import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('Rack mode entry is staff + tablet only', () => {
  const S = read('screens/CoachToolsScreen.tsx');
  it('the Tools entry is gated by isStaff AND the tablet check', () => {
    expect(S).toContain('const showRackSetup = isStaff && isTabletDevice();');
    expect(S).toMatch(/\{showRackSetup && \(\s*<TouchableOpacity[^\n]*navigate\('RackSetup'\)/);
    expect(S).toContain('Set up this iPad as a rack');
  });
  it('the tablet check uses Platform.isPad / expo-device TABLET', () => {
    const D = read('lib/rack/device.ts');
    expect(D).toContain('isPad');
    expect(D).toContain('Device.DeviceType.TABLET');
  });
  it('the setup screen re-checks staff + tablet', () => {
    expect(read('screens/rack/RackSetupScreen.tsx')).toContain('const allowed = isStaff && !!staffOrgId && isTabletDevice();');
  });
  it('athlete / parent dashboards never link to Rack mode', () => {
    for (const f of ['screens/DashboardScreen.tsx', 'screens/ParentDashboardScreen.tsx']) {
      expect(read(f)).not.toMatch(/Rack(Setup|Mode)/);
    }
  });
});

describe('Rack setup', () => {
  const S = read('screens/rack/RackSetupScreen.tsx');
  it('picks or creates a rack, pairs the OVR, handles the PIN, then saves rack_device_v1 and enters Rack mode', () => {
    expect(S).toContain('api\n      .listRacks(orgId)');
    expect(S).toContain(".from('racks')\n      .insert(");
    expect(S).toContain("update({ ovr_device_name: deviceName })");
    expect(S).toContain('Skip — pair later');
    expect(S).toContain('api.setPin(pin)');
    const save = S.indexOf('await saveRackDevice({ rackId: r.id, rackName: r.name });');
    const enter = S.indexOf("routes: [{ name: 'RackMode' }]");
    expect(save).toBeGreaterThan(-1);
    expect(enter).toBeGreaterThan(save);
  });
});

describe('Rack PIN exit', () => {
  const S = read('screens/rack/RackPinExit.tsx');
  it('requires rack_verify_pin success before draining', () => {
    expect(S).toContain('ok = await api.verifyPin(pin);');
    const fail = S.indexOf('if (!ok) {');
    const wrong = S.indexOf("setError('Wrong PIN');");
    const drain = S.indexOf('await drainThenLeave();');
    expect(fail).toBeGreaterThan(-1);
    expect(wrong).toBeGreaterThan(fail);
    expect(drain).toBeGreaterThan(wrong);
    expect(S).toContain('doShake();');
  });
  it('drains the rack queues before clearing rack_device_v1', () => {
    const drain = S.indexOf('await drainRackQueues(persist)');
    const leaveFn = S.indexOf('const leave = async () => {');
    const clear = S.indexOf('await clearRackDevice();');
    expect(drain).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(leaveFn);
    // clearRackDevice is only reachable through leave(), which drainThenLeave
    // calls only after the drain returned (or the user chose Exit anyway).
    expect((S.match(/clearRackDevice\(\)/g) || []).length).toBe(1);
    const body = S.slice(S.indexOf('const drainThenLeave'), S.indexOf('const submit'));
    expect(body.indexOf('drainRackQueues(persist)')).toBeLessThan(body.indexOf('await leave()'));
  });
  it('re-locks portrait on the way out', () => {
    const leave = S.slice(S.indexOf('const leave = async'), S.indexOf('const drainThenLeave'));
    expect(leave).toContain('await lockPortrait();');
  });
  it('Rack mode has no sign-out', () => {
    expect(read('screens/rack/RackModeScreen.tsx')).not.toMatch(/signOut/);
  });
});

describe('boot to rack', () => {
  const A = read('App.tsx');
  it('App.tsx reads rack_device_v1 and boots staff into RackMode', () => {
    expect(A).toContain('readRackDevice()');
    expect(A).toContain('if (!navReady || !rolesResolved || !isStaff || !rackDevice) return;');
    expect(A).toContain("nav.reset({ index: 0, routes: [{ name: 'RackMode' }] });");
  });
  it('registers the rack routes and locks portrait at start', () => {
    for (const r of ['RackSetup', 'RackMode', 'RackPinExit']) expect(A).toContain(`name="${r}"`);
    expect(A).toMatch(/\nlockPortrait\(\);/);
    expect(A).toContain('onStateChange={() => syncOrientationForRoute(');
  });
  it('the stored key is rack_device_v1', () => {
    expect(read('lib/rack/device.ts')).toContain("export const RACK_DEVICE_KEY = 'rack_device_v1';");
  });
});

describe('app config', () => {
  const app = JSON.parse(read('app.json')).expo;
  const eas = JSON.parse(read('eas.json'));
  it('iPad supported, full screen, default orientation with a portrait initial lock', () => {
    expect(app.ios.supportsTablet).toBe(true);
    expect(app.ios.requireFullScreen).toBe(true);
    expect(app.orientation).toBe('default');
    expect(app.plugins).toContainEqual(['expo-screen-orientation', { initialOrientation: 'PORTRAIT_UP' }]);
  });
  it('BLE permission text mentions Pulse and the OVR', () => {
    const ble = app.plugins.find((p: any) => Array.isArray(p) && p[0] === '@config-plugins/react-native-ble-plx');
    expect(ble[1].bluetoothAlwaysPermission).toMatch(/Pulse/);
    expect(ble[1].bluetoothAlwaysPermission).toMatch(/OVR/);
  });
  it('EAS channels + updates url + runtimeVersion', () => {
    expect(eas.build.production.channel).toBe('production');
    expect(eas.build.preview.channel).toBe('preview');
    expect(eas.build.development.channel).toBe('development');
    expect(app.updates.url).toMatch(/^https:\/\/u\.expo\.dev\//);
    expect(app.runtimeVersion).toEqual({ policy: 'appVersion' });
  });
});

describe('drainRackQueues', () => {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: 'ios', isPad: true } }), { virtual: true });
  jest.doMock('expo-device', () => ({ deviceType: 2, DeviceType: { TABLET: 2 } }), { virtual: true });
  jest.doMock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
  }));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { drainRackQueues } = require('../lib/rack/device') as typeof import('../lib/rack/device');

  it('flushes until both queues are empty', async () => {
    let left = 3;
    const persist = {
      flush: jest.fn(async () => { left -= 1; }),
      pending: jest.fn(async () => ({ reps: Math.max(0, left), sets: 0 })),
    };
    const res = await drainRackQueues(persist, 10_000);
    expect(res).toEqual({ drained: true, reps: 0, sets: 0 });
    expect(persist.flush).toHaveBeenCalledWith({ force: true });
  });

  it('gives up after the timeout and reports what is left', async () => {
    let t = 0;
    const persist = {
      flush: jest.fn(async () => { t += 4_000; }),
      pending: jest.fn(async () => ({ reps: 2, sets: 1 })),
    };
    const res = await drainRackQueues(persist, 10_000, () => t);
    expect(res).toEqual({ drained: false, reps: 2, sets: 1 });
  });
});
