// Phone side of rack VBT — pure view logic (no React, no network):
// rep chips + full-rep count for the live row, the banner state from
// rack_list_for_me + the rack_sessions rows the athlete can read, the
// debounced phone-context sender, and what Done does while live.
//
// The live row is source-agnostic ('rack' | 'sensor') so Task 10b's
// phone-direct sensor reuses it ("SENSOR · LIVE").

import type { RackListItem } from './api';
import type { RackSessionRow } from './engine';
import type { RepChip } from './phone';
import { rackSetLine, resolveRackSet, type RackSetInstance, type RackSetLog } from './resolveRackSet';
import { avgWattsSuffix, setWatts } from './power';

// ---- colours (logger v2 restraint: zone blue, slow red, fast faint white only)
export const RACK_COLORS = {
  zone: '#9BDDFF',
  zoneBg: 'rgba(155,221,255,0.12)',
  slow: '#E5534B',
  slowBg: 'rgba(229,83,75,0.14)',
  fast: 'rgba(255,255,255,0.85)',
  fastBg: 'rgba(255,255,255,0.08)',
  partText: 'rgba(255,255,255,0.3)',
  partBorder: 'rgba(255,255,255,0.15)',
  tagBorder: 'rgba(155,221,255,0.4)',
  bannerBorder: 'rgba(155,221,255,0.3)',
  bannerBg: 'rgba(155,221,255,0.05)',
  muted: 'rgba(255,255,255,0.5)',
  hint: 'rgba(255,255,255,0.4)',
} as const;

export type LiveSource = 'rack' | 'sensor';

export interface SpeedZone {
  min: number | null;
  max: number | null;
}

/** A zone only counts when at least one bound is set. */
export function zoneOf(min: unknown, max: unknown): SpeedZone | null {
  const n = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const z = { min: n(min), max: n(max) };
  return z.min == null && z.max == null ? null : z;
}

export type ChipTone = 'in' | 'slow' | 'fast' | 'plain' | 'part';

export function chipTone(chip: Pick<RepChip, 'v' | 'partial'>, zone: SpeedZone | null): ChipTone {
  if (chip.partial) return 'part';
  if (!zone) return 'plain';
  if (zone.min != null && chip.v < zone.min) return 'slow';
  if (zone.max != null && chip.v > zone.max) return 'fast';
  return 'in';
}

export interface ChipView {
  key: string;
  /** vbt_reps.client_rep_id (long-press → remove this rep). */
  clientRepId: string;
  /** 1-based position in the set ("Rep 3"). */
  repNo: number;
  v: number;
  partial: boolean;
  label: string;
  tone: ChipTone;
  color: string;
  backgroundColor: string;
  /** Dashed border (partial reps only). */
  dashedBorder: string | null;
}

export function chipView(chip: RepChip, zone: SpeedZone | null, repNo = 1): ChipView {
  const tone = chipTone(chip, zone);
  const base = {
    key: chip.clientRepId,
    clientRepId: chip.clientRepId,
    repNo,
    v: chip.v,
    partial: chip.partial,
    tone,
    label: chip.v.toFixed(2),
    dashedBorder: null as string | null,
  };
  switch (tone) {
    case 'part':
      return { ...base, label: 'part', color: RACK_COLORS.partText, backgroundColor: 'transparent', dashedBorder: RACK_COLORS.partBorder };
    case 'in':
      return { ...base, color: RACK_COLORS.zone, backgroundColor: RACK_COLORS.zoneBg };
    case 'slow':
      return { ...base, color: RACK_COLORS.slow, backgroundColor: RACK_COLORS.slowBg };
    case 'fast':
    case 'plain':
    default:
      return { ...base, color: RACK_COLORS.fast, backgroundColor: RACK_COLORS.fastBg };
  }
}

export function chipViews(chips: RepChip[], zone: SpeedZone | null): ChipView[] {
  return chips.map((c, i) => chipView(c, zone, i + 1));
}

