import { readFileSync } from 'fs';
import { join } from 'path';

const D = readFileSync(join(__dirname, '../screens/exercise-detail-view.tsx'), 'utf8');
const L = readFileSync(join(__dirname, '../screens/WorkoutLoggerScreen.tsx'), 'utf8');
const sets = () => D.slice(D.indexOf('const renderSets'), D.indexOf('// Helper to truncate exercise name'));

describe('exercise screen — dense table (task 15)', () => {
  it('uses LOGGER_COLORS; amber only for RPE and the PR 🏆', () => {
    expect(D).toContain("import { LOGGER_COLORS } from '../lib/logger/theme'");
    expect(D).toContain('LOGGER_COLORS.accent');
    expect(D).toContain('LOGGER_COLORS.bg');
    expect(D).toContain('LOGGER_COLORS.green');
    expect(D).toContain('LOGGER_COLORS.greenText');
    expect(D).not.toMatch(/#D9A441/i); // amber comes from LOGGER_COLORS.rpe
  });

  it('no fontSize above 28', () => {
    const sizes = Array.from(D.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)).map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(28);
  });

  it('header: back · code chip · UPPERCASE name · PR pill only when PR-tracked; no counter', () => {
    expect(D).toContain('exerciseName.toUpperCase()');
    expect(D).toContain('{blockLabel && (');
    expect(D).toContain('if (trackedMetrics.length === 0) return null;');
    expect(D).toContain('`🏆 ${line ? `${line.name} ` : \'\'}max ${value != null ? value : \'—\'}`');
    expect(D).not.toContain('exercisePosition');
  });

  it('removed: A1/A2 pills, New PR banner, card shells, "last week" line, athlete note input', () => {
    expect(D).not.toContain('supersetPill');
    expect(D).not.toContain('NEW PERSONAL RECORD');
    expect(D).not.toContain('prAlert');
    expect(L).not.toContain('prAlert');
    expect(D).not.toContain('setCardCurrent');
    expect(D).not.toContain('last week ${');
    expect(D).not.toContain('<TextInput');
    // PR detection + saving maxes stays in the logger
    expect(L).toContain("supabase.from('athlete_maxes').update(row)");
    expect(L).toContain('checkAndSavePR(targetExerciseId, field, numValue, repsNum)');
  });

  it('one rx line: sets × reps / AMRAP / rest, or the superset round + next + rest', () => {
    expect(D).toContain('`round ${currentRound} of ${totalRounds}`');
    expect(D).toContain('`next ${codeFor(next.reId)} ${nameOf(next.reId)}`');
    expect(D).toContain('`rest ${formatRest(rest)} after ${codeFor(last.reId)}`');
    expect(D).toContain("parts.push('last set AMRAP')");
    expect(D).toContain('{!!rx && <Text style={styles.rx}>{rx}</Text>}');
  });

  it('coach note is one line with "more"', () => {
    expect(D).toContain('<Text style={styles.noteLabel}>COACH  </Text>');
    expect(D).toContain('numberOfLines={2}');
    expect(D).toContain('parseInstructionBlock(exerciseCoachNote)');
  });

  it('column header: SET · LAST (weight + history only) · metrics · paired BALL/REPS/MPH; 🏆 on tracked columns', () => {
    expect(D).toContain("const showLast = metricFields.includes('weight') && lastWeek != null;");
    expect(D).toContain('{showLast && <Text style={[styles.thText, styles.colLast]}>LAST</Text>}');
    expect(D).toContain("{trackedMetrics.includes(m) ? trophy : null}");
    expect(D).toContain("{pairedIsBall ? 'BALL' : 'TYPE'}");
    expect(D).toContain("if (m?.category !== 'paired') {");
    // the tracked ball's name carries a 🏆 too
    expect(D).toContain('{ball.tracked ? <Text style={styles.ballTrophy}> 🏆</Text> : null}');
  });

  it('rows in set order; current = rail + tint + inputs; done green; upcoming grey prescription', () => {
    const fn = sets();
    expect(fn).toContain('for (let i = 0; i < setCount; i++) {');
    expect(fn).toContain('{isCurrentSet && <View style={styles.rail} />}');
    expect(fn).toContain('styles.setCur');
    expect(D).toContain("done ? 'done' : 'dim'");
    expect(D).toContain("tone === 'done' && styles.vDone");
    // free-text prescriptions display as written
    expect(D).toContain('if (!isEmptyValue(target)) return { text: String(target) };');
    // AMRAP: "max" + tag
    expect(D).toContain("return { text: 'max', amrap: true };");
    expect(D).toContain('>AMRAP</Text>');
  });

  it('paired balls: one line per ball inside the set, one circle per set', () => {
    const fn = sets();
    expect(fn).toContain('const lineCount = Math.max(1, pairedLines.length);');
    expect(fn).toContain('{first ? renderSetCheck(i, isCompleted) : null}');
    expect(fn.match(/renderSetCheck\(/g)?.length).toBe(1);
  });

  it('under a row: coach set note, intensity caption and the compact RPE strip on the open set', () => {
    const fn = sets();
    expect(fn).toContain('{!!setConfig?.notes && <Text style={styles.cn}>{setConfig.notes}</Text>}');
    expect(fn).toContain('const caption = isOpen ? intensityCaption(i) : null;');
    expect(D).toContain('intensityCaptionText(targetArgs(setIndex, m))');
    expect(fn).toMatch(/isOpen && exercise\.ask_rpe && onRpeChange && \(/);
    expect(fn).toContain('<RpeRow\n                compact');
  });

  it('LAST column: back-off sets never fall back to last week\'s top set; today is excluded', () => {
    const fn = D.slice(D.indexOf('const lastWeekFor'), D.indexOf('function isBackoffSet'));
    expect(fn).toContain('setIndex === 0 || !isBackoffSet(setIndex)');
    expect(D).toMatch(/lastSession\(lastWeekRows \?\? \[\], exercise\.exercise_id, workoutInstanceId/);
    expect(L).toContain('workoutInstanceId={workoutInstanceId}');
  });

  it('tap a row opens it in place; open set scrolls into view; circle toggles done', () => {
    const fn = sets();
    expect(fn.match(/onLayout=\{\(e\) => onSetLayout\(i, e\.nativeEvent\.layout\.y\)\}/g)?.length).toBe(2);
    expect(fn).toContain('accessibilityLabel={`Open set ${i + 1}`}');
    expect(D).toContain('scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });');
    const check = D.slice(D.indexOf('const renderSetCheck'), D.indexOf('// Header 🏆'));
    expect(check).toContain('onPress={() => handleCheckboxToggle(setIndex)}');
  });

  it('footer: prescribed rest + live countdown from the logger\'s rest timer', () => {
    expect(D).toContain('between sets`');
    expect(D).toContain('between rounds`');
    expect(D).toContain('`Rest ${formatRest(restSecondsLeft)}`');
    expect(L).toContain('restSecondsLeft={restTimer.secondsLeft}');
  });

  it('bottom bar: labelled History · Done (set / → next / round) · menu', () => {
    expect(D).toMatch(/accessibilityLabel="History"/);
    expect(D).toContain('>History</Text>');
    expect(D).toMatch(/accessibilityLabel="Overview"/);
    expect(D).toContain('`Done · set ${currentSetIndex + 1}`');
    expect(D).toContain('`Done → ${codeFor(next.reId)} ');
    expect(D).toContain('`Done · round ${currentRound}`');
    expect(D).not.toMatch(/<Ionicons[^>]*accessibilityLabel/);
  });

  it('keeps swipe, history sheet, keypad and the two-phase Done (log, then advance)', () => {
    expect(D).toContain('{...panResponder.panHandlers}');
    expect(D).toContain('visible={showHistory}');
    expect(D).toContain('<NumericKeypad');
    expect(D).toContain('onPress={handleNextButtonPress}');
    const fn = D.slice(D.indexOf('const handleNextButtonPress'), D.indexOf('// Swipe gesture handler'));
    expect(fn).toContain('handleCheckboxToggle(currentSetIndex);');
    expect(fn).toContain('onNextSet();');
    // keypad walks the columns in screen order
    expect(D).toContain('hasNextField={inputOrder.indexOf(activeInput.metricId) < inputOrder.length - 1}');
  });
});
