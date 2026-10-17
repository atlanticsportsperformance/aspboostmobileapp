// "Last week" reference (spec §11.7): the athlete's most recent completed
// instance of the same exercise_id, excluding the current instance.

export interface LogRow {
  workout_instance_id: string;
  exercise_id: string;
  set_number: number;
  actual_weight: number | null;
  actual_reps: number | null;
  /** workout_instances.completed_at of the instance this log belongs to. */
  completed_at?: string | null;
  logged_at?: string | null;
}

export interface SetResult {
  weight: number | null;
  reps: number | null;
}

export interface LastSession {
  best: SetResult | null;
  bySet: Record<number, SetResult>;
}

function stamp(r: LogRow): number {
  const t = Date.parse(r.completed_at || r.logged_at || '');
  return Number.isNaN(t) ? -Infinity : t;
}

export function lastSession(
  history: LogRow[],
  exerciseId: string,
  excludeInstanceId: string,
): LastSession | null {
  // Latest timestamp per candidate instance.
  const latest = new Map<string, number>();
  for (const r of history) {
    if (r.exercise_id !== exerciseId || r.workout_instance_id === excludeInstanceId) continue;
    const t = stamp(r);
    const prev = latest.get(r.workout_instance_id);
    if (prev === undefined || t > prev) latest.set(r.workout_instance_id, t);
  }
  if (latest.size === 0) return null;

  let pickId = '';
  let pickT = -Infinity;
  let first = true;
  latest.forEach((t, id) => {
    if (first || t > pickT) {
      pickId = id;
      pickT = t;
      first = false;
    }
  });

  const rows = history.filter(
    (r) =>
      r.exercise_id === exerciseId &&
      r.workout_instance_id === pickId &&
      (r.actual_weight != null || r.actual_reps != null),
  );
  if (rows.length === 0) return null;

  const bySet: Record<number, SetResult> = {};
  for (const r of rows) bySet[r.set_number] = { weight: r.actual_weight, reps: r.actual_reps };

  const best = rows.reduce((a, b) => {
    const aw = a.actual_weight ?? -Infinity;
    const bw = b.actual_weight ?? -Infinity;
    if (bw !== aw) return bw > aw ? b : a;
    return (b.actual_reps ?? -Infinity) > (a.actual_reps ?? -Infinity) ? b : a;
  });

  return { best: { weight: best.actual_weight, reps: best.actual_reps }, bySet };
}

export function deltaText(current: number | null, last: number | null): string | null {
  if (current == null || last == null) return null;
  const diff = Math.round((current - last) * 100) / 100;
  if (diff === 0) return null;
  return diff > 0 ? `+${diff} lb over last week` : `−${Math.abs(diff)} lb vs last week`;
}
