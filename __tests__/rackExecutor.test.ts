import * as engineModule from '../lib/rack/engine';
import { createRackEngine, type RackEvent, type RackSessionRow } from '../lib/rack/engine';
import { createRackExecutor, SEED_RETRY_MS, SEED_REFRESH_MS, type ExecutorApi } from '../lib/rack/executor';
import type { TodayAthlete, TodayExercise } from '../lib/rack/api';
import type { SetLogRow } from '../lib/rack/api';
import type { OvrRep } from '../lib/ovr/protocol';

const RACK = 'rack-3';
const T0 = 1_760_000_000_000;
const iso = (t: number) => new Date(t).toISOString();

const row = (over: Partial<RackSessionRow> = {}): RackSessionRow => ({
  rack_id: RACK,
  active_athlete_id: 'tyler',
  workout_instance_id: 'wi-1',
  routine_exercise_id: 're-squat',
  exercise_id: 'ex-squat',
  set_number: 1,
  load_lb: 205,
  state: 'idle',
  queue: ['jake'],
  set_started_at: null,
  pending_workout_instance_id: null,
  pending_routine_exercise_id: null,
  pending_set_number: null,
  pending_load_lb: null,
  leave_requested: false,
  pending_end: false,
  updated_at: iso(T0),
  ...over,
});

const ovr = (v: number): OvrRep => ({ concentricS: 0.5, romIn: 20, meanV: v, peakV: v + 0.3, meanPowerW: 900, peakPowerW: 1800 });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flushMicro = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await flushMicro();
    await new Promise(res => setTimeout(res, 0));
  }
};

function rig(over: { api?: Partial<ExecutorApi>; persist?: any } = {}) {
  let t = T0;
  const calls: string[] = [];
  const api: ExecutorApi = {
    startSet: jest.fn(async (_r, a, s) => {
      calls.push('rpc:startSet');
      return row({ active_athlete_id: a, state: 'lifting', set_started_at: s, updated_at: iso(t) });
    }),
    setActive: jest.fn(async (_r, a) => {
      calls.push('rpc:setActive');
      return row({ active_athlete_id: a, updated_at: iso(t) });
    }),
    endSet: jest.fn(async () => {
      calls.push('rpc:endSet');
      return row({ active_athlete_id: 'jake', queue: [], updated_at: iso(t + 1) });
    }),
    todaysSetLogs: jest.fn(async (): Promise<SetLogRow[]> => []),
    ...over.api,
  };
  const persist = {
    writeRep: jest.fn(async () => void calls.push('persist:writeRep')),
    endSet: jest.fn(async () => void calls.push('persist:endSet')),
    amendSet: jest.fn(async () => void calls.push('persist:amendSet')),
    flush: jest.fn(async () => {}),
    ...over.persist,
  };
  const sensor = { writeLoad: jest.fn(async () => {}) };
  const log = jest.fn();
  const ex = createRackExecutor({ engine: createRackEngine(RACK), api, persist, sensor, now: () => t, log });
  return {
    ex,
    api,
    persist,
    sensor,
    log,
    calls,
    advance: (ms: number) => (t += ms),
    get t() {
      return t;
    },
  };
}

let events: RackEvent[];
let reduceSpy: jest.SpyInstance;
beforeEach(() => {
  events = [];
  const real = engineModule.reduce;
  reduceSpy = jest.spyOn(engineModule, 'reduce').mockImplementation((s, e, n) => {
    events.push(e);
    return real(s, e, n);
  });
});
afterEach(() => {
  reduceSpy.mockRestore();
  jest.useRealTimers();
});

async function activeTyler(r: ReturnType<typeof rig>) {
  r.ex.dispatch({ type: 'sessionSync', row: row() });
  await flushMicro();
  await r.ex.idle();
}

