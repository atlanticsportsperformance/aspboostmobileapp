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
//   - Exercise + set come from resolveRackSet (the same function the phone
//     runs) over the executor's cached exercise_logs: on every set start, and
//     between sets on every event (sessionSync, today, override, log refresh).
//     The answer goes to the engine as a resolved `localContext` and is
//     published with rack_set_ipad_context (unison). At a set start the live
//     set's context is published BEFORE rack_start_set when the row differs,
//     so the phone's live row is the rack's set.
//   - Logs: ONE athlete at a time (the active / switching-to one) through
//     rack_athlete_sets, read only when that athlete changes, when the
//     phone's set / exercise in the row moves, when a set ends, and before a
//     set start whose logs are older than 2 s. Never on every row. Each read
//     REPLACES the engine's complete-set guard (`replaceComplete`) with the
//     read's complete rows + the rack's own writes not confirmed yet.
//   - The row's set number from the phone (anything the iPad didn't publish
//     itself) is always the resolver's "everything below is done" hint.
//   - A first rep whose athlete's logs are stale waits (≤ 1.5 s) for the
//     read; meanwhile EVERY event (ticks, rows, Done, taps, coach picks) is
//     queued and replayed in order. `isSyncing()` = the rep athlete's logs
//     haven't loaded yet (UI).
//   - `tick` every 1 s; both queues flushed (serialized) on start, every 15 s
//     (the app has no NetInfo), after each enqueue, and on `flush()`.

import { IDLE_END_MS, LATE_REP_MS, REOPEN_MS, nextContext, nextSetNumber, reduce, type RackEffect, type RackEngineState, type RackEvent, type RpcKind } from './engine';
import type { RackContext, RackSessionRow, SetSummary, RepWrite } from './engine';
import { prescribedWeightFor, percentWeightTarget, type SetLogRow, type TodayAthlete, type TodayExercise } from './api';
import { rackInstancesOf, resolveRackSet, type RackExerciseRef, type RackSetLog, type ResolvedRackSet } from './resolveRackSet';
import { intensityFor, type LoggedSets } from '../logger/targets';
import { withTimeout, type RackPersist } from './persist';

export const TICK_MS = 1_000;
export const FLUSH_MS = 15_000;
export const SEED_RETRY_MS = 5_000;
export const RPC_TIMEOUT_MS = 10_000;
/** A failed last-logged-weight read is retried after this long. */
export const WEIGHT_RETRY_MS = 30_000;
/** Logs older than this are re-read before a set starts. */
export const LOG_FRESH_MS = 2_000;
/** The longest a first rep waits for that re-read. */
export const LOG_HOLD_MAX_MS = 1_500;
/** Reps this soon after the last rack set of a finished exercise = lifting continues on it. */
export const CONTINUE_MS = IDLE_END_MS;

export interface ExecutorApi {
  startSet(rackId: string, athleteId: string, startedAt: string): Promise<RackSessionRow>;
  setActive(rackId: string, athleteId: string): Promise<RackSessionRow>;
  endSet(rackId: string, athleteId: string): Promise<RackSessionRow>;
  /** One athlete's set rows today (rack_athlete_sets) — resolveRackSet's logs. */
  athleteSets(rackId: string, athleteId: string): Promise<SetLogRow[]>;
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
  /** Queued set writes (key `wi:re:set`) — a rack write still queued stays complete for the resolver. */
  setQueue?: { peekAll(): Promise<{ key: string }[]> };
};

export interface ExecutorSensor {
  writeLoad(lb: number): Promise<void>;
}

