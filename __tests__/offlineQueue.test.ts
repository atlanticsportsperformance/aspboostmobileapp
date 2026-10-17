const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      // yield so concurrent writers interleave if unserialized
      await Promise.resolve();
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
  },
}));

import { createQueue } from '../lib/offline/queue';
import {
  enqueueThrow,
  flushQueue,
  queueSize,
  startOfflineQueue,
  stopOfflineQueue,
  type QueuedThrowRow,
} from '../lib/pulse/ble/offline-queue';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('createQueue', () => {
  it('survives restart and flushes in order', async () => {
    const a = createQueue<number>('k1', async () => {});
    await a.enqueue(1);
    await a.enqueue(2);
    await a.enqueue(3);
    const sent: number[] = [];
    const b = createQueue<number>('k1', async n => void sent.push(n));
    expect(await b.peekAll()).toEqual([1, 2, 3]);
    expect(await b.flush()).toEqual({ sent: 3, failed: 0 });
    expect(sent).toEqual([1, 2, 3]);
    expect(await b.size()).toBe(0);
  });

  it('failed send keeps the item and stops', async () => {
    const sent: number[] = [];
    const q = createQueue<number>('k2', async n => {
      if (n === 2) throw new Error('offline');
      sent.push(n);
    });
    for (const n of [1, 2, 3]) await q.enqueue(n);
    expect(await q.flush()).toEqual({ sent: 1, failed: 1 });
    expect(sent).toEqual([1]);
    expect(await q.peekAll()).toEqual([2, 3]);
  });

  it('permanent failure drops the item and continues', async () => {
    const sent: number[] = [];
    const q = createQueue<number>('k3', async n => {
      if (n === 2) throw Object.assign(new Error('bad'), { permanent: true });
      sent.push(n);
    });
    for (const n of [1, 2, 3]) await q.enqueue(n);
    expect(await q.flush()).toEqual({ sent: 2, failed: 1 });
    expect(sent).toEqual([1, 3]);
    expect(await q.size()).toBe(0);
  });

  it('concurrent enqueues do not lose items', async () => {
    const q = createQueue<number>('k4', async () => {});
    await Promise.all(Array.from({ length: 20 }, (_, i) => q.enqueue(i)));
    expect((await q.peekAll()).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('concurrent flushes do not double-send', async () => {
    const sent: number[] = [];
    const q = createQueue<number>('k5', async n => {
      await new Promise(r => setTimeout(r, 5));
      sent.push(n);
    });
    for (const n of [1, 2, 3]) await q.enqueue(n);
    const [r1, r2] = await Promise.all([q.flush(), q.flush()]);
    expect(sent).toEqual([1, 2, 3]);
    expect(r1).toBe(r2);
  });

  it('ignores an idOf duplicate', async () => {
    const q = createQueue<{ id: string }>('k6', async () => {}, { idOf: i => i.id });
    await q.enqueue({ id: 'a' });
    await q.enqueue({ id: 'a' });
    await q.enqueue({ id: 'b' });
    expect((await q.peekAll()).map(i => i.id)).toEqual(['a', 'b']);
  });
});

describe('Pulse queue on the generic queue', () => {
  const row = (n: number): QueuedThrowRow => ({
    org_id: 'o',
    athlete_id: 'a',
    device_id: null,
    thrown_at: `t${n}`,
    torque_nm: null,
    arm_speed_dps: null,
    arm_slot_deg: null,
    ball_weight_oz: 5,
    source: 'test',
    is_valid: true,
  });
  const client = (inserted: any[], fail = false): any => ({
    from: () => ({
      insert: async (rows: any[]) => {
        if (fail) return { error: { message: 'down' } };
        inserted.push(...rows);
        return { error: null };
      },
    }),
  });

  it('keeps the legacy storage key/format, flushes in order, hydrates on start', async () => {
    store['pulse_offline_throw_queue'] = JSON.stringify([row(1)]);
    const inserted: any[] = [];
    await startOfflineQueue(client(inserted, true));
    stopOfflineQueue();
    expect(queueSize()).toBe(1);
    await enqueueThrow(row(2));
    expect(queueSize()).toBe(2);
    expect(JSON.parse(store['pulse_offline_throw_queue']).map((r: any) => r.thrown_at)).toEqual(['t1', 't2']);
    expect(await flushQueue(client(inserted, true))).toBe(0);
    expect(queueSize()).toBe(2);
    expect(await flushQueue(client(inserted))).toBe(2);
    expect(inserted.map(r => r.thrown_at)).toEqual(['t1', 't2']);
    expect(queueSize()).toBe(0);
    expect(store['pulse_offline_throw_queue']).toBeUndefined();
  });
});
