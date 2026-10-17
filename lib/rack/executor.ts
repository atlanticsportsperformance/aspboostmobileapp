// Rack executor: owns the engine state, reduces events, and runs the engine's
// effects against the world (sensor, persistence queues, rack RPCs).
//
// Contract (task-6 report, fix rounds 1–2):
//   - Effects run IN ORDER on one serial chain. Persistence effects (writeRep,
//     endSet, amendSet) are awaited — "awaited" = durably enqueued, not sent.
//   - RPC effects are started in order on their own serial chain, once every
//     effect before them has run, so `rpcEndSet` always goes out after the
//     preceding `endSet` is on disk. The effect chain does not wait for the
//     RPC's round trip (reps keep being queued while it is in flight).
//   - An RPC's returned row is dispatched as `sessionSync` BEFORE
//     `rpcSettled`; an error dispatches `rpcFailed`. rpcSetActive is never
//     queued offline — it just fails.
//   - Seed: on start and whenever the active athlete changes, today's written
//     sets are fetched and dispatched as `seedHighWater` before any later
//     event reaches the engine (events are held, in order, up to 3 s; after
//     that they proceed and the late seed still applies).
//   - `tick` every 1 s; both queues flushed on start, every 15 s (the app has
//     no NetInfo) and after each enqueue.

import { reduce, type RackEffect, type RackEngineState, type RackEvent, type RpcKind } from './engine';
import type { RackSessionRow } from './engine';
import type { TodayAthlete, WrittenSet } from './api';
import type { RackPersist } from './persist';

export const SEED_TIMEOUT_MS = 3_000;
export const TICK_MS = 1_000;
export const FLUSH_MS = 15_000;

export interface ExecutorApi {
  startSet(rackId: string, athleteId: string, startedAt: string): Promise<RackSessionRow>;
  setActive(rackId: string, athleteId: string): Promise<RackSessionRow>;
  endSet(rackId: string, athleteId: string): Promise<RackSessionRow>;
  todaysWrittenSets(athleteIds: string[]): Promise<WrittenSet[]>;
}

export type ExecutorPersist = Pick<RackPersist, 'writeRep' | 'endSet' | 'amendSet' | 'flush'>;

export interface ExecutorSensor {
  writeLoad(lb: number): Promise<void>;
}

export interface RackExecutor {
  /** Reduce one event (held while a seed is pending; `tick` is skipped then). */
  dispatch(event: RackEvent, atMs?: number): void;
  getState(): RackEngineState;
  subscribe(listener: (s: RackEngineState) => void): () => void;
  /** Today's athletes: dispatches contextMeta for every exercise and the
   *  iPad's localContext pick for the active athlete. */
  setToday(athletes: TodayAthlete[]): void;
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
  const listeners = new Set<(s: RackEngineState) => void>();
  let effectChain: Promise<void> = Promise.resolve();
  let rpcChain: Promise<void> = Promise.resolve();
  let today: TodayAthlete[] = [];
  let timers: ReturnType<typeof setInterval>[] = [];

  // Seed gate: while set, events are held in arrival order.
  let gate: { athleteId: string; held: { event: RackEvent; at: number }[] } | null = null;
  let seedTimer: ReturnType<typeof setTimeout> | null = null;
  // Last athlete a seed ran for: the sync confirming a tile tap (already
  // seeded at the tap) doesn't seed again.
  let lastSeeded: string | null = null;

  const notify = () => listeners.forEach(l => l(state));

  // ---------------------------------------------------------------- effects

  const flushSoon = () => {
    persist.flush().catch(e => log('flush failed', e));
  };

