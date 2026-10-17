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

import type { SupabaseClient } from '@supabase/supabase-js';
import { createQueue } from '../../offline/queue';
import { pulseEvents } from './pulse-events';

const STORAGE_KEY = 'pulse_offline_throw_queue';
const DEFAULT_INTERVAL_MS = 10_000;

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

let flushTimer: ReturnType<typeof setInterval> | null = null;
let supabaseRef: SupabaseClient | null = null;
let activeClient: SupabaseClient | null = null;
let currentIntervalMs = DEFAULT_INTERVAL_MS;
// Mirror of the persisted length so queueSize() can stay synchronous.
let cachedSize = 0;

const queue = createQueue<QueuedThrowRow>(STORAGE_KEY, async row => {
  const client = activeClient ?? supabaseRef;
  if (!client) throw new Error('no supabase client');
  const { error } = await client.from('pulse_throws').insert([row]);
  if (error) throw error;
});

async function refreshSize(): Promise<void> {
  try {
    cachedSize = await queue.size();
  } catch {
    // non-fatal
  }
}

/** Enqueue a row that failed to commit. Persists to AsyncStorage. */
export async function enqueueThrow(row: QueuedThrowRow): Promise<void> {
  cachedSize++;
  try {
    await queue.enqueue(row);
  } catch {
    // AsyncStorage write failed
  }
  await refreshSize();
}

/** Enqueue multiple rows at once. */
export async function enqueueThrows(rows: QueuedThrowRow[]): Promise<void> {
  for (const row of rows) await enqueueThrow(row);
}

/** How many throws are waiting to be committed. */
export function queueSize(): number {
  return cachedSize;
}

/**
 * Attempt to flush all queued throws to Supabase. Silently succeeds if
 * queue is empty. Returns the number successfully committed.
 */
export async function flushQueue(supabase?: SupabaseClient): Promise<number> {
  const client = supabase ?? supabaseRef;
  if (!client || cachedSize === 0) return 0;
  activeClient = client;
  try {
    const { sent, failed } = await queue.flush();
    if (failed > 0) console.warn('[offline-queue] flush failed, will retry');
    if (sent > 0) {
      // Notify listeners (WorkloadScreen, ThrowingThrowsFeed) that new rows
      // landed in Supabase so they can refetch.
      pulseEvents.emitThrowsCommitted();
    }
    return sent;
  } catch (err: any) {
    console.warn('[offline-queue] flush threw, will retry:', err?.message);
    return 0;
  } finally {
    await refreshSize();
  }
}

/**
 * Start the periodic flush timer. Call once at app startup with the
 * Supabase client. Also hydrates any persisted queue from a prior session.
 */
export async function startOfflineQueue(supabase: SupabaseClient): Promise<void> {
  supabaseRef = supabase;
  await refreshSize();
  if (cachedSize > 0) {
    console.warn(`[offline-queue] hydrated ${cachedSize} queued throws from storage`);
    flushQueue().catch(() => {});
  }
  restartTimer();
}

function restartTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushTimer = setInterval(() => {
    if (cachedSize > 0) {
      flushQueue().catch(() => {});
    }
  }, currentIntervalMs);
}

/**
 * Re-pace the flush timer at runtime. Live sessions call this with 1000 ms
 * for near-realtime persistence; stop() restores the 10 s idle cadence.
 * Safe to call before startOfflineQueue — the interval is used when the
 * timer is next started.
 */
export function setFlushInterval(ms: number): void {
  const clamped = Math.max(250, Math.floor(ms));
  if (clamped === currentIntervalMs) return;
  currentIntervalMs = clamped;
  if (flushTimer) {
    restartTimer();
  }
}

/** Stop the periodic flush timer. */
export function stopOfflineQueue(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
