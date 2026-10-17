// Phone-direct sensor (Task 10b): no rack iPad, the athlete pairs the OVR to
// their own phone. The Task 6 engine runs in solo mode (active athlete = me,
// no queue, no rpc* effects); the phone is the device that ends the set, so
// it writes its own set row (upsert_exercise_log, metric_data_patch.vbt with
// source 'phone') and its reps (vbt_reps, rack_id null) — both through
// durable queues under their OWN keys, never the rack iPad's.
//
// Set end = Done, the 60 s idle end, or the 30 s idle-reopen window — the
// engine's rules, unchanged.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createRackEngine,
  reduce,
  type LiveSet,
  type RackEffect,
  type RackEngineState,
  type RackEvent,
  type SetSummary,
} from './engine';
import type { PersistKeys, RackPersist } from './persist';
import type { RepChip } from './phone';
import type { OvrConnState } from '../ovr/ovr-device';

// ---------------------------------------------------------------- keys

/** Remembered sensor name, per phone. */
export const SOLO_OVR_NAME_KEY = 'solo_ovr_name_v1';

export const SOLO_PERSIST_KEYS: PersistKeys = {
  reps: 'solo_vbt_reps_v1',
  sets: 'solo_set_writes_v1',
  deadReps: 'solo_vbt_reps_dead_v1',
  deadSets: 'solo_set_writes_dead_v1',
};

export const SENSOR_BUSY_TEXT = 'Sensor busy (on a rack?)';

export const SOLO_TICK_MS = 1_000;
export const SOLO_FLUSH_MS = 15_000;
const ENQUEUE_TRIES = 3;

export async function readSoloOvrName(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(SOLO_OVR_NAME_KEY);
    return v && v.startsWith('OVR_Velocity') ? v : null;
  } catch {
    return null;
  }
}

export async function saveSoloOvrName(name: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SOLO_OVR_NAME_KEY, name);
  } catch (e) {
    console.warn('[solo] remember sensor failed', e);
  }
}

// ---------------------------------------------------------------- pure view rules

/** "Connect sensor" shows only for the athlete's own workout, off any rack. */
export function showConnectSensor(i: { isSelf: boolean; onRack: boolean; hasExercise: boolean }): boolean {
  return i.isSelf && !i.onRack && i.hasExercise;
}

/** Joining a rack (active or queued) drops the phone's sensor. */
export function mustDropSensor(i: { onRack: boolean; sensorOn: boolean }): boolean {
  return i.onRack && i.sensorOn;
}

/**
 * The scan timed out without finding the sensor. The OVR allows one client,
 * so a sensor held by a rack iPad is invisible: say so.
 */
export function isSensorBusy(state: OvrConnState, error: string | undefined): boolean {
  return (state === 'reconnecting' || state === 'error') && !!error && /No OVR sensor found/i.test(error);
}

/** The live set's reps as chips (same shape the rack's realtime reps use). */
export function soloChips(set: LiveSet | null): RepChip[] {
  if (!set) return [];
  return set.reps.map(r => ({
    clientRepId: r.clientRepId,
    repIndex: r.repIndex,
    v: r.v,
    pv: r.pv,
    rom: r.rom,
    partial: r.partial,
    loadLb: set.context.loadLb,
    receivedAt: new Date(r.receivedAtMs).toISOString(),
  }));
}

/** The set being lifted on this workout (null while not lifting). */
export function soloLiveSet(
  s: RackEngineState | null,
  workoutInstanceId: string,
): { routineExerciseId: string; setNumber: number; set: LiveSet } | null {
  const live = s?.setState === 'lifting' ? s.live : null;
  if (!live || live.free) return null;
  const c = live.context;
  if (c.workoutInstanceId !== workoutInstanceId || !c.routineExerciseId || c.setNumber == null) return null;
  return { routineExerciseId: c.routineExerciseId, setNumber: c.setNumber, set: live };
}

/**
 * The exercise_logs-shaped row of a set the phone just wrote, so the logger
 * fills it in exactly like a rack-written row (reps, LB, check-off, next set).
 */
