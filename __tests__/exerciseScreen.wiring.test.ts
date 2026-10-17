import { readFileSync } from 'fs';
import { join } from 'path';

const D = readFileSync(join(__dirname, '../screens/exercise-detail-view.tsx'), 'utf8');

describe('exercise screen v2 wiring', () => {
  it('uses LOGGER_COLORS', () => {
    expect(D).toContain("import { LOGGER_COLORS } from '../lib/logger/theme'");
    expect(D).toContain('LOGGER_COLORS.accent');
    expect(D).toContain('LOGGER_COLORS.bg');
    expect(D).toContain('LOGGER_COLORS.green');
    expect(D).toContain('LOGGER_COLORS.hairline');
  });

  it('renders last week line', () => {
    expect(D).toMatch(/lastSession\(lastWeekRows/);
    expect(D).toContain('last week ${');
    expect(D).toContain('styles.lastWeekLine');
  });

  it('no fontSize above 28', () => {
    const sizes = Array.from(D.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(28);
  });

  it('done set shows result line', () => {
    expect(D).toContain('styles.setResultLine');
    expect(D).toMatch(/deltaText\(/);
    expect(D).toContain('RPE ${');
    // still flags a missing RPE on an ask_rpe exercise
    expect(D).toMatch(/isCompleted && exercise\.ask_rpe && rpeValues/);
  });

  it('collapsed rows keep every logged metric, not just weight × reps', () => {
    // body lives in lib/logger/setLine (shared with the overview)
    expect(D).toContain('formatSetLine(metricFields, valueOf, customMeasurements)');
    const S = readFileSync(join(__dirname, '../lib/logger/setLine.ts'), 'utf8');
    const fn = S.slice(S.indexOf('export function formatSetMetrics'));
    expect(fn).toContain('for (const metricId of metricFields)');
    expect(fn).toContain('parts.length >= 3');
    expect(D.match(/formatSetMetrics\(/g)?.length).toBe(2); // done + upcoming
  });

  it('back-off sets never fall back to last week\'s top set; today is excluded', () => {
    const fn = D.slice(D.indexOf('const lastWeekFor'), D.indexOf('function isBackoffSet'));
    expect(fn).toContain('setIndex === 0 || !isBackoffSet(setIndex)');
    expect(D).toMatch(/lastSession\(lastWeekRows \?\? \[\], exercise\.exercise_id, workoutInstanceId/);
    const L = readFileSync(join(__dirname, '../screens/WorkoutLoggerScreen.tsx'), 'utf8');
    expect(L).toContain('workoutInstanceId={workoutInstanceId}');
  });

  it('done result line is LOGGER_COLORS.green; bar buttons carry their own labels', () => {
    const st = D.slice(D.indexOf('  setResultLine: {'));
    expect(st.slice(0, 120)).toContain('LOGGER_COLORS.green');
    expect(D).toMatch(/accessibilityLabel="History"/);
    expect(D).toMatch(/accessibilityLabel="Overview"/);
    expect(D).not.toMatch(/<Ionicons[^>]*accessibilityLabel/);
  });

  it('header has no exercise counter and the set card marks the top set', () => {
    expect(D).not.toContain('exercisePosition');
    expect(D).toContain('· top set');
    // caption text lives in lib/logger/targets (intensityText)
    expect(D).toContain('return t ? intensityText(t) : null;');
  });

  it('sets render in set order; the open set expands in place and scrolls into view', () => {
    const fn = D.slice(D.indexOf('const renderSetCards'), D.indexOf('// Helper to truncate exercise name'));
    expect(fn).toContain('for (let i = 0; i < setCount; i++) {');
    expect(fn).not.toContain('order.push');
    expect(fn.match(/onLayout=\{\(e\) => onSetLayout\(i, e\.nativeEvent\.layout\.y\)\}/g)?.length).toBe(2);
    expect(D).toContain('scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });');
    expect(D).not.toContain('scrollTo({ y: 0, animated: true });\n    }, 100)');
  });

  it('collapsed row: whole row opens the set, no "edit" link, circle on the right like the open card', () => {
    const fn = D.slice(D.indexOf('const renderSetCards'), D.indexOf('// Helper to truncate exercise name'));
    expect(D).not.toContain('setRowEdit');
    expect(fn).not.toMatch(/>edit</);
    // one circle component, rendered last in both the row and the card header
    expect(fn.match(/\{renderSetCheck\(i, isCompleted\)\}/g)?.length).toBe(2);
    expect(fn).toMatch(/\{renderSetCheck\(i, isCompleted\)\}\s*<\/TouchableOpacity>,/);
    expect(fn).toMatch(/\{renderSetCheck\(i, isCompleted\)\}\s*<\/View>/);
    const check = D.slice(D.indexOf('const renderSetCheck'), D.indexOf('const renderSetCards'));
    expect(check).toContain('onPress={() => handleCheckboxToggle(setIndex)}');
    // row and card share one shell (radius/padding/background)
    expect(fn).toContain('styles.setRow,\n              styles.setRowCollapsed,');
    expect(fn).toContain('styles.setRow,\n            isCompleted && styles.setRowDone,');
  });

  it('empty inputs show the pending % ("90% of set 1"), and the header caption is not repeated', () => {
    expect(D).toContain('pendingTargetText(intensity)');
    expect(D).not.toContain('no max set`');
    expect(D).toContain('const headerCaption = caption && !showsPendingTarget(i, setData) ? caption : null;');
  });

  it('keeps swipe, PR banner, history sheet, keypad and the two-phase Log Set', () => {
    expect(D).toContain('{...panResponder.panHandlers}');
    expect(D).toContain('NEW PERSONAL RECORD!');
    expect(D).toContain('visible={showHistory}');
    expect(D).toContain('<NumericKeypad');
    expect(D).toContain("'Log Set'");
    expect(D).toContain('onPress={handleNextButtonPress}');
  });
});
