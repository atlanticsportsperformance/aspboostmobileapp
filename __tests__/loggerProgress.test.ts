import { buildSequence } from '../lib/logger/sequence';
import { workoutProgress, exerciseDashes, progressLine } from '../lib/logger/progress';
import type { LoggerRoutine, LoggerRoutineExercise } from '../types/logger';

function re(id: string, sets: number): LoggerRoutineExercise {
  return {
    id, exercise_id: `ex-${id}`, sets, order_index: 0, ask_rpe: false,
    velocity_min_mps: null, velocity_max_mps: null, speed_drop_stop_pct: null,
    rest_seconds: null, exercises: { id: `ex-${id}`, name: id },
  };
}
function routine(id: string, scheme: string, exercises: LoggerRoutineExercise[]): LoggerRoutine {
  return { id, name: id, order_index: 0, scheme, rounds: null, rest_between_rounds_seconds: null, routine_exercises: exercises };
}

describe('workout progress', () => {
  it('counts real sets from the sequence', () => {
    // uneven superset: A has 3 sets, B has 2 -> 5 steps, plus straight C x2 = 7
    const seq = buildSequence([
      routine('r1', 'superset', [re('A', 3), re('B', 2)]),
      routine('r2', 'straight', [re('C', 2)]),
    ]);
    const p = workoutProgress(seq, { A: [true, true, false], B: [true], C: [false, false] });
    expect(p).toEqual({ doneSets: 3, totalSets: 7 });
  });

  it('ignores done flags beyond the real sets', () => {
    const seq = buildSequence([routine('r1', 'straight', [re('A', 2)])]);
    expect(workoutProgress(seq, { A: [true, true, true], ghost: [true] })).toEqual({ doneSets: 2, totalSets: 2 });
  });

  it('dashes mark current set', () => {
    const seq = buildSequence([routine('r1', 'straight', [re('A', 3)])]);
    expect(exerciseDashes('A', seq, { A: [true, false, false] }, { reId: 'A', setIndex: 1 }))
      .toEqual(['done', 'current', 'todo']);
    expect(exerciseDashes('A', seq, { A: [true, false, false] }))
      .toEqual(['done', 'todo', 'todo']);
  });

  it('progressLine formats', () => {
    expect(progressLine({ doneSets: 7, totalSets: 16 }, 24)).toBe('7/16 sets · 24 min');
    expect(progressLine({ doneSets: 0, totalSets: 16 }, 0)).toBe('0/16 sets');
  });
});
