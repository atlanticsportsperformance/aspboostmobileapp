/**
 * Step 7 — Metric calc: armSpeed, torque, armSlot.
 *
 * Reference: `_GSEstimateReleaseFromMinimumSlotAngle @ 0x06a08`
 *   armSpeed:  lines 84-157
 *   torque:    lines 158-264 (device_id != 3 branch)
 *   armSlot:   lines 313-572 (simplified port)
 *
 * Reads the integrated buffer (208 bytes/sample). Returns metrics in their
 * native physical units (rad/s, Nm, rad).
 *
 * IMPORTANT — this is the FIRST PASS of the metric port. It mirrors the
 * binary's structure faithfully but several constants and edge cases
 * (BHinterpolateArmSpeed, the slot zero-crossing search, the despike pass)
 * use straightforward implementations that may need refinement to hit
 * byte-exact (≤ 0.1%) parity with `motus_truth.csv`. If the byte-exact test
 * shows drift, this file is the first place to look.
 */

import { miniLPF2, miniLPF5, fivepointDiffArmSpeed, fivepointDiffArmSlot } from './filters';
import { OFF208_PUBLIC, SAMPLE_BYTES_208_PUBLIC } from './integrate';

const G = 9.81;

// arm-speed boost breakpoints (from the binary):
const SPEED_BREAK_HIGH = 69.81317007977317;   // 4000 dps in rad/s
const SPEED_BREAK_LOW = 10.471975511965978;   // 600 dps in rad/s
const SPEED_BOOST_DENOM = 38.39724354387525;
const SPEED_CLAMP_MIN = 0.01;
const SPEED_CLAMP_MAX = 200.0;

// arm-speed saturation interp threshold — `_BHinterpolateArmSpeed(0x4054000000000000, ...)`
// = 80.0
const ARMSPEED_SAT_THRESHOLD = 80.0;

// torque-formula constants
const MOMENT_ARM_OFFSET = 0.0229;       // multiplied by mass_kg
const INERTIAL_DIVISOR = 228.53786;
const INERTIAL_MULTIPLIER = 0.0076;
const ELBOW_Y_HEIGHT_FRACTION = 0.0870744;
const ELBOW_Y_OFFSET = -0.07;

// armSlot constants
const SLOT_OFFSET_DEG = 5.0;
const SLOT_BASELINE_DEG = 90.0;

export interface PlayerState {
  heightM: number;
  weightKg: number;
  /** Defaults to -0.07 m. */
  sensorToElbowY?: number;
}

export interface MetricInputs {
  /** Integrated 208-byte buffer. */
  integrated: ArrayBuffer;
  /** Number of integrated samples. */
  n: number;
  /** Index of the impact frame in the integrated buffer. */
  impactOutputIdx: number;
  player: PlayerState;
  ballOz: number;
}

export interface MetricResult {
  armSpeedRadS: number;
  torqueNm: number;
  armSlotRad: number;
  peakIdx: number;
  torqueSeriesNearPeak?: number[];
  torquePeakIdx?: number;
  /** Diagnostic: pvVar11_lpf at peakIdx (centripetal post-LPF). */
  pvVar11LpfAtPeak?: number;
  /** Diagnostic: pvVar12_lpf at peakIdx (inertial post-LPF). */
  pvVar12LpfAtPeak?: number;
  /** Diagnostic: speedDeriv at peakIdx (= 5pt-diff(LPF2(omega_x))). */
  speedDerivAtPeak?: number;
}

