// Rack VBT data access: typed wrappers over the rack RPCs (migrations
// 20261018090000/100000/110000 in the web repo) plus the reads the rack iPad
// needs (racks, today's athletes + remaining exercises, today's written sets).
//
// Every rack_* RPC that changes the session returns the `rack_sessions` row;
// the caller feeds it to the engine as `sessionSync`. Errors are thrown as
// RackRpcError (code/status kept so callers can tell refused vs unreachable).

import { supabase } from '../supabase';
import { toLocalDateKey } from '../coachDates';
import type { RackSessionRow } from './engine';

// Minimal structural slice of SupabaseClient the rack code uses (mockable).
export type RackClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: any; status?: number }>;
  from: (table: string) => any;
};

export class RackRpcError extends Error {
  code?: string;
  status?: number;
  constructor(fn: string, error: any, status?: number) {
    super(`${fn}: ${error?.message ?? String(error)}`);
    this.name = 'RackRpcError';
    this.code = typeof error?.code === 'string' ? error.code : undefined;
    this.status = status;
  }
}

export interface RackListItem {
  rackId: string;
  name: string;
  activeAthleteFirstName: string | null;
  state: string;
  /** 1-based; null when the caller is not queued. */
  queuePositionOfCaller: number | null;
}

export interface Rack {
  id: string;
  orgId: string;
  name: string;
  ovrDeviceName: string | null;
  active: boolean;
}

export interface TodayExercise {
  routineExerciseId: string;
  exerciseId: string;
  name: string;
  /** Prescribed sets (null = not prescribed). */
  sets: number | null;
  /** Sets already completed today. */
  completedSets: number;
  zoneMin: number | null;
  zoneMax: number | null;
  dropStopPct: number | null;
}

export interface TodayAthlete {
  athleteId: string;
  firstName: string;
  lastName: string;
  workoutInstanceId: string;
  /** Remaining exercises of today's workout, in workout order. */
  remaining: TodayExercise[];
  /** Every (non-placeholder) exercise of the workout, in order (for contextMeta). */
  exercises: TodayExercise[];
}

export interface WrittenSet {
  athleteId: string;
  workoutInstanceId: string;
  routineExerciseId: string;
  /** Highest set_number already written today for this (athlete, wi, re). */
  setNumber: number;
}

/** Org-local "today" — same clock as the coach/logger screens (device-local key). */
export function todayKey(now: Date = new Date()): string {
  return toLocalDateKey(now);
}

