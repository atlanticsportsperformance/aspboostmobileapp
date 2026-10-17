/**
 * Rack iPad view model: pure mapping from the engine state (+ today's
 * athletes) to what the rack screen draws, plus the layout math. No React /
 * RN imports, so it is unit-tested in node (`__tests__/rackViewModel.test.ts`).
 */

import type { Zone } from '../ovr/protocol';
import type { OvrConnState } from '../ovr/ovr-device';
import { nextContext, nextSetNumber, type EndedBy, type EngineRep, type LiveSet, type RackContext, type RackEngineState } from './engine';
import { pickLocalExercise, type TodayAthlete, type TodayExercise } from './api';

// ---------------------------------------------------------------- colours

/** Logger v2 restraint: zone blue, slow red, fast faint white. No warm hues. */
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
} as const;

/** Zone → colour: in = blue, slow = red, fast = faint white; no zone = white. */
export function zoneColor(z: Zone | null | undefined): string {
  if (z === 'in') return RACK_COLORS.acc;
  if (z === 'slow') return RACK_COLORS.red;
  if (z === 'fast') return RACK_COLORS.fast;
  return '#ffffff';
}

/**
 * A rep's colour (bars + the dial's landed arc). With a zone: a rep at or past
 * the speed-drop stop is red even when it is in the zone (spec §3); otherwise
 * the zone colour. Without a zone: neutral white. Partial: faint.
 */
