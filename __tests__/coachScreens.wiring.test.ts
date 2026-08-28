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
  it('resets appRole on both sign-out and a failed token refresh', () => {
    expect((S.match(/setAppRole\(null\)/g) || []).length).toBeGreaterThanOrEqual(2);
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
    expect(S).toContain("from '../lib/coachRosterApi'");
    expect(S).toContain('getCoachRosterStatus');
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
  it('renders one row per athlete with a severity stripe and category dots', () => {
    expect(S).toContain('runwaySubtitle(');
    expect(S).toContain('activitySubtitle(');
    expect(S).toContain('severityTone(');
    expect(S).toContain('programmedCategories(');
    expect(S).toContain("navigation.navigate('AthleteProgram', { athleteId: item.athlete_id, athleteName: item.athlete_name })");
  });
  it('surfaces logsUnavailable and suppresses the activity line', () => {
    expect(S).toContain('activity unavailable right now');
    expect(S).toContain('{!logsUnavailable && (');
  });
  it('asks for members, and only widens to everyone through the persisted All toggle', () => {
    expect(S).toContain('getCoachRosterStatus({ includeAll })');
    expect(S).toContain("const ROSTER_SCOPE_KEY = 'aspboost_coach_roster_scope';");
    expect(S).toContain("AsyncStorage.setItem(ROSTER_SCOPE_KEY, next ? 'all' : 'member')");
    // the preference must resolve before the first fetch, or the screen
    // loads members and then immediately reloads with everyone
    expect(S).toContain('if (prefsLoaded) load();');
  });
});

describe('the day list keeps its shape and can get back to Overview', () => {
  const S = read('screens/CoachDashboardScreen.tsx');
  it('imports the shared date helpers instead of declaring them', () => {
    expect(S).toContain("from '../lib/coachDates'");
    expect(S).not.toContain('function startOfDay(');
  });
  it('Schedule stays the active item; Overview and Roster are reachable', () => {
    expect(S).toContain("{ id: 'schedule', label: 'Schedule', icon: 'home', isActive: true, onPress: () => {} },");
    expect(S).toContain("{ id: 'overview', label: 'Overview', icon: 'grid', onPress: () => navigation.navigate('CoachOverview') },");
    expect(S).toContain("{ id: 'roster', label: 'Roster', icon: 'people', onPress: () => navigation.navigate('CoachRoster') },");
    expect(S).not.toContain('athleteId={');
  });
});

describe('App registers the coach screens lazily', () => {
  const S = read('App.tsx');
  for (const name of ['CoachOverview', 'CoachRoster', 'AthleteProgram', 'CoachCoverage']) {
    it(`registers ${name}`, () => {
      expect(S).toContain(`<Stack.Screen name="${name}" getComponent={() => require('./screens/${name}Screen').default} />`);
    });
  }
  it('lands staff on Overview and leaves the athlete and parent landings alone', () => {
    expect(S).toContain("nav.navigate(isStaff ? 'CoachOverview' : isParentAccount ? 'ParentDashboard' : 'Dashboard');");
  });
});

