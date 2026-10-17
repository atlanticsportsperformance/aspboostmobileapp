import { readFileSync } from 'fs';
import { join } from 'path';
import {
  rackInstanceFromLogger,
  rackLogsFromCompleted,
  resolveRackSet,
  type RackSetExercise,
  type RackSetInstance,
  type RackSetLog,
  type ResolveRackSetInput,
} from '../lib/rack/resolveRackSet';
import { createRackEngine, type RackSessionRow } from '../lib/rack/engine';
import { createRackExecutor, CONTINUE_MS, LOG_HOLD_MAX_MS, type ExecutorApi } from '../lib/rack/executor';
import type { SetLogRow, TodayAthlete, TodayExercise } from '../lib/rack/api';
import type { OvrRep } from '../lib/ovr/protocol';

// ---------------------------------------------------------------- pure resolver

const lift = (re: string, sets = 3, over: Partial<RackSetExercise> = {}): RackSetExercise => ({
  routineExerciseId: re,
  exerciseId: `ex-${re}`,
  sets,
  rackLift: true,
  group: null,
  ...over,
});
const nonLift = (re: string, sets = 3, over: Partial<RackSetExercise> = {}) => lift(re, sets, { rackLift: false, ...over });
const inst = (wi: string, exercises: RackSetExercise[]): RackSetInstance => ({ workoutInstanceId: wi, exercises });
const done = (wi: string, re: string, ...ns: number[]): RackSetLog[] =>
  ns.map(n => ({ workoutInstanceId: wi, routineExerciseId: re, setNumber: n, isComplete: true }));
const draft = (wi: string, re: string, n: number): RackSetLog => ({ workoutInstanceId: wi, routineExerciseId: re, setNumber: n, isComplete: false });

// Simulator workout: Back Squat (3) → DB Bulgarian (3) → Box Jump (3) → RDL (3).
const W = inst('wi', [lift('squat'), lift('bulgarian'), nonLift('box'), lift('rdl')]);
const resolve = (over: Partial<ResolveRackSetInput>) => resolveRackSet({ instances: [W], logs: [], ...over });
const at = (r: ReturnType<typeof resolveRackSet>) => (r.none ? 'none' : `${r.routineExerciseId}#${r.setNumber}`);

