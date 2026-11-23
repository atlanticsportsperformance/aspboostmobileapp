/**
 * Pure data layer for the mocap Report + Energy tabs.
 * Ports the JS of docs/mocap-redesign-v2.html (pitching) and
 * docs/mocap-redesign-hitting-v1.html (hitting).
 */
import {
  GROUPS as PITCHING_GROUPS,
  computeGroupRows,
  computeScore,
  type PercentileTable,
  type RadarGroup,
  type StrictRowData,
} from '../../../lib/mocap/percentiles';

// ─── Local structural type (the screen owner extends MocapPitchDetail) ───────

export interface ReportPitch {
  id: string;
  pitchType?: string | null;
  velocity?: number | null;
  batSpeed?: number | null;
  exitVelo?: number | null;
  pitchNumber?: number | null;
  category?: string | null;
  scalarMetrics?: Record<string, number> | null;
  eventTimes?: Record<string, number> | null;
  curves?: Record<string, (number | null)[]> | null;
  handedness?: string | null;
  playLevel?: string | null;
  sex?: string | null;
  heightM?: number | null;
  massKg?: number | null;
  cameraCount?: number | null;
  calibRmse?: number | null;
  cohortEligible?: boolean | null;
}
export interface ReportDetail {
  pitch: ReportPitch;
  videoUrl?: string | null;
  c3dUrl?: string | null;
}

// ─── Tiers (components/dashboard/athletes/force-profile/lib/zones.ts) ────────

