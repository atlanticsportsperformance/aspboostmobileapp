/**
 * Step 5 — Saturation interpolation.
 *
 * References:
 *   _BHinterpolateAll.c @ 0x0add8 — saturation-run finder + spline patcher
 *   _splineBH.c          @ 0x0aad0 — custom 2-piece interpolation kernel
 *
 * For each of the 6 channels (gyro x/y/z, then accel x/y/z), find runs of
 * "saturated" samples (i.e. |sample| > threshold) — both positive and
 * negative — and replace each run's interior with `splineBH`-interpolated
 * values from the surrounding good samples.
 *
 * Thresholds (from `GSCalculateSwingFromIMUData @ 0xd164` line 118):
 *
 *   gyro:  0x40504456d5cfaace  ≈  65.067 rad/s   (≈ 3727 dps)
 *   accel: 0x4035c7ae147ae148  ≈  21.776 m/s²   (≈ 2.22 g)
 *
 * Run gating (only patch the run if all of):
 *   - run is long enough (≥ 5 or 6 samples — branch differs slightly between
 *     the positive- and negative-saturation passes)
 *   - run is short enough (< 0x78 = 120 samples)
 *   - run start > 5 (so we have at least one neighbor before)
 *   - run end < 0x1383 = 4995 (so we have neighbors after)
 *
 * `_splineBH` itself is a custom (NOT a true cubic spline) two-piece patcher:
 *   - Left half: cumulative-sum with a linearly-decaying derivative seeded
 *     at `0.6 × (in[uVar5] - in[uVar8-1])`.
 *   - Right half: parabolic from the mid-point value toward `in[uVar13]`.
 */

import { OFF60, SAMPLE_BYTES_60 } from './buffer-layout';
import { extractChannel, injectChannel } from './filters';

/** Decode an IEEE 754 hex bit-string (16 hex chars) into a JS number. */
function hexToDouble(hex: string): number {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  for (let i = 0; i < 8; i++) {
    dv.setUint8(i, parseInt(hex.substr((7 - i) * 2, 2), 16));
  }
  return dv.getFloat64(0, true);
}

const GYRO_SAT_THRESHOLD = hexToDouble('40504456d5cfaace');
const ACCEL_SAT_THRESHOLD = hexToDouble('4035c7ae147ae148');

const GYRO_AXES: readonly number[] = [OFF60.GX, OFF60.GY, OFF60.GZ];
const ACCEL_AXES: readonly number[] = [OFF60.AX, OFF60.AY, OFF60.AZ];

const SAMPLE_COUNT = 5000;
const RUN_MIN_LEN_POS = 6; // (uVar5+5 < uVar13) AND (uVar5 > 5)  → run length ≥ 6
const RUN_MIN_LEN_NEG = 7; // (uVar5+6 < uVar13) AND (uVar5 > 4)  → run length ≥ 7
const RUN_MAX_LEN = 0x78; // 120
const RUN_END_MAX_POS = 0x1383; // 4995
const RUN_END_MAX_NEG = 0x1383;
const SCAN_MAX = 0x1384; // 4996 (loop bound for the inner scan)
const SCAN_OUTER_MAX = 0x1386; // 4998 (loop bound for outer scan)

/**
 * Patch saturation runs across all 6 channels of a 5000-sample 60-byte buffer
 * in place.
 */
export function interpolateAll(buffer: ArrayBuffer): void {
  for (const off of GYRO_AXES) {
    const ch = extractChannel(buffer, off, SAMPLE_COUNT);
    interpolateChannel(ch, GYRO_SAT_THRESHOLD);
    injectChannel(buffer, off, ch);
  }
  for (const off of ACCEL_AXES) {
    const ch = extractChannel(buffer, off, SAMPLE_COUNT);
    interpolateChannel(ch, ACCEL_SAT_THRESHOLD);
    injectChannel(buffer, off, ch);
  }
}

// ────────────────────────────────────────────────────────────────────
// Per-channel saturation processing
// ────────────────────────────────────────────────────────────────────

function buildMarkers(channel: Float64Array, threshold: number): Float64Array {
  const m = new Float64Array(channel.length);
  const negThresh = -threshold;
  for (let i = 0; i < channel.length; i++) {
    const v = channel[i];
    if (v > threshold) m[i] = 1.0;
    else if (v < negThresh) m[i] = -1.0;
    else m[i] = 0;
  }
  return m;
}

