// "Complete workout" intents that could not reach the server (offline). The
// athlete is never blocked at Finish: the intent is queued here and replayed
// by the app-level foreground sync (hooks/useOutboxForegroundSync.ts), after
// the set outbox has flushed.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { markWorkoutListDirty } from '../workoutRefreshSignal';

export const PENDING_COMPLETE_KEY = 'logger_pending_complete_v1';

export type PendingComplete = {
  workoutInstanceId: string;
  completedAt: string;
  // Absent when the athlete skipped (or was never asked) — column untouched.
  sessionRpe?: number;
};

type Result = { error: { message: string } | null };

// status/completed_at plus session_rpe only when a number was chosen.
export function completionPatch(p: PendingComplete): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: 'completed', completed_at: p.completedAt };
  if (p.sessionRpe != null) patch.session_rpe = p.sessionRpe;
  return patch;
}

export async function sendCompletion(p: PendingComplete): Promise<Result> {
  try {
    const { error } = await supabase
      .from('workout_instances')
      .update(completionPatch(p))
      .eq('id', p.workoutInstanceId);
    return { error: error ? { message: error.message } : null };
  } catch (e: any) {
    return { error: { message: e?.message || 'network error' } };
  }
}

async function readAll(): Promise<PendingComplete[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_COMPLETE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function queueCompletion(p: PendingComplete): Promise<void> {
  try {
    const rest = (await readAll()).filter(x => x.workoutInstanceId !== p.workoutInstanceId);
    await AsyncStorage.setItem(PENDING_COMPLETE_KEY, JSON.stringify([...rest, p]));
  } catch (e) {
    console.error('[pendingComplete] queue failed', e);
  }
}

// Replays queued completions; keeps the ones that still fail.
export async function flushPendingCompletions(): Promise<number> {
  const all = await readAll();
  if (all.length === 0) return 0;
  const sentKeys = new Set<string>();
  for (const p of all) {
    const { error } = await sendCompletion(p);
    if (!error) sentKeys.add(`${p.workoutInstanceId}|${p.completedAt}`);
  }
  if (sentKeys.size === 0) return 0;
  try {
    // Re-read so intents queued while we were sending aren't lost.
    const latest = await readAll();
    const next = latest.filter(l => !sentKeys.has(`${l.workoutInstanceId}|${l.completedAt}`));
    await AsyncStorage.setItem(PENDING_COMPLETE_KEY, JSON.stringify(next));
  } catch (e) {
    console.error('[pendingComplete] persist failed', e);
  }
  markWorkoutListDirty();
  return sentKeys.size;
}
