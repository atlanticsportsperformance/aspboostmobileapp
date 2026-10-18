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
import { createRackEngine, reduce, type RackEffect, type RackEngineState, type RackEvent, type RackSessionRow } from '../lib/rack/engine';
import { createRackExecutor, MOVE_WINDOW_MS, type ExecutorApi } from '../lib/rack/executor';
import { createRackPersist, MOVE_QUEUE_KEY, SET_QUEUE_KEY } from '../lib/rack/persist';
import { buildRackView, moveCandidates, MOVE_WINDOW_MS as VIEW_MOVE_WINDOW_MS, removeRepTitle } from '../lib/rack/viewModel';
import { addRepRow, type ChipSet } from '../lib/rack/phone';
import { dropPct } from '../lib/ovr/protocol';
import type { OvrRep } from '../lib/ovr/protocol';
import type { SetLogRow, TodayAthlete, TodayExercise } from '../lib/rack/api';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const RACK = 'rack-3';
const ORG = 'org-1';
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
const ovr = (v: number, rom = 20): OvrRep => ({ concentricS: 0.5, romIn: rom, meanV: v, peakV: v + 0.3, meanPowerW: 900, peakPowerW: 1800 });

const tEx = (over: Partial<TodayExercise>): TodayExercise => ({
  workoutInstanceId: 'wi-j',
  routineExerciseId: 're-j',
  exerciseId: 'ex-squat',
  name: 'Back Squat',
  sets: 3,
  completedSets: 0,
  zoneMin: null,
  zoneMax: null,
  dropStopPct: null,
  plan: { exercise_id: over.exerciseId ?? 'ex-squat', enabled_measurements: ['weight'] },
  ...over,
});
const todayOf = (athleteId: string, exs: TodayExercise[], first = athleteId, last = ''): TodayAthlete => ({
  athleteId,
  firstName: first,
  lastName: last,
  instances: [{ workoutInstanceId: exs[0]?.workoutInstanceId ?? 'wi-x', status: 'not_started', createdAt: '2026-10-17T10:00:00Z', exercises: exs, remaining: exs }],
  exercises: exs,
  remaining: exs,
});

const flushMicro = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

// ---------------------------------------------------------------- engine: removeRep

function engineRig() {
  let s: RackEngineState = createRackEngine(RACK);
  let t = T0;
  const all: RackEffect[] = [];
  const send = (e: RackEvent, dt = 500) => {
    t += dt;
    const r = reduce(s, e, t);
    s = r.state;
    all.push(...r.effects);
    return r.effects;
  };
  return {
    send,
    get s() {
      return s;
    },
    get t() {
      return t;
    },
    all,
  };
}

function zoned(r: ReturnType<typeof engineRig>) {
  r.send({ type: 'contextMeta', exerciseId: 'ex-squat', routineExerciseId: 're-squat', zoneMin: 0.5, zoneMax: 0.9, dropStopPct: 20 });
  r.send({ type: 'sessionSync', row: row({ updated_at: iso(T0 + 1) }) });
}

