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
 * rack RPC returns). The engine never edits the queue locally; it asks the
 * server through `rpcSetActive` / `rpcEndSet` and waits for the next sync.
 * Phone join / "I'm up" / Leave are server RPCs the phone calls; the engine
 * only sees their result in a sync.
 *
 * Effects are ORDERED. The executor must run them in order; in particular
 * `rpcEndSet` must only be called after the preceding `endSet` row has been
 * persisted (or durably queued). The executor should feed every RPC's
 * returned row back as a `sessionSync`.
 *
 * Set end triggers (ending is idempotent; a set is ended once):
 *   - `ipadDone`                                   endedBy 'ipad'
 *   - sync with pending_end = true                 endedBy 'phone'
 *   - sync with leave_requested = true             endedBy 'leave'
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
 * Set numbers: the phone's context (rack_sessions.set_number) is used as-is
 * when the phone sends a new one. When the phone has NOT sent a new context
 * since the athlete's last set ended (same workout / routine exercise / raw
 * set_number), the engine uses lastSetNumber + 1 so a following set never
 * overwrites the previous one through the upsert key.
 * EXCEPTION — idle end: after a 60 s idle end the set number is NOT advanced
 * until the phone sends a new context or the active athlete changes. A later
 * rep with the unchanged context starts a new set with the SAME set_number,
 * and that set carries the idle-ended set's reps forward, so the upsert on
 * (same set_number) rewrites the set with all its reps — the server-side
 * "reopen" of spec §3. Carried reps are not re-written to vbt_reps.
 *
 * Modes (fixed at init):
 *   - 'rack': the rack iPad (above). endSet.source = 'rack'.
 *   - 'solo': phone-direct fallback — the athlete paired the OVR straight to
 *     their iPhone, no rack iPad. The active athlete is fixed, there is no
 *     queue and no sessionSync; context + exercise metadata arrive as
 *     `soloContext`. Emits NO rpcSetActive / rpcEndSet / sessionPatch.
 *     endSet.source = 'phone'. Every other rule (Done, 60 s idle end, 3 s
 *     late-rep attach, partials, drop cue, writeRep, writeLoadToSensor,
 *     set-number advance/hold) is identical. rackId is null (vbt_reps.rack_id
 *     null); clientRepId uses the prefix 'solo'.
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
/** Safety: forget a pending tile switch if no sync arrives within this. */
export const SWITCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------- types

export type SetState = 'idle' | 'lifting' | 'summary';
export type EngineMode = 'rack' | 'solo';
export type SetSource = 'rack' | 'phone';
export type EndedBy = 'ipad' | 'phone' | 'switch' | 'leave' | 'idle';

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
  /** Context as the phone/session gave it (before set-number advance). */
  rawContext: RackContext;
  /** Context this set is written with. */
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
  /** Idle end: don't advance set_number (cleared when the athlete changes). */
  hold: boolean;
  set: LiveSet;
}