export interface Tier {
  key: 'elite' | 'proficient' | 'developing' | 'foundation' | 'none';
  label: string;
  color: string;
  bg: string;
  note: string;
}
export const ZONES: Record<'elite' | 'proficient' | 'developing' | 'foundation', Tier> = {
  elite: { key: 'elite', label: 'ELITE', color: '#22D3EE', bg: 'rgba(34,211,238,0.10)', note: 'Elite · top quarter at this level' },
  proficient: { key: 'proficient', label: 'PROFICIENT', color: '#22C55E', bg: 'rgba(34,197,94,0.10)', note: 'Proficient · above the median' },
  developing: { key: 'developing', label: 'DEVELOPING', color: '#A6ABB5', bg: 'rgba(166,171,181,0.10)', note: 'Developing · below the median' },
  foundation: { key: 'foundation', label: 'FOUNDATION', color: '#EF4444', bg: 'rgba(239,68,68,0.10)', note: 'Foundation · priority block' },
};
export const NO_COHORT: Tier = { key: 'none', label: 'NO COHORT', color: '#4b5563', bg: 'rgba(75,85,99,0.15)', note: '' };
export const LEGEND: [Tier, string][] = [
  [ZONES.foundation, '<25'],
  [ZONES.developing, '25+'],
  [ZONES.proficient, '50+'],
  [ZONES.elite, '75+'],
];
export function zoneOf(p: number): Tier {
  return p >= 75 ? ZONES.elite : p >= 50 ? ZONES.proficient : p >= 25 ? ZONES.developing : ZONES.foundation;
}
export function zN(v: number | null | undefined): Tier {
  return v == null ? NO_COHORT : zoneOf(v);
}
export function cap(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
export function fmtN(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  return a >= 1000 ? Math.round(v).toLocaleString('en-US') : a >= 100 ? v.toFixed(0) : v.toFixed(1);
}
export function mean(a: (number | null | undefined)[]): number | null {
  const v = a.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
/** Mix a hex colour toward white (for the radar stroke: #a78bfa → #c4b5fd-ish). */
export function lighten(hex: string, k = 0.35): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return '#' + c.map((x) => Math.round(x + (255 - x) * k).toString(16).padStart(2, '0')).join('');
}
export function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// ─── Sport ───────────────────────────────────────────────────────────────────

export type Sport = 'pitching' | 'hitting';
export function sportOf(p: ReportPitch): Sport {
  return p.category === 'baseball_hitting' || p.category === 'softball_hitting' ? 'hitting' : 'pitching';
}

// ─── Hitting groups (mockup hitting-v1, same as web hitting radar) ───────────

const h = (
  key: string, axisLabel: string, unit: string, timing: string, explanation: string,
) => ({ key, percKey: key, axisLabel, unit, scoring: 'higher' as const, timing, explanation, detail: explanation });

export const HITTING_GROUPS: RadarGroup[] = [
  { title: 'Approach & Stride', metrics: [
    h('maxCogVelocity', 'Max COG Velo', 'm/s', 'Peak · pelvis proxy', 'How fast the body moves forward into the swing. More momentum drives more bat speed.'),
    h('leadKneeFlexFP', 'Lead Knee Flex at FP', 'deg', 'At foot plant', 'Lead leg bend at foot plant. Sets the stride load before the swing fires.'),
    h('leadKneeExt', 'Lead Knee Extension', 'deg', 'Foot plant → peak rotation', 'How much the front knee straightens through contact. Provides the wall to rotate against.'),
  ] },
  { title: 'Rotation & Separation', metrics: [
    h('hipShoulderSep', 'Hip-Shoulder Sep at FP', 'deg', 'At foot plant', 'Angle between hips and shoulders at foot plant. More separation = more rotational stretch.'),
    h('pelvisRotVelo', 'Pelvis Rot Velo', 'deg/s', 'Peak after foot plant', 'How fast the hips rotate. First link in the kinetic chain that drives the bat.'),
    h('trunkRotVelo', 'Torso Rot Velo', 'deg/s', 'Peak after foot plant', 'How fast the torso rotates. Second link, follows the hips and feeds the upper body.'),
  ] },
  { title: 'Posture', metrics: [
    h('torsoForwardTiltFP', 'Torso Fwd Tilt at FP', 'deg', 'At foot plant', 'Forward lean at foot plant. Establishes the swing plane for the barrel path.'),
    h('torsoLateralTiltMER', 'Torso Side Bend', 'deg', 'At peak rotation', 'Lateral lean toward the back side at peak rotation. Drives uphill barrel path.'),
    h('torsoRotationBR', 'Torso Rotation at Contact', 'deg', 'At peak rotation', 'How far the torso has rotated at peak rotation (proxy for contact).'),
  ] },
  { title: 'Bat Action', metrics: [
    h('rearElbowFlexFM', 'Rear Elbow Flex', 'deg', 'At first move', 'Back elbow bend at first move. The "slot" position before the barrel fires.'),
    h('upperArmVelo', 'Upper Arm Velo', 'deg/s', 'Peak after foot plant', 'How fast the rear upper arm rotates through the zone. Drives barrel speed.'),
    h('handSpeed', 'Hand Speed', 'm/s', 'Peak · rear hand', 'Peak speed of the rear hand through the swing.'),
    h('batSpeed', 'Bat Speed', 'mph', 'Stored bat_speed_mph', 'Peak bat speed through contact. Direct driver of exit velocity.'),
  ] },
];
export const HITTING_METRIC_KEYS = HITTING_GROUPS.flatMap((g) => g.metrics.map((m) => m.percKey));

export function groupsFor(sport: Sport): RadarGroup[] {
  return sport === 'hitting' ? HITTING_GROUPS : PITCHING_GROUPS;
}
export const SHORT: Record<Sport, string[]> = {
  pitching: ['DRIVE', 'POSTURE', 'BLOCK', 'ARM'],
  hitting: ['APPROACH', 'ROTATION', 'POSTURE', 'BAT'],
};

// ─── Curves (extractor normalized_curves, two-phase grid) ────────────────────
// 301-pt grid: anchor0@50, anchor1@150, anchor2@250 (pitching: PKH/FP/BR, verified in the mockup).
// 201-pt grid: anchors at 0/100/200 (pitching PKH/FP/BR; hitting LOAD/FP/PEAK ROT).

export interface CurveGrid {
  len: number;
  idx: [number, number, number];
  t: [number, number, number];
}
export function anchorKeys(sport: Sport): [string, string, string] {
  return sport === 'hitting' ? ['load', 'fp', 'peakRot'] : ['pkh', 'fp', 'br'];
}
export function curveGrid(p: ReportPitch, sport: Sport): CurveGrid | null {
  const C = p.curves;
  const ET = p.eventTimes;
  if (!C || !ET) return null;
  const first = Object.values(C).find((a) => Array.isArray(a) && a.length > 0);
  if (!first) return null;
  const len = first.length;
  const [k0, k1, k2] = anchorKeys(sport);
  const t0 = ET[k0], t1 = ET[k1], t2 = ET[k2];
  if (![t0, t1, t2].every((x) => typeof x === 'number' && Number.isFinite(x)) || t1 <= t0 || t2 <= t1) return null;
  const idx: [number, number, number] = len >= 301 ? [50, 150, 250] : [0, Math.round((len - 1) / 2), len - 1];
  return { len, idx, t: [t0, t1, t2] };
}
export function tOfIdx(g: CurveGrid, i: number): number {
  const [a0, a1, a2] = g.idx;
  const [t0, t1, t2] = g.t;
  return i < a1 ? t0 + ((i - a0) / (a1 - a0)) * (t1 - t0) : t1 + ((i - a1) / (a2 - a1)) * (t2 - t1);
}
export function idxOfT(g: CurveGrid, t: number): number {
  const [a0, a1, a2] = g.idx;
  const [t0, t1, t2] = g.t;
  return t < t1 ? a0 + ((t - t0) / (t1 - t0)) * (a1 - a0) : a1 + ((t - t1) / (t2 - t1)) * (a2 - a1);
}
export function curveAt(p: ReportPitch, g: CurveGrid | null, key: string, t: number | null | undefined): number | null {
  const a = p.curves?.[key];
  if (!a || !g || t == null || !Number.isFinite(t)) return null;
  const x = idxOfT(g, t);
  if (x < 0 || x > a.length - 1) return null;
  const i = Math.floor(x), j = Math.min(i + 1, a.length - 1);
  const ai = a[i], aj = a[j];
  if (ai == null || aj == null) return null;
  return ai + (aj - ai) * (x - i);
}
function curvePeakAbs(p: ReportPitch, g: CurveGrid | null, key: string, tA: number, tB: number): number | null {
  const a = p.curves?.[key];
  if (!a || !g) return null;
  let m: number | null = null;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    const t = tOfIdx(g, i);
    if (v == null || t < tA || t > tB) continue;
    m = m == null ? Math.abs(v) : Math.max(m, Math.abs(v));
  }
  return m;
}
function curveMax(p: ReportPitch, key: string): number | null {
  const a = p.curves?.[key];
  if (!a) return null;
  let m: number | null = null;
  for (const v of a) if (v != null && Number.isFinite(v)) m = m == null ? v : Math.max(m, v);
  return m;
}