describe('engine removeRep', () => {
  it('drops a live rep and recalculates reps, best and drop (the removed rep was the best)', () => {
    const r = engineRig();
    zoned(r);
    r.send({ type: 'rep', rep: ovr(0.8) });
    r.send({ type: 'rep', rep: ovr(0.6) });
    r.send({ type: 'rep', rep: ovr(0.5) });
    expect(r.s.live!.reps[2].dropCue).toBe(true); // 37.5 % vs 0.80
    const first = r.s.live!.reps[0].clientRepId;
    const fx = r.send({ type: 'removeRep', clientRepId: first });
    expect(fx).toEqual([]); // the live set's row is written at its end
    const reps = r.s.live!.reps;
    expect(reps.map(x => x.v)).toEqual([0.6, 0.5]);
    expect(reps[0].dropPct).toBe(dropPct(0.6, 0.6));
    expect(reps[1].dropPct).toBe(dropPct(0.6, 0.5));
    expect(reps[1].dropCue).toBe(false); // 16.7 % < 20 %
    const view = buildRackView({ state: r.s, today: [], rackName: 'Rack 3', nowMs: r.t });
    expect(view.fullReps).toBe(2);
    expect(view.bestV).toBe(0.6);
    expect(view.dropCue).toBe(false);
    // The set's row carries the recalculated summary.
    const end = r.send({ type: 'ipadDone' }).find(f => f.type === 'endSet') as Extract<RackEffect, { type: 'endSet' }>;
    expect(end.summary.fullReps).toBe(2);
    expect(end.summary.bestV).toBe(0.6);
    expect(end.summary.avgV).toBe(0.55);
    expect(end.summary.reps.map(x => x.v)).toEqual([0.6, 0.5]);
  });

  it('a rep after a removal never reuses the removed rep index / client_rep_id', () => {
    const r = engineRig();
    zoned(r);
    r.send({ type: 'rep', rep: ovr(0.8) });
    r.send({ type: 'rep', rep: ovr(0.7) });
    const gone = r.s.live!.reps[1];
    r.send({ type: 'removeRep', clientRepId: gone.clientRepId });
    const fx = r.send({ type: 'rep', rep: ovr(0.75) });
    const w = fx.find(f => f.type === 'writeRep') as Extract<RackEffect, { type: 'writeRep' }>;
    expect(w.rep.repIndex).toBe(3);
    expect(w.rep.clientRepId).not.toBe(gone.clientRepId);
  });

  it('a rep of the just-ended set: summary recalculated + setChanged (a queued write gets the new summary)', () => {
    const r = engineRig();
    zoned(r);
    r.send({ type: 'rep', rep: ovr(0.8) });
    r.send({ type: 'rep', rep: ovr(0.4) });
    r.send({ type: 'ipadDone' });
    const bad = r.s.lastEnded!.reps[1].clientRepId;
    const fx = r.send({ type: 'removeRep', clientRepId: bad });
    expect(fx.map(f => f.type)).toEqual(['setChanged']);
    const sm = (fx[0] as Extract<RackEffect, { type: 'setChanged' }>).summary;
    expect(sm.fullReps).toBe(1);
    expect(sm.setNumber).toBe(1);
    expect(r.s.lastEnded!.reps).toHaveLength(1);
    const view = buildRackView({ state: r.s, today: [], rackName: 'Rack 3', nowMs: r.t });
    expect(view.summary?.big).toBe('205 lb × 1');
  });

  it('an unknown rep id is a no-op', () => {
    const r = engineRig();
    zoned(r);
    r.send({ type: 'rep', rep: ovr(0.8) });
    const before = r.s;
    expect(r.send({ type: 'removeRep', clientRepId: 'nope' })).toEqual([]);
    expect(r.s.live!.reps).toBe(before.live!.reps);
  });

  it('setMoved forgets the ended set: no summary, no late-rep attach, not complete any more', () => {
    const r = engineRig();
    zoned(r);
    r.send({ type: 'rep', rep: ovr(0.8) });
    r.send({ type: 'ipadDone' });
    const ended = r.s.lastEnded!;
    r.send({ type: 'setMoved', athleteId: 'tyler', setStartedAtMs: ended.startedAtMs }, 100);
    expect(r.s.lastEnded).toBeNull();
    expect(r.s.lastEndByAthlete.tyler).toBeUndefined();
    expect(r.s.completeSets['tyler:wi-1:re-squat'] ?? []).not.toContain(1);
    expect(buildRackView({ state: r.s, today: [], rackName: 'Rack 3', nowMs: r.t }).summary).toBeNull();
    // A rep within 3 s now starts a new set instead of amending the moved one.
    const fx = r.send({ type: 'rep', rep: ovr(0.7) }, 100);
    expect(fx.map(f => f.type)).toContain('rpcStartSet');
    expect(fx.map(f => f.type)).not.toContain('amendSet');
  });
});

