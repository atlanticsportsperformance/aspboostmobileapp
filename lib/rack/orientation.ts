/**
 * Orientation policy.
 *   - Phone: portrait everywhere, always.
 *   - iPad: never orientation-forced — every orientation, on every screen
 *     including the Rack screens. Forcing landscape on iPadOS 26 turns the app
 *     into a small letterboxed floating window when the iPad is held in
 *     portrait. The rack iPad is physically mounted landscape; the rack
 *     layout adapts (and stacks in portrait).
 * App.tsx applies the base policy at start and calls
 * `syncOrientationForRoute` on every navigation change (the route no longer
 * changes the answer, but the call keeps a failed lock retried).
 */

import * as ScreenOrientation from 'expo-screen-orientation';
import { isTabletDevice } from './device';

export const RACK_ROUTES = ['RackSetup', 'RackMode', 'RackPinExit'] as const;

export function isRackRoute(name: string | undefined | null): boolean {
  return !!name && (RACK_ROUTES as readonly string[]).includes(name);
}

type Want = 'portrait' | 'all';
let last: Want | null = null;

/** What this device should be locked to (route-independent). */
export function orientationPolicy(): Want {
  return isTabletDevice() ? 'all' : 'portrait';
}

// `last` is recorded only after a lock succeeds, so a failed lock is retried
// on the next navigation change.
export async function lockPortrait(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    last = 'portrait';
  } catch (e) {
    last = null;
    console.warn('[orientation] portrait lock failed', e);
  }
}

/** iPad: allow every orientation (explicit ALL — not unlockAsync, which
 *  would fall back to the plist's portrait-only initial mask). */
export async function unlockAllOrientations(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.ALL);
    last = 'all';
  } catch (e) {
    last = null;
    console.warn('[orientation] unlock failed', e);
  }
}

/** Phone → portrait; iPad → all orientations. */
export async function applyBaseOrientation(): Promise<void> {
  return orientationPolicy() === 'all' ? unlockAllOrientations() : lockPortrait();
}

export function syncOrientationForRoute(_name: string | undefined | null): void {
  if (orientationPolicy() === last) return;
  void applyBaseOrientation();
}
