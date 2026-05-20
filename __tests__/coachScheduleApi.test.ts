import { buildSessionsUrl, type CoachSession } from '../lib/coachScheduleApi';

describe('buildSessionsUrl', () => {
  it('builds a my_sessions URL for a given date + tz offset', () => {
    const url = buildSessionsUrl('https://aspboostapp.vercel.app', new Date(2026, 4, 19), -300);
    expect(url).toBe(
      'https://aspboostapp.vercel.app/api/schedule/sessions?date=2026-05-19&tz_offset=-300&my_sessions=true'
    );
  });

  it('appends category_id when provided', () => {
    const url = buildSessionsUrl('https://x.com', new Date(2026, 0, 2), 0, 'cat-1');
    expect(url).toContain('category_id=cat-1');
    expect(url).toContain('date=2026-01-02');
  });

  it('omits my_sessions when mineOnly is false (admin org-wide)', () => {
    const url = buildSessionsUrl('https://x.com', new Date(2026, 4, 19), -300, undefined, false);
    expect(url).toBe('https://x.com/api/schedule/sessions?date=2026-05-19&tz_offset=-300');
    expect(url).not.toContain('my_sessions');
  });
  it('includes my_sessions by default (coach)', () => {
    const url = buildSessionsUrl('https://x.com', new Date(2026, 4, 19), -300);
    expect(url).toContain('my_sessions=true');
  });
});
