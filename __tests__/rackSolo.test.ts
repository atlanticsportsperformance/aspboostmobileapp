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
import { createRackPersist, RACK_PERSIST_KEYS } from '../lib/rack/persist';
import type { RackEvent, SetSummary } from '../lib/rack/engine';
import type { OvrRep } from '../lib/ovr/protocol';
import {
  SENSOR_BUSY_TEXT,
  SOLO_OVR_NAME_KEY,
  SOLO_PERSIST_KEYS,
  SOLO_RACK_SENSORS_KEY,
  createSoloSession,
  onAnyRack,
  rackSensorNames,
  readRackSensors,
  saveRackSensors,
  soloPersistKeys,
  soloScanTarget,
  isSensorBusy,
  mustDropSensor,
  readSoloOvrName,
  saveSoloOvrName,
  showConnectSensor,
  soloChips,
  soloLiveSet,
  soloSavedLog,
} from '../lib/rack/solo';

const ORG = 'org-1';
const T0 = 1_760_000_000_000;
const ovr = (v: number, rom = 20): OvrRep => ({
  concentricS: 0.5,
  romIn: rom,
  meanV: v,
  peakV: v + 0.3,
  meanPowerW: 900,
  peakPowerW: 1800,
});
const ctx = (over: Record<string, unknown> = {}): RackEvent =>
  ({
    type: 'soloContext',
    workoutInstanceId: 'wi-1',
    routineExerciseId: 're-squat',
    exerciseId: 'ex-squat',
    setNumber: 1,
    loadLb: 205,
    zoneMin: 0.45,
    zoneMax: 0.9,
    dropStopPct: 20,
    ...over,
  }) as RackEvent;

function mockClient() {
  const upsert = jest.fn(async (_rows: any[], _o: any) => ({ error: null, status: 201 }));
  const rpc = jest.fn(async (_fn: string, _args: any) => ({ data: 'log-id', error: null, status: 200 }));
  const from = jest.fn((_t: string) => ({ upsert }));
  return { client: { rpc, from } as any, rpc, upsert, from };
}

