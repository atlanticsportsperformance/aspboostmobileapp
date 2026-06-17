/**
 * acdlTheme — the ACDL brand palette for the league surfaces in the mobile app.
 *
 * Mirrors the actual ACDL website (aspwebsite `app/acdl/acdl.css`): a LIGHT,
 * CREAM / off-white look with navy ink and sky-blue accents — visually distinct
 * from the dark performance app. The league pages are meant to feel like the
 * public ACDL site, NOT the dark "Data Lab" shell.
 *
 * Tokens (verbatim from acdl.css :root):
 *   CREAM      #f5efe2   page background
 *   CREAM_2    #ece4d2   alt surface
 *   PAPER      #fbf7ee   cards
 *   NAVY/INK   #16181c   primary text + "band" backgrounds
 *   INK_2      #4a4f57   secondary text
 *   MUT        #867f71   muted text
 *   BRAND      #9bddff   sky-blue accent (fills, pips, active)
 *   BRAND_2    #7fcdf2   pressed/hover accent
 *   BRAND_TEXT #0f6fa6   deeper blue for links / eyebrows on light
 *   ON_BRAND   #07202c   text drawn ON a sky-blue fill
 *   LINE       rgba(22,24,28,.13)  hairline border on cream
 *
 * Idioms to mirror: eyebrow labels = BRAND_TEXT, uppercase, letter-spaced;
 * big bold headers in NAVY; cream cards with thin navy hairline borders; navy
 * "band" strips (navy bg, cream text); blue pill buttons with ON_BRAND text.
 * Numbers stay tabular/bold.
 *
 * NOTE: the old dark-only constants (ACDL_NAVY as a *panel* bg, ACDL_WHITE)
 * are kept as aliases so nothing breaks, but on the league pages NAVY is now a
 * text/ink color (and the "band" background), not a card surface.
 */

// ── cream / paper surfaces ──
export const ACDL_CREAM = '#f5efe2';
export const ACDL_CREAM_2 = '#ece4d2';
export const ACDL_PAPER = '#fbf7ee';

// ── ink / text ──
export const ACDL_NAVY = '#16181c'; // also the "band" background
export const ACDL_INK = '#16181c';
export const ACDL_INK_2 = '#4a4f57';
export const ACDL_MUT = '#867f71';

// ── brand (sky-blue) ──
export const ACDL_BLUE = '#9bddff';
export const ACDL_BLUE_2 = '#7fcdf2';
/** Deeper blue for eyebrows / links / text-on-light. */
export const ACDL_BLUE_DEEP = '#0f6fa6';
export const ACDL_BRAND_TEXT = '#0f6fa6';
/** Dark text drawn ON the sky-blue accent fill. */
export const ACDL_ON_ACCENT = '#07202c';
export const ACDL_ON_BRAND = '#07202c';

// ── lines ──
export const ACDL_LINE = 'rgba(22, 24, 28, 0.13)';
export const ACDL_LINE_2 = 'rgba(22, 24, 28, 0.07)';

// ── cream text on the navy band ──
export const ACDL_BAND_TEXT = '#f5efe2';
export const ACDL_BAND_MUT = '#9fb0c8';

// ── status (kept calm + on-theme) ──
export const ACDL_WIN = '#2e7d52';
export const ACDL_LOSS = '#b4453a';

// ── LIVE badge (website idiom) — navy pill, cream text, small green dot ──
export const ACDL_LIVE_BG = ACDL_NAVY; // navy band background
export const ACDL_LIVE_TEXT = ACDL_CREAM; // cream text on navy
export const ACDL_LIVE_DOT = '#4fd596'; // small live-pulse dot (green)

// ── event-type accents (shared by Dashboard day-cards + Schedule) ──
export const ACDL_EVT_GAME = '#0f6fa6'; // deep brand blue
export const ACDL_EVT_PRACTICE = '#2e7d52'; // green
export const ACDL_EVT_TRAINING = '#b07b16'; // amber
export const ACDL_EVT_OTHER = ACDL_MUT; // muted ink (assessment/other)

/** Legacy alias (was a deeper navy panel bg). */
export const ACDL_NAVY_2 = '#0f1012';
/** Legacy alias. */
export const ACDL_WHITE = '#ffffff';

/** ACDL blue as an rgba() with the given alpha (for fills/borders/glows). */
export function acdlBlueAlpha(alpha: number): string {
  // #9bddff → rgb(155, 221, 255)
  return `rgba(155, 221, 255, ${alpha})`;
}

/** Navy/ink as an rgba() with the given alpha (hairlines / subtle fills on cream). */
export function acdlInkAlpha(alpha: number): string {
  // #16181c → rgb(22, 24, 28)
  return `rgba(22, 24, 28, ${alpha})`;
}

export const ACDL = {
  cream: ACDL_CREAM,
  cream2: ACDL_CREAM_2,
  paper: ACDL_PAPER,
  navy: ACDL_NAVY,
  ink: ACDL_INK,
  ink2: ACDL_INK_2,
  mut: ACDL_MUT,
  blue: ACDL_BLUE,
  blue2: ACDL_BLUE_2,
  blueDeep: ACDL_BLUE_DEEP,
  brandText: ACDL_BRAND_TEXT,
  onAccent: ACDL_ON_ACCENT,
  onBrand: ACDL_ON_BRAND,
  line: ACDL_LINE,
  line2: ACDL_LINE_2,
  bandText: ACDL_BAND_TEXT,
  bandMut: ACDL_BAND_MUT,
  win: ACDL_WIN,
  loss: ACDL_LOSS,
  white: ACDL_WHITE,
  liveBg: ACDL_LIVE_BG,
  liveText: ACDL_LIVE_TEXT,
  liveDot: ACDL_LIVE_DOT,
  evtGame: ACDL_EVT_GAME,
  evtPractice: ACDL_EVT_PRACTICE,
  evtTraining: ACDL_EVT_TRAINING,
  evtOther: ACDL_EVT_OTHER,
} as const;
