// The ONE set-matching rule for rack VBT (spec item 8). Both the rack iPad
// (executor → engine) and the athlete's phone (WorkoutLoggerScreen) call
// resolveRackSet over the same data, so they cannot disagree about which
// exercise and which set is current. Pure: no I/O, no clock.
//
// Rules, in priority order:
//   1. Exercise: the phone-open exercise, then the coach override, then the
//      first unfinished RACK LIFT (isRackLift) in workout order.
//   2. Set: the lowest set number in 1..prescribed that is not complete. Set
//      numbers come from exercise_logs, never from a counter.
//   3. Never an is_complete set.
//   4. Exercise finished (every prescribed set complete): the phone wins if it
//      moved on (rule 1); else, while lifting continues on it, an extra set
//      (the first free number past the prescription); else the next
//      unfinished rack lift; else { none } (the iPad asks "Pick an exercise",
//      reps become a free set).
//   5. Supersets: the rack serves only rack lifts. A phone open on a non-lift
//      in a superset/circuit block resolves to that block's rack lift.
//   6. Two instances today: the phone-open instance first, otherwise the
//      first one with unfinished rack lifts.
//   7. A phone edit/reopen never splits a live set — callers resolve only
//      between sets (the engine freezes the live set's context).

import { isRackLift, type TodayAthlete, type TodayExercise } from './api';
import { normalizeScheme } from '../logger/scheme';
import type { LoggerRoutine } from '../../types/logger';

export interface RackSetExercise {
  routineExerciseId: string;
  exerciseId: string | null;
  /** Prescribed sets (null = 1). */
  sets: number | null;
  /** isRackLift(): weight-tracked or speed-zoned. */
  rackLift: boolean;
  /** Superset/circuit block (grouped schemes only); null = a straight block. */
  group: string | null;
}

export interface RackSetInstance {
  workoutInstanceId: string;
  /** Workout order. */
  exercises: RackSetExercise[];
}

/** One exercise_logs row (drafts included; only is_complete counts as done). */
export interface RackSetLog {
  workoutInstanceId: string;
  routineExerciseId: string;
  setNumber: number;
  isComplete: boolean;
}

export interface RackExerciseRef {
  workoutInstanceId: string | null;
  routineExerciseId: string | null;
  /** The phone's open set (its own first incomplete set); phone context only. */
  setNumber?: number | null;
}

export interface ResolveRackSetInput {
  /** The athlete's open instances today, in order. */
  instances: RackSetInstance[];
  logs: RackSetLog[];
  /** Exercise (and set) the phone has open; null on the overview / no phone. */
  phone?: RackExerciseRef | null;
  /** The coach's iPad pick. */
  override?: RackExerciseRef | null;
  /** Exercise of the athlete's last rack set. */
  lastRackExercise?: RackExerciseRef | null;
  /** Reps keep arriving on lastRackExercise after its prescription is done. */
  liftingContinues?: boolean;
}

export type RackSetReason = 'phone' | 'superset-lift' | 'override' | 'extra-set' | 'next-rack-lift';

export type ResolvedRackSet =
  | {
      none?: undefined;
      workoutInstanceId: string;
      routineExerciseId: string;
      exerciseId: string | null;
      setNumber: number;
      reason: RackSetReason;
    }
  | { none: true; reason: 'nothing-left' };

type Hit = { inst: RackSetInstance; ex: RackSetExercise };

const keyOf = (wi: string, re: string, n: number) => `${wi}:${re}:${n}`;