describe('executor ordering', () => {
  it('rpcEndSet is called only after the set write is enqueued', async () => {
    const write = deferred<void>();
    const r = rig({ persist: { endSet: jest.fn(() => write.promise) } });
    await activeTyler(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.advance(2000);
    r.ex.dispatch({ type: 'ipadDone' });
    await flushMicro();
    await new Promise(res => setTimeout(res, 5));
    expect(r.persist.endSet).toHaveBeenCalledTimes(1);
    expect(r.api.endSet).not.toHaveBeenCalled();
    write.resolve();
    await r.ex.idle();
    expect(r.api.endSet).toHaveBeenCalledWith(RACK, 'tyler');
  });

  it('a failed set enqueue does not release the set: rpcFailed instead of rpcEndSet', async () => {
    const r = rig({ persist: { endSet: jest.fn(async () => { throw new Error('disk'); }) } });
    await activeTyler(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    expect(r.api.endSet).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'rpcFailed', kind: 'endSet', athleteId: 'tyler' });
  });

  it("the RPC's returned row is fed as sessionSync before rpcSettled", async () => {
    const r = rig();
    await activeTyler(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.idle();
    const types = events.map(e => e.type);
    const sync = types.lastIndexOf('sessionSync');
    const settled = types.indexOf('rpcSettled');
    expect(r.api.startSet).toHaveBeenCalledTimes(1);
    expect(settled).toBeGreaterThan(-1);
    expect(sync).toBeLessThan(settled);
    expect(events[sync]).toMatchObject({ row: { state: 'lifting' } });
    expect(events[settled]).toEqual({ type: 'rpcSettled', kind: 'startSet', athleteId: 'tyler' });
  });

  it('dispatches rpcFailed on RPC error', async () => {
    const r = rig({ api: { endSet: jest.fn(async () => { throw new Error('offline'); }) } });
    await activeTyler(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    expect(events).toContainEqual({ type: 'rpcFailed', kind: 'endSet', athleteId: 'tyler' });
    expect(events.some(e => e.type === 'rpcSettled' && e.kind === 'endSet')).toBe(false);
  });

  it('runs persistence and RPC effects in engine order', async () => {
    const r = rig();
    await activeTyler(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    expect(r.calls.indexOf('persist:endSet')).toBeLessThan(r.calls.indexOf('rpc:endSet'));
    expect(r.calls.filter(c => c === 'persist:writeRep')).toHaveLength(2);
    expect(r.persist.flush).toHaveBeenCalled();
  });

  it('a free set never calls persist.endSet', async () => {
    const r = rig();
    r.ex.dispatch({ type: 'sessionSync', row: row({ workout_instance_id: null, routine_exercise_id: null, exercise_id: null }) });
    await r.ex.idle();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    expect(r.persist.writeRep).toHaveBeenCalledTimes(1);
    expect(r.persist.endSet).not.toHaveBeenCalled();
  });
});

const tile = (athleteId: string): TodayAthlete => ({ athleteId, firstName: athleteId, lastName: '', instances: [], exercises: [], remaining: [] });

describe('seed preload', () => {
  it("preloads seeds for all of today's athletes at start, then every 60 s", async () => {
    jest.useFakeTimers();
    const r = rig();
    r.ex.setToday([tile('tyler'), tile('jake'), tile('cole')]);
    r.ex.start();
    await jest.advanceTimersByTimeAsync(0);
    const calls = (r.api.todaysSetLogs as jest.Mock).mock.calls.map(c => [...c[0]].sort());
    expect(calls[0]).toEqual(['cole', 'jake', 'tyler']);
    const n = calls.length;
    await jest.advanceTimersByTimeAsync(SEED_REFRESH_MS);
    expect((r.api.todaysSetLogs as jest.Mock).mock.calls.length).toBeGreaterThan(n);
    r.ex.stop();
  });

  it('a seed landing before the first rep puts the set above the high-water', async () => {
    const r = rig({
      api: {
        todaysSetLogs: jest.fn(async () =>
          [1, 2, 3].map(n => ({ athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', setNumber: n, isComplete: true })),
        ),
      },
    });
    r.ex.setToday([tile('tyler')]);
    await flushMicro();
    expect(events.some(e => e.type === 'seedHighWater')).toBe(true);
    r.ex.dispatch({ type: 'sessionSync', row: row() }); // phone says set 1
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.idle();
    expect((r.persist.writeRep as jest.Mock).mock.calls[0][0].setNumber).toBe(4);
  });

  it('logs failing: a first rep waits only for the bounded re-read, a later event releases it in order', async () => {
    jest.useFakeTimers();
    const seedFn = jest.fn(() => Promise.reject(new Error('offline')));
    const r = rig({ api: { todaysSetLogs: seedFn } });
    r.ex.start();
    r.ex.dispatch({ type: 'sessionSync', row: row() });
    expect(r.ex.isSyncing()).toBe(true);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'ipadDone' }); // releases the held rep first
    const order = events.filter(e => e.type === 'rep' || e.type === 'ipadDone').map(e => e.type);
    expect(order).toEqual(['rep', 'ipadDone']);
    await jest.advanceTimersByTimeAsync(SEED_RETRY_MS + 10);
    await r.ex.idle();
    expect(seedFn.mock.calls.length).toBeGreaterThanOrEqual(2); // retried every 5 s
    expect(r.persist.writeRep).toHaveBeenCalledTimes(1);
    expect(r.persist.endSet).toHaveBeenCalledTimes(1);
    expect(events.filter(e => e.type === 'ipadDone')).toHaveLength(1); // no replay
    r.ex.stop();
  });

  it("N-1 regression: Jake's reps stay Jake's when Tyler becomes active again", async () => {
    const seed = deferred<SetLogRow[]>();
    const seedFn = jest.fn().mockResolvedValueOnce([]).mockImplementation(() => seed.promise);
    const r = rig({ api: { todaysSetLogs: seedFn } });
    await activeTyler(r); // Tyler active + seeded
    r.ex.dispatch({ type: 'sessionSync', row: row({ active_athlete_id: 'jake', queue: ['tyler'], updated_at: iso(r.advance(1000)) }) });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) }, r.advance(1000));
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(2000));
    r.ex.dispatch({ type: 'ipadDone' }, r.advance(1000));
    await r.ex.idle();
    r.ex.dispatch({ type: 'sessionSync', row: row({ active_athlete_id: 'tyler', queue: [], updated_at: iso(r.advance(1000)) }) });
    seed.resolve([]);
    await flushMicro();
    await r.ex.idle();
    const reps = (r.persist.writeRep as jest.Mock).mock.calls.map(c => c[0].athleteId);
    expect(reps).toEqual(['jake', 'jake']);
    const sets = (r.persist.endSet as jest.Mock).mock.calls.map(c => c[0]);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ athleteId: 'jake', fullReps: 2 });
    expect((r.api.endSet as jest.Mock).mock.calls).toEqual([[RACK, 'jake']]);
  });

  it("a tile tap refreshes seeds right away (non-blocking)", async () => {
    const r = rig();
    await activeTyler(r);
    const before = (r.api.todaysSetLogs as jest.Mock).mock.calls.length;
    r.ex.dispatch({ type: 'selectAthlete', athleteId: 'jake' });
    await flushMicro();
    await r.ex.idle();
    const calls = (r.api.todaysSetLogs as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(before);
    expect(calls.some(c => c[0].includes('jake'))).toBe(true);
    expect(r.ex.getState().activeAthleteId).toBe('jake');
  });

  it('a set with no exerciseId gets it from the engine map before persist', async () => {
    const r = rig();
    r.ex.dispatch({ type: 'sessionSync', row: row({ exercise_id: null }) });
    r.ex.dispatch({ type: 'contextMeta', exerciseId: 'ex-squat', routineExerciseId: 're-squat', zoneMin: null, zoneMax: null, dropStopPct: null });
    await flushMicro();
    await r.ex.idle();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    expect((r.persist.endSet as jest.Mock).mock.calls[0][0].exerciseId).toBe('ex-squat');
  });

  it('a failed set enqueue is kept and re-enqueued on the next flush', async () => {
    let fail = true;
    const endSet = jest.fn(async () => {
      if (fail) throw new Error('disk');
    });
    const r = rig({ persist: { endSet } });
    await activeTyler(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    await new Promise(res => setTimeout(res, 5));
    const tries = endSet.mock.calls.length;
    expect(tries).toBeGreaterThanOrEqual(3); // 3 tries, then kept (and retried by flushes)
    fail = false;
    r.ex.flush();
    await new Promise(res => setTimeout(res, 5));
    expect(endSet.mock.calls.length).toBe(tries + 1); // re-enqueued once it works
    r.ex.flush();
    await new Promise(res => setTimeout(res, 5));
    expect(endSet.mock.calls.length).toBe(tries + 1); // and is gone from memory
  });
});

