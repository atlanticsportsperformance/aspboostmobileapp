/**
 * Shared Bluetooth permission / state utility.
 *
 * Wraps a single `BleManager` for permission probing across the app so the
 * ArmCare wizard, Pulse wizard, and Settings sheet all read the same
 * source of truth without spinning up their own managers. Drivers
 * (Activ5DeviceRN, the Pulse driver) keep their own managers for actual
 * device I/O — that's fine; ble-plx allows multiple managers.
 *
 * iOS reality check: we cannot programmatically toggle the system
 * Bluetooth radio or grant our own permission. The best we can do is:
 *   1. Detect the current state via ble-plx.
 *   2. Listen for state changes (e.g. user flips it from Settings or
 *      Control Center) so the UI auto-advances.
 *   3. Deep-link to the app's Settings page so the user can grant
 *      permission with one tap from our sheet.
 */

import { Linking, Platform } from 'react-native';
import { BleManager, State as BleState, Subscription } from 'react-native-ble-plx';

export type BluetoothPermissionState =
  | 'on' // PoweredOn — fully ready
  | 'off' // PoweredOff — system Bluetooth is disabled
  | 'unauthorized' // user denied app permission OR not yet requested in some cases
  | 'resetting' // ble stack restarting; transient
  | 'unsupported' // hardware doesn't support BLE (sims, very old phones)
  | 'unknown' // state hasn't been emitted yet
  | 'native-missing'; // ble-plx couldn't construct (Expo Go, missing native build)

let _manager: BleManager | null = null;
let _nativeMissing = false;

function ensureManager(): BleManager | null {
  if (_nativeMissing) return null;
  if (!_manager) {
    try {
      _manager = new BleManager();
    } catch {
      // Happens when the app runs in Expo Go (no native ble-plx linkage)
      // or before a dev build is installed. Surface it as a distinct state
      // so the sheet can show the right message.
      _nativeMissing = true;
      return null;
    }
  }
  return _manager;
}

function mapBleState(s: BleState): BluetoothPermissionState {
  switch (s) {
    case BleState.PoweredOn:
      return 'on';
    case BleState.PoweredOff:
      return 'off';
    case BleState.Unauthorized:
      return 'unauthorized';
    case BleState.Resetting:
      return 'resetting';
    case BleState.Unsupported:
      return 'unsupported';
    case BleState.Unknown:
    default:
      return 'unknown';
  }
}

/**
 * Read the current state. Side-effect: instantiates BleManager on first
 * call which is what triggers the iOS permission prompt the FIRST time
 * the app ever needs Bluetooth — so call this only when the user has
 * agreed to a "We need Bluetooth" rationale.
 */
export async function getBluetoothState(): Promise<BluetoothPermissionState> {
  const mgr = ensureManager();
  if (!mgr) return 'native-missing';
  try {
    const s = await mgr.state();
    return mapBleState(s);
  } catch {
    return 'unknown';
  }
}

/**
 * Subscribe to state changes. Returns an unsubscribe function. When
 * `emitCurrent` is true (default) the callback fires immediately with
 * the current state.
 */
export function onBluetoothStateChange(
  cb: (state: BluetoothPermissionState) => void,
  emitCurrent = true,
): () => void {
  const mgr = ensureManager();
  if (!mgr) {
    cb('native-missing');
    return () => {};
  }
  const sub: Subscription = mgr.onStateChange((s) => {
    cb(mapBleState(s));
  }, emitCurrent);
  return () => sub.remove();
}

/**
 * Deep-link to the app's Settings page (iOS) or app info page (Android).
 * Returns `true` if the link opened successfully.
 */
export async function openBluetoothSettings(): Promise<boolean> {
  try {
    if (Platform.OS === 'ios') {
      await Linking.openURL('app-settings:');
    } else {
      await Linking.openSettings();
    }
    return true;
  } catch {
    return false;
  }
}