/** The live row's power: "avg 612 W" from the full reps, only when the load is known. */
export function livePowerText(chips: Pick<RepChip, 'v' | 'partial'>[], loadLb: number | null | undefined): string | null {
  const w = setWatts(loadLb, chips).avgW;
  return w == null ? null : `avg ${w} W`;
}

/** Remove-rep sheet title on the phone: "Rep 3 · 0.30 m/s". */
export function chipRemoveTitle(c: Pick<ChipView, 'repNo' | 'v' | 'partial'>): string {
  return `Rep ${c.repNo} · ${c.partial ? 'partial' : `${c.v.toFixed(2)} m/s`}`;
}

/** REPS cell = full reps only (partials are stored, never counted). */
export function fullRepCount(chips: Pick<RepChip, 'partial'>[]): number {
  return chips.filter(c => !c.partial).length;
}

export const DEFAULT_DROP_STOP_PCT = 20;

/**
 * "Speed dropped N% — rack it": only with a zone. Drop = (best full-rep mean
 * velocity in the set − the latest full rep) / best. Returns the threshold
 * crossed, or null.
 */
export function speedDropCue(
  chips: RepChip[],
  zone: SpeedZone | null,
  dropStopPct: number | null | undefined,
): number | null {
  if (!zone) return null;
  const full = chips.filter(c => !c.partial && Number.isFinite(c.v));
  if (full.length < 2) return null;
  const best = Math.max(...full.map(c => c.v));
  if (!(best > 0)) return null;
  const last = full[full.length - 1].v;
  const threshold = dropStopPct != null && dropStopPct > 0 ? dropStopPct : DEFAULT_DROP_STOP_PCT;
  return ((best - last) / best) * 100 >= threshold ? threshold : null;
}

export function liveTag(source: LiveSource, rackName: string | null): string {
  if (source === 'sensor') return 'SENSOR · LIVE';
  return `${(rackName ?? 'RACK').toUpperCase()} · LIVE`;
}

export function liveDoneLabel(reps: number): string {
  return `✓ Done · ${reps} ${reps === 1 ? 'rep' : 'reps'}`;
}


// ---- banner

export type BannerMode = 'active' | 'queued' | 'browse';

export interface BannerRack {
  rackId: string;
  name: string;
  /** "open" / "Tyler lifting" */
  status: string;
}

export interface BannerState {
  mode: BannerMode;
  /** Set for active / queued. */
  rackId: string | null;
  title: string;
  subtitle: string;
  /** Browse: every rack with its state (tap = join). */
  racks: BannerRack[];
  /** Active: the rack's current set, "Rack 1 · Romanian Deadlift · Set 1 of 3" (same resolver + wording as the iPad card). */
  rackSet?: string | null;
}

/** The active banner with the rack's current set line (both phone screens). */
export function withRackSet(banner: BannerState | null, line: string | null): BannerState | null {
  if (!banner || banner.mode !== 'active') return banner;
  return { ...banner, rackSet: line };
}

function rackStatus(item: RackListItem): string {
  return item.activeAthleteFirstName ? `${item.activeAthleteFirstName} lifting` : 'open';
}

/**
 * The banner from rack_list_for_me + the rack_sessions rows this athlete is
 * active / queued on. null = the org has no active rack → no banner.
 */
