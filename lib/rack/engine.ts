/**
 * Rack engine: the rack iPad's set lifecycle as a PURE reducer.
 * No React, no Supabase, no BLE, no timers.
 *
 *   reduce(state, event, now) -> { state, effects }
 *
 * `now` (epoch ms) is injected; time only advances through events, and
 * `tick` drives the 60 s no-rep save.
 *
 * Source of truth: the server's `rack_sessions` row owns who is active and
 * the queue. It arrives as `sessionSync(row)` (realtime, and the row each
 * rack RPC returns). A row whose `updated_at` is older than the last applied
 * row is ignored, so an RPC response landing after a newer realtime row is
 * harmless. The engine never edits the queue locally; it asks the server
 * through `rpcSetActive` / `rpcStartSet` / `rpcEndSet` and waits for the next
 * sync. Phone join / "I'm up" / Leave are server RPCs the phone calls; the
 * engine only sees their result in a sync.
 *
 * Executor contract:
 *   - Effects are ORDERED; run them in order. `rpcEndSet` only after the
 *     preceding `endSet` row is persisted (or durably queued).
 *   - Feed every RPC's returned row back as a `sessionSync`.
 *   - Dispatch `rpcSettled{kind, athleteId}` when an RPC succeeds and
 *     `rpcFailed{kind, athleteId}` when it errors (refused or unsendable).
 *     `rpcSetActive` must NOT be queued offline: show the tiles as offline
 *     and dispatch `rpcFailed('setActive')`.
 *   - After a restart, dispatch `seedHighWater` for today's already-written
 *     sets (exercise_logs) of the active athlete's workout.
 *   - `writeRep` -> vbt_reps insert (dedupe on client_rep_id).
 *     `endSet` / `amendSet` -> upsert_exercise_log; both SKIPPED when `free`.
 *   - Dispatch `tick` about once a second.
 *
 * Set start: the first rep while not lifting starts a set and ALWAYS emits
 * `rpcStartSet{athleteId, setStartedAt}` with that set's own start — even if
 * the engine believes the server is still 'lifting'. rack_start_set flips the
 * row to 'lifting' only while that athlete is active, and takes over a stale
 * lift of the same athlete when the new start is newer (new set_started_at,
 * pending_end cleared), so phone Done / Leave then match the new set.
 *
 * Set end triggers (ending is idempotent; a set is ended once):
 *   - `ipadDone` / `done`                          endedBy 'ipad' ('phone' in solo)
 *   - sync with pending_end = true                 endedBy 'phone'
 *   - sync with leave_requested = true             endedBy 'leave'
 *     Both flags only count when the row's set_started_at equals the live
 *     set's start (the iPad's own p_started_at). Otherwise ignored.
 *   - `selectAthlete(other)`                        endedBy 'switch'
 *     (endSet, then rpcSetActive; NO rpcEndSet — rack_set_active rotates)
 *   - sync where the server moved the active lifter away mid-set
 *                                                  endedBy 'switch' (no RPC)
 *   - `tick` 60 s after the last rep               endedBy 'idle'
 *
 * Late reps: a rep within 3 s after a set ended attaches to that set
 * (`writeRep` + `amendSet` with the full updated summary). After 3 s a rep
 * starts a new set.
 *
 * Tile switch: after `selectAthlete`, reps are BUFFERED (never dropped) until
 * the switch resolves, then credited to whoever the server says is active:
 *   - any applied sync that shows the chosen athlete active, or that changes
 *     the active athlete at all (the server decided) -> the new active one;
 *   - `rpcFailed('setActive')` -> the still-active athlete;
 *   - another tile tap first flushes the pending buffer to the currently
 *     active athlete, then starts its own switch.
 * `rpcSettled('setActive')` without a confirming sync keeps waiting.
 *
 * Set numbers: per (athlete, workout instance, routine exercise) the engine
 * keeps a high-water mark of the set numbers it has written. A new set's
 * number is max(phone set_number, highWater + 1), so a lagging phone context
 * (or a superset A1 -> A2 -> A1) can never overwrite a written set.
 * EXCEPTION — idle end: after a 60 s idle end the number is held until the
 * context changes or the active athlete changes. A later rep with the
 * unchanged context starts a new set with the SAME set_number that carries
 * the idle-ended set's reps forward, so the upsert rewrites the set with all
 * its reps — the server-side "reopen" of spec §3. Carried reps are not
 * re-written to vbt_reps (rep_index continues; clientRepIds use the new
 * set start, so they never collide).
 *
 * Context for the next set (rack): pending_* if the phone sent one mid-set,
 * else the row's live context; if that has no workout instance, the iPad's
 * `localContext` for the active athlete (the executor's "first remaining
 * exercise in workout order"). A server/phone context always wins. The live
 * set's context, load and zone are frozen at its start. A free set (no
 * workout instance or no routine exercise) writes vbt_reps only and keeps no
 * ROM history (partials use the 8 in rule).
 *
 * Modes (fixed at init):
 *   - 'rack': the rack iPad (above). endSet.source = 'rack'.
 *   - 'solo': phone-direct fallback — the athlete paired the OVR straight to
 *     their iPhone, no rack iPad. The active athlete is fixed, there is no
 *     queue and no sessionSync; context + exercise metadata arrive as
 *     `soloContext`. Emits NO rpcSetActive / rpcStartSet / rpcEndSet.
 *     endSet.source = 'phone'. Every other rule (Done, 60 s idle end, 3 s
 *     late-rep attach, partials, drop cue, writeRep, writeLoadToSensor,
 *     set-number high-water/hold) is identical. rackId is null
 *     (vbt_reps.rack_id null); clientRepId uses the prefix 'solo'.
 */

