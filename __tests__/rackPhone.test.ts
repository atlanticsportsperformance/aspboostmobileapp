import {
  CONTEXT_DEBOUNCE_MS,
  LOAD_EDIT_GUARD_MS,
  RACK_COLORS,
  applyRackLog,
  bannerState,
  chipTone,
  chipViews,
  createContextSender,
  endedByIdle,
  endedSets,
  firstIncompleteSet,
  followTarget,
  contextLoad,
  contextSig,
  fullRepCount,
  liveDoneLabel,
  liveRackSet,
  liveTag,
  loadSyncValue,
  newerRow,
  pressDone,
  rackContextOf,
  rackErrorText,
  rackSafeWrite,
  rackSummaryLine,
  speedDropCue,
  zoneOf,
  type PhoneContext,
} from '../lib/rack/phoneView';
import { addRepRow, type ChipSet, type RepChip } from '../lib/rack/phone';
import type { RackListItem } from '../lib/rack/api';
import type { RackSessionRow } from '../lib/rack/engine';
import { logToSetInputs } from '../lib/loggerResume';

const chip = (i: number, v: number, partial = false): RepChip => ({
  clientRepId: `r${i}`,
  repIndex: i,
  v,
  pv: v + 0.2,
  rom: 20,
  partial,
  loadLb: 205,
  receivedAt: '2026-10-17T15:00:00Z',
});

const session = (over: Partial<RackSessionRow> = {}): RackSessionRow => ({
  rack_id: 'rack3',
  active_athlete_id: 'me',
  workout_instance_id: 'wi',
  routine_exercise_id: 'squat',
  exercise_id: 'ex-squat',
  set_number: 2,
  load_lb: 205,
  state: 'idle',
  queue: [],
  set_started_at: null,
  pending_workout_instance_id: null,
  pending_routine_exercise_id: null,
  pending_set_number: null,
  pending_load_lb: null,
  leave_requested: false,
  pending_end: false,
  updated_at: '2026-10-17T15:00:00Z',
  ...over,
});

describe('vbt_reps → chips', () => {
  const zone = zoneOf(0.7, 0.9);

  it('zone colours: in zone blue, slow red, fast faint white; partial = dashed "part"', () => {
    const views = chipViews([chip(1, 0.8), chip(2, 0.6), chip(3, 1.1), chip(4, 0.5, true)], zone);
    expect(views.map(v => v.tone)).toEqual(['in', 'slow', 'fast', 'part']);
    expect(views[0]).toMatchObject({ label: '0.80', color: '#9BDDFF', backgroundColor: 'rgba(155,221,255,0.12)', dashedBorder: null });
    expect(views[1]).toMatchObject({ color: '#E5534B' });
    expect(views[2]).toMatchObject({ backgroundColor: 'rgba(255,255,255,0.08)' });
    expect(views[3]).toMatchObject({ label: 'part', dashedBorder: RACK_COLORS.partBorder });
  });

  it('no zone → every full rep is plain faint white', () => {
    expect(zoneOf(null, undefined)).toBeNull();
    expect(chipTone(chip(1, 0.2), null)).toBe('plain');
    expect(chipViews([chip(1, 1.5)], null)[0].backgroundColor).toBe(RACK_COLORS.fastBg);
  });

  it('one bound is still a zone', () => {
    expect(chipTone(chip(1, 0.6), zoneOf(0.7, null))).toBe('slow');
    expect(chipTone(chip(1, 2), zoneOf(0.7, null))).toBe('in');
  });

  it('REPS = full reps only; Done label', () => {
    const chips = [chip(1, 0.8), chip(2, 0.5, true), chip(3, 0.79)];
    expect(fullRepCount(chips)).toBe(2);
    expect(liveDoneLabel(2)).toBe('✓ Done · 2 reps');
    expect(liveDoneLabel(1)).toBe('✓ Done · 1 rep');
  });

  it('rows → chips through the realtime reducer (dedupe + order) → views', () => {
    const sets = new Map<string, ChipSet>();
    const row = (i: number, v: number, partial = false) => ({
      client_rep_id: `c${i}`, rack_id: 'rack3', workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 2,
      rep_index: i, load_lb: 205, mean_velocity: v, peak_velocity: v, rom_in: 20, is_partial: partial, received_at: 't',
    });
    addRepRow(sets, row(2, 0.6));
    addRepRow(sets, row(1, 0.8));
    addRepRow(sets, row(1, 0.8)); // duplicate delivery
    addRepRow(sets, row(3, 0.4, true));
    const chips = sets.get('wi:squat:2')!.chips;
    expect(chips.map(c => c.repIndex)).toEqual([1, 2, 3]);
    expect(fullRepCount(chips)).toBe(2);
    expect(chipViews(chips, zone).map(v => v.tone)).toEqual(['in', 'slow', 'part']);
  });

  it('speed-drop cue only with a zone, at the threshold (default 20%)', () => {
    const chips = [chip(1, 1.0), chip(2, 0.9), chip(3, 0.79)];
    expect(speedDropCue(chips, null, 20)).toBeNull();
    expect(speedDropCue(chips, zone, null)).toBe(20);
    expect(speedDropCue(chips, zone, 25)).toBeNull();
    expect(speedDropCue([chip(1, 1.0), chip(2, 0.5, true)], zone, 20)).toBeNull(); // partials don't count
  });

  it('live tag is source-agnostic (Task 10b sensor)', () => {
    expect(liveTag('rack', 'Rack 3')).toBe('RACK 3 · LIVE');
    expect(liveTag('sensor', null)).toBe('SENSOR · LIVE');
  });
});

