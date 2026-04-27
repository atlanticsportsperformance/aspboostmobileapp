/**
 * Vector / matrix primitives used by the Pulse integrator and metric calc.
 *
 * Mirrors the PPCommon helpers
 * (`/Users/maxsmac/Desktop/motus/pulse_probe/decompiled/PPCommon/`):
 *   GSVectorCopyD, GSVectorMagnitudeD, GSVectorNormalizeD,
 *   GSVectorScalarMultiplyD, GSVectorMultiplyScalarAddVectorD,
 *   GSVectorMatrixMultiplyD, GSVectorMatrixTransposeMultiplyD,
 *   GSVectorLinearInterpolateD, GSVectorDotProductD, GSVectorCrossProductD,
 *   GSMatrixMakeIdentity, GSMatrixMatrixMultiplyD, GSMatrixTransposeD,
 *   GSMatrixRotationFromVectorD.
 *
 * 3×3 matrices are stored row-major as 9 contiguous doubles. Vectors are
 * length-N Float64Arrays.
 */

export type Vec3 = Float64Array; // length 3
export type Mat3 = Float64Array; // length 9 (row-major)

// ────────────────────────────────────────────────────────────────────
// Vector ops
// ────────────────────────────────────────────────────────────────────

export function vCopy(out: Float64Array, src: ArrayLike<number>, n = 3): void {
  for (let i = 0; i < n; i++) out[i] = src[i];
}

export function vAdd(out: Vec3, a: ArrayLike<number>, b: ArrayLike<number>): void {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
}

export function vSub(out: Vec3, a: ArrayLike<number>, b: ArrayLike<number>): void {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
}

export function vScale(out: Float64Array, s: number, src: ArrayLike<number>, n = 3): void {
  for (let i = 0; i < n; i++) out[i] = s * src[i];
}

/** out = s × a + b (componentwise) */
export function vScaleAdd(
  out: Float64Array,
  s: number,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  n = 3,
): void {
  for (let i = 0; i < n; i++) out[i] = s * a[i] + b[i];
}

export function vMagnitude(v: ArrayLike<number>, n = 3): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

/** Normalize in place. Returns 0 if magnitude was non-zero, 1 if zero. */
export function vNormalize(out: Float64Array, src: ArrayLike<number>, n = 3): number {
  const m = vMagnitude(src, n);
  if (m === 0) return 1;
  for (let i = 0; i < n; i++) out[i] = src[i] / m;
  return 0;
}

export function vDot(a: ArrayLike<number>, b: ArrayLike<number>, n = 3): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function vCross(out: Vec3, a: ArrayLike<number>, b: ArrayLike<number>): void {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

/** out = (1 - t) × a + t × b */
export function vLerp(
  out: Float64Array,
  t: number,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  n = 3,
): void {
  for (let i = 0; i < n; i++) out[i] = (1 - t) * a[i] + t * b[i];
}

// ────────────────────────────────────────────────────────────────────
// Matrix ops (3×3)
// ────────────────────────────────────────────────────────────────────

export function mIdentity(out: Mat3): void {
  out[0] = 1; out[1] = 0; out[2] = 0;
  out[3] = 0; out[4] = 1; out[5] = 0;
  out[6] = 0; out[7] = 0; out[8] = 1;
}

export function mCopy(out: Mat3, src: ArrayLike<number>): void {
  for (let i = 0; i < 9; i++) out[i] = src[i];
}

export function mTranspose(out: Mat3, src: ArrayLike<number>): void {
  if (out === (src as unknown as Mat3)) {
    // In-place transpose
    let t: number;
    t = out[1]; out[1] = out[3]; out[3] = t;
    t = out[2]; out[2] = out[6]; out[6] = t;
    t = out[5]; out[5] = out[7]; out[7] = t;
    return;
  }
  out[0] = src[0]; out[1] = src[3]; out[2] = src[6];
  out[3] = src[1]; out[4] = src[4]; out[5] = src[7];
  out[6] = src[2]; out[7] = src[5]; out[8] = src[8];
}

/** out = A × B (3×3) */
export function mMul(out: Mat3, a: ArrayLike<number>, b: ArrayLike<number>): void {
  const a0 = a[0], a1 = a[1], a2 = a[2];
  const a3 = a[3], a4 = a[4], a5 = a[5];
  const a6 = a[6], a7 = a[7], a8 = a[8];
  const b0 = b[0], b1 = b[1], b2 = b[2];
  const b3 = b[3], b4 = b[4], b5 = b[5];
  const b6 = b[6], b7 = b[7], b8 = b[8];
  out[0] = a0 * b0 + a1 * b3 + a2 * b6;
  out[1] = a0 * b1 + a1 * b4 + a2 * b7;
  out[2] = a0 * b2 + a1 * b5 + a2 * b8;
  out[3] = a3 * b0 + a4 * b3 + a5 * b6;
  out[4] = a3 * b1 + a4 * b4 + a5 * b7;
  out[5] = a3 * b2 + a4 * b5 + a5 * b8;
  out[6] = a6 * b0 + a7 * b3 + a8 * b6;
  out[7] = a6 * b1 + a7 * b4 + a8 * b7;
  out[8] = a6 * b2 + a7 * b5 + a8 * b8;
}

/**
 * out = M × vec   (M is n×n row-major, vec interpreted as a column vector of length n).
 *
 * Matches `_GSVectorMatrixMultiplyD(out, vec, mat, n)` in PPCommon
 * (`/Users/maxsmac/Desktop/motus/pulse_probe/decompiled/PPCommon/0x054f4__GSVectorMatrixMultiplyD.c`),
 * which calls Apple's `vDSP_mmulD(A=mat, B=vec, C=out, M=n, N=1, P=n)` — i.e.
 * computes `C = A × B` = `mat × vec`. Reading row-major M as A, this gives
 * `out[i] = sum_j M[i·n + j] × vec[j]`.
 */
export function vMatMul(out: Float64Array, vec: ArrayLike<number>, mat: ArrayLike<number>, n = 3): void {
  const tmp = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += mat[i * n + j] * vec[j];
    tmp[i] = s;
  }
  for (let i = 0; i < n; i++) out[i] = tmp[i];
}

