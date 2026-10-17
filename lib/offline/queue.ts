// Generic durable FIFO queue on AsyncStorage. Items are stored as a plain JSON
// array under `key` (the format Pulse's queue has always used).
//
// - enqueue appends (no coalescing); with `idOf`, an already-queued id is a no-op.
// - flush sends in FIFO order and stops at the first transient failure, leaving
//   that item and everything after it queued. An error with `permanent: true`
//   drops the item and continues.
// - Storage read-modify-write is serialized per key, so concurrent enqueues
//   never drop each other. Concurrent flushes share one promise.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type QueueOptions<T> = {
  idOf?: (item: T) => string;
  maxItems?: number;
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
  const { idOf, maxItems } = opts;

  const enqueue = (item: T) =>
    withLock(key, async () => {
      const items = await read<T>(key);
      if (idOf) {
        const id = idOf(item);
        if (items.some(i => idOf(i) === id)) return;
      }
      items.push(item);
      // Over capacity: drop the oldest.
      if (maxItems && items.length > maxItems) items.splice(0, items.length - maxItems);
      await write(key, items);
    });

  const removeHead = () =>
    withLock(key, async () => {
      const items = await read<T>(key);
      items.shift();
      await write(key, items);
    });

  const runFlush = async () => {
    let sent = 0;
    let failed = 0;
    for (;;) {
      const head = (await withLock(key, () => read<T>(key)))[0];
      if (head === undefined) break;
      try {
        await send(head);
      } catch (err) {
        failed++;
        if (isPermanent(err)) {
          await removeHead();
          continue;
        }
        break;
      }
      await removeHead();
      sent++;
    }
    return { sent, failed };
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
