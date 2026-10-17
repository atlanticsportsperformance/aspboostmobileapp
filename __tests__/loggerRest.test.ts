import { restAfter, formatRest, secondsRemaining } from '../lib/logger/rest';
import type { SeqStep } from '../lib/logger/sequence';
import type { LoggerRoutine, LoggerRoutineExercise } from '../types/logger';

function re(extra: Partial<LoggerRoutineExercise> = {}): LoggerRoutineExercise {
  return {
    id: 'A', exercise_id: 'ex-A', sets: 3, order_index: 0, ask_rpe: false,
    velocity_min_mps: null, velocity_max_mps: null, speed_drop_stop_pct: null,
    rest_seconds: null, exercises: { id: 'ex-A', name: 'A' }, ...extra,
  };
}
function routine(scheme: string, rest: number | null = null): LoggerRoutine {
  return { id: 'r', name: 'r', order_index: 0, scheme, rounds: null, rest_between_rounds_seconds: rest, routine_exercises: [] };
}
const step = (setIndex: number, endsRound = false): SeqStep => ({ routineId: 'r', reId: 'A', setIndex, round: setIndex + 1, endsRound });

describe('rest rules', () => {
  it('straight uses per-set rest then exercise rest', () => {
    const e = re({ rest_seconds: 90, set_configurations: [{ rest_seconds: 45 }, {}] });
    expect(restAfter(step(0), e, routine('straight'))).toBe(45);
    expect(restAfter(step(1), e, routine('straight'))).toBe(90);
    expect(restAfter(step(2), e, routine('straight'))).toBe(90);
  });

  it('grouped rests only at round end', () => {
    const r = routine('superset', 120);
    expect(restAfter(step(0, false), re(), r)).toBe(0);
    expect(restAfter(step(0, true), re(), r)).toBe(120);
    expect(restAfter(step(0, true), re(), routine('superset', null))).toBeNull();
  });

  it('no prescription -> null', () => {
    expect(restAfter(step(0), re(), routine('straight'))).toBeNull();
    expect(restAfter(step(0), re({ set_configurations: [{ rest_seconds: null }] }), routine('straight'))).toBeNull();
  });

  it('formatRest', () => {
    expect(formatRest(72)).toBe('1:12');
    expect(formatRest(5)).toBe('0:05');
    expect(formatRest(0)).toBe('0:00');
  });

  it('secondsRemaining counts down from an end timestamp', () => {
    expect(secondsRemaining(10_000, 7_500)).toBe(3);
    expect(secondsRemaining(10_000, 10_000)).toBe(0);
    expect(secondsRemaining(10_000, 12_000)).toBe(0);
  });
});
