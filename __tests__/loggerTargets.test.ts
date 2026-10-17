import {
  roundLoad, resolveTarget, backoffFills, backoffUpdates, intensityFor, nextSetPrefill,
  intensityText, pendingTargetText, needsWeightEntry, intensityCaptionText, isBackoffReference,
} from '../lib/logger/targets';
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
      percent: 90, sourceExerciseName: 'Set 1', referenceSet: 1,
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
    expect(src).toMatch(/backoffUpdates\(/);
  });

  it('marks hand-typed fields as edited (keypad press + backspace)', () => {
    expect(src.match(/markFieldEdited\(setIndex, metricId\)/g)).toHaveLength(3); // keypad press, backspace, stepper
  });
});

describe('backoffUpdates', () => {
  const base = { re: wave, metrics: ['reps', 'weight'], maxes: {}, edited: new Set<string>() };

  it('a back-off skipped while the keypad is on it still follows set 1 afterwards', () => {
    // set 1 was 220, set 2 auto-filled to 200 (logged, never typed)
    const first = backoffUpdates({ ...base, logged: { 0: { weight: 220, reps: 2 }, 1: { weight: 200, reps: 4 } }, expected: {}, active: null });
    expect(first.apply).toEqual([]);
    expect(first.expected['1:weight']).toBe(200);

    // athlete edits set 1 to 230 and the keypad jumps straight to set 2's weight
    const logged = { 0: { weight: 230, reps: 2 }, 1: { weight: 200, reps: 4 } };
    const during = backoffUpdates({ ...base, logged, expected: first.expected, active: { setIndex: 1, metric: 'weight' } });
    expect(during.apply).toEqual([]);
    expect(during.expected['1:weight']).toBe(200);

    // keypad leaves set 2 without typing → 230 × 0.9 = 207 → roundLoad → 205
    const after = backoffUpdates({ ...base, logged, expected: during.expected, active: null });
    expect(after.apply).toEqual([{ setIndex: 1, metric: 'weight', value: roundLoad(207) }]);
    expect(roundLoad(207)).toBe(205);
    expect(after.expected['1:weight']).toBe(205);
  });

  it('a hand-edited back-off stays', () => {
    const logged = { 0: { weight: 230 }, 1: { weight: 200 } };
    const r = backoffUpdates({ ...base, logged, expected: { '1:weight': 200 }, active: null, edited: new Set(['1:weight']) });
    expect(r.apply).toEqual([]);
  });

  it('editing reps does not freeze the weight', () => {
    const logged = { 0: { weight: 230 }, 1: { weight: 200, reps: 5 } };
    const r = backoffUpdates({ ...base, logged, expected: { '1:weight': 200 }, active: null, edited: new Set(['1:reps']) });
    expect(r.apply).toEqual([{ setIndex: 1, metric: 'weight', value: 205 }]);
  });

  it('a value that is not the previous auto value is kept (edited lost to a remount)', () => {
    const logged = { 0: { weight: 230 }, 1: { weight: 210 } };
    expect(backoffUpdates({ ...base, logged, expected: { '1:weight': 200 }, active: null }).apply).toEqual([]);
    expect(backoffUpdates({ ...base, logged, expected: {}, active: null }).apply).toEqual([]);
  });

  it('empty back-offs are never written but their expected value is recorded', () => {
    const r = backoffUpdates({ ...base, logged: { 0: { weight: 220 } }, expected: {}, active: null });
    expect(r.apply).toEqual([]);
    expect(r.expected).toEqual({ '1:weight': 200, '2:weight': 200 });
  });
});

