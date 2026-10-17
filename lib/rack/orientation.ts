/**
 * Orientation policy. The app config allows every orientation (so the iPad
 * rack can go landscape), and this keeps everything portrait except the Rack
 * screens on a tablet. App.tsx locks portrait at start and calls
 * `syncOrientationForRoute` on every navigation change, so leaving a Rack
 * screen by any path re-locks portrait. Phones never unlock.
 */

import * as ScreenOrientation from 'expo-screen-orientation';
import { isTabletDevice } from './device';

export const RACK_ROUTES = ['RackSetup', 'RackMode', 'RackPinExit'] as const;

export function isRackRoute(name: string | undefined | null): boolean {
  return !!name && (RACK_ROUTES as readonly string[]).includes(name);
}

let last: 'portrait' | 'landscape' | null = null;

export async function lockPortrait(): Promise<void> {
  last = 'portrait';
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  } catch (e) {
    console.warn('[orientation] portrait lock failed', e);
  }
}

/** Landscape on a tablet; a phone stays portrait. */
export async function lockRackLandscape(): Promise<void> {
  if (!isTabletDevice()) return lockPortrait();
  last = 'landscape';
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  } catch (e) {
    console.warn('[orientation] landscape lock failed', e);
  }
}

export function syncOrientationForRoute(name: string | undefined | null): void {
  const want = isRackRoute(name) && isTabletDevice() ? 'landscape' : 'portrait';
  if (want === last) return;
  void (want === 'landscape' ? lockRackLandscape() : lockPortrait());
}
