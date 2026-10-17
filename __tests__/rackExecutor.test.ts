import * as engineModule from '../lib/rack/engine';
import { createRackEngine, type RackEvent, type RackSessionRow } from '../lib/rack/engine';
import { createRackExecutor, SEED_RETRY_MS, SEED_REFRESH_MS, type ExecutorApi } from '../lib/rack/executor';
import type { TodayAthlete } from '../lib/rack/api';
import type { WrittenSet } from '../lib/rack/api';
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
    todaysWrittenSets: jest.fn(async (): Promise<WrittenSet[]> => []),
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
    const calls = (r.api.todaysWrittenSets as jest.Mock).mock.calls.map(c => [...c[0]].sort());
    expect(calls[0]).toEqual(['cole', 'jake', 'tyler']);
    const n = calls.length;
    await jest.advanceTimersByTimeAsync(SEED_REFRESH_MS);
    expect((r.api.todaysWrittenSets as jest.Mock).mock.calls.length).toBeGreaterThan(n);
    r.ex.stop();
  });

  it('a seed landing before the first rep puts the set above the high-water', async () => {
    const r = rig({
      api: { todaysWrittenSets: jest.fn(async () => [{ athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', setNumber: 3 }]) },
    });
    r.ex.setToday([tile('tyler')]);
    await flushMicro();
    expect(events.some(e => e.type === 'seedHighWater')).toBe(true);
    r.ex.dispatch({ type: 'sessionSync', row: row() }); // phone says set 1
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.idle();
    expect((r.persist.writeRep as jest.Mock).mock.calls[0][0].setNumber).toBe(4);
  });

  it('reps are never buffered in the executor (seed pending or failing)', async () => {
    jest.useFakeTimers();
    const seedFn = jest.fn(() => Promise.reject(new Error('offline')));
    const r = rig({ api: { todaysWrittenSets: seedFn } });
    r.ex.start();
    r.ex.dispatch({ type: 'sessionSync', row: row() });
    expect(r.ex.isSyncing()).toBe(true);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    expect(events.filter(e => e.type === 'rep')).toHaveLength(1); // reached the engine synchronously
    r.ex.dispatch({ type: 'ipadDone' });
    expect(events.filter(e => e.type === 'ipadDone')).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(SEED_RETRY_MS + 10);
    await r.ex.idle();
    expect(seedFn.mock.calls.length).toBeGreaterThanOrEqual(2); // retried every 5 s
    expect(r.persist.writeRep).toHaveBeenCalledTimes(1);
    expect(r.persist.endSet).toHaveBeenCalledTimes(1);
    expect(events.filter(e => e.type === 'ipadDone')).toHaveLength(1); // no replay
    r.ex.stop();
  });

  it("N-1 regression: Jake's reps stay Jake's when Tyler becomes active again", async () => {
    const seed = deferred<WrittenSet[]>();
    const seedFn = jest.fn().mockResolvedValueOnce([]).mockImplementation(() => seed.promise);
    const r = rig({ api: { todaysWrittenSets: seedFn } });
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
    const before = (r.api.todaysWrittenSets as jest.Mock).mock.calls.length;
    r.ex.dispatch({ type: 'selectAthlete', athleteId: 'jake' });
    await flushMicro();
    await r.ex.idle();
    const calls = (r.api.todaysWrittenSets as jest.Mock).mock.calls;
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

