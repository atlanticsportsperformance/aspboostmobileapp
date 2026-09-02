/**
 * Which routine_exercises a read-only workout preview should render.
 *
 * A routine can hold three kinds of row:
 *   - a real exercise                     -> render it
 *   - a true placeholder (unresolved)     -> hide it; it has no content yet
 *   - a notes_only instruction card       -> render it, but it has NO joined
 *                                            `exercises` row at all
 *
 * Two flags decide this, and BOTH live on the routine_exercise: its own
 * `is_placeholder`, and the joined exercise's. A row can carry
 * `is_placeholder: false` while pointing at an exercise that is itself a
 * placeholder, so checking only the row's flag lets unresolved rows through.
 *
 * Callers must SELECT `is_placeholder` and `notes_only`. If they don't, the
 * fields arrive `undefined`, every row passes the filter, and a notes_only row
 * reaches the renderer with `exercises: null` — which is exactly how the parent
 * dashboard crashed on `exercises.name`.
 */
export interface PreviewRoutineExercise {
  id: string;
  order_index: number;
  is_placeholder?: boolean | null;
  notes_only?: boolean | null;
  exercises?: { id: string; name: string; is_placeholder?: boolean } | null;
  [key: string]: any;
}

export function visibleRoutineExercises<T extends PreviewRoutineExercise>(
  routineExercises: T[] | null | undefined,
): T[] {
  return [...(routineExercises || [])]
    .filter(re => !(re.is_placeholder || re.exercises?.is_placeholder) || re.notes_only)
    .sort((a, b) => a.order_index - b.order_index);
}

/**
 * Display name for a preview row. Notes-only rows carry their title in
 * `placeholder_name` because they have no exercise to read a name from.
 */
export function previewExerciseName(re: PreviewRoutineExercise): string {
  return re.exercises?.name || re.placeholder_name || 'Exercise';
}
