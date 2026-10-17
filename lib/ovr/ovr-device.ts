/**
 * OVR Velocity rack sensor over BLE (react-native-ble-plx).
 *
 * The rack iPad owns the sensor: scan by name, connect, subscribe to the
 * rep characteristic, emit parsed + deduped reps, write the bar load to
 * slot 1, and auto-reconnect with backoff while the sensor is wanted.
 * The sensor allows one client at a time; it re-sends its last rep on
 * reconnect, which the deduper drops.
 *
 * Only type imports from ble-plx so this is testable with a mocked manager.
 * Protocol facts: motus/ovr/HANDOFF.md.
 */

import type { BleError, Device, Subscription } from 'react-native-ble-plx';
import { getBleManager } from '../ble/manager';
import { backoffMs, connectWithRetry, describeBleError } from '../ble/connect';
import { createRepDeduper, encodeLoad, parseRep, type OvrRep } from './protocol';
import { FakeOvrDevice } from './fake-ovr';

// ─── Protocol constants (HANDOFF §1) ───

export const OVR = {
  NAME_PREFIX: 'OVR_Velocity',
  SERVICE_UUID: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
  DATA_CHAR_UUID: '14001dc2-5089-47d3-84bc-7c3d418389aa',
  LOAD_CHAR_UUID: 'ba755038-b91d-4efb-9fce-b6ce2a9beb01', // slot 1
} as const;

// ─── Shared interface (real + fake) ───

export type OvrConnState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface OvrStatus {
  state: OvrConnState;
  error?: string;
  deviceName?: string;
}

export type OvrRepListener = (rep: OvrRep, receivedAtMs: number) => void;
export type OvrStateListener = (status: OvrStatus) => void;

export interface OvrDevice {
  readonly state: OvrConnState;
  readonly error?: string;
  readonly deviceName?: string;
  /** Exact name (e.g. `OVR_Velocity-6C8E`) matches only that sensor; no
   *  argument matches the first name starting with `OVR_Velocity`. */
  connect(namePrefixOrExactName?: string): Promise<void>;
  /** User disconnect: stops any reconnecting. */
  disconnect(): void;
  /** Write with response to slot 1. While disconnected the load is kept
   *  and written on the next connect. */
  writeLoad(lb: number): Promise<void>;
  onRep(cb: OvrRepListener): () => void;
  onState(cb: OvrStateListener): () => void;
}

export interface OvrDeviceOptions {
  /** How long one scan waits for the sensor before giving up. */
  scanTimeoutMs?: number;
  now?: () => number;
}

const DEFAULT_SCAN_TIMEOUT_MS = 15_000;

/** True when `name` is the sensor we are looking for. */
export function matchesOvrName(name: string | null | undefined, target?: string): boolean {
  if (!name) return false;
  if (!target || target === OVR.NAME_PREFIX) return name.startsWith(OVR.NAME_PREFIX);
  return name === target;
}

// ─── Real device ───

export class OvrBleDevice implements OvrDevice {
  state: OvrConnState = 'idle';
  error?: string;
  deviceName?: string;

  private repListeners = new Set<OvrRepListener>();
  private stateListeners = new Set<OvrStateListener>();
  private readonly dedupe = createRepDeduper();
  private readonly scanTimeoutMs: number;
  private readonly now: () => number;

  /** Bumped on every user connect/disconnect; stale async work checks it. */
  private gen = 0;
  private wanted = false;
  private target?: string;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private device: Device | null = null;
  private dataSub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private connectedAtMs = 0;
  private desiredLoad: number | null = null;

