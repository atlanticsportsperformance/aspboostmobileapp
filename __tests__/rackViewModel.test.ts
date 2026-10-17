import { createRackEngine, reduce, IDLE_END_MS, type RackEngineState, type RackEvent, type RackSessionRow } from '../lib/rack/engine';
import type { OvrRep } from '../lib/ovr/protocol';
import type { TodayAthlete, TodayExercise } from '../lib/rack/api';
import {
  buildRackView,
  initialsOf,
  localContextFor,
  phoneContextOfRow,
  sensorPillOf,
  shortSensorName,
  SUMMARY_MS,
  velocityScale,
  zoneColor,
} from '../lib/rack/viewModel';

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

const ovr = (v: number, rom = 20): OvrRep => ({ concentricS: 0.5, romIn: rom, meanV: v, peakV: v + 0.3, meanPowerW: 900, peakPowerW: 1800 });

const ex = (over: Partial<TodayExercise>): TodayExercise => ({
  workoutInstanceId: 'wi-1',
  routineExerciseId: 're-squat',
  exerciseId: 'ex-squat',
  name: 'Back Squat',
  sets: 3,
  completedSets: 0,
  zoneMin: 0.45,
  zoneMax: 0.6,
  dropStopPct: 20,
  ...over,
});

const SQUAT = ex({});
const BOX = ex({ routineExerciseId: 're-box', exerciseId: 'ex-box', name: 'Box Jump', zoneMin: null, zoneMax: null, dropStopPct: null });
const athlete = (id: string, first: string, last: string, exercises: TodayExercise[]): TodayAthlete => ({
  athleteId: id,
  firstName: first,
  lastName: last,
  instances: [{ workoutInstanceId: 'wi-1', status: 'not_started', createdAt: iso(T0), exercises, remaining: exercises }],
  exercises,
  remaining: exercises,
});
const TODAY: TodayAthlete[] = [
  athlete('tyler', 'Tyler', 'Reed', [SQUAT, BOX]),
  athlete('jake', 'Jake', 'Moss', [SQUAT, BOX]),
  athlete('cole', 'Cole', 'Burns', [SQUAT]),
  athlete('mason', 'Mason', 'Dee', [SQUAT]),
];

function rig() {
  let s: RackEngineState = createRackEngine(RACK);
  let now = T0;
  const send = (e: RackEvent, at?: number) => {
    if (at !== undefined) now = at;
    s = reduce(s, e, now).state;
  };
  for (const a of TODAY) for (const e of a.exercises) send({ type: 'contextMeta', exerciseId: e.exerciseId, routineExerciseId: e.routineExerciseId, zoneMin: e.zoneMin, zoneMax: e.zoneMax, dropStopPct: e.dropStopPct });
  return {
    send,
    sync: (over: Partial<RackSessionRow> = {}, at?: number) => {
      if (at !== undefined) now = at;
      send({ type: 'sessionSync', row: row({ updated_at: iso(now), ...over }) });
    },
    get s() {
      return s;
    },
    get now() {
      return now;
    },
  };
}

const view = (s: RackEngineState, nowMs = T0, extra: Partial<Parameters<typeof buildRackView>[0]> = {}) =>
  buildRackView({ state: s, today: TODAY, rackName: 'Rack 3', nowMs, ...extra });

