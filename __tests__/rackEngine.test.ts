import {
  createRackEngine,
  reduce,
  IDLE_END_MS,
  type RackEngineState,
  type RackEvent,
  type RackEffect,
  type RackSessionRow,
} from '../lib/rack/engine';
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
  queue: ['jake', 'cole'],
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

const ovr = (v: number, rom = 20): OvrRep => ({
  concentricS: 0.5,
  romIn: rom,
  meanV: v,
  peakV: v + 0.3,
  meanPowerW: 900,
  peakPowerW: 1800,
});

/** Tiny driver: feeds events, keeps state, collects effects per step. */
function rig(initial?: RackEngineState) {
  let state = initial ?? createRackEngine(RACK);
  let now = T0;
  const all: RackEffect[] = [];
  const send = (e: RackEvent, at?: number): RackEffect[] => {
    if (at !== undefined) now = at;
    const r = reduce(state, e, now);
    state = r.state;
    all.push(...r.effects);
    return r.effects;
  };
  /** A sync whose row is stamped updated_at = the event time (unless given). */
  const sync = (over: Partial<RackSessionRow> = {}, at?: number): RackEffect[] => {
    if (at !== undefined) now = at;
    return send({ type: 'sessionSync', row: row({ updated_at: iso(now), ...over }) });
  };
  return {
    send,
    sync,
    get state() {
      return state;
    },
    all,
  };
}

const types = (fx: RackEffect[]) => fx.map((f) => f.type);
const ofType = <T extends RackEffect['type']>(fx: RackEffect[], t: T) =>
  fx.filter((f): f is Extract<RackEffect, { type: T }> => f.type === t);
const repOf = (fx: RackEffect[]) => ofType(fx, 'writeRep')[0].rep;
const endOf = (fx: RackEffect[]) => ofType(fx, 'endSet')[0].summary;

function withZone(r: ReturnType<typeof rig>) {
  r.send({
    type: 'contextMeta',
    exerciseId: 'ex-squat',
    routineExerciseId: 're-squat',
    zoneMin: 0.45,
    zoneMax: 0.6,
    dropStopPct: 20,
  });
}

