import { toLocalDateKey, weekStartingMonday, addDays, isSameDay } from '../lib/coachDates';

describe('coachDates', () => {
  it('10. toLocalDateKey uses local parts, never toISOString', () => {
    expect(toLocalDateKey(new Date(2026, 8, 1))).toBe('2026-09-01');
    expect(toLocalDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('weekStartingMonday returns 7 consecutive days starting Monday', () => {
    const w = weekStartingMonday(new Date(2026, 7, 27)); // Thu 27 Aug 2026
    expect(w).toHaveLength(7);
    expect(toLocalDateKey(w[0])).toBe('2026-08-24');
    expect(w[0].getDay()).toBe(1);
    expect(isSameDay(addDays(w[0], 6), w[6])).toBe(true);
  });
});
