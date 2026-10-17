// Rack executor: owns the engine state, reduces events, and runs the engine's
// effects against the world (sensor, persistence queues, rack RPCs).
//
// Contract (task-6 report, fix rounds 1–2):
//   - Effects run IN ORDER on one serial chain. Persistence effects (writeRep,
//     endSet, amendSet) are awaited — "awaited" = durably enqueued, not sent.
//   - RPC effects are started in order on their own serial chain, once every
//     effect before them has run, so `rpcEndSet` always goes out after the
//     preceding `endSet` is on disk. The effect chain does not wait for the
//     RPC's round trip. RPCs time out after 10 s (→ rpcFailed).
//   - An RPC's returned row is dispatched as `sessionSync` BEFORE
//     `rpcSettled`; an error dispatches `rpcFailed`. rpcSetActive is never
//     queued offline — it just fails.
//   - Seed (high-water): whenever the athlete reps would be credited to (the
//     tile being switched to, else the active athlete) changes — and on start —
//     today's written sets are fetched and dispatched as `seedHighWater`.
//     Until that athlete's seed SUCCEEDS, `rep` events are held here (in
//     order, with their original timestamps); the seed retries every 2 s with
//     no cap. Nothing else is held: syncs, taps, Done and ticks go straight
//     to the engine. A Done that arrives while reps are held is applied now
//     AND replayed after those reps, so the set they start still ends on it.
//     `isSyncing()` is true meanwhile (UI "Syncing…" pill).
//     Held reps are in memory only: an app kill while the seed is unavailable
//     loses exactly those reps (everything already enqueued is on disk).
//   - `tick` every 1 s; both queues flushed on start, every 15 s (the app has
//     no NetInfo), after each enqueue, and on `flush()` (realtime reconnect).

import { reduce, type RackEffect, type RackEngineState, type RackEvent, type RpcKind } from './engine';
import type { RackSessionRow, SetSummary, RepWrite } from './engine';
import { pickLocalExercise, type TodayAthlete, type WrittenSet } from './api';
import { withTimeout, type RackPersist } from './persist';

export const TICK_MS = 1_000;
export const FLUSH_MS = 15_000;
export const SEED_RETRY_MS = 2_000;
/** A successful seed younger than this is not re-run on a re-activation. */
export const SEED_FRESH_MS = 60_000;
export const RPC_TIMEOUT_MS = 10_000;

export interface ExecutorApi {
  startSet(rackId: string, athleteId: string, startedAt: string): Promise<RackSessionRow>;
  setActive(rackId: string, athleteId: string): Promise<RackSessionRow>;
  endSet(rackId: string, athleteId: string): Promise<RackSessionRow>;
  todaysWrittenSets(athleteIds: string[]): Promise<WrittenSet[]>;
}

export type ExecutorPersist = Pick<RackPersist, 'writeRep' | 'endSet' | 'amendSet'> & {
  flush(opts?: { force?: boolean }): Promise<void>;
};

export interface ExecutorSensor {
  writeLoad(lb: number): Promise<void>;
}

