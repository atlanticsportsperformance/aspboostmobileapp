import { isSetDoneFromLog, isValidSetIndex } from '../lib/loggerResume';

describe('isSetDoneFromLog — resume rule', () => {
  it('is_complete true with no values is done (quick-complete / Log Set with nothing typed)', () => {
    expect(isSetDoneFromLog({ is_complete: true, actual_reps: null, metric_data: null })).toBe(true);
  });
  it('values with is_complete false is still done (legacy rows)', () => {
    expect(isSetDoneFromLog({ is_complete: false, actual_reps: 5 })).toBe(true);
    expect(isSetDoneFromLog({ is_complete: false, metric_data: { velo: 82 } })).toBe(true);
  });
  it('empty row with is_complete false is not done', () => {
    expect(isSetDoneFromLog({ is_complete: false, actual_reps: null, actual_weight: '', metric_data: {} })).toBe(false);
  });
  it('notes alone do not count as done', () => {
    expect(isSetDoneFromLog({ is_complete: false, notes: 'felt good' })).toBe(false);
  });
  it('missing log is not done', () => {
    expect(isSetDoneFromLog(null)).toBe(false);
  });
});

describe('isValidSetIndex — no phantom set rows', () => {
  it('rejects -1 and sets; accepts 0 and sets-1', () => {
    expect(isValidSetIndex(-1, 3)).toBe(false);
    expect(isValidSetIndex(0, 3)).toBe(true);
    expect(isValidSetIndex(2, 3)).toBe(true);
    expect(isValidSetIndex(3, 3)).toBe(false);
  });
  it('rejects everything when sets is missing', () => {
    expect(isValidSetIndex(0, undefined)).toBe(false);
  });
});
