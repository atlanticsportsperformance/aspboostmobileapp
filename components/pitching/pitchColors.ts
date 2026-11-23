/** Shared pitch-type palette + normalization for the pitching screens. */

export const PITCH_COLORS: Record<string, string> = {
  Fastball: '#ef4444',
  Sinker: '#fb923c',
  Cutter: '#f472b6',
  Slider: '#a78bfa',
  Sweeper: '#c084fc',
  Curveball: '#22D3EE',
  Changeup: '#34d399',
  Splitter: '#fbbf24',
  Other: '#9ca3af',
};

/** Map a raw TrackMan tag to a canonical pitch type. 'two'/'sinker' are checked before 'fastball' so TwoSeamFastBall → Sinker. */
export function normalizePitchType(raw: string | null | undefined): string {
  if (!raw) return 'Other';
  const t = raw.trim();
  const l = t.toLowerCase();
  if (!l) return 'Other';
  if (l.includes('two') || l.includes('sinker') || l === 'si' || l === 'ft') return 'Sinker';
  if (l.includes('four') || l.includes('fastball') || l === 'ff' || l === 'fa') return 'Fastball';
  if (l.includes('cutter') || l === 'fc') return 'Cutter';
  if (l.includes('sweeper') || l === 'sw' || l === 'st') return 'Sweeper';
  if (l.includes('slider') || l === 'sl') return 'Slider';
  if (l.includes('curve') || l === 'cu' || l === 'cb' || l === 'kc') return 'Curveball';
  if (l.includes('change') || l === 'ch') return 'Changeup';
  if (l.includes('split') || l === 'fs' || l === 'sf') return 'Splitter';
  return 'Other';
}

export function pitchColor(raw: string | null | undefined): string {
  return PITCH_COLORS[normalizePitchType(raw)] ?? PITCH_COLORS.Other;
}
