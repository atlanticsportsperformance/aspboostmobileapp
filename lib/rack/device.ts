/**
 * This iPad's rack identity (AsyncStorage `rack_device_v1`), the tablet
 * check that gates Rack mode, and the bounded queue drain run before the
 * rack id is cleared (PIN exit).
 *
 * Drain-before-clear matters because the rack queues are not keyed by user:
 * anything left behind would be sent later by whoever signs in next (data
 * layer note M-8).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import type { RackPersist } from './persist';

export const RACK_DEVICE_KEY = 'rack_device_v1';

export interface RackDevice {
  rackId: string;
  rackName: string;
}

/** iPad (or Android tablet). Rack mode is offered only here. */
export function isTabletDevice(): boolean {
  if (Platform.OS === 'ios' && (Platform as { isPad?: boolean }).isPad) return true;
  return Device.deviceType === Device.DeviceType.TABLET;
}

// ---- stored rack id (with a tiny store so App.tsx sees setup / exit)

type Listener = (d: RackDevice | null) => void;
const listeners = new Set<Listener>();
let current: RackDevice | null | undefined; // undefined = not read yet

export async function readRackDevice(): Promise<RackDevice | null> {
  if (current !== undefined) return current;
  try {
    const raw = await AsyncStorage.getItem(RACK_DEVICE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    current =
      parsed && typeof parsed.rackId === 'string' && typeof parsed.rackName === 'string'
        ? { rackId: parsed.rackId, rackName: parsed.rackName }
        : null;
  } catch (e) {
    console.warn('[rack] read rack_device_v1 failed', e);
    current = null;
  }
  return current;
}

export async function saveRackDevice(d: RackDevice): Promise<void> {
  await AsyncStorage.setItem(RACK_DEVICE_KEY, JSON.stringify({ rackId: d.rackId, rackName: d.rackName }));
  current = { ...d };
  listeners.forEach(l => l(current ?? null));
}

export async function clearRackDevice(): Promise<void> {
  await AsyncStorage.removeItem(RACK_DEVICE_KEY);
  current = null;
  listeners.forEach(l => l(null));
}

export function subscribeRackDevice(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---- drain

/** Rack mode's live executor registers its flush here, so the drain also
 *  re-enqueues writes it is holding in memory (Task 9). */
let activeFlusher: (() => Promise<void> | void) | null = null;
export function setActiveRackFlusher(fn: (() => Promise<void> | void) | null): void {
  activeFlusher = fn;
}

export const DRAIN_TIMEOUT_MS = 10_000;
const DRAIN_POLL_MS = 500;

export interface DrainResult {
  drained: boolean;
  reps: number;
  sets: number;
}

/**
 * Flush the rack rep + set queues until both are empty or `timeoutMs`
 * passes. Never deletes anything: items left over stay on disk.
 */
export async function drainRackQueues(
  persist: Pick<RackPersist, 'flush' | 'pending'>,
  timeoutMs = DRAIN_TIMEOUT_MS,
  now: () => number = () => Date.now(),
): Promise<DrainResult> {
  const deadline = now() + timeoutMs;
  let left = { reps: 0, sets: 0 };
  for (;;) {
    if (activeFlusher) {
      const fn = activeFlusher;
      await bounded(Promise.resolve().then(fn), deadline - now()).catch(e =>
        console.warn('[rack] executor flush failed during drain', e),
      );
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await bounded(persist.flush({ force: true }), remaining);
    try {
      left = await persist.pending();
    } catch (e) {
      console.warn('[rack] pending() failed during drain', e);
      left = { reps: -1, sets: -1 };
    }
    if (left.reps === 0 && left.sets === 0) return { drained: true, reps: 0, sets: 0 };
    if (now() + DRAIN_POLL_MS >= deadline) break;
    await sleep(DRAIN_POLL_MS);
  }
  try {
    left = await persist.pending();
  } catch {
    // keep the last count
  }
  return { drained: left.reps === 0 && left.sets === 0, reps: left.reps, sets: left.sets };
}

/** Waits for `p`, at most `ms` (the work itself is not cancelled). */
async function bounded(p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([p, new Promise<void>(r => { timer = setTimeout(r, Math.max(0, ms)); })]);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, Math.max(0, ms)));
}