import {
  type OvrRep,
  type Zone,
  dropPct as dropPctOf,
  isPartial as isPartialRom,
  zoneOf,
} from '../ovr/protocol';

export const IDLE_END_MS = 60_000;
export const LATE_REP_MS = 3_000;

// ---------------------------------------------------------------- types

export type SetState = 'idle' | 'lifting' | 'summary';
export type EngineMode = 'rack' | 'solo';
export type SetSource = 'rack' | 'phone';
export type EndedBy = 'ipad' | 'phone' | 'switch' | 'leave' | 'idle';
export type RpcKind = 'setActive' | 'endSet' | 'startSet';

/** The `rack_sessions` row as it arrives over realtime (snake_case). */
export interface RackSessionRow {
  rack_id: string;
  active_athlete_id: string | null;
  workout_instance_id: string | null;
  routine_exercise_id: string | null;
  exercise_id: string | null;
  set_number: number | null;
  load_lb: number | null;
  state: SetState;
  queue: string[];
  set_started_at: string | null;
  pending_workout_instance_id: string | null;
  pending_routine_exercise_id: string | null;
  pending_set_number: number | null;
  pending_load_lb: number | null;
  leave_requested: boolean;
  pending_end: boolean;
  /** Maintained by the touch_updated_at trigger; orders out-of-order rows. */
  updated_at: string;
}

/** Which set the phone has open (camelCase of the session's context). */
export interface RackContext {
  workoutInstanceId: string | null;
  routineExerciseId: string | null;
  exerciseId: string | null;
  setNumber: number | null;
  loadLb: number | null;
}

/** Local exercise metadata (exercises.velocity_min/max_mps, speed_drop_stop_pct). */
export interface ExerciseMeta {
  zoneMin: number | null;
  zoneMax: number | null;
  dropStopPct: number | null;
}

export interface EngineRep {
  repIndex: number;
  clientRepId: string;
  v: number;
  pv: number;
  rom: number;
  meanPowerW: number;
  peakPowerW: number;
  concentricS: number;
  partial: boolean;
  zone: Zone | null;
  /** Drop vs best full rep of the set (full reps only; partial → null). */
  dropPct: number | null;
  dropCue: boolean;
  receivedAtMs: number;
  /** Carried forward from an idle-ended set (already written to vbt_reps). */
  carried?: boolean;
}

export interface LiveSet {
  athleteId: string;
  startedAtMs: number;
  /** Context as the phone/session/iPad gave it (before set numbering). */
  rawContext: RackContext;
  /** Context this set is written with (numbered, load fallback applied). */
  context: RackContext;
  zone: [number, number] | null;
  dropStopPct: number | null;
  reps: EngineRep[];
  lastRepAtMs: number;
  endedAtMs: number | null;
  endedBy: EndedBy | null;
  free: boolean;
}

export interface SetSummary {
  /** null in solo mode. */
  rackId: string | null;
  source: SetSource;
  athleteId: string;
  workoutInstanceId: string | null;
  routineExerciseId: string | null;
  exerciseId: string | null;
  setNumber: number | null;
  loadLb: number | null;
  setStartedAt: string;
  reps: { v: number; pv: number; rom: number; partial: boolean }[];
  fullReps: number;
  avgV: number | null;
  bestV: number | null;
  dropPct: number | null;
  zone: [number, number] | null;
  endedBy: EndedBy;
  free: boolean;
}

/** One `vbt_reps` row to write (client_rep_id dedupes offline replays). */
export interface RepWrite {
  clientRepId: string;
  /** null in solo mode. */
  rackId: string | null;
  athleteId: string;
  workoutInstanceId: string | null;
  routineExerciseId: string | null;
  exerciseId: string | null;
  setNumber: number | null;
  repIndex: number;
  loadLb: number | null;
  meanVelocity: number;
  peakVelocity: number;
  meanPowerW: number;
  peakPowerW: number;
  romIn: number;
  concentricS: number;
  isPartial: boolean;
  zone: Zone | null;
  dropPct: number | null;
  dropCue: boolean;
  receivedAt: string;
}