export function bannerState(
  list: RackListItem[],
  sessions: Pick<RackSessionRow, 'rack_id' | 'active_athlete_id' | 'queue'>[],
  athleteId: string,
): BannerState | null {
  if (list.length === 0) return null;
  const itemOf = (id: string) => list.find(r => r.rackId === id);

  const active = sessions.find(s => s.active_athlete_id === athleteId && itemOf(s.rack_id));
  if (active) {
    const item = itemOf(active.rack_id)!;
    const waiting = (active.queue ?? []).filter(q => q !== athleteId).length;
    return {
      mode: 'active',
      rackId: active.rack_id,
      title: `${item.name} · you’re up`,
      subtitle: item.nextAthleteFirstName
        ? `${item.nextAthleteFirstName} is next`
        : waiting === 0
          ? 'Nobody waiting'
          : `${waiting} waiting`,
      racks: [],
    };
  }

  const queuedSession = sessions.find(s => (s.queue ?? []).includes(athleteId) && itemOf(s.rack_id));
  const queuedItem = queuedSession ? itemOf(queuedSession.rack_id) : list.find(r => r.queuePositionOfCaller != null);
  if (queuedItem) {
    const pos = queuedSession ? (queuedSession.queue ?? []).indexOf(athleteId) + 1 : queuedItem.queuePositionOfCaller ?? 1;
    return {
      mode: 'queued',
      rackId: queuedItem.rackId,
      title: `${queuedItem.name} · ${queuedItem.activeAthleteFirstName ? `${queuedItem.activeAthleteFirstName} is lifting` : 'open'}`,
      subtitle: `You’re #${pos} in line`,
      racks: [],
    };
  }

  return {
    mode: 'browse',
    rackId: null,
    title: 'Racks',
    subtitle: '',
    racks: list.map(r => ({ rackId: r.rackId, name: r.name, status: rackStatus(r) })),
  };
}

/** Inline banner error. 55000 = "already on Rack X" (shown as-is). */
export function rackErrorText(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === '55000') {
    const raw = String(err.message ?? '').replace(/^[a-z_]+:\s*/i, '').trim() || 'already on another rack';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return 'Couldn’t reach the rack — try again';
}

// ---- the rack's context (rack_sessions = the shared record)

type SessionLike = Pick<
  RackSessionRow,
  | 'active_athlete_id'
  | 'workout_instance_id'
  | 'routine_exercise_id'
  | 'state'
  | 'set_number'
  | 'load_lb'
  | 'pending_workout_instance_id'
  | 'pending_routine_exercise_id'
  | 'pending_set_number'
  | 'pending_load_lb'
>;

export interface RackCtx {
  workoutInstanceId: string | null;
  routineExerciseId: string | null;
  setNumber: number | null;
  loadLb: number | null;
}

const numOrNull = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * What the rack is set up for NEXT: mid-set the pending context (it applies to
 * the next set), else the live context. Exercise, set and load always come
 * from the same group, so a mid-set override lands on the right row.
 */
export function rackContextOf(s: SessionLike | null): RackCtx {
  if (!s) return { workoutInstanceId: null, routineExerciseId: null, setNumber: null, loadLb: null };
  if (s.state === 'lifting' && s.pending_routine_exercise_id) {
    return {
      workoutInstanceId: s.pending_workout_instance_id ?? s.workout_instance_id,
      routineExerciseId: s.pending_routine_exercise_id,
      setNumber: s.pending_set_number ?? null,
      loadLb: numOrNull(s.pending_load_lb),
    };
  }
  return {
    workoutInstanceId: s.workout_instance_id,
    routineExerciseId: s.routine_exercise_id,
    setNumber: s.set_number ?? null,
    loadLb: numOrNull(s.load_lb),
  };
}

/** The set being lifted right now (state 'lifting'), keyed off rack_sessions — never the phone's open row. */
export function liveRackSet(
  s: SessionLike | null,
  athleteId: string,
  workoutInstanceId: string,
): { routineExerciseId: string; setNumber: number } | null {
  if (!s || s.active_athlete_id !== athleteId || s.state !== 'lifting') return null;
  if (!s.routine_exercise_id || s.set_number == null) return null;
  if (s.workout_instance_id && s.workout_instance_id !== workoutInstanceId) return null;
  return { routineExerciseId: s.routine_exercise_id, setNumber: s.set_number };
}

// ---- phone context (debounced, active only, exact echo guard)

export interface PhoneContext {
  workoutInstanceId: string | null;
  routineExerciseId: string | null;
  setNumber: number | null;
  loadLb: number | null;
}

export function contextSig(c: RackCtx | PhoneContext): string {
  return `${c.routineExerciseId ?? ''}|${c.setNumber ?? ''}|${c.loadLb ?? ''}`;
}