describe('resolveRackSet — rules', () => {
  it('rule 1: exercise = phone-open, then coach override, then first unfinished rack lift', () => {
    expect(at(resolve({ phone: { workoutInstanceId: 'wi', routineExerciseId: 'rdl' }, override: { workoutInstanceId: 'wi', routineExerciseId: 'bulgarian' } }))).toBe('rdl#1');
    expect(at(resolve({ override: { workoutInstanceId: 'wi', routineExerciseId: 'bulgarian' } }))).toBe('bulgarian#1');
    expect(at(resolve({}))).toBe('squat#1');
    expect(resolve({ override: { workoutInstanceId: 'wi', routineExerciseId: 'bulgarian' } })).toMatchObject({ reason: 'override' });
  });

  it('rule 1: auto-pick takes only rack lifts (isRackLift), in workout order', () => {
    const logs = [...done('wi', 'squat', 1, 2, 3), ...done('wi', 'bulgarian', 1, 2, 3)];
    expect(resolve({ logs })).toMatchObject({ routineExerciseId: 'rdl', setNumber: 1, reason: 'next-rack-lift' });
  });

  it('rule 2: set = lowest set in 1..prescribed that is not complete (drafts are not complete)', () => {
    expect(at(resolve({ logs: [...done('wi', 'squat', 1), draft('wi', 'squat', 2)] }))).toBe('squat#2');
  });

  it('rule 2: logged-ahead — 1 and 2 done on the phone → set 3', () => {
    expect(at(resolve({ logs: done('wi', 'squat', 1, 2) }))).toBe('squat#3');
  });

  it('rule 2: skipped — set 2 done, set 1 empty → set 1', () => {
    expect(at(resolve({ logs: done('wi', 'squat', 2) }))).toBe('squat#1');
  });

  it("rule 2: the phone's open set means every set below it is done on the phone (outbox not landed)", () => {
    expect(at(resolve({ logs: done('wi', 'squat', 1), phone: { workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 3 } }))).toBe('squat#3');
  });

  it('rule 3: never an is_complete set — every candidate skips complete numbers', () => {
    for (let mask = 0; mask < 8; mask++) {
      const ns = [1, 2, 3].filter(n => mask & (1 << (n - 1)));
      const r = resolve({ logs: done('wi', 'squat', ...ns), phone: { workoutInstanceId: 'wi', routineExerciseId: 'squat' } });
      if (!r.none && r.routineExerciseId === 'squat') expect(ns).not.toContain(r.setNumber);
    }
  });

  it('rule 4: finished + the phone moved to another exercise → follow the phone', () => {
    const logs = done('wi', 'squat', 1, 2, 3);
    const r = resolve({ logs, phone: { workoutInstanceId: 'wi', routineExerciseId: 'rdl' }, lastRackExercise: { workoutInstanceId: 'wi', routineExerciseId: 'squat' }, liftingContinues: true });
    expect(at(r)).toBe('rdl#1');
  });

  it('rule 4: finished + lifting continues on it → extra set prescribed + 1 (appended)', () => {
    const last = { workoutInstanceId: 'wi', routineExerciseId: 'squat' };
    expect(resolve({ logs: done('wi', 'squat', 1, 2, 3), lastRackExercise: last, liftingContinues: true })).toMatchObject({
      routineExerciseId: 'squat', setNumber: 4, reason: 'extra-set',
    });
    // a 4th already logged → 5 (never a complete number)
    expect(at(resolve({ logs: done('wi', 'squat', 1, 2, 3, 4), lastRackExercise: last, liftingContinues: true }))).toBe('squat#5');
  });

  it('rule 4: finished, nothing continuing → next unfinished rack lift', () => {
    expect(at(resolve({ logs: done('wi', 'squat', 1, 2, 3), lastRackExercise: { workoutInstanceId: 'wi', routineExerciseId: 'squat' } }))).toBe('bulgarian#1');
  });

  it('rule 4: no rack lift left → none (the iPad asks "Pick an exercise"; reps = free set)', () => {
    const logs = [...done('wi', 'squat', 1, 2, 3), ...done('wi', 'bulgarian', 1, 2, 3), ...done('wi', 'rdl', 1, 2, 3)];
    expect(resolve({ logs })).toEqual({ none: true, reason: 'nothing-left' });
  });

  it('rule 5: supersets — a phone on A2 (not a lift) resolves to A1, the rack lift', () => {
    const SS = inst('wi', [lift('a1', 3, { group: 'A' }), nonLift('a2', 3, { group: 'A' }), lift('b1')]);
    const r = resolveRackSet({ instances: [SS], logs: [...done('wi', 'a1', 1), ...done('wi', 'a2', 1)], phone: { workoutInstanceId: 'wi', routineExerciseId: 'a2' } });
    expect(r).toMatchObject({ routineExerciseId: 'a1', setNumber: 2, reason: 'superset-lift' });
  });

  it('rule 5: A1 finished while the phone is on A2 → the rack never serves A2', () => {
    const SS = inst('wi', [lift('a1', 2, { group: 'A' }), nonLift('a2', 3, { group: 'A' }), lift('b1')]);
    const r = resolveRackSet({ instances: [SS], logs: done('wi', 'a1', 1, 2), phone: { workoutInstanceId: 'wi', routineExerciseId: 'a2' } });
    expect(at(r)).toBe('b1#1');
  });

  it('rule 6: two instances — the phone-open instance wins, else the first with unfinished rack lifts', () => {
    const throwing = inst('wi-throw', [nonLift('throw', 1)]);
    const lifting = inst('wi-lift', [lift('squat')]);
    const later = inst('wi-pm', [lift('bench')]);
    expect(at(resolveRackSet({ instances: [throwing, lifting, later], logs: [] }))).toBe('squat#1');
    expect(resolveRackSet({ instances: [throwing, lifting, later], logs: [], phone: { workoutInstanceId: 'wi-pm', routineExerciseId: 'bench' } })).toMatchObject({ workoutInstanceId: 'wi-pm', routineExerciseId: 'bench' });
    // phone on the throwing instance (no lift there) → first instance with a lift
    expect(resolveRackSet({ instances: [throwing, lifting, later], logs: done('wi-throw', 'throw', 1), phone: { workoutInstanceId: 'wi-throw', routineExerciseId: 'throw' } })).toMatchObject({ workoutInstanceId: 'wi-lift' });
  });
});

describe('resolveRackSet — scenarios', () => {
  it('SIMULATOR BUG: Back Squat 3/3 done, phone on DB Bulgarian → DB Bulgarian set 1, never Back Squat set 4', () => {
    const logs = done('wi', 'squat', 1, 2, 3);
    const last = { workoutInstanceId: 'wi', routineExerciseId: 'squat' };
    const onPhone = resolve({ logs, lastRackExercise: last, phone: { workoutInstanceId: 'wi', routineExerciseId: 'bulgarian', setNumber: 1 } });
    expect(onPhone).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1 });
    // phone on the overview (sends nothing) → the next rack lift, DB Bulgarian
    expect(at(resolve({ logs, lastRackExercise: last }))).toBe('bulgarian#1');
    // DB Bulgarian not a rack lift → the next rack lift (RDL), still never squat #4
    const noBulg = inst('wi', [lift('squat'), nonLift('bulgarian'), nonLift('box'), lift('rdl')]);
    expect(at(resolveRackSet({ instances: [noBulg], logs, lastRackExercise: last }))).toBe('rdl#1');
  });

  it('superset A1/A2: the returning athlete gets A1’s next set', () => {
    const SS = inst('wi', [lift('a1', 3, { group: 'A' }), nonLift('a2', 3, { group: 'A' })]);
    const logs = [...done('wi', 'a1', 1, 2), ...done('wi', 'a2', 1, 2)];
    expect(at(resolveRackSet({ instances: [SS], logs, phone: { workoutInstanceId: 'wi', routineExerciseId: 'a2', setNumber: 3 } }))).toBe('a1#3');
    expect(at(resolveRackSet({ instances: [SS], logs }))).toBe('a1#3');
  });

  it('the phone and the iPad agree: the phone’s own inputs (logger shape) give the iPad’s answer', () => {
    const routines: any[] = [
      { id: 'r-a', scheme: 'superset', routine_exercises: [
        { id: 'a1', exercise_id: 'ex-a1', sets: 3, velocity_min_mps: 0.6, velocity_max_mps: 0.9, exercises: { is_placeholder: false } },
        { id: 'a2', exercise_id: 'ex-a2', sets: 3, velocity_min_mps: null, velocity_max_mps: null, enabled_measurements: ['reps'], exercises: { is_placeholder: false } },
      ] },
      { id: 'r-warm', scheme: 'warm_up', routine_exercises: [{ id: 'w', exercise_id: null, notes_only: true, sets: 0 }] },
      { id: 'r-b', scheme: 'straight', routine_exercises: [
        { id: 'b1', exercise_id: 'ex-b1', sets: 2, metric_targets: { weight: 185 }, velocity_min_mps: null, velocity_max_mps: null, exercises: { is_placeholder: false } },
      ] },
    ];
    const phoneInst = rackInstanceFromLogger('wi', routines);
    expect(phoneInst.exercises.map(e => [e.routineExerciseId, e.rackLift, e.group])).toEqual([
      ['a1', true, 'r-a'], ['a2', false, 'r-a'], ['b1', true, null],
    ]);
    const logs = rackLogsFromCompleted('wi', { a1: [true, true, true], b1: [true, false] });
    expect(at(resolveRackSet({ instances: [phoneInst], logs }))).toBe('b1#2');
  });
});