export function computeMetrics(inputs: MetricInputs): MetricResult {
  const { integrated, n, impactOutputIdx, player, ballOz } = inputs;
  const dv = new DataView(integrated);

  const massKg = player.weightKg;
  const heightM = player.heightM;
  const ballMassKg = ballOz * 0.0283495;
  // device_id != 3 branch
  const effMomentArm = ballMassKg + massKg * MOMENT_ARM_OFFSET;
  const elbowY = heightM * ELBOW_Y_HEIGHT_FRACTION + ELBOW_Y_OFFSET;

  // ────────────────────────────────────────────────────────────────────
  // 1. Build per-sample series of ω_body_mag and ω_body_x for samples [15..n-5]
  // ────────────────────────────────────────────────────────────────────
  const omegaMag = new Float64Array(n);
  const omegaX = new Float64Array(n);
  const startSample = 15;
  const endSample = Math.max(startSample, n - 5);
  for (let i = startSample; i < endSample; i++) {
    const off = i * SAMPLE_BYTES_208_PUBLIC;
    const wx = dv.getFloat64(off + OFF208_PUBLIC.OMEGA_BODY, true);
    const wy = dv.getFloat64(off + OFF208_PUBLIC.OMEGA_BODY + 8, true);
    const wz = dv.getFloat64(off + OFF208_PUBLIC.OMEGA_BODY + 16, true);
    omegaMag[i] = Math.sqrt(wx * wx + wy * wy + wz * wz);
    omegaX[i] = wx;
  }

  // ────────────────────────────────────────────────────────────────────
  // 2. Arm speed: LPF2 → saturation interp → LPF2 → peak in window
  // ────────────────────────────────────────────────────────────────────
  const speedSeries = new Float64Array(omegaMag);
  miniLPF2(speedSeries);
  bhInterpolateArmSpeed(speedSeries, ARMSPEED_SAT_THRESHOLD);
  miniLPF2(speedSeries);

  // Per `_GSEstimateReleaseFromMinimumSlotAngle` lines 117-141:
  //   peakSpeed = max(LPF2 → BHinterpolateArmSpeed → LPF2 of omegaMag) ← used in boost formula
  //   peakIdx   = argmax of RAW omegaMag                              ← used as torque-window center
  // These are tracked separately (uVar40 in the binary tracks raw-omega argmax).
  let peakIdx = startSample;
  let peakOmegaMag = 0;
  let peakSpeed = 0.1; // matches binary's seed `dVar42 = 0.1`
  for (let i = startSample; i < endSample; i++) {
    if (speedSeries[i] > peakSpeed) {
      peakSpeed = speedSeries[i];
    }
    if (omegaMag[i] > peakOmegaMag) {
      peakOmegaMag = omegaMag[i];
      peakIdx = i;
    }
  }

  // Piecewise boost (arm speed in rad/s):
  //   delta = max(0, peakSpeed - SPEED_BREAK_HIGH)
  //   speed = peakSpeed - SPEED_BREAK_LOW + (delta / SPEED_BOOST_DENOM) × 1000 × π/180
  //   speed = clamp(SPEED_CLAMP_MIN, SPEED_CLAMP_MAX, speed)
  const delta = Math.max(0, peakSpeed - SPEED_BREAK_HIGH);
  let armSpeed = peakSpeed - SPEED_BREAK_LOW + (delta / SPEED_BOOST_DENOM) * 1000 * Math.PI / 180;
  if (armSpeed < SPEED_CLAMP_MIN) armSpeed = SPEED_CLAMP_MIN;
  if (armSpeed > SPEED_CLAMP_MAX) armSpeed = SPEED_CLAMP_MAX;

  // ────────────────────────────────────────────────────────────────────
  // 3. Torque: per-sample (inertial - centripetal), LPF2, peak in window
  // ────────────────────────────────────────────────────────────────────
  const omegaXFiltered = new Float64Array(omegaX);
  miniLPF2(omegaXFiltered);
  const speedDeriv = new Float64Array(n);
  fivepointDiffArmSpeed(speedDeriv, omegaXFiltered);

  // Per `_GSEstimateReleaseFromMinimumSlotAngle.c` lines 192-220:
  //   pvVar11[i] = centripetal      (= scalar_C_g × dVar44 × elbowY)
  //   pvVar12[i] = inertial          (= inertialCoef × 0.0076 × α_X)
  //   miniLPF2(pvVar11);              ← INDIVIDUAL LPF — was missing in earlier port
  //   miniLPF2(pvVar12);              ← INDIVIDUAL LPF — was missing in earlier port
  //   pvVar13[i] = pvVar12_lpf[i] - pvVar11_lpf[i]
  //   miniLPF2(pvVar13);
  //   torque = peak |pvVar13|
  const pvVar11 = new Float64Array(n);
  const pvVar12 = new Float64Array(n);
  const inertialCoef = (massKg * heightM * heightM) / INERTIAL_DIVISOR;
  for (let i = startSample; i < endSample; i++) {
    const off = i * SAMPLE_BYTES_208_PUBLIC;
    const scalarCG = dv.getFloat64(off + OFF208_PUBLIC.SCALAR_C_G, true);
    pvVar11[i] = scalarCG * effMomentArm * elbowY;
    pvVar12[i] = inertialCoef * INERTIAL_MULTIPLIER * speedDeriv[i];
  }
  miniLPF2(pvVar11);
  miniLPF2(pvVar12);
  const torqueSeries = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    torqueSeries[i] = pvVar12[i] - pvVar11[i];
  }
  // Snapshot pvVar13 BEFORE the final LPF2 — used by the diff harness to
  // diff against the expert's table (which is also pre-final-LPF2).
  const pvVar13PreFinalLPF = new Float64Array(torqueSeries);
  miniLPF2(torqueSeries);

  // Peak |torque| in window — per `_GSEstimateReleaseFromMinimumSlotAngle.c`
  // lines 160-235, the window for device_id ∉ {3, 5} (i.e. Pulse `device_id == 1`)
  // is **[peak-1000, peak-31]**, NOT `[peak-1000, peak+50]` (which is the
  // device_id == 3 branch). Critical detail: line 170 overrides
  // `uVar24 = uVar32 = peak - 30` for our device class.
  //
  //   uVar40 = peakIdx
  //   uVar32 = peakIdx - 30
  //   uVar24 = peakIdx + 40   (then overridden to uVar32 for device_id != 3, != 5)
  //   if (nOut <= uVar24) uVar24 = nOut
  //   if (uVar24 < 0x11)  uVar24 = 0x10
  //   uVar23 = (peakIdx < 0x3f8) ? 0x3f7 : peakIdx
  //   scan window = [uVar23 - 1000, uVar24]   inclusive
  const uVar40 = peakIdx;
  const uVar32 = uVar40 - 30;
  let uVar24 = uVar32; // device_id != 3, != 5 branch
  if (n <= uVar24) uVar24 = n;
  if (uVar24 < 0x11) uVar24 = 0x10;
  const uVar23 = uVar40 < 0x3f8 ? 0x3f7 : uVar40;
  let torquePeak = 0.1;
  let torquePeakIdx = uVar23 - 1000;
  if (uVar23 - 1000 < uVar24) {
    // Binary scans [uVar23-1000, uVar24-1] inclusive (lVar36 = uVar24-uVar23+1000
    // iterations starting at pvVar13[uVar23-1000], advancing by 1). Per-sample
    // count = uVar24 - uVar23 + 1000; my earlier `<= uVar24` was off-by-one.
    for (let i = uVar23 - 1000; i < uVar24; i++) {
      const a = Math.abs(torqueSeries[i]);
      if (a > torquePeak) {
        torquePeak = a;
        torquePeakIdx = i;
      }
    }
  }
  // Capture torque series in [peakIdx-10, peakIdx+10] for diff-against-dump.
  // Use pre-final-LPF values so they directly compare to the expert's pvVar13 table.
  const torqueSeriesNearPeak: number[] = [];
  for (let i = peakIdx - 10; i <= peakIdx + 10; i++) {
    torqueSeriesNearPeak.push(pvVar13PreFinalLPF[i] ?? NaN);
  }

  // ────────────────────────────────────────────────────────────────────
  // 4. Arm slot: angle from forearm vector to lab-vertical
  //
  // Simplified per FORMULAS.md lines 67-77:
  //   slot_deg = (90 - (forearm_elevation - 90)) + 5
  //
  // Forearm elevation = angle (in degrees) from gravity direction. We compute
  // it from the rotation matrix at peakIdx by taking the body-to-lab Z-axis
  // and measuring its angle from world-up.
  // ────────────────────────────────────────────────────────────────────
  const armSlotRad = computeArmSlot(dv, peakIdx, n);

  return {
    armSpeedRadS: armSpeed,
    torqueNm: torquePeak,
    armSlotRad,
    peakIdx,
    torqueSeriesNearPeak,
    torquePeakIdx,
    pvVar11LpfAtPeak: pvVar11[peakIdx],
    pvVar12LpfAtPeak: pvVar12[peakIdx],
    speedDerivAtPeak: speedDeriv[peakIdx],
  };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Saturation interp on the arm-speed channel.
 *
 * Faithful port of `_BHinterpolateArmSpeed @ 0x77fc` + `_splineBHArmSpeed @ 0xac94`.
 * Two-pass scan (positive then negative saturation runs); each run is patched
 * by `splineBHArmSpeed`, which differs from generic `_splineBH`:
 *   1. Initial derivative seed uses factor **0.9** (not 0.6).
 *
 * Critically, this EXTRAPOLATES ABOVE the saturation cap (~80 rad/s),
 * matching the binary's behavior for high-velocity throws. Linear interp
 * (the previous port) clipped peaks at ~80, producing 25-35% arm-speed errors
 * on cmd01_18-01-56 events.
 */