describe('AthleteProgramScreen', () => {
  const S = read('screens/AthleteProgramScreen.tsx');
  it('reads instances directly (RLS is the boundary) with the dashboard tree, by bare-date strings', () => {
    expect(S).toContain(".from('workout_instances')");
    expect(S).toContain(".eq('athlete_id', athleteId)");
    expect(S).toContain(".gte('scheduled_date', ");
    expect(S).toContain(".lte('scheduled_date', ");
    expect(S).toContain('routine_exercises (');
    expect(S).not.toContain('toISOString().split');
    expect(S).not.toContain('new Date(w.scheduled_date)');
    expect(S).toContain('w.scheduled_date === dayKey');
  });
  it('groups a day by category with the shared helper and the fixed order', () => {
    expect(S).toContain('groupDayWorkouts(');
    expect(S).toContain('CATEGORY_LABEL[');
  });
  it('shows the runway tiles from the same payload as the roster, for members and non-members alike', () => {
    expect(S).toContain('getCoachRosterStatus({ includeAll: true })');
    expect(S).toContain('categoryTile(');
    expect(S).toContain('CATEGORY_NAME[');
  });
  it('marks a past day that was never opened as missed', () => {
    expect(S).toContain('isMissedInstance(w, todayKey)');
    expect(S).toContain("'Missed'");
  });
  it('opens completed workouts read-only and links only read-only screens', () => {
    expect(S).toContain("navigation.navigate('CompletedWorkout', { workoutInstanceId: w.id, readOnly: true })");
    for (const s of ['Performance', 'ForceProfile', 'HittingPerformance', 'PitchingHub', 'Resources']) {
      expect(S).toContain(`navigation.navigate('${s}', { athleteId })`);
    }
    expect(S).not.toContain("'WorkoutLogger'");
    expect(S).not.toContain("'Booking'");
    expect(S).not.toContain("'ArmCareWizard'");
  });
  it('never writes', () => {
    expect(S).not.toMatch(/\.(update|insert|delete|upsert)\(/);
  });
  it('surfaces a read error instead of a false-empty agenda, and always clears loading state', () => {
    expect(S).toContain("Could not load this athlete's program");
    expect(S).toContain('finally {');
  });
});

describe('CoachCoverageScreen', () => {
  const S = read('screens/CoachCoverageScreen.tsx');
  it('has the two tabs and uses the shared metrics', () => {
    expect(S).toContain('Needs programming');
    expect(S).toContain('Not following');
    expect(S).toContain('isNotLogging(');
    expect(S).toContain('sortNeedsAttention(');
  });
  it('splits overdue from the coming week and names the reason', () => {
    expect(S).toContain('splitCoverage(');
    expect(S).toContain('coverageReason(');
    expect(S).toContain('Out now · ');
    expect(S).toContain('This week · ');
  });
  it('shares the roster member filter so the two screens never disagree', () => {
    expect(S).toContain("const ROSTER_SCOPE_KEY = 'aspboost_coach_roster_scope';");
    expect(S).toContain('getCoachRosterStatus({ includeAll })');
    expect(S).toContain('if (prefsLoaded) load();');
  });
  it('opens the program calendar and never writes', () => {
    expect(S).toContain("navigation.navigate('AthleteProgram', { athleteId: item.athlete_id, athleteName: item.athlete_name })");
    expect(S).not.toMatch(/\.(update|insert|delete|upsert)\(/);
  });
  it('shows a placeholder in Not logging when logs are unavailable, but Running out is unaffected', () => {
    expect(S).toContain('logsUnavailable');
    expect(S).toContain('Activity unavailable right now');
  });
  it('shows an em dash instead of a count on the Not following tab when logs are unavailable', () => {
    expect(S).toContain("logsUnavailable ? '—' : String(notLogging.length)");
  });
});

describe('CoachTools gains a Coverage tile', () => {
  const S = read('screens/CoachToolsScreen.tsx');
  it('navigates to CoachCoverage', () => {
    expect(S).toContain("navigation.navigate('CoachCoverage')");
    expect(S).toContain('Coverage');
    expect(S).toContain('Who is running out · who is not logging');
  });
});

describe('the roster screens wear the app palette', () => {
  const files = ['screens/CoachRosterScreen.tsx', 'screens/AthleteProgramScreen.tsx', 'screens/CoachCoverageScreen.tsx'];
  it('sits on the app ground, not a navy of its own', () => {
    for (const f of files) {
      expect(read(f)).not.toContain('#0B0F14');
      expect(read(f)).toContain("backgroundColor: '#0A0A0A'");
    }
  });
  it('spends the accent on marks, never as a panel fill', () => {
    for (const f of files) {
      const S = read(f);
      // rgba(155,221,255,…) is only allowed at the low alphas used for an
      // active control; the P4 screens filled whole surfaces at .08 and .18.
      expect(S).not.toContain('rgba(155,221,255,0.18)');
      expect(S).not.toContain('rgba(155,221,255,0.15)');
    }
  });
  it('greys come from the app ramp, not ad-hoc white alphas', () => {
    for (const f of files) {
      const S = read(f);
      expect(S).not.toContain("color: 'rgba(255,255,255,0.55)'");
      expect(S).not.toContain("color: 'rgba(255,255,255,0.6)'");
    }
  });
});

describe('CoachOverviewScreen', () => {
  const S = read('screens/CoachOverviewScreen.tsx');
  it('builds the day from the existing sessions fetch, not a new one', () => {
    expect(S).toContain('getCoachTodaysSessions(today, undefined, !isAdmin)');
    expect(S).toContain('splitToday(sessions, now)');
    expect(S).toContain('startsInLabel(current, now)');
    expect(S).toContain('bookedPreview(current)');
  });
  it('takes its counts from the shared roster metrics', () => {
    expect(S).toContain('splitCoverage(members, today)');
    expect(S).toContain('isNotLogging(a, today)');
    expect(S).toContain('getUnreadSummary()');
  });
  it('makes ONE plan-expirations call, not two — it is the heaviest request on the landing', () => {
    expect((S.match(/getCoachRosterStatus\(/g) || []).length).toBe(1);
    expect(S).not.toContain('getCoachRosterStatus({ includeAll: true })');
  });
  it('one failing block never blanks the others', () => {
    expect(S).toContain('Promise.allSettled');
    // a dash, never a silent zero, when a count could not be read
    expect(S).toContain("(v === null ? '—' : String(v))");
  });
  it('every tile is a door, and the coverage tiles pick their tab', () => {
    expect(S).toContain("navigation.navigate('CoachRoster')");
    expect(S).toContain("navigation.navigate('Messages')");
    expect(S).toContain("navigation.navigate('CoachCoverage', { tab: 'programming' })");
    expect(S).toContain("navigation.navigate('CoachCoverage', { tab: 'following' })");
    expect(S).toContain("navigation.navigate('CoachDashboard')");
  });
  it('is read-only, like the rest of the roster section', () => {
    expect(S).not.toMatch(/\.(update|insert|delete|upsert)\(/);
  });
  it('marks itself as the active FAB item and keeps the others', () => {
    expect(S).toContain("{ id: 'overview', label: 'Overview', icon: 'grid', isActive: true, onPress: () => {} },");
    for (const id of ['schedule', 'roster', 'tools', 'messages']) expect(S).toContain(`id: '${id}'`);
  });
});

describe('Coverage opens on the tab it was sent to', () => {
  const S = read('screens/CoachCoverageScreen.tsx');
  it('reads the route param, defaulting to programming', () => {
    expect(S).toContain("route?.params?.tab === 'following' ? 'following' : 'programming'");
  });
});

describe('messaging fixes for staff', () => {
  it('the unread count ignores conversations the coach archived away', () => {
    const S = read('lib/coachOverviewApi.ts');
    // Messages hides archived conversations, so counting them would show a
    // badge with nothing behind it to clear.
    expect(S).toContain("('is_archived', false)");
  });
  it('directors are labelled in the recipient picker, not left blank', () => {
    const S = read('screens/MessagesScreen.tsx');
    expect(S).toContain("if (role === 'director') return 'Director';");
  });
  it('an empty inbox tells staff to start one, and waits for the role first', () => {
    const S = read('screens/MessagesScreen.tsx');
    expect(S).toContain('const { isStaff, rolesResolved } = useAuth();');
    expect(S).toContain("isStaff ? 'Start one with the button above' : 'Your coach will message you here'");
  });
});

describe('coaches can join their own remote sessions', () => {
  it('Overview offers Join on the next session and on remote rows later today', () => {
    const S = read('screens/CoachOverviewScreen.tsx');
    expect(S).toContain('joinUrlFor(current, now)');
    expect(S).toContain('joinUrlFor(s, now)');
    expect(S).toContain('Linking.openURL(url)');
    expect(S).toContain('accessibilityLabel="Join video call"');
  });
  it('the day list card offers it too — a coach browsing a future day', () => {
    const S = read('screens/CoachDashboardScreen.tsx');
    expect(S).toContain('const joinUrl = joinUrlFor(session, new Date());');
    expect(S).toContain('Linking.openURL(joinUrl)');
    expect(S).toContain('accessibilityLabel="Join video call"');
  });
});

describe('Overview fills the space below the tiles with work, not padding', () => {
  const S = read('screens/CoachOverviewScreen.tsx');
  it('lists the athletes to look at first, each opening their program', () => {
    expect(S).toContain('attentionList(members, today)');
    expect(S).toContain("navigation.navigate('AthleteProgram', { athleteId: athlete.athlete_id, athleteName: athlete.athlete_name })");
    expect(S).toContain('Needs attention');
  });
  it('hides the section entirely when nobody needs attention', () => {
    expect(S).toContain('{attention.length > 0 && (');
  });
  it('quick actions offer what the tiles above do not', () => {
    expect(S).toContain('Message an athlete');
    expect(S).toContain("navigation.navigate('CoachArmCareSearch')");
  });
});
