/**
 * Rack power (watts) — our own number, from the bar load and the rep's mean
 * concentric velocity:
 *
 *   watts = round(load_lb × 0.4536 × 9.81 × mean_v)
 *
 * (load in kg × g = the bar's weight in newtons, × m/s = watts). The OVR's own
 * watts stay stored raw on vbt_reps (mean_power_w / peak_power_w) and are never
 * shown. No load (null / 0 / not a number) = no power.
 */

export const LB_TO_KG = 0.4536;
export const G = 9.81;

const ok = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** The load counts for power: a finite number above 0. */
export function hasLoad(loadLb: number | null | undefined): loadLb is number {
  return ok(loadLb) && loadLb > 0;
}

/** Watts of one rep, or null without a load / velocity. */
export function wattsOf(loadLb: number | null | undefined, meanV: number | null | undefined): number | null {
  if (!hasLoad(loadLb) || !ok(meanV) || meanV < 0) return null;
  return Math.round(loadLb * LB_TO_KG * G * meanV);
}

/** AVG W (from the set's average mean velocity) and PEAK W (from its best), full reps only. */
export function setWatts(
  loadLb: number | null | undefined,
  reps: { v: number; partial: boolean }[],
): { avgW: number | null; peakW: number | null } {
  const full = reps.filter(r => !r.partial && ok(r.v));
  if (!hasLoad(loadLb) || full.length === 0) return { avgW: null, peakW: null };
  const avg = full.reduce((a, r) => a + r.v, 0) / full.length;
  const best = Math.max(...full.map(r => r.v));
  return { avgW: wattsOf(loadLb, avg), peakW: wattsOf(loadLb, best) };
}

/** "· avg 612 W" for the phone's RACK / SENSOR line; '' without a load. */
export function avgWattsSuffix(loadLb: number | null | undefined, avgV: number | null | undefined): string {
  const w = wattsOf(loadLb, avgV);
  return w == null ? '' : ` · avg ${w} W`;
}