// ---------------------------------------------------------------- executor wiring (iPad)

const RACK = 'rack-3';
const T0 = 1_760_000_000_000;
const iso = (t: number) => new Date(t).toISOString();
const ovr = (v: number): OvrRep => ({ concentricS: 0.5, romIn: 20, meanV: v, peakV: v + 0.3, meanPowerW: 900, peakPowerW: 1800 });
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 10; k++) await Promise.resolve();
    await new Promise(res => setTimeout(res, 0));
  }
};

const row = (over: Partial<RackSessionRow> = {}): RackSessionRow => ({
  rack_id: RACK, active_athlete_id: 'tyler', workout_instance_id: null, routine_exercise_id: null, exercise_id: null,
  set_number: null, load_lb: null, state: 'idle', queue: [], set_started_at: null,
  pending_workout_instance_id: null, pending_routine_exercise_id: null, pending_set_number: null, pending_load_lb: null,
  leave_requested: false, pending_end: false, updated_at: iso(T0), ...over,
});
const tEx = (re: string, lifted = true): TodayExercise => ({
  workoutInstanceId: 'wi', routineExerciseId: re, exerciseId: `ex-${re}`, name: re, sets: 3, completedSets: 0,
  zoneMin: null, zoneMax: null, dropStopPct: null,
  plan: { exercise_id: `ex-${re}`, enabled_measurements: lifted ? ['weight', 'reps'] : ['reps'] },
});
const tyler = (exs: TodayExercise[]): TodayAthlete => ({
  athleteId: 'tyler', firstName: 'Tyler', lastName: 'B',
  instances: [{ workoutInstanceId: 'wi', status: 'in_progress', createdAt: iso(T0), exercises: exs, remaining: exs }],
  exercises: exs, remaining: exs,
});
const logRows = (re: string, ...ns: number[]): SetLogRow[] =>
  ns.map(n => ({ athleteId: 'tyler', workoutInstanceId: 'wi', routineExerciseId: re, setNumber: n, isComplete: true }));

/** The executor over a tiny fake server: every RPC edits one rack_sessions row. */
function rig(initialLogs: SetLogRow[] = []) {
  let t = T0;
  let logs = initialLogs;
  let updated = T0;
  let server = row();
  const put = (over: Partial<RackSessionRow>) => (server = { ...server, ...over, updated_at: iso((updated += 1)) });
  const api: ExecutorApi = {
    startSet: jest.fn(async (_r, a, st) => put({ active_athlete_id: a, state: 'lifting', set_started_at: st, pending_end: false })),
    setActive: jest.fn(async (_r, a) => put({ active_athlete_id: a })),
    // rack_end_set: the set ends; a context sent mid-set (pending_*) becomes the live one.
    endSet: jest.fn(async () =>
      put({
        state: 'idle', set_started_at: null, pending_end: false,
        ...(server.pending_routine_exercise_id != null
          ? {
              workout_instance_id: server.pending_workout_instance_id, routine_exercise_id: server.pending_routine_exercise_id,
              set_number: server.pending_set_number, load_lb: server.pending_load_lb,
              pending_workout_instance_id: null, pending_routine_exercise_id: null, pending_set_number: null, pending_load_lb: null,
            }
          : {}),
      }),
    ),
    athleteSets: jest.fn(async () => logs),
    setIpadContext: jest.fn(async (_r, a, c) =>
      server.state === 'lifting'
        ? put({ pending_workout_instance_id: c.workoutInstanceId, pending_routine_exercise_id: c.routineExerciseId, pending_set_number: c.setNumber, pending_load_lb: c.loadLb })
        : put({ active_athlete_id: a, workout_instance_id: c.workoutInstanceId, routine_exercise_id: c.routineExerciseId, set_number: c.setNumber, load_lb: c.loadLb }),
    ),
  };
  // The DB: the rack's set writes land in the logs.
  const write = async (sm: any) => {
    if (sm.workoutInstanceId && sm.routineExerciseId && sm.setNumber != null) {
      logs = [...logs, { athleteId: sm.athleteId, workoutInstanceId: sm.workoutInstanceId, routineExerciseId: sm.routineExerciseId, setNumber: sm.setNumber, isComplete: true }];
    }
  };
  const persist = { writeRep: jest.fn(async () => {}), endSet: jest.fn(write), amendSet: jest.fn(write), flush: jest.fn(async () => {}) };
  const ex = createRackExecutor({ engine: createRackEngine(RACK), api, persist, sensor: { writeLoad: jest.fn(async () => {}) }, now: () => t, log: () => {} });
  return {
    ex, api, persist,
    advance: (ms: number) => (t += ms),
    setLogs: (l: SetLogRow[]) => (logs = l),
    /** The phone (or the DB) changes the row; realtime delivers it. */
    sync: (over: Partial<RackSessionRow>, at?: number) => ex.dispatch({ type: 'sessionSync', row: put(over) }, at),
    get t() { return t; },
  };
}

