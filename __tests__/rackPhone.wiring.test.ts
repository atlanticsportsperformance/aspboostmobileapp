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
    expect(L).toContain('if (!rack.hasRacks || !currentExercise) return null;');
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
    expect(H).toContain('supabase.auth.getUser()');
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
    expect(D).toContain('<LiveRepRow source={rackLive.source} rackName={rackLive.rackName} chips={rackLive.chips} />');
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
    expect(L).toContain('firstIncompleteSet(completedSets[ctxExercise.id], ctxExercise.sets)');
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
    expect(L).toContain('resolveRackSet({ instances: [rackInstance], logs: rackLogs, phone: { workoutInstanceId, routineExerciseId: ctxExercise.id } })');
    expect(L).toContain('autoPickExerciseId: rackAutoPick,');
  });

  it('N1 phone: a set advancing on the open exercise sends the context immediately (no debounce)', () => {
    expect(L).toContain('const advanced = !!prev && prev.reId === ctxExercise.id && prev.setIndex !== ctxSetIndex;');
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