  constructor(opts: OvrDeviceOptions = {}) {
    this.scanTimeoutMs = opts.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  async connect(namePrefixOrExactName?: string): Promise<void> {
    this.teardown();
    const gen = ++this.gen;
    this.wanted = true;
    this.target = namePrefixOrExactName;
    this.attempt = 0;
    this.deviceName = undefined;
    try {
      await this.establish(gen, 'scanning');
    } catch (err) {
      if (gen !== this.gen) return;
      // First connect failed: surface it, stop wanting the sensor.
      this.wanted = false;
      this.teardown();
      this.setState('error', describeBleError(err).message);
    }
  }

  disconnect(): void {
    this.gen++;
    this.wanted = false;
    this.teardown();
    this.setState('idle');
  }

  async writeLoad(lb: number): Promise<void> {
    this.desiredLoad = lb;
    if (this.state !== 'connected' || !this.device) return;
    await this.device.writeCharacteristicWithResponseForService(
      OVR.SERVICE_UUID,
      OVR.LOAD_CHAR_UUID,
      encodeLoad(lb),
    );
  }

  onRep(cb: OvrRepListener): () => void {
    this.repListeners.add(cb);
    return () => {
      this.repListeners.delete(cb);
    };
  }

  onState(cb: OvrStateListener): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  // ─── internals ───

  /** Scan → connect → discover → subscribe. Throws on failure. */
  private async establish(gen: number, scanState: 'scanning' | 'reconnecting'): Promise<void> {
    const mgr = getBleManager();
    this.setState(scanState);

    const ble = String(await mgr.state());
    if (gen !== this.gen) return;
    if (ble === 'PoweredOff') throw new Error('Bluetooth is off. Turn it on and try again.');
    if (ble === 'Unauthorized') throw new Error('Bluetooth permission denied — allow it in Settings.');
    if (ble === 'Unsupported') throw new Error('Bluetooth is not supported on this device.');

    const found = await this.scan(gen);
    if (gen !== this.gen || !found) return;

    if (scanState === 'scanning') this.setState('connecting');
    const connected = await connectWithRetry(found);
    if (gen !== this.gen) {
      connected.cancelConnection().catch(() => {});
      return;
    }
    await connected.discoverAllServicesAndCharacteristics();
    if (gen !== this.gen) {
      connected.cancelConnection().catch(() => {});
      return;
    }

    this.device = connected;
    this.deviceName = connected.name ?? connected.localName ?? found.name ?? undefined;
    // Reconnects must find this same sensor, not whichever OVR is nearest.
    if (this.deviceName) this.target = this.deviceName;
    this.connectedAtMs = this.now();

    this.disconnectSub = connected.onDisconnected(() => this.handleDrop(gen));
    this.dataSub = connected.monitorCharacteristicForService(
      OVR.SERVICE_UUID,
      OVR.DATA_CHAR_UUID,
      (err: BleError | null, ch) => {
        // Monitor errors also fire on disconnect; onDisconnected handles that.
        if (err || !ch?.value || gen !== this.gen) return;
        this.handlePacket(ch.value);
      },
    );

    this.attempt = 0;
    this.setState('connected');

    if (this.desiredLoad !== null) {
      try {
        await this.writeLoad(this.desiredLoad);
      } catch (e) {
        console.warn('[ovr] load write on connect failed', e);
      }
    }
  }

  private scan(gen: number): Promise<Device | null> {
    const mgr = getBleManager();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        Promise.resolve(mgr.stopDeviceScan()).catch(() => {});
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error('No OVR sensor found — make sure it is on and not connected to another device.'))),
        this.scanTimeoutMs,
      );
      // The sensor's service UUID isn't known to be advertised; match by name.
      Promise.resolve(
        mgr.startDeviceScan(null, { allowDuplicates: false }, (err, d) => {
          if (gen !== this.gen) return finish(() => resolve(null));
          if (err) return finish(() => reject(err));
          if (!d) return;
          if (matchesOvrName(d.name ?? d.localName, this.target)) finish(() => resolve(d));
        }),
      ).catch((err) => finish(() => reject(err)));
    });
  }

  private handlePacket(value: string): void {
    let rep: OvrRep;
    try {
      rep = parseRep(value);
    } catch (e) {
      console.warn('[ovr] bad rep packet', e);
      return;
    }
    const nowMs = this.now();
    if (this.dedupe(rep, this.connectedAtMs, nowMs)) return;
    this.repListeners.forEach((cb) => {
      try {
        cb(rep, nowMs);
      } catch (e) {
        console.warn('[ovr] rep listener threw', e);
      }
    });
  }

  /** Unexpected disconnect from the sensor side. */
  private handleDrop(gen: number): void {
    if (gen !== this.gen) return;
    this.removeSubs();
    this.device = null;
    if (!this.wanted) {
      this.setState('idle');
      return;
    }
    this.setState('reconnecting');
    this.scheduleRetry(gen);
  }

  private scheduleRetry(gen: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = backoffMs(this.attempt++);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (gen !== this.gen || !this.wanted) return;
      try {
        await this.establish(gen, 'reconnecting');
      } catch (err) {
        if (gen !== this.gen || !this.wanted) return;
        this.removeSubs();
        if (this.device) this.device.cancelConnection().catch(() => {});
        this.device = null;
        this.setState('reconnecting', describeBleError(err).message);
        this.scheduleRetry(gen);
      }
    }, delay);
  }

  private removeSubs(): void {
    this.dataSub?.remove();
    this.disconnectSub?.remove();
    this.dataSub = null;
    this.disconnectSub = null;
  }

  private teardown(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    try {
      Promise.resolve(getBleManager().stopDeviceScan()).catch(() => {});
    } catch {
      // manager unavailable (Expo Go) — nothing to stop
    }
    this.removeSubs();
    const d = this.device;
    this.device = null;
    if (d) d.cancelConnection().catch(() => {});
  }

  private setState(state: OvrConnState, error?: string): void {
    this.state = state;
    this.error = error;
    const status: OvrStatus = { state, error, deviceName: this.deviceName };
    this.stateListeners.forEach((cb) => {
      try {
        cb(status);
      } catch (e) {
        console.warn('[ovr] state listener threw', e);
      }
    });
  }
}

// ─── Factory ───

let devFakeToggle = false;

/** Dev-only switch: use the fake sensor on a real device in __DEV__. */
export function setOvrDevFakeToggle(on: boolean): void {
  devFakeToggle = on;
}

/** Fake when running in the simulator, or in __DEV__ with the dev toggle on. */
export function shouldUseFakeOvr(): boolean {
  let simulator = false;
  try {
    // Lazy so node tests don't load the native module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    simulator = require('expo-device').isDevice === false;
  } catch {
    simulator = false;
  }
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  return simulator || (dev && devFakeToggle);
}

export function createOvrDevice(
  opts: { fake?: boolean } & OvrDeviceOptions = {},
): OvrDevice {
  const fake = opts.fake ?? shouldUseFakeOvr();
  return fake ? new FakeOvrDevice() : new OvrBleDevice(opts);
}
