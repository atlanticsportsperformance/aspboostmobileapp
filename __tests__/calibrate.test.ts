/**
 * Unit test for the int16 → physical-units calibration step.
 *
 * Constants and per-sample byte layout are dictated by
 * `_GSCalculateSwingFromIMUData @ 0xd164` lines 46-71. Any drift here
 * propagates into every downstream metric.
 */
import { calibrate, _internal } from '@/lib/pulse/decoder/calibrate';
import { OFF60, SAMPLE_BYTES_60 } from '@/lib/pulse/decoder/buffer-layout';

describe('calibrate', () => {
  it('uses the binary-derived accel/gyro scales (no curve-fit fudge)', () => {
    expect(_internal.ACCEL_SCALE).toBeCloseTo(24 / 2048, 15);
    expect(_internal.GYRO_SCALE).toBeCloseTo(
      (4000 / 32768) * (Math.PI / 180),
      15,
    );
  });

  it('produces a 60-byte/sample buffer with accel and gyro doubles at the documented offsets', () => {
    // Build one sample = 12 bytes int16 LE: ax=1024, ay=-2048, az=512, gx=8192, gy=-16384, gz=4096
    const input = new Uint8Array(12);
    const dv = new DataView(input.buffer);
    dv.setInt16(0, 1024, true);
    dv.setInt16(2, -2048, true);
    dv.setInt16(4, 512, true);
    dv.setInt16(6, 8192, true);
    dv.setInt16(8, -16384, true);
    dv.setInt16(10, 4096, true);

    const out = calibrate(input);
    expect(out.byteLength).toBe(SAMPLE_BYTES_60);
    const ov = new DataView(out);

    expect(ov.getFloat64(OFF60.AX, true)).toBeCloseTo(1024 * (24 / 2048), 12);
    expect(ov.getFloat64(OFF60.AY, true)).toBeCloseTo(-2048 * (24 / 2048), 12);
    expect(ov.getFloat64(OFF60.AZ, true)).toBeCloseTo(512 * (24 / 2048), 12);
    expect(ov.getFloat64(OFF60.GX, true)).toBeCloseTo(
      8192 * ((4000 / 32768) * (Math.PI / 180)),
      12,
    );
    expect(ov.getFloat64(OFF60.GY, true)).toBeCloseTo(
      -16384 * ((4000 / 32768) * (Math.PI / 180)),
      12,
    );
    expect(ov.getFloat64(OFF60.GZ, true)).toBeCloseTo(
      4096 * ((4000 / 32768) * (Math.PI / 180)),
      12,
    );

    // sample index slot stays zero (filled later by sample-index pass).
    expect(ov.getInt32(OFF60.IDX, true)).toBe(0);
    // scalar C slot stays zero (filled later by integrator).
    expect(ov.getFloat64(OFF60.SCALAR_C, true)).toBe(0);
  });

  it('processes multiple samples sequentially with 60-byte stride', () => {
    const n = 5;
    const input = new Uint8Array(n * 12);
    const dv = new DataView(input.buffer);
    for (let i = 0; i < n; i++) {
      // Distinct ax per sample so we can verify stride.
      dv.setInt16(i * 12, i + 1, true);
    }
    const out = calibrate(input);
    expect(out.byteLength).toBe(n * SAMPLE_BYTES_60);
    const ov = new DataView(out);
    for (let i = 0; i < n; i++) {
      const off = i * SAMPLE_BYTES_60;
      expect(ov.getFloat64(off + OFF60.AX, true)).toBeCloseTo(
        (i + 1) * (24 / 2048),
        12,
      );
    }
  });
});
