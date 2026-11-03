import { readFileSync } from 'fs';
import { join } from 'path';
import { lookupExerciseIds } from '../lib/logger/exerciseIds';

describe('lookupExerciseIds', () => {
  it('drops null / undefined / empty ids from notes-only rows', () => {
    expect(lookupExerciseIds(['ex-A', null, 'ex-B', undefined, ''])).toEqual(['ex-A', 'ex-B']);
  });

  it('dedupes and keeps first-seen order', () => {
    expect(lookupExerciseIds(['ex-B', 'ex-A', 'ex-B', null, 'ex-A'])).toEqual(['ex-B', 'ex-A']);
  });

  it('accepts a Set and returns [] when every row is notes-only', () => {
    expect(lookupExerciseIds(new Set<string | null>([null]))).toEqual([]);
    expect(lookupExerciseIds([])).toEqual([]);
  });
});

describe('wiring: logger lookups never send a null exercise id', () => {
  const screen = readFileSync(join(__dirname, '../screens/WorkoutLoggerScreen.tsx'), 'utf8');

  it('maxes lookup uses the filtered list and skips the call when empty', () => {
    expect(screen).toContain('const maxExerciseIds = lookupExerciseIds(exerciseIdsToFetch);');
    expect(screen).toContain(".in('exercise_id', maxExerciseIds)");
    expect(screen).not.toContain(".in('exercise_id', Array.from(exerciseIdsToFetch))");
    expect(screen).toMatch(/const \{ data: maxes \} = maxExerciseIds\.length\s*\?/);
  });

  it('past-sets lookup uses the filtered list and skips the call when empty', () => {
    expect(screen).toMatch(/const uniqueExerciseIds = lookupExerciseIds\(/);
    expect(screen).toContain(".in('routine_exercises.exercise_id', uniqueExerciseIds)");
    expect(screen).toMatch(/const \{ data: historyData \} = !uniqueExerciseIds\.length\s*\?/);
    expect(screen).not.toContain('[...new Set(exerciseIds)]');
  });
});
