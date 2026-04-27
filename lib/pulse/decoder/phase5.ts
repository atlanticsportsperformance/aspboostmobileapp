/**
 * Phase 5 of `__indexSwingStartMeanAccel @ 0xfe10` — recursive integrator pass
 * that produces the per-event `startAccelMean` body-frame vector. This is the
 * INPUT to `_GSCalculateInitialBodyToLabMatrix`; without it, the main
 * integrator's initial R is wrong and slot/torque drift across events.
 *
 * Walkthrough (per ASM 0xffc0..0x10118 in expert's Round 9 dump):
 *
 *   A. Create a temp swing with ball_oz = 5.11472, height=1.7m, weight=62.62kg,
 *      identity body-to-sensor matrix, identity initial-R correction.
 *   B. Set temp.startAccelMean = (0, 0, 1e-8) so InitialBodyToLab inside the
 *      temp integrator returns identity R.
 *   C. Set temp.swing_start = uVar5 (Loop 2 result), temp.impact = raw_impact,
 *      temp.swing_stop = raw_impact (= integrate the very-short window).
 *   D. Run integrator on temp — produces a 208-byte/sample buffer with R(t),
 *      vel_lab(t), accel_body(t), etc.
 *   E. avg_accel_lab = vel_lab[last] / ((nOut - 1) × 0.000624)
 *   F. Get R(time = (raw_impact-1)*1000 - swing_start*1000 μs) from temp buffer.
 *   G. avg_accel_body = avg_accel_lab × R^T
 *   H. Store as parent.startAccelMean (body-frame "down" reference for main
 *      integrator's _GSCalculateInitialBodyToLabMatrix).
 */

import { OFF60, SAMPLE_BYTES_60 } from './buffer-layout';
import { mIdentity, vMatTransposeMul, vScale, Mat3, Vec3 } from './math';
import { integrateImuData, OFF208_PUBLIC, SAMPLE_BYTES_208_PUBLIC } from './integrate';

const STRIDE = 0x270; // 624 — int-units between integrated output samples

/**
 * Compute `uVar3` per `__indexSwingStartMeanAccel` lines 33-44: scan forward
 * from sample 0's GX field, returning the index of the first sample where
 * GX differs from sample 0's GX. If all 5000 samples have identical GX,
 * returns 15.
 */
function computeUVar3(decompressed: ArrayBuffer): number {
  const dv = new DataView(decompressed);
  const sample0Gx = dv.getFloat64(OFF60.GX, true);
  for (let lVar4 = -1; lVar4 > -5000; lVar4--) {
    const i = -lVar4; // 1, 2, 3, ...
    const gx = dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.GX, true);
    if (gx !== sample0Gx) return i;
  }
  return 15;
}

/**
 * Loop 1 of `__indexSwingStartMeanAccel` — backward float32 |gyro| argmin
 * scan from `raw_impact` over `[raw_impact + iVar1 + 1, raw_impact]`.
 *
 * Per decompile lines 47-87:
 *   uVar3 = first-divergent-sample index
 *   iVar1 = -500 by default; -1000 if uVar3 > 0x9c5 + 299 = ~2800;
 *           -2000 if iVar1 was -1000 AND uVar3 > 0x5dd + 999 = ~2500
 *   Loop scans backward from raw_impact down to raw_impact + iVar1 + 1.
 *
 * Returns the argmin (as float32 |gyro|) over that backward range. This
 * value is what binary passes as `temp.0x1a4` and `temp.0x1a8` — NOT
 * raw_impact (per expert R22: `str w24, [x23, #0x1a4]` where w24 has
 * been updated inside Loop 1's argmin scan).
 */
