// Rack VBT persistence: two durable offline queues (never drop a rep).
//
//   rack_vbt_reps_v1   — one item per rep (id = client_rep_id). Flushed in
//                        batches into vbt_reps with ON CONFLICT (client_rep_id)
//                        DO NOTHING, so offline replays are idempotent.
//   rack_set_writes_v1 — one item per set (id = `${wi}:${re}:${set}`). A later
//                        write of the same set REPLACES the queued one (an
//                        amend after a late rep, a double end), so each flush
//                        makes one upsert_exercise_log call per set.
//
// Set rows go through upsert_exercise_log with only the keys the rack owns:
// identity (buildLogRow), actual_reps = full reps, actual_weight = load,
// is_complete = true, and metric_data_patch = { vbt } — shallow-merged by the
// RPC so the phone's custom metrics on the same set survive. `metric_data`
// itself is never sent. Free sets (no workout/routine exercise) write only
// vbt_reps.

import { createQueue, type Queue } from '../offline/queue';
import { buildLogRow, type LogRow, type RpcClient } from '../logger/saveSet';
import type { RepWrite, SetSummary } from './engine';
import type { RackClient } from './api';

export const REP_QUEUE_KEY = 'rack_vbt_reps_v1';
export const SET_QUEUE_KEY = 'rack_set_writes_v1';

export interface VbtRepRow {
  client_rep_id: string;
  org_id: string;
  athlete_id: string;
  rack_id: string | null;
  workout_instance_id: string | null;
  routine_exercise_id: string | null;
  exercise_id: string | null;
  set_number: number | null;
  rep_index: number;
  load_lb: number | null;
  mean_velocity: number;
  peak_velocity: number;
  mean_power_w: number;
  peak_power_w: number;
  rom_in: number;
  concentric_s: number;
  is_partial: boolean;
  received_at: string;
}

export interface SetWriteItem {
  key: string;
  /** Without exercise_id when `resolveExerciseFor` is set. */
  row: LogRow;
  /** routine_exercise id whose exercise_id is looked up at send time. */
  resolveExerciseFor?: string;
}

/** Read-only view of a dead-letter queue (it is never flushed). */
export interface DeadLetter<T> {
  peekAll(): Promise<T[]>;
  size(): Promise<number>;
}

export function vbtRepRow(rep: RepWrite, orgId: string): VbtRepRow {
  return {
    client_rep_id: rep.clientRepId,
    org_id: orgId,
    athlete_id: rep.athleteId,
    rack_id: rep.rackId,
    workout_instance_id: rep.workoutInstanceId,
    routine_exercise_id: rep.routineExerciseId,
    exercise_id: rep.exerciseId,
    set_number: rep.setNumber,
    rep_index: rep.repIndex,
    load_lb: rep.loadLb,
    mean_velocity: rep.meanVelocity,
    peak_velocity: rep.peakVelocity,
    mean_power_w: rep.meanPowerW,
    peak_power_w: rep.peakPowerW,
    rom_in: rep.romIn,
    concentric_s: rep.concentricS,
    is_partial: rep.isPartial,
    received_at: rep.receivedAt,
  };
}

/** Queue key of a set write; null for a free set (nothing to write). */
export function setKeyOf(s: Pick<SetSummary, 'workoutInstanceId' | 'routineExerciseId' | 'setNumber' | 'free'>): string | null {
  if (s.free || !s.workoutInstanceId || !s.routineExerciseId || s.setNumber == null) return null;
  return `${s.workoutInstanceId}:${s.routineExerciseId}:${s.setNumber}`;
}

/**
 * The upsert_exercise_log row for an ended (or amended) set. null when free,
 * or when the exercise is unknown (exercise_logs.exercise_id is NOT NULL — the
 * row would fail with 23502; the caller resolves it first or downgrades).
 */
export function setWriteRow(summary: SetSummary, orgId: string | null): LogRow | null {
  if (!summary.exerciseId) return null;
  return buildSetRow(summary, orgId);
}

/** As setWriteRow, but a null exerciseId leaves exercise_id out (resolved later). */
function buildSetRow(summary: SetSummary, orgId: string | null): LogRow | null {
  if (!setKeyOf(summary)) return null;
  const row = buildLogRow(
    {
      workoutInstanceId: summary.workoutInstanceId!,
      routineExerciseId: summary.routineExerciseId!,
      setNumber: summary.setNumber!,
    },
    { reps: summary.fullReps, weight: summary.loadLb },
    {
      athleteId: summary.athleteId,
      exerciseId: summary.exerciseId as string,
      orgId,
      complete: true,
      // Unknown load: leave the phone's weight alone (a null key would clear it).
      fields: summary.loadLb == null ? ['reps'] : ['reps', 'weight'],
    },
  );
  if (!summary.exerciseId) delete row.exercise_id;
  // fields ['reps','weight'] never builds metric_data; kept as a guard so a
  // future buildLogRow change can't make the rack replace the phone's metrics.
  delete row.metric_data;
  row.metric_data_patch = {
    vbt: {
      reps: summary.reps.map(r => ({ v: r.v, pv: r.pv, rom: r.rom, partial: r.partial })),
      avg_v: summary.avgV,
      best_v: summary.bestV,
      zone: summary.zone,
      drop_pct: summary.dropPct,
      source: summary.source,
      rack: summary.rackId,
      ended_by: summary.endedBy,
    },
  };
  return row;
}

