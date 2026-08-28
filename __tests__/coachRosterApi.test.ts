import {
  runwayDays, daysSinceLog, runwayChip, activityChip, isNotLogging, sortNeedsAttention, sortAlpha,
  groupDayWorkouts, splitName, NOT_LOGGING_STALE_DAYS, NOT_LOGGING_WINDOW_DAYS,
  getCoachRosterStatus, runwaySubtitle, activitySubtitle, severityTone, programmedCategories,
  categoryTile, splitCoverage, coverageReason, isMissedInstance, attentionList,
} from '../lib/coachRosterApi';
import { supabase } from '../lib/supabase';

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

// ─────────────────────────────────────────────────────────────────────────────
// Roster redesign: member filter, row copy, coverage grouping, missed instances
// ─────────────────────────────────────────────────────────────────────────────

describe('member filter', () => {
  const originalFetch = global.fetch;
  const originalGetSession = supabase.auth.getSession;
  let calledUrl = '';
  beforeEach(() => {
    calledUrl = '';
    supabase.auth.getSession = (async () => ({ data: { session: { access_token: 'test-token' } }, error: null })) as any;
    (global as any).fetch = jest.fn(async (url: string) => {
      calledUrl = url;
      return { ok: true, json: async () => ({ athletes: [], logs_unavailable: false }) } as any;
    });
  });
  afterEach(() => { (global as any).fetch = originalFetch; supabase.auth.getSession = originalGetSession; });

  it('asks for members by default — the roster is the people a coach programs for', async () => {
    await getCoachRosterStatus();
    expect(calledUrl).toContain('lifecycle=member');
    expect(calledUrl).not.toContain('lifecycle=all');
  });
  it('asks for everyone only when the All toggle is on', async () => {
    await getCoachRosterStatus({ includeAll: true });
    expect(calledUrl).toContain('lifecycle=all');
  });
  it('includeAll: false is the same as omitting it', async () => {
    await getCoachRosterStatus({ includeAll: false });
    expect(calledUrl).toContain('lifecycle=member');
  });
});

describe('roster row copy', () => {
  it('runway subtitle covers out / soon / never / healthy', () => {
    expect(runwaySubtitle(ath('a', cat(-6), cat(null), cat(null), null))).toEqual({ text: 'Out of programming', tone: 'red' });
    expect(runwaySubtitle(ath('a', cat(3), cat(null), cat(null), null))).toEqual({ text: '3 days left', tone: 'amber' });
    expect(runwaySubtitle(ath('a', cat(1), cat(null), cat(null), null))).toEqual({ text: '1 day left', tone: 'amber' });
    expect(runwaySubtitle(ath('a', cat(null), cat(null), cat(null), null))).toEqual({ text: 'Never programmed', tone: 'grey' });
  });
  it('a healthy athlete says how far out they are programmed, not nothing', () => {
    const a = ath('a', cat(20, 5, '2026-10-14'), cat(null), cat(null), null);
    expect(runwaySubtitle(a)).toEqual({ text: 'Programmed through Oct 14', tone: 'grey' });
  });
  it('falls back to a day count when the far date is missing', () => {
    const a = ath('a', cat(20, 5, null), cat(null), cat(null), null);
    expect(runwaySubtitle(a)).toEqual({ text: '20 days left', tone: 'grey' });
  });
  it('activity subtitle reads in plain language', () => {
    expect(activitySubtitle(ath('a', cat(1), cat(null), cat(null), '2026-08-27T08:00:00.000Z'), now)).toBe('Logged today');
    expect(activitySubtitle(ath('a', cat(1), cat(null), cat(null), '2026-08-26T08:00:00.000Z'), now)).toBe('Logged 1d ago');
    expect(activitySubtitle(ath('a', cat(1), cat(null), cat(null), '2026-08-16T08:00:00.000Z'), now)).toBe('No logs 11d');
    expect(activitySubtitle(ath('a', cat(1), cat(null), cat(null), null), now)).toBe('No logs');
  });
  it('severity drives the edge stripe: red out, amber inside the warn window, none beyond it', () => {
    expect(severityTone(ath('a', cat(0), cat(null), cat(null), null))).toBe('red');
    expect(severityTone(ath('a', cat(7), cat(null), cat(null), null))).toBe('amber');
    expect(severityTone(ath('a', cat(8), cat(null), cat(null), null))).toBeNull();
    expect(severityTone(ath('a', cat(null), cat(null), cat(null), null))).toBe('red');
  });
  it('category dots light only where programming exists', () => {
    const a = ath('a', cat(5), cat(null), cat(9), null);
    expect(programmedCategories(a)).toEqual(['strength_conditioning', 'hitting']);
  });
});

describe('athlete program runway tiles', () => {
  it('counts down, goes negative when overdue, and says Never when unprogrammed', () => {
    const a = ath('a', cat(3, 5, '2026-10-03'), cat(-4, 5, '2026-09-26'), cat(null), null);
    expect(categoryTile(a, 'strength_conditioning')).toEqual({ value: '3d', tone: 'amber', foot: 'thru Oct 3' });
    expect(categoryTile(a, 'throwing')).toEqual({ value: '−4d', tone: 'red', foot: 'ran out Sep 26' });
    expect(categoryTile(a, 'hitting')).toEqual({ value: 'Never', tone: 'none', foot: 'not programmed' });
  });
  it('a healthy category is neutral, not amber', () => {
    const a = ath('a', cat(30, 5, '2026-10-30'), cat(null), cat(null), null);
    expect(categoryTile(a, 'strength_conditioning')).toEqual({ value: '30d', tone: 'grey', foot: 'thru Oct 30' });
  });
});

