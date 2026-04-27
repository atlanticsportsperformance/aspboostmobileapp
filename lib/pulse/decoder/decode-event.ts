/**
 * Step 8 — Top-level event decoder.
 *
 * Composes the byte-exact pipeline:
 *
 *   sampleData (raw int16 bytes)
 *     ↓ calibrate                           60-byte/sample buffer
 *     ↓ decompressAllData                   5000 samples × 60 B
 *     ↓ applyMiniLPFTorqueToAZ              writes scalar_C from filtered AZ
 *     ↓ interpolateAll                      saturation patch on 6 channels
 *     ↓ swing-index helpers                 (impact, swingStop, swingStart)
 *     ↓ integrateImuData                    208-byte/sample buffer
 *     ↓ computeMetrics                      { armSpeedRadS, torqueNm, armSlotRad }
 *
 * Returns `DecodedEvent` with both rad and deg variants for compatibility
 * with existing call sites.
 */

import { calibrate } from './calibrate';
import { decompressAllData } from './decompress';
import { applyMiniLPFTorqueToAZ } from './filters';
import { interpolateAll, bhInterpolateSome } from './interpolate';
import {
  indexImpact,
  indexSwingStop,
  indexSwingStart,
  startAccelMean,
} from './swing-indices';
import { integrateImuData } from './integrate';
import { computeMetrics } from './metrics';
import { mIdentity, mRotationFromVector, vMatMul, Mat3 } from './math';
import { OFF60, SAMPLE_BYTES_60 } from './buffer-layout';
import { computeStartAccelMean } from './phase5';

/**
 * Fill the int sample-index field of the decompressed buffer:
 *   sample[i].idx = i × 1000
 * Mirrors `GSCalculateSwingFromIMUData @ 0xd164` lines 79-85.
 */
function stampSampleIndices(decompressed: ArrayBuffer): void {
  const dv = new DataView(decompressed);
  const n = Math.floor(decompressed.byteLength / SAMPLE_BYTES_60);
  for (let i = 0; i < n; i++) {
    dv.setInt32(i * SAMPLE_BYTES_60 + OFF60.IDX, i * 1000, true);
  }
}

/**
 * Argmax of |gyro| over decompressed samples [2250, 4499]. Mirrors the
 * loop at `GSCalculateSwingFromIMUData @ d164:95-113`:
 *
 *   for lVar8 in 0..0x8ca:
 *     mag = sqrt(gx² + gy² + gz²)
 *     if mag > running_max: running_max = mag, idx = lVar8 + 0x8ca
 *
 * Returns the resulting `iVar1` consumed by `_BHinterpolateSome`'s merge cap.
 */
