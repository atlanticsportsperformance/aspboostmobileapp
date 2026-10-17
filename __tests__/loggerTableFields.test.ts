import { tableFieldsFor } from '../lib/logger/setLine';
import type { LoggerRoutineExercise, Measurement } from '../types/logger';

function re(extra: Partial<LoggerRoutineExercise> = {}): LoggerRoutineExercise {
  return {
    id: 'A', exercise_id: 'ex-A', sets: 3, order_index: 0, ask_rpe: false,
    velocity_min_mps: null, velocity_max_mps: null, speed_drop_stop_pct: null,
    rest_seconds: null, exercises: { id: 'ex-A', name: 'A' }, ...extra,
  };
}

const weightOnly: Measurement[] = [{ id: 'm-w', name: 'Weight', category: 'single', primary_metric_id: 'weight' }];

describe('tableFieldsFor', () => {
  it('adds reps prescribed per set when only weight is enabled (Back Squat)', () => {
    const squat = re({
      enabled_measurements: ['m-w'],
      set_configurations: [{ metric_values: { reps: 2 } }, { metric_values: { reps: 2 } }],
    });
    expect(tableFieldsFor(squat, weightOnly)).toEqual(['weight', 'reps']);
  });

  it('weight first, then reps, then others; % targets count; empty values do not', () => {
    const e = re({
      enabled_measurements: ['m-d'],
      intensity_targets: [{ metric: 'weight', percent: 80 }],
      set_configurations: [{ metric_values: { reps: 5, time_seconds: null as unknown as number } }],
    });
    const distance: Measurement[] = [{ id: 'm-d', name: 'Distance', category: 'single', primary_metric_id: 'distance' }];
    expect(tableFieldsFor(e, distance)).toEqual(['weight', 'reps', 'distance']);
  });
});
