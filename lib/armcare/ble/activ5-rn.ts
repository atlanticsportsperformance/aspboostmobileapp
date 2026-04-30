/**
 * Activ5DeviceRN — React Native BLE driver for the Activbody Activ5 sensor.
 *
 * Mirrors the web Activ5Sensor (Web Bluetooth) so the wizard logic can stay
 * the same shape on both platforms.
 *
 * Protocol (validated 0.9% vs ArmCare app on a WSPR2-IMU unit):
 *   - Service:    0xF0F0   (00f0f0... full UUID below)
 *   - Force char: 0xF0FE   (notify, 2 bytes = int16 LE = one raw sample @ 10 Hz)
 *   - Scale:      raw × 0.05907 = lbf
 *
 * Hard requirements:
 *   - Must NOT run in Expo Go — react-native-ble-plx needs native linking.
 *   - iOS: NSBluetoothAlwaysUsageDescription wired via @config-plugins.
 */

import {
  BleManager,
  type Device,
  type Subscription,
  State as BleState,
  LogLevel,
} from 'react-native-ble-plx';

export const ACTIV5 = {
  SERVICE_UUID: '0000f0f0-0000-1000-8000-00805f9b34fb',
  FORCE_CHAR_UUID: '0000f0fe-0000-1000-8000-00805f9b34fb',
  BATTERY_SERVICE_UUID: '0000180f-0000-1000-8000-00805f9b34fb',
  BATTERY_CHAR_UUID: '00002a19-0000-1000-8000-00805f9b34fb',
  // raw int16 × SCALE_LBF = lbf
  SCALE_LBF: 0.05907,
  SAMPLE_RATE_HZ: 10,
} as const;

// ────────────────────────────────────────────────────────────────────
// base64 ↔ bytes helpers (Hermes ships atob on RN 0.74+)
// ────────────────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Singleton BleManager (ble-plx wants exactly one per app)
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
// Public API
// ────────────────────────────────────────────────────────────────────

export interface Activ5Sample {
  raw: number; // int16, pre-tare, pre-scale
  lbf: number; // post-tare, post-scale
  t: number;   // ms since stream start (Date.now() basis)
}

export interface Activ5Info {
  name: string;
  batteryPercent?: number;
}

type Listener = (sample: Activ5Sample) => void;
type DisconnectListener = () => void;

export class Activ5DeviceRN {
  readonly device: Device;
  public name: string;
  public connected = false;

  private listeners = new Set<Listener>();
  private disconnectListeners = new Set<DisconnectListener>();
  private forceSub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private offset = 0;
  private streamStart = 0;

  constructor(device: Device) {
    this.device = device;
    this.name = device.name ?? device.localName ?? 'Activ5';
  }

  // Scan for an Activ5 by advertised name. Resolves with the first match.
  // Defensive: a previous failed request() may have left a scan running on
  // the singleton manager. Stop it first so we don't double-scan / double-
  // resolve when the user taps Connect again after a timeout.
  static async request(timeoutMs = 12_000): Promise<Activ5DeviceRN> {
    const mgr = getManager();
    try {
      mgr.stopDeviceScan();
    } catch {
      // ignore — first call has nothing to stop
    }

    const state = await mgr.state();
    if (state === BleState.PoweredOff) {
      throw new Error('Bluetooth is off. Turn it on in Settings and try again.');
    }
    if (state === BleState.Unsupported) {
      throw new Error('Bluetooth is not supported on this device.');
    }
    if (state === BleState.Unauthorized) {
      throw new Error('Bluetooth Unauthorized — grant permission in Settings.');
    }
    if (state !== BleState.PoweredOn) {
      await new Promise<void>((resolve, reject) => {
        const sub = mgr.onStateChange((s) => {
          if (s === BleState.PoweredOn) {
            sub.remove();
            resolve();
          } else if (
            s === BleState.PoweredOff ||
            s === BleState.Unsupported ||
            s === BleState.Unauthorized
          ) {
            sub.remove();
            reject(new Error(`Bluetooth ${s}`));
          }
        }, true);
      });
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        mgr.stopDeviceScan();
        reject(
          new Error(
            'No Activ5 found. Make sure the sensor is on and within range, then try again.',
          ),
        );
      }, timeoutMs);

      // Activ5 sensors advertise under several names depending on firmware/SKU:
      //   - "ACTIV5-AP-XXXX"        (Activbody original)
      //   - "ActivBody Activ5"      (newer SKU)
      //   - "WSPR2-IMU"             (newer rebranded units)
      // Some units also strip the name from the advertising packet entirely on
      // iOS, leaving only the F0F0 service UUID as a reliable signal. Match
      // on EITHER a known name pattern OR the service UUID.
      const SERVICE_UUID_LOWER = ACTIV5.SERVICE_UUID.toLowerCase();
      const SERVICE_SHORT = '0000f0f0';
      const NAME_PATTERNS = ['activ', 'wspr'];

