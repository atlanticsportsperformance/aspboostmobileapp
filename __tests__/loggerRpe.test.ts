import { rpeOptions } from '../lib/logger/rpe';

describe('rpeOptions', () => {
  it('whole numbers when no target', () => {
    expect(rpeOptions(null)).toEqual([6, 7, 8, 9, 10]);
  });
  it('inserts half-step target', () => {
    expect(rpeOptions(8.5)).toEqual([6, 7, 8, 8.5, 9, 10]);
    expect(rpeOptions(8)).toEqual([6, 7, 8, 9, 10]);
  });
  it('ignores out-of-range target', () => {
    expect(rpeOptions(5.5)).toEqual([6, 7, 8, 9, 10]);
    expect(rpeOptions(10.5)).toEqual([6, 7, 8, 9, 10]);
    expect(rpeOptions(Number.NaN)).toEqual([6, 7, 8, 9, 10]);
  });
});
