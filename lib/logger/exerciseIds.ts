/**
 * Exercise ids that are safe to put in an `.in('exercise_id', ...)` lookup.
 *
 * Notes-only rows (warm-up text blocks: is_placeholder=true, notes_only=true)
 * are kept in the logger so they render, but they have exercise_id = null.
 * One null in the list is sent to PostgREST as the text "null", which is not
 * a uuid, so Postgres rejects the WHOLE lookup (400) and the athlete loses
 * every max and every past set for the workout. Drop blanks, keep first-seen
 * order, no duplicates. Same rule the rack uses (lib/rack/api.ts skips
 * rows with no exercise_id).
 */
export function lookupExerciseIds(ids: Iterable<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
