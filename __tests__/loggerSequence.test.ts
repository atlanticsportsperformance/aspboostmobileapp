import { buildSequence, neighborExercise, nextStep } from '../lib/logger/sequence';
import type { LoggerRoutine, LoggerRoutineExercise } from '../types/logger';

function re(id: string, sets: number, extra: Partial<LoggerRoutineExercise> = {}): LoggerRoutineExercise {
  return {
    id,
    exercise_id: `ex-${id}`,
    sets,
    order_index: 0,
    ask_rpe: false,
    velocity_min_mps: null,
    velocity_max_mps: null,
    speed_drop_stop_pct: null,
    rest_seconds: null,
    exercises: { id: `ex-${id}`, name: id },
    ...extra,
  };
}

function routine(id: string, scheme: string, exercises: LoggerRoutineExercise[], rounds: number | null = null): LoggerRoutine {
  return {
    id,
    name: id,
    order_index: 0,
    scheme,
    rounds,
    rest_between_rounds_seconds: null,
    routine_exercises: exercises,
  };
}

const pairs = (seq: ReturnType<typeof buildSequence>) => seq.map(s => [s.reId, s.setIndex]);

describe('buildSequence', () => {
  it('straight block runs all sets then next exercise', () => {
    const seq = buildSequence([routine('R1', 'straight', [re('E1', 3), re('E2', 2)])]);
    expect(pairs(seq)).toEqual([['E1', 0], ['E1', 1], ['E1', 2], ['E2', 0], ['E2', 1]]);
    expect(seq.every(s => s.routineId === 'R1')).toBe(true);
  });

  it('uneven superset drops shorter exercise', () => {
    const seq = buildSequence([routine('A', 'superset', [re('A1', 4), re('A2', 3)])]);
    expect(pairs(seq)).toEqual([
      ['A1', 0], ['A2', 0], ['A1', 1], ['A2', 1], ['A1', 2], ['A2', 2], ['A1', 3],
    ]);
    const ends = seq.filter(s => s.endsRound).map(s => [s.reId, s.setIndex]);
    expect(ends).toEqual([['A2', 0], ['A2', 1], ['A2', 2], ['A1', 3]]);
    expect(seq.map(s => s.round)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });

  it('rounds override caps rounds', () => {
    const seq = buildSequence([routine('A', 'circuit', [re('A1', 3), re('A2', 3)], 2)]);
    expect(pairs(seq)).toEqual([['A1', 0], ['A2', 0], ['A1', 1], ['A2', 1]]);
    expect(seq.map(s => s.round)).toEqual([1, 1, 2, 2]);
  });

  it('notes-only rows and text blocks are skipped', () => {
    const seq = buildSequence([
      routine('W', 'warm_up', [re('W1', 2)]),
      routine('R', 'straight', [re('N1', 1, { notes_only: true, is_placeholder: true }), re('E1', 1)]),
      routine('S', 'superset', [re('N2', 1, { notes_only: true }), re('S1', 1)]),
    ]);
    expect(pairs(seq)).toEqual([['E1', 0], ['S1', 0]]);
  });
});

describe('nextStep', () => {
  const seq = buildSequence([routine('A', 'superset', [re('A1', 2), re('A2', 2)])]);

  it('nextStep continues rotation after A1', () => {
    const step = nextStep(seq, { A1: [true, false] }, { reId: 'A1', setIndex: 0 });
    expect(step && [step.reId, step.setIndex]).toEqual(['A2', 0]);
    expect(nextStep(seq, { A1: [true, true], A2: [true, true] }, { reId: 'A1', setIndex: 1 })).toBeNull();
  });

  it('wraps to the first not-done step of the workout', () => {
    const step = nextStep(seq, { A1: [false, true], A2: [true, true] }, { reId: 'A2', setIndex: 1 });
    expect(step && [step.reId, step.setIndex]).toEqual(['A1', 0]);
  });

  it('without from returns the first not-done step', () => {
    const step = nextStep(seq, { A1: [true] });
    expect(step && [step.reId, step.setIndex]).toEqual(['A2', 0]);
  });
});

describe('screens use the sequence engine', () => {
  const { readFileSync } = require('fs');
  const { join } = require('path');
  const read = (f: string) => readFileSync(join(__dirname, '..', 'screens', f), 'utf8');

  it('WorkoutLoggerScreen.handleNextSet asks nextStep for the next set', () => {
    const src = read('WorkoutLoggerScreen.tsx');
    expect(src).toContain('buildSequence(workout.routines)');
    expect(src).toMatch(/const next = nextStep\(sequence, done,/);
    expect(src).not.toContain("currentRoutine.scheme === 'superset'");
  });

  it('exercise-detail-view Next label asks nextStep', () => {
    const src = read('exercise-detail-view.tsx');
    expect(src).toMatch(/const next = nextStep\(sequence, done,/);
    expect(src).not.toContain('simulatedIndexes');
  });
});

describe('placeholders', () => {
  it('placeholder rows are excluded from the sequence', () => {
    const seq = buildSequence([
      routine('r1', 'straight', [
        re('A', 2),
        re('P', 3, { is_placeholder: true }),
        re('Q', 3, { exercises: { id: 'q', name: 'q', is_placeholder: true } }),
      ]),
    ]);
    expect(pairs(seq)).toEqual([['A', 0], ['A', 1]]);
  });
});

describe('neighborExercise — prev/next/swipe skip text blocks (final review I5)', () => {
  const rows = [
    { id: 'warm', exercises: null },
    { id: 'A', exercises: { name: 'A' } },
    { id: 'note', exercises: null },
    { id: 'B', exercises: { name: 'B' } },
    { id: 'cool', exercises: null },
  ];
  it('steps over rows with no joined exercise', () => {
    expect(neighborExercise(rows, 'A', 1)?.id).toBe('B');
    expect(neighborExercise(rows, 'B', -1)?.id).toBe('A');
  });
  it('null at the ends (only text blocks beyond) and for an unknown id', () => {
    expect(neighborExercise(rows, 'A', -1)).toBeNull();
    expect(neighborExercise(rows, 'B', 1)).toBeNull();
    expect(neighborExercise(rows, 'zzz', 1)).toBeNull();
    expect(neighborExercise(rows, null, 1)).toBeNull();
  });
  it('the logger and exercise screen navigate through it and never dereference exercises unguarded', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const L: string = readFileSync(join(__dirname, '..', 'screens/WorkoutLoggerScreen.tsx'), 'utf8');
    const D: string = readFileSync(join(__dirname, '..', 'screens/exercise-detail-view.tsx'), 'utf8');
    expect(L).toContain('const prev = neighborExercise(allExercises, activeExerciseId, -1);');
    expect(L).toContain('const following = neighborExercise(allExercises, activeExerciseId, 1);');
    expect(L).toContain('hasPrev={neighborExercise(allExercises, currentExercise.id, -1) != null}');
    expect(L).toContain('hasNext={neighborExercise(allExercises, currentExercise.id, 1) != null}');
    expect(D).not.toMatch(/\.exercises\.(name|video_url)/);
  });
});