describe('ticks and flushes', () => {
  it('start drives tick every second and flushes on start and every 15 s', async () => {
    jest.useFakeTimers();
    const r = rig();
    r.ex.start();
    expect(r.persist.flush).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3000);
    expect(events.filter(e => e.type === 'tick')).toHaveLength(3);
    await jest.advanceTimersByTimeAsync(12_000);
    expect(r.persist.flush).toHaveBeenCalledTimes(2);
    r.ex.stop();
  });

  it('setToday dispatches contextMeta and the active athlete\'s localContext', async () => {
    const r = rig();
    r.ex.dispatch({ type: 'sessionSync', row: row({ workout_instance_id: null, routine_exercise_id: null, exercise_id: null }) });
    await flushMicro();
    await r.ex.idle();
    const exA = { workoutInstanceId: 'wi-9', routineExerciseId: 're-a', exerciseId: 'ex-a', name: 'A', sets: 3, completedSets: 3, zoneMin: null, zoneMax: null, dropStopPct: null };
    const exB = { workoutInstanceId: 'wi-9', routineExerciseId: 're-b', exerciseId: 'ex-b', name: 'B', sets: 3, completedSets: 0, zoneMin: 0.6, zoneMax: 0.9, dropStopPct: 20 };
    r.ex.setToday([
      {
        athleteId: 'tyler',
        firstName: 'Tyler',
        lastName: 'B',
        instances: [{ workoutInstanceId: 'wi-9', status: 'not_started', createdAt: '2026-10-17T10:00:00Z', exercises: [exA, exB], remaining: [exB] }],
        exercises: [exA, exB],
        remaining: [exB],
      },
    ]);
    expect(events.filter(e => e.type === 'contextMeta')).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ type: 'localContext', athleteId: 'tyler', routineExerciseId: 're-b' }));
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.idle();
    const w = (r.persist.writeRep as jest.Mock).mock.calls[0][0];
    expect(w).toMatchObject({ workoutInstanceId: 'wi-9', routineExerciseId: 're-b' });
  });
});