const SIM = () => tyler([tEx('squat'), tEx('bulgarian'), tEx('box', false), tEx('rdl')]);

describe('iPad wiring (executor → engine)', () => {
  it('SIMULATOR BUG on the iPad: squat 3/3 done by phone Done, phone on DB Bulgarian → DB Bulgarian set 1, not "Set 4 of 3"', async () => {
    const r = rig(logRows('squat', 1, 2));
    r.ex.setToday([SIM()]);
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 3 });
    await settle();
    // set 3 on the rack, ended by phone Done (pending_end on that set)
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(1000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 3 });
    r.sync({ pending_end: true }, r.advance(2000)); // phone Done → rack_request_end_set
    await settle();
    expect((r.persist.endSet as jest.Mock).mock.calls[0][0]).toMatchObject({ routineExerciseId: 'squat', setNumber: 3 });
    // the phone moves on to DB Bulgarian
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'bulgarian', set_number: 1 }, r.advance(500));
    await settle();
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1, resolved: true });
    const { nextSetNumber, nextContext } = require('../lib/rack/engine');
    expect(nextContext(r.ex.getState())).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1 });
    expect(nextSetNumber(r.ex.getState(), 'tyler')).toBe(1);
    // the phone on the overview instead (empty context) → still DB Bulgarian, published
    r.sync({ workout_instance_id: null, routine_exercise_id: null, set_number: null }, r.advance(500));
    await settle();
    expect(r.ex.getState().session).toMatchObject({ routine_exercise_id: 'bulgarian', set_number: 1 });
  });

  it('rule 7: a phone context change mid-set never splits the live set; it applies at the next set start', async () => {
    const r = rig();
    r.ex.setToday([SIM()]);
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 1 });
    await settle();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(1000));
    await settle();
    r.sync({ pending_workout_instance_id: 'wi', pending_routine_exercise_id: 'rdl', pending_set_number: 1 }, r.advance(500));
    r.ex.dispatch({ type: 'rep', rep: ovr(0.68) }, r.advance(1500));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 1 });
    expect((r.persist.writeRep as jest.Mock).mock.calls.map(c => c[0].routineExerciseId)).toEqual(['squat', 'squat']);
  });

  it('extra set: reps keep coming on a finished exercise (nothing else open) → set 4, appended', async () => {
    const r = rig(logRows('squat', 1, 2));
    r.ex.setToday([SIM()]);
    r.sync({});
    await settle();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(1000));
    r.ex.dispatch({ type: 'ipadDone' }, r.advance(2000));
    // at once — never a flash of "Back Squat · Set 4 of 3"
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1 });
    await settle();
    expect((r.persist.endSet as jest.Mock).mock.calls[0][0]).toMatchObject({ routineExerciseId: 'squat', setNumber: 3 });
    expect((r.api.setIpadContext as jest.Mock).mock.calls.map(c => `${c[2].routineExerciseId}#${c[2].setNumber}`)).not.toContain('squat#4');
    // idle: the iPad moves on (published) …
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1 });
    // … but reps keep coming on the rack 20 s later with nothing else open → squat set 4
    r.ex.dispatch({ type: 'rep', rep: ovr(0.66) }, r.advance(20_000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 4 });
    // the phone's live row is the rack's set: published before rack_start_set
    expect(r.ex.getState().session).toMatchObject({ routine_exercise_id: 'squat', set_number: 4 });
  });

  it('no extra set once the athlete rested past CONTINUE_MS → the next rack lift', async () => {
    const r = rig(logRows('squat', 1, 2));
    r.ex.setToday([SIM()]);
    r.sync({});
    await settle();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(1000));
    r.ex.dispatch({ type: 'ipadDone' }, r.advance(2000));
    await settle();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.66) }, r.advance(CONTINUE_MS + 5000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1 });
  });

  it('nothing remaining → none: no exercise, reps go in as a free set', async () => {
    const r = rig([...logRows('squat', 1, 2, 3), ...logRows('bulgarian', 1, 2, 3), ...logRows('rdl', 1, 2, 3)]);
    r.ex.setToday([SIM()]);
    r.sync({});
    await settle();
    expect(r.ex.getState().localContext).toMatchObject({ resolved: true, routineExerciseId: null });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(1000));
    await settle();
    expect((r.persist.writeRep as jest.Mock).mock.calls[0][0]).toMatchObject({ workoutInstanceId: null, routineExerciseId: null, setNumber: null });
  });

  it('N1: a stray rep right after a manual phone Done never lifts the set the phone just completed', async () => {
    const r = rig(logRows('squat', 1));
    r.ex.setToday([SIM()]);
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 2 });
    await settle();
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'squat', setNumber: 2 });
    // The phone saves set 2 by hand (it lands in the DB); its context for set 3 hasn't arrived yet.
    r.setLogs(logRows('squat', 1, 2));
    r.advance(5000); // cached logs now older than LOG_FRESH_MS
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) });
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 3 });
    expect((r.persist.writeRep as jest.Mock).mock.calls[0][0].setNumber).toBe(3);
  });

  it('N1: the re-read is bounded — a slow read starts the set after LOG_HOLD_MAX_MS with cached logs; reps keep their order', async () => {
    jest.useFakeTimers();
    try {
      const r = rig();
      r.ex.setToday([SIM()]);
      r.sync({});
      await jest.advanceTimersByTimeAsync(0);
      (r.api.athleteSets as jest.Mock).mockImplementation(() => new Promise(() => {}));
      r.advance(5000);
      r.ex.dispatch({ type: 'rep', rep: ovr(0.7) });
      r.ex.dispatch({ type: 'rep', rep: ovr(0.69) });
      expect(r.ex.getState().live).toBeNull();
      await jest.advanceTimersByTimeAsync(LOG_HOLD_MAX_MS + 10);
      expect(r.ex.getState().live?.reps.map(x => x.v)).toEqual([0.7, 0.69]);
      expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 1 });
    } finally {
      jest.useRealTimers();
    }
  });
});