function interpolateChannel(channel: Float64Array, threshold: number): void {
  const markers = buildMarkers(channel, threshold);

  // Pass A — positive-saturation runs (markers transition 0 → +1 → 0).
  // Mirrors lines 68-122 of the decompile.
  for (let uVar5 = 1; uVar5 < SCAN_OUTER_MAX; ) {
    let uVar12 = uVar5;
    if (markers[uVar5] > 0 && markers[uVar5 - 1] <= 0 && uVar5 < 0x1385) {
      // Find run end
      let uVar7 = uVar5 - 1;
      let uVar13 = uVar5;
      let cursor = uVar5 + 1;
      while (uVar7 < SCAN_MAX) {
        uVar12 = cursor;
        if (markers[cursor] <= 0 && markers[cursor - 1] > 0) {
          // Per expert response 17: binary's uVar13 is the LAST SATURATED
          // sample (= cursor - 1), not the first below-threshold sample.
          // This makes `half = span >> 1` come out one smaller, shifting the
          // spline peak one sample earlier and reducing peak magnitude.
          uVar13 = uVar12 - 1;
          break;
        }
        uVar7++;
        cursor++;
        uVar13 = uVar5;
        if (cursor > SCAN_MAX) break;
      }
      uVar12++;
      const runLen = uVar13 - uVar5;
      if (uVar5 + 5 < uVar13 && uVar5 > 5 && runLen < RUN_MAX_LEN && uVar13 < RUN_END_MAX_POS) {
        // Build x4 = [uVar8, uVar5, uVar13, uVar13+1] (4 boundary indices)
        const uVar8 = uVar5 - 1;
        const x4 = [uVar8, uVar5, uVar13, uVar13 + 1];
        // Build y4 = corresponding channel values
        const y4 = [channel[uVar8], channel[uVar5], channel[uVar13], channel[uVar13 + 1]];
        // Spline output buffer of length runLen + 1 (= uVar13 - uVar8 = uVar2)
        const span = uVar13 - uVar8; // = runLen + 1
        const out = new Float64Array(span).fill(channel[uVar5]);
        splineBH(x4, y4, out);
        // Per the binary's `_BHinterpolateAll` writeback (lines 107-115 of
        // 0x0add8): pvVar4[1..run_length-1] → channel[uVar5..uVar13-2]. The
        // LAST saturated sample (channel[uVar13-1]) is left at its raw value.
        // Iteration count = run_length - 1 = span - 2.
        for (let k = 1; k < span - 1; k++) {
          channel[uVar5 + k - 1] = out[k];
        }
      }
    }
    uVar5 = uVar12 + 1;
  }

  // Pass B — negative-saturation runs (markers transition 0 → -1 → 0).
  // Lines 123-175. Subtle differences in run gating: needs uVar5 > 4 and
  // uVar5+6 < uVar13 (== run length ≥ 7).
  for (let uVar5 = 1; uVar5 < SCAN_OUTER_MAX; ) {
    let uVar12 = uVar5;
    if (markers[uVar5] >= 0 && markers[uVar5 + 1] < 0 && uVar5 < 0x1385) {
      const uVar8 = uVar5 + 1;
      let uVar7 = uVar5;
      let uVar17 = uVar8;
      let cursor = uVar8 + 1;
      while (uVar7 < SCAN_MAX) {
        if (markers[cursor - 1] < 0 && markers[cursor] >= 0) {
          // Per expert response 17: binary's uVar17 is the LAST NEGATIVE
          // sample (= cursor - 1), not the first non-negative sample.
          uVar17 = cursor - 1;
          break;
        }
        cursor++;
        uVar7++;
        uVar17 = uVar8;
        if (cursor > SCAN_MAX) break;
      }
      uVar12 = uVar7 + 1;
      const iVar15 = uVar17;
      const runLen = iVar15 - uVar8;
      if (uVar5 + 6 < iVar15 && uVar5 > 4 && runLen < RUN_MAX_LEN && iVar15 < RUN_END_MAX_NEG) {
        const x4 = [uVar5, uVar8, iVar15, iVar15 + 1];
        const y4 = [channel[uVar5], channel[uVar8], channel[iVar15], channel[iVar15 + 1]];
        const span = iVar15 - uVar5; // boundary span
        const out = new Float64Array(span + 1).fill(channel[uVar8]);
        splineBH(x4, y4, out);
        // Write spline interior into channel[uVar8..iVar15-2] (= iVar15 - uVar5 - 2 samples)
        const writeCount = iVar15 - uVar5 - 2;
        for (let k = 0; k < writeCount; k++) {
          channel[uVar8 + k] = out[1 + k];
        }
      }
    }
    uVar5 = uVar12 + 1;
  }
}

