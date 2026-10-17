import {
  createRackEngine,
  reduce,
  clientRepIdOf,
  IDLE_END_MS,
  type RackEngineState,
  type RackEvent,
  type RackEffect,
  type RackSessionRow,
} from '../lib/rack/engine';
import type { OvrRep } from '../lib/ovr/protocol';

const RACK = 'rack-3';
const T0 = 1_760_000_000_000;

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
  return {
    send,
    get state() {
      return state;
    },
    get now() {
      return now;
    },
    all,
  };
}

const types = (fx: RackEffect[]) => fx.map((f) => f.type);
const ofType = <T extends RackEffect['type']>(fx: RackEffect[], t: T) =>
  fx.filter((f): f is Extract<RackEffect, { type: T }> => f.type === t);

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
  it('first rep starts a set: lifting + sessionPatch + writeRep', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    const fx = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    expect(types(fx)).toEqual(['sessionPatch', 'writeRep']);
    expect(r.state.setState).toBe('lifting');
    expect(ofType(fx, 'sessionPatch')[0].patch).toEqual({
      state: 'lifting',
      set_started_at: new Date(T0 + 1000).toISOString(),
    });
    const w = ofType(fx, 'writeRep')[0].rep;
    expect(w).toMatchObject({
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

  it('deterministic clientRepId', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    const a = ofType(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000), 'writeRep')[0].rep;
    const b = ofType(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 4000), 'writeRep')[0].rep;
    expect(a.clientRepId).toBe(`${RACK}:tyler:${T0 + 1000}:1`);
    expect(b.clientRepId).toBe(clientRepIdOf(RACK, 'tyler', T0 + 1000, 2));

    // Same inputs → same ids (replayable).
    const r2 = rig();
    r2.send({ type: 'sessionSync', row: row() });
    const a2 = ofType(r2.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000), 'writeRep')[0].rep;
    expect(a2.clientRepId).toBe(a.clientRepId);
  });

  it('no rep without an active athlete', () => {
    const r = rig();
    expect(types(r.send({ type: 'rep', rep: ovr(0.5) }))).toEqual(['droppedRep']);
    r.send({ type: 'sessionSync', row: row({ active_athlete_id: null, queue: [] }) });
    const fx = r.send({ type: 'rep', rep: ovr(0.5) });
    expect(fx).toEqual([{ type: 'droppedRep', reason: 'noAthlete', rep: ovr(0.5) }]);
    expect(r.state.setState).toBe('idle');
  });

  it('im up does not interrupt', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    // Cole taps "I'm up" on his phone → server moves him to the queue head.
    const fx = r.send(
      { type: 'sessionSync', row: row({ state: 'lifting', queue: ['cole', 'jake'] }) },
      T0 + 2000,
    );
    expect(ofType(fx, 'endSet')).toHaveLength(0);
    expect(ofType(fx, 'rpcEndSet')).toHaveLength(0);
    expect(r.state.setState).toBe('lifting');
    expect(r.state.queue).toEqual(['cole', 'jake']);
    const w = ofType(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 4000), 'writeRep')[0].rep;
    expect(w.repIndex).toBe(2);
    expect(w.athleteId).toBe('tyler');
  });

  it('double end writes once', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    const first = r.send({ type: 'ipadDone' }, T0 + 2000);
    expect(types(first)).toEqual(['endSet', 'rpcEndSet']);
    expect(r.send({ type: 'ipadDone' }, T0 + 2100)).toEqual([]);
    // Phone Done lands while our rpcEndSet is still in flight.
    const late = r.send(
      { type: 'sessionSync', row: row({ state: 'lifting', pending_end: true }) },
      T0 + 2200,
    );
    expect(ofType(late, 'endSet')).toHaveLength(0);
    expect(ofType(late, 'rpcEndSet')).toHaveLength(0);
    expect(ofType(r.all, 'endSet')).toHaveLength(1);
    expect(ofType(r.all, 'rpcEndSet')).toHaveLength(1);
  });

  it('rpcEndSet emitted after endSet with the athleteId', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    const fx = r.send({ type: 'ipadDone' }, T0 + 2000);
    expect(fx[0].type).toBe('endSet');
    expect(fx[1]).toEqual({ type: 'rpcEndSet', athleteId: 'tyler' });
    const s = ofType(fx, 'endSet')[0].summary;
    expect(s).toMatchObject({
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
    r.send({ type: 'sessionSync', row: row() });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    const fx = r.send(
      { type: 'sessionSync', row: row({ state: 'lifting', pending_end: true }) },
      T0 + 2000,
    );
    expect(types(fx).slice(0, 2)).toEqual(['endSet', 'rpcEndSet']);
    expect(ofType(fx, 'endSet')[0].summary.endedBy).toBe('phone');
  });

  it('leave_requested ends set', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    const fx = r.send(
      { type: 'sessionSync', row: row({ state: 'lifting', leave_requested: true }) },
      T0 + 2000,
    );
    expect(types(fx).slice(0, 2)).toEqual(['endSet', 'rpcEndSet']);
    expect(ofType(fx, 'endSet')[0].summary.endedBy).toBe('leave');
  });

  it('pending_end with nothing lifting still releases the rack once', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    const fx = r.send({ type: 'sessionSync', row: row({ state: 'lifting', pending_end: true }) });
    expect(fx).toEqual([{ type: 'rpcEndSet', athleteId: 'tyler' }]);
    expect(
      r.send({ type: 'sessionSync', row: row({ state: 'lifting', pending_end: true }) }),
    ).toEqual([]);
  });

  it('select other athlete ends set then rpcSetActive', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    const fx = r.send({ type: 'selectAthlete', athleteId: 'jake' }, T0 + 2000);
    expect(types(fx)).toEqual(['endSet', 'rpcSetActive']);
    expect(ofType(fx, 'endSet')[0].summary.endedBy).toBe('switch');
    expect(fx[1]).toEqual({ type: 'rpcSetActive', athleteId: 'jake' });
    // Engine waits for the server; queue untouched locally.
    expect(r.state.activeAthleteId).toBe('tyler');
    expect(r.state.queue).toEqual(['jake', 'cole']);
    // Server confirms.
    r.send(
      { type: 'sessionSync', row: row({ active_athlete_id: 'jake', queue: ['cole', 'tyler'], set_number: null, workout_instance_id: null, routine_exercise_id: null, exercise_id: null, load_lb: null }) },
      T0 + 2500,
    );
    expect(r.state.activeAthleteId).toBe('jake');
    expect(r.state.setState).toBe('idle');
  });

  it('select while idle only emits rpcSetActive; same athlete is a no-op', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    expect(r.send({ type: 'selectAthlete', athleteId: 'tyler' })).toEqual([]);
    expect(r.send({ type: 'selectAthlete', athleteId: 'cole' })).toEqual([
      { type: 'rpcSetActive', athleteId: 'cole' },
    ]);
    // Rep while the switch is in flight (and not a late rep) is not misattributed.
    expect(types(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 10_000))).toEqual(['droppedRep']);
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
    r.send({ type: 'sessionSync', row: row() });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    // Phone opens bench mid-set → server stores it as pending.
    r.send(
      {
        type: 'sessionSync',
        row: row({
          state: 'lifting',
          pending_workout_instance_id: 'wi-1',
          pending_routine_exercise_id: 're-bench',
          pending_set_number: 1,
          pending_load_lb: 135,
        }),
      },
      T0 + 2000,
    );
    const mid = ofType(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 3000), 'writeRep')[0].rep;
    expect(mid.routineExerciseId).toBe('re-squat');
    expect(mid.loadLb).toBe(205);
    const end = r.send({ type: 'ipadDone' }, T0 + 4000);
    expect(ofType(end, 'endSet')[0].summary.routineExerciseId).toBe('re-squat');
    // After the set ends the sensor gets the next set's load.
    expect(ofType(end, 'writeLoadToSensor')).toEqual([{ type: 'writeLoadToSensor', lb: 135 }]);
    // Next set (pending context; server's rpcEndSet echo may lag).
    const next = r.send({ type: 'rep', rep: ovr(0.4) }, T0 + 10_000);
    const w = ofType(next, 'writeRep')[0].rep;
    expect(w).toMatchObject({
      routineExerciseId: 're-bench',
      exerciseId: 'ex-bench',
      setNumber: 1,
      loadLb: 135,
      zone: 'in',
    });
  });

  it('idle 60s ends set, with no timer before the first rep', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    expect(r.send({ type: 'tick' }, T0 + 120_000)).toEqual([]);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 200_000);
    expect(r.send({ type: 'tick' }, T0 + 200_000 + IDLE_END_MS - 1)).toEqual([]);
    const fx = r.send({ type: 'tick' }, T0 + 200_000 + IDLE_END_MS);
    expect(types(fx)).toEqual(['endSet', 'rpcEndSet']);
    expect(ofType(fx, 'endSet')[0].summary.endedBy).toBe('idle');
    expect(r.send({ type: 'tick' }, T0 + 400_000)).toEqual([]);
  });

  it('late rep within 3s attaches; after 3s starts a new set', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row({ queue: [] }) });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    r.send({ type: 'ipadDone' }, T0 + 2000);
    const late = r.send({ type: 'rep', rep: ovr(0.45) }, T0 + 5000);
    expect(types(late)).toEqual(['writeRep', 'amendSet']);
    const am = ofType(late, 'amendSet')[0];
    expect(am.summary.fullReps).toBe(2);
    expect(am.summary.setNumber).toBe(1);
    expect(am.rep.clientRepId).toBe(`${RACK}:tyler:${T0 + 1000}:2`);
    expect(r.state.setState).toBe('summary');
    expect(ofType(r.all, 'endSet')).toHaveLength(1);

    // > 3 s after the end → a new set, set_number advanced (phone sent nothing new).
    const fresh = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 5001);
    expect(types(fresh)).toEqual(['sessionPatch', 'writeRep']);
    const w = ofType(fresh, 'writeRep')[0].rep;
    expect(w.setNumber).toBe(2);
    expect(w.repIndex).toBe(1);
    expect(r.state.setState).toBe('lifting');
  });

  it('phone context set_number is trusted when it changes', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row({ queue: [] }) });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000);
    r.send({ type: 'ipadDone' }, T0 + 2000);
    r.send({ type: 'sessionSync', row: row({ queue: [], set_number: 2 }) }, T0 + 3000);
    const w = ofType(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 20_000), 'writeRep')[0].rep;
    expect(w.setNumber).toBe(2);
  });

  it('after an idle end the set number is held and reps carry forward', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row({ queue: [] }) });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0);
    r.send({ type: 'tick' }, T0 + IDLE_END_MS);
    const fx = r.send({ type: 'rep', rep: ovr(0.48) }, T0 + IDLE_END_MS + 10_000);
    const w = ofType(fx, 'writeRep');
    expect(w).toHaveLength(1); // carried rep is not re-written
    expect(w[0].rep.setNumber).toBe(1);
    expect(w[0].rep.repIndex).toBe(2);
    const end = ofType(r.send({ type: 'ipadDone' }, T0 + IDLE_END_MS + 11_000), 'endSet')[0];
    expect(end.summary.setNumber).toBe(1);
    expect(end.summary.fullReps).toBe(2);
  });

  it('idle hold is released when the athlete changes', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row({ queue: [] }) });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0);
    r.send({ type: 'tick' }, T0 + IDLE_END_MS);
    r.send({ type: 'sessionSync', row: row({ active_athlete_id: 'jake', queue: ['tyler'] }) });
    r.send({ type: 'sessionSync', row: row({ queue: [] }) });
    const w = ofType(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 200_000), 'writeRep')[0].rep;
    expect(w.setNumber).toBe(2);
    expect(w.repIndex).toBe(1);
  });

  it('partial reps not counted', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row({ queue: [] }) });
    // First set: absolute 8 in threshold.
    const p = ofType(r.send({ type: 'rep', rep: ovr(0.9, 6) }, T0), 'writeRep')[0].rep;
    expect(p.isPartial).toBe(true);
    expect(p.dropPct).toBeNull();
    r.send({ type: 'rep', rep: ovr(0.5, 20) }, T0 + 1000);
    r.send({ type: 'rep', rep: ovr(0.4, 20) }, T0 + 2000);
    const s1 = ofType(r.send({ type: 'ipadDone' }, T0 + 3000), 'endSet')[0].summary;
    expect(s1.fullReps).toBe(2);
    expect(s1.bestV).toBe(0.5); // partial 0.9 excluded
    expect(s1.avgV).toBe(0.45);
    expect(s1.reps).toHaveLength(3);
    expect(s1.reps[0].partial).toBe(true);
    // Second set: 60% of median ROM (20 in) → 11 in is partial, 13 in is not.
    const a = ofType(r.send({ type: 'rep', rep: ovr(0.5, 11) }, T0 + 20_000), 'writeRep')[0].rep;
    const b = ofType(r.send({ type: 'rep', rep: ovr(0.5, 13) }, T0 + 21_000), 'writeRep')[0].rep;
    expect(a.isPartial).toBe(true);
    expect(b.isPartial).toBe(false);
  });

  it('drop cue only with a zone', () => {
    const noZone = rig();
    noZone.send({ type: 'sessionSync', row: row() });
    noZone.send({ type: 'rep', rep: ovr(0.6) }, T0);
    const nz = ofType(noZone.send({ type: 'rep', rep: ovr(0.4) }, T0 + 1000), 'writeRep')[0].rep;
    expect(nz.dropPct).toBe(33);
    expect(nz.zone).toBeNull();
    expect(nz.dropCue).toBe(false);

    const z = rig();
    withZone(z);
    z.send({ type: 'sessionSync', row: row() });
    z.send({ type: 'rep', rep: ovr(0.6) }, T0);
    const ok = ofType(z.send({ type: 'rep', rep: ovr(0.55) }, T0 + 1000), 'writeRep')[0].rep;
    expect(ok.dropCue).toBe(false);
    const cue = ofType(z.send({ type: 'rep', rep: ovr(0.48) }, T0 + 2000), 'writeRep')[0].rep;
    expect(cue.dropPct).toBe(20);
    expect(cue.dropCue).toBe(true);
    expect(cue.zone).toBe('in');
    const s = ofType(z.send({ type: 'ipadDone' }, T0 + 3000), 'endSet')[0].summary;
    expect(s.zone).toEqual([0.45, 0.6]);
    expect(s.dropPct).toBe(20);
  });

  it('free set flag', () => {
    const r = rig();
    r.send({
      type: 'sessionSync',
      row: row({
        workout_instance_id: null,
        routine_exercise_id: null,
        exercise_id: null,
        set_number: null,
        load_lb: null,
      }),
    });
    const w = ofType(r.send({ type: 'rep', rep: ovr(0.5) }, T0), 'writeRep')[0].rep;
    expect(w.workoutInstanceId).toBeNull();
    const s = ofType(r.send({ type: 'ipadDone' }, T0 + 1000), 'endSet')[0].summary;
    expect(s.free).toBe(true);
    expect(s.workoutInstanceId).toBeNull();
    expect(s.setNumber).toBeNull();
  });

  it('writes load to the sensor whenever the effective load changes', () => {
    const r = rig();
    expect(r.send({ type: 'sessionSync', row: row() })).toEqual([
      { type: 'writeLoadToSensor', lb: 205 },
    ]);
    expect(r.send({ type: 'sessionSync', row: row({ queue: ['jake'] }) })).toEqual([]);
    expect(r.send({ type: 'sessionSync', row: row({ load_lb: 215 }) })).toEqual([
      { type: 'writeLoadToSensor', lb: 215 },
    ]);
    // No phone load → local fallback (plan / last logged weight).
    r.send({ type: 'sessionSync', row: row({ load_lb: null }) });
    expect(r.send({ type: 'loadChanged', lb: 185 })).toEqual([
      { type: 'writeLoadToSensor', lb: 185 },
    ]);
  });

  it('server moving the lifter away mid-set saves the set without an RPC', () => {
    const r = rig();
    r.send({ type: 'sessionSync', row: row() });
    r.send({ type: 'rep', rep: ovr(0.5) }, T0);
    const fx = r.send({ type: 'sessionSync', row: row({ active_athlete_id: 'jake' }) }, T0 + 1000);
    expect(types(fx)).toContain('endSet');
    expect(types(fx)).not.toContain('rpcEndSet');
    expect(r.state.setState).toBe('idle');
  });
});

