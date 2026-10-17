import { readFileSync } from 'fs';
import { join } from 'path';

const S = readFileSync(join(__dirname, '..', 'screens/CompletedWorkoutScreen.tsx'), 'utf8');
const body = (start: string, end: string) => S.slice(S.indexOf(start), S.indexOf(end, S.indexOf(start)));

describe('completed workout summary', () => {
  it('only is_complete rows count as logged sets (drafts / un-checked sets are hidden)', () => {
    const q = S.slice(S.indexOf(".from('exercise_logs')"), S.indexOf('setExerciseLogs(logsData'));
    expect(q).toContain(".eq('is_complete', true)");
  });
  it('Reset drops this workout\'s queued sets from the outbox before deleting its logs', () => {
    const fn = body('async function handleResetWorkout', 'setShowResetModal(false)');
    const dropAt = fn.indexOf('await loggerOutbox.drop(workoutInstanceId)');
    expect(dropAt).toBeGreaterThan(-1);
    expect(dropAt).toBeLessThan(fn.indexOf(".from('exercise_logs')"));
  });
});
