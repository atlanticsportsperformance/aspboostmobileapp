/**
 * Rack iPad view model: pure mapping from the engine state (+ today's
 * athletes) to what the rack screen draws, plus the layout math. No React /
 * RN imports, so it is unit-tested in node (`__tests__/rackViewModel.test.ts`).
 */

import type { Zone } from '../ovr/protocol';
import type { OvrConnState } from '../ovr/ovr-device';
import { nextContext, nextSetNumber, pickedByOf, type EndedBy, type EngineRep, type LiveSet, type RackContext, type RackEngineState } from './engine';
import { percentWeightTarget, pickLocalExercise, type TodayAthlete, type TodayExercise } from './api';
import { rackSetLine } from './resolveRackSet';
import { hasLoad, setWatts, wattsOf } from './power';

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
  /** Tighter athlete card (short iPads, e.g. a mini in landscape). */
  compactCard: boolean;
}

/** Natural athlete-card height in the landscape column (normal / compact). */
export const ATHLETE_CARD_H = 356;
export const ATHLETE_CARD_COMPACT_H = 290;

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
    // Row 1 is max(dial card, athlete card): whatever is left after row 2's
    // minimum must hold the athlete card too — else use the compact card.
    const row1Room = H - fixed - 16 - row2Min;
    const compactCard = row1Room < ATHLETE_CARD_H;
    const dialByH = row1Room - cardChrome;
    const dialByW = (W - 32 - 16 - 360 - 40 - 28 - 14) / (across(1) as number);
    const dial = Math.floor(Math.max(160, Math.min(300 * k, dialByH, dialByW)));
    return { mode: 'landscape', k, dial, bubble: Math.round((dial * 124) / 300), tilesH, barsMin, sideW: 360, compactCard };
  }

  const k = clamp(H / 1136, 0.7, 1.3);
  const tilesH = Math.round(88 * Math.min(k, 1.15));
  const athleteH = 190; // kv grid (2 rows × ~67 + 10) + card padding/border
  // pad 32 + header 44 + 4 gaps 64 + tiles + athlete card + row 3 min.
  const fixed = 32 + 44 + 64 + tilesH + athleteH + row2Min;
  const dialByH = H - fixed - cardChrome;
  const dialByW = (W - 32 - 40 - 36 - 14) / (across(1) as number);
  const dial = Math.floor(Math.max(160, Math.min(300 * k, dialByH, dialByW)));
  return { mode: 'portrait', k, dial, bubble: Math.round((dial * 124) / 300), tilesH, barsMin, sideW: 230, compactCard: false };
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
  /** vbt_reps.client_rep_id (tap → remove-rep sheet). */
  clientRepId: string;
  /** 1-based position in the set ("Rep 3"). */
  repNo: number;
  v: number;
  partial: boolean;
  zone: Zone | null;
  /** At/past the speed-drop stop (only meaningful with a zone). */
  dropCue: boolean;
  /** "0.52", or "—" for a partial rep. */
  label: string;
  /** Our watts (load × g × mean v); null without a load or for a partial rep. */
  watts: number | null;
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
  /** AVG W / PEAK W — only when the set's load is known. */
  avgW: string | null;
  peakW: string | null;
  /** "Wrong athlete? Move set" — within MOVE_WINDOW_MS of the end. */
  canMove: boolean;
  /** When the move button goes (the screen re-renders then). */
  moveUntilMs: number;
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
  /** "FROM TYLER'S PHONE" / "PICKED BY RACK" / "PICKED ON IPAD" / "FREE LIFT". */
  sourceLine: string;
  contextSource: 'phone' | 'ipad' | 'rack' | 'none';
  /** BAR caption when the load can't be shown yet (an unresolved % target). */
  loadNote: string | null;
  /** The load is known (> 0): the Speed | Power toggle and the watts show. */
  powerAvailable: boolean;
  /**
   * Athlete-card chip "Wrong athlete? Move last set": the set that just ended,
   * for 2 min after its end or until that athlete's next set starts.
   */
  lastSetMove: { athleteId: string; name: string; untilMs: number } | null;
  /** No exercise for the active athlete (no rack lift left): prompt "Pick an exercise". */
  needsPick: boolean;
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
  /** All of the active athlete's exercises today, in workout order (live picker). */
  exercises: TodayExercise[];
  scaleV: number;
}

