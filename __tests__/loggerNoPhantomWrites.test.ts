// Owner bug (2026-10-17): opening a FINISHED exercise (Box Jump) and tapping a
// set row re-saved set 1 with the same values. Root cause: every
// onInputChange (incl. auto-fill / back-off re-applies and a keypad opened and
// closed untouched) scheduled a draft without comparing to the server's
// value. Opening / selecting / tapping / scrolling / the rack follow must
// NEVER write; only a real value edit, the circle, Done, RPE / note.
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildLogRow } from '../lib/logger/saveSet';
import { createDraftWriter, sameValue } from '../lib/logger/draftWriter';

const S = readFileSync(join(__dirname, '..', 'screens/WorkoutLoggerScreen.tsx'), 'utf8');
const D = readFileSync(join(__dirname, '..', 'screens/exercise-detail-view.tsx'), 'utf8');

function rig() {
  jest.useFakeTimers();
  const upserts: Record<string, unknown>[] = [];
  // The screen's state: what each set shows (loaded from the DB).
  const inputs: Record<string, Record<string, unknown>> = {};
  const w = createDraftWriter({
    persist: (key, fields) => {
      const i = key.lastIndexOf(':');
      const row = buildLogRow(
        { workoutInstanceId: 'wi', routineExerciseId: key.slice(0, i), setNumber: Number(key.slice(i + 1)) + 1 },
        inputs[key] ?? {},
        { fields, athleteId: 'a', exerciseId: 'ex' },
      );
      upserts.push(row);
      w.markSaved(key, fields, inputs[key] ?? {});
    },
  });
  /** Resume: Box Jump 3/3 done, 3 reps each. */
  const load = (re: string, sets: Record<string, unknown>[]) =>
    sets.forEach((v, i) => {
      inputs[`${re}:${i}`] = { ...v };
      w.setSaved(`${re}:${i}`, v);
    });
  /** What the screen's handleInputChange does: local value, then the draft guard. */
  const change = (re: string, i: number, field: string, value: unknown) => {
    inputs[`${re}:${i}`] = { ...(inputs[`${re}:${i}`] ?? {}), [field]: value };
    w.edit(`${re}:${i}`, field, value);
  };
  return { w, upserts, load, change, flush: () => jest.advanceTimersByTime(600) };
}

afterEach(() => jest.useRealTimers());

describe('opening / selecting never writes; drafts only on real edits', () => {
  it('open a FINISHED exercise and tap every row (keypad opened/closed, same-value auto-fill / back-off) → zero upsert_exercise_log', () => {
    const r = rig();
    r.load('box', [{ reps: 3 }, { reps: 3 }, { reps: 3 }]);
    for (let i = 0; i < 3; i++) {
      // a row tap re-applies what the row already shows (the old path wrote here)
      r.change('box', i, 'reps', '3');
      r.change('box', i, 'reps', 3);
    }
    r.flush();
    expect(r.upserts).toHaveLength(0);
  });

  it('open an UNFINISHED exercise and tap a row with no edit → zero calls', () => {
    const r = rig();
    r.load('squat', [{ reps: 5, weight: 185 }, {}, {}]);
    r.change('squat', 1, 'weight', ''); // empty stays empty
    r.change('squat', 0, 'weight', '185');
    r.flush();
    expect(r.upserts).toHaveLength(0);
  });

  it('edit a value → exactly one call, with only the changed keys (never is_complete)', () => {
    const r = rig();
    r.load('squat', [{ reps: 5, weight: 185 }]);
    r.change('squat', 0, 'weight', '19');
    r.change('squat', 0, 'weight', '195');
    r.change('squat', 0, 'reps', '5'); // unchanged → not sent
    r.flush();
    expect(r.upserts).toHaveLength(1);
    const row = r.upserts[0];
    expect(row).toMatchObject({ actual_weight: 195, set_number: 1 });
    expect('actual_reps' in row).toBe(false);
    expect('is_complete' in row).toBe(false);
    // the same value again later → nothing
    r.change('squat', 0, 'weight', 195);
    r.flush();
    expect(r.upserts).toHaveLength(1);
  });

  it('edited back to the saved value inside the debounce → the draft is dropped', () => {
    const r = rig();
    r.load('squat', [{ weight: 185 }]);
    r.change('squat', 0, 'weight', '190');
    r.change('squat', 0, 'weight', '185');
    r.flush();
    expect(r.upserts).toHaveLength(0);
    expect(sameValue(3, '3')).toBe(true);
    expect(sameValue(null, '')).toBe(true);
  });

  it('wiring: the screen drafts through the guard, loaded / saved / rack rows set the baseline, keypad auto-fill only after typing', () => {
    expect(S).toContain('draftWriter.edit(timerKey, field, value);');
    expect(S).toContain('draftWriter.setSaved(`${ex.id}:${setIndex}`, setsData[setIndex]);');
    expect(S).toContain('if ((write.fields ?? []).length) draftWriter.markSaved(`${exerciseId}:${setIndex}`, write.fields ?? [], sentValues);');
    // M2: the baseline moves only after the write is queued
    const ps = S.slice(S.indexOf('const markSent = () =>'), S.indexOf('draftPersistRef.current = (re, idx, w)'));
    expect(ps.indexOf('await loggerOutbox.enqueue(row);')).toBeLessThan(ps.lastIndexOf('markSent();'));
    expect(S).toContain('draftWriter.setSaved(key, res.inputs[res.setIndex] ?? {});');
    expect(S).not.toContain('draftTimersRef');
    // selecting a row only moves the current set index — no write
    const sel = S.slice(S.indexOf('const handleSelectSet'), S.indexOf('const handleBackToOverview'));
    expect(sel).not.toMatch(/persistSet|handleInputChange|draftWriter/);
    // keypad Done auto-fills siblings only after a real keystroke in that field
    expect(D).toContain('if (typedHere && currentValue != null && currentValue !== \'\') {');
  });
});

describe('I3: a value that synced in (the rack LB) is saved when the athlete completes the set', () => {
  it('sync alone → no write; Log Set → the row carries actual_weight', () => {
    const r = rig();
    r.load('squat', [{ reps: 5 }, {}]);
    // the rack's load lands in the set-2 LB cell (commitInputs only — no draft)
    const inputs: Record<string, unknown> = { weight: '55' };
    r.flush();
    expect(r.upserts).toHaveLength(0);
    // Log Set: pending draft fields + every shown value the server doesn't hold
    const fields = [...new Set([...r.w.take('squat:1'), ...r.w.unsaved('squat:1', inputs)])];
    expect(fields).toEqual(['weight']);
    const row = buildLogRow({ workoutInstanceId: 'wi', routineExerciseId: 'squat', setNumber: 2 }, inputs, { fields, athleteId: 'a', exerciseId: 'ex', complete: true });
    expect(row).toMatchObject({ actual_weight: 55, is_complete: true });
    // already saved values are not re-sent; vbt never counts
    expect(r.w.unsaved('squat:0', { reps: 5, vbt: { avg_v: 0.7 } })).toEqual([]);
  });
  it('wiring: Next / the circle complete with completionFields', () => {
    expect(S).toContain('const draftFields = completionFields(activeExerciseId, currentSetIndex);');
    expect(S).toContain('const draftFields = currentlyCompleted ? cancelDraft(activeExerciseId, setIndex) : completionFields(activeExerciseId, setIndex);');
    expect(S).toContain('for (const f of draftWriter.unsaved(key, inputsRef.current[exerciseId]?.[setIndex] || {})) fields.add(f);');
  });
});