// ---------------------------------------------------------------- errors

type PgError = { code?: string; message?: string } | null | undefined;

export const SEND_TIMEOUT_MS = 10_000;
export const REP_DEAD_KEY = 'rack_vbt_reps_dead_v1';
export const SET_DEAD_KEY = 'rack_set_writes_dead_v1';

/** Unique violation on client_rep_id: the rep is already stored. */
export function isUniqueViolation(error: PgError): boolean {
  return error?.code === '23505';
}

// Auth/session problems (expired JWT, deactivated or re-scoped Racks login,
// RLS 42501), timeouts and rate limits are not the row's fault: keep the item
// and back off — never drop it.
const TRANSIENT_STATUS = new Set([401, 403, 408, 425, 429]);
const isTransientCode = (code?: string) => code === '42501' || (!!code && /^PGRST30\d$/.test(code));

/** true = the server rejected the row itself; false = keep it and retry. */
export function isPermanentError(error: PgError, status?: number): boolean {
  if (isTransientCode(error?.code)) return false;
  if (typeof status === 'number') {
    if (TRANSIENT_STATUS.has(status)) return false;
    return status >= 400 && status < 500;
  }
  // No HTTP status: a Postgres error code means the server answered.
  return typeof error?.code === 'string' && error.code !== '' && !/^PGRST/.test(error.code);
}

function failure(what: string, error: PgError, status?: number): Error & { permanent?: boolean } {
  const err = new Error(`${what}: ${error?.message ?? 'failed'}`) as Error & { permanent?: boolean };
  if (isPermanentError(error, status)) err.permanent = true;
  return err;
}

