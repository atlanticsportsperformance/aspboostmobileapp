/**
 * Resume rule for the workout logger: is a saved exercise_logs row a "done"
 * set? `is_complete` is authoritative when true (quick-complete and Log Set
 * with no values write value-less is_complete rows); any logged value also
 * counts, for legacy rows written before is_complete was reliable.
 */
export function isSetDoneFromLog(log: Record<string, any> | null | undefined): boolean {
  if (!log) return false;
  if (log.is_complete === true) return true;
  const values: Record<string, any> = {
    reps: log.actual_reps,
    weight: log.actual_weight,
    time_seconds: log.actual_duration_seconds,
    distance: log.actual_distance,
    ...(log.metric_data || {}),
  };
  return Object.keys(values).some(
    key => key !== 'notes' && values[key] != null && values[key] !== '',
  );
}

/** A 0-based set index is within the exercise's prescribed sets. */
export function isValidSetIndex(setIndex: number, sets: number | null | undefined): boolean {
  return Number.isInteger(setIndex) && setIndex >= 0 && setIndex < (sets ?? 0);
}