describe('banner state from rack_list_for_me', () => {
  const list: RackListItem[] = [
    { rackId: 'rack1', name: 'Rack 1', activeAthleteFirstName: 'Jake', state: 'lifting', queuePositionOfCaller: null },
    { rackId: 'rack3', name: 'Rack 3', activeAthleteFirstName: 'Tyler', state: 'idle', queuePositionOfCaller: 2 },
  ];

  it('no racks → no banner', () => {
    expect(bannerState([], [], 'me')).toBeNull();
  });

  it('not on a rack → browse list with each rack’s state', () => {
    const b = bannerState(list.map(r => ({ ...r, queuePositionOfCaller: null })), [], 'me')!;
    expect(b.mode).toBe('browse');
    expect(b.racks).toEqual([
      { rackId: 'rack1', name: 'Rack 1', status: 'Jake lifting' },
      { rackId: 'rack3', name: 'Rack 3', status: 'Tyler lifting' },
    ]);
    const open = bannerState([{ ...list[0], activeAthleteFirstName: null }], [], 'me')!;
    expect(open.racks[0].status).toBe('open');
  });

  it('queued → "Rack 3 · Tyler is lifting / You’re #2 in line"', () => {
    const b = bannerState(list, [session({ active_athlete_id: 'tyler', queue: ['jake', 'me'] })], 'me')!;
    expect(b).toMatchObject({ mode: 'queued', rackId: 'rack3', title: 'Rack 3 · Tyler is lifting', subtitle: 'You’re #2 in line' });
  });

  it('active → "Rack 3 · you’re up" + who is waiting', () => {
    const b = bannerState(list, [session({ queue: ['jake'] })], 'me')!;
    expect(b).toMatchObject({ mode: 'active', rackId: 'rack3', title: 'Rack 3 · you’re up', subtitle: '1 waiting' });
    expect(bannerState(list, [session()], 'me')!.subtitle).toBe('Nobody waiting');
    const named = list.map(r => (r.rackId === 'rack3' ? { ...r, nextAthleteFirstName: 'Jake' } : r));
    expect(bannerState(named, [session({ queue: ['jake'] })], 'me')!.subtitle).toBe('Jake is next');
  });

  it('55000 "already on Rack X" shows inline; other errors are generic', () => {
    expect(rackErrorText({ code: '55000', message: 'rack_join: already on Rack 1' })).toBe('Already on Rack 1');
    expect(rackErrorText({ code: '42501', message: 'nope' })).toBe('Couldn’t reach the rack — try again');
  });
});

