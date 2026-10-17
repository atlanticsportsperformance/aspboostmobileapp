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

  it('header shows the exercise position in the workout and the set card marks the top set', () => {
    expect(D).toContain('of ${exercisePosition.total}');
    expect(D).toContain('· top set');
    expect(D).toMatch(/% of \$\{/);
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
