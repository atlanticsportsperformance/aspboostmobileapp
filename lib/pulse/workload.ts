/**
 * Pulse throwing workload math — pure TS port of Driveline's formulas.
 * Source docs: pulse_integration/workloadinfo.md and scripts/workload.py
 *
 * Verified match to Pulse's displayed values at 1-decimal precision.
 *
 * No React, no Supabase — pure functions so the builder can call it per keystroke.
 */

/**
 * Acute workload kernel (today → 8 days ago). Sums to 9.0 by design, so a flat
 * 9-day history averages to the same value and produces ACWR = 1.0.
 */
export const ACUTE_KERNEL: readonly number[] = [
  1.3, 1.225, 1.15, 1.075, 1.0, 0.925, 0.85, 0.775, 0.7,
];

/** ACWR safe zone — outside this band, the coach should be warned. */
export const ACWR_SAFE_LOW = 0.7;
export const ACWR_SAFE_HIGH = 1.3;

/**
 * W_throw = (τ / (height_m × mass_kg)) ^ 1.3
 * Non-linear (exponent 1.3) because tissue stimulus is not linear with load.
 */
export function wThrow(
  torqueNm: number,
  heightM: number,
  weightKg: number,
): number {
  if (!(torqueNm > 0) || !(heightM > 0) || !(weightKg > 0)) return 0;
  return Math.pow(torqueNm / (heightM * weightKg), 1.3);
}

/** Convenience: same math but starting from imperial athletes table units. */
export function wThrowImperial(
  torqueNm: number,
  heightInches: number,
  weightLbs: number,
): number {
  return wThrow(torqueNm, heightInches * 0.0254, weightLbs * 0.453592);
}

/**
 * 9-day weighted acute workload at index `i` in `series`.
 * `series` is chronological — index 0 is oldest, index n-1 is most recent.
 *
 * Dynamic divisor:
 *   - If fewer than 7 prior throwing days exist, N ramps 3 → 9
 *   - Once ≥7 days exist, N = 9 (static)
 *
 * Returns 0 if i is out of range.
 */
export function acuteWorkload(series: readonly number[], i: number): number {
  if (i < 0 || i >= series.length) return 0;

  // How many historical days are available at this index (inclusive of today)
  const available = i + 1;
  const usable = Math.min(9, available);

  let sum = 0;
  for (let k = 0; k < usable; k++) {
    const idx = i - k; // today, 1-day ago, 2-day ago, ...
    if (idx < 0) break;
    sum += series[idx] * ACUTE_KERNEL[k];
  }

  // Dynamic divisor table (Driveline spec):
  //   day 1 → 3, day 2 → 4, ... day 7 → 9, then static 9 forever
  // "day" here means "days of throwing history available", which equals `available`
  const divisor = available < 7 ? Math.max(3, available + 2) : 9;

  return sum / divisor;
}

/**
 * 28-day unweighted chronic workload at index `i` in `series`.
 *
 * Dynamic divisor:
 *   - First 24 days: N ramps 5 → 28
 *   - After: N = 28 (static)
 */
export function chronicWorkload(series: readonly number[], i: number): number {
  if (i < 0 || i >= series.length) return 0;

  const available = i + 1;
  const usable = Math.min(28, available);

  let sum = 0;
  for (let k = 0; k < usable; k++) {
    const idx = i - k;
    if (idx < 0) break;
    sum += series[idx];
  }

  // Dynamic divisor: day 1 → 5, day 2 → 6, ..., day 24 → 28, then static 28
  const divisor = available < 24 ? Math.max(5, available + 4) : 28;

  return sum / divisor;
}

/**
 * ACWR at index `i`. Returns null when chronic is effectively zero (no history
 * to compare against — the ratio is undefined, not NaN or Infinity).
 */
export function acwr(series: readonly number[], i: number): number | null {
  const chronic = chronicWorkload(series, i);
  if (chronic <= 1e-9) return null;
  const acute = acuteWorkload(series, i);
  return acute / chronic;
}

/** ACWR → visual bucket for bar coloring. */
export type AcwrColor = 'gray' | 'blue' | 'green' | 'emerald' | 'yellow' | 'orange' | 'red';

export function acwrColor(ratio: number | null): AcwrColor {
  return acwrColorWithBand(ratio, ACWR_SAFE_LOW, ACWR_SAFE_HIGH);
}

/**
 * Color bucket for a user-defined safe band. "Safe" is green; below the low edge
 * fades to blue (undertraining); above the high edge steps through yellow/orange/red.
 * Used so coaches can loosen the band during return-to-throw phases where ACWR
 * inherently runs hot while chronic rebuilds from zero.
 */
export function acwrColorWithBand(
  ratio: number | null,
  safeLow: number,
  safeHigh: number,
): AcwrColor {
  if (ratio == null) return 'gray';
  // Round to 2-decimal precision so a tooltip showing "1.30" never colors yellow
  // because of a 1.3001 floating-point value underneath.
  const r = Math.round(ratio * 100) / 100;
  if (r < safeLow * 0.7) return 'blue';
  if (r < safeLow) return 'green';
  if (r <= safeHigh) return 'emerald';
  const overshoot = r - safeHigh;
  if (overshoot < 0.1) return 'yellow';
  if (overshoot < 0.25) return 'orange';
  return 'red';
}

