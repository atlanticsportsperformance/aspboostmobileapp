import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { avgWattsSuffix, hasLoad, setWatts, wattsOf } from '../lib/rack/power';
import { buildRackView, repBars, summaryBoxes } from '../lib/rack/viewModel';
import { createRackEngine, reduce, type RackEngineState, type RackEvent, type RackSessionRow } from '../lib/rack/engine';
import { chipViews, livePowerText, rackSummaryLine } from '../lib/rack/phoneView';
import type { OvrRep } from '../lib/ovr/protocol';
import type { RepChip } from '../lib/rack/phone';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
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
  queue: [],
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
const ovr = (v: number, rom = 20): OvrRep => ({ concentricS: 0.5, romIn: rom, meanV: v, peakV: v + 0.3, meanPowerW: 999, peakPowerW: 1999 });

function drive(events: RackEvent[], start: RackEngineState = createRackEngine(RACK)) {
  let s = start;
  let t = T0;
  for (const e of events) {
    t += 500;
    s = reduce(s, e, t).state;
  }
  return { s, t };
}

describe('power.ts — our watts', () => {
  it('watts = round(load_lb × 0.4536 × 9.81 × mean_v)', () => {
    expect(wattsOf(205, 0.52)).toBe(Math.round(205 * 0.4536 * 9.81 * 0.52));
    expect(wattsOf(205, 0.52)).toBe(474);
    expect(wattsOf(315, 0.3)).toBe(421);
    expect(wattsOf(100, 1)).toBe(445);
  });

  it('no load → no watts (null, 0, NaN, negative); a bad velocity → null', () => {
    expect(wattsOf(null, 0.5)).toBeNull();
    expect(wattsOf(undefined, 0.5)).toBeNull();
    expect(wattsOf(0, 0.5)).toBeNull();
    expect(wattsOf(NaN, 0.5)).toBeNull();
    expect(wattsOf(-45, 0.5)).toBeNull();
    expect(wattsOf(205, null)).toBeNull();
    expect(wattsOf(205, Number.NaN)).toBeNull();
    expect(hasLoad(45)).toBe(true);
    expect(hasLoad(0)).toBe(false);
  });

  it('AVG W from the average mean v, PEAK W from the best — full reps only', () => {
    const reps = [
      { v: 0.6, partial: false },
      { v: 0.5, partial: false },
      { v: 0.9, partial: true },
    ];
    expect(setWatts(205, reps)).toEqual({ avgW: wattsOf(205, 0.55), peakW: wattsOf(205, 0.6) });
    expect(setWatts(null, reps)).toEqual({ avgW: null, peakW: null });
    expect(setWatts(205, [{ v: 0.9, partial: true }])).toEqual({ avgW: null, peakW: null });
    expect(avgWattsSuffix(205, 0.55)).toBe(` · avg ${wattsOf(205, 0.55)} W`);
    expect(avgWattsSuffix(null, 0.55)).toBe('');
  });

  it("OVR's own watts are never what we show", () => {
    const bars = repBars(
      [{ repIndex: 1, clientRepId: 'c1', v: 0.5, pv: 0.8, rom: 20, meanPowerW: 999, peakPowerW: 1999, concentricS: 0.5, partial: false, zone: null, dropPct: 0, dropCue: false, receivedAtMs: T0 }],
      'k',
      205,
    );
    expect(bars[0].watts).toBe(wattsOf(205, 0.5));
    expect(bars[0].watts).not.toBe(999);
  });
});