interface EndRecord {
  rawContext: RackContext;
  setNumber: number | null;
  endedBy: EndedBy;
  /** Idle end: don't advance set_number (released on context/athlete change). */
  hold: boolean;
  set: LiveSet;
}

export interface RackEngineState {
  mode: EngineMode;
  /** null in solo mode. */
  rackId: string | null;
  /** Solo mode: the phone's latest context (rack mode: unused, null). */
  soloContext: RackContext | null;
  /** iPad-picked context, used only while the server row has no workout. */
  localContext: (RackContext & { athleteId: string }) | null;
  /** Last row applied from the server (null until the first sync). */
  session: RackSessionRow | null;
  activeAthleteId: string | null;
  queue: string[];
  setState: SetState;
  /** The set being lifted (setState 'lifting') — null otherwise. */
  live: LiveSet | null;
  /** The most recently ended set (shown in summary; late reps attach to it). */
  lastEnded: LiveSet | null;
  lastEndByAthlete: Record<string, EndRecord>;
  /** Highest set number written, key `${athleteId}:${workoutInstanceId}:${routineExerciseId}`. */
  setHighWater: Record<string, number>;
  metaByExercise: Record<string, ExerciseMeta>;
  exerciseByRoutineExercise: Record<string, string>;
  /** Full-rep ROMs of ended non-free sets, key `${athleteId}:${exerciseId}`. */
  romHistory: Record<string, number[]>;
  loadOverrideLb: number | null;
  sensorLoadLb: number | null;
  /** Tile tapped; waiting for the confirming sync (or rpcFailed). */
  switchingTo: string | null;
  /** Reps that arrived while switching; credited once the switch resolves. */
  switchBuffer: { rep: OvrRep; atMs: number }[];
  /** rpcEndSet emitted for this athlete; not yet reflected by a sync. */
  endRpcPendingFor: string | null;
}

export type RackEvent =
  | { type: 'sessionSync'; row: RackSessionRow }
  | {
      type: 'contextMeta';
      exerciseId: string;
      routineExerciseId?: string | null;
      zoneMin: number | null;
      zoneMax: number | null;
      dropStopPct: number | null;
    }
  | {
      /** Solo mode only: the phone's open set + that exercise's metadata. */
      type: 'soloContext';
      workoutInstanceId: string | null;
      routineExerciseId: string | null;
      exerciseId: string | null;
      setNumber: number | null;
      loadLb: number | null;
      zoneMin: number | null;
      zoneMax: number | null;
      dropStopPct: number | null;
    }
  | {
      /**
       * Rack mode only: the iPad's pick (first remaining exercise in workout
       * order) for `athleteId`, used while the server row has no workout
       * context. Carries that exercise's metadata.
       */
      type: 'localContext';
      athleteId: string;
      workoutInstanceId: string | null;
      routineExerciseId: string | null;
      exerciseId: string | null;
      setNumber: number | null;
      loadLb: number | null;
      zoneMin: number | null;
      zoneMax: number | null;
      dropStopPct: number | null;
    }
  | { type: 'rep'; rep: OvrRep }
  /** Done on the rack iPad (rack mode) — endedBy 'ipad'. */
  | { type: 'ipadDone' }
  /** Done on the device running the engine: 'ipad' in rack, 'phone' in solo. */
  | { type: 'done' }
  | { type: 'selectAthlete'; athleteId: string }
  | { type: 'tick' }
  | { type: 'loadChanged'; lb: number | null }
  /** The executor's RPC errored (refused, or not sendable). */
  | { type: 'rpcFailed'; kind: RpcKind; athleteId: string }
  /** The executor's RPC succeeded (its returned row still goes in as a sessionSync). */
  | { type: 'rpcSettled'; kind: RpcKind; athleteId: string }
  /** Restart: a set already written today (raises the set-number high-water mark). */
  | {
      type: 'seedHighWater';
      athleteId: string;
      workoutInstanceId: string;
      routineExerciseId: string;
      setNumber: number;
    };

export type RackEffect =
  /** rack_start_set(p_rack, athleteId, setStartedAt): 'lifting' only if still active. */
  | { type: 'rpcStartSet'; athleteId: string; setStartedAt: string }
  | { type: 'writeRep'; rep: RepWrite }
  | { type: 'endSet'; summary: SetSummary }
  | { type: 'amendSet'; summary: SetSummary; rep: RepWrite }
  | { type: 'rpcEndSet'; athleteId: string }
  | { type: 'rpcSetActive'; athleteId: string }
  | { type: 'writeLoadToSensor'; lb: number }
  /** Only when nobody is (or is becoming) active on the rack. */
  | { type: 'droppedRep'; reason: 'noAthlete'; rep: OvrRep };