/** How long a summary stays up (an idle-ended one stays until something changes). */
export const SUMMARY_MS = 6_000;
/** "Wrong athlete? Move set" shows this long after the set ended (= executor MOVE_WINDOW_MS). */
export const MOVE_WINDOW_MS = 120_000;

const END_LABEL: Record<EndedBy, string> = {
  ipad: 'DONE ON IPAD',
  phone: 'DONE ON PHONE',
  switch: 'SWITCHED',
  leave: 'LEFT THE RACK',
  idle: '60 S NO REPS',
};

const fmtV = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));

export function repBars(reps: EngineRep[], prefix: string, loadLb: number | null = null): RepBarView[] {
  return reps.map((r, i) => ({
    key: `${prefix}:${r.repIndex}`,
    clientRepId: r.clientRepId,
    repNo: i + 1,
    v: r.v,
    partial: r.partial,
    zone: r.partial ? null : r.zone,
    dropCue: !r.partial && r.dropCue,
    label: r.partial ? '—' : r.v.toFixed(2),
    watts: r.partial ? null : wattsOf(loadLb, r.v),
  }));
}

/** The move-last-set chip: the just-ended set, ≤ 2 min, until that athlete's next set starts. */
export function lastSetMoveOf(
  s: Pick<RackEngineState, 'lastEnded' | 'live' | 'setState'>,
  today: TodayAthlete[],
  nowMs: number,
): RackView['lastSetMove'] {
  const e = s.lastEnded;
  if (!e || e.endedAtMs == null) return null;
  const untilMs = e.endedAtMs + MOVE_WINDOW_MS;
  if (nowMs >= untilMs) return null;
  if (s.setState === 'lifting' && s.live && s.live.athleteId === e.athleteId && s.live.startedAtMs > e.endedAtMs - 1) return null;
  return { athleteId: e.athleteId, name: findAthlete(today, e.athleteId)?.firstName ?? 'Athlete', untilMs };
}

/** Summary boxes: AVG / BEST / DROP, then AVG W / PEAK W when the load is known. */
export function summaryBoxes(sm: SummaryView): [string, string][] {
  const out: [string, string][] = [
    ['AVG', sm.avg],
    ['BEST', sm.best],
    ['DROP', sm.drop],
  ];
  if (sm.avgW != null) out.push(['AVG W', sm.avgW]);
  if (sm.peakW != null) out.push(['PEAK W', sm.peakW]);
  return out;
}

/** Remove-rep sheet text: "Rep 3 · 0.30 m/s" (a partial: "Rep 3 · partial"). */
export function removeRepTitle(b: Pick<RepBarView, 'repNo' | 'v' | 'partial'>): string {
  return `Rep ${b.repNo} · ${b.partial ? 'partial' : `${b.v.toFixed(2)} m/s`}`;
}

/**
 * "Switch, or move this set?" list: the athletes on the rack (queue order)
 * first, then today's other athletes by name — never `excludeId` (whose set
 * it is). A search (first / last name) filters both groups.
 */
export function moveCandidates(
  s: Pick<RackEngineState, 'activeAthleteId' | 'queue'>,
  today: TodayAthlete[],
  excludeId: string | null,
  query = '',
): { athlete: TodayAthlete; onRack: boolean }[] {
  const q = query.trim().toLowerCase();
  const match = (a: TodayAthlete) =>
    !q || a.firstName.toLowerCase().startsWith(q) || a.lastName.toLowerCase().startsWith(q) || `${a.firstName} ${a.lastName}`.toLowerCase().includes(q);
  const out: { athlete: TodayAthlete; onRack: boolean }[] = [];
  const seen = new Set<string>(excludeId ? [excludeId] : []);
  for (const id of [s.activeAthleteId, ...s.queue]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const a = today.find(t => t.athleteId === id);
    if (a && match(a)) out.push({ athlete: a, onRack: true });
  }
  for (const a of filterAddable(today, '')) {
    if (seen.has(a.athleteId)) continue;
    seen.add(a.athleteId);
    if (match(a)) out.push({ athlete: a, onRack: false });
  }
  return out;
}

function possessive(first: string): string {
  const up = first.toUpperCase();
  return up.endsWith('S') ? `${up}'` : `${up}'S`;
}

const sameEx = (a: Pick<RackContext, 'workoutInstanceId' | 'routineExerciseId'>, b: Pick<RackContext, 'workoutInstanceId' | 'routineExerciseId'>) =>
  a.workoutInstanceId === b.workoutInstanceId && a.routineExerciseId === b.routineExerciseId;