export interface RackExecutor {
  /** Reduce one event. Only a set-starting rep can wait (≤ LOG_HOLD_MAX_MS)
   *  for a fresh log read; any later non-rep event releases it first. */
  dispatch(event: RackEvent, atMs?: number): void;
  getState(): RackEngineState;
  /** true while the rep athlete's logs have not loaded yet (UI indicator). */
  isSyncing(): boolean;
  /** Called on every state or syncing change. */
  subscribe(listener: (s: RackEngineState, syncing: boolean) => void): () => void;
  /** Today's athletes: dispatches contextMeta for every exercise and the
   *  active athlete's resolveRackSet answer (a resolved localContext). */
  setToday(athletes: TodayAthlete[]): void;
  /** Flush both queues now, ignoring back-off (e.g. realtime reconnect).
   *  Resolves when that flush pass is done. */
  flush(): Promise<void>;
  /** Coach exercise pick for an athlete (null clears) — resolveRackSet's
   *  override input. Beats a phone context made before it; a newer phone
   *  context clears it. Cleared when the active athlete changes. */
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
  /** The phone has an exercise open that today's list lacks: re-read today now. */
  onStaleToday?: () => void;
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

  /** Athletes whose logs have landed at least once. */
  const seeded = new Set<string>();
  let readInFlight = false;
  let readAgain = false;
  let readRetry: ReturnType<typeof setTimeout> | null = null;
  /** Orders writes and read requests (a read only confirms writes made before it). */
  let seq = 0;
  /** Cached exercise_logs per athlete (+ when / at which seq they were requested). */
  const logsByAthlete = new Map<string, { rows: SetLogRow[]; at: number; seq: number }>();
  /** Sets the rack itself wrote complete, until a later read confirms or drops them (key athlete:wi:re:n). */
  const rackWritten = new Map<string, SetLogRow & { seq: number }>();
  let staleTodayAt = -Infinity;

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
          // A set ended: re-read that athlete's logs once the write has gone out.
          const who = fx.summary.athleteId;
          void flushSoon().then(() => readLogs(who));
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

  // ---------------------------------------------------------------- log reads (one athlete)

  /** Read one athlete's logs (default: the rep target). Coalesced; retried on failure. */
  const readLogs = (athleteId: string | null = repTarget()): Promise<void> => {
    if (!athleteId || !state.rackId) return Promise.resolve();
    if (readInFlight) {
      readAgain = true;
      return Promise.resolve();
    }
    if (readRetry) clearTimeout(readRetry);
    readRetry = null;
    readInFlight = true;
    const rackId = state.rackId;
    const reqSeq = ++seq;
    const reqAt = now();
    return withTimeout(api.athleteSets(rackId, athleteId), RPC_TIMEOUT_MS, 'athleteSets')
      .then(rows => storeLogs(athleteId, rows, reqSeq, reqAt))
      .then(() => notify())
      .catch(e => {
        log(`log read failed; retrying in ${SEED_RETRY_MS} ms`, e);
        if (running) readRetry = setTimeout(() => ((readRetry = null), void readLogs()), SEED_RETRY_MS);
      })
      .finally(() => {
        readInFlight = false;
        if (readAgain) {
          readAgain = false;
          void readLogs();
        }
      });
  };

  /**
   * A read landed: cache it (an older request never overwrites a newer one),
   * settle the rack's own writes (confirmed → dropped; shown not complete and
   * no longer queued → dropped: an un-check / a moved set), then REPLACE the
   * engine's complete-set guard and re-resolve.
   */
  const storeLogs = async (athleteId: string, rows: SetLogRow[], reqSeq: number, reqAt: number) => {
    const cached = logsByAthlete.get(athleteId);
    if (cached && cached.seq > reqSeq) return;
    let queued: Set<string> | null = null;
    try {
      queued = persist.setQueue ? new Set((await persist.setQueue.peekAll()).map(i => i.key)) : null;
    } catch {
      queued = null;
    }
    const cachedNow = logsByAthlete.get(athleteId);
    if (cachedNow && cachedNow.seq > reqSeq) return;
    logsByAthlete.set(athleteId, { rows, at: reqAt, seq: reqSeq });
    const done = new Set(rows.filter(r => r.isComplete).map(r => `${r.workoutInstanceId}:${r.routineExerciseId}:${r.setNumber}`));
    const unsaved = new Set(unsavedSets.map(u => `${u.summary.workoutInstanceId}:${u.summary.routineExerciseId}:${u.summary.setNumber}`));
    for (const [k, w] of rackWritten) {
      if (w.athleteId !== athleteId) continue;
      const sk = `${w.workoutInstanceId}:${w.routineExerciseId}:${w.setNumber}`;
      if (done.has(sk)) rackWritten.delete(k);
      else if (w.seq < reqSeq && !unsaved.has(sk) && !(queued?.has(sk) ?? false)) rackWritten.delete(k);
    }
    seeded.add(athleteId);
    apply(
      {
        type: 'replaceComplete',
        athleteId,
        sets: logsFor(athleteId)
          .filter(l => l.isComplete)
          .map(l => ({ workoutInstanceId: l.workoutInstanceId, routineExerciseId: l.routineExerciseId, setNumber: l.setNumber })),
      },
      now(),
    );
    reresolve();
  };