export interface ReduceResult {
  state: RackEngineState;
  effects: RackEffect[];
}

export type EngineInit =
  | { mode: 'rack'; rackId: string }
  | { mode: 'solo'; athleteId: string };

// ---------------------------------------------------------------- helpers

/** `createRackEngine('rack-id')` is shorthand for `{ mode: 'rack', rackId }`. */
export function createRackEngine(init: string | EngineInit): RackEngineState {
  const i: EngineInit = typeof init === 'string' ? { mode: 'rack', rackId: init } : init;
  return {
    mode: i.mode,
    rackId: i.mode === 'rack' ? i.rackId : null,
    soloContext: null,
    localContext: null,
    session: null,
    activeAthleteId: i.mode === 'solo' ? i.athleteId : null,
    queue: [],
    setState: 'idle',
    live: null,
    lastEnded: null,
    lastEndByAthlete: {},
    setHighWater: {},
    metaByExercise: {},
    exerciseByRoutineExercise: {},
    romHistory: {},
    loadOverrideLb: null,
    sensorLoadLb: null,
    switchingTo: null,
    switchBuffer: [],
    endRpcPendingFor: null,
  };
}

/** Deterministic: same rack/athlete/set start/index → same id (replay-safe). */
export function clientRepIdOf(
  rackId: string | null,
  athleteId: string,
  setStartedAtMs: number,
  repIndex: number,
): string {
  return `${rackId ?? 'solo'}:${athleteId}:${setStartedAtMs}:${repIndex}`;
}

const romKey = (athleteId: string, exerciseId: string | null) => `${athleteId}:${exerciseId}`;
const hwKey = (athleteId: string, c: RackContext) =>
  `${athleteId}:${c.workoutInstanceId}:${c.routineExerciseId}`;
const isFree = (c: RackContext) => c.workoutInstanceId == null || c.routineExerciseId == null;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const EMPTY_CTX: RackContext = {
  workoutInstanceId: null,
  routineExerciseId: null,
  exerciseId: null,
  setNumber: null,
  loadLb: null,
};

/** Context for the next set, either mode. */
export function nextContext(s: RackEngineState): RackContext {
  if (s.mode === 'solo') return s.soloContext ?? EMPTY_CTX;
  const server = serverNextContext(s.session, s.exerciseByRoutineExercise);
  if (server.workoutInstanceId == null && s.localContext && s.localContext.athleteId === s.activeAthleteId) {
    const { athleteId: _a, ...ctx } = s.localContext;
    return ctx;
  }
  return server;
}

/** Server context for the NEXT set: pending (phone sent it mid-set) wins over live. */
function serverNextContext(
  row: RackSessionRow | null,
  exByRe: Record<string, string>,
): RackContext {
  if (!row) return EMPTY_CTX;
  const hasPending =
    row.pending_workout_instance_id != null ||
    row.pending_routine_exercise_id != null ||
    row.pending_set_number != null ||
    row.pending_load_lb != null;
  if (hasPending) {
    const re = row.pending_routine_exercise_id;
    return {
      workoutInstanceId: row.pending_workout_instance_id,
      routineExerciseId: re,
      exerciseId: re ? exByRe[re] ?? null : null,
      setNumber: row.pending_set_number,
      loadLb: row.pending_load_lb,
    };
  }
  return {
    workoutInstanceId: row.workout_instance_id,
    routineExerciseId: row.routine_exercise_id,
    exerciseId: row.exercise_id,
    setNumber: row.set_number,
    loadLb: row.load_lb,
  };
}

const sameCtx = (a: RackContext, b: RackContext) =>
  a.workoutInstanceId === b.workoutInstanceId &&
  a.routineExerciseId === b.routineExerciseId &&
  a.setNumber === b.setNumber;