describe('coverage grouping', () => {
  it('splits overdue from the coming week and leaves healthy athletes out', () => {
    const out = ath('out', cat(-2, 5, '2026-08-25'), cat(null), cat(null), null);
    const never = ath('never', cat(null), cat(null), cat(null), null);
    const soon = ath('soon', cat(4, 5, '2026-08-31'), cat(20, 5, '2026-09-16'), cat(20, 5, '2026-09-16'), null);
    const fine = ath('fine', cat(30, 5, '2026-09-26'), cat(30, 5, '2026-09-26'), cat(30, 5, '2026-09-26'), null);
    const { outNow, thisWeek } = splitCoverage([soon, fine, out, never], now);
    expect(outNow.map((a) => a.athlete_id)).toEqual(['never', 'out']);
    expect(thisWeek.map((a) => a.athlete_id)).toEqual(['soon']);
  });
  it('names the categories that are out rather than showing a bare number', () => {
    expect(coverageReason(ath('a', cat(-2), cat(-5), cat(30), null))).toBe('Strength, Throwing out');
    expect(coverageReason(ath('a', cat(null), cat(null), cat(null), null))).toBe('Never programmed');
    expect(coverageReason(ath('a', cat(4), cat(30), cat(30), null))).toBe('Strength');
  });
  // Not one member in the org has all three categories programmed — athletes
  // are programmed in what they actually train. Treating an untrained category
  // as a gap flagged 100% of the roster and made the tile meaningless.
  it('a category the athlete does not train is not a gap', () => {
    const pitcher = ath('pitcher', cat(30, 5, '2026-09-26'), cat(30, 5, '2026-09-26'), cat(null), null);
    expect(splitCoverage([pitcher], now)).toEqual({ outNow: [], thisWeek: [] });
    const hitterOnly = ath('hitter', cat(null), cat(null), cat(20, 5, '2026-09-16'), null);
    expect(splitCoverage([hitterOnly], now)).toEqual({ outNow: [], thisWeek: [] });
  });
  it('but a category they DO train running out still counts', () => {
    const a = ath('a', cat(-3, 5, '2026-08-24'), cat(null), cat(null), null);
    expect(splitCoverage([a], now).outNow.map((x) => x.athlete_id)).toEqual(['a']);
    expect(coverageReason(a)).toBe('Strength out');
  });
  it('an athlete with no programming anywhere is the real never-programmed case', () => {
    const a = ath('a', cat(null), cat(null), cat(null), null);
    expect(splitCoverage([a], now).outNow.map((x) => x.athlete_id)).toEqual(['a']);
  });
});

describe('missed instances', () => {
  const inst = (date: string, status: string) => ({ scheduled_date: date, status });
  it('a past day that was never opened is missed', () => {
    expect(isMissedInstance(inst('2026-08-26', 'not_started'), '2026-08-27')).toBe(true);
  });
  it('today is never missed, however it stands', () => {
    expect(isMissedInstance(inst('2026-08-27', 'not_started'), '2026-08-27')).toBe(false);
  });
  it('the future is never missed', () => {
    expect(isMissedInstance(inst('2026-08-28', 'not_started'), '2026-08-27')).toBe(false);
  });
  it('work that was started or finished is not missed', () => {
    expect(isMissedInstance(inst('2026-08-26', 'completed'), '2026-08-27')).toBe(false);
    expect(isMissedInstance(inst('2026-08-26', 'in_progress'), '2026-08-27')).toBe(false);
  });
});

describe('attentionList', () => {
  it('orders overdue, then running out, then silent — each athlete once', () => {
    const out = ath('out', cat(-2, 5, '2026-08-25'), cat(null), cat(null), '2026-08-27T00:00:00.000Z');
    const soon = ath('soon', cat(4, 5, '2026-08-31'), cat(null), cat(null), '2026-08-27T00:00:00.000Z');
    const silent = ath('silent', cat(30, 5, '2026-09-26'), cat(null), cat(null), null, true);
    const rows = attentionList([silent, soon, out], now);
    expect(rows.map((r) => r.athlete.athlete_id)).toEqual(['out', 'soon', 'silent']);
    expect(rows.map((r) => r.tone)).toEqual(['red', 'amber', 'amber']);
    expect(rows[0].reason).toBe('Strength out');
    expect(rows[2].reason).toBe('Never logged a set');
  });
  it('an athlete who is both overdue and silent appears once, as overdue', () => {
    const both = ath('both', cat(-2, 5, '2026-08-25'), cat(null), cat(null), null, true);
    const rows = attentionList([both], now);
    expect(rows).toHaveLength(1);
    expect(rows[0].tone).toBe('red');
  });
  it('respects the limit', () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((i) => ath(`a${i}`, cat(-i, 5, '2026-08-20'), cat(null), cat(null), null));
    expect(attentionList(many, now, 5)).toHaveLength(5);
  });
  it('a healthy roster produces an empty list, not a crash', () => {
    const fine = ath('fine', cat(30, 5, '2026-09-26'), cat(null), cat(null), '2026-08-27T00:00:00.000Z');
    expect(attentionList([fine], now)).toEqual([]);
  });
  it('counts days since the last log in the reason', () => {
    const silent = ath('s', cat(30, 5, '2026-09-26'), cat(null), cat(null), '2026-08-16T00:00:00.000Z', true);
    // 2026-08-16T00:00Z is Aug 15 in a western local zone — daysSinceLog counts
    // local calendar days, so this is 12, not 11.
    expect(attentionList([silent], now)[0].reason).toBe('No logs in 12 days');
  });
});
