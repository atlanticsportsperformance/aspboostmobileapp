/**
 * Rack iPad view model: pure mapping from the engine state (+ today's
 * athletes) to what the rack screen draws. No React / RN imports, so it is
 * unit-tested in node (`__tests__/rackViewModel.test.ts`).
 */

import type { Zone } from '../ovr/protocol';
import type { OvrConnState } from '../ovr/ovr-device';
import { nextContext, type EndedBy, type EngineRep, type LiveSet, type RackContext, type RackEngineState } from './engine';
import { pickLocalExercise, type TodayAthlete, type TodayExercise } from './api';

// ---------------------------------------------------------------- colours

export const RACK_COLORS = {
  bg: '#08090a',
  card: '#101113',
  line: 'rgba(255,255,255,0.08)',
  mut: 'rgba(255,255,255,0.5)',
  acc: '#9BDDFF',
  accInk: '#04131C',
  red: '#E5534B',
  fast: 'rgba(255,255,255,0.9)',
  green: '#10B981',
  greenText: '#6EE7B7',
  amber: '#F0883E',
  amberText: '#F7B27A',
} as const;

/** Zone → colour: in = blue, slow = red, fast = faint white; no zone = white. */
export function zoneColor(z: Zone | null | undefined): string {
  if (z === 'in') return RACK_COLORS.acc;
  if (z === 'slow') return RACK_COLORS.red;
  if (z === 'fast') return RACK_COLORS.fast;
  return '#ffffff';
}

export function zoneWord(z: Zone | null | undefined): string {
  if (z === 'in') return 'IN ZONE';
  if (z === 'slow') return 'TOO SLOW';
  if (z === 'fast') return 'TOO FAST';
  return '';
}

/** Top of the velocity scale (dial + bars): 1.0 m/s, or the next 0.5 above the fastest value. */
export function velocityScale(...vs: (number | null | undefined)[]): number {
  const max = Math.max(0, ...vs.filter((v): v is number => typeof v === 'number' && isFinite(v)));
  if (max <= 1) return 1;
  return Math.ceil(max * 2) / 2;
}

// ---------------------------------------------------------------- sensor pill

export type SensorPillKind = 'connected' | 'reconnecting' | 'notPaired';

export interface SensorPill {
  kind: SensorPillKind;
  label: string;
}

/** `OVR_Velocity-6C8E` → `OVR-6C8E`. */
export function shortSensorName(name: string | null | undefined): string {
  if (!name) return 'Sensor';
  return name.replace(/^OVR_Velocity-?/, 'OVR-').replace(/-$/, '');
}

export function sensorPillOf(
  state: OvrConnState,
  deviceName: string | null | undefined,
  pairedName: string | null | undefined,
): SensorPill {
  if (state === 'connected') return { kind: 'connected', label: `${shortSensorName(deviceName ?? pairedName)} connected` };
  if (state === 'scanning' || state === 'connecting' || state === 'reconnecting') {
    return { kind: 'reconnecting', label: pairedName ? `Reconnecting ${shortSensorName(pairedName)}…` : 'Looking for sensor…' };
  }
  return { kind: 'notPaired', label: pairedName ? `${shortSensorName(pairedName)} not connected` : 'Sensor not paired' };
}

// ---------------------------------------------------------------- names

export function initialsOf(first: string | null | undefined, last: string | null | undefined): string {
  const a = (first ?? '').trim()[0] ?? '';
  const b = (last ?? '').trim()[0] ?? '';
  return (a + b).toUpperCase() || '?';
}

function findAthlete(today: TodayAthlete[], id: string | null | undefined): TodayAthlete | undefined {
  return id ? today.find(t => t.athleteId === id) : undefined;
}

/** The athlete's TodayExercise for a context (routine exercise first, then exercise id). */
export function exerciseFor(
  athlete: TodayAthlete | undefined,
  ctx: Pick<RackContext, 'routineExerciseId' | 'exerciseId' | 'workoutInstanceId'>,
): TodayExercise | undefined {
  if (!athlete) return undefined;
  if (ctx.routineExerciseId) {
    const e = athlete.exercises.find(x => x.routineExerciseId === ctx.routineExerciseId);
    if (e) return e;
  }
  if (ctx.exerciseId) return athlete.exercises.find(x => x.exerciseId === ctx.exerciseId);
  return undefined;
}

/** A "rack exercise" is one the coach gave a velocity target. */
export function isRackExercise(ex: Pick<TodayExercise, 'zoneMin' | 'zoneMax'> | undefined): boolean {
  return !!ex && (ex.zoneMin != null || ex.zoneMax != null);
}

// ---------------------------------------------------------------- view types

