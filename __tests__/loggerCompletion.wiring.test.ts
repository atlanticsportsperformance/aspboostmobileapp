import { readFileSync } from 'fs';
import { join } from 'path';

const S = readFileSync(join(__dirname, '..', 'screens/WorkoutLoggerScreen.tsx'), 'utf8');
const body = (start: string, end: string) => S.slice(S.indexOf(start), S.indexOf(end, S.indexOf(start)));

describe('workout logger — set completion survives leaving and resuming', () => {
  it('resume trusts is_complete via isSetDoneFromLog', () => {
    expect(S).toContain("from '../lib/loggerResume'");
    expect(S).toContain('completedArray[setIndex] = isSetDoneFromLog(log)');
  });
  it('checking/unchecking a set persists completion', () => {
    const fn = body('const handleToggleSetComplete', '// Get current exercise and routine');
    expect(fn).toContain('saveSetData(activeExerciseId, setIndex, null, null, !currentlyCompleted)');
    // double-tap while saving is ignored, cleared when the save settles
    expect(fn).toContain('if (completionInFlightRef.current.has(inFlightKey)) return;');
    expect(fn).toContain('.finally(() => completionInFlightRef.current.delete(inFlightKey))');
  });
  it('Next / Log Set persists the current set as complete', () => {
    const fn = body('const handleNextSet', '// Navigation handlers');
    expect(fn).toContain('saveSetData(activeExerciseId, currentSetIndex, null, null, true)');
  });
  it('quick-complete persists both completing and un-completing', () => {
    const fn = body('const handleToggleExerciseComplete', '// Save set data to database');
    expect(fn).toContain('saveSetData(exerciseId, setIndex, null, null, newStatus)');
  });
  it('completion-only saves skip notes-only rows and only un-mark existing rows', () => {
    const fn = body('const saveSetData', '// Helper to get max value');
    expect(fn).toContain('if (field === null && !exercise.exercise_id) return;');
    expect(fn).toContain('if (!existingLog) return;');
    expect(fn).toContain('.update({ is_complete: false })');
    expect(fn).toContain('if (field === null && !isValidSetIndex(setIndex, exercise.sets)) return;');
  });
});
