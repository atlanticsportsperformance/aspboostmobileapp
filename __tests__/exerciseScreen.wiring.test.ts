import { readFileSync } from 'fs';
import { join } from 'path';

const D = readFileSync(join(__dirname, '../screens/exercise-detail-view.tsx'), 'utf8');
const L = readFileSync(join(__dirname, '../screens/WorkoutLoggerScreen.tsx'), 'utf8');
const sets = () => D.slice(D.indexOf('const renderSets'), D.indexOf('// Helper to truncate exercise name'));

describe('exercise screen — dense table (task 15)', () => {
  it('uses LOGGER_COLORS; RPE and PR markers faint white (no amber)', () => {
    expect(D).toContain("import { LOGGER_COLORS } from '../lib/logger/theme'");
    expect(D).toContain('LOGGER_COLORS.accent');
    expect(D).toContain('LOGGER_COLORS.bg');
    expect(D).toContain('LOGGER_COLORS.green');
    expect(D).toContain('LOGGER_COLORS.greenText');
    expect(D).not.toMatch(/#D9A441|217,\s*164,\s*65/i);
    expect(D).toContain('borderColor: LOGGER_COLORS.prBorder,');
    expect(D).toContain('color: LOGGER_COLORS.prText,');
    const T = readFileSync(join(__dirname, '../lib/logger/theme.ts'), 'utf8');
    expect(T).not.toMatch(/#D9A441/i);
    expect(T).toContain("rpe: 'rgba(255,255,255,0.45)'");
    expect(T).toContain("rpeBorder: 'rgba(255,255,255,0.12)'");
    expect(T).toContain("rpeTarget: 'rgba(255,255,255,0.45)'");
    expect(T).toContain("rpeSelected: 'rgba(255,255,255,0.14)'");
    expect(T).toContain("prBorder: 'rgba(255,255,255,0.18)'");
    expect(T).toContain("prText: 'rgba(255,255,255,0.7)'");
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
    expect(D).toContain("if (value == null) return '🏆 tracked';");
    expect(D).toContain('`🏆 ${line ? `${line.name} ` : \'\'}max ${value}`');
    expect(D).not.toContain('max —');
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
    expect(L).toContain('checkAndSavePR(routineExerciseId, metric, value, reps);');
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
    expect(D).toContain("{showLast && headerCell('last', styles.colLast, 'LAST')}");
    expect(D).toContain('{tracked ? trophy : null}');
    expect(D).toContain("pairedIsBall ? 'BALL' : 'TYPE'");
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
    expect(fn).toContain('{showNote && <Text style={styles.cn}>{setConfig?.notes}</Text>}');
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

  it('device fixes: prescribed columns, pending text, fixed widths, empty done, note once', () => {
    // columns = enabled measurements ∪ prescribed metrics (Back Squat reps)
    expect(D).toContain('const metricFields = tableFieldsFor(exercise, customMeasurements);');
    // upcoming cell / empty input: short "90% S1" (full text is the caption)
    expect(D).toContain('`${t.percent}% S${t.referenceSet}`');
    // grid like the mock: fixed SET/LAST/circle, equal metric columns, no gap
    // or auto margins (an earlier flexBasis/auto-margin grid overlapped cells)
    expect(D).toContain("colMetric: { flex: 1, minWidth: 0, marginLeft: 8 },");
    expect(D).not.toContain("marginLeft: 'auto'");
    const tr = D.slice(D.indexOf('  tr: {'), D.indexOf('  trSub:'));
    expect(tr).not.toContain('gap');
    // header cells use the same column styles as the rows
    expect(D).toContain("{singleMetrics.map((m) => headerCell(m, styles.colMetric, columnLabel(m), trackedMetrics.includes(m)))}");
    // inputs fill their column up to 120 px
    expect(D).toContain('maxWidth: 120,');
    // inputs and the RPE strip only on the open row
    const fn = sets();
    expect(fn).toContain('renderMetric(i, m, isOpen, isCompleted)');
    expect(fn).toMatch(/isOpen && exercise\.ask_rpe && onRpeChange && \(/);
    // ticked with no values reads "done" in green
    expect(D).toContain("metricId === inputOrder[0] ? 'done' : ''");
    // a % -only coach note isn't repeated under the caption
    expect(D).toContain('!(caption && noteRepeatsCaption(setConfig.notes, caption))');
  });

  it('exactly one open set: tapping a row makes it the current set', () => {
    const fn = sets();
    expect(D).not.toContain('manuallyExpandedSets');
    expect(fn).toContain('const isOpen = isCurrentSet;');
    expect(fn).toContain('onSelectSet(i);');
    expect(L).toContain('onSelectSet={handleSelectSet}');
    expect(L).toContain('setCurrentSetIndexes(prev => ({ ...prev, [activeExerciseId]: setIndex }));');
  });

  it('set rows are at least 64 pt tall (header row unchanged)', () => {
    const tr = D.slice(D.indexOf('  tr: {'), D.indexOf('  trSub:'));
    expect(tr).toContain('minHeight: 64,');
  });

  it('+/− steppers on the current set only, through the same input path as typing', () => {
    expect(D).toContain("import { canStep, stepValue } from '../lib/logger/stepper';");
    const fn = D.slice(D.indexOf('const renderMetric'), D.indexOf('// The completion circle'));
    // read-only rows return before the stepper branch
    expect(fn.indexOf('if (!open) {')).toBeLessThan(fn.indexOf('const steppable'));
    expect(fn).toContain('const steppable = canStep(stepBase);');
    expect(fn).toContain('{steppable && stepper(-1)}');
    expect(fn).toContain('{steppable && stepper(1)}');
    expect(fn).toContain('onInputChange(setIndex, metricId, String(next));');
    expect(fn).toContain('markFieldEdited(setIndex, metricId);');
    // 36 pt targets: 24 wide + 6 px slop each side, 36 tall
    const st = D.slice(D.indexOf('  stepBtn: {'), D.indexOf('  stepText:'));
    expect(st).toContain('width: 24,');
    expect(st).toContain('height: 36,');
    expect(fn).toContain('hitSlop={{ top: 0, bottom: 0, left: 6, right: 6 }}');
  });

  it('a stepper on a back-off reference set re-runs backoffUpdates (review I1)', () => {
    const fn = D.slice(D.indexOf('const renderMetric'), D.indexOf('// The completion circle'));
    expect(fn).toContain('if (isBackoffReference(exercise, setIndex)) setBackoffTick((t) => t + 1);');
    expect(D).toContain('activeInput == null, backoffTick]);');
  });

  it('PR check runs once per logged set, never per edit (review I2)', () => {
    const edit = L.slice(L.indexOf('const handleInputChange'), L.indexOf('const checkPRsForSet'));
    expect(edit).not.toContain('checkAndSavePR(');
    expect(edit).not.toContain('checkPRs');
    expect(L).toContain('prCandidates(re?.tracked_max_metrics, setData)');
    // Done (log + advance), the circle, and the overview's complete-all
    expect(L).toContain('if (!wasDone) checkPRsRef.current(activeExerciseId, currentSetIndex);');
    expect(L).toContain('if (!currentlyCompleted) checkPRsRef.current(activeExerciseId, setIndex);');
    expect(L).toContain('if (newStatus && !currentSets[setIndex]) checkPRsRef.current(exerciseId, setIndex);');
    // compares against the latest maxes, not a stale closure
    expect(L).toContain('return athleteMaxesRef.current[exerciseId]?.[metricId] ?? null;');
  });
});
