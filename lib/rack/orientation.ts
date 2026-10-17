/**
 * Orientation policy (controller ruling, Task 9 fix round 2).
 *   - Phone: portrait everywhere, always (Info.plist: iPhone = portrait only).
 *   - iPad, Rack screens (RackSetup / RackMode / RackPinExit and their
 *     sheets): unlocked — `OrientationLock.DEFAULT`, i.e. whatever
 *     `UISupportedInterfaceOrientations~ipad` allows (all four). Never forced
 *     to landscape: on iPadOS 26 a forced lock against the held orientation
 *     letterboxes the app. The rack layout adapts (landscape / portrait).
 *   - iPad, every other screen: PORTRAIT_UP, as before (those screens have
 *     not been laid out for landscape).
 * App.tsx applies the base (portrait) lock at start and calls
 * `syncOrientationForRoute` on every navigation change.
 */

import * as ScreenOrientation from 'expo-screen-orientation';
import { isTabletDevice } from './device';

export const RACK_ROUTES = ['RackSetup', 'RackMode', 'RackPinExit'] as const;

/** Every orientation — for any Modal shown on a rack screen (RN defaults to portrait only). */
export const ALL_MODAL_ORIENTATIONS = ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right'] as const;

export function isRackRoute(name: string | undefined | null): boolean {
  return !!name && (RACK_ROUTES as readonly string[]).includes(name);
}

type Want = 'portrait' | 'unlocked';
let last: Want | null = null;

/** Unlocked only on a rack route on an iPad; portrait everywhere else. */
export function orientationFor(routeName: string | undefined | null): Want {
  return isRackRoute(routeName) && isTabletDevice() ? 'unlocked' : 'portrait';
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

/** iPad rack screens: back to the plist's supported set (all four on iPad). */
export async function unlockRackOrientations(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
    last = 'unlocked';
  } catch (e) {
    last = null;
    console.warn('[orientation] unlock failed', e);
  }
}

/** The non-rack base: portrait (phone and iPad). */
export async function applyBaseOrientation(): Promise<void> {
  return lockPortrait();
}

export function syncOrientationForRoute(name: string | undefined | null): void {
  const want = orientationFor(name);
  if (want === last) return;
  void (want === 'unlocked' ? unlockRackOrientations() : lockPortrait());
}
