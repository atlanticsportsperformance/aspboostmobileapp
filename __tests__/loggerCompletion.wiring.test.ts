import { readFileSync } from 'fs';
import { join } from 'path';

const S = readFileSync(join(__dirname, '..', 'screens/WorkoutLoggerScreen.tsx'), 'utf8');
const body = (start: string, end: string) => S.slice(S.indexOf(start), S.indexOf(end, S.indexOf(start)));

describe('workout logger — set completion survives leaving and resuming', () => {
  it('resume trusts is_complete via isSetDoneFromLog', () => {
    expect(S).toContain("from '../lib/loggerResume'");
    expect(S).toContain('completedArray[setIndex] = isSetDoneFromLog(log)');
  });
  it('checking/unchecking a set persists completion (Log Set → complete, uncheck → draft)', () => {
    const fn = body('const handleToggleSetComplete', '// Get current exercise and routine');
    expect(fn).toContain('persistSet(activeExerciseId, setIndex, !currentlyCompleted)');
    // double-tap while saving is ignored, cleared when the save settles
    expect(fn).toContain('if (completionInFlightRef.current.has(inFlightKey)) return;');
    expect(fn).toContain('.finally(() => completionInFlightRef.current.delete(inFlightKey))');
    // a logged set on a sequence step starts the rest timer
    expect(fn).toContain('if (ok && !currentlyCompleted) startRestAfter(activeExerciseId, setIndex);');
  });
  it('Next / Log Set persists the current set as complete', () => {
    const fn = body('const handleNextSet', '// Navigation handlers');
    expect(fn).toContain('persistSet(activeExerciseId, currentSetIndex, true)');
  });
  it('quick-complete persists both completing and un-completing', () => {
    const fn = body('const handleToggleExerciseComplete', '// Helper to get max value');
    expect(fn).toContain('await persistSet(exerciseId, setIndex, newStatus)');
  });
  it('saves skip notes-only rows and out-of-range sets, and go through the outbox as full rows', () => {
    const fn = body('const persistSet', '// Rest after a logged set');
    expect(fn).toContain('if (!exercise.exercise_id) return false;');
    expect(fn).toContain('if (!isValidSetIndex(setIndex, exercise.sets)) return false;');
    expect(fn).toContain('buildLogRow(');
    expect(fn).toContain('inputsRef.current[exerciseId]?.[setIndex]');
    expect(fn).toContain('await loggerOutbox.enqueue(row)');
    expect(fn).toContain('void loggerOutbox.flush()');
    expect(fn).not.toContain(".from('exercise_logs')");
  });
  it('field edits save drafts; an edit never marks a set done, editing a done set keeps it done', () => {
    const fn = body('const handleInputChange', '// Handle next set / done');
    expect(fn).toContain('completeForEdit(completedRef.current[targetExerciseId], setIndex)');
    expect(fn).toContain('}, 500);');
    expect(fn).not.toContain('commitCompleted');
    expect(fn).not.toContain('setCompletedSets');
  });
  it('outbox flushes after load and on app foreground; reload overlays unsynced rows', () => {
    expect(S).toContain('const loggerOutbox = createOutbox();');
    expect(S).toContain("if (state === 'active') void loggerOutbox.flush();");
    expect(S).toMatch(/loadWorkout\(\)\.finally\(\(\) => \{\s*void loggerOutbox\.flush\(\);/);
    expect(S).toContain('await loggerOutbox.pending()');
  });
});
