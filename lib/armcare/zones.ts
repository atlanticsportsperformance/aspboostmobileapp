/**
 * Threshold zones lifted from the ArmCare report glossary (page 6 of the
 * sample PDF). Used to color-code values across the iOS ArmCare surface so
 * a glance tells you Normal / Watch / Warning at a glance.
 */

export type Zone = 'normal' | 'watch' | 'warning' | 'unknown';

export const ZONE_COLORS: Record<Zone, string> = {
  normal: '#34D399',  // emerald-400
  watch: '#FBBF24',   // amber-400
  warning: '#F87171', // red-400
  unknown: '#9ca3af', // gray-400 — no data / can't compute
};

// Per-test peak as % of bodyweight.
//   IR / ER:  >=20% normal,  15-20% watch,  <15% warning
//   Scap/Grip: >=15% normal, 10-15% watch,  <10% warning
export function peakZone(
  test: 'ir' | 'er' | 'scap' | 'grip',
  peakLbf: number,
  bodyweightLbs: number,
): Zone {
  if (!bodyweightLbs || bodyweightLbs <= 0) return 'unknown';
  if (!peakLbf || peakLbf <= 0) return 'unknown';
  const pct = (peakLbf / bodyweightLbs) * 100;
  if (test === 'ir' || test === 'er') {
    if (pct >= 20) return 'normal';
    if (pct >= 15) return 'watch';
    return 'warning';
  }
  // scap or grip
  if (pct >= 15) return 'normal';
  if (pct >= 10) return 'watch';
  return 'warning';
}

// Shoulder Balance (ER:IR ratio):
//   normal: 0.85 to 1.05
//   watch:  0.70-0.84  OR  1.06-1.20
//   warning: <0.70  OR  >1.20
export function erIrZone(ratio: number | null | undefined): Zone {
  if (ratio == null || !isFinite(ratio) || ratio <= 0) return 'unknown';
  if (ratio >= 0.85 && ratio <= 1.05) return 'normal';
  if ((ratio >= 0.7 && ratio < 0.85) || (ratio > 1.05 && ratio <= 1.2)) {
    return 'watch';
  }
  return 'warning';
}

// SVR — age-banded.
//   under 15:  normal >1.3,  watch 1.1-1.3,  warning <1.1
//   15+:       normal >1.6,  watch 1.4-1.6,  warning <1.4
export function svrZone(svr: number | null | undefined, ageOver15 = true): Zone {
  if (svr == null || !isFinite(svr) || svr <= 0) return 'unknown';
  if (ageOver15) {
    if (svr >= 1.6) return 'normal';
    if (svr >= 1.4) return 'watch';
    return 'warning';
  }
  if (svr >= 1.3) return 'normal';
  if (svr >= 1.1) return 'watch';
  return 'warning';
}

// ArmScore = (top-per-test sum / bodyweight) × 100.
// Glossary calls out >70 minimum, >100 strong-arm.
//   >=70: normal (green; >=100 still green, just exceptional)
//   60-70: watch
//   <60: warning
export function armScoreZone(armScore: number | null | undefined): Zone {
  if (armScore == null || !isFinite(armScore) || armScore <= 0) return 'unknown';
  if (armScore >= 70) return 'normal';
  if (armScore >= 60) return 'watch';
  return 'warning';
}

// Total Strength as % of bodyweight.
//   >=70%: normal,  60-70%: watch,  <60%: warning
export function totalStrengthZone(
  totalLbf: number | null | undefined,
  bodyweightLbs: number | null | undefined,
): Zone {
  if (
    totalLbf == null || !isFinite(totalLbf) || totalLbf <= 0 ||
    bodyweightLbs == null || !bodyweightLbs || bodyweightLbs <= 0
  ) {
    return 'unknown';
  }
  const pct = (totalLbf / bodyweightLbs) * 100;
  if (pct >= 70) return 'normal';
  if (pct >= 60) return 'watch';
  return 'warning';
}

export function colorFor(zone: Zone): string {
  return ZONE_COLORS[zone];
}
