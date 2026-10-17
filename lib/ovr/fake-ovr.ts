/**
 * Fake OVR sensor for the simulator / dev builds. Same interface as the
 * BLE device; reps come from `emitRep()` (tests, dev buttons) or
 * `autoRun()` (a timed set). Power follows load × g × velocity, like the
 * real sensor.
 */

import type { OvrRep } from './protocol';
import type {
  OvrConnState,
  OvrDevice,
  OvrRepListener,
  OvrStateListener,
  OvrStatus,
} from './ovr-device';

const LB_TO_KG = 0.45359237;
const G = 9.81;
const DEFAULT_LOAD_LB = 135;

export class FakeOvrDevice implements OvrDevice {
  state: OvrConnState = 'idle';
  error?: string;
  deviceName?: string;
  /** Last load written, for dev UI / tests. */
  load: number | null = null;

  private repListeners = new Set<OvrRepListener>();
  private stateListeners = new Set<OvrStateListener>();
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private dropTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(namePrefixOrExactName?: string): Promise<void> {
    this.deviceName =
      namePrefixOrExactName && namePrefixOrExactName !== 'OVR_Velocity'
        ? namePrefixOrExactName
        : 'OVR_Velocity-FAKE';
    this.setState('connecting');
    this.setState('connected');
  }

  disconnect(): void {
    this.stopAutoRun();
    if (this.dropTimer) {
      clearTimeout(this.dropTimer);
      this.dropTimer = null;
    }
    this.setState('idle');
  }

  async writeLoad(lb: number): Promise<void> {
    this.load = lb;
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

  /** Simulate a sensor drop: `reconnecting` for `ms`, then `connected` again. */
  simulateDrop(ms = 2000): void {
    if (this.state !== 'connected') return;
    this.setState('reconnecting');
    if (this.dropTimer) clearTimeout(this.dropTimer);
    this.dropTimer = setTimeout(() => {
      this.dropTimer = null;
      if (this.state === 'reconnecting') this.setState('connected');
    }, ms);
  }

  /** Emit one rep (defaults: a plausible ~0.8 m/s squat rep at the current
   *  load). Like the real sensor, nothing is emitted unless connected. */
  emitRep(partial: Partial<OvrRep> = {}): OvrRep | null {
    if (this.state !== 'connected') return null;
    const meanV = partial.meanV ?? 0.8;
    const peakV = partial.peakV ?? round2(meanV * 1.6);
    const romIn = partial.romIn ?? 24;
    const newtons = (this.load ?? DEFAULT_LOAD_LB) * LB_TO_KG * G;
    const rep: OvrRep = {
      concentricS: partial.concentricS ?? round2((romIn * 0.0254) / meanV),
      romIn,
      meanV,
      peakV,
      meanPowerW: partial.meanPowerW ?? Math.round(newtons * meanV),
      peakPowerW: partial.peakPowerW ?? Math.round(newtons * peakV),
    };
    const at = Date.now();
    this.repListeners.forEach((cb) => {
      try {
        cb(rep, at);
      } catch (e) {
        console.warn('[ovr-fake] rep listener threw', e);
      }
    });
    return rep;
  }

  /** Emit `n` reps every `intervalMs`, velocity dropping ~3% per rep.
   *  Ticks while not connected are skipped (not counted). Returns a stop fn. */
  autoRun(n: number, intervalMs = 2500): () => void {
    this.stopAutoRun();
    let i = 0;
    const startV = 0.85 + Math.random() * 0.1;
    this.autoTimer = setInterval(() => {
      if (i >= n) {
        this.stopAutoRun();
        return;
      }
      if (this.emitRep({ meanV: round2(startV * Math.pow(0.97, i)) })) i++;
    }, intervalMs);
    return () => this.stopAutoRun();
  }

  stopAutoRun(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  private setState(state: OvrConnState, error?: string): void {
    this.state = state;
    this.error = error;
    const status: OvrStatus = { state, error, deviceName: this.deviceName };
    this.stateListeners.forEach((cb) => {
      try {
        cb(status);
      } catch (e) {
        console.warn('[ovr-fake] state listener threw', e);
      }
    });
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