export interface ContextSender {
  /** Latest context. rackId null = not active (resets); ctx null = paused (sends nothing). */
  update: (rackId: string | null, ctx: PhoneContext | null, opts?: { immediate?: boolean }) => void;
  cancel: () => void;
  /** The row's context is exactly one the phone sent (last sent, or still in flight). */
  isEcho: (ctx: RackCtx) => boolean;
  /** Whether a context was sent since the last deactivation. */
  sentThisActivation: () => boolean;
}

export const CONTEXT_DEBOUNCE_MS = 300;

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
};

export function createContextSender(
  send: (rackId: string, ctx: PhoneContext) => PromiseLike<unknown> | unknown,
  delayMs: number = CONTEXT_DEBOUNCE_MS,
  timers: Timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): ContextSender {
  let handle: unknown = null;
  let lastSent: string | null = null;
  const inFlight = new Map<string, number>();
  const cancel = () => {
    if (handle != null) timers.clearTimeout(handle);
    handle = null;
  };
  const fire = (rackId: string, ctx: PhoneContext, sig: string) => {
    handle = null;
    lastSent = sig;
    inFlight.set(sig, (inFlight.get(sig) ?? 0) + 1);
    const done = () => {
      const n = (inFlight.get(sig) ?? 1) - 1;
      if (n <= 0) inFlight.delete(sig);
      else inFlight.set(sig, n);
    };
    try {
      const r = send(rackId, ctx) as PromiseLike<unknown> | undefined;
      if (r && typeof (r as any).then === 'function') (r as PromiseLike<unknown>).then(done, done);
      else done();
    } catch {
      done();
    }
  };
  return {
    update(rackId, ctx, opts) {
      cancel();
      if (!rackId) {
        lastSent = null; // not active: the next activation sends again
        inFlight.clear();
        return;
      }
      if (!ctx) return; // active but nothing open (overview): send nothing, keep the echo memory
      const sig = contextSig(ctx);
      if (sig === lastSent && inFlight.size === 0) return;
      if (opts?.immediate) fire(rackId, ctx, sig);
      else handle = timers.setTimeout(() => fire(rackId, ctx, sig), delayMs);
    },
    cancel,
    isEcho(ctx) {
      const sig = contextSig(ctx);
      return sig === lastSent || inFlight.has(sig);
    },
    sentThisActivation: () => lastSent != null,
  };
}

/** Weight input → load for the rack (null when empty / not a number). */
export function loadFromInput(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The load the phone sends: only the athlete's own LB (typed / stepped, or a
 * logged value) — never the prescription. Otherwise it passes the rack's
 * current load for that same set back unchanged, so a context send never
 * clobbers a load the iPad published.
 */
export function contextLoad(i: {
  ownWeight: unknown | null;
  rack: RackCtx;
  routineExerciseId: string;
  setNumber: number | null;
}): number | null {
  const own = loadFromInput(i.ownWeight);
  if (own != null) return own;
  if (i.rack.routineExerciseId === i.routineExerciseId && i.rack.setNumber === i.setNumber) return i.rack.loadLb;
  return null;
}

// ---- Done while live / rack-owned sets

export interface DoneDeps {
  requestEndSet: (rackId: string) => Promise<unknown>;
  /** The phone's normal set save (Log Set). */
  saveSet: () => void;
  /** Start waiting for the rack's exercise_logs write. */
  awaitRackWrite: () => void;
}

/**
 * Done on the phone. While a rack set is being lifted: ask the rack to end it
 * (the iPad writes the row, incl. metric_data.vbt + reps) and wait for that
 * row — the phone writes nothing for the set. Otherwise the normal save.
 */
export function pressDone(live: { rackId: string; lifting: boolean } | null, deps: DoneDeps): 'rack' | 'save' {
  if (live && live.lifting) {
    deps.awaitRackWrite();
    void deps.requestEndSet(live.rackId).catch(() => undefined);
    return 'rack';
  }
  deps.saveSet();
  return 'save';
}

