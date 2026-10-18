// Metric fields + compact set lines for the workout logger. Pure: shared by
// the exercise screen (collapsed set rows) and the overview (done / current
// exercise rows) so both read results the same way.

import type { Measurement, LoggerRoutineExercise } from '../../types/logger';

// Helper: Get metric label
export function getMetricLabel(
  metricId: string,
  customMeasurements: Measurement[]
): string {
  // Check for standard metrics
  if (metricId === 'reps') return 'Reps';
  if (metricId === 'weight') return 'Weight (lb)';
  if (metricId === 'time_seconds') return 'Time (sec)';
  if (metricId === 'distance') return 'Distance (ft)';

  // Check custom measurements
  for (const measurement of customMeasurements) {
    if (measurement.primary_metric_id === metricId) {
      // For ball metrics, include the measurement name (e.g., "Red Ball Reps")
      const metricName = measurement.primary_metric_name || 'Reps';
      return `${measurement.name} ${metricName}`;
    }
    if (measurement.secondary_metric_id === metricId) {
      // For ball metrics, include the measurement name (e.g., "Red Ball Velo")
      const metricName = measurement.secondary_metric_name || 'Velo';
      return `${measurement.name} ${metricName}`;
    }
  }

  return metricId;
}

// Ball weight order for sorting (heaviest to lightest)
export const ballWeightOrder: Record<string, number> = {
  '7oz': 1,
  '7_oz': 1,
  '6oz': 2,
  '6_oz': 2,
  '5oz': 3,
  '5_oz': 3,
  'baseball': 3,
  '4oz': 4,
  '4_oz': 4,
  '3oz': 5,
  '3_oz': 5,
  'blue': 6,
  'blue_ball': 6,
  'red': 7,
  'red_ball': 7,
  'yellow': 8,
  'yellow_ball': 8,
  'gray': 9,
  'gray_ball': 9,
  'grey': 9,
  'grey_ball': 9,
  'green': 10,
  'green_ball': 10,
};

// Helper: Get ball weight for sorting
export function getBallWeight(metricId: string, customMeasurements: Measurement[]): number {
  // Get the measurement name to check (not the UUID)
  const measurementName = customMeasurements.find(
    m => m.primary_metric_id === metricId || m.secondary_metric_id === metricId
  )?.name;
  const textToCheck = (measurementName || metricId).toLowerCase();

  for (const [key, weight] of Object.entries(ballWeightOrder)) {
    if (textToCheck.includes(key)) {
      return weight;
    }
  }
  return 999; // Non-ball metrics go last
}

// Helper: Get measurement name from metricId (looks up in customMeasurements)
export function getMeasurementName(metricId: string, customMeasurements: Measurement[]): string | null {
  for (const measurement of customMeasurements) {
    if (measurement.primary_metric_id === metricId || measurement.secondary_metric_id === metricId) {
      return measurement.name;
    }
  }
  return null;
}

// Helper: Check if metric is a ball-related metric
export function isBallMetric(metricId: string, customMeasurements: Measurement[]): boolean {
  // First check the measurement name from customMeasurements
  const measurementName = getMeasurementName(metricId, customMeasurements);
  const textToCheck = measurementName || metricId;
  const lowerText = textToCheck.toLowerCase();

  const ballKeywords = ['oz', 'ball', 'blue', 'red', 'yellow', 'gray', 'grey', 'green', 'baseball'];
  return ballKeywords.some(keyword => lowerText.includes(keyword));
}