function loop1ArgminGyroMagBackward(
  decompressed: ArrayBuffer,
  rawImpact: number,
  uVar3: number,
): number {
  const dv = new DataView(decompressed);
  const fround = Math.fround;

  // iVar1 selection per decompile lines 52-59. The comparisons are UNSIGNED:
  //   `999 < (uint)(uVar3 - 0x5dd)` is true when uVar3 < 0x5dd (underflow gives
  //   a huge unsigned value) OR uVar3 > 0x5dd + 999. For typical data (uVar3 ~ 1),
  //   the underflow path triggers and iVar1 = -2000.
  // Reproduce unsigned-32-bit comparisons via `>>> 0`.
  const u3 = uVar3 >>> 0;
  let iVar8 = -1000;
  if (((u3 - 0x5dd) >>> 0) > 999) iVar8 = -2000;
  let iVar1 = -500;
  if (((u3 - 0x9c5) >>> 0) > 299) iVar1 = iVar8;

  const lowerBound = rawImpact + iVar1; // exclusive — loop continues while uVar11 > lowerBound
  if (lowerBound >= rawImpact) return rawImpact;

  let bestIdx = rawImpact;
  let bestVal = fround(100.0);
  // Backward scan from raw_impact down to lowerBound + 1 inclusive.
  for (let i = rawImpact; i > lowerBound; i--) {
    const off = i * SAMPLE_BYTES_60;
    const fgx = fround(dv.getFloat64(off + OFF60.GX, true));
    const fgy = fround(dv.getFloat64(off + OFF60.GY, true));
    const fgz = fround(dv.getFloat64(off + OFF60.GZ, true));
    const sumSq = fround(
      fround(fround(fgx * fgx) + fround(fgy * fgy)) + fround(fgz * fgz),
    );
    const mag = fround(Math.sqrt(sumSq));
    if (mag < bestVal) {
      bestVal = mag;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Loop 2 of `__indexSwingStartMeanAccel` — forward float32 |gyro| argmin
 * scan from sample 15.
 */
function loop2ArgminAccelMag(decompressed: ArrayBuffer): number {
  const dv = new DataView(decompressed);
  const fround = Math.fround;

  let bestIdx = 15;
  let bestVal = fround(1000.0);
  // pdVar3 starts at param_2 + 0x184 = sample 6 byte 28 = sample[6].GX.
  // Wait — re-reading: 0x184 = 388. 388 / 60 = 6.466. 6*60 = 360. 388 - 360 = 28 = OFF60.GX.
  // So pdVar3 = &sample[6].gx, reads 3 doubles: gx, gy, gz of sample 6.
  // BUT the magnitude-sliding-mean uses |accel|, which would be at offset 4.
  //
  // Looking again: the inner loop computes magnitudes from `pdVar6[0], pdVar6[1], pdVar6[2]`
  // for two consecutive samples, then advances pdVar6 by 0xf (= 60 bytes).
  //
  // For the function to compute |accel| MAG, pdVar3 should point to ax of sample N.
  // Offset of ax is 4. So pdVar3 = &sample[N].ax = param_2 + N*60 + 4.
  //
  // 0x184 = 388 = 6*60 + 28. So pdVar3 = &sample[6].gx (NOT ax).
  //
  // This means Loop 2 computes |gyro| running mean, NOT |accel|. The function
  // name `__indexSwingStartMeanAccel` is misleading (same as Loop 1).
  // Per-sample argmin of float32 |gyro| over [15, 1200].
  for (let i = 15; i <= 1200; i++) {
    const off = i * SAMPLE_BYTES_60;
    const fgx = fround(dv.getFloat64(off + OFF60.GX, true));
    const fgy = fround(dv.getFloat64(off + OFF60.GY, true));
    const fgz = fround(dv.getFloat64(off + OFF60.GZ, true));
    const sumSq = fround(
      fround(fround(fgx * fgx) + fround(fgy * fgy)) + fround(fgz * fgz),
    );
    const mag = fround(Math.sqrt(sumSq));
    if (mag < bestVal) {
      bestVal = mag;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Get rotation matrix R at time `tMicros` (microseconds since swing_start)
 * from the temp swing's integrated buffer. tMicros should be a multiple of
 * STRIDE; otherwise lerp between adjacent samples.
 *
 * Per binary's `_GSGetBodyToLabMatrix(swing, &R, tMicros)` semantics: the
 * timestamp is added to iVar1 to find the integrated sample; if exact, return
 * R from that sample; otherwise lerp.
 *
 * For Phase 5 the time is exactly at sample boundaries (we pass
 * `(raw_impact - 1) - swing_start` which is integer multiple of 1000 μs).
 * 1000 / 624 isn't integer though — so lerp is needed.
 */
function getBodyToLabMatrixAtTime(
  integratedBuffer: ArrayBuffer,
  nOut: number,
  tMicros: number,
  out: Mat3,
): void {
  const dv = new DataView(integratedBuffer);
  // Find sample idx: tMicros = N × STRIDE → N = tMicros / 624.
  const sampleFrac = tMicros / STRIDE;
  const N = Math.floor(sampleFrac);
  const f = sampleFrac - N;

  if (N < 0) {
    // Read R from sample 0
    for (let i = 0; i < 9; i++) {
      out[i] = dv.getFloat64(0 + OFF208_PUBLIC.R + i * 8, true);
    }
    return;
  }
  if (N >= nOut - 1) {
    // Read R from last sample
    const last = nOut - 1;
    for (let i = 0; i < 9; i++) {
      out[i] = dv.getFloat64(last * SAMPLE_BYTES_208_PUBLIC + OFF208_PUBLIC.R + i * 8, true);
    }
    return;
  }
  // Lerp between sample N and N+1
  const offN = N * SAMPLE_BYTES_208_PUBLIC + OFF208_PUBLIC.R;
  const offN1 = (N + 1) * SAMPLE_BYTES_208_PUBLIC + OFF208_PUBLIC.R;
  for (let i = 0; i < 9; i++) {
    const a = dv.getFloat64(offN + i * 8, true);
    const b = dv.getFloat64(offN1 + i * 8, true);
    out[i] = a * (1 - f) + b * f;
  }
}

/**
 * Run Phase 5 and return the body-frame `startAccelMean` to feed into the
 * main integrator's `_GSCalculateInitialBodyToLabMatrix`.
 */
export function computeStartAccelMean(
  decompressed: ArrayBuffer,
  rawImpact: number,
  debug?: (info: any) => void,
): Vec3 {
  // Step A0: uVar3 = first-divergent-sample index (decompile lines 33-44).
  const uVar3 = computeUVar3(decompressed);

  // Step A1: Loop 1 → uVar9 (backward argmin |gyro| from raw_impact). This is
  // the value binary passes as `temp.0x1a4 = temp.0x1a8`. Per expert R22 it's
  // distinct from raw_impact; passing raw_impact (the bug we just had) yields
  // wildly wrong startAccelMean.
  const loop1Argmin = loop1ArgminGyroMagBackward(decompressed, rawImpact, uVar3);

  // Step A2: Loop 2 → uVar5 (forward argmin = temp swing's swing_start)
  const uVar5 = loop2ArgminAccelMag(decompressed);
  debug?.({ uVar3, loop1Argmin, uVar5 });

  // Step B+C: Run a temp integrator with:
  //   - IDENTITY initial R directly (binary skips InitialBodyToLab via flag258
  //     and copies parent's swing[0x1c8] = identity)
  //   - swing_start = uVar5
  //   - impact = loop1Argmin   ← NOT rawImpact (per R22 fix)
  //   - swing_stop = loop1Argmin
  const identityR = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  // Per binary's Phase 5 setup (Round 9 ASM trace, step B):
  //   temp.startAccelMean = (0, 0, 1e-8)
  // The integrator computes its gravity vector as `-|startAccelMean|` in lab z.
  // With magnitude 1e-8 ≈ 0, the temp integrator effectively does NOT subtract
  // gravity from accel_lab, so vel_lab integrates raw rotated accel (which is
  // what we want — we use vel_lab[last] to extract the mean accel direction).
  const TEMP_START_ACCEL_MEAN = new Float64Array([0, 0, 1e-8]);
  const tempIntegrated = integrateImuData({
    decompressed,
    swingStartIdx: uVar5,
    impactIdx: loop1Argmin,
    swingStopIdx: loop1Argmin,
    initialBodyToLab: identityR,
    startAccelMean: TEMP_START_ACCEL_MEAN,
  });

  // Step E: avg_accel_lab = vel_lab[last] / ((nOut-1) × 0.000624)
  const dv = new DataView(tempIntegrated.buffer);
  const lastSampleOff = (tempIntegrated.n - 1) * SAMPLE_BYTES_208_PUBLIC;
  const velLab: Vec3 = new Float64Array(3);
  velLab[0] = dv.getFloat64(lastSampleOff + OFF208_PUBLIC.VEL_LAB, true);
  velLab[1] = dv.getFloat64(lastSampleOff + OFF208_PUBLIC.VEL_LAB + 8, true);
  velLab[2] = dv.getFloat64(lastSampleOff + OFF208_PUBLIC.VEL_LAB + 16, true);
  const elapsedTime = (tempIntegrated.n - 1) * 0.000624;
  const scalar = elapsedTime > 0 ? 1.0 / elapsedTime : 0;
  const avgAccelLab: Vec3 = new Float64Array(3);
  vScale(avgAccelLab, scalar, velLab, 3);
  debug?.({
    nOut: tempIntegrated.n,
    velLab: [velLab[0], velLab[1], velLab[2]],
    elapsedTime,
    scalar,
    avgAccelLab: [avgAccelLab[0], avgAccelLab[1], avgAccelLab[2]],
  });

  // Step F: R at time `(loop1Argmin - 1) - swing_start` microseconds.
  // Per decompile lines 133-137: `uVar10 = uVar9 - 1` (= loop1Argmin - 1) and
  // `_GSGetBodyToLabMatrix(... param_2[uVar10].idx - param_2[temp.0x198].idx)`.
  // Sample idx field = sample_idx × 1000 μs (set by stampSampleIndices).
  const tMicros = (loop1Argmin - 1) * 1000 - uVar5 * 1000;
  const R: Mat3 = new Float64Array(9);
  getBodyToLabMatrixAtTime(tempIntegrated.buffer, tempIntegrated.n, tMicros, R);

  // Step G: avg_accel_body = avg_accel_lab × R^T (transpose-multiply)
  const avgAccelBody: Vec3 = new Float64Array(3);
  vMatTransposeMul(avgAccelBody, avgAccelLab, R, 3);

  return avgAccelBody;
}