/** null = sticky (idle end: stays until the engine leaves summary). */
function summaryExpiry(ended: LiveSet): number | null {
  if (ended.endedBy === 'idle' || ended.endedAtMs == null) return null;
  return ended.endedAtMs + SUMMARY_MS;
}

/**
 * Summary overlay up: the engine is in 'summary' and (idle end, or less than
 * SUMMARY_MS since the end). `nowMs` may lag real time (minute clock), which
 * only keeps the summary up a little longer; the screen sets a timeout at the
 * expiry so it re-renders on time.
 */
export function summaryVisible(s: RackEngineState, nowMs: number): boolean {
  const ended = s.lastEnded;
  if (s.setState !== 'summary' || !ended || !ended.endedBy || ended.endedAtMs == null) return false;
  const exp = summaryExpiry(ended);
  return exp == null || nowMs < exp;
}

/** "+" sheet list: filter by first or last name (case-insensitive), stable name order. */
export function filterAddable(list: TodayAthlete[], query: string): TodayAthlete[] {
  const q = query.trim().toLowerCase();
  const sorted = [...list].sort(
    (a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`) || a.athleteId.localeCompare(b.athleteId),
  );
  if (!q) return sorted;
  return sorted.filter(a => a.firstName.toLowerCase().startsWith(q) || a.lastName.toLowerCase().startsWith(q) ||
    `${a.firstName} ${a.lastName}`.toLowerCase().includes(q));
}

export interface RackViewInput {
  state: RackEngineState;
  today: TodayAthlete[];
  rackName: string;
  nowMs: number;
  /** Last phone context seen per athlete (from session rows while they were active). */
  phoneContexts?: Record<string, RackContext>;
  /** executor.ipadOwnsContext(): the row's exercise is the iPad's published pick. */
  ipadOwned?: boolean;
}

export function buildRackView({ state: s, today, rackName, nowMs, phoneContexts = {}, ipadOwned }: RackViewInput): RackView {
  const activeId = s.activeAthleteId;
  const active = findAthlete(today, activeId);
  const firstName = active?.firstName ?? 'Athlete';
  const lifting = s.setState === 'lifting' && !!s.live;

  // Which set is on screen: live, else the just-ended one of the active athlete.
  // The ended set stays on screen only while its summary is up; after that
  // the screen moves to the NEXT set (bars + dial reset, SET advances).
  const summaryUp = summaryVisible(s, nowMs);
  const shownSet: LiveSet | null = lifting
    ? s.live
    : summaryUp && s.lastEnded && s.lastEnded.athleteId === activeId
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
  // Resolved (resolveRackSet): the truthful origin — the phone only when its
  // open exercise is the pick; the rack's own resolver; a coach on the iPad.
  const resolvedPick = shownSet ? shownSet.pickedBy ?? null : local?.resolved ? pickedByOf(local.reason) : null;
  if (ctx.workoutInstanceId == null) contextSource = 'none';
  else if (resolvedPick) contextSource = resolvedPick;
  else if (shownSet) {
    const fromIpad = !!local && sameEx(local, shownSet.rawContext) && (!!ipadOwned || row == null || row.workout_instance_id == null);
    contextSource = fromIpad ? 'ipad' : 'phone';
  } else if (ipadOwned !== undefined) {
    contextSource = ipadOwned ? 'ipad' : 'phone';
  } else {
    const serverHasWorkout = row != null && (row.workout_instance_id != null || row.pending_workout_instance_id != null);
    contextSource = serverHasWorkout ? 'phone' : 'ipad';
  }
  const sourceLine =
    contextSource === 'phone'
      ? `FROM ${possessive(firstName)} PHONE`
      : contextSource === 'ipad'
        ? 'PICKED ON IPAD'
        : contextSource === 'rack'
          ? 'PICKED BY RACK'
          : 'FREE LIFT';

  const exerciseName = ex?.name ?? (ctx.workoutInstanceId ? 'Exercise' : 'Free lift');
  const setsPrescribed = ex?.sets ?? null;
  const exerciseLine = rackSetLine(exerciseName, setNumber, setsPrescribed);

  const workoutName = active
    ? (active.instances.find(i => i.workoutInstanceId === ctx.workoutInstanceId) ?? active.instances[0])?.workoutName ?? null
    : null;

  const reps = shownSet?.reps ?? [];
  const full = reps.filter(r => !r.partial);
  const bestV = full.length ? Math.max(...full.map(r => r.v)) : null;
  const lastFull = full[full.length - 1];
  // Without a zone there is no drop rule: SPEED DROP reads "—" (like the bars and the cue).
  const dropPct = zone ? lastFull?.dropPct ?? null : null;
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
  if (summaryUp && ended && ended.endedBy && ended.endedAtMs != null) {
    const expiresAtMs = summaryExpiry(ended);
    {
      const efull = ended.reps.filter(r => !r.partial);
      const ebest = efull.length ? Math.max(...efull.map(r => r.v)) : null;
      const eavg = efull.length ? efull.reduce((a, r) => a + r.v, 0) / efull.length : null;
      const elast = efull[efull.length - 1];
      const n = ended.context.setNumber;
      const what = ended.free ? 'REPS SAVED' : n != null ? `SET ${n} SAVED` : 'SET SAVED';
      const lb = ended.context.loadLb;
      const sw = setWatts(lb, ended.reps);
      const moveUntilMs = ended.endedAtMs + MOVE_WINDOW_MS;
      const nextUp = s.queue.find(id => id !== ended.athleteId);
      const nextName = nextUp ? findAthlete(today, nextUp)?.firstName ?? 'next athlete' : null;
      summary = {
        title: `${what} · ${END_LABEL[ended.endedBy]}`,
        // Reps before weight (owner): "5 reps × 205 lb".
        big: lb != null ? `${efull.length} rep${efull.length === 1 ? '' : 's'} × ${lb} lb` : `${efull.length} rep${efull.length === 1 ? '' : 's'}`,
        avg: fmtV(eavg),
        best: fmtV(ebest),
        drop: ended.zone && elast?.dropPct != null ? `${elast.dropPct}%` : '—',
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
        avgW: sw.avgW != null ? String(sw.avgW) : null,
        peakW: sw.peakW != null ? String(sw.peakW) : null,
        canMove: nowMs < moveUntilMs,
        moveUntilMs,
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
    // The phone's REPS for this exact exercise + set when it holds one, else the prescription.
    repsTarget: phoneRepsFor(row, ctx.routineExerciseId, setNumber) ?? ex?.repsTarget ?? null,
    exerciseLine,
    sourceLine,
    contextSource,
    routineExerciseId: ctx.routineExerciseId,
    loadLb,
    // Unresolved % load: BAR shows "—" with the prescription as its caption ("90% of set 1").
    loadNote: loadLb == null && ex ? percentLoadText(percentWeightTarget(ex, setNumber)) : null,
    powerAvailable: hasLoad(loadLb),
    lastSetMove: lastSetMoveOf(s, today, nowMs),
    needsPick: !!activeId && !lifting && ctx.workoutInstanceId == null && (active?.remaining.length ?? 0) > 0,
    zone,
    dropStopPct,
    bars: repBars(reps, setKey, loadLb),
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
    exercises: active?.exercises ?? [],
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

/** The card's exercise pill: "Romanian Deadlift · Set 1 of 3" → name + "Set 1 of 3" (the set part never truncates). */
export function pillParts(label: string): { name: string; set: string | null } {
  const i = label.lastIndexOf(' · Set ');
  return i < 0 ? { name: label, set: null } : { name: label.slice(0, i), set: label.slice(i + 3) };
}

/** The phone's REPS for (exercise, set) from the row (rack_set_phone_context p_reps_target), else null. */
export function phoneRepsFor(
  row: Pick<RackContext, never> & { reps_target?: number | null; reps_target_routine_exercise_id?: string | null; reps_target_set_number?: number | null } | null | undefined,
  routineExerciseId: string | null,
  setNumber: number | null,
): number | null {
  if (!row || row.reps_target == null || !routineExerciseId || setNumber == null) return null;
  if (row.reps_target_routine_exercise_id !== routineExerciseId || row.reps_target_set_number !== setNumber) return null;
  const n = Number(row.reps_target);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A % weight target as the coach wrote it: "90% of set 1", "80% of max" (null = none). */
export function percentLoadText(t: { percent?: number | null; relative_to?: string | null; reference_set?: number | null } | null | undefined): string | null {
  if (!t || t.percent == null) return null;
  return t.relative_to === 'set' && t.reference_set != null ? `${t.percent}% of set ${t.reference_set}` : `${t.percent}% of max`;
}