/**
 * A phone write for a set the rack owns (being lifted, or ended and not yet
 * landed): never is_complete, never reps — the rack's row carries them.
 * Other fields (LB, notes, RPE) still go through.
 */
export function rackSafeWrite<W extends { complete?: boolean; fields?: string[]; rpe?: boolean }>(write: W, owned: boolean): W {
  if (!owned) return write;
  const { complete: _c, ...rest } = write;
  return { ...(rest as W), fields: (write.fields ?? []).filter(f => f !== 'reps') };
}

/** The rack ended the set on its own (60 s with no rep). */
export function endedByIdle(log: { metric_data?: any } | null | undefined): boolean {
  return log?.metric_data?.vbt?.ended_by === 'idle';
}

/** UI copy switches to "pull to refresh" after this; polling continues. */
export const RACK_WRITE_TIMEOUT_MS = 10_000;
/** While on a rack (active or queued): rack_sessions + pending set rows. */
export const RACK_POLL_MS = 10_000;

// ---- set ended on the rack (phone Done, iPad Done, idle, switch)

export interface EndedSet {
  rackId: string;
  workoutInstanceId: string | null;
  routineExerciseId: string | null;
  setNumber: number | null;
}

/**
 * Sets this athlete was lifting in `prev` that are no longer being lifted in
 * `next` (state left 'lifting', another set started, or the row is gone).
 * The phone then waits for the rack's exercise_logs write for that set.
 */
export function endedSets(prev: RackSessionRow[], next: RackSessionRow[], athleteId: string): EndedSet[] {
  const out: EndedSet[] = [];
  for (const p of prev) {
    if (p.active_athlete_id !== athleteId || p.state !== 'lifting') continue;
    const n = next.find(r => r.rack_id === p.rack_id);
    const stillLifting =
      n &&
      n.state === 'lifting' &&
      n.active_athlete_id === p.active_athlete_id &&
      n.workout_instance_id === p.workout_instance_id &&
      n.routine_exercise_id === p.routine_exercise_id &&
      n.set_number === p.set_number &&
      n.set_started_at === p.set_started_at;
    if (!stillLifting) {
      out.push({
        rackId: p.rack_id,
        workoutInstanceId: p.workout_instance_id ?? null,
        routineExerciseId: p.routine_exercise_id ?? null,
        setNumber: p.set_number ?? null,
      });
    }
  }
  return out;
}

/** Newer-or-equal row wins (updated_at); a late realtime event never rolls state back. */
export function newerRow(prev: RackSessionRow | undefined, next: RackSessionRow): boolean {
  if (!prev) return true;
  return String(next.updated_at ?? '') >= String(prev.updated_at ?? '');
}

// ---- iPad → phone (follow + load)

/** A phone LB edit this recent wins over the rack's load. */
export const LOAD_EDIT_GUARD_MS = 3000;

export interface FollowInput {
  session: SessionLike | null;
  /** The rack exercise on the previous read of THIS activation (undefined = first read = baseline). */
  prevRackExercise: string | null | undefined;
  /** The phone already sent a context in this activation. */
  sentThisActivation: boolean;
  athleteId: string;
  workoutInstanceId: string;
  /** Exercise open on the phone (null on the overview). */
  openExerciseId: string | null;
  /** Exact echo test against what the phone sent. */
  isEcho: (ctx: RackCtx) => boolean;
  /** The phone finished this exercise (it sent set N+1): a change away from it is like null→X. */
  isFinishedOnPhone?: (routineExerciseId: string) => boolean;
  /**
   * The iPad's own auto-pick for this phone's state: resolveRackSet with no
   * phone context and no override (routine exercise id; null = none). A
   * null→X change to exactly this is the iPad following the phone, not a
   * coach override.
   */
  autoPickExerciseId?: string | null;
}

