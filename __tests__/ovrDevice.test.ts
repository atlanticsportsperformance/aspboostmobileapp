import { bytesToBase64, base64ToBytes, backoffMs } from '../lib/ble/connect';

// ─── Mocked ble-plx manager ───

type Listener = (...args: any[]) => void;

interface MockDevice {
  id: string;
  name: string;
  localName: null;
  isConnected: jest.Mock;
  connect: jest.Mock;
  cancelConnection: jest.Mock;
  discoverAllServicesAndCharacteristics: jest.Mock;
  onDisconnected: jest.Mock;
  monitorCharacteristicForService: jest.Mock;
  writeCharacteristicWithResponseForService: jest.Mock;
  // test handles
  drop: () => void;
  notify: (b64: string) => void;
}

function makeDevice(name: string): MockDevice {
  let onDisc: Listener | null = null;
  let onData: Listener | null = null;
  const d: MockDevice = {
    id: name,
    name,
    localName: null,
    isConnected: jest.fn(async () => false),
    connect: jest.fn(async () => d),
    cancelConnection: jest.fn(async () => d),
    discoverAllServicesAndCharacteristics: jest.fn(async () => d),
    onDisconnected: jest.fn((l: Listener) => {
      onDisc = l;
      return { remove: () => { if (onDisc === l) onDisc = null; } };
    }),
    monitorCharacteristicForService: jest.fn((_s: string, _c: string, l: Listener) => {
      onData = l;
      return { remove: () => { if (onData === l) onData = null; } };
    }),
    writeCharacteristicWithResponseForService: jest.fn(async () => ({})),
    drop: () => onDisc?.(null, d),
    notify: (b64) => onData?.(null, { value: b64 }),
  };
  return d;
}

// A live scan: the callback stays registered until stopDeviceScan(), and
// devices advertised later are delivered to it (like ble-plx).
let scanCb: Listener | null = null;
const mgr = {
  advertised: [] as MockDevice[],
  bleState: 'PoweredOn',
  stateCbs: new Set<Listener>(),
  state: jest.fn(async (): Promise<string> => mgr.bleState),
  onStateChange: jest.fn((cb: Listener, emitCurrent: boolean) => {
    mgr.stateCbs.add(cb);
    if (emitCurrent) cb(mgr.bleState);
    return { remove: () => mgr.stateCbs.delete(cb) };
  }),
  setBleState(s: string) {
    mgr.bleState = s;
    [...mgr.stateCbs].forEach((cb) => cb(s));
  },
  startDeviceScan: jest.fn((_u: any, _o: any, cb: Listener) => {
    scanCb = cb;
    const list = [...mgr.advertised];
    Promise.resolve().then(() => list.forEach((d) => scanCb === cb && cb(null, d)));
    return Promise.resolve();
  }),
  stopDeviceScan: jest.fn(() => {
    scanCb = null;
    return Promise.resolve();
  }),
  advertise(d: MockDevice) {
    mgr.advertised.push(d);
    scanCb?.(null, d);
  },
};

jest.mock('../lib/ble/manager', () => ({
  getBleManager: () => mgr,
  NOT_LINKED_MSG: 'not linked',
}));

import { OvrBleDevice, OVR, createOvrDevice, matchesOvrName } from '../lib/ovr/ovr-device';
import { FakeOvrDevice } from '../lib/ovr/fake-ovr';
import type { OvrRep } from '../lib/ovr/protocol';

const hex = (h: string) =>
  bytesToBase64(new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16))));
const REP_A = hex('23004e01f20034026904490a'); // 2.42 m/s
const REP_B = hex('37007d01b00046013603f205'); // 1.76 m/s
const ascii = (b64: string) => String.fromCharCode(...Array.from(base64ToBytes(b64)));

