/**
 * Unit tests for saturation interpolation (`_BHinterpolateAll` + `_splineBH`).
 */
import {
  interpolateAll,
  _internal,
} from '@/lib/pulse/decoder/interpolate';
import { OFF60, SAMPLE_BYTES_60 } from '@/lib/pulse/decoder/buffer-layout';

const { GYRO_SAT_THRESHOLD, ACCEL_SAT_THRESHOLD, splineBH, buildMarkers } = _internal;

describe('saturation thresholds (binary-derived)', () => {
  it('GYRO_SAT_THRESHOLD ≈ 65.067 rad/s (≈ 3727 dps)', () => {
    expect(GYRO_SAT_THRESHOLD).toBeGreaterThan(65);
    expect(GYRO_SAT_THRESHOLD).toBeLessThan(66);
  });

  it('ACCEL_SAT_THRESHOLD ≈ 21.776 m/s² (≈ 2.22 g)', () => {
    expect(ACCEL_SAT_THRESHOLD).toBeGreaterThan(21);
    expect(ACCEL_SAT_THRESHOLD).toBeLessThan(22);
  });
});

describe('buildMarkers', () => {
  it('marks +1 above threshold, -1 below -threshold, 0 in middle', () => {
    const ch = new Float64Array([0, 1, 100, 50, -100, -50, 0]);
    const m = buildMarkers(ch, 30);
    expect(Array.from(m)).toEqual([0, 0, 1, 1, -1, -1, 0]);
  });
});

describe('splineBH (manual smoke)', () => {
  it('writes `span` values starting at out[0] = y4[1]', () => {
    const x4 = [10, 11, 20, 21]; // span = 10, half = 5
    const y4 = [1.0, 2.0, 3.0, 4.0];
    const out = new Float64Array(10).fill(NaN);
    splineBH(x4, y4, out);
    expect(out[0]).toBe(2.0); // y4[1]
    // Last value should approach (but not equal) y4[2] = 3
    expect(out[9]).toBeGreaterThan(2.0);
    expect(out[9]).toBeLessThan(3.5);
    // No NaNs anywhere
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });

  it('no-ops when span <= 3', () => {
    const x4 = [0, 1, 2, 3]; // span = 2
    const y4 = [1.0, 2.0, 3.0, 4.0];
    const out = new Float64Array(2).fill(7);
    splineBH(x4, y4, out);
    expect(Array.from(out)).toEqual([7, 7]);
  });
});

describe('interpolateAll (end-to-end)', () => {
  function buildBuffer(channelGen: (i: number) => number, axisOffset: number): ArrayBuffer {
    const buf = new ArrayBuffer(5000 * SAMPLE_BYTES_60);
    const dv = new DataView(buf);
    for (let i = 0; i < 5000; i++) {
      dv.setFloat64(i * SAMPLE_BYTES_60 + axisOffset, channelGen(i), true);
    }
    return buf;
  }

  it('leaves an unsaturated channel untouched', () => {
    const buf = buildBuffer((i) => Math.sin(i * 0.01) * 5, OFF60.GX);
    const before: number[] = [];
    const dv = new DataView(buf);
    for (let i = 0; i < 100; i++) {
      before.push(dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.GX, true));
    }
    interpolateAll(buf);
    for (let i = 0; i < 100; i++) {
      expect(dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.GX, true)).toBeCloseTo(
        before[i],
        12,
      );
    }
  });

  it('replaces a saturated run with extrapolated values (matches binary behavior)', () => {
    // Pulse's saturation patcher EXTRAPOLATES UPWARD beyond the saturation
    // cap — the assumption being that a clipped reading was actually larger
    // in the underlying signal. So replacement values are usually larger
    // than the original saturation value, not smaller.
    const SAT_RAW = GYRO_SAT_THRESHOLD * 1.2;
    const buf = buildBuffer((i) => {
      if (i >= 200 && i <= 220) return SAT_RAW;
      return 1.0;
    }, OFF60.GY);

    const dv = new DataView(buf);
    interpolateAll(buf);

    // Verify the run was patched (values changed from SAT_RAW)
    let changedCount = 0;
    for (let i = 200; i <= 220; i++) {
      const v = dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.GY, true);
      if (Math.abs(v - SAT_RAW) > 1e-6) changedCount++;
    }
    expect(changedCount).toBeGreaterThan(15);

    // Trajectory should be smooth (no NaN/Infinity, monotonic-ish over each
    // half — though we don't assert specific values since the algorithm is
    // intentionally unusual).
    for (let i = 200; i <= 220; i++) {
      const v = dv.getFloat64(i * SAMPLE_BYTES_60 + OFF60.GY, true);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