function bhInterpolateArmSpeed(channel: Float64Array, threshold: number): void {
  const n = channel.length;
  // Build markers: +1 above threshold, -1 below -threshold, 0 otherwise.
  const markers = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (channel[k] > threshold) markers[k] = 1;
    else if (channel[k] < -threshold) markers[k] = -1;
  }

  // Pass A — positive saturation runs (mirror of `_BHinterpolateAll` Pass A
  // with the spline call replaced by `splineBHArmSpeed`).
  for (let uVar5 = 1; uVar5 < n - 1; ) {
    let bumped = uVar5 + 1;
    if (markers[uVar5] > 0 && markers[uVar5 - 1] <= 0 && uVar5 < n - 3) {
      let cursor = uVar5 + 1;
      let runEnd = uVar5;
      while (cursor < n - 3) {
        if (markers[cursor] <= 0 && markers[cursor - 1] > 0) {
          runEnd = cursor;
          break;
        }
        cursor++;
        runEnd = uVar5;
      }
      const span = runEnd - uVar5;
      if (uVar5 + 5 < runEnd && uVar5 > 5 && span < 0x78 && runEnd < n - 5) {
        const x4 = [uVar5 - 1, uVar5, runEnd, runEnd + 1];
        const y4 = [
          channel[uVar5 - 1],
          channel[uVar5],
          channel[runEnd],
          channel[runEnd + 1],
        ];
        const spanSize = x4[2] - x4[0];
        const out = new Float64Array(spanSize).fill(channel[uVar5]);
        splineBHArmSpeed(y4, out);
        for (let k = 1; k < spanSize; k++) {
          channel[uVar5 + k - 1] = out[k];
        }
      }
      bumped = cursor + 1;
    }
    uVar5 = bumped;
  }

  // Pass B — negative saturation runs.
  for (let uVar5 = 1; uVar5 < n - 1; ) {
    let bumped = uVar5 + 1;
    if (markers[uVar5] >= 0 && uVar5 < n - 3 && markers[uVar5 + 1] < 0) {
      let cursor = uVar5 + 2;
      let runEnd = uVar5 + 1;
      while (cursor < n - 3) {
        if (markers[cursor - 1] < 0 && markers[cursor] >= 0) {
          runEnd = cursor;
          break;
        }
        cursor++;
        runEnd = uVar5 + 1;
      }
      const span = runEnd - (uVar5 + 1);
      if (uVar5 + 6 < runEnd && uVar5 > 4 && span < 0x78 && runEnd < n - 5) {
        const x4 = [uVar5, uVar5 + 1, runEnd, runEnd + 1];
        const y4 = [
          channel[uVar5],
          channel[uVar5 + 1],
          channel[runEnd],
          channel[runEnd + 1],
        ];
        const spanSize = runEnd - uVar5;
        const out = new Float64Array(spanSize + 1).fill(channel[uVar5 + 1]);
        splineBHArmSpeed(y4, out);
        const writeCount = runEnd - uVar5 - 2;
        for (let k = 0; k < writeCount; k++) {
          channel[uVar5 + 1 + k] = out[1 + k];
        }
      }
      bumped = cursor + 1;
    }
    uVar5 = bumped;
  }
}

