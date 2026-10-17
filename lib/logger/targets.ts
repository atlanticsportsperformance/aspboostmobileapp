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
      };
    }
    // Reference set not logged yet — show the percentage, no number.
    return { percent: target.percent, sourceExerciseName: `Set ${target.reference_set} (not logged yet)` };
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
