/**
 * Pulse cmd01 BLE stream → per-pitch (sampleData, compressionData) extractor.
 *
 * Reference: pulse_recipe/BLE_PROTOCOL.md and Python `cap_to_bytestream` /
 * `split_events` in `/Users/maxsmac/Desktop/motus/scripts/test_per_event.py`.
 *
 * The cmd01 BLE channel emits 18-byte notifications. Each notification is:
 *
 *     [0..2]   uint16 BLE sequence number  (NOT IMU data — must be skipped)
 *     [2..18]  16 bytes of chunk-stream payload
 *
 * Concatenating the 16-byte payloads yields a flat stream of 256-byte logical
 * chunks. Each chunk is one of:
 *
 *     0x00          metadata chunk
 *     0x02 / 0x03   sample chunk
 *     0xff          firmware-error marker (skip)
 *
 * Pitches are identified by event_id, which is carried in both metadata and
 * sample chunks. Group sample chunks by event_id (concat 252-byte payloads),
 * group metadata chunks by event_id (concat the up-to-50-byte compression
 * scale array, null-terminated). The result is exactly the (sampleData,
 * compressionData) pair Pulse's GSCalculateSwingFromIMUData expects.
 *
 * This replaces the legacy `parsePacket` / `splitBySentinel` path in
 * pulse-codec.ts, which mis-framed the stream as raw 18-byte IMU samples.
 */

const CHUNK_BYTES = 256;
const BLE_NOTIFICATION_BYTES = 18;
const BLE_SEQ_HEADER_BYTES = 2;
const BLE_PAYLOAD_BYTES = BLE_NOTIFICATION_BYTES - BLE_SEQ_HEADER_BYTES; // 16

/** One pitch as extracted from the cmd01 stream. */
export interface PulseEvent {
  /** Per-pitch identifier carried in chunk headers. */
  eventId: number;
  /** Unix seconds (from the metadata chunk). 0 if no metadata seen. */
  timestamp: number;
  /** Concatenated 252-byte sample-chunk payloads (raw int16 LE × 6 per 12 B). */
  sampleData: Uint8Array;
  /** Up to 50 bytes of compression-scale metadata (null-terminated). */
  compressionData: Uint8Array;
}

/**
 * Parse a sequence of 18-byte BLE notifications into per-pitch
 * `(sampleData, compressionData)` events.
 *
 * Each notification can be a `Uint8Array`, `ArrayBuffer`, or `DataView` — all
 * are normalized to a `Uint8Array`. Notifications shorter than 18 bytes are
 * dropped (defensive — should never happen on this characteristic).
 */
export function parseCmd01Stream(
  notifications: ReadonlyArray<Uint8Array | ArrayBuffer | DataView>,
): PulseEvent[] {
  // Step 1: strip the 2-byte BLE sequence header from every notification and
  // concatenate the 16-byte payloads into a single flat byte buffer.
  const flat = concatBlePayloads(notifications);

  // Step 2: walk the flat buffer in 256-byte chunks, route by chunk[0],
  // bucketing samples + metadata + timestamp by event_id.
  const samplesByEvent = new Map<number, Uint8Array[]>();
  const metadataByEvent = new Map<number, Uint8Array[]>();
  const timestampByEvent = new Map<number, number>();
  const order: number[] = []; // preserve first-seen order for deterministic output

  const view = new DataView(flat.buffer, flat.byteOffset, flat.byteLength);
  const chunkCount = Math.floor(flat.byteLength / CHUNK_BYTES);
  for (let c = 0; c < chunkCount; c++) {
    const off = c * CHUNK_BYTES;
    const type = flat[off];

    if (type === 0x00) {
      // Metadata chunk
      const eventId = view.getUint16(off + 13, true);
      const ts = view.getUint32(off + 9, true);
      if (!timestampByEvent.has(eventId)) timestampByEvent.set(eventId, ts);

      // bytes [20..70] of the chunk = the 50-byte compression scale array,
      // null-terminated if shorter.
      const block = flat.subarray(off + 20, off + 70);
      const nullPos = block.indexOf(0);
      const meta = nullPos === -1 ? block : block.subarray(0, nullPos);
      pushBucket(metadataByEvent, eventId, meta, order);
    } else if (type === 0x02 || type === 0x03) {
      // Sample chunk
      const eventId = view.getUint16(off + 1, true);
      const payload = flat.subarray(off + 4, off + CHUNK_BYTES);
      pushBucket(samplesByEvent, eventId, payload, order);
    }
    // 0xff (and any other unknown byte) — skip
  }

  const events: PulseEvent[] = [];
  for (const eventId of order) {
    const sampleParts = samplesByEvent.get(eventId);
    if (!sampleParts || sampleParts.length === 0) continue;
    const metaParts = metadataByEvent.get(eventId) ?? [];
    events.push({
      eventId,
      timestamp: timestampByEvent.get(eventId) ?? 0,
      sampleData: concatUint8(sampleParts),
      compressionData: concatUint8(metaParts),
    });
  }
  return events;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function pushBucket(
  bucket: Map<number, Uint8Array[]>,
  key: number,
  value: Uint8Array,
  order: number[],
): void {
  const existing = bucket.get(key);
  if (existing === undefined) {
    bucket.set(key, [value]);
    if (!order.includes(key)) order.push(key);
  } else {
    existing.push(value);
  }
}

function toUint8(buf: Uint8Array | ArrayBuffer | DataView): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function concatBlePayloads(
  notifications: ReadonlyArray<Uint8Array | ArrayBuffer | DataView>,
): Uint8Array {
  let total = 0;
  for (const n of notifications) {
    const u = toUint8(n);
    if (u.byteLength >= BLE_NOTIFICATION_BYTES) total += BLE_PAYLOAD_BYTES;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const n of notifications) {
    const u = toUint8(n);
    if (u.byteLength < BLE_NOTIFICATION_BYTES) continue;
    out.set(
      u.subarray(BLE_SEQ_HEADER_BYTES, BLE_NOTIFICATION_BYTES),
      offset,
    );
    offset += BLE_PAYLOAD_BYTES;
  }
  return out;
}

function concatUint8(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}