// ---------------------------------------------------------------- Task 9 fix round 1

const tEx = (over: Partial<TodayExercise>): TodayExercise => ({
  workoutInstanceId: 'wi-9',
  routineExerciseId: 're-a',
  exerciseId: 'ex-a',
  name: 'A',
  sets: 3,
  completedSets: 0,
  zoneMin: null,
  zoneMax: null,
  dropStopPct: null,
  // A rack lift (tracks weight) unless a test says otherwise.
  plan: { exercise_id: over.exerciseId ?? 'ex-a', enabled_measurements: ['weight'] },
  ...over,
});
const todayOf = (athleteId: string, exs: TodayExercise[]): TodayAthlete => ({
  athleteId,
  firstName: athleteId,
  lastName: '',
  instances: [{ workoutInstanceId: exs[0]?.workoutInstanceId ?? 'wi-9', status: 'not_started', createdAt: '2026-10-17T10:00:00Z', exercises: exs, remaining: exs }],
  exercises: exs,
  remaining: exs,
});
const noPhone = { workout_instance_id: null, routine_exercise_id: null, exercise_id: null, set_number: null, load_lb: null };

describe('exercise override lives in the executor', () => {
  it('override → idle end → setToday keeps the idle hold (no executor pick in between)', async () => {
    // rack_end_set leaves Tyler up (nobody queued).
    const r = rig({
      api: {
        startSet: jest.fn(async (_r, a, st) => row({ ...noPhone, active_athlete_id: a, state: 'lifting', set_started_at: st, queue: [], updated_at: iso(T0 + 1) })),
        endSet: jest.fn(async () => row({ ...noPhone, queue: [], updated_at: iso(T0 + 61_001) })),
      },
    });
    r.ex.dispatch({ type: 'sessionSync', row: row(noPhone) });
    await r.ex.idle();
    const A = tEx({});
    const B = tEx({ routineExerciseId: 're-b', exerciseId: 'ex-b', name: 'B' });
    r.ex.setToday([todayOf('tyler', [A, B])]);
    r.ex.setOverride('tyler', B);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.advance(61_000);
    r.ex.dispatch({ type: 'tick' });
    await r.ex.idle();
    expect(r.ex.getState().lastEndByAthlete.tyler).toMatchObject({ hold: true, endedBy: 'idle' });
    const before = events.length;
    r.ex.setToday([todayOf('tyler', [A, B])]);
    const pushed = events.slice(before).filter(e => e.type === 'localContext');
    expect(pushed.every(e => (e as any).routineExerciseId === 're-b')).toBe(true);
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 're-b', resolved: true });
    expect(r.ex.getState().lastEndByAthlete.tyler.hold).toBe(true);
    // The next rep (past the 3 s late-rep window) reopens the same set.
    r.advance(5_000);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.78) });
    await r.ex.idle();
    expect(r.ex.getState().live).toMatchObject({ context: { routineExerciseId: 're-b', setNumber: 1 } });
  });

  it('the override is cleared when the active athlete changes', async () => {
    const r = rig();
    r.ex.dispatch({ type: 'sessionSync', row: row(noPhone) });
    const A = tEx({});
    const B = tEx({ routineExerciseId: 're-b', exerciseId: 'ex-b', name: 'B' });
    r.ex.setToday([todayOf('tyler', [A, B]), todayOf('jake', [A, B])]);
    r.ex.setOverride('tyler', B);
    r.ex.dispatch({ type: 'sessionSync', row: row({ ...noPhone, active_athlete_id: 'jake', updated_at: iso(T0 + 1) }) });
    r.ex.dispatch({ type: 'sessionSync', row: row({ ...noPhone, active_athlete_id: 'tyler', updated_at: iso(T0 + 2) }) });
    expect(r.ex.getState().localContext).toMatchObject({ athleteId: 'tyler', routineExerciseId: 're-a' });
  });
});

