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

describe('createQueue fixes', () => {
  it('maxItems trimming during an in-flight send never removes an unsent item', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const sent: number[] = [];
    const q = createQueue<number>(
      'k7',
      async n => {
        if (n === 1) await gate;
        sent.push(n);
      },
      { maxItems: 2 },
    );
    await q.enqueue(1);
    await q.enqueue(2);
    const f = q.flush();
    await new Promise(r => setTimeout(r, 5));
    await q.enqueue(3); // trims 1 (in flight) away
    release();
    await f;
    expect(sent).toEqual([1, 2, 3]);
    expect(await q.size()).toBe(0);
  });

  it('batches: one storage write per chunk, FIFO', async () => {
    const AS = require('@react-native-async-storage/async-storage').default;
    const batches: number[][] = [];
    const q = createQueue<number>('k8', async () => {}, {
      sendBatch: async b => void batches.push(b),
      batchSize: 2,
    });
    for (const n of [1, 2, 3, 4, 5]) await q.enqueue(n);
    AS.setItem.mockClear();
    AS.removeItem.mockClear();
    expect(await q.flush()).toEqual({ sent: 5, failed: 0 });
    expect(batches).toEqual([[1, 2], [3, 4], [5]]);
    expect(AS.setItem.mock.calls.length + AS.removeItem.mock.calls.length).toBe(3);
  });

  it('batch transient failure keeps the chunk and stops', async () => {
    const q = createQueue<number>('k9', async () => {}, {
      sendBatch: async b => {
        if (b.includes(3)) throw new Error('offline');
      },
      batchSize: 2,
    });
    for (const n of [1, 2, 3, 4]) await q.enqueue(n);
    expect(await q.flush()).toEqual({ sent: 2, failed: 2 });
    expect(await q.peekAll()).toEqual([3, 4]);
  });

  it('batch permanent failure falls back to per-item to isolate the bad one', async () => {
    const sent: number[] = [];
    const q = createQueue<number>(
      'k10',
      async n => {
        if (n === 2) throw Object.assign(new Error('bad'), { permanent: true });
        sent.push(n);
      },
      {
        sendBatch: async () => {
          throw Object.assign(new Error('bad'), { permanent: true });
        },
        batchSize: 3,
      },
    );
    for (const n of [1, 2, 3]) await q.enqueue(n);
    const r = await q.flush();
    expect(sent).toEqual([1, 3]);
    expect(r.sent).toBe(2);
    expect(await q.size()).toBe(0);
  });

  it('a storage error rejects only its caller, not the chain', async () => {
    const AS = require('@react-native-async-storage/async-storage').default;
    AS.setItem.mockRejectedValueOnce(new Error('disk'));
    const q = createQueue<number>('k11', async () => {});
    await expect(q.enqueue(1)).rejects.toThrow('disk');
    await q.enqueue(2);
    expect(await q.peekAll()).toEqual([2]);
  });
});
