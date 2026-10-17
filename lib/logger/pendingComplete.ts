// Finish without blocking on the network. A completion that could not reach
// the server because the DEVICE is offline is queued here (tagged with the
// signed-in user) and replayed by the app-level foreground sync AFTER the set
// outbox has flushed. A server rejection is never queued — the screen shows
// the error and the athlete stays put.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { markWorkoutListDirty } from '../workoutRefreshSignal';
import type { OutboxStorage } from './outbox';

export const PENDING_COMPLETE_KEY = 'logger_pending_complete_v2';

export type PendingComplete = {
  workoutInstanceId: string;
  completedAt: string;
  // Absent when the athlete skipped (or was never asked) — column untouched.
  sessionRpe?: number;
};

type Queued = PendingComplete & { userId: string };

// retryable: true = network failure (queue it). false = the server rejected
// it, or updated 0 rows (RLS hides it / row gone).
export type CompleteSend = (p: PendingComplete) => Promise<{
  ok: boolean;
  retryable?: boolean;
  zeroRows?: boolean;
  message?: string;
}>;

export type CompleteOutcome =
  | { status: 'sent' }
  | { status: 'queued' }
  | { status: 'rejected'; message: string };

// status/completed_at plus session_rpe only when a number was chosen.
export function completionPatch(p: PendingComplete): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: 'completed', completed_at: p.completedAt };
  if (p.sessionRpe != null) patch.session_rpe = p.sessionRpe;
  return patch;
}

// Retryable = the request never got a real answer, or the server/DB is
// temporarily down (5xx, PostgREST PGRST000-002 connection/pool errors). Only
// 4xx-class rejections and other coded errors are final.
export function isRetryableError(error: { code?: unknown } | null | undefined, status?: number): boolean {
  if (typeof status === 'number' && status >= 500) return true;
  const code = typeof error?.code === 'string' ? error.code : '';
  if (/^PGRST00[012]$/.test(code)) return true;
  const clientError = typeof status === 'number' && status >= 400 && status < 500;
  return !(code !== '' || clientError);
}

const defaultSend: CompleteSend = async p => {
  try {
    const { data, error, status } = await supabase
      .from('workout_instances')
      .update(completionPatch(p))
      .eq('id', p.workoutInstanceId)
      .select('id');
    if (error) {
      return { ok: false, retryable: isRetryableError(error as any, status), message: error.message };
    }
    if (!data || data.length === 0) {
      return { ok: false, retryable: false, zeroRows: true, message: 'Workout not found or not allowed.' };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, retryable: true, message: e?.message || 'network error' };
  }
};

const defaultUserId = async (): Promise<string | null> => {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
};

export function createPendingCompletions(
  storage: OutboxStorage = AsyncStorage,
  send: CompleteSend = defaultSend,
  getUserId: () => Promise<string | null> = defaultUserId,
) {
  const read = async (): Promise<Queued[]> => {
    try {
      const raw = await storage.getItem(PENDING_COMPLETE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const write = (q: Queued[]) => storage.setItem(PENDING_COMPLETE_KEY, JSON.stringify(q));

  // Serialize read-modify-write so concurrent calls never drop each other.
  let chain: Promise<unknown> = Promise.resolve();
  const locked = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };

  const clear = (workoutInstanceId: string) =>
    locked(async () => {
      try {
        const q = await read();
        const next = q.filter(x => x.workoutInstanceId !== workoutInstanceId);
        if (next.length !== q.length) await write(next);
      } catch (e) {
        console.error('[pendingComplete] clear failed', e);
      }
    });

  const complete = async (p: PendingComplete): Promise<CompleteOutcome> => {
    const res = await send(p);
    if (res.ok) {
      await clear(p.workoutInstanceId); // a stale queued intent must not replay over this
      return { status: 'sent' };
    }
    if (res.retryable) {
      const userId = await getUserId();
      if (userId) {
        await locked(async () => {
          const q = (await read()).filter(x => x.workoutInstanceId !== p.workoutInstanceId);
          await write([...q, { ...p, userId }]);
        });
        return { status: 'queued' };
      }
    }
    return { status: 'rejected', message: res.message || 'Please try again.' };
  };

  // Replays the CURRENT user's queued completions; others stay queued.
  const flush = async (): Promise<number> => {
    const userId = await getUserId();
    if (!userId) return 0;
    const mine = (await read()).filter(x => x.userId === userId);
    const done = new Set<string>();
    for (const p of mine) {
      const res = await send(p);
      const key = `${p.workoutInstanceId}|${p.completedAt}`;
      if (res.ok) done.add(key);
      else if (!res.retryable && !res.zeroRows) {
        // Server rejected it outright: retrying can never help.
        console.warn('[pendingComplete] dropping rejected completion', p.workoutInstanceId, res.message);
        done.add(key);
      }
    }
    if (done.size === 0) return 0;
    await locked(async () => {
      const q = await read();
      await write(q.filter(x => !(x.userId === userId && done.has(`${x.workoutInstanceId}|${x.completedAt}`))));
    });
    markWorkoutListDirty();
    return done.size;
  };

  return { complete, flush, clear, pending: read };
}

export const pendingCompletions = createPendingCompletions();
