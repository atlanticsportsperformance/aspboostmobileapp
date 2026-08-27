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

describe('CoachRosterScreen', () => {
  const S = read('screens/CoachRosterScreen.tsx');
  it('takes its list from the server payload, never coach_athletes', () => {
    expect(S).toContain("import { getCoachRosterStatus");
    expect(S).not.toContain("from('coach_athletes')");
    expect(S).not.toContain('getLinkedAthletes(');
  });
  it('searches with the existing filter and sorts two ways, persisted', () => {
    expect(S).toContain("import { filterAthletes } from '../lib/coachAthletes';");
    expect(S).toContain("const ROSTER_SORT_KEY = 'aspboost_coach_roster_sort';");
    expect(S).toContain('sortNeedsAttention(');
    expect(S).toContain('sortAlpha(');
    expect(S).toContain('Needs attention');
    expect(S).toContain('A–Z');
  });
  it('renders the two chips and opens the program calendar', () => {
    expect(S).toContain('runwayChip(');
    expect(S).toContain('activityChip(');
    expect(S).toContain("navigation.navigate('AthleteProgram', { athleteId: item.athlete_id, athleteName: item.athlete_name })");
  });
  it('surfaces logsUnavailable and suppresses activity chips', () => {
    expect(S).toContain('Activity unavailable right now');
  });
});

describe('coach home keeps its shape and gains Roster', () => {
  const S = read('screens/CoachDashboardScreen.tsx');
  it('imports the shared date helpers instead of declaring them', () => {
    expect(S).toContain("from '../lib/coachDates'");
    expect(S).not.toContain('function startOfDay(');
  });
  it('Schedule stays first and active; Roster is added', () => {
    expect(S).toContain("{ id: 'schedule', label: 'Schedule', icon: 'home', isActive: true, onPress: () => {} },");
    expect(S).toContain("{ id: 'roster', label: 'Roster', icon: 'people', onPress: () => navigation.navigate('CoachRoster') },");
    expect(S).not.toContain('athleteId={');
  });
});

describe('App registers the three coach screens lazily', () => {
  const S = read('App.tsx');
  for (const name of ['CoachRoster', 'AthleteProgram', 'CoachCoverage']) {
    it(`registers ${name}`, () => {
      expect(S).toContain(`<Stack.Screen name="${name}" getComponent={() => require('./screens/${name}Screen').default} />`);
    });
  }
  it("does not change the staff landing", () => {
    expect(S).toContain("nav.navigate(isStaff ? 'CoachDashboard' : isParentAccount ? 'ParentDashboard' : 'Dashboard');");
  });
});
