import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const D = read('screens/exercise-detail-view.tsx');
const L = read('screens/WorkoutLoggerScreen.tsx');
const R = read('components/logger/RpeRow.tsx');

describe('RPE row wiring', () => {
  it('RpeRow uses the amber label and outlines the target', () => {
    expect(R).toContain('LOGGER_COLORS.rpe');
    expect(R).toContain('RPE · TARGET');
    expect(R).toContain('rpeOptions(target)');
  });
  it('detail view renders <RpeRow only inside an ask_rpe condition', () => {
    expect(D.match(/<RpeRow/g)?.length).toBe(1);
    const i = D.indexOf('<RpeRow');
    expect(D.slice(Math.max(0, i - 300), i)).toContain('exercise.ask_rpe');
  });
  it('RPE row target falls back to the exercise-level rpe_target', () => {
    expect(D).toContain('target={setConfig?.rpe ?? exercise.rpe_target ?? null}');
  });
  it('done set with no rpe on an ask_rpe exercise shows RPE?', () => {
    expect(D).toContain('RPE?');
    expect(D).toMatch(/isCompleted && exercise\.ask_rpe && rpeValues/);
  });
  it('the chosen rpe feeds buildLogRow and saves immediately (rpe only, completion untouched)', () => {
    expect(L).toContain('rpe: write.rpe ? rpeRef.current[`${exerciseId}:${setIndex}`] ?? null : undefined');
    const fn = L.slice(L.indexOf('const handleRpeChange'), L.indexOf('// Get current exercise and routine'));
    expect(fn).toContain('rpeRef.current');
    expect(fn).toContain('persistSet(activeExerciseId, setIndex, { rpe: true, fields: draftFields })');
    expect(fn).not.toContain('complete:');
    expect(L).toContain('onRpeChange={handleRpeChange}');
  });
  it('a missing RPE never disables Log Set', () => {
    const fn = L.slice(L.indexOf('const handleToggleSetComplete'), L.indexOf('// RPE tap'));
    expect(fn).not.toMatch(/rpe/i);
    expect(D).not.toMatch(/disabled=\{[^}]*rpe/i);
  });
});