/**
 * iPad → phone: the routine exercise the phone should switch to, or null.
 * Only on a CHANGE of the rack's exercise within one activation (the first
 * read is the baseline — the phone's open exercise wins then), only while this
 * athlete is active, only for this workout, never an exact echo of the
 * phone's own context. Once the phone has sent its context, a null→X change
 * is ignored only when X is the iPad's auto-pick for the phone's own state
 * (the shared resolver) — a real coach override after an empty context
 * (finished exercise) is still followed (N4).
 */
export function followTarget(i: FollowInput): string | null {
  const s = i.session;
  if (!s || s.active_athlete_id !== i.athleteId) return null;
  const ctx = rackContextOf(s);
  if (!ctx.routineExerciseId) return null;
  if (ctx.workoutInstanceId && ctx.workoutInstanceId !== i.workoutInstanceId) return null;
  if (i.prevRackExercise === undefined) return null;
  if (ctx.routineExerciseId === i.prevRackExercise) return null;
  const prevNone = i.prevRackExercise === null || (!!i.prevRackExercise && !!i.isFinishedOnPhone?.(i.prevRackExercise));
  if (prevNone && i.sentThisActivation && ctx.routineExerciseId === (i.autoPickExerciseId ?? null)) return null;
  if (ctx.routineExerciseId === i.openExerciseId) return null;
  if (i.isEcho(ctx)) return null;
  return ctx.routineExerciseId;
}

/**
 * iPad → phone load: the LB to put in the phone's cell, or null. Only on a
 * change of the rack's load, only when it differs from the phone's, never
 * while the athlete is typing and never within 3 s of an LB edit (the phone's
 * edit wins and is sent back through the context).
 */
export function loadSyncValue(i: {
  rackLoad: number | null;
  prevRackLoad: number | null | undefined;
  phoneLoad: number | null;
  lastEditAt: number;
  now: number;
  editing?: boolean;
}): number | null {
  if (i.editing) return null;
  if (i.rackLoad == null) return null;
  if (i.prevRackLoad === undefined || i.prevRackLoad === i.rackLoad) return null;
  if (i.phoneLoad === i.rackLoad) return null;
  if (i.now - i.lastEditAt < LOAD_EDIT_GUARD_MS) return null;
  return i.rackLoad;
}

/** First set not complete (0-based), or null when every set is done. */
export function firstIncompleteSet(completed: boolean[] | undefined, sets: number): number | null {
  for (let k = 0; k < sets; k++) if (completed?.[k] !== true) return k;
  return null;
}

/**
 * "RACK · avg 0.78 · best 0.84 m/s · avg 612 W" under a rack-saved row (null
 * when not rack-saved). The watts are ours (load × g × avg v), only with a load.
 */
export function rackSummaryLine(vbt: any, loadLb?: unknown): string | null {
  if (!vbt || typeof vbt !== 'object') return null;
  const avg = numOrNull(vbt.avg_v);
  const best = numOrNull(vbt.best_v);
  if (avg == null && best == null) return null;
  const parts = [avg != null ? `avg ${avg.toFixed(2)}` : null, best != null ? `best ${best.toFixed(2)}` : null].filter(Boolean);
  return `${parts.join(' · ')} m/s${avgWattsSuffix(numOrNull(loadLb), avg)}`;
}

/**
 * A rack-written exercise_logs row → the phone's set state: values fill in
 * (reps, LB, …), the row checks off, and the next incomplete set opens.
 * Pure; returns null when the row doesn't fit this exercise.
 */
export function applyRackLog(i: {
  inputs: Record<string, any>[] | undefined;
  completed: boolean[] | undefined;
  sets: number;
  log: Record<string, any>;
  toInputs: (log: Record<string, any>) => Record<string, any>;
}): { inputs: Record<string, any>[]; completed: boolean[]; setIndex: number; nextIndex: number | null; wasDone: boolean; idle: boolean } | null {
  const setIndex = Number(i.log.set_number) - 1;
  if (!Number.isInteger(setIndex) || setIndex < 0 || setIndex >= i.sets) return null;
  const inputs = [...(i.inputs ?? [])];
  while (inputs.length <= setIndex) inputs.push({});
  inputs[setIndex] = { ...inputs[setIndex], ...i.toInputs(i.log) };
  const completed = [...(i.completed ?? Array(i.sets).fill(false))];
  while (completed.length < i.sets) completed.push(false);
  const wasDone = completed[setIndex] === true;
  const complete = i.log.is_complete === true;
  if (complete) completed[setIndex] = true;
  return {
    inputs,
    completed,
    setIndex,
    nextIndex: complete ? firstIncompleteSet(completed, i.sets) : setIndex,
    wasDone,
    idle: endedByIdle(i.log),
  };
}

