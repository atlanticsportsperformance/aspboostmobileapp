/** Pitch-type label + color, shared by the arsenal rows and the 3D pitch view. */
export const PITCH_TYPE_DISPLAY: Record<string, { short: string; full: string; hex: string }> = {
  Fastball: { short: 'FB', full: 'Fastball', hex: '#9BDDFF' },
  Sinker: { short: 'SI', full: 'Sinker', hex: '#7DD3FC' },
  Cutter: { short: 'CT', full: 'Cutter', hex: '#A5B4FC' },
  Slider: { short: 'SL', full: 'Slider', hex: '#FFB84D' },
  Sweeper: { short: 'SW', full: 'Sweeper', hex: '#FB923C' },
  Curveball: { short: 'CB', full: 'Curveball', hex: '#A78BFA' },
  Changeup: { short: 'CH', full: 'Changeup', hex: '#34D399' },
  Splitter: { short: 'SP', full: 'Splitter', hex: '#10B981' },
  Knuckleball: { short: 'KN', full: 'Knuckleball', hex: '#F472B6' },
  'Two-seam': { short: '2S', full: 'Two-seam', hex: '#7DD3FC' },
  'Four-seam': { short: '4S', full: 'Four-seam', hex: '#9BDDFF' },
};

export function pitchDisplay(pitchType: string) {
  if (PITCH_TYPE_DISPLAY[pitchType]) return PITCH_TYPE_DISPLAY[pitchType];
  // Case-insensitive lookup
  const ci = Object.keys(PITCH_TYPE_DISPLAY).find(
    (k) => k.toLowerCase() === pitchType.toLowerCase(),
  );
  if (ci) return PITCH_TYPE_DISPLAY[ci];
  return {
    short: pitchType.slice(0, 3).toUpperCase(),
    full: pitchType,
    hex: '#9BDDFF',
  };
}

