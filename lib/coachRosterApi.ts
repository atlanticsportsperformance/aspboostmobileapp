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

/**
 * The ONE fetch behind the roster chips and the Coverage tabs. The server
 * decides which athletes the caller may see (resolveAthleteScope); the
 * client sends no athlete ids. lifecycle=all: five athletes hold an active
 * membership while sitting at cancelled_membership, and a coach must still
 * see them.
 */
export async function getCoachRosterStatus(): Promise<{ athletes: RosterAthlete[]; logsUnavailable: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const res = await fetch(`${API_URL}/api/dashboard/plan-expirations?lifecycle=all`, {
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