function rig() {
  const m = mockClient();
  const persist = createRackPersist({ client: m.client, orgId: ORG, keys: SOLO_PERSIST_KEYS, log: () => {} });
  const calls: string[] = [];
  const spy = {
    writeRep: jest.fn((r: any) => (calls.push('writeRep'), persist.writeRep(r))),
    endSet: jest.fn((s: SetSummary) => (calls.push('endSet'), persist.endSet(s))),
    amendSet: jest.fn((s: SetSummary) => (calls.push('amendSet'), persist.amendSet(s))),
    flush: jest.fn(() => persist.flush()),
  };
  const writeLoad = jest.fn(async (_lb: number) => {});
  const logs: unknown[][] = [];
  const session = createSoloSession({
    athleteId: 'tyler',
    persist: spy,
    sensor: { writeLoad },
    log: (...a) => logs.push(a),
  });
  const saved: SetSummary[] = [];
  session.onSetSaved(s => saved.push(s));
  return { m, persist, spy, calls, writeLoad, session, saved, logs };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('solo session (phone-direct sensor)', () => {
  it('runs the engine in solo mode: reps + set row queued, load to the sensor, NO rpc effects', async () => {
    const r = rig();
    r.session.dispatch(ctx(), T0);
    r.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 100);
    r.session.dispatch({ type: 'rep', rep: ovr(0.65) }, T0 + 2000);
    // rack-only events are ignored in solo
    r.session.dispatch({ type: 'selectAthlete', athleteId: 'jake' }, T0 + 2100);
    r.session.dispatch({ type: 'done' }, T0 + 3000);
    await r.session.idle();
    expect(r.writeLoad).toHaveBeenCalledWith(205);
    expect(r.calls).toEqual(['writeRep', 'writeRep', 'endSet']);
    expect(r.saved).toHaveLength(1);
    expect(r.saved[0]).toMatchObject({ source: 'phone', rackId: null, endedBy: 'phone', fullReps: 2, setNumber: 1, loadLb: 205 });
    // nothing was ignored: no rpc* effect ever reached the executor
    expect(r.logs.filter(l => String(l[0]).includes('ignored effect'))).toEqual([]);
  });

  it('set row carries source phone and sends only metric_data_patch (never metric_data); reps have rack_id null', async () => {
    const r = rig();
    r.session.dispatch(ctx(), T0);
    r.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 100);
    r.session.dispatch({ type: 'rep', rep: ovr(0.6) }, T0 + 2000);
    r.session.dispatch({ type: 'done' }, T0 + 3000);
    await r.session.idle();
    await r.persist.flush({ force: true });

    expect(r.m.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = r.m.rpc.mock.calls[0];
    expect(fn).toBe('upsert_exercise_log');
    const row = args.p_row;
    expect(row).not.toHaveProperty('metric_data');
    expect(row).toMatchObject({
      workout_instance_id: 'wi-1',
      routine_exercise_id: 're-squat',
      exercise_id: 'ex-squat',
      set_number: 1,
      actual_reps: 2,
      actual_weight: 205,
      is_complete: true,
    });
    expect(row.metric_data_patch.vbt).toMatchObject({ source: 'phone', rack: null, ended_by: 'phone', avg_v: 0.65, best_v: 0.7 });

    const reps = r.m.upsert.mock.calls.flatMap(c => c[0]);
    expect(r.m.from).toHaveBeenCalledWith('vbt_reps');
    expect(reps).toHaveLength(2);
    for (const rep of reps) expect(rep).toMatchObject({ rack_id: null, athlete_id: 'tyler', org_id: ORG });
    expect(new Set(reps.map((x: any) => x.client_rep_id)).size).toBe(2);
    expect(r.m.upsert.mock.calls[0][1]).toEqual({ onConflict: 'client_rep_id', ignoreDuplicates: true });
  });

  it('the solo queues use their own keys (per athlete), never the rack iPad’s', async () => {
    const keys = Object.values(soloPersistKeys('tyler'));
    for (const k of Object.values(RACK_PERSIST_KEYS)) expect(keys).not.toContain(k);
    expect(soloPersistKeys('tyler').reps).toBe('solo_vbt_reps_v1:tyler');
    expect(soloPersistKeys('jake').reps).not.toBe(soloPersistKeys('tyler').reps); // M1

    const m = mockClient();
    m.upsert.mockImplementation(async () => ({ error: { message: 'offline' }, status: 503 } as any));
    const persist = createRackPersist({ client: m.client, orgId: ORG, keys: soloPersistKeys('tyler'), log: () => {} });
    const r = createSoloSession({ athleteId: 'tyler', persist, sensor: { writeLoad: async () => {} }, log: () => {} });
    r.dispatch(ctx(), T0);
    r.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 100);
    await r.idle();
    expect(store[soloPersistKeys('tyler').reps]).toBeDefined();
    expect(JSON.parse(store[soloPersistKeys('tyler').reps])).toHaveLength(1);
    expect(store[SOLO_PERSIST_KEYS.reps]).toBeUndefined();
    expect(store[RACK_PERSIST_KEYS.reps]).toBeUndefined();
  });

  it('I4: 60 s idle end; the phone moving to the next set releases the hold (as rack-with-phone)', async () => {
    const r = rig();
    r.session.dispatch(ctx(), T0);
    r.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0);
    r.session.dispatch({ type: 'tick' }, T0 + 60_000);
    await r.session.idle();
    expect(r.saved[0]).toMatchObject({ endedBy: 'idle', setNumber: 1, fullReps: 1 });
    // the phone fills set 1 in and opens set 2 → no reopen, even 20 s later
    r.session.dispatch(ctx({ setNumber: 2 }), T0 + 61_000);
    r.session.dispatch({ type: 'rep', rep: ovr(0.68) }, T0 + 80_000);
    r.session.dispatch({ type: 'done' }, T0 + 82_000);
    await r.session.idle();
    expect(r.saved[1]).toMatchObject({ setNumber: 2, fullReps: 1 });
  });

  it('I4: the 30 s reopen window while the phone stays on the set; past it → a new set', async () => {
    const r = rig();
    r.session.dispatch(ctx(), T0);
    r.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0);
    r.session.dispatch({ type: 'tick' }, T0 + 60_000);
    r.session.dispatch({ type: 'rep', rep: ovr(0.68) }, T0 + 80_000); // 20 s after the idle end
    r.session.dispatch({ type: 'done' }, T0 + 82_000);
    await r.session.idle();
    expect(r.saved[1]).toMatchObject({ setNumber: 1, fullReps: 2 });
    const r2 = rig();
    r2.session.dispatch(ctx(), T0);
    r2.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0);
    r2.session.dispatch({ type: 'tick' }, T0 + 60_000);
    r2.session.dispatch({ type: 'rep', rep: ovr(0.68) }, T0 + 60_000 + 31_000);
    r2.session.dispatch({ type: 'done' }, T0 + 95_000);
    await r2.session.idle();
    expect(r2.saved[1]).toMatchObject({ setNumber: 2, fullReps: 1 });
  });

  it('I2: a same-set LB change while lifting is that set’s load (row + sensor); another set’s is not', async () => {
    const r = rig();
    r.session.dispatch(ctx({ loadLb: null }), T0);
    r.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 100);
    r.session.dispatch(ctx({ loadLb: 225 }), T0 + 5000); // typed after racking the bar
    r.session.dispatch({ type: 'done' }, T0 + 6000);
    await r.session.idle();
    expect(r.saved[0]).toMatchObject({ setNumber: 1, loadLb: 225 });
    expect(r.writeLoad).toHaveBeenCalledWith(225);
    // set 2 is lifted; a context for set 3 mid-set does not change set 2's load
    r.session.dispatch(ctx({ setNumber: 2, loadLb: 225 }), T0 + 20_000);
    r.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 21_000);
    r.session.dispatch(ctx({ setNumber: 3, loadLb: 245 }), T0 + 22_000);
    r.session.dispatch({ type: 'done' }, T0 + 23_000);
    await r.session.idle();
    expect(r.saved[1]).toMatchObject({ setNumber: 2, loadLb: 225 });
  });

  it('I1: no own LB → no actual_weight and load_lb null (the prescription never becomes the load)', async () => {
    const r = rig();
    r.session.dispatch(ctx({ loadLb: null }), T0);
    r.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 100);
    r.session.dispatch({ type: 'done' }, T0 + 1000);
    await r.session.idle();
    await r.persist.flush({ force: true });
    expect(r.m.rpc.mock.calls[0][1].p_row).not.toHaveProperty('actual_weight');
    expect(r.m.upsert.mock.calls[0][0][0].load_lb).toBeNull();
    expect(r.writeLoad).not.toHaveBeenCalled();
  });

  it('C1: at a set start the rack check runs; on a rack → no set, reps dropped, onRack (disconnect)', async () => {
    let answer!: (v: boolean) => void;
    const onRack = jest.fn();
    const persist = { writeRep: jest.fn(async () => {}), endSet: jest.fn(async () => {}), amendSet: jest.fn(async () => {}), flush: jest.fn(async () => {}) };
    const s = createSoloSession({
      athleteId: 'tyler', persist, sensor: { writeLoad: async () => {} }, log: () => {},
      checkRack: () => new Promise<boolean>(res => (answer = res)), onRack,
    });
    s.dispatch(ctx(), T0);
    s.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 100);
    s.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 1100);
    expect(s.checking()).toBe(true);
    expect(s.getState().setState).not.toBe('lifting');
    answer(true);
    await new Promise(res => setTimeout(res, 0));
    await s.idle();
    expect(onRack).toHaveBeenCalledTimes(1);
    expect(s.getState().setState).not.toBe('lifting');
    expect(persist.writeRep).not.toHaveBeenCalled();
  });

  it('C1: not on a rack → the held reps start the set in order, with their own times; a timeout lets it start', async () => {
    const persist = { writeRep: jest.fn(async () => {}), endSet: jest.fn(async () => {}), amendSet: jest.fn(async () => {}), flush: jest.fn(async () => {}) };
    const s = createSoloSession({
      athleteId: 'tyler', persist, sensor: { writeLoad: async () => {} }, log: () => {},
      checkRack: async () => false,
    });
    s.dispatch(ctx(), T0);
    s.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 100);
    s.dispatch({ type: 'rep', rep: ovr(0.6) }, T0 + 1100);
    await new Promise(res => setTimeout(res, 0));
    await s.idle();
    expect(s.getState().live?.reps.map(x => [x.v, x.receivedAtMs])).toEqual([[0.7, T0 + 100], [0.6, T0 + 1100]]);
    // a check that never answers: the set starts after the cap
    jest.useFakeTimers();
    try {
      const s2 = createSoloSession({
        athleteId: 'tyler', persist, sensor: { writeLoad: async () => {} }, log: () => {},
        checkRack: () => new Promise<boolean>(() => {}), checkTimeoutMs: 2000,
      });
      s2.dispatch(ctx(), T0);
      s2.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 100);
      expect(s2.getState().setState).not.toBe('lifting');
      await jest.advanceTimersByTimeAsync(2000);
      expect(s2.getState().setState).toBe('lifting');
    } finally {
      jest.useRealTimers();
    }
  });

  it('live view: chips + live set for this workout only', () => {
    const r = rig();
    r.session.dispatch(ctx(), T0);
    r.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0);
    r.session.dispatch({ type: 'rep', rep: ovr(0.3, 4) }, T0 + 1000);
    const live = soloLiveSet(r.session.getState(), 'wi-1');
    expect(live).toMatchObject({ routineExerciseId: 're-squat', setNumber: 1 });
    const chips = soloChips(live!.set);
    expect(chips.map(c => [c.repIndex, c.v, c.partial, c.loadLb])).toEqual([
      [1, 0.7, false, 205],
      [2, 0.3, true, 205],
    ]);
    expect(soloLiveSet(r.session.getState(), 'wi-other')).toBeNull();
  });

  it('soloSavedLog: the logger fills the row like a rack-written one', () => {
    const s: SetSummary = {
      rackId: null, source: 'phone', athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat',
      exerciseId: 'ex-squat', setNumber: 3, loadLb: null, setStartedAt: 'x', reps: [], fullReps: 4, avgV: 0.6,
      bestV: 0.7, dropPct: 5, zone: null, endedBy: 'idle', free: false,
    };
    const log = soloSavedLog(s)!;
    expect(log).toMatchObject({ set_number: 3, actual_reps: 4, is_complete: true });
    expect(log).not.toHaveProperty('actual_weight'); // unknown load leaves the phone's LB
    expect(log.metric_data.vbt).toMatchObject({ source: 'phone', ended_by: 'idle' });
    expect(soloSavedLog({ ...s, free: true })).toBeNull();
  });
});

