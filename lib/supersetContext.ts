/**
 * Superset context helper — mobile port of lib/superset-context.ts in the
 * web repo. Calculates per-exercise progress within a superset routine so
 * the exercise-detail view can render "A1 [2/3] · A2 [1/3]" progress pills.
 */

export interface SupersetExercise {
  /** routine_exercises.id (NOT exercise_id) — used to match the active row */
  id: string;
  name: string;
  order: number;
  totalSets: number;
  completedSets: number;
}

export interface SupersetContext {
  isSupersetBlock: boolean;
  currentRound: number;
  totalRounds: number;
  exercises: SupersetExercise[];
  currentExerciseIndex: number;
  blockLabel: string | null;
  blockName: string | null;
}

interface RoutineExerciseLike {
  id: string;
  exercise_id: string;
  order_index: number;
  sets?: number;
  set_configurations?: any[];
  exercises?: { name?: string | null } | null;
  placeholder_name?: string | null;
}

interface RoutineLike {
  scheme?: string;
  name?: string;
  superset_block_name?: string | null;
  routine_exercises?: RoutineExerciseLike[];
}

/**
 * Build the superset context for the currently-selected exercise.
 *
 * @param routine               The routine the active exercise belongs to.
 * @param selectedRoutineExId   The routine_exercises.id of the active row.
 * @param currentSetIdx         Zero-based current set within that exercise.
 * @param completedSets         Map of routine_exercise.id → boolean[] of
 *                              completed flags (matches the parent state on
 *                              WorkoutLoggerScreen).
 */
export function getSupersetContext(
  routine: RoutineLike | undefined | null,
  selectedRoutineExId: string,
  currentSetIdx: number,
  completedSets: Record<string, boolean[]>,
): SupersetContext | null {
  if (!routine) return null;
  // Treat circuits as supersets for pill display (both alternate exercises).
  const isSuperset = routine.scheme === 'superset' || routine.scheme === 'circuit';
  if (!isSuperset) return null;

  const rows = (routine.routine_exercises || [])
    .slice()
    .sort((a, b) => a.order_index - b.order_index);

  const exercises: SupersetExercise[] = rows.map((re) => {
    const totalSets =
      (re.set_configurations && re.set_configurations.length) || re.sets || 3;
    const flags = completedSets[re.id] || [];
    const done = flags.reduce((n, f) => n + (f ? 1 : 0), 0);
    return {
      id: re.id,
      name: re.exercises?.name || re.placeholder_name || 'Exercise',
      order: re.order_index,
      totalSets,
      completedSets: done,
    };
  });

  const totalRounds = Math.max(...exercises.map((e) => e.totalSets), 1);
  const currentRound = currentSetIdx + 1;
  const currentExerciseIndex = exercises.findIndex(
    (e) => e.id === selectedRoutineExId,
  );

  // Hide auto-generated scheme-y names that aren't real coach labels.
  const schemeNames = ['exercise', 'superset', 'straight', 'straight_sets', 'circuit'];
  const showName =
    !!routine.name && !schemeNames.includes(routine.name.toLowerCase());

  return {
    isSupersetBlock: true,
    currentRound,
    totalRounds,
    exercises,
    currentExerciseIndex,
    blockLabel: routine.superset_block_name || null,
    blockName: showName ? (routine.name as string) : null,
  };
}
