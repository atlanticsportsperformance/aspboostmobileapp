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
//   - Fix mistakes (rack-edge mock): `moveSet(target)` mid-set resolves the
//     target's set with resolveRackSet and dispatches `moveLiveSet` — the set
//     ends AS the target (nothing written for the wrong athlete, no
//     rack_end_set), rack_move_reps (exact rep ids) queued in rack_moves_v1
//     behind the rep + set writes, then rack_set_active(target). After Done
//     (`{ last: true }`, ≤ 2 min): rack_move_set for a workout set,
//     rack_move_reps (its rep ids) for a free set.
//     `removeRep(id)` drops the rep in the engine and queues rack_remove_rep
//     (a removal seen from the phone = `remote`: engine only).
//   - BAR stepper: `setBarLoad(lb)` publishes load_lb through
//     rack_set_ipad_context between sets (mid-set: on the next set) and wins
//     over the row's load for that exercise until someone else changes it.

import { IDLE_END_MS, LATE_REP_MS, REOPEN_MS, nextContext, nextSetNumber, reduce, type RackEffect, type RackEngineState, type RackEvent, type RpcKind } from './engine';
import type { RackContext, RackSessionRow, SetSummary, RepWrite } from './engine';
import { prescribedWeightFor, percentWeightTarget, type SetLogRow, type TodayAthlete, type TodayExercise } from './api';
import { LOAD_EDIT_GUARD_MS } from './phoneView';
import { pickerRowsOf, rackInstancesOf, resolveRackSet, type PickerRow, type RackExerciseRef, type RackSetLog, type ResolvedRackSet } from './resolveRackSet';
import { intensityFor, type LoggedSets } from '../logger/targets';
import { dropPct as dropPctOf } from '../ovr/protocol';
import { setKeyOf, withTimeout, type FixItem, type RackPersist, type SetRef } from './persist';

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
/** A just-ended set can be moved to the right athlete for this long. */
export const MOVE_WINDOW_MS = 120_000;

/** One rep of a set read back from vbt_reps (killed-iPad recovery). */
export interface StoredRep {
  v: number;
  pv: number;
  rom: number;
  partial: boolean;
  /** vbt_reps.received_at (the idle check). */
  receivedAt?: string | null;
}

/**
 * I1 — the iPad was killed mid-set: the reps are durable in vbt_reps but no
 * set row was written. The set's summary rebuilt from them (same math as the
 * engine's summarize: full reps only for avg / best / drop).
 */
export function recoveredSummary(
  rackId: string,
  row: RackSessionRow,
  reps: StoredRep[],
  opts: { exerciseId: string | null; zone: [number, number] | null; nowIso: string },
): SetSummary {
  const full = reps.filter(r => !r.partial);
  const bestV = full.length ? Math.max(...full.map(r => r.v)) : null;
  const avgV = full.length ? Math.round((full.reduce((a, r) => a + r.v, 0) / full.length) * 1000) / 1000 : null;
  const last = full[full.length - 1];
  return {
    rackId,
    source: 'rack',
    athleteId: row.active_athlete_id!,
    workoutInstanceId: row.workout_instance_id,
    routineExerciseId: row.routine_exercise_id,
    exerciseId: opts.exerciseId,
    setNumber: row.set_number,
    loadLb: row.load_lb == null ? null : Number(row.load_lb),
    setStartedAt: row.set_started_at ?? opts.nowIso,
    reps: reps.map(r => ({ v: r.v, pv: r.pv, rom: r.rom, partial: r.partial })),
    fullReps: full.length,
    avgV,
    bestV,
    dropPct: bestV != null && last ? dropPctOf(bestV, last.v) : null,
    zone: opts.zone,
    endedBy: row.pending_end ? 'phone' : 'idle',
    free: false,
  };
}