// ---------------------------------------------------------------- executor rig

function rig(over: { api?: Partial<ExecutorApi>; persist?: any } = {}) {
  let t = T0;
  const db: SetLogRow[] = [];
  const calls: string[] = [];
  const api: ExecutorApi = {
    startSet: jest.fn(async (_r, a, s) => {
      calls.push('rpc:startSet');
      return row({ active_athlete_id: a, state: 'lifting', set_started_at: s, updated_at: iso(t) });
    }),
    setActive: jest.fn(async (_r, a) => {
      calls.push(`rpc:setActive:${a}`);
      return row({ active_athlete_id: a, queue: [], workout_instance_id: null, routine_exercise_id: null, exercise_id: null, set_number: null, load_lb: null, updated_at: iso(t + 2) });
    }),
    endSet: jest.fn(async () => {
      calls.push('rpc:endSet');
      return row({ active_athlete_id: 'tyler', queue: ['jake'], updated_at: iso(t + 1) });
    }),
    athleteSets: jest.fn(async (_r, a): Promise<SetLogRow[]> => db.filter(d => d.athleteId === a)),
    setIpadContext: jest.fn(async (_r, a, c) => {
      calls.push(`rpc:setIpadContext:${c.loadLb}`);
      return row({ active_athlete_id: a, workout_instance_id: c.workoutInstanceId, routine_exercise_id: c.routineExerciseId, set_number: c.setNumber, load_lb: c.loadLb, updated_at: iso(t + 3) });
    }),
    ...over.api,
  };
  const persist = over.persist ?? {
    writeRep: jest.fn(async () => void calls.push('persist:writeRep')),
    endSet: jest.fn(async () => void calls.push('persist:endSet')),
    amendSet: jest.fn(async () => void calls.push('persist:amendSet')),
    moveSet: jest.fn(async () => void calls.push('persist:moveSet')),
    removeRep: jest.fn(async () => void calls.push('persist:removeRep')),
    flush: jest.fn(async () => {}),
  };
  const sensor = { writeLoad: jest.fn(async () => {}) };
  const ex = createRackExecutor({ engine: createRackEngine(RACK), api, persist, sensor, now: () => t, log: () => {} });
  return {
    ex,
    api,
    persist,
    sensor,
    calls,
    db,
    advance: (ms: number) => (t += ms),
  };
}

async function tylerUpWithJakeToday(r: ReturnType<typeof rig>) {
  r.ex.setToday([todayOf('jake', [tEx({})], 'Jake')]);
  r.ex.dispatch({ type: 'sessionSync', row: row() });
  await flushMicro();
  await r.ex.idle();
}

