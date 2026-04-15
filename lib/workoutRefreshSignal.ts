/**
 * Tiny module-level flag used to signal that the dashboard's workout list
 * is stale and must be refetched on next focus, bypassing the 30s throttle.
 *
 * Set by WorkoutLoggerScreen after a successful complete/exit write.
 * Consumed (and cleared) by DashboardScreen's useFocusEffect.
 */

let dirty = false;

export function markWorkoutListDirty() {
  dirty = true;
}

export function consumeWorkoutListDirty(): boolean {
  const wasDirty = dirty;
  dirty = false;
  return wasDirty;
}