  /** The athlete's logs as resolveRackSet reads them (cache + the rack's own writes). */
  const logsFor = (athleteId: string): RackSetLog[] => {
    const rows = [...(logsByAthlete.get(athleteId)?.rows ?? [])];
    for (const w of rackWritten.values()) if (w.athleteId === athleteId) rows.push(w);
    return rows.map(r => ({
      workoutInstanceId: r.workoutInstanceId,
      routineExerciseId: r.routineExerciseId,
      setNumber: r.setNumber,
      isComplete: r.isComplete,
    }));
  };

  // ---------------------------------------------------------------- resolve (shared with the phone)

  const refSig = (r: RackExerciseRef | null) => (r ? `${r.workoutInstanceId}:${r.routineExerciseId}:${r.setNumber ?? ''}` : '');

  /**
   * The phone's context in the row: anything the iPad didn't publish itself.
   * Its exercise is the phone-open one (rule 1) and its set number is always
   * the "everything below is done" hint — also when the iPad published that
   * exercise and the phone then moved the set on (a hand-saved set).
   */
  const phoneRef = (): RackExerciseRef | null => {
    const id = state.activeAthleteId;
    const r = state.session;
    if (!id || !r || r.active_athlete_id !== id) return null;
    const n = rowNext();
    if (!n || n.wi == null || n.re == null) return null;
    // Only what the iPad actually SENT is its own (an adopted phone value stays the phone's hint).
    const p = sentByIpad;
    if (p && p.athleteId === id && p.workoutInstanceId === n.wi && p.routineExerciseId === n.re && p.setNumber === n.set) return null;
    return { workoutInstanceId: n.wi, routineExerciseId: n.re, setNumber: n.set };
  };
  const lastRackExerciseOf = (athleteId: string): RackExerciseRef | null => {
    const set = state.lastEndByAthlete[athleteId]?.set;
    return set && !set.free ? { workoutInstanceId: set.context.workoutInstanceId, routineExerciseId: set.context.routineExerciseId } : null;
  };

  /** resolveRackSet for the athlete; null = their workout isn't loaded (the engine falls back to the row). */
  const resolveFor = (athleteId: string, liftingContinues = false): ResolvedRackSet | null => {
    const a = today.find(t => t.athleteId === athleteId);
    if (!a) return null;
    const ovr = override && override.athleteId === athleteId ? override : null;
    const ov = ovr?.ex ?? null;
    const instances = rackInstancesOf(a);
    // Phone-open beats the coach pick — except a pick made AFTER the phone's
    // current context (the latest action wins; the phone then follows it).
    // A newer phone context clears the override (apply()).
    const phoneNow = phoneRef();
    const phone = ovr && refSig(phoneNow) === ovr.phoneSig ? null : phoneNow;
    const known = (ref: RackExerciseRef) =>
      instances.some(i => (!ref.workoutInstanceId || i.workoutInstanceId === ref.workoutInstanceId) && i.exercises.some(e => e.routineExerciseId === ref.routineExerciseId));
    // The phone has an exercise open that today's list doesn't hold (another
    // instance / a stale list): the phone wins — the row's context applies.
    if (phone && !known(phone) && !ov) {
      if (opts.onStaleToday && now() - staleTodayAt > 10_000) {
        staleTodayAt = now();
        opts.onStaleToday();
      }
      return null;
    }
    return resolveRackSet({
      instances,
      logs: logsFor(athleteId),
      phone,
      override: ov ? { workoutInstanceId: ov.workoutInstanceId, routineExerciseId: ov.routineExerciseId } : null,
      lastRackExercise: lastRackExerciseOf(athleteId),
      liftingContinues,
    });
  };