  const runRpc = (effect: Extract<RackEffect, { type: 'rpcStartSet' | 'rpcSetActive' | 'rpcEndSet' }>) => {
    const rackId = state.rackId;
    const kind = RPC_KIND[effect.type];
    const athleteId = effect.athleteId;
    rpcChain = rpcChain.then(async () => {
      if (!rackId) return; // solo engines emit no rack RPCs
      let row: RackSessionRow;
      try {
        row =
          effect.type === 'rpcStartSet'
            ? await api.startSet(rackId, athleteId, effect.setStartedAt)
            : effect.type === 'rpcSetActive'
              ? await api.setActive(rackId, athleteId)
              : await api.endSet(rackId, athleteId);
      } catch (e) {
        log(`${kind} failed`, e);
        dispatch({ type: 'rpcFailed', kind, athleteId });
        return;
      }
      if (row) dispatch({ type: 'sessionSync', row });
      dispatch({ type: 'rpcSettled', kind, athleteId });
    });
  };

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
          try {
            await persist.writeRep(fx.rep);
            flushSoon();
          } catch (e) {
            log('writeRep enqueue failed', e, fx.rep.clientRepId);
          }
          break;
        case 'endSet':
        case 'amendSet':
          if (fx.summary.free) break; // free sets: vbt_reps only
          try {
            await (fx.type === 'endSet' ? persist.endSet(fx.summary) : persist.amendSet(fx.summary));
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

  // ---------------------------------------------------------------- reduce

  const apply = (event: RackEvent, at: number) => {
    const before = state.activeAthleteId;
    const res = reduce(state, event, at);
    state = res.state;
    notify();
    if (res.effects.length) {
      const effects = res.effects;
      effectChain = effectChain.then(() => runEffects(effects)).catch(e => log('effects failed', e));
    }
    if (state.activeAthleteId !== before) {
      if (state.activeAthleteId !== lastSeeded) lastSeeded = null;
      pushLocalContext();
    }
  };

  /** Athlete this event makes active (→ seed first), if any. */
  const seedTargetOf = (event: RackEvent): string | null => {
    if (event.type === 'sessionSync') {
      const next = event.row.active_athlete_id;
      return next && next !== state.activeAthleteId && next !== lastSeeded ? next : null;
    }
    return null;
  };

  const openGate = (athleteId: string) => {
    gate = { athleteId, held: [] };
    lastSeeded = athleteId;
    let landed = false;
    const release = () => {
      if (!gate || gate.athleteId !== athleteId) return;
      if (seedTimer) clearTimeout(seedTimer);
      seedTimer = null;
      const held = gate.held;
      gate = null;
      for (let i = 0; i < held.length; i++) {
        if (gate) {
          // A held event opened a new gate: keep the rest behind it.
          (gate as { held: { event: RackEvent; at: number }[] }).held.push(...held.slice(i));
          break;
        }
        dispatch(held[i].event, held[i].at);
      }
    };
    seedTimer = setTimeout(() => {
      if (!landed) log(`seed for ${athleteId} not back after ${SEED_TIMEOUT_MS} ms; proceeding`);
      release();
    }, SEED_TIMEOUT_MS);
    api
      .todaysWrittenSets([athleteId])
      .then(sets => {
        landed = true;
        // Applied directly (bypasses the gate); harmless if late — max().
        for (const s of sets) {
          apply(
            {
              type: 'seedHighWater',
              athleteId: s.athleteId,
              workoutInstanceId: s.workoutInstanceId,
              routineExerciseId: s.routineExerciseId,
              setNumber: s.setNumber,
            },
            now(),
          );
        }
      })
      .catch(e => log('seed failed', e))
      .finally(release);
  };

  const dispatch = (event: RackEvent, atMs?: number) => {
    const at = atMs ?? now();
    if (gate) {
      if (event.type !== 'tick') gate.held.push({ event, at });
      return;
    }
    const target = seedTargetOf(event);
    if (target) {
      openGate(target);
      gate!.held.push({ event, at });
      return;
    }
    apply(event, at);
    // A tile tap: seed the chosen athlete before the confirming sync lands.
    if (event.type === 'selectAthlete' && event.athleteId !== state.activeAthleteId && !gate) {
      openGate(event.athleteId);
    }
  };

  // ---------------------------------------------------------------- today

  const pushLocalContext = () => {
    if (state.mode !== 'rack') return;
    const id = state.activeAthleteId;
    if (!id) return;
    const a = today.find(t => t.athleteId === id);
    const ex = a?.remaining[0];
    if (!a || !ex) return;
    // The engine uses it only while the server row has no workout context.
    apply(
      {
        type: 'localContext',
        athleteId: id,
        workoutInstanceId: a.workoutInstanceId,
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
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setToday,
    start() {
      if (timers.length) return;
      timers.push(setInterval(() => dispatch({ type: 'tick' }), TICK_MS));
      timers.push(setInterval(flushSoon, FLUSH_MS));
      flushSoon();
      if (state.activeAthleteId && !gate) openGate(state.activeAthleteId);
    },
    stop() {
      timers.forEach(clearInterval);
      timers = [];
      if (seedTimer) clearTimeout(seedTimer);
      seedTimer = null;
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
