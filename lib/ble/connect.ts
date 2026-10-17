/**
 * Generic BLE helpers shared by Pulse and the OVR rack sensor:
 * base64 <-> bytes, BleError description, backoff schedule, and a
 * stale-cleanup + retry connect. Only type imports from ble-plx so the
 * pure helpers are unit-testable without native linking.
 */

import type { BleError, Device } from 'react-native-ble-plx';

// base64 <-> byte helpers (Hermes ships atob/btoa on RN 0.74+)

export function base64ToBytes(b64: string): Uint8Array {
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

export function byteToBase64(b: number): string {
  return bytesToBase64(new Uint8Array([b & 0xff]));
}

/** Reconnect backoff: min(500 * 2^attempt, 8000) ms, attempt starting at 0. */
export function backoffMs(attempt: number): number {
  return Math.min(500 * Math.pow(2, attempt), 8000);
}

/** Turn a raw BleError into a message carrying its reason + numeric codes,
 *  so "Device … connection failed" becomes diagnosable in the field. */
export function describeBleError(err: unknown): Error {
  if (err && typeof err === 'object' && 'errorCode' in err) {
    const be = err as BleError;
    const reason = be.reason ?? be.message ?? 'connection failed';
    const codes = [
      `BLE ${be.errorCode}`,
      be.iosErrorCode != null ? `iOS ${be.iosErrorCode}` : null,
      be.attErrorCode != null ? `ATT ${be.attErrorCode}` : null,
    ]
      .filter(Boolean)
      .join(' / ');
    return new Error(`${reason} (${codes})`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Establish the GATT connection with stale-connection cleanup, a hard
 * timeout, and one retry. iOS surfaces a generic "Device <id> connection
 * failed" (BleErrorCode 300) for a half-open connection left from a
 * previous session, or a transient first-attempt failure; cancelling first
 * and retrying once after a short pause clears most of these.
 */
export async function connectWithRetry(device: Device): Promise<Device> {
  // Clear any lingering OS-level connection to this peripheral first.
  try {
    if (await device.isConnected()) {
      await device.cancelConnection();
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {
    // best-effort — ignore
  }

  const ATTEMPTS = 2;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      // requestMTU is honored on Android and ignored on iOS (auto-negotiated);
      // timeout prevents a hung connect from spinning forever.
      return await device.connect({ requestMTU: 247, timeout: 12_000 });
    } catch (err) {
      lastErr = err;
      if (attempt < ATTEMPTS) {
        // Let CoreBluetooth release a half-open connection before retrying.
        try {
          await device.cancelConnection();
        } catch {
          // ignore
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  throw describeBleError(lastErr);
}
