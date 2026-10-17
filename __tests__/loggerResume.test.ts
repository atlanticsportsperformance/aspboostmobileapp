import { isSetDoneFromLog, isValidSetIndex, logToSetInputs, mergeLogsWithPending } from '../lib/loggerResume';

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

describe('mergeLogsWithPending — reload overlay', () => {
  const server = [
    { id: 'a', routine_exercise_id: 're-1', set_number: 1, actual_reps: 3, is_complete: false, rpe: 7 },
    { id: 'b', routine_exercise_id: 're-1', set_number: 2, actual_reps: 4, is_complete: true },
  ];
  it('pending rows win over server rows for the same set, keeping server-only columns', () => {
    const pending = [{ workout_instance_id: 'wi', routine_exercise_id: 're-1', set_number: 1, actual_reps: 5, is_complete: true }];
    const merged = mergeLogsWithPending(server, pending, 'wi');
    expect(merged).toHaveLength(2);
    expect(merged.find(l => l.set_number === 1)).toMatchObject({ id: 'a', actual_reps: 5, is_complete: true, rpe: 7 });
    expect(merged.find(l => l.set_number === 2)).toEqual(server[1]);
  });
  it('adds pending-only sets and ignores other workouts', () => {
    const pending = [
      { workout_instance_id: 'wi', routine_exercise_id: 're-2', set_number: 1, actual_reps: 9 },
      { workout_instance_id: 'other', routine_exercise_id: 're-1', set_number: 2, actual_reps: 99 },
    ];
    const merged = mergeLogsWithPending(server, pending, 'wi');
    expect(merged).toHaveLength(3);
    expect(merged.find(l => l.set_number === 2 && l.routine_exercise_id === 're-1')?.actual_reps).toBe(4);
  });
  it('handles null server logs', () => {
    expect(mergeLogsWithPending(null, [], 'wi')).toEqual([]);
  });
});
