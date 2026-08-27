/**
 * Formats exercise metrics for display in a consistent, compact format.
 * React Native version — mirrors lib/format-exercise-metrics.ts on web.
 *
 * Nuances this must never drop: rep ranges ("8-10"), AMRAP (whole exercise
 * or one set), time/distance as themselves (not "30 Reps"), "% of Set N"
 * wave loading, "% of <other exercise>", per-set weights, paired-measurement
 * secondary values. Set positions are preserved ("5, —, 1"), never
 * collapsed by dropping blanks.
 */

interface CustomMeasurement {
  id: string;
  name: string;
  category?: 'single' | 'paired' | string;
  primary_metric_id?: string | null;
  primary_metric_name?: string | null;
  primary_metric_type?: string | null;
  secondary_metric_id?: string | null;
  secondary_metric_name?: string | null;
  secondary_metric_type?: string | null;
}

export interface FormatterIntensityTarget {
  metric: string;
  percent: number;
  relative_to?: 'max' | 'set' | string | null;
  reference_set?: number | null;
  source_exercise_name?: string | null;
}

interface FormatExerciseMetricsOptions {
  exercise: {
    enabled_measurements?: string[] | null;
    metric_targets?: Record<string, any> | null;
    set_configurations?: Array<{
      metric_values?: Record<string, any> | null;
      is_amrap?: boolean | null;
      intensity_targets?: FormatterIntensityTarget[] | null;
    }> | null;
    intensity_targets?: FormatterIntensityTarget[] | null;
    tracked_max_metrics?: string[] | null;
    is_amrap?: boolean | null;
    sets?: number | null;
    reps_min?: number | null;
    reps_max?: number | null;
    time_seconds?: number | null;
    rest_seconds?: number | null;
    tempo?: string | null;
    rpe_target?: number | null;
    // legacy
    reps?: string;
    weight?: string;
  };
  customMeasurements: CustomMeasurement[];
  separator?: string;
}

// ─── helpers ────────────────────────────────────────────────────────

function findMeasurement(key: string, customMeasurements: CustomMeasurement[]) {
  return (
    customMeasurements.find((m) => m.primary_metric_id === key || m.secondary_metric_id === key) ||
    customMeasurements.find((m) => m.id === key)
  );
}

function isTimeMetric(key: string, measurement?: CustomMeasurement): boolean {
  if (key === 'time' || key.toLowerCase().endsWith('_time')) return true;
  if (!measurement) return false;
  const type = measurement.primary_metric_id === key ? measurement.primary_metric_type : measurement.secondary_metric_type;
  return type === 'time';
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return String(seconds);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function unitFor(key: string, measurement?: CustomMeasurement): string {
  if (key === 'reps' || key.toLowerCase().endsWith('_reps')) return '';
  if (key === 'weight') return ' lbs';
  if (key === 'distance') return ' ft';
  if (!measurement) return '';
  const raw = measurement.primary_metric_id === key ? measurement.primary_metric_name : measurement.secondary_metric_name;
  if (!raw || raw === measurement.name || /^[0:]+$/.test(raw) || raw.length > 8) return '';
  return ` ${raw}`;
}

export function formatMetricValue(key: string, value: any, customMeasurements: CustomMeasurement[]): string {
  if (value == null || value === '') return '—';
  if (value === 'AMRAP') return 'AMRAP';
  const measurement = findMeasurement(key, customMeasurements);
  if (isTimeMetric(key, measurement)) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? formatSeconds(n) : String(value);
  }
  return `${value}${unitFor(key, measurement)}`;
}

export function formatRepRange(ex: { reps_min?: number | null; reps_max?: number | null }): string | null {
  if (ex.reps_min == null || ex.reps_max == null || ex.reps_min === ex.reps_max) return null;
  return `${ex.reps_min}-${ex.reps_max}`;
}

/** "90% of Set 1" | "60% of Bench Press" | "80%" | "" */
export function describeIntensity(t: FormatterIntensityTarget | null | undefined): string {
  if (!t || typeof t.percent !== 'number' || !(t.percent > 0)) return '';
  if (t.relative_to === 'set' && t.reference_set) return `${t.percent}% of Set ${t.reference_set}`;
  if (t.source_exercise_name) return `${t.percent}% of ${t.source_exercise_name}`;
  return `${t.percent}%`;
}