export interface RepBarView {
  key: string;
  v: number;
  partial: boolean;
  zone: Zone | null;
  /** "0.52", or "—" for a partial rep. */
  label: string;
}

export interface SummaryView {
  title: string;
  big: string;
  avg: string;
  best: string;
  drop: string;
  footer: string;
  endedBy: EndedBy;
}

export type TileStatus = 'UP NOW' | 'NEXT' | string;

export interface TileView {
  athleteId: string;
  initials: string;
  name: string;
  subtitle: string;
  status: TileStatus;
  active: boolean;
  away: boolean;
  switching: boolean;
}

export interface RackView {
  open: boolean;
  statusText: string;
  dropCue: boolean;
  athlete: { id: string; name: string; firstName: string; initials: string } | null;
  exerciseName: string;
  setNumber: number | null;
  setsPrescribed: number | null;
  /** "Back Squat · Set 1 of 3". */
  exerciseLine: string;
  /** "FROM TYLER'S PHONE" / "PICKED ON THE IPAD" / "FREE LIFT". */
  sourceLine: string;
  contextSource: 'phone' | 'ipad' | 'none';
  loadLb: number | null;
  zone: [number, number] | null;
  dropStopPct: number | null;
  /** Bars of the set on screen (live set, or the set just ended). */
  bars: RepBarView[];
  fullReps: number;
  bestV: number | null;
  /** Drop % of the last full rep (null before any). */
  dropPct: number | null;
  /** Drop line height (m/s): best × (1 − stop%), only with a zone + stop %. */
  dropLineV: number | null;
  /** Newest rep (drives the dial count-up); null when no set is on screen. */
  lastRep: { key: string; v: number; partial: boolean; zone: Zone | null } | null;
  lifting: boolean;
  summary: SummaryView | null;
  tiles: TileView[];
  /** Today's athletes not active / queued (the "+" sheet). */
  addable: TodayAthlete[];
  /** The active athlete's remaining exercises (override dropdown). */
  remaining: TodayExercise[];
  scaleV: number;
}

/** How long a summary stays up (an idle-ended one stays until something changes). */
export const SUMMARY_MS = 6_000;

const END_LABEL: Record<EndedBy, string> = {
  ipad: 'DONE ON IPAD',
  phone: 'DONE ON PHONE',
  switch: 'SWITCHED',
  leave: 'LEFT THE RACK',
  idle: '60 S NO REPS',
};

const fmtV = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));

export function repBars(reps: EngineRep[], prefix: string): RepBarView[] {
  return reps.map(r => ({
    key: `${prefix}:${r.repIndex}`,
    v: r.v,
    partial: r.partial,
    zone: r.partial ? null : r.zone,
    label: r.partial ? '—' : r.v.toFixed(2),
  }));
}

/** Number shown for the next set: max(phone number, high-water + 1); held after an idle end. */
function nextSetNumber(s: RackEngineState, athleteId: string, ctx: RackContext): number | null {
  if (ctx.workoutInstanceId == null || ctx.routineExerciseId == null) return null;
  const rec = s.lastEndByAthlete[athleteId];
  if (rec?.hold && rec.rawContext.workoutInstanceId === ctx.workoutInstanceId && rec.rawContext.routineExerciseId === ctx.routineExerciseId) {
    return rec.setNumber;
  }
  const hw = s.setHighWater[`${athleteId}:${ctx.workoutInstanceId}:${ctx.routineExerciseId}`] ?? 0;
  return Math.max(ctx.setNumber ?? 0, hw + 1);
}

function possessive(first: string): string {
  const up = first.toUpperCase();
  return up.endsWith('S') ? `${up}'` : `${up}'S`;
}

export interface RackViewInput {
  state: RackEngineState;
  today: TodayAthlete[];
  rackName: string;
  nowMs: number;
  /** Last phone context seen per athlete (from session rows while they were active). */
  phoneContexts?: Record<string, RackContext>;
}