describe('executor: move a set to the right athlete', () => {
  it('mid-set: set write enqueued → rack_move_set queued → rack_set_active(target), exactly once', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) });
    await r.ex.idle();
    expect(r.ex.getState().setState).toBe('lifting');

    const to = await r.ex.moveSet('jake');
    await r.ex.idle();
    expect(to).toEqual({ athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 });
    expect(r.persist.moveSet).toHaveBeenCalledTimes(1);
    expect(r.persist.moveSet).toHaveBeenCalledWith(
      { athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', setNumber: 1 },
      { athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 },
    );
    const iEnd = r.calls.indexOf('persist:endSet');
    const iMove = r.calls.indexOf('persist:moveSet');
    const iActive = r.calls.indexOf('rpc:setActive:jake');
    expect(iEnd).toBeGreaterThan(-1);
    expect(iEnd).toBeLessThan(iMove);
    expect(iMove).toBeLessThan(iActive);
    expect(r.calls.filter(c => c === 'rpc:setActive:jake')).toHaveLength(1);
    // The wrong athlete's set is forgotten here; Jake is up.
    expect(r.ex.getState().lastEnded).toBeNull();
    expect(r.ex.getState().activeAthleteId).toBe('jake');
  });

  it('after Done: the just-ended set moves within 2 minutes, not after', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    r.advance(MOVE_WINDOW_MS + 1);
    expect(await r.ex.moveSet('jake')).toBeNull();
    expect(r.persist.moveSet).not.toHaveBeenCalled();

    const r2 = rig();
    await tylerUpWithJakeToday(r2);
    r2.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r2.ex.dispatch({ type: 'ipadDone' });
    await r2.ex.idle();
    r2.advance(30_000);
    expect(await r2.ex.moveSet('jake')).not.toBeNull();
    expect(r2.persist.moveSet).toHaveBeenCalledTimes(1);
    expect(VIEW_MOVE_WINDOW_MS).toBe(MOVE_WINDOW_MS);
  });

  it('offline: the move waits in rack_moves_v1 behind the set write, then goes out once', async () => {
    let online = false;
    const rpc = jest.fn(async (fn: string, _a: any) => (online ? { data: fn === 'rack_move_set' ? 2 : 'ok', error: null, status: 200 } : { data: null, error: { message: 'offline' }, status: 503 }));
    const upsert = jest.fn(async () => (online ? { error: null, status: 201 } : { error: { message: 'offline' }, status: 503 }));
    const client = { rpc, from: jest.fn(() => ({ upsert })) } as any;
    const persist = createRackPersist({ client, orgId: ORG, log: () => {} });
    const r = rig({ persist });
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.idle();
    await r.ex.moveSet('jake');
    await r.ex.idle();
    await r.ex.flush();
    // On disk, in order: the set write and the move — nothing sent.
    expect(JSON.parse(store[SET_QUEUE_KEY])).toHaveLength(1);
    const moves = JSON.parse(store[MOVE_QUEUE_KEY]);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: 'move', from: { athleteId: 'tyler', setNumber: 1 }, to: { athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 } });
    expect(rpc.mock.calls.filter(c => c[0] === 'rack_move_set')).toHaveLength(0);

    online = true;
    await r.ex.flush();
    const fns = rpc.mock.calls.map(c => c[0]);
    const lastUpsert = fns.lastIndexOf('upsert_exercise_log');
    expect(lastUpsert).toBeGreaterThan(-1);
    expect(fns.filter(f => f === 'rack_move_set')).toHaveLength(1);
    expect(fns.indexOf('rack_move_set')).toBeGreaterThan(lastUpsert);
    expect(rpc.mock.calls.find(c => c[0] === 'rack_move_set')![1]).toEqual({
      p_from_athlete: 'tyler',
      p_from_wi: 'wi-1',
      p_from_re: 're-squat',
      p_from_set: 1,
      p_to_athlete: 'jake',
      p_to_wi: 'wi-j',
      p_to_re: 're-j',
      p_to_set: 1,
    });
    expect(store[MOVE_QUEUE_KEY]).toBeUndefined();
    await r.ex.flush();
    expect(rpc.mock.calls.filter(c => c[0] === 'rack_move_set')).toHaveLength(1);
  });

  it('a move flush never runs while a rep is still queued', async () => {
    let repsOnline = false;
    const rpc = jest.fn(async () => ({ data: 1, error: null, status: 200 }));
    const upsert = jest.fn(async () => (repsOnline ? { error: null, status: 201 } : { error: { message: 'offline' }, status: 503 }));
    const p = createRackPersist({ client: { rpc, from: () => ({ upsert }) } as any, orgId: ORG, log: () => {} });
    await p.writeRep({
      clientRepId: 'rack-3:tyler:1:1', rackId: RACK, athleteId: 'tyler', workoutInstanceId: null, routineExerciseId: null, exerciseId: null,
      setNumber: null, repIndex: 1, loadLb: null, meanVelocity: 0.5, peakVelocity: 0.8, meanPowerW: 1, peakPowerW: 2, romIn: 20,
      concentricS: 0.5, isPartial: false, zone: null, dropPct: 0, dropCue: false, receivedAt: iso(T0),
    });
    await p.removeRep('rack-3:tyler:1:1');
    await p.flush({ force: true });
    expect(rpc).not.toHaveBeenCalled();
    repsOnline = true;
    await p.flush({ force: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('rack_remove_rep', { p_client_rep_id: 'rack-3:tyler:1:1', p_restore: false });
    expect(await p.pending()).toEqual({ reps: 0, sets: 0, moves: 0 });
  });
});