function collapse(cells: string[], gap = '—'): string {
  const filled = cells.map((c) => c || gap);
  if (!filled.some((c) => c !== gap)) return '';
  return filled.every((c) => c === filled[0]) ? filled[0] : filled.join(', ');
}

// ─── entry point ────────────────────────────────────────────────────

export function formatExerciseMetrics(options: FormatExerciseMetricsOptions): string {
  const { exercise, customMeasurements, separator = ' • ' } = options;

  const summaries: string[] = [];
  const setConfigs = exercise.set_configurations || [];
  const hasSetConfigurations = setConfigs.length > 0;
  const metricTargets = exercise.metric_targets || {};
  const hasMetricTargets = Object.keys(metricTargets).length > 0;
  const range = formatRepRange(exercise);

  // Fallback to legacy reps/weight if no modern metrics configured
  if (!hasSetConfigurations && !hasMetricTargets) {
    if (exercise.sets && exercise.reps) {
      return `${exercise.sets} × ${exercise.reps}${exercise.weight ? ` @ ${exercise.weight}` : ''}`;
    }
    const bits: string[] = [];
    if (exercise.is_amrap) bits.push('AMRAP');
    else if (range) bits.push(`Reps (${range})`);
    if (exercise.time_seconds) bits.push(`Time (${formatSeconds(exercise.time_seconds)})`);
    return bits.join(separator);
  }

  // Group metrics by measurement — prioritize enabled_measurements
  const measurementGroups: Record<string, { primary?: string; secondary?: string; measurement: CustomMeasurement | null }> = {};

  if (exercise.enabled_measurements && exercise.enabled_measurements.length > 0) {
    exercise.enabled_measurements.forEach((measurementId: string) => {
      const measurement = customMeasurements.find((m) => m.id === measurementId);
      if (measurement) {
        measurementGroups[measurement.id] = {
          measurement,
          primary: measurement.primary_metric_id || undefined,
          secondary: measurement.secondary_metric_id || undefined,
        };
      } else {
        // Built-in id (reps/weight/time/distance) used directly
        measurementGroups[measurementId] = { measurement: null, primary: measurementId };
      }
    });
  } else {
    const allMetricKeys = new Set<string>();
    if (hasSetConfigurations) {
      setConfigs.forEach((setConfig) => {
        if (setConfig.metric_values) Object.keys(setConfig.metric_values).forEach((key) => allMetricKeys.add(key));
      });
    } else {
      Object.keys(metricTargets).forEach((key) => allMetricKeys.add(key));
    }
    Array.from(allMetricKeys).forEach((key) => {
      const measurement = findMeasurement(key, customMeasurements);
      if (measurement) {
        if (!measurementGroups[measurement.id]) measurementGroups[measurement.id] = { measurement };
        if (measurement.primary_metric_id === key) measurementGroups[measurement.id].primary = key;
        else if (measurement.secondary_metric_id === key) measurementGroups[measurement.id].secondary = key;
        else measurementGroups[measurement.id].primary = key;
      } else {
        measurementGroups[key] = { measurement: null, primary: key };
      }
    });
  }

  Object.entries(measurementGroups).forEach(([, group]) => {
    const { primary, secondary, measurement } = group;
    if (!primary) return;
    const measurementName =
      measurement?.name || (primary === 'reps' ? 'Reps' : primary === 'weight' ? 'Weight' : primary === 'time' ? 'Time' : primary === 'distance' ? 'Distance' : primary);
    const isReps = primary === 'reps' || primary.toLowerCase().endsWith('_reps');

    // AMRAP: any per-set flag, or the exercise-level flag
    const hasAMRAP = isReps && (hasSetConfigurations ? setConfigs.some((s) => s.is_amrap) || !!exercise.is_amrap : !!exercise.is_amrap);

    // Primary values — keep set positions ("5, —, 1"), never drop blanks.
    let primaryDisplay = '';
    if (hasSetConfigurations) {
      const cells = setConfigs.map((s) => {
        if (isReps && (s.is_amrap || (exercise.is_amrap && s.metric_values?.[primary] == null))) return 'AMRAP';
        const v = s.metric_values?.[primary];
        if (v == null || v === '') return isReps && range ? range : '';
        return formatMetricValue(primary, v, customMeasurements);
      });
      primaryDisplay = collapse(cells);
    } else {
      const raw = metricTargets[primary];
      if (isReps && range) primaryDisplay = range;
      else if (raw != null && raw !== '' && raw !== 0) primaryDisplay = formatMetricValue(primary, raw, customMeasurements);
    }

    if (!primaryDisplay && !hasAMRAP) return;

    // Intensity — secondary metric first (ball velo), then primary. Per-set
    // cells carry "of Set 1" / "of <exercise>".
    let intensityDisplay = '';
    const metricsToCheck = [secondary, primary].filter(Boolean) as string[];
    if (hasSetConfigurations) {
      for (const metricId of metricsToCheck) {
        const cells = setConfigs.map((s) => describeIntensity(s.intensity_targets?.find((t) => t.metric === metricId)));
        const collapsed = collapse(cells);
        if (collapsed) {
          intensityDisplay = ` @ ${collapsed}`;
          break;
        }
      }
    } else if (exercise.intensity_targets) {
      for (const metricId of metricsToCheck) {
        const d = describeIntensity(exercise.intensity_targets.find((t) => t.metric === metricId));
        if (d) {
          intensityDisplay = ` @ ${d}`;
          break;
        }
      }
    }

    // Secondary value (MPH etc.) — shown alongside intensity, not suppressed by it
    let secondaryDisplay = '';
    if (secondary) {
      if (hasSetConfigurations) {
        const cells = setConfigs.map((s) => {
          const v = s.metric_values?.[secondary];
          return v == null || v === '' ? '' : formatMetricValue(secondary, v, customMeasurements);
        });
        const collapsed = collapse(cells);
        if (collapsed) secondaryDisplay = ` (${collapsed})`;
      } else if (metricTargets[secondary] != null && metricTargets[secondary] !== '') {
        secondaryDisplay = ` (${formatMetricValue(secondary, metricTargets[secondary], customMeasurements)})`;
      }
    }

    let displayText: string;
    if (hasAMRAP) {
      const alreadyHasAMRAP = primaryDisplay.includes('AMRAP');
      if (!primaryDisplay) displayText = `${measurementName} (AMRAP)${intensityDisplay}${secondaryDisplay}`;
      else if (alreadyHasAMRAP) displayText = `${measurementName} (${primaryDisplay})${intensityDisplay}${secondaryDisplay}`;
      else displayText = `${measurementName} (${primaryDisplay} AMRAP)${intensityDisplay}${secondaryDisplay}`;
    } else {
      displayText = `${measurementName} (${primaryDisplay})${intensityDisplay}${secondaryDisplay}`;
    }
    summaries.push(displayText);
  });

  if (exercise.time_seconds && !('time' in metricTargets) && !hasSetConfigurations) {
    summaries.push(`Time (${formatSeconds(exercise.time_seconds)})`);
  }

  // Prepend the set count to each measurement line ("3 × Reps (5)").
  const setCount = (hasSetConfigurations && setConfigs.length) || exercise.sets || 0;
  if (setCount > 0 && summaries.length > 0) {
    return summaries.map((s) => `${setCount} × ${s}`).join(separator);
  }

  return summaries.join(separator);
}

/** "RPE 8 · Tempo 3-1-2-0 · Rest 1:30" — empty when none apply. */
export function formatPrescriptionExtras(
  exercise: { rpe_target?: number | null; tempo?: string | null; rest_seconds?: number | null } | null | undefined,
  separator = ' · '
): string {
  if (!exercise) return '';
  const parts: string[] = [];
  if (exercise.rpe_target != null) parts.push(`RPE ${exercise.rpe_target}`);
  if (exercise.tempo) parts.push(`Tempo ${exercise.tempo}`);
  if (exercise.rest_seconds) parts.push(`Rest ${formatSeconds(exercise.rest_seconds)}`);
  return parts.join(separator);
}

/**
 * Format simple sets × reps display
 */
export function formatSetsAndReps(sets: number, reps: string | number, weight?: string | number): string {
  let display = `${sets} × ${reps}`;
  if (weight) {
    display += ` @ ${weight}`;
  }
  return display;
}
