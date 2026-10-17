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
   *  argument matches the first name starting with `OVR_Velocity`. Keeps
   *  retrying with backoff (state `reconnecting`) until `disconnect()`. */
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

/** A failure retrying can't fix (no BLE hardware, ble-plx not linked). */
class OvrTerminalError extends Error {}

const BT_READY_TIMEOUT_MS = 10_000;
const LOAD_RETRY_MS = 500;

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
  private loadRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Settles the in-flight scan (clears its timer, stops only that scan). */
  private cancelScan: (() => void) | null = null;
  /** Settles the in-flight wait for Bluetooth PoweredOn. */
  private cancelBtWait: (() => void) | null = null;
  /** Peripheral mid-connect, so teardown can release the one-client sensor. */
  private pending: Device | null = null;
  private device: Device | null = null;
  private dataSub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private connectedAtMs = 0;
  private desiredLoad: number | null = null;

  constructor(opts: OvrDeviceOptions = {}) {
    this.scanTimeoutMs = opts.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Connects, and keeps retrying with backoff until `disconnect()`. */
  async connect(namePrefixOrExactName?: string): Promise<void> {
    this.teardown();
    const gen = ++this.gen;
    this.wanted = true;
    this.target = namePrefixOrExactName;
    this.attempt = 0;
    this.deviceName = undefined;
    this.error = undefined;
    try {
      await this.establish(gen, 'scanning');
    } catch (err) {
      this.attemptFailed(gen, err);
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

  /** Wait for BLE → scan → connect → discover → subscribe. Throws on failure. */
  private async establish(gen: number, scanState: 'scanning' | 'reconnecting'): Promise<void> {
    let mgr: ReturnType<typeof getBleManager>;
    try {
      mgr = getBleManager();
    } catch (e) {
      throw new OvrTerminalError(e instanceof Error ? e.message : String(e));
    }
    this.setState(scanState);

    await this.waitPoweredOn(gen, mgr);
    if (gen !== this.gen) return;

    const found = await this.scan(gen, mgr);
    if (gen !== this.gen || !found) return;

    if (scanState === 'scanning') this.setState('connecting');
    this.pending = found;
    let connected: Device;
    try {
      connected = await connectWithRetry(found);
      if (gen !== this.gen) {
        connected.cancelConnection().catch(() => {});
        return;
      }
      await connected.discoverAllServicesAndCharacteristics();
    } catch (e) {
      if (this.pending === found) {
        found.cancelConnection().catch(() => {});
        this.pending = null;
      }
      throw e;
    }
    if (this.pending === found) this.pending = null;
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
    this.writeLoadOnConnect(gen);
  }

  /** Rewrite the remembered load; one retry, then surface the failure. */
  private writeLoadOnConnect(gen: number): void {
    if (this.desiredLoad === null) return;
    const failed = (e: unknown) => {
      if (gen !== this.gen || this.state !== 'connected') return;
      this.setState('connected', `Load write failed: ${describeBleError(e).message}`);
    };
    this.writeLoad(this.desiredLoad).catch(() => {
      if (gen !== this.gen) return;
      this.loadRetryTimer = setTimeout(() => {
        this.loadRetryTimer = null;
        if (gen !== this.gen || this.desiredLoad === null) return;
        this.writeLoad(this.desiredLoad).catch(failed);
      }, LOAD_RETRY_MS);
    });
  }

  /** Resolve once BLE is PoweredOn; Unsupported is terminal; else time out. */
  private waitPoweredOn(gen: number, mgr: ReturnType<typeof getBleManager>): Promise<void> {
    return new Promise((resolve, reject) => {
      let last = 'Unknown';
      let done = false;
      let sub: { remove: () => void } | null = null;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sub?.remove();
        if (this.cancelBtWait === cancel) this.cancelBtWait = null;
        fn();
      };
      const cancel = () => finish(resolve);
      this.cancelBtWait = cancel;
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new Error(
                last === 'PoweredOff'
                  ? 'Bluetooth is off. Turn it on and try again.'
                  : last === 'Unauthorized'
                    ? 'Bluetooth permission denied — allow it in Settings.'
                    : `Bluetooth not ready (${last}).`,
              ),
            ),
          ),
        BT_READY_TIMEOUT_MS,
      );
      sub = mgr.onStateChange((s) => {
        last = String(s);
        if (gen !== this.gen) return finish(resolve);
        if (last === 'PoweredOn') finish(resolve);
        else if (last === 'Unsupported') {
          finish(() => reject(new OvrTerminalError('Bluetooth is not supported on this device.')));
        }
      }, true);
      if (done) sub.remove();
    });
  }

  private scan(gen: number, mgr: ReturnType<typeof getBleManager>): Promise<Device | null> {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (this.cancelScan === cancel) this.cancelScan = null;
        // Stops only this scan: finish runs once, and a newer generation's
        // connect() settles this scan before starting its own.
        Promise.resolve(mgr.stopDeviceScan()).catch(() => {});
        fn();
      };
      const cancel = () => finish(() => resolve(null));
      this.cancelScan = cancel;
      const timer = setTimeout(
        () => finish(() => reject(new Error('No OVR sensor found — make sure it is on and not connected to another device.'))),
        this.scanTimeoutMs,
      );
      // The sensor's service UUID isn't known to be advertised; match by name.
      Promise.resolve(
        mgr.startDeviceScan(null, { allowDuplicates: false }, (err, d) => {
          if (done) return;
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

  /** Any failed attempt (first or retry): back off and try again while wanted. */
  private attemptFailed(gen: number, err: unknown): void {
    if (gen !== this.gen || !this.wanted) return;
    const msg = describeBleError(err).message;
    this.removeSubs();
    if (this.device) this.device.cancelConnection().catch(() => {});
    this.device = null;
    if (err instanceof OvrTerminalError) {
      this.wanted = false;
      this.teardown();
      this.setState('error', msg);
      return;
    }
    this.setState('reconnecting', msg);
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
        this.attemptFailed(gen, err);
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
    if (this.loadRetryTimer) {
      clearTimeout(this.loadRetryTimer);
      this.loadRetryTimer = null;
    }
    // Settle only work this device owns; never stop someone else's scan.
    this.cancelBtWait?.();
    this.cancelScan?.();
    this.removeSubs();
    const p = this.pending;
    this.pending = null;
    if (p) p.cancelConnection().catch(() => {});
    const d = this.device;
    this.device = null;
    if (d) d.cancelConnection().catch(() => {});
  }

  /** Error is kept while still trying (scanning/connecting/reconnecting)
   *  so the reason stays visible; cleared on connected/idle unless given. */
  private setState(state: OvrConnState, error?: string): void {
    this.state = state;
    if (error !== undefined) this.error = error;
    else if (state === 'connected' || state === 'idle') this.error = undefined;
    const status: OvrStatus = { state, error: this.error, deviceName: this.deviceName };
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