// ────────────────────────────────────────────────────────────────────
// _splineBH — custom two-piece patcher
// ────────────────────────────────────────────────────────────────────

/**
 * Produce a smooth replacement for a saturated run.
 *
 * Inputs:
 *   x4 = [uVar8, uVar5, uVar13, uVar13+1]  (4 boundary x-coordinates)
 *   y4 = [in[uVar8], in[uVar5], in[uVar13], in[uVar13+1]]
 *   out = preallocated Float64Array of length (x4[2] - x4[0])
 *
 * Behavior (lines 21-49 of `_splineBH.c`):
 *   half = (x4[2] - x4[0]) >> 1     // span >> 1
 *   if span <= 3 → no-op
 *   Left half: derivative-decay accumulator seeded at `0.6 × (y4[1] - y4[0])`.
 *     out[0] = y4[1]
 *     for k in 1..half-1:
 *       deriv += -seed_deriv / half
 *       out[k] = out[k-1] + deriv
 *   Right half: parabola from out[half-1] toward y4[2].
 *     for k in 0..(span-half-1):
 *       out[half + k] = out[half-1] + k² × (y4[2] - out[half-1]) / (span-half)²
 */
function splineBH(x4: number[], y4: number[], out: Float64Array): void {
  const span = x4[2] - x4[0];
  if (span <= 3) return;

  const half = span >>> 1;
  let acc = y4[1];
  let deriv = (y4[1] - y4[0]) * 0.6;
  const negDeriv = -deriv;

  out[0] = acc;
  for (let k = 1; k < half; k++) {
    deriv = deriv + negDeriv / half;
    acc = acc + deriv;
    out[k] = acc;
  }

  // Right half: parabola from out[half-1] toward y4[2]
  const mid = out[half - 1];
  const end = y4[2];
  const rightLen = span - half;
  const denom = rightLen * rightLen;
  for (let k = 0, i = half; i < span; k++, i++) {
    out[i] = mid + (k * k * (end - mid)) / denom;
  }
}

// ────────────────────────────────────────────────────────────────────
// BHinterpolateSome — saturation-spline pass on the SCALAR_C channel
//
// Reference: `pulse_probe/decompiled/GolfSwingKit/0x0bd94__BHinterpolateSome.c`
// (calls `_splineBHtorqueA @ 0x0ab7c`).
//
// Runs AFTER `miniLPFtorque(AZ) → SCALAR_C` and AFTER `BHinterpolateAll`.
// Detects saturation runs in SCALAR_C (threshold = 21.7 m/s² ≈ 2.21 g) and
// patches them with a cubic-spline extrapolation that EXTENDS ABOVE the cap.
//
// Critical: outer loop scans from sample 0x9c4 = 2500. Events whose impact
// occurs before sample 2500 (60 of 66 captured events) skip this stage
// entirely — which is why those events were already byte-exact without it.
// Events with impact in [2500, 4998] (the 6 cmd01_18-01-56 high-velocity
// outliers) need this stage; missing it caused a ~9 Nm pvVar13 deficit at
// the terminal climb of the torque scan window.
// ────────────────────────────────────────────────────────────────────

const SCALAR_C_SAT_THRESHOLD = hexToDouble('4035b33333333333'); // 21.7 m/s²
const SOME_OUTER_START = 0x9c4;   // 2500
const SOME_OUTER_END = 0x1386;    // 4998 (loop bound exclusive)
const SOME_RUN_END_MAX = 0x1383;  // 4995
const SOME_MERGE_LIMIT = 0x1384;  // 4996 (inner-merge scan upper bound)