/**
 * `_splineBHArmSpeed @ 0xac94`. Custom 2-piece spline:
 *   half = span >> 1 (or 1 if span < 4)
 *   left half: cumulative-sum with linearly-decaying derivative
 *              seeded at 0.9 × (y4[1] - y4[0])
 *   right half: parabola from out[half-1] toward y4[2]
 *
 * Span = x4[2] - x4[0] (the boundary span).
 */
function splineBHArmSpeed(y4: number[], out: Float64Array): void {
  const spanRaw = out.length;
  // Empirically, binary's effective half is (span - 1) >> 1, not span >> 1.
  // For ev=0 of cmd01_18-01-56 (run length 49): span=50 → half=24, peak at
  // out[23] (sample 2828), matching binary's column dump in
  // `EV2_PVVAR13_DUMP.md`. Using `span >> 1 = 25` shifts the peak one sample
  // late and inflates magnitude by ~0.9 rad/s, propagating through the boost
  // formula to ~1.16% high arm speed on the 6 cmd01_18-01-56 outliers.
  let half = (spanRaw - 1) >>> 1;
  if (spanRaw < 4) half = 1;

  let acc = y4[1];
  let deriv = (y4[1] - y4[0]) * 0.9;
  const negDeriv = -deriv;

  out[0] = acc;
  for (let k = 1; k < half; k++) {
    deriv = deriv + negDeriv / half;
    acc = acc + deriv;
    out[k] = acc;
  }

  // Right half: parabola from out[half-1] toward y4[2]
  const rightLen = spanRaw - half;
  if (rightLen > 0) {
    const mid = out[half - 1] ?? y4[1];
    const end = y4[2];
    const denom = rightLen * rightLen;
    for (let k = 0; k < rightLen; k++) {
      out[half + k] = mid + (k * k * (end - mid)) / denom;
    }
  }
}