describe('nextSetPrefill — Next Set carry-forward (final review I1)', () => {
  const base = { maxes: {}, moundVelocity: null };

  it('back-off set: set 1 = 220 → set 2 gets 200 (not 220); per-set reps are not copied', () => {
    const logged = { 0: { weight: '220', reps: '2' } };
    expect(nextSetPrefill({ ...base, re: wave, nextSetIndex: 1, prev: logged[0], logged })).toEqual({ weight: 200 });
  });

  it('plain straight sets still copy the previous set', () => {
    const e = re();
    const logged = { 0: { weight: '135', reps: '8', notes: 'easy' } };
    expect(nextSetPrefill({ ...base, re: e, nextSetIndex: 1, prev: logged[0], logged })).toEqual({ weight: '135', reps: '8' });
  });

  it('skips prescribed values, % of max, measured velocity, and values already in the next set', () => {
    const e = re({
      metric_targets: { reps: 5 },
      intensity_targets: [{ metric: 'weight', percent: 80 }],
    });
    const logged = { 0: { reps: '5', weight: '180', velo_5oz: 82, distance: 10, time_seconds: 30 }, 1: { distance: 12 } };
    expect(nextSetPrefill({ ...base, re: e, nextSetIndex: 1, prev: logged[0], logged })).toEqual({ time_seconds: 30 });
  });

  it('chained back-off anchors on the logged value of the reference set', () => {
    const chain = re({
      set_configurations: [
        {},
        { intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 1 }] },
        { intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 2 }] },
      ],
    });
    const logged = { 0: { weight: 220 }, 1: { weight: 195 } };
    expect(nextSetPrefill({ ...base, re: chain, nextSetIndex: 2, prev: logged[1], logged })).toEqual({ weight: 175 });
  });
});

describe('target text', () => {
  const pctMax = re({ intensity_targets: [{ metric: 'weight', percent: 80 }] });
  const pctBench = re({ intensity_targets: [{ metric: 'weight', percent: 70, source_exercise_id: 'ex-B', source_exercise_name: 'Bench' }] });

  it('caption reads "90% of set 1" / "70% of Bench max" / "80% of max"', () => {
    expect(intensityText(intensityFor({ re: wave, setIndex: 1, metric: 'weight', maxes: {}, logged: {} })!)).toBe('90% of set 1');
    expect(intensityText(intensityFor({ re: wave, setIndex: 1, metric: 'weight', maxes: {}, logged: { 0: { weight: 220 } } })!)).toBe('90% of set 1');
    expect(intensityText(intensityFor({ re: pctBench, setIndex: 0, metric: 'weight', maxes: {}, logged: {} })!)).toBe('70% of Bench max');
    expect(intensityText(intensityFor({ re: pctMax, setIndex: 0, metric: 'weight', maxes: {}, logged: {} })!)).toBe('80% of max');
  });

  it('placeholder for an unlogged reference set names the set, not "no max set"', () => {
    const t = intensityFor({ re: wave, setIndex: 1, metric: 'weight', maxes: {}, logged: {} });
    expect(pendingTargetText(t)).toBe('90% of set 1');
  });

  it('"no max set" only for % of max with no max on file', () => {
    expect(pendingTargetText(intensityFor({ re: pctMax, setIndex: 0, metric: 'weight', maxes: {}, logged: {} }))).toBe('80% · no max set');
    expect(pendingTargetText(intensityFor({ re: pctBench, setIndex: 0, metric: 'weight', maxes: {}, logged: {} }))).toBe('70% · no max set');
  });

  it('no placeholder text once the target works out to a number, or with no target', () => {
    expect(pendingTargetText(intensityFor({ re: wave, setIndex: 1, metric: 'weight', maxes: {}, logged: { 0: { weight: 220 } } }))).toBeNull();
    expect(pendingTargetText(intensityFor({ re: pctMax, setIndex: 0, metric: 'weight', maxes: { 'ex-A': { weight: 300 } }, logged: {} }))).toBeNull();
    expect(pendingTargetText(intensityFor({ re: wave, setIndex: 0, metric: 'weight', maxes: {}, logged: {} }))).toBeNull();
    expect(pendingTargetText(null)).toBeNull();
  });
});

