/**
 * Step 3 verification — Lanczos-2 decompressor.
 *
 * Validates the verifiable surface (kernel weights, metadata-length
 * convention, end-to-end shape) — full byte-exact verification happens at
 * the metric level in pulse-byte-exact.test.ts.
 */
import {
  decompressAllData,
  _internal,
} from '@/lib/pulse/decoder/decompress';
import { calibrate } from '@/lib/pulse/decoder/calibrate';
import { OFF60, SAMPLE_BYTES_60 } from '@/lib/pulse/decoder/buffer-layout';

const { effectiveMetadataLength, lanczosWeight, OUTPUT_SAMPLES } = _internal;

describe('lanczosWeight', () => {
  it('is exactly 1 at x=0', () => {
    expect(lanczosWeight(0)).toBe(1);
  });

  it('is zero at integer offsets ±1, ±2 (sinc lattice property)', () => {
    expect(Math.abs(lanczosWeight(1))).toBeLessThan(1e-15);
    expect(Math.abs(lanczosWeight(-1))).toBeLessThan(1e-15);
    expect(Math.abs(lanczosWeight(2))).toBeLessThan(1e-15);
    expect(Math.abs(lanczosWeight(-2))).toBeLessThan(1e-15);
  });

  it('matches a hand-computed value at x = 0.5', () => {
    // sinc(π·0.5) · sinc(π·0.25) = (sin(π/2)/(π/2)) · (sin(π/4)/(π/4))
    const expected = (Math.sin(Math.PI * 0.5) / (Math.PI * 0.5)) *
      (Math.sin(Math.PI * 0.25) / (Math.PI * 0.25));
    expect(lanczosWeight(0.5)).toBeCloseTo(expected, 14);
  });
});

describe('effectiveMetadataLength', () => {
  it('returns full count when metadata has no embedded null', () => {
    const meta = new Uint8Array(50).fill(2);
    expect(effectiveMetadataLength(meta)).toBe(50);
  });

  it('respects null at offset 1 (yields 0)', () => {
    const meta = new Uint8Array([3, 0, 4, 5]);
    expect(effectiveMetadataLength(meta)).toBe(0);
  });

  it('mirrors the binary: null at offset N yields N-1', () => {
    // Per the binary, the loop checks compression[1+uVar7] for null. So a 4-byte
    // metadata "ABCD" with null at index 3 → uVar7 stops at 2 → returns 2.
    const meta = new Uint8Array([0x41, 0x42, 0x43, 0x00]);
    expect(effectiveMetadataLength(meta)).toBe(2);
  });

  it('caps at 50 when metadata is dense', () => {
    const meta = new Uint8Array(60).fill(1);
    expect(effectiveMetadataLength(meta)).toBe(50);
  });
});

describe('decompressAllData (shape)', () => {
  it('produces exactly 5000 samples × 60 bytes regardless of input length', () => {
    // Build a synthetic 50-sample input where ax = i and metadata = all-1s.
    const n = 50;
    const input = new Uint8Array(n * 12);
    const dv = new DataView(input.buffer);
    for (let i = 0; i < n; i++) {
      dv.setInt16(i * 12, i, true);
    }
    const calibrated = calibrate(input);
    const meta = new Uint8Array(50).fill(1);
    const out = decompressAllData(calibrated, meta);
    expect(out.byteLength).toBe(OUTPUT_SAMPLES * SAMPLE_BYTES_60);
  });

  it('writes finite values into all 6 channels at every sample slot', () => {
    // Use realistic metadata: 50 bytes × b=8 → each byte consumes 100/8 = 12
    // input cells. Total stride 600. Match input length to that.
    const meta = new Uint8Array(50).fill(8);
    let cellsNeeded = 0;
    for (const b of meta) cellsNeeded += Math.floor(100 / b);
    const n = cellsNeeded; // input cursor walks exactly to the end
    const input = new Uint8Array(n * 12);
    const dv = new DataView(input.buffer);
    for (let i = 0; i < n; i++) {
      dv.setInt16(i * 12 + 0, i + 1, true);
      dv.setInt16(i * 12 + 2, i + 2, true);
      dv.setInt16(i * 12 + 4, i + 3, true);
      dv.setInt16(i * 12 + 6, i + 4, true);
      dv.setInt16(i * 12 + 8, i + 5, true);
      dv.setInt16(i * 12 + 10, i + 6, true);
    }
    const calibrated = calibrate(input);
    const out = decompressAllData(calibrated, meta);
    const ov = new DataView(out);

    const offsets = [OFF60.AX, OFF60.AY, OFF60.AZ, OFF60.GX, OFF60.GY, OFF60.GZ];
    let nonZeroCount = 0;
    for (let i = 0; i < OUTPUT_SAMPLES; i++) {
      for (const off of offsets) {
        const v = ov.getFloat64(i * SAMPLE_BYTES_60 + off, true);
        expect(Number.isFinite(v)).toBe(true);
        if (v !== 0) nonZeroCount++;
      }
    }
    expect(nonZeroCount).toBeGreaterThan(OUTPUT_SAMPLES * 6 * 0.9);
  });

  it('preserves a constant input as a constant output (within Lanczos tolerance)', () => {
    // Constant input → constant interpolated output. Use realistic metadata
    // sized so the input cursor exactly walks the input range.
    const meta = new Uint8Array(50).fill(4);
    let cellsNeeded = 0;
    for (const b of meta) cellsNeeded += Math.floor(100 / b);
    const n = cellsNeeded; // 50 × 25 = 1250
    const input = new Uint8Array(n * 12);
    const dv = new DataView(input.buffer);
    const RAW = 1000;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 6; k++) dv.setInt16(i * 12 + k * 2, RAW, true);
    }
    const calibrated = calibrate(input);
    const out = decompressAllData(calibrated, meta);
    const ov = new DataView(out);

    const expectedAccel = RAW * (24 / 2048);
    // Lanczos-2 with 5 taps has small normalization error (~1% peak); on a
    // constant input the output stays within ~1% of the constant.
    for (let i = 200; i < 4800; i++) {
      const ax = ov.getFloat64(i * SAMPLE_BYTES_60 + OFF60.AX, true);
      expect(ax / expectedAccel).toBeGreaterThan(0.99);
      expect(ax / expectedAccel).toBeLessThan(1.01);
    }
  });
});