  /** Hand a resolution to the engine (a resolved localContext) when it changed. */
  const applyResolution = (athleteId: string, res: ResolvedRackSet | null) => {
    const cur = state.localContext;
    if (!res) {
      // Workout not loaded: drop an older resolution so the row's context applies.
      if (cur && cur.athleteId === athleteId && cur.resolved) {
        apply({ type: 'localContext', athleteId, workoutInstanceId: null, routineExerciseId: null, exerciseId: null, setNumber: null, loadLb: null, zoneMin: null, zoneMax: null, dropStopPct: null }, now());
      }
      return;
    }
    const set = res.none ? null : res;
    const ex = set ? today.find(t => t.athleteId === athleteId)?.exercises.find(e => e.workoutInstanceId === set.workoutInstanceId && e.routineExerciseId === set.routineExerciseId) : undefined;
    const next = {
      workoutInstanceId: set?.workoutInstanceId ?? null,
      routineExerciseId: set?.routineExerciseId ?? null,
      exerciseId: set?.exerciseId ?? null,
      setNumber: set?.setNumber ?? null,
    };
    const reason = set?.reason ?? null;
    if (
      cur && cur.athleteId === athleteId && cur.resolved &&
      cur.workoutInstanceId === next.workoutInstanceId && cur.routineExerciseId === next.routineExerciseId &&
      cur.exerciseId === next.exerciseId && cur.setNumber === next.setNumber && (cur.reason ?? null) === reason
    ) return;
    apply(
      {
        type: 'localContext',
        athleteId,
        resolved: true,
        reason,
        ...next,
        loadLb: null,
        zoneMin: ex?.zoneMin ?? null,
        zoneMax: ex?.zoneMax ?? null,
        dropStopPct: ex?.dropStopPct ?? null,
      },
      now(),
    );
  };

  /** Between sets: the active athlete's exercise + set from the resolver. */
  let resolving = false;
  const reresolve = () => {
    if (state.mode !== 'rack' || resolving) return;
    const id = state.activeAthleteId;
    if (!id || state.setState === 'lifting') return;
    resolving = true;
    try {
      applyResolution(id, resolveFor(id));
    } finally {
      resolving = false;
    }
  };

