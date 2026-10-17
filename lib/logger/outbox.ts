// Offline outbox for logger set writes (spec §7): every set is saved to device
// storage first, then synced. Rows are coalesced per set (latest full row
// wins — rows are full state, so nothing is merged) and removed only once the
// server accepted that exact row.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { upsertSet, type LogRow } from './saveSet';

export const OUTBOX_KEY = 'logger_outbox_v1';
// After this many consecutive failed sends for one set, the row is kept but
// only retried on foreground flushes (app open / back to the app), so a row
// the server keeps rejecting doesn't ride along on every save.
export const MAX_FAILURES = 5;

export type OutboxStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

export type Send = (row: LogRow) => Promise<{ ok: boolean }>;

export type Outbox = {
  enqueue: (row: LogRow) => Promise<void>;
  // Sends every queued row once; resolves to the number accepted. Rows that
  // backed off (MAX_FAILURES) are only sent when `foreground` is set.
  flush: (opts?: { foreground?: boolean }) => Promise<number>;
  size: () => Promise<number>;
  // Queued (unsynced) rows — overlaid on server logs when a workout reopens.
  pending: () => Promise<LogRow[]>;
};

type Queue = Record<string, LogRow>;

export function setKeyOf(row: LogRow): string {
  return `${row.workout_instance_id}|${row.routine_exercise_id}|${row.set_number}`;
}

// Storage read-modify-write is serialized per storage object, so concurrent
// enqueues (or two outboxes on the same storage) never drop each other's rows.
const locks = new WeakMap<object, Promise<unknown>>();
function withLock<T>(storage: object, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(storage) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(storage, next.catch(() => {}));
  return next;
}

const defaultSend: Send = row => upsertSet(supabase, row);

export function createOutbox(storage: OutboxStorage = AsyncStorage, send: Send = defaultSend): Outbox {
  const read = async (): Promise<Queue> => {
    const raw = await storage.getItem(OUTBOX_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      console.error('logger outbox: unreadable storage, starting empty', error);
      return {};
    }
  };
  const write = (q: Queue) => storage.setItem(OUTBOX_KEY, JSON.stringify(q));

  const enqueue = (row: LogRow) =>
    withLock(storage, async () => {
      const q = await read();
      const k = setKeyOf(row);
      delete q[k]; // re-insert so queue order follows the latest edit
      q[k] = row;
      await write(q);
    });

  // One pass over a snapshot. A row is removed only if it is still exactly
  // the row that was sent — a newer edit enqueued mid-send stays queued.
  // Consecutive failures per set, in memory (an app restart retries all).
  const failures = new Map<string, number>();

  const drainOnce = async (foreground: boolean): Promise<number> => {
    const snapshot = await withLock(storage, read);
    let sent = 0;
    for (const [k, row] of Object.entries(snapshot)) {
      if (!foreground && (failures.get(k) ?? 0) >= MAX_FAILURES) continue;
      let ok = false;
      try {
        ok = (await send(row)).ok;
      } catch (error) {
        console.error('logger outbox: send threw', error);
      }
      if (!ok) {
        const n = (failures.get(k) ?? 0) + 1;
        failures.set(k, n);
        if (n === MAX_FAILURES) {
          console.warn(`logger outbox: ${k} failed ${n} times in a row — kept, retrying only on app foreground`);
        }
        continue;
      }
      failures.delete(k);
      sent += 1;
      const body = JSON.stringify(row);
      await withLock(storage, async () => {
        const q = await read();
        if (q[k] && JSON.stringify(q[k]) === body) {
          delete q[k];
          await write(q);
        }
      });
    }
    return sent;
  };

  let flushing: Promise<number> | null = null;
  let rerun = false;
  let rerunForeground = false;
  const flush = (opts?: { foreground?: boolean }): Promise<number> => {
    if (flushing) {
      // Already flushing: run one more pass when it finishes so rows enqueued
      // meanwhile go out, without ever sending concurrently.
      rerun = true;
      if (opts?.foreground) rerunForeground = true;
      return flushing;
    }
    let foreground = !!opts?.foreground;
    flushing = (async () => {
      let sent = 0;
      do {
        rerun = false;
        sent += await drainOnce(foreground);
        foreground = rerunForeground;
        rerunForeground = false;
      } while (rerun);
      return sent;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  };

  const size = async () => Object.keys(await withLock(storage, read)).length;
  const pending = async () => Object.values(await withLock(storage, read));

  return { enqueue, flush, size, pending };
}