      mgr.startDeviceScan(null, { allowDuplicates: false }, (err, device) => {
        if (err) {
          clearTimeout(timer);
          mgr.stopDeviceScan();
          reject(err);
          return;
        }
        if (!device) return;

        const rawName = device.name ?? device.localName ?? '';
        const candidate = rawName.toLowerCase();
        const services = (device.serviceUUIDs ?? []).map((s) => s.toLowerCase());

        const nameMatches = NAME_PATTERNS.some((p) => candidate.includes(p));
        const serviceMatches = services.some(
          (s) => s === SERVICE_UUID_LOWER || s.startsWith(SERVICE_SHORT),
        );

        // Visibility for diagnosing real-world advertisements. Filtered to
        // only print devices that have ANY identifier so we don't spam the
        // log with every empty advertisement on a busy floor.
        if (rawName || services.length > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[Activ5 scan] name="${rawName}" services=[${services.join(',')}] match=${nameMatches || serviceMatches}`,
          );
        }

        if (nameMatches || serviceMatches) {
          clearTimeout(timer);
          mgr.stopDeviceScan();
          resolve(new Activ5DeviceRN(device));
        }
      });
    });
  }

  // ─── Connect + subscribe to the force characteristic ───
  async connect(): Promise<Activ5Info> {
    const connected = await this.device.connect({ requestMTU: 64 });
    await connected.discoverAllServicesAndCharacteristics();
    this.connected = true;

    let batteryPercent: number | undefined;
    try {
      const ch = await connected.readCharacteristicForService(
        ACTIV5.BATTERY_SERVICE_UUID,
        ACTIV5.BATTERY_CHAR_UUID,
      );
      const bytes = ch.value ? base64ToBytes(ch.value) : new Uint8Array();
      if (bytes.length >= 1) batteryPercent = bytes[0];
    } catch {
      // battery is optional; keep going
    }

    this.disconnectSub = connected.onDisconnected(() => {
      this.connected = false;
      // Fire all subscribed disconnect listeners. Higher-level code (the
      // wizard) uses this to detect a silent mid-rep drop — without it,
      // a disconnect during rep-push is invisible and the rep saves a
      // peak of 0.
      for (const l of this.disconnectListeners) {
        try {
          l();
        } catch {
          // listener failure shouldn't bring down the device cleanup path
        }
      }
    });

    return { name: this.name, batteryPercent };
  }

  /**
   * Subscribe to disconnect events. Fires when the underlying BLE peripheral
   * drops the connection (sensor went to sleep, walked out of range, etc.).
   * Returns an unsubscribe function.
   */
  onDisconnect(listener: DisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  async startStreaming(): Promise<void> {
    if (!this.connected) throw new Error('Sensor not connected');
    this.streamStart = Date.now();
    this.forceSub = this.device.monitorCharacteristicForService(
      ACTIV5.SERVICE_UUID,
      ACTIV5.FORCE_CHAR_UUID,
      (err, ch) => {
        if (err) return;
        if (!ch?.value) return;
        const bytes = base64ToBytes(ch.value);
        if (bytes.length < 2) return;
        // little-endian signed int16
        let raw = bytes[0] | (bytes[1] << 8);
        if (raw > 32767) raw -= 65536;
        const lbf = (raw - this.offset) * ACTIV5.SCALE_LBF;
        const sample: Activ5Sample = {
          raw,
          lbf,
          t: Date.now() - this.streamStart,
        };
        for (const l of this.listeners) l(sample);
      },
    );
  }

  async stopStreaming(): Promise<void> {
    this.forceSub?.remove();
    this.forceSub = null;
  }

  /** Sample idle for `durationMs`, average raw values, store as offset. */
  async tare(durationMs = 2000): Promise<number> {
    const samples: number[] = [];
    const collect: Listener = (s) => samples.push(s.raw);
    this.listeners.add(collect);
    try {
      await new Promise((r) => setTimeout(r, durationMs));
    } finally {
      this.listeners.delete(collect);
    }
    if (samples.length === 0) {
      throw new Error(
        'No samples received during calibration. Make sure the sensor is on and try again.',
      );
    }
    this.offset = samples.reduce((a, b) => a + b, 0) / samples.length;
    return this.offset;
  }

  resetTare(): void {
    this.offset = 0;
  }

  getOffset(): number {
    return this.offset;
  }

  /** Subscribe to per-sample events. Returns an unsubscribe fn. */
  onSample(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async disconnect(): Promise<void> {
    await this.stopStreaming().catch(() => {});
    this.disconnectSub?.remove();
    this.disconnectSub = null;
    try {
      await this.device.cancelConnection();
    } catch {
      // already disconnected
    }
    this.connected = false;
    this.listeners.clear();
    this.disconnectListeners.clear();
    this.offset = 0;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