const toEx = (re: string): TodayExercise => tEx(re);

describe('fix round 1 (review 10c)', () => {
  /** Squat set 2 lifted, then 60 s with no rep → idle end. */
  async function idleEndedSet2(r: ReturnType<typeof rig>) {
    r.ex.setToday([SIM()]);
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 2 });
    await settle();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(1000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 2 });
    r.ex.dispatch({ type: 'tick' }, r.advance(61_000));
    await settle();
    expect(r.ex.getState().lastEndByAthlete.tyler).toMatchObject({ endedBy: 'idle', hold: true });
  }

  it('C1 (reviewer repro): idle end, the phone moves to set 3, a rep 3 min later → set 3, not merged into set 2', async () => {
    const r = rig(logRows('squat', 1));
    await idleEndedSet2(r);
    r.sync({ set_number: 3 }, r.advance(2000)); // the phone opens set 3
    await settle();
    expect(r.ex.getState().lastEndByAthlete.tyler.hold).toBe(false);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.69) }, r.advance(180_000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 3 });
    expect(r.ex.getState().live?.reps.some(x => x.carried)).toBe(false);
  });

  it('C1: no phone at all — long after the 30 s window, a rep starts set 3', async () => {
    const r = rig(logRows('squat', 1));
    await idleEndedSet2(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.69) }, r.advance(180_000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 3 });
  });

  it('C1 (30 s window, no phone): a rep 60 s after the idle end starts set 3 — a normal rest never merges', async () => {
    const r = rig(logRows('squat', 1));
    await idleEndedSet2(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.69) }, r.advance(60_000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 3 });
    expect(r.ex.getState().live?.reps.some(x => x.carried)).toBe(false);
  });

  it('C1: a rep 20 s after the idle end (inside the window) reopens the set (spec §3)', async () => {
    const r = rig(logRows('squat', 1));
    await idleEndedSet2(r);
    r.ex.dispatch({ type: 'rep', rep: ovr(0.69) }, r.advance(20_000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 2 });
    expect(r.ex.getState().live?.reps.filter(x => x.carried)).toHaveLength(1);
  });

  it('I2: an un-check on the phone is reflected — the guard is rebuilt from each read, set 2 is filled again', async () => {
    const r = rig(logRows('squat', 1));
    r.ex.setToday([SIM()]);
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 2 });
    await settle();
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(1000));
    r.ex.dispatch({ type: 'ipadDone' }, r.advance(2000));
    await settle();
    expect(r.ex.getState().completeSets['tyler:wi:squat']).toEqual(expect.arrayContaining([1, 2]));
    r.sync({ set_number: 3 }, r.advance(1000)); // the rack's row landed: the phone opens set 3
    await settle();
    // The athlete un-checks set 2 on the phone (the row goes is_complete false), the phone sends set 2.
    r.setLogs(logRows('squat', 1));
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 2 }, r.advance(5000));
    await settle();
    expect(r.ex.getState().completeSets['tyler:wi:squat']).toEqual([1]);
    const { nextSetNumber } = require('../lib/rack/engine');
    expect(nextSetNumber(r.ex.getState(), 'tyler')).toBe(2);
  });

  it('I3: the iPad published squat:1, the phone saves set 1 by hand and sends squat:2 → hint kept, never rewritten', async () => {
    const r = rig();
    r.ex.setToday([SIM()]);
    r.sync({});
    await settle();
    expect(r.ex.getState().session).toMatchObject({ routine_exercise_id: 'squat', set_number: 1 }); // iPad auto-pick
    const before = (r.api.setIpadContext as jest.Mock).mock.calls.length;
    // DB still lacks set 1 (outbox); the phone's context says set 2.
    r.sync({ set_number: 2 }, r.advance(500));
    await settle();
    expect((r.api.setIpadContext as jest.Mock).mock.calls.slice(before).map(c => c[2].setNumber)).not.toContain(1);
    expect(r.ex.getState().session).toMatchObject({ routine_exercise_id: 'squat', set_number: 2 });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(5000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 2 });
  });

  it('I4: squat 3/3 saved by hand (DB stale) → the phone sends squat:4 → next rack lift, never squat 3', async () => {
    const r = rig(logRows('squat', 1, 2));
    r.ex.setToday([SIM()]);
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 4 });
    await settle();
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1 });
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(5000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1 });
  });

  it('M1: a coach pick during the first-rep wait is queued behind the rep (the rep is not lifted under it)', async () => {
    jest.useFakeTimers();
    try {
      const r = rig();
      r.ex.setToday([SIM()]);
      r.sync({});
      await jest.advanceTimersByTimeAsync(0);
      (r.api.athleteSets as jest.Mock).mockImplementation(() => new Promise(res => setTimeout(() => res([]), 500)));
      r.advance(5000);
      r.ex.dispatch({ type: 'rep', rep: ovr(0.7) });
      r.ex.setOverride('tyler', toEx('rdl'));
      await jest.advanceTimersByTimeAsync(600);
      expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 1 });
      expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'squat' }); // lifting: applies next set
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('END TO END: phone finishes A → rack lift B on BOTH devices (owner: "isn\'t syncing")', () => {
  const { phoneRackNow, followOnFinish, rackStripLine, rackFollowToast } = require('../lib/rack/phoneView');
  const { buildRackView } = require('../lib/rack/viewModel');
  // Back Squat (lift) → DB Bulgarian (NOT a lift here: reps only) → Romanian Deadlift (lift).
  const reRow = (id: string, name: string, lift: boolean) => ({
    id, exercise_id: `ex-${id}`, sets: 3, velocity_min_mps: null, velocity_max_mps: null,
    enabled_measurements: lift ? ['weight', 'reps'] : ['reps'], exercises: { name, is_placeholder: false },
  });
  const routines: any[] = [{ id: 'r-a', scheme: 'straight', routine_exercises: [reRow('squat', 'Back Squat', true), reRow('bulgarian', 'DB Bulgarian', false), reRow('rdl', 'Romanian Deadlift', true)] }];
  const today = (): TodayAthlete => {
    const exs = routines[0].routine_exercises.map((r: any) => ({
      ...tEx(r.id, r.enabled_measurements.includes('weight')),
      name: r.exercises.name,
    }));
    return tyler(exs);
  };

  it('phone view-model, iPad view-model and the follow all say Romanian Deadlift · Set 1 of 3', async () => {
    // ---- phone: squat 3/3 just completed by hand on the squat screen
    const instance = rackInstanceFromLogger('wi', routines);
    const before = rackLogsFromCompleted('wi', { squat: [true, true, false] });
    const after = rackLogsFromCompleted('wi', { squat: [true, true, true] });
    const session = row({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 3 });
    const isEcho = (c: any) => c.routineExerciseId === 'squat' && c.setNumber === 3;
    const nowBefore = phoneRackNow({ instance, logs: before, session, athleteId: 'tyler', workoutInstanceId: 'wi', openExerciseId: 'squat', isEcho });
    expect(nowBefore).toMatchObject({ routineExerciseId: 'squat', setNumber: 3, source: 'phone' });
    const now = phoneRackNow({ instance, logs: after, session, athleteId: 'tyler', workoutInstanceId: 'wi', openExerciseId: 'squat', isEcho });
    expect(now).toMatchObject({ routineExerciseId: 'rdl', setNumber: 1, source: 'rack' });
    const opened = followOnFinish({ prev: null, openId: 'squat', finished: false, active: true, rackNow: nowBefore, blockHasMore: false });
    const { follow } = followOnFinish({ prev: opened.track, openId: 'squat', finished: true, active: true, rackNow: now, blockHasMore: false });
    expect(follow).toBe('rdl');
    expect(rackFollowToast('Rack 1', 'Romanian Deadlift', 1)).toBe('Rack 1 → Romanian Deadlift · set 1');
    const phoneStrip = rackStripLine('Rack 1', 'Romanian Deadlift', now.setNumber, 3);
    expect(phoneStrip).toBe('Rack 1 · Romanian Deadlift · Set 1 of 3');

    // ---- iPad: the phone sent "done through 3" (squat:4); its logs may still lag (only 1, 2).
    const r = rig(logRows('squat', 1, 2));
    r.ex.setToday([today()]);
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 4 });
    await settle();
    const v = buildRackView({ state: r.ex.getState(), today: [today()], rackName: 'Rack 1', nowMs: r.t, ipadOwned: r.ex.ipadOwnsContext() });
    expect(v.exerciseLine).toBe('Romanian Deadlift · Set 1 of 3');
    expect(phoneStrip).toBe(`Rack 1 · ${v.exerciseLine}`);
    // truthful source: the phone never chose RDL
    expect(v.sourceLine).toBe('PICKED BY RACK');

    // ---- the phone follows: it opens RDL set 1 and sends it → the iPad says "from the phone"
    r.sync({ routine_exercise_id: 'rdl', set_number: 1 }, r.advance(500));
    await settle();
    const v2 = buildRackView({ state: r.ex.getState(), today: [today()], rackName: 'Rack 1', nowMs: r.t, ipadOwned: r.ex.ipadOwnsContext() });
    expect(v2.exerciseLine).toBe('Romanian Deadlift · Set 1 of 3');
    expect(v2.sourceLine).toBe("FROM TYLER'S PHONE");
  });

  it('N1 (reviewer repro): open DB Bulgarian, back to the overview → the strip shows Bulgarian set 1 on BOTH', async () => {
    const instance = rackInstanceFromLogger('wi', routines);
    const logs = rackLogsFromCompleted('wi', { squat: [true, true, false] });
    const session = row({ workout_instance_id: 'wi', routine_exercise_id: 'bulgarian', set_number: 1 });
    const isEcho = (c: any) => c.routineExerciseId === 'bulgarian' && c.setNumber === 1; // what the phone sent
    const onOverview = phoneRackNow({ instance, logs, session, athleteId: 'tyler', workoutInstanceId: 'wi', openExerciseId: null, isEcho });
    expect(onOverview).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1 });
    const phoneStrip = rackStripLine('Rack 1', 'DB Bulgarian', onOverview.setNumber, 3);

    const r = rig(logRows('squat', 1, 2));
    r.ex.setToday([today()]);
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'bulgarian', set_number: 1 });
    await settle();
    const v = buildRackView({ state: r.ex.getState(), today: [today()], rackName: 'Rack 1', nowMs: r.t, ipadOwned: r.ex.ipadOwnsContext() });
    expect(phoneStrip).toBe(`Rack 1 · ${v.exerciseLine}`);
    expect(v.exerciseLine).toBe('DB Bulgarian · Set 1 of 3');
  });

  it('truthful source: a coach pick reads PICKED ON IPAD', async () => {
    const r = rig();
    r.ex.setToday([today()]);
    r.sync({});
    await settle();
    expect(buildRackView({ state: r.ex.getState(), today: [today()], rackName: 'Rack 1', nowMs: r.t }).sourceLine).toBe('PICKED BY RACK');
    r.ex.setOverride('tyler', today().exercises.find((e: TodayExercise) => e.routineExerciseId === 'rdl')!);
    await settle();
    expect(buildRackView({ state: r.ex.getState(), today: [today()], rackName: 'Rack 1', nowMs: r.t }).sourceLine).toBe('PICKED ON IPAD');
  });
});

