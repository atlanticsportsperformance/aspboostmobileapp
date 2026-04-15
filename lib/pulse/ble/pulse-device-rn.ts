/**
 * PulseDeviceRN — React Native twin of the web PulseDevice class.
 *
 * Wraps react-native-ble-plx (CoreBluetooth on iOS, BluetoothGatt on Android)
 * behind the same API surface the web class exposes, so pulse-sync.ts and
 * hooks.ts can be shared with minimal tweaks.
 *
 * Hard requirements:
 *   - Must NOT run in Expo Go — this file imports react-native-ble-plx,
 *     which needs native linking. Use EAS Dev Client.
 *   - iOS: NSBluetoothAlwaysUsageDescription must be set (the
 *     @config-plugins/react-native-ble-plx plugin wires it via app.json).
 */

import {
  BleManager,
  type Device,
  type Subscription,
  type Characteristic,
  type BleError,
  State as BleState,
  LogLevel,
} from 'react-native-ble-plx';
import { PULSE } from './constants';

// ────────────────────────────────────────────────────────────────────
// base64 <-> byte helpers (Hermes ships atob/btoa on RN 0.74+)
// ────────────────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

function byteToBase64(b: number): string {
  return bytesToBase64(new Uint8Array([b & 0xff]));
}

// ────────────────────────────────────────────────────────────────────
// Singleton BleManager — ble-plx wants exactly one per app
//
// Wrapped in try/catch because ble-plx throws at construction time when
// running inside Expo Go (no native linking). We surface a friendlier
// error instead of a raw module crash.
// ────────────────────────────────────────────────────────────────────

const NOT_LINKED_MSG =
  'Bluetooth requires a dev build. Run `npx expo run:ios` or install the TestFlight build — Expo Go does not include Bluetooth.';

let _manager: BleManager | null = null;
let _managerError: Error | null = null;

