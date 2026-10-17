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
    expect(S).toContain('onSelect={selectAthlete} onAdd={selectAthlete}');
    expect(TILES).toContain('onPress={() => onSelect(t.athleteId)}');
    expect(TILES).toContain('onAdd(a.athleteId);');
  });

  it('big Done calls ipadDone', () => {
    expect(S).toContain("onDone={() => dispatch({ type: 'ipadDone' })}");
    expect(CARD).toContain('onPress={onDone}');
  });

  it('exercise override goes to the executor (no screen re-dispatch)', () => {
    expect(S).toContain('executor.setOverride(activeId, ex);');
    expect(S).not.toContain("type: 'localContext'");
    expect(CARD).toContain('onPick={onPickExercise}');
  });

  it('the fake-sensor dev bar is guarded by __DEV__', () => {
    expect(S).toContain('{__DEV__ && fake && <DevSensorBar');
    expect(DEV).toContain('if (!__DEV__) return null;');
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
    expect(S).toMatch(/\{portrait \? \(\s*<View style=\{styles\.ip\}>/);
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

describe('orientation: iPad never forced, phones portrait', () => {
  it('no landscape lock anywhere; App applies the base policy', () => {
    expect(ORIENT).not.toMatch(/OrientationLock\.LANDSCAPE/);
    expect(ORIENT).toContain('ScreenOrientation.OrientationLock.ALL');
    expect(APP).toMatch(/\napplyBaseOrientation\(\);/);
  });

  const load = (tablet: boolean) => {
    jest.resetModules();
    const lockAsync = jest.fn(async () => {});
    jest.doMock('expo-screen-orientation', () => ({ lockAsync, OrientationLock: { ALL: 'ALL', PORTRAIT_UP: 'PORTRAIT_UP', LANDSCAPE: 'LANDSCAPE' } }), { virtual: true });
    jest.doMock('../lib/rack/device', () => ({ isTabletDevice: () => tablet }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const o = require('../lib/rack/orientation') as typeof import('../lib/rack/orientation');
    return { o, lockAsync };
  };

  it('iPad: every orientation on rack AND non-rack routes', async () => {
    const { o, lockAsync } = load(true);
    await o.applyBaseOrientation();
    o.syncOrientationForRoute('RackSetup');
    o.syncOrientationForRoute('CoachDashboard');
    await Promise.resolve();
    expect(lockAsync.mock.calls.map(c => (c as unknown[])[0])).toEqual(['ALL']);
  });

  it('phone: portrait everywhere, rack routes included', async () => {
    const { o, lockAsync } = load(false);
    await o.applyBaseOrientation();
    o.syncOrientationForRoute('RackMode');
    await Promise.resolve();
    expect(lockAsync.mock.calls.map(c => (c as unknown[])[0])).toEqual(['PORTRAIT_UP']);
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
