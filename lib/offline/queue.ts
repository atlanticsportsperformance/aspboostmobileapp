// Generic durable FIFO queue on AsyncStorage. Items are stored as a plain JSON
// array under `key` (the format Pulse's queue has always used).
//
// - enqueue appends (no coalescing); with `idOf`, an already-queued id is a no-op
//   — or, with `replace: true`, the queued item is replaced in place by the new
//   one (latest write wins). A replaced item that was in flight is NOT removed
//   when its send completes: removal then matches the exact sent value, so the
//   newer payload stays queued and goes out on the next pass.
// - flush sends in FIFO order and stops at the first transient failure, leaving
//   that item and everything after it queued. An error with `permanent: true`
//   drops the item and continues.
// - Storage read-modify-write is serialized per key, so concurrent enqueues
//   never drop each other. Concurrent flushes share one promise.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type QueueOptions<T> = {
  idOf?: (item: T) => string;
  // Oldest items are dropped when the queue grows past this.
  maxItems?: number;
  // When given, flush sends chunks of `batchSize` with one storage write per
  // successful chunk. A permanent failure falls back to per-item `send` for
  // that chunk so the bad item can be isolated.
  sendBatch?: (items: T[]) => Promise<void>;
  batchSize?: number;
  // With `idOf`: a later enqueue of a queued id replaces it (same position).
  replace?: boolean;
};

export type Queue<T> = {
  enqueue: (item: T) => Promise<void>;
  flush: () => Promise<{ sent: number; failed: number }>;
  size: () => Promise<number>;
  peekAll: () => Promise<T[]>;
};

const locks = new Map<string, Promise<unknown>>();
function withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

// One queue per storage key: flushes are shared by key.
const flushing = new Map<string, Promise<{ sent: number; failed: number }>>();

function isPermanent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { permanent?: unknown }).permanent === true;
}

async function read<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (error) {
    console.error(`offline queue ${key}: unreadable storage, starting empty`, error);
    return [];
  }
}

async function write<T>(key: string, items: T[]): Promise<void> {
  if (items.length === 0) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, JSON.stringify(items));
}

export function createQueue<T>(
  key: string,
  send: (item: T) => Promise<void>,
  opts: QueueOptions<T> = {},
): Queue<T> {
  const { idOf, maxItems, sendBatch } = opts;
  const replace = !!(opts.replace && idOf);
  const batchSize = Math.max(1, opts.batchSize ?? 50);
  // Identity of a queued item: its id, else its serialized value.
  // In replace mode an id's payload can change while it is in flight, so a
  // completed send removes only the exact value it sent.
  const identOf = (item: T) => (idOf && !replace ? idOf(item) : JSON.stringify(item));

  const enqueue = (item: T) =>
    withLock(key, async () => {
      const items = await read<T>(key);
      if (idOf) {
        const id = idOf(item);
        const at = items.findIndex(i => idOf(i) === id);
        if (at >= 0) {
          if (!replace) return;
          items[at] = item;
          await write(key, items);
          return;
        }
      }
      items.push(item);
      if (maxItems && items.length > maxItems) items.splice(0, items.length - maxItems);
      await write(key, items);
    });

  // Removes one occurrence of each given item BY IDENTITY (never by position),
  // in a single storage write. Items already trimmed away are simply absent.
  const remove = (done: T[]) =>
    withLock(key, async () => {
      const items = await read<T>(key);
      for (const d of done) {
        const id = identOf(d);
        const idx = items.findIndex(i => identOf(i) === id);
        if (idx >= 0) items.splice(idx, 1);
      }
      await write(key, items);
    });

  // Sends items one by one; returns false if a transient failure stopped it.
  const sendEach = async (chunk: T[], acc: { sent: number; failed: number }) => {
    for (const item of chunk) {
      try {
        await send(item);
      } catch (err) {
        acc.failed++;
        if (isPermanent(err)) {
          await remove([item]);
          continue;
        }
        return false;
      }
      await remove([item]);
      acc.sent++;
    }
    return true;
  };

  const runFlush = async () => {
    const acc = { sent: 0, failed: 0 };
    for (;;) {
      const snapshot = await withLock(key, () => read<T>(key));
      if (snapshot.length === 0) break;
      const chunk = snapshot.slice(0, sendBatch ? batchSize : 1);
      if (!sendBatch) {
        if (!(await sendEach(chunk, acc))) break;
        continue;
      }
      try {
        await sendBatch(chunk);
      } catch (err) {
        if (!isPermanent(err)) {
          acc.failed += chunk.length;
          break;
        }
        if (!(await sendEach(chunk, acc))) break;
        continue;
      }
      await remove(chunk);
      acc.sent += chunk.length;
    }
    return acc;
  };

  const flush = () => {
    const existing = flushing.get(key);
    if (existing) return existing;
    const p = runFlush().finally(() => flushing.delete(key));
    flushing.set(key, p);
    return p;
  };

  return {
    enqueue,
    flush,
    size: async () => (await withLock(key, () => read<T>(key))).length,
    peekAll: () => withLock(key, () => read<T>(key)),
  };
}
