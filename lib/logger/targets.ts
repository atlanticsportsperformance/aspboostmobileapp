// Set targets for the workout logger (spec §4.3, §7). Pure: the exercise
// screen keeps the state (inputs, maxes, which sets the athlete edited) and
// asks these functions what a set's target is and which back-off sets need
// re-filling.

import type { IntensityTarget, LoggerRoutineExercise } from '../../types/logger';
import { calculateThrowingTarget, isThrowingVelocityMetric } from '../throwingConversions';

// What the athlete has typed so far, by 0-indexed set. Values arrive as
// strings from the keypad, so both are accepted.
export type LoggedSets = Record<number, Record<string, number | string | null | undefined> | undefined>;

export interface TargetArgs {
  re: LoggerRoutineExercise;
  setIndex: number;
  metric: string;
  // athlete maxes keyed exercise_id -> metric_id -> value (cross-exercise
  // targets read another exercise's max, so this stays two-level).
  maxes: Record<string, Record<string, number> | undefined>;
  logged: LoggedSets;
  // 5oz mound velocity, the fallback for throwing-velocity targets.
  moundVelocity?: number | null;
}

export interface IntensityResult {
  percent: number;
  calculatedValue?: number;
  sourceExerciseName?: string | null;
  // 1-indexed set this target is a % of ("90% of set 1"); absent for % of max.
  referenceSet?: number;
}

// Nearest 5 lb — something that goes on a bar (80% of 227 is 180, not 182).
export function roundLoad(lb: number): number {
  return Math.round(lb / 5) * 5;
}

// weight → nearest 5 lb; everything else → whole number.
function roundFor(value: number, metric: string): number {
  return metric === 'weight' ? roundLoad(value) : Math.round(value);
}

function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

// The coach's prescribed value: per-set metric_values, else the exercise's
// metric_targets. `!= null`, not truthiness — a prescribed 0 is a value.
export function prescribedValue(re: LoggerRoutineExercise, setIndex: number, metric: string): number | undefined {
  const perSet = re.set_configurations?.[setIndex]?.metric_values?.[metric];
  if (perSet != null) return perSet;
  const exerciseLevel = re.metric_targets?.[metric];
  if (exerciseLevel != null) return exerciseLevel;
  return undefined;
}

function intensityTargetFor(re: LoggerRoutineExercise, setIndex: number, metric: string): IntensityTarget | undefined {
  const targets = re.set_configurations?.[setIndex]?.intensity_targets || re.intensity_targets;
  return targets?.find((t) => t.metric === metric);
}

// 0-indexed reference set for a valid "N% of set K" target (K before this
// set), else null.
function referenceIndex(target: IntensityTarget, setIndex: number): number | null {
  if (target.relative_to !== 'set' || target.reference_set == null) return null;
  const refIdx = target.reference_set - 1; // 1-indexed → 0-indexed
  return refIdx >= 0 && refIdx < setIndex ? refIdx : null;
}

// The intensity prescription for a set + what it works out to today.
// Precedence: "% of set K" (from what was logged for set K) → % of the
// athlete's max (source exercise's max when cross-exercise; mound-velocity
// fallback for throwing velocity). null when no intensity target.
export function intensityFor(args: TargetArgs): IntensityResult | null {
  const { re, setIndex, metric, maxes, logged, moundVelocity } = args;
  const target = intensityTargetFor(re, setIndex, metric);
  if (!target) return null;

  const refIdx = referenceIndex(target, setIndex);
  if (refIdx != null) {
    const refNum = toNumber(logged[refIdx]?.[metric]);
    if (refNum != null && refNum > 0) {
      return {
        percent: target.percent,
        calculatedValue: roundFor(refNum * (target.percent / 100), metric),
        sourceExerciseName: `Set ${target.reference_set}`,
        referenceSet: target.reference_set!,
      };
    }
    // Reference set not logged yet — show the percentage, no number.
    return { percent: target.percent, sourceExerciseName: `Set ${target.reference_set}`, referenceSet: target.reference_set! };
  }

  const sourceExerciseId = target.source_exercise_id || re.exercise_id;
  const sourceMetricId = target.source_metric_id || metric;
  const maxValue = maxes[sourceExerciseId]?.[sourceMetricId] ?? null;

  if (isThrowingVelocityMetric(metric)) {
    const calculatedValue = calculateThrowingTarget(maxValue, moundVelocity ?? null, metric, target.percent);
    return calculatedValue !== null
      ? { percent: target.percent, calculatedValue, sourceExerciseName: target.source_exercise_name }
      : { percent: target.percent, sourceExerciseName: target.source_exercise_name };
  }

  if (maxValue) {
    return {
      percent: target.percent,
      calculatedValue: roundFor(maxValue * (target.percent / 100), metric),
      sourceExerciseName: target.source_exercise_name,
    };
  }
  return { percent: target.percent, sourceExerciseName: target.source_exercise_name };
}