export function resolveRackSet(input: ResolveRackSetInput): ResolvedRackSet {
  const { instances } = input;
  const complete = new Set<string>();
  for (const l of input.logs) if (l.isComplete) complete.add(keyOf(l.workoutInstanceId, l.routineExerciseId, l.setNumber));

  const find = (ref: RackExerciseRef | null | undefined): Hit | null => {
    if (!ref || !ref.routineExerciseId) return null;
    for (const inst of instances) {
      if (ref.workoutInstanceId && inst.workoutInstanceId !== ref.workoutInstanceId) continue;
      const ex = inst.exercises.find(e => e.routineExerciseId === ref.routineExerciseId);
      if (ex) return { inst, ex };
    }
    return null;
  };

  const phone = find(input.phone);
  // The phone's open set is its own first incomplete set, so every set below
  // it is done on the phone — including a save still in its outbox.
  const phoneSet = input.phone?.setNumber;
  if (phone && phoneSet != null) {
    for (let n = 1; n < phoneSet; n++) complete.add(keyOf(phone.inst.workoutInstanceId, phone.ex.routineExerciseId, n));
  }

  const done = (h: Hit, n: number) => complete.has(keyOf(h.inst.workoutInstanceId, h.ex.routineExerciseId, n));
  const prescribed = (h: Hit) => Math.max(0, h.ex.sets ?? 1);
  /** Rules 2 + 3: lowest not-complete set in 1..prescribed. */
  const openSet = (h: Hit): number | null => {
    for (let n = 1; n <= prescribed(h); n++) if (!done(h, n)) return n;
    return null;
  };
  /** Rule 4: first free number past the prescription (appended). */
  const extraSet = (h: Hit): number => {
    let n = prescribed(h) + 1;
    while (done(h, n)) n++;
    return n;
  };
  const same = (h: Hit, ref: RackExerciseRef | null | undefined) =>
    !!ref &&
    ref.routineExerciseId === h.ex.routineExerciseId &&
    (!ref.workoutInstanceId || ref.workoutInstanceId === h.inst.workoutInstanceId);
  const pick = (h: Hit, setNumber: number, reason: RackSetReason): ResolvedRackSet => ({
    workoutInstanceId: h.inst.workoutInstanceId,
    routineExerciseId: h.ex.routineExerciseId,
    exerciseId: h.ex.exerciseId,
    setNumber,
    reason,
  });
  const continuesOn = (h: Hit) => !!input.liftingContinues && same(h, input.lastRackExercise);

  // 1 + 5: the phone-open exercise.
  if (phone) {
    const n = openSet(phone);
    if (phone.ex.group && !phone.ex.rackLift) {
      // A superset partner (A2): the rack serves the block's rack lift.
      const lift = phone.inst.exercises
        .map(ex => ({ inst: phone.inst, ex }))
        .find(h => h.ex.group === phone.ex.group && h.ex.rackLift && openSet(h) != null);
      if (lift) return pick(lift, openSet(lift)!, 'superset-lift');
    } else if (n != null) {
      return pick(phone, n, 'phone');
    } else if (continuesOn(phone)) {
      return pick(phone, extraSet(phone), 'extra-set');
    }
  }

  // 1: the coach override (any exercise the coach picked).
  const override = find(input.override);
  if (override) {
    const n = openSet(override);
    if (n != null) return pick(override, n, 'override');
    if (continuesOn(override)) return pick(override, extraSet(override), 'extra-set');
  }

  // 4: the last rack exercise is finished but reps keep coming on it.
  const last = find(input.lastRackExercise);
  if (last && input.liftingContinues && openSet(last) == null) return pick(last, extraSet(last), 'extra-set');

  // 1 + 6: first unfinished rack lift — the phone-open instance first.
  const order = phone ? [phone.inst, ...instances.filter(i => i !== phone.inst)] : instances;
  for (const inst of order) {
    for (const ex of inst.exercises) {
      if (!ex.rackLift) continue;
      const h = { inst, ex };
      const n = openSet(h);
      if (n != null) return pick(h, n, 'next-rack-lift');
    }
  }
  return { none: true, reason: 'nothing-left' };
}

// ---------------------------------------------------------------- inputs

/** iPad: today's instances of one athlete (lib/rack/api). */
export function rackInstancesOf(athlete: Pick<TodayAthlete, 'instances'>): RackSetInstance[] {
  return athlete.instances.map(inst => ({
    workoutInstanceId: inst.workoutInstanceId,
    exercises: inst.exercises.map(rackSetExerciseOf),
  }));
}

export function rackSetExerciseOf(e: TodayExercise): RackSetExercise {
  return {
    routineExerciseId: e.routineExerciseId,
    exerciseId: e.exerciseId,
    sets: e.sets,
    rackLift: isRackLift(e),
    group: e.group ?? null,
  };
}

/**
 * Phone: the logger's workout as one instance — the same rows the iPad gets
 * from todaysAthletesForRack (notes-only / placeholder / text rows dropped),
 * through the same isRackLift.
 */
export function rackInstanceFromLogger(workoutInstanceId: string, routines: LoggerRoutine[]): RackSetInstance {
  const exercises: RackSetExercise[] = [];
  for (const r of routines) {
    const scheme = normalizeScheme(r.scheme);
    if (scheme === 'text') continue;
    for (const re of r.routine_exercises ?? []) {
      if (re.notes_only || re.is_placeholder || re.exercises?.is_placeholder || !re.exercise_id) continue;
      exercises.push({
        routineExerciseId: re.id,
        exerciseId: re.exercise_id,
        sets: typeof re.sets === 'number' ? re.sets : null,
        rackLift: isRackLift({
          zoneMin: re.velocity_min_mps ?? null,
          zoneMax: re.velocity_max_mps ?? null,
          plan: {
            exercise_id: re.exercise_id,
            metric_targets: re.metric_targets ?? null,
            set_configurations: re.set_configurations ?? null,
            intensity_targets: re.intensity_targets ?? null,
            enabled_measurements: re.enabled_measurements ?? null,
          },
        }),
        group: scheme === 'grouped' ? r.id : null,
      });
    }
  }
  return { workoutInstanceId, exercises };
}

/** Phone: completed-set flags (0-based per routine exercise) → log rows. */
export function rackLogsFromCompleted(workoutInstanceId: string, completed: Record<string, boolean[] | undefined>): RackSetLog[] {
  const out: RackSetLog[] = [];
  for (const [re, flags] of Object.entries(completed)) {
    (flags ?? []).forEach((c, i) => {
      if (c === true) out.push({ workoutInstanceId, routineExerciseId: re, setNumber: i + 1, isComplete: true });
    });
  }
  return out;
}