describe('phone context sender (debounced 300 ms, active only)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const ctx = (setNumber: number, loadLb: number | null = 205): PhoneContext => ({
    workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber, loadLb,
  });

  it('a burst of changes sends once, the last value, after 300 ms', () => {
    const send = jest.fn();
    const s = createContextSender(send);
    s.update('rack3', ctx(1));
    jest.advanceTimersByTime(100);
    s.update('rack3', ctx(1, 210));
    jest.advanceTimersByTime(100);
    s.update('rack3', ctx(2, 215));
    jest.advanceTimersByTime(CONTEXT_DEBOUNCE_MS - 1);
    expect(send).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('rack3', ctx(2, 215));
  });

  it('never sends while not active; going inactive cancels a pending send', () => {
    const send = jest.fn();
    const s = createContextSender(send);
    s.update(null, ctx(1));
    s.update('rack3', ctx(1));
    s.update(null, null);
    jest.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
  });

  it('an unchanged context is not resent; re-activation resends', () => {
    const send = jest.fn();
    const s = createContextSender(send);
    s.update('rack3', ctx(1));
    jest.advanceTimersByTime(300);
    s.update('rack3', ctx(1));
    jest.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledTimes(1);
    s.update(null, null);
    s.update('rack3', ctx(1));
    jest.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('Done while live', () => {
  it('calls rack_request_end_set and waits for the rack’s row — never the set save', () => {
    const deps = { requestEndSet: jest.fn(() => Promise.resolve()), saveSet: jest.fn(), awaitRackWrite: jest.fn() };
    expect(pressDone({ rackId: 'rack3', lifting: true }, deps)).toBe('rack');
    expect(deps.requestEndSet).toHaveBeenCalledWith('rack3');
    expect(deps.awaitRackWrite).toHaveBeenCalledTimes(1);
    expect(deps.saveSet).not.toHaveBeenCalled();
  });

  it('not lifting / no rack → the phone’s normal save', () => {
    const deps = { requestEndSet: jest.fn(() => Promise.resolve()), saveSet: jest.fn(), awaitRackWrite: jest.fn() };
    expect(pressDone({ rackId: 'rack3', lifting: false }, deps)).toBe('save');
    expect(pressDone(null, deps)).toBe('save');
    expect(deps.requestEndSet).not.toHaveBeenCalled();
    expect(deps.saveSet).toHaveBeenCalledTimes(2);
  });

  it('a refused end request never throws out of Done', async () => {
    const deps = { requestEndSet: jest.fn(() => Promise.reject(new Error('x'))), saveSet: jest.fn(), awaitRackWrite: jest.fn() };
    expect(() => pressDone({ rackId: 'rack3', lifting: true }, deps)).not.toThrow();
    await Promise.resolve();
  });
});

describe('live row keyed off rack_sessions (I1)', () => {
  it('the lifted set is rack_sessions.routine_exercise_id + set_number, never the phone’s open row', () => {
    const s = session({ state: 'lifting', set_number: 2 });
    expect(liveRackSet(s, 'me', 'wi')).toEqual({ routineExerciseId: 'squat', setNumber: 2 });
    // the phone has set 3 open — the live row is still set 2
    expect(liveRackSet(s, 'me', 'wi')!.setNumber).toBe(2);
  });
  it('only while lifting, only for me, only this workout', () => {
    expect(liveRackSet(session({ state: 'idle' }), 'me', 'wi')).toBeNull();
    expect(liveRackSet(session({ state: 'lifting', active_athlete_id: 'tyler' }), 'me', 'wi')).toBeNull();
    expect(liveRackSet(session({ state: 'lifting', workout_instance_id: 'other' }), 'me', 'wi')).toBeNull();
    expect(liveRackSet(session({ state: 'lifting', set_number: null }), 'me', 'wi')).toBeNull();
    expect(liveRackSet(null, 'me', 'wi')).toBeNull();
  });
});

describe('rack-owned sets (C1)', () => {
  it('race: a set the rack ended but whose row has not landed → the phone’s Done writes no is_complete / reps', () => {
    // auto-fill put the prescribed reps in; the rack's row (measured reps) may already be in
    const w = rackSafeWrite({ complete: true, fields: ['reps', 'weight'] }, true);
    expect(w.complete).toBeUndefined();
    expect(w.fields).toEqual(['weight']);
    const rpe = rackSafeWrite({ rpe: true, fields: [] }, true);
    expect(rpe).toEqual({ rpe: true, fields: [] });
  });
  it('a set the rack does not own saves as before', () => {
    const w = { complete: true, fields: ['reps'] };
    expect(rackSafeWrite(w, false)).toBe(w);
  });
});

describe('phone ↔ iPad in unison', () => {
  const T = 1_000_000;
  const sender = (sent: { re: string; set: number | null; load: number | null }[] = []) => {
    const s = createContextSender(() => new Promise(() => undefined), 0, {
      setTimeout: (fn: () => void) => { fn(); return 1; },
      clearTimeout: () => undefined,
    });
    sent.forEach(c => s.update('rack3', { workoutInstanceId: 'wi', routineExerciseId: c.re, setNumber: c.set, loadLb: c.load }));
    return s;
  };
  const follow = (over: Partial<Parameters<typeof followTarget>[0]> = {}) =>
    followTarget({
      session: session({ routine_exercise_id: 'bench', set_number: 1, load_lb: 135 }),
      prevRackExercise: 'squat',
      sentThisActivation: true,
      athleteId: 'me',
      workoutInstanceId: 'wi',
      openExerciseId: 'squat',
      isEcho: sender([{ re: 'squat', set: 2, load: 205 }]).isEcho,
      ...over,
    });

  it('iPad override → the phone follows (exercise screen and overview)', () => {
    expect(follow()).toBe('bench');
    expect(follow({ openExerciseId: null })).toBe('bench');
  });

  it('no echo loop: an exact match of a context the phone sent (last or in flight) is ignored', () => {
    // phone sent bench/1/135 then moved on — the late echo of bench is not an override
    const s1 = sender([{ re: 'bench', set: 1, load: 135 }, { re: 'deadlift', set: 1, load: 225 }]);
    expect(follow({ openExerciseId: 'deadlift', isEcho: s1.isEcho })).toBeNull();
    // same exercise but a different set/load is a real iPad change → followed (no time window)
    const s2 = sender([{ re: 'bench', set: 2, load: 135 }]);
    expect(follow({ openExerciseId: 'deadlift', isEcho: s2.isEcho })).toBe('bench');
    expect(contextSig({ workoutInstanceId: 'wi', routineExerciseId: 'bench', setNumber: 1, loadLb: 135 })).toBe('bench|1|135');
  });

  it('first read of an activation is the baseline; null→X (the iPad’s auto-pick) after the phone sent is not an override (I3)', () => {
    expect(follow({ prevRackExercise: undefined })).toBeNull();
    expect(follow({ prevRackExercise: null, autoPickExerciseId: 'bench' })).toBeNull();
    expect(follow({ prevRackExercise: null, sentThisActivation: false, openExerciseId: null })).toBe('bench');
  });

  it('N4: after an empty context (finished exercise), a real coach override null→Y is still followed', () => {
    // The phone finished squat and sent an empty context; its own resolver says the iPad's auto-pick is RDL.
    expect(follow({ prevRackExercise: null, openExerciseId: 'squat', autoPickExerciseId: 'rdl' })).toBe('bench');
    // The iPad publishing exactly that auto-pick is not an override.
    expect(
      follow({ prevRackExercise: null, openExerciseId: 'squat', autoPickExerciseId: 'rdl', session: session({ routine_exercise_id: 'rdl', set_number: 1 }) }),
    ).toBeNull();
    // Nothing left to auto-pick (none) → any null→Y is the coach.
    expect(follow({ prevRackExercise: null, openExerciseId: null, autoPickExerciseId: null })).toBe('bench');
  });

  it('only on a change, only while active, only for this workout', () => {
    expect(follow({ prevRackExercise: 'bench' })).toBeNull();
    expect(follow({ openExerciseId: 'bench' })).toBeNull();
    expect(follow({ session: session({ routine_exercise_id: 'bench', active_athlete_id: 'tyler' }) })).toBeNull();
    expect(follow({ session: session({ routine_exercise_id: 'bench', workout_instance_id: 'other' }) })).toBeNull();
  });

  it('mid-set the pending group (exercise, set, load) is the rack’s next context (I4c)', () => {
    const s = session({ state: 'lifting', routine_exercise_id: 'squat', set_number: 2, load_lb: 205, pending_routine_exercise_id: 'bench', pending_set_number: 3, pending_load_lb: 145 });
    expect(rackContextOf(s)).toEqual({ workoutInstanceId: 'wi', routineExerciseId: 'bench', setNumber: 3, loadLb: 145 });
    expect(follow({ session: s })).toBe('bench');
  });

  it('the sender: immediate on activation, debounced otherwise; paused keeps the echo memory', () => {
    jest.useFakeTimers();
    const send = jest.fn(() => Promise.resolve());
    const s = createContextSender(send);
    const c = { workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 1, loadLb: null };
    s.update('rack3', c, { immediate: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(s.sentThisActivation()).toBe(true);
    s.update('rack3', null); // overview
    expect(s.isEcho({ ...c })).toBe(true);
    s.update(null, null); // left the rack
    expect(s.sentThisActivation()).toBe(false);
    jest.useRealTimers();
  });

  it('context load: the athlete’s own LB only — never the prescription; else the rack’s load passes through (I4b)', () => {
    const rack = { workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 2, loadLb: 215 };
    expect(contextLoad({ ownWeight: '225', rack, routineExerciseId: 'squat', setNumber: 2 })).toBe(225);
    expect(contextLoad({ ownWeight: null, rack, routineExerciseId: 'squat', setNumber: 2 })).toBe(215);
    expect(contextLoad({ ownWeight: null, rack, routineExerciseId: 'squat', setNumber: 3 })).toBeNull();
  });

  it('a late row never rolls the rack back', () => {
    const a = session({ updated_at: '2026-10-17T15:00:02Z' });
    expect(newerRow(a, session({ updated_at: '2026-10-17T15:00:01Z' }))).toBe(false);
    expect(newerRow(a, session({ updated_at: '2026-10-17T15:00:03Z' }))).toBe(true);
  });

  it('load sync respects the 3 s edit guard; a phone edit wins', () => {
    const at = (over: Partial<Parameters<typeof loadSyncValue>[0]>) =>
      loadSyncValue({ rackLoad: 225, prevRackLoad: 205, phoneLoad: 205, lastEditAt: 0, now: T, ...over });
    expect(at({})).toBe(225);
    expect(at({ lastEditAt: T - (LOAD_EDIT_GUARD_MS - 1) })).toBeNull();
    expect(at({ lastEditAt: T - LOAD_EDIT_GUARD_MS })).toBe(225);
    expect(at({ phoneLoad: 225 })).toBeNull(); // echo of the phone's own LB
    expect(at({ prevRackLoad: 225 })).toBeNull(); // not a change
    expect(at({ prevRackLoad: undefined })).toBeNull(); // first read
    expect(at({ rackLoad: null })).toBeNull();
    expect(at({ editing: true })).toBeNull(); // never while the keypad is open (M1)
  });

  it('a rack-written log marks the row complete without a reopen, fills reps + LB, opens the next set', () => {
    const log = {
      workout_instance_id: 'wi', routine_exercise_id: 'squat', set_number: 2, is_complete: true,
      actual_reps: 3, actual_weight: 225,
      metric_data: { vbt: { source: 'rack', rack: 'rack3', ended_by: 'phone', reps: [], avg_v: 0.8, best_v: 0.85 } },
    };
    expect(rackSummaryLine(log.metric_data.vbt)).toBe('avg 0.80 · best 0.85 m/s');
    expect(rackSummaryLine(undefined)).toBeNull();
    const res = applyRackLog({
      inputs: [{ reps: '3', weight: '205' }, { reps: '3', weight: '215' }, {}],
      completed: [true, false, false],
      sets: 3,
      log,
      toInputs: logToSetInputs,
    })!;
    expect(res.completed).toEqual([true, true, false]);
    expect(res.inputs[1]).toMatchObject({ reps: 3, weight: 225 });
    expect(res.setIndex).toBe(1);
    expect(res.nextIndex).toBe(2);
    expect(res.wasDone).toBe(false);
    expect(res.idle).toBe(false);
  });

  it('idle-ended set is flagged ("Saved · tap to edit"); out-of-range rows are ignored', () => {
    const log = { set_number: 1, is_complete: true, metric_data: { vbt: { source: 'rack', ended_by: 'idle' } } };
    expect(endedByIdle(log)).toBe(true);
    expect(applyRackLog({ inputs: [], completed: [], sets: 2, log, toInputs: logToSetInputs })!.idle).toBe(true);
    expect(applyRackLog({ inputs: [], completed: [], sets: 2, log: { ...log, set_number: 3 }, toInputs: logToSetInputs })).toBeNull();
  });

  it('current set = first incomplete set (the context’s set_number)', () => {
    expect(firstIncompleteSet([true, false, false], 3)).toBe(1);
    expect(firstIncompleteSet(undefined, 3)).toBe(0);
    expect(firstIncompleteSet([true, true], 2)).toBeNull();
  });

  it('a set stopping being lifted is reported once (then the phone refetches its row)', () => {
    const lifting = session({ state: 'lifting', set_started_at: 't1' });
    expect(endedSets([lifting], [session({ state: 'summary' })], 'me')).toEqual([
      { rackId: 'rack3', workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 2 },
    ]);
    expect(endedSets([lifting], [lifting], 'me')).toEqual([]);
    expect(endedSets([lifting], [], 'me')).toHaveLength(1); // left the rack mid-set
    expect(endedSets([session()], [session({ state: 'lifting' })], 'me')).toEqual([]);
  });
});

// ---------------------------------------------------------------- fix round 1: the rack's set on the phone
import { followOnFinish, phoneRackNow, rackStripLine, withRackSet } from '../lib/rack/phoneView';
import { rackInstanceFromLogger, rackLogsFromCompleted } from '../lib/rack/resolveRackSet';

describe('phoneRackNow / followOnFinish / banner strip', () => {
  const reRow = (id: string, lift: boolean) => ({
    id, exercise_id: `ex-${id}`, sets: 3, velocity_min_mps: null, velocity_max_mps: null,
    enabled_measurements: lift ? ['weight'] : ['reps'], exercises: { name: id, is_placeholder: false },
  });
  const instance = rackInstanceFromLogger('wi', [{ id: 'r', scheme: 'straight', routine_exercises: [reRow('squat', true), reRow('box', false), reRow('rdl', true)] }] as any);
  const sess = (over: any = {}) => ({
    active_athlete_id: 'me', workout_instance_id: 'wi', routine_exercise_id: null, state: 'idle', set_number: null, load_lb: null,
    pending_workout_instance_id: null, pending_routine_exercise_id: null, pending_set_number: null, pending_load_lb: null, ...over,
  });
  const now = (over: any = {}) =>
    phoneRackNow({ instance, logs: rackLogsFromCompleted('wi', { squat: [true, true, true] }), session: sess(), athleteId: 'me', workoutInstanceId: 'wi', openExerciseId: null, isEcho: () => false, ...over });

  it('overview: the resolver’s rack lift (skips the non-lift); exercise screen: the open exercise wins', () => {
    expect(now()).toEqual({ routineExerciseId: 'rdl', setNumber: 1, source: 'rack' });
    expect(now({ openExerciseId: 'box' })).toEqual({ routineExerciseId: 'box', setNumber: 1, source: 'phone' });
  });

  it('a coach pick in the row (not the phone’s echo, not the auto-pick) is the override; lifting = the row’s live set', () => {
    expect(now({ session: sess({ routine_exercise_id: 'box', set_number: 1 }) })).toMatchObject({ routineExerciseId: 'box', source: 'ipad' });
    // the phone's own echo is its last-sent context (N1) → the phone's exercise, not a coach pick
    expect(now({ session: sess({ routine_exercise_id: 'box', set_number: 1 }), isEcho: () => true })).toMatchObject({ routineExerciseId: 'box', source: 'phone' });
    expect(now({ session: sess({ state: 'lifting', routine_exercise_id: 'squat', set_number: 4 }) })).toEqual({ routineExerciseId: 'squat', setNumber: 4, source: 'live' });
  });

  /** Drive followOnFinish through a sequence of screen states; returns every follow. */
  const run = (steps: { openId: string | null; finished: boolean; active: boolean; blockHasMore?: boolean }[]) => {
    const rackNow = { routineExerciseId: 'rdl', setNumber: 1, source: 'rack' as const };
    let prev: any = null;
    return steps.map(st => {
      const { track, follow } = followOnFinish({ ...st, blockHasMore: !!st.blockHasMore, prev, rackNow });
      prev = track;
      return follow;
    });
  };

  it('N2: follows once when an exercise opened UNFINISHED becomes finished during this open', () => {
    expect(run([
      { openId: 'squat', finished: false, active: true },
      { openId: 'squat', finished: true, active: true },
      { openId: 'squat', finished: true, active: true },
    ])).toEqual([null, 'rdl', null]);
  });

  it('N2: finished while queued → followed when the athlete becomes active', () => {
    expect(run([
      { openId: 'squat', finished: false, active: false },
      { openId: 'squat', finished: true, active: false },
      { openId: 'squat', finished: true, active: true },
    ])).toEqual([null, null, 'rdl']);
  });

  it('N2: a kid who opens a FINISHED exercise to edit it is never pulled away — promotion, un-check/re-check included', () => {
    expect(run([
      { openId: 'squat', finished: true, active: false }, // opened finished to fix a weight, queued
      { openId: 'squat', finished: true, active: true }, // promoted by the queue
      { openId: 'squat', finished: false, active: true }, // un-checks the last set
      { openId: 'squat', finished: true, active: true }, // re-checks it
    ])).toEqual([null, null, null, null]);
  });

  it('N2: an un-check/re-check after the first finish never follows again; a block with sets left never follows', () => {
    expect(run([
      { openId: 'squat', finished: false, active: false },
      { openId: 'squat', finished: true, active: false },
      { openId: 'squat', finished: false, active: false },
      { openId: 'squat', finished: true, active: true },
    ])).toEqual([null, null, null, null]);
    expect(run([
      { openId: 'a1', finished: false, active: true },
      { openId: 'a1', finished: true, active: true, blockHasMore: true },
    ])).toEqual([null, null]);
  });

  it('N1: on the overview the phone resolves from its own last-sent context (the iPad’s phone input)', () => {
    // opened DB-Bulgarian-like "box" (sent box:1), back on the overview
    const s = sess({ routine_exercise_id: 'box', set_number: 1 });
    expect(now({ session: s, isEcho: (c: any) => c.routineExerciseId === 'box' && c.setNumber === 1 })).toEqual({ routineExerciseId: 'box', setNumber: 1, source: 'phone' });
    // after finishing squat it sent squat:4 → the next rack lift
    const s4 = sess({ routine_exercise_id: 'squat', set_number: 4 });
    expect(now({ session: s4, isEcho: () => true })).toMatchObject({ routineExerciseId: 'rdl', setNumber: 1 });
  });

  it('the strip is the iPad card’s wording; only the active banner carries it', () => {
    expect(rackStripLine('Rack 1', 'Romanian Deadlift', 1, 3)).toBe('Rack 1 · Romanian Deadlift · Set 1 of 3');
    const active = { mode: 'active' as const, rackId: 'r', title: 'Rack 1 · you’re up', subtitle: 'Nobody waiting', racks: [] };
    expect(withRackSet(active, 'X')?.rackSet).toBe('X');
    expect(withRackSet({ ...active, mode: 'queued' }, 'X')?.rackSet).toBeUndefined();
  });

  it('I4: after the phone finished squat (sent squat:4), the iPad’s auto-pick is not an override', () => {
    expect(
      followTarget({
        session: session({ routine_exercise_id: 'rdl', set_number: 1 }) as any,
        prevRackExercise: 'squat',
        sentThisActivation: true,
        athleteId: 'me',
        workoutInstanceId: 'wi',
        openExerciseId: 'squat',
        isEcho: () => false,
        autoPickExerciseId: 'rdl',
        isFinishedOnPhone: re => re === 'squat',
      }),
    ).toBeNull();
  });
});

describe('fix round 3: the phone follows a coach’s exact set; a finished open never moves the strip', () => {
  const { coachSetChoice, phoneRackNow } = require('../lib/rack/phoneView');
  const { rackInstanceFromLogger, rackLogsFromCompleted } = require('../lib/rack/resolveRackSet');
  const ctx = (re: string, set: number) => ({ workoutInstanceId: 'wi', routineExerciseId: re, setNumber: set, loadLb: null });

  it('coachSetChoice: a new iPad row that is not the phone’s echo nor the auto-pick → that exact set', () => {
    const base = { workoutInstanceId: 'wi', isEcho: () => false, autoPick: { routineExerciseId: 'rdl', setNumber: 2 } };
    expect(coachSetChoice({ ...base, ctx: ctx('squat', 2), prev: { exercise: 'rdl', set: 2 } })).toEqual({ routineExerciseId: 'squat', setNumber: 2 });
    expect(coachSetChoice({ ...base, ctx: ctx('rdl', 1), prev: { exercise: 'rdl', set: 2 } })).toEqual({ routineExerciseId: 'rdl', setNumber: 1 }); // same exercise, set change
    expect(coachSetChoice({ ...base, ctx: ctx('rdl', 2), prev: { exercise: 'squat', set: 4 } })).toBeNull(); // the auto-pick
    expect(coachSetChoice({ ...base, ctx: ctx('squat', 2), prev: { exercise: 'rdl', set: 2 }, isEcho: () => true })).toBeNull();
    expect(coachSetChoice({ ...base, ctx: ctx('squat', 2), prev: undefined })).toBeNull(); // baseline
    expect(coachSetChoice({ ...base, ctx: ctx('squat', 2), prev: { exercise: 'squat', set: 2 } })).toBeNull(); // unchanged
  });

  it('phoneRackNow: a finished exercise open → the rack’s set; a chosen set → exactly it (even done)', () => {
    const reRow = (id: string) => ({ id, exercise_id: `ex-${id}`, sets: 3, velocity_min_mps: null, velocity_max_mps: null, enabled_measurements: ['weight'], exercises: { name: id, is_placeholder: false } });
    const instance = rackInstanceFromLogger('wi', [{ id: 'r', scheme: 'straight', routine_exercises: [reRow('squat'), reRow('rdl')] }]);
    const logs = rackLogsFromCompleted('wi', { squat: [true, true, true], rdl: [true, false, false] });
    const sess = { active_athlete_id: 'me', workout_instance_id: 'wi', routine_exercise_id: 'rdl', set_number: 2, state: 'idle', load_lb: null, pending_workout_instance_id: null, pending_routine_exercise_id: null, pending_set_number: null, pending_load_lb: null };
    const base = { instance, logs, session: sess, athleteId: 'me', workoutInstanceId: 'wi', isEcho: () => false };
    expect(phoneRackNow({ ...base, openExerciseId: 'squat' })).toMatchObject({ routineExerciseId: 'rdl', setNumber: 2 });
    expect(phoneRackNow({ ...base, openExerciseId: null, chosen: { routineExerciseId: 'squat', setNumber: 2 } })).toMatchObject({ routineExerciseId: 'squat', setNumber: 2, source: 'ipad' });
  });
});

describe('REGRESSION (owner): strip showed "Box Jump · Set 5 of 4" while the iPad showed Back Squat · Set 1 of 3', () => {
  const { createContextSender, coachSetChoice, phoneRackNow, rackStripLine } = require('../lib/rack/phoneView');
  const { rackInstanceFromLogger, rackLogsFromCompleted } = require('../lib/rack/resolveRackSet');
  const reRow = (id: string, sets: number, lift: boolean) => ({
    id, exercise_id: `ex-${id}`, sets, velocity_min_mps: null, velocity_max_mps: null,
    enabled_measurements: lift ? ['weight', 'reps'] : ['reps'], exercises: { name: id, is_placeholder: false },
  });
  const instance = rackInstanceFromLogger('wi', [{ id: 'r', scheme: 'straight', routine_exercises: [reRow('box', 4, false), reRow('squat', 3, true)] }]);
  const logs = rackLogsFromCompleted('wi', { box: [true, true, true, true] });
  const ctx = (re: string, set: number) => ({ workoutInstanceId: 'wi', routineExerciseId: re, setNumber: set, loadLb: null });
  const sess = (re: string, set: number) => ({
    active_athlete_id: 'me', workout_instance_id: 'wi', routine_exercise_id: re, set_number: set, state: 'idle', load_lb: null,
    pending_workout_instance_id: null, pending_routine_exercise_id: null, pending_set_number: null, pending_load_lb: null,
  });

  it('root cause: a LATE realtime row of an older phone send looked like a coach pick → "chosen" Box Jump 5', () => {
    // Sets 3–4 checked by hand: the phone sent box:3, box:4, then box:5 ("done through 4"), then followed to squat:1.
    const sender = createContextSender(() => Promise.resolve(), 0, { setTimeout: (fn: () => void) => (fn(), 0), clearTimeout: () => {} });
    for (const c of [ctx('box', 3), ctx('box', 4), ctx('box', 5), ctx('squat', 1)]) sender.update('rack-1', c, { immediate: true });
    // the late row box:5 is still the phone's own echo (not only the last / in-flight send)
    expect(sender.isEcho(ctx('box', 5))).toBe(true);
    expect(sender.isEcho(ctx('box', 4))).toBe(true);
    expect(coachSetChoice({ ctx: ctx('box', 5), prev: { exercise: 'squat', set: 1 }, workoutInstanceId: 'wi', isEcho: sender.isEcho, autoPick: { routineExerciseId: 'squat', setNumber: 1 } })).toBeNull();
    // the strip then resolves from the phone's own state: never an extra set from manual completion
    const now = phoneRackNow({ instance, logs, session: sess('box', 5), athleteId: 'me', workoutInstanceId: 'wi', openExerciseId: 'box', openSetNumber: 5, isEcho: sender.isEcho });
    expect(now).toMatchObject({ routineExerciseId: 'squat', setNumber: 1 });
    expect(rackStripLine('Rack 1', 'Back Squat', now.setNumber, 3)).toBe('Rack 1 · Back Squat · Set 1 of 3');
  });

  it('while active the strip IS the rack row (iPad-published squat:1), whatever the phone has open', () => {
    const now = phoneRackNow({ instance, logs, session: sess('squat', 1), athleteId: 'me', workoutInstanceId: 'wi', openExerciseId: 'box', openSetNumber: 5, isEcho: () => false });
    expect(now).toMatchObject({ routineExerciseId: 'squat', setNumber: 1, source: 'rack' });
  });
});

describe('iPad REPS follow the phone: the context carries the phone’s reps', () => {
  const { createContextSender } = require('../lib/rack/phoneView');
  const { createRackApi } = require('../lib/rack/api');
  it('a reps-only change is sent; echoes still match the row (which has no reps)', () => {
    const send = jest.fn((_r: string, _c: any) => Promise.resolve());
    const s = createContextSender(send, 0, { setTimeout: (fn: () => void) => (fn(), 0), clearTimeout: () => {} });
    const c = { workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 1, loadLb: 185 };
    s.update('rack-1', { ...c, repsTarget: 2 }, { immediate: true });
    s.update('rack-1', { ...c, repsTarget: 5 }, { immediate: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).toMatchObject({ repsTarget: 5 });
    expect(s.isEcho({ workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 1, loadLb: 185 })).toBe(true);
  });
  it('rack_set_phone_context sends p_reps_target; before the migration it falls back to the 5-argument call once', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'no function' } })
      .mockResolvedValue({ data: { rack_id: 'r' }, error: null });
    const api = createRackApi({ rpc, from: jest.fn() });
    const ctx = { workoutInstanceId: 'wi', routineExerciseId: 're', setNumber: 1, loadLb: null, repsTarget: 5 };
    await api.setPhoneContext('r', ctx);
    await api.setPhoneContext('r', ctx);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_reps_target: 5 });
    expect('p_reps_target' in rpc.mock.calls[1][1]).toBe(false);
    expect('p_reps_target' in rpc.mock.calls[2][1]).toBe(false); // remembered
  });
});
