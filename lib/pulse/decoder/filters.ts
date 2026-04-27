/**
 * Step 4 — Filters and 5-point derivatives.
 *
 * References (Ghidra decompiles in
 * `/Users/maxsmac/Desktop/motus/pulse_probe/decompiled/GolfSwingKit/`):
 *
 *   _miniLPF2.c        @ 0x05fdc — zero-phase 2nd-order biquad LPF
 *   _miniLPFtorque.c   @ 0x06124 — same algorithm, different coefficients
 *                                  (applied to AZ pre-decompress; result stored in scalar_C)
 *   _miniLPF5.c        @ 0x0626c — same algorithm, different coefficients
 *                                  (used for fingertip velocity, not ported here yet — included for parity)
 *   _fivepointdiffArmSpeed.c @ 0x06724 — 5-point central diff, ×1000, glitch threshold 7000
 *   _fivepointdiffArmSlot.c  @ 0x06644 — 5-point central diff, ×80.1, glitch threshold 20000
 *
 * All three biquad LPFs share the structure:
 *
 *     out[0] = in[0]
 *     out[1] = in[1]
 *     for k in [2..N): out[k] = b0·in[k] + b1·in[k-1] + b2·in[k-2]
 *                              + a1·out[k-1] + a2·out[k-2]
 *
 *     final[N-1] = out[N-1]
 *     final[N-2] = out[N-2]
 *     for k in (N-3..0]: final[k] = b0·out[k] + b1·out[k+1] + b2·out[k+2]
 *                                   + a1·final[k+1] + a2·final[k+2]
 *
 * (Note the binary uses `+ a·y` form where the coefficients already absorb the sign,
 * so we pass `a1 = +1.797154`, `a2 = -0.8176033` for `_miniLPF2`.)
 */

import { OFF60, SAMPLE_BYTES_60 } from './buffer-layout';

/** Coefficients per the binary's three biquad variants. */
interface BiquadCoefs {
  b0: number; // weight on x[k]   and x[k-2]
  b1: number; // weight on x[k-1]
  a1: number; // weight on y[k-1]
  a2: number; // weight on y[k-2]
}

const COEFS_LPF2: BiquadCoefs = {
  b0: 0.005112374,
  b1: 0.01022475,
  a1: 1.797154,
  a2: -0.8176033,
};

const COEFS_LPF_TORQUE: BiquadCoefs = {
  b0: 0.06372802,
  b1: 0.127456,
  a1: 1.194365,
  a2: -0.4492774,
};

const COEFS_LPF5: BiquadCoefs = {
  b0: 0.0008663387,
  b1: 0.001632678,
  a1: 1.919129,
  a2: -0.9225943,
};

// ────────────────────────────────────────────────────────────────────
// Zero-phase biquad LPF (forward then backward)
// ────────────────────────────────────────────────────────────────────

/**
 * Apply a zero-phase biquad LPF in-place. Allocates a single temp buffer of
 * size N×8 bytes; no other allocation in the hot path.
 *
 * Algorithm exactly mirrors the binary's two-pass structure (forward into
 * temp, backward into target). Sentinels: out[0] = in[0], out[1] = in[1] for
 * the forward pass; final[N-1] = out[N-1], final[N-2] = out[N-2] for backward.
 */
function applyZeroPhaseBiquad(
  data: Float64Array,
  c: BiquadCoefs,
): void {
  const n = data.length;
  if (n < 3) return; // nothing to filter; matches the binary's `iVar2 > 2` guard

  const temp = new Float64Array(n);
  // Forward pass — seed first two samples directly from input
  temp[0] = data[0];
  temp[1] = data[1];
  for (let k = 2; k < n; k++) {
    temp[k] =
      c.b0 * data[k] +
      c.b1 * data[k - 1] +
      c.b0 * data[k - 2] +
      c.a1 * temp[k - 1] +
      c.a2 * temp[k - 2];
  }

  // Backward pass — seed last two samples from forward output, then walk down
  data[n - 1] = temp[n - 1];
  data[n - 2] = temp[n - 2];
  for (let k = n - 3; k >= 0; k--) {
    data[k] =
      c.b0 * temp[k] +
      c.b1 * temp[k + 1] +
      c.b0 * temp[k + 2] +
      c.a1 * data[k + 1] +
      c.a2 * data[k + 2];
  }
}

/** Zero-phase 2nd-order biquad with `_miniLPF2` coefficients. */
export function miniLPF2(data: Float64Array): void {
  applyZeroPhaseBiquad(data, COEFS_LPF2);
}

/** Zero-phase biquad with `_miniLPFtorque` coefficients (used pre-decompress on AZ → scalar_C). */
export function miniLPFtorque(data: Float64Array): void {
  applyZeroPhaseBiquad(data, COEFS_LPF_TORQUE);
}

/** Zero-phase biquad with `_miniLPF5` coefficients (used for fingertip velocity). */
export function miniLPF5(data: Float64Array): void {
  applyZeroPhaseBiquad(data, COEFS_LPF5);
}