/**
 * Arm slot — full port of `_GSEstimateReleaseFromMinimumSlotAngle` lines 313-386.
 *
 * Algorithm:
 *   1. Build pvVar15[i] = arcsin(R[7]_i) × 180/π + 5  for each integrated sample i.
 *      (R[7] = element at row 2, col 1 of integrated sample's rotation matrix.
 *      This is the Z-component of the forearm's lab-frame direction, since
 *      forearm_body = (0, M, 0) → forearm_lab = R × (0, M, 0) → z = R[7]·M.)
 *   2. pvVar16 = fivepointDiffArmSlot(pvVar15).
 *   3. Zero-crossing scan over uVar38 ∈ [peakIdx - 103, peakIdx]:
 *      first uVar38 where pvVar16[uVar38-21] >= 0 AND pvVar16[uVar38-20] < 0
 *      → lVar36 = uVar38 - 20.
 *   4. Fallback: scan lVar36 backward from peakIdx-20 down to peakIdx-124
 *      finding first lVar36 where pvVar16[lVar36] is a local max with
 *      pvVar16[lVar36] > -20 (and pvVar16[lVar36-1] < pvVar16[lVar36],
 *      pvVar16[lVar36+1] < pvVar16[lVar36]).
 *   5. Refinement loop scans backward from lVar36-6 looking for a "rising
 *      pattern" in pvVar15 that drops below initial dVar42; usually doesn't
 *      fire → final slot = pvVar15[lVar36] × π / 180.
 */
