/**
 * Step 6 — Strapdown integrator.
 *
 * Reference: `_GSIntegrateIMUData @ 0xa16c` in
 * `/Users/maxsmac/Desktop/motus/pulse_probe/decompiled/GolfSwingKit/`.
 *
 * Reads the 5000-sample 60-byte/sample decompressed buffer (after filters and
 * saturation interpolation), integrates a strapdown IMU model from
 * `swingStartIdx` through `swingStopIdx`, and writes a 208-byte/sample
 * integrated buffer.
 *
 * Output layout (208 bytes/sample):
 *   [0..4]    int32   sample-time stamp (== iVar11, the `iVar1`-relative tick offset)
 *   [4..8]    pad     (struct alignment)
 *   [8..80]   9 doubles  rotation matrix R (body-to-lab, row-major)
 *   [80..104] 3 doubles  body-frame angular velocity ω_body
 *   [104..128] 3 doubles position_lab (m)
 *   [128..152] 3 doubles velocity_lab (m/s)
 *   [152..176] 3 doubles acceleration_lab (m/s², gravity removed)
 *   [176..200] 3 doubles body-frame acceleration (m/s²)
 *   [200..208] 1 double  scalar_C × 9.81 (read by torque centripetal term)
 *
 * The output sample stride in the input timeline is `0x270 = 624` int-units
 * (i.e. `iVar11 += 0x270` per output). One integration step uses
 * `dt = 0.000624 s` (the raw sample period).
 */

import { OFF60, SAMPLE_BYTES_60 } from './buffer-layout';
import {
  Vec3,
  Mat3,
  vCopy,
  vAdd,
  vScale,
  vScaleAdd,
  vMagnitude,
  vNormalize,
  vDot,
  vCross,
  vLerp,
  mIdentity,
  mMul,
  mTranspose,
  vMatMul,
  mRotationFromVector,
  X_AXIS,
  Y_AXIS,
} from './math';

const SAMPLE_BYTES_208 = 208;
const STRIDE = 0x270; // 624 — int-units between output samples
const DT = 0.000624; // seconds per integration step
const G = 9.81;

const OFF208 = {
  IDX: 0,
  R: 8,            // 9 doubles row-major
  OMEGA_BODY: 80,  // 3 doubles
  POS_LAB: 104,    // 3 doubles
  VEL_LAB: 128,    // 3 doubles
  ACCEL_LAB: 152,  // 3 doubles  (gravity removed)
  ACCEL_BODY: 176, // 3 doubles (m/s²)
  SCALAR_C_G: 200, // 1 double  (scalar_C × 9.81)
} as const;

export interface IntegrateInputs {
  decompressed: ArrayBuffer; // 5000 × 60 bytes
  swingStartIdx: number;
  impactIdx: number;
  swingStopIdx: number;
  /** Player struct's body-to-sensor matrix (3×3 row-major). Default: identity. */
  playerMatrix?: ArrayLike<number>;
  /** Initial body-to-lab rotation (3×3). If omitted, computed from startAccelMean. */
  initialBodyToLab?: ArrayLike<number>;
  /** Mean of first ~50 accel samples (for fallback initial rotation). */
  startAccelMean?: ArrayLike<number>;
}

export interface IntegratedBuffer {
  buffer: ArrayBuffer;
  sampleCount: number;
  /** Number of output samples. */
  n: number;
  /** Index in output buffer corresponding to the impact frame. */
  impactOutputIdx: number;
}

/**
 * Run the strapdown integrator across the swing window.
 */
