/**
 * Singleton BleManager — ble-plx wants exactly one per app.
 *
 * Wrapped in try/catch because ble-plx throws at construction time when
 * running inside Expo Go (no native linking). We surface a friendlier
 * error instead of a raw module crash.
 */

import { BleManager, LogLevel } from 'react-native-ble-plx';

export const NOT_LINKED_MSG =
  'Bluetooth requires a dev build. Run `npx expo run:ios` or install the TestFlight build — Expo Go does not include Bluetooth.';

let _manager: BleManager | null = null;
let _managerError: Error | null = null;

export function getBleManager(): BleManager {
  if (_managerError) throw _managerError;
  if (!_manager) {
    try {
      _manager = new BleManager();
      _manager.setLogLevel(LogLevel.None);
    } catch {
      _managerError = new Error(NOT_LINKED_MSG);
      throw _managerError;
    }
  }
  return _manager;
}