function getManager(): BleManager {
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

// ────────────────────────────────────────────────────────────────────
// Event shim — tiny observer pattern, no EventTarget dependency
// ────────────────────────────────────────────────────────────────────

export type PulseEvent = 'counter' | 'packet' | 'battery' | 'disconnect';
type Listener = (detail: any) => void;

// ────────────────────────────────────────────────────────────────────
// PulseDeviceRN
// ────────────────────────────────────────────────────────────────────

export class PulseDeviceRN {
  readonly device: Device;
  private listeners: { [E in PulseEvent]?: Set<Listener> } = {};
  private counterSub: Subscription | null = null;
  private dataSub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;

  // Match web interface shape
  public name: string;
  public connected = false;

  constructor(device: Device) {
    this.device = device;
    this.name = device.name ?? device.localName ?? 'Pulse';
  }

  // ─── Scanner ───
  static async request(timeoutMs = 10_000): Promise<PulseDeviceRN> {
    const mgr = getManager();

    // Wait for BLE to be powered on
    const state = await mgr.state();
    if (state !== BleState.PoweredOn) {
      await new Promise<void>((resolve, reject) => {
        const sub = mgr.onStateChange((s) => {
          if (s === BleState.PoweredOn) {
            sub.remove();
            resolve();
          } else if (s === BleState.Unsupported || s === BleState.Unauthorized) {
            sub.remove();
            reject(new Error(`Bluetooth ${s}`));
          }
        }, true);
      });
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        mgr.stopDeviceScan();
        reject(new Error('No Pulse found — make sure the sensor is on and nearby.'));
      }, timeoutMs);

      // Pulse 2.0 does NOT advertise its custom service UUID — it only puts it in
      // the GATT after connect. So we must scan unfiltered and match by name,
      // matching the working bleak/noble scripts in /Users/maxsmac/Desktop/motus.
      mgr.startDeviceScan(
        null,
        { allowDuplicates: false },
        (err, device) => {
          if (err) {
            clearTimeout(timer);
            mgr.stopDeviceScan();
            reject(err);
            return;
          }
          if (!device) return;
          const candidate = (device.name ?? device.localName ?? '').toLowerCase();
          if (candidate.includes('pulse') || candidate.includes('motus')) {
            clearTimeout(timer);
            mgr.stopDeviceScan();
            resolve(new PulseDeviceRN(device));
          }
        },
      );
    });
  }

  // ─── Connect + subscribe ───
  async connect(): Promise<void> {
    const connected = await this.device.connect({ requestMTU: 247 });
    await connected.discoverAllServicesAndCharacteristics();
    this.connected = true;

    const CTRL = PULSE.CONTROL_SERVICE_UUID;

    // Counter notify → uint16 LE → emit
    this.counterSub = connected.monitorCharacteristicForService(
      CTRL,
      PULSE.COUNTER_CHAR_UUID,
      (err, ch) => {
        if (err) return this._handleError(err);
        if (!ch?.value) return;
        const bytes = base64ToBytes(ch.value);
        if (bytes.length >= 2) {
          const counter = bytes[0] | (bytes[1] << 8);
          this._emit('counter', counter);
        }
      },
    );

    // Data stream notify → DataView (wrap bytes buffer) → emit
    this.dataSub = connected.monitorCharacteristicForService(
      CTRL,
      PULSE.DATA_CHAR_UUID,
      (err, ch) => {
        if (err) return this._handleError(err);
        if (!ch?.value) return;
        const bytes = base64ToBytes(ch.value);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this._emit('packet', view);
      },
    );

    // Disconnect watcher
    this.disconnectSub = connected.onDisconnected(() => {
      this.connected = false;
      this._emit('disconnect', undefined);
    });
  }

  // ─── Reads ───
  async readCounter(): Promise<number> {
    const ch = await this.device.readCharacteristicForService(
      PULSE.CONTROL_SERVICE_UUID,
      PULSE.COUNTER_CHAR_UUID,
    );
    const bytes = ch.value ? base64ToBytes(ch.value) : new Uint8Array();
    if (bytes.length < 2) return 0;
    return bytes[0] | (bytes[1] << 8);
  }

  async readBattery(): Promise<number> {
    // ble-plx accepts standard 16-bit UUIDs expanded to full 128-bit form
    const BATTERY_SVC = '0000180f-0000-1000-8000-00805f9b34fb';
    const BATTERY_LVL = '00002a19-0000-1000-8000-00805f9b34fb';
    try {
      const ch: Characteristic = await this.device.readCharacteristicForService(
        BATTERY_SVC,
        BATTERY_LVL,
      );
      const bytes = ch.value ? base64ToBytes(ch.value) : new Uint8Array();
      return bytes.length >= 1 ? bytes[0] : 0;
    } catch {
      return 0;
    }
  }

  // ─── Write ───
  async writeCmd(byte: number): Promise<void> {
    await this.device.writeCharacteristicWithResponseForService(
      PULSE.CONTROL_SERVICE_UUID,
      PULSE.CMD_CHAR_UUID,
      byteToBase64(byte),
    );
  }

  // ─── Flash wipe helper (matches web shape) ───
  async wipeFlashAfterSync(): Promise<void> {
    await this.writeCmd(0x04);
  }

  // ─── Disconnect ───
  disconnect(): void {
    this.counterSub?.remove();
    this.dataSub?.remove();
    this.disconnectSub?.remove();
    this.counterSub = null;
    this.dataSub = null;
    this.disconnectSub = null;
    this.device.cancelConnection().catch(() => {});
    this.connected = false;
  }

  // ─── Observer pattern (nano-events) ───
  on(event: PulseEvent, cb: Listener): () => void {
    const set = (this.listeners[event] ??= new Set());
    set.add(cb);
    return () => set.delete(cb);
  }

  // Web-style addEventListener alias so hooks.ts can stay almost identical
  addEventListener(event: PulseEvent, cb: Listener): void {
    (this.listeners[event] ??= new Set()).add(cb);
  }

  removeEventListener(event: PulseEvent, cb: Listener): void {
    this.listeners[event]?.delete(cb);
  }

  private _emit(event: PulseEvent, detail: any): void {
    this.listeners[event]?.forEach((cb) => {
      try {
        cb(detail);
      } catch (e) {
        console.warn(`[pulse] listener for ${event} threw`, e);
      }
    });
  }

  private _handleError(err: BleError): void {
    console.warn('[pulse-rn] characteristic error', err.message);
  }

  // Static helper so hooks.ts can check support the same way as web.
  // Returns false when ble-plx is not linked (e.g. Expo Go) so the UI can
  // show a friendly message instead of letting the user hit Connect and
  // crash.
  static isSupported(): boolean {
    try {
      getManager();
      return true;
    } catch {
      return false;
    }
  }
}