/**
 * out = M^T × vec  (matches `_GSVectorMatrixTransposeMultiplyD`).
 * out[i] = sum_j M[j·n + i] × vec[j]
 */
export function vMatTransposeMul(
  out: Float64Array,
  vec: ArrayLike<number>,
  mat: ArrayLike<number>,
  n = 3,
): void {
  const tmp = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += mat[j * n + i] * vec[j];
    tmp[i] = s;
  }
  for (let i = 0; i < n; i++) out[i] = tmp[i];
}

/**
 * Build a 3×3 rotation matrix from an axis-angle vector, **matching the
 * binary's `_GSMatrixRotationFromVectorD` exactly**.
 *
 * Per `/Users/maxsmac/Desktop/motus/pulse_probe/decompiled/PPCommon/0x062b8__GSMatrixRotationFromVectorD.c`
 * lines 34-42, the binary writes:
 *
 *   M[0] = c + ux²·C
 *   M[1] = s·uz + C·ux·uy           ← +s·uz  (standard Rodriguez has -s·uz)
 *   M[2] = -s·uy + C·ux·uz          ← -s·uy  (standard has +s·uy)
 *   M[3] = -s·uz + C·ux·uy          ← -s·uz  (standard has +s·uz)
 *   M[4] = c + uy²·C
 *   M[5] = s·ux + C·uy·uz           ← +s·ux  (standard has -s·ux)
 *   M[6] = s·uy + C·ux·uz           ← +s·uy  (standard has -s·uy)
 *   M[7] = -s·ux + C·uy·uz          ← -s·ux  (standard has +s·ux)
 *   M[8] = c + uz²·C
 *
 * This is the **transpose** of standard Rodriguez (i.e. `R(-θ)`). Combined
 * with the binary's `M × vec` matrix-multiply convention (per `vDSP_mmulD`),
 * the net effect is that an axis-angle vector v rotates a vector by `-|v|`
 * around `v / |v|` — the inverse of the typical Rodriguez convention.
 */
export function mRotationFromVector(out: Mat3, axisAngle: ArrayLike<number>): void {
  const x = axisAngle[0], y = axisAngle[1], z = axisAngle[2];
  const theta = Math.sqrt(x * x + y * y + z * z);
  if (theta < 1.7453292519943297e-07) {
    mIdentity(out);
    return;
  }
  const ux = x / theta;
  const uy = y / theta;
  const uz = z / theta;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const C = 1 - c;
  out[0] = c + ux * ux * C;
  out[1] = s * uz + C * ux * uy;
  out[2] = -s * uy + C * ux * uz;
  out[3] = -s * uz + C * ux * uy;
  out[4] = c + uy * uy * C;
  out[5] = s * ux + C * uy * uz;
  out[6] = s * uy + C * ux * uz;
  out[7] = -s * ux + C * uy * uz;
  out[8] = c + uz * uz * C;
}

// Reference unit-axis constants used by the binary (`_GSXAxis`, `_GSYAxis`, `_GSZAxis`)
export const X_AXIS = Object.freeze([1.0, 0.0, 0.0]);
export const Y_AXIS = Object.freeze([0.0, 1.0, 0.0]);
export const Z_AXIS = Object.freeze([0.0, 0.0, 1.0]);
