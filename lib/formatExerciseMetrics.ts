/**
 * Formats exercise metrics for display in a consistent, compact format
 * React Native version - adapted from web app
 */

interface CustomMeasurement {
  id: string;
  name: string;
  category: 'single' | 'paired';
  primary_metric_id?: string;
  primary_metric_name?: string;
  primary_metric_type?: string;
  secondary_metric_id?: string;
  secondary_metric_name?: string;
  secondary_metric_type?: string;
}

interface FormatExerciseMetricsOptions {
  exercise: {
    enabled_measurements?: string[];
    metric_targets?: Record<string, any>;
    set_configurations?: Array<{
      metric_values?: Record<string, any>;
      is_amrap?: boolean;
      intensity_targets?: Array<{
        metric: string;
        percent: number;
      }>;
    }>;
    intensity_targets?: Array<{
      metric: string;
      percent: number;
    }>;
    tracked_max_metrics?: string[];
    is_amrap?: boolean;
    sets?: number;
    reps?: string;
    weight?: string;
  };
  customMeasurements: CustomMeasurement[];
  separator?: string;
}

export function formatExerciseMetrics(options: FormatExerciseMetricsOptions): string {
  const { exercise, customMeasurements, separator = ' • ' } = options;

  const summaries: string[] = [];

  // Check if we have per-set or simple mode
  const hasSetConfigurations = exercise.set_configurations && exercise.set_configurations.length > 0;
  const hasMetricTargets = exercise.metric_targets && Object.keys(exercise.metric_targets).length > 0;

  // Fallback to legacy reps/weight if no modern metrics configured
  if (!hasSetConfigurations && !hasMetricTargets) {
    if (exercise.sets && exercise.reps) {
      return `${exercise.sets} × ${exercise.reps}${exercise.weight ? ` @ ${exercise.weight}` : ''}`;
    }
    return '';
  }

  // Group metrics by measurement - prioritize enabled_measurements
  const measurementGroups: Record<string, { primary?: string; secondary?: string; measurement: any }> = {};

  if (exercise.enabled_measurements && exercise.enabled_measurements.length > 0) {
    // Use enabled_measurements array to group properly
    exercise.enabled_measurements.forEach((measurementId: string) => {
      const measurement = customMeasurements.find(m => m.id === measurementId);

      if (measurement) {
        measurementGroups[measurement.id] = {
          measurement,
          primary: measurement.primary_metric_id,
          secondary: measurement.secondary_metric_id
        };
      }
    });
  } else {
    // Fallback: collect all metric keys and try to group them
    const allMetricKeys = new Set<string>();
    if (hasSetConfigurations) {
      exercise.set_configurations.forEach((setConfig) => {
        if (setConfig.metric_values) {
          Object.keys(setConfig.metric_values).forEach(key => allMetricKeys.add(key));
        }
      });
    } else if (hasMetricTargets) {
      Object.keys(exercise.metric_targets).forEach(key => allMetricKeys.add(key));
    }

    Array.from(allMetricKeys).forEach((key: string) => {
      let measurement = customMeasurements.find(m =>
        m.primary_metric_id === key || m.secondary_metric_id === key
      );

      if (!measurement) {
        measurement = customMeasurements.find(m => m.id === key);
      }

      if (measurement) {
        if (!measurementGroups[measurement.id]) {
          measurementGroups[measurement.id] = { measurement };
        }

        if (measurement.primary_metric_id === key) {
          measurementGroups[measurement.id].primary = key;
        } else if (measurement.secondary_metric_id === key) {
          measurementGroups[measurement.id].secondary = key;
        } else {
          measurementGroups[measurement.id].primary = key;
        }
      } else {
        measurementGroups[key] = { measurement: null, primary: key };
      }
    });
  }

  // Build display for each measurement group
  Object.entries(measurementGroups).forEach(([measurementId, group]) => {
    const { primary, secondary, measurement } = group;
    const measurementName = measurement?.name || (primary === 'reps' ? 'Reps' : primary === 'weight' ? 'Weight' : primary);

    // Check for AMRAP
    let hasAMRAP = false;
    if (hasSetConfigurations) {
      hasAMRAP = exercise.set_configurations!.some(s => s.is_amrap);
    } else {
      hasAMRAP = !!exercise.is_amrap;
    }

    // Get primary metric values (reps)
    let primaryValues: (string | number)[] = [];
    if (hasSetConfigurations && primary) {
      primaryValues = exercise.set_configurations!
        .map((s, idx) => {
          if (primary === 'reps' && s.is_amrap) {
            return 'AMRAP';
          }
          return s.metric_values?.[primary] || 0;
        })
        .filter(v => v != null && v !== '' && v !== 0);
    } else if (primary && exercise.metric_targets?.[primary]) {
      const targetValue = exercise.metric_targets[primary];
      if (targetValue != null && targetValue !== '' && targetValue !== 0) {
        primaryValues = [targetValue];
      }
    }

    if (primaryValues.length === 0 && !(hasAMRAP && primary === 'reps')) return;

    const allSame = primaryValues.every(v => v === primaryValues[0]);
    const primaryDisplay = allSame ? String(primaryValues[0]) : primaryValues.join(', ');

    // PR tracking is now shown separately next to exercise name, not in metrics string

    // Check for intensity - try secondary metric first, then primary, then any metric in this measurement
    let intensityDisplay = '';
    const metricsToCheck = [secondary, primary].filter(Boolean) as string[];

    if (exercise.set_configurations && exercise.set_configurations.length > 0) {
      // Try each metric until we find intensity targets
      for (const metricId of metricsToCheck) {
        const intensityPercents = exercise.set_configurations
          .map(set => set.intensity_targets?.find(t => t.metric === metricId)?.percent)
          .filter(p => p != null && p! > 0);

        if (intensityPercents.length > 0) {
          const allSame = intensityPercents.every(p => p === intensityPercents[0]);
          if (allSame) {
            intensityDisplay = ` @${intensityPercents[0]}%`;
          } else {
            intensityDisplay = ` @${intensityPercents.map(p => `${p}%`).join(', @')}`;
          }
          break; // Found intensity, stop looking
        }
      }
    } else if (exercise.intensity_targets) {
      // Fallback to old intensity_targets format
      for (const metricId of metricsToCheck) {
        const intensityPercent = exercise.intensity_targets?.find((t) => t.metric === metricId)?.percent;
        if (intensityPercent && intensityPercent > 0) {
          intensityDisplay = ` @${intensityPercent}%`;
          break;
        }
      }
    }

    // Get secondary metric value
    let secondaryDisplay = '';
    if (!intensityDisplay && secondary) {
      if (hasSetConfigurations) {
        const secondaryValues = exercise.set_configurations!
          .map((s) => s.metric_values?.[secondary] || 0)
          .filter(v => v > 0);
        if (secondaryValues.length > 0) {
          const secondaryValuesDisplay = secondaryValues.length > 1 ? secondaryValues.join(', ') : secondaryValues[0];
          secondaryDisplay = ` (${secondaryValuesDisplay} ${measurement?.secondary_metric_name || 'MPH'})`;
        }
      } else if (exercise.metric_targets?.[secondary]) {
        secondaryDisplay = ` (${exercise.metric_targets[secondary]} ${measurement?.secondary_metric_name || 'MPH'})`;
      }
    }

    // Build display text
    let displayText = '';
    if (hasAMRAP && primary === 'reps') {
      const alreadyHasAMRAP = String(primaryDisplay).includes('AMRAP');

      if (primaryValues.length === 0) {
        displayText = `${measurementName} (AMRAP)${intensityDisplay}${secondaryDisplay}`;
      } else if (alreadyHasAMRAP) {
        const repsLabel = hasSetConfigurations ? '' : ' Reps';
        displayText = `${measurementName} (${primaryDisplay}${repsLabel})${intensityDisplay}${secondaryDisplay}`;
      } else {
        const repsLabel = hasSetConfigurations ? '' : ' Reps';
        displayText = `${measurementName} (${primaryDisplay}${repsLabel} AMRAP)${intensityDisplay}${secondaryDisplay}`;
      }
    } else {
      const repsLabel = hasSetConfigurations ? '' : ' Reps';
      displayText = `${measurementName} (${primaryDisplay}${repsLabel})${intensityDisplay}${secondaryDisplay}`;
    }
    summaries.push(displayText);
  });

  return summaries.join(separator);
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