export function integrateImuData(inputs: IntegrateInputs): IntegratedBuffer {
  const inDv = new DataView(inputs.decompressed);

  const startIdx = inputs.swingStartIdx;
  const impactIdx = inputs.impactIdx;
  const stopIdx = inputs.swingStopIdx;

  // Read int-time stamps for each special sample.
  const tStart = inDv.getInt32(startIdx * SAMPLE_BYTES_60, true);
  const tImpact = inDv.getInt32(impactIdx * SAMPLE_BYTES_60, true);
  const tStop = inDv.getInt32(stopIdx * SAMPLE_BYTES_60, true);

  // iVar1 per `_GSIntegrateIMUData` line 87:
  //   iVar1 = ((iVar3 - iVar9) / 0x270) * -0x270 + iVar3
  // ARM64 SDIV / C99+ signed-int division truncates toward zero. Use
  // Math.trunc to match. Confirmed by Round 3 expert response.
  const iVar1 = tImpact - Math.trunc((tImpact - tStart) / STRIDE) * STRIDE;
  // Number of output samples
  const nOut = Math.floor((tStop - iVar1) / STRIDE) + 1;

  const out = new ArrayBuffer(Math.max(1, nOut) * SAMPLE_BYTES_208);
  const outDv = new DataView(out);

  // Initial rotation matrix (body-to-lab).
  const R: Mat3 = new Float64Array(9);
  if (inputs.initialBodyToLab) {
    for (let i = 0; i < 9; i++) R[i] = inputs.initialBodyToLab[i];
  } else if (inputs.startAccelMean) {
    initialBodyToLab(R, inputs.startAccelMean, inputs.playerMatrix);
  } else {
    mIdentity(R);
  }

  const playerM: Mat3 = new Float64Array(9);
  if (inputs.playerMatrix) {
    for (let i = 0; i < 9; i++) playerM[i] = inputs.playerMatrix[i];
  } else {
    mIdentity(playerM);
  }

  // Cursor through input samples — points at the sample whose int-time-stamp
  // is the LAST one we've read into (auStack_1f0, etc.).
  let inCursor = startIdx;
  let curSample = readRawSample(inDv, inCursor);
  let nextSample = readRawSample(inDv, inCursor + 1);

  // Advance until nextSample's timestamp ≥ iVar1 (so iVar1 is bracketed).
  while (nextSample.t < iVar1 && inCursor + 1 < 4999) {
    inCursor++;
    curSample = nextSample;
    nextSample = readRawSample(inDv, inCursor + 1);
  }

  // Lerp factor between curSample and nextSample at iVar1.
  const denom0 = nextSample.t - curSample.t;
  const f0 = denom0 === 0 ? 0 : (iVar1 - curSample.t) / denom0;
  const accelG = new Float64Array(3); // accel in g
  const gyroRad = new Float64Array(3);
  let scalarC: number;
  vLerp(accelG, f0, curSample.a, nextSample.a);
  vLerp(gyroRad, f0, curSample.g, nextSample.g);
  scalarC = (1 - f0) * curSample.s + f0 * nextSample.s;
  scalarC = scalarC * G;

  // Body-frame angular velocity and accel (in g)
  const omegaBody = new Float64Array(3);
  const accelBodyG = new Float64Array(3);
  vMatMul(omegaBody, gyroRad, playerM);
  vMatMul(accelBodyG, accelG, playerM);

  // Gravity magnitude — per binary, this is |startAccelMean|, NOT a hardcoded
  // G. For the Phase 5 temp swing, startAccelMean = (0, 0, 1e-8) so gravity
  // ≈ 0 and the integrator effectively skips gravity removal. For the main
  // swing, |startAccelMean| ≈ 9.4 m/s² (the actual measured stationary accel
  // magnitude). Hardcoding G here breaks Phase 5 by injecting a phantom
  // -9.81 m/s² in z that integrates into ~31 m/s of bogus z-velocity.
  let gravityMag = G;
  if (inputs.startAccelMean) {
    let sumSq = 0;
    for (let i = 0; i < 3; i++) sumSq += inputs.startAccelMean[i] * inputs.startAccelMean[i];
    gravityMag = Math.sqrt(sumSq);
  }
  const gravityVec = new Float64Array(3);
  gravityVec[2] = -gravityMag;

  // Lab-frame accel
  const accelLab = new Float64Array(3);
  vMatMul(accelLab, accelBodyG, R);
  for (let i = 0; i < 3; i++) accelLab[i] = G * accelLab[i] + gravityVec[i];

  // Body-frame accel in m/s²
  const accelBodyMS2 = new Float64Array(3);
  vScale(accelBodyMS2, G, accelBodyG, 3);

  // Position and velocity start at zero
  const posLab = new Float64Array(3);
  const velLab = new Float64Array(3);

  // Write output sample 0
  writeOutputSample(outDv, 0, 0, R, omegaBody, posLab, velLab, accelLab, accelBodyMS2, scalarC);

  // Main loop — integrate
  let prevAccelLab = new Float64Array(accelLab);
  let prevOmegaBody = new Float64Array(omegaBody);
  for (let outIdx = 1; outIdx < nOut; outIdx++) {
    const tTarget = iVar1 + outIdx * STRIDE;

    // Advance cursor until nextSample brackets tTarget
    while (nextSample.t < tTarget && inCursor + 1 < 4999) {
      inCursor++;
      curSample = nextSample;
      nextSample = readRawSample(inDv, inCursor + 1);
    }

    const denom = nextSample.t - curSample.t;
    const f = denom === 0 ? 0 : (tTarget - curSample.t) / denom;
    vLerp(accelG, f, curSample.a, nextSample.a);
    vLerp(gyroRad, f, curSample.g, nextSample.g);
    scalarC = ((1 - f) * curSample.s + f * nextSample.s) * G;

    vMatMul(omegaBody, gyroRad, playerM);
    vMatMul(accelBodyG, accelG, playerM);

    // Update orientation: average angular velocity × dt, build small-angle
    // rotation, R = R × R_step^T (per decompile lines 240-248).
    const angle = new Float64Array(3);
    for (let i = 0; i < 3; i++) {
      angle[i] = (omegaBody[i] + prevOmegaBody[i]) * 0.5 * DT;
    }
    const Rstep: Mat3 = new Float64Array(9);
    mRotationFromVector(Rstep, angle);
    const RstepT: Mat3 = new Float64Array(9);
    mTranspose(RstepT, Rstep);
    const Rnew: Mat3 = new Float64Array(9);
    mMul(Rnew, R, RstepT);
    for (let i = 0; i < 9; i++) R[i] = Rnew[i];

    // Lab-frame accel after rotation update
    vMatMul(accelLab, accelBodyG, R);
    for (let i = 0; i < 3; i++) accelLab[i] = G * accelLab[i] + gravityVec[i];
    vScale(accelBodyMS2, G, accelBodyG, 3);

    // Position update: pos += (a + 2·a_prev) × dt² / 6 + v × dt
    for (let i = 0; i < 3; i++) {
      posLab[i] += (accelLab[i] + 2 * prevAccelLab[i]) * DT * DT / 6 + velLab[i] * DT;
    }
    // Velocity update: v += (a + a_prev) × dt / 2
    for (let i = 0; i < 3; i++) {
      velLab[i] += (accelLab[i] + prevAccelLab[i]) * 0.5 * DT;
    }

    // Write output
    writeOutputSample(
      outDv,
      outIdx,
      outIdx * STRIDE,
      R,
      omegaBody,
      posLab,
      velLab,
      accelLab,
      accelBodyMS2,
      scalarC,
    );

    prevAccelLab = new Float64Array(accelLab);
    prevOmegaBody = new Float64Array(omegaBody);
  }

  // Find impact's output index — output sample whose tTarget ≈ tImpact.
  const impactOutputIdx = Math.round((tImpact - iVar1) / STRIDE);

  return {
    buffer: out,
    sampleCount: nOut,
    n: nOut,
    impactOutputIdx,
  };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

interface RawSample {
  t: number;
  a: Float64Array;
  g: Float64Array;
  s: number;
}

function readRawSample(dv: DataView, idx: number): RawSample {
  const off = idx * SAMPLE_BYTES_60;
  const a = new Float64Array(3);
  const g = new Float64Array(3);
  a[0] = dv.getFloat64(off + OFF60.AX, true);
  a[1] = dv.getFloat64(off + OFF60.AY, true);
  a[2] = dv.getFloat64(off + OFF60.AZ, true);
  g[0] = dv.getFloat64(off + OFF60.GX, true);
  g[1] = dv.getFloat64(off + OFF60.GY, true);
  g[2] = dv.getFloat64(off + OFF60.GZ, true);
  return {
    t: dv.getInt32(off, true),
    a,
    g,
    s: dv.getFloat64(off + OFF60.SCALAR_C, true),
  };
}

function writeOutputSample(
  dv: DataView,
  i: number,
  tStamp: number,
  R: Mat3,
  omegaBody: Vec3,
  posLab: Vec3,
  velLab: Vec3,
  accelLab: Vec3,
  accelBody: Vec3,
  scalarCxG: number,
): void {
  const off = i * SAMPLE_BYTES_208;
  dv.setInt32(off + OFF208.IDX, tStamp, true);
  for (let j = 0; j < 9; j++) dv.setFloat64(off + OFF208.R + j * 8, R[j], true);
  for (let j = 0; j < 3; j++) {
    dv.setFloat64(off + OFF208.OMEGA_BODY + j * 8, omegaBody[j], true);
    dv.setFloat64(off + OFF208.POS_LAB + j * 8, posLab[j], true);
    dv.setFloat64(off + OFF208.VEL_LAB + j * 8, velLab[j], true);
    dv.setFloat64(off + OFF208.ACCEL_LAB + j * 8, accelLab[j], true);
    dv.setFloat64(off + OFF208.ACCEL_BODY + j * 8, accelBody[j], true);
  }
  dv.setFloat64(off + OFF208.SCALAR_C_G, scalarCxG, true);
}

/**
 * Build the initial body-to-lab rotation matrix from the mean accel-at-rest
 * vector. Mirrors `_GSCalculateInitialBodyToLabMatrix` (no magnetometer):
 *
 *   normalize startAccel → "down" in body frame
 *   transform via player matrix → "down" in body frame after player
 *   pick X or Y as ref axis (whichever is more orthogonal)
 *   build orthonormal basis
 */
export function initialBodyToLab(
  out: Mat3,
  startAccelMean: ArrayLike<number>,
  playerMatrix?: ArrayLike<number>,
): void {
  const down = new Float64Array(3);
  if (vNormalize(down, startAccelMean) === 1) {
    mIdentity(out);
    return;
  }
  if (playerMatrix) {
    const tmp = new Float64Array(3);
    vMatMul(tmp, down, playerMatrix);
    vNormalize(down, tmp);
  }

  // Binary uses unsigned dot (NOT abs) per `_GSCalculateInitialBodyToLabMatrix` line 36:
  //   if (0.707 <= dVar5) { puVar1 = &_GSYAxis; } else { puVar1 = &_GSXAxis; }
  const refAxis = vDot(down, X_AXIS as ArrayLike<number>) >= 0.707
    ? Y_AXIS
    : X_AXIS;

  const u = new Float64Array(3);
  vCross(u, down, refAxis as ArrayLike<number>);
  vNormalize(u, u);
  const v = new Float64Array(3);
  vCross(v, down, u);
  vNormalize(v, v);

  // Rows = u, v, down per the binary's `_GSVectorCopyD(param_2 + 0x18, ...)` calls
  out[0] = u[0]; out[1] = u[1]; out[2] = u[2];
  out[3] = v[0]; out[4] = v[1]; out[5] = v[2];
  out[6] = down[0]; out[7] = down[1]; out[8] = down[2];
}

export const OFF208_PUBLIC = OFF208;
export const SAMPLE_BYTES_208_PUBLIC = SAMPLE_BYTES_208;
