import {
  splitToday, startsInLabel, bookedPreview, countUnread, formatSessionTime, joinUrlFor,
} from '../lib/coachOverviewApi';

const at = (h: number, m = 0) => new Date(2026, 8, 30, h, m).toISOString();
const session = (h: number, opts: Partial<any> = {}) => ({
  id: `s${h}`,
  startTime: at(h),
  endTime: at(h + 1),
  status: 'scheduled',
  capacity: 10,
  currentBookings: 7,
  notes: null,
  template: { id: 't', name: `Session ${h}`, scheduling_categories: { id: 'c', name: 'Throwing', color: '#F87171' } },
  location: { id: 'l', name: 'Main Turf' },
  bookings: [],
  allBookings: [],
  ...opts,
});

describe('splitToday', () => {
  it('picks the first session that has not finished, and the rest follow it', () => {
    const now = new Date(2026, 8, 30, 7, 42);
    const { current, later } = splitToday([session(13), session(8), session(11)], now);
    expect(current?.id).toBe('s8');
    expect(later.map((s) => s.id)).toEqual(['s11', 's13']);
  });
  it('a session already under way is still the current one', () => {
    const now = new Date(2026, 8, 30, 8, 30);
    const { current, later } = splitToday([session(8), session(11)], now);
    expect(current?.id).toBe('s8');
    expect(later.map((s) => s.id)).toEqual(['s11']);
  });
  it('after the last session there is no current one and nothing later', () => {
    const now = new Date(2026, 8, 30, 22, 0);
    const { current, later } = splitToday([session(8), session(11)], now);
    expect(current).toBeNull();
    expect(later).toEqual([]);
  });
  it('an empty day is empty, not a crash', () => {
    expect(splitToday([], new Date(2026, 8, 30, 9))).toEqual({ current: null, later: [] });
  });
  it('sorts by start time regardless of the order the server sent', () => {
    const now = new Date(2026, 8, 30, 6);
    const { current, later } = splitToday([session(16), session(9), session(11)], now);
    expect(current?.id).toBe('s9');
    expect(later.map((s) => s.id)).toEqual(['s11', 's16']);
  });
});

describe('startsInLabel', () => {
  it('counts down in minutes under an hour', () => {
    expect(startsInLabel(session(8, { startTime: at(8, 30) }), new Date(2026, 8, 30, 7, 42))).toBe('Starts in 48 min');
  });
  it('counts down in hours and minutes beyond one hour', () => {
    expect(startsInLabel(session(8, { startTime: at(10, 0) }), new Date(2026, 8, 30, 7, 45))).toBe('Starts in 2h 15m');
  });
  it('drops the stray minutes on a whole hour', () => {
    expect(startsInLabel(session(8, { startTime: at(10, 0) }), new Date(2026, 8, 30, 8, 0))).toBe('Starts in 2h');
  });
  it('says a minute, not 1 min, at the boundary', () => {
    expect(startsInLabel(session(8, { startTime: at(8, 0) }), new Date(2026, 8, 30, 7, 59))).toBe('Starts in 1 min');
  });
  it('reads as in progress once it has begun', () => {
    expect(startsInLabel(session(8), new Date(2026, 8, 30, 8, 20))).toBe('In progress');
  });
  it('starting exactly now is in progress, not a zero countdown', () => {
    expect(startsInLabel(session(8), new Date(2026, 8, 30, 8, 0))).toBe('In progress');
  });
});

describe('bookedPreview', () => {
  const booking = (first: string, last: string) => ({
    id: `${first}${last}`, status: 'booked', source_type: 'x',
    athletes: { id: `${first}`, first_name: first, last_name: last, email: '' },
  });
  it('gives initials up to the cap and counts the overflow', () => {
    const s = session(8, { allBookings: [booking('Marcus', 'Reyes'), booking('Tyler', 'Donovan'), booking('Jaden', 'Cole')] });
    expect(bookedPreview(s, 2)).toEqual({ initials: ['MR', 'TD'], overflow: 1, booked: 7, capacity: 10 });
  });
  it('no overflow when everyone fits', () => {
    const s = session(8, { allBookings: [booking('Marcus', 'Reyes')] });
    expect(bookedPreview(s, 4)).toEqual({ initials: ['MR'], overflow: 0, booked: 7, capacity: 10 });
  });
  it('falls back to bookings when allBookings is empty', () => {
    const s = session(8, { allBookings: [], bookings: [booking('Ella', 'Brennan')] });
    expect(bookedPreview(s, 4).initials).toEqual(['EB']);
  });
  it('survives a booking with no athlete row', () => {
    const s = session(8, { allBookings: [{ id: 'x', status: 'booked', source_type: 'x', athletes: null }] });
    expect(bookedPreview(s, 4).initials).toEqual(['?']);
  });
});

