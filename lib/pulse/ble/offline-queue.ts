/**
 * Offline throw queue — buffers failed commitThrows calls and retries them
 * when network comes back. Uses AsyncStorage so throws survive an app kill.
 *
 * Flow:
 *   1. Live mode fires commitThrows per throw.
 *   2. If it fails (no network, server error, timeout), the row payload
 *      is pushed into the queue.
 *   3. A periodic flush (every 10s while the app is open) retries the queue.
 *   4. On app launch, any persisted queue items from a previous session
 *      are retried automatically.
 *
 * Zero throws lost even if the athlete is in a gym with no cell service.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';

const STORAGE_KEY = 'pulse_offline_throw_queue';

export interface QueuedThrowRow {
  org_id: string;
  athlete_id: string;
  device_id: string | null;
  thrown_at: string;
  torque_nm: number | null;
  arm_speed_dps: number | null;
  arm_slot_deg: number | null;
  ball_weight_oz: number;
  source: string;
  is_valid: boolean;
}

let memoryQueue: QueuedThrowRow[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let supabaseRef: SupabaseClient | null = null;

/** Enqueue a row that failed to commit. Persists to AsyncStorage. */
export async function enqueueThrow(row: QueuedThrowRow): Promise<void> {
  memoryQueue.push(row);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryQueue));
  } catch {
    // AsyncStorage write failed — still in memory, will retry
  }
}

/** Enqueue multiple rows at once. */
export async function enqueueThrows(rows: QueuedThrowRow[]): Promise<void> {
  memoryQueue.push(...rows);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryQueue));
  } catch {
    // non-fatal
  }
}

/** How many throws are waiting to be committed. */
export function queueSize(): number {
  return memoryQueue.length;
}

/**
 * Attempt to flush all queued throws to Supabase. Silently succeeds if
 * queue is empty. Returns the number successfully committed.
 */
export async function flushQueue(supabase?: SupabaseClient): Promise<number> {
  const client = supabase ?? supabaseRef;
  if (!client || memoryQueue.length === 0) return 0;

  const batch = [...memoryQueue];
  try {
    const { error, count } = await client
      .from('pulse_throws')
      .insert(batch, { count: 'exact' });

    if (error) {
      console.warn('[offline-queue] flush failed, will retry:', error.message);
      return 0;
    }

    // Success — clear the queue
    memoryQueue = [];
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {
      // non-fatal
    }
    console.warn(`[offline-queue] flushed ${count ?? batch.length} queued throws`);
    return count ?? batch.length;
  } catch (err: any) {
    console.warn('[offline-queue] flush threw, will retry:', err?.message);
    return 0;
  }
}

/**
 * Start the periodic flush timer. Call once at app startup with the
 * Supabase client. Also hydrates any persisted queue from a prior session.
 */
export async function startOfflineQueue(supabase: SupabaseClient): Promise<void> {
  supabaseRef = supabase;

  // Hydrate from AsyncStorage
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryQueue = parsed;
        console.warn(`[offline-queue] hydrated ${memoryQueue.length} queued throws from storage`);
      }
    }
  } catch {
    // non-fatal
  }

  // Flush immediately if there's anything from a previous session
  if (memoryQueue.length > 0) {
    flushQueue().catch(() => {});
  }

  // Periodic retry every 10 seconds
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = setInterval(() => {
    if (memoryQueue.length > 0) {
      flushQueue().catch(() => {});
    }
  }, 10_000);
}

/** Stop the periodic flush timer. */
export function stopOfflineQueue(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
