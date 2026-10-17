import { readFileSync } from 'fs';
import { join } from 'path';
import { formatSetMetrics, metricFieldsFor } from '../lib/logger/setLine';

const B = readFileSync(join(__dirname, '../screens/block-overview.tsx'), 'utf8');
const L = readFileSync(join(__dirname, '../screens/WorkoutLoggerScreen.tsx'), 'utf8');

describe('after-Start overview v2 wiring', () => {
  it('Continue uses nextStep', () => {
    expect(B).toContain('const next = rackStep ?? nextStep(sequence, completedSets);');
    expect(B).toContain('onPress={() => onContinue(next.reId, next.setIndex)}');
    expect(B).toContain('`Continue · ${codeById[next.reId]');
    // all done → today's COMPLETE WORKOUT button, no Continue
    const bar = B.slice(B.indexOf('{allSetsCompleted ? ('), B.indexOf('{/* Incomplete Workout Warning Modal */}'));
    expect(bar.indexOf('COMPLETE WORKOUT')).toBeLessThan(bar.indexOf('continueLabel'));
    expect(bar).toContain(') : next ? (');
    expect(bar).toContain('Finish early');
  });

  it('Continue sets the set index from nextStep; a row tap does not', () => {
    const fn = L.slice(L.indexOf('const handleContinue'), L.indexOf('const handleBackToOverview'));
    expect(fn).toContain('setCurrentSetIndexes(prev => ({ ...prev, [exerciseId]: setIndex }));');
    expect(fn).toContain('setActiveExerciseId(exerciseId);');
    expect(fn).toContain("setViewMode('exercise');");
    expect(L).toContain('onContinue={handleContinue}');
    expect(L).toContain('onExercisePress={handleExercisePress}');
    const tap = L.slice(L.indexOf('const handleExercisePress'), L.indexOf('// Overview Continue'));
    expect(tap).not.toContain('setCurrentSetIndexes');
    expect(B).toContain("onPress={isNotesOnlyRow ? undefined : () => onExercisePress(exercise.id)}");
  });

  it('done block dims header + rows but not the green result line', () => {
    expect(B).toContain('const dim = blockDone ? styles.dimmed : null;');
    expect(B).toContain('style={[styles.blockHeader, dim]}');
    expect(B).toContain('<Text style={styles.doneLine}>{doneSummary(exercise)}</Text>');
    expect(B).not.toContain('blockSectionDone');
  });

  it('RPE tag gated on ask_rpe', () => {
    expect(B).toContain('const showRpeTag = exercise.ask_rpe === true;');
    expect(B).toMatch(/\{showRpeTag && \(\s*<View style=\{styles\.rpeTag\}>/);
    const st = B.slice(B.indexOf('  rpeTagText: {'));
    expect(st.slice(0, 140)).toContain('LOGGER_COLORS.rpe');
  });

  it('"enter weight" hint uses needsWeightEntry on the row\'s next set; never on done rows', () => {
    const fn = B.slice(B.indexOf('const showWeightHint'), B.indexOf('const progressPercent'));
    expect(fn).toContain('if (next && next.reId === exercise.id) setIndex = next.setIndex;');
    expect(fn).toContain('needsWeightEntry({');
    expect(B).toContain('const weightHint = !isNotesOnlyRow && !isCompleted && showWeightHint(exercise, fields);');
    expect(B.match(/\{weightHint && <Text style=\{styles\.weightHint\}> · enter weight<\/Text>\}/g)?.length).toBe(2);
    const st = B.slice(B.indexOf('  weightHint: {'));
    expect(st.slice(0, 60)).toContain('LOGGER_COLORS.muted');
  });

  it('RACK · SPEED tag gated on velocity', () => {
    expect(B).toContain(
      'const showSpeedTag = exercise.velocity_min_mps != null && exercise.velocity_max_mps != null;',
    );
    expect(B).toMatch(/\{showSpeedTag && \(\s*<View style=\{styles\.speedTag\}>\s*<Text style=\{styles\.speedTagText\}>RACK · SPEED<\/Text>/);
  });

  it('circle still calls handleToggleExerciseComplete', () => {
    expect(B).toContain('onToggleExerciseComplete(exercise.id, exercise.sets);');
    expect(B).toContain('onToggleExerciseComplete(exercise.id, 1);');
    expect(L).toContain('onToggleExerciseComplete={handleToggleExerciseComplete}');
  });

  it('header shows progress line + rest countdown from the logger rest timer', () => {
    expect(B).toContain('progressLine(progress, Math.floor(timer / 60))');
    expect(B).toContain('Rest {formatRest(restSecondsLeft)}');
    expect(L).toContain('restSecondsLeft={restTimer.secondsLeft}');
    expect(L).toContain('exerciseInputs={exerciseInputs}');
    expect(L).toContain('rpeValues={rpeValues}');
  });

  it('done / current rows: green summary, current rail + dashes, done block ✓', () => {
    expect(B).toContain('· all done');
    expect(B).toContain('const isCurrent = !!next && next.reId === exercise.id;');
    expect(B).toContain('isCurrent && styles.exerciseCardCurrent');
    expect(B).toContain('exerciseDashes(exercise.id, sequence, completedSets, next ?? undefined)');
    expect(B).toContain('next${target ? `: ${target}` : \'\'}');
    const st = B.slice(B.indexOf('  doneLine: {'));
    expect(st.slice(0, 80)).toContain('LOGGER_COLORS.green');
  });
});

describe('setLine', () => {
  const re: any = { enabled_measurements: [], metric_targets: { reps: 3, weight: 200 } };
  it('orders weight before reps and formats a compact line', () => {
    const fields = metricFieldsFor(re, []);
    expect(fields).toEqual(['weight', 'reps']);
    expect(formatSetMetrics(fields, (m) => ({ weight: 220, reps: 2 } as any)[m], [])).toBe('220 × 2');
  });
  it('adds other metrics, at most 3 parts', () => {
    const fields = ['weight', 'reps', 'distance', 'time_seconds', 'x'];
    const v: any = { weight: 100, reps: 5, distance: 40, time_seconds: 30, x: 9 };
    expect(formatSetMetrics(fields, (m) => v[m], [])).toBe('100 × 5 · 40 ft · 30s');
  });
});
