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
import { createRackPersist, MOVE_QUEUE_KEY, REMOVAL_QUEUE_KEY, REP_QUEUE_KEY, SET_QUEUE_KEY } from '../lib/rack/persist';
import type { RepWrite, SetSummary } from '../lib/rack/engine';
import { buildRackView, lastSetMoveOf, moveCandidates, MOVE_WINDOW_MS as VIEW_MOVE_WINDOW_MS, removeRepTitle } from '../lib/rack/viewModel';
import { addRepRow, type ChipSet } from '../lib/rack/phone';
import { captionWithRackLoad, rackCellLoad, rackLoadForSet, rackRowDiff, rackRowsGone } from '../lib/rack/phoneView';
import { createDraftWriter } from '../lib/logger/draftWriter';
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

const repW = (id: string): RepWrite => ({
  clientRepId: id, rackId: RACK, athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', exerciseId: 'ex-squat',
  setNumber: 1, repIndex: 1, loadLb: 205, meanVelocity: 0.5, peakVelocity: 0.8, meanPowerW: 1, peakPowerW: 2, romIn: 20,
  concentricS: 0.5, isPartial: false, zone: null, dropPct: 0, dropCue: false, receivedAt: iso(T0),
});
const setSum = (): SetSummary => ({
  rackId: RACK, source: 'rack', athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', exerciseId: 'ex-squat',
  setNumber: 1, loadLb: 205, setStartedAt: iso(T0), reps: [{ v: 0.5, pv: 0.8, rom: 20, partial: false }], fullReps: 1, avgV: 0.5,
  bestV: 0.5, dropPct: 0, zone: null, endedBy: 'ipad', free: false,
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
    expect(view.summary?.big).toBe('1 rep × 205 lb');
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
    moveReps: jest.fn(async () => void calls.push('persist:moveReps')),
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
  it('mid-set: zero writes for the wrong athlete, no rack_end_set; set ends as the target → rack_move_reps (exact ids) → rack_set_active', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) });
    await r.ex.idle();
    const ids = r.ex.getState().live!.reps.map(x => x.clientRepId);
    (r.persist.writeRep as jest.Mock).mockClear();
    r.calls.length = 0;

    const to = await r.ex.moveSet('jake');
    await r.ex.idle();
    expect(to).toEqual({ athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 });
    // Nothing for Tyler: no set row, no re-sent rep, no rack_end_set, no rack_move_set.
    const setWrites = [...(r.persist.endSet as jest.Mock).mock.calls, ...(r.persist.amendSet as jest.Mock).mock.calls].map(c => c[0]);
    expect(setWrites.filter(sm => sm.athleteId === 'tyler')).toHaveLength(0);
    expect((r.persist.writeRep as jest.Mock).mock.calls.filter(c => c[0].athleteId === 'tyler')).toHaveLength(0);
    expect(r.api.endSet).not.toHaveBeenCalled();
    expect(r.persist.moveSet).not.toHaveBeenCalled();
    // The set is Jake's: reps re-sent under Jake (same ids), his row written, then exactly these reps moved.
    expect((r.persist.writeRep as jest.Mock).mock.calls.map(c => [c[0].clientRepId, c[0].athleteId, c[0].routineExerciseId, c[0].setNumber])).toEqual(
      ids.map(id => [id, 'jake', 're-j', 1]),
    );
    expect(setWrites).toHaveLength(1);
    expect(setWrites[0]).toMatchObject({ athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1, fullReps: 2 });
    expect(r.persist.moveReps).toHaveBeenCalledTimes(1);
    expect(r.persist.moveReps).toHaveBeenCalledWith(ids, { athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 });
    const iEnd = r.calls.indexOf('persist:endSet');
    const iMove = r.calls.indexOf('persist:moveReps');
    const iActive = r.calls.indexOf('rpc:setActive:jake');
    expect(iEnd).toBeGreaterThan(-1);
    expect(iEnd).toBeLessThan(iMove);
    expect(iMove).toBeLessThan(iActive);
    expect(r.calls.filter(c => c === 'rpc:setActive:jake')).toHaveLength(1);
    expect(r.calls).not.toContain('rpc:endSet');
    expect(r.ex.getState().activeAthleteId).toBe('jake');
    expect(r.ex.getState().lastEnded!.athleteId).toBe('jake');
  });

  it('after Done, a FREE set moves with rack_move_reps and exactly its rep ids (never rack_move_set)', async () => {
    const r = rig();
    r.ex.setToday([todayOf('jake', [tEx({})], 'Jake')]);
    r.ex.dispatch({ type: 'sessionSync', row: row({ workout_instance_id: null, routine_exercise_id: null, exercise_id: null, set_number: null }) });
    await r.ex.idle();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    const ids = r.ex.getState().lastEnded!.reps.map(x => x.clientRepId);
    expect(r.ex.getState().lastEnded!.free).toBe(true);
    await r.ex.moveSet('jake', { last: true });
    expect(r.persist.moveSet).not.toHaveBeenCalled();
    expect(r.persist.moveReps).toHaveBeenCalledTimes(1);
    expect((r.persist.moveReps as jest.Mock).mock.calls[0][0]).toEqual(ids);
    expect((r.persist.moveReps as jest.Mock).mock.calls[0][1]).toEqual({ athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 });
  });

  it('after Done, a workout set moves with rack_move_set (and does not touch someone lifting now)', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    await r.ex.moveSet('jake', { last: true });
    expect(r.persist.moveSet).toHaveBeenCalledWith(
      { athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', setNumber: 1 },
      { athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 },
    );
    expect(r.persist.moveReps).not.toHaveBeenCalled();
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

  it('offline: the mid-set move waits in rack_moves_v1 behind the rep + set writes, then goes out once', async () => {
    let online = false;
    const rpc = jest.fn(async (fn: string, _a: any) => (online ? { data: fn === 'rack_move_reps' ? 2 : 'ok', error: null, status: 200 } : { data: null, error: { message: 'offline' }, status: 503 }));
    const upsert = jest.fn(async (_rows: any[], _o?: any) => (online ? { error: null, status: 201 } : { error: { message: 'offline' }, status: 503 }));
    const client = { rpc, from: jest.fn(() => ({ upsert })) } as any;
    const persist = createRackPersist({ client, orgId: ORG, log: () => {} });
    const r = rig({ persist, api: { setActive: jest.fn(async () => { throw new Error('offline'); }) } });
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) });
    await r.ex.idle();
    const ids = r.ex.getState().live!.reps.map(x => x.clientRepId);
    await r.ex.moveSet('jake');
    await r.ex.idle();
    await r.ex.flush();
    // On disk: the reps (re-keyed to Jake, never Tyler), Jake's set row, then the move.
    const reps = JSON.parse(store[REP_QUEUE_KEY]);
    expect(reps.map((x: any) => [x.client_rep_id, x.athlete_id])).toEqual(ids.map(id => [id, 'jake']));
    const sets = JSON.parse(store[SET_QUEUE_KEY]);
    expect(sets).toHaveLength(1);
    expect(sets[0].row).toMatchObject({ athlete_id: 'jake', routine_exercise_id: 're-j', set_number: 1 });
    const moves = JSON.parse(store[MOVE_QUEUE_KEY]);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: 'moveReps', clientRepIds: ids, to: { athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 } });
    expect(rpc.mock.calls.filter(c => c[0] === 'rack_move_reps')).toHaveLength(0);

    online = true;
    const sentFrom = upsert.mock.calls.length;
    await r.ex.flush();
    const fns = rpc.mock.calls.map(c => c[0]);
    const lastUpsert = fns.lastIndexOf('upsert_exercise_log');
    expect(lastUpsert).toBeGreaterThan(-1);
    expect(fns.filter(f => f === 'rack_move_reps')).toHaveLength(1);
    expect(fns.indexOf('rack_move_reps')).toBeGreaterThan(lastUpsert);
    expect(fns).not.toContain('rack_end_set');
    expect(rpc.mock.calls.find(c => c[0] === 'rack_move_reps')![1]).toEqual({
      p_client_rep_ids: ids,
      p_to_athlete: 'jake',
      p_to_wi: 'wi-j',
      p_to_re: 're-j',
      p_to_set: 1,
    });
    // Every vbt_reps row that reached the server is Jake's.
    const sent = upsert.mock.calls.slice(sentFrom).flatMap(c => c[0] as any[]);
    expect(sent.map(x => x.client_rep_id)).toEqual(ids);
    for (const x of sent) expect(x.athlete_id).toBe('jake');
    expect(store[MOVE_QUEUE_KEY]).toBeUndefined();
    await r.ex.flush();
    expect(rpc.mock.calls.filter(c => c[0] === 'rack_move_reps')).toHaveLength(1);
  });

  it('removal ordering: rep → its removal → set writes, in one flush', async () => {
    const order: string[] = [];
    const rpc = jest.fn(async (fn: string) => {
      order.push(fn);
      return { data: 1, error: null, status: 200 };
    });
    const upsert = jest.fn(async () => {
      order.push('vbt_reps');
      return { error: null, status: 201 };
    });
    const p = createRackPersist({ client: { rpc, from: () => ({ upsert }) } as any, orgId: ORG, log: () => {} });
    await p.writeRep(repW('rack-3:tyler:1:1'));
    await p.endSet(setSum());
    await p.removeRep('rack-3:tyler:1:1');
    await p.flush({ force: true });
    expect(order).toEqual(['vbt_reps', 'rack_remove_rep', 'upsert_exercise_log']);
  });

  it('a removal waits while its rep is still queued (never "rep not found")', async () => {
    let repsOnline = false;
    const rpc = jest.fn(async () => ({ data: 1, error: null, status: 200 }));
    const upsert = jest.fn(async () => (repsOnline ? { error: null, status: 201 } : { error: { message: 'offline' }, status: 503 }));
    const p = createRackPersist({ client: { rpc, from: () => ({ upsert }) } as any, orgId: ORG, log: () => {} });
    await p.writeRep(repW('rack-3:tyler:1:1'));
    await p.removeRep('rack-3:tyler:1:1');
    await p.flush({ force: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(JSON.parse(store[REMOVAL_QUEUE_KEY])).toHaveLength(1);
    repsOnline = true;
    await p.flush({ force: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('rack_remove_rep', { p_client_rep_id: 'rack-3:tyler:1:1', p_restore: false });
    expect(await p.pending()).toEqual({ reps: 0, sets: 0, moves: 0 });
  });

  it('a rep held only in memory is dropped by its removal: never sent, no rack_remove_rep', async () => {
    let fail = true;
    const r = rig({
      persist: {
        writeRep: jest.fn(async () => {
          if (fail) throw new Error('disk full');
        }),
        endSet: jest.fn(async () => {}),
        amendSet: jest.fn(async () => {}),
        removeRep: jest.fn(async () => {}),
        flush: jest.fn(async () => {}),
      },
    });
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.idle();
    expect(r.ex.unsavedCount().reps).toBe(1);
    const id = r.ex.getState().live!.reps[0].clientRepId;
    await r.ex.removeRep(id);
    expect(r.ex.unsavedCount().reps).toBe(0);
    expect(r.persist.removeRep).not.toHaveBeenCalled();
    fail = false;
    (r.persist.writeRep as jest.Mock).mockClear();
    await r.ex.flush();
    expect(r.persist.writeRep).not.toHaveBeenCalled();
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

describe('athlete card chip "Wrong athlete? Move last set"', () => {
  it('2 min after the set ended, or until that athlete’s next set starts', () => {
    const r = engineRig();
    zoned(r);
    r.send({ type: 'rep', rep: ovr(0.8) });
    r.send({ type: 'ipadDone' });
    const endedAt = r.s.lastEnded!.endedAtMs!;
    const today = [todayOf('tyler', [], 'Tyler')];
    expect(lastSetMoveOf(r.s, today, endedAt + 10_000)).toEqual({ athleteId: 'tyler', name: 'Tyler', untilMs: endedAt + 120_000 });
    expect(lastSetMoveOf(r.s, today, endedAt + 119_999)).not.toBeNull();
    expect(lastSetMoveOf(r.s, today, endedAt + 120_000)).toBeNull();
    // Tyler's next set starts → gone (well inside the 2 min).
    r.send({ type: 'rep', rep: ovr(0.7) }, 20_000);
    expect(r.s.setState).toBe('lifting');
    expect(lastSetMoveOf(r.s, today, endedAt + 21_000)).toBeNull();
    const v = buildRackView({ state: r.s, today, rackName: 'Rack 3', nowMs: endedAt + 21_000 });
    expect(v.lastSetMove).toBeNull();
  });

  it('sits under the source label and opens the same sheet with the just-ended set', () => {
    const C = read('components/rack/AthleteCard.tsx');
    const src = C.indexOf('<Text style={styles.src}>{view.sourceLine}</Text>');
    const chip = C.indexOf('{view.lastSetMove && onMoveSet && (');
    expect(src).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(src);
    expect(C).toContain('Wrong athlete? Move last set');
    const S = read('screens/rack/RackModeScreen.tsx');
    expect(S).toContain("onMoveSet={() => openMove('after')}");
    expect(S).toContain('const chipUntil = view.lastSetMove?.untilMs ?? null;');
  });
});

describe('phone rep subscription', () => {
  it('only while the exercise screen shows rack / sensor rows, paused in the background', () => {
    const H = read('hooks/useRackPhone.ts');
    expect(H).toContain('const chipsWanted = hasRacks && foreground && !!opts.exerciseOpen && (!!opts.savedRackRows || liveHere);');
    expect(H).toContain("AppState.addEventListener('change', st => setForeground(st === 'active'))");
    expect(H).toContain('if (!chipsWanted) return;');
    const L = read('screens/WorkoutLoggerScreen.tsx');
    expect(L).toContain("const chipsExercise = viewMode === 'exercise' ? activeExerciseId : null;");
    expect(L).toContain('exerciseOpen: chipsExercise,');
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
    expect(S).toContain("executor.moveSet(athleteId, { last: moveFrom.mode === 'after' })");
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

// ---------------------------------------------------------------- fix round 2 (review)

describe('review I2: a mid-set move of an idle-reopened set moves the carried reps too', () => {
  it('queues rack_move_set for the wrong athlete’s reopened set + rack_move_reps for the new reps', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.8) });
    await r.ex.idle();
    r.advance(61_000);
    r.ex.dispatch({ type: 'tick' }); // 60 s idle end → hold
    await r.ex.idle();
    r.advance(10_000);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }); // reopen: set 1 again, rep 1 carried
    await r.ex.idle();
    const live = r.ex.getState().live!;
    expect(live.reps.some(x => x.carried)).toBe(true);
    const fresh = live.reps.filter(x => !x.carried).map(x => x.clientRepId);
    (r.persist.endSet as jest.Mock).mockClear();
    r.calls.length = 0;
    await r.ex.moveSet('jake');
    await r.ex.idle();
    expect(r.persist.moveSet).toHaveBeenCalledTimes(1);
    expect(r.persist.moveSet).toHaveBeenCalledWith(
      { athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', setNumber: 1 },
      { athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 },
    );
    expect(r.persist.moveReps).toHaveBeenCalledWith(fresh, { athleteId: 'jake', workoutInstanceId: 'wi-j', routineExerciseId: 're-j', setNumber: 1 });
    expect((r.persist.endSet as jest.Mock).mock.calls.every(c => c[0].athleteId === 'jake')).toBe(true);
    expect(r.calls).not.toContain('rpc:endSet');
    // The wrong athlete no longer holds that set.
    expect(r.ex.getState().lastEndByAthlete.tyler).toBeUndefined();
    expect(r.ex.getState().completeSets['tyler:wi-1:re-squat'] ?? []).not.toContain(1);
  });
});

describe('review I1: solo set writes carry metric_data_patch.vbt (the server recomputes them)', () => {
  it('a phone-sensor set row has the vbt patch', () => {
    const { setWriteRow } = require('../lib/rack/persist');
    const row = setWriteRow({ ...setSum(), rackId: null, source: 'phone' }, ORG);
    expect(row.metric_data_patch.vbt).toMatchObject({ source: 'phone', rack: null, avg_v: 0.5 });
    expect(read('hooks/useSoloSensor.ts')).toContain('const persist = createRackPersist({');
  });
});

describe('review I3: phones re-read the open exercise when a rack row changes', () => {
  it('a moved-away rack set un-checks; a moved-in one is applied', () => {
    const gone = rackRowsGone({
      completed: [true, true, false],
      inputs: [{ reps: 2, vbt: { avg_v: 0.5 } }, { reps: 3 }, {}],
      rows: [],
      sets: 3,
    });
    expect(gone).toEqual([0]); // set 2 was hand-logged (no vbt): kept
    expect(
      rackRowsGone({ completed: [true], inputs: [{ vbt: {} }], rows: [{ set_number: 1, is_complete: true, metric_data: { vbt: {} } }], sets: 1 }),
    ).toEqual([]);
  });

  it('triggers: rack_sessions realtime, refresh (focus / foreground / pull), my rep UPDATEs — debounced', () => {
    const H = read('hooks/useRackPhone.ts');
    const rt = H.slice(H.indexOf("supabase\n        .channel(uniqueTopic(`rack_session:${rackId}:me`))"));
    expect(rt).toContain('rackChanged();');
    expect(H).toMatch(/await readSessions\(\);[\s\S]*?rackChanged\(\);/);
    expect(H).toContain('() => rackChanged(),');
    expect(H).toContain('cbRef.current.onRackChange?.();');
    expect(H).toContain('RACK_CHANGE_DEBOUNCE_MS');
    expect(H).toContain("AppState.addEventListener('change', s => {\n      if (s === 'active') void refresh();");
    expect(H).toContain('useFocusEffect(');
    const L = read('screens/WorkoutLoggerScreen.tsx');
    expect(L).toContain('onRackChange: () => rackOnChangeRef.current(),');
    expect(L).toContain('const { changes, gone } = rackRowDiff({');
    // The re-read never cancels a draft and never reapplies a whole row to a prescribed set.
    const reread = L.slice(L.indexOf('rackOnChangeRef.current = () => {'), L.indexOf('// N3: left the rack or bumped off it'));
    expect(reread).not.toContain('cancelDraft');
    expect(reread).not.toContain('draftWriter.take');
    expect(reread).not.toContain('draftWriter.setSaved');
    expect(reread).toContain('pending: k => draftWriter.pending(keyOf(k)),');
    expect(reread).toContain('saved: k => draftWriter.savedOf(keyOf(k)),');
    const P = read('lib/rack/phone.ts');
    expect(P).toContain('if (!closed) onUpdate?.(payload.new);');
  });
});

describe('review I4: a phone LB edit newer than the iPad bar weight wins', () => {
  const phoneMid = (load: number, t: number) =>
    row({
      state: 'lifting',
      pending_workout_instance_id: 'wi-1',
      pending_routine_exercise_id: 're-squat',
      pending_set_number: 2,
      pending_load_lb: load,
      updated_at: iso(t),
    });

  it('mid-set step, then a phone LB edit, then set end → the phone’s LB, never the iPad’s', async () => {
    const r = rig({ api: { endSet: jest.fn(async () => row({ set_number: 2, load_lb: 235, queue: [], updated_at: iso(T0 + 90_000) })) } });
    await tylerUpWithJakeToday(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.6) });
    await r.ex.idle();
    r.ex.setBarLoad(225);
    expect(r.ex.barLoad()).toEqual({ lb: 225, next: true });
    r.advance(5_000);
    const live = r.ex.getState().live!;
    r.ex.dispatch({ type: 'sessionSync', row: { ...phoneMid(235, T0 + 50_000), set_started_at: new Date(live.startedAtMs).toISOString() } });
    await r.ex.idle();
    expect(r.ex.barLoad()).toBeNull();
    r.ex.dispatch({ type: 'ipadDone' });
    await r.ex.idle();
    expect(r.api.setIpadContext).not.toHaveBeenCalledWith(RACK, 'tyler', expect.objectContaining({ loadLb: 225 }));
    expect(r.sensor.writeLoad).not.toHaveBeenCalledWith(225);
    r.advance(10_000);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.6) });
    await r.ex.idle();
    expect(r.ex.getState().live!.context.loadLb).toBe(235);
  });

  it('between sets, still unconfirmed: a phone edit wins; the stale pre-step load inside 3 s does not', async () => {
    let release!: () => void;
    const first = new Promise<RackSessionRow>(res => (release = () => res(row({ load_lb: 215, updated_at: iso(T0 + 1) }))));
    let n = 0;
    const r = rig({
      api: {
        setIpadContext: jest.fn(async (_r: string, a: string, c: any) => (n++ === 0 ? first : row({ active_athlete_id: a, load_lb: c.loadLb, updated_at: iso(T0 + 30) }))),
      },
    });
    await tylerUpWithJakeToday(r);
    r.ex.setBarLoad(215);
    // The phone's in-flight context with the old load (205) lands within 3 s: not an edit.
    r.advance(500);
    r.ex.dispatch({ type: 'sessionSync', row: row({ load_lb: 205, updated_at: iso(T0 + 10) }) });
    expect(r.ex.barLoad()).toEqual({ lb: 215, next: false });
    // A real phone edit (230) while the iPad's publish is still in flight: the phone wins.
    r.ex.dispatch({ type: 'sessionSync', row: row({ load_lb: 230, updated_at: iso(T0 + 20) }) });
    expect(r.ex.barLoad()).toBeNull();
    release();
    await r.ex.idle();
    expect(r.ex.getState().barLoad).toBeNull();
  });
});