// The metrics an exercise logs, in screen order (ball metrics heaviest to
// lightest, REPS before weight). Empty = notes-only exercise.
export function metricFieldsFor(
  exercise: LoggerRoutineExercise,
  customMeasurements: Measurement[],
): string[] {
  let fields: string[] = [];

  if (exercise.enabled_measurements && exercise.enabled_measurements.length > 0) {
    // Use custom measurements
    exercise.enabled_measurements.forEach(measurementId => {
      const measurement = customMeasurements.find(m => m.id === measurementId);
      if (measurement) {
        if (measurement.primary_metric_id) fields.push(measurement.primary_metric_id);
        if (measurement.secondary_metric_id) fields.push(measurement.secondary_metric_id);
      }
    });
  } else if (exercise.metric_targets && Object.keys(exercise.metric_targets).length > 0) {
    // Fallback to metric_targets if explicitly set
    fields = Object.keys(exercise.metric_targets);
  } else if (exercise.reps || exercise.weight) {
    // Legacy fallback - only if exercise has legacy reps/weight set
    fields = ['reps'];
    if (exercise.weight) fields.push('weight');
  }
  // If no metrics configured, fields stays empty (notes-only exercise)

  // Sort ball metrics by weight (heaviest to lightest)
  // Group primary metrics (reps) and secondary metrics (velo) together per ball type
  const hasBallMetrics = fields.some(f => isBallMetric(f, customMeasurements));
  if (hasBallMetrics) {
    // Separate ball and non-ball metrics
    const ballMetrics = fields.filter(f => isBallMetric(f, customMeasurements));
    const nonBallMetrics = fields.filter(f => !isBallMetric(f, customMeasurements));

    // Sort ball metrics by weight, keeping primary (reps) before secondary (velo) for same ball
    ballMetrics.sort((a, b) => {
      const weightA = getBallWeight(a, customMeasurements);
      const weightB = getBallWeight(b, customMeasurements);
      if (weightA !== weightB) return weightA - weightB;
      // Same ball type - primary (reps) comes before secondary (velo)
      const isAPrimary = a.toLowerCase().includes('reps');
      const isBPrimary = b.toLowerCase().includes('reps');
      if (isAPrimary && !isBPrimary) return -1;
      if (!isAPrimary && isBPrimary) return 1;
      return 0;
    });

    fields = [...nonBallMetrics, ...ballMetrics];
  }

  // REPS before weight (owner) — on screen and in keypad order.
  const w = fields.indexOf('weight');
  const r = fields.indexOf('reps');
  if (w !== -1 && r > w) {
    fields.splice(r, 1);
    fields.splice(w, 0, 'reps');
  }

  return fields;
}

// "5 × 50 lb", "220 lb", "8 reps" — REPS × weight when the exercise has both.
export function formatWeightReps(weight: unknown, reps: unknown): string | null {
  const has = (v: unknown) => v != null && v !== '';
  if (has(weight) && has(reps)) return `${reps} × ${weight} lb`;
  if (has(weight)) return `${weight} lb`;
  if (has(reps)) return `${reps} reps`;
  return null;
}

// One compact line for a set: "5 × 50 lb", then every other metric ("40 ft",
// "30s", "85 red ball velo") — at most 3 parts. `valueOf` returns the logged
// value (done sets) or value-else-target (upcoming).
export function formatSetMetrics(
  metricFields: string[],
  valueOf: (metricId: string) => unknown,
  customMeasurements: Measurement[],
): string {
  const has = (v: unknown) => v != null && v !== '';
  const parts: string[] = [];
  const wr = formatWeightReps(
    metricFields.includes('weight') ? valueOf('weight') : null,
    metricFields.includes('reps') ? valueOf('reps') : null,
  );
  if (wr) parts.push(wr);
  for (const metricId of metricFields) {
    if (parts.length >= 3) break;
    if (metricId === 'weight' || metricId === 'reps') continue;
    const v = valueOf(metricId);
    if (!has(v)) continue;
    if (metricId === 'time_seconds') parts.push(`${v}s`);
    else if (metricId === 'distance') parts.push(`${v} ft`);
    else parts.push(`${v} ${getMetricLabel(metricId, customMeasurements).toLowerCase()}`);
  }
  return parts.join(' · ');
}

// The exercise table's columns: metricFieldsFor (enabled measurements) plus
// every metric the coach prescribed a value or % target for (metric_targets,
// set_configurations[n].metric_values / intensity_targets) — a Back Squat
// with enabled_measurements = [weight] still prescribes reps = 2 per set.
// Order: REPS first, then weight (LB), then the rest as metricFieldsFor had them.
export function tableFieldsFor(
  exercise: LoggerRoutineExercise,
  customMeasurements: Measurement[],
): string[] {
  const fields = [...metricFieldsFor(exercise, customMeasurements)];
  const add = (metric: string | null | undefined) => {
    if (metric && !fields.includes(metric)) fields.push(metric);
  };
  const hasValue = (v: unknown) => v != null && v !== '';
  for (const [k, v] of Object.entries(exercise.metric_targets ?? {})) if (hasValue(v)) add(k);
  for (const t of exercise.intensity_targets ?? []) add(t.metric);
  for (const sc of exercise.set_configurations ?? []) {
    for (const [k, v] of Object.entries(sc?.metric_values ?? {})) if (hasValue(v)) add(k);
    for (const t of sc?.intensity_targets ?? []) add(t.metric);
  }
  const rank = (m: string) => (m === 'reps' ? 0 : m === 'weight' ? 1 : 2);
  return fields
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map((x) => x.m);
}