describe('rack view model', () => {
  it('empty rack → "Rack 3 is open", no athlete, only addable', () => {
    const r = rig();
    r.sync({ active_athlete_id: null, queue: [], workout_instance_id: null, routine_exercise_id: null, exercise_id: null });
    const v = view(r.s);
    expect(v.open).toBe(true);
    expect(v.statusText).toBe('Rack 3 is open');
    expect(v.athlete).toBeNull();
    expect(v.tiles).toEqual([]);
    expect(v.addable.map(a => a.athleteId)).toEqual(['tyler', 'jake', 'cole', 'mason']);
  });

  it('athlete up from the phone: card, zone, next set, tiles UP NOW / NEXT / #2 IN LINE', () => {
    const r = rig();
    r.sync();
    const v = view(r.s);
    expect(v.open).toBe(false);
    expect(v.statusText).toBe('Tyler is up · lift when ready');
    expect(v.athlete).toEqual({ id: 'tyler', name: 'Tyler Reed', firstName: 'Tyler', initials: 'TR' });
    expect(v.exerciseLine).toBe('Back Squat · Set 1 of 3');
    expect(v.sourceLine).toBe("FROM TYLER'S PHONE");
    expect(v.contextSource).toBe('phone');
    expect(v.loadLb).toBe(205);
    expect(v.zone).toEqual([0.45, 0.6]);
    expect(v.bars).toEqual([]);
    expect(v.tiles.map(t => [t.athleteId, t.status, t.active])).toEqual([
      ['tyler', 'UP NOW', true],
      ['jake', 'NEXT', false],
      ['cole', '#2 IN LINE', false],
    ]);
    expect(v.tiles[1].subtitle).toBe('Back Squat · Set 1/3');
    expect(v.addable.map(a => a.athleteId)).toEqual(['mason']);
  });

  it('reps: zone colours, partial dimmed "—" and not counted, drop % + drop line, drop cue', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.55) }, T0 + 1000);
    r.send({ type: 'rep', rep: ovr(0.5, 3) }, T0 + 4000); // partial (< 8 in, first set)
    r.send({ type: 'rep', rep: ovr(0.42) }, T0 + 7000); // slow, 24% drop
    const v = view(r.s, r.now);
    expect(v.lifting).toBe(true);
    expect(v.statusText).toBe('Tyler is up · lifting');
    expect(v.bars.map(b => [b.label, b.partial, b.zone])).toEqual([
      ['0.55', false, 'in'],
      ['—', true, null],
      ['0.42', false, 'slow'],
    ]);
    expect(v.fullReps).toBe(2);
    expect(v.bestV).toBe(0.55);
    expect(v.dropPct).toBe(24);
    expect(v.dropCue).toBe(true);
    expect(v.dropLineV).toBeCloseTo(0.44);
    expect(v.lastRep).toMatchObject({ v: 0.42, partial: false, zone: 'slow' });
  });

  it('no zone → neutral: no zone, no drop line, no cue', () => {
    const r = rig();
    r.sync({ routine_exercise_id: 're-box', exercise_id: 'ex-box' });
    r.send({ type: 'rep', rep: ovr(0.9) }, T0 + 1000);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 3000);
    const v = view(r.s, r.now);
    expect(v.zone).toBeNull();
    expect(v.dropLineV).toBeNull();
    expect(v.dropCue).toBe(false);
    expect(v.bars.every(b => b.zone === null)).toBe(true);
  });

  it('idle end → summary "SET 1 SAVED · 60 S NO REPS" that stays up', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.55) }, T0 + 1000);
    r.send({ type: 'rep', rep: ovr(0.5) }, T0 + 3000);
    r.send({ type: 'tick' }, T0 + 3000 + IDLE_END_MS);
    const v = view(r.s, r.now + 10 * SUMMARY_MS);
    expect(v.summary).toMatchObject({
      title: 'SET 1 SAVED · 60 S NO REPS',
      big: '205 lb × 2',
      avg: '0.53',
      best: '0.55',
      drop: '9%',
      footer: 'Saved · tap to edit on the phone',
    });
    expect(v.bars).toHaveLength(2); // the ended set stays on screen
  });

  it('iPad Done → summary that auto-hides after SUMMARY_MS', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'rep', rep: ovr(0.55) }, T0 + 1000);
    r.send({ type: 'ipadDone' }, T0 + 2000);
    expect(view(r.s, T0 + 2500).summary?.title).toBe('SET 1 SAVED · DONE ON IPAD');
    expect(view(r.s, T0 + 2500).summary?.footer).toBe('Next up: Jake');
    expect(view(r.s, T0 + 2000 + SUMMARY_MS + 1).summary).toBeNull();
  });

  it('next set number honours the high-water mark', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'seedHighWater', athleteId: 'tyler', workoutInstanceId: 'wi-1', routineExerciseId: 're-squat', setNumber: 2 });
    expect(view(r.s).setNumber).toBe(3);
    expect(view(r.s).exerciseLine).toBe('Back Squat · Set 3 of 3');
  });

  it('iPad pick (localContext) when the phone sent nothing → PICKED ON THE IPAD', () => {
    const r = rig();
    r.sync({ workout_instance_id: null, routine_exercise_id: null, exercise_id: null, set_number: null, load_lb: null });
    expect(view(r.s).sourceLine).toBe('FREE LIFT');
    r.send(localContextFor('tyler', BOX));
    const v = view(r.s);
    expect(v.sourceLine).toBe('PICKED ON THE IPAD');
    expect(v.exerciseName).toBe('Box Jump');
    expect(v.remaining.map(e => e.name)).toEqual(['Back Squat', 'Box Jump']);
  });

  it('switching shows on the status line and the target tile', () => {
    const r = rig();
    r.sync();
    r.send({ type: 'selectAthlete', athleteId: 'cole' });
    const v = view(r.s);
    expect(v.statusText).toBe('Switching to Cole…');
    expect(v.tiles.find(t => t.athleteId === 'cole')?.switching).toBe(true);
  });

  it('a queued athlete whose phone is on a non-rack exercise is dimmed "On Box Jump"', () => {
    const r = rig();
    r.sync();
    const v = view(r.s, T0, { phoneContexts: { jake: { workoutInstanceId: 'wi-1', routineExerciseId: 're-box', exerciseId: 'ex-box', setNumber: 1, loadLb: null } } });
    const jake = v.tiles.find(t => t.athleteId === 'jake')!;
    expect(jake).toMatchObject({ away: true, subtitle: 'On Box Jump', status: 'NEXT' });
    expect(v.tiles.find(t => t.athleteId === 'tyler')!.away).toBe(false);
  });

  it('phoneContextOfRow prefers the pending (newest) phone context', () => {
    const r = rig();
    r.sync({ pending_workout_instance_id: 'wi-1', pending_routine_exercise_id: 're-box', pending_set_number: 1 });
    expect(phoneContextOfRow(r.s)).toEqual({
      athleteId: 'tyler',
      ctx: { workoutInstanceId: 'wi-1', routineExerciseId: 're-box', exerciseId: 'ex-box', setNumber: 1, loadLb: null },
    });
  });
});