export function buildRackView({ state: s, today, rackName, nowMs, phoneContexts = {} }: RackViewInput): RackView {
  const activeId = s.activeAthleteId;
  const active = findAthlete(today, activeId);
  const firstName = active?.firstName ?? 'Athlete';
  const lifting = s.setState === 'lifting' && !!s.live;

  // Which set is on screen: live, else the just-ended one of the active athlete.
  const shownSet: LiveSet | null = lifting
    ? s.live
    : s.setState === 'summary' && s.lastEnded && s.lastEnded.athleteId === activeId
      ? s.lastEnded
      : null;

  // Context: the live set's frozen one, else the ended set's, else the next one.
  const next = nextContext(s);
  const ctx: RackContext = shownSet ? shownSet.context : next;
  const ex = exerciseFor(active, ctx);
  const meta = ctx.exerciseId ? s.metaByExercise[ctx.exerciseId] : undefined;
  const zone: [number, number] | null = shownSet
    ? shownSet.zone
    : meta && meta.zoneMin != null && meta.zoneMax != null
      ? [meta.zoneMin, meta.zoneMax]
      : ex && ex.zoneMin != null && ex.zoneMax != null
        ? [ex.zoneMin, ex.zoneMax]
        : null;
  const dropStopPct = shownSet ? shownSet.dropStopPct : meta?.dropStopPct ?? ex?.dropStopPct ?? null;
  const setNumber = shownSet ? shownSet.context.setNumber : activeId ? nextSetNumber(s, activeId, ctx) : null;
  const loadLb = shownSet ? shownSet.context.loadLb : ctx.loadLb ?? s.loadOverrideLb;

  // Where the context came from.
  const serverHasWorkout =
    s.session != null &&
    (s.session.workout_instance_id != null || s.session.pending_workout_instance_id != null);
  const contextSource: RackView['contextSource'] =
    ctx.workoutInstanceId == null ? 'none' : serverHasWorkout ? 'phone' : 'ipad';
  const sourceLine =
    contextSource === 'phone' ? `FROM ${possessive(firstName)} PHONE` : contextSource === 'ipad' ? 'PICKED ON THE IPAD' : 'FREE LIFT';

  const exerciseName = ex?.name ?? (ctx.workoutInstanceId ? 'Exercise' : 'Free lift');
  const setsPrescribed = ex?.sets ?? null;
  const exerciseLine =
    setNumber != null
      ? `${exerciseName} · Set ${setNumber}${setsPrescribed ? ` of ${setsPrescribed}` : ''}`
      : exerciseName;

  const reps = shownSet?.reps ?? [];
  const full = reps.filter(r => !r.partial);
  const bestV = full.length ? Math.max(...full.map(r => r.v)) : null;
  const lastFull = full[full.length - 1];
  const dropPct = lastFull?.dropPct ?? null;
  const dropCue = lifting && !!lastFull?.dropCue;
  const dropLineV = zone && dropStopPct != null && bestV != null ? bestV * (1 - dropStopPct / 100) : null;
  const newest = reps[reps.length - 1];
  const setKey = shownSet ? `${shownSet.athleteId}:${shownSet.startedAtMs}` : 'none';

  // Status line.
  const switchingName = s.switchingTo ? findAthlete(today, s.switchingTo)?.firstName ?? 'next athlete' : null;
  const statusText = switchingName
    ? `Switching to ${switchingName}…`
    : !activeId
      ? `${rackName} is open`
      : `${firstName} is up · ${lifting ? 'lifting' : 'lift when ready'}`;

  // Summary overlay.
  let summary: SummaryView | null = null;
  const ended = s.lastEnded;
  if (
    s.setState === 'summary' &&
    ended &&
    ended.endedBy &&
    ended.endedAtMs != null &&
    (ended.endedBy === 'idle' || nowMs - ended.endedAtMs < SUMMARY_MS)
  ) {
    const efull = ended.reps.filter(r => !r.partial);
    const ebest = efull.length ? Math.max(...efull.map(r => r.v)) : null;
    const eavg = efull.length ? efull.reduce((a, r) => a + r.v, 0) / efull.length : null;
    const elast = efull[efull.length - 1];
    const n = ended.context.setNumber;
    const what = ended.free ? 'REPS SAVED' : n != null ? `SET ${n} SAVED` : 'SET SAVED';
    const lb = ended.context.loadLb;
    const nextUp = s.queue.find(id => id !== ended.athleteId);
    const nextName = nextUp ? findAthlete(today, nextUp)?.firstName ?? 'next athlete' : null;
    summary = {
      title: `${what} · ${END_LABEL[ended.endedBy]}`,
      big: lb != null ? `${lb} lb × ${efull.length}` : `${efull.length} rep${efull.length === 1 ? '' : 's'}`,
      avg: fmtV(eavg),
      best: fmtV(ebest),
      drop: elast?.dropPct != null ? `${elast.dropPct}%` : '—',
      footer:
        ended.endedBy === 'idle'
          ? 'Saved · tap to edit on the phone'
          : ended.athleteId !== activeId && activeId
            ? `${findAthlete(today, activeId)?.firstName ?? 'Next athlete'} is up`
            : nextName
              ? `Next up: ${nextName}`
              : 'Same lifter · next set',
      endedBy: ended.endedBy,
    };
  }

  // Tiles: active first, then the queue (server order).
  const order: string[] = [];
  for (const id of [activeId, ...s.queue]) if (id && !order.includes(id)) order.push(id);
  const queue = s.queue.filter(id => id !== activeId);
  const tiles: TileView[] = order.map(id => {
    const a = findAthlete(today, id);
    const isActive = id === activeId;
    const qpos = queue.indexOf(id);
    const status = isActive ? 'UP NOW' : qpos === 0 ? 'NEXT' : qpos > 0 ? `#${qpos + 1} IN LINE` : '';
    // Away: a queued athlete whose phone is on a non-rack exercise (only when known).
    const pc = !isActive ? phoneContexts[id] : undefined;
    const pcEx = pc ? exerciseFor(a, pc) : undefined;
    const away = !!pcEx && !isRackExercise(pcEx);
    let subtitle: string;
    if (away && pcEx) subtitle = `On ${pcEx.name}`;
    else if (isActive) subtitle = exerciseLine;
    else {
      const pick = a ? pickLocalExercise(a) : null;
      subtitle = pick
        ? `${pick.name} · Set ${pick.completedSets + 1}${pick.sets ? `/${pick.sets}` : ''}`
        : a
          ? 'No sets left today'
          : '';
    }
    return {
      athleteId: id,
      initials: a ? initialsOf(a.firstName, a.lastName) : '?',
      name: a?.firstName ?? 'Athlete',
      subtitle,
      status,
      active: isActive,
      away,
      switching: id === s.switchingTo,
    };
  });
  if (s.switchingTo && !order.includes(s.switchingTo)) {
    const a = findAthlete(today, s.switchingTo);
    tiles.push({
      athleteId: s.switchingTo,
      initials: a ? initialsOf(a.firstName, a.lastName) : '?',
      name: a?.firstName ?? 'Athlete',
      subtitle: 'Switching…',
      status: '',
      active: false,
      away: false,
      switching: true,
    });
  }

  const onRack = new Set([...order, ...(s.switchingTo ? [s.switchingTo] : [])]);
  const addable = today.filter(t => !onRack.has(t.athleteId));

  const scaleV = velocityScale(zone?.[1], ...reps.map(r => r.v));

  return {
    open: !activeId && !s.switchingTo,
    statusText,
    dropCue,
    athlete: activeId
      ? { id: activeId, name: active ? `${active.firstName} ${active.lastName}`.trim() : 'Athlete', firstName, initials: active ? initialsOf(active.firstName, active.lastName) : '?' }
      : null,
    exerciseName,
    setNumber,
    setsPrescribed,
    exerciseLine,
    sourceLine,
    contextSource,
    loadLb,
    zone,
    dropStopPct,
    bars: repBars(reps, setKey),
    fullReps: full.length,
    bestV,
    dropPct,
    dropLineV,
    lastRep: newest ? { key: `${setKey}:${newest.repIndex}`, v: newest.v, partial: newest.partial, zone: newest.partial ? null : newest.zone } : null,
    lifting,
    summary,
    tiles,
    addable,
    remaining: active?.remaining ?? [],
    scaleV,
  };
}

