import { createRackApi, pickLocalExercise, type TodayAthlete } from '../lib/rack/api';
import { createRackExecutor } from '../lib/rack/executor';
import { createRackEngine, type RackEvent } from '../lib/rack/engine';
import { subscribeMyRack, uniqueTopic } from '../lib/rack/phone';

/** Chainable PostgREST-ish builder: records calls, resolves to `result`. */
function builder(result: any, calls: any[][]) {
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'gte', 'limit', 'maybeSingle', 'neq']) {
    b[m] = (...args: any[]) => {
      calls.push([m, ...args]);
      return b;
    };
  }
  b.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return b;
}

const re = (id: string, order: number, over: any = {}) => ({
  id,
  order_index: order,
  sets: 3,
  exercise_id: `ex-${id}`,
  is_placeholder: false,
  notes_only: false,
  velocity_min_mps: null,
  velocity_max_mps: null,
  speed_drop_stop_pct: null,
  exercises: { id: `ex-${id}`, name: id, is_placeholder: false },
  ...over,
});

const instance = (id: string, createdAt: string, exs: any[], status = 'not_started') => ({
  id,
  athlete_id: 'tyler',
  scheduled_date: '2026-10-17',
  status,
  created_at: createdAt,
  athletes: { id: 'tyler', org_id: 'org-1', first_name: 'Tyler', last_name: 'B' },
  workouts: { id: `w-${id}`, routines: [{ id: `r-${id}`, order_index: 0, routine_exercises: exs }] },
});

describe('todaysAthletesForRack', () => {
  function apiWith(instances: any[], logs: any[]) {
    const calls: any[][] = [];
    const client = {
      rpc: jest.fn(),
      from: jest.fn((t: string) => {
        calls.push(['from', t]);
        return builder(t === 'workout_instances' ? { data: instances, error: null } : { data: logs, error: null }, calls);
      }),
    };
    return { api: createRackApi(client as any), calls };
  }

  it('an athlete with 2 instances appears once, instances by created_at, open statuses only', async () => {
    // Throwing workout created first and fully done; lift workout second.
    const { api, calls } = apiWith(
      [
        instance('wi-lift', '2026-10-17T09:00:00Z', [re('squat', 0, { velocity_min_mps: 0.6, velocity_max_mps: 0.9 }), re('bench', 1)]),
        instance('wi-throw', '2026-10-17T08:00:00Z', [re('throw', 0, { sets: 1 })]),
      ],
      [{ workout_instance_id: 'wi-throw', routine_exercise_id: 'throw' }],
    );
    const out = await api.todaysAthletesForRack('org-1', '2026-10-17');
    expect(out).toHaveLength(1);
    const a = out[0];
    expect(a.instances.map(i => i.workoutInstanceId)).toEqual(['wi-throw', 'wi-lift']);
    expect(a.instances[0].remaining).toEqual([]);
    expect(a.remaining.map(e => `${e.workoutInstanceId}/${e.routineExerciseId}`)).toEqual(['wi-lift/squat', 'wi-lift/bench']);
    expect(a.exercises).toHaveLength(3);
    expect(calls).toContainEqual(['in', 'status', ['not_started', 'in_progress']]);
    expect(calls).toContainEqual(['eq', 'org_id', 'org-1']);
    expect(pickLocalExercise(a)).toMatchObject({ workoutInstanceId: 'wi-lift', routineExerciseId: 'squat', zoneMin: 0.6 });
    // The server/phone context's instance wins.
    expect(pickLocalExercise(a, ['wi-lift'])?.routineExerciseId).toBe('squat');
  });

  it('the executor gives that athlete the right localContext', async () => {
    const { api } = apiWith(
      [
        instance('wi-a', '2026-10-17T08:00:00Z', [re('mob', 0, { sets: 1 })]),
        instance('wi-b', '2026-10-17T09:00:00Z', [re('squat', 0, { metric_targets: { weight: 185 } })]),
      ],
      [{ workout_instance_id: 'wi-a', routine_exercise_id: 'mob' }],
    );
    const today: TodayAthlete[] = await api.todaysAthletesForRack('org-1', '2026-10-17');
    const seen: RackEvent[] = [];
    const engine = require('../lib/rack/engine');
    const real = engine.reduce;
    const spy = jest.spyOn(engine, 'reduce').mockImplementation((s: any, e: any, n: any) => {
      seen.push(e);
      return real(s, e, n);
    });
    const ex = createRackExecutor({
      engine: createRackEngine('rack-3'),
      api: { startSet: jest.fn(), setActive: jest.fn(), endSet: jest.fn(), todaysWrittenSets: jest.fn(async () => []) } as any,
      persist: { writeRep: jest.fn(), endSet: jest.fn(), amendSet: jest.fn(), flush: jest.fn(async () => {}) },
      sensor: { writeLoad: jest.fn(async () => {}) },
      log: () => {},
    });
    ex.setToday(today);
    ex.dispatch({
      type: 'sessionSync',
      row: {
        rack_id: 'rack-3', active_athlete_id: 'tyler', workout_instance_id: null, routine_exercise_id: null,
        exercise_id: null, set_number: null, load_lb: null, state: 'idle', queue: [], set_started_at: null,
        pending_workout_instance_id: null, pending_routine_exercise_id: null, pending_set_number: null,
        pending_load_lb: null, leave_requested: false, pending_end: false, updated_at: new Date().toISOString(),
      },
    });
    const locals = seen.filter(e => e.type === 'localContext');
    expect(locals).toHaveLength(1);
    expect(locals[0]).toMatchObject({ athleteId: 'tyler', workoutInstanceId: 'wi-b', routineExerciseId: 'squat' });
    spy.mockRestore();
  });
});

