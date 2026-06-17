/**
 * leagueFormat — small formatting helpers shared by the ACDL athlete screens
 * (Phase 12.2 / 12.3). The stat views return wide, loosely-typed rows
 * (LeagueStatRow = Record<string, number|string|boolean|null>), and PostgREST
 * renders numerics as strings, so every numeric read goes through `num()`.
 */
import { LeagueStatRow, LineScore } from './acdlLeague';
import {
  ACDL_EVT_GAME,
  ACDL_EVT_PRACTICE,
  ACDL_EVT_TRAINING,
  ACDL_EVT_OTHER,
} from '../components/league/acdlTheme';

/** Coerce a LeagueStatRow cell (number | numeric-string | null) to number|null. */
export function num(v: number | string | boolean | null | undefined): number | null {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Generic fixed-decimal formatter; em-dash when null. */
export function fmt(v: number | null, decimals = 2): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toFixed(decimals);
}

/** Integer formatter; em-dash when null. */
export function fmtInt(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  return String(Math.round(v));
}

/** 3-decimal rate (AVG/OBP/SLG/wOBA) with a leading-zero strip, em-dash null. */
export function fmt3(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v.toFixed(3);
  // .342 rather than 0.342 (baseball convention) for sub-1 rates.
  return v < 1 && v >= 0 ? s.replace(/^0/, '') : s;
}

/** Percentage from a 0–1 rate; em-dash null. e.g. 0.192 → "19.2%". */
export function fmtPct(v: number | null, decimals = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(decimals)}%`;
}

/** Signed inch value (IVB/HB): +17.2 / -8.4 / em-dash. */
export function fmtSigned(v: number | null, decimals = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(decimals)}`;
}

/** ip_outs (count of outs) → "5.2" innings-pitched display. */
export function ipFromOuts(outs: number | null): string {
  if (outs == null || Number.isNaN(outs)) return '—';
  const whole = Math.floor(outs / 3);
  const rem = outs % 3;
  return `${whole}.${rem}`;
}

/** First-token / 3-letter team abbreviation for tight chips. */
export function teamAbbrev(name: string | null | undefined): string {
  if (!name) return '—';
  const first = name.trim().split(/\s+/)[0];
  return first.length <= 4 ? first : first.slice(0, 3).toUpperCase();
}

/**
 * ACDL has NO fixed teams — every game is Navy vs White, reshuffled weekly. A
 * game is shown by the athlete's SIDE for THAT game (my_team_name), not
 * home/away. This builds the matchup string both ways:
 *
 *   - withSide: when we know the athlete's side, "<MySide> vs <Opponent>"
 *     (the athlete's side first), e.g. "Navy vs White".
 *   - both: when the side is unknown (null), just "Navy vs White" using the
 *     home/away names — NEVER "Away @ Home".
 *
 * `mySide` is the SHORT label for the athlete's side badge (e.g. "NAVY"), or
 * null when unassigned.
 */
export function gameSide(g: {
  my_team_name?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
}): { mySide: string | null; opponent: string | null; matchup: string } {
  const home = g.home_team_name?.trim() || null;
  const away = g.away_team_name?.trim() || null;
  const mine = g.my_team_name?.trim() || null;

  if (mine) {
    // Opponent is whichever named side isn't the athlete's.
    const opponent =
      home && home.toLowerCase() !== mine.toLowerCase()
        ? home
        : away && away.toLowerCase() !== mine.toLowerCase()
        ? away
        : null;
    return {
      mySide: mine.toUpperCase(),
      opponent,
      matchup: opponent ? `${mine} vs ${opponent}` : mine,
    };
  }

  // No side assigned yet → show both sides (Navy vs White). Prefer the named
  // sides; fall back to the generic ACDL Navy/White labeling.
  const a = home || 'Navy';
  const b = away || 'White';
  return { mySide: null, opponent: null, matchup: `${a} vs ${b}` };
}

/**
 * Side-aware line-score string, e.g. "7–4". The canonical totals are
 * `home_total` / `away_total`. When `side` ('home' | 'away') is known, the
 * athlete's side is shown FIRST so the score order matches the matchup title
 * everywhere (Dashboard, Schedule, Game Log). When the side is unknown we keep
 * the home–away order. Returns null when no usable totals exist.
 *
 * Pass `side` from the event/game: 'home' when my_team_id === home_team_id,
 * 'away' when my_team_id === away_team_id, else null/undefined.
 */
export function formatLineScore(
  ls: LineScore | null | undefined,
  opts?: { side?: 'home' | 'away' | null }
): string | null {
  if (!ls) return null;
  const home = num(ls.home_total as number | null | undefined);
  const away = num(ls.away_total as number | null | undefined);
  if (home == null || away == null) return null;
  const side = opts?.side ?? null;
  // Athlete's side first to match the matchup title order; default home–away.
  if (side === 'away') return `${away}–${home}`;
  return `${home}–${away}`;
}

/**
 * Resolve which line_score side ('home' | 'away') is the athlete's, by matching
 * the athlete's per-game side (my_team_id, else my_team_name) against the game's
 * home/away id/name. Null when unassigned / unknown — callers then show the
 * default home–away order. Works for both LeagueEvent (has ids) and
 * LeagueGameLogRow (names only).
 */
