/**
 * Step 1 verification — `parseCmd01Stream` chunk framing.
 *
 * Reads the captured cmd01 CSVs at /Users/maxsmac/Desktop/motus/data/, feeds
 * them into our parser, and asserts the per-event sample/metadata sizes match
 * the Python reference in `scripts/test_per_event.py`. Anything mismatched
 * means the chunk framing has drifted.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCmd01Stream } from '@/lib/pulse/ble/pulse-chunks';

const DATA_DIR = '/Users/maxsmac/Desktop/motus/data';

function readCmd01Csv(path: string): Uint8Array[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  // Captures have inconsistent column order across captures
  // (e.g. pkt_num,hex,len vs pkt_num,wall_time,length,hex). Match Python's
  // approach in scripts/test_per_event.py: pick the longest hex-only field.
  const HEX_RE = /^[0-9a-fA-F]+$/;
  const out: Uint8Array[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(',');
    let hex = '';
    for (const p of parts) {
      if (p.length >= 24 && HEX_RE.test(p) && p.length > hex.length) hex = p;
    }
    if (hex.length < 36) continue;
    const u8 = new Uint8Array(hex.length / 2);
    for (let j = 0; j < u8.length; j++) {
      u8[j] = parseInt(hex.substr(j * 2, 2), 16);
    }
    out.push(u8);
  }
  return out;
}

interface Expected {
  eventId: number;
  sampleBytes: number;
  metaBytes: number;
  timestamp: number;
}

// Reference output from `python3 scripts/test_per_event.py` (already verified
// 66/66 byte-exact at the metric level — these are the exact framing sizes).
const TRUTH: Record<string, Expected[]> = {
  'cmd01_11-10-13.csv': [
    { eventId: 0, sampleBytes: 4788, metaBytes: 50, timestamp: 1735732344 },
    { eventId: 1, sampleBytes: 4788, metaBytes: 50, timestamp: 1735732354 },
    { eventId: 2, sampleBytes: 4788, metaBytes: 50, timestamp: 1735732366 },
  ],
  'cmd01_13-27-39.csv': [
    { eventId: 0, sampleBytes: 4536, metaBytes: 50, timestamp: 1735740551 },
    { eventId: 1, sampleBytes: 4536, metaBytes: 50, timestamp: 1735740556 },
    { eventId: 2, sampleBytes: 4788, metaBytes: 50, timestamp: 1735740563 },
  ],
  'cmd01_16-18-58.csv': [
    { eventId: 0, sampleBytes: 4788, metaBytes: 50, timestamp: 1735750771 },
    { eventId: 1, sampleBytes: 4788, metaBytes: 50, timestamp: 1735750779 },
    { eventId: 2, sampleBytes: 4788, metaBytes: 50, timestamp: 1735750791 },
    { eventId: 3, sampleBytes: 4536, metaBytes: 50, timestamp: 1735750801 },
    { eventId: 4, sampleBytes: 4788, metaBytes: 50, timestamp: 1735750810 },
    { eventId: 5, sampleBytes: 4788, metaBytes: 50, timestamp: 1735750820 },
    { eventId: 6, sampleBytes: 4788, metaBytes: 50, timestamp: 1735750829 },
    { eventId: 7, sampleBytes: 4788, metaBytes: 50, timestamp: 1735750840 },
    { eventId: 8, sampleBytes: 5040, metaBytes: 50, timestamp: 1735750852 },
  ],
  'cmd01_17-18-54.csv': [
    { eventId: 0, sampleBytes: 4788, metaBytes: 50, timestamp: 1735754342 },
    { eventId: 1, sampleBytes: 4788, metaBytes: 50, timestamp: 1735754351 },
    { eventId: 2, sampleBytes: 4536, metaBytes: 50, timestamp: 1735754361 },
    { eventId: 3, sampleBytes: 4536, metaBytes: 50, timestamp: 1735754374 },
    { eventId: 4, sampleBytes: 4788, metaBytes: 50, timestamp: 1735754392 },
    { eventId: 5, sampleBytes: 4536, metaBytes: 50, timestamp: 1735754409 },
    { eventId: 6, sampleBytes: 4788, metaBytes: 50, timestamp: 1735754422 },
    { eventId: 7, sampleBytes: 4536, metaBytes: 50, timestamp: 1735754432 },
  ],
};

describe('parseCmd01Stream', () => {
  // The captures live outside the repo; skip cleanly in CI environments where
  // they aren't checked out.
  const haveCaptures = existsSync(DATA_DIR);
  const maybeIt = haveCaptures ? it : it.skip;

  maybeIt.each(Object.keys(TRUTH))(
    '%s — event count, sample bytes, metadata bytes, timestamps match Python reference',
    (capture) => {
      const path = join(DATA_DIR, capture);
      const notifications = readCmd01Csv(path);
      const events = parseCmd01Stream(notifications);
      const expected = TRUTH[capture];

      expect(events).toHaveLength(expected.length);
      // Event order is first-seen — for these captures all events run sequentially
      // by event_id, so we expect ascending order.
      for (let i = 0; i < expected.length; i++) {
        expect(events[i].eventId).toBe(expected[i].eventId);
        expect(events[i].sampleData.byteLength).toBe(expected[i].sampleBytes);
        expect(events[i].compressionData.byteLength).toBe(expected[i].metaBytes);
        expect(events[i].timestamp).toBe(expected[i].timestamp);
      }
    },
  );

  maybeIt('total event count across all captures equals 66 (matches byte-exact verification claim)', () => {
    let total = 0;
    const captures = [
      'cmd01_11-10-13.csv',
      'cmd01_11-42-35.csv',
      'cmd01_13-27-39.csv',
      'cmd01_16-18-58.csv',
      'cmd01_17-18-54.csv',
      'cmd01_18-01-56.csv',
    ];
    for (const cap of captures) {
      const path = join(DATA_DIR, cap);
      if (!existsSync(path)) continue;
      const notifications = readCmd01Csv(path);
      total += parseCmd01Stream(notifications).length;
    }
    expect(total).toBe(66);
  });

  it('skips notifications shorter than 18 bytes', () => {
    // One short notification + one valid metadata chunk built across 16 valid notifications
    // (16 × 16 = 256 bytes = exactly one chunk).
    const meta = new Uint8Array(256);
    meta[0] = 0x00; // metadata chunk
    // event_id = 0x002a at bytes [13..15]
    meta[13] = 0x2a;
    meta[14] = 0x00;
    // timestamp = 0x12345678 at bytes [9..13]
    meta[9] = 0x78; meta[10] = 0x56; meta[11] = 0x34; meta[12] = 0x12;
    // metadata payload: "AB\0" at [20..]
    meta[20] = 0x41;
    meta[21] = 0x42;
    meta[22] = 0x00;

    const notifications: Uint8Array[] = [];
    // One short notification (should be ignored)
    notifications.push(new Uint8Array([0xff, 0xff]));
    // Build 16 BLE notifications (each: 2-byte seq + 16-byte payload)
    for (let i = 0; i < 16; i++) {
      const n = new Uint8Array(18);
      n[0] = i & 0xff;
      n[1] = (i >> 8) & 0xff;
      n.set(meta.subarray(i * 16, (i + 1) * 16), 2);
      notifications.push(n);
    }
    // Add a corresponding sample chunk so the event registers
    const sample = new Uint8Array(256);
    sample[0] = 0x02;
    sample[1] = 0x2a; // event_id LE
    sample[2] = 0x00;
    for (let i = 0; i < 16; i++) {
      const n = new Uint8Array(18);
      n[0] = (16 + i) & 0xff;
      n[1] = ((16 + i) >> 8) & 0xff;
      n.set(sample.subarray(i * 16, (i + 1) * 16), 2);
      notifications.push(n);
    }

    const events = parseCmd01Stream(notifications);
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe(0x2a);
    expect(events[0].timestamp).toBe(0x12345678);
    expect(events[0].compressionData).toEqual(new Uint8Array([0x41, 0x42]));
    expect(events[0].sampleData.byteLength).toBe(252);
  });

  it('skips chunks with type 0xff', () => {
    const buf = new Uint8Array(256);
    buf[0] = 0xff;
    const notifications: Uint8Array[] = [];
    for (let i = 0; i < 16; i++) {
      const n = new Uint8Array(18);
      n.set(buf.subarray(i * 16, (i + 1) * 16), 2);
      notifications.push(n);
    }
    expect(parseCmd01Stream(notifications)).toHaveLength(0);
  });

  it('groups multi-chunk samples and metadata under the same event_id', () => {
    // 1 metadata chunk + 2 sample chunks for event_id = 7
    const make = (type: number, eventIdBytes: [number, number, number]) => {
      const c = new Uint8Array(256);
      c[0] = type;
      c[eventIdBytes[2]] = eventIdBytes[0];
      c[eventIdBytes[2] + 1] = eventIdBytes[1];
      return c;
    };
    const m = make(0x00, [0x07, 0x00, 13]);
    // metadata payload: 4 bytes "ZZZZ" at offset 20
    m[20] = 0x5a; m[21] = 0x5a; m[22] = 0x5a; m[23] = 0x5a;
    const s1 = make(0x02, [0x07, 0x00, 1]);
    const s2 = make(0x03, [0x07, 0x00, 1]);

    const all = new Uint8Array(256 * 3);
    all.set(m, 0);
    all.set(s1, 256);
    all.set(s2, 512);

    const notifications: Uint8Array[] = [];
    for (let i = 0; i < all.byteLength / 16; i++) {
      const n = new Uint8Array(18);
      n[0] = i & 0xff;
      n[1] = (i >> 8) & 0xff;
      n.set(all.subarray(i * 16, (i + 1) * 16), 2);
      notifications.push(n);
    }
    const events = parseCmd01Stream(notifications);
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe(7);
    expect(events[0].sampleData.byteLength).toBe(252 * 2);
    expect(events[0].compressionData.byteLength).toBe(4);
  });
});