/** Summary of an ENDED set (throws if the set has no end reason). */
export function summarize(
  rackId: string | null,
  set: LiveSet,
  source: SetSource = rackId == null ? 'phone' : 'rack',
): SetSummary {
  if (set.endedBy == null) throw new Error('rack engine: summarize() needs an ended set');
  const full = set.reps.filter((r) => !r.partial);
  const bestV = full.length ? Math.max(...full.map((r) => r.v)) : null;
  const avgV = full.length
    ? Math.round((full.reduce((a, r) => a + r.v, 0) / full.length) * 1000) / 1000
    : null;
  const last = full[full.length - 1];
  return {
    rackId,
    source,
    athleteId: set.athleteId,
    workoutInstanceId: set.context.workoutInstanceId,
    routineExerciseId: set.context.routineExerciseId,
    exerciseId: set.context.exerciseId,
    setNumber: set.context.setNumber,
    loadLb: set.context.loadLb,
    setStartedAt: new Date(set.startedAtMs).toISOString(),
    reps: set.reps.map((r) => ({ v: r.v, pv: r.pv, rom: r.rom, partial: r.partial })),
    fullReps: full.length,
    avgV,
    bestV,
    dropPct: bestV != null && last ? dropPctOf(bestV, last.v) : null,
    zone: set.zone,
    endedBy: set.endedBy,
    free: set.free,
  };
}

const summarizeFor = (s: RackEngineState, set: LiveSet) =>
  summarize(s.rackId, set, s.mode === 'solo' ? 'phone' : 'rack');

function effectiveLoad(s: RackEngineState): number | null {
  const ctxLoad = s.live ? s.live.context.loadLb : nextContext(s).loadLb;
  return ctxLoad ?? s.loadOverrideLb;
}

function syncSensorLoad(s: RackEngineState, fx: RackEffect[]): RackEngineState {
  const lb = effectiveLoad(s);
  if (lb == null || lb === s.sensorLoadLb) return s;
  fx.push({ type: 'writeLoadToSensor', lb });
  return { ...s, sensorLoadLb: lb };
}

/** The active athlete's idle hold is released once the next context differs. */
function releaseHoldOnNewContext(s: RackEngineState): RackEngineState {
  const a = s.activeAthleteId;
  const rec = a ? s.lastEndByAthlete[a] : undefined;
  if (!a || !rec || !rec.hold || s.setState === 'lifting') return s;
  if (sameCtx(rec.rawContext, nextContext(s))) return s;
  return { ...s, lastEndByAthlete: { ...s.lastEndByAthlete, [a]: { ...rec, hold: false } } };
}

/** Build + append one rep to `set`; returns the new set and its write. */
function addRep(
  s: RackEngineState,
  set: LiveSet,
  rep: OvrRep,
  now: number,
): { set: LiveSet; write: RepWrite } {
  const med = set.free
    ? null
    : median(s.romHistory[romKey(set.athleteId, set.context.exerciseId)] ?? []);
  const partial = isPartialRom(rep.romIn, med);
  const repIndex = set.reps.length + 1;
  const zone = set.zone ? zoneOf(rep.meanV, set.zone[0], set.zone[1]) : null;
  let drop: number | null = null;
  let dropCue = false;
  if (!partial) {
    const best = Math.max(rep.meanV, ...set.reps.filter((r) => !r.partial).map((r) => r.v));
    drop = dropPctOf(best, rep.meanV);
    dropCue = set.zone != null && set.dropStopPct != null && drop >= set.dropStopPct;
  }
  const clientRepId = clientRepIdOf(s.rackId, set.athleteId, set.startedAtMs, repIndex);
  const er: EngineRep = {
    repIndex,
    clientRepId,
    v: rep.meanV,
    pv: rep.peakV,
    rom: rep.romIn,
    meanPowerW: rep.meanPowerW,
    peakPowerW: rep.peakPowerW,
    concentricS: rep.concentricS,
    partial,
    zone,
    dropPct: drop,
    dropCue,
    receivedAtMs: now,
  };
  const next: LiveSet = { ...set, reps: [...set.reps, er], lastRepAtMs: now };
  const write: RepWrite = {
    clientRepId,
    rackId: s.rackId,
    athleteId: set.athleteId,
    workoutInstanceId: set.context.workoutInstanceId,
    routineExerciseId: set.context.routineExerciseId,
    exerciseId: set.context.exerciseId,
    setNumber: set.context.setNumber,
    repIndex,
    loadLb: set.context.loadLb,
    meanVelocity: rep.meanV,
    peakVelocity: rep.peakV,
    meanPowerW: rep.meanPowerW,
    peakPowerW: rep.peakPowerW,
    romIn: rep.romIn,
    concentricS: rep.concentricS,
    isPartial: partial,
    zone,
    dropPct: drop,
    dropCue,
    receivedAt: new Date(now).toISOString(),
  };
  return { set: next, write };
}

/**
 * Set number the athlete's NEXT set gets (what startSet will use): an
 * idle-hold reopen keeps the held number; otherwise max(phone, high-water + 1).
 * Free sets keep the raw (null) number.
 */
export function nextSetNumber(s: RackEngineState, athleteId: string): number | null {
  return numberFor(s, athleteId, nextContext(s)).setNumber;
}