export function lineScoreSide(g: {
  my_team_id?: string | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
  my_team_name?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
}): 'home' | 'away' | null {
  if (g.my_team_id) {
    if (g.home_team_id && g.my_team_id === g.home_team_id) return 'home';
    if (g.away_team_id && g.my_team_id === g.away_team_id) return 'away';
  }
  const mine = g.my_team_name?.trim().toLowerCase() || null;
  if (mine) {
    if (g.home_team_name?.trim().toLowerCase() === mine) return 'home';
    if (g.away_team_name?.trim().toLowerCase() === mine) return 'away';
  }
  return null;
}

/**
 * Shared per-event-type accent color + label, used by BOTH the Dashboard
 * day-cards and the Schedule cards so the two surfaces stay identical. Colors
 * are the on-theme Schedule values (named tokens in acdlTheme):
 *   game=#0f6fa6, practice=#2e7d52, training=#b07b16, assessment/other=ACDL_MUT.
 */
export function eventTypeMeta(type: string): { color: string; label: string } {
  switch (type) {
    case 'game':
      return { color: ACDL_EVT_GAME, label: 'GAME' };
    case 'practice':
      return { color: ACDL_EVT_PRACTICE, label: 'PRACTICE' };
    case 'training_day':
      return { color: ACDL_EVT_TRAINING, label: 'TRAINING' };
    case 'assessment':
      return { color: ACDL_EVT_OTHER, label: 'ASSESSMENT' };
    case 'other':
      return { color: ACDL_EVT_OTHER, label: 'OTHER' };
    default:
      return { color: ACDL_EVT_OTHER, label: (type || 'EVENT').toUpperCase() };
  }
}

/** 'YYYY-MM-DD' → "Sat Jun 12" (date-only, no TZ shift). */
export function formatGameDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** 'YYYY-MM-DD' → "Jun 12" (compact, no weekday/TZ shift). */
export function formatShortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** 'HH:MM:SS' → "5:00 PM". */
export function formatEventTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let h = Number(hStr);
  const m = mStr ?? '00';
  if (!Number.isFinite(h)) return '';
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * Hitter batting-line summary, e.g. "2-4, 2B, 2 RBI". Uses LeagueStatRow keys
 * from league_batting_lines (h, ab, b2, b3, hr, rbi, bb, k, sb).
 */
export function battingLineSummary(b: LeagueStatRow | null): string {
  if (!b) return '—';
  const h = num(b.h) ?? 0;
  const ab = num(b.ab) ?? 0;
  const parts: string[] = [`${h}-${ab}`];
  const hr = num(b.hr) ?? 0;
  const b3 = num(b.b3) ?? 0;
  const b2 = num(b.b2) ?? 0;
  if (hr > 0) parts.push(hr === 1 ? 'HR' : `${hr} HR`);
  if (b3 > 0) parts.push(b3 === 1 ? '3B' : `${b3} 3B`);
  if (b2 > 0) parts.push(b2 === 1 ? '2B' : `${b2} 2B`);
  const rbi = num(b.rbi) ?? 0;
  if (rbi > 0) parts.push(`${rbi} RBI`);
  const bb = num(b.bb) ?? 0;
  if (bb > 0) parts.push(`${bb} BB`);
  const sb = num(b.sb) ?? 0;
  if (sb > 0) parts.push(`${sb} SB`);
  return parts.join(', ');
}

/**
 * Pitcher outing-line summary, e.g. "5.0 IP, 4H, 1ER, 7K". Uses LeagueStatRow
 * keys from league_pitching_lines (ip_outs, h, earned_runs, k, bb).
 */
export function pitchingLineSummary(p: LeagueStatRow | null): string {
  if (!p) return '—';
  const ip = ipFromOuts(num(p.ip_outs));
  const h = num(p.h) ?? 0;
  const er = num(p.earned_runs) ?? 0;
  const k = num(p.k) ?? 0;
  const bb = num(p.bb) ?? 0;
  const parts = [`${ip} IP`, `${h}H`, `${er}ER`, `${k}K`];
  if (bb > 0) parts.push(`${bb}BB`);
  return parts.join(', ');
}

/** Pitch-call → human label for the every-pitch tables. */
export function callLabel(call: string | null | undefined): string {
  if (!call) return '—';
  const map: Record<string, string> = {
    called_strike: 'Called K',
    swinging_strike: 'Swing K',
    ball: 'Ball',
    foul: 'Foul',
    foul_tip: 'Foul tip',
    in_play: 'In play',
    hit_by_pitch: 'HBP',
  };
  return map[call] ?? call.replace(/_/g, ' ');
}

/** Pretty PA-result label (e.g. 'home_run' → 'HR', 'strikeout_swinging' → 'K swinging'). */
export function paResultLabel(result: string | null | undefined): string {
  if (!result) return '—';
  const map: Record<string, string> = {
    single: '1B',
    double: '2B',
    triple: '3B',
    home_run: 'HR',
    walk: 'BB',
    intentional_walk: 'IBB',
    hit_by_pitch: 'HBP',
    strikeout_swinging: 'K swinging',
    strikeout_looking: 'K looking',
    ground_out: 'Groundout',
    fly_out: 'Flyout',
    line_out: 'Lineout',
    pop_out: 'Popout',
    fielders_choice: 'FC',
    reached_on_error: 'ROE',
    sac_fly: 'Sac fly',
    sac_bunt: 'Sac bunt',
    double_play: 'DP',
  };
  return map[result] ?? result.replace(/_/g, ' ');
}

/** Result classes: did this PA end in a hit / an out? (for color cues) */
export function isHitResult(result: string | null | undefined): boolean {
  return (
    result === 'single' ||
    result === 'double' ||
    result === 'triple' ||
    result === 'home_run'
  );
}
