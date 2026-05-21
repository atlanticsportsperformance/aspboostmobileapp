import { dpsToRpm } from '../lib/pulse/units';

describe('dpsToRpm', () => {
  it('converts degrees/sec to revolutions/min (÷6)', () => {
    expect(dpsToRpm(6130)).toBe(1022);   // 6130/6 = 1021.67 → 1022
    expect(dpsToRpm(1484)).toBe(247);
    expect(dpsToRpm(0)).toBe(0);
  });
  it('returns null for null input', () => {
    expect(dpsToRpm(null)).toBeNull();
  });
});