function numberFor(
  s: RackEngineState,
  athleteId: string,
  raw: RackContext,
): { setNumber: number | null; reopen: boolean } {
  if (isFree(raw)) return { setNumber: raw.setNumber, reopen: false };
  const prev = s.lastEndByAthlete[athleteId];
  if (prev && prev.hold && sameCtx(prev.rawContext, raw)) {
    // Idle end, unchanged context: same set_number, reps carried forward.
    return { setNumber: prev.setNumber, reopen: true };
  }
  const floor = s.setHighWater[hwKey(athleteId, raw)] ?? 0;
  return { setNumber: Math.max(raw.setNumber ?? 0, floor + 1), reopen: false };
}

function startSet(s: RackEngineState, athleteId: string, now: number): LiveSet {
  const raw = nextContext(s);
  const free = isFree(raw);
  const prev = s.lastEndByAthlete[athleteId];
  const { setNumber, reopen } = numberFor(s, athleteId, raw);
  const carried: EngineRep[] = reopen ? prev.set.reps.map((r) => ({ ...r, carried: true })) : [];
  const meta = raw.exerciseId ? s.metaByExercise[raw.exerciseId] : undefined;
  const zone: [number, number] | null =
    meta && meta.zoneMin != null && meta.zoneMax != null ? [meta.zoneMin, meta.zoneMax] : null;
  return {
    athleteId,
    startedAtMs: now,
    rawContext: raw,
    context: { ...raw, setNumber, loadLb: raw.loadLb ?? s.loadOverrideLb },
    zone,
    dropStopPct: meta?.dropStopPct ?? null,
    reps: carried,
    lastRepAtMs: now,
    endedAtMs: null,
    endedBy: null,
    free,
  };
}

/** End the live set (no-op when nothing is lifting). */
function endLive(
  s: RackEngineState,
  by: EndedBy,
  now: number,
  fx: RackEffect[],
  callEndRpc: boolean,
): RackEngineState {
  if (s.setState !== 'lifting' || !s.live) return s;
  const rpc = callEndRpc && s.mode === 'rack';
  const ended: LiveSet = { ...s.live, endedAtMs: now, endedBy: by };
  fx.push({ type: 'endSet', summary: summarizeFor(s, ended) });
  if (rpc) fx.push({ type: 'rpcEndSet', athleteId: ended.athleteId });

  let romHistory = s.romHistory;
  let setHighWater = s.setHighWater;
  if (!ended.free) {
    const key = romKey(ended.athleteId, ended.context.exerciseId);
    const fullRoms = ended.reps.filter((r) => !r.partial && !r.carried).map((r) => r.rom);
    romHistory = { ...romHistory, [key]: [...(romHistory[key] ?? []), ...fullRoms] };
    const hk = hwKey(ended.athleteId, ended.context);
    if (ended.context.setNumber != null) {
      setHighWater = {
        ...setHighWater,
        [hk]: Math.max(setHighWater[hk] ?? 0, ended.context.setNumber),
      };
    }
  }
  const next: RackEngineState = {
    ...s,
    setState: 'summary',
    live: null,
    lastEnded: ended,
    lastEndByAthlete: {
      ...s.lastEndByAthlete,
      [ended.athleteId]: {
        rawContext: ended.rawContext,
        setNumber: ended.context.setNumber,
        endedBy: by,
        hold: by === 'idle',
        set: ended,
      },
    },
    romHistory,
    setHighWater,
    endRpcPendingFor: rpc ? ended.athleteId : s.endRpcPendingFor,
  };
  return syncSensorLoad(next, fx);
}

/** Credit a rep to the active athlete: start a set if needed, then add it. */
function applyRep(s: RackEngineState, rep: OvrRep, at: number, fx: RackEffect[]): RackEngineState {
  const athleteId = s.activeAthleteId;
  if (!athleteId) {
    fx.push({ type: 'droppedRep', reason: 'noAthlete', rep });
    return s;
  }
  let live = s.live;
  if (s.setState !== 'lifting' || !live) {
    live = startSet(s, athleteId, at);
    if (s.mode === 'rack') {
      fx.push({ type: 'rpcStartSet', athleteId, setStartedAt: new Date(at).toISOString() });
    }
    s = { ...s, setState: 'lifting' };
  }
  const { set, write } = addRep(s, live, rep, at);
  fx.push({ type: 'writeRep', rep: write });
  return syncSensorLoad({ ...s, live: set }, fx);
}

function flushSwitchBuffer(s: RackEngineState, fx: RackEffect[]): RackEngineState {
  const buf = s.switchBuffer;
  s = { ...s, switchingTo: null, switchBuffer: [] };
  for (const b of buf) s = applyRep(s, b.rep, b.atMs, fx);
  return s;
}