describe('iPad: THIS SET watts, the toggle and the summary', () => {
  const lifting = (load: number | null) =>
    drive([
      { type: 'sessionSync', row: row({ load_lb: load, updated_at: iso(T0) }) },
      { type: 'rep', rep: ovr(0.6) },
      { type: 'rep', rep: ovr(0.5) },
      { type: 'rep', rep: ovr(0.4, 5) },
    ]);

  it('with a load: bars carry watts (partials none) and the toggle is available', () => {
    const { s, t } = lifting(205);
    const v = buildRackView({ state: s, today: [], rackName: 'Rack 3', nowMs: t });
    expect(v.powerAvailable).toBe(true);
    expect(v.bars.map(b => b.watts)).toEqual([wattsOf(205, 0.6), wattsOf(205, 0.5), null]);
  });

  it('without a load: no toggle and no watts', () => {
    const { s, t } = lifting(null);
    const v = buildRackView({ state: s, today: [], rackName: 'Rack 3', nowMs: t });
    expect(v.loadLb).toBeNull();
    expect(v.powerAvailable).toBe(false);
    expect(v.bars.every(b => b.watts == null)).toBe(true);
    const S = read('screens/rack/RackModeScreen.tsx');
    expect(S).toContain('const showPower = view.powerAvailable;');
    // The Speed | Power segment renders only with a load; RepBars gets watts only then.
    expect(S).toMatch(/\{showPower && \(\s*<View style=\{styles\.seg\}>/);
    expect(S).toContain('showWatts={showPower}');
    expect(S).toContain("metric={showPower ? metric : 'speed'}");
    const B = read('components/rack/RepBars.tsx');
    expect(B).toContain("const power = showWatts && metric === 'power';");
    expect(B).toContain('{wattsUnder && <Text style={styles.pw}>');
  });

  it('summary: AVG W + PEAK W only when the load is known', () => {
    const withLoad = lifting(205);
    let r = reduce(withLoad.s, { type: 'ipadDone' }, withLoad.t + 100);
    let v = buildRackView({ state: r.state, today: [], rackName: 'Rack 3', nowMs: withLoad.t + 200 });
    expect(v.summary?.avgW).toBe(String(wattsOf(205, 0.55)));
    expect(v.summary?.peakW).toBe(String(wattsOf(205, 0.6)));
    expect(summaryBoxes(v.summary!).map(b => b[0])).toEqual(['AVG', 'BEST', 'DROP', 'AVG W', 'PEAK W']);

    const noLoad = lifting(null);
    r = reduce(noLoad.s, { type: 'ipadDone' }, noLoad.t + 100);
    v = buildRackView({ state: r.state, today: [], rackName: 'Rack 3', nowMs: noLoad.t + 200 });
    expect(v.summary?.avgW).toBeNull();
    expect(v.summary?.peakW).toBeNull();
    expect(summaryBoxes(v.summary!).map(b => b[0])).toEqual(['AVG', 'BEST', 'DROP']);
  });
});

describe('phone: "· avg ### W" on the RACK / SENSOR line', () => {
  const chip = (i: number, v: number, partial = false, loadLb: number | null = 205): RepChip => ({
    clientRepId: `c${i}`,
    repIndex: i,
    v,
    pv: v + 0.3,
    rom: 20,
    partial,
    loadLb,
    receivedAt: iso(T0),
  });

  it('saved rack row: appended only with a load', () => {
    const vbt = { avg_v: 0.55, best_v: 0.6 };
    expect(rackSummaryLine(vbt, 205)).toBe(`avg 0.55 · best 0.60 m/s · avg ${wattsOf(205, 0.55)} W`);
    expect(rackSummaryLine(vbt, '205')).toBe(`avg 0.55 · best 0.60 m/s · avg ${wattsOf(205, 0.55)} W`);
    expect(rackSummaryLine(vbt)).toBe('avg 0.55 · best 0.60 m/s');
    expect(rackSummaryLine(vbt, null)).toBe('avg 0.55 · best 0.60 m/s');
  });

  it('live row: avg W from the full reps, none without a load', () => {
    const chips = [chip(1, 0.6), chip(2, 0.5), chip(3, 0.3, true)];
    expect(livePowerText(chips, 205)).toBe(`avg ${wattsOf(205, 0.55)} W`);
    expect(livePowerText(chips, null)).toBeNull();
    expect(livePowerText([], 205)).toBeNull();
  });

  it('chips carry their rep id + number for the long-press sheet', () => {
    const v = chipViews([chip(1, 0.6), chip(4, 0.5)], null);
    expect(v.map(c => [c.clientRepId, c.repNo])).toEqual([
      ['c1', 1],
      ['c4', 2],
    ]);
    const L = read('screens/WorkoutLoggerScreen.tsx');
    expect(L).toContain('powerText: livePowerText(chips, chipsLoad(chips, s.load_lb)),');
    expect(L).toContain('rackSummaryLine(vbt, log?.actual_weight)');
    const D = read('screens/exercise-detail-view.tsx');
    expect(D).toContain('rackSummaryLine(exerciseInputs[exercise.id]?.[i]?.vbt, loadFromInput(exerciseInputs[exercise.id]?.[i]?.weight))');
  });
});

describe('BAR · LB on the iPad card', () => {
  it('label is "BAR · LB" with −/+ and long-press; no "SET ON PHONE"', () => {
    const C = read('components/rack/AthleteCard.tsx');
    expect(C).toContain("'BAR · LB'");
    expect(C).not.toMatch(/SET ON PHONE/i);
    expect(C).toContain('onPress={() => onBarStep?.(-BAR_STEP_LB)}');
    expect(C).toContain('onPress={() => onBarStep?.(BAR_STEP_LB)}');
    expect(C).toContain('onLongPress={onBarType}');
    expect(C).toContain('export const BAR_STEP_LB = 5;');
    const S = read('screens/rack/RackModeScreen.tsx');
    expect(S).toContain('executor.setBarLoad(next);');
    expect(S).toContain('barNext={!!bar?.next}');
  });
});

describe('no gold anywhere in the new rack UI', () => {
  it('rack components, power, phone live row', () => {
    const gold = /#(F5A623|FFD700|FFC107|FFB800|D4AF37|F59E0B|FBBF24|EAB308|FACC15|FFCC00|E6B800|C9A227|F0883E|F7B27A|D9A441)\b|\bgold\b|\bamber\b/i;
    const dir = join(__dirname, '..', 'components/rack');
    const files = readdirSync(dir).map(f => read(`components/rack/${f}`));
    files.push(read('lib/rack/power.ts'), read('components/logger/LiveRepRow.tsx'), read('screens/rack/RackModeScreen.tsx'));
    for (const f of files) expect(f).not.toMatch(gold);
    // Only the restraint palette in the new sheets.
    const M = read('components/rack/MoveSetSheet.tsx') + read('components/rack/RemoveRepSheet.tsx') + read('components/rack/BarWeightSheet.tsx');
    expect(M).toContain('ALL_MODAL_ORIENTATIONS');
    expect(read('components/rack/RemoveRepSheet.tsx')).toContain("borderColor: 'rgba(229,83,75,0.5)'");
  });
});
