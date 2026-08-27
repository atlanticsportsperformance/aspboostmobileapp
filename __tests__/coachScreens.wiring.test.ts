import { readFileSync } from 'fs';
import { join } from 'path';
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('AuthContext exposes app_role', () => {
  const S = read('contexts/AuthContext.tsx');
  it('selects it with account_type and exposes appRole', () => {
    expect(S).toContain(".select('account_type, app_role')");
    expect(S).toContain('appRole');
    expect(S).toMatch(/appRole: string \| null/);
  });
});

describe('useAthleteLifecycle can look at someone else', () => {
  const S = read('lib/useAthleteLifecycle.ts');
  it('accepts an optional athleteId and resolves by athletes.id under its own cache key', () => {
    expect(S).toContain('export function useAthleteLifecycle(athleteId?: string | null)');
    expect(S).toContain("`athlete:${athleteId}`");
    expect(S).toContain(".eq('id', athleteId)");
    expect(S).toContain(".eq('user_id', userId)");
  });
});

describe('the pitching screens gate on the ATHLETE being viewed', () => {
  it('PitchingHub passes athleteId', () => {
    expect(read('screens/PitchingHubScreen.tsx')).toContain('useAthleteLifecycle(athleteId)');
  });
  it('PitchingScreen passes athleteId', () => {
    expect(read('screens/PitchingScreen.tsx')).toContain('useAthleteLifecycle(athleteId)');
  });
});

describe('CompletedWorkout can be opened read-only', () => {
  const S = read('screens/CompletedWorkoutScreen.tsx');
  it('reads the param and hides both write buttons and the reset modal', () => {
    expect(S).toContain('const { workoutInstanceId, readOnly = false } = route.params;');
    expect(S).toContain('{!readOnly && (');
    expect(S.split('{!readOnly && (').length - 1).toBeGreaterThanOrEqual(2);
  });
});