/** Rejects with a transient (non-permanent) error after `ms`. */
export function withTimeout<T>(p: PromiseLike<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(p).finally(() => timer && clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: timed out after ${ms} ms`)), ms);
    }),
  ]);
}

// ---------------------------------------------------------------- persist

export interface RackPersist {
  /** Durably queue one rep (resolves once it is on disk). */
  writeRep(rep: RepWrite): Promise<void>;
  /**
   * Durably queue an ended set's write. No-op for a free set. A set with no
   * exerciseId is queued anyway and its exercise_id is looked up from
   * routine_exercises at send time (a lookup failure retries with the queue);
   * a definite null downgrades it to a free set (dead-lettered + logged).
   */
  endSet(summary: SetSummary): Promise<void>;
  /** Same as endSet: re-writes the whole set, replacing any queued write. */
  amendSet(summary: SetSummary): Promise<void>;
  /** Flush both queues (reps first). Never rejects. Skipped while backing
   *  off after a transient failure unless `force`. */
  flush(opts?: { force?: boolean }): Promise<void>;
  pending(): Promise<{ reps: number; sets: number }>;
  readonly repQueue: Queue<VbtRepRow>;
  readonly setQueue: Queue<SetWriteItem>;
  /** Items the server rejected as malformed (kept, never flushed or deleted). */
  readonly dead: { reps: DeadLetter<VbtRepRow>; sets: DeadLetter<SetWriteItem> };
}

export function createRackPersist(opts: {
  client: RackClient & RpcClient;
  orgId: string;
  batchSize?: number;
  log?: (...args: unknown[]) => void;
  now?: () => number;
  sendTimeoutMs?: number;
}): RackPersist {
  const { client, orgId } = opts;
  const log = opts.log ?? ((...a: unknown[]) => console.warn('[rack persist]', ...a));
  const now = opts.now ?? (() => Date.now());
  const timeoutMs = opts.sendTimeoutMs ?? SEND_TIMEOUT_MS;

  // Dead letters: a flush would "send" (= delete) them, so their send always
  // fails transiently and they are only exposed read-only.
  const never = async () => {
    throw new Error('dead letter: never flushed');
  };
  const deadReps = createQueue<VbtRepRow>(REP_DEAD_KEY, never, { idOf: r => r.client_rep_id });
  const deadSets = createQueue<SetWriteItem>(SET_DEAD_KEY, never);

  // Set by any transient send failure during a flush (drives back-off; a
  // dead-lettered permanent failure alone does not).
  let sawTransient = false;
  const raise = (err: Error & { permanent?: boolean }): never => {
    if (!err.permanent) sawTransient = true;
    throw err;
  };

  const sendReps = async (rows: VbtRepRow[]) => {
    let res: { error: PgError; status?: number };
    try {
      res = await withTimeout(
        client.from('vbt_reps').upsert(rows, { onConflict: 'client_rep_id', ignoreDuplicates: true }),
        timeoutMs,
        'vbt_reps',
      );
    } catch (error) {
      return raise(failure('vbt_reps unreachable', { message: String((error as Error)?.message ?? error) }));
    }
    if (!res.error || isUniqueViolation(res.error)) return;
    raise(failure('vbt_reps', res.error, res.status));
  };

  const repQueue = createQueue<VbtRepRow>(
    REP_QUEUE_KEY,
    async row => {
      try {
        await sendReps([row]);
      } catch (e) {
        if ((e as { permanent?: boolean }).permanent) {
          log('rep rejected; moved to dead letter', e, row.client_rep_id);
          await deadReps.enqueue(row);
        }
        throw e;
      }
    },
    { idOf: r => r.client_rep_id, sendBatch: sendReps, batchSize: opts.batchSize ?? 50 },
  );

  const setQueue = createQueue<SetWriteItem>(
    SET_QUEUE_KEY,
    async item => {
      let row = item.row;
      if (item.resolveExerciseFor && !row.exercise_id) {
        const exerciseId = await resolveExerciseId(item.resolveExerciseFor); // throws transient
        if (!exerciseId) {
          // exercise_logs.exercise_id is NOT NULL: no row is possible.
          log('set has no exercise_id; downgraded to a free set (vbt_reps only), dead-lettered', item.key);
          await deadSets.enqueue(item);
          return;
        }
        row = { ...row, exercise_id: exerciseId };
      }
      let res: { data: unknown; error: any; status?: number };
      try {
        res = await withTimeout(client.rpc('upsert_exercise_log', { p_row: row }), timeoutMs, 'upsert_exercise_log');
      } catch (error) {
        return raise(failure('upsert_exercise_log unreachable', { message: String((error as Error)?.message ?? error) }));
      }
      if (res.error) {
        const err = failure('upsert_exercise_log', res.error, res.status);
        log('upsert_exercise_log failed', res.error, item.key);
        if (err.permanent) await deadSets.enqueue({ ...item, row });
        raise(err);
      }
    },
    { idOf: i => i.key, replace: true },
  );

  const exerciseCache = new Map<string, string>();
  /** exercise_id of a routine exercise; null = definitely none. Any lookup
   *  failure throws a TRANSIENT error so the queue keeps the set and retries. */
  const resolveExerciseId = async (routineExerciseId: string): Promise<string | null> => {
    const hit = exerciseCache.get(routineExerciseId);
    if (hit) return hit;
    let res: { data: { exercise_id?: string | null } | null; error: PgError };
    try {
      res = (await withTimeout(
        client.from('routine_exercises').select('exercise_id').eq('id', routineExerciseId).maybeSingle(),
        timeoutMs,
        'routine_exercises',
      )) as typeof res;
    } catch (e) {
      log('exercise_id lookup unreachable; will retry', e, routineExerciseId);
      return raise(new Error(`routine_exercises unreachable: ${(e as Error)?.message ?? e}`));
    }
    if (res.error) {
      log('exercise_id lookup failed; will retry', res.error, routineExerciseId);
      return raise(new Error(`routine_exercises: ${res.error.message ?? 'failed'}`));
    }
    const id = res.data?.exercise_id ?? null;
    if (id) exerciseCache.set(routineExerciseId, id);
    return id;
  };

  const writeSet = async (summary: SetSummary) => {
    const key = setKeyOf(summary);
    if (!key) return; // free set: vbt_reps only
    const row = buildSetRow(summary, orgId);
    if (!row) return;
    await setQueue.enqueue(
      summary.exerciseId ? { key, row } : { key, row, resolveExerciseFor: summary.routineExerciseId! },
    );
  };

  // Back-off after a transient failure, so per-rep flushes don't hammer a
  // 401/403 server: 2 s doubling to 60 s, reset on a clean pass.
  let backoffMs = 0;
  let retryAt = 0;

  return {
    writeRep: rep => repQueue.enqueue(vbtRepRow(rep, orgId)),
    endSet: writeSet,
    amendSet: writeSet,
    async flush(o) {
      if (!o?.force && now() < retryAt) return;
      sawTransient = false;
      try {
        await repQueue.flush();
      } catch (e) {
        sawTransient = true;
        log('rep flush failed', e);
      }
      try {
        await setQueue.flush();
      } catch (e) {
        sawTransient = true;
        log('set flush failed', e);
      }
      if (sawTransient) {
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : 2_000, 60_000);
        retryAt = now() + backoffMs;
      } else {
        backoffMs = 0;
        retryAt = 0;
      }
    },
    async pending() {
      return { reps: await repQueue.size(), sets: await setQueue.size() };
    },
    repQueue,
    setQueue,
    dead: {
      reps: { peekAll: () => deadReps.peekAll(), size: () => deadReps.size() },
      sets: { peekAll: () => deadSets.peekAll(), size: () => deadSets.size() },
    },
  };
}