async function settle(ms = 0) {
  await jest.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  jest.useFakeTimers();
  mgr.advertised = [];
  mgr.bleState = 'PoweredOn';
  mgr.stateCbs.clear();
  scanCb = null;
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

function track(dev: OvrBleDevice) {
  const states: string[] = [];
  const reps: OvrRep[] = [];
  dev.onState((s) => states.push(s.state));
  dev.onRep((r) => reps.push(r));
  return { states, reps };
}

describe('matchesOvrName', () => {
  it('prefix by default, exact when a full name is given', () => {
    expect(matchesOvrName('OVR_Velocity-6C8E')).toBe(true);
    expect(matchesOvrName('Pulse')).toBe(false);
    expect(matchesOvrName('OVR_Velocity-6C8E', 'OVR_Velocity-6C8E')).toBe(true);
    expect(matchesOvrName('OVR_Velocity-AAAA', 'OVR_Velocity-6C8E')).toBe(false);
  });
});

describe('OvrBleDevice', () => {
  it('scans, connects and subscribes to the data characteristic', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [makeDevice('Pulse'), s];
    const dev = new OvrBleDevice();
    const { states } = track(dev);
    await dev.connect();
    expect(states).toEqual(['scanning', 'connecting', 'connected']);
    expect(dev.deviceName).toBe('OVR_Velocity-6C8E');
    expect(s.monitorCharacteristicForService).toHaveBeenCalledWith(
      '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
      '14001dc2-5089-47d3-84bc-7c3d418389aa',
      expect.any(Function),
    );
  });

  it('exact-name match skips other OVR sensors', async () => {
    const other = makeDevice('OVR_Velocity-AAAA');
    const mine = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [other, mine];
    const dev = new OvrBleDevice();
    await dev.connect('OVR_Velocity-6C8E');
    expect(other.connect).not.toHaveBeenCalled();
    expect(mine.connect).toHaveBeenCalled();
    expect(dev.state).toBe('connected');
  });

  it('reconnects after an unexpected disconnect and resets the attempt counter', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice({ scanTimeoutMs: 1000 });
    const { states } = track(dev);
    await dev.connect();

    // Drop #1; sensor not visible for the first retry (scan times out).
    mgr.advertised = [];
    s.drop();
    expect(dev.state).toBe('reconnecting');
    await settle(backoffMs(0)); // retry #1 starts scanning
    await settle(1000); // scan timeout → retry #2 scheduled at backoffMs(1)
    expect(dev.state).toBe('reconnecting');
    expect(dev.error).toMatch(/No OVR sensor/);

    mgr.advertised = [s];
    await settle(backoffMs(1) - 1);
    expect(dev.state).toBe('reconnecting');
    await settle(1);
    expect(dev.state).toBe('connected');
    expect(states.slice(-1)).toEqual(['connected']);

    // Drop #2: the counter was reset, so the first retry is again backoffMs(0).
    s.drop();
    await settle(backoffMs(0) - 1);
    expect(dev.state).toBe('reconnecting');
    await settle(1);
    expect(dev.state).toBe('connected');
    expect(s.connect).toHaveBeenCalledTimes(3);
  });

  it('user disconnect() stops retries', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice();
    await dev.connect();
    s.drop();
    expect(dev.state).toBe('reconnecting');
    dev.disconnect();
    expect(dev.state).toBe('idle');
    await settle(60_000);
    expect(s.connect).toHaveBeenCalledTimes(1);
    expect(dev.state).toBe('idle');
  });

  it('drops a repeated rep within 1500 ms of reconnect, passes a different one', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice();
    const { reps } = track(dev);
    await dev.connect();
    await settle(5000);
    s.notify(REP_A);
    expect(reps).toHaveLength(1);

    s.drop();
    await settle(backoffMs(0));
    expect(dev.state).toBe('connected');
    s.notify(REP_A); // sensor re-sends its last rep on reconnect
    expect(reps).toHaveLength(1);
    await settle(200);
    s.notify(REP_B);
    expect(reps).toHaveLength(2);
    expect(reps[1].meanV).toBe(1.76);
  });

  it('a load written while disconnected is written on connect, and survives a reconnect', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice();
    await dev.writeLoad(225);
    expect(s.writeCharacteristicWithResponseForService).not.toHaveBeenCalled();
    await dev.connect();
    expect(s.writeCharacteristicWithResponseForService).toHaveBeenCalledTimes(1);
    const [svc, ch, val] = s.writeCharacteristicWithResponseForService.mock.calls[0];
    expect(svc).toBe(OVR.SERVICE_UUID);
    expect(ch).toBe('ba755038-b91d-4efb-9fce-b6ce2a9beb01');
    expect(ascii(val)).toBe('225');

    s.drop();
    await settle(backoffMs(0));
    expect(dev.state).toBe('connected');
    expect(s.writeCharacteristicWithResponseForService).toHaveBeenCalledTimes(2);
    expect(ascii(s.writeCharacteristicWithResponseForService.mock.calls[1][2])).toBe('225');
  });

  it('writes the load immediately when connected', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice();
    await dev.connect();
    await dev.writeLoad(135);
    expect(ascii(s.writeCharacteristicWithResponseForService.mock.calls[0][2])).toBe('135');
  });

  it('first scan fails → reconnecting → retry → connected; disconnect stops the loop', async () => {
    const dev = new OvrBleDevice({ scanTimeoutMs: 500 });
    const { states } = track(dev);
    const p = dev.connect();
    await settle(500); // scan #1 times out
    await p;
    expect(dev.state).toBe('reconnecting');
    expect(dev.error).toMatch(/No OVR sensor/);
    expect(mgr.startDeviceScan).toHaveBeenCalledTimes(1);

    await settle(backoffMs(0)); // retry #1 scanning; error still visible
    expect(mgr.startDeviceScan).toHaveBeenCalledTimes(2);
    expect(dev.error).toMatch(/No OVR sensor/);

    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertise(s); // sensor wakes up mid-scan
    await settle(0);
    expect(dev.state).toBe('connected');
    expect(dev.error).toBeUndefined();
    expect(states[0]).toBe('scanning');

    // Same loop, then a user disconnect stops it.
    mgr.advertised = [];
    s.drop();
    expect(dev.state).toBe('reconnecting');
    dev.disconnect();
    await settle(60_000);
    expect(dev.state).toBe('idle');
    expect(s.connect).toHaveBeenCalledTimes(1);
  });

  it('waits for Bluetooth PoweredOn before scanning', async () => {
    mgr.bleState = 'Resetting';
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice();
    const p = dev.connect();
    await settle(100);
    expect(mgr.startDeviceScan).not.toHaveBeenCalled();
    mgr.setBleState('PoweredOn');
    await p;
    expect(dev.state).toBe('connected');
  });

  it('Unsupported Bluetooth is terminal', async () => {
    mgr.bleState = 'Unsupported';
    const dev = new OvrBleDevice();
    await dev.connect();
    expect(dev.state).toBe('error');
    await settle(60_000);
    expect(mgr.startDeviceScan).not.toHaveBeenCalled();
  });

  it('a stale scan timer never stops a newer scan (disconnect → reconnect within 15 s)', async () => {
    const dev = new OvrBleDevice(); // default 15 s scan timeout
    void dev.connect();
    await settle(2000);
    dev.disconnect();
    await settle(3000); // t = 5 s
    const p = dev.connect();
    await settle(10_500); // t = 15.5 s: past the first scan's old deadline
    expect(mgr.stopDeviceScan).toHaveBeenCalledTimes(1); // only by disconnect()
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertise(s);
    await p;
    expect(dev.state).toBe('connected');
    expect(s.connect).toHaveBeenCalledTimes(1);
  });

  it('connect() does not stop a scan it does not own', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice();
    await dev.connect();
    const stops = mgr.stopDeviceScan.mock.calls.length;
    dev.disconnect(); // no scan in flight
    expect(mgr.stopDeviceScan.mock.calls.length).toBe(stops);
  });

  it('disconnect() while connected removes both subscriptions and cancels the connection', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice();
    await dev.connect();
    const discSub = s.onDisconnected.mock.results[0].value;
    const dataSub = s.monitorCharacteristicForService.mock.results[0].value;
    const r1 = jest.spyOn(discSub, 'remove');
    const r2 = jest.spyOn(dataSub, 'remove');
    dev.disconnect();
    expect(r1).toHaveBeenCalled();
    expect(r2).toHaveBeenCalled();
    expect(s.cancelConnection).toHaveBeenCalled();
    expect(dev.state).toBe('idle');
  });

  it('loads set while reconnecting are written once on connect, latest value', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice();
    await dev.connect();
    s.drop();
    await dev.writeLoad(100);
    await dev.writeLoad(120);
    expect(s.writeCharacteristicWithResponseForService).not.toHaveBeenCalled();
    await settle(backoffMs(0));
    expect(dev.state).toBe('connected');
    expect(s.writeCharacteristicWithResponseForService).toHaveBeenCalledTimes(1);
    expect(ascii(s.writeCharacteristicWithResponseForService.mock.calls[0][2])).toBe('120');
  });

  it('a failed load write on connect retries once, then surfaces the error', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    s.writeCharacteristicWithResponseForService.mockRejectedValue(new Error('ATT'));
    const dev = new OvrBleDevice();
    await dev.writeLoad(135);
    await dev.connect();
    await settle(500);
    expect(s.writeCharacteristicWithResponseForService).toHaveBeenCalledTimes(2);
    expect(dev.state).toBe('connected');
    expect(dev.error).toMatch(/Load write failed/);
  });

  it('connect() during a reconnect loop leaves a single loop', async () => {
    const s = makeDevice('OVR_Velocity-6C8E');
    mgr.advertised = [s];
    const dev = new OvrBleDevice({ scanTimeoutMs: 1000 });
    await dev.connect();
    mgr.advertised = [];
    s.drop(); // loop A pending
    const p = dev.connect(); // loop B
    await settle(1000); // B's first scan times out → B retries
    await p;
    await settle(20_000);
    // A's retry timer was cleared: only B scans, one at a time.
    const scans = mgr.startDeviceScan.mock.calls.length;
    const stops = mgr.stopDeviceScan.mock.calls.length;
    expect(scans - stops).toBeLessThanOrEqual(1);
    mgr.advertise(s);
    await settle(10_000);
    expect(dev.state).toBe('connected');
    expect(s.connect).toHaveBeenCalledTimes(2);
  });
});