/**
 * `_splineBHtorqueA @ 0xab7c`. Variant of `_splineBH` used by
 * `_BHinterpolateSome` for the SCALAR_C channel.
 *
 *   half = (run_length + 1) / 2 (or 1 if run_length+1 < 4)
 *
 *   left half (k=0..half-1):
 *     out[0]     = y4[1]
 *     deriv0     = y4[1] - y4[0]
 *     deriv_k    = deriv0 × (1 - k/half)
 *     out[k]     = out[k-1] + deriv_k
 *
 *   right half (k=0..len-half-1):
 *     out[half+k] = out[half-1] + k² × ((y4[2] - out[half-1]) / (len-half)²)
 *
 * Differs from `splineBHArmSpeed` only in the absence of the 0.9 multiplier
 * on `deriv0`.
 */
function splineBHtorqueA(y4: number[], out: Float64Array): void {
  const len = out.length;
  let half = len >>> 1;
  if (len < 4) half = 1;

  let acc = y4[1];
  let deriv = y4[1] - y4[0]; // no 0.9 here (unlike armspeed variant)
  const negDeriv = -deriv;

  out[0] = acc;
  for (let k = 1; k < half; k++) {
    deriv = deriv + negDeriv / half;
    acc = acc + deriv;
    out[k] = acc;
  }

  // Right half: parabola from out[half-1] toward y4[2]
  const rightLen = len - half;
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
 * Apply `_BHinterpolateSome` saturation-spline pass to the SCALAR_C field of
 * a 5000-sample 60-byte buffer in place. Reads SCALAR_C of every sample,
 * builds saturation markers, and patches positive- and negative-saturation
 * runs in [2500, 4998] using `splineBHtorqueA`.
 *
 * @param peakGyroIdx — index of max gyro magnitude (`iVar1` in the binary's
 *   `GSCalculateSwingFromIMUData @ d164:95-113`). Caps the merge-extension
 *   window for nearby saturation runs.
 */
export function bhInterpolateSome(buffer: ArrayBuffer, peakGyroIdx: number): void {
  const dv = new DataView(buffer);
  const n = Math.floor(buffer.byteLength / SAMPLE_BYTES_60);

  // Extract SCALAR_C as flat array
  const scalarC = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    scalarC[i] = dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.SCALAR_C, true);
  }

  // Build markers (only for samples we'll actually scan, but build full so
  // we can index any sample).
  const markers = buildMarkers(scalarC, SCALAR_C_SAT_THRESHOLD);

  // iVar1 = min(peakGyroIdx, 0x11f8) + 400  — caps the merge-extension scan.
  const iVar1 = (peakGyroIdx > 0x11f7 ? 0x11f8 : peakGyroIdx) + 400;

  // ── Pass A: positive saturation runs ──────────────────────────────
  patchPass(scalarC, markers, iVar1, /* positive= */ true);

  // ── Pass B: negative saturation runs ──────────────────────────────
  patchPass(scalarC, markers, iVar1, /* positive= */ false);

  // Write SCALAR_C back to buffer
  for (let i = 0; i < n; i++) {
    dv.setFloat64(i * SAMPLE_BYTES_60 + OFF60.SCALAR_C, scalarC[i], true);
  }
}

