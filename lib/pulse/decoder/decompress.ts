/**
 * Step 3 — Lanczos-2 sinc decompressor.
 *
 * Reference: `_BHDecompressAllData @ 0xc990` in
 * `/Users/maxsmac/Desktop/motus/pulse_probe/decompiled/GolfSwingKit/`.
 *
 * Algorithm:
 *   1. Determine effective metadata length: scan compression bytes for the
 *      first '\0' starting at index 1 (Pulse's exact convention), capped at 50.
 *   2. Determine effective input length: scan the input GY channel for four
 *      consecutive zeros (= junk/fill region — `isZero` style termination).
 *   3. For each of 6 channels (gx, gy, gz pass; ax, ay, az pass), upsample
 *      with a 5-tap Lanczos-2 windowed sinc kernel:
 *        for each metadata byte b (∈ [1, 100]):
 *          for each "input sample slot" inside this metadata chunk:
 *            fetch 5 surrounding input samples (with edge clamping)
 *            produce b output samples by Lanczos-weighted sum
 *      yielding 100/b × b ≈ 100 output samples per metadata byte.
 *   4. Right-align (front-pad) the output buffer to exactly 5000 samples by
 *      replicating the input's first sample backward, mirroring the binary's
 *      finalization pass at lines 316-374.
 *
 * The Lanczos-2 weight at distance x (output relative to input grid) is:
 *
 *      x = 0:     w = 1
 *      x ≠ 0:     w = sinc(πx) · sinc(πx / 2)
 *               = (sin(πx) / (πx)) · (sin(πx/2) / (πx/2))
 *
 * with kernel offsets {-2, -1, 0, 1, 2}.
 */

import { OFF60, SAMPLE_BYTES_60 } from './buffer-layout';

const OUTPUT_SAMPLES = 5000;
const META_MAX = 0x32; // 50
const META_SCAN_CAP = 0x31; // 49 — loop bound matching the binary's `do { ... } while (uVar7 != 0x31)`
const KERNEL_OFFSETS = [-2, -1, 0, 1, 2] as const;
const ZERO_RUN_TERMINATOR = 4; // four consecutive zeros in GY = junk/fill

const AXIS_OFFSETS_GYRO: readonly number[] = [OFF60.GX, OFF60.GY, OFF60.GZ];
const AXIS_OFFSETS_ACCEL: readonly number[] = [OFF60.AX, OFF60.AY, OFF60.AZ];

/**
 * Decompress a calibrated 60-byte/sample input buffer to a 5000-sample
 * 60-byte/sample output buffer (300000 bytes total).
 */
export function decompressAllData(
  calibrated: ArrayBuffer,
  compression: Uint8Array,
): ArrayBuffer {
  const out = new ArrayBuffer(OUTPUT_SAMPLES * SAMPLE_BYTES_60);
  const inDv = new DataView(calibrated);
  const outDv = new DataView(out);
  const nInput = Math.floor(calibrated.byteLength / SAMPLE_BYTES_60);

  const metaLen = effectiveMetadataLength(compression);
  if (metaLen <= 0 || nInput <= 0) {
    // No metadata means nothing to decompress; output stays zero. (In practice
    // this never happens — every event has 27..50 metadata bytes.)
    return out;
  }

  const inputRange = effectiveInputRange(inDv, nInput);

  // Pass 1: gyro channels (input offsets GX, GY, GZ → same output offsets).
  let lastWritten = decompressPass(
    outDv,
    inDv,
    inputRange,
    compression,
    metaLen,
    AXIS_OFFSETS_GYRO,
  );
  // Pass 2: accel channels.
  lastWritten = decompressPass(
    outDv,
    inDv,
    inputRange,
    compression,
    metaLen,
    AXIS_OFFSETS_ACCEL,
  );

  // Finalization: right-align the produced data to fill exactly 5000 slots,
  // front-padding with copies of the first decompressed sample (== Lanczos
  // output of the first input sample's neighborhood). Mirrors lines 316-374.
  rightAlignAndFrontPad(outDv, lastWritten);

  return out;
}

// ────────────────────────────────────────────────────────────────────
// Metadata + input-range scans
// ────────────────────────────────────────────────────────────────────

/**
 * Replicate the binary's exact metadata-length convention:
 *
 *     uVar7 = 0;
 *     do {
 *       if (compression[1 + uVar7] == 0) break;
 *       uVar7 += 1;
 *     } while (uVar7 != 0x31);
 *     if (uVar7 == 0x31) uVar7 = 0x32;
 *
 * Out-of-bounds reads (when `compression.byteLength < 1 + uVar7`) terminate
 * the loop the same way a null byte would, since RAM past the buffer end is
 * not structured.
 */