describe('FakeOvrDevice', () => {
  it('createOvrDevice({ fake: true }) returns the fake', () => {
    expect(createOvrDevice({ fake: true })).toBeInstanceOf(FakeOvrDevice);
    expect(createOvrDevice({ fake: false })).toBeInstanceOf(OvrBleDevice);
  });

  it('emits reps through onRep', async () => {
    const fake = new FakeOvrDevice();
    const got: OvrRep[] = [];
    fake.onRep((r) => got.push(r));
    await fake.connect();
    expect(fake.state).toBe('connected');
    await fake.writeLoad(105);
    fake.emitRep({ meanV: 2.42, peakV: 5.64 });
    expect(got).toHaveLength(1);
    expect(got[0].meanV).toBe(2.42);
    // power = load × g × v (105 lb ≈ 467 N)
    expect(got[0].meanPowerW).toBeCloseTo(1131, -1);

    const stop = fake.autoRun(3, 1000);
    await settle(5000);
    expect(got).toHaveLength(4);
    stop();
  });

  it('emits nothing unless connected, and simulateDrop goes reconnecting → connected', async () => {
    const fake = new FakeOvrDevice();
    const got: OvrRep[] = [];
    fake.onRep((r) => got.push(r));
    expect(fake.emitRep()).toBeNull();
    await fake.connect();
    fake.simulateDrop(1000);
    expect(fake.state).toBe('reconnecting');
    expect(fake.emitRep()).toBeNull();
    await settle(1000);
    expect(fake.state).toBe('connected');
    fake.emitRep();
    expect(got).toHaveLength(1);
  });
});
