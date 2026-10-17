// Phone-side read of the rack's reps: a realtime subscription on vbt_reps for
// one athlete. Reps are grouped per set, key `${workoutInstance}:${routineExercise}:${setNumber}`
// (free reps group under `free:${rackId ?? 'solo'}`), deduped by client_rep_id
// and ordered by rep_index. The callback gets the set the newest rep belongs to.

import { supabase } from '../supabase';

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
  const channel = client
    .channel(`vbt_reps:${athleteId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'vbt_reps', filter: `athlete_id=eq.${athleteId}` },
      (payload: { new?: any }) => {
        const set = addRepRow(sets, payload.new);
        if (set) onSet(set, sets);
      },
    )
    .subscribe();
  return {
    sets: () => sets,
    chipsFor: (wi, re, n) => sets.get(chipKey(wi, re, n))?.chips ?? [],
    unsubscribe: () => {
      client.removeChannel(channel);
    },
  };
}