function patchPass(
  scalarC: Float64Array,
  markers: Float64Array,
  iVar1: number,
  positive: boolean,
): void {
  // For Pass A (positive): run start when marker[i] > 0 AND marker[i-1] <= 0;
  //   run end when marker[k] <= 0 AND marker[k-1] > 0.
  // For Pass B (negative): mirror — start when marker[i] >= 0 AND marker[i+1] < 0;
  //   end when marker[k] >= 0 AND marker[k-1] < 0 (read direction same: next index).
  let uVar8 = SOME_OUTER_START;
  while (uVar8 < SOME_OUTER_END) {
    const iVar6 = uVar8;
    let advance = uVar8 + 1;

    // Detect run start
    const startCondition = positive
      ? markers[iVar6] > 0 && markers[iVar6 - 1] <= 0
      : markers[iVar6] >= 0 && markers[iVar6 + 1] < 0;

    if (startCondition && iVar6 < 0x1385) {
      // Find run end
      let uVar10 = uVar8;
      let uVar19 = uVar8;
      let uVar16: number;

      if (positive) {
        // Pass A: scan forward for marker[k] <= 0 AND marker[k-1] > 0.
        // Per expert response 17: uVar10 = LAST SATURATED sample (= k - 1),
        // not the first below-threshold sample. Same off-by-one fix as in
        // `_BHinterpolateAll`.
        let k = iVar6 + 1;
        let found = false;
        while (k < SOME_MERGE_LIMIT) {
          if (markers[k] <= 0 && markers[k - 1] > 0) {
            uVar10 = k - 1;
            found = true;
            break;
          }
          k++;
        }
        if (!found) uVar10 = uVar8;
        uVar19 = uVar10 + 1;
        uVar16 = uVar10;
      } else {
        // Pass B: scan forward for marker[k-1] < 0 AND marker[k] >= 0.
        // Same off-by-one fix: uVar19/uVar16 = LAST NEGATIVE sample (= k - 1).
        uVar19 = iVar6 + 1;
        uVar16 = iVar6 + 1;
        let k = iVar6 + 2;
        while (k < SOME_MERGE_LIMIT) {
          if (markers[k - 1] < 0 && markers[k] >= 0) {
            uVar19 = k - 1;
            uVar16 = k - 1;
            break;
          }
          k++;
        }
        uVar10 = uVar19;
      }

      let iVar17 = uVar16;
      let iVar18 = uVar19;

      // Inner merge loop — extend run if another saturation run starts within
      // 9 samples and we're still below peak_gyro_idx + 400.
      let merged = false;
      if (iVar18 < iVar1) {
        let scan = uVar19;
        let bVar3 = false;
        while (scan + 1 < iVar1) {
          const iVar15 = scan;
          // Look for next run-start of same sign within 9 samples of run end
          const reentryCondition = positive
            ? markers[iVar15] > 0 && markers[iVar15 - 1] <= 0
            : markers[iVar15] >= 0 && markers[iVar15 + 1] < 0;
          if (reentryCondition && !bVar3 && iVar15 - uVar16 < 9 && iVar15 < iVar1) {
            // Find this sub-run's end
            let k = iVar15 + 1;
            let foundEnd = false;
            while (k + 1 < iVar1) {
              const subEnd = positive
                ? markers[k] <= 0 && markers[k - 1] > 0
                : markers[k] >= 0 && markers[k - 1] < 0;
              if (subEnd) {
                bVar3 = true;
                merged = true;
                uVar10 = k;
                uVar16 = k;
                iVar17 = k;
                iVar18 = k;
                foundEnd = true;
                scan = k + 1;
                break;
              }
              k++;
            }
            if (!foundEnd) {
              break;
            }
          } else {
            scan++;
          }
        }
      }

      // Bounds check + run-length cap, then patch.
      const lenCap = merged ? 400 : 0x96;
      const startBound = positive ? iVar6 + 5 < iVar17 && iVar6 > 5 : iVar6 + 6 < iVar17 && iVar6 > 4;
      if (startBound && iVar17 < SOME_RUN_END_MAX) {
        const uVar12 = positive ? iVar6 - 1 : iVar6 + 1;
        const runLen = positive ? iVar17 - iVar6 : iVar17 - uVar12;
        if (runLen > 0 && runLen < lenCap) {
          // x4 = [run_start_minus_1, run_start, run_end, run_end+1] (Pass A)
          //     = [run_start, run_start_plus_1, run_end, run_end+1]  (Pass B)
          // y4 = SCALAR_C at those indices.
          const y4 = positive
            ? [scalarC[uVar12], scalarC[iVar6], scalarC[iVar17], scalarC[iVar17 + 1]]
            : [scalarC[iVar6], scalarC[uVar12], scalarC[iVar17], scalarC[iVar17 + 1]];

          // Allocate spline output of size run_length + 1, filled with y4[1].
          const out = new Float64Array(runLen + 1).fill(y4[1]);
          splineBHtorqueA(y4, out);

          // Writeback: per the binary, lVar7 = (iVar17 - 1) - iVar6 = N - 2
          // iterations (where N = saturated run length). After expert response
          // 17's fix, runLen = uVar10 - iVar6 = N - 1, so writeCount = N - 2
          // becomes `runLen - 1`. Writes out[1..N-2] → SCALAR_C of run.
          const writeStart = positive ? iVar6 : uVar12;
          const writeCount = runLen - 1;
          for (let k = 0; k < writeCount; k++) {
            scalarC[writeStart + k] = out[k + 1];
          }
        }
      }

      advance = iVar18 + 1;
    }
    uVar8 = advance;
  }
}

export const _internal = {
  GYRO_SAT_THRESHOLD,
  ACCEL_SAT_THRESHOLD,
  SCALAR_C_SAT_THRESHOLD,
  splineBH,
  splineBHtorqueA,
  buildMarkers,
};