describe('fix round 3 (owner bugs)', () => {
  const rdlAt2 = () => [...logRows('squat', 1, 2, 3), ...logRows('bulgarian', 1, 2, 3), ...logRows('rdl', 1)];

  it('pure: a FINISHED exercise open on the phone is viewing/editing — never a target, never an extra set', () => {
    const logs = [...done('wi', 'squat', 1, 2, 3), ...done('wi', 'rdl', 1)];
    const viewing = { workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 4 };
    expect(resolve({ logs, phone: viewing })).toMatchObject({ routineExerciseId: 'bulgarian', setNumber: 1 });
    expect(resolve({ logs: [...logs, ...done('wi', 'bulgarian', 1, 2, 3)], phone: viewing })).toMatchObject({ routineExerciseId: 'rdl', setNumber: 2 });
    // un-checking set 2 makes it unfinished → a target again (normal rules)
    expect(resolve({ logs: [...done('wi', 'squat', 1, 3), ...done('wi', 'rdl', 1)], phone: { workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 2 } })).toMatchObject({
      routineExerciseId: 'squat', setNumber: 2, reason: 'phone',
    });
  });

  it('iPad: opening finished squat on the phone leaves the rack on RDL set 2; un-checking squat set 2 makes it the target', async () => {
    const r = rig(rdlAt2());
    r.ex.setToday([SIM()]);
    r.sync({});
    await settle();
    expect(r.ex.getState().session).toMatchObject({ routine_exercise_id: 'rdl', set_number: 2 });
    const published = (r.api.setIpadContext as jest.Mock).mock.calls.length;
    // the phone opens finished squat → sends "done through 3"
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 4 }, r.advance(1000));
    await settle();
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'rdl', setNumber: 2 });
    expect((r.api.setIpadContext as jest.Mock).mock.calls.slice(published).map(c => c[2].routineExerciseId)).not.toContain('squat');
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(1000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'rdl', setNumber: 2 }); // never "squat set 4"
    r.ex.dispatch({ type: 'ipadDone' }, r.advance(2000));
    await settle();
    // un-check squat set 2 on the phone → it sends squat:2
    r.setLogs(rdlAt2().filter(l => !(l.routineExerciseId === 'squat' && l.setNumber === 2)).concat(logRows('rdl', 2)));
    r.sync({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 2 }, r.advance(5000));
    await settle();
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'squat', setNumber: 2, reason: 'phone' });
  });

  it('picker: live progress per exercise from the resolver’s own logs (chips, done marks, + extra)', () => {
    const { pickerRowsOf } = require('../lib/rack/resolveRackSet');
    const rows = pickerRowsOf([W], [...done('wi', 'squat', 1, 2, 3), ...done('wi', 'rdl', 1, 2), draft('wi', 'bulgarian', 1)]);
    const by = (re: string) => rows.find((x: any) => x.routineExerciseId === re);
    expect(by('squat')).toMatchObject({ progress: '3/3 ✓', finished: true, extraSet: 4 });
    expect(by('rdl')).toMatchObject({ progress: '2/3', finished: false, extraSet: 4 });
    expect(by('rdl').chips).toEqual([{ setNumber: 1, done: true }, { setNumber: 2, done: true }, { setNumber: 3, done: false }]);
    expect(by('bulgarian')).toMatchObject({ progress: '0/3', doneCount: 0 }); // a draft is not done
    const { preselectedSet } = require('../lib/rack/resolveRackSet');
    expect(preselectedSet(by('rdl'), true, 3)).toBe(3); // the resolver's current set
    expect(preselectedSet(by('rdl'), false, null)).toBe(3); // lowest open
    expect(preselectedSet(by('squat'), false, null)).toBe(4); // finished → + extra
  });

  it('picker: the executor’s rows follow its log reads (no extra query) and the rack’s own writes', async () => {
    const r = rig(logRows('squat', 1));
    r.ex.setToday([SIM()]);
    r.sync({});
    await settle();
    const reads = (r.api.athleteSets as jest.Mock).mock.calls.length;
    expect(r.ex.pickerRows('tyler').find(x => x.routineExerciseId === 'squat')?.progress).toBe('1/3');
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(1000));
    r.ex.dispatch({ type: 'ipadDone' }, r.advance(2000));
    expect(r.ex.pickerRows('tyler').find(x => x.routineExerciseId === 'squat')?.progress).toBe('2/3'); // at once
    expect((r.api.athleteSets as jest.Mock).mock.calls.length).toBe(reads); // pickerRows itself never queries
  });

  it('picker: a coach pick of exercise + set (even a done one) publishes that set and resolves to exactly it, once', async () => {
    const r = rig(logRows('squat', 1, 2));
    r.ex.setToday([SIM()]);
    r.sync({});
    await settle();
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'squat', setNumber: 3 });
    r.ex.setOverride('tyler', SIM().exercises.find(e => e.routineExerciseId === 'squat')!, 2); // re-do done set 2
    await settle();
    expect((r.api.setIpadContext as jest.Mock).mock.calls.at(-1)?.[2]).toMatchObject({ routineExerciseId: 'squat', setNumber: 2 });
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'squat', setNumber: 2, reason: 'override', exact: true });
    const { buildRackView } = require('../lib/rack/viewModel');
    expect(buildRackView({ state: r.ex.getState(), today: [SIM()], rackName: 'Rack 1', nowMs: r.t }).sourceLine).toBe('PICKED ON IPAD');
    r.ex.dispatch({ type: 'rep', rep: ovr(0.7) }, r.advance(5000));
    await settle();
    expect(r.ex.getState().live?.context).toMatchObject({ routineExerciseId: 'squat', setNumber: 2 }); // no guard bump
    r.ex.dispatch({ type: 'ipadDone' }, r.advance(2000));
    await settle();
    expect((r.persist.endSet as jest.Mock).mock.calls.at(-1)?.[0]).toMatchObject({ routineExerciseId: 'squat', setNumber: 2 });
    // used once: the next set follows the normal rules
    expect(r.ex.getState().localContext).toMatchObject({ routineExerciseId: 'squat', setNumber: 3 });
  });
});