// ---- the rack's current set on the phone (same resolver as the iPad)

export interface PhoneRackNow {
  routineExerciseId: string;
  setNumber: number;
  /** live = being lifted (the row); phone = the open exercise; rack = the resolver's pick; ipad = a coach pick. */
  source: 'live' | 'phone' | 'rack' | 'ipad';
}

/**
 * What the rack is on for this athlete, computed on the phone exactly as the
 * iPad does: while lifting, the row's live set; otherwise resolveRackSet over
 * the phone's logs with its open exercise as the phone context (rule 1) and a
 * coach pick in the row (anything the phone didn't send and the resolver
 * wouldn't auto-pick) as the override. A set the row has ahead of the phone
 * (the rack's write not landed yet) wins over the phone's older logs.
 */
export function phoneRackNow(i: {
  instance: RackSetInstance | null;
  logs: RackSetLog[];
  session: SessionLike | null;
  athleteId: string;
  workoutInstanceId: string;
  /** Exercise open on the phone (null on the overview). */
  openExerciseId: string | null;
  /** The set the phone sends for it (its selected row; > prescribed = finished). */
  openSetNumber?: number | null;
  isEcho: (ctx: RackCtx) => boolean;
  /** A coach's explicit exercise + set (coachSetChoice) — honoured exactly. */
  chosen?: { routineExerciseId: string; setNumber: number } | null;
}): PhoneRackNow | null {
  const s = i.session;
  if (!s || s.active_athlete_id !== i.athleteId) return null;
  const live = liveRackSet(s, i.athleteId, i.workoutInstanceId);
  if (live) return { ...live, source: 'live' };
  // A coach's explicit set (iPad picker, carried by the row): the strip shows
  // exactly the set the rack will capture — the phone-open exercise must not
  // re-resolve it to its own first open set.
  if (i.chosen) return { routineExerciseId: i.chosen.routineExerciseId, setNumber: i.chosen.setNumber, source: 'ipad' };
  if (!i.instance) return null;
  const base = { instances: [i.instance], logs: i.logs };
  const auto = resolveRackSet(base);
  const row = rackContextOf(s);
  const rowHere = !!row.routineExerciseId && (!row.workoutInstanceId || row.workoutInstanceId === i.workoutInstanceId);
  const rowFromIpad = rowHere && !i.isEcho(row);
  const coach = rowFromIpad && (auto.none || auto.routineExerciseId !== row.routineExerciseId);
  // Nothing open (overview): the phone's own last-sent context, still in the
  // row — exactly the iPad's phone input (its phoneRef), set hint included.
  const lastSent = !i.openExerciseId && rowHere && !rowFromIpad ? row : null;
  const res = resolveRackSet({
    ...base,
    phone: i.openExerciseId
      ? { workoutInstanceId: i.workoutInstanceId, routineExerciseId: i.openExerciseId, setNumber: i.openSetNumber ?? null }
      : lastSent
        ? { workoutInstanceId: i.workoutInstanceId, routineExerciseId: lastSent.routineExerciseId, setNumber: lastSent.setNumber }
        : null,
    override: coach
        ? { workoutInstanceId: i.workoutInstanceId, routineExerciseId: row.routineExerciseId }
        : null,
  });
  if (res.none) return null;
  const ahead = rowFromIpad && row.routineExerciseId === res.routineExerciseId && row.setNumber != null && row.setNumber > res.setNumber;
  return {
    routineExerciseId: res.routineExerciseId,
    setNumber: ahead ? row.setNumber! : res.setNumber,
    source: res.reason === 'phone' ? 'phone' : res.reason === 'override' ? 'ipad' : 'rack',
  };
}