// "90% of set 1", "70% of Back Squat max", "80% of max".
export function intensityText(t: IntensityResult): string {
  if (t.referenceSet != null) return `${t.percent}% of set ${t.referenceSet}`;
  return t.sourceExerciseName ? `${t.percent}% of ${t.sourceExerciseName} max` : `${t.percent}% of max`;
}

// The unrounded number a % target works out to (279 for 90% of 310), or
// null when it has none yet or is a throwing-velocity target.
function rawIntensityValue(args: TargetArgs): number | null {
  const { re, setIndex, metric, maxes, logged } = args;
  const target = intensityTargetFor(re, setIndex, metric);
  if (!target) return null;
  const refIdx = referenceIndex(target, setIndex);
  if (refIdx != null) {
    const ref = toNumber(logged[refIdx]?.[metric]);
    return ref != null && ref > 0 ? ref * (target.percent / 100) : null;
  }
  if (isThrowingVelocityMetric(metric)) return null;
  const max = maxes[target.source_exercise_id || re.exercise_id]?.[target.source_metric_id || metric] ?? null;
  return max ? max * (target.percent / 100) : null;
}

// Caption under the open set: "90% of set 2 · 279 → 280" (the raw number →
// what goes on the bar), "80% of max · 240" when nothing was rounded, or
// just "90% of set 2" while the reference set is not logged. null when the
// set has no % target for `metric`.
export function intensityCaptionText(args: TargetArgs): string | null {
  const t = intensityFor(args);
  if (!t) return null;
  const head = intensityText(t);
  if (t.calculatedValue == null) return head;
  const raw = rawIntensityValue(args);
  const r = raw == null ? null : Math.round(raw * 10) / 10;
  return r == null || r === t.calculatedValue
    ? `${head} · ${t.calculatedValue}`
    : `${head} · ${r} → ${t.calculatedValue}`;
}

// Placeholder for a % target that has no number yet: "90% of set 1" while
// the reference set is not logged; "80% · no max set" only for % of max with
// no max on file. null when the target resolves to a number.
export function pendingTargetText(t: IntensityResult | null): string | null {
  if (!t || t.calculatedValue != null) return null;
  return t.referenceSet != null ? intensityText(t) : `${t.percent}% · no max set`;
}

// The number a set's input should show/auto-fill: the computed intensity
// value when there is one, else the prescribed value, else null.
export function resolveTarget(args: TargetArgs): number | null {
  return intensityFor(args)?.calculatedValue ?? prescribedValue(args.re, args.setIndex, args.metric) ?? null;
}

// New values for back-off sets ("N% of set K") of `metric`, computed from
// what was logged for set K. Sets the athlete edited by hand are skipped
// (spec §7) — their own value then anchors any later set that references
// them. Earlier fills feed later ones, so chains (set 3 = 90% of set 2)
// resolve in one pass.
export function backoffFills(args: Omit<TargetArgs, 'setIndex'> & { edited: Set<number> }): Record<number, number> {
  const { re, metric, edited } = args;
  const working: LoggedSets = { ...args.logged };
  const fills: Record<number, number> = {};
  const setCount = Math.max(re.sets || 0, re.set_configurations?.length ?? 0);

  for (let i = 0; i < setCount; i++) {
    if (edited.has(i)) continue;
    const target = intensityTargetFor(re, i, metric);
    if (!target || referenceIndex(target, i) == null) continue;
    const value = intensityFor({ ...args, setIndex: i, logged: working })?.calculatedValue;
    if (value == null) continue;
    fills[i] = value;
    working[i] = { ...working[i], [metric]: value };
  }
  return fills;
}

// Is set `setIndex` (0-indexed) the reference of some later set's "% of set
// K" target? A change to such a set must re-run backoffUpdates at once —
// e.g. a stepper tap, which is not a keypad commit point.
export function isBackoffReference(re: LoggerRoutineExercise, setIndex: number): boolean {
  const setCount = Math.max(re.sets || 0, re.set_configurations?.length ?? 0);
  for (let j = setIndex + 1; j < setCount; j++) {
    const targets = re.set_configurations?.[j]?.intensity_targets || re.intensity_targets || [];
    if (targets.some((t) => referenceIndex(t, j) === setIndex)) return true;
  }
  return false;
}

// "set:metric" — the key for one input field of one set.
export const fieldKey = (setIndex: number, metric: string) => `${setIndex}:${metric}`;

export interface BackoffUpdateArgs extends Omit<TargetArgs, 'setIndex' | 'metric'> {
  metrics: string[];
  // Fields ("set:metric") the athlete changed by hand this session.
  edited: Set<string>;
  // Per field, the value back-off auto-fill last gave it (or would have, for
  // an empty field). From the previous call; {} on first look.
  expected: Record<string, number>;
  // The field the keypad is on — never changed underneath the athlete.
  active: { setIndex: number; metric: string } | null;
}

