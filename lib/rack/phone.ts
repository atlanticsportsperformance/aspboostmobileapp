// Phone-side read of the rack's reps: a realtime subscription on vbt_reps for
// one athlete. Reps are grouped per set, key `${workoutInstance}:${routineExercise}:${setNumber}`
// (free reps group under `free:${rackId ?? 'solo'}`), deduped by client_rep_id
// and ordered by rep_index. The callback gets the set the newest rep belongs to.

import { supabase } from '../supabase';
import { todayKey } from './api';

let topicSeq = 0;
/**
 * A realtime topic unique to one subscription. realtime-js `channel(topic)`
 * returns the EXISTING channel for a repeated topic — a second subscriber
 * would then never get events, and the first one's removeChannel would kill
 * both. Every subscription gets its own suffix and removes only its channel.
 */
export function uniqueTopic(base: string): string {
  topicSeq += 1;
  return `${base}:${topicSeq.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface RepChip {
  clientRepId: string;
  repIndex: number;
  v: number;
  pv: number;
  rom: number;
  partial: boolean;
  loadLb: number | null;
  receivedAt: string;
}

export interface ChipSet {
  key: string;
  workoutInstanceId: string | null;
  routineExerciseId: string | null;
  setNumber: number | null;
  chips: RepChip[];
}

export function chipKey(
  workoutInstanceId: string | null,
  routineExerciseId: string | null,
  setNumber: number | null,
  rackId: string | null = null,
): string {
  if (!workoutInstanceId || !routineExerciseId) return `free:${rackId ?? 'solo'}`;
  return `${workoutInstanceId}:${routineExerciseId}:${setNumber ?? 'null'}`;
}

/** Pure reducer used by the subscription: add one vbt_reps row. */
export function addRepRow(sets: Map<string, ChipSet>, row: any): ChipSet | null {
  if (!row || typeof row.client_rep_id !== 'string') return null;
  const key = chipKey(row.workout_instance_id ?? null, row.routine_exercise_id ?? null, row.set_number ?? null, row.rack_id ?? null);
  const set: ChipSet = sets.get(key) ?? {
    key,
    workoutInstanceId: row.workout_instance_id ?? null,
    routineExerciseId: row.routine_exercise_id ?? null,
    setNumber: row.set_number ?? null,
    chips: [],
  };
  if (!set.chips.some(c => c.clientRepId === row.client_rep_id)) {
    const chip: RepChip = {
      clientRepId: row.client_rep_id,
      repIndex: Number(row.rep_index),
      v: Number(row.mean_velocity),
      pv: Number(row.peak_velocity),
      rom: Number(row.rom_in),
      partial: row.is_partial === true,
      loadLb: row.load_lb == null ? null : Number(row.load_lb),
      receivedAt: row.received_at,
    };
    set.chips = [...set.chips, chip].sort((a, b) => a.repIndex - b.repIndex);
  }
  sets.set(key, set);
  return set;
}

export interface MyRackSubscription {
  /** Every set seen since subscribing, by chipKey. */
  sets: () => Map<string, ChipSet>;
  /** Chips of one set (empty when none yet). */
  chipsFor: (workoutInstanceId: string, routineExerciseId: string, setNumber: number) => RepChip[];
  unsubscribe: () => void;
}

export function subscribeMyRack(
  athleteId: string,
  onSet: (current: ChipSet, all: Map<string, ChipSet>) => void,
  client: any = supabase,
): MyRackSubscription {
  const sets = new Map<string, ChipSet>();
  let closed = false;
  const push = (row: any) => {
    const set = addRepRow(sets, row);
    if (set && !closed) onSet(set, sets);
  };
  // Reps written while this phone wasn't connected: today's rows for the
  // athlete, replayed through the same reducer (deduped by client_rep_id).
  const backfill = async () => {
    try {
      const since = new Date(`${todayKey()}T00:00:00`).toISOString();
      const { data, error } = await client
        .from('vbt_reps')
        .select('client_rep_id, rack_id, workout_instance_id, routine_exercise_id, set_number, rep_index, load_lb, mean_velocity, peak_velocity, rom_in, is_partial, received_at')
        .eq('athlete_id', athleteId)
        .gte('received_at', since)
        .order('received_at', { ascending: true });
      if (error) throw error;
      for (const row of (data as any[]) ?? []) push(row);
    } catch (e) {
      console.warn('[rack phone] backfill failed', e);
    }
  };
  const channel = client
    .channel(uniqueTopic(`vbt_reps:${athleteId}`))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'vbt_reps', filter: `athlete_id=eq.${athleteId}` },
      (payload: { new?: any }) => push(payload.new),
    )
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') backfill();
    });
  return {
    sets: () => sets,
    chipsFor: (wi, re, n) => sets.get(chipKey(wi, re, n))?.chips ?? [],
    unsubscribe: () => {
      closed = true;
      client.removeChannel(channel);
    },
  };
}
