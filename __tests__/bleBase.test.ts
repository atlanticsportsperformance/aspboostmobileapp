import {
  base64ToBytes,
  bytesToBase64,
  byteToBase64,
  backoffMs,
  describeBleError,
} from '../lib/ble/connect';

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
  it('encodes a single byte masked to 8 bits', () => {
    expect(byteToBase64(0x04)).toBe('BA==');
    expect(byteToBase64(0x104)).toBe('BA==');
  });
  it('handles empty input', () => {
    expect(base64ToBytes('').length).toBe(0);
  });
});

describe('backoffMs', () => {
  it('doubles from 500 and caps at 8000', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });
});

describe('describeBleError', () => {
  it('formats BleError with reason and codes', () => {
    const e = describeBleError({
      errorCode: 300, reason: 'boom', message: 'm', iosErrorCode: 7, attErrorCode: 14,
    });
    expect(e.message).toBe('boom (BLE 300 / iOS 7 / ATT 14)');
  });
  it('falls back to message and omits absent codes', () => {
    expect(describeBleError({ errorCode: 2, message: 'msg' }).message).toBe('msg (BLE 2)');
  });
  it('passes Error through and wraps other values', () => {
    const err = new Error('x');
    expect(describeBleError(err)).toBe(err);
    expect(describeBleError('nope').message).toBe('nope');
  });
});