describe('rack engine', () => {
  it('first rep starts a set: lifting + rpcStartSet + writeRep', () => {
    const r = rig();
    r.sync();
    const fx = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    expect(types(fx)).toEqual(['rpcStartSet', 'writeRep']);
    expect(r.state.setState).toBe('lifting');
    expect(fx[0]).toEqual({ type: 'rpcStartSet', athleteId: 'tyler', setStartedAt: iso(T0 + 1000) });
    expect(repOf(fx)).toMatchObject({
      athleteId: 'tyler',
      workoutInstanceId: 'wi-1',
      routineExerciseId: 're-squat',
      exerciseId: 'ex-squat',
      setNumber: 1,
      repIndex: 1,
      loadLb: 205,
      isPartial: false,
    });
  });

  it('deterministic clientRepId: equal across replays, distinct across reps and sets', () => {
    const run = () => {
      const r = rig();
      r.sync({ queue: [] });
      const ids = [
        repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000)).clientRepId,
        repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 4000)).clientRepId,
      ];
      r.send({ type: 'ipadDone' }, T0 + 5000);
      ids.push(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 20_000)).clientRepId);
      return ids;
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(new Set(a).size).toBe(3);
  });

  it('no rep without an active athlete', () => {
    const r = rig();
    expect(types(r.send({ type: 'rep', rep: ovr(0.5) }))).toEqual(['droppedRep']);
    r.sync({ active_athlete_id: null, queue: [] });
    const fx = r.send({ type: 'rep', rep: ovr(0.5) });
    expect(fx).toEqual([{ type: 'droppedRep', reason: 'noAthlete', rep: ovr(0.5) }]);
    expect(r.state.setState).toBe('idle');
  });

  it('im up does not interrupt', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    // Cole taps "I'm up" on his phone → server moves him to the queue head.
    const fx = r.sync({ state: 'lifting', set_started_at: iso(T0 + 1000), queue: ['cole', 'jake'] }, T0 + 2000);
    expect(ofType(fx, 'endSet')).toHaveLength(0);
    expect(ofType(fx, 'rpcEndSet')).toHaveLength(0);
    expect(r.state.setState).toBe('lifting');
    expect(r.state.queue).toEqual(['cole', 'jake']);
    const w = repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 4000));
    expect(w.repIndex).toBe(2);
    expect(w.athleteId).toBe('tyler');
  });

  it('double end writes once', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    expect(types(r.send({ type: 'ipadDone' }, T0 + 2000))).toEqual(['endSet', 'rpcEndSet']);
    expect(r.send({ type: 'ipadDone' }, T0 + 2100)).toEqual([]);
    // Phone Done lands while our rpcEndSet is still in flight.
    const late = r.sync({ state: 'lifting', set_started_at: iso(T0 + 1000), pending_end: true }, T0 + 2200);
    expect(ofType(late, 'endSet')).toHaveLength(0);
    expect(ofType(late, 'rpcEndSet')).toHaveLength(0);
    expect(ofType(r.all, 'endSet')).toHaveLength(1);
    expect(ofType(r.all, 'rpcEndSet')).toHaveLength(1);
  });

  it('rpcEndSet emitted after endSet with the athleteId', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    const fx = r.send({ type: 'ipadDone' }, T0 + 2000);
    expect(fx[0].type).toBe('endSet');
    expect(fx[1]).toEqual({ type: 'rpcEndSet', athleteId: 'tyler' });
    expect(endOf(fx)).toMatchObject({
      athleteId: 'tyler',
      workoutInstanceId: 'wi-1',
      routineExerciseId: 're-squat',
      exerciseId: 'ex-squat',
      setNumber: 1,
      loadLb: 205,
      fullReps: 1,
      avgV: 0.5,
      bestV: 0.5,
      dropPct: 0,
      endedBy: 'ipad',
      free: false,
      source: 'rack',
      rackId: RACK,
    });
    expect(r.state.setState).toBe('summary');
  });

  it('pending_end ends set', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    const fx = r.sync({ state: 'lifting', set_started_at: iso(T0 + 1000), pending_end: true }, T0 + 2000);
    expect(types(fx).slice(0, 2)).toEqual(['endSet', 'rpcEndSet']);
    expect(endOf(fx).endedBy).toBe('phone');
  });

  it('leave_requested ends set', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    const fx = r.sync({ state: 'lifting', set_started_at: iso(T0 + 1000), leave_requested: true }, T0 + 2000);
    expect(types(fx).slice(0, 2)).toEqual(['endSet', 'rpcEndSet']);
    expect(endOf(fx).endedBy).toBe('leave');
  });

  it('stale pending_end does not end the next set (I1)', () => {
    const r = rig();
    r.sync({ queue: [] });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    // Phone Done for set 1 ends it.
    const s1 = r.sync({ state: 'lifting', set_started_at: iso(T0 + 1000), pending_end: true }, T0 + 2000);
    expect(endOf(s1).endedBy).toBe('phone');
    // Set 2 starts before rpcEndSet lands.
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 10_000);
    // A sync still carrying set 1's pending_end (newer updated_at) arrives.
    const stale = r.sync(
      { state: 'lifting', set_started_at: iso(T0 + 1000), pending_end: true },
      T0 + 11_000,
    );
    expect(stale).toEqual([]);
    // Same without set_started_at while set 1's rpcEndSet is still in flight.
    expect(r.sync({ state: 'lifting', pending_end: true }, T0 + 11_500)).toEqual([]);
    expect(r.state.setState).toBe('lifting');
    expect(ofType(r.all, 'rpcEndSet')).toHaveLength(1);
    // The real Done for set 2 still works.
    const s2 = r.sync({ state: 'lifting', set_started_at: iso(T0 + 10_000), pending_end: true }, T0 + 12_000);
    expect(endOf(s2).setNumber).toBe(2);
  });

  it('ignores rows older than the last applied one (I3)', () => {
    const r = rig();
    r.sync({}, T0 + 5000);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 6000);
    // An RPC response from earlier (other active athlete) lands late.
    const fx = r.send({
      type: 'sessionSync',
      row: row({ active_athlete_id: 'jake', updated_at: iso(T0 + 1000) }),
    });
    expect(fx).toEqual([]);
    expect(r.state.activeAthleteId).toBe('tyler');
    expect(r.state.setState).toBe('lifting');
  });

  it('pending_end with nothing lifting still releases the rack once', () => {
    const r = rig();
    r.sync();
    expect(r.sync({ state: 'lifting', pending_end: true })).toEqual([
      { type: 'rpcEndSet', athleteId: 'tyler' },
    ]);
    expect(r.sync({ state: 'lifting', pending_end: true })).toEqual([]);
  });

  it('leave_requested while not lifting releases the rack once', () => {
    const r = rig();
    r.sync();
    expect(r.sync({ state: 'lifting', leave_requested: true })).toEqual([
      { type: 'rpcEndSet', athleteId: 'tyler' },
    ]);
    expect(r.sync({ state: 'lifting', leave_requested: true })).toEqual([]);
  });

  it('rpcFailed(endSet) lets the release retry', () => {
    const r = rig();
    r.sync();
    r.sync({ state: 'lifting', pending_end: true });
    r.send({ type: 'rpcFailed', kind: 'endSet', athleteId: 'tyler' });
    expect(r.sync({ state: 'lifting', pending_end: true })).toEqual([
      { type: 'rpcEndSet', athleteId: 'tyler' },
    ]);
  });

  it('select other athlete ends set then rpcSetActive', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    const fx = r.send({ type: 'selectAthlete', athleteId: 'jake' }, T0 + 2000);
    expect(types(fx)).toEqual(['endSet', 'rpcSetActive']);
    expect(endOf(fx).endedBy).toBe('switch');
    expect(fx[1]).toEqual({ type: 'rpcSetActive', athleteId: 'jake' });
    // Engine waits for the server; queue untouched locally.
    expect(r.state.activeAthleteId).toBe('tyler');
    expect(r.state.queue).toEqual(['jake', 'cole']);
    r.sync(
      { active_athlete_id: 'jake', queue: ['cole', 'tyler'], set_number: null, workout_instance_id: null, routine_exercise_id: null, exercise_id: null, load_lb: null },
      T0 + 2500,
    );
    expect(r.state.activeAthleteId).toBe('jake');
    expect(r.state.setState).toBe('idle');
  });

  it('late rep after selectAthlete is credited to the ended athlete', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    r.send({ type: 'selectAthlete', athleteId: 'jake' }, T0 + 2000);
    const fx = r.send({ type: 'rep', rep: ovr(0.45) }, T0 + 3000);
    expect(types(fx)).toEqual(['writeRep', 'amendSet']);
    expect(repOf(fx).athleteId).toBe('tyler');
    expect(ofType(fx, 'amendSet')[0].summary.fullReps).toBe(2);
  });

  it('switch: reps are buffered, then credited to the confirmed athlete (I2)', () => {
    const r = rig();
    r.sync();
    expect(r.send({ type: 'selectAthlete', athleteId: 'tyler' })).toEqual([]);
    expect(r.send({ type: 'selectAthlete', athleteId: 'cole' })).toEqual([
      { type: 'rpcSetActive', athleteId: 'cole' },
    ]);
    // Long offline wait: no timer revert, reps buffered, nothing written yet.
    expect(r.send({ type: 'tick' }, T0 + 10_000)).toEqual([]);
    expect(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 10_000)).toEqual([]);
    expect(r.send({ type: 'rep', rep: ovr(0.52) }, T0 + 11_000)).toEqual([]);
    // An unrelated sync (still Tyler active) does not release the buffer.
    expect(ofType(r.sync({ queue: ['jake', 'cole', 'mason'] }, T0 + 11_500), 'writeRep')).toEqual([]);
    const fx = r.sync({ active_athlete_id: 'cole', queue: ['jake', 'tyler'] }, T0 + 12_000);
    const writes = ofType(fx, 'writeRep');
    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.rep.athleteId)).toEqual(['cole', 'cole']);
    expect(writes[0].rep.receivedAt).toBe(iso(T0 + 10_000));
    expect(ofType(fx, 'rpcStartSet')[0]).toEqual({
      type: 'rpcStartSet',
      athleteId: 'cole',
      setStartedAt: iso(T0 + 10_000),
    });
    expect(ofType(r.all, 'droppedRep')).toEqual([]);
  });

  it('switch refused: buffered reps go to the still-active athlete (I2)', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'selectAthlete', athleteId: 'cole' }, T0 + 1000);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 2000);
    const fx = r.send({ type: 'rpcFailed', kind: 'setActive', athleteId: 'cole' }, T0 + 2500);
    expect(types(fx)).toEqual(['rpcStartSet', 'writeRep']);
    expect(repOf(fx).athleteId).toBe('tyler');
    expect(r.state.switchingTo).toBeNull();
    // Later reps flow normally.
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 3000)).repIndex).toBe(2);
  });

  it('switch buffer resolves on any active change; Cole is never credited to Tyler (N1)', () => {
    const r = rig();
    r.sync({}, T0);
    r.send({ type: 'selectAthlete', athleteId: 'jake' }, T0 + 1000);
    // A newer realtime row (Cole took the rack) is applied first…
    r.sync({ active_athlete_id: 'cole', queue: ['jake', 'tyler'] }, T0 + 3000);
    // …so Jake's confirming row (older updated_at) is dropped.
    expect(
      r.send({ type: 'sessionSync', row: row({ active_athlete_id: 'jake', updated_at: iso(T0 + 2000) }) }),
    ).toEqual([]);
    r.send({ type: 'rpcSettled', kind: 'setActive', athleteId: 'jake' }, T0 + 3500);
    const a = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 8000);
    const b = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 9000);
    expect(repOf(a).athleteId).toBe('cole');
    expect(repOf(b).athleteId).toBe('cole');
    // Five minutes later staff tap Tyler: nothing of Cole's moves to Tyler.
    r.send({ type: 'tick' }, T0 + 300_000);
    r.send({ type: 'selectAthlete', athleteId: 'tyler' }, T0 + 300_000);
    expect(ofType(r.all, 'writeRep').filter((w) => w.rep.athleteId === 'tyler')).toEqual([]);
  });

  it('reps buffered before the server changes the active athlete go to the new active one (N1)', () => {
    const r = rig();
    r.sync({}, T0);
    r.send({ type: 'selectAthlete', athleteId: 'jake' }, T0 + 1000);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 5000);
    const fx = r.sync({ active_athlete_id: 'cole', queue: ['jake', 'tyler'] }, T0 + 6000);
    expect(ofType(fx, 'writeRep').map((w) => w.rep.athleteId)).toEqual(['cole']);
    expect(r.state.switchingTo).toBeNull();
  });

  it('rpcSettled(setActive) without the confirming row keeps buffering', () => {
    const r = rig();
    r.sync({}, T0);
    r.send({ type: 'selectAthlete', athleteId: 'jake' }, T0 + 1000);
    expect(r.send({ type: 'rpcSettled', kind: 'setActive', athleteId: 'jake' })).toEqual([]);
    expect(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 2000)).toEqual([]);
    const fx = r.sync({ active_athlete_id: 'jake', queue: ['cole', 'tyler'] }, T0 + 2500);
    expect(repOf(fx).athleteId).toBe('jake');
  });

  it('a second tile tap flushes the pending buffer to the active athlete first (N1)', () => {
    const r = rig();
    r.sync({}, T0);
    r.send({ type: 'selectAthlete', athleteId: 'jake' }, T0 + 1000);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 5000);
    const fx = r.send({ type: 'selectAthlete', athleteId: 'cole' }, T0 + 6000);
    expect(types(fx)).toEqual(['rpcStartSet', 'writeRep', 'endSet', 'rpcSetActive']);
    expect(repOf(fx).athleteId).toBe('tyler');
    expect(fx[3]).toEqual({ type: 'rpcSetActive', athleteId: 'cole' });
    expect(r.state.switchingTo).toBe('cole');
  });

  it('after a refused tile tap the next set re-starts and phone Done ends it (N2)', () => {
    const r = rig();
    r.sync({}, T0);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    r.sync({ state: 'lifting', set_started_at: iso(T0 + 1000) }, T0 + 1100);
    // Tap Jake → set ends locally as 'switch'; the server refuses (still lifting set 1).
    r.send({ type: 'selectAthlete', athleteId: 'jake' }, T0 + 2000);
    r.send({ type: 'rpcFailed', kind: 'setActive', athleteId: 'jake' }, T0 + 2500);
    // Tyler's next set: rpcStartSet carries its own start despite server 'lifting'.
    const start = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 10_000);
    expect(ofType(start, 'rpcStartSet')).toEqual([
      { type: 'rpcStartSet', athleteId: 'tyler', setStartedAt: iso(T0 + 10_000) },
    ]);
    // rack_start_set took over the stale lift; phone Done carries the new start.
    const done = r.sync(
      { state: 'lifting', set_started_at: iso(T0 + 10_000), pending_end: true },
      T0 + 12_000,
    );
    expect(types(done).slice(0, 2)).toEqual(['endSet', 'rpcEndSet']);
    expect(endOf(done)).toMatchObject({ endedBy: 'phone', setNumber: 2 });
  });

  it('seedHighWater (restart) keeps a lagging phone from overwriting an earlier set', () => {
    const r = rig();
    r.send({ type: 'seedHighWater', athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', setNumber: 2 });
    r.sync({ queue: [], set_number: 2 });
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000)).setNumber).toBe(3);
  });

  it('phone exercise switch applies next set', () => {
    const r = rig();
    withZone(r);
    r.send({
      type: 'contextMeta',
      exerciseId: 'ex-bench',
      routineExerciseId: 're-bench',
      zoneMin: 0.3,
      zoneMax: 0.5,
      dropStopPct: 15,
    });
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    // Phone opens bench mid-set → server stores it as pending.
    r.sync(
      {
        state: 'lifting',
        set_started_at: iso(T0 + 1000),
        pending_workout_instance_id: 'wi-1',
        pending_routine_exercise_id: 're-bench',
        pending_set_number: 1,
        pending_load_lb: 135,
      },
      T0 + 2000,
    );
    const mid = repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 3000));
    expect(mid.routineExerciseId).toBe('re-squat');
    expect(mid.loadLb).toBe(205);
    const end = r.send({ type: 'ipadDone' }, T0 + 4000);
    expect(endOf(end).routineExerciseId).toBe('re-squat');
    // After the set ends the sensor gets the next set's load.
    expect(ofType(end, 'writeLoadToSensor')).toEqual([{ type: 'writeLoadToSensor', lb: 135 }]);
    // Next set (pending context; server's rpcEndSet echo may lag).
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.4) }, T0 + 10_000))).toMatchObject({
      routineExerciseId: 're-bench',
      exerciseId: 'ex-bench',
      setNumber: 1,
      loadLb: 135,
      zone: 'in',
    });
  });

  it('idle 60s ends set, with no timer before the first rep', () => {
    const r = rig();
    r.sync();
    expect(r.send({ type: 'tick' }, T0 + 120_000)).toEqual([]);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 200_000);
    expect(r.send({ type: 'tick' }, T0 + 200_000 + IDLE_END_MS - 1)).toEqual([]);
    const fx = r.send({ type: 'tick' }, T0 + 200_000 + IDLE_END_MS);
    expect(types(fx)).toEqual(['endSet', 'rpcEndSet']);
    expect(endOf(fx).endedBy).toBe('idle');
    expect(r.send({ type: 'tick' }, T0 + 400_000)).toEqual([]);
  });

  it('late rep within 3s attaches; after 3s starts a new set', () => {
    const r = rig();
    r.sync({ queue: [] });
    const first = repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000));
    r.send({ type: 'ipadDone' }, T0 + 2000);
    const late = r.send({ type: 'rep', rep: ovr(0.45) }, T0 + 5000);
    expect(types(late)).toEqual(['writeRep', 'amendSet']);
    const am = ofType(late, 'amendSet')[0];
    expect(am.summary.fullReps).toBe(2);
    expect(am.summary.setNumber).toBe(1);
    expect(am.rep.repIndex).toBe(2);
    expect(am.rep.clientRepId).not.toBe(first.clientRepId);
    expect(r.state.setState).toBe('summary');
    expect(ofType(r.all, 'endSet')).toHaveLength(1);

    // > 3 s after the end → a new set, set_number advanced (phone sent nothing new).
    const fresh = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 5001);
    expect(types(fresh)).toEqual(['rpcStartSet', 'writeRep']);
    expect(repOf(fresh)).toMatchObject({ setNumber: 2, repIndex: 1 });
    expect(r.state.setState).toBe('lifting');
  });

  it('phone context set_number is trusted when it moves ahead', () => {
    const r = rig();
    r.sync({ queue: [] });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    r.send({ type: 'ipadDone' }, T0 + 2000);
    r.sync({ queue: [], set_number: 3 }, T0 + 3000);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 20_000)).setNumber).toBe(3);
  });

  it('a lagging phone set_number never reuses a written set (C1 repro)', () => {
    const r = rig();
    r.sync({ queue: [] });
    // Set 1 (phone said 1).
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    r.send({ type: 'ipadDone' }, T0 + 2000);
    r.sync({ queue: [] }, T0 + 2500);
    // No new context → engine derives set 2.
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 10_000)).setNumber).toBe(2);
    // Phone catches up mid-set: pending set 2.
    r.sync(
      { queue: [], state: 'lifting', set_started_at: iso(T0 + 10_000), pending_workout_instance_id: 'wi-1', pending_routine_exercise_id: 're-squat', pending_set_number: 2, pending_load_lb: 205 },
      T0 + 11_000,
    );
    r.send({ type: 'ipadDone' }, T0 + 12_000);
    // rack_end_set promotes pending 2 to live.
    r.sync({ queue: [], set_number: 2 }, T0 + 12_500);
    const w = repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 20_000));
    expect(w.setNumber).toBe(3);
    const ends = ofType(r.all, 'endSet').map((e) => e.summary.setNumber);
    expect(ends).toEqual([1, 2]);
  });

  it('superset A1 → A2 → A1 keeps A1 numbering (C1)', () => {
    const r = rig();
    const a1 = { queue: [], routine_exercise_id: 're-squat', exercise_id: 'ex-squat' };
    const a2 = { queue: [], routine_exercise_id: 're-jump', exercise_id: 'ex-jump', set_number: 1 };
    r.sync({ ...a1, set_number: 1 }, T0);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    r.send({ type: 'ipadDone' }, T0 + 2000);
    // A1 set 2 derived (phone silent).
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 10_000)).setNumber).toBe(2);
    r.send({ type: 'ipadDone' }, T0 + 11_000);
    // A2 set 1.
    r.sync(a2, T0 + 12_000);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 20_000))).toMatchObject({ routineExerciseId: 're-jump', setNumber: 1 });
    r.send({ type: 'ipadDone' }, T0 + 21_000);
    // Back to A1; the phone only knows about set 2.
    r.sync({ ...a1, set_number: 2 }, T0 + 22_000);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 30_000))).toMatchObject({ routineExerciseId: 're-squat', setNumber: 3 });
  });

  it('a non-free set with a null set_number is numbered from the high-water mark', () => {
    const r = rig();
    r.sync({ queue: [], set_number: null });
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000)).setNumber).toBe(1);
    r.send({ type: 'ipadDone' }, T0 + 2000);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 10_000)).setNumber).toBe(2);
  });

  it('after an idle end the set number is held and reps carry forward', () => {
    const r = rig();
    r.sync({ queue: [] });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0);
    r.send({ type: 'tick' }, T0 + IDLE_END_MS);
    const w = ofType(r.send({ type: 'rep', rep: ovr(0.48) }, T0 + IDLE_END_MS + 10_000), 'writeRep');
    expect(w).toHaveLength(1); // carried rep is not re-written
    expect(w[0].rep).toMatchObject({ setNumber: 1, repIndex: 2 });
    const end = endOf(r.send({ type: 'ipadDone' }, T0 + IDLE_END_MS + 11_000));
    expect(end.setNumber).toBe(1);
    expect(end.fullReps).toBe(2);
  });

  it('idle hold is released when the athlete changes', () => {
    const r = rig();
    r.sync({ queue: [] });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0);
    r.send({ type: 'tick' }, T0 + IDLE_END_MS);
    r.sync({ active_athlete_id: 'jake', queue: ['tyler'] }, T0 + IDLE_END_MS + 100);
    r.sync({ queue: [] }, T0 + IDLE_END_MS + 200);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 200_000))).toMatchObject({ setNumber: 2, repIndex: 1 });
  });

  it('idle hold is released by a new phone context', () => {
    const r = rig();
    r.sync({ queue: [] });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0);
    r.send({ type: 'tick' }, T0 + IDLE_END_MS);
    // Phone opens set 2, then goes back to set 1 (e.g. to look at it).
    r.sync({ queue: [], set_number: 2 }, T0 + IDLE_END_MS + 100);
    r.sync({ queue: [], set_number: 1 }, T0 + IDLE_END_MS + 200);
    const w = repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 200_000));
    expect(w).toMatchObject({ setNumber: 2, repIndex: 1 });
  });

  it('partial reps not counted', () => {
    const r = rig();
    r.sync({ queue: [] });
    // First set: absolute 8 in threshold.
    const p = repOf(r.send({ type: 'rep', rep: ovr(0.9, 6) }, T0));
    expect(p.isPartial).toBe(true);
    expect(p.dropPct).toBeNull();
    r.send({ type: 'rep', rep: ovr(0.5, 20) }, T0 + 1000);
    r.send({ type: 'rep', rep: ovr(0.4, 20) }, T0 + 2000);
    const s1 = endOf(r.send({ type: 'ipadDone' }, T0 + 3000));
    expect(s1.fullReps).toBe(2);
    expect(s1.bestV).toBe(0.5); // partial 0.9 excluded
    expect(s1.avgV).toBe(0.45);
    expect(s1.reps).toHaveLength(3);
    expect(s1.reps[0].partial).toBe(true);
    // Second set: 60% of median ROM (20 in) → 11 in is partial, 13 in is not.
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5, 11) }, T0 + 20_000)).isPartial).toBe(true);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5, 13) }, T0 + 21_000)).isPartial).toBe(false);
  });

  it('free sets keep no ROM history (8 in rule always)', () => {
    const r = rig();
    const free = { queue: [], workout_instance_id: null, routine_exercise_id: null, exercise_id: null, set_number: null };
    r.sync(free);
    r.send({ type: 'rep', rep: ovr(0.5, 30) }, T0);
    r.send({ type: 'ipadDone' }, T0 + 1000);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5, 10) }, T0 + 20_000)).isPartial).toBe(false);
  });

  it('drop cue only with a zone', () => {
    const noZone = rig();
    noZone.sync();
    noZone.send({ type: 'rep', rep: ovr(0.6) }, T0);
    const nz = repOf(noZone.send({ type: 'rep', rep: ovr(0.4) }, T0 + 1000));
    expect(nz.dropPct).toBe(33);
    expect(nz.zone).toBeNull();
    expect(nz.dropCue).toBe(false);

    const z = rig();
    withZone(z);
    z.sync();
    z.send({ type: 'rep', rep: ovr(0.6) }, T0);
    expect(repOf(z.send({ type: 'rep', rep: ovr(0.55) }, T0 + 1000)).dropCue).toBe(false);
    const cue = repOf(z.send({ type: 'rep', rep: ovr(0.48) }, T0 + 2000));
    expect(cue).toMatchObject({ dropPct: 20, dropCue: true, zone: 'in' });
    const s = endOf(z.send({ type: 'ipadDone' }, T0 + 3000));
    expect(s.zone).toEqual([0.45, 0.6]);
    expect(s.dropPct).toBe(20);
  });

  it('late contextMeta fills a set started from a pending context (M4)', () => {
    const r = rig();
    r.sync({ queue: [], workout_instance_id: null, routine_exercise_id: null, exercise_id: null, set_number: null,
      pending_workout_instance_id: 'wi-1', pending_routine_exercise_id: 're-squat', pending_set_number: 1 });
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0)).exerciseId).toBeNull();
    withZone(r);
    const w = repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000));
    expect(w).toMatchObject({ exerciseId: 'ex-squat', zone: 'in' });
  });

  it('free set flag (no workout, or no routine exercise)', () => {
    const r = rig();
    r.sync({ workout_instance_id: null, routine_exercise_id: null, exercise_id: null, set_number: null, load_lb: null });
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0)).workoutInstanceId).toBeNull();
    const s = endOf(r.send({ type: 'ipadDone' }, T0 + 1000));
    expect(s).toMatchObject({ free: true, workoutInstanceId: null, setNumber: null });

    const r2 = rig();
    r2.sync({ routine_exercise_id: null, exercise_id: null });
    r2.send({ type: 'rep', rep: ovr(0.5) }, T0);
    expect(endOf(r2.send({ type: 'ipadDone' }, T0 + 1000)).free).toBe(true);
  });

  it('writes load to the sensor whenever the effective load changes', () => {
    const r = rig();
    expect(r.sync()).toEqual([{ type: 'writeLoadToSensor', lb: 205 }]);
    expect(r.sync({ queue: ['jake'] })).toEqual([]);
    expect(r.sync({ load_lb: 215 })).toEqual([{ type: 'writeLoadToSensor', lb: 215 }]);
    // No phone load → local fallback (plan / last logged weight).
    r.sync({ load_lb: null });
    expect(r.send({ type: 'loadChanged', lb: 185 })).toEqual([{ type: 'writeLoadToSensor', lb: 185 }]);
    // …and the fallback is frozen into the set (M3).
    const w = repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000));
    expect(w.loadLb).toBe(185);
    expect(endOf(r.send({ type: 'ipadDone' }, T0 + 2000)).loadLb).toBe(185);
  });

  it('localContext is used only when the server row has no workout', () => {
    const r = rig();
    const none = { queue: [], workout_instance_id: null, routine_exercise_id: null, exercise_id: null, set_number: null, load_lb: null };
    r.sync(none);
    r.send({
      type: 'localContext',
      athleteId: 'tyler',
      workoutInstanceId: 'wi-1',
      routineExerciseId: 're-bench',
      exerciseId: 'ex-bench',
      setNumber: 1,
      loadLb: 135,
      zoneMin: 0.3,
      zoneMax: 0.5,
      dropStopPct: 15,
    });
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.4) }, T0 + 1000))).toMatchObject({
      routineExerciseId: 're-bench',
      setNumber: 1,
      loadLb: 135,
      zone: 'in',
    });
    expect(endOf(r.send({ type: 'ipadDone' }, T0 + 2000)).free).toBe(false);
    // The phone opens squat → the server context wins.
    r.sync({ queue: [] }, T0 + 3000);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 10_000)).routineExerciseId).toBe('re-squat');
  });

  it('server moving the lifter away mid-set saves the set without an RPC', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.5) }, T0);
    const fx = r.sync({ active_athlete_id: 'jake' }, T0 + 1000);
    expect(types(fx)).toContain('endSet');
    expect(types(fx)).not.toContain('rpcEndSet');
    expect(r.state.setState).toBe('idle');
  });
});

