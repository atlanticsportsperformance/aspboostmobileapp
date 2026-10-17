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
    expect(fn).toContain('persistSet(activeExerciseId, setIndex, { complete: !currentlyCompleted, fields: draftFields })');
    // double-tap while saving is ignored, cleared when the save settles
    expect(fn).toContain('if (completionInFlightRef.current.has(inFlightKey)) return;');
    expect(fn).toContain('setTimeout(() => completionInFlightRef.current.delete(inFlightKey), COMPLETION_GUARD_MS)');
    // a logged set on a sequence step starts the rest timer
    expect(fn).toContain('if (ok && !currentlyCompleted) startRestAfter(activeExerciseId, setIndex);');
  });
  it('Next / Log Set persists the current set as complete', () => {
    const fn = body('const handleNextSet', '// Navigation handlers');
    expect(fn).toContain('persistSet(activeExerciseId, currentSetIndex, { complete: true, fields: draftFields })');
  });
  it('Next Set pre-fills through nextSetPrefill, never a raw copy of every field', () => {
    const fn = body('const handleNextSet', '// Navigation handlers');
    expect(fn).toContain('nextSetPrefill({');
    expect(fn).not.toContain('Object.keys(currentSetData).forEach');
  });
  it('quick-complete (overview circle) persists only completion, both ways', () => {
    const fn = body('const handleToggleExerciseComplete', '// Helper to get max value');
    expect(fn).toContain('await persistSet(exerciseId, setIndex, { complete: newStatus, fields })');
    expect(fn).toContain('const fields = cancelDraft(exerciseId, setIndex);');
  });
  it('saves skip notes-only rows and out-of-range sets, and go through the outbox as partial rows', () => {
    const fn = body('const persistSet', '// Rest after a logged set');
    expect(fn).toContain('if (!exercise.exercise_id) return false;');
    expect(fn).toContain('if (!isValidSetIndex(setIndex, exercise.sets)) return false;');
    expect(fn).toContain('buildLogRow(');
    expect(fn).toContain('fields: write.fields ?? []');
    expect(fn).toContain('complete: write.complete');
    expect(fn).toContain('inputsRef.current[exerciseId]?.[setIndex]');
    expect(fn).toContain('await loggerOutbox.enqueue(row)');
    expect(fn).toContain('void loggerOutbox.flush()');
    expect(fn).not.toContain(".from('exercise_logs')");
  });
  it('field edits (typed or auto-filled) save drafts; an edit never marks a set done, editing a done set keeps it done', () => {
    const fn = body('const handleInputChange', '// Handle next set / done');
    expect(fn).not.toContain('isAutoFill ||');
    // drafts send only the edited fields and never is_complete
    expect(fn).toContain('persistSet(targetExerciseId, setIndex, { fields })');
    expect(fn).not.toContain('complete:');
    expect(fn).toContain('}, 500);');
    expect(fn).not.toContain('commitCompleted');
    expect(fn).not.toContain('setCompletedSets');
  });
  it('outbox flushes after load and on app foreground; reload overlays unsynced rows', () => {
    expect(S).toContain("import { loggerOutbox } from '../lib/logger/outbox';");
    expect(S).toMatch(/loadWorkout\(\)\.finally\(\(\) => \{\s*void loggerOutbox\.flush\(\{ foreground: true \}\);/);
    expect(S).toContain('await loggerOutbox.pending()');
    // queue is snapshotted BEFORE the server logs are read (a flush landing
    // in between can then never resurrect older server state)
    const load = body('const loadWorkout', '// Timer effect');
    const pendingAt = load.indexOf('await loggerOutbox.pending()');
    const logsAt = load.indexOf(".from('exercise_logs')");
    expect(pendingAt).toBeGreaterThan(-1);
    expect(pendingAt).toBeLessThan(logsAt);
    expect(load).toContain('mergeLogsWithPending(logs, pendingRows, workoutInstanceId)');
  });
  it('foreground sync lives at app level, so queued sets sync without the logger open', () => {
    const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toContain('useOutboxForegroundSync(!!session)');
    const hook = readFileSync(join(__dirname, '..', 'hooks/useOutboxForegroundSync.ts'), 'utf8');
    expect(hook).toContain("if (state === 'active') void syncAll();");
    expect(readFileSync(join(__dirname, '..', 'lib/logger/syncAll.ts'), 'utf8')).toContain('.flush({ foreground: true })');
    expect(S).not.toContain("AppState.addEventListener");
  });
  it('a fast second tap on Log Set cannot un-check the set (guard held ≥600 ms)', () => {
    const fn = body('const handleToggleSetComplete', '// Get current exercise and routine');
    expect(fn).toContain('COMPLETION_GUARD_MS');
    expect(S).toContain('const COMPLETION_GUARD_MS = 600;');
  });
});