export interface RackEngineState {
  mode: EngineMode;
  /** null in solo mode. */
  rackId: string | null;
  /** Solo mode: the phone's latest context (rack mode: unused, null). */
  soloContext: RackContext | null;
  /** Last row synced from the server (null until the first sync). */
  session: RackSessionRow | null;
  activeAthleteId: string | null;
  queue: string[];
  setState: SetState;
  /** The set being lifted (setState 'lifting') — null otherwise. */
  live: LiveSet | null;
  /** The most recently ended set (shown in summary; late reps attach to it). */
  lastEnded: LiveSet | null;
  lastEndByAthlete: Record<string, EndRecord>;
  metaByExercise: Record<string, ExerciseMeta>;
  exerciseByRoutineExercise: Record<string, string>;
  /** Full-rep ROMs of ended sets, key `${athleteId}:${exerciseId ?? 'free'}`. */
  romHistory: Record<string, number[]>;
  loadOverrideLb: number | null;
  sensorLoadLb: number | null;
  /** Tile tapped; waiting for the server's sync. */
  switchingTo: string | null;
  switchingSinceMs: number | null;
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
  | { type: 'rep'; rep: OvrRep }
  /** Done on the rack iPad (rack mode) — endedBy 'ipad'. */
  | { type: 'ipadDone' }
  /** Done on the device running the engine: 'ipad' in rack, 'phone' in solo. */
  | { type: 'done' }
  | { type: 'selectAthlete'; athleteId: string }
  | { type: 'tick' }
  | { type: 'loadChanged'; lb: number | null };

export type RackEffect =
  | {
      type: 'sessionPatch';
      patch: { state: 'lifting'; set_started_at: string };
    }
  | { type: 'writeRep'; rep: RepWrite }
  | { type: 'endSet'; summary: SetSummary }
  | { type: 'amendSet'; summary: SetSummary; rep: RepWrite }
  | { type: 'rpcEndSet'; athleteId: string }
  | { type: 'rpcSetActive'; athleteId: string }
  | { type: 'writeLoadToSensor'; lb: number }
  | {
      type: 'droppedRep';
      reason: 'noAthlete' | 'switching';
      rep: OvrRep;
    };

export interface ReduceResult {
  state: RackEngineState;
  effects: RackEffect[];
}

// ---------------------------------------------------------------- helpers

export type EngineInit =
  | { mode: 'rack'; rackId: string }
  | { mode: 'solo'; athleteId: string };

/** `createRackEngine('rack-id')` is shorthand for `{ mode: 'rack', rackId }`. */
export function createRackEngine(init: string | EngineInit): RackEngineState {
  const i: EngineInit = typeof init === 'string' ? { mode: 'rack', rackId: init } : init;
  return {
    mode: i.mode,
    rackId: i.mode === 'rack' ? i.rackId : null,
    soloContext: null,
    session: null,
    activeAthleteId: i.mode === 'solo' ? i.athleteId : null,
    queue: [],
    setState: 'idle',
    live: null,
    lastEnded: null,
    lastEndByAthlete: {},
    metaByExercise: {},
    exerciseByRoutineExercise: {},
    romHistory: {},
    loadOverrideLb: null,
    sensorLoadLb: null,
    switchingTo: null,
    switchingSinceMs: null,
    endRpcPendingFor: null,
  };
}

export function clientRepIdOf(
  rackId: string | null,
  athleteId: string,
  setStartedAtMs: number,
  repIndex: number,
): string {
  return `${rackId ?? 'solo'}:${athleteId}:${setStartedAtMs}:${repIndex}`;
}

const romKey = (athleteId: string, exerciseId: string | null) =>
  `${athleteId}:${exerciseId ?? 'free'}`;

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
function nextContext(s: RackEngineState): RackContext {
  if (s.mode === 'solo') return s.soloContext ?? EMPTY_CTX;
  return nextContextOf(s.session, s.exerciseByRoutineExercise);
}

/** Context for the NEXT set: pending (phone sent it mid-set) wins over live. */
function nextContextOf(
  row: RackSessionRow | null,
  exByRe: Record<string, string>,
): RackContext {
  if (!row) {
    return {
      workoutInstanceId: null,
      routineExerciseId: null,
      exerciseId: null,
      setNumber: null,
      loadLb: null,
    };
  }
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

export function summarize(
  rackId: string | null,
  set: LiveSet,
  source: SetSource = rackId == null ? 'phone' : 'rack',
): SetSummary {
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
    endedBy: set.endedBy ?? 'ipad',
    free: set.free,
  };
}

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

/** Build + append one rep to `set`; returns the new set and its write. */
function addRep(
  s: RackEngineState,
  set: LiveSet,
  rep: OvrRep,
  now: number,
): { set: LiveSet; write: RepWrite } {
  const med = median(s.romHistory[romKey(set.athleteId, set.context.exerciseId)] ?? []);
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

function startSet(s: RackEngineState, athleteId: string, now: number): LiveSet {
  const raw = nextContext(s);
  const prev = s.lastEndByAthlete[athleteId];
  let setNumber = raw.setNumber;
  let carried: EngineRep[] = [];
  if (prev && sameCtx(prev.rawContext, raw) && raw.workoutInstanceId != null) {
    if (prev.hold) {
      // Idle end, unchanged context: same set_number, reps carried forward.
      setNumber = prev.setNumber;
      carried = prev.set.reps.map((r) => ({ ...r, carried: true }));
    } else if (prev.setNumber != null) {
      setNumber = prev.setNumber + 1;
    }
  } else if (prev && prev.hold && raw.workoutInstanceId == null && sameCtx(prev.rawContext, raw)) {
    // Free set after an idle free set: carry for the summary only.
    carried = prev.set.reps.map((r) => ({ ...r, carried: true }));
  }
  const meta = raw.exerciseId ? s.metaByExercise[raw.exerciseId] : undefined;
  const zone: [number, number] | null =
    meta && meta.zoneMin != null && meta.zoneMax != null ? [meta.zoneMin, meta.zoneMax] : null;
  return {
    athleteId,
    startedAtMs: now,
    rawContext: raw,
    context: { ...raw, setNumber },
    zone,
    dropStopPct: meta?.dropStopPct ?? null,
    reps: carried,
    lastRepAtMs: now,
    endedAtMs: null,
    endedBy: null,
    free: raw.workoutInstanceId == null,
  };
}

const summarizeFor = (s: RackEngineState, set: LiveSet) =>
  summarize(s.rackId, set, s.mode === 'solo' ? 'phone' : 'rack');

/** End the live set (no-op when nothing is lifting). */
function endLive(
  s: RackEngineState,
  by: EndedBy,
  now: number,
  fx: RackEffect[],
  callEndRpc: boolean,
): RackEngineState {
  if (s.setState !== 'lifting' || !s.live) return s;
  const ended: LiveSet = { ...s.live, endedAtMs: now, endedBy: by };
  fx.push({ type: 'endSet', summary: summarizeFor(s, ended) });
  if (callEndRpc && s.mode === 'rack') fx.push({ type: 'rpcEndSet', athleteId: ended.athleteId });

  const key = romKey(ended.athleteId, ended.context.exerciseId);
  const fullRoms = ended.reps.filter((r) => !r.partial && !r.carried).map((r) => r.rom);
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
    romHistory: { ...s.romHistory, [key]: [...(s.romHistory[key] ?? []), ...fullRoms] },
    endRpcPendingFor: callEndRpc && s.mode === 'rack' ? ended.athleteId : s.endRpcPendingFor,
  };
  return syncSensorLoad(next, fx);
}

// ---------------------------------------------------------------- reducer

export function reduce(state: RackEngineState, event: RackEvent, now: number): ReduceResult {
  const fx: RackEffect[] = [];
  let s = state;

  switch (event.type) {
    case 'sessionSync': {
      if (s.mode === 'solo') break;
      const row = event.row;
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
        switchingTo: null,
        switchingSinceMs: null,
        endRpcPendingFor,
        lastEndByAthlete,
      };

      if (s.setState === 'lifting' && s.live) {
        if (s.live.athleteId !== nextActive) {
          // Server moved the rack on mid-set; save what we have.
          s = endLive(s, 'switch', now, fx, false);
        } else if (row.pending_end) {
          s = endLive(s, 'phone', now, fx, true);
        } else if (row.leave_requested) {
          s = endLive(s, 'leave', now, fx, true);
        }
      } else if (
        nextActive &&
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
      s = syncSensorLoad(s, fx);
      break;
    }

    case 'contextMeta': {
      const meta: ExerciseMeta = {
        zoneMin: event.zoneMin,
        zoneMax: event.zoneMax,
        dropStopPct: event.dropStopPct,
      };
      s = {
        ...s,
        metaByExercise: { ...s.metaByExercise, [event.exerciseId]: meta },
        exerciseByRoutineExercise: event.routineExerciseId
          ? { ...s.exerciseByRoutineExercise, [event.routineExerciseId]: event.exerciseId }
          : s.exerciseByRoutineExercise,
      };
      // Metadata (not a context change): fill in a live set that started
      // before its exercise's metadata loaded.
      if (s.live && s.live.context.exerciseId === event.exerciseId) {
        const zone: [number, number] | null =
          meta.zoneMin != null && meta.zoneMax != null ? [meta.zoneMin, meta.zoneMax] : null;
        s = { ...s, live: { ...s.live, zone, dropStopPct: meta.dropStopPct } };
      }
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
        const key = romKey(amended.athleteId, amended.context.exerciseId);
        const last = amended.reps[amended.reps.length - 1];
        s = {
          ...s,
          lastEnded: amended,
          lastEndByAthlete:
            rec && rec.set.startedAtMs === amended.startedAtMs
              ? { ...s.lastEndByAthlete, [amended.athleteId]: { ...rec, set: amended } }
              : s.lastEndByAthlete,
          romHistory: last.partial
            ? s.romHistory
            : { ...s.romHistory, [key]: [...(s.romHistory[key] ?? []), last.rom] },
        };
        break;
      }

      if (!s.activeAthleteId) {
        fx.push({ type: 'droppedRep', reason: 'noAthlete', rep: event.rep });
        break;
      }
      if (s.switchingTo) {
        fx.push({ type: 'droppedRep', reason: 'switching', rep: event.rep });
        break;
      }

      let live = s.live;
      if (s.setState !== 'lifting' || !live) {
        live = startSet(s, s.activeAthleteId, now);
        if (s.mode === 'rack') {
          fx.push({
            type: 'sessionPatch',
            patch: { state: 'lifting', set_started_at: new Date(now).toISOString() },
          });
        }
        s = { ...s, setState: 'lifting' };
      }
      const { set, write } = addRep(s, live, event.rep, now);
      fx.push({ type: 'writeRep', rep: write });
      s = { ...s, live: set };
      s = syncSensorLoad(s, fx);
      break;
    }

    case 'soloContext': {
      if (s.mode !== 'solo') break;
      const ctx: RackContext = {
        workoutInstanceId: event.workoutInstanceId,
        routineExerciseId: event.routineExerciseId,
        exerciseId: event.exerciseId,
        setNumber: event.setNumber,
        loadLb: event.loadLb,
      };
      s = { ...s, soloContext: ctx };
      if (event.exerciseId) {
        // Reuse the metadata path (also fills a live set missing its zone).
        s = reduce(
          s,
          {
            type: 'contextMeta',
            exerciseId: event.exerciseId,
            routineExerciseId: event.routineExerciseId,
            zoneMin: event.zoneMin,
            zoneMax: event.zoneMax,
            dropStopPct: event.dropStopPct,
          },
          now,
        ).state;
      }
      // Mid-set: the live set is frozen; this context applies to the next set.
      s = syncSensorLoad(s, fx);
      break;
    }

    case 'ipadDone':
    case 'done':
      s = endLive(s, s.mode === 'solo' ? 'phone' : 'ipad', now, fx, true);
      break;

    case 'selectAthlete': {
      if (s.mode === 'solo') break;
      if (event.athleteId === s.activeAthleteId || event.athleteId === s.switchingTo) break;
      s = endLive(s, 'switch', now, fx, false);
      fx.push({ type: 'rpcSetActive', athleteId: event.athleteId });
      s = { ...s, switchingTo: event.athleteId, switchingSinceMs: now };
      break;
    }

    case 'tick': {
      if (s.switchingTo && s.switchingSinceMs != null && now - s.switchingSinceMs >= SWITCH_TIMEOUT_MS) {
        s = { ...s, switchingTo: null, switchingSinceMs: null };
      }
      if (s.setState === 'lifting' && s.live && now - s.live.lastRepAtMs >= IDLE_END_MS) {
        s = endLive(s, 'idle', now, fx, true);
      }
      break;
    }

    case 'loadChanged':
      s = syncSensorLoad({ ...s, loadOverrideLb: event.lb }, fx);
      break;
  }

  return { state: s, effects: fx };
}
