import { readFileSync } from 'fs';
import { join } from 'path';
import { getUnreadMessagesCount } from '../lib/unreadMessages';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** Minimal chainable supabase double. */
function makeClient(participants: any[], counts: Record<string, number>) {
  const calls: any[] = [];
  return {
    calls,
    from(table: string) {
      if (table === 'conversation_participants') {
        const q: any = {
          select: () => q,
          eq: () => q,
          then: (res: any) => res({ data: participants, error: null }),
        };
        return q;
      }
      const state: any = { table, filters: {} };
      const q: any = {
        select: (_c: string, _o: any) => q,
        eq: (k: string, v: any) => {
          state.filters[k] = v;
          return q;
        },
        neq: (k: string, v: any) => {
          state.filters['neq:' + k] = v;
          return q;
        },
        gt: (k: string, v: any) => {
          state.filters['gt:' + k] = v;
          return q;
        },
        then: (res: any) => {
          calls.push(state);
          return res({ count: counts[state.filters.conversation_id] ?? 0 });
        },
      };
      return q;
    },
  } as any;
}

describe('getUnreadMessagesCount', () => {
  it('sums per-conversation counts', async () => {
    const client = makeClient(
      [
        { conversation_id: 'c1', last_read_at: '2026-01-01T00:00:00Z' },
        { conversation_id: 'c2', last_read_at: null },
      ],
      { c1: 3, c2: 4 }
    );
    expect(await getUnreadMessagesCount('u1', client)).toBe(7);
  });

  it('filters out the user\'s own messages, deleted rows, and messages already read', async () => {
    const client = makeClient([{ conversation_id: 'c1', last_read_at: '2026-01-01T00:00:00Z' }], { c1: 1 });
    await getUnreadMessagesCount('u1', client);
    expect(client.calls[0].filters).toEqual({
      conversation_id: 'c1',
      is_deleted: false,
      'neq:sender_id': 'u1',
      'gt:created_at': '2026-01-01T00:00:00Z',
    });
  });

  it('defaults last_read_at to the epoch', async () => {
    const client = makeClient([{ conversation_id: 'c1', last_read_at: null }], { c1: 1 });
    await getUnreadMessagesCount('u1', client);
    expect(client.calls[0].filters['gt:created_at']).toBe('1970-01-01');
  });

  it('returns 0 with no userId, no participants, or a query error', async () => {
    expect(await getUnreadMessagesCount('', makeClient([], {}))).toBe(0);
    expect(await getUnreadMessagesCount('u1', makeClient([], {}))).toBe(0);
    const broken: any = {
      from: () => {
        const q: any = {
          select: () => q,
          eq: () => q,
          then: (res: any) => res({ data: null, error: { message: 'nope' } }),
        };
        return q;
      },
    };
    expect(await getUnreadMessagesCount('u1', broken)).toBe(0);
  });
});

describe('unread badge screens use the shared helper', () => {
  const screens = [
    'screens/DashboardScreen.tsx',
    'screens/ForceProfileScreen.tsx',
    'screens/HittingPerformanceScreen.tsx',
    'screens/PitchingScreen.tsx',
    'screens/PerformanceScreen.tsx',
  ];

  it.each(screens)('%s imports getUnreadMessagesCount and calls it', (p) => {
    const S = read(p);
    expect(S).toContain("from '../lib/unreadMessages'");
    expect(S).toContain('getUnreadMessagesCount(');
  });

  it.each(screens)('%s no longer queries the dead message columns', (p) => {
    const S = read(p);
    expect(S).not.toContain('receiver_id');
    expect(S).not.toContain('recipient_id');
    expect(S).not.toMatch(/\.eq\('read', false\)/);
  });
});
