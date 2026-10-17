// Rack executor: owns the engine state, reduces events, and runs the engine's
// effects against the world (sensor, persistence queues, rack RPCs).
//
// Contract (task-6 report, fix rounds 1–2):
//   - Every event goes straight to the engine — nothing is buffered here.
//   - Effects run IN ORDER on one serial chain. Persistence effects (writeRep,
//     endSet, amendSet) are awaited — "awaited" = durably enqueued, not sent.
//   - RPC effects are started in order on their own serial chain, once every
//     effect before them has run, so `rpcEndSet` always goes out after the
//     preceding `endSet` is on disk. The effect chain does not wait for the
//     RPC's round trip. RPCs time out after 10 s (→ rpcFailed).
//   - An RPC's returned row is dispatched as `sessionSync` BEFORE
//     `rpcSettled`; an error dispatches `rpcFailed`. rpcSetActive is never
//     queued offline — it just fails.
//   - Seeds (high-water) are PRELOADED, never awaited: todaysWrittenSets for
//     every athlete on today's tiles (+ the active / switching-to athlete) on
//     start, every 60 s, and right away when the tile list or the active
//     athlete changes. Each row is dispatched as `seedHighWater` the moment it
//     lands; a failure retries every 5 s. Tiles are known before anyone
//     lifts, so the seed is normally in before the first rep. `isSyncing()` =
//     the rep athlete's seed hasn't loaded yet (UI indicator only).
//     RESIDUAL RISK: iPad offline since boot + no phone context for the
//     athlete → the rack numbers from its local high-water and can collide
//     with a set the athlete logged on the phone.
//   - `tick` every 1 s; both queues flushed (serialized) on start, every 15 s
//     (the app has no NetInfo), after each enqueue, and on `flush()`.

import { nextContext, nextSetNumber, reduce, type RackEffect, type RackEngineState, type RackEvent, type RpcKind } from './engine';
import type { RackContext, RackSessionRow, SetSummary, RepWrite } from './engine';
import { pickLocalExercise, prescribedWeightFor, type TodayAthlete, type TodayExercise, type WrittenSet } from './api';
import { withTimeout, type RackPersist } from './persist';

export const TICK_MS = 1_000;
export const FLUSH_MS = 15_000;
export const SEED_RETRY_MS = 5_000;
export const SEED_REFRESH_MS = 60_000;
export const RPC_TIMEOUT_MS = 10_000;
/** A failed last-logged-weight read is retried after this long. */
export const WEIGHT_RETRY_MS = 30_000;

export interface ExecutorApi {
  startSet(rackId: string, athleteId: string, startedAt: string): Promise<RackSessionRow>;
  setActive(rackId: string, athleteId: string): Promise<RackSessionRow>;
  endSet(rackId: string, athleteId: string): Promise<RackSessionRow>;
  todaysWrittenSets(athleteIds: string[]): Promise<WrittenSet[]>;
  /** Last logged weight for (athlete, exercise) — the load fallback when
   *  neither the phone nor the plan gives one. Optional (tests). */
  lastLoggedWeight?(athleteId: string, exerciseId: string): Promise<number | null>;
}

export type ExecutorPersist = Pick<RackPersist, 'writeRep' | 'endSet' | 'amendSet'> & {
  flush(opts?: { force?: boolean }): Promise<void>;
};

export interface ExecutorSensor {
  writeLoad(lb: number): Promise<void>;
}

export interface RackExecutor {
  /** Reduce one event (never buffered). */
  dispatch(event: RackEvent, atMs?: number): void;
  getState(): RackEngineState;
  /** true while the rep athlete's seed has not loaded yet (UI indicator). */
  isSyncing(): boolean;
  /** Called on every state or syncing change. */
  subscribe(listener: (s: RackEngineState, syncing: boolean) => void): () => void;
  /** Today's athletes: dispatches contextMeta for every exercise and the
   *  iPad's localContext pick for the active athlete. */
  setToday(athletes: TodayAthlete[]): void;
  /** Flush both queues now, ignoring back-off (e.g. realtime reconnect).
   *  Resolves when that flush pass is done. */
  flush(): Promise<void>;
  /** iPad exercise pick for an athlete (null clears). Applied as the engine's
   *  localContext by the executor itself, after its own pick, so the two
   *  never alternate. Cleared when the active athlete changes. */
  setOverride(athleteId: string, ex: TodayExercise | null): void;
  /** End any live set (iPad Done) and wait until its writes are queued. */
  endLive(): Promise<void>;
  /** Writes held in memory because their enqueue failed. */
  unsavedCount(): { reps: number; sets: number };
  start(): void;
  stop(): void;
  /** Resolves when every effect and RPC queued so far has run (tests). */
  idle(): Promise<void>;
}