describe('fix round 3 C1: the set re-read is a diff of rack keys only', () => {
  const vbt1 = { avg_v: 0.5, best_v: 0.6, reps: [{ v: 0.5 }, { v: 0.6 }] };
  const rowOf = (n: number, over: Record<string, any> = {}) => ({
    set_number: n,
    is_complete: true,
    actual_reps: 2,
    actual_weight: 205,
    rpe: 7,
    notes: 'server note',
    metric_data: { vbt: vbt1 },
    ...over,
  });
  const writer = () => createDraftWriter({ persist: () => {}, timers: { setTimeout: () => 1, clearTimeout: () => {} } });

  it('an unchanged row → no change at all', () => {
    const w = writer();
    w.setSaved('re:0', { reps: 2, weight: 205, notes: 'server note', vbt: vbt1 });
    const d = rackRowDiff({
      completed: [true],
      inputs: [{ reps: 2, weight: 205, notes: 'server note', vbt: vbt1 }],
      rows: [rowOf(1)],
      sets: 1,
      saved: k => w.savedOf(`re:${k}`),
      pending: k => w.pending(`re:${k}`),
    });
    expect(d).toEqual({ changes: [], gone: [] });
  });

  it('an edit in flight survives: a pending LB / RPE / notes draft and an unsynced reps edit are never touched or cancelled', () => {
    const w = writer();
    w.setSaved('re:0', { reps: 2, weight: 205, notes: 'server note', vbt: vbt1 });
    w.edit('re:0', 'weight', 215); // typed, debounce pending
    w.edit('re:0', 'notes', 'felt fast');
    // The server row changed its rack keys (a rep removed on the iPad: 1 rep left), and the athlete
    // also changed REPS locally to 3 (in the outbox, not on the server yet).
    const vbt2 = { avg_v: 0.6, best_v: 0.6, reps: [{ v: 0.6 }] };
    const d = rackRowDiff({
      completed: [true],
      inputs: [{ reps: 3, weight: 215, notes: 'felt fast', vbt: vbt1 }],
      rows: [rowOf(1, { actual_reps: 1, metric_data: { vbt: vbt2 } })],
      sets: 1,
      saved: k => w.savedOf(`re:${k}`),
      pending: k => w.pending(`re:${k}`),
    });
    expect(d.changes).toEqual([{ setIndex: 0, kind: 'changed', patch: { vbt: vbt2 } }]);
    expect(d.changes[0].patch).not.toHaveProperty('weight');
    expect(d.changes[0].patch).not.toHaveProperty('notes');
    expect(d.changes[0].patch).not.toHaveProperty('rpe');
    expect(d.changes[0].patch).not.toHaveProperty('reps'); // the athlete's own edit stands
    expect(w.pending('re:0').sort()).toEqual(['notes', 'weight']); // drafts untouched
  });

  it('rack reps follow the server when the phone still shows the old value', () => {
    const w = writer();
    w.setSaved('re:0', { reps: 2, vbt: vbt1 });
    const vbt2 = { avg_v: 0.6, best_v: 0.6, reps: [{ v: 0.6 }] };
    const d = rackRowDiff({
      completed: [true],
      inputs: [{ reps: 2, vbt: vbt1 }],
      rows: [rowOf(1, { actual_reps: 1, metric_data: { vbt: vbt2 } })],
      sets: 1,
      saved: k => w.savedOf(`re:${k}`),
      pending: k => w.pending(`re:${k}`),
    });
    expect(d.changes).toEqual([{ setIndex: 0, kind: 'changed', patch: { vbt: vbt2, reps: 1 } }]);
  });

  it('a moved-in row checks off (rack keys; weight only into an empty cell)', () => {
    const w = writer();
    const d = rackRowDiff({
      completed: [true, false],
      inputs: [{ reps: 2, vbt: vbt1 }, {}],
      rows: [rowOf(1), rowOf(2, { actual_reps: 3 })],
      sets: 2,
      saved: k => (k === 0 ? { reps: 2, vbt: vbt1 } : undefined),
      pending: () => [],
    });
    expect(d.changes).toEqual([{ setIndex: 1, kind: 'in', patch: { vbt: vbt1, reps: 3, weight: 205 } }]);
    // A typed LB on the moved-in set stays the athlete's.
    w.edit('re:1', 'weight', 225);
    const d2 = rackRowDiff({
      completed: [false],
      inputs: [{ weight: 225 }],
      rows: [rowOf(1)],
      sets: 1,
      saved: () => undefined,
      pending: k => w.pending(`re:${k + 1}`),
    });
    expect(d2.changes[0].patch).toEqual({ vbt: vbt1, reps: 2 });
  });

  it('a moved-out row un-checks (gone), a hand-logged one stays', () => {
    const d = rackRowDiff({
      completed: [true, true],
      inputs: [{ reps: 2, vbt: vbt1 }, { reps: 5 }],
      rows: [],
      sets: 2,
      saved: () => undefined,
      pending: () => [],
    });
    expect(d).toEqual({ changes: [], gone: [0] });
  });
});

