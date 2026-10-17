import { prCandidates } from '../lib/logger/pr';

describe('prCandidates (PR check on Log Set)', () => {
  it('one candidate per tracked metric with a positive value, reps from the set', () => {
    expect(prCandidates(['weight'], { weight: '315', reps: '3' })).toEqual([{ metric: 'weight', value: 315, reps: 3 }]);
    expect(prCandidates(['reps'], { reps: 12 })).toEqual([{ metric: 'reps', value: 12, reps: 12 }]);
    expect(prCandidates(['red_ball_velo'], { red_ball_velo: '61.5', red_ball_reps: 4 }))
      .toEqual([{ metric: 'red_ball_velo', value: 61.5, reps: null }]);
  });

  it('skips untracked, empty, zero and free-text values', () => {
    expect(prCandidates(['weight'], { reps: 5 })).toEqual([]);
    expect(prCandidates(['weight'], { weight: '0' })).toEqual([]);
    expect(prCandidates(['weight'], { weight: 'abc' })).toEqual([]);
    expect(prCandidates(undefined, { weight: 300 })).toEqual([]);
  });
});
