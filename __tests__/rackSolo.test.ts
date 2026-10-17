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
  createSoloSession,
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

  it('the solo queues use their own keys, never the rack iPad’s', async () => {
    const keys = Object.values(SOLO_PERSIST_KEYS);
    for (const k of Object.values(RACK_PERSIST_KEYS)) expect(keys).not.toContain(k);
    expect(SOLO_PERSIST_KEYS.reps).toBe('solo_vbt_reps_v1');

    const m = mockClient();
    m.upsert.mockImplementation(async () => ({ error: { message: 'offline' }, status: 503 } as any));
    const persist = createRackPersist({ client: m.client, orgId: ORG, keys: SOLO_PERSIST_KEYS, log: () => {} });
    const r = createSoloSession({ athleteId: 'tyler', persist, sensor: { writeLoad: async () => {} }, log: () => {} });
    r.dispatch(ctx(), T0);
    r.dispatch({ type: 'rep', rep: ovr(0.7) }, T0 + 100);
    await r.idle();
    expect(store[SOLO_PERSIST_KEYS.reps]).toBeDefined();
    expect(JSON.parse(store[SOLO_PERSIST_KEYS.reps])).toHaveLength(1);
    expect(store[RACK_PERSIST_KEYS.reps]).toBeUndefined();
  });

  it('set end: 60 s idle, and the 30 s reopen window even after the phone advanced its set', async () => {
    const r = rig();
    r.session.dispatch(ctx(), T0);
    r.session.dispatch({ type: 'rep', rep: ovr(0.7) }, T0);
    r.session.dispatch({ type: 'tick' }, T0 + 60_000);
    await r.session.idle();
    expect(r.saved[0]).toMatchObject({ endedBy: 'idle', setNumber: 1, fullReps: 1 });
    // the phone fills set 1 in and opens set 2 (same exercise)
    r.session.dispatch(ctx({ setNumber: 2 }), T0 + 61_000);
    // a rep 20 s after the idle end reopens set 1 with its reps
    r.session.dispatch({ type: 'rep', rep: ovr(0.68) }, T0 + 80_000);
    r.session.dispatch({ type: 'done' }, T0 + 82_000);
    await r.session.idle();
    expect(r.saved[1]).toMatchObject({ setNumber: 1, fullReps: 2, endedBy: 'phone' });
    // past the window → the phone's set 2
    r.session.dispatch({ type: 'rep', rep: ovr(0.6) }, T0 + 82_000 + 40_000);
    r.session.dispatch({ type: 'done' }, T0 + 82_000 + 41_000);
    await r.session.idle();
    expect(r.saved[2]).toMatchObject({ setNumber: 2, fullReps: 1 });
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
    expect(H).toContain('keys: SOLO_PERSIST_KEYS');
  });

  it('without connecting, nothing runs: no engine, no scan', () => {
    expect(H).toContain('engine: on ? engine : null');
    expect(H).toMatch(/if \(!session \|\| !on\) return;/);
    expect(L).toContain('if (!solo.on || !ctxExercise || !ctxExercise.exercise_id) return;');
  });
});