describe('solo (phone-direct) mode', () => {
  const soloCtx = (over: Record<string, unknown> = {}): RackEvent => ({
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
  } as RackEvent);
  const solo = () => rig(createRackEngine({ mode: 'solo', athleteId: 'tyler' }));

  it('solo emits no rpc effects', () => {
    const r = solo();
    expect(r.state.activeAthleteId).toBe('tyler');
    expect(r.send(soloCtx())).toEqual([{ type: 'writeLoadToSensor', lb: 205 }]);
    const first = r.send({ type: 'rep', rep: ovr(0.6) }, T0);
    expect(types(first)).toEqual(['writeRep']);
    const w = ofType(first, 'writeRep')[0].rep;
    expect(w.rackId).toBeNull();
    expect(w.clientRepId).toBe(`solo:tyler:${T0}:1`);
    const cue = ofType(r.send({ type: 'rep', rep: ovr(0.48) }, T0 + 1000), 'writeRep')[0].rep;
    expect(cue.dropCue).toBe(true);
    expect(r.send({ type: 'selectAthlete', athleteId: 'jake' })).toEqual([]);
    expect(r.send({ type: 'sessionSync', row: row({ pending_end: true }) })).toEqual([]);
    const end = r.send({ type: 'done' }, T0 + 2000);
    expect(types(end)).toEqual(['endSet']);
    expect(ofType(end, 'endSet')[0].summary).toMatchObject({
      source: 'phone',
      rackId: null,
      endedBy: 'phone',
      fullReps: 2,
    });
    expect(r.send({ type: 'done' }, T0 + 2100)).toEqual([]);
    const late = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 4000);
    expect(types(late)).toEqual(['writeRep', 'amendSet']);
    const next = r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 20_000);
    expect(types(next)).toEqual(['writeRep']);
    expect(ofType(next, 'writeRep')[0].rep.setNumber).toBe(2);
    const banned = ['rpcSetActive', 'rpcEndSet', 'sessionPatch'];
    expect(r.all.filter((f) => banned.includes(f.type))).toEqual([]);
  });

  it('solo idle 60s ends set with source phone', () => {
    const r = solo();
    r.send(soloCtx());
    expect(r.send({ type: 'tick' }, T0 + 120_000)).toEqual([]);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 200_000);
    const fx = r.send({ type: 'tick' }, T0 + 200_000 + IDLE_END_MS);
    expect(types(fx)).toEqual(['endSet']);
    expect(ofType(fx, 'endSet')[0].summary).toMatchObject({ source: 'phone', endedBy: 'idle' });
  });

  it('solo context change mid-set applies next set', () => {
    const r = solo();
    r.send(soloCtx());
    r.send({ type: 'rep', rep: ovr(0.5) }, T0);
    const fx = r.send(soloCtx({ routineExerciseId: 're-bench', exerciseId: 'ex-bench', loadLb: 135 }), T0 + 500);
    expect(ofType(fx, 'writeLoadToSensor')).toEqual([]);
    const mid = ofType(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 1000), 'writeRep')[0].rep;
    expect(mid.routineExerciseId).toBe('re-squat');
    const end = r.send({ type: 'done' }, T0 + 2000);
    expect(ofType(end, 'writeLoadToSensor')).toEqual([{ type: 'writeLoadToSensor', lb: 135 }]);
    const nxt = ofType(r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 20_000), 'writeRep')[0].rep;
    expect(nxt).toMatchObject({ routineExerciseId: 're-bench', loadLb: 135, setNumber: 1 });
  });
});