export function createRackApi(client: RackClient = supabase as unknown as RackClient) {
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let res: { data: unknown; error: any; status?: number };
    try {
      res = await client.rpc(fn, args);
    } catch (error) {
      throw new RackRpcError(fn, error);
    }
    if (res.error) throw new RackRpcError(fn, res.error, res.status);
    return res.data as T;
  }
  const session = (fn: string, args: Record<string, unknown>) => call<RackSessionRow>(fn, args);

  return {
    // ---- phone (athlete) RPCs
    join: (rackId: string) => session('rack_join', { p_rack: rackId }),
    imUp: (rackId: string) => session('rack_im_up', { p_rack: rackId }),
    leave: (rackId: string) => session('rack_leave', { p_rack: rackId }),
    setPhoneContext: (
      rackId: string,
      ctx: { workoutInstanceId: string | null; routineExerciseId: string | null; setNumber: number | null; loadLb: number | null },
    ) =>
      session('rack_set_phone_context', {
        p_rack: rackId,
        p_workout_instance: ctx.workoutInstanceId,
        p_routine_exercise: ctx.routineExerciseId,
        p_set_number: ctx.setNumber,
        p_load_lb: ctx.loadLb,
      }),
    requestEndSet: (rackId: string) => session('rack_request_end_set', { p_rack: rackId }),
    async listForMe(): Promise<RackListItem[]> {
      const rows = (await call<any[]>('rack_list_for_me', {})) ?? [];
      return rows.map(r => ({
        rackId: r.rack_id,
        name: r.name,
        activeAthleteFirstName: r.active_athlete_first_name ?? null,
        state: r.state,
        queuePositionOfCaller: r.queue_position_of_caller ?? null,
      }));
    },

    // ---- rack iPad (staff) RPCs
    setActive: (rackId: string, athleteId: string) =>
      session('rack_set_active', { p_rack: rackId, p_athlete: athleteId }),
    endSet: (rackId: string, athleteId: string) =>
      session('rack_end_set', { p_rack: rackId, p_athlete: athleteId }),
    startSet: (rackId: string, athleteId: string, startedAt: string) =>
      session('rack_start_set', { p_rack: rackId, p_athlete: athleteId, p_started_at: startedAt }),
    setPin: async (pin: string) => {
      await call<null>('rack_set_pin', { p_pin: pin });
    },
    verifyPin: async (pin: string) => (await call<boolean>('rack_verify_pin', { p_pin: pin })) === true,

    // ---- reads
    async getSession(rackId: string): Promise<RackSessionRow | null> {
      const { data, error } = await client.from('rack_sessions').select('*').eq('rack_id', rackId).maybeSingle();
      if (error) throw new RackRpcError('rack_sessions', error);
      return (data as RackSessionRow) ?? null;
    },

    async listRacks(orgId: string): Promise<Rack[]> {
      const { data, error } = await client
        .from('racks')
        .select('id, org_id, name, ovr_device_name, active')
        .eq('org_id', orgId)
        .eq('active', true)
        .order('name');
      if (error) throw new RackRpcError('racks', error);
      return ((data as any[]) ?? []).map(r => ({
        id: r.id,
        orgId: r.org_id,
        name: r.name,
        ovrDeviceName: r.ovr_device_name ?? null,
        active: r.active !== false,
      }));
    },

    /**
     * Athletes of the org with a workout scheduled today, with each workout's
     * exercises in workout order (routines.order_index, then
     * routine_exercises.order_index; placeholders / notes-only rows dropped)
     * and the ones still remaining (completed sets < prescribed sets).
     */
    async todaysAthletesForRack(orgId: string, today: string = todayKey()): Promise<TodayAthlete[]> {
      const { data, error } = await client
        .from('workout_instances')
        .select(
          `id, athlete_id, scheduled_date,
           athletes!inner ( id, org_id, first_name, last_name ),
           workouts ( id, routines ( id, order_index, routine_exercises (
             id, order_index, sets, exercise_id, is_placeholder, notes_only,
             velocity_min_mps, velocity_max_mps, speed_drop_stop_pct,
             exercises ( id, name, is_placeholder ) ) ) )`,
        )
        .eq('scheduled_date', today)
        .eq('athletes.org_id', orgId);
      if (error) throw new RackRpcError('workout_instances', error);
      const instances = (data as any[]) ?? [];
      if (instances.length === 0) return [];

      const done = await completedCounts(instances.map(i => i.id));
      const out: TodayAthlete[] = [];
      for (const wi of instances) {
        const routines = [...(wi.workouts?.routines ?? [])].sort(byOrder);
        const exercises: TodayExercise[] = [];
        for (const r of routines) {
          for (const re of [...(r.routine_exercises ?? [])].sort(byOrder)) {
            if (re.notes_only || re.is_placeholder || re.exercises?.is_placeholder || !re.exercise_id) continue;
            exercises.push({
              routineExerciseId: re.id,
              exerciseId: re.exercise_id,
              name: re.exercises?.name ?? '',
              sets: typeof re.sets === 'number' ? re.sets : null,
              completedSets: done.get(`${wi.id}:${re.id}`) ?? 0,
              zoneMin: num(re.velocity_min_mps),
              zoneMax: num(re.velocity_max_mps),
              dropStopPct: num(re.speed_drop_stop_pct),
            });
          }
        }
        out.push({
          athleteId: wi.athlete_id,
          firstName: wi.athletes?.first_name ?? '',
          lastName: wi.athletes?.last_name ?? '',
          workoutInstanceId: wi.id,
          exercises,
          remaining: exercises.filter(e => e.completedSets < (e.sets ?? 1)),
        });
      }
      out.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
      return out;
    },

    /**
     * Per (athlete, workout instance, routine exercise): the highest set_number
     * already written today (any row, complete or draft) — for `seedHighWater`.
     */
    async todaysWrittenSets(athleteIds: string[], today: string = todayKey()): Promise<WrittenSet[]> {
      if (athleteIds.length === 0) return [];
      const { data: wis, error } = await client
        .from('workout_instances')
        .select('id, athlete_id')
        .in('athlete_id', athleteIds)
        .eq('scheduled_date', today);
      if (error) throw new RackRpcError('workout_instances', error);
      const ids = ((wis as any[]) ?? []).map(w => w.id);
      if (ids.length === 0) return [];
      const { data: logs, error: logErr } = await client
        .from('exercise_logs')
        .select('athlete_id, workout_instance_id, routine_exercise_id, set_number')
        .in('workout_instance_id', ids);
      if (logErr) throw new RackRpcError('exercise_logs', logErr);
      const max = new Map<string, WrittenSet>();
      for (const l of (logs as any[]) ?? []) {
        if (!l.routine_exercise_id || typeof l.set_number !== 'number') continue;
        const k = `${l.athlete_id}:${l.workout_instance_id}:${l.routine_exercise_id}`;
        const prev = max.get(k);
        if (!prev || l.set_number > prev.setNumber) {
          max.set(k, {
            athleteId: l.athlete_id,
            workoutInstanceId: l.workout_instance_id,
            routineExerciseId: l.routine_exercise_id,
            setNumber: l.set_number,
          });
        }
      }
      return [...max.values()];
    },
  };

  async function completedCounts(instanceIds: string[]): Promise<Map<string, number>> {
    const { data, error } = await client
      .from('exercise_logs')
      .select('workout_instance_id, routine_exercise_id, set_number, is_complete')
      .in('workout_instance_id', instanceIds)
      .eq('is_complete', true);
    if (error) throw new RackRpcError('exercise_logs', error);
    const counts = new Map<string, number>();
    for (const l of (data as any[]) ?? []) {
      const k = `${l.workout_instance_id}:${l.routine_exercise_id}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }
}

export type RackApi = ReturnType<typeof createRackApi>;

const byOrder = (a: { order_index?: number | null }, b: { order_index?: number | null }) =>
  (a.order_index ?? 0) - (b.order_index ?? 0);

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