export function repColor(r: { zone: Zone | null; partial: boolean; dropCue: boolean }, hasZone: boolean): string {
  if (r.partial) return 'rgba(255,255,255,0.12)';
  if (!hasZone) return '#ffffff';
  if (r.dropCue) return RACK_COLORS.red;
  return zoneColor(r.zone);
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

// ---------------------------------------------------------------- layout

export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface RackLayout {
  mode: 'landscape' | 'portrait';
  /** Safe-area height scale vs the design canvas (1180×820 / 820×1180). */
  k: number;
  dial: number;
  bubble: number;
  tilesH: number;
  /** Minimum THIS SET bars height (the bars fill their card above this). */
  barsMin: number;
  /** Right column: athlete card (landscape) / replay panel (portrait). */
  sideW: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Layout from the window + safe area. Landscape when width > height (the
 * approved rack-live.html), portrait otherwise (rack-portrait.html). Sizes
 * scale from the SAFE-AREA height; the dial is capped so row 2 keeps at least
 * `barsMin` of bars, and so dial + bubbles fit across.
 *
 * Fixed chrome (pt): outer padding 2×16, header 44, card padding 2×20 +
 * border 2, card header 30 (16 line + 14 gap), gaps 16.
 */
export function rackLayout(width: number, height: number, insets: SafeInsets): RackLayout {
  const H = height - insets.top - insets.bottom;
  const W = width - insets.left - insets.right;
  const cardChrome = 42 + 30; // padding + border + card header
  const barsMin = 90;
  const row2Min = cardChrome + barsMin;
  const across = (dial: number) => dial + (2 * dial * 124) / 300; // dial + 2 bubbles

  if (width > height) {
    const k = clamp(H / 776, 0.7, 1.3);
    const tilesH = Math.round(96 * Math.min(k, 1.15));
    // pad 32 + header 44 + 3 gaps 48 + tiles; then row gap 16 + row 2 min.
    const fixed = 32 + 44 + 48 + tilesH;
    const dialByH = H - fixed - 16 - row2Min - cardChrome;
    const dialByW = (W - 32 - 16 - 360 - 40 - 28 - 14) / (across(1) as number);
    const dial = Math.floor(Math.max(160, Math.min(300 * k, dialByH, dialByW)));
    return { mode: 'landscape', k, dial, bubble: Math.round((dial * 124) / 300), tilesH, barsMin, sideW: 360 };
  }

  const k = clamp(H / 1136, 0.7, 1.3);
  const tilesH = Math.round(88 * Math.min(k, 1.15));
  const athleteH = 190; // kv grid (2 rows × ~67 + 10) + card padding/border
  // pad 32 + header 44 + 4 gaps 64 + tiles + athlete card + row 3 min.
  const fixed = 32 + 44 + 64 + tilesH + athleteH + row2Min;
  const dialByH = H - fixed - cardChrome;
  const dialByW = (W - 32 - 40 - 36 - 14) / (across(1) as number);
  const dial = Math.floor(Math.max(160, Math.min(300 * k, dialByH, dialByW)));
  return { mode: 'portrait', k, dial, bubble: Math.round((dial * 124) / 300), tilesH, barsMin, sideW: 230 };
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

/**
 * `pairedName` null + not the fake = no sensor paired: the iPad does NOT
 * connect (it could take another rack's sensor) and says so.
 */
export function sensorPillOf(
  state: OvrConnState,
  deviceName: string | null | undefined,
  pairedName: string | null | undefined,
  fake = false,
): SensorPill {
  if (!pairedName && !fake) return { kind: 'notPaired', label: 'Sensor not paired · pair in setup' };
  if (state === 'connected') return { kind: 'connected', label: `${shortSensorName(deviceName ?? pairedName)} connected` };
  if (state === 'scanning' || state === 'connecting' || state === 'reconnecting') {
    return { kind: 'reconnecting', label: `Reconnecting ${shortSensorName(pairedName ?? deviceName)}…` };
  }
  return { kind: 'notPaired', label: `${shortSensorName(pairedName ?? deviceName)} not connected` };
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

const exLabel = (e: TodayExercise) => (e.code ? `${e.code} · ${e.name}` : e.name);

// ---------------------------------------------------------------- view types

export interface RepBarView {
  key: string;
  v: number;
  partial: boolean;
  zone: Zone | null;
  /** At/past the speed-drop stop (only meaningful with a zone). */
  dropCue: boolean;
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
  /** When the summary stops showing (null = until the engine leaves summary). */
  expiresAtMs: number | null;
}

export interface TileView {
  athleteId: string;
  initials: string;
  name: string;
  subtitle: string;
  status: string;
  active: boolean;
  away: boolean;
  switching: boolean;
}

export interface RackView {
  open: boolean;
  statusText: string;
  dropCue: boolean;
  athlete: { id: string; name: string; firstName: string; initials: string } | null;
  /** Header bold line: the active athlete's workout name. */
  workoutName: string | null;
  exerciseName: string;
  setNumber: number | null;
  setsPrescribed: number | null;
  /** Prescribed reps (plan), null when not prescribed. */
  repsTarget: number | null;
  /** "Back Squat · Set 1 of 3". */
  exerciseLine: string;
  /** "FROM TYLER'S PHONE" / "PICKED ON THE IPAD" / "FREE LIFT". */
  sourceLine: string;
  contextSource: 'phone' | 'ipad' | 'none';
  /** Routine exercise the card is showing (picker highlight). */
  routineExerciseId: string | null;
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
  lastRep: { key: string; v: number; partial: boolean; zone: Zone | null; dropCue: boolean } | null;
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
    dropCue: !r.partial && r.dropCue,
    label: r.partial ? '—' : r.v.toFixed(2),
  }));
}

function possessive(first: string): string {
  const up = first.toUpperCase();
  return up.endsWith('S') ? `${up}'` : `${up}'S`;
}

const sameEx = (a: Pick<RackContext, 'workoutInstanceId' | 'routineExerciseId'>, b: Pick<RackContext, 'workoutInstanceId' | 'routineExerciseId'>) =>
  a.workoutInstanceId === b.workoutInstanceId && a.routineExerciseId === b.routineExerciseId;

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
  const ctx: RackContext = shownSet ? shownSet.context : nextContext(s);
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
  const setNumber = shownSet ? shownSet.context.setNumber : activeId ? nextSetNumber(s, activeId) : null;
  const loadLb = shownSet ? shownSet.context.loadLb : ctx.loadLb ?? s.loadOverrideLb;

  // Where the context came from. A shown set keeps its own origin: it came
  // from the iPad when it matches the iPad pick and the row's LIVE context is
  // empty (a later phone pick only fills pending_*).
  const row = s.session;
  const local = s.localContext && s.localContext.athleteId === activeId ? s.localContext : null;
  let contextSource: RackView['contextSource'];
  if (ctx.workoutInstanceId == null) contextSource = 'none';
  else if (shownSet) {
    contextSource =
      local && sameEx(local, shownSet.rawContext) && (row == null || row.workout_instance_id == null) ? 'ipad' : 'phone';
  } else {
    const serverHasWorkout = row != null && (row.workout_instance_id != null || row.pending_workout_instance_id != null);
    contextSource = serverHasWorkout ? 'phone' : 'ipad';
  }
  const sourceLine =
    contextSource === 'phone' ? `FROM ${possessive(firstName)} PHONE` : contextSource === 'ipad' ? 'PICKED ON THE IPAD' : 'FREE LIFT';

  const exerciseName = ex?.name ?? (ctx.workoutInstanceId ? 'Exercise' : 'Free lift');
  const setsPrescribed = ex?.sets ?? null;
  const exerciseLine =
    setNumber != null
      ? `${exerciseName} · Set ${setNumber}${setsPrescribed ? ` of ${setsPrescribed}` : ''}`
      : exerciseName;

  const workoutName = active
    ? (active.instances.find(i => i.workoutInstanceId === ctx.workoutInstanceId) ?? active.instances[0])?.workoutName ?? null
    : null;

  const reps = shownSet?.reps ?? [];
  const full = reps.filter(r => !r.partial);
  const bestV = full.length ? Math.max(...full.map(r => r.v)) : null;
  const lastFull = full[full.length - 1];
  const dropPct = lastFull?.dropPct ?? null;
  const dropCue = lifting && !!zone && !!lastFull?.dropCue;
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
  if (s.setState === 'summary' && ended && ended.endedBy && ended.endedAtMs != null) {
    const expiresAtMs = ended.endedBy === 'idle' ? null : ended.endedAtMs + SUMMARY_MS;
    if (expiresAtMs == null || nowMs < expiresAtMs) {
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
        expiresAtMs,
      };
    }
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
    // Away: a queued athlete whose phone moved on from the exercise of their
    // last set on this rack (known only from rows seen while they were up).
    const pc = !isActive ? phoneContexts[id] : undefined;
    const lastSet = s.lastEndByAthlete[id]?.set;
    const away = !!pc && !!lastSet && pc.routineExerciseId != null && !sameEx(pc, lastSet.context);
    const pcEx = away && pc ? exerciseFor(a, pc) : undefined;
    let subtitle: string;
    if (away) subtitle = pcEx ? `On ${exLabel(pcEx)}` : 'On another exercise';
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
    workoutName,
    exerciseName,
    setNumber,
    setsPrescribed,
    repsTarget: ex?.repsTarget ?? null,
    exerciseLine,
    sourceLine,
    contextSource,
    routineExerciseId: ctx.routineExerciseId,
    loadLb,
    zone,
    dropStopPct,
    bars: repBars(reps, setKey),
    fullReps: full.length,
    bestV,
    dropPct,
    dropLineV,
    lastRep: newest
      ? { key: `${setKey}:${newest.repIndex}`, v: newest.v, partial: newest.partial, zone: newest.partial ? null : newest.zone, dropCue: !newest.partial && newest.dropCue }
      : null,
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
