// "Restart from Beginning" / "Discard Progress" on a workout in progress.
// Clears everything this device holds for that ONE workout instance, so the
// logger opens fresh and nothing queued re-inserts a set afterwards:
//   - the logger outbox rows (unsynced sets / drafts) and a queued completion;
//   - the saved progress key (`workout_<id>`, elapsed time);
//   - rack / phone-direct (solo) set writes and reps queued for that instance.
// The rack: leave it first when the athlete is up or queued (rack_leave).
// Server: exercise_logs of the instance are deleted (as Discard always did).
// Server-side, deleting a set's exercise_logs row retires its vbt_reps.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { loggerOutbox } from './outbox';
import { pendingCompletions } from './pendingComplete';
import { removeQueued } from '../offline/queue';
import { REP_QUEUE_KEY, SET_QUEUE_KEY } from '../rack/persist';
import { SOLO_PERSIST_KEYS, soloPersistKeys } from '../rack/solo';

export const RESTART_CONFIRM = {
  title: 'Restart workout?',
  message: 'This clears every set you logged in this workout.',
  ok: 'Restart',
} as const;
export const DISCARD_CONFIRM = {
  title: 'Discard progress?',
  message: 'This clears every set you logged and marks the workout not started.',
  ok: 'Discard',
} as const;

export interface ResetDeps {
  /** supabase-like client (delete exercise_logs, rack_sessions read). */
  client: { from: (t: string) => any };
  /** rack_leave(rackId). */
  leaveRack: (rackId: string) => Promise<unknown>;
}

/** Device-side state of one workout instance (no server calls). */
export async function clearWorkoutLocalState(instanceId: string, athleteId: string | null): Promise<void> {
  const ofInstance = (i: { row?: { workout_instance_id?: string } }) => i?.row?.workout_instance_id === instanceId;
  const setKeys = [SET_QUEUE_KEY, SOLO_PERSIST_KEYS.sets, ...(athleteId ? [soloPersistKeys(athleteId).sets] : [])];
  // Queued reps too: a solo rep flushed after the reset would re-attach to it.
  const repKeys = [REP_QUEUE_KEY, SOLO_PERSIST_KEYS.reps, ...(athleteId ? [soloPersistKeys(athleteId).reps] : [])];
  const repOfInstance = (r: { workout_instance_id?: string | null }) => r?.workout_instance_id === instanceId;
  await Promise.all([
    loggerOutbox.drop(instanceId),
    pendingCompletions.clear(instanceId),
    AsyncStorage.removeItem(`workout_${instanceId}`),
    ...setKeys.map(k => removeQueued(k, ofInstance)),
    ...repKeys.map(k => removeQueued(k, repOfInstance)),
  ]);
}

/** Leave every rack this athlete is up on or queued on (the RLS-scoped rows are only theirs). */
export async function leaveMyRacks(athleteId: string, deps: ResetDeps): Promise<void> {
  try {
    const { data } = await deps.client
      .from('rack_sessions')
      .select('rack_id, active_athlete_id, queue')
      .or(`active_athlete_id.eq.${athleteId},queue.cs.{${athleteId}}`);
    for (const r of (data as { rack_id: string }[]) ?? []) {
      try {
        await deps.leaveRack(r.rack_id);
      } catch (e) {
        console.warn('[reset] rack_leave failed', e);
      }
    }
  } catch (e) {
    console.warn('[reset] rack read failed', e);
  }
}

/**
 * Restart / Discard: leave the rack, delete this instance's exercise_logs,
 * clear the device state. The caller sets the status (Restart keeps
 * in_progress; Discard → not_started) and navigates.
 */
export async function resetWorkout(instanceId: string, athleteId: string | null, deps: ResetDeps): Promise<{ ok: boolean }> {
  if (athleteId) await leaveMyRacks(athleteId, deps);
  // Local first: nothing queued may re-insert a set after the delete.
  await clearWorkoutLocalState(instanceId, athleteId);
  const { error } = await deps.client.from('exercise_logs').delete().eq('workout_instance_id', instanceId);
  if (error) console.error('[reset] exercise_logs delete failed', error);
  return { ok: !error };
}
