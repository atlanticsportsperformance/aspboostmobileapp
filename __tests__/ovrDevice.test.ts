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

const mgr = {
  advertised: [] as MockDevice[],
  state: jest.fn(async () => 'PoweredOn'),
  startDeviceScan: jest.fn((_u: any, _o: any, cb: Listener) => {
    const list = [...mgr.advertised];
    Promise.resolve().then(() => list.forEach((d) => cb(null, d)));
    return Promise.resolve();
  }),
  stopDeviceScan: jest.fn(() => Promise.resolve()),
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

  it('first connect failure goes to error without retrying', async () => {
    const dev = new OvrBleDevice({ scanTimeoutMs: 500 });
    const p = dev.connect();
    await settle(500);
    await p;
    expect(dev.state).toBe('error');
    expect(dev.error).toMatch(/No OVR sensor/);
    await settle(30_000);
    expect(mgr.startDeviceScan).toHaveBeenCalledTimes(1);
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
});
