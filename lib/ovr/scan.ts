/**
 * One-shot scan that lists nearby OVR sensors by name (rack setup's "pair"
 * step). Separate from OvrBleDevice, which connects to the first match: here
 * staff pick one sensor out of several at the gym.
 *
 * The sensor allows one client, so a sensor already connected to another
 * iPad does not advertise and will not show up.
 */

import type { Subscription } from 'react-native-ble-plx';
import { getBleManager } from '../ble/manager';
import { matchesOvrName, shouldUseFakeOvr } from './ovr-device';

export const OVR_SCAN_MS = 10_000;
const BT_READY_TIMEOUT_MS = 8_000;

/**
 * Scans for `OVR_Velocity*` names for `timeoutMs`. `onFound` gets each new
 * name once. Resolves with every name seen; rejects if Bluetooth never turns
 * on or the scan fails. Call the returned `stop` to end early.
 */
export function scanOvrSensors(
  onFound: (name: string) => void,
  timeoutMs = OVR_SCAN_MS,
): { done: Promise<string[]>; stop: () => void } {
  const seen = new Set<string>();

  if (shouldUseFakeOvr()) {
    const timer = setTimeout(() => {
      seen.add('OVR_Velocity-FAKE');
      onFound('OVR_Velocity-FAKE');
    }, 300);
    let resolve!: (v: string[]) => void;
    const done = new Promise<string[]>(r => {
      resolve = r;
      setTimeout(() => r([...seen]), 600);
    });
    return { done, stop: () => { clearTimeout(timer); resolve([...seen]); } };
  }

  let stopped = false;
  let finish: () => void = () => {};
  const done = new Promise<string[]>((resolve, reject) => {
    let mgr: ReturnType<typeof getBleManager>;
    try {
      mgr = getBleManager();
    } catch (e) {
      reject(e);
      return;
    }
    let stateSub: Subscription | null = null;
    let scanTimer: ReturnType<typeof setTimeout> | null = null;
    let btTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      stopped = true;
      if (scanTimer) clearTimeout(scanTimer);
      if (btTimer) clearTimeout(btTimer);
      stateSub?.remove();
      Promise.resolve(mgr.stopDeviceScan()).catch(() => {});
      fn();
    };
    finish = () => settle(() => resolve([...seen]));

    const startScan = () => {
      if (stopped) return;
      scanTimer = setTimeout(() => settle(() => resolve([...seen])), timeoutMs);
      Promise.resolve(
        mgr.startDeviceScan(null, { allowDuplicates: false }, (err, d) => {
          if (settled) return;
          if (err) return settle(() => reject(err));
          const name = d?.name ?? d?.localName;
          if (!name || !matchesOvrName(name) || seen.has(name)) return;
          seen.add(name);
          onFound(name);
        }),
      ).catch(err => settle(() => reject(err)));
    };

    btTimer = setTimeout(
      () => settle(() => reject(new Error('Bluetooth is off or not allowed for ASP Boost.'))),
      BT_READY_TIMEOUT_MS,
    );
    let started = false;
    stateSub = mgr.onStateChange(state => {
      if (state === 'PoweredOn' && !started) {
        started = true;
        if (btTimer) clearTimeout(btTimer);
        stateSub?.remove();
        stateSub = null;
        startScan();
      }
    }, true);
    // The initial state can be emitted synchronously, before stateSub is set.
    if (started && stateSub) {
      stateSub.remove();
      stateSub = null;
    }
  });

  return { done, stop: () => finish() };
}
