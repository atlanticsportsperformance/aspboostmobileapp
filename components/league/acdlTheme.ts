/**
 * acdlTheme — the ACDL brand palette for the league surfaces in the mobile app.
 *
 * Mirrors aspwebsite `app/acdl/acdl.css`:
 *   --brand      #9bddff   sky-blue accent
 *   --navy       #16181c   panel background
 *   --navy2      #0f1012   deeper panel background
 *   --brandText  #0f6fa6   deeper blue for text-on-light
 *   --on-brand   #07202c   dark text drawn ON the sky-blue accent
 *
 * These replace the old purple league accent (#a855f7) so the league section
 * reads as ACDL-branded while staying cohesive with the (dark) app shell.
 *
 * Helpers below build the translucent fills/borders the screens use so callers
 * don't re-derive rgba() strings from the hex by hand.
 */

/** Sky-blue brand accent (dots, chips, borders, eyebrows, active states). */
export const ACDL_BLUE = '#9BDDFF';
/** Deeper blue for text-on-light / pressed accents. */
export const ACDL_BLUE_DEEP = '#0f6fa6';
/** Navy panel background. */
export const ACDL_NAVY = '#16181c';
/** Deeper navy panel background. */
export const ACDL_NAVY_2 = '#0f1012';
/** White text. */
export const ACDL_WHITE = '#ffffff';
/** Dark text/ink drawn ON the sky-blue accent. */
export const ACDL_ON_ACCENT = '#07202c';

/** ACDL blue as an rgba() with the given alpha (for fills/borders/glows). */
export function acdlBlueAlpha(alpha: number): string {
  // #9BDDFF → rgb(155, 221, 255)
  return `rgba(155, 221, 255, ${alpha})`;
}

export const ACDL = {
  blue: ACDL_BLUE,
  blueDeep: ACDL_BLUE_DEEP,
  navy: ACDL_NAVY,
  navy2: ACDL_NAVY_2,
  white: ACDL_WHITE,
  onAccent: ACDL_ON_ACCENT,
} as const;
