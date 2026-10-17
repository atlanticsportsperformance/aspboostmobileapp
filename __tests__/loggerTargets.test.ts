import { roundLoad, resolveTarget, backoffFills, intensityFor } from '../lib/logger/targets';
import type { LoggerRoutineExercise } from '../types/logger';

function re(extra: Partial<LoggerRoutineExercise> = {}): LoggerRoutineExercise {
  return {
    id: 'A', exercise_id: 'ex-A', sets: 3, order_index: 0, ask_rpe: false,
    velocity_min_mps: null, velocity_max_mps: null, speed_drop_stop_pct: null,
    rest_seconds: null, exercises: { id: 'ex-A', name: 'A' }, ...extra,
  };
}

// Set 1 is a top set; sets 2 and 3 are 90% of set 1.
const wave = re({
  set_configurations: [
    { metric_values: { reps: 2 } },
    { metric_values: { reps: 4 }, intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 1 }] },
    { metric_values: { reps: 4 }, intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 1 }] },
  ],
});

describe('logger targets', () => {
  it('roundLoad rounds to the nearest 5', () => {
    expect(roundLoad(197.5)).toBe(200);
    expect(roundLoad(181.6)).toBe(180);
  });

  it('90% of set 1 from logged 220 -> 200', () => {
    const logged = { 0: { weight: 220 } };
    expect(resolveTarget({ re: wave, setIndex: 1, metric: 'weight', maxes: {}, logged })).toBe(200);
  });

  it('reads string inputs and returns null when the reference set is not logged', () => {
    expect(resolveTarget({ re: wave, setIndex: 1, metric: 'weight', maxes: {}, logged: { 0: { weight: '220' } } })).toBe(200);
    expect(resolveTarget({ re: wave, setIndex: 1, metric: 'weight', maxes: {}, logged: {} })).toBeNull();
    expect(intensityFor({ re: wave, setIndex: 1, metric: 'weight', maxes: {}, logged: {} })).toEqual({
      percent: 90, sourceExerciseName: 'Set 1 (not logged yet)',
    });
  });

  it('falls back to metric_targets', () => {
    const e = re({ metric_targets: { reps: 5, weight: 0 }, set_configurations: [{ metric_values: { reps: 3 } }] });
    expect(resolveTarget({ re: e, setIndex: 0, metric: 'reps', maxes: {}, logged: {} })).toBe(3);
    expect(resolveTarget({ re: e, setIndex: 1, metric: 'reps', maxes: {}, logged: {} })).toBe(5);
    expect(resolveTarget({ re: e, setIndex: 1, metric: 'weight', maxes: {}, logged: {} })).toBe(0);
    expect(resolveTarget({ re: e, setIndex: 1, metric: 'distance', maxes: {}, logged: {} })).toBeNull();
  });

  it('% of max uses athlete max', () => {
    const e = re({ metric_targets: { weight: 135 }, intensity_targets: [{ metric: 'weight', percent: 80 }] });
    expect(resolveTarget({ re: e, setIndex: 0, metric: 'weight', maxes: { 'ex-A': { weight: 227 } }, logged: {} })).toBe(180);
    // no max → prescribed value
    expect(resolveTarget({ re: e, setIndex: 0, metric: 'weight', maxes: {}, logged: {} })).toBe(135);
    // non-weight metrics round to whole numbers, not 5s
    const r = re({ intensity_targets: [{ metric: 'reps', percent: 50 }] });
    expect(resolveTarget({ re: r, setIndex: 0, metric: 'reps', maxes: { 'ex-A': { reps: 13 } }, logged: {} })).toBe(7);
  });

  it('cross-exercise max uses the source exercise', () => {
    const e = re({ intensity_targets: [{ metric: 'weight', percent: 50, source_exercise_id: 'ex-B', source_exercise_name: 'Bench' }] });
    expect(intensityFor({ re: e, setIndex: 0, metric: 'weight', maxes: { 'ex-B': { weight: 300 } }, logged: {} })).toEqual({
      percent: 50, calculatedValue: 150, sourceExerciseName: 'Bench',
    });
  });

  it('throwing velocity falls back to mound velocity', () => {
    const e = re({ intensity_targets: [{ metric: '4oz_velo', percent: 90 }] });
    // 80 mph mound → 4oz = round(80 * 1.027) = 82 → 90% = 74
    expect(resolveTarget({ re: e, setIndex: 0, metric: '4oz_velo', maxes: {}, logged: {}, moundVelocity: 80 })).toBe(74);
    expect(resolveTarget({ re: e, setIndex: 0, metric: '4oz_velo', maxes: {}, logged: {} })).toBeNull();
  });

  it('back-off fills every set relative to a logged set', () => {
    const fills = backoffFills({ re: wave, metric: 'weight', maxes: {}, logged: { 0: { weight: 220 } }, edited: new Set() });
    expect(fills).toEqual({ 1: 200, 2: 200 });
  });

  it('edited backoff is kept', () => {
    const fills = backoffFills({ re: wave, metric: 'weight', maxes: {}, logged: { 0: { weight: 220 }, 1: { weight: 205 } }, edited: new Set([1]) });
    expect(fills).toEqual({ 2: 200 });
    expect(1 in fills).toBe(false);
  });

  it('chained back-offs use the filled value of the set before', () => {
    const chain = re({
      set_configurations: [
        {},
        { intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 1 }] },
        { intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 2 }] },
      ],
    });
    expect(backoffFills({ re: chain, metric: 'weight', maxes: {}, logged: { 0: { weight: 300 } }, edited: new Set() }))
      .toEqual({ 1: 270, 2: 245 });
    // an edited middle set anchors the next one on what the athlete typed
    expect(backoffFills({ re: chain, metric: 'weight', maxes: {}, logged: { 0: { weight: 300 }, 1: { weight: 250 } }, edited: new Set([1]) }))
      .toEqual({ 2: 225 });
  });

  it('no fills when the reference set is not logged or targets are max-based', () => {
    expect(backoffFills({ re: wave, metric: 'weight', maxes: {}, logged: {}, edited: new Set() })).toEqual({});
    const e = re({ intensity_targets: [{ metric: 'weight', percent: 80 }] });
    expect(backoffFills({ re: e, metric: 'weight', maxes: { 'ex-A': { weight: 200 } }, logged: {}, edited: new Set() })).toEqual({});
  });
});

describe('exercise screen wiring', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../screens/exercise-detail-view.tsx'), 'utf8') as string;

  it('delegates target math to lib/logger/targets', () => {
    expect(src).toMatch(/from '\.\.\/lib\/logger\/targets'/);
    expect(src).not.toMatch(/calculateThrowingTarget/);
    expect(src).toMatch(/backoffFills\(/);
  });

  it('marks hand-typed sets as edited (keypad press + backspace)', () => {
    expect(src.match(/markSetEdited\(setIndex\);\n\s*onInputChangeWithTick\(setIndex, metricId, newValue\)/g)).toHaveLength(2);
  });
});