// Which already-logged back-off fields to move now that their reference set
// changed (spec §7), plus the `expected` map to pass next time. A field is
// moved only while it still holds its previous auto value (so a hand-typed
// value survives even when `edited` was lost to a remount) and is not hand-
// edited. A field skipped because the keypad is on it keeps its previous
// expected value, so it still follows its reference set on the next call.
// Empty fields are never written (their placeholder shows the target and is
// filled on completion) but their expected value is recorded. Kept fields
// anchor later sets on their actual value.
export function backoffUpdates(args: BackoffUpdateArgs): {
  apply: Array<{ setIndex: number; metric: string; value: number }>;
  expected: Record<string, number>;
} {
  const { re, metrics, edited, expected: prevExpected, active } = args;
  const setCount = Math.max(re.sets || 0, re.set_configurations?.length ?? 0);
  const apply: Array<{ setIndex: number; metric: string; value: number }> = [];
  const expected: Record<string, number> = {};

  for (const metric of metrics) {
    const working: LoggedSets = { ...args.logged };
    for (let i = 0; i < setCount; i++) {
      const key = fieldKey(i, metric);
      if (edited.has(key)) continue;
      const target = intensityTargetFor(re, i, metric);
      if (!target || referenceIndex(target, i) == null) continue;
      const value = intensityFor({ ...args, setIndex: i, metric, logged: working })?.calculatedValue;
      if (value == null) continue;

      const current = toNumber(working[i]?.[metric]);
      if (current == null || current === value) {
        expected[key] = value;
        continue;
      }
      if (current !== prevExpected[key]) continue; // the athlete's own value
      if (active && active.setIndex === i && active.metric === metric) {
        expected[key] = prevExpected[key]; // reconcile once the keypad leaves
        continue;
      }
      apply.push({ setIndex: i, metric, value });
      expected[key] = value;
      working[i] = { ...working[i], [metric]: value };
    }
  }
  return { apply, expected };
}

// Does the coach prescribe this set's `metric` itself (per-set or exercise-
// level value, or any intensity target: % of max or % of an earlier set)?
export function hasOwnTarget(re: LoggerRoutineExercise, setIndex: number, metric: string): boolean {
  return prescribedValue(re, setIndex, metric) !== undefined || intensityTargetFor(re, setIndex, metric) !== undefined;
}

const isEmpty = (v: unknown) => v == null || v === '';

export interface CarryArgs extends Omit<TargetArgs, 'setIndex' | 'metric'> {
  // The set being moved to (0-indexed) and the set just logged.
  nextSetIndex: number;
  prev: Record<string, unknown>;
}

// "Next Set →" on straight sets: what to pre-fill in the next set. Copies the
// set just logged ONLY for fields the next set has no target of its own for —
// a prescribed value (5/3/1 waves) or a % of max shows as the placeholder and
// fills on Log Set. Back-off fields ("90% of set 1") take their backoffFills
// value. Measured values (throwing velocity) are never copied, and a value
// already in the next set is never overwritten.
export function nextSetPrefill(args: CarryArgs): Record<string, unknown> {
  const { re, nextSetIndex, prev } = args;
  const current = args.logged[nextSetIndex] || {};
  const out: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(prev)) {
    if (field === 'notes' || isEmpty(value)) continue;
    if (isThrowingVelocityMetric(field)) continue;
    if (hasOwnTarget(re, nextSetIndex, field)) continue;
    if (!isEmpty(current[field])) continue;
    out[field] = value;
  }

  const targets = re.set_configurations?.[nextSetIndex]?.intensity_targets || re.intensity_targets || [];
  for (const t of targets) {
    if (referenceIndex(t, nextSetIndex) == null || !isEmpty(current[t.metric])) continue;
    // Earlier sets anchor on what was actually logged, so only this set is computed.
    const others = new Set<number>();
    for (let i = 0; i < Math.max(re.sets || 0, re.set_configurations?.length ?? 0); i++) if (i !== nextSetIndex) others.add(i);
    const fill = backoffFills({ ...args, metric: t.metric, edited: others })[nextSetIndex];
    if (fill != null) out[t.metric] = fill;
  }
  return out;
}

// Overview hint: the athlete has to type a weight for this set — the exercise
// tracks weight (`fields` from metricFieldsFor), nothing is typed yet, and
// there is no prescribed weight or % target that works out to a number.
export function needsWeightEntry(args: Omit<TargetArgs, 'metric'> & { fields: string[] }): boolean {
  if (!args.fields.includes('weight')) return false;
  if (!isEmpty(args.logged[args.setIndex]?.weight)) return false;
  return resolveTarget({ ...args, metric: 'weight' }) == null;
}