describe('realtime topics', () => {
  it('two subscribers for one athlete get distinct channels; unsubscribe removes only its own', () => {
    const channels: any[] = [];
    const client = {
      channel: jest.fn((topic: string) => {
        const ch: any = { topic, on: jest.fn(() => ch), subscribe: jest.fn(() => ch) };
        channels.push(ch);
        return ch;
      }),
      removeChannel: jest.fn(),
      from: jest.fn(),
    };
    const a = subscribeMyRack('tyler', () => {}, client);
    const b = subscribeMyRack('tyler', () => {}, client);
    expect(channels).toHaveLength(2);
    expect(channels[0].topic).not.toBe(channels[1].topic);
    expect(channels[0].topic.startsWith('vbt_reps:tyler:')).toBe(true);
    a.unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
    b.unsubscribe();
    expect(client.removeChannel).toHaveBeenLastCalledWith(channels[1]);
    expect(uniqueTopic('rack_session:r')).not.toBe(uniqueTopic('rack_session:r'));
  });
});

describe('Task 9 fix round 3: api', () => {
  it('todaysWrittenSets counts only is_complete=true sets', async () => {
    const calls: any[][] = [];
    const client = {
      rpc: jest.fn(),
      from: jest.fn((t: string) => {
        calls.push(['from', t]);
        return builder(
          t === 'workout_instances'
            ? { data: [{ id: 'wi-1', athlete_id: 'tyler' }], error: null }
            : { data: [{ athlete_id: 'tyler', workout_instance_id: 'wi-1', routine_exercise_id: 're-1', set_number: 2 }], error: null },
          calls,
        );
      }),
    };
    const out = await createRackApi(client as any).todaysWrittenSets(['tyler'], '2026-10-17');
    const logsAt = calls.findIndex(c => c[0] === 'from' && c[1] === 'exercise_logs');
    expect(calls.slice(logsAt)).toContainEqual(['eq', 'is_complete', true]);
    expect(out).toEqual([{ athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-1', setNumber: 2 }]);
  });

  it('setIpadContext calls rack_set_ipad_context with every field', async () => {
    const rpc = jest.fn(async () => ({ data: { rack_id: 'r' }, error: null }));
    await createRackApi({ rpc, from: jest.fn() } as any).setIpadContext('r', 'tyler', { workoutInstanceId: 'wi', routineExerciseId: 're', setNumber: 2, loadLb: 180 });
    expect(rpc).toHaveBeenCalledWith('rack_set_ipad_context', {
      p_rack: 'r', p_athlete: 'tyler', p_workout_instance: 'wi', p_routine_exercise: 're', p_set_number: 2, p_load_lb: 180,
    });
  });

  it('isRackLift: weight-tracked or zoned only; percentWeightTarget follows logger precedence', () => {
    const { isRackLift, percentWeightTarget } = require('../lib/rack/api') as typeof import('../lib/rack/api');
    const base = { workoutInstanceId: 'wi', routineExerciseId: 're', exerciseId: 'ex', name: 'x', sets: 3, completedSets: 0, zoneMin: null, zoneMax: null, dropStopPct: null };
    expect(isRackLift({ ...base, plan: { exercise_id: 'ex', enabled_measurements: ['reps'] } })).toBe(false); // jump / reps-only
    expect(isRackLift({ ...base, plan: { exercise_id: 'ex' } })).toBe(false); // notes / mobility
    expect(isRackLift({ ...base, plan: { exercise_id: 'ex', enabled_measurements: ['weight'] } })).toBe(true);
    expect(isRackLift({ ...base, plan: { exercise_id: 'ex', metric_targets: { weight: 135 } } })).toBe(true);
    expect(isRackLift({ ...base, plan: { exercise_id: 'ex', set_configurations: [{ intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 1 }] }] } })).toBe(true);
    expect(isRackLift({ ...base, zoneMin: 0.5, zoneMax: 0.7, plan: { exercise_id: 'ex' } })).toBe(true);
    const pct = { ...base, plan: { exercise_id: 'ex', intensity_targets: [{ metric: 'weight', percent: 80 }], set_configurations: [{}, { intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set' as const, reference_set: 1 }] }] } };
    expect(percentWeightTarget(pct, 1)).toMatchObject({ percent: 80 });
    expect(percentWeightTarget(pct, 2)).toMatchObject({ percent: 90, reference_set: 1 });
    expect(percentWeightTarget({ ...base }, 1)).toBeNull();
  });

  it('todaysAthletesForRack carries the plan (logger shape) and selects intensity_targets', async () => {
    const calls: any[][] = [];
    const inst = instance('wi-x', '2026-10-17T09:00:00Z', [re('sq', 0, { metric_targets: { weight: 185 }, intensity_targets: [{ metric: 'weight', percent: 80 }], enabled_measurements: ['weight'] })]);
    const client = {
      rpc: jest.fn(),
      from: jest.fn((t: string) => {
        calls.push(['from', t]);
        return builder(t === 'workout_instances' ? { data: [inst], error: null } : { data: [], error: null }, calls);
      }),
    };
    const [a] = await createRackApi(client as any).todaysAthletesForRack('org-1', '2026-10-17');
    expect(a.exercises[0].plan).toMatchObject({ exercise_id: 'ex-sq', metric_targets: { weight: 185 }, intensity_targets: [{ metric: 'weight', percent: 80 }], enabled_measurements: ['weight'] });
    const sel = calls.find(c => c[0] === 'select')![1] as string;
    expect(sel).toContain('intensity_targets');
    expect(sel).toContain('enabled_measurements');
  });
});
