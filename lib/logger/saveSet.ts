// Logger v2 save model (spec §7, §11.2/11.3). One exercise_logs row per set,
// keyed by (workout_instance_id, routine_exercise_id, set_number). The
// upsert_exercise_log RPC writes ONLY the keys present in the row (absent key
// = column untouched, key with null = cleared), so each write carries only
// what it means to change: a completion tap sends is_complete, an RPE tap
// sends rpe, a field edit sends the edited fields. A phone with stale local
// values then can't wipe what a coach or another device wrote.

export type SetKey = { workoutInstanceId: string; routineExerciseId: string; setNumber: number };

export type LogRow = Record<string, unknown>;

export type BuildOpts = {
  athleteId: string;
  exerciseId: string;
  orgId?: string | null;
  // Omitted → no is_complete key (the server keeps the set's completion).
  complete?: boolean;
  // Omitted → no rpe key (the server keeps the set's rpe).
  rpe?: number | null;
  // Local field names to write (reps, weight, a custom metric id, notes...).
  // Omitted → every value column (full set state). [] → no value columns.
  // Any custom metric in the list writes the set's whole metric_data (the
  // RPC replaces metric_data as one value).
  fields?: readonly string[];
};

// Identity keys every write carries.
export const IDENTITY_KEYS = ['workout_instance_id', 'routine_exercise_id', 'set_number', 'athlete_id', 'exercise_id', 'org_id'] as const;

// Local field name → dedicated numeric column. Everything else (custom
// measurements) lives in metric_data; notes has its own text column.
const NUMERIC_COLUMNS: Record<string, string> = {
  reps: 'actual_reps',
  weight: 'actual_weight',
  time_seconds: 'actual_duration_seconds',
  distance: 'actual_distance',
};

// The RPC casts these with ::int — a fractional value would fail the whole
// set's write, so round them here.
const INT_COLUMNS = new Set(['actual_reps', 'actual_duration_seconds']);

function toNumber(value: unknown, integer: boolean): number | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return integer ? Math.round(n) : n;
}

export function buildLogRow(key: SetKey, fields: Record<string, unknown>, opts: BuildOpts): LogRow {
  const row: LogRow = {
    workout_instance_id: key.workoutInstanceId,
    routine_exercise_id: key.routineExerciseId,
    set_number: key.setNumber,
    athlete_id: opts.athleteId,
    exercise_id: opts.exerciseId,
    ...(opts.orgId ? { org_id: opts.orgId } : {}),
  };
  const only = opts.fields ? new Set(opts.fields) : null;
  const wants = (field: string) => only == null || only.has(field);

  for (const [field, column] of Object.entries(NUMERIC_COLUMNS)) {
    if (wants(field)) row[column] = toNumber(fields[field], INT_COLUMNS.has(column));
  }
  if (wants('notes')) {
    const notes = fields.notes;
    row.notes = typeof notes === 'string' && notes !== '' ? notes : null;
  }

  const isCustom = (field: string) => !(field in NUMERIC_COLUMNS) && field !== 'notes';
  if (only == null || [...only].some(isCustom)) {
    const metricData: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (!isCustom(field)) continue;
      // A cleared custom metric is dropped, so writing metric_data removes it.
      if (value == null || value === '') continue;
      metricData[field] = value;
    }
    row.metric_data = metricData;
  }
  if (opts.complete !== undefined) row.is_complete = opts.complete;
  if (opts.rpe !== undefined) row.rpe = opts.rpe;
  return row;
}

// A field edit is a draft — unless the set is already logged: editing a done
// set must not un-complete it.
export function completeForEdit(completed: boolean[] | undefined, setIndex: number): boolean {
  return completed?.[setIndex] === true;
}

export type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: any; status?: number }>;
};

// retryable: true = the request never got a server answer (offline, fetch
// TypeError) — the outbox retries freely. false = the server rejected the row
// (Postgres/PostgREST error code, or a 4xx) — counts toward back-off.
export type SendResult = { ok: boolean; id?: string; retryable?: boolean };

export async function upsertSet(client: RpcClient, row: LogRow): Promise<SendResult> {
  try {
    const { data, error, status } = await client.rpc('upsert_exercise_log', { p_row: row });
    if (error) {
      const hasCode = typeof error?.code === 'string' && error.code !== '';
      const clientError = typeof status === 'number' && status >= 400 && status < 500;
      const rejected = hasCode || clientError;
      console.error(`upsert_exercise_log ${rejected ? 'rejected' : 'unreachable'}:`, error, 'row:', row);
      return { ok: false, retryable: !rejected };
    }
    return { ok: true, id: typeof data === 'string' ? data : undefined };
  } catch (error) {
    console.error('upsert_exercise_log threw (network):', error);
    return { ok: false, retryable: true };
  }
}