describe('countUnread', () => {
  const me = 'me';
  const msg = (conv: string, sender: string, iso: string) => ({ conversation_id: conv, sender_id: sender, created_at: iso });
  it('counts only other people’s messages newer than my last read', () => {
    const parts = [{ conversation_id: 'a', last_read_at: '2026-09-30T10:00:00.000Z' }];
    const msgs = [
      msg('a', 'other', '2026-09-30T11:00:00.000Z'),
      msg('a', 'other', '2026-09-30T12:00:00.000Z'),
      msg('a', me, '2026-09-30T13:00:00.000Z'),
      msg('a', 'other', '2026-09-30T09:00:00.000Z'),
    ];
    expect(countUnread(parts, msgs, me)).toEqual({ messages: 2, conversations: 1 });
  });
  it('a conversation never read counts every message from others', () => {
    const parts = [{ conversation_id: 'a', last_read_at: null }];
    const msgs = [msg('a', 'other', '2026-01-01T00:00:00.000Z'), msg('a', me, '2026-01-02T00:00:00.000Z')];
    expect(countUnread(parts, msgs, me)).toEqual({ messages: 1, conversations: 1 });
  });
  it('counts conversations, not just messages', () => {
    const parts = [
      { conversation_id: 'a', last_read_at: null },
      { conversation_id: 'b', last_read_at: null },
      { conversation_id: 'c', last_read_at: null },
    ];
    const msgs = [msg('a', 'other', '2026-01-01T00:00:00.000Z'), msg('b', 'other', '2026-01-01T00:00:00.000Z'), msg('b', 'other', '2026-01-02T00:00:00.000Z')];
    expect(countUnread(parts, msgs, me)).toEqual({ messages: 3, conversations: 2 });
  });
  it('nothing waiting is zero, not null', () => {
    expect(countUnread([], [], me)).toEqual({ messages: 0, conversations: 0 });
  });
  it('ignores messages in conversations I am not part of', () => {
    const parts = [{ conversation_id: 'a', last_read_at: null }];
    expect(countUnread(parts, [msg('zzz', 'other', '2026-01-01T00:00:00.000Z')], me)).toEqual({ messages: 0, conversations: 0 });
  });
});

describe('formatSessionTime', () => {
  it('renders a wall-clock time', () => {
    expect(formatSessionTime(at(8, 30))).toMatch(/8:30/);
  });
});

describe('joinUrlFor', () => {
  const now = new Date(2026, 8, 30, 8, 15);
  const remote = (extra: Partial<any> = {}) => session(8, { is_remote: true, meeting_url: 'https://meet.google.com/abc-defg-hij', ...extra });

  it('gives the link for a remote session that has not ended', () => {
    expect(joinUrlFor(remote(), now)).toBe('https://meet.google.com/abc-defg-hij');
  });
  it('a session already under way is still joinable — that is when it is needed most', () => {
    expect(joinUrlFor(remote(), new Date(2026, 8, 30, 8, 59))).toBe('https://meet.google.com/abc-defg-hij');
  });
  it('goes away once the session has ended', () => {
    expect(joinUrlFor(remote(), new Date(2026, 8, 30, 9, 1))).toBeNull();
  });
  it('an in-person session never offers a link, even if one is set', () => {
    expect(joinUrlFor(remote({ is_remote: false }), now)).toBeNull();
  });
  it('a remote session with no link yet offers nothing to tap', () => {
    expect(joinUrlFor(remote({ meeting_url: null }), now)).toBeNull();
    expect(joinUrlFor(remote({ meeting_url: '' }), now)).toBeNull();
    expect(joinUrlFor(session(8, { is_remote: true }), now)).toBeNull();
  });
  it('only ever hands back an http(s) link', () => {
    expect(joinUrlFor(remote({ meeting_url: 'javascript:alert(1)' }), now)).toBeNull();
    expect(joinUrlFor(remote({ meeting_url: 'http://meet.example/x' }), now)).toBe('http://meet.example/x');
  });
});