/** "Rack 1 · Romanian Deadlift · Set 1 of 3" — the phone's rack strip (the iPad card's exerciseLine). */
export function rackStripLine(rackName: string | null, name: string, setNumber: number, sets: number | null): string {
  return `${rackName ?? 'Rack'} · ${rackSetLine(name, setNumber, sets)}`;
}

/** "Rack 1 → Romanian Deadlift · set 1" — the toast when the phone follows the rack. */
export function rackFollowToast(rackName: string | null, name: string, setNumber: number): string {
  return `${rackName ?? 'The rack'} → ${name} · set ${setNumber}`;
}

export interface OpenState {
  openId: string | null;
  finished: boolean;
  active: boolean;
}

/** One open of an exercise screen, as far as follow-on-finish is concerned. */
export interface OpenTrack {
  openId: string | null;
  /** It was already finished when opened (a deliberate edit). */
  openedFinished: boolean;
  /** It became finished at some point during this open. */
  finishedOnce: boolean;
  /** Finished during this open; the follow is still owed (e.g. finished while queued). */
  pending: boolean;
}

/**
 * The phone FOLLOWS the rack only when the open exercise was UNFINISHED when
 * opened and became finished during this open — once. Never when the kid
 * opened a finished exercise to edit it, nor on an un-check/re-check. A finish
 * while not active (queued) is followed once the athlete becomes active, if
 * still finished. Not while the superset/circuit block still has sets (the
 * partner is next), and never to the open exercise itself.
 */
export function followOnFinish(i: OpenState & { prev: OpenTrack | null; rackNow: PhoneRackNow | null; blockHasMore: boolean }): {
  track: OpenTrack;
  follow: string | null;
} {
  const p = i.prev;
  if (!p || p.openId !== i.openId) {
    return { track: { openId: i.openId, openedFinished: i.finished, finishedOnce: i.finished, pending: false }, follow: null };
  }
  const t: OpenTrack = { ...p };
  if (i.finished && !t.finishedOnce && !t.openedFinished) {
    t.finishedOnce = true;
    t.pending = true;
  }
  if (!i.finished || i.blockHasMore) t.pending = false;
  if (!t.pending || !i.active) return { track: t, follow: null };
  t.pending = false; // owed once: follow now (or nothing to follow to)
  const to = i.rackNow && i.openId && i.rackNow.routineExerciseId !== i.openId ? i.rackNow.routineExerciseId : null;
  return { track: t, follow: to };
}

/**
 * A coach's explicit exercise + set from the iPad picker, seen in the row: a
 * NEW row context (exercise or set changed since the last read of this
 * activation) that the phone didn't send and that isn't the rack's own
 * auto-pick for the phone's state. The phone then follows that exact set —
 * even a done one (a re-do).
 */
export function coachSetChoice(i: {
  ctx: RackCtx;
  /** The row's (exercise, set) on the previous read; undefined = first read (baseline). */
  prev: { exercise: string | null; set: number | null } | undefined;
  workoutInstanceId: string;
  isEcho: (ctx: RackCtx) => boolean;
  autoPick: { routineExerciseId: string; setNumber: number } | null;
}): { routineExerciseId: string; setNumber: number } | null {
  const c = i.ctx;
  if (!i.prev || !c.routineExerciseId || c.setNumber == null) return null;
  if (c.workoutInstanceId && c.workoutInstanceId !== i.workoutInstanceId) return null;
  if (i.prev.exercise === c.routineExerciseId && i.prev.set === c.setNumber) return null;
  if (i.isEcho(c)) return null;
  if (i.autoPick && i.autoPick.routineExerciseId === c.routineExerciseId && i.autoPick.setNumber === c.setNumber) return null;
  return { routineExerciseId: c.routineExerciseId, setNumber: c.setNumber };
}