describe('E2E fix: the phone LB follows the rack’s live load; NEXT SET only after the first rep', () => {
  it('iPad: a bar step before the first rep is the live set’s load (no NEXT SET); after it, NEXT SET', async () => {
    const r = rig();
    await tylerUpWithJakeToday(r);
    r.advance(1_000);
    r.ex.setBarLoad(50);
    await r.ex.idle();
    r.advance(2_000);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.6) });
    await r.ex.idle();
    expect(r.ex.getState().live!.context.loadLb).toBe(50);
    expect(r.ex.barLoad()).toEqual({ lb: 50, next: false });
    r.advance(1_000);
    r.ex.setBarLoad(55);
    expect(r.ex.barLoad()).toEqual({ lb: 55, next: true });
    expect(r.ex.getState().live!.context.loadLb).toBe(50);
  });

  const live = row({ state: 'lifting', workout_instance_id: 'wi-1', routine_exercise_id: 're-squat', set_number: 2, load_lb: 50 });

  it('phone: the live set’s LB cell shows the rack’s value (not the prescription), unless edited < 3 s ago or typing', () => {
    const rackLoad = rackLoadForSet(live, 'tyler', 'wi-1', 're-squat', 1);
    expect(rackLoad).toBe(50);
    expect(rackLoadForSet(live, 'tyler', 'wi-1', 're-squat', 0)).toBeNull(); // another set
    expect(rackLoadForSet(live, 'jake', 'wi-1', 're-squat', 1)).toBeNull(); // not active
    expect(rackLoadForSet({ ...live, workout_instance_id: 'wi-other' }, 'tyler', 'wi-1', 're-squat', 1)).toBeNull();
    // Empty cell (the prescription "90% S1" → 45 was only a placeholder): the rack's 50 goes in.
    expect(rackCellLoad({ rackLoad, phoneLoad: null, lastEditAt: 0, now: T0 })).toBe(50);
    expect(rackCellLoad({ rackLoad, phoneLoad: 45, lastEditAt: 0, now: T0 })).toBe(50);
    expect(rackCellLoad({ rackLoad, phoneLoad: 50, lastEditAt: 0, now: T0 })).toBeNull();
    expect(rackCellLoad({ rackLoad, phoneLoad: 55, lastEditAt: T0 - 2_000, now: T0 })).toBeNull(); // athlete's edit wins
    expect(rackCellLoad({ rackLoad, phoneLoad: 55, lastEditAt: T0 - 3_000, now: T0 })).toBe(50);
    expect(rackCellLoad({ rackLoad, phoneLoad: 45, lastEditAt: 0, now: T0, editing: true })).toBeNull();
    const L = read('screens/WorkoutLoggerScreen.tsx');
    expect(L).toContain("const liveNow = s.state === 'lifting' ? liveRackSet(s, athleteId, workoutInstanceId) : null;");
    expect(L).toContain('rackLoad: rackLoadForSet(s, athleteId, workoutInstanceId, reId, idx),');
  });

  it('phone caption hides a computed weight that differs from the rack’s load', () => {
    expect(captionWithRackLoad('90% of set 1 · 45', 45, 50)).toBe('90% of set 1');
    expect(captionWithRackLoad('90% of set 1 · 41 → 45', 45, 50)).toBe('90% of set 1');
    expect(captionWithRackLoad('90% of set 1 · 50', 50, 50)).toBe('90% of set 1 · 50');
    expect(captionWithRackLoad('90% of set 1 · 45', 45, null)).toBe('90% of set 1 · 45');
    const D = read('screens/exercise-detail-view.tsx');
    expect(D).toContain("if (t && m === 'weight') return captionWithRackLoad(t, resolveTarget(targetArgs(setIndex, m)), rack?.rackLoadFor?.(setIndex) ?? null);");
  });
});