describe('solo view rules', () => {
  it('"Connect sensor" is hidden on a rack (active or queued) and for someone else’s workout', () => {
    expect(showConnectSensor({ isSelf: true, onRack: false, hasExercise: true })).toBe(true);
    expect(showConnectSensor({ isSelf: true, onRack: true, hasExercise: true })).toBe(false);
    expect(showConnectSensor({ isSelf: false, onRack: false, hasExercise: true })).toBe(false);
    expect(showConnectSensor({ isSelf: true, onRack: false, hasExercise: false })).toBe(false);
  });

  it('joining a rack drops the phone sensor', () => {
    expect(mustDropSensor({ onRack: true, sensorOn: true })).toBe(true);
    expect(mustDropSensor({ onRack: false, sensorOn: true })).toBe(false);
    expect(mustDropSensor({ onRack: true, sensorOn: false })).toBe(false);
  });

  it('"Sensor busy (on a rack?)" only after the scan timed out', () => {
    const timeout = 'No OVR sensor found — make sure it is on and not connected to another device.';
    expect(isSensorBusy('reconnecting', timeout)).toBe(true);
    expect(isSensorBusy('scanning', undefined)).toBe(false);
    expect(isSensorBusy('reconnecting', 'Bluetooth is off. Turn it on and try again.')).toBe(false);
    expect(isSensorBusy('connected', undefined)).toBe(false);
    expect(SENSOR_BUSY_TEXT).toBe('Sensor busy (on a rack?)');
  });

  it('C1: the solo scan never targets a rack sensor; the remembered one only if it is not a rack’s', async () => {
    const list = [
      { ovrDeviceName: 'OVR_Velocity-RACK1', callerIsActive: false, queuePositionOfCaller: null },
      { ovrDeviceName: null, callerIsActive: false, queuePositionOfCaller: null },
    ];
    const racks = rackSensorNames(list);
    expect(racks).toEqual(['OVR_Velocity-RACK1']);
    expect(soloScanTarget(null, racks)).toEqual({ target: 'OVR_Velocity', exclude: ['OVR_Velocity-RACK1'] });
    expect(soloScanTarget('OVR_Velocity-MINE', racks)).toEqual({ target: 'OVR_Velocity-MINE', exclude: ['OVR_Velocity-RACK1'] });
    expect(soloScanTarget('OVR_Velocity-RACK1', racks).target).toBe('OVR_Velocity');
    expect(onAnyRack(list)).toBe(false);
    expect(onAnyRack([{ callerIsActive: true, queuePositionOfCaller: null }])).toBe(true);
    expect(onAnyRack([{ callerIsActive: false, queuePositionOfCaller: 2 }])).toBe(true);
    await saveRackSensors(racks);
    expect(JSON.parse(store[SOLO_RACK_SENSORS_KEY])).toEqual(racks);
    expect(await readRackSensors()).toEqual(racks);
  });

  it('remembers the sensor name per phone', async () => {
    expect(await readSoloOvrName()).toBeNull();
    await saveSoloOvrName('OVR_Velocity-6C8E');
    expect(store[SOLO_OVR_NAME_KEY]).toBe('OVR_Velocity-6C8E');
    expect(await readSoloOvrName()).toBe('OVR_Velocity-6C8E');
  });
});