function findPeakGyroMagIdx(decompressed: ArrayBuffer): number {
  const dv = new DataView(decompressed);
  const SCAN_OFFSET = 0x8ca; // 2250
  const SCAN_LEN = 0x8ca;    // 2250 iterations → samples [2250, 4499]
  let bestMag = 0;
  let bestIdx = SCAN_OFFSET;
  for (let lVar8 = 0; lVar8 < SCAN_LEN; lVar8++) {
    const i = SCAN_OFFSET + lVar8;
    const off = i * SAMPLE_BYTES_60;
    const gx = dv.getFloat64(off + OFF60.GX, true);
    const gy = dv.getFloat64(off + OFF60.GY, true);
    const gz = dv.getFloat64(off + OFF60.GZ, true);
    const mag = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (mag > bestMag) {
      bestMag = mag;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Apply Pulse's pre-integration "internal frame" rotations.
 *
 * Reference: `GSCalculateSwingFromIMUData @ 0xd164` lines 121-148.
 *
 * The binary applies two rotations to the decompressed buffer BEFORE the
 * saturation interp + integration stages:
 *
 *   gyro_x,y,z[i]  = gyro × R_z(-7π/4)      (constant 0xc015fdbbe9bba775)
 *   accel_x,y,z[i] = accel × R_z(5π/4)       (constant 0x400f6a7a2955385e)
 *
 * Without these, every downstream metric reads the wrong frame components.
 */
function applyInternalFrameRotations(decompressed: ArrayBuffer): void {
  const ANGLE_GYRO = -7 * Math.PI / 4;  // -5.49778714... — `0xc015fdbbe9bba775`
  const ANGLE_ACCEL = 5 * Math.PI / 4;  //  3.92699081... — `0x400f6a7a2955385e`

  const Rgyro: Mat3 = new Float64Array(9);
  const Raccel: Mat3 = new Float64Array(9);
  mRotationFromVector(Rgyro, [0, 0, ANGLE_GYRO]);
  mRotationFromVector(Raccel, [0, 0, ANGLE_ACCEL]);

  const dv = new DataView(decompressed);
  const n = Math.floor(decompressed.byteLength / SAMPLE_BYTES_60);
  const tmp = new Float64Array(3);
  const v = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    const off = i * SAMPLE_BYTES_60;

    // Rotate gyro
    v[0] = dv.getFloat64(off + OFF60.GX, true);
    v[1] = dv.getFloat64(off + OFF60.GY, true);
    v[2] = dv.getFloat64(off + OFF60.GZ, true);
    vMatMul(tmp, v, Rgyro);
    dv.setFloat64(off + OFF60.GX, tmp[0], true);
    dv.setFloat64(off + OFF60.GY, tmp[1], true);
    dv.setFloat64(off + OFF60.GZ, tmp[2], true);

    // Rotate accel
    v[0] = dv.getFloat64(off + OFF60.AX, true);
    v[1] = dv.getFloat64(off + OFF60.AY, true);
    v[2] = dv.getFloat64(off + OFF60.AZ, true);
    vMatMul(tmp, v, Raccel);
    dv.setFloat64(off + OFF60.AX, tmp[0], true);
    dv.setFloat64(off + OFF60.AY, tmp[1], true);
    dv.setFloat64(off + OFF60.AZ, tmp[2], true);
  }
}

export interface AthleteAnthro {
  heightM: number;
  weightKg: number;
}

export interface DecodedEvent {
  armSpeedRadS: number;
  armSpeedDps: number;
  /** Arm speed in revolutions per minute — the unit the Pulse iOS app displays. */
  armSpeedRpm: number;
  torqueNm: number;
  armSlotRad: number;
  armSlotDeg: number;
  /** Driveline workload from torque + anthro. */
  wThrow: number;
  /** Diagnostic: count of raw input samples. */
  cleanSampleCount: number;
}

export interface DecodeOptions {
  /** Standard regulation baseball = 5.11472 oz. */
  ballOz?: number;
  /** Test-only: override swing-detection indices. */
  overrideIndices?: {
    swingStartIdx: number;
    impactIdx: number;
    swingStopIdx: number;
  };
  /** Test-only: override only the raw impact (let helpers derive start/stop from it). */
  overrideImpactIdx?: number;
  /** Test-only: override the initial body-to-lab rotation matrix. */
  overrideInitialBodyToLab?: Float64Array | number[];
  /**
   * Test-only: override startAccelMean (the body-frame "down" vector that
   * `_GSCalculateInitialBodyToLabMatrix` uses to build initial R). With the
   * binary's ground-truth startAccelMean per event, slot becomes byte-exact.
   */
  overrideStartAccelMean?: Float64Array | number[];
  /** Test-only: dump intermediate state. */
  diagnostics?: {
    onIntegrated?: (info: {
      n: number;
      impactOutputIdx: number;
      buffer: ArrayBuffer;
    }) => void;
    onIndices?: (info: { swingStartIdx: number; impactIdx: number; swingStopIdx: number }) => void;
    onMetrics?: (info: {
      peakIdx: number;
      torqueSeriesNearPeak?: number[];
      torquePeakIdx?: number;
      pvVar11LpfAtPeak?: number;
      pvVar12LpfAtPeak?: number;
      speedDerivAtPeak?: number;
    }) => void;
  };
}

export function decodeEvent(
  sampleData: Uint8Array,
  compressionData: Uint8Array,
  athlete: AthleteAnthro,
  options: DecodeOptions = {},
): DecodedEvent {
  const ballOz = options.ballOz ?? 5.11472;

  // 1. Calibrate raw bytes to 60-byte/sample physical-units buffer
  const calibrated = calibrate(sampleData);

  // 2. Decompress to 5000 × 60 B via metadata-driven Lanczos schedule
  const decompressed = decompressAllData(calibrated, compressionData);

  // 2b. Stamp sample indices (idx = i × 1000) — required by the integrator's
  // timestamp-based output cadence.
  stampSampleIndices(decompressed);

  // 3. Compute scalar_C via miniLPFtorque on AZ
  applyMiniLPFTorqueToAZ(decompressed);

  // 4. Saturation interp on all 6 channels (per `GSCalculateSwingFromIMUData`
  //    lines 115-119, BEFORE the internal-frame rotations).
  interpolateAll(decompressed);

  // 4a. Saturation-spline pass on the SCALAR_C channel (per
  //     `GSCalculateSwingFromIMUData` line 120 → `_BHinterpolateSome`).
  //     Outer loop scans samples [2500, 4998] only — events whose impact
  //     occurs before sample 2500 (the 60 byte-exact captures) skip this
  //     entirely; events with impact in [2500, 4998] (the 6 cmd01_18-01-56
  //     high-velocity outliers) need it for the SCALAR_C terminal climb.
  //     The peak-gyro-magnitude index is the argmax of |gyro| over samples
  //     [2250, 4499] per d164:95-113.
  const peakGyroIdx = findPeakGyroMagIdx(decompressed);
  bhInterpolateSome(decompressed, peakGyroIdx);

  // 4b. Apply Pulse's pre-integration "internal frame" rotations per
  //     `GSCalculateSwingFromIMUData` lines 121-148. Order matters: rotations
  //     come AFTER saturation interp so the unrotated raw values get patched
  //     against the unrotated saturation thresholds first.
  applyInternalFrameRotations(decompressed);

  // 5. Find swing indices (or use test-override)
  let impactIdx: number, swingStopIdx: number, swingStartIdx: number;
  if (options.overrideIndices) {
    impactIdx = options.overrideIndices.impactIdx;
    swingStopIdx = options.overrideIndices.swingStopIdx;
    swingStartIdx = options.overrideIndices.swingStartIdx;
  } else if (options.overrideImpactIdx !== undefined) {
    // Use binary's raw impact, derive start/stop from it via local helpers.
    impactIdx = options.overrideImpactIdx;
    swingStopIdx = indexSwingStop(decompressed, impactIdx);
    swingStartIdx = indexSwingStart(decompressed, impactIdx);
  } else {
    impactIdx = indexImpact(decompressed);
    swingStopIdx = indexSwingStop(decompressed, impactIdx);
    swingStartIdx = indexSwingStart(decompressed, impactIdx);
  }
  options.diagnostics?.onIndices?.({ swingStartIdx, impactIdx, swingStopIdx });

  // 6. Compute startAccelMean via Phase 5 (`__indexSwingStartMeanAccel @ 0xfe10`).
  //    R22 fix: `temp.0x1a4 = temp.0x1a8 = loop1Argmin` (NOT rawImpact). With
  //    that one-line fix, Phase 5 produces byte-exact startAccelMean ≈
  //    (3.602, 3.924, -7.759) for cmd01_11-10-13 ev=0 — matching the binary's
  //    actual stored value, not just the expert's earlier (also buggy) repro.
  //    Override path retained for the test harness but no longer required for
  //    production slot accuracy.
  const accelMean = options.overrideStartAccelMean
    ? new Float64Array(options.overrideStartAccelMean)
    : computeStartAccelMean(decompressed, impactIdx);
  const playerMatrix = new Float64Array(9);
  mIdentity(playerMatrix);
  const integrated = integrateImuData({
    decompressed,
    swingStartIdx,
    impactIdx,
    swingStopIdx,
    playerMatrix,
    startAccelMean: accelMean,
    initialBodyToLab: options.overrideInitialBodyToLab,
  });

  options.diagnostics?.onIntegrated?.({
    n: integrated.n,
    impactOutputIdx: integrated.impactOutputIdx,
    buffer: integrated.buffer,
  });

  // 7. Compute metrics
  const metrics = computeMetrics({
    integrated: integrated.buffer,
    n: integrated.n,
    impactOutputIdx: integrated.impactOutputIdx,
    player: { heightM: athlete.heightM, weightKg: athlete.weightKg },
    ballOz,
  });
  options.diagnostics?.onMetrics?.({
    peakIdx: metrics.peakIdx,
    torqueSeriesNearPeak: metrics.torqueSeriesNearPeak,
    torquePeakIdx: metrics.torquePeakIdx,
    pvVar11LpfAtPeak: metrics.pvVar11LpfAtPeak,
    pvVar12LpfAtPeak: metrics.pvVar12LpfAtPeak,
    speedDerivAtPeak: metrics.speedDerivAtPeak,
  });

  // Driveline workload — uses unchanged formula from `lib/pulse/workload.ts`
  const denom = Math.max(1e-6, athlete.heightM * athlete.weightKg);
  const wThrow = Math.pow(Math.max(0, metrics.torqueNm) / denom, 1.3);

  return {
    armSpeedRadS: metrics.armSpeedRadS,
    armSpeedDps: metrics.armSpeedRadS * 180 / Math.PI,
    armSpeedRpm: metrics.armSpeedRadS * 60 / (2 * Math.PI),
    torqueNm: metrics.torqueNm,
    armSlotRad: metrics.armSlotRad,
    armSlotDeg: metrics.armSlotRad * 180 / Math.PI,
    wThrow,
    cleanSampleCount: Math.floor(sampleData.byteLength / 12),
  };
}