/**
 * The phone's context for the active athlete, as last shown by the server
 * row (pending first — the phone's newest pick). Used to remember where each
 * athlete's phone was when they leave the front of the rack.
 */
export function phoneContextOfRow(s: RackEngineState): { athleteId: string; ctx: RackContext } | null {
  const row = s.session;
  if (!row || !row.active_athlete_id) return null;
  const hasPending = row.pending_workout_instance_id != null || row.pending_routine_exercise_id != null;
  const ctx: RackContext = hasPending
    ? {
        workoutInstanceId: row.pending_workout_instance_id,
        routineExerciseId: row.pending_routine_exercise_id,
        exerciseId: row.pending_routine_exercise_id ? s.exerciseByRoutineExercise[row.pending_routine_exercise_id] ?? null : null,
        setNumber: row.pending_set_number,
        loadLb: row.pending_load_lb,
      }
    : {
        workoutInstanceId: row.workout_instance_id,
        routineExerciseId: row.routine_exercise_id,
        exerciseId: row.exercise_id,
        setNumber: row.set_number,
        loadLb: row.load_lb,
      };
  if (ctx.workoutInstanceId == null) return null;
  return { athleteId: row.active_athlete_id, ctx };
}

/** The `localContext` event for an iPad exercise pick. */
export function localContextFor(athleteId: string, ex: TodayExercise) {
  return {
    type: 'localContext' as const,
    athleteId,
    workoutInstanceId: ex.workoutInstanceId,
    routineExerciseId: ex.routineExerciseId,
    exerciseId: ex.exerciseId,
    setNumber: null,
    loadLb: null,
    zoneMin: ex.zoneMin,
    zoneMax: ex.zoneMax,
    dropStopPct: ex.dropStopPct,
  };
}
