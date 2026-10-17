/**
 * OVR rack sensor protocol + rep rules. Pure: no BLE, no UI.
 * Rep packet = 12 bytes, 6 x little-endian uint16:
 * concentric /100 s, ROM /10 in, mean V /100 m/s, peak V /100 m/s,
 * mean power W, peak power W.
 */

import { base64ToBytes, bytesToBase64 } from '../ble/connect';

export interface OvrRep {
  concentricS: number;
  romIn: number;
  meanV: number;
  peakV: number;
  meanPowerW: number;
  peakPowerW: number;
}

export type Zone = 'in' | 'slow' | 'fast';

const REP_BYTES = 12;
const RECONNECT_DUP_WINDOW_MS = 1500;
const PARTIAL_ABS_IN = 8;
const PARTIAL_REL = 0.6;

export function parseRep(base64: string): OvrRep {
  const b = base64ToBytes(base64);
  if (b.length < REP_BYTES) {
    throw new Error(`OVR rep packet too short: ${b.length} bytes`);
  }
  const u16 = (i: number) => b[i * 2] | (b[i * 2 + 1] << 8);
  return {
    concentricS: u16(0) / 100,
    romIn: u16(1) / 10,
    meanV: u16(2) / 100,
    peakV: u16(3) / 100,
    meanPowerW: u16(4),
    peakPowerW: u16(5),
  };
}

/** Load as base64 of the ASCII integer string (rounded, clamped at 0). */
export function encodeLoad(lb: number): string {
  const n = Math.max(0, Math.round(Number.isFinite(lb) ? lb : 0));
  const s = String(n);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytesToBase64(bytes);
}

/**
 * The sensor re-sends its last rep right after a (re)connect. Skip a rep
 * identical to the previous one when it arrives within 1500 ms of connect.
 */
export function createRepDeduper(): (
  rep: OvrRep,
  connectedAtMs: number,
  nowMs: number,
) => boolean {
  let last: OvrRep | null = null;
  return (rep, connectedAtMs, nowMs) => {
    const same =
      last !== null &&
      last.concentricS === rep.concentricS &&
      last.romIn === rep.romIn &&
      last.meanV === rep.meanV &&
      last.peakV === rep.peakV &&
      last.meanPowerW === rep.meanPowerW &&
      last.peakPowerW === rep.peakPowerW;
    last = rep;
    return same && nowMs - connectedAtMs <= RECONNECT_DUP_WINDOW_MS;
  };
}

export function isPartial(romIn: number, medianRomIn: number | null): boolean {
  if (medianRomIn === null) return romIn < PARTIAL_ABS_IN;
  return romIn < PARTIAL_REL * medianRomIn;
}

export function dropPct(bestV: number, v: number): number {
  if (bestV <= 0) return 0;
  return Math.round(((bestV - v) / bestV) * 100);
}

export function zoneOf(
  v: number,
  min: number | null | undefined,
  max: number | null | undefined,
): Zone | null {
  if (min == null || max == null) return null;
  if (v < min) return 'slow';
  if (v > max) return 'fast';
  return 'in';
}
