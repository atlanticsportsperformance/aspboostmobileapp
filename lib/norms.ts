/**
 * Play-level percentile norms for the home-screen rankings.
 *
 * Anchored at P10/25/50/75/90; `percentileFor` fits a normal curve to
 * the anchors (μ = P50, σ = (P90−P10)/2.5631) so every 1–99 is reachable.
 *
 * Sources:
 *  - FB_VELO, DISTANCE: computed from our own data on 2026-11-23
 *    (trackman_pitch_data max fastball rel_speed per athlete by play_level;
 *    hittrax_swings max distance per session by play_level). Re-run the
 *    queries to refresh. A level with too few samples is left out so we
 *    never rank someone against a handful of athletes.
 *  - EXIT_VELO, BAT_SPEED: reference bands carried over from HittingSection.
 */

export type Pcts = { p10: number; p25: number; p50: number; p75: number; p90: number };
export const LEVELS = ['Youth', 'High School', 'College', 'Pro'] as const;
export type Level = (typeof LEVELS)[number];

export const FB_VELO_NORMS: Partial<Record<Level, Pcts>> = {
  Youth: { p10: 58.5, p25: 61.6, p50: 67.2, p75: 72.4, p90: 79.2 }, // n=21
  'High School': { p10: 71.9, p25: 77.0, p50: 80.2, p75: 84.4, p90: 87.9 }, // n=66
  College: { p10: 78.4, p25: 85.6, p50: 87.9, p75: 89.8, p90: 91.8 }, // n=30
  Pro: { p10: 86.5, p25: 90.3, p50: 92.2, p75: 94.8, p90: 96.1 }, // n=11
};

export const DISTANCE_NORMS: Partial<Record<Level, Pcts>> = {
  Youth: { p10: 162, p25: 189, p50: 222, p75: 263, p90: 297 }, // n=290
  'High School': { p10: 182, p25: 206, p50: 251, p75: 283, p90: 308 }, // n=150
  // College (n=1) and Pro (n=5): not enough data yet.
};

export const EXIT_VELO_NORMS: Partial<Record<Level, Pcts>> = {
  Youth: { p10: 50, p25: 58, p50: 65, p75: 72, p90: 78 },
  'High School': { p10: 70, p25: 78, p50: 85, p75: 92, p90: 98 },
  College: { p10: 85, p25: 92, p50: 97, p75: 102, p90: 107 },
  Pro: { p10: 95, p25: 100, p50: 104, p75: 108, p90: 112 },
};

export const BAT_SPEED_NORMS: Partial<Record<Level, Pcts>> = {
  Youth: { p10: 42, p25: 47, p50: 52, p75: 58, p90: 64 },
  'High School': { p10: 56, p25: 62, p50: 67, p75: 72, p90: 77 },
  College: { p10: 64, p25: 69, p50: 73, p75: 76, p90: 79 },
  Pro: { p10: 70, p25: 73, p50: 76, p75: 79, p90: 83 },
};

export function normalizePlayLevel(raw: string | null | undefined): Level | null {
  if (!raw) return null;
  const l = raw.trim().toLowerCase();
  if (!l) return null;
  if (l.includes('youth') || /\b1[0-4]u\b/.test(l) || l.includes('middle')) return 'Youth';
  if (l.includes('high') || /\bhs\b/.test(l) || /\b1[5-8]u\b/.test(l)) return 'High School';
  if (l.includes('college') || l.includes('ncaa') || l.includes('juco') || /\bd[123]\b/.test(l)) return 'College';
  if (l.includes('pro') || l.includes('milb') || l.includes('mlb') || l.includes('indy')) return 'Pro';
  return null;
}

function normalCDF(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function percentileFor(value: number, p: Pcts): number {
  const sigma = (p.p90 - p.p10) / 2.5631;
  if (!(sigma > 0)) return 50;
  return Math.max(1, Math.min(99, Math.round(normalCDF((value - p.p50) / sigma) * 100)));
}
