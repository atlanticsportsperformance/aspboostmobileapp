const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
  },
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { OUTBOX_KEY } from '../lib/logger/outbox';
import { PENDING_COMPLETE_KEY } from '../lib/logger/pendingComplete';
import { SET_QUEUE_KEY } from '../lib/rack/persist';
import { soloPersistKeys } from '../lib/rack/solo';
import { resetWorkout } from '../lib/logger/resetWorkout';

const D = readFileSync(join(__dirname, '..', 'screens/DashboardScreen.tsx'), 'utf8');

describe('Restart / Discard really reset the workout', () => {
  it('leaves the rack, clears this instance’s outbox / completion / progress / queued rack+solo set writes, deletes its exercise_logs', async () => {
    const row = (wi: string, n: number) => ({ workout_instance_id: wi, routine_exercise_id: 're', set_number: n });
    store[OUTBOX_KEY] = JSON.stringify({ 'wi|re|1': row('wi', 1), 'other|re|1': row('other', 1) });
    store[PENDING_COMPLETE_KEY] = JSON.stringify([{ workoutInstanceId: 'wi' }, { workoutInstanceId: 'other' }]);
    store['workout_wi'] = JSON.stringify({ elapsedTime: 99 });
    store[SET_QUEUE_KEY] = JSON.stringify([{ key: 'wi:re:1', row: row('wi', 1) }, { key: 'other:re:1', row: row('other', 1) }]);
    const solo = soloPersistKeys('tyler').sets;
    store[solo] = JSON.stringify([{ key: 'wi:re:2', row: row('wi', 2) }]);
    const calls: string[] = [];
    const client = {
      from: (t: string) => {
        const b: any = {};
        b.select = () => b;
        b.or = async () => ({ data: t === 'rack_sessions' ? [{ rack_id: 'rack-1' }] : [] });
        b.delete = () => {
          calls.push(`delete:${t}`);
          return b;
        };
        b.eq = async (c: string, v: string) => {
          calls.push(`eq:${c}=${v}`);
          return { error: null };
        };
        return b;
      },
    };
    const leaveRack = jest.fn(async () => {
      calls.push('rack_leave');
    });
    const res = await resetWorkout('wi', 'tyler', { client, leaveRack });
    expect(res.ok).toBe(true);
    expect(leaveRack).toHaveBeenCalledWith('rack-1');
    expect(calls.indexOf('rack_leave')).toBeLessThan(calls.indexOf('delete:exercise_logs'));
    expect(calls).toContain('eq:workout_instance_id=wi');
    expect(Object.keys(JSON.parse(store[OUTBOX_KEY]))).toEqual(['other|re|1']);
    expect(JSON.parse(store[PENDING_COMPLETE_KEY])).toEqual([{ workoutInstanceId: 'other' }]);
    expect(store['workout_wi']).toBeUndefined();
    expect(JSON.parse(store[SET_QUEUE_KEY]).map((i: any) => i.key)).toEqual(['other:re:1']);
    expect(store[solo]).toBeUndefined();
    expect(calls.some(c => c.includes('vbt_reps'))).toBe(false); // history stays
  });

  it('wiring: Restart and Discard each confirm, reset, then Restart stays in_progress and opens the logger fresh', () => {
    const restart = D.slice(D.indexOf('function handleRestartWorkout'), D.indexOf('function handleDiscardWorkout'));
    expect(restart).toContain('Alert.alert(RESTART_CONFIRM.title, RESTART_CONFIRM.message, [');
    expect(restart).toContain("{ text: 'Cancel', style: 'cancel' },");
    expect(restart).toContain('await resetWorkout(data.instanceId, athleteId ?? null, resetDeps);');
    expect(restart).toContain(".update({ status: 'in_progress' })");
    expect(restart).toContain("navigation.navigate('WorkoutLogger', { workoutInstanceId: data.instanceId, athleteId });");
    const discard = D.slice(D.indexOf('function handleDiscardWorkout'), D.indexOf('// Booking sheet handlers'));
    expect(discard).toContain('Alert.alert(DISCARD_CONFIRM.title, DISCARD_CONFIRM.message, [');
    expect(discard).toContain('await resetWorkout(instanceId, athleteId ?? null, resetDeps);');
    expect(discard).toContain(".update({ status: 'not_started' })");
    const { RESTART_CONFIRM } = require('../lib/logger/resetWorkout');
    expect(`${RESTART_CONFIRM.title} ${RESTART_CONFIRM.message}`).toBe('Restart workout? This clears every set you logged in this workout.');
  });
});