function effectiveMetadataLength(compression: Uint8Array): number {
  let len = 0;
  while (len < META_SCAN_CAP) {
    const idx = 1 + len;
    if (idx >= compression.byteLength) return len;
    if (compression[idx] === 0) return len;
    len++;
  }
  return META_MAX;
}

/**
 * Find the effective input range by scanning the GY channel for
 * `ZERO_RUN_TERMINATOR` consecutive zero samples — Pulse's "junk / fill"
 * marker. Returns `nInput` if no run is found.
 *
 * Mirrors lines 62-87 of the decompile (the preamble before each axis pass).
 */
function effectiveInputRange(inDv: DataView, nInput: number): number {
  if (nInput <= 0) return 0;
  let zeroRun = 0;
  for (let i = 0; i < nInput; i++) {
    const gy = inDv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.GY, true);
    if (gy === 0.0) {
      zeroRun++;
      if (zeroRun >= ZERO_RUN_TERMINATOR) return i - ZERO_RUN_TERMINATOR + 1;
    } else {
      zeroRun = 0;
    }
  }
  return nInput;
}

// ────────────────────────────────────────────────────────────────────
// Per-axis Lanczos pass
// ────────────────────────────────────────────────────────────────────

/**
 * Run one outer pass: 3 axes (gyro or accel triple), each producing up to
 * 100 × metaLen output samples. Returns the index of the last output sample
 * written (== output count after this pass).
 */
function decompressPass(
  outDv: DataView,
  inDv: DataView,
  nEffective: number,
  compression: Uint8Array,
  metaLen: number,
  axisOffsets: readonly number[],
): number {
  let lastIdx = 0;
  for (const axisOffset of axisOffsets) {
    lastIdx = decompressOneChannel(
      outDv,
      inDv,
      nEffective,
      compression,
      metaLen,
      axisOffset,
    );
  }
  return lastIdx;
}

/**
 * Decompress one channel (one axis) in place into the output buffer.
 *
 * Returns the index (1-based count) of the last sample written.
 */
function decompressOneChannel(
  outDv: DataView,
  inDv: DataView,
  nEffective: number,
  compression: Uint8Array,
  metaLen: number,
  axisOffset: number,
): number {
  // Running write position in the output buffer (`lVar8` in the decompile).
  let outIdx = 0;
  // Index that walks from -1 ("just before first input sample") through input
  // grid (`uVar18` in the decompile). After producing `b` output samples for
  // a chunk it's set to `uVar1 = uVar18 + 1`.
  let inputCursor = -1;

  for (let m = 0; m < metaLen; m++) {
    const b = compression[m];
    if (b === 0) continue;

    // Number of input-grid steps this metadata byte consumes:
    //   uVar2 = uVar18 + max(0, (int)(100 / b))
    // With b ≥ 1 always positive, this is just floor(100/b).
    const stepsThisChunk = Math.floor(100 / b);
    const cursorEnd = inputCursor + stepsThisChunk;

    while (inputCursor < cursorEnd) {
      const next = inputCursor + 1; // uVar1
      const e0 = neighborhood(inDv, axisOffset, inputCursor, next, nEffective);

      // Produce `b` output samples between input grid points.
      // Output sample k corresponds to fractional position (k / b - 1) in
      // the kernel's local coordinate system (centered between samples
      // inputCursor and next).
      for (let k = 0; k < b; k++) {
        const frac = (k - b) / b; // ∈ [-1, 0)
        let acc = 0;
        for (let j = 0; j < 5; j++) {
          const x = frac - KERNEL_OFFSETS[j];
          acc += e0[j] * lanczosWeight(x);
        }
        outDv.setFloat64(outIdx * SAMPLE_BYTES_60 + axisOffset, acc, true);
        outIdx++;
      }

      inputCursor = next;
    }
  }

  return outIdx;
}

/** Lanczos-2 windowed-sinc weight. `w(0) = 1`. */
function lanczosWeight(xRaw: number): number {
  if (xRaw === 0) return 1;
  const x = xRaw * Math.PI;
  return (Math.sin(x) / x) * (Math.sin(x * 0.5) / (x * 0.5));
}