describe('derived load (no phone load)', () => {
  it("uses the plan's weight for that set and writes it to the sensor + set row", async () => {
    const r = rig({
      api: {
        startSet: jest.fn(async (_r, a, st) => row({ ...noPhone, active_athlete_id: a, state: 'lifting', set_started_at: st, queue: [], updated_at: iso(T0 + 1) })),
        endSet: jest.fn(async () => row({ ...noPhone, queue: [], updated_at: iso(T0 + 2) })),
      },
    });
    r.ex.dispatch({ type: 'sessionSync', row: row(noPhone) });
    r.ex.setToday([todayOf('tyler', [tEx({ prescribedWeights: [185, 195, 205], prescribedWeight: 175 })])]);
    expect(r.ex.getState().loadOverrideLb).toBe(185);
    await r.ex.idle();
    expect(r.sensor.writeLoad).toHaveBeenCalledWith(185);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    expect((r.persist.endSet as jest.Mock).mock.calls[0][0]).toMatchObject({ setNumber: 1, loadLb: 185 });
    // Next set → set 2's weight.
    expect(r.ex.getState().loadOverrideLb).toBe(195);
  });

  it('falls back to the last logged weight (one query, cached per athlete+exercise)', async () => {
    const lastLoggedWeight = jest.fn(async () => 225);
    const r = rig({ api: { lastLoggedWeight } });
    r.ex.dispatch({ type: 'sessionSync', row: row(noPhone) });
    r.ex.setToday([todayOf('tyler', [tEx({})])]);
    await flushMicro();
    await r.ex.idle();
    expect(lastLoggedWeight).toHaveBeenCalledTimes(1);
    expect(lastLoggedWeight).toHaveBeenCalledWith('tyler', 'ex-a');
    expect(r.ex.getState().loadOverrideLb).toBe(225);
    expect(r.sensor.writeLoad).toHaveBeenCalledWith(225);
    r.ex.setToday([todayOf('tyler', [tEx({})])]);
    r.ex.dispatch({ type: 'tick' });
    await flushMicro();
    expect(lastLoggedWeight).toHaveBeenCalledTimes(1);
  });

  it('a phone load always wins', async () => {
    const lastLoggedWeight = jest.fn(async () => 225);
    const r = rig({ api: { lastLoggedWeight } });
    r.ex.setToday([todayOf('tyler', [tEx({ workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', exerciseId: 'ex-squat', prescribedWeight: 175 })])]);
    r.ex.dispatch({ type: 'sessionSync', row: row() }); // phone: 205
    await flushMicro();
    expect(r.ex.getState().loadOverrideLb).toBeNull();
    expect(lastLoggedWeight).not.toHaveBeenCalled();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    expect(r.ex.getState().live?.context.loadLb).toBe(205);
  });

  it('no athlete → the derived load is cleared', () => {
    const r = rig();
    r.ex.dispatch({ type: 'sessionSync', row: row(noPhone) });
    r.ex.setToday([todayOf('tyler', [tEx({ prescribedWeight: 175 })])]);
    expect(r.ex.getState().loadOverrideLb).toBe(175);
    r.ex.dispatch({ type: 'sessionSync', row: row({ ...noPhone, active_athlete_id: null, queue: [], updated_at: iso(T0 + 1) }) });
    expect(r.ex.getState().loadOverrideLb).toBeNull();
  });
});

describe('PIN-exit helpers', () => {
  it('endLive ends a live set with ipadDone and waits for its write', async () => {
    const r = rig({ api: { endSet: jest.fn(async () => row({ queue: [], updated_at: iso(T0 + 1) })) } });
    r.ex.dispatch({ type: 'sessionSync', row: row() });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.endLive();
    expect(events).toContainEqual({ type: 'ipadDone' });
    expect(r.persist.endSet).toHaveBeenCalledTimes(1);
    expect(r.ex.getState().setState).toBe('summary');
  });
  it('endLive does nothing when not lifting', async () => {
    const r = rig();
    r.ex.dispatch({ type: 'sessionSync', row: row() });
    await r.ex.endLive();
    expect(events).not.toContainEqual({ type: 'ipadDone' });
  });
  it('flush() returns the flush promise; unsavedCount reports memory-held writes', async () => {
    const r = rig({ persist: { writeRep: jest.fn(async () => { throw new Error('disk full'); }) } });
    r.ex.dispatch({ type: 'sessionSync', row: row() });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.idle();
    expect(r.ex.unsavedCount()).toEqual({ reps: 1, sets: 0 });
    await expect(r.ex.flush()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------- Task 9 fix round 3: unison, rack lifts, % loads

const boxJump = () => tEx({ routineExerciseId: 're-box', exerciseId: 'ex-box', name: 'Box Jump', plan: { exercise_id: 'ex-box', enabled_measurements: ['reps'] } });
const squat = (over: Partial<TodayExercise> = {}) =>
  tEx({ routineExerciseId: 're-sq', exerciseId: 'ex-sq', name: 'Back Squat', plan: { exercise_id: 'ex-sq', enabled_measurements: ['weight', 'reps'] }, ...over });
const ipadRow = (ctx: { wi: string | null; re: string | null; set: number | null; load: number | null }, at = T0 + 5) =>
  row({ workout_instance_id: ctx.wi, routine_exercise_id: ctx.re, exercise_id: null, set_number: ctx.set, load_lb: ctx.load, queue: [], updated_at: iso(at) });

function unisonRig(extra: Partial<ExecutorApi> = {}) {
  const setIpadContext = jest.fn(async (_r: string, _a: string, c: any) =>
    ipadRow({ wi: c.workoutInstanceId, re: c.routineExerciseId, set: c.setNumber, load: c.loadLb }),
  );
  const r = rig({ api: { setIpadContext, ...extra } });
  return { r, setIpadContext };
}

describe('unison: the iPad publishes its context (rack_set_ipad_context)', () => {
  it('auto-pick with no phone context → publishes athlete, instance, routine exercise, set, load; row fed back', async () => {
    const { r, setIpadContext } = unisonRig();
    r.ex.dispatch({ type: 'sessionSync', row: row({ ...noPhone, queue: [] }) });
    r.ex.setToday([todayOf('tyler', [boxJump(), squat({ prescribedWeight: 185 })])]);
    await flushMicro();
    expect(setIpadContext).toHaveBeenCalledTimes(1);
    expect(setIpadContext).toHaveBeenCalledWith(RACK, 'tyler', { workoutInstanceId: 'wi-9', routineExerciseId: 're-sq', setNumber: 1, loadLb: 185 });
    expect(r.ex.getState().session).toMatchObject({ routine_exercise_id: 're-sq', load_lb: 185 });
    expect(r.ex.ipadOwnsContext()).toBe(true);
    // Settled: no republish on later events.
    r.ex.dispatch({ type: 'tick' });
    r.ex.setToday([todayOf('tyler', [boxJump(), squat({ prescribedWeight: 185 })])]);
    await flushMicro();
    expect(setIpadContext).toHaveBeenCalledTimes(1);
  });

  it("never echoes the phone's context", async () => {
    const { r, setIpadContext } = unisonRig();
    r.ex.setToday([todayOf('tyler', [squat({ workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', exerciseId: 'ex-squat', prescribedWeight: 185 })])]);
    r.ex.dispatch({ type: 'sessionSync', row: row({ load_lb: null }) }); // phone: wi-1 / re-squat, no load
    await flushMicro();
    expect(setIpadContext).not.toHaveBeenCalled();
    expect(r.ex.ipadOwnsContext()).toBe(false);
  });

  it('a coach override over the phone publishes; a later phone change wins and is not overwritten', async () => {
    const { r, setIpadContext } = unisonRig();
    const sq = squat({ workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', exerciseId: 'ex-squat' });
    const bench = squat({ workoutInstanceId: 'wi-1', routineExerciseId: 're-bench', exerciseId: 'ex-bench', name: 'Bench' });
    r.ex.setToday([todayOf('tyler', [sq, bench])]);
    r.ex.dispatch({ type: 'sessionSync', row: row({ queue: [] }) }); // phone on squat
    r.ex.setOverride('tyler', bench);
    await flushMicro();
    expect(setIpadContext).toHaveBeenCalledTimes(1);
    expect(setIpadContext.mock.calls[0][2]).toMatchObject({ routineExerciseId: 're-bench' });
    // The phone moves to squat again.
    r.ex.dispatch({ type: 'sessionSync', row: row({ queue: [], updated_at: iso(T0 + 100) }) });
    await flushMicro();
    expect(setIpadContext).toHaveBeenCalledTimes(1);
    expect(r.ex.ipadOwnsContext()).toBe(false);
  });

  it('auto-pick skips non-rack lifts; none left → no pick, no publish, reps go in as a free set', async () => {
    const { r, setIpadContext } = unisonRig();
    r.ex.dispatch({ type: 'sessionSync', row: row({ ...noPhone, queue: [] }) });
    r.ex.setToday([todayOf('tyler', [boxJump()])]);
    await flushMicro();
    expect(r.ex.getState().localContext).toMatchObject({ resolved: true, workoutInstanceId: null, routineExerciseId: null });
    expect(setIpadContext).not.toHaveBeenCalled();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.idle();
    expect((r.persist.writeRep as jest.Mock).mock.calls[0][0]).toMatchObject({ workoutInstanceId: null, routineExerciseId: null });
  });

  it('an earlier pick is cleared when no rack lift remains (from the logs)', async () => {
    let logs: SetLogRow[] = [];
    const { r } = unisonRig({ todaysSetLogs: jest.fn(async () => logs) });
    r.ex.dispatch({ type: 'sessionSync', row: row({ ...noPhone, queue: [] }) });
    r.ex.setToday([todayOf('tyler', [squat()])]);
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 're-sq' });
    logs = [1, 2, 3].map(n => ({ athleteId: 'tyler', workoutInstanceId: 'wi-9', routineExerciseId: 're-sq', setNumber: n, isComplete: true }));
    r.ex.setToday([todayOf('tyler', [squat()])]);
    await settle();
    expect(r.ex.getState().localContext).toMatchObject({ workoutInstanceId: null });
  });
});

describe('% loads (logger v2 targets)', () => {
  const pct90S1 = () =>
    squat({
      plan: {
        exercise_id: 'ex-sq',
        enabled_measurements: ['weight'],
        set_configurations: [
          { metric_values: { weight: 200 } },
          { intensity_targets: [{ metric: 'weight', percent: 90, relative_to: 'set', reference_set: 1 }] },
        ],
      },
    });

  it('"90% S1" for set 2 resolves from today\'s logged set-1 weight and is published', async () => {
    const loggedWeights = jest.fn(async () => ({ 1: 200 }));
    const { r, setIpadContext } = unisonRig({ loggedWeights });
    r.ex.dispatch({ type: 'sessionSync', row: row({ ...noPhone, queue: [] }) });
    r.ex.dispatch({ type: 'seedHighWater', athleteId: 'tyler', workoutInstanceId: 'wi-9', routineExerciseId: 're-sq', setNumber: 1 });
    r.ex.setToday([todayOf('tyler', [pct90S1()])]);
    await flushMicro();
    await flushMicro();
    expect(loggedWeights).toHaveBeenCalledWith('wi-9', 're-sq');
    expect(r.ex.getState().loadOverrideLb).toBe(180);
    expect(setIpadContext).toHaveBeenLastCalledWith(RACK, 'tyler', expect.objectContaining({ setNumber: 2, loadLb: 180 }));
  });

  it('unresolvable % (set 1 not logged) → no load, no last-weight fallback', async () => {
    const lastLoggedWeight = jest.fn(async () => 225);
    const { r } = unisonRig({ loggedWeights: jest.fn(async () => ({})), lastLoggedWeight });
    r.ex.dispatch({ type: 'sessionSync', row: row({ ...noPhone, queue: [] }) });
    r.ex.dispatch({ type: 'seedHighWater', athleteId: 'tyler', workoutInstanceId: 'wi-9', routineExerciseId: 're-sq', setNumber: 1 });
    r.ex.setToday([todayOf('tyler', [pct90S1()])]);
    await flushMicro();
    expect(r.ex.getState().loadOverrideLb).toBeNull();
    expect(lastLoggedWeight).not.toHaveBeenCalled();
  });

  it('"80% of max" resolves from the athlete\'s max', async () => {
    const athleteMaxes = jest.fn(async () => ({ 'ex-sq': { weight: 250 } }));
    const { r } = unisonRig({ athleteMaxes });
    r.ex.dispatch({ type: 'sessionSync', row: row({ ...noPhone, queue: [] }) });
    r.ex.setToday([
      todayOf('tyler', [squat({ plan: { exercise_id: 'ex-sq', intensity_targets: [{ metric: 'weight', percent: 80 }] } })]),
    ]);
    await flushMicro();
    await flushMicro();
    expect(athleteMaxes).toHaveBeenCalledWith('tyler', ['ex-sq']);
    expect(r.ex.getState().loadOverrideLb).toBe(200);
  });
});
