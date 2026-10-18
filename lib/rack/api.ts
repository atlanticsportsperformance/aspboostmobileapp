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
import type { IntensityTarget } from '../../types/logger';
import { normalizeScheme } from '../logger/scheme';

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
  /** Queue head's first name ("Jake is next"); null when nobody waits. */
  nextAthleteFirstName?: string | null;
  state: string;
  /** 1-based; null when the caller is not queued. */
  queuePositionOfCaller: number | null;
  /** The rack's paired sensor (phone-direct mode never connects to it). */
  ovrDeviceName?: string | null;
  /** The caller is the rack's active lifter (undefined from an older RPC). */
  callerIsActive?: boolean;
}

export interface Rack {
  id: string;
  orgId: string;
  name: string;
  ovrDeviceName: string | null;
  active: boolean;
}

export interface TodayExercise {
  workoutInstanceId: string;
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
  /** Block code as the logger shows it ("A2"); null when unknown. */
  code?: string | null;
  /** Superset/circuit block (the routine id) when the block is grouped; null = straight. */
  group?: string | null;
  /** Prescribed reps for set 1 (per-set metric_values.reps, else metric_targets.reps). */
  repsTarget?: number | null;
  /** Prescribed weight (lb) per 0-indexed set (set_configurations[n].metric_values.weight). */
  prescribedWeights?: (number | null)[];
  /** Exercise-level prescribed weight (metric_targets.weight). */
  prescribedWeight?: number | null;
  /** The routine exercise's prescription, shaped like the logger's
   *  LoggerRoutineExercise so lib/logger/targets resolves % loads the same way. */
  plan?: RackPlan;
}

/** Prescription subset (logger v2 shape) — fixed and % weight targets. */
export interface RackPlan {
  exercise_id: string;
  metric_targets?: Record<string, number> | null;
  set_configurations?: { metric_values?: Record<string, any> | null; intensity_targets?: IntensityTarget[] | null }[] | null;
  intensity_targets?: IntensityTarget[] | null;
  enabled_measurements?: string[] | null;
}

/**
 * A "rack lift": the coach tracks weight on it (a weight target / % target /
 * the weight measurement), or gave it a velocity zone. Jumps, mobility,
 * reps-only and notes are not — the iPad never auto-picks them.
 */
export function isRackLift(
  ex: Pick<TodayExercise, 'zoneMin' | 'zoneMax' | 'plan' | 'prescribedWeight' | 'prescribedWeights'>,
): boolean {
  if (ex.zoneMin != null || ex.zoneMax != null) return true;
  const p = ex.plan;
  if (!p) return ex.prescribedWeight != null || (ex.prescribedWeights ?? []).some(w => w != null);
  const isWeight = (t: IntensityTarget | null | undefined) => !!t && t.metric === 'weight';
  if (p.metric_targets && p.metric_targets.weight != null) return true;
  if ((p.enabled_measurements ?? []).includes('weight')) return true;
  if ((p.intensity_targets ?? []).some(isWeight)) return true;
  return (p.set_configurations ?? []).some(
    c => c?.metric_values?.weight != null || (c?.intensity_targets ?? []).some(isWeight),
  );
}

/**
 * The % weight target for a 1-based set ("90% of set 1", "80% of max"),
 * picked exactly like logger v2's intensityTargetFor: the set's own
 * intensity_targets, else the exercise's.
 */
export function percentWeightTarget(ex: TodayExercise, setNumber: number | null): IntensityTarget | null {
  const p = ex.plan;
  if (!p) return null;
  const i = (setNumber ?? 1) - 1;
  const list = p.set_configurations?.[i]?.intensity_targets || p.intensity_targets || [];
  return list.find(t => t?.metric === 'weight') ?? null;
}

/** The plan's weight for a 1-based set: per-set value, else the exercise's. */
export function prescribedWeightFor(ex: TodayExercise, setNumber: number | null): number | null {
  const i = (setNumber ?? 1) - 1;
  const perSet = ex.prescribedWeights?.[i];
  if (perSet != null) return perSet;
  return ex.prescribedWeight ?? null;
}

/** One of today's workout instances for an athlete (not skipped/completed). */
export interface TodayInstance {
  workoutInstanceId: string;
  status: string;
  createdAt: string;
  /** workouts.name (header). */
  workoutName?: string | null;
  /** Every (non-placeholder) exercise, in workout order. */
  exercises: TodayExercise[];
  /** Exercises with sets still to do, in workout order. */
  remaining: TodayExercise[];
}

