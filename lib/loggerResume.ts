/**
 * Resume rule for the workout logger: is a saved exercise_logs row a "done"
 * set? Only `is_complete === true`. Every legacy write path (old saveSetData,
 * quick-complete) wrote is_complete:true, so legacy rows still read as done;
 * is_complete:false rows are un-checks and v2 drafts (typed or auto-filled
 * values not logged yet), which must resume not-done with their values.
 */
export function isSetDoneFromLog(log: Record<string, any> | null | undefined): boolean {
  return log?.is_complete === true;
}

/**
 * A saved row's values in the logger's local field names (dedicated
 * actual_* columns → reps/weight/time_seconds/distance, custom metrics from
 * metric_data). Drafts keep their values on resume through this.
 */
export function logToSetInputs(log: Record<string, any>): Record<string, any> {
  return {
    reps: log.actual_reps,
    weight: log.actual_weight,
    time_seconds: log.actual_duration_seconds,
    distance: log.actual_distance,
    notes: log.notes,
    ...(log.metric_data || {}),
  };
}

/** A 0-based set index is within the exercise's prescribed sets. */
export function isValidSetIndex(setIndex: number, sets: number | null | undefined): boolean {
  return Number.isInteger(setIndex) && setIndex >= 0 && setIndex < (sets ?? 0);
}

/**
 * Reload overlay: this device's unsynced outbox rows for the workout win over
 * the server's rows for the same set (they are never older on one device);
 * server-only columns (id, rpe, ...) are kept. Snapshot `pending` BEFORE
 * fetching server logs — a flush landing in between then can't hide a row.
 */
export function mergeLogsWithPending(
  serverLogs: Record<string, any>[] | null | undefined,
  pending: Record<string, any>[],
  workoutInstanceId: string,
): Record<string, any>[] {
  const bySet = new Map<string, Record<string, any>>();
  (serverLogs || []).forEach(l => bySet.set(`${l.routine_exercise_id}:${l.set_number}`, l));
  pending
    .filter(r => r.workout_instance_id === workoutInstanceId)
    .forEach(r => {
      const k = `${r.routine_exercise_id}:${r.set_number}`;
      bySet.set(k, { ...bySet.get(k), ...r });
    });
  return Array.from(bySet.values());
}
