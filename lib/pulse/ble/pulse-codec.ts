/**
 * Motus Pulse raw IMU → (torque, arm speed, arm slot) decoder.
 *
 * Ported verbatim from pulse_integration/FINAL_FORMULAS.md — LOOCV-validated
 * multi-feature regression on 20 real throws. Torque: 2.10% mean error,
 * 10/20 exact integer matches against Pulse's displayed value.
 *
 * This file is pure: no BLE, no React, no I/O. Unit-test friendly. Inputs are
 * raw 18-byte packets (as DataView) or pre-parsed Sample arrays. Output is
 * DecodedThrow with physical units.
 */

import {
  ACCEL_SCALE,
  GYRO_SCALE,
  PACKET_BYTES,
  PACKET_FIELDS,
  BIAS_SAMPLE_COUNT,
  MIN_CLIP_LENGTH,
} from './constants';

/** One raw IMU sample as stored on the sensor (int16 counts). */
export interface Sample {
  idx: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  ax2: number;
  ay2: number;
}

/** Physical-units decoded throw. */
export interface DecodedThrow {
  torqueNm: number;
  armSpeedDps: number;
  armSlotDeg: number;
  /** Driveline one-throw workload from torque + athlete anthropometry. */
  wThrow: number;
  /** How many clean samples the decoder used (diagnostic). */
  cleanSampleCount: number;
}

// ────────────────────────────────────────────────────────────────────
// 1. Packet parsing — 18 bytes, little-endian, as documented in PROTOCOL.md
// ────────────────────────────────────────────────────────────────────

/**
 * Parse a single 18-byte BLE data packet into a Sample.
 * Caller must guarantee `view.byteLength >= 18`.
 */
export function parsePacket(view: DataView): Sample {
  return {
    idx: view.getUint16(PACKET_FIELDS.SAMPLE_INDEX_OFFSET, true),
    ax: view.getInt16(PACKET_FIELDS.ACCEL_X_OFFSET, true),
    ay: view.getInt16(PACKET_FIELDS.ACCEL_Y_OFFSET, true),
    az: view.getInt16(PACKET_FIELDS.ACCEL_Z_OFFSET, true),
    gx: view.getInt16(PACKET_FIELDS.GYRO_X_OFFSET, true),
    gy: view.getInt16(PACKET_FIELDS.GYRO_Y_OFFSET, true),
    gz: view.getInt16(PACKET_FIELDS.GYRO_Z_OFFSET, true),
    ax2: view.getInt16(PACKET_FIELDS.ACCEL_X2_OFFSET, true),
    ay2: view.getInt16(PACKET_FIELDS.ACCEL_Y2_OFFSET, true),
  };
}

/** Parse a concatenated byte buffer of N*18-byte packets into Samples. */
export function parseBuffer(buf: ArrayBuffer): Sample[] {
  const view = new DataView(buf);
  const count = Math.floor(buf.byteLength / PACKET_BYTES);
  const out: Sample[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const sub = new DataView(buf, i * PACKET_BYTES, PACKET_BYTES);
    out[i] = parsePacket(sub);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// 2. Junk / sentinel filtering
//
// Every clip in cmd 0x01 ends with a "sentinel" marker. A naive max(|ω|) over
// the raw stream finds the sentinel value and produces garbage. These three
// predicates match the reference decoder in pulse_integration/FINAL_FORMULAS.md.
// ────────────────────────────────────────────────────────────────────

export function isSentinel(s: Sample): boolean {
  return s.gz > 29000 && s.gz < 31000 && Math.abs(s.gx) < 500;
}

export function isFill(s: Sample): boolean {
  // 0x1414 on both gyro x and y = unwritten flash
  return s.gx === 5140 && s.gy === 5140;
}

export function isZero(s: Sample): boolean {
  return s.gx === 0 && s.gy === 0 && s.gz === 0;
}

export function isJunk(s: Sample): boolean {
  return isSentinel(s) || isFill(s) || isZero(s);
}

/**
 * Split a bulk-sync stream into per-throw clips at sentinel boundaries.
 * Each clip returned is the raw samples BEFORE the sentinel (sentinels stripped).
 */
export function splitBySentinel(stream: readonly Sample[]): Sample[][] {
  const clips: Sample[][] = [];
  let current: Sample[] = [];
  for (const s of stream) {
    if (isSentinel(s)) {
      if (current.length > 0) {
        clips.push(current);
        current = [];
      }
      continue;
    }
    if (isFill(s) || isZero(s)) {
      // Fill/zero blocks are padding between clips — flush whatever we had.
      if (current.length > 0) {
        clips.push(current);
        current = [];
      }
      continue;
    }
    current.push(s);
  }
  if (current.length > 0) clips.push(current);
  return clips;
}

/** Strip any residual junk samples from a single clip. */
export function stripJunk(clip: readonly Sample[]): Sample[] {
  return clip.filter((s) => !isJunk(s));
}

// ────────────────────────────────────────────────────────────────────
// 3. Numeric helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Centered moving average over a window of size `w`. For `w=1` the signal is
 * returned unchanged. Edges are padded by clamping (standard SMA behavior).
 */
function smooth(arr: readonly number[], w: number): number[] {
  if (w <= 1) return arr.slice();
  const n = arr.length;
  const out = new Array<number>(n);
  const half = Math.floor(w / 2);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let sum = 0;
    let cnt = 0;
    for (let j = lo; j <= hi; j++) {
      sum += arr[j];
      cnt++;
    }
    out[i] = sum / cnt;
  }
  return out;
}

function peakAbs(arr: readonly number[], w = 1): number {
  const s = smooth(arr, w);
  let m = 0;
  for (let i = 0; i < s.length; i++) {
    const v = Math.abs(s[i]);
    if (v > m) m = v;
  }
  return m;
}

function peakMag2(a: readonly number[], b: readonly number[], w = 1): number {
  const sa = smooth(a, w);
  const sb = smooth(b, w);
  const n = Math.min(sa.length, sb.length);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const mag = Math.hypot(sa[i], sb[i]);
    if (mag > m) m = mag;
  }
  return m;
}