  /**
   * Right before a rep starts a set: resolve again. When the resolver moved
   * off the athlete's last rack exercise only because it is finished, reps
   * still coming on it (≤ CONTINUE_MS after its last rep) with nothing else
   * open on the phone or picked by the coach = lifting continues → an extra
   * set is appended instead of jumping exercises mid-lift.
   */
  const prepareStart = (athleteId: string, at: number) => {
    resolving = true;
    try {
      let res = resolveFor(athleteId);
      const last = lastRackExerciseOf(athleteId);
      const rec = state.lastEndByAthlete[athleteId];
      const lastSet = rec?.set;
      const isLast = (ref: { workoutInstanceId: string | null; routineExerciseId: string | null } | null) =>
        !!ref && !!last && ref.workoutInstanceId === last.workoutInstanceId && ref.routineExerciseId === last.routineExerciseId;
      const onLast = !!res && !res.none && isLast(res);
      const ov = override && override.athleteId === athleteId ? override.ex : null;
      const phone = phoneRef();
      // The phone still on the finished last exercise (it sends set N+1) is not "something else".
      const somethingElseOpen = (!!phone && !isLast(phone)) || (!!ov && !isLast(ov));
      // Hold first: an idle-ended set (≤ REOPEN_MS ago, nothing else open) is reopened.
      if (res && last && lastSet && rec.hold && lastSet.endedAtMs != null && at - lastSet.endedAtMs < REOPEN_MS && !somethingElseOpen) {
        applyResolution(athleteId, {
          workoutInstanceId: last.workoutInstanceId!,
          routineExerciseId: last.routineExerciseId!,
          exerciseId: lastSet.context.exerciseId,
          setNumber: rec.setNumber ?? 1,
          reason: 'reopen',
        });
        return;
      }
      if (res && last && lastSet && !onLast && !somethingElseOpen && at - lastSet.lastRepAtMs <= CONTINUE_MS) {
        const extra = resolveFor(athleteId, true);
        if (extra && !extra.none && extra.reason === 'extra-set') res = extra;
      }
      applyResolution(athleteId, res);
    } finally {
      resolving = false;
    }
  };

  /** Would this rep start a new set (not a continuation, late rep or switch)? */
  const startsSet = (at: number): boolean => {
    const s = state;
    if (s.mode !== 'rack' || !s.activeAthleteId || s.switchingTo) return false;
    if (s.setState === 'lifting' && s.live) return false;
    const just = s.lastEnded;
    return !(just && just.endedAtMs != null && at - just.endedAtMs <= LATE_REP_MS);
  };

  /** The live set just started: put its context in the row before rack_start_set. */
  const publishStart = () => {
    const live = state.live;
    const r = state.session;
    const rackId = state.rackId;
    if (!live || live.free || !rackId || !api.setIpadContext || !r || r.active_athlete_id !== live.athleteId) return;
    const c = live.context;
    if (r.workout_instance_id === c.workoutInstanceId && r.routine_exercise_id === c.routineExerciseId && r.set_number === c.setNumber) return;
    const want: Pub = {
      athleteId: live.athleteId,
      workoutInstanceId: c.workoutInstanceId!,
      routineExerciseId: c.routineExerciseId!,
      setNumber: c.setNumber,
      loadLb: c.loadLb,
    };
    published = want;
    sentByIpad = want;
    lastAttemptKey = `${want.athleteId}:${want.workoutInstanceId}:${want.routineExerciseId}:${want.setNumber}:${want.loadLb}`;
    const setIpadContext = api.setIpadContext;
    // Same serial chain as the RPCs: this goes out before the rpcStartSet the
    // engine just emitted (its effect chain runs later).
    rpcChain = rpcChain.then(async () => {
      try {
        const row = await withTimeout(
          setIpadContext(rackId, want.athleteId, { workoutInstanceId: want.workoutInstanceId, routineExerciseId: want.routineExerciseId, setNumber: want.setNumber, loadLb: want.loadLb }),
          RPC_TIMEOUT_MS,
          'setIpadContext',
        );
        if (row) dispatch({ type: 'sessionSync', row });
      } catch (e) {
        log('setIpadContext (set start) failed', e);
      }
    });
  };

  // ---------------------------------------------------------------- first-rep freshness hold

  /** The first-rep wait: every event / call meanwhile is queued, replayed in order on release. */
  let held: { athleteId: string; queue: (() => void)[]; timer: ReturnType<typeof setTimeout>; done: Promise<void> } | null = null;
  let releasing = false;

  const logsFresh = (athleteId: string) => {
    const c = logsByAthlete.get(athleteId);
    return !!c && now() - c.at <= LOG_FRESH_MS;
  };

  const releaseHold = (h = held) => {
    if (!h || held !== h) return;
    held = null;
    clearTimeout(h.timer);
    releasing = true;
    try {
      for (const run of h.queue) run();
    } finally {
      releasing = false;
    }
  };

