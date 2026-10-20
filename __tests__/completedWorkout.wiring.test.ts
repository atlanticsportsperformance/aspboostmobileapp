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
    // resetWorkout clears the outbox (and the rack/solo queues) before it deletes the logs
    expect(fn).toContain('await resetWorkout(workoutInstanceId,');
    const R = readFileSync(join(__dirname, '..', 'lib/logger/resetWorkout.ts'), 'utf8');
    const reset = R.slice(R.indexOf('export async function resetWorkout'));
    expect(reset.indexOf('await clearWorkoutLocalState(instanceId, athleteId);')).toBeLessThan(reset.indexOf(".from('exercise_logs').delete()"));
    expect(R).toContain('loggerOutbox.drop(instanceId),');
  });
});