function peakMag3(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  w = 1,
): number {
  const sa = smooth(a, w);
  const sb = smooth(b, w);
  const sc = smooth(c, w);
  const n = Math.min(sa.length, sb.length, sc.length);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const mag = Math.hypot(sa[i], sb[i], sc[i]);
    if (mag > m) m = mag;
  }
  return m;
}

function mean(arr: readonly number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

// ────────────────────────────────────────────────────────────────────
// 4. Bias correction + unit conversion
// ────────────────────────────────────────────────────────────────────

interface PhysicalClip {
  gxR: number[]; // rad/s
  gyR: number[];
  gzR: number[];
  axM: number[]; // m/s²
  ayM: number[];
  azM: number[];
}

function toPhysicalUnits(clip: readonly Sample[]): PhysicalClip {
  const head = clip.slice(0, Math.min(BIAS_SAMPLE_COUNT, clip.length));
  const gxb = mean(head.map((s) => s.gx));
  const gyb = mean(head.map((s) => s.gy));
  const gzb = mean(head.map((s) => s.gz));
  const axb = mean(head.map((s) => s.ax));
  const ayb = mean(head.map((s) => s.ay));
  const azb = mean(head.map((s) => s.az));

  const n = clip.length;
  const gxR = new Array<number>(n);
  const gyR = new Array<number>(n);
  const gzR = new Array<number>(n);
  const axM = new Array<number>(n);
  const ayM = new Array<number>(n);
  const azM = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const s = clip[i];
    gxR[i] = (s.gx - gxb) * GYRO_SCALE;
    gyR[i] = (s.gy - gyb) * GYRO_SCALE;
    gzR[i] = (s.gz - gzb) * GYRO_SCALE;
    axM[i] = (s.ax - axb) * ACCEL_SCALE;
    ayM[i] = (s.ay - ayb) * ACCEL_SCALE;
    azM[i] = (s.az - azb) * ACCEL_SCALE;
  }
  return { gxR, gyR, gzR, axM, ayM, azM };
}

// ────────────────────────────────────────────────────────────────────
// 5. Production regression formulas
// (LOOCV on 20 throws, copied verbatim from FINAL_FORMULAS.md)
// ────────────────────────────────────────────────────────────────────

/**
 * Arm speed (deg/s). Mean error 1.26%, max 3.6%, Pearson r²=0.986.
 *
 *   speed = 6.687·peak|ω_z|_raw
 *         + 8.758·peak|ω_xyz|_raw
 *         + 3.253·peak|a_xy|_raw
 *         − 227.03
 */
export function armSpeedDps(p: PhysicalClip): number {
  const peakOmegaZ = peakAbs(p.gzR);
  const peakOmegaXYZ = peakMag3(p.gxR, p.gyR, p.gzR);
  const peakAxy = peakMag2(p.axM, p.ayM);
  return 6.687 * peakOmegaZ + 8.758 * peakOmegaXYZ + 3.253 * peakAxy - 227.03;
}

/**
 * Elbow valgus torque (Nm). Mean error 2.10%, 10/20 exact integer matches,
 * 16/20 within ±1 Nm, 19/20 within ±2 Nm.
 *
 *   τ = 0.522·peak|a_y_s3|
 *     + 0.964·peak|a_z_s3|
 *     − 1.445·peak|ω_xyz_s5|
 *     + 11.38
 */
export function elbowTorqueNm(p: PhysicalClip): number {
  const peakAy3 = peakAbs(p.ayM, 3);
  const peakAz3 = peakAbs(p.azM, 3);
  const peakOmegaXyz5 = peakMag3(p.gxR, p.gyR, p.gzR, 5);
  return 0.522 * peakAy3 + 0.964 * peakAz3 - 1.445 * peakOmegaXyz5 + 11.38;
}

// ────────────────────────────────────────────────────────────────────
// 6. Arm slot via quaternion integration
//
// Integrate angular velocity from rest → peak to get orientation at release,
// then compare the arrow axis to gravity to find how vertical the arm was.
// ────────────────────────────────────────────────────────────────────

