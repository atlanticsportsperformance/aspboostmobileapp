import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const S = read('screens/rack/RackModeScreen.tsx');
const HOOK = read('hooks/useRackSession.ts');
const TILES = read('components/rack/AthleteTiles.tsx');
const CARD = read('components/rack/AthleteCard.tsx');
const DEV = read('components/rack/DevSensorBar.tsx');

describe('Rack screen wiring', () => {
  it('sensor onRep feeds the executor (useOvrDevice → useRackSession)', () => {
    expect(S).toContain('const ovr = useOvrDevice();');
    expect(S).toMatch(/useRackSession\(\{[\s\S]*?sensor: ovr\.device,[\s\S]*?\}\)/);
    expect(HOOK).toContain("sensor.onRep((rep, receivedAtMs) => executor.dispatch({ type: 'rep', rep }, receivedAtMs))");
  });

  it('connects the sensor by racks.ovr_device_name, else the first OVR_Velocity*', () => {
    expect(S).toContain('.listRacks(orgId)');
    expect(S).toContain('?.ovrDeviceName ?? null');
    expect(S).toContain('connect(name ?? undefined)');
  });

  it('registers the executor flush for the PIN-exit drain and clears it on unmount', () => {
    expect(S).toContain('setActiveRackFlusher(() => executor.flush());');
    expect(S).toContain('return () => setActiveRackFlusher(null);');
  });

  it("refreshes today's athletes every 60 s", () => {
    expect(S).toContain('export const TODAY_REFRESH_MS = 60_000;');
    expect(S).toMatch(/setInterval\(\(\) => \{\s*refreshToday\(\);\s*\}, TODAY_REFRESH_MS\)/);
  });

  it('tiles and the "+" sheet call engine selectAthlete', () => {
    expect(S).toContain("const selectAthlete = (athleteId: string) => dispatch({ type: 'selectAthlete', athleteId });");
    expect(S).toContain('onSelect={selectAthlete} onAdd={selectAthlete}');
    expect(TILES).toContain('onPress={() => onSelect(t.athleteId)}');
    expect(TILES).toContain('onAdd(a.athleteId);');
  });

  it('big Done calls ipadDone', () => {
    expect(S).toContain("onDone={() => dispatch({ type: 'ipadDone' })}");
    expect(CARD).toContain('onPress={onDone}');
  });

  it('exercise override dispatches localContext', () => {
    expect(S).toContain('dispatch(localContextFor(activeId, ex));');
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

  it('session loss shows "Sign in to resume" and keeps rack_device_v1', () => {
    expect(S).toContain('Sign in to resume');
    expect(S).toContain("navigation.navigate('Login')");
    expect(S).not.toContain('clearRackDevice');
  });

  it('the replay panel is a quiet "Coming soon" placeholder (no video)', () => {
    expect(S).toContain('>REPLAY<');
    expect(S).toContain('Coming soon');
    expect(S).not.toMatch(/expo-video|expo-camera|VideoView/);
  });

  it('no gold colours in components/rack (or the screen / view model)', () => {
    const dir = join(__dirname, '..', 'components/rack');
    const files = readdirSync(dir).map(f => read(`components/rack/${f}`));
    files.push(S, read('lib/rack/viewModel.ts'));
    const gold = /#(F5A623|FFD700|FFC107|FFB800|D4AF37|F59E0B|FBBF24|EAB308|FACC15|FFCC00|E6B800|C9A227)\b|\bgold\b/i;
    for (const f of files) expect(f).not.toMatch(gold);
  });
});
