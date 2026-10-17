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
  label: string;
  tone: ChipTone;
  color: string;
  backgroundColor: string;
  /** Dashed border (partial reps only). */
  dashedBorder: string | null;
}

export function chipView(chip: RepChip, zone: SpeedZone | null): ChipView {
  const tone = chipTone(chip, zone);
  const base = { key: chip.clientRepId, tone, label: chip.v.toFixed(2), dashedBorder: null as string | null };
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
  return chips.map(c => chipView(c, zone));
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
}

function rackStatus(item: RackListItem): string {
  return item.activeAthleteFirstName ? `${item.activeAthleteFirstName} lifting` : 'open';
}

/**
 * The banner from rack_list_for_me + the rack_sessions rows RLS lets the
 * athlete read (active or queued). null = the org has no active rack → no banner.
 */
export function bannerState(
  list: RackListItem[],
  sessions: Pick<RackSessionRow, 'rack_id' | 'active_athlete_id' | 'queue'>[],
  athleteId: string,
): BannerState | null {
  if (list.length === 0) return null;
  const nameOf = (id: string) => list.find(r => r.rackId === id)?.name ?? 'Rack';

  const active = sessions.find(s => s.active_athlete_id === athleteId && list.some(r => r.rackId === s.rack_id));
  if (active) {
    const waiting = (active.queue ?? []).filter(q => q !== athleteId).length;
    return {
      mode: 'active',
      rackId: active.rack_id,
      title: `${nameOf(active.rack_id)} · you’re up`,
      subtitle: waiting === 0 ? 'Nobody waiting' : `${waiting} waiting`,
      racks: [],
    };
  }

  const queuedSession = sessions.find(s => (s.queue ?? []).includes(athleteId) && list.some(r => r.rackId === s.rack_id));
  const queuedItem = queuedSession
    ? list.find(r => r.rackId === queuedSession.rack_id)
    : list.find(r => r.queuePositionOfCaller != null);
  if (queuedItem) {
    const pos = queuedSession
      ? (queuedSession.queue ?? []).indexOf(athleteId) + 1
      : queuedItem.queuePositionOfCaller ?? 1;
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

// ---- live row placement

export interface LiveRowInput {
  session: Pick<RackSessionRow, 'active_athlete_id' | 'workout_instance_id' | 'routine_exercise_id' | 'state' | 'set_number'> | null;
  athleteId: string;
  workoutInstanceId: string;
  /** The exercise shown on the phone. */
  routineExerciseId: string;
  currentSetIndex: number;
}

/**
 * Which set (1-based) of this exercise is live on the rack, or null. Live only
 * while the athlete is the active lifter and only on the current open row of
 * the exercise the rack is using (its routine_exercise_id, or — none set — the
 * phone's own open exercise).
 */
export function liveSetNumber(i: LiveRowInput): number | null {
  const s = i.session;
  if (!s || s.active_athlete_id !== i.athleteId) return null;
  if (s.workout_instance_id && s.workout_instance_id !== i.workoutInstanceId) return null;
  if (s.routine_exercise_id && s.routine_exercise_id !== i.routineExerciseId) return null;
  return i.currentSetIndex + 1;
}

// ---- phone context (debounced, active only)

export interface PhoneContext {
  workoutInstanceId: string;
  routineExerciseId: string;
  setNumber: number | null;
  loadLb: number | null;
}

export interface ContextSender {
  /** Latest context; null = not active (cancels anything pending, sends nothing). */
  update: (rackId: string | null, ctx: PhoneContext | null) => void;
  cancel: () => void;
}

export const CONTEXT_DEBOUNCE_MS = 300;

type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
};

export function createContextSender(
  send: (rackId: string, ctx: PhoneContext) => unknown,
  delayMs: number = CONTEXT_DEBOUNCE_MS,
  timers: Timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): ContextSender {
  let handle: unknown = null;
  let lastSent: string | null = null;
  const cancel = () => {
    if (handle != null) timers.clearTimeout(handle);
    handle = null;
  };
  return {
    update(rackId, ctx) {
      cancel();
      if (!rackId || !ctx) {
        lastSent = null; // next activation sends again
        return;
      }
      const sig = `${rackId}|${ctx.workoutInstanceId}|${ctx.routineExerciseId}|${ctx.setNumber}|${ctx.loadLb ?? ''}`;
      if (sig === lastSent) return;
      handle = timers.setTimeout(() => {
        handle = null;
        lastSent = sig;
        send(rackId, ctx);
      }, delayMs);
    },
    cancel,
  };
}

/** Weight input → load for the rack (null when empty / not a number). */
export function loadFromInput(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ---- Done while live

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

/** The rack ended the set on its own (60 s with no rep). */
export function endedByIdle(log: { metric_data?: any } | null | undefined): boolean {
  return log?.metric_data?.vbt?.ended_by === 'idle';
}

export const RACK_WRITE_TIMEOUT_MS = 10_000;
export const RACK_POLL_MS = 10_000;

// ---- set ended on the rack (phone Done, iPad Done, idle, switch)

export interface EndedSet {
  rackId: string;
  /** null when the rack had no phone context (the caller uses its open set). */
  workoutInstanceId: string | null;
  routineExerciseId: string | null;
  setNumber: number | null;
}

/**
 * Sets this athlete was lifting in `prev` that are no longer being lifted in
 * `next` (state left 'lifting', another set started, or the row is gone).
 * The phone then waits for the rack's exercise_logs write for that set.
 */
export function endedSets(
  prev: RackSessionRow[],
  next: RackSessionRow[],
  athleteId: string,
): EndedSet[] {
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

// ---- phone ↔ iPad in unison (rack_sessions + exercise_logs = one record)

/** Ignore rack_sessions changes this soon after the phone's own context write. */
export const ECHO_WINDOW_MS = 1000;
/** A phone LB edit this recent wins over the rack's load. */
export const LOAD_EDIT_GUARD_MS = 3000;

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

/** The exercise the rack is on next: mid-set the pending context wins (it applies to the next set). */
export function rackExerciseOf(s: SessionLike | null): { workoutInstanceId: string | null; routineExerciseId: string | null } {
  if (!s) return { workoutInstanceId: null, routineExerciseId: null };
  if (s.state === 'lifting' && s.pending_routine_exercise_id) {
    return { workoutInstanceId: s.pending_workout_instance_id ?? s.workout_instance_id, routineExerciseId: s.pending_routine_exercise_id };
  }
  return { workoutInstanceId: s.workout_instance_id, routineExerciseId: s.routine_exercise_id };
}

/** The rack's load for the set it is on (pending mid-set). */
export function rackLoadOf(s: SessionLike | null): number | null {
  if (!s) return null;
  const v = s.state === 'lifting' && s.pending_load_lb != null ? s.pending_load_lb : s.load_lb;
  return v == null ? null : Number(v);
}

export interface FollowInput {
  session: SessionLike | null;
  /** The rack exercise seen on the previous rack_sessions read (undefined = first read). */
  prevRackExercise: string | null | undefined;
  athleteId: string;
  workoutInstanceId: string;
  /** Exercise open on the phone (null on the overview). */
  openExerciseId: string | null;
  /** Last routine exercise the phone sent in its context, and when. */
  lastSentExerciseId: string | null;
  lastSentAt: number;
  now: number;
}

/**
 * iPad → phone: the routine exercise the phone should switch to, or null.
 * Only on a CHANGE of the rack's exercise (never the first read), only while
 * this athlete is active, only for this workout, never an echo of the
 * phone's own context write (same exercise as last sent, or within 1 s of a send).
 */
export function followTarget(i: FollowInput): string | null {
  const s = i.session;
  if (!s || s.active_athlete_id !== i.athleteId) return null;
  const { workoutInstanceId, routineExerciseId } = rackExerciseOf(s);
  if (!routineExerciseId) return null;
  if (workoutInstanceId && workoutInstanceId !== i.workoutInstanceId) return null;
  if (i.prevRackExercise === undefined) return null;
  if (routineExerciseId === i.prevRackExercise) return null;
  if (routineExerciseId === i.openExerciseId) return null;
  if (routineExerciseId === i.lastSentExerciseId) return null;
  if (i.now - i.lastSentAt < ECHO_WINDOW_MS) return null;
  return routineExerciseId;
}

/**
 * iPad → phone load: the LB to put in the phone's cell, or null. Only on a
 * change of the rack's load, only when it differs from the phone's, and never
 * within 3 s of the athlete editing that cell (the phone's edit wins and is
 * sent back through the context).
 */
export function loadSyncValue(i: {
  rackLoad: number | null;
  prevRackLoad: number | null | undefined;
  phoneLoad: number | null;
  lastEditAt: number;
  now: number;
}): number | null {
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

/** A row the rack wrote (only the device that ends a set writes metric_data.vbt). */
export function isRackWrittenLog(log: { metric_data?: any } | null | undefined): boolean {
  const v = log?.metric_data?.vbt;
  return !!v && typeof v === 'object' && (v.source === 'rack' || v.rack != null);
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
