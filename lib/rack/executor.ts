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

import { nextContext, nextSetNumber, nextSetNumberFor, reduce, type RackEffect, type RackEngineState, type RackEvent, type RpcKind } from './engine';
import type { RackContext, RackSessionRow, SetSummary, RepWrite } from './engine';
import { pickRackLift, prescribedWeightFor, percentWeightTarget, type TodayAthlete, type TodayExercise, type WrittenSet } from './api';
import { intensityFor, type LoggedSets } from '../logger/targets';
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
  /** Today's logged weight per set number (resolves "% of set N"). Optional (tests). */
  loggedWeights?(workoutInstanceId: string, routineExerciseId: string): Promise<Record<number, number>>;
  /** Athlete maxes exercise → metric → value (resolves "% of max"). Optional (tests). */
  athleteMaxes?(athleteId: string, exerciseIds: string[]): Promise<Record<string, Record<string, number>>>;
  /** Publish the iPad's pick to rack_sessions (unison with the phone). Optional (tests). */
  setIpadContext?(
    rackId: string,
    athleteId: string,
    ctx: { workoutInstanceId: string | null; routineExerciseId: string | null; setNumber: number | null; loadLb: number | null },
  ): Promise<RackSessionRow>;
}

/** A failed rack_set_ipad_context is retried after this long. */
export const PUBLISH_RETRY_MS = 10_000;

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
  /** The active athlete's context is the iPad's (its pick / a coach
   *  override, published to rack_sessions) — not the phone's. */
  ipadOwnsContext(): boolean;
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
          if (fx.summary.loadLb != null && fx.summary.setNumber != null && fx.summary.workoutInstanceId && fx.summary.routineExerciseId) {
            const lk = `${fx.summary.workoutInstanceId}:${fx.summary.routineExerciseId}`;
            const prev = logged.get(lk);
            if (prev) logged.set(lk, { ...prev, [fx.summary.setNumber]: fx.summary.loadLb });
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
      published = null;
      lastAttemptKey = null;
      pushLocalContext();
    } else if (event.type === 'sessionSync' && override && !publishInFlight && phoneOwnsRow()) {
      // The phone moved the athlete on: its pick wins over an older coach override.
      override = null;
    }
    const changed = event.type !== 'tick' || `${state.setState}|${ctxKey(nextContext(state))}` !== ctxBefore;
    if (event.type !== 'loadChanged' && changed) deriveLoad();
    if (event.type !== 'loadChanged' && (changed || (publishFailedAt != null && now() - publishFailedAt >= PUBLISH_RETRY_MS))) {
      publishIfNeeded();
    }
    notify();
  };

  // ---------------------------------------------------------------- unison: publish the iPad's context

  type Pub = { athleteId: string; workoutInstanceId: string; routineExerciseId: string; setNumber: number | null; loadLb: number | null };
  /** What the iPad last published for the active athlete (null = nothing / phone-owned). */
  let published: Pub | null = null;
  let lastAttemptKey: string | null = null;
  let publishInFlight = false;
  let publishFailedAt: number | null = null;

  /** The row's context for the NEXT set (pending wins — same rule as the engine). */
  const rowNext = () => {
    const r = state.session;
    if (!r) return null;
    const pending =
      r.pending_workout_instance_id != null || r.pending_routine_exercise_id != null || r.pending_set_number != null || r.pending_load_lb != null;
    return pending
      ? { wi: r.pending_workout_instance_id, re: r.pending_routine_exercise_id, set: r.pending_set_number, load: r.pending_load_lb }
      : { wi: r.workout_instance_id, re: r.routine_exercise_id, set: r.set_number, load: r.load_lb };
  };

  /** The row's exercise is the iPad's (empty, or what the iPad last published). */
  const ipadOwnsContext = (): boolean => {
    const id = state.activeAthleteId;
    const r = state.session;
    if (!id || !r || r.active_athlete_id !== id) return false;
    const n = rowNext();
    if (!n || n.wi == null) return true;
    return !!published && published.athleteId === id && published.workoutInstanceId === n.wi && published.routineExerciseId === n.re;
  };
  const phoneOwnsRow = () => {
    const n = rowNext();
    return !!n && n.wi != null && !ipadOwnsContext();
  };

  /**
   * Publish the iPad's context (its rack-lift pick or a coach override) with
   * the set number and load, via rack_set_ipad_context — so the phone follows.
   * Never echoes the phone's context: when the row's exercise came from the
   * phone (not what the iPad published), nothing is sent. Per field, a value
   * the phone changed since the iPad's publish (set number, load) is kept.
   */
  const publishIfNeeded = () => {
    if (state.mode !== 'rack' || !state.rackId || !api.setIpadContext || publishInFlight) return;
    const id = state.activeAthleteId;
    const local = state.localContext;
    if (!id || !local || local.athleteId !== id || local.workoutInstanceId == null || local.routineExerciseId == null) return;
    const r = state.session;
    if (!r || r.active_athlete_id !== id) return;
    const coach = !!override && override.athleteId === id && override.ex.workoutInstanceId === local.workoutInstanceId && override.ex.routineExerciseId === local.routineExerciseId;
    if (!ipadOwnsContext() && !coach) return; // the phone's context: never echo it
    const n = rowNext();
    const sameEx = !!n && n.wi === local.workoutInstanceId && n.re === local.routineExerciseId;
    const mine = published && published.athleteId === id ? published : null;
    // Fields the phone changed after the iPad's publish stay the phone's.
    const phoneSet = sameEx && n!.set != null && mine && n!.set !== mine.setNumber ? n!.set : null;
    const phoneLoad = sameEx && n!.load != null && mine && n!.load !== mine.loadLb ? Number(n!.load) : null;
    const want: Pub = {
      athleteId: id,
      workoutInstanceId: local.workoutInstanceId,
      routineExerciseId: local.routineExerciseId,
      setNumber: phoneSet ?? nextSetNumberFor(state, id, { ...local, setNumber: sameEx ? n!.set : null, loadLb: null }),
      loadLb: phoneLoad ?? derivedLb,
    };
    if (sameEx && n!.set === want.setNumber && (n!.load == null ? null : Number(n!.load)) === want.loadLb) {
      published = want;
      return;
    }
    const key = `${id}:${want.workoutInstanceId}:${want.routineExerciseId}:${want.setNumber}:${want.loadLb}`;
    if (key === lastAttemptKey && publishFailedAt == null) return; // sent; the DB may have declined (not active)
    if (publishFailedAt != null && key === lastAttemptKey && now() - publishFailedAt < PUBLISH_RETRY_MS) return;
    lastAttemptKey = key;
    publishInFlight = true;
    published = want;
    const rackId = state.rackId;
    withTimeout(
      api.setIpadContext(rackId, id, {
        workoutInstanceId: want.workoutInstanceId,
        routineExerciseId: want.routineExerciseId,
        setNumber: want.setNumber,
        loadLb: want.loadLb,
      }),
      RPC_TIMEOUT_MS,
      'setIpadContext',
    )
      .then(row => {
        publishFailedAt = null;
        publishInFlight = false;
        if (row) dispatch({ type: 'sessionSync', row });
      })
      .catch(e => {
        log('setIpadContext failed', e);
        publishFailedAt = now();
        publishInFlight = false;
      });
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
  /** Load the iPad derived for the next set (published with its context). */
  let derivedLb: number | null = null;

  /** Today's logged weights per `${wi}:${re}` ({setNumber: lb}). */
  const logged = new Map<string, Record<number, number>>();
  /** Athlete maxes per athlete. */
  const maxes = new Map<string, Record<string, Record<string, number>>>();
  const cacheInFlight = new Set<string>();
  const cacheFailedAt = new Map<string, number>();

  /** One cached read per key; re-derives when it lands. */
  function cachedRead<T>(map: Map<string, T>, key: string, read: (() => Promise<T>) | null): T | undefined {
    if (map.has(key)) return map.get(key);
    const ck = `${map === (logged as unknown) ? 'l' : 'm'}:${key}`;
    const failed = cacheFailedAt.get(ck);
    if (!read || cacheInFlight.has(ck) || (failed != null && now() - failed < WEIGHT_RETRY_MS)) return undefined;
    cacheInFlight.add(ck);
    withTimeout(read(), RPC_TIMEOUT_MS, ck)
      .then(v => {
        map.set(key, v);
        cacheFailedAt.delete(ck);
      })
      .catch(e => {
        cacheFailedAt.set(ck, now());
        log('rack load lookup failed', ck, e);
      })
      .finally(() => {
        cacheInFlight.delete(ck);
        deriveLoad();
        publishIfNeeded();
        notify();
      });
    return undefined;
  }

  /**
   * Weight for set `setNumber` of `ex`: a % target ("90% of set 1", "% of
   * max") resolved like logger v2 (lib/logger/targets) from today's logged
   * weights / the athlete's maxes; else the plan's fixed weight. `percent`
   * true = a % target that can't be resolved yet (no fallback: the phone sets it).
   */
  const planWeight = (athleteId: string, ex: TodayExercise, setNumber: number | null): { lb: number | null; percent: boolean } => {
    const setIndex = (setNumber ?? 1) - 1;
    const target = percentWeightTarget(ex, setNumber);
    if (target && ex.plan) {
      const lk = `${ex.workoutInstanceId}:${ex.routineExerciseId}`;
      const bySet = cachedRead(logged, lk, api.loggedWeights ? () => api.loggedWeights!(ex.workoutInstanceId, ex.routineExerciseId) : null);
      const loggedSets: LoggedSets = {};
      for (const [n, w] of Object.entries(bySet ?? {})) loggedSets[Number(n) - 1] = { weight: w };
      // Maxes for every exercise the athlete has today (+ cross-exercise sources), one read per athlete.
      const athleteMaxes = cachedRead(maxes, athleteId, api.athleteMaxes ? () => api.athleteMaxes!(athleteId, maxExerciseIds(athleteId)) : null);
      const r = intensityFor({ re: ex.plan as any, setIndex, metric: 'weight', maxes: athleteMaxes ?? {}, logged: loggedSets });
      return { lb: r?.calculatedValue ?? null, percent: true };
    }
    return { lb: prescribedWeightFor(ex, setNumber), percent: false };
  };

  const maxExerciseIds = (athleteId: string): string[] => {
    const ids = new Set<string>();
    for (const e of today.find(t => t.athleteId === athleteId)?.exercises ?? []) {
      ids.add(e.exerciseId);
      const p = e.plan;
      for (const t of [...(p?.intensity_targets ?? []), ...(p?.set_configurations ?? []).flatMap(c => c?.intensity_targets ?? [])]) {
        if (t?.source_exercise_id) ids.add(t.source_exercise_id);
      }
    }
    return [...ids];
  };

  const deriveLoad = () => {
    if (state.mode !== 'rack' || state.setState === 'lifting') return;
    const id = state.activeAthleteId;
    let lb: number | null = null;
    if (id) {
      const c = nextContext(state);
      // A phone load wins; a load the iPad itself published is re-derived.
      const phoneLoad = c.loadLb != null && !ipadOwnsContext();
      if (!phoneLoad && (c.routineExerciseId || c.exerciseId)) {
        const ex = findExercise(id, c);
        const plan = ex ? planWeight(id, ex, nextSetNumber(state, id)) : { lb: null, percent: false };
        lb = plan.lb;
        const exerciseId = c.exerciseId ?? ex?.exerciseId ?? null;
        if (lb == null && !plan.percent && exerciseId) lb = cachedLastWeight(id, exerciseId);
      }
    }
    derivedLb = lb;
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
    // Auto-pick only RACK LIFTS (weight-tracked or zoned); a coach can pick anything.
    const ex = picked ?? pickRackLift(a, [row?.workout_instance_id, row?.pending_workout_instance_id]);
    if (!ex) {
      // Nothing to auto-pick: clear any older pick (reps go in as a free set;
      // the card prompts "Pick an exercise").
      if (state.localContext && state.localContext.athleteId === id && state.localContext.workoutInstanceId != null) {
        apply(
          { type: 'localContext', athleteId: id, workoutInstanceId: null, routineExerciseId: null, exerciseId: null, setNumber: null, loadLb: null, zoneMin: null, zoneMax: null, dropStopPct: null },
          now(),
        );
      }
      return;
    }
    // The engine uses it only while the server row has no workout context;
    // publishIfNeeded puts it in the row (unison with the phone).
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
    // Fresh reads for % loads (the phone may have logged / edited sets).
    logged.clear();
    maxes.clear();
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
    ipadOwnsContext,
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