describe('rack view helpers', () => {
  it('zone colours: blue / red / faint white; never gold', () => {
    expect(zoneColor('in')).toBe('#9BDDFF');
    expect(zoneColor('slow')).toBe('#E5534B');
    expect(zoneColor('fast')).toBe('rgba(255,255,255,0.9)');
    expect(zoneColor(null)).toBe('#ffffff');
  });
  it('velocity scale is 1.0 m/s unless something is faster', () => {
    expect(velocityScale(0.6, 0.9)).toBe(1);
    expect(velocityScale(1.2)).toBe(1.5);
    expect(velocityScale(null, undefined)).toBe(1);
  });
  it('sensor pill: connected / reconnecting / not paired', () => {
    expect(shortSensorName('OVR_Velocity-6C8E')).toBe('OVR-6C8E');
    expect(sensorPillOf('connected', 'OVR_Velocity-6C8E', null)).toEqual({ kind: 'connected', label: 'OVR-6C8E connected' });
    expect(sensorPillOf('reconnecting', undefined, 'OVR_Velocity-6C8E').kind).toBe('reconnecting');
    expect(sensorPillOf('scanning', undefined, null).kind).toBe('reconnecting');
    expect(sensorPillOf('idle', undefined, null)).toEqual({ kind: 'notPaired', label: 'Sensor not paired' });
  });
  it('initials', () => {
    expect(initialsOf('Tyler', 'Reed')).toBe('TR');
    expect(initialsOf('', '')).toBe('?');
  });
});
