/**
 * pitchColors — shared pitch-type color + abbreviation helpers for the ACDL
 * league SVG plots. Colors are the app's standard pitch palette (ported from
 * components/dashboard/PitchingCard.tsx) with the four the mockup leans on:
 *   FF #C33B3B · SL #FFC533 · CB #79b6ce · CH #2e8720.
 */

/** Standardized pitch-type hex colors (matches PitchingCard.PITCH_COLORS). */
export const PITCH_COLORS: Record<string, string> = {
  Fastball: '#C33B3B',
  FF: '#C33B3B',
  FA: '#C33B3B',
  Sinker: '#E86A33',
  SI: '#E86A33',
  FT: '#E86A33',
  Cutter: '#8B4513',
  FC: '#8B4513',
  Curveball: '#79b6ce',
  CB: '#79b6ce',
  CU: '#79b6ce',
  Slider: '#FFC533',
  SL: '#FFC533',
  Sweeper: '#D4AF37',
  SW: '#D4AF37',
  Slurve: '#9932CC',
  SV: '#9932CC',
  Changeup: '#2e8720',
  CH: '#2e8720',
  Splitter: '#00CED1',
  FS: '#00CED1',
  SF: '#00CED1',
  Knuckleball: '#9932CC',
  KN: '#9932CC',
  Eephus: '#FF69B4',
  Unknown: '#808080',
};

/** Resolve any pitch-type string (db name or abbrev) to a hex color. */
export function getPitchColor(pitchType?: string | null): string {
  if (!pitchType) return PITCH_COLORS.Unknown;
  if (PITCH_COLORS[pitchType]) return PITCH_COLORS[pitchType];

  const lower = pitchType.toLowerCase().trim();
  if (lower.includes('four') || lower === 'ff' || lower.includes('4-seam') || lower.includes('fastball'))
    return PITCH_COLORS.Fastball;
  if (lower.includes('two') || lower === 'ft' || lower.includes('2-seam') || lower.includes('sinker') || lower === 'si')
    return PITCH_COLORS.Sinker;
  if (lower === 'fc' || lower.includes('cutter')) return PITCH_COLORS.Cutter;
  if (lower === 'sw' || lower.includes('sweeper')) return PITCH_COLORS.Sweeper;
  if (lower === 'sl' || lower.includes('slider')) return PITCH_COLORS.Slider;
  if (lower === 'sv' || lower.includes('slurve')) return PITCH_COLORS.Slurve;
  if (lower === 'cu' || lower === 'cb' || lower.includes('curve')) return PITCH_COLORS.Curveball;
  if (lower === 'ch' || lower.includes('change')) return PITCH_COLORS.Changeup;
  if (lower === 'fs' || lower === 'sf' || lower.includes('split')) return PITCH_COLORS.Splitter;
  if (lower === 'kn' || lower.includes('knuckle')) return PITCH_COLORS.Knuckleball;
  if (lower.includes('eephus')) return PITCH_COLORS.Eephus;
  return PITCH_COLORS.Unknown;
}

/** Resolve a pitch-type to a 2-letter abbreviation for legends. */
export function getPitchAbbrev(pitchType?: string | null): string {
  if (!pitchType) return '??';
  const abbrevMap: Record<string, string> = {
    Fastball: 'FF',
    Slider: 'SL',
    Curveball: 'CB',
    Changeup: 'CH',
    Cutter: 'FC',
    Sinker: 'SI',
    Splitter: 'FS',
    Sweeper: 'SW',
    Slurve: 'SV',
    Knuckleball: 'KN',
    Eephus: 'EP',
  };
  if (abbrevMap[pitchType]) return abbrevMap[pitchType];

  const knownAbbrevs = ['FF', 'FA', 'SL', 'CB', 'CU', 'CH', 'FC', 'SI', 'FT', 'FS', 'SF', 'SW', 'SV', 'KN'];
  const upper = pitchType.toUpperCase().trim();
  if (knownAbbrevs.includes(upper)) return upper;

  const lower = pitchType.toLowerCase().trim();
  if (lower.includes('four') || lower.includes('4-seam') || lower.includes('fastball')) return 'FF';
  if (lower.includes('two') || lower.includes('2-seam') || lower.includes('sinker')) return 'SI';
  if (lower.includes('cutter')) return 'FC';
  if (lower.includes('sweeper')) return 'SW';
  if (lower.includes('slider')) return 'SL';
  if (lower.includes('slurve')) return 'SV';
  if (lower.includes('curve')) return 'CB';
  if (lower.includes('change')) return 'CH';
  if (lower.includes('split')) return 'FS';
  if (lower.includes('knuckle')) return 'KN';
  if (lower.includes('eephus')) return 'EP';
  return pitchType.substring(0, 2).toUpperCase();
}

/**
 * Pitch-call → dot color (catcher-view zone plot, "colorBy: call").
 * Mirrors the mockup: strike = red, ball = green, in-play = cyan.
 */
export function getCallColor(call?: string | null): string {
  if (!call) return '#9BDDFF';
  const c = call.toLowerCase();
  if (c.includes('strike') || c === 'k' || c.includes('foul') || c.includes('swing') || c.includes('called'))
    return '#f87171';
  if (c.includes('ball') || c === 'b') return '#86EFAC';
  if (c.includes('play') || c.includes('hit') || c.includes('contact')) return '#9BDDFF';
  return '#9BDDFF';
}