describe('needsWeightEntry', () => {
  const fields = ['weight', 'reps'];
  const base = { maxes: {}, logged: {}, fields };

  it('weight tracked, nothing prescribed → athlete enters it', () => {
    expect(needsWeightEntry({ ...base, re: wave, setIndex: 0 })).toBe(true);
  });

  it('not when the exercise does not track weight', () => {
    expect(needsWeightEntry({ ...base, re: wave, setIndex: 0, fields: ['reps'] })).toBe(false);
  });

  it('not when a weight is prescribed (per set or exercise level, 0 counts)', () => {
    expect(needsWeightEntry({ ...base, re: re({ set_configurations: [{ metric_values: { weight: 135 } }] }), setIndex: 0 })).toBe(false);
    expect(needsWeightEntry({ ...base, re: re({ metric_targets: { weight: 0 } }), setIndex: 2 })).toBe(false);
  });

  it('% of max: hint only while no max is on file', () => {
    const e = re({ intensity_targets: [{ metric: 'weight', percent: 80 }] });
    expect(needsWeightEntry({ ...base, re: e, setIndex: 0 })).toBe(true);
    expect(needsWeightEntry({ ...base, re: e, setIndex: 0, maxes: { 'ex-A': { weight: 300 } } })).toBe(false);
  });

  it('% of set K: resolves once set K is logged', () => {
    expect(needsWeightEntry({ ...base, re: wave, setIndex: 1 })).toBe(true);
    expect(needsWeightEntry({ ...base, re: wave, setIndex: 1, logged: { 0: { weight: '220' } } })).toBe(false);
  });

  it('not when the athlete already typed a weight for that set', () => {
    expect(needsWeightEntry({ ...base, re: wave, setIndex: 0, logged: { 0: { weight: '185' } } })).toBe(false);
    expect(needsWeightEntry({ ...base, re: wave, setIndex: 0, logged: { 0: { weight: '' } } })).toBe(true);
  });
});

describe('intensityCaptionText', () => {
  const backoff = re({
    set_configurations: [
      { metric_values: { reps: 5 } },
      { metric_values: { reps: 5 } },
      { metric_values: { reps: 5 }, intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 2 }] },
    ],
  });

  it('shows the raw number → the rounded load', () => {
    const logged = { 0: { weight: 295 }, 1: { weight: 310 } };
    expect(intensityCaptionText({ re: backoff, setIndex: 2, metric: 'weight', maxes: {}, logged })).toBe('90% of set 2 · 279 → 280');
  });

  it('no arrow when nothing was rounded; just the % while pending; null without a target', () => {
    expect(intensityCaptionText({ re: backoff, setIndex: 2, metric: 'weight', maxes: {}, logged: { 1: { weight: 300 } } }))
      .toBe('90% of set 2 · 270');
    expect(intensityCaptionText({ re: backoff, setIndex: 2, metric: 'weight', maxes: {}, logged: {} })).toBe('90% of set 2');
    expect(intensityCaptionText({ re: backoff, setIndex: 0, metric: 'weight', maxes: {}, logged: {} })).toBeNull();
  });

  it('% of max reads the max', () => {
    const e = re({ intensity_targets: [{ metric: 'weight', percent: 80 }] });
    expect(intensityCaptionText({ re: e, setIndex: 0, metric: 'weight', maxes: { 'ex-A': { weight: 312 } }, logged: {} }))
      .toBe('80% of max · 249.6 → 250');
  });
});

describe('isBackoffReference — back-off follow-through trigger', () => {
  it('true only for a set another set is "% of"', () => {
    expect(isBackoffReference(wave, 0)).toBe(true); // sets 2 and 3 are 90% of set 1
    expect(isBackoffReference(wave, 1)).toBe(false);
    expect(isBackoffReference(wave, 2)).toBe(false);
    expect(isBackoffReference(re(), 0)).toBe(false);
  });

  it('exercise-level "% of set 1" makes set 1 a reference; % of max never does', () => {
    expect(isBackoffReference(re({ intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 1 }] }), 0)).toBe(true);
    expect(isBackoffReference(re({ intensity_targets: [{ metric: 'weight', percent: 80 }] }), 0)).toBe(false);
  });
});
