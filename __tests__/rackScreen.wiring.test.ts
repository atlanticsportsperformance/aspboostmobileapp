import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const S = read('screens/rack/RackModeScreen.tsx');
const HOOK = read('hooks/useRackSession.ts');
const TILES = read('components/rack/AthleteTiles.tsx');
const CARD = read('components/rack/AthleteCard.tsx');
const DEV = read('components/rack/DevSensorBar.tsx');
const SETUP = read('screens/rack/RackSetupScreen.tsx');
const ORIENT = read('lib/rack/orientation.ts');
const APP = read('App.tsx');

describe('Rack screen wiring', () => {
  it('sensor onRep feeds the executor (useOvrDevice → useRackSession)', () => {
    expect(S).toContain('const ovr = useOvrDevice();');
    expect(S).toMatch(/useRackSession\(\{[\s\S]*?sensor: ovr\.device,[\s\S]*?\}\)/);
    expect(HOOK).toContain("sensor.onRep((rep, receivedAtMs) => executor.dispatch({ type: 'rep', rep }, receivedAtMs))");
  });

  it('connects only to the paired sensor (cached first); unpaired never connects (fake exempt)', () => {
    expect(S).toContain('rack.ovrDeviceName !== undefined ? { known: true, name: rack.ovrDeviceName ?? null }');
    expect(S).toContain('.listRacks(orgId)');
    expect(S).toContain('?.ovrDeviceName ?? null');
    expect(S).toContain('saveRackDevice({ rackId: rack.rackId, rackName: rack.rackName, ovrDeviceName: name })');
    expect(S).toContain('if (paired.name) connect(paired.name)');
    expect(S).toContain('else if (fake) connect()');
    expect(S).toContain('else disconnect();');
    expect(S).not.toMatch(/connect\(\w+ \?\? undefined\)/);
    expect(SETUP).toContain('saveRackDevice({ rackId: r.id, rackName: r.name, ovrDeviceName: r.ovrDeviceName })');
  });

  it('registers flush / end-live / unsaved for the PIN-exit drain and clears them on unmount', () => {
    expect(S).toContain('setActiveRackFlusher(() => executor.flush());');
    expect(S).toContain('setActiveRackEnder(() => executor.endLive());');
    expect(S).toContain('setActiveRackUnsaved(() => executor.unsavedCount());');
    expect(S).toContain('setActiveRackFlusher(null);');
    expect(S).toContain('setActiveRackEnder(null);');
    expect(S).toContain('setActiveRackUnsaved(null);');
  });

  it("refreshes today's athletes every 60 s", () => {
    expect(S).toContain('export const TODAY_REFRESH_MS = 60_000;');
    expect(S).toMatch(/setInterval\(\(\) => \{\s*refreshToday\(\);\s*\}, TODAY_REFRESH_MS\)/);
  });

  it('tiles and the "+" sheet call engine selectAthlete', () => {
    expect(S).toContain("const selectAthlete = useCallback((athleteId: string) => dispatch({ type: 'selectAthlete', athleteId }), [dispatch]);");
    expect(S).toContain('onSelect={onTile} onAdd={selectAthlete}');
    expect(TILES).toContain('onPress={() => onSelect(t.athleteId)}');
    expect(TILES).toContain('<AddAthleteSheet visible={sheet} addable={addable} onClose={() => setSheet(false)} onAdd={onAdd} />');
  });

  it('"+ Add" sheet: search, snapshot list, scroll-guarded taps, and a two-step confirm', () => {
    const A = read('components/rack/AddAthleteSheet.tsx');
    expect(A).toContain('<TextInput');
    expect(A).toContain('autoFocus={false}');
    expect(A).toContain('filterAddable(snapshot, query)');
    expect(A).toContain('const snapshot = useMemo(() => (visible ? addable : []), [visible]);');
    for (const h of ['onScrollBeginDrag={startScroll}', 'onMomentumScrollBegin={startScroll}', 'onScrollEndDrag={endScroll}', 'onMomentumScrollEnd={endScroll}']) {
      expect(A).toContain(h);
    }
    expect(A).toContain('if (scrolling.current) return;');
    // A row tap only selects; the ONLY onAdd call is the confirm button.
    expect(A).toContain('onPress={() => tapRow(a.athleteId)}');
    expect((A.match(/onAdd\(/g) || []).length).toBe(1);
    const confirm = A.slice(A.indexOf('const confirm = () =>'), A.indexOf('return (', A.indexOf('const confirm = () =>')));
    expect(confirm).toContain('onAdd(chosen.athleteId);');
    expect(A).toContain('onPress={confirm}');
    expect(A).toContain('`Put ${chosen.firstName} up`');
  });

  it('every rack Modal allows all four orientations', () => {
    const files = readdirSync(join(__dirname, '..', 'components/rack')).map(f => read(`components/rack/${f}`));
    files.push(S, read('screens/rack/RackSetupScreen.tsx'), read('screens/rack/RackPinExit.tsx'));
    for (const f of files) {
      const modals = f.match(/<Modal[\s\S]*?>/g) || [];
      for (const m of modals) expect(m).toContain('supportedOrientations={[...ALL_MODAL_ORIENTATIONS]}');
    }
    expect(ORIENT).toContain("export const ALL_MODAL_ORIENTATIONS = ['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right'] as const;");
  });

  it('big Done calls ipadDone', () => {
    expect(S).toContain("onDone={() => dispatch({ type: 'ipadDone' })}");
    expect(CARD).toContain('onPress={onDone}');
  });

  it('exercise override goes to the executor (no screen re-dispatch)', () => {
    expect(S).toContain('executor.setOverride(activeId, ex, setNumber);');
    expect(S).not.toContain("type: 'localContext'");
    expect(CARD).toContain('onPick={onPickExercise}');
  });

  it('the fake-sensor dev bar is guarded by __DEV__ and docked in the header (not over the bars)', () => {
    expect(S).toContain('{__DEV__ && fake && <DevSensorBar');
    expect(DEV).toContain('if (!__DEV__) return null;');
    const header = S.slice(S.indexOf('const header = ('), S.indexOf('const gauge = ('));
    expect(header).toContain('<DevSensorBar');
    expect(DEV).not.toContain("position: 'absolute'");
  });

  it('lock → RackPinExit; no sign-out in Rack mode', () => {
    expect(S).toContain("onLock={() => navigation.navigate('RackPinExit')}");
    expect(S).toContain('onPress={onLock}');
    expect(S).not.toMatch(/signOut/);
  });

  it('keeps the iPad awake on the rack screen', () => {
    expect(S).toContain("import { useKeepAwake } from 'expo-keep-awake';");
    expect(S.slice(S.indexOf('function RackLive'))).toContain('useKeepAwake();');
  });

  it('session loss and the role gate are overlays — the live screen stays mounted', () => {
    const outer = S.slice(S.indexOf('export default function RackModeScreen'), S.indexOf('function RackLive'));
    expect(outer).not.toMatch(/if \(!session\)\s*\{?\s*return/);
    expect(outer).toContain('{rack && orgId ? (');
    expect(outer).toContain('<RackLive rack={rack} orgId={orgId}');
    expect(outer.indexOf('<RackLive')).toBeLessThan(outer.indexOf('{!session && ('));
    expect(outer).toContain('Sign in to resume');
    expect(outer).toContain('{!!session && !staffOrgId && !!rack && !!orgId && (');
    // last known org id, so a momentary null staffOrgId does not unmount
    expect(outer).toContain('if (staffOrgId) setOrgId(staffOrgId);');
    // end the live set before handing over to Login; rack_device_v1 kept
    expect(outer).toMatch(/await endActiveRackSet\(\);\s*navigation\.navigate\('Login'\);/);
    expect(S).not.toContain('clearRackDevice');
  });

  it('the replay panel is a quiet "Coming soon" placeholder (no video)', () => {
    expect(S).toContain('>REPLAY<');
    expect(S).toContain('Coming soon');
    expect(S).not.toMatch(/expo-video|expo-camera|VideoView/);
  });

  it('layout: landscape / portrait from the window and the safe-area insets', () => {
    expect(S).toContain('const insets = useSafeAreaInsets();');
    expect(S).toContain('const { width, height } = useWindowDimensions();');
    expect(S).toContain('const layout = rackLayout(width, height, insets);');
    expect(S).toContain("const portrait = layout.mode === 'portrait';");
    // one tree for both orientations; only row 1's direction flips
    expect(S).toContain('<View style={portrait ? styles.row1Portrait : styles.row1}>');
    expect((S.match(/<View style=\{styles\.ip\}>/g) || []).length).toBe(1);
    expect(S).toContain("layout={portrait ? 'row' : 'column'}");
    expect(S).toContain('compact={portrait}');
  });

  it('no gold colours in components/rack (or the screen / view model)', () => {
    const dir = join(__dirname, '..', 'components/rack');
    const files = readdirSync(dir).map(f => read(`components/rack/${f}`));
    files.push(S, read('lib/rack/viewModel.ts'));
    const gold = /#(F5A623|FFD700|FFC107|FFB800|D4AF37|F59E0B|FBBF24|EAB308|FACC15|FFCC00|E6B800|C9A227|F0883E|F7B27A)\b|\bgold\b|\bamber\b/i;
    for (const f of files) expect(f).not.toMatch(gold);
  });
});

describe('orientation: iPad rack screens unlocked, everything else portrait', () => {
  it('no landscape lock anywhere; unlock = DEFAULT; App applies the portrait base', () => {
    expect(ORIENT).not.toMatch(/OrientationLock\.LANDSCAPE/);
    expect(ORIENT).not.toMatch(/OrientationLock\.ALL/);
    expect(ORIENT).toContain('ScreenOrientation.OrientationLock.DEFAULT');
    expect(APP).toMatch(/\napplyBootOrientation\(\);/);
  });

  it('RackMode re-asserts the unlock on mount, focus and foreground (never trusts a cached lock)', () => {
    expect(S).toContain('void ensureRackOrientation();');
    expect(S).toContain("if (st === 'active') void ensureRackOrientation();");
    expect(S).toMatch(/useFocusEffect\(\s*useCallback\(\(\) => \{\s*void ensureRackOrientation\(\);/);
  });

  it('a rack iPad is never portrait-locked (boot hop Loading → CoachDashboard → RackMode)', () => {
    expect(APP).toContain('setRackDeviceHint(!!d);');
  });

  it('Info.plist: iPhone portrait only; iPad all four orientations', () => {
    const ios = JSON.parse(read('app.json')).expo.ios.infoPlist;
    expect(ios.UISupportedInterfaceOrientations).toEqual(['UIInterfaceOrientationPortrait']);
    expect(ios['UISupportedInterfaceOrientations~ipad']).toEqual([
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ]);
  });

  const load = (tablet: boolean) => {
    jest.resetModules();
    const lockAsync = jest.fn(async () => {});
    jest.doMock('expo-screen-orientation', () => ({ lockAsync, OrientationLock: { DEFAULT: 'DEFAULT', ALL: 'ALL', PORTRAIT_UP: 'PORTRAIT_UP', LANDSCAPE: 'LANDSCAPE' } }), { virtual: true });
    jest.doMock('../lib/rack/device', () => ({ isTabletDevice: () => tablet }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const o = require('../lib/rack/orientation') as typeof import('../lib/rack/orientation');
    return { o, lockAsync };
  };

  it('iPad: rack routes unlock (DEFAULT); other routes lock portrait', async () => {
    const { o, lockAsync } = load(true);
    await o.applyBaseOrientation();
    o.syncOrientationForRoute('RackSetup');
    await Promise.resolve();
    o.syncOrientationForRoute('RackMode');
    await Promise.resolve();
    o.syncOrientationForRoute('CoachDashboard');
    await Promise.resolve();
    expect(lockAsync.mock.calls.map(c => (c as unknown[])[0])).toEqual(['PORTRAIT_UP', 'DEFAULT', 'PORTRAIT_UP']);
  });

  it('phone: portrait everywhere, rack routes included', async () => {
    const { o, lockAsync } = load(false);
    await o.applyBaseOrientation();
    o.syncOrientationForRoute('RackMode');
    await Promise.resolve();
    expect(lockAsync.mock.calls.map(c => (c as unknown[])[0])).toEqual(['PORTRAIT_UP']);
  });

  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  it('regression: a quick rack → non-rack → rack bounce ends UNLOCKED (late portrait lock never wins)', async () => {
    const { o, lockAsync } = load(true);
    o.setRackDeviceHint(false);
    const pending: (() => void)[] = [];
    lockAsync.mockImplementation(() => new Promise<void>(r => pending.push(r)));
    o.syncOrientationForRoute('RackMode'); // DEFAULT in flight
    pending.shift()!();
    await settle();
    o.syncOrientationForRoute('Loading'); // hint false → portrait in flight
    o.syncOrientationForRoute('RackMode'); // back before it resolves
    pending.shift()!();
    await settle();
    pending.shift()?.();
    await settle();
    const calls = lockAsync.mock.calls.map(c => (c as unknown[])[0]);
    expect(calls[calls.length - 1]).toBe('DEFAULT');
  });

  it('a rack iPad is never portrait-locked, on any route', async () => {
    const { o, lockAsync } = load(true);
    o.setRackDeviceHint(true);
    o.syncOrientationForRoute('Loading');
    await settle();
    o.syncOrientationForRoute('CoachDashboard');
    await settle();
    expect(lockAsync.mock.calls.map(c => (c as unknown[])[0])).toEqual(['DEFAULT']);
  });

  it('boot: iPad applies no lock; phone locks portrait', async () => {
    const ipad = load(true);
    await ipad.o.applyBootOrientation();
    expect(ipad.lockAsync).not.toHaveBeenCalled();
    const phone = load(false);
    await phone.o.applyBootOrientation();
    expect(phone.lockAsync).toHaveBeenCalledWith('PORTRAIT_UP');
  });

  it('ensureRackOrientation re-applies the unlock even when already unlocked', async () => {
    const { o, lockAsync } = load(true);
    o.syncOrientationForRoute('RackMode');
    await settle();
    await o.ensureRackOrientation();
    await settle();
    expect(lockAsync.mock.calls.map(c => (c as unknown[])[0])).toEqual(['DEFAULT', 'DEFAULT']);
  });
});

describe('PIN-exit drain ends the live set first and counts memory-held writes', () => {
  const load = () => {
    jest.resetModules();
    jest.dontMock('../lib/rack/device');
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios', isPad: true } }), { virtual: true });
    jest.doMock('expo-device', () => ({ deviceType: 2, DeviceType: { TABLET: 2 } }), { virtual: true });
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      __esModule: true,
      default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../lib/rack/device') as typeof import('../lib/rack/device');
  };

  it('runs the ender (ipadDone) before flushing', async () => {
    const d = load();
    const order: string[] = [];
    d.setActiveRackEnder(async () => void order.push('end'));
    d.setActiveRackFlusher(async () => void order.push('flushMem'));
    const persist = {
      flush: jest.fn(async () => void order.push('flushDisk')),
      pending: jest.fn(async () => ({ reps: 0, sets: 0 })),
    };
    const res = await d.drainRackQueues(persist, 10_000);
    expect(res.drained).toBe(true);
    expect(order).toEqual(['end', 'flushMem', 'flushDisk']);
  });

  it('never reports drained while the executor holds writes in memory', async () => {
    const d = load();
    let t = 0;
    d.setActiveRackUnsaved(() => ({ reps: 1, sets: 1 }));
    const persist = {
      flush: jest.fn(async () => { t += 4_000; }),
      pending: jest.fn(async () => ({ reps: 0, sets: 0 })),
    };
    const res = await d.drainRackQueues(persist, 10_000, () => t);
    expect(res).toEqual({ drained: false, reps: 1, sets: 1 });
  });
});

describe('fix round 3 wiring', () => {
  it('the screen feeds the executor\'s ownership into the view', () => {
    expect(S).toContain('const ipadOwned = executor.ipadOwnsContext();');
    expect(S).toContain('buildRackView({ state, today, rackName: rack.rackName, nowMs, phoneContexts, ipadOwned })');
  });
  it('the card prompts "Pick an exercise" (picker lists all remaining) and shows the % load note', () => {
    expect(CARD).toContain('prompt={view.needsPick}');
    expect(CARD).toContain('view.loadNote');
    const P = read('components/rack/ExercisePicker.tsx');
    expect(P).toContain('Pick an exercise');
    expect(P).toContain('{exercises.map(e => {'); // the live picker lists every exercise with its progress
  });
  it('summary replaces the card contents: opaque card background/radius, keeps the card height, boxes wrap; no "Move last set" chip under it', () => {
    const sumBranch = CARD.slice(CARD.indexOf('  if (view.summary) {'), CARD.indexOf('  return (\n    <View style={[styles.card, row ? styles.cardRow'));
    expect(sumBranch).toContain('<View style={[styles.card, row ? styles.cardRowSum : styles.cardCol, c && styles.cardC, { minHeight: contentH || undefined }]}>');
    expect(sumBranch).not.toContain('Move last set');
    expect(sumBranch).not.toContain('absoluteFill');
    expect(CARD).toContain("sumBoxes: { flexDirection: 'row', flexWrap: 'wrap'");
    expect(CARD).not.toContain("backgroundColor: 'rgba(8,9,10,0.94)'");
  });
  it('the add sheet avoids the keyboard', () => {
    const A = read('components/rack/AddAthleteSheet.tsx');
    expect(A).toContain("<KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>");
  });
  it('the executor publishes via rack_set_ipad_context and never echoes the phone', () => {
    const E = read('lib/rack/executor.ts');
    expect(E).toContain("if (!ipadOwnsContext() && !coach && !phoneRowFinished()) return;");
    expect(read('lib/rack/api.ts')).toContain("session('rack_set_ipad_context', {");
  });
});

describe('staff-check guard (N-2)', () => {
  const G = read('hooks/useRackStaffGuard.ts');
  const AUTH = read('contexts/AuthContext.tsx');
  it('a failed staff check is unknown, not "not staff"; the same user keeps their flags', () => {
    expect(AUTH).toContain("if (error) throw error;");
    const c = AUTH.slice(AUTH.indexOf("console.log('[Auth] checkStaffStatus error:'"), AUTH.indexOf('const resolveRoles'));
    expect(c).toContain("setStaffStatus('unknown');");
    expect(c).toContain('if (confirmedStaffUserRef.current !== userId) {');
    expect(AUTH).toContain("setStaffStatus('not_staff');");
  });
  it('leaves only on a confirmed non-staff result, ending the live set first', () => {
    jest.resetModules();
    jest.doMock('@react-navigation/native', () => ({ useNavigation: () => ({}) }), { virtual: true });
    jest.doMock('../contexts/AuthContext', () => ({ useAuth: () => ({}) }));
    jest.doMock('../lib/rack/device', () => ({ endActiveRackSet: async () => {} }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { shouldLeaveRack } = require('../hooks/useRackStaffGuard') as typeof import('../hooks/useRackStaffGuard');
    expect(shouldLeaveRack({ hasSession: true, rolesResolved: true, staffStatus: 'unknown' })).toBe(false);
    expect(shouldLeaveRack({ hasSession: true, rolesResolved: true, staffStatus: 'staff' })).toBe(false);
    expect(shouldLeaveRack({ hasSession: true, rolesResolved: false, staffStatus: 'not_staff' })).toBe(false);
    expect(shouldLeaveRack({ hasSession: true, rolesResolved: true, staffStatus: 'not_staff' })).toBe(true);
    jest.dontMock('../lib/rack/device');
    expect(G).toMatch(/await endActiveRackSet\(\);\s*if \(!cancelled\) navigation\.reset/);
  });
  it('endActiveRackSet ends (ipadDone) then flushes, bounded', () => {
    const D = read('lib/rack/device.ts');
    const fn = D.slice(D.indexOf('export async function endActiveRackSet'), D.indexOf('/** Writes the executor holds'));
    expect(fn.indexOf('if (end) await bounded(')).toBeLessThan(fn.indexOf('if (flush) await bounded('));
  });
});

describe('athlete card: the exercise + set line is a clear button (pill)', () => {
  const P = read('components/rack/ExercisePicker.tsx');
  it('a Pressable pill that opens the picker: border, zone-blue text, full chevron, 44 pt', () => {
    const trigger = P.slice(P.indexOf('<Pressable\n          disabled={!can}'), P.indexOf('</Pressable>', P.indexOf('<Pressable\n          disabled={!can}')));
    expect(trigger).toContain('onPress={() => setOpen(true)}');
    expect(trigger).toContain('accessibilityRole="button"');
    expect(trigger).toContain('<Ionicons name="chevron-down" size={20}');
    expect(P).toContain("borderColor: 'rgba(155,221,255,0.45)'");
    expect(P).toContain('borderWidth: 1.5,');
    expect(P).toContain("backgroundColor: 'rgba(155,221,255,0.08)'");
    expect(P).toContain('<View style={styles.pillText}>');
    expect(P).toContain("color: '#9BDDFF'");
    expect(P).toContain('minHeight: 44,');
    expect(P).toContain('paddingVertical: 10,');
    expect(P).toContain('paddingHorizontal: 14,');
    expect(P).toContain('borderRadius: 12,');
    expect(P).not.toContain('styles.chev}>▾');
  });
  it('the name truncates, "Set n of N" never does; the source label stays under the pill (both layouts)', () => {
    const { pillParts } = require('../lib/rack/viewModel');
    expect(pillParts('Romanian Deadlift · Set 1 of 3')).toEqual({ name: 'Romanian Deadlift', set: 'Set 1 of 3' });
    expect(pillParts('Free lift')).toEqual({ name: 'Free lift', set: null });
    expect(P).toContain('<Text style={styles.pillName} numberOfLines={1} ellipsizeMode="tail">');
    expect(P).toContain("pillSet: { fontSize: 14, fontWeight: '800'");
    // one card component for both layouts; the source label sits right under the pill
    expect(CARD.indexOf('<ExercisePicker')).toBeLessThan(CARD.indexOf('<Text style={styles.src}>{view.sourceLine}</Text>'));
  });
});

describe('BAR · LB: an unresolved % load shows — plus the prescription caption', () => {
  it('value is "—" (never a truncated note) and the caption wraps under it', () => {
    expect(CARD).toContain("{lb != null ? String(lb) : '—'}");
    expect(CARD).toContain('{lb == null && view.loadNote ? <Text style={styles.loadNote}>{view.loadNote}</Text> : null}');
    expect(CARD).not.toMatch(/styles\.note, c && styles\.xC\]\} numberOfLines=\{1\}>\{view\.loadNote\}/);
  });
});

describe('THIS SET bars stay inside their card after a rotation', () => {
  const B = read('components/rack/RepBars.tsx');
  it('the card clips, the bars remount per orientation and size only from the measured height', () => {
    expect(S).toContain("barsCard: { flex: 1, flexDirection: 'column', overflow: 'hidden' },");
    expect(S).toContain('key={layout.mode}');
    expect(B).toContain('const [measured, setMeasured] = useState(0);');
    expect(B).toContain('<View style={styles.bars} onLayout={onLayout}>');
    expect(B).toContain('const h = Math.min(H, ');
  });
});