describe('executor: remove a bad rep', () => {
  it('iPad: engine drops it from the live set, then rack_remove_rep is queued once', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.3) });
    await r.ex.idle();
    const bad = r.ex.getState().live!.reps[1].clientRepId;
    await r.ex.removeRep(bad);
    expect(r.ex.getState().live!.reps.map(x => x.v)).toEqual([0.8]);
    expect(r.persist.removeRep).toHaveBeenCalledTimes(1);
    expect(r.persist.removeRep).toHaveBeenCalledWith(bad);
    expect(r.calls.lastIndexOf('persist:writeRep')).toBeLessThan(r.calls.indexOf('persist:removeRep'));
  });

  it('removed on the phone (realtime): engine only, no second rack_remove_rep', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.3) });
    await r.ex.idle();
    const bad = r.ex.getState().live!.reps[1].clientRepId;
    await r.ex.removeRep(bad, { remote: true });
    expect(r.ex.getState().live!.reps).toHaveLength(1);
    expect(r.persist.removeRep).not.toHaveBeenCalled();
    const H = read('hooks/useRackSession.ts');
    expect(H).toContain("{ event: 'UPDATE', schema: 'public', table: 'vbt_reps', filter: `rack_id=eq.${rackId}` }");
    expect(H).toContain('if (r?.client_rep_id && r.removed_at) void executor.removeRep(r.client_rep_id, { remote: true });');
  });

  it("an ended set's queued write is replaced with the recalculated summary", async () => {
    const queuedKeys = ['wi-1:re-squat:1'];
    const r = rig();
    r.persist.setQueue = { peekAll: async () => queuedKeys.map(key => ({ key })) };
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.3) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    const bad = r.ex.getState().lastEnded!.reps[1].clientRepId;
    await r.ex.removeRep(bad);
    await r.ex.idle();
    expect(r.persist.amendSet).toHaveBeenCalledTimes(1);
    expect((r.persist.amendSet as jest.Mock).mock.calls[0][0]).toMatchObject({ fullReps: 1, setNumber: 1 });
    expect(r.persist.removeRep).toHaveBeenCalledWith(bad);
  });
});

describe('executor: BAR stepper publishes load_lb', () => {
  it('between sets: rack_set_ipad_context with the new load, and the sensor gets it', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.ex.setBarLoad(215);
    await r.ex.idle();
    expect(r.api.setIpadContext).toHaveBeenCalledTimes(1);
    expect((r.api.setIpadContext as jest.Mock).mock.calls[0][2]).toMatchObject({ workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', setNumber: 1, loadLb: 215 });
    expect(r.sensor.writeLoad).toHaveBeenLastCalledWith(215);
    expect(r.ex.barLoad()).toEqual({ lb: 215, next: false });
    // The next set is written with it.
    r.ex.dispatch({ type: 'rep', rep: ovr(0.6) });
    await r.ex.idle();
    expect(r.ex.getState().live!.context.loadLb).toBe(215);
  });

  it('mid-set: the live set keeps its load; the new one shows as "next set" and is published once the set ends', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.6) });
    await r.ex.idle();
    (r.sensor.writeLoad as jest.Mock).mockClear();
    r.ex.setBarLoad(225);
    await r.ex.idle();
    expect(r.ex.getState().live!.context.loadLb).toBe(205);
    expect(r.ex.barLoad()).toEqual({ lb: 225, next: true });
    expect(r.api.setIpadContext).not.toHaveBeenCalledWith(RACK, 'tyler', expect.objectContaining({ loadLb: 225 }));
    expect(r.sensor.writeLoad).not.toHaveBeenCalledWith(225);
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    expect(r.api.setIpadContext).toHaveBeenCalledWith(RACK, 'tyler', expect.objectContaining({ loadLb: 225 }));
    expect(r.sensor.writeLoad).toHaveBeenCalledWith(225);
  });
});

