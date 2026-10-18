// Phone-side read of the rack's reps: a realtime subscription on vbt_reps for
// one athlete. Reps are grouped per set, key `${workoutInstance}:${routineExercise}:${setNumber}`
// (free reps group under `free:${rackId ?? 'solo'}`), deduped by client_rep_id
// and ordered by rep_index. The callback gets the set the newest rep belongs to.
// UPDATEs count too: a removed rep (removed_at) leaves its set, a moved one
// (rack_move_set) changes set; a backfill REBUILDS the map from the server.

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

/** Drop one rep from every set (removed, or moved to another set). Returns the set it left. */
export function dropRepRow(sets: Map<string, ChipSet>, clientRepId: string, exceptKey: string | null = null): ChipSet | null {
  let left: ChipSet | null = null;
  for (const [k, set] of sets) {
    if (k === exceptKey || !set.chips.some(c => c.clientRepId === clientRepId)) continue;
    const next = { ...set, chips: set.chips.filter(c => c.clientRepId !== clientRepId) };
    sets.set(k, next);
    left = next;
  }
  return left;
}

/**
 * Pure reducer used by the subscription: add (or update) one vbt_reps row.
 * A removed rep (removed_at set) is taken out; a rep whose set changed
 * (rack_move_set) moves to its new set.
 */
export function addRepRow(sets: Map<string, ChipSet>, row: any): ChipSet | null {
  if (!row || typeof row.client_rep_id !== 'string') return null;
  if (row.removed_at) return dropRepRow(sets, row.client_rep_id);
  const key = chipKey(row.workout_instance_id ?? null, row.routine_exercise_id ?? null, row.set_number ?? null, row.rack_id ?? null);
  dropRepRow(sets, row.client_rep_id, key);
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
  /** Re-read today's reps (a dropped socket loses INSERT events). */
  backfill: () => Promise<void>;
  unsubscribe: () => void;
}

export function subscribeMyRack(
  athleteId: string,
  onSet: (current: ChipSet, all: Map<string, ChipSet>) => void,
  client: any = supabase,
): MyRackSubscription {
  const sets = new Map<string, ChipSet>();
  let closed = false;
  /** Realtime rows seen while a backfill read is in flight (re-applied on top of it). */
  let during: any[] | null = null;
  const push = (row: any) => {
    if (during) during.push(row);
    const set = addRepRow(sets, row);
    if (set && !closed) onSet(set, sets);
  };
  // Today's rows for the athlete (reps written while this phone wasn't
  // connected; removals / moves it missed): the map is REBUILT from them.
  const backfill = async () => {
    const mine: any[] = [];
    during = mine;
    try {
      const since = new Date(`${todayKey()}T00:00:00`).toISOString();
      const { data, error } = await client
        .from('vbt_reps')
        .select('client_rep_id, rack_id, workout_instance_id, routine_exercise_id, set_number, rep_index, load_lb, mean_velocity, peak_velocity, rom_in, is_partial, received_at')
        .eq('athlete_id', athleteId)
        .is('removed_at', null)
        .gte('received_at', since)
        .order('received_at', { ascending: true });
      if (error) throw error;
      const fresh = new Map<string, ChipSet>();
      for (const row of (data as any[]) ?? []) addRepRow(fresh, row);
      for (const row of mine) addRepRow(fresh, row);
      sets.clear();
      fresh.forEach((v, k) => sets.set(k, v));
      if (!closed) {
        const any = sets.values().next().value as ChipSet | undefined;
        onSet(any ?? { key: '', workoutInstanceId: null, routineExerciseId: null, setNumber: null, chips: [] }, sets);
      }
    } catch (e) {
      console.warn('[rack phone] backfill failed', e);
    } finally {
      if (during === mine) during = null;
    }
  };
  const channel = client
    .channel(uniqueTopic(`vbt_reps:${athleteId}`))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'vbt_reps', filter: `athlete_id=eq.${athleteId}` },
      (payload: { new?: any }) => push(payload.new),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'vbt_reps', filter: `athlete_id=eq.${athleteId}` },
      (payload: { new?: any }) => push(payload.new),
    )
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') backfill();
    });
  return {
    sets: () => sets,
    chipsFor: (wi, re, n) => sets.get(chipKey(wi, re, n))?.chips ?? [],
    backfill,
    unsubscribe: () => {
      closed = true;
      client.removeChannel(channel);
    },
  };
}