export function soloSavedLog(summary: SetSummary): Record<string, any> | null {
  if (summary.free || !summary.routineExerciseId || summary.setNumber == null) return null;
  return {
    workout_instance_id: summary.workoutInstanceId,
    routine_exercise_id: summary.routineExerciseId,
    set_number: summary.setNumber,
    actual_reps: summary.fullReps,
    ...(summary.loadLb != null ? { actual_weight: summary.loadLb } : {}),
    is_complete: true,
    metric_data: {
      vbt: {
        reps: summary.reps,
        avg_v: summary.avgV,
        best_v: summary.bestV,
        zone: summary.zone,
        drop_pct: summary.dropPct,
        source: summary.source,
        rack: null,
        ended_by: summary.endedBy,
      },
    },
  };
}

// ---------------------------------------------------------------- session (executor)

export interface SoloSensor {
  writeLoad(lb: number): Promise<void>;
}

export interface SoloSession {
  dispatch(event: RackEvent, atMs?: number): void;
  getState(): RackEngineState;
  subscribe(fn: (s: RackEngineState) => void): () => void;
  /** Called once a set row is durably queued (ended or amended). */
  onSetSaved(fn: (summary: SetSummary) => void): () => void;
  start(): void;
  stop(): void;
  flush(): Promise<void>;
  /** Resolves when every effect so far has run (tests). */
  idle(): Promise<void>;
}

export function createSoloSession(opts: {
  athleteId: string;
  persist: Pick<RackPersist, 'writeRep' | 'endSet' | 'amendSet' | 'flush'>;
  sensor: SoloSensor;
  now?: () => number;
  log?: (...a: unknown[]) => void;
}): SoloSession {
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((...a: unknown[]) => console.warn('[solo]', ...a));
  let state = createRackEngine({ mode: 'solo', athleteId: opts.athleteId });
  const subs = new Set<(s: RackEngineState) => void>();
  const savedSubs = new Set<(s: SetSummary) => void>();
  let chain: Promise<void> = Promise.resolve();
  let tick: ReturnType<typeof setInterval> | null = null;
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  // Writes whose enqueue failed: kept in memory, re-enqueued on the next flush.
  const unsaved: (() => Promise<void>)[] = [];

  const tryEnqueue = async (fn: () => Promise<void>, what: string) => {
    for (let i = 0; i < ENQUEUE_TRIES; i++) {
      try {
        await fn();
        return;
      } catch (e) {
        log(`${what} enqueue failed`, e);
      }
    }
    unsaved.push(fn);
  };

  const run = async (fx: RackEffect) => {
    switch (fx.type) {
      case 'writeRep':
        await tryEnqueue(() => opts.persist.writeRep(fx.rep), 'rep');
        break;
      case 'endSet':
      case 'amendSet': {
        const summary = fx.summary;
        await tryEnqueue(
          () => (fx.type === 'endSet' ? opts.persist.endSet(summary) : opts.persist.amendSet(summary)),
          'set',
        );
        savedSubs.forEach(f => {
          try {
            f(summary);
          } catch (e) {
            log('onSetSaved threw', e);
          }
        });
        void flush();
        break;
      }
      case 'writeLoadToSensor':
        await opts.sensor.writeLoad(fx.lb).catch(e => log('load write failed', e));
        break;
      case 'droppedRep':
        log('rep dropped', fx.reason);
        break;
      default:
        // Solo never emits rpcStartSet / rpcEndSet / rpcSetActive; nothing to call.
        log('ignored effect in solo mode', fx.type);
    }
  };

  const flush = async () => {
    const pending = unsaved.splice(0);
    for (const fn of pending) await tryEnqueue(fn, 'retry');
    await opts.persist.flush();
  };

  const dispatch = (event: RackEvent, atMs?: number) => {
    const res = reduce(state, event, atMs ?? now());
    const changed = res.state !== state;
    state = res.state;
    for (const fx of res.effects) chain = chain.then(() => run(fx)).catch(e => log('effect failed', e));
    if (changed) subs.forEach(f => f(state));
  };

  return {
    dispatch,
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    onSetSaved(fn) {
      savedSubs.add(fn);
      return () => savedSubs.delete(fn);
    },
    start() {
      if (tick) return;
      tick = setInterval(() => dispatch({ type: 'tick' }), SOLO_TICK_MS);
      flushTimer = setInterval(() => void flush().catch(e => log('flush failed', e)), SOLO_FLUSH_MS);
      void flush().catch(e => log('flush failed', e));
    },
    stop() {
      if (tick) clearInterval(tick);
      if (flushTimer) clearInterval(flushTimer);
      tick = null;
      flushTimer = null;
    },
    flush: () => flush().catch(e => log('flush failed', e)),
    idle: () => chain,
  };
}
