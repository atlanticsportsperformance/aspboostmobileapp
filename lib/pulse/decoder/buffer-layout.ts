/**
 * Per-sample byte layouts used by the Pulse decoder pipeline.
 *
 * The binary (`GSCalculateSwingFromIMUData @ 0xd164`) stores all per-sample
 * data in flat byte buffers with fixed strides. We mirror those layouts so
 * each pipeline stage reads/writes the same offsets the binary does.
 *
 * Two strides exist:
 *
 *   60-byte stride: post-calibrate, post-decompress, post-LPF.
 *     [0..4]    int32  — sample index (filled by `GSCalculateSwingFromIMUData`'s
 *                        second pass, after decompress)
 *     [4..12]   double — accel x  (m/s² basis: raw × 24 / 2048)
 *     [12..20]  double — accel y
 *     [20..28]  double — accel z
 *     [28..36]  double — gyro  x  (rad/s)
 *     [36..44]  double — gyro  y
 *     [44..52]  double — gyro  z
 *     [52..60]  double — scalar C (filled later by integrator; pre-int it's 0)
 *
 *   208-byte stride: post-integrate. Layout described inline in integrate.ts.
 *
 * Source: `pulse_probe/decompiled/GolfSwingKit/0x0d164__GSCalculateSwingFromIMUData.c`
 * lines 46-71 (calibrate) and 79-85 (sample-index fill).
 */

export const SAMPLE_BYTES_60 = 60;

export const OFF60 = {
  IDX: 0,
  AX: 4,
  AY: 12,
  AZ: 20,
  GX: 28,
  GY: 36,
  GZ: 44,
  SCALAR_C: 52,
} as const;