/** Tailwind fill class for a color bucket (SVG-friendly). */
export const ACWR_FILL_CLASS: Record<AcwrColor, string> = {
  gray: 'fill-gray-600',
  blue: 'fill-blue-500',
  green: 'fill-emerald-500',
  emerald: 'fill-emerald-400',
  yellow: 'fill-yellow-400',
  orange: 'fill-orange-500',
  red: 'fill-red-500',
};

/** Hex equivalents (for places where tailwind classes don't apply — gradients, etc). */
export const ACWR_HEX: Record<AcwrColor, string> = {
  gray: '#4b5563',
  blue: '#3b82f6',
  green: '#10b981',
  emerald: '#34d399',
  yellow: '#facc15',
  orange: '#f97316',
  red: '#ef4444',
};

export type SimulationPoint = {
  /** 0-indexed day offset within the plan (not the virtual series). */
  dayOffset: number;
  /** Target W_day set by the coach for this day. */
  target: number;
  /** Projected W_acute on this day given all prior plan days + seed. */
  wAcute: number;
  /** Projected W_chronic on this day. */
  wChronic: number;
  /** Projected ACWR on this day (null if chronic is zero). */
  acwr: number | null;
  /** Color bucket for bar fill. */
  color: AcwrColor;
};

/**
 * Simulate a plan against a historical seed.
 *
 * `seed` — up to 28 days of real W_day history immediately preceding the plan.
 * `plan` — the plan's target W_day values (length usually 28).
 *
 * Returns one `SimulationPoint` per plan day, in order. The virtual series is
 * `[...seed, ...plan]`; for plan day `i`, metrics are computed at virtual index
 * `seed.length + i` so prior plan days feed forward into later acute/chronic.
 */
export function simulatePlan({
  seed,
  plan,
}: {
  seed: readonly number[];
  plan: readonly number[];
}): SimulationPoint[] {
  const virtual = [...seed, ...plan];
  const seedLen = seed.length;

  return plan.map((target, i) => {
    const idx = seedLen + i;
    const wAcute = acuteWorkload(virtual, idx);
    const wChronic = chronicWorkload(virtual, idx);
    const ratio =
      wChronic > 1e-9 ? wAcute / wChronic : null;
    return {
      dayOffset: i,
      target,
      wAcute,
      wChronic,
      acwr: ratio,
      color: acwrColor(ratio),
    };
  });
}

// ---------------------------------------------------------------------------
// Dual simulation — actual vs "if-plan-followed"
// ---------------------------------------------------------------------------

/**
 * One day's point in a dual simulation. Contains both:
 *  - actual* values: computed from real pulse_daily_workload (zeros for days
 *    without data). This is the athlete's real tissue-load trajectory.
 *  - target* values: computed from a virtual series where every past day with
 *    missing sensor data is filled with the plan's target. This answers
 *    "if the athlete had followed the plan exactly, where would ACWR be?"
 *
 * Both simulations share the same seed (pre-window actuals), so chronic is
 * warmed up consistently across them.
 */
export type DualSimulationPoint = {
  dayOffset: number;
  actualValue: number | null;
  targetValue: number | null;

  // "Reality" — driven by real pulse data. Null when no pulse data exists at all.
  actualAcute: number | null;
  actualChronic: number | null;
  actualAcwr: number | null;
  actualColor: AcwrColor;

  // "Plan compliance" — driven by plan targets substituting any missing actuals
  targetAcute: number | null;
  targetChronic: number | null;
  targetAcwr: number | null;
  targetColor: AcwrColor;
};

/**
 * Compute dual simulation for a time-range view.
 *
 * - `seed`: up to 28 days of real actuals immediately before the range (warms chronic)
 * - `actuals`: one entry per visible day, `null` where no sensor data exists
 * - `targets`: one entry per visible day, `null` where no plan covers that day
 *
 * Returns one point per visible day, in order.
 */
export function simulateActualVsTarget({
  seed,
  actuals,
  targets,
}: {
  seed: readonly number[];
  actuals: readonly (number | null)[];
  targets: readonly (number | null)[];
}): DualSimulationPoint[] {
  if (actuals.length !== targets.length) {
    throw new Error('simulateActualVsTarget: actuals and targets must be the same length');
  }

  // Build the two parallel series. Both start from the same seed window so
  // chronic/acute respond to the real history before the visible range begins.
  const actualSeries = [...seed, ...actuals.map((a) => a ?? 0)];
  const targetSeries = [
    ...seed,
    ...actuals.map((a, i) => (a != null ? a : targets[i] ?? 0)),
  ];
  const seedLen = seed.length;

  return actuals.map((_, i) => {
    const idx = seedLen + i;

    const aAcute = acuteWorkload(actualSeries, idx);
    const aChronic = chronicWorkload(actualSeries, idx);
    const aRatio = aChronic > 1e-9 ? aAcute / aChronic : null;

    const tAcute = acuteWorkload(targetSeries, idx);
    const tChronic = chronicWorkload(targetSeries, idx);
    const tRatio = tChronic > 1e-9 ? tAcute / tChronic : null;

    return {
      dayOffset: i,
      actualValue: actuals[i],
      targetValue: targets[i],
      actualAcute: aAcute,
      actualChronic: aChronic,
      actualAcwr: aRatio,
      actualColor: acwrColor(aRatio),
      targetAcute: tAcute,
      targetChronic: tChronic,
      targetAcwr: tRatio,
      targetColor: acwrColor(tRatio),
    };
  });
}
