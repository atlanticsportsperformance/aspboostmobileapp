import {
  parseRep,
  encodeLoad,
  createRepDeduper,
  isPartial,
  dropPct,
  zoneOf,
} from '../lib/ovr/protocol';
import { base64ToBytes, bytesToBase64 } from '../lib/ble/connect';

const hex = (h: string) =>
  bytesToBase64(new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16))));

describe('parseRep', () => {
  it('decodes the HANDOFF ground-truth packet', () => {
    expect(parseRep(hex('23004e01f20034026904490a'))).toEqual({
      concentricS: 0.35,
      romIn: 33.4,
      meanV: 2.42,
      peakV: 5.64,
      meanPowerW: 1129,
      peakPowerW: 2633,
    });
  });
  it('throws on short packets', () => {
    expect(() => parseRep(hex('2300'))).toThrow();
  });
});

describe('encodeLoad', () => {
  const dec = (s: string) => String.fromCharCode(...Array.from(base64ToBytes(s)));
  it('encodes ASCII integer, rounded and clamped', () => {
    expect(dec(encodeLoad(225))).toBe('225');
    expect(dec(encodeLoad(135.6))).toBe('136');
    expect(dec(encodeLoad(-5))).toBe('0');
  });
});

describe('createRepDeduper', () => {
  const rep = parseRep(hex('23004e01f20034026904490a'));
  it('repeat on reconnect is skipped', () => {
    const skip = createRepDeduper();
    expect(skip(rep, 1000, 500)).toBe(false);
    expect(skip({ ...rep }, 2000, 2800)).toBe(true);
  });
  it('identical rep later in the set is kept', () => {
    const skip = createRepDeduper();
    skip(rep, 0, 100);
    expect(skip({ ...rep }, 0, 5000)).toBe(false);
  });
  it('different rep at reconnect is kept', () => {
    const skip = createRepDeduper();
    skip(rep, 0, 100);
    expect(skip({ ...rep, meanV: 2.1 }, 2000, 2200)).toBe(false);
  });
});

describe('isPartial', () => {
  it('uses 8 in when no median', () => {
    expect(isPartial(7.9, null)).toBe(true);
    expect(isPartial(8, null)).toBe(false);
  });
  it('uses 60% of median when set', () => {
    expect(isPartial(19.7, 33)).toBe(true);
    expect(isPartial(19.9, 33)).toBe(false);
    expect(isPartial(25, 33)).toBe(false);
  });
});

describe('dropPct', () => {
  it('rounds to integer percent, 0 when no best', () => {
    expect(dropPct(1, 0.8)).toBe(20);
    expect(dropPct(3, 2)).toBe(33);
    expect(dropPct(0, 1)).toBe(0);
  });
});

describe('zoneOf', () => {
  it('classifies against bounds', () => {
    expect(zoneOf(0.4, 0.5, 0.75)).toBe('slow');
    expect(zoneOf(0.8, 0.5, 0.75)).toBe('fast');
    expect(zoneOf(0.5, 0.5, 0.75)).toBe('in');
    expect(zoneOf(0.75, 0.5, 0.75)).toBe('in');
  });
  it('null when a bound is missing', () => {
    expect(zoneOf(0.6, null, 0.75)).toBeNull();
    expect(zoneOf(0.6, 0.5, undefined)).toBeNull();
  });
});
