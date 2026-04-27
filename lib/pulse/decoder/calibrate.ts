/**
 * Step 2 — Calibration: int16 raw IMU bytes → 60-byte/sample physical-units buffer.
 *
 * Reference: `_GSCalculateSwingFromIMUData @ 0xd164` lines 46-71 in
 * `/Users/maxsmac/Desktop/motus/pulse_probe/decompiled/GolfSwingKit/`.
 *
 * Each input sample is 12 bytes = six int16 LE values in this order:
 *
 *   [0..2]   int16 — accel x (raw counts)
 *   [2..4]   int16 — accel y
 *   [4..6]   int16 — accel z
 *   [6..8]   int16 — gyro  x
 *   [8..10]  int16 — gyro  y
 *   [10..12] int16 — gyro  z
 *
 * Calibration scales (from the binary, not curve-fit):
 *
 *   accel = raw × 24 / 2048   (= raw × 24.0 × 0.00048828125)
 *   gyro  = raw × 4000 / 32768 × π / 180
 *         = raw × 4000.0 × 3.0517578125e-05 × π / 180   (rad/s)
 *
 * Output is one large `ArrayBuffer` of `n × 60` bytes. The first 4 bytes of
 * each sample (the int sample index) and the trailing 8 bytes (scalar C)
 * are zeroed; they're filled by later pipeline stages.
 */

import { OFF60, SAMPLE_BYTES_60 } from './buffer-layout';

const ACCEL_SCALE = 24.0 / 2048.0;                   // 0.01171875
const GYRO_SCALE = (4000.0 / 32768.0) * (Math.PI / 180.0);

/**
 * Calibrate a packed int16-LE IMU sample buffer (12 bytes per sample) to a
 * 60-byte-per-sample physical-units buffer.
 *
 * @param sampleData  Concatenated 252-byte chunk payloads from `parseCmd01Stream`.
 *                    Must be a multiple of 12 bytes.
 * @returns           ArrayBuffer of size `n × 60` where `n = sampleData.byteLength / 12`.
 */
export function calibrate(sampleData: Uint8Array): ArrayBuffer {
  const n = Math.floor(sampleData.byteLength / 12);
  const out = new ArrayBuffer(n * SAMPLE_BYTES_60);
  const dv = new DataView(out);
  const inDv = new DataView(
    sampleData.buffer,
    sampleData.byteOffset,
    sampleData.byteLength,
  );

  for (let i = 0; i < n; i++) {
    const inOff = i * 12;
    const ax = inDv.getInt16(inOff + 0, true);
    const ay = inDv.getInt16(inOff + 2, true);
    const az = inDv.getInt16(inOff + 4, true);
    const gx = inDv.getInt16(inOff + 6, true);
    const gy = inDv.getInt16(inOff + 8, true);
    const gz = inDv.getInt16(inOff + 10, true);

    const outOff = i * SAMPLE_BYTES_60;
    dv.setFloat64(outOff + OFF60.AX, ax * ACCEL_SCALE, true);
    dv.setFloat64(outOff + OFF60.AY, ay * ACCEL_SCALE, true);
    dv.setFloat64(outOff + OFF60.AZ, az * ACCEL_SCALE, true);
    dv.setFloat64(outOff + OFF60.GX, gx * GYRO_SCALE, true);
    dv.setFloat64(outOff + OFF60.GY, gy * GYRO_SCALE, true);
    dv.setFloat64(outOff + OFF60.GZ, gz * GYRO_SCALE, true);
    // [0..4] int idx and [52..60] scalar C are left zero.
  }

  return out;
}

export const _internal = { ACCEL_SCALE, GYRO_SCALE };
