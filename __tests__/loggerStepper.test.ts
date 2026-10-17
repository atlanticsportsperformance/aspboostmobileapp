import { canStep, showSteppers, stepFor, stepValue, tableColumnWidth } from '../lib/logger/stepper';

describe('logger stepper', () => {
  it('steps by metric', () => {
    expect(stepFor('weight')).toBe(5);
    expect(stepFor('reps')).toBe(1);
    expect(stepFor('red_ball_reps')).toBe(1);
    expect(stepFor('red_ball_velo')).toBe(0.5);
    expect(stepFor('baseball_5oz_mph')).toBe(0.5);
    expect(stepFor('time_seconds')).toBe(5);
    expect(stepFor('distance')).toBe(5);
    expect(stepFor('bat_swings')).toBe(1);
  });

  it('adds / subtracts one step from typed strings and numbers', () => {
    expect(stepValue('weight', '280', 1)).toBe(285);
    expect(stepValue('weight', 280, -1)).toBe(275);
    expect(stepValue('reps', '5', -1)).toBe(4);
    expect(stepValue('red_ball_velo', '61.5', 1)).toBe(62);
    expect(stepValue('red_ball_velo', '0.1', 1)).toBe(0.6);
  });

  it('empty starts from 0; never below 0', () => {
    expect(stepValue('reps', '', 1)).toBe(1);
    expect(stepValue('reps', null, -1)).toBe(0);
    expect(stepValue('weight', '3', -1)).toBe(0);
  });

  it('free text has no stepper', () => {
    expect(canStep('5 LB DB')).toBe(false);
    expect(stepValue('weight', '5 LB DB', 1)).toBeNull();
    expect(stepValue('distance', '10 yards', -1)).toBeNull();
    expect(canStep('12.5')).toBe(true);
  });
});

describe('stepper visibility (review I3)', () => {
  it('column widths follow the table styles', () => {
    // Back Squat (LB · REPS + LAST): 95.5 at 375, 103 at 390
    expect(tableColumnWidth({ screenWidth: 375, showLast: true, flexes: [1, 1], flex: 1 })).toBeCloseTo(95.5);
    expect(tableColumnWidth({ screenWidth: 390, showLast: true, flexes: [1, 1], flex: 1 })).toBeCloseTo(103);
    // three columns + LAST at 390: ~66
    expect(tableColumnWidth({ screenWidth: 390, showLast: true, flexes: [1, 1, 1], flex: 1 })).toBeCloseTo(66);
    // paired ball · reps · mph at 390: reps 90, mph 99
    expect(tableColumnWidth({ screenWidth: 390, showLast: false, flexes: [0.9, 1, 1.1], flex: 1 })).toBeCloseTo(90);
    expect(tableColumnWidth({ screenWidth: 390, showLast: false, flexes: [0.9, 1, 1.1], flex: 1.1 })).toBeCloseTo(99);
  });

  it('steppers only with ≤ 2 metric columns and a cell ≥ 90 pt', () => {
    expect(showSteppers(2, 95.5)).toBe(true);
    expect(showSteppers(1, 200)).toBe(true);
    expect(showSteppers(3, 120)).toBe(false);
    expect(showSteppers(2, 85)).toBe(false);
  });
});