describe('solo wiring', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  const L = read('screens/WorkoutLoggerScreen.tsx');
  const D = read('screens/exercise-detail-view.tsx');
  const H = read('hooks/useSoloSensor.ts');
  const B = read('components/logger/SensorButton.tsx');

  it('the control renders only through sensorProps, gated on not-on-a-rack', () => {
    expect(L).toContain("showConnectSensor({ isSelf: rack.isSelf, onRack: rack.onRack, hasExercise: !!currentExercise.exercise_id })");
    expect(L).toContain('(solo.on && !rack.onRack)');
    expect(L).toContain('sensor={sensorProps}');
    expect(D).toContain('{sensor && <SensorButton {...sensor} />}');
    expect(B).toContain('Connect sensor');
    expect(B).toContain('SENSOR_BUSY_TEXT');
  });

  it('joining a rack disconnects the phone sensor (hook effect)', () => {
    expect(H).toMatch(/if \(mustDropSensor\(\{ onRack, sensorOn: on \}\)\) disconnect\(\);/);
    expect(H).toContain('onRack: boolean;');
    expect(L).toContain('onRack: rack.onRack,');
  });

  it('solo Done ends the set on the phone engine, never the rack RPC', () => {
    expect(L).toMatch(/if \(soloLive && !rackLive\) \{\s*solo\.dispatch\(\{ type: 'done' \}\);\s*return;/);
    expect(L).toContain("source: 'sensor',");
    expect(H).toContain('keys: soloPersistKeys(athleteId)');
  });

  it('C1: connect excludes rack sensors and gives up after one scan timeout; set starts check the rack', () => {
    expect(H).toContain('void ovr.connect(target, { exclude, giveUpOnScanTimeout: true });');
    expect(H).toContain('return !!list && onAnyRack(list);');
    expect(B).toContain('onPress={() => p.onConnect(true)}'); // Retry = a user tap (still excludes)
  });

  it('I3: unmount mid-set ends the set, then flushes', () => {
    expect(H).toMatch(/session\.dispatch\(\{ type: 'done' \}\);\s*void session\.idle\(\)\.then\(\(\) => session\.flush\(\)\);\s*session\.stop\(\);/);
  });

  it('I1: the set load is the own LB only; the prescription is the sensor display only', () => {
    expect(L).toContain('? loadFromInput(exerciseInputs[ctxExercise.id]?.[ctxSetIndex]?.weight)\n    : null;');
    expect(L).toContain('loadLb: soloWeight,');
    expect(L).toContain('solo.setDisplayLoad(soloDisplayLoad);');
    expect(L).toContain('if (!opts?.solo) cancelDraft(reId, res.setIndex);');
  });

  it('without connecting, nothing runs: no engine, no scan', () => {
    expect(H).toContain('engine: on ? engine : null');
    expect(H).toMatch(/if \(!session \|\| !on\) return;/);
    expect(L).toContain('if (!solo.on || !ctxExercise || !ctxExercise.exercise_id) return;');
  });
});
