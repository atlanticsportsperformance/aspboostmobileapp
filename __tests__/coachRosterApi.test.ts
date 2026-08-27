import {
  runwayDays, daysSinceLog, runwayChip, activityChip, isNotLogging, sortNeedsAttention, sortAlpha,
  groupDayWorkouts, splitName, NOT_LOGGING_STALE_DAYS, NOT_LOGGING_WINDOW_DAYS,
} from '../lib/coachRosterApi';

const now = new Date(2026, 7, 27, 12);
const cat = (days: number | null, count = days === null ? 0 : 5, last: string | null = days === null ? null : '2026-08-20') =>
  ({ last_workout_date: last, days_until_next: days, next_workout_date: null, workout_count: count });
const ath = (name: string, sc: any, th: any, hi: any, logged: string | null, hasRecent?: boolean) => ({
  athlete_id: name, athlete_name: name, last_completed_at: null, last_logged_at: logged,
  workouts: { strength_conditioning: sc, throwing: th, hitting: hi },
  ...(hasRecent === undefined ? {} : { has_recent_scheduled_work: hasRecent }),
});

describe('runway', () => {
  it('is the smallest non-null days_until_next', () => {
    expect(runwayDays(ath('a', cat(12), cat(3), cat(null), null))).toBe(3);
    expect(runwayDays(ath('a', cat(null), cat(null), cat(null), null))).toBeNull();
  });
  it('chips: out / n left / none / never', () => {
    expect(runwayChip(ath('a', cat(-2), cat(null), cat(null), null))).toEqual({ text: 'Out of programming', tone: 'red' });
    expect(runwayChip(ath('a', cat(5), cat(null), cat(null), null))).toEqual({ text: '5d left', tone: 'amber' });
    expect(runwayChip(ath('a', cat(20), cat(null), cat(null), null))).toBeNull();
    expect(runwayChip(ath('a', cat(null), cat(null), cat(null), null))).toEqual({ text: 'Never programmed', tone: 'grey' });
  });
});

describe('activity', () => {
  it('days since log, and chips', () => {
    expect(daysSinceLog(ath('a', cat(1), cat(null), cat(null), '2026-08-17T10:00:00.000Z'), now)).toBe(10);
    expect(activityChip(ath('a', cat(1), cat(null), cat(null), '2026-08-17T10:00:00.000Z'), now)).toEqual({ text: 'No logs 10d', tone: 'amber' });
    expect(activityChip(ath('a', cat(1), cat(null), cat(null), '2026-08-01T10:00:00.000Z'), now)).toEqual({ text: 'No logs 26d', tone: 'grey' });
    expect(activityChip(ath('a', cat(1), cat(null), cat(null), null), now)).toEqual({ text: 'No logs', tone: 'grey' });
    expect(activityChip(ath('a', cat(1), cat(null), cat(null), '2026-08-25T10:00:00.000Z'), now)).toBeNull();
  });
  it('not logging = had work in the window AND stale/never (fallback heuristic, field absent)', () => {
    expect(NOT_LOGGING_STALE_DAYS).toBe(7);
    expect(NOT_LOGGING_WINDOW_DAYS).toBe(14);
    const recentWork = cat(3, 5, '2026-08-30');
    expect(isNotLogging(ath('a', recentWork, cat(null), cat(null), null), now)).toBe(true);
    expect(isNotLogging(ath('a', recentWork, cat(null), cat(null), '2026-08-10T00:00:00.000Z'), now)).toBe(true);
    expect(isNotLogging(ath('a', recentWork, cat(null), cat(null), '2026-08-24T00:00:00.000Z'), now)).toBe(false);
    // no scheduled work in the last 14 days → belongs on the runway list, not here
    expect(isNotLogging(ath('a', cat(-40, 5, '2026-07-18'), cat(null), cat(null), null), now)).toBe(false);
  });
  it('not logging = server-provided has_recent_scheduled_work is authoritative when present', () => {
    // R4: days_until_next 20 (far future programming) but the server says nothing was
    // actually scheduled in the last 14 days → NOT "not logging", even though the old
    // heuristic (days_until_next >= -14) would have said yes.
    expect(isNotLogging(ath('a', cat(20), cat(null), cat(null), null, false), now)).toBe(false);
    // Server says recent work WAS scheduled, and logs are stale/never → not logging.
    expect(isNotLogging(ath('a', cat(20), cat(null), cat(null), null, true), now)).toBe(true);
    expect(isNotLogging(ath('a', cat(20), cat(null), cat(null), '2026-08-24T00:00:00.000Z', true), now)).toBe(false);
  });
});

describe('sorting', () => {
  it('needs attention: never-programmed first, then shortest runway, then longest silence', () => {
    const list = [
      ath('c', cat(10), cat(null), cat(null), '2026-08-26T00:00:00.000Z'),
      ath('a', cat(null), cat(null), cat(null), null),
      ath('b', cat(2), cat(null), cat(null), '2026-08-01T00:00:00.000Z'),
      ath('d', cat(2), cat(null), cat(null), '2026-08-20T00:00:00.000Z'),
    ];
    expect(sortNeedsAttention(list, now).map((a) => a.athlete_id)).toEqual(['a', 'b', 'd', 'c']);
  });
  it('A–Z by last name then first', () => {
    const list = [ath('Zed Adams', cat(1), cat(null), cat(null), null), ath('Amy Brown', cat(1), cat(null), cat(null), null), ath('Bob Adams', cat(1), cat(null), cat(null), null)];
    expect(sortAlpha(list).map((a) => a.athlete_name)).toEqual(['Bob Adams', 'Zed Adams', 'Amy Brown']);
    expect(splitName('Mary Jo Smith')).toEqual({ first: 'Mary Jo', last: 'Smith' });
  });
});

describe('groupDayWorkouts', () => {
  const w = (id: string, category: string, name: string) => ({ id, workouts: { category, name } });
  it('11. two categories on one day → two groups in fixed order', () => {
    const g = groupDayWorkouts([w('1', 'hitting', 'H'), w('2', 'strength_conditioning', 'S')]);
    expect(g.map((x) => x.category)).toEqual(['strength_conditioning', 'hitting']);
  });
  it('12. same category, same name → stable by id; shuffled input gives the same result', () => {
    const a = groupDayWorkouts([w('9', 'throwing', 'Bullpen'), w('2', 'throwing', 'Bullpen'), w('5', 'throwing', 'Arm care')]);
    const b = groupDayWorkouts([w('5', 'throwing', 'Arm care'), w('2', 'throwing', 'Bullpen'), w('9', 'throwing', 'Bullpen')]);
    expect(a).toEqual(b);
    expect(a[0].items.map((i) => i.id)).toEqual(['5', '2', '9']);
  });
});
