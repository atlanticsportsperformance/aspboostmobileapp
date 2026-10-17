import { lastSession, deltaText, type LogRow } from '../lib/logger/lastWeek';

const row = (inst: string, set: number, w: number | null, r: number | null, at: string, ex = 'ex-A'): LogRow => ({
  workout_instance_id: inst, exercise_id: ex, set_number: set,
  actual_weight: w, actual_reps: r, completed_at: at,
});

describe('lastSession', () => {
  it('picks most recent other instance', () => {
    const h = [
      row('old', 1, 200, 3, '2026-10-01T10:00:00Z'),
      row('mid', 1, 215, 2, '2026-10-08T10:00:00Z'),
      row('mid', 2, 195, 5, '2026-10-08T10:00:00Z'),
      row('today', 1, 999, 1, '2026-10-15T10:00:00Z'),
      row('other', 1, 500, 1, '2026-10-12T10:00:00Z', 'ex-B'),
    ];
    const s = lastSession(h, 'ex-A', 'today')!;
    expect(s.bySet).toEqual({ 1: { weight: 215, reps: 2 }, 2: { weight: 195, reps: 5 } });
  });

  it('best is heaviest then most reps', () => {
    const h = [
      row('i', 1, 200, 5, '2026-10-08T10:00:00Z'),
      row('i', 2, 215, 2, '2026-10-08T10:00:00Z'),
      row('i', 3, 215, 4, '2026-10-08T10:00:00Z'),
    ];
    expect(lastSession(h, 'ex-A', 'x')!.best).toEqual({ weight: 215, reps: 4 });
  });

  it('falls back to logged_at when completed_at is missing', () => {
    const h: LogRow[] = [
      { workout_instance_id: 'a', exercise_id: 'ex-A', set_number: 1, actual_weight: 100, actual_reps: 5, logged_at: '2026-10-01T00:00:00Z' },
      { workout_instance_id: 'b', exercise_id: 'ex-A', set_number: 1, actual_weight: 110, actual_reps: 5, logged_at: '2026-10-05T00:00:00Z' },
    ];
    expect(lastSession(h, 'ex-A', 'x')!.best!.weight).toBe(110);
  });

  it('no history → null', () => {
    expect(lastSession([], 'ex-A', 'x')).toBeNull();
    expect(lastSession([row('today', 1, 1, 1, '2026-10-15T00:00:00Z')], 'ex-A', 'today')).toBeNull();
  });
});

describe('deltaText', () => {
  it('delta formats sign', () => {
    expect(deltaText(220, 215)).toBe('+5 lb over last week');
    expect(deltaText(210, 215)).toBe('−5 lb vs last week');
    expect(deltaText(215, 215)).toBeNull();
    expect(deltaText(null, 215)).toBeNull();
    expect(deltaText(215, null)).toBeNull();
  });
});

describe('wiring', () => {
  const { readFileSync } = require('fs');
  const { join } = require('path');
  it('logger screen passes raw history rows to the exercise view', () => {
    const screen = readFileSync(join(__dirname, '../screens/WorkoutLoggerScreen.tsx'), 'utf8');
    expect(screen).toMatch(/setLastWeekRows\(/);
    expect(screen).toMatch(/lastWeekRows=\{lastWeekRows\}/);
    const view = readFileSync(join(__dirname, '../screens/exercise-detail-view.tsx'), 'utf8');
    expect(view).toMatch(/lastWeekRows\?: LogRow\[\]/);
  });
});
