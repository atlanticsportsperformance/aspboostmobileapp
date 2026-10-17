import { isSetDoneFromLog } from '../lib/loggerResume';

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