/**
 * Fetch the 5-tap input neighborhood for the Lanczos kernel, replicating the
 * decompile's exact edge-clamping cases (lines 102-149 / 226-275).
 *
 * The neighborhood is conceptually:
 *
 *   e0 = [in[uVar18-1], in[uVar18], in[uVar1], in[uVar1+1], in[uVar1+2]]
 *
 * with clamping at both ends:
 *
 *   uVar18 == -1            (first chunk)
 *     → e0 = [in[0], in[0], in[0], in[1], in[2]]
 *   uVar18 == 0             (second chunk)
 *     → e0 = [in[0], in[0], in[1], in[2], in[3]]
 *   uVar1 == nEffective-1   (last input pos)
 *     → e0 = [in[N-3], in[N-2], in[N-1], in[N-1], in[N-1]]
 *   uVar1 == nEffective-2
 *     → e0 = [in[N-4], in[N-3], in[N-2], in[N-1], in[N-1]]
 */
function neighborhood(
  inDv: DataView,
  axisOffset: number,
  uVar18: number,
  uVar1: number,
  nEffective: number,
): number[] {
  const e0 = [0, 0, 0, 0, 0];
  const at = (i: number) => inDv.getFloat64(i * SAMPLE_BYTES_60 + axisOffset, true);
  const last = nEffective - 1;

  if (uVar18 === -1) {
    e0[0] = at(0);
    e0[1] = e0[0];
    e0[2] = e0[0];
    e0[3] = at(1);
    e0[4] = at(2);
  } else if (uVar18 === 0) {
    // Per the decompile: assigns then overwrites e0[0]; the final fall-through
    // line `e0[0] = e0[1]` then restores e0[0] to in[0]. Net effect:
    e0[0] = at(0);
    e0[1] = at(0);
    e0[2] = at(1);
    e0[3] = at(2);
    e0[4] = at(3);
  }

  // Right-edge cases (lines 128-141) — applied AFTER the left-edge ifs.
  // They conditionally overwrite e0 fully.
  if (uVar1 === last) {
    e0[0] = at(last - 2);
    e0[1] = at(last - 1);
    e0[2] = at(last);
    e0[3] = e0[2];
    e0[4] = e0[2];
  } else if (uVar1 === last - 1) {
    e0[0] = at(last - 3);
    e0[1] = at(last - 2);
    e0[2] = at(last - 1);
    e0[3] = at(last);
    e0[4] = e0[3];
  }

  // Interior case (line 142) — uVar18 > 0 AND uVar1 < nEffective - 2.
  if (uVar18 > 0 && uVar1 < last - 1) {
    e0[0] = at(uVar18 - 1);
    e0[1] = at(uVar18);
    e0[2] = at(uVar1);
    e0[3] = at(uVar1 + 1);
    e0[4] = at(uVar1 + 2);
  }

  return e0;
}

// ────────────────────────────────────────────────────────────────────
// Right-align + front-pad finalization
// ────────────────────────────────────────────────────────────────────

/**
 * If we wrote fewer than 5000 samples, slide the data to the right end of the
 * 5000-sample buffer and front-fill the leading slots with the (now-shifted)
 * first sample. Mirrors the binary's `_malloc(300000)` finalization at
 * lines 316-374.
 *
 * Note: only the 6 IMU doubles are touched (offsets 4, 12, 20, 28, 36, 44 of
 * each 60-byte slot). The int sample-index slot and the trailing scalar-C slot
 * stay zero — `GSCalculateSwingFromIMUData` fills the index later.
 */
function rightAlignAndFrontPad(outDv: DataView, written: number): void {
  if (written >= OUTPUT_SAMPLES) return;
  if (written <= 0) return;

  const offsets = [
    OFF60.AX,
    OFF60.AY,
    OFF60.AZ,
    OFF60.GX,
    OFF60.GY,
    OFF60.GZ,
  ];

  // Step 1: shift `written` samples from [0..written) to [5000-written..5000).
  // Iterate from high to low to avoid trampling.
  const shift = OUTPUT_SAMPLES - written;
  for (let i = written - 1; i >= 0; i--) {
    const srcOff = i * SAMPLE_BYTES_60;
    const dstOff = (i + shift) * SAMPLE_BYTES_60;
    for (const off of offsets) {
      outDv.setFloat64(dstOff + off, outDv.getFloat64(srcOff + off, true), true);
    }
  }

  // Step 2: front-fill slots [0..shift) with the (newly-shifted) first sample
  // values at slot `shift`.
  const firstOff = shift * SAMPLE_BYTES_60;
  const first = offsets.map((off) => outDv.getFloat64(firstOff + off, true));
  for (let i = 0; i < shift; i++) {
    const dstOff = i * SAMPLE_BYTES_60;
    for (let k = 0; k < offsets.length; k++) {
      outDv.setFloat64(dstOff + offsets[k], first[k], true);
    }
  }
}

export const _internal = {
  effectiveMetadataLength,
  effectiveInputRange,
  lanczosWeight,
  OUTPUT_SAMPLES,
};
