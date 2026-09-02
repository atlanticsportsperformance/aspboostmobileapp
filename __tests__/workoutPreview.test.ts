import { readFileSync } from 'fs';
import { join } from 'path';
import { visibleRoutineExercises, previewExerciseName } from '../lib/workoutPreview';

const PARENT_SCREEN = readFileSync(
  join(__dirname, '..', 'screens', 'ParentDashboardScreen.tsx'),
  'utf8',
);

/**
 * Shapes taken from Jack Figmic's 2026-09-02 "Medium" workout
 * (instance a7303850-63bf-4c75-b9f2-e9a3ca223199), the one that crashed the
 * iOS app when his parent expanded the card.
 */
const REAL_EXERCISE = {
  id: 're-real',
  order_index: 1,
  is_placeholder: false,
  notes_only: false,
  exercises: { id: 'ex-1', name: 'Reverse Throws', is_placeholder: false },
};

// Blocks 3 and 4 of the real workout: is_placeholder AND notes_only true,
// exercise_id null, so PostgREST returns `exercises: null`.
const NOTES_ONLY_ROW = {
  id: 're-notes',
  order_index: 2,
  is_placeholder: true,
  notes_only: true,
  placeholder_name: 'Throwing Progression',
  exercises: null,
};

// Block 2 of the real workout: the ROW says is_placeholder false, but the
// joined exercise is itself a placeholder.
const UNRESOLVED_PLACEHOLDER = {
  id: 're-unresolved',
  order_index: 3,
  is_placeholder: false,
  notes_only: false,
  exercises: { id: 'ex-2', name: 'Placeholder', is_placeholder: true },
};

describe('a notes-only row never reaches the renderer as a null exercise', () => {
  it('keeps the notes-only card and names it from placeholder_name', () => {
    const visible = visibleRoutineExercises([REAL_EXERCISE, NOTES_ONLY_ROW]);
    expect(visible.map(r => r.id)).toEqual(['re-real', 're-notes']);
    expect(previewExerciseName(NOTES_ONLY_ROW)).toBe('Throwing Progression');
  });

  it('never dereferences a null exercise', () => {
    for (const row of visibleRoutineExercises([REAL_EXERCISE, NOTES_ONLY_ROW])) {
      expect(() => previewExerciseName(row)).not.toThrow();
    }
  });

  it('drops a row whose JOINED exercise is the placeholder', () => {
    const visible = visibleRoutineExercises([REAL_EXERCISE, UNRESOLVED_PLACEHOLDER]);
    expect(visible.map(r => r.id)).toEqual(['re-real']);
  });

  it('sorts by order_index without mutating the caller array', () => {
    const input = [{ ...REAL_EXERCISE, order_index: 9 }, { ...NOTES_ONLY_ROW, order_index: 1 }];
    const snapshot = input.map(r => r.id);
    expect(visibleRoutineExercises(input).map(r => r.id)).toEqual(['re-notes', 're-real']);
    expect(input.map(r => r.id)).toEqual(snapshot);
  });

  it('survives a routine with no exercises at all', () => {
    expect(visibleRoutineExercises(null)).toEqual([]);
    expect(visibleRoutineExercises(undefined)).toEqual([]);
    expect(visibleRoutineExercises([])).toEqual([]);
  });
});

/**
 * The filter is only as good as the columns the query fetches. The crash
 * happened because `is_placeholder` and `notes_only` were absent from the
 * SELECT, arrived as `undefined`, and so filtered nothing.
 */
describe('the parent dashboard fetches the fields the filter reads', () => {
  const select = PARENT_SCREEN.split('routine_exercises (')[1]?.split(')')[0] ?? '';

  it('selects is_placeholder and notes_only on routine_exercises', () => {
    expect(select).toContain('is_placeholder');
    expect(select).toContain('notes_only');
  });

  it('selects placeholder_name, the only title a notes-only row has', () => {
    expect(select).toContain('placeholder_name');
  });

  it('routes the preview through the shared helper, not an inline filter', () => {
    expect(PARENT_SCREEN).toContain('visibleRoutineExercises(');
    expect(PARENT_SCREEN).toContain('previewExerciseName(');
    expect(PARENT_SCREEN).not.toContain('routineExercise.exercises.name');
  });
});
