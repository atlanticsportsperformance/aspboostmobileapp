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

  it('no racks → no poll, no realtime (hook gates on hasRacks)', () => {
    expect(H).toMatch(/useEffect\(\(\) => \{\s*if \(!hasRacks\) return;/);
    expect(H).toContain('RACK_POLL_MS');
    expect(L).toMatch(/useEffect\(\(\) => \{\s*if \(!rack\.hasRacks\) return;\s*const channel = supabase/);
  });

  it('live row only on the live set; REPS = full reps; Done hands off to the rack', () => {
    expect(D).toContain('const rackLive = rack?.hasRacks ? rack.live : null;');
    expect(D).toContain("if (rackLive && isLiveRow(setIndex) && metricId === 'reps') {");
    expect(D).toContain('<LiveRepRow source={rackLive.source} rackName={rackLive.rackName} chips={rackLive.chips} />');
    expect(D).toContain('liveDoneLabel(rackLive.fullReps)');
    expect(D).toContain('Saved · tap to edit');
    expect(D).toContain('Saved on the rack · pull to refresh');
    expect(D).toContain('`Speed dropped ${rackLive.dropCue}% — rack it`');
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
    // rack-written rows are only read (realtime + refetch), never upserted here
    const rackBlock = L.slice(L.indexOf('// ── Rack VBT (phone side)'), L.indexOf('// Get current exercise and routine'));
    expect(rackBlock).not.toContain('persistSet(');
    expect(rackBlock).not.toContain('loggerOutbox');
    expect(rackBlock).toContain(".from('exercise_logs')");
    expect(rackBlock).toContain("table: 'exercise_logs'");
  });

  it('context: debounced sender, active only, set = first incomplete', () => {
    expect(H).toContain('createContextSender(');
    expect(H).toContain('sender.update(activeRackId, activeRackId ? ctx : null)');
    expect(L).toContain('firstIncompleteSet(completedSets[ctxExercise.id], ctxExercise.sets)');
  });

  it('follow waits for blur; echo guard uses the last sent context', () => {
    expect(L).toContain('rackPendingFollowRef.current = target; // never while typing — after blur');
    expect(L).toContain('lastSentExerciseId: rack.lastSent().reId');
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
