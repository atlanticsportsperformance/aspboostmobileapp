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

/**
 * Serialized "desired state" pump. Every request records what it WANTS; one
 * loop applies locks one at a time until what was applied equals the latest
 * want. (The old code cached `last` only after an async lock resolved, so a
 * quick rack → non-rack → rack bounce — the staff guard / boot-to-rack reset —
 * skipped the unlock as "already unlocked" and the late portrait lock won:
 * RackMode stayed portrait-locked and iPadOS 26 letterboxed it on rotation.)
 */
let desired: Want | null = null;
let applied: Want | null = null;
/** Re-apply even when applied === desired (RackMode focus / foreground). */
let dirty = false;
let pumping: Promise<void> | null = null;

async function pump(): Promise<void> {
  while (desired !== null && (desired !== applied || dirty)) {
    const want = desired;
    dirty = false;
    try {
      await ScreenOrientation.lockAsync(
        want === 'unlocked' ? ScreenOrientation.OrientationLock.DEFAULT : ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
      applied = want;
    } catch (e) {
      applied = null;
      console.warn(`[orientation] ${want === 'unlocked' ? 'unlock' : 'portrait lock'} failed`, e);
      return; // retried on the next request
    }
  }
}

function request(want: Want, force = false): Promise<void> {
  desired = want;
  if (force) dirty = true;
  if (!pumping) {
    pumping = pump().finally(() => {
      pumping = null;
    });
  }
  return pumping;
}

/**
 * Whether this iPad is a rack (rack_device_v1 present). null = not read yet.
 * App.tsx sets it. While booting (Loading) a rack iPad must NOT be locked
 * portrait: a portrait-only moment while the iPad is held landscape makes
 * iPadOS 26 open the app as a letterboxed WINDOW, and it stays windowed.
 */
let rackHint: boolean | null = null;
export function setRackDeviceHint(present: boolean): void {
  rackHint = present;
}

/** Boot routes shown before routing decides (Loading). */
const BOOT_ROUTES = ['Loading'];

/** iPad: unlocked on rack routes, on every route of a rack iPad, and while booting
 *  before rack_device_v1 is read; portrait everywhere else. Phone: portrait. */
export function orientationFor(routeName: string | undefined | null): Want {
  if (!isTabletDevice()) return 'portrait';
  if (isRackRoute(routeName)) return 'unlocked';
  // A rack iPad (rack_device_v1 set) is never portrait-locked — not even the
  // brief Loading → CoachDashboard → RackMode hop at boot.
  if (rackHint === true) return 'unlocked';
  if ((routeName == null || BOOT_ROUTES.includes(routeName)) && rackHint === null) return 'unlocked';
  return 'portrait';
}

export function lockPortrait(): Promise<void> {
  return request('portrait');
}

/** iPad rack screens: OrientationLock.DEFAULT (= all-but-upside-down on a
 *  home-indicator iPad; `ALL` is refused there). */
export function unlockRackOrientations(): Promise<void> {
  return request('unlocked');
}

/** The non-rack base: portrait (phone and iPad). Used when leaving Rack mode. */
export function applyBaseOrientation(): Promise<void> {
  return lockPortrait();
}

/**
 * App start. Phone: portrait. iPad: no lock yet — the native default is the
 * plist's iPad set (all four; app.json sets no portrait-only launch mask), and
 * the first route decides (a rack iPad boots straight into RackMode unlocked).
 */
export function applyBootOrientation(): Promise<void> {
  return isTabletDevice() ? Promise.resolve() : lockPortrait();
}

/**
 * Rack screen mount / focus / foreground: unlock on an iPad EVERY time, even
 * if this module believes it already is (a native lock can be stale).
 */
export function ensureRackOrientation(): Promise<void> {
  return isTabletDevice() ? request('unlocked', true) : request('portrait');
}

export function syncOrientationForRoute(name: string | undefined | null): void {
  void request(orientationFor(name));
}
