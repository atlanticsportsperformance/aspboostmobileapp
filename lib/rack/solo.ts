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
import type { RackListItem } from './api';
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

/** Per athlete: user A's leftovers never flush under user B's login. */
export function soloPersistKeys(athleteId: string): PersistKeys {
  const k = (base: string) => `${base}:${athleteId}`;
  return {
    reps: k(SOLO_PERSIST_KEYS.reps),
    sets: k(SOLO_PERSIST_KEYS.sets),
    deadReps: k(SOLO_PERSIST_KEYS.deadReps),
    deadSets: k(SOLO_PERSIST_KEYS.deadSets),
  };
}

/** Every rack's sensor name, cached per phone (the solo scan never takes one). */
export const SOLO_RACK_SENSORS_KEY = 'solo_rack_sensors_v1';

/** Rack sensors from rack_list_for_me (ovr_device_name). */
export function rackSensorNames(list: Pick<RackListItem, 'ovrDeviceName'>[]): string[] {
  return [...new Set(list.map(r => r.ovrDeviceName).filter((n): n is string => !!n))];
}

/** The caller is active or queued on any rack. */
export function onAnyRack(list: Pick<RackListItem, 'callerIsActive' | 'queuePositionOfCaller'>[]): boolean {
  return list.some(r => r.callerIsActive === true || r.queuePositionOfCaller != null);
}

export async function readRackSensors(): Promise<string[]> {
  try {
    const v = await AsyncStorage.getItem(SOLO_RACK_SENSORS_KEY);
    const a = v ? JSON.parse(v) : [];
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function saveRackSensors(names: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SOLO_RACK_SENSORS_KEY, JSON.stringify(names));
  } catch (e) {
    console.warn('[solo] cache rack sensors failed', e);
  }
}

/**
 * What to scan for: the remembered sensor unless it is (now) a rack's, else
 * any OVR — always excluding every rack sensor, never retrying past a timeout.
 */
export function soloScanTarget(remembered: string | null, rackSensors: string[]): {
  target: string;
  exclude: string[];
} {
  const prefix = 'OVR_Velocity';
  return {
    target: remembered && !rackSensors.includes(remembered) ? remembered : prefix,
    exclude: rackSensors,
  };
}

export const SENSOR_BUSY_TEXT = 'Sensor busy (on a rack?)';

export const SOLO_TICK_MS = 1_000;
export const SOLO_FLUSH_MS = 15_000;
/** Cap on the set-start rack check (offline → the set starts). */
export const RACK_CHECK_MS = 2_000;
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
  /** A set-start rack check is in flight (events are held behind it). */
  checking(): boolean;
}

export function createSoloSession(opts: {
  athleteId: string;
  persist: Pick<RackPersist, 'writeRep' | 'endSet' | 'amendSet' | 'flush'>;
  sensor: SoloSensor;
  /**
   * At each set start (the rep that would start a set): is the athlete on a
   * rack? true → the set doesn't start (its reps are dropped) and `onRack`
   * runs (disconnect). A failure or a timeout lets the set start.
   */
  checkRack?: () => Promise<boolean>;
  onRack?: () => void;
  checkTimeoutMs?: number;
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

  const apply = (event: RackEvent, at: number) => {
    const res = reduce(state, event, at);
    const changed = res.state !== state;
    state = res.state;
    for (const fx of res.effects) chain = chain.then(() => run(fx)).catch(e => log('effect failed', e));
    if (changed) subs.forEach(f => f(state));
  };

  // Set-start rack check: the rep that would start a set waits for it; every
  // later event queues behind it, in order (each keeps its own time).
  let held: { event: RackEvent; at: number }[] | null = null;
  const startsSet = (event: RackEvent, at: number) =>
    event.type === 'rep' && state.setState !== 'lifting' && reduce(state, event, at).state.setState === 'lifting';
  const release = (onRack: boolean) => {
    const q = held ?? [];
    held = null;
    if (onRack) {
      log('athlete is on a rack: solo set not started');
      for (const h of q) if (h.event.type !== 'rep') apply(h.event, h.at);
      opts.onRack?.();
      return;
    }
    for (const h of q) dispatch(h.event, h.at);
  };
  const dispatch = (event: RackEvent, atMs?: number) => {
    const at = atMs ?? now();
    if (held) {
      held.push({ event, at });
      return;
    }
    if (!opts.checkRack || !startsSet(event, at)) {
      apply(event, at);
      return;
    }
    held = [];
    const mine = held;
    let settled = false;
    const done = (onRack: boolean) => {
      if (settled || held !== mine) return;
      settled = true;
      clearTimeout(timer);
      // The checked rep goes first, then everything queued behind it.
      held.unshift({ event, at });
      if (onRack) release(true);
      else {
        const q = held;
        held = null;
        const [first, ...rest] = q;
        apply(first.event, first.at);
        for (const h of rest) dispatch(h.event, h.at);
      }
    };
    const timer = setTimeout(() => done(false), opts.checkTimeoutMs ?? RACK_CHECK_MS);
    opts
      .checkRack()
      .then(r => done(r === true))
      .catch(e => {
        log('rack check failed; set starts', e);
        done(false);
      });
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
    checking: () => held != null,
  };
}