describe('solo (phone-direct) mode', () => {
  const soloCtx = (over: Record<string, unknown> = {}): RackEvent =>
    ({
      type: 'soloContext',
      workoutInstanceId: 'wi-1',
      routineExerciseId: 're-squat',
      exerciseId: 'ex-squat',
      setNumber: 1,
      loadLb: 205,
      zoneMin: 0.45,
      zoneMax: 0.6,
      dropStopPct: 20,
      ...over,
    }) as RackEvent;
  const solo = () => rig(createRackEngine({ mode: 'solo', athleteId: 'tyler' }));
  const banned = ['rpcSetActive', 'rpcEndSet', 'rpcStartSet'];

  it('solo emits no rpc effects', () => {
    const r = solo();
    expect(r.state.activeAthleteId).toBe('tyler');
    expect(r.send(soloCtx())).toEqual([{ type: 'writeLoadToSensor', lb: 205 }]);
    const first = r.send({ type: 'rep', rep: ovr(0.6) }, T0);
    expect(types(first)).toEqual(['writeRep']);
    expect(repOf(first).rackId).toBeNull();
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.48) }, T0 + 1000)).dropCue).toBe(true);
    expect(r.send({ type: 'selectAthlete', athleteId: 'jake' })).toEqual([]);
    expect(r.send({ type: 'sessionSync', row: row({ pending_end: true }) })).toEqual([]);
    const end = r.send({ type: 'done' }, T0 + 2000);
    expect(types(end)).toEqual(['endSet']);
    expect(endOf(end)).toMatchObject({ source: 'phone', rackId: null, endedBy: 'phone', fullReps: 2 });
    expect(r.send({ type: 'done' }, T0 + 2100)).toEqual([]);
    expect(types(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 4000))).toEqual(['writeRep', 'amendSet']);
    const next = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 20_000);
    expect(types(next)).toEqual(['writeRep']);
    expect(repOf(next).setNumber).toBe(2);
    expect(r.all.filter((f) => banned.includes(f.type))).toEqual([]);
  });

  it('solo idle 60s ends set with source phone', () => {
    const r = solo();
    r.send(soloCtx());
    expect(r.send({ type: 'tick' }, T0 + 120_000)).toEqual([]);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 200_000);
    const fx = r.send({ type: 'tick' }, T0 + 200_000 + IDLE_END_MS);
    expect(types(fx)).toEqual(['endSet']);
    expect(endOf(fx)).toMatchObject({ source: 'phone', endedBy: 'idle' });
    expect(r.all.filter((f) => banned.includes(f.type))).toEqual([]);
  });

  it('solo context change mid-set applies next set', () => {
    const r = solo();
    r.send(soloCtx());
    r.send({ type: 'rep', rep: ovr(0.5) }, T0);
    const fx = r.send(soloCtx({ routineExerciseId: 're-bench', exerciseId: 'ex-bench', loadLb: 135 }), T0 + 500);
    expect(ofType(fx, 'writeLoadToSensor')).toEqual([]);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000)).routineExerciseId).toBe('re-squat');
    const end = r.send({ type: 'done' }, T0 + 2000);
    expect(ofType(end, 'writeLoadToSensor')).toEqual([{ type: 'writeLoadToSensor', lb: 135 }]);
    expect(repOf(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 20_000))).toMatchObject({
      routineExerciseId: 're-bench',
      loadLb: 135,
      setNumber: 1,
    });
  });
});
