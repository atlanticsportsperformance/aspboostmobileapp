import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const D = read('screens/exercise-detail-view.tsx');
const B = read('screens/block-overview.tsx');
const L = read('screens/WorkoutLoggerScreen.tsx');
const H = read('hooks/useRackPhone.ts');
const V = read('lib/rack/phoneView.ts');
const BN = read('components/logger/RackBanner.tsx');
const LR = read('components/logger/LiveRepRow.tsx');
const PHONE = [D, B, L, H, V, BN, LR];

describe('rack phone wiring', () => {
  it('banner renders on the overview and the exercise screen, guarded by hasRacks', () => {
    for (const src of [D, B]) {
      expect(src).toContain("import RackBanner, { type RackScreenProps } from '../components/logger/RackBanner';");
      expect(src).toMatch(/\{rack\?\.hasRacks && rack\.banner && \(\s*<RackBanner/);
    }
    expect(L).toContain('rack={rackScreen}');
    expect(L).toContain('rack={rackExerciseProps}');
    expect(L).toContain('if (!currentExercise || (!rack.hasRacks && !solo.on && !rackExtra[currentExercise.id])) return null;');
  });

  it('I2: realtime + 10 s poll only while on a rack, filtered per rack; browse = focus / foreground / pull only', () => {
    expect(H).toContain('if (!hasRacks || !onRackIds) return;');
    expect(H).toContain("filter: `rack_id=eq.${rackId}`");
    expect(H).toContain('RACK_POLL_MS');
    expect(H).toContain('useFocusEffect(');
    expect(H).toContain("AppState.addEventListener('change'");
    expect(H).toContain(".or(`active_athlete_id.eq.${athleteId},queue.cs.{${athleteId}}`)");
    // the dead exercise_logs channel is gone
    expect(L).not.toContain("table: 'exercise_logs'");
    expect(H).not.toContain("table: 'exercise_logs'");
  });

  it('I5: self only — the hook is inert unless athletes.user_id = auth.uid() is this athlete', () => {
    expect(H).toContain('supabase.auth.getSession()');
    expect(H).not.toContain('supabase.auth.getUser()');
    expect(H).toContain(".from('athletes').select('id').eq('user_id', uid)");
    expect(H).toContain('const hasRacks = isSelf && list.length > 0;');
    expect(H).toMatch(/const refresh = useCallback\(async \(\) => \{\s*if \(!isSelf\) return;/);
  });

  it('R1: no draft hold — drafts write as before', () => {
    expect(L).not.toContain('rackHoldsDraft');
  });

  it('C1: rack-owned sets never get is_complete / reps from the phone', () => {
    expect(L).toContain('const write = rackSafeWrite(requested, rackOwnsSetRef.current(exerciseId, setIndex));');
    expect(L).toContain('awaitRackWrite(e.routineExerciseId, e.setNumber);');
    const toggle = D.slice(D.indexOf('const handleCheckboxToggle'), D.indexOf('// Done button — two-phase'));
    expect(toggle).toContain('if (rack && rackSaving(setIndex)) {');
    expect(D).toContain("disabled={rackLabel === 'Saving…' && rackSaving(currentSetIndex) === 'saving'}");
    expect(D).toContain('<RefreshControl refreshing={rack.refreshing} onRefresh={rack.onPullRefresh}');
  });

  it('live row only on the live set; REPS = full reps; Done hands off to the rack', () => {
    expect(D).toContain('const rackLive = rack?.hasRacks ? rack.live : null;');
    expect(D).toContain("if (rackLive && isLiveRow(setIndex) && metricId === 'reps') {");
    expect(D).toContain('<LiveRepRow source={rackLive.source} rackName={rackLive.rackName} chips={rackLive.chips} powerText={rackLive.powerText} onLongPressChip={chipPress(i)} />');
    expect(D).toContain('liveDoneLabel(rackLive.fullReps)');
    expect(D).toContain('Saved · tap to edit');
    expect(D).toContain('Saved on the rack · pull to refresh');
    expect(D).toContain('`Speed dropped ${rackLive.dropCue}% — rack it`');
    expect(L).toContain('liveRackSet(rack.activeSession, athleteId, workoutInstanceId)');
    expect(L).toContain('rack.chipsFor(workoutInstanceId, reId, rackLive.setNumber)');
    expect(L).toContain('awaitRackWrite: () => awaitRackWrite(liveRe, liveNo)');
    const toggle = D.slice(D.indexOf('const handleCheckboxToggle'), D.indexOf('// Done button — two-phase'));
    expect(toggle.indexOf('rack.onLiveDone()')).toBeLessThan(toggle.indexOf('onToggleSetComplete'));
    expect(L).toContain('saveSet: () => undefined');
    expect(L).toContain('requestEndSet: rack.requestEndSet');
  });

  it('the phone never writes metric_data.vbt or rack reps', () => {
    for (const src of PHONE) {
      expect(src).not.toMatch(/metric_data_patch/);
      expect(src).not.toMatch(/vbt\s*[:=]\s*\{/);
      expect(src).not.toMatch(/\.vbt\s*=/);
      expect(src).not.toMatch(/upsert_exercise_log/);
    }
    // rack-written rows are only read (refetch), never upserted here
    const rackBlock = L.slice(L.indexOf('// ── Rack VBT (phone side)'), L.indexOf('// Get current exercise and routine'));
    expect(rackBlock).not.toContain('persistSet(');
    expect(rackBlock).not.toContain('loggerOutbox');
    expect(rackBlock).toContain(".from('exercise_logs')");
  });

  it('context: debounced sender, active only, set = first incomplete', () => {
    expect(H).toContain('createContextSender(');
    expect(H).toContain('sender.update(activeRackId, activeRackId ? ctx : null, o)');
    expect(L).toContain('firstIncompleteSet(completedSets[ctxExercise.id], ctxExercise.sets ?? 1)');
    expect(L).toContain('{ immediate }');
    expect(L).toContain('contextLoad({');
  });

  it('follow waits for blur; echo guard uses the last sent context', () => {
    expect(L).toContain('rackPendingFollowRef.current = target; // never while typing — after blur');
    expect(L).toContain('isEcho: rack.isEcho,');
    expect(L).toContain('sentThisActivation: rack.sentThisActivation(),');
    expect(D).toContain('rackOnEditingChange?.(activeInput != null);');
    expect(L).toContain('switched you to');
  });

  it('colours: zone blue / red / faint white, no gold or amber', () => {
    const rackBlock = L.slice(L.indexOf('// ── Rack VBT (phone side)'), L.indexOf('// Get current exercise and routine'));
    const rackStyles = L.slice(L.indexOf('  rackToast: {'), L.indexOf('  loadingContainer: {'));
    for (const src of [H, V, BN, LR, rackBlock, rackStyles]) {
      expect(src).not.toMatch(/#D9A441|#F5A623|#FFD700|#FBBF24|#F59E0B|gold|amber/i);
    }
    // the logger screens stay free of the old gold too
    for (const src of [D, B]) expect(src).not.toMatch(/#D9A441/i);
    expect(V).toContain("zone: '#9BDDFF'");
    expect(V).toContain("slow: '#E5534B'");
    expect(V).toContain("fastBg: 'rgba(255,255,255,0.08)'");
  });

  it('no exercise counter and no A1/A2 pills added by the rack UI', () => {
    for (const src of [BN, LR]) {
      expect(src).not.toMatch(/of \$\{|blockLabel|codeFor/);
    }
  });
});

describe('rack phone wiring — shared resolver + re-review N1/N3/N4', () => {
  it('the phone’s current rack set comes from resolveRackSet (same function as the iPad), open exercise = phone context', () => {
    expect(L).toContain("import { rackInstanceFromLogger, rackLogsFromCompleted, resolveRackSet } from '../lib/rack/resolveRackSet';");
    // the phone-open SET (selected incomplete row) is what it sends and what its strip resolves with
    expect(L).toContain('const ctxSelected = ctxExercise ? currentSetIndexes[ctxExercise.id] ?? 0 : null;');
    expect(L).toContain('openSetNumber: viewMode === \'exercise\' ? ctxSendSet : null,');
    expect(L).toContain('autoPickExerciseId: rackAutoPick,');
  });

  it('N1 phone: a set advancing on the open exercise sends the context immediately (no debounce)', () => {
    // any change of the open row (a tapped row, a saved set, another exercise) goes out at once
    expect(L).toContain('const advanced = !prev || prev.reId !== ctxExercise.id || prev.setIndex !== ctxSetIndex;');
    expect(L).toContain('const immediate = rackActivationSentRef.current !== rackActivation || advanced;');
  });

  it('N1 phone: a live rack set on a row shown complete → circle / Done end the rack set; never a local un-check', () => {
    const toggle = D.slice(D.indexOf('const handleCheckboxToggle'), D.indexOf('// Done button — two-phase'));
    expect(toggle).toContain('if (rack && rackLive?.lifting && isLiveRow(setIndex)) {');
    expect(toggle.indexOf('rack.onLiveDone()')).toBeLessThan(toggle.indexOf('onToggleSetComplete'));
    const next = D.slice(D.indexOf('const handleNextButtonPress'), D.indexOf('// Swipe gesture handler'));
    expect(next).toContain('if (rack && rackLive?.lifting) {');
    // the data path refuses a check/un-check of a rack-owned set too
    const t = L.slice(L.indexOf('const handleToggleSetComplete'), L.indexOf('// RPE tap'));
    expect(t).toContain('if (rackOwnsSetRef.current(activeExerciseId, setIndex)) return;');
    expect(t.indexOf('rackOwnsSetRef.current(activeExerciseId, setIndex)')).toBeLessThan(t.indexOf('commitCompleted('));
  });

  it('N3: leaving / being bumped releases rack-owned and pending sets after a last read', () => {
    const n3 = L.slice(L.indexOf('const rackWasActiveRef'), L.indexOf('// Real pull-to-refresh'));
    expect(n3).toContain('void readPendingRackWrites();');
    expect(n3).toContain('rackPendingRef.current = {};');
    expect(n3).toContain('setRackSavingState(prev => (Object.keys(prev).length ? {} : prev));');
    expect(n3).toContain('RACK_WRITE_TIMEOUT_MS');
    expect(n3).toContain('if (rackWasActiveRef.current) return; // active again');
  });
});

describe('rack phone wiring — fix round 1 (review 10c + owner sync)', () => {
  it('I4: a finished exercise sends {instance, exercise, set: prescribed + 1}, never an empty context', () => {
    expect(L).toContain('{ workoutInstanceId, routineExerciseId: ctxExercise.id, setNumber: (ctxExercise.sets ?? 1) + 1, loadLb: null }');
    expect(L).not.toContain('? { workoutInstanceId: null, routineExerciseId: null, setNumber: null, loadLb: null }');
    expect(L).toContain('isFinishedOnPhone: reId =>');
  });

  it('banner strip (both screens) and the overview Continue come from phoneRackNow — the iPad’s resolver', () => {
    expect(L).toContain('const rackNow = rackActive\n    ? phoneRackNow({');
    expect(L).toContain('banner: withRackSet(rack.banner, rackSetStrip),');
    expect(L).toContain('rackFocus={rack.hasRacks ? (rackNow ? { reId: rackNow.routineExerciseId, setIndex: rackNow.setNumber - 1 } : rackFocus) : null}');
    expect(BN).toContain('{active && banner.rackSet ? (');
    // the exercise screen and the overview both render RackBanner from rackScreen
    expect(L).toContain('...rackScreen,');
  });

  it('owner ruling 1: the open exercise finishing while active follows the rack (navigate + toast), and Next goes there', () => {
    expect(L).toContain('const { track, follow: target } = followOnFinish({');
    expect(L).toContain('showRackToast(rackFollowToast(rack.activeRackName,');
    const next = L.slice(L.indexOf('const handleNextSet = useCallback'), L.indexOf('// Navigation handlers'));
    expect(next.indexOf('rackNextAfterRef.current(activeExerciseId, currentSetIndex)')).toBeLessThan(next.indexOf('nextStep(sequence, done'));
    expect(D).toContain('const rackNext = rack?.hasRacks ? rack.rackNextAfter?.(currentSetIndex) ?? null : null;');
  });

  it('concern 4: extra rack sets past the prescription get a read-only row with the RACK line', () => {
    expect(L).toContain('} else if (setIndex >= ex.sets && log.metric_data?.vbt) {');
    expect(L).toContain('extraSets: extraRackSets(reId, currentExercise.sets ?? 1),');
    expect(D).toContain('for (const x of rack?.hasRacks ? rack.extraSets ?? [] : []) {');
    expect(D).toContain('{x.rackLine && <Text style={styles.rackSummary}>{x.rackLine}</Text>}');
  });
});

describe('rack phone wiring — fix round 3', () => {
  it('a coach’s exact set is followed (toast) and sent back as the phone’s set', () => {
    expect(L).toContain('const chosen = coachSetChoice({');
    expect(L).toContain('showRackToast(rackFollowToast(rack.activeRackName, rackExerciseName(chosen.routineExerciseId), chosen.setNumber));');
    expect(L).toContain('? chosenHere\n      ? chosenHere.setNumber - 1');
    expect(L).toContain('chosen: rackChosen,');
  });
});
