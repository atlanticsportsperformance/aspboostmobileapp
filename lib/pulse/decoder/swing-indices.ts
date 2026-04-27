/**
 * Step 6b — Swing-index helpers.
 *
 * Pulse identifies three special sample indices on the decompressed buffer:
 *
 *   impactIdx     — peak of scalar_C (filtered-AZ) within a fixed window
 *   swingStartIdx — minimum of accel magnitude before impact (in a window)
 *   swingStopIdx  — first sample whose int-time-stamp exceeds impact + 500000
 *
 * References:
 *   `_GSIndexImpact.c`             @ 0x0fa90
 *   `_GSIndexSwingStop.c`          @ 0x11aa8
 *   `_indexSwingStartMeanAccel.c`  @ 0x0fe10
 *   `_GSIndexSwingStart.c`         @ 0x11a90 (dispatcher; for device_id != 6/7/9/10
 *                                              calls indexSwingStartMeanAccel)
 *
 * Each works on the 60-byte/sample decompressed buffer with the layout:
 *   [0..4]   int     sample index (== sample_idx × 1000 from
 *                                  `GSCalculateSwingFromIMUData` lines 79-85)
 *   [28..52] 3 doubles  gyro x/y/z
 *   [4..28]  3 doubles  accel x/y/z
 *   [52..60] 1 double   scalar_C  (= miniLPFtorque(AZ))
 */

import { OFF60, SAMPLE_BYTES_60 } from './buffer-layout';

const N_SAMPLES = 5000;

const IMPACT_WINDOW_START = 0x839; // 2105
const IMPACT_WINDOW_LEN = 0xb40; // 2880

/**
 * Find the impact sample index — `_GSIndexImpact @ 0xfa90` three-phase
 * algorithm. Operates on **post-rotation gyro X** (offset 0x1c = OFF60.GX),
 * NOT scalar_C (Ghidra's "_sin + 3" was a relocation-alias display artifact).
 *
 * Phase 1: argmin(gx_rot) over [2105, 4984], init = 1000.0  → ph1_idx
 * Phase 2: argmax(gx_rot) over [2105, ph1_idx], init = 0.1   → ph2_idx
 * Phase 3: if (ph1_idx − ph2_idx) ≥ 66, argmax(gx_rot) over [2105, 4984]
 *          from scratch (init = 0.0) → ph3_idx; else use ph2_idx.
 *
 * For cmd01_11-10-13 ev=0: ph1=4066 (gx=-40.91), ph2=3899 (+14.07),
 * gap=167 ≥ 66 → Phase 3 runs → returns 4110. Matches binary.
 *
 * All comparisons use float32 precision (Math.fround) per ARM `fcvtn`.
 */
export function indexImpact(decompressed: ArrayBuffer): number {
  const dv = new DataView(decompressed);

  // Phase 1: argmin(gx_rot) over [2105, 4984]
  let ph1Idx = IMPACT_WINDOW_START;
  let ph1Val = Math.fround(1000.0);
  for (let off = 0; off < IMPACT_WINDOW_LEN; off++) {
    const i = IMPACT_WINDOW_START + off;
    const v = Math.fround(
      dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.GX, true),
    );
    if (v < ph1Val) {
      ph1Val = v;
      ph1Idx = i;
    }
  }

  // Phase 2: argmax(gx_rot) over [2105, ph1Idx], init = 0.1
  let ph2Idx = IMPACT_WINDOW_START;
  let ph2Val = Math.fround(0.1);
  for (let i = IMPACT_WINDOW_START; i <= ph1Idx; i++) {
    const v = Math.fround(
      dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.GX, true),
    );
    if (v > ph2Val) {
      ph2Val = v;
      ph2Idx = i;
    }
  }

  // Phase 3 (conditional): argmax(gx_rot) over full [2105, 4984], init = 0.0
  if (ph1Idx - ph2Idx >= 66) {
    let ph3Idx = IMPACT_WINDOW_START;
    let ph3Val = Math.fround(0.0);
    for (let off = 0; off < IMPACT_WINDOW_LEN; off++) {
      const i = IMPACT_WINDOW_START + off;
      const v = Math.fround(
        dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.GX, true),
      );
      if (v > ph3Val) {
        ph3Val = v;
        ph3Idx = i;
      }
    }
    return ph3Idx;
  }
  return ph2Idx;
}

/**
 * Find swing-stop: first sample whose int-time-stamp exceeds the impact's
 * by 500000. Mirrors `_GSIndexSwingStop` lines 28-37.
 */
export function indexSwingStop(decompressed: ArrayBuffer, impactIdx: number, nInput = N_SAMPLES): number {
  const dv = new DataView(decompressed);
  let limit = nInput;
  if (limit < 0x20) limit = 0x1f;
  limit = limit - 0xf;
  if (impactIdx >= limit) return impactIdx;

  // Per `_GSIndexSwingStop.c` line 30: returns iVar2 (the running cursor)
  // — i.e. the FIRST sample after impact whose timestamp exceeds impact + 500000.
  const impactTs = dv.getInt32(impactIdx * SAMPLE_BYTES_60, true);
  for (let i = impactIdx; i < limit; i++) {
    const ts = dv.getInt32(i * SAMPLE_BYTES_60, true);
    if (impactTs + 500000 < ts) return i;
  }
  return limit;
}

