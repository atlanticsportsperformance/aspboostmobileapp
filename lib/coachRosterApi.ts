import { supabase } from './supabase';
import { toLocalDateKey } from './coachDates';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

/** Thresholds for the coverage screens. Client constants, deliberately not settings. */
export const NOT_LOGGING_STALE_DAYS = 7;
export const NOT_LOGGING_WINDOW_DAYS = 14;
export const RUNWAY_WARN_DAYS = 7;

export type WorkoutType = 'strength_conditioning' | 'throwing' | 'hitting';
export const CATEGORY_ORDER: readonly WorkoutType[] = ['strength_conditioning', 'throwing', 'hitting'] as const;
export const CATEGORY_LABEL: Record<WorkoutType, string> = {
  strength_conditioning: 'S+C', throwing: 'Throwing', hitting: 'Hitting',
};
/** Full words, for anywhere the abbreviation would read as jargon. */
export const CATEGORY_NAME: Record<WorkoutType, string> = {
  strength_conditioning: 'Strength', throwing: 'Throwing', hitting: 'Hitting',
};

export interface CategoryStatus {
  last_workout_date: string | null;
  days_until_next: number | null;
  next_workout_date: string | null;
  workout_count: number;
}
export interface RosterAthlete {
  athlete_id: string;
  athlete_name: string;
  workouts: Record<WorkoutType, CategoryStatus>;
  last_logged_at: string | null;
  last_completed_at: string | null;
  groups?: any[];
  memberships?: any[];
  /** True iff an instance was scheduled in [today-14d, today]. Absent on older servers. */
  has_recent_scheduled_work?: boolean;
}

export interface RosterFetchOptions {
  /**
   * Show every athlete the caller can see, not just active members. Off by
   * default: `client_lifecycle = 'member'` is kept exactly equal to "holds an
   * active membership" by the database (migration
   * 20260828010000_lifecycle_member_invariant), so it is the honest definition
   * of the people a coach programs for. Without it the roster is ~4x longer,
   * padded with athletes who have no programming because they were never
   * meant to.
   */
  includeAll?: boolean;
}

/**
 * The ONE fetch behind the roster rows and the Coverage tabs. The server
 * decides which athletes the caller may see (resolveAthleteScope); the
 * client sends no athlete ids, only the lifecycle filter.
 */