// ---------------------------------------------------------------- view + sheets

describe('summary "Wrong athlete? Move set" — only within 2 minutes', () => {
  it('canMove until endedAt + 2 min (a sticky idle summary loses it)', () => {
    const r = engineRig();
    zoned(r);
    r.send({ type: 'rep', rep: ovr(0.8) });
    r.send({ type: 'tick' }, 60_000); // idle end: the summary stays up
    const endedAt = r.s.lastEnded!.endedAtMs!;
    const at = (ms: number) => buildRackView({ state: r.s, today: [], rackName: 'Rack 3', nowMs: endedAt + ms }).summary;
    expect(at(1_000)?.canMove).toBe(true);
    expect(at(119_999)?.canMove).toBe(true);
    expect(at(120_000)?.canMove).toBe(false);
    expect(at(1_000)?.moveUntilMs).toBe(endedAt + 120_000);
    const C = read('components/rack/AthleteCard.tsx');
    expect(C).toContain('{view.summary.canMove && onMoveSet && (');
    expect(C).toContain('Wrong athlete? Move set');
    const S = read('screens/rack/RackModeScreen.tsx');
    expect(S).toContain("onMoveSet={() => openMove('after')}");
    expect(S).toContain('const moveUntil = view.summary?.canMove ? view.summary.moveUntilMs : null;');
  });
});

describe('move sheet', () => {
  const today = [
    todayOf('zed', [tEx({})], 'Zed', 'Adams'),
    todayOf('cole', [tEx({})], 'Cole', 'Brown'),
    todayOf('jake', [tEx({})], 'Jake', 'Miller'),
    todayOf('amy', [tEx({})], 'Amy', 'Cole'),
    todayOf('tyler', [tEx({})], 'Tyler', 'Reed'),
  ];

  it('lists the queue first (rack order), then today by name; never the set owner; with search', () => {
    const list = moveCandidates({ activeAthleteId: 'tyler', queue: ['jake', 'cole'] }, today, 'tyler');
    expect(list.map(c => [c.athlete.athleteId, c.onRack])).toEqual([
      ['jake', true],
      ['cole', true],
      ['amy', false],
      ['zed', false],
    ]);
    expect(moveCandidates({ activeAthleteId: 'tyler', queue: ['jake', 'cole'] }, today, 'tyler', 'col').map(c => c.athlete.athleteId)).toEqual(['cole', 'amy']);
  });

  it('two steps: a tap selects; "Move set to <Name>" is the one call (guarded); live also offers Switch', () => {
    const M = read('components/rack/MoveSetSheet.tsx');
    expect(M).toContain('onPress={() => tapRow(a.athleteId)}');
    expect(M).toContain('setSelected(prev => (prev === id ? null : id));');
    expect(M).toContain('`Move set to ${chosen.firstName}`');
    expect(M).toContain('disabled={!chosen} onPress={once(onMove)}');
    expect(M).toContain('if (!chosen || sent.current) return;');
    expect(M).toContain("'Switch, or move this set?'");
    expect(M).toContain('{!after && (');
    expect(M).toContain('onPress={once(onSwitch)}');
    expect(M).toContain('supportedOrientations={[...ALL_MODAL_ORIENTATIONS]}');
    expect(M).toContain('<TextInput');
    // The ACTIVE tile while lifting opens it; other tiles switch as before.
    const S = read('screens/rack/RackModeScreen.tsx');
    expect(S).toContain("if (athleteId === state.activeAthleteId && state.setState === 'lifting' && state.live) openMove('live');");
    expect(S).toContain('else selectAthlete(athleteId);');
    expect(S).toContain('executor.moveSet(athleteId)');
    expect(S).toContain('onSwitch={selectAthlete}');
  });
});