/** Does this row's pending_end / leave_requested belong to the live set? */
function flagsBelongToLive(s: RackEngineState, row: RackSessionRow): boolean {
  const live = s.live;
  if (!live) return false;
  // rack_start_set always stamps set_started_at with the iPad's own start,
  // so a row without one (or with another set's) is not about this set.
  return row.set_started_at != null && ms(row.set_started_at) === live.startedAtMs;
}

function applyMeta(
  s: RackEngineState,
  e: { exerciseId: string; routineExerciseId?: string | null } & ExerciseMeta,
): RackEngineState {
  const meta: ExerciseMeta = { zoneMin: e.zoneMin, zoneMax: e.zoneMax, dropStopPct: e.dropStopPct };
  s = {
    ...s,
    metaByExercise: { ...s.metaByExercise, [e.exerciseId]: meta },
    exerciseByRoutineExercise: e.routineExerciseId
      ? { ...s.exerciseByRoutineExercise, [e.routineExerciseId]: e.exerciseId }
      : s.exerciseByRoutineExercise,
  };
  // Metadata (not a context change): fill in a live set that started before
  // its exercise's metadata / exercise id loaded.
  const live = s.live;
  if (
    live &&
    (live.context.exerciseId === e.exerciseId ||
      (live.context.exerciseId == null &&
        e.routineExerciseId != null &&
        live.context.routineExerciseId === e.routineExerciseId))
  ) {
    const zone: [number, number] | null =
      meta.zoneMin != null && meta.zoneMax != null ? [meta.zoneMin, meta.zoneMax] : null;
    s = {
      ...s,
      live: {
        ...live,
        context: { ...live.context, exerciseId: e.exerciseId },
        zone,
        dropStopPct: meta.dropStopPct,
      },
    };
  }
  return s;
}

// ---------------------------------------------------------------- reducer