// ─── Per-pitch values ────────────────────────────────────────────────────────

/** Stored scalar_metrics first; for hitting, fill gaps from the extractor curves at the stored events. */
export function metricValues(p: ReportPitch, sport: Sport): Record<string, number | null> {
  const sm: Record<string, number | null> = { ...(p.scalarMetrics || {}) };
  if (sport !== 'hitting') return sm;
  const g = curveGrid(p, sport);
  const ET = p.eventTimes || {};
  const fill = (k: string, v: number | null | undefined) => {
    if (sm[k] == null && v != null && Number.isFinite(v)) sm[k] = v;
  };
  const kFP = curveAt(p, g, 'leadKneeFlex', ET.fp);
  const kPR = curveAt(p, g, 'leadKneeFlex', ET.peakRot);
  const wEnd = ET.peakRot != null ? ET.peakRot + 0.167 : Infinity;
  fill('maxCogVelocity', curveMax(p, 'cogVelocity'));
  fill('leadKneeFlexFP', kFP);
  fill('leadKneeExt', kFP != null && kPR != null ? kFP - kPR : null);
  fill('hipShoulderSep', curveAt(p, g, 'hipShoulderSep', ET.fp));
  if (ET.fp != null) {
    fill('pelvisRotVelo', curvePeakAbs(p, g, 'pelvisRotVelo', ET.fp, wEnd));
    fill('trunkRotVelo', curvePeakAbs(p, g, 'trunkRotVelo', ET.fp, wEnd));
  }
  fill('torsoForwardTiltFP', curveAt(p, g, 'trunkForwardTilt', ET.fp));
  fill('torsoLateralTiltMER', curveAt(p, g, 'trunkLateralTilt', ET.peakRot));
  fill('rearElbowFlexFM', curveAt(p, g, 'elbowFlex', ET.fm));
  fill('batSpeed', p.batSpeed ?? null);
  return sm;
}