describe('remove-rep sheet', () => {
  it('iPad: a THIS SET bar opens it; Remove calls executor.removeRep once', () => {
    expect(removeRepTitle({ repNo: 3, v: 0.3, partial: false })).toBe('Rep 3 · 0.30 m/s');
    const R = read('components/rack/RemoveRepSheet.tsx');
    expect(R).toContain('Bumped the bar or a re-rack?');
    expect(R).toContain('if (!rep || sent.current) return;');
    expect(R).toContain('onRemove(rep.clientRepId);');
    expect(R).toContain('Keep');
    expect(R).toContain('Remove rep');
    expect(R).toContain('supportedOrientations={[...ALL_MODAL_ORIENTATIONS]}');
    const S = read('screens/rack/RackModeScreen.tsx');
    expect(S).toContain('onPressBar={b => setRemoveRep({ clientRepId: b.clientRepId, repNo: b.repNo, v: b.v, partial: b.partial })}');
    expect(S).toContain('executor.removeRep(clientRepId)');
  });

  it('phone: long-press a live or saved chip → the sheet → rack_remove_rep as the athlete themself', () => {
    const LR = read('components/logger/LiveRepRow.tsx');
    expect(LR).toContain('onLongPress={onLongPressChip ? () => onLongPressChip(c) : undefined}');
    const D = read('screens/exercise-detail-view.tsx');
    expect(D).toContain('<LiveRepRow source="rack" chips={rack!.savedChips!(i)} live={false} onLongPressChip={chipPress(i)} />');
    expect(D).toContain('rack?.onRemoveRep?.(id, at);');
    const L = read('screens/WorkoutLoggerScreen.tsx');
    expect(L).toContain('await rack.removeRep(clientRepId);');
    expect(L).toContain('await solo.removeRep(clientRepId);');
    const H = read('hooks/useRackPhone.ts');
    expect(H).toContain('await api.removeRep(clientRepId);');
    // Self-only hook: everything is behind isSelf (athletes.user_id = auth.uid()).
    expect(H).toContain('const hasRacks = isSelf && list.length > 0;');
    const A = read('lib/rack/api.ts');
    expect(A).toContain("call<unknown>('rack_remove_rep', { p_client_rep_id: clientRepId, p_restore: restore })");
  });

  it('phone chips: a removed rep leaves its set, a moved rep changes set', () => {
    const sets = new Map<string, ChipSet>();
    const base = { client_rep_id: 'r1', rack_id: RACK, workout_instance_id: 'wi-1', routine_exercise_id: 're-squat', set_number: 1, rep_index: 1, mean_velocity: 0.5, peak_velocity: 0.8, rom_in: 20, is_partial: false, load_lb: 205, received_at: iso(T0) };
    addRepRow(sets, base);
    addRepRow(sets, { ...base, client_rep_id: 'r2', rep_index: 2 });
    expect(sets.get('wi-1:re-squat:1')!.chips).toHaveLength(2);
    addRepRow(sets, { ...base, removed_at: iso(T0 + 1) });
    expect(sets.get('wi-1:re-squat:1')!.chips.map(c => c.clientRepId)).toEqual(['r2']);
    addRepRow(sets, { ...base, client_rep_id: 'r2', rep_index: 2, workout_instance_id: 'wi-1', routine_exercise_id: 're-bench', set_number: 2 });
    expect(sets.get('wi-1:re-squat:1')!.chips).toHaveLength(0);
    expect(sets.get('wi-1:re-bench:2')!.chips.map(c => c.clientRepId)).toEqual(['r2']);
  });
});