export interface RackExecutor {
  /** Reduce one event. `rep` is held while its athlete's seed is pending. */
  dispatch(event: RackEvent, atMs?: number): void;
  getState(): RackEngineState;
  /** true while reps are held / the seed for the rep athlete is pending. */
  isSyncing(): boolean;
  /** Called on every state or syncing change. */
  subscribe(listener: (s: RackEngineState, syncing: boolean) => void): () => void;
  /** Today's athletes: dispatches contextMeta for every exercise and the
   *  iPad's localContext pick for the active athlete. */
  setToday(athletes: TodayAthlete[]): void;
  /** Flush both queues now, ignoring back-off (e.g. realtime reconnect). */
  flush(): void;
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

type Held = { event: RackEvent; at: number };
type Seed = {
  token: number;
  status: 'pending' | 'done';
  doneAt: number;
  inFlight: boolean;
  retry: ReturnType<typeof setTimeout> | null;
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

  const seeds = new Map<string, Seed>();
  let seedSeq = 0;
  const held: Held[] = [];
  /** Reps whose enqueue failed (storage error) — retried on every flush. */
  const unsavedReps: RepWrite[] = [];

  const repTarget = () => state.switchingTo ?? state.activeAthleteId;
  const repReady = () => {
    const t = repTarget();
    return !t || seeds.get(t)?.status === 'done';
  };
  const isSyncing = () => {
    const t = repTarget();
    return held.length > 0 || (!!t && seeds.get(t)?.status === 'pending');
  };
  const notify = () => {
    const syncing = isSyncing();
    listeners.forEach(l => l(state, syncing));
  };

  // ---------------------------------------------------------------- effects

  const flushSoon = (force = false) => {
    (async () => {
      while (unsavedReps.length) {
        await persist.writeRep(unsavedReps[0]);
        unsavedReps.shift();
      }
      await persist.flush(force ? { force } : undefined);
    })().catch(e => log('flush failed', e));
  };

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

  const writeRepDurably = async (rep: RepWrite) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await persist.writeRep(rep);
        return;
      } catch (e) {
        if (attempt === 3) {
          log('writeRep enqueue failed; kept in memory for the next flush', e, rep.clientRepId);
          unsavedReps.push(rep);
        }
      }
    }
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
          await writeRepDurably(fx.rep);
          flushSoon();
          break;
        case 'endSet':
        case 'amendSet':
          if (fx.summary.free) break; // free sets: vbt_reps only
          try {
            const s = withExercise(fx.summary);
            await (fx.type === 'endSet' ? persist.endSet(s) : persist.amendSet(s));
            setWriteFailed = false;
            flushSoon();
          } catch (e) {
            setWriteFailed = true;
            log(`${fx.type} enqueue failed`, e);
          }
          break;
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

  // ---------------------------------------------------------------- seed

  const runSeed = (athleteId: string, token: number) => {
    const current = () => {
      const s = seeds.get(athleteId);
      return s && s.token === token ? s : null;
    };
    const mine = current();
    if (!mine || mine.inFlight) return;
    mine.inFlight = true;
    withTimeout(api.todaysWrittenSets([athleteId]), RPC_TIMEOUT_MS, 'todaysWrittenSets')
      .then(sets => {
        const s = current();
        if (!s) return; // superseded by a newer seed for this athlete
        s.inFlight = false;
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
        s.status = 'done';
        s.doneAt = now();
        releaseReps();
        notify();
      })
      .catch(e => {
        const s = current();
        if (!s) return;
        s.inFlight = false;
        log(`seed for ${athleteId} failed; retrying in ${SEED_RETRY_MS} ms`, e);
        if (!running) return; // start() resumes pending seeds
        s.retry = setTimeout(() => {
          s.retry = null;
          if (current()) runSeed(athleteId, token);
        }, SEED_RETRY_MS);
      });
  };

  const ensureSeed = (athleteId: string | null) => {
    if (!athleteId) return;
    const s = seeds.get(athleteId);
    if (s?.status === 'pending') return;
    if (s?.status === 'done' && now() - s.doneAt < SEED_FRESH_MS) return;
    const token = ++seedSeq;
    if (s?.retry) clearTimeout(s.retry);
    seeds.set(athleteId, { token, status: 'pending', doneAt: 0, inFlight: false, retry: null });
    runSeed(athleteId, token);
    notify();
  };

  // ---------------------------------------------------------------- reduce

  const apply = (event: RackEvent, at: number) => {
    const before = state.activeAthleteId;
    const targetBefore = repTarget();
    const res = reduce(state, event, at);
    state = res.state;
    if (res.effects.length) {
      const effects = res.effects;
      effectChain = effectChain.then(() => runEffects(effects)).catch(e => log('effects failed', e));
    }
    if (repTarget() !== targetBefore) ensureSeed(repTarget());
    if (state.activeAthleteId !== before) pushLocalContext();
    notify();
  };

  const releaseReps = () => {
    while (held.length && repReady()) {
      const h = held.shift()!;
      apply(h.event, h.at);
    }
  };

  const dispatch = (event: RackEvent, atMs?: number) => {
    const at = atMs ?? now();
    if (event.type === 'rep') {
      if (held.length || !repReady()) {
        held.push({ event, at });
        notify();
        return;
      }
      apply(event, at);
      return;
    }
    if ((event.type === 'ipadDone' || event.type === 'done') && held.length) {
      apply(event, at);
      held.push({ event, at }); // also ends the set the held reps will start
      return;
    }
    apply(event, at);
    releaseReps();
  };

  // ---------------------------------------------------------------- today

  const pushLocalContext = () => {
    if (state.mode !== 'rack') return;
    const id = state.activeAthleteId;
    if (!id) return;
    const a = today.find(t => t.athleteId === id);
    if (!a) return;
    const row = state.session;
    const ex = pickLocalExercise(a, [row?.workout_instance_id, row?.pending_workout_instance_id]);
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
    flush: () => flushSoon(true),
    start() {
      if (running) return;
      running = true;
      timers.push(setInterval(() => dispatch({ type: 'tick' }), TICK_MS));
      timers.push(setInterval(() => flushSoon(), FLUSH_MS));
      flushSoon();
      // Resume seeds requested before start (or interrupted by stop).
      for (const [id, s] of seeds) if (s.status === 'pending' && !s.retry && !s.inFlight) runSeed(id, s.token);
      ensureSeed(repTarget());
    },
    stop() {
      running = false;
      timers.forEach(clearInterval);
      timers = [];
      for (const s of seeds.values()) {
        if (s.retry) clearTimeout(s.retry);
        s.retry = null;
      }
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