describe('wiring: no bare high-water + 1', () => {
  const E = readFileSync(join(__dirname, '..', 'lib/rack/engine.ts'), 'utf8');
  const X = readFileSync(join(__dirname, '..', 'lib/rack/executor.ts'), 'utf8');
  it('the engine/executor never number a set as high-water + 1', () => {
    for (const src of [E, X]) {
      expect(src).not.toMatch(/floor\s*\+\s*1/);
      expect(src).not.toMatch(/[Hh]igh[Ww]ater[^\n]*\+\s*1/);
      expect(src).not.toContain('setHighWater');
      expect(src).not.toContain('nextSetNumberFor');
    }
    expect(X).toContain('resolveRackSet({');
    expect(X).toContain("resolved: true");
  });

  it('behaviour: only set 3 complete (1, 2 skipped), phone on set 1 → set 1, not 4', () => {
    const { reduce } = require('../lib/rack/engine');
    let s = createRackEngine(RACK);
    s = reduce(s, { type: 'sessionSync', row: row({ workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 1 }) }, T0).state;
    s = reduce(s, { type: 'seedHighWater', athleteId: 'tyler', workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 3 }, T0).state;
    s = reduce(s, { type: 'rep', rep: ovr(0.7) }, T0 + 1000).state;
    expect(s.live?.context.setNumber).toBe(1);
  });
});