const RPC_KIND: Record<'rpcStartSet' | 'rpcSetActive' | 'rpcEndSet', RpcKind> = {
  rpcStartSet: 'startSet',
  rpcSetActive: 'setActive',
  rpcEndSet: 'endSet',
};

export function createRackExecutor(opts: {
  engine: RackEngineState;
  api: ExecutorApi;
  persist: ExecutorPersist;
  sensor: ExecutorSensor;
  now?: () => number;
  log?: (...args: unknown[]) => void;
}): RackExecutor {
  const { api, persist, sensor } = opts;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((...a: unknown[]) => console.warn('[rack]', ...a));

  let state = opts.engine;
  const listeners = new Set<(s: RackEngineState, syncing: boolean) => void>();
  let effectChain: Promise<void> = Promise.resolve();
  let rpcChain: Promise<void> = Promise.resolve();
  let today: TodayAthlete[] = [];
  let timers: ReturnType<typeof setInterval>[] = [];
  let running = false;

  /** Athletes whose seed has landed at least once. */
  const seeded = new Set<string>();
  let seedInFlight = false;
  let seedAgain = false;
  let seedRetry: ReturnType<typeof setTimeout> | null = null;

  /** Writes whose enqueue failed (storage error) — retried on every flush. */
  const unsavedReps: RepWrite[] = [];
  const unsavedSets: { kind: 'endSet' | 'amendSet'; summary: SetSummary }[] = [];

  const repTarget = () => state.switchingTo ?? state.activeAthleteId;
  const isSyncing = () => {
    const t = repTarget();
    return !!t && !seeded.has(t);
  };
  const notify = () => {
    const syncing = isSyncing();
    listeners.forEach(l => l(state, syncing));
  };

  // ---------------------------------------------------------------- flush

  // Serialized: one drain + flush at a time; a request during it runs once more after.
  let flushing: Promise<void> | null = null;
  let flushAgain = false;
  let flushForce = false;
  const drainAndFlush = async () => {
    while (unsavedReps.length) {
      const r = unsavedReps[0];
      await persist.writeRep(r);
      const i = unsavedReps.indexOf(r);
      if (i >= 0) unsavedReps.splice(i, 1);
    }
    while (unsavedSets.length) {
      const w = unsavedSets[0];
      await (w.kind === 'endSet' ? persist.endSet(w.summary) : persist.amendSet(w.summary));
      const i = unsavedSets.indexOf(w);
      if (i >= 0) unsavedSets.splice(i, 1);
    }
    const force = flushForce;
    flushForce = false;
    await persist.flush(force ? { force } : undefined);
  };
  const flushSoon = (force = false): Promise<void> => {
    if (force) flushForce = true;
    if (flushing) {
      flushAgain = true;
      return flushing;
    }
    const p = (async () => {
      do {
        flushAgain = false;
        try {
          await drainAndFlush();
        } catch (e) {
          log('flush failed', e);
        }
      } while (flushAgain);
    })().finally(() => {
      flushing = null;
    });
    flushing = p;
    return p;
  };

  // ---------------------------------------------------------------- effects

  const runRpc = (effect: Extract<RackEffect, { type: 'rpcStartSet' | 'rpcSetActive' | 'rpcEndSet' }>) => {
    const rackId = state.rackId;
    const kind = RPC_KIND[effect.type];
    const athleteId = effect.athleteId;
    rpcChain = rpcChain.then(async () => {
      if (!rackId) return; // solo engines emit no rack RPCs
      let row: RackSessionRow;
      try {
        const call =
          effect.type === 'rpcStartSet'
            ? api.startSet(rackId, athleteId, effect.setStartedAt)
            : effect.type === 'rpcSetActive'
              ? api.setActive(rackId, athleteId)
              : api.endSet(rackId, athleteId);
        row = await withTimeout(call, RPC_TIMEOUT_MS, kind);
      } catch (e) {
        log(`${kind} failed`, e);
        dispatch({ type: 'rpcFailed', kind, athleteId });
        return;
      }
      if (row) dispatch({ type: 'sessionSync', row });
      dispatch({ type: 'rpcSettled', kind, athleteId });
    });
  };

  /** Enqueue with 3 tries; on failure keep it in memory for the next flush. */
  const durably = async (what: string, write: () => Promise<void>, keep: () => void): Promise<boolean> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await write();
        return true;
      } catch (e) {
        if (attempt === 3) {
          log(`${what} enqueue failed; kept in memory for the next flush`, e);
          keep();
        }
      }
    }
    return false;
  };

  /** Fill a missing exerciseId from the engine's routine-exercise map. */
  const withExercise = (s: SetSummary): SetSummary =>
    s.exerciseId || !s.routineExerciseId
      ? s
      : { ...s, exerciseId: state.exerciseByRoutineExercise[s.routineExerciseId] ?? null };

  const runEffects = async (effects: RackEffect[]) => {
    // A set whose write could not be queued must not be released on the
    // server by a following rpcEndSet (ordering contract) — report it failed.
    let setWriteFailed = false;
    for (const fx of effects) {
      switch (fx.type) {
        case 'writeLoadToSensor':
          sensor.writeLoad(fx.lb).catch(e => log('writeLoad failed', e));
          break;
        case 'writeRep':
          await durably('writeRep', () => persist.writeRep(fx.rep), () => unsavedReps.push(fx.rep));
          flushSoon();
          break;
        case 'endSet':
        case 'amendSet': {
          // The weight just saved is the athlete's newest "last logged weight".
          if (fx.summary.loadLb != null && fx.summary.exerciseId) {
            lastWeight.set(`${fx.summary.athleteId}:${fx.summary.exerciseId}`, fx.summary.loadLb);
          }
          if (fx.summary.free) break; // free sets: vbt_reps only
          const s = withExercise(fx.summary);
          const kind = fx.type;
          const ok = await durably(
            kind,
            () => (kind === 'endSet' ? persist.endSet(s) : persist.amendSet(s)),
            () => unsavedSets.push({ kind, summary: s }),
          );
          setWriteFailed = !ok;
          flushSoon();
          break;
        }
        case 'rpcEndSet':
          if (setWriteFailed) {
            dispatch({ type: 'rpcFailed', kind: 'endSet', athleteId: fx.athleteId });
            break;
          }
          runRpc(fx);
          break;
        case 'rpcStartSet':
        case 'rpcSetActive':
          runRpc(fx);
          break;
        case 'droppedRep':
          log('dropped rep', fx.reason, fx.rep);
          break;
      }
    }
  };

  // ---------------------------------------------------------------- seed preload

  const seedIds = (): string[] => {
    const ids = new Set<string>(today.map(a => a.athleteId));
    if (state.activeAthleteId) ids.add(state.activeAthleteId);
    if (state.switchingTo) ids.add(state.switchingTo);
    return [...ids];
  };

  const preloadSeeds = () => {
    if (seedInFlight) {
      seedAgain = true;
      return;
    }
    const ids = seedIds();
    if (ids.length === 0) return;
    if (seedRetry) clearTimeout(seedRetry);
    seedRetry = null;
    seedInFlight = true;
    withTimeout(api.todaysWrittenSets(ids), RPC_TIMEOUT_MS, 'todaysWrittenSets')
      .then(sets => {
        for (const w of sets) {
          apply(
            {
              type: 'seedHighWater',
              athleteId: w.athleteId,
              workoutInstanceId: w.workoutInstanceId,
              routineExerciseId: w.routineExerciseId,
              setNumber: w.setNumber,
            },
            now(),
          );
        }
        ids.forEach(id => seeded.add(id));
        notify();
      })
      .catch(e => {
        log(`seed preload failed; retrying in ${SEED_RETRY_MS} ms`, e);
        if (running) seedRetry = setTimeout(() => ((seedRetry = null), preloadSeeds()), SEED_RETRY_MS);
      })
      .finally(() => {
        seedInFlight = false;
        if (seedAgain) {
          seedAgain = false;
          preloadSeeds();
        }
      });
  };

  // ---------------------------------------------------------------- reduce

  const apply = (event: RackEvent, at: number) => {
    const before = state.activeAthleteId;
    const ctxBefore = state.mode === 'rack' ? `${state.setState}|${ctxKey(nextContext(state))}` : '';
    const targetBefore = repTarget();
    const res = reduce(state, event, at);
    state = res.state;
    if (res.effects.length) {
      const effects = res.effects;
      effectChain = effectChain.then(() => runEffects(effects)).catch(e => log('effects failed', e));
    }
    const target = repTarget();
    // Refresh right away on an active/switch-target change (the phone may have
    // logged sets since the last preload). Non-blocking.
    if ((target !== targetBefore || state.activeAthleteId !== before) && (target || state.activeAthleteId)) {
      preloadSeeds();
    }
    if (state.activeAthleteId !== before) {
      if (override && override.athleteId !== state.activeAthleteId) override = null;
      pushLocalContext();
    }
    if (event.type !== 'loadChanged' && (event.type !== 'tick' || `${state.setState}|${ctxKey(nextContext(state))}` !== ctxBefore)) deriveLoad();
    notify();
  };

  // ---------------------------------------------------------------- derived load

  const ctxKey = (c: RackContext) => `${c.workoutInstanceId}:${c.routineExerciseId}:${c.exerciseId}:${c.setNumber}:${c.loadLb}`;
  /** Last logged weight per `${athleteId}:${exerciseId}` (null = none logged). */
  const lastWeight = new Map<string, number | null>();
  const weightInFlight = new Set<string>();
  const weightFailedAt = new Map<string, number>();

  const findExercise = (athleteId: string, c: RackContext): TodayExercise | undefined => {
    const a = today.find(t => t.athleteId === athleteId);
    if (!a) return undefined;
    if (c.routineExerciseId) {
      const e = a.exercises.find(
        x => x.routineExerciseId === c.routineExerciseId && (!c.workoutInstanceId || x.workoutInstanceId === c.workoutInstanceId),
      );
      if (e) return e;
    }
    return c.exerciseId ? a.exercises.find(x => x.exerciseId === c.exerciseId) : undefined;
  };

  const cachedLastWeight = (athleteId: string, exerciseId: string): number | null => {
    const k = `${athleteId}:${exerciseId}`;
    if (lastWeight.has(k)) return lastWeight.get(k) ?? null;
    const failed = weightFailedAt.get(k);
    if (!api.lastLoggedWeight || weightInFlight.has(k) || (failed != null && now() - failed < WEIGHT_RETRY_MS)) return null;
    weightInFlight.add(k);
    withTimeout(api.lastLoggedWeight(athleteId, exerciseId), RPC_TIMEOUT_MS, 'lastLoggedWeight')
      .then(w => {
        lastWeight.set(k, w);
        weightFailedAt.delete(k);
      })
      .catch(e => {
        weightFailedAt.set(k, now());
        log('last logged weight failed', e);
      })
      .finally(() => {
        weightInFlight.delete(k);
        deriveLoad();
        notify();
      });
    return null;
  };

  /**
   * Load when the phone gave none (spec §3): the plan's prescribed weight for
   * that routine exercise / set, else the athlete's last logged weight for the
   * exercise. Dispatched as `loadChanged` (sensor + the set row's weight). A
   * phone load always wins (the engine prefers the context's load).
   */
  const deriveLoad = () => {
    if (state.mode !== 'rack' || state.setState === 'lifting') return;
    const id = state.activeAthleteId;
    let lb: number | null = null;
    if (id) {
      const c = nextContext(state);
      if (c.loadLb == null && (c.routineExerciseId || c.exerciseId)) {
        const ex = findExercise(id, c);
        lb = ex ? prescribedWeightFor(ex, nextSetNumber(state, id)) : null;
        const exerciseId = c.exerciseId ?? ex?.exerciseId ?? null;
        if (lb == null && exerciseId) lb = cachedLastWeight(id, exerciseId);
      }
    }
    if (lb !== state.loadOverrideLb) apply({ type: 'loadChanged', lb }, now());
  };

  const dispatch = (event: RackEvent, atMs?: number) => apply(event, atMs ?? now());

  // ---------------------------------------------------------------- today

  const pushLocalContext = () => {
    if (state.mode !== 'rack') return;
    const id = state.activeAthleteId;
    if (!id) return;
    const a = today.find(t => t.athleteId === id);
    if (!a) return;
    const row = state.session;
    const picked =
      override && override.athleteId === id && a.remaining.some(r => sameExercise(r, override!.ex)) ? override.ex : null;
    const ex = picked ?? pickLocalExercise(a, [row?.workout_instance_id, row?.pending_workout_instance_id]);
    if (!ex) return;
    // The engine uses it only while the server row has no workout context.
    apply(
      {
        type: 'localContext',
        athleteId: id,
        workoutInstanceId: ex.workoutInstanceId,
        routineExerciseId: ex.routineExerciseId,
        exerciseId: ex.exerciseId,
        setNumber: null,
        loadLb: null,
        zoneMin: ex.zoneMin,
        zoneMax: ex.zoneMax,
        dropStopPct: ex.dropStopPct,
      },
      now(),
    );
  };

  const sameExercise = (x: TodayExercise, y: TodayExercise) =>
    x.workoutInstanceId === y.workoutInstanceId && x.routineExerciseId === y.routineExerciseId;
  let override: { athleteId: string; ex: TodayExercise } | null = null;

  const setOverride = (athleteId: string, ex: TodayExercise | null) => {
    override = ex ? { athleteId, ex } : override?.athleteId === athleteId ? null : override;
    if (athleteId === state.activeAthleteId) pushLocalContext();
    notify();
  };

  const setToday = (athletes: TodayAthlete[]) => {
    today = athletes;
    for (const a of athletes) {
      for (const ex of a.exercises) {
        apply(
          {
            type: 'contextMeta',
            exerciseId: ex.exerciseId,
            routineExerciseId: ex.routineExerciseId,
            zoneMin: ex.zoneMin,
            zoneMax: ex.zoneMax,
            dropStopPct: ex.dropStopPct,
          },
          now(),
        );
      }
    }
    pushLocalContext();
    preloadSeeds();
  };

  // ---------------------------------------------------------------- lifecycle

  return {
    dispatch,
    getState: () => state,
    isSyncing,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setToday,
    setOverride,
    flush: () => flushSoon(true),
    async endLive() {
      if (state.setState === 'lifting') dispatch({ type: 'ipadDone' });
      // Wait for the EFFECT chain only (the set row is queued there); the
      // rpcEndSet round trip can take its full timeout offline.
      for (let i = 0; i < 20; i++) {
        const e = effectChain;
        await e;
        if (e === effectChain) return;
      }
    },
    unsavedCount: () => ({ reps: unsavedReps.length, sets: unsavedSets.length }),
    start() {
      if (running) return;
      running = true;
      timers.push(setInterval(() => dispatch({ type: 'tick' }), TICK_MS));
      timers.push(setInterval(() => flushSoon(), FLUSH_MS));
      timers.push(setInterval(preloadSeeds, SEED_REFRESH_MS));
      flushSoon();
      preloadSeeds();
    },
    stop() {
      running = false;
      timers.forEach(clearInterval);
      timers = [];
      if (seedRetry) clearTimeout(seedRetry);
      seedRetry = null;
    },
    async idle() {
      // Effects can enqueue RPCs and RPCs can dispatch more effects: settle both.
      for (let i = 0; i < 20; i++) {
        const e = effectChain;
        const r = rpcChain;
        await e;
        await r;
        if (e === effectChain && r === rpcChain) return;
      }
    },
  };
}