type Quat = { w: number; x: number; y: number; z: number };

function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function quatFromAxisAngle(x: number, y: number, z: number, angleRad: number): Quat {
  const half = angleRad / 2;
  const s = Math.sin(half);
  return { w: Math.cos(half), x: x * s, y: y * s, z: z * s };
}

function quatConjugate(q: Quat): Quat {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

function quatRotate(q: Quat, v: [number, number, number]): [number, number, number] {
  // v' = q * v * q_conj
  const vq: Quat = { w: 0, x: v[0], y: v[1], z: v[2] };
  const r = quatMul(quatMul(q, vq), quatConjugate(q));
  return [r.x, r.y, r.z];
}

/**
 * Estimate arm slot (degrees above horizontal) from the integrated gyro
 * orientation at peak angular velocity. 90° = overhand, 45° = three-quarter,
 * 0° = sidearm.
 */
export function armSlotDeg(p: PhysicalClip, dtSec = 0.001): number {
  const n = p.gxR.length;
  if (n < 10) return 0;

  // Find the peak |ω_xyz| index — that's "release"
  let peakIdx = 0;
  let peakMag = 0;
  for (let i = 0; i < n; i++) {
    const m = Math.hypot(p.gxR[i], p.gyR[i], p.gzR[i]);
    if (m > peakMag) {
      peakMag = m;
      peakIdx = i;
    }
  }

  // Integrate from rest (0) to peak
  let q: Quat = { w: 1, x: 0, y: 0, z: 0 };
  for (let i = 0; i < peakIdx; i++) {
    const wx = p.gxR[i];
    const wy = p.gyR[i];
    const wz = p.gzR[i];
    const angle = Math.hypot(wx, wy, wz) * dtSec;
    if (angle > 1e-9) {
      const axisX = wx / Math.hypot(wx, wy, wz);
      const axisY = wy / Math.hypot(wx, wy, wz);
      const axisZ = wz / Math.hypot(wx, wy, wz);
      const dq = quatFromAxisAngle(axisX, axisY, axisZ, angle);
      q = quatMul(q, dq);
    }
  }

  // Arrow axis in the body frame is -Z (sensor convention)
  const arrowRest = quatRotate(quatConjugate(q), [0, 0, -1]);

  // Gravity direction at rest = normalized mean of first 50 accel samples
  const head = Math.min(50, p.axM.length);
  const gx = mean(p.axM.slice(0, head));
  const gy = mean(p.ayM.slice(0, head));
  const gz = mean(p.azM.slice(0, head));
  const gMag = Math.hypot(gx, gy, gz);
  if (gMag < 1e-6) return 0;
  const gravRest: [number, number, number] = [gx / gMag, gy / gMag, gz / gMag];

  // Arm slot = angle between arrow and -gravity, then 90° - that
  const dot =
    arrowRest[0] * -gravRest[0] +
    arrowRest[1] * -gravRest[1] +
    arrowRest[2] * -gravRest[2];
  const clamped = Math.max(-1, Math.min(1, dot));
  const angleFromUp = (Math.acos(clamped) * 180) / Math.PI;
  return 90 - angleFromUp;
}

// ────────────────────────────────────────────────────────────────────
// 7. Top-level: raw clip → physical metrics → decoded throw
// ────────────────────────────────────────────────────────────────────

export interface AthleteAnthro {
  heightM: number;
  weightKg: number;
}

/**
 * Decode a single throw clip. Throws if the clip is too short to be trustworthy.
 */
export function decodeClip(
  rawClip: readonly Sample[],
  athlete: AthleteAnthro,
): DecodedThrow {
  const clean = stripJunk(rawClip);
  if (clean.length < MIN_CLIP_LENGTH) {
    throw new Error(
      `clip too short after junk filter: ${clean.length} < ${MIN_CLIP_LENGTH}`,
    );
  }
  const physical = toPhysicalUnits(clean);
  const torqueNm = elbowTorqueNm(physical);
  const armSpeed = armSpeedDps(physical);
  const armSlot = armSlotDeg(physical);
  const denom = Math.max(1e-6, athlete.heightM * athlete.weightKg);
  const wThrow = Math.pow(Math.max(0, torqueNm) / denom, 1.3);

  return {
    torqueNm,
    armSpeedDps: armSpeed,
    armSlotDeg: armSlot,
    wThrow,
    cleanSampleCount: clean.length,
  };
}

/**
 * Convenience: take a bulk-sync byte buffer, split by sentinels, and decode
 * every clip that passes the minimum-length gate.
 */
export function decodeBulkSync(
  buf: ArrayBuffer,
  athlete: AthleteAnthro,
): { throws: DecodedThrow[]; skipped: number } {
  const samples = parseBuffer(buf);
  const clips = splitBySentinel(samples);
  const throws: DecodedThrow[] = [];
  let skipped = 0;
  for (const clip of clips) {
    try {
      throws.push(decodeClip(clip, athlete));
    } catch {
      skipped++;
    }
  }
  return { throws, skipped };
}
