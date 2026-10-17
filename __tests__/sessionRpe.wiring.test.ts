import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const logger = read('screens/WorkoutLoggerScreen.tsx');
const completed = read('screens/CompletedWorkoutScreen.tsx');
const sheet = read('components/logger/SessionRpeSheet.tsx');
const pending = read('lib/logger/pendingComplete.ts');
const sync = read('hooks/useOutboxForegroundSync.ts');

describe('session RPE at finish', () => {
  it('sheet only when ask_session_rpe', () => {
    expect(logger).toMatch(/if \(workout\?\.ask_session_rpe\)\s*\{\s*setShowSessionRpe\(true\)/);
    expect(logger).toMatch(/workout\?\.ask_session_rpe \? \(\s*<SessionRpeSheet/);
    expect(sheet).toContain('How hard was today overall?');
    expect(sheet).toContain('[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]');
    expect(sheet).toContain('Skip');
  });

  it('Skip completes without session_rpe', () => {
    expect(logger).toMatch(/handleSkipSessionRpe = \(\) => \{\s*setShowSessionRpe\(false\);\s*void finalizeWorkout\(\);/);
    expect(pending).toMatch(/if \(p\.sessionRpe != null\) patch\.session_rpe = p\.sessionRpe/);
    expect(pending).toContain("status: 'completed'");
  });

  it('flushes the outbox before completing and never blocks offline', () => {
    const fin = logger.slice(logger.indexOf('const finalizeWorkout'));
    expect(fin.indexOf('loggerOutbox.flush')).toBeGreaterThan(-1);
    expect(fin.indexOf('loggerOutbox.flush')).toBeLessThan(fin.indexOf('sendCompletion('));
    expect(fin).toContain('queueCompletion(intent)');
    expect(sync).toContain('flushPendingCompletions');
  });

  it('CompletedWorkout select includes ask_rpe', () => {
    expect(completed).toMatch(/ask_rpe,/);
    expect(completed).toMatch(/\brounds,/);
    expect(completed).toContain('rest_between_rounds_seconds');
    expect(completed).toContain('session_rpe,');
    expect(completed).toMatch(/\brpe,\n\s*metric_data/);
    expect(completed).toContain('Session RPE');
  });
});