  /** Queue `run` behind a pending first-rep wait; false = no wait, run now. */
  const queued = (run: () => void): boolean => {
    if (!held || releasing) return false;
    held.queue.push(run);
    return true;
  };

  /** Re-read the athlete's logs before the set starts (bounded; events keep their order and times). */
  const beginHold = (athleteId: string, event: RackEvent, at: number) => {
    let finish!: () => void;
    const done = new Promise<void>(res => (finish = res));
    const h = {
      athleteId,
      queue: [() => dispatch(event, at)],
      timer: setTimeout(() => {
        log('log re-read slow; starting the set with cached logs');
        releaseHold(h);
        finish();
      }, LOG_HOLD_MAX_MS),
      done,
    };
    held = h;
    const rackId = state.rackId!;
    const reqSeq = ++seq;
    const reqAt = now();
    withTimeout(api.athleteSets(rackId, athleteId), LOG_HOLD_MAX_MS, 'athleteSets')
      .then(rows => storeLogs(athleteId, rows, reqSeq, reqAt))
      .catch(e => log('log re-read failed; starting the set with cached logs', e))
      .finally(() => {
        releaseHold(h);
        finish();
      });
  };

  // ---------------------------------------------------------------- reduce

  const apply = (event: RackEvent, at: number) => {
    const before = state.activeAthleteId;
    const ctxBefore = state.mode === 'rack' ? `${state.setState}|${ctxKey(nextContext(state))}` : '';
    const targetBefore = repTarget();
    const hintBefore = event.type === 'sessionSync' ? refSig(phoneRef()) : '';
    const res = reduce(state, event, at);
    state = res.state;
    // A set the rack just ended counts as complete for the resolver at once —
    // before this event's re-resolve (the log read lags the write queue).
    for (const fx of res.effects) {
      if ((fx.type !== 'endSet' && fx.type !== 'amendSet') || fx.summary.free) continue;
      const sm = fx.summary;
      if (!sm.workoutInstanceId || !sm.routineExerciseId || sm.setNumber == null) continue;
      rackWritten.set(`${sm.athleteId}:${sm.workoutInstanceId}:${sm.routineExerciseId}:${sm.setNumber}`, {
        athleteId: sm.athleteId,
        workoutInstanceId: sm.workoutInstanceId,
        routineExerciseId: sm.routineExerciseId,
        setNumber: sm.setNumber,
        isComplete: true,
        seq: ++seq,
      });
    }
    if (res.effects.length) {
      const effects = res.effects;
      effectChain = effectChain.then(() => runEffects(effects)).catch(e => log('effects failed', e));
    }
    const target = repTarget();
    // Read right away on an active / switch-target change (the phone may have
    // logged sets since). Non-blocking.
    if ((target !== targetBefore || state.activeAthleteId !== before) && (target || state.activeAthleteId)) {
      void readLogs();
    }
    if (state.activeAthleteId !== before) {
      if (override && override.athleteId !== state.activeAthleteId) override = null;
      published = null;
      sentByIpad = null;
      lastAttemptKey = null;
    } else if (event.type === 'sessionSync' && override && !publishInFlight && phoneOwnsRow() && refSig(phoneRef()) !== override.phoneSig) {
      // The phone moved the athlete on: its newer pick wins over the coach override.
      override = null;
    }
    if (event.type === 'sessionSync' && state.activeAthleteId === before && state.activeAthleteId) {
      const hint = phoneRef();
      if (refSig(hint) !== hintBefore && hint) {
        // The phone's set / exercise moved: re-read (never on other row changes).
        void readLogs();
        // …and it moved past an idle-held set → that set is not reopened.
        const rec = state.lastEndByAthlete[state.activeAthleteId];
        const held = rec?.hold ? rec.set.context : null;
        if (
          held &&
          (hint.workoutInstanceId !== held.workoutInstanceId ||
            hint.routineExerciseId !== held.routineExerciseId ||
            (hint.setNumber != null && rec!.setNumber != null && hint.setNumber > rec!.setNumber))
        ) {
          apply({ type: 'releaseHold', athleteId: state.activeAthleteId }, at);
        }
      }
    }
    if (event.type !== 'localContext') reresolve();
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
  /** The last context the iPad itself sent (rack_set_ipad_context). */
  let sentByIpad: Pub | null = null;
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
    if (state.setState === 'lifting') return; // the live set's context was published at its start
    const r = state.session;
    if (!r || r.active_athlete_id !== id) return;
    const coach = !!override && override.athleteId === id && override.ex.workoutInstanceId === local.workoutInstanceId && override.ex.routineExerciseId === local.routineExerciseId;
    if (!ipadOwnsContext() && !coach) return; // the phone's context: never echo it
    const n = rowNext();
    const sameEx = !!n && n.wi === local.workoutInstanceId && n.re === local.routineExerciseId;
    const mine = published && published.athleteId === id ? published : null;
    // The set number is the resolver's (via the engine's guard / idle hold);
    // a load the phone changed after the iPad's publish stays the phone's.
    const resolved = nextSetNumber(state, id);
    // Keep the phone's set hint for this exercise when it is ahead (a hand-saved set).
    const setNumber = sameEx && n!.set != null && resolved != null && n!.set > resolved && !(override && override.athleteId === id) ? n!.set : resolved;
    const phoneLoad = sameEx && n!.set === setNumber && n!.load != null && mine && n!.load !== mine.loadLb ? Number(n!.load) : null;
    const want: Pub = {
      athleteId: id,
      workoutInstanceId: local.workoutInstanceId,
      routineExerciseId: local.routineExerciseId,
      setNumber,
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
    sentByIpad = want;
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

  const dispatch = (event: RackEvent, atMs?: number) => {
    const at = atMs ?? now();
    // A first rep is waiting for its log read: queue EVERYTHING (ticks, rows,
    // Done, taps) and replay in order on release.
    if (queued(() => dispatch(event, at))) return;
    let starting = false;
    if (event.type === 'rep' && startsSet(at)) {
      const id = state.activeAthleteId!;
      if (!releasing && !logsFresh(id)) {
        beginHold(id, event, at);
        return;
      }
      prepareStart(id, at);
      starting = true;
    }
    apply(event, at);
    if (starting) publishStart();
  };

  // ---------------------------------------------------------------- today

  /** The coach's pick + the phone context it was made over (phoneSig). */
  let override: { athleteId: string; ex: TodayExercise; phoneSig: string } | null = null;

  const setOverride = (athleteId: string, ex: TodayExercise | null) => {
    if (queued(() => setOverride(athleteId, ex))) return;
    override = ex
      ? { athleteId, ex, phoneSig: athleteId === state.activeAthleteId ? refSig(phoneRef()) : '' }
      : override?.athleteId === athleteId ? null : override;
    if (athleteId === state.activeAthleteId) {
      reresolve();
      deriveLoad();
      publishIfNeeded();
    }
    notify();
  };

  const setToday = (athletes: TodayAthlete[]) => {
    if (queued(() => setToday(athletes))) return;
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
    reresolve();
    const id = repTarget();
    if (id && !seeded.has(id)) void readLogs(id);
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
      releaseHold();
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
      flushSoon();
      void readLogs();
    },
    stop() {
      releaseHold();
      running = false;
      timers.forEach(clearInterval);
      timers = [];
      if (readRetry) clearTimeout(readRetry);
      readRetry = null;
    },
    async idle() {
      // Effects can enqueue RPCs and RPCs can dispatch more effects: settle both
      // (and a first rep waiting for its log re-read).
      for (let i = 0; i < 20; i++) {
        if (held) await held.done;
        const e = effectChain;
        const r = rpcChain;
        await e;
        await r;
        if (!held && e === effectChain && r === rpcChain) return;
      }
    },
  };
}
