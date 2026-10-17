import { isSetDoneFromLog, isValidSetIndex, logToSetInputs } from '../lib/loggerResume';

describe('isSetDoneFromLog — resume rule (is_complete only)', () => {
  it('legacy complete row with no values resumes done', () => {
    expect(isSetDoneFromLog({ is_complete: true, actual_reps: null, metric_data: null })).toBe(true);
  });
  it('legacy complete row with values resumes done', () => {
    expect(isSetDoneFromLog({ is_complete: true, actual_reps: 5, actual_weight: 135 })).toBe(true);
  });
  it('draft with values resumes as not done but keeps values', () => {
    const draft = {
      is_complete: false,
      actual_reps: 5,
      actual_weight: 135,
      actual_duration_seconds: null,
      actual_distance: null,
      notes: 'grip',
      metric_data: { velo: 82 },
    };
    expect(isSetDoneFromLog(draft)).toBe(false);
    expect(logToSetInputs(draft)).toEqual({
      reps: 5,
      weight: 135,
      time_seconds: null,
      distance: null,
      notes: 'grip',
      velo: 82,
    });
  });
  it('un-checked row (is_complete false) is not done', () => {
    expect(isSetDoneFromLog({ is_complete: false, actual_reps: null, metric_data: {} })).toBe(false);
  });
  it('missing log or missing flag is not done', () => {
    expect(isSetDoneFromLog(null)).toBe(false);
    expect(isSetDoneFromLog({ actual_reps: 5 })).toBe(false);
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