function computeArmSlot(dv: DataView, peakIdx: number, n: number): number {
  // Step 1: pvVar15
  const pvVar15 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * SAMPLE_BYTES_208_PUBLIC;
    // R[7] = byte offset OFF208.R + 7*8 = 8 + 56 = 64
    const r7 = dv.getFloat64(off + OFF208_PUBLIC.R + 56, true);
    const clamped = r7 > 1 ? 1 : r7 < -1 ? -1 : r7;
    pvVar15[i] = (Math.asin(clamped) * 180.0) / Math.PI + 5.0;
  }

  // Step 2: pvVar16 = fivepointDiffArmSlot(pvVar15)
  const pvVar16 = new Float64Array(n);
  fivepointDiffArmSlot(pvVar16, pvVar15);

  // Step 3: Zero-crossing scan — find uVar38 ∈ [peakIdx-103, peakIdx] where
  // pvVar16 transitions from positive (at uVar38-21) to negative (at uVar38-20).
  let lVar36 = -1;
  for (let uVar38 = peakIdx; uVar38 >= peakIdx - 103; uVar38--) {
    const a = pvVar16[uVar38 - 21];
    const b = pvVar16[uVar38 - 20];
    if (a >= 0 && b < 0) {
      lVar36 = uVar38 - 20;
      break;
    }
  }

  // Step 4: Fallback — scan lVar36 backward looking for local max in pvVar16.
  if (lVar36 === -1) {
    let scanIdx = peakIdx - 20;
    while (scanIdx >= peakIdx - 124) {
      const cur = pvVar16[scanIdx];
      const prev = pvVar16[scanIdx - 1];
      const next = pvVar16[scanIdx + 1];
      if (cur > -20 && prev < cur && next < cur) {
        lVar36 = scanIdx;
        break;
      }
      scanIdx--;
    }
  }

  if (lVar36 === -1) {
    // Neither found — fall back to the simplified atan2 (should be rare).
    return 0;
  }

  // Step 5: Refinement loop. Initial dVar42 = pvVar15[lVar36], dVar44 = dVar42.
  let dVar42 = pvVar15[lVar36];
  let dVar44 = dVar42;

  // uVar24 = lVar36 (with floor at 0x18=24); uVar39 = lVar36 (with floor at 0xb=11).
  let uVar24 = lVar36;
  let uVar39 = lVar36;
  if (uVar39 < 11) uVar39 = 10;
  if (uVar24 < 25) uVar24 = 24;

  if (uVar24 - 16 < uVar39) {
    let refLVar = uVar39 - 6;
    let pIdx = uVar39 - 7; // pdVar14 = pvVar15 + uVar39 - 7
    while (refLVar > uVar24 - 22) {
      dVar44 = pvVar15[pIdx + 1];
      const pdVar0 = pvVar15[pIdx];
      const pdVar2 = pvVar15[pIdx + 2];
      let breakLoop = false;
      if (pdVar0 < dVar44) {
        if (dVar44 < pdVar2) {
          // Both inequalities hold: NaN-safe break check
          const bVar2 = dVar44 < dVar42;
          const bVar3 = dVar44 === dVar42;
          const bVar4 = false;
          if (!bVar3 && bVar2 === bVar4) breakLoop = true;
        }
      }
      if (breakLoop) break;
      pIdx--;
      refLVar--;
      dVar44 = dVar42;
    }
  }

  // Step 6: Convert degrees → radians and store. Float32 quantization at end.
  return Math.fround((dVar44 * Math.PI) / 180.0);
}

export const _internal = {
  bhInterpolateArmSpeed,
  computeArmSlot,
};