/**
 * Find swing-start, byte-exact match to `__indexSwingStartMeanAccel @ 0xfe10`
 * (the helper that `_GSIndexSwingStart` actually trampolines to for Pulse,
 * NOT the `__indexSwingStartMeanAccelVBclip` variant which is for device_id ∈
 * {9, 10}).
 *
 * Three phases (the function returns Loop 1's argmin in register x22):
 *
 *   1. uVar3 = first sample-index where AZ differs from AZ[0]; default 15.
 *   2. iVar1 = backward-window size based on uVar3 (matches binary's exact
 *      unsigned compares):
 *        uVar3 ∈ [0, 1500]      → iVar1 = -2000
 *        uVar3 ∈ [1501, 2500]   → iVar1 = -1000
 *        uVar3 ∈ [2501, 2800]   → iVar1 = -500
 *        uVar3 ∈ [2801, …]      → iVar1 = -2000
 *   3. Loop 1: scan backward from raw impact down to `impact + iVar1`,
 *      tracking argmin of `sqrt(GX² + GY² + GZ²)` (i.e. gyro magnitude — the
 *      function name is misleading; it uses gyro per `pdVar6 = sample + 0x2c`
 *      with `pdVar6[-2..0] = GX, GY, GZ`). Initial bestMag = 100.0.
 *
 * Returns the argmin sample index in the decompressed buffer.
 */
export function indexSwingStart(
  decompressed: ArrayBuffer,
  impactIdx: number,
): number {
  const dv = new DataView(decompressed);
  const nInput = Math.floor(decompressed.byteLength / SAMPLE_BYTES_60);
  if (nInput <= 0) return 0;

  // Phase 1 — uVar3
  const az0 = dv.getFloat64(OFF60.AZ, true);
  let uVar3 = 0xf; // 15 default
  for (let i = 0; i < nInput; i++) {
    const az = dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.AZ, true);
    if (az !== az0) {
      uVar3 = i;
      break;
    }
  }

  // Phase 2 — iVar1 (backward-window size)
  let iVar1: number;
  if (uVar3 <= 1500) iVar1 = -2000;
  else if (uVar3 <= 2500) iVar1 = -1000;
  else if (uVar3 <= 2800) iVar1 = -500;
  else iVar1 = -2000;

  // Phase 3 — Loop 1: scan backward [impact + iVar1, impact] for argmin |gyro|.
  // The binary's `if (uVar5 <= uVar9)` and `if (uVar5 < uVar9)` guard against
  // edge cases (impact too small or window low > impact). With iVar1 < 0, the
  // window low is below impact, so the inner loop runs.
  const winLow = impactIdx + iVar1;
  if (winLow < 15 || impactIdx <= winLow) return 0;

  let bestIdx = impactIdx;
  let bestMag = Math.fround(100.0); // matches binary's `fVar13 = 100.0` seed
  // Binary iterates from impact downward, decrementing per sample, exit when
  // scan position == winLow. Inclusive of impact, exclusive of winLow.
  // ARM `fmul.2s` + `fadd` + `fsqrt s1` runs at float32 throughout — quantize
  // every intermediate to match.
  for (let i = impactIdx; i > winLow; i--) {
    const off = i * SAMPLE_BYTES_60;
    const fgx = Math.fround(dv.getFloat64(off + OFF60.GX, true));
    const fgy = Math.fround(dv.getFloat64(off + OFF60.GY, true));
    const fgz = Math.fround(dv.getFloat64(off + OFF60.GZ, true));
    const sumSq = Math.fround(
      Math.fround(Math.fround(fgx * fgx) + Math.fround(fgy * fgy)) +
        Math.fround(fgz * fgz),
    );
    const mag = Math.fround(Math.sqrt(sumSq));
    if (mag < bestMag) {
      bestMag = mag;
      bestIdx = i;
    }
  }
  // Per ASM at 0x100c0 inside Phase 5: literal `sub w22, w24, #1` —
  // the function returns argmin - 1, NOT argmin. (Ghidra hid this inside the
  // recursive block as a local variable assignment.)
  return bestIdx - 1;
}

/**
 * Compute the "startAccelMean" vector — average of the first ~50 accel
 * samples. Used by `GSCalculateInitialBodyToLabMatrix` to establish the
 * initial body-to-lab orientation.
 */
export function startAccelMean(decompressed: ArrayBuffer, swingStartIdx: number): Float64Array {
  const dv = new DataView(decompressed);
  const n = Math.min(50, swingStartIdx);
  const out = new Float64Array(3);
  if (n <= 0) return out;
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < n; i++) {
    const off = i * SAMPLE_BYTES_60;
    sx += dv.getFloat64(off + OFF60.AX, true);
    sy += dv.getFloat64(off + OFF60.AY, true);
    sz += dv.getFloat64(off + OFF60.AZ, true);
  }
  out[0] = sx / n;
  out[1] = sy / n;
  out[2] = sz / n;
  return out;
}