/** One athlete with a workout today — ONE entry per athlete. */
export interface TodayAthlete {
  athleteId: string;
  firstName: string;
  lastName: string;
  /** Not-skipped, not-completed instances, earliest created first. */
  instances: TodayInstance[];
  /** All instances' exercises, instance order then workout order (contextMeta). */
  exercises: TodayExercise[];
  /** All instances' remaining exercises, same order (Task 9 override list). */
  remaining: TodayExercise[];
}

/** Statuses a rack can still log into (skipped/completed are excluded). */
export const OPEN_INSTANCE_STATUSES = ['not_started', 'in_progress'] as const;

/**
 * The iPad's exercise pick for an athlete: an instance the server/phone
 * context points at wins, else the earliest instance with remaining work
 * (instances are already ordered by created_at — workout_instances has no
 * scheduled time). Returns its first remaining exercise.
 */
export function pickLocalExercise(
  athlete: TodayAthlete,
  contextInstanceIds: (string | null | undefined)[] = [],
): TodayExercise | null {
  for (const id of contextInstanceIds) {
    if (!id) continue;
    const inst = athlete.instances.find(i => i.workoutInstanceId === id);
    if (inst?.remaining[0]) return inst.remaining[0];
  }
  for (const inst of athlete.instances) if (inst.remaining[0]) return inst.remaining[0];
  return null;
}

/** One of today's exercise_logs rows (drafts too) — resolveRackSet's logs. */
export interface SetLogRow {
  athleteId: string;
  workoutInstanceId: string;
  routineExerciseId: string;
  setNumber: number;
  isComplete: boolean;
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
  /** rack_set_phone_context has no p_reps_target yet (migration pending): skip it. */
  let repsTargetUnsupported = false;

  return {
    // ---- phone (athlete) RPCs
    join: (rackId: string) => session('rack_join', { p_rack: rackId }),
    imUp: (rackId: string) => session('rack_im_up', { p_rack: rackId }),
    leave: (rackId: string) => session('rack_leave', { p_rack: rackId }),
    /**
     * The phone's open exercise / set / LB (+ its REPS for that set, so the
     * iPad's REPS box follows). p_reps_target needs the reps_target migration;
     * until it is applied the call falls back to the 5-argument RPC.
     */
    async setPhoneContext(
      rackId: string,
      ctx: { workoutInstanceId: string | null; routineExerciseId: string | null; setNumber: number | null; loadLb: number | null; repsTarget?: number | null },
    ) {
      const args = {
        p_rack: rackId,
        p_workout_instance: ctx.workoutInstanceId,
        p_routine_exercise: ctx.routineExerciseId,
        p_set_number: ctx.setNumber,
        p_load_lb: ctx.loadLb,
      };
      if (!repsTargetUnsupported) {
        try {
          return await session('rack_set_phone_context', { ...args, p_reps_target: ctx.repsTarget ?? null });
        } catch (e) {
          // PGRST202 / 42883: no 6-argument function yet (migration not applied).
          const code = (e as RackRpcError).code;
          if (code !== 'PGRST202' && code !== '42883') throw e;
          repsTargetUnsupported = true;
        }
      }
      return session('rack_set_phone_context', args);
    },
    requestEndSet: (rackId: string) => session('rack_request_end_set', { p_rack: rackId }),
    /** Soft-delete (or restore) one rep; the set row's reps / avg / best / drop are recomputed.
     *  Staff in reach, or the athlete themself (the phone long-press). */
    removeRep: (clientRepId: string, restore = false) =>
      call<unknown>('rack_remove_rep', { p_client_rep_id: clientRepId, p_restore: restore }),
    async listForMe(): Promise<RackListItem[]> {
      const rows = (await call<any[]>('rack_list_for_me', {})) ?? [];
      return rows.map(r => ({
        rackId: r.rack_id,
        name: r.name,
        activeAthleteFirstName: r.active_athlete_first_name ?? null,
        nextAthleteFirstName: r.next_athlete_first_name ?? null,
        state: r.state,
        queuePositionOfCaller: r.queue_position_of_caller ?? null,
        ovrDeviceName: r.ovr_device_name ?? null,
        ...(typeof r.caller_is_active === 'boolean' ? { callerIsActive: r.caller_is_active } : {}),
      }));
    },

    // ---- rack iPad (staff) RPCs
    setActive: (rackId: string, athleteId: string) =>
      session('rack_set_active', { p_rack: rackId, p_athlete: athleteId }),
    endSet: (rackId: string, athleteId: string) =>
      session('rack_end_set', { p_rack: rackId, p_athlete: athleteId }),
    /** Staff: publish the iPad's pick (no-op unless the athlete is active;
     *  mid-set it lands in pending_*). Returns the row (→ sessionSync). */
    setIpadContext: (
      rackId: string,
      athleteId: string,
      ctx: { workoutInstanceId: string | null; routineExerciseId: string | null; setNumber: number | null; loadLb: number | null },
    ) =>
      session('rack_set_ipad_context', {
        p_rack: rackId,
        p_athlete: athleteId,
        p_workout_instance: ctx.workoutInstanceId,
        p_routine_exercise: ctx.routineExerciseId,
        p_set_number: ctx.setNumber,
        p_load_lb: ctx.loadLb,
      }),
    startSet: (rackId: string, athleteId: string, startedAt: string) =>
      session('rack_start_set', { p_rack: rackId, p_athlete: athleteId, p_started_at: startedAt }),
    setPin: async (pin: string) => {
      await call<null>('rack_set_pin', { p_pin: pin });
    },
    verifyPin: async (pin: string) => (await call<boolean>('rack_verify_pin', { p_pin: pin })) === true,
    /** Whether the caller's org already has a rack PIN (staff only). */
    pinIsSet: async () => (await call<boolean>('rack_pin_is_set', {})) === true,

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
          `id, athlete_id, scheduled_date, status, created_at,
           athletes!inner ( id, org_id, first_name, last_name ),
           workouts ( id, name, routines ( id, order_index, scheme, routine_exercises (
             id, order_index, sets, exercise_id, is_placeholder, notes_only,
             metric_targets, set_configurations, intensity_targets, enabled_measurements,
             velocity_min_mps, velocity_max_mps, speed_drop_stop_pct,
             exercises ( id, name, is_placeholder ) ) ) )`,
        )
        .eq('scheduled_date', today)
        .eq('org_id', orgId)
        .in('status', [...OPEN_INSTANCE_STATUSES]);
      if (error) throw new RackRpcError('workout_instances', error);
      const instances = (data as any[]) ?? [];
      if (instances.length === 0) return [];