// ────────────────────────────────────────────────────────────────────
// 5-point central difference + Pulse-style glitch removal
// ────────────────────────────────────────────────────────────────────

/**
 * Generic 5-point central difference with edge handling and post-glitch
 * suppression, matching `_fivepointdiffArmSpeed` / `_fivepointdiffArmSlot`.
 *
 * Edge handling (matches the binary):
 *   k = 0 or 1:        diff[k] = in[1] - in[0]
 *   k = N-1 or N-2:    diff[k] = in[k] - in[k-1]
 *   interior:          diff[k] = (in[k-2] − 8·in[k-1] + 8·in[k+1] − in[k+2]) / 12
 *
 * The result is then multiplied by `scale` and a glitch-removal pass replaces
 * 4 consecutive samples whenever a `>threshold` jump is detected.
 *
 * @param scale     `1000` for armSpeed, `1602/20 = 80.1` for armSlot
 * @param threshold `7000` for armSpeed, `20000` for armSlot
 */
function fivePointDiffWithDespike(
  out: Float64Array,
  input: Float64Array,
  scale: number,
  threshold: number,
): void {
  const n = input.length;
  if (n <= 0) return;

  for (let k = 0; k < n; k++) {
    let diff: number;
    if (k < 2) {
      diff = input[1] - input[0];
    } else if (k === n - 1 || k === n - 2) {
      diff = input[k] - input[k - 1];
    } else {
      diff =
        (input[k - 2] - 8 * input[k - 1] + 8 * input[k + 1] - input[k + 2]) /
        12.0;
    }
    out[k] = diff * scale;
  }

  // Glitch removal: starting at index 6, if abs(out[k] - out[k-3]) > threshold
  // replace 4 consecutive entries with out[k-9]'s value. Mirrors the binary's
  // pdVar3-relative pointer arithmetic (lines 38-54 of either decompile).
  if (n > 7) {
    let prev = out[3];
    for (let k = 6; k <= n - 4; k++) {
      const cur = out[k];
      if (Math.abs(prev - cur) > threshold) {
        const replacement = out[k - 6];
        out[k - 3] = replacement;
        out[k - 2] = replacement;
        out[k - 1] = replacement;
        out[k] = replacement;
      }
      prev = cur;
    }
  }
}

/** 5-point derivative for arm-speed channel (scale ×1000, despike threshold 7000). */
export function fivepointDiffArmSpeed(
  out: Float64Array,
  input: Float64Array,
): void {
  fivePointDiffWithDespike(out, input, 1000.0, 7000.0);
}

/** 5-point derivative for arm-slot channel (scale 1602/20, despike threshold 20000). */
export function fivepointDiffArmSlot(
  out: Float64Array,
  input: Float64Array,
): void {
  fivePointDiffWithDespike(out, input, 1602.0 / 20.0, 20000.0);
}

// ────────────────────────────────────────────────────────────────────
// Channel extract / inject helpers for the 60-byte/sample interleaved buffer
// ────────────────────────────────────────────────────────────────────

/**
 * Extract one axis of the 60-byte/sample buffer into a flat Float64Array.
 * Used to feed channel-wise filters.
 */
export function extractChannel(
  buffer: ArrayBuffer,
  axisOffset: number,
  outLength?: number,
): Float64Array {
  const dv = new DataView(buffer);
  const n = outLength ?? Math.floor(buffer.byteLength / SAMPLE_BYTES_60);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = dv.getFloat64(i * SAMPLE_BYTES_60 + axisOffset, true);
  }
  return out;
}

/**
 * Write a flat Float64Array channel back into one axis of the 60-byte/sample
 * buffer.
 */
export function injectChannel(
  buffer: ArrayBuffer,
  axisOffset: number,
  channel: Float64Array,
): void {
  const dv = new DataView(buffer);
  const n = Math.min(channel.length, Math.floor(buffer.byteLength / SAMPLE_BYTES_60));
  for (let i = 0; i < n; i++) {
    dv.setFloat64(i * SAMPLE_BYTES_60 + axisOffset, channel[i], true);
  }
}

/**
 * Compute scalar_C for every sample in a 5000-sample 60-byte buffer:
 *
 *   scalar_C[i] = miniLPFtorque(AZ[i])      (pre-decompress, applied to AZ)
 *
 * Matches `GSCalculateSwingFromIMUData` lines 75-93 in
 * `0x0d164__GSCalculateSwingFromIMUData.c`.
 */
export function applyMiniLPFTorqueToAZ(buffer: ArrayBuffer): void {
  const channel = extractChannel(buffer, OFF60.AZ);
  miniLPFtorque(channel);
  injectChannel(buffer, OFF60.SCALAR_C, channel);
}

export const _internal = {
  COEFS_LPF2,
  COEFS_LPF_TORQUE,
  COEFS_LPF5,
};