export function reduce(state: RackEngineState, event: RackEvent, now: number): ReduceResult {
  const fx: RackEffect[] = [];
  let s = state;

  switch (event.type) {
    case 'sessionSync': {
      if (s.mode === 'solo') break;
      const row = event.row;
      // Out-of-order delivery: never apply a row older than the last one.
      if (s.session && ms(row.updated_at) < ms(s.session.updated_at)) break;

      const prevActive = s.activeAthleteId;
      const nextActive = row.active_athlete_id;

      let endRpcPendingFor = s.endRpcPendingFor;
      if (
        endRpcPendingFor != null &&
        (nextActive !== endRpcPendingFor ||
          (row.state === 'idle' && !row.pending_end && !row.leave_requested))
      ) {
        endRpcPendingFor = null;
      }

      // Athlete changed: the previous lifter's idle hold is released.
      let lastEndByAthlete = s.lastEndByAthlete;
      if (prevActive && prevActive !== nextActive && lastEndByAthlete[prevActive]?.hold) {
        lastEndByAthlete = {
          ...lastEndByAthlete,
          [prevActive]: { ...lastEndByAthlete[prevActive], hold: false },
        };
      }

      s = {
        ...s,
        session: row,
        activeAthleteId: nextActive,
        queue: [...row.queue],
        endRpcPendingFor,
        lastEndByAthlete,
      };

      if (s.setState === 'lifting' && s.live) {
        if (s.live.athleteId !== nextActive) {
          // Server moved the rack on mid-set; save what we have.
          s = endLive(s, 'switch', now, fx, false);
        } else if ((row.pending_end || row.leave_requested) && flagsBelongToLive(s, row)) {
          s = endLive(s, row.pending_end ? 'phone' : 'leave', now, fx, true);
        }
      } else if (
        nextActive &&
        !s.switchingTo &&
        (row.pending_end || row.leave_requested) &&
        s.endRpcPendingFor !== nextActive
      ) {
        // Server is waiting on the iPad to finish a set the engine is not
        // lifting (e.g. app restarted): finish it so the rack isn't stuck.
        fx.push({ type: 'rpcEndSet', athleteId: nextActive });
        s = { ...s, endRpcPendingFor: nextActive };
      }

      if (prevActive !== nextActive && s.setState !== 'lifting') {
        s = { ...s, setState: 'idle' };
      }
      // The switch resolves on the confirming sync, or on any applied change
      // of the active athlete: buffered reps go to whoever the server says
      // is active now.
      if (s.switchingTo && (nextActive === s.switchingTo || nextActive !== prevActive)) {
        s = flushSwitchBuffer(s, fx);
      }
      s = releaseHoldOnNewContext(s);
      s = syncSensorLoad(s, fx);
      break;
    }

    case 'contextMeta':
      s = applyMeta(s, event);
      break;

    case 'soloContext': {
      if (s.mode !== 'solo') break;
      const { type: _t, zoneMin, zoneMax, dropStopPct, ...ctx } = event;
      s = { ...s, soloContext: ctx };
      if (ctx.exerciseId) {
        s = applyMeta(s, { exerciseId: ctx.exerciseId, routineExerciseId: ctx.routineExerciseId, zoneMin, zoneMax, dropStopPct });
      }
      // Mid-set: the live set is frozen; this context applies to the next set.
      s = releaseHoldOnNewContext(s);
      s = syncSensorLoad(s, fx);
      break;
    }

    case 'localContext': {
      if (s.mode !== 'rack') break;
      const { type: _t, zoneMin, zoneMax, dropStopPct, ...ctx } = event;
      s = { ...s, localContext: ctx };
      if (ctx.exerciseId) {
        s = applyMeta(s, { exerciseId: ctx.exerciseId, routineExerciseId: ctx.routineExerciseId, zoneMin, zoneMax, dropStopPct });
      }
      s = releaseHoldOnNewContext(s);
      s = syncSensorLoad(s, fx);
      break;
    }

    case 'rep': {
      const just = s.lastEnded;
      if (
        s.setState !== 'lifting' &&
        just &&
        just.endedAtMs != null &&
        now - just.endedAtMs <= LATE_REP_MS
      ) {
        const { set, write } = addRep(s, just, event.rep, now);
        // A late rep does not extend the window or re-end the set.
        const amended: LiveSet = { ...set, endedAtMs: just.endedAtMs };
        fx.push({ type: 'writeRep', rep: write });
        fx.push({ type: 'amendSet', summary: summarizeFor(s, amended), rep: write });
        const rec = s.lastEndByAthlete[amended.athleteId];
        const last = amended.reps[amended.reps.length - 1];
        let romHistory = s.romHistory;
        if (!amended.free && !last.partial) {
          const key = romKey(amended.athleteId, amended.context.exerciseId);
          romHistory = { ...romHistory, [key]: [...(romHistory[key] ?? []), last.rom] };
        }
        s = {
          ...s,
          lastEnded: amended,
          lastEndByAthlete:
            rec && rec.set.startedAtMs === amended.startedAtMs
              ? { ...s.lastEndByAthlete, [amended.athleteId]: { ...rec, set: amended } }
              : s.lastEndByAthlete,
          romHistory,
        };
        break;
      }
      if (s.switchingTo) {
        s = { ...s, switchBuffer: [...s.switchBuffer, { rep: event.rep, atMs: now }] };
        break;
      }
      s = applyRep(s, event.rep, now, fx);
      break;
    }

    case 'ipadDone':
    case 'done':
      s = endLive(s, s.mode === 'solo' ? 'phone' : 'ipad', now, fx, true);
      break;

    case 'selectAthlete': {
      if (s.mode === 'solo') break;
      if (event.athleteId === s.switchingTo) break;
      if (!s.switchingTo && event.athleteId === s.activeAthleteId) break;
      // A pending switch is replaced: its reps go to the currently active
      // athlete first (never to the next one tapped).
      if (s.switchingTo) s = flushSwitchBuffer(s, fx);
      s = endLive(s, 'switch', now, fx, false);
      fx.push({ type: 'rpcSetActive', athleteId: event.athleteId });
      s = { ...s, switchingTo: event.athleteId };
      break;
    }

    case 'rpcFailed': {
      if (s.mode === 'solo') break;
      if (event.kind === 'setActive' && s.switchingTo === event.athleteId) {
        // Switch refused / unsendable: buffered reps go to the still-active athlete.
        s = flushSwitchBuffer(s, fx);
      } else if (event.kind === 'endSet' && s.endRpcPendingFor === event.athleteId) {
        // Allow the release path to try again on the next flagged sync.
        s = { ...s, endRpcPendingFor: null };
      }
      // 'startSet' refused: the athlete is no longer active server-side; the
      // sync that shows the new lifter ends the live set as a 'switch'.
      break;
    }

    case 'rpcSettled':
      // setActive settled without its confirming row: keep waiting — the row
      // (or any later change of the active athlete) resolves the switch.
      break;

    case 'seedHighWater': {
      const k = `${event.athleteId}:${event.workoutInstanceId}:${event.routineExerciseId}`;
      s = {
        ...s,
        setHighWater: { ...s.setHighWater, [k]: Math.max(s.setHighWater[k] ?? 0, event.setNumber) },
      };
      break;
    }

    case 'tick':
      if (s.setState === 'lifting' && s.live && now - s.live.lastRepAtMs >= IDLE_END_MS) {
        s = endLive(s, 'idle', now, fx, true);
      }
      break;

    case 'loadChanged':
      s = syncSensorLoad({ ...s, loadOverrideLb: event.lb }, fx);
      break;
  }

  return { state: s, effects: fx };
}
