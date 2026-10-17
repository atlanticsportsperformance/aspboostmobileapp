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
  row: LogRow;
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

/** The upsert_exercise_log row for an ended (or amended) set; null when free. */
export function setWriteRow(summary: SetSummary, orgId: string | null): LogRow | null {
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
  if (summary.exerciseId == null) delete row.exercise_id;
  delete row.metric_data; // never replace metric_data — patch only
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

/** Unique violation on client_rep_id: the rep is already stored. */
export function isUniqueViolation(error: PgError): boolean {
  return error?.code === '23505';
}

// Expired/missing JWT, timeouts and rate limits are not the row's fault: keep
// the item and retry, never drop it.
const TRANSIENT_STATUS = new Set([401, 408, 425, 429]);
const TRANSIENT_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);

/** true = the server rejected the row itself (drop it); false = retry later. */
export function isPermanentError(error: PgError, status?: number): boolean {
  if (error?.code && TRANSIENT_CODES.has(error.code)) return false;
  if (typeof status === 'number') {
    if (TRANSIENT_STATUS.has(status)) return false;
    return status >= 400 && status < 500;
  }
  // No HTTP status: a Postgres error code means the server answered.
  return typeof error?.code === 'string' && error.code !== '' && !/^PGRST/.test(error.code);
}

function failure(what: string, error: PgError, status?: number): Error {
  const err = new Error(`${what}: ${error?.message ?? 'failed'}`) as Error & { permanent?: boolean };
  if (isPermanentError(error, status)) err.permanent = true;
  return err;
}

// ---------------------------------------------------------------- persist

export interface RackPersist {
  /** Durably queue one rep (resolves once it is on disk). */
  writeRep(rep: RepWrite): Promise<void>;
  /** Durably queue an ended set's write. No-op for a free set. */
  endSet(summary: SetSummary): Promise<void>;
  /** Same as endSet: re-writes the whole set, replacing any queued write. */
  amendSet(summary: SetSummary): Promise<void>;
  /** Flush both queues (reps first). Never rejects. */
  flush(): Promise<void>;
  pending(): Promise<{ reps: number; sets: number }>;
  readonly repQueue: Queue<VbtRepRow>;
  readonly setQueue: Queue<SetWriteItem>;
}

export function createRackPersist(opts: {
  client: RackClient & RpcClient;
  orgId: string;
  batchSize?: number;
  log?: (...args: unknown[]) => void;
}): RackPersist {
  const { client, orgId } = opts;
  const log = opts.log ?? ((...a: unknown[]) => console.warn('[rack persist]', ...a));

  const sendReps = async (rows: VbtRepRow[]) => {
    let res: { error: PgError; status?: number };
    try {
      res = await client
        .from('vbt_reps')
        .upsert(rows, { onConflict: 'client_rep_id', ignoreDuplicates: true });
    } catch (error) {
      throw failure('vbt_reps unreachable', error as PgError);
    }
    if (!res.error || isUniqueViolation(res.error)) return;
    throw failure('vbt_reps', res.error, res.status);
  };

  const repQueue = createQueue<VbtRepRow>(REP_QUEUE_KEY, row => sendReps([row]), {
    idOf: r => r.client_rep_id,
    sendBatch: sendReps,
    batchSize: opts.batchSize ?? 50,
  });

  const setQueue = createQueue<SetWriteItem>(
    SET_QUEUE_KEY,
    async item => {
      let res: { data: unknown; error: any; status?: number };
      try {
        res = await client.rpc('upsert_exercise_log', { p_row: item.row });
      } catch (error) {
        throw failure('upsert_exercise_log unreachable', error as PgError);
      }
      if (res.error) {
        log('upsert_exercise_log failed', res.error, item.key);
        throw failure('upsert_exercise_log', res.error, res.status);
      }
    },
    { idOf: i => i.key, replace: true },
  );

  const writeSet = async (summary: SetSummary) => {
    const key = setKeyOf(summary);
    const row = key ? setWriteRow(summary, orgId) : null;
    if (!key || !row) return; // free set: vbt_reps only
    await setQueue.enqueue({ key, row });
  };

  return {
    writeRep: rep => repQueue.enqueue(vbtRepRow(rep, orgId)),
    endSet: writeSet,
    amendSet: writeSet,
    async flush() {
      try {
        await repQueue.flush();
      } catch (e) {
        log('rep flush failed', e);
      }
      try {
        await setQueue.flush();
      } catch (e) {
        log('set flush failed', e);
      }
    },
    async pending() {
      return { reps: await repQueue.size(), sets: await setQueue.size() };
    },
    repQueue,
    setQueue,
  };
}