export interface ExecutorApi {
  startSet(rackId: string, athleteId: string, startedAt: string): Promise<RackSessionRow>;
  setActive(rackId: string, athleteId: string): Promise<RackSessionRow>;
  endSet(rackId: string, athleteId: string): Promise<RackSessionRow>;
  /** The set's non-removed vbt_reps (rep order) since `since` — killed-iPad recovery. Optional (tests). */
  setReps?(
    rackId: string,
    q: { athleteId: string; workoutInstanceId: string; routineExerciseId: string; setNumber: number; since: string | null },
  ): Promise<StoredRep[]>;
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
  /** rack_move_set, queued behind every rep + set write (rack_moves_v1). */
  moveSet?: RackPersist['moveSet'];
  /** rack_move_reps (exact rep ids), queued behind every rep + set write (rack_moves_v1). */
  moveReps?: RackPersist['moveReps'];
  /** rack_remove_rep, queued right behind the reps (rack_rep_removals_v1). */
  removeRep?: RackPersist['removeRep'];
  /** Queued fix-mistakes calls (a moved set's target stays complete for the resolver). */
  moveQueue?: { peekAll(): Promise<FixItem[]> };
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
  setOverride(athleteId: string, ex: TodayExercise | null, setNumber?: number | null): void;
  /** The iPad picker's live rows for an athlete (progress + set chips), from the resolver's own logs. */
  pickerRows(athleteId: string): PickerRow[];
  /** End any live set (iPad Done) and wait until its writes are queued. */
  endLive(): Promise<void>;
  /** Writes held in memory because their enqueue failed. */
  unsavedCount(): { reps: number; sets: number };
  /** The active athlete's context is the iPad's (its pick / a coach
   *  override, published to rack_sessions) — not the phone's. */
  ipadOwnsContext(): boolean;
  /**
   * Wrong athlete: move the live set (ended first, its write queued) or the
   * set that just ended (≤ MOVE_WINDOW_MS) to `targetId` — rack_move_set to
   * the target's resolveRackSet set, queued behind the set write — then put
   * the target up (rack_set_active). Resolves with the target set (null = no
   * set to move).
   */
  moveSet(targetId: string, opts?: { last?: boolean }): Promise<SetRef | null>;
  /** Remove a bad rep: engine first (live set recalculated), then rack_remove_rep
   *  (queued). `remote` = it was removed elsewhere (the phone): engine only. */
  removeRep(clientRepId: string, opts?: { remote?: boolean }): Promise<void>;
  /** BAR stepper on the iPad: the bar weight for the active athlete's exercise. */
  setBarLoad(lb: number): void;
  /** The iPad's BAR weight; `next` = typed mid-set, applies on the next set. */
  barLoad(): { lb: number; next: boolean } | null;
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
  /** Athletes asked for while a read was in flight (each is read next — none dropped). */
  const readPending = new Set<string>();
  let readRetry: ReturnType<typeof setTimeout> | null = null;
  /** Orders writes and read requests (a read only confirms writes made before it). */
  let seq = 0;
  /** Cached exercise_logs per athlete (+ when / at which seq they were requested). */
  const logsByAthlete = new Map<string, { rows: SetLogRow[]; at: number; seq: number }>();
  /** Sets the rack itself wrote complete, until a later read confirms or drops them (key athlete:wi:re:n). */
  const rackWritten = new Map<string, SetLogRow & { seq: number }>();
  /** Sets moved off an athlete (key athlete:wi:re:n): hidden from their logs until the move is sent. */
  const movedAway = new Set<string>();
  let staleTodayAt = -Infinity;

