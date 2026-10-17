// Logger v2 save model (spec §7, §11.2/11.3). One exercise_logs row per set,
// keyed by (workout_instance_id, routine_exercise_id, set_number). Every write
// carries the set's FULL current state — the upsert_exercise_log RPC overwrites
// all value columns, so a null clears a value and is_complete can go false.

export type SetKey = { workoutInstanceId: string; routineExerciseId: string; setNumber: number };

export type LogRow = Record<string, unknown>;

export type BuildOpts = {
  complete: boolean;
  athleteId: string;
  exerciseId: string;
  orgId?: string | null;
  // Omitted → no rpe key in the row. NOTE: the RPC writes rpe = null when the
  // key is absent, so callers that know a set's rpe must always pass it.
  rpe?: number | null;
};

// Local field name → dedicated numeric column. Everything else (custom
// measurements) lives in metric_data; notes has its own text column.
const NUMERIC_COLUMNS: Record<string, string> = {
  reps: 'actual_reps',
  weight: 'actual_weight',
  time_seconds: 'actual_duration_seconds',
  distance: 'actual_distance',
};

function toNumber(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
  for (const [field, column] of Object.entries(NUMERIC_COLUMNS)) {
    row[column] = toNumber(fields[field]);
  }
  const notes = fields.notes;
  row.notes = typeof notes === 'string' && notes !== '' ? notes : null;

  const metricData: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (field in NUMERIC_COLUMNS || field === 'notes') continue;
    // A cleared custom metric is dropped, so the full-state write removes it.
    if (value == null || value === '') continue;
    metricData[field] = value;
  }
  row.metric_data = metricData;
  row.is_complete = opts.complete;
  if (opts.rpe !== undefined) row.rpe = opts.rpe;
  return row;
}

// A field edit is a draft — unless the set is already logged: editing a done
// set must not un-complete it.
export function completeForEdit(completed: boolean[] | undefined, setIndex: number): boolean {
  return completed?.[setIndex] === true;
}

export type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function upsertSet(client: RpcClient, row: LogRow): Promise<{ ok: boolean; id?: string }> {
  try {
    const { data, error } = await client.rpc('upsert_exercise_log', { p_row: row });
    if (error) {
      console.error('upsert_exercise_log failed:', error, 'row:', row);
      return { ok: false };
    }
    return { ok: true, id: typeof data === 'string' ? data : undefined };
  } catch (error) {
    console.error('upsert_exercise_log threw:', error);
    return { ok: false };
  }
}