export async function getCoachRosterStatus(
  opts?: RosterFetchOptions
): Promise<{ athletes: RosterAthlete[]; logsUnavailable: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const lifecycle = opts?.includeAll ? 'all' : 'member';
  const res = await fetch(`${API_URL}/api/dashboard/plan-expirations?lifecycle=${lifecycle}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch roster (${res.status})`);
  const data = await res.json();
  return {
    athletes: (data.athletes || []) as RosterAthlete[],
    logsUnavailable: data.logs_unavailable === true,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function runwayDays(a: RosterAthlete): number | null {
  let min: number | null = null;
  for (const t of CATEGORY_ORDER) {
    const d = a.workouts?.[t]?.days_until_next;
    if (d === null || d === undefined) continue;
    if (min === null || d < min) min = d;
  }
  return min;
}

export function daysSinceLog(a: RosterAthlete, now: Date): number | null {
  if (!a.last_logged_at) return null;
  const logged = new Date(a.last_logged_at);
  if (Number.isNaN(logged.getTime())) return null;
  // Count LOCAL calendar days, not raw elapsed ms — flooring ms is timezone-fragile
  // (a log made "10 local days ago" can be < 10*24h away in UTC terms near a DST
  // boundary or simply due to time-of-day, so it must diff calendar date keys).
  const nowKey = toLocalDateKey(now);
  const loggedKey = toLocalDateKey(logged);
  const [ny, nm, nd] = nowKey.split('-').map(Number);
  const [ly, lm, ld] = loggedKey.split('-').map(Number);
  return Math.round((Date.UTC(ny, nm - 1, nd) - Date.UTC(ly, lm - 1, ld)) / DAY_MS);
}

export function runwayChip(a: RosterAthlete): { text: string; tone: 'red' | 'amber' | 'grey' } | null {
  const r = runwayDays(a);
  if (r === null) return { text: 'Never programmed', tone: 'grey' };
  if (r <= 0) return { text: 'Out of programming', tone: 'red' };
  if (r <= RUNWAY_WARN_DAYS) return { text: `${r}d left`, tone: 'amber' };
  return null;
}

export function activityChip(a: RosterAthlete, now: Date): { text: string; tone: 'amber' | 'grey' } | null {
  const d = daysSinceLog(a, now);
  if (d === null) return { text: 'No logs', tone: 'grey' };
  if (d > NOT_LOGGING_WINDOW_DAYS) return { text: `No logs ${d}d`, tone: 'grey' };
  if (d > NOT_LOGGING_STALE_DAYS) return { text: `No logs ${d}d`, tone: 'amber' };
  return null;
}

/**
 * Any category whose scheduled programming touched the last NOT_LOGGING_WINDOW_DAYS days.
 *
 * The server now sends `has_recent_scheduled_work` (true iff an instance was
 * scheduled in [today-14d, today]) and it is authoritative whenever present —
 * the days_until_next heuristic below over-includes athletes with ongoing
 * future programming and no work actually scheduled inside the window. Fall
 * back to the heuristic only when talking to an older server that omits the
 * field.
 */
export function hadScheduledWorkInWindow(a: RosterAthlete, now: Date): boolean {
  if (typeof a.has_recent_scheduled_work === 'boolean') return a.has_recent_scheduled_work;
  for (const t of CATEGORY_ORDER) {
    const c = a.workouts?.[t];
    if (!c || c.workout_count === 0) continue;
    // days_until_next >= -window means the furthest scheduled instance is inside or after the window
    if (c.days_until_next !== null && c.days_until_next >= -NOT_LOGGING_WINDOW_DAYS) return true;
  }
  return false;
}

export function isNotLogging(a: RosterAthlete, now: Date): boolean {
  if (!hadScheduledWorkInWindow(a, now)) return false;
  const d = daysSinceLog(a, now);
  return d === null || d > NOT_LOGGING_STALE_DAYS;
}

export function sortNeedsAttention(list: RosterAthlete[], now: Date): RosterAthlete[] {
  return [...list].sort((a, b) => {
    const ra = runwayDays(a), rb = runwayDays(b);
    const ka = ra === null ? -Infinity : ra, kb = rb === null ? -Infinity : rb;
    if (ka !== kb) return ka - kb;
    const la = daysSinceLog(a, now), lb = daysSinceLog(b, now);
    const sa = la === null ? Infinity : la, sb = lb === null ? Infinity : lb;
    if (sa !== sb) return sb - sa;
    return a.athlete_name.localeCompare(b.athlete_name);
  });
}

export function splitName(athlete_name: string): { first: string; last: string } {
  const parts = athlete_name.trim().split(/\s+/);
  if (parts.length <= 1) return { first: athlete_name.trim(), last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

export function sortAlpha(list: RosterAthlete[]): RosterAthlete[] {
  return [...list].sort((a, b) => {
    const na = splitName(a.athlete_name), nb = splitName(b.athlete_name);
    return na.last.localeCompare(nb.last) || na.first.localeCompare(nb.first);
  });
}

/**
 * Same-day ordering is undefined in the database (no order column, and
 * assignment_id is NULL on every row, so plan provenance is unrecoverable).
 * Impose one stable, documented order: category → workout name → id.
 */
export function groupDayWorkouts<T extends { id: string; workouts?: { name?: string | null; category?: string | null } | null }>(
  items: T[]
): Array<{ category: string; items: T[] }> {
  const rank = (c: string | null | undefined) => {
    const i = CATEGORY_ORDER.indexOf(c as WorkoutType);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  const sorted = [...items].sort((a, b) =>
    rank(a.workouts?.category) - rank(b.workouts?.category) ||
    (a.workouts?.name || '').localeCompare(b.workouts?.name || '') ||
    a.id.localeCompare(b.id)
  );
  const groups: Array<{ category: string; items: T[] }> = [];
  for (const it of sorted) {
    const category = it.workouts?.category || 'other';
    const g = groups[groups.length - 1];
    if (g && g.category === category) g.items.push(it);
    else groups.push({ category, items: [it] });
  }
  return groups;
}

/**
 * `YYYY-MM-DD` → "Oct 14". Bare dates are parsed part-by-part, never through
 * `new Date(string)`, which reads them as UTC midnight and shifts the day back
 * for anyone west of Greenwich.
 */
export function formatBareDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** The category that runs out first — the one the runway number describes. */
function tightestCategory(a: RosterAthlete): CategoryStatus | null {
  let best: CategoryStatus | null = null;
  for (const t of CATEGORY_ORDER) {
    const c = a.workouts?.[t];
    if (!c || c.days_until_next === null || c.days_until_next === undefined) continue;
    if (!best || c.days_until_next < (best.days_until_next as number)) best = c;
  }
  return best;
}

/**
 * The roster row's first line. Unlike `runwayChip` this always says something:
 * a healthy athlete reads "Programmed through Oct 14" rather than leaving the
 * row looking unfinished.
 */
export function runwaySubtitle(a: RosterAthlete): { text: string; tone: 'red' | 'amber' | 'grey' } {
  const r = runwayDays(a);
  if (r === null) return { text: 'Never programmed', tone: 'grey' };
  if (r <= 0) return { text: 'Out of programming', tone: 'red' };
  if (r <= RUNWAY_WARN_DAYS) return { text: `${r} ${r === 1 ? 'day' : 'days'} left`, tone: 'amber' };
  const through = formatBareDate(tightestCategory(a)?.last_workout_date);
  return { text: through ? `Programmed through ${through}` : `${r} days left`, tone: 'grey' };
}

/** The roster row's second line: when this athlete last logged a set. */
export function activitySubtitle(a: RosterAthlete, now: Date): string {
  const d = daysSinceLog(a, now);
  if (d === null) return 'No logs';
  if (d === 0) return 'Logged today';
  if (d <= NOT_LOGGING_STALE_DAYS) return `Logged ${d}d ago`;
  return `No logs ${d}d`;
}

/**
 * The left edge stripe. Never-programmed counts as red here even though its
 * subtitle is grey — an athlete with no plan at all is the most urgent row on
 * the screen, and the stripe is what a coach reads while scrolling.
 */
export function severityTone(a: RosterAthlete): 'red' | 'amber' | null {
  const r = runwayDays(a);
  if (r === null || r <= 0) return 'red';
  if (r <= RUNWAY_WARN_DAYS) return 'amber';
  return null;
}

/** Categories this athlete has any programming in — the lit dots on a row. */
export function programmedCategories(a: RosterAthlete): WorkoutType[] {
  return CATEGORY_ORDER.filter((t) => (a.workouts?.[t]?.workout_count ?? 0) > 0);
}

/** One runway tile on the athlete's program screen. */
export function categoryTile(
  a: RosterAthlete,
  t: WorkoutType
): { value: string; tone: 'red' | 'amber' | 'grey' | 'none'; foot: string } {
  const c = a.workouts?.[t];
  if (!c || c.workout_count === 0 || c.days_until_next === null || !c.last_workout_date) {
    return { value: 'Never', tone: 'none', foot: 'not programmed' };
  }
  const d = c.days_until_next;
  const when = formatBareDate(c.last_workout_date) || '';
  // U+2212 MINUS, not a hyphen: it sits on the digit baseline and reads as a
  // negative number rather than a stray dash.
  if (d <= 0) return { value: `\u2212${Math.abs(d)}d`, tone: 'red', foot: `ran out ${when}` };
  return { value: `${d}d`, tone: d <= RUNWAY_WARN_DAYS ? 'amber' : 'grey', foot: `thru ${when}` };
}

/**
 * A category this athlete is actually trained in. Athletes are programmed in
 * what they do — a pitcher has no hitting block and never will. Treating an
 * untrained category as a gap flagged every member in the org, because not one
 * of them carries all three.
 */
function trainedCategories(a: RosterAthlete): WorkoutType[] {
  return CATEGORY_ORDER.filter((t) => (a.workouts?.[t]?.workout_count ?? 0) > 0);
}

/** A category they train that has nothing scheduled ahead of it any more. */
function outCategories(a: RosterAthlete): WorkoutType[] {
  return trainedCategories(a).filter((t) => {
    const c = a.workouts?.[t];
    return !!c && c.days_until_next !== null && c.days_until_next <= 0;
  });
}

/** No programming anywhere — the real never-programmed case. */
function hasNoProgramming(a: RosterAthlete): boolean {
  return trainedCategories(a).length === 0;
}

/**
 * The programming queue, split into two jobs: work that is already overdue
 * (or was never built at all) and work that runs out inside the warn window.
 * Athletes with runway in everything they train are not on this screen.
 */
export function splitCoverage(
  list: RosterAthlete[],
  now: Date
): { outNow: RosterAthlete[]; thisWeek: RosterAthlete[] } {
  const outNow: RosterAthlete[] = [];
  const thisWeek: RosterAthlete[] = [];
  for (const a of list) {
    if (hasNoProgramming(a) || outCategories(a).length > 0) { outNow.push(a); continue; }
    const r = runwayDays(a);
    if (r !== null && r <= RUNWAY_WARN_DAYS) thisWeek.push(a);
  }
  return { outNow: sortNeedsAttention(outNow, now), thisWeek: sortNeedsAttention(thisWeek, now) };
}

/** Why this athlete is on the Coverage list, named by category. */
export function coverageReason(a: RosterAthlete): string {
  if (hasNoProgramming(a)) return 'Never programmed';
  const out = outCategories(a);
  if (out.length) return `${out.map((t) => CATEGORY_NAME[t]).join(', ')} out`;
  const soon = trainedCategories(a).filter((t) => {
    const c = a.workouts?.[t];
    return !!c && c.days_until_next !== null && c.days_until_next <= RUNWAY_WARN_DAYS;
  });
  if (soon.length) return soon.map((t) => CATEGORY_NAME[t]).join(', ');
  return '';
}

/**
 * A workout scheduled before today that was never opened. This is the "not
 * following the plan" signal at the level a coach can act on — the specific
 * day, rather than an athlete-wide staleness count. Today is never missed:
 * the athlete still has the day to do it.
 */
export function isMissedInstance(
  instance: { scheduled_date: string; status: string },
  todayKey: string
): boolean {
  if (!instance.scheduled_date || instance.scheduled_date >= todayKey) return false;
  return instance.status !== 'completed' && instance.status !== 'in_progress';
}

/**
 * The few athletes a coach should look at first, for the Overview home screen:
 * overdue programming, then programming running out, then people who have
 * stopped logging. Each appears once, most urgent first, with the reason
 * already resolved so the caller only renders it.
 */
export function attentionList(
  list: RosterAthlete[],
  now: Date,
  limit = 5
): Array<{ athlete: RosterAthlete; reason: string; tone: 'red' | 'amber' }> {
  const { outNow, thisWeek } = splitCoverage(list, now);
  const seen = new Set<string>();
  const rows: Array<{ athlete: RosterAthlete; reason: string; tone: 'red' | 'amber' }> = [];

  const push = (a: RosterAthlete, reason: string, tone: 'red' | 'amber') => {
    if (seen.has(a.athlete_id) || rows.length >= limit) return;
    seen.add(a.athlete_id);
    rows.push({ athlete: a, reason, tone });
  };

  for (const a of outNow) push(a, coverageReason(a), 'red');
  for (const a of thisWeek) push(a, coverageReason(a), 'amber');
  for (const a of sortNeedsAttention(list.filter((x) => isNotLogging(x, now)), now)) {
    const d = daysSinceLog(a, now);
    push(a, d === null ? 'Never logged a set' : `No logs in ${d} days`, 'amber');
  }
  return rows;
}