  /** Writes whose enqueue failed (storage error) — retried on every flush. */
  const unsavedReps: RepWrite[] = [];
  const unsavedSets: { kind: 'endSet' | 'amendSet'; summary: SetSummary }[] = [];
  /** Fix-mistakes calls whose enqueue failed (after the set writes in the drain). */
  const unsavedFixes: { item: FixItem; run: () => Promise<void> }[] = [];

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
    while (unsavedFixes.length) {
      const f = unsavedFixes[0];
      await f.run();
      const i = unsavedFixes.indexOf(f);
      if (i >= 0) unsavedFixes.splice(i, 1);
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
        case 'writeRep': {
          // A re-sent rep (moved to the right athlete) supersedes its memory-held copy.
          const old = unsavedReps.findIndex(u => u.clientRepId === fx.rep.clientRepId);
          if (old >= 0) unsavedReps.splice(old, 1);
          await durably('writeRep', () => persist.writeRep(fx.rep), () => unsavedReps.push(fx.rep));
          flushSoon();
          break;
        }
        case 'moveSetRow': {
          if (!persist.moveSet) {
            log('moveSetRow: persist has no move queue');
            break;
          }
          const mv = persist.moveSet;
          const { from, to } = fx;
          const fk = `${from.athleteId}:${from.workoutInstanceId}:${from.routineExerciseId}:${from.setNumber}`;
          rackWritten.delete(fk);
          movedAway.add(fk);
          await queueFix({ kind: 'move', id: `move:${fk}>${to.athleteId}`, from, to }, () => mv(from, to));
          break;
        }
        case 'moveReps': {
          const to: SetRef = fx.to;
          const ids = fx.clientRepIds;
          if (!persist.moveReps) {
            log('moveReps: persist has no move queue');
            break;
          }
          const mv = persist.moveReps;
          await queueFix({ kind: 'moveReps', id: `reps:${ids.join(',')}>${to.athleteId}`, clientRepIds: ids, to }, () => mv(ids, to));
          break;
        }
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
          // A killed-set recovery ends that set itself (after its row is queued).
          if ((recovering && recovering.athleteId === fx.athleteId) || recoveryKeyOf(state.session) === recoveredKeyFor(fx.athleteId)) break;
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
        case 'setChanged': {
          // A rep was removed from an ended set: a write of it still queued
          // (or held in memory) carries the new summary; a sent one is fixed
          // by rack_remove_rep's recompute.
          if (fx.summary.free) break;
          const sm = withExercise(fx.summary);
          const key = setKeyOf(sm);
          const mem = unsavedSets.find(u => setKeyOf(u.summary) === key);
          if (mem) {
            mem.summary = sm;
            break;
          }
          let queuedNow = false;
          try {
            queuedNow = !!persist.setQueue && (await persist.setQueue.peekAll()).some(i => i.key === key);
          } catch (e) {
            log('set queue read failed; re-queuing the changed set', e);
            queuedNow = true;
          }
          if (queuedNow) await durably('amendSet', () => persist.amendSet(sm), () => unsavedSets.push({ kind: 'amendSet', summary: sm }));
          break;
        }
      }
    }
  };

  // ---------------------------------------------------------------- killed-iPad recovery (I1 / N1)

  /**
   * A killed-set recovery for the active athlete's row. `inflight` = its
   * flush + read is running; `timer` = waiting for the set to go idle.
   */
  let recovering: {
    athleteId: string;
    key: string;
    row: RackSessionRow;
    cancelled: boolean;
    /** The rack switched athlete during the wait: land the set now, no rack_end_set. */
    forced?: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    done: Promise<void>;
  } | null = null;
  const recoveredStarts = new Set<string>();
  /** The last recovered set per athlete (the engine's own rpcEndSet for it is dropped — never two). */
  const recoveredLast = new Map<string, string>();
  /** A rep cancelled a recovery: the engine's next set adopts that set (same exercise + set number). */
  let adoptSet: { athleteId: string; workoutInstanceId: string; routineExerciseId: string; exerciseId: string | null; setNumber: number } | null = null;
  const recoveryKeyOf = (r: RackSessionRow | null): string | null =>
    r && r.active_athlete_id ? `${r.active_athlete_id}:${r.set_started_at ?? ''}:${r.routine_exercise_id}:${r.set_number}` : null;
  const recoveredKeyFor = (athleteId: string) => recoveredLast.get(athleteId) ?? '∅';

  /**
   * The server row says a set is lifting (or the phone asked to end it) but
   * this engine never lifted anything since it started: the iPad was killed
   * mid-set. The rack never ends a set on its own while it may still be
   * lifted — it recovers only a FINISHED set: pending_end / leave_requested,
   * or 60 s (IDLE_END_MS) since the newest stored rep (re-checked on a timer
   * so the rack never stays "lifting" forever). Then it writes the set row
   * from vbt_reps (queued reps flushed first) and calls rack_end_set once. Any
   * rep first cancels it: the engine continues that set (stored + new reps,
   * one write, rack_recompute_set counts them all).
   */
  const maybeRecover = () => {
    const r = state.session;
    const rackId = state.rackId;
    if (state.mode !== 'rack' || !r || !rackId) return;
    if (recovering) {
      // R1: phone Done / Leave for the set being recovered — no 60 s wait.
      const rec = recovering;
      if (rec.timer && rec.key === recoveryKeyOf(r) && (r.pending_end || r.leave_requested)) {
        clearTimeout(rec.timer);
        rec.timer = null;
        rec.done = attemptRecovery(rec);
      }
      return;
    }
    if (r.state !== 'lifting' && !r.pending_end && !r.leave_requested) return;
    // An idle row (no set start) holds no set to recover — the engine's release path covers its flags.
    if (r.state !== 'lifting' && !r.set_started_at) return;
    if (state.live || state.lastEnded) return; // this engine owns / owned the set
    const athleteId = r.active_athlete_id;
    if (!athleteId || !r.workout_instance_id || !r.routine_exercise_id || r.set_number == null) return;
    const key = recoveryKeyOf(r)!;
    if (recoveredStarts.has(key)) return;
    const rec = { athleteId, key, row: r, cancelled: false, timer: null as ReturnType<typeof setTimeout> | null, done: Promise.resolve() };
    recovering = rec;
    rec.done = attemptRecovery(rec);
  };

  const attemptRecovery = async (rec: NonNullable<typeof recovering>): Promise<void> => {
    const rackId = state.rackId!;
    const row = rec.row;
    const athleteId = rec.athleteId;
    try {
      await flushSoon(true); // reps still in the local queue count too
      if (rec.cancelled) return;
      const reps = api.setReps
        ? await withTimeout(
            api.setReps(rackId, {
              athleteId,
              workoutInstanceId: row.workout_instance_id!,
              routineExerciseId: row.routine_exercise_id!,
              setNumber: row.set_number!,
              since: row.set_started_at,
            }),
            RPC_TIMEOUT_MS,
            'setReps',
          )
        : [];
      if (rec.cancelled) return;
      // force = the rack switched athlete during the wait: land the crashed set
      // now (from the row it had), so it never merges into their next set.
      const force = rec.forced;
      const cur = force ? rec.row : state.session;
      if (!force && (!cur || recoveryKeyOf(cur) !== rec.key || state.live)) {
        // the row moved on (another set / athlete) — nothing to recover
        if (recovering === rec) recovering = null;
        return;
      }
      if (!cur) return;
      const flagged = force || !!cur.pending_end || !!cur.leave_requested;
      const times = reps.map(x => (x.receivedAt ? Date.parse(x.receivedAt) : NaN)).filter(Number.isFinite);
      const lastAt = times.length ? Math.max(...times) : cur.set_started_at ? Date.parse(cur.set_started_at) : NaN;
      const idleFor = Number.isFinite(lastAt) ? now() - lastAt : IDLE_END_MS;
      if (!flagged && idleFor < IDLE_END_MS) {
        // Maybe still being lifted: look again once it would be 60 s idle.
        rec.timer = setTimeout(() => {
          rec.timer = null;
          if (rec.cancelled || recovering !== rec) return;
          rec.done = attemptRecovery(rec);
        }, IDLE_END_MS - idleFor + 50);
        return;
      }
      recoveredStarts.add(rec.key);
      recoveredLast.set(athleteId, rec.key);
      if (reps.length) {
        const exerciseId = row.exercise_id ?? state.exerciseByRoutineExercise[row.routine_exercise_id!] ?? null;
        const meta = exerciseId ? state.metaByExercise[exerciseId] : undefined;
        const zone: [number, number] | null = meta && meta.zoneMin != null && meta.zoneMax != null ? [meta.zoneMin, meta.zoneMax] : null;
        const summary = withExercise(recoveredSummary(rackId, cur, reps, { exerciseId, zone, nowIso: new Date(now()).toISOString() }));
        rackWritten.set(`${athleteId}:${row.workout_instance_id}:${row.routine_exercise_id}:${row.set_number}`, {
          athleteId,
          workoutInstanceId: row.workout_instance_id!,
          routineExerciseId: row.routine_exercise_id!,
          setNumber: row.set_number!,
          isComplete: true,
          seq: ++seq,
        });
        if (rec.cancelled) return; // a rep adopted the set meanwhile
        await durably('endSet', () => persist.endSet(summary), () => unsavedSets.push({ kind: 'endSet', summary }));
        void flushSoon().then(() => readLogs(athleteId));
      }
      if (recovering === rec) recovering = null;
      reresolve();
      // R3: never end a set a rep adopted; after a switch the rack is already released.
      if (rec.cancelled || rec.forced) return;
      runRpc({ type: 'rpcEndSet', athleteId });
    } catch (e) {
      log('killed-set recovery failed; re-checking', e);
      if (!rec.cancelled && recovering === rec && running) {
        rec.timer = setTimeout(() => {
          rec.timer = null;
          if (rec.cancelled || recovering !== rec) return;
          rec.done = attemptRecovery(rec);
        }, SEED_RETRY_MS);
      } else if (recovering === rec) {
        recovering = null;
      }
    }
  };

  /** A rep arrived first: cancel the recovery; the next set adopts that set. */
  const cancelRecovery = () => {
    const rec = recovering;
    if (!rec || rec.athleteId !== state.activeAthleteId) return;
    rec.cancelled = true;
    if (rec.timer) clearTimeout(rec.timer);
    rec.timer = null;
    recovering = null;
    recoveredStarts.add(rec.key); // never recover that set later
    adoptSet = {
      athleteId: rec.athleteId,
      workoutInstanceId: rec.row.workout_instance_id!,
      routineExerciseId: rec.row.routine_exercise_id!,
      exerciseId: rec.row.exercise_id ?? null,
      setNumber: rec.row.set_number!,
    };
  };

  // ---------------------------------------------------------------- log reads (one athlete)

  /** Read one athlete's logs (default: the rep target). Coalesced; retried on failure. */
  const readLogs = (athleteId: string | null = repTarget()): Promise<void> => {
    if (!athleteId || !state.rackId) return Promise.resolve();
    if (readInFlight) {
      readPending.add(athleteId);
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
        if (running) readRetry = setTimeout(() => ((readRetry = null), void readLogs(athleteId)), SEED_RETRY_MS);
      })
      .finally(() => {
        readInFlight = false;
        const next = readPending.values().next().value as string | undefined;
        if (next) {
          readPending.delete(next);
          void readLogs(next);
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
    let movesQueued: FixItem[] = [];
    try {
      queued = persist.setQueue ? new Set((await persist.setQueue.peekAll()).map(i => i.key)) : null;
    } catch {
      queued = null;
    }
    try {
      movesQueued = persist.moveQueue ? await persist.moveQueue.peekAll() : [];
    } catch {
      movesQueued = [];
    }
    const allMoves = [...movesQueued, ...unsavedFixes.map(f => f.item)];
    const pendingMoves = allMoves.filter((m): m is Extract<FixItem, { kind: 'move' }> => m.kind === 'move');
    // A moved set's target is written by rack_move_set / rack_move_reps: complete until that call is sent.
    for (const m of allMoves) {
      if (m.kind === 'remove') continue;
      if (m.to.athleteId === athleteId && m.to.workoutInstanceId && m.to.routineExerciseId && m.to.setNumber != null) {
        queued = queued ?? new Set<string>();
        queued.add(`${m.to.workoutInstanceId}:${m.to.routineExerciseId}:${m.to.setNumber}`);
      }
    }
    // A moved-away set stops hiding once its move has been sent (the read is the truth again).
    for (const k of [...movedAway]) {
      if (!k.startsWith(`${athleteId}:`)) continue;
      const still = pendingMoves.some(m => `${m.from.athleteId}:${m.from.workoutInstanceId}:${m.from.routineExerciseId}:${m.from.setNumber}` === k);
      if (!still) movedAway.delete(k);
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
    // A set moved away to another athlete no longer counts for this one.
    const rows = (logsByAthlete.get(athleteId)?.rows ?? []).filter(
      r => !movedAway.has(`${athleteId}:${r.workoutInstanceId}:${r.routineExerciseId}:${r.setNumber}`),
    );
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
  /**
   * The phone's latest context — remembered by PROVENANCE, not read off the
   * row: the iPad's own re-publishes (a derived load, the bar weight, its
   * resolution of that same set) rewrite the row with the phone's set but are
   * not phone actions, and must never launder the phone's set back to the
   * rack's auto-pick. Set from every row value the iPad didn't send itself;
   * cleared when the active athlete changes. The rack's auto-pick is never
   * newer than a phone action; only a coach pick competes (latest wins).
   */
  let phoneCtx: (RackExerciseRef & { athleteId: string }) | null = null;
  const notePhoneCtx = () => {
    const id = state.activeAthleteId;
    const r = state.session;
    if (!id || !r || r.active_athlete_id !== id) return;
    const n = rowNext();
    if (!n || n.wi == null || n.re == null) return;
    const p = sentByIpad;
    if (p && p.athleteId === id && p.workoutInstanceId === n.wi && p.routineExerciseId === n.re && p.setNumber === n.set) return;
    phoneCtx = { athleteId: id, workoutInstanceId: n.wi, routineExerciseId: n.re, setNumber: n.set };
  };
  const phoneRef = (): RackExerciseRef | null => {
    const id = state.activeAthleteId;
    const r = state.session;
    if (!id || !r || r.active_athlete_id !== id || !phoneCtx || phoneCtx.athleteId !== id) return null;
    const { athleteId: _a, ...ref } = phoneCtx;
    return ref;
  };
  const lastRackExerciseOf = (athleteId: string): RackExerciseRef | null => {
    const set = state.lastEndByAthlete[athleteId]?.set;
    return set && !set.free ? { workoutInstanceId: set.context.workoutInstanceId, routineExerciseId: set.context.routineExerciseId } : null;
  };

  /** resolveRackSet for the athlete; null = their workout isn't loaded (the engine falls back to the row). */
  const resolveFor = (athleteId: string, liftingContinues = false): ResolvedRackSet | null => {
    const a = today.find(t => t.athleteId === athleteId);
    if (!a) {
      // No today entry: the engine falls back to the row's context (a phone
      // "done through N" hint there could number an extra set) — say so, and
      // re-read today's list.
      if (now() - staleTodayAt > 10_000) {
        staleTodayAt = now();
        log('no workout loaded for the active athlete; using the row context', athleteId);
        opts.onStaleToday?.();
      }
      return null;
    }
    const ovr = override && override.athleteId === athleteId ? override : null;
    const ov = ovr?.ex ?? null;
    const instances = rackInstancesOf(a);
    // Phone-open beats the coach pick — except a pick made AFTER the phone's
    // current context (the latest action wins; the phone then follows it).
    // A newer phone context clears the override (apply()).
    // The row's phone context is the ACTIVE athlete's — never another's (a move target).
    const phoneNow = athleteId === state.activeAthleteId ? phoneRef() : null;
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
      override: ov ? { workoutInstanceId: ov.workoutInstanceId, routineExerciseId: ov.routineExerciseId, setNumber: ovr?.setNumber ?? null } : null,
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
    const exact = reason === 'override' && override?.athleteId === athleteId && override.setNumber != null && set?.setNumber === override.setNumber;
    if (
      cur && cur.athleteId === athleteId && cur.resolved &&
      cur.workoutInstanceId === next.workoutInstanceId && cur.routineExerciseId === next.routineExerciseId &&
      cur.exerciseId === next.exerciseId && cur.setNumber === next.setNumber && (cur.reason ?? null) === reason && !!cur.exact === exact
    ) return;
    apply(
      {
        type: 'localContext',
        athleteId,
        resolved: true,
        reason,
        exact,
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
      // Something else open = the phone's UNFINISHED exercise is the pick (a
      // finished one is only viewing) or a coach pick on another exercise.
      const somethingElseOpen = (!!res && !res.none && res.reason === 'phone' && !isLast(res)) || (!!ov && !isLast(ov));
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
      // The set a crash interrupted continues (same exercise + set number).
      if (adoptSet && adoptSet.athleteId === athleteId) {
        const a = adoptSet;
        adoptSet = null;
        applyResolution(athleteId, { workoutInstanceId: a.workoutInstanceId, routineExerciseId: a.routineExerciseId, exerciseId: a.exerciseId, setNumber: a.setNumber, reason: 'reopen' });
      }
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
    if (state.activeAthleteId !== before && recovering && recovering.athleteId !== state.activeAthleteId) {
      // R3: a tile switch during the recovery wait — land the crashed set first.
      const rec = recovering;
      rec.forced = true;
      if (rec.timer) {
        clearTimeout(rec.timer);
        rec.timer = null;
        rec.done = attemptRecovery(rec);
      } // else: the attempt in flight sees `forced`
    }
    if (state.activeAthleteId !== before) {
      if (override && override.athleteId !== state.activeAthleteId) override = null;
      published = null;
      sentByIpad = null;
      phoneCtx = null;
      lastAttemptKey = null;
    }
    if (event.type === 'sessionSync') {
      notePhoneCtx();
      maybeRecover();
    }
    if (state.activeAthleteId !== before) {
      // (handled above)
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
    trackBar(event);
    if (event.type !== 'localContext') reresolve();
    const changed = event.type !== 'tick' || `${state.setState}|${ctxKey(nextContext(state))}` !== ctxBefore;
    if (event.type !== 'loadChanged' && changed) deriveLoad();
    if (event.type !== 'loadChanged' && (changed || (publishFailedAt != null && now() - publishFailedAt >= PUBLISH_RETRY_MS))) {
      publishIfNeeded();
    }
    if (bar && bar.status === 'pending' && state.setState !== 'lifting' && (barFailedAt == null || now() - barFailedAt >= PUBLISH_RETRY_MS)) {
      publishBar();
    }
    notify();
  };

  // ---------------------------------------------------------------- BAR stepper (iPad bar weight)

  /** The iPad's bar weight for one exercise of the active athlete (pending = not sent yet). */
  let bar: {
    athleteId: string;
    wi: string | null;
    re: string | null;
    lb: number;
    status: 'pending' | 'sent' | 'confirmed';
    /** When it was set (iPad clock). */
    at: number;
    /** The row's load for that exercise when it was set (a stale echo of it is not a phone edit). */
    prevLoad: number | null;
  } | null = null;
  /** The row's next-set load as last seen, per exercise (`wi:re` → lb) — a change is a phone edit. */
  let lastRowLoad: { key: string; lb: number | null } | null = null;
  let barFailedAt: number | null = null;

  const barFor = (athleteId: string, wi: string | null, re: string | null): number | null =>
    bar && bar.athleteId === athleteId && bar.wi === wi && bar.re === re ? bar.lb : null;

  /** Rows / athlete / exercise changes settle the bar weight (confirmed, replaced by the phone, or gone). */
  const trackBar = (event: RackEvent) => {
    let prev: number | null | undefined;
    let rowLb: number | null = null;
    let n: ReturnType<typeof rowNext> = null;
    if (event.type === 'sessionSync') {
      n = rowNext();
      const key = n ? `${n.wi}:${n.re}` : '';
      rowLb = n && n.load != null ? Number(n.load) : null;
      prev = lastRowLoad && lastRowLoad.key === key ? lastRowLoad.lb : undefined;
      lastRowLoad = { key, lb: rowLb };
    }
    if (!bar || event.type === 'barLoad') return;
    if (bar.athleteId !== state.activeAthleteId) {
      clearBar();
      return;
    }
    if (state.setState !== 'lifting') {
      const local = state.localContext;
      // The resolver moved to another exercise: this lift's bar weight no longer applies.
      if (local?.resolved && local.athleteId === bar.athleteId && (local.workoutInstanceId !== bar.wi || local.routineExerciseId !== bar.re)) {
        clearBar();
        return;
      }
    }
    if (event.type !== 'sessionSync') return;
    if (!n || n.wi !== bar.wi || n.re !== bar.re || rowLb == null) return;
    if (rowLb === bar.lb) {
      bar.status = 'confirmed';
      return;
    }
    // The row's load changed to something else after the iPad's step = a phone LB edit: the phone wins,
    // whatever the bar's status. Within the 3 s guard, the row going back to the load from before the
    // step is the phone's stale (in-flight) context, not an edit.
    if (prev === rowLb) return;
    if (now() - bar.at < LOAD_EDIT_GUARD_MS && rowLb === bar.prevLoad) return;
    clearBar();
  };
  const clearBar = () => {
    const b = bar;
    bar = null;
    if (b && state.barLoad) apply({ type: 'barLoad', athleteId: b.athleteId, workoutInstanceId: b.wi, routineExerciseId: b.re, lb: null }, now());
  };

  /** Publish the bar weight with the row's next set (rack_set_ipad_context); the phone's LB cell follows. */
  const publishBar = () => {
    const b = bar;
    const rackId = state.rackId;
    if (!b || !rackId || !api.setIpadContext || state.setState === 'lifting') return;
    const r = state.session;
    if (!r || r.active_athlete_id !== b.athleteId) return;
    if (b.wi == null || b.re == null) {
      b.status = 'confirmed'; // a free set: the sensor + this iPad only
      return;
    }
    const n = rowNext();
    const sameRow = !!n && n.wi === b.wi && n.re === b.re;
    const setNumber = sameRow && n!.set != null ? n!.set : nextSetNumber(state, b.athleteId);
    b.status = 'sent';
    // The iPad's own published context keeps its key in step (no re-publish of an old load).
    if (published && published.athleteId === b.athleteId && published.workoutInstanceId === b.wi && published.routineExerciseId === b.re) {
      published = { ...published, loadLb: b.lb };
      lastAttemptKey = `${published.athleteId}:${published.workoutInstanceId}:${published.routineExerciseId}:${published.setNumber}:${published.loadLb}`;
    }
    const setIpadContext = api.setIpadContext;
    rpcChain = rpcChain.then(async () => {
      try {
        const row = await withTimeout(
          setIpadContext(rackId, b.athleteId, { workoutInstanceId: b.wi, routineExerciseId: b.re, setNumber, loadLb: b.lb }),
          RPC_TIMEOUT_MS,
          'setIpadContext',
        );
        barFailedAt = null;
        if (row) dispatch({ type: 'sessionSync', row });
      } catch (e) {
        log('setIpadContext (bar weight) failed', e);
        barFailedAt = now();
        if (bar === b && b.status === 'sent') b.status = 'pending';
      }
    });
  };

  const setBarLoad = (lbIn: number) => {
    if (queued(() => setBarLoad(lbIn))) return;
    const id = state.activeAthleteId;
    if (state.mode !== 'rack' || !id || !Number.isFinite(lbIn)) return;
    const lb = Math.max(0, Math.min(2000, Math.round(lbIn * 2) / 2));
    const c = state.setState === 'lifting' && state.live ? state.live.context : nextContext(state);
    const n = rowNext();
    const prevLoad = n && n.wi === c.workoutInstanceId && n.re === c.routineExerciseId && n.load != null ? Number(n.load) : null;
    bar = { athleteId: id, wi: c.workoutInstanceId, re: c.routineExerciseId, lb, status: 'pending', at: now(), prevLoad };
    barFailedAt = null;
    // The engine's next set uses it (mid-set: the live set stays frozen; the sensor follows between sets).
    // apply() then publishes it with the row (→ the phone's LB cell): between sets now, mid-set once the set ends.
    apply({ type: 'barLoad', athleteId: id, workoutInstanceId: c.workoutInstanceId, routineExerciseId: c.routineExerciseId, lb }, now());
  };

  // ---------------------------------------------------------------- fix mistakes

  /** Queue a fix-mistakes call; kept in memory (drained before the next flush) if storage fails. */
  const queueFix = async (item: FixItem, run: () => Promise<void>) => {
    await durably(item.kind, run, () => unsavedFixes.push({ item, run }));
    void flushSoon();
  };

  /** Wait until the effect chain has run (the set write is durably queued). */
  const effectsDone = async () => {
    for (let i = 0; i < 20; i++) {
      const e = effectChain;
      await e;
      if (e === effectChain) return;
    }
  };

  /** One athlete's logs, now (bounded) — a move target's set is resolved on fresh logs. */
  const readLogsNow = async (athleteId: string) => {
    if (!state.rackId) return;
    const reqSeq = ++seq;
    const reqAt = now();
    try {
      const rows = await withTimeout(api.athleteSets(state.rackId, athleteId), LOG_HOLD_MAX_MS, 'athleteSets');
      await storeLogs(athleteId, rows, reqSeq, reqAt);
    } catch (e) {
      log('move: target log read failed; resolving on cached logs', e);
    }
  };

  /** The target's set: resolveRackSet on their fresh logs — the same rules as everywhere. */
  const targetSet = async (targetId: string): Promise<SetRef> => {
    await readLogsNow(targetId);
    const res = resolveFor(targetId);
    return res && !res.none
      ? { athleteId: targetId, workoutInstanceId: res.workoutInstanceId, routineExerciseId: res.routineExerciseId, setNumber: res.setNumber }
      : { athleteId: targetId, workoutInstanceId: null, routineExerciseId: null, setNumber: null };
  };

  const moveSet = async (targetId: string, o?: { last?: boolean }): Promise<SetRef | null> => {
    releaseHold();
    if (state.mode !== 'rack' || !state.rackId) return null;
    // Mid-set: the live set becomes the target's — nothing saved to the wrong athlete, no rack_end_set.
    if (!o?.last && state.setState === 'lifting' && state.live && state.live.athleteId !== targetId) {
      const startedAt = state.live.startedAtMs;
      const to = await targetSet(targetId);
      if (state.setState === 'lifting' && state.live && state.live.startedAtMs === startedAt) {
        const ex = to.routineExerciseId
          ? today.find(t => t.athleteId === targetId)?.exercises.find(e => e.workoutInstanceId === to.workoutInstanceId && e.routineExerciseId === to.routineExerciseId)
          : undefined;
        dispatch({
          type: 'moveLiveSet',
          toAthleteId: targetId,
          workoutInstanceId: to.workoutInstanceId,
          routineExerciseId: to.routineExerciseId,
          exerciseId: ex?.exerciseId ?? (to.routineExerciseId ? state.exerciseByRoutineExercise[to.routineExerciseId] ?? null : null),
          setNumber: to.setNumber,
          zoneMin: ex?.zoneMin ?? null,
          zoneMax: ex?.zoneMax ?? null,
          dropStopPct: ex?.dropStopPct ?? null,
        });
        await effectsDone();
        return to;
      }
      // The set ended meanwhile (phone Done / idle): move it as the last set.
    }
    await effectsDone();
    const src = state.lastEnded;
    if (!src || src.endedAtMs == null || src.athleteId === targetId || now() - src.endedAtMs > MOVE_WINDOW_MS) return null;
    const c = src.context;
    const from: SetRef = { athleteId: src.athleteId, workoutInstanceId: c.workoutInstanceId, routineExerciseId: c.routineExerciseId, setNumber: c.setNumber };

    const to = await targetSet(targetId);

    // Local truth right away: the wrong athlete's set is gone, the target's is complete.
    apply({ type: 'setMoved', athleteId: src.athleteId, setStartedAtMs: src.startedAtMs }, now());
    if (!src.free && c.workoutInstanceId && c.routineExerciseId && c.setNumber != null) {
      const k = `${src.athleteId}:${c.workoutInstanceId}:${c.routineExerciseId}:${c.setNumber}`;
      rackWritten.delete(k);
      movedAway.add(k);
    }
    if (to.workoutInstanceId && to.routineExerciseId && to.setNumber != null) {
      rackWritten.set(`${targetId}:${to.workoutInstanceId}:${to.routineExerciseId}:${to.setNumber}`, {
        athleteId: targetId,
        workoutInstanceId: to.workoutInstanceId,
        routineExerciseId: to.routineExerciseId,
        setNumber: to.setNumber,
        isComplete: true,
        seq: ++seq,
      });
      apply({ type: 'seedHighWater', athleteId: targetId, workoutInstanceId: to.workoutInstanceId, routineExerciseId: to.routineExerciseId, setNumber: to.setNumber }, now());
    }
    if (src.free) {
      // A free set: exactly its reps (rack_move_set would take every free rep of the athlete).
      const ids = src.reps.filter(r => !r.carried).map(r => r.clientRepId);
      if (persist.moveReps) {
        const mv = persist.moveReps;
        await queueFix({ kind: 'moveReps', id: `reps:${ids.join(',')}>${targetId}`, clientRepIds: ids, to }, () => mv(ids, to));
      } else log('moveSet: persist has no move queue');
    } else {
      const item: FixItem = { kind: 'move', id: `move:${from.athleteId}:${src.startedAtMs}>${targetId}`, from, to };
      if (persist.moveSet) {
        const mv = persist.moveSet;
        await queueFix(item, () => mv(from, to));
      } else log('moveSet: persist has no move queue');
    }

    // Then the right athlete goes up — unless someone else is lifting now.
    if (state.activeAthleteId !== targetId && state.setState !== 'lifting') dispatch({ type: 'selectAthlete', athleteId: targetId });
    return to;
  };

  const removeRep = async (clientRepId: string, o?: { remote?: boolean }) => {
    if (queued(() => void removeRep(clientRepId, o))) return;
    apply({ type: 'removeRep', clientRepId }, now());
    if (o?.remote) return;
    // Held in memory only (its enqueue failed): never send it — nothing to remove on the server.
    const mem = unsavedReps.findIndex(u => u.clientRepId === clientRepId);
    if (mem >= 0) {
      unsavedReps.splice(mem, 1);
      return;
    }
    if (!persist.removeRep) {
      log('removeRep: persist has no move queue');
      return;
    }
    const rm = persist.removeRep;
    await queueFix({ kind: 'remove', id: `remove:${clientRepId}`, clientRepId }, () => rm(clientRepId));
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
  /** The row holds the phone's "done through N" context (set past the prescription). */
  const phoneRowFinished = (): boolean => {
    const n = rowNext();
    const id = state.activeAthleteId;
    if (!n || n.wi == null || n.re == null || n.set == null || !id) return false;
    const ex = today.find(t => t.athleteId === id)?.exercises.find(e => e.workoutInstanceId === n.wi && e.routineExerciseId === n.re);
    return !!ex && n.set > Math.max(0, ex.sets ?? 1);
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
    // The phone's context: never echo it — except a finished exercise the
    // phone only views ("done through N", set > prescribed): not a target, so
    // the row shows the rack's resolved set (the phone's strip reads the row).
    if (!ipadOwnsContext() && !coach && !phoneRowFinished()) return;
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
      const barLb = barFor(id, c.workoutInstanceId, c.routineExerciseId);
      if (barLb != null) lb = barLb; // the iPad's BAR stepper
      else if (!phoneLoad && (c.routineExerciseId || c.exerciseId)) {
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
    // A rep while a killed-set recovery waits: the set is still being lifted — adopt it.
    if (event.type === 'rep' && recovering) cancelRecovery();
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
    if (starting) {
      // A coach's explicit set is used once: the next set follows the normal rules.
      if (override?.setNumber != null && state.live?.athleteId === override.athleteId && state.live.context.routineExerciseId === override.ex.routineExerciseId) {
        override = { ...override, setNumber: null };
      }
      publishStart();
    }
  };

  // ---------------------------------------------------------------- today

  /** The coach's pick + the phone context it was made over (phoneSig). */
  let override: { athleteId: string; ex: TodayExercise; phoneSig: string; setNumber: number | null } | null = null;

  const setOverride = (athleteId: string, ex: TodayExercise | null, setNumber: number | null = null) => {
    if (queued(() => setOverride(athleteId, ex, setNumber))) return;
    override = ex
      ? { athleteId, ex, phoneSig: athleteId === state.activeAthleteId ? refSig(phoneRef()) : '', setNumber }
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
    unsavedCount: () => ({ reps: unsavedReps.length, sets: unsavedSets.length + unsavedFixes.length }),
    ipadOwnsContext,
    moveSet,
    removeRep,
    setBarLoad,
    barLoad: () => {
      const id = state.activeAthleteId;
      if (!bar || !id || bar.athleteId !== id) return null;
      const live = state.setState === 'lifting' ? state.live : null;
      if (live) {
        if (live.context.workoutInstanceId !== bar.wi || live.context.routineExerciseId !== bar.re) return null;
        // Changed before the set's first rep = the live set's own load (no "NEXT SET").
        return { lb: bar.lb, next: bar.at >= live.startedAtMs };
      }
      return { lb: bar.lb, next: false };
    },
    pickerRows: (athleteId: string) => {
      const a = today.find(t => t.athleteId === athleteId);
      return a ? pickerRowsOf(rackInstancesOf(a), logsFor(athleteId)) : [];
    },
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
      if (recovering?.timer) clearTimeout(recovering.timer);
      recovering = null; // a later start() can recover again
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
        if (recovering) await recovering.done;
        const e = effectChain;
        const r = rpcChain;
        await e;
        await r;
        if (!held && e === effectChain && r === rpcChain) return;
      }
    },
  };
}