      const done = await completedCounts(instances.map(i => i.id));
      const byAthlete = new Map<string, TodayAthlete>();
      const ordered = [...instances].sort(
        (a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id)),
      );
      for (const wi of ordered) {
        const routines = [...(wi.workouts?.routines ?? [])].sort(byOrder);
        const exercises: TodayExercise[] = [];
        routines.forEach((r: any, ri: number) => {
          // Text blocks (warm-up / notes) log no sets — same filter as the logger.
          if (normalizeScheme(r.scheme) === 'text') return;
          // Code index counts the rows the logger lists (true placeholders dropped).
          const listed = [...(r.routine_exercises ?? [])]
            .sort(byOrder)
            .filter((re: any) => !((re.is_placeholder || re.exercises?.is_placeholder) && !re.notes_only));
          listed.forEach((re: any, ei: number) => {
            if (re.notes_only || re.is_placeholder || re.exercises?.is_placeholder || !re.exercise_id) return;
            const cfg: any[] = Array.isArray(re.set_configurations) ? re.set_configurations : [];
            exercises.push({
              workoutInstanceId: wi.id,
              routineExerciseId: re.id,
              exerciseId: re.exercise_id,
              name: re.exercises?.name ?? '',
              sets: typeof re.sets === 'number' ? re.sets : null,
              completedSets: done.get(`${wi.id}:${re.id}`) ?? 0,
              zoneMin: num(re.velocity_min_mps),
              zoneMax: num(re.velocity_max_mps),
              dropStopPct: num(re.speed_drop_stop_pct),
              code: `${String.fromCharCode(65 + ri)}${ei + 1}`,
              group: normalizeScheme(r.scheme) === 'grouped' ? r.id : null,
              repsTarget: num(cfg[0]?.metric_values?.reps) ?? num(re.metric_targets?.reps),
              prescribedWeights: cfg.map(c => num(c?.metric_values?.weight)),
              prescribedWeight: num(re.metric_targets?.weight),
              plan: {
                exercise_id: re.exercise_id,
                metric_targets: re.metric_targets ?? null,
                set_configurations: cfg,
                intensity_targets: Array.isArray(re.intensity_targets) ? re.intensity_targets : null,
                enabled_measurements: Array.isArray(re.enabled_measurements) ? re.enabled_measurements : null,
              },
            });
          });
        });
        const inst: TodayInstance = {
          workoutInstanceId: wi.id,
          status: wi.status,
          createdAt: wi.created_at,
          workoutName: wi.workouts?.name ?? null,
          exercises,
          remaining: exercises.filter(e => e.completedSets < (e.sets ?? 1)),
        };
        let a = byAthlete.get(wi.athlete_id);
        if (!a) {
          a = {
            athleteId: wi.athlete_id,
            firstName: wi.athletes?.first_name ?? '',
            lastName: wi.athletes?.last_name ?? '',
            instances: [],
            exercises: [],
            remaining: [],
          };
          byAthlete.set(wi.athlete_id, a);
        }
        a.instances.push(inst);
        a.exercises.push(...inst.exercises);
        a.remaining.push(...inst.remaining);
      }
      return [...byAthlete.values()].sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      );
    },

    /** Today's logged weight per set number for one routine exercise ({setNumber: lb}). */
    async loggedWeights(workoutInstanceId: string, routineExerciseId: string): Promise<Record<number, number>> {
      const { data, error } = await client
        .from('exercise_logs')
        .select('set_number, actual_weight')
        .eq('workout_instance_id', workoutInstanceId)
        .eq('routine_exercise_id', routineExerciseId);
      if (error) throw new RackRpcError('exercise_logs', error);
      const out: Record<number, number> = {};
      for (const r of (data as any[]) ?? []) {
        const w = num(r.actual_weight);
        if (typeof r.set_number === 'number' && w != null && w > 0) out[r.set_number] = w;
      }
      return out;
    },

    /** The athlete's maxes, exercise_id → metric_id → value (most recent wins). */
    async athleteMaxes(athleteId: string, exerciseIds: string[]): Promise<Record<string, Record<string, number>>> {
      if (exerciseIds.length === 0) return {};
      const { data, error } = await client
        .from('athlete_maxes')
        .select('exercise_id, metric_id, max_value, achieved_on')
        .eq('athlete_id', athleteId)
        .in('exercise_id', exerciseIds)
        .order('achieved_on', { ascending: false });
      if (error) throw new RackRpcError('athlete_maxes', error);
      const out: Record<string, Record<string, number>> = {};
      for (const m of (data as any[]) ?? []) {
        const v = num(m.max_value);
        if (v == null) continue;
        out[m.exercise_id] ??= {};
        if (out[m.exercise_id][m.metric_id] === undefined) out[m.exercise_id][m.metric_id] = v;
      }
      return out;
    },

    /** The athlete's most recent logged weight (lb) for an exercise, or null. */
    async lastLoggedWeight(athleteId: string, exerciseId: string): Promise<number | null> {
      const { data, error } = await client
        .from('exercise_logs')
        .select('actual_weight')
        .eq('athlete_id', athleteId)
        .eq('exercise_id', exerciseId)
        .not('actual_weight', 'is', null)
        // idx_exercise_logs_athlete_exercise_date = (athlete_id, exercise_id, logged_at DESC)
        .order('logged_at', { ascending: false })
        .limit(1);
      if (error) throw new RackRpcError('exercise_logs', error);
      const w = num(((data as any[]) ?? [])[0]?.actual_weight);
      return w != null && w > 0 ? w : null;
    },

    /**
     * ONE athlete's set rows (set_number + is_complete, drafts too) on their
     * instances scheduled `today` — resolveRackSet's logs on the iPad.
     * rack_athlete_sets is SECURITY DEFINER (staff of the rack's org + reach):
     * one call, no RLS planning.
     */
    async athleteSets(rackId: string, athleteId: string, today: string = todayKey()): Promise<SetLogRow[]> {
      const rows = (await call<any[]>('rack_athlete_sets', { p_rack: rackId, p_athlete: athleteId, p_date: today })) ?? [];
      const out: SetLogRow[] = [];
      for (const l of rows) {
        if (!l.routine_exercise_id || typeof l.set_number !== 'number') continue;
        out.push({
          athleteId,
          workoutInstanceId: l.workout_instance_id,
          routineExerciseId: l.routine_exercise_id,
          setNumber: l.set_number,
          isComplete: l.is_complete === true,
        });
      }
      return out;
    },
  };

  async function completedCounts(instanceIds: string[]): Promise<Map<string, number>> {
    const { data, error } = await client
      .from('exercise_logs')
      .select('workout_instance_id, routine_exercise_id')
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