// ─── Scores ──────────────────────────────────────────────────────────────────

export interface ReportModel {
  sport: Sport;
  groups: RadarGroup[];
  rows: StrictRowData[][];
  groupScores: (number | null)[];
  p50Group: (number | null)[];
  composite: number | null;
  tier: Tier | null;
  scoredCount: number;
  values: Record<string, number | null>;
}
export function buildModel(p: ReportPitch, table: PercentileTable | null): ReportModel {
  const sport = sportOf(p);
  const groups = groupsFor(sport);
  const values = metricValues(p, sport);
  const rows = groups.map((g) => computeGroupRows(g, values, table));
  const groupScores = rows.map((d) => mean(d.map((r) => r.score)));
  const all = rows.flat();
  const composite = mean(all.map((r) => r.score));
  // Cohort-median athlete's group score: every metric at P50 → 'higher' 50, 'goldilocks' 100
  const p50Group = groups.map((g) =>
    mean(g.metrics.map((m) => (table?.metrics[m.percKey] ? computeScore(50, m.scoring) : null))),
  );
  return {
    sport, groups, rows, groupScores, p50Group, composite,
    tier: composite == null ? null : zoneOf(composite),
    scoredCount: all.filter((r) => r.score != null).length,
    values,
  };
}

// ─── Velocity opportunity (port of lib/biomech-report/score.ts velocityOpportunities) ─

const DRIVERS: { key: string; label: string; unit: string; eliteMedian: number; per1mph: number; inverted?: boolean }[] = [
  { key: 'maxCogVelocity', label: 'Max COG Velocity', unit: 'm/s', eliteMedian: 2.85, per1mph: 0.34 },
  { key: 'cogDeceleration', label: 'COG Deceleration', unit: 'm/s', eliteMedian: 1.6, per1mph: 0.155 },
  { key: 'pelvisRotVelo', label: 'Pelvis Rotation Velocity', unit: 'deg/s', eliteMedian: 597, per1mph: 124.1 },
  { key: 'hipShoulderSep', label: 'Hip-Shoulder Separation', unit: 'deg', eliteMedian: 30, per1mph: 3.5 },
  { key: 'torsoRotationBR', label: 'Torso Rotation at Release', unit: 'deg', eliteMedian: 111, per1mph: 5.82 },
  { key: 'leadKneeExt', label: 'Lead Knee Extension', unit: 'deg', eliteMedian: 11, per1mph: 5.25 },
  { key: 'kneeExtVelo', label: 'Peak Lead Knee Ext Velocity', unit: 'deg/s', eliteMedian: 317, per1mph: 106.1 },
  { key: 'trunkRotVelo', label: 'Torso Rotation Velocity', unit: 'deg/s', eliteMedian: 965, per1mph: 41.3 },
  { key: 'shoulderRotVelo', label: 'Shoulder IR Velocity', unit: 'deg/s', eliteMedian: 4681, per1mph: 605.6 },
  { key: 'elbowExtVelo', label: 'Elbow Extension Velocity', unit: 'deg/s', eliteMedian: 2318, per1mph: 196.8 },
];
export interface Opportunity { key: string; label: string; unit: string; value: number; target: number; mph: number }
const r1 = (x: number) => Math.round(x * 10) / 10;
export function velocityOpportunities(sm: Record<string, number | null | undefined>, max = 3): Opportunity[] {
  const out: Opportunity[] = [];
  for (const m of DRIVERS) {
    const raw = sm[m.key];
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    const v = Number(raw);
    const gap = m.inverted ? v - m.eliteMedian : m.eliteMedian - v;
    if (gap <= 0) continue;
    out.push({ key: m.key, label: m.label, unit: m.unit, value: r1(v), target: m.eliteMedian, mph: r1(Math.min(gap / m.per1mph, 3)) });
  }
  return out.sort((a, b) => b.mph - a.mph).slice(0, max);
}
