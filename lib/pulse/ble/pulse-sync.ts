/**
 * High-level Pulse sync flow — byte-exact decoder edition.
 *
 *   1. Subscribe to 'packet' notifications (18-byte BLE chunks)
 *   2. Write CMD.BULK_SYNC (0x01) to the CMD register
 *   3. Buffer every raw 18-byte notification (NOT pre-parsed; the framing is
 *      chunk-based, not per-IMU-sample — see pulse-chunks.ts)
 *   4. Wait for silence (SYNC_SILENCE_MS with no new packet = done)
 *   5. parseCmd01Stream(buffered notifications) → one event per pitch
 *   6. For each event: decodeEvent(sampleData, compressionData, athlete) → DecodedThrow
 *   7. Return decoded throws — WITHOUT writing 0x04 (flash wipe)
 *
 * Caller is responsible for committing to Supabase first, then calling
 * `device.wipeFlashAfterSync()`. If anything goes wrong between "decoded
 * successfully" and "persisted to DB", we want the sensor's flash intact so
 * the sync can be retried.
 *
 * Pulse iOS pipeline byte-exact match across 66 captured events:
 *   torque   0.01% mean error
 *   armSpeed 0.05% mean error
 *   armSlot  0.27% mean error
 *
 * Mobile-specific notes (see PORT_TO_MOBILE.md):
 *   - PulseDeviceRN's `addEventListener('packet', cb)` calls `cb(view)` with
 *     a DataView directly — not a CustomEvent.detail. The handlers below
 *     match this signature.
 *   - The live-session counter logic is more elaborate than web's because the
 *     sensor's POP_OR_ADVANCE protocol decrements its counter on a successful
 *     advance; we mirror that locally so subsequent ticks aren't dropped.
 */

import { PulseDeviceRN as PulseDevice } from './pulse-device-rn';
import { CMD, SYNC_SILENCE_MS, LIVE_SILENCE_MS, PACKET_BYTES } from './constants';
import { parseCmd01Stream } from './pulse-chunks';
import { decodeEvent } from '../decoder/decode-event';

export interface AthleteAnthro {
  /** Athlete height in metres. Convert from inches at the call site (× 0.0254). */
  heightM: number;
  /** Athlete weight in kilograms. Convert from pounds at the call site (× 0.45359237). */
  weightKg: number;
}

export interface DecodedThrow {
  torqueNm: number;
  armSpeedRadS: number;
  armSpeedDps: number;
  /** Arm speed in RPM — the unit Pulse iOS displays. */
  armSpeedRpm: number;
  armSlotRad: number;
  armSlotDeg: number;
  /** Driveline one-throw workload (kept on client too — DB trigger is canonical). */
  wThrow: number;
  /** How many raw samples this throw decoded from (diagnostic). */
  cleanSampleCount: number;
  /** Pulse-assigned per-pitch id — useful for ordering / dedup. */
  eventId: number;
  /** Sensor-stamped Unix seconds (0 if no metadata chunk for this event). */
  timestampSec: number;
}

export interface SyncProgress {
  /** Number of 18-byte BLE notifications received from the sensor so far. */
  packetsReceived: number;
  /** Decoded throws so far (populated only after the sync completes). */
  throwsDecoded: number;
  /** Whether the silence timer has fired and the sync has finished collecting. */
  done: boolean;
}

export interface SyncResult {
  throws: DecodedThrow[];
  /** Events the decoder skipped (too short or malformed). */
  skipped: number;
  /** Total raw 18-byte BLE notifications received. */
  notificationCount: number;
}

/**
 * Run a full bulk sync against a connected PulseDevice and return the decoded
 * throws. Does NOT wipe flash — that's the caller's job after a successful commit.
 */
export async function syncAllThrows(
  device: PulseDevice,
  athlete: AthleteAnthro,
  onProgress?: (p: SyncProgress) => void,
  ballOz?: number,
): Promise<SyncResult> {
  const notifications: Uint8Array[] = [];
  let lastPacketAt = Date.now();
  let packetCount = 0;

  const handler = (view: DataView) => {
    if (!view || view.byteLength < PACKET_BYTES) return;
    // Copy the bytes out so the decoder isn't holding refs into a buffer the
    // BLE library may reuse on its next emit. `.slice()` on Uint8Array
    // produces a fresh, independent buffer.
    notifications.push(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice(),
    );
    packetCount++;
    lastPacketAt = Date.now();
    onProgress?.({ packetsReceived: packetCount, throwsDecoded: 0, done: false });
  };
  device.addEventListener('packet', handler);

  try {
    await device.writeCmd(CMD.BULK_SYNC);
    await waitForSilence(() => lastPacketAt, SYNC_SILENCE_MS, 30_000);
  } finally {
    device.removeEventListener('packet', handler);
  }

  const events = parseCmd01Stream(notifications);
  const throws: DecodedThrow[] = [];
  let skipped = 0;
  for (const ev of events) {
    try {
      // Yield to the JS event loop between events so big bulk syncs (200+
      // pitches) don't lock the UI for the duration of the decode pass.
      // 100-200ms per event * 200 events ≈ 30s of CPU; we want progressive
      // feedback rather than one giant blocking chunk.
      await new Promise<void>((r) => setTimeout(r, 0));
      const decoded = decodeEvent(ev.sampleData, ev.compressionData, athlete, { ballOz });
      throws.push(toDecodedThrow(decoded, ev.eventId, ev.timestamp));
      onProgress?.({
        packetsReceived: packetCount,
        throwsDecoded: throws.length,
        done: false,
      });
    } catch {
      skipped++;
    }
  }

  onProgress?.({
    packetsReceived: packetCount,
    throwsDecoded: throws.length,
    done: true,
  });

  return { throws, skipped, notificationCount: notifications.length };
}

function toDecodedThrow(
  d: ReturnType<typeof decodeEvent>,
  eventId: number,
  timestampSec: number,
): DecodedThrow {
  return {
    torqueNm: d.torqueNm,
    armSpeedRadS: d.armSpeedRadS,
    armSpeedDps: d.armSpeedDps,
    armSpeedRpm: d.armSpeedRpm,
    armSlotRad: d.armSlotRad,
    armSlotDeg: d.armSlotDeg,
    wThrow: d.wThrow,
    cleanSampleCount: d.cleanSampleCount,
    eventId,
    timestampSec,
  };
}

/**
 * Resolve once the supplied `lastEventAtRef` has been unchanged for `silenceMs`.
 * Rejects if `maxWaitMs` elapses from the start of the call.
 *
 * Important: tracks whether `lastEventAtRef` has advanced past its starting
 * value, and only starts the silence timer after the first real packet has
 * been seen — otherwise a slow sensor response looks identical to a completed
 * clip.
 */
async function waitForSilence(
  lastEventAtRef: () => number,
  silenceMs: number,
  maxWaitMs: number,
): Promise<void> {
  const start = Date.now();
  const initialPacketAt = lastEventAtRef();
  while (true) {
    const now = Date.now();
    if (now - start >= maxWaitMs) {
      throw new Error(`sync timed out after ${maxWaitMs}ms without silence`);
    }
    const currentPacketAt = lastEventAtRef();
    if (currentPacketAt === initialPacketAt) {
      await delay(50);
      continue;
    }
    if (now - currentPacketAt >= silenceMs) return;
    await delay(50);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ────────────────────────────────────────────────────────────────────
// Live session — command 0x07 flow
//
// Protocol (per pulse_integration/IOS_INTEGRATION.md):
//   1. Sensor notifies on COUNTER when a new throw hits flash
//   2. Write 0x07 to CMD  → sensor streams that one throw's notifications
//   3. Wait for silence   → parseCmd01Stream → decodeEvent
//   4. Write 0x04 to CMD  → advances the cursor (decrements counter)
//   5. Loop back to (1) for the next throw
//
// The mobile `lastCounter` mirror is necessary because POP_OR_ADVANCE
// decrements the sensor's counter on its end; without local mirroring, the
// next real tick at the same numeric value would be silently dropped as a
// stale repeat.
// ────────────────────────────────────────────────────────────────────

export interface LiveSessionHandle {
  stop(): Promise<void>;
}

export interface LiveSessionCallbacks {
  /** Called as each throw lands (after decode + 0x04 advance). */
  onThrow: (t: DecodedThrow, index: number) => void;
  /** Called when decode fails on a specific clip. Index is the attempt index. */
  onDecodeError?: (error: string, index: number) => void;
  /** Called whenever the sensor notifies a new counter value. */
  onCounterChange?: (counter: number) => void;
}

/**
 * Start a live session loop. Each time the sensor counter ticks up, pull the
 * throw, decode it via the byte-exact pipeline, and call onThrow.
 *
 * Assumes the device is already connected and counter + data notifications
 * are subscribed (PulseDevice.connect() handles both).
 */
export function startLiveSession(
  device: PulseDevice,
  athlete: AthleteAnthro,
  cbs: LiveSessionCallbacks,
  ballOz?: number,
): LiveSessionHandle {
  let active = true;
  let throwIndex = 0;
  // Track the last counter value we saw AND a pending-throws queue. Both are
  // needed: the queue so multiple ticks during decode aren't lost; the mirror
  // so we can detect real increments after POP_OR_ADVANCE (which decrements
  // the sensor's counter, making the next real tick look equal to our stale
  // value and silently drop).
  let lastCounter: number | null = null;
  let pendingCount = 0;
  let processing = false;
  const pending: Uint8Array[] = [];
  let lastPacketAt = 0;

  const packetHandler = (view: DataView) => {
    if (!processing) return;
    if (!view || view.byteLength < PACKET_BYTES) return;
    pending.push(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice(),
    );
    lastPacketAt = Date.now();
  };
  device.addEventListener('packet', packetHandler);

  const counterHandler = (n: number) => {
    cbs.onCounterChange?.(n);
    if (lastCounter == null) {
      // Baseline. If the sensor reports a non-zero queue at subscribe time,
      // those are pre-existing buffered throws we should drain.
      lastCounter = n;
      if (n > 0) {
        pendingCount += n;
        if (!processing) void processNextThrow();
      }
      return;
    }
    if (n > lastCounter) {
      const delta = n - lastCounter;
      pendingCount += delta;
      if (!processing) void processNextThrow();
    }
    // n <= lastCounter: stale repeat or post-advance mirror — ignore.
    lastCounter = n;
  };
  device.addEventListener('counter', counterHandler);

  async function processNextThrow() {
    if (!active || processing) return;
    if (pendingCount <= 0) return;
    processing = true;
    pending.length = 0;
    lastPacketAt = Date.now();
    try {
      await device.writeCmd(CMD.PER_THROW_FETCH);
      // Collect packets until silence — shorter window for live mode since a
      // single throw's BLE burst is much shorter than a bulk-sync clip.
      await waitForSilence(() => lastPacketAt, LIVE_SILENCE_MS, 10_000);

      // Per-throw fetch should yield exactly one event. If the sensor mixes
      // in stale metadata we just take the first event the parser sees.
      try {
        const events = parseCmd01Stream(pending);
        if (events.length === 0) {
          cbs.onDecodeError?.('no event parsed', throwIndex);
        } else {
          const ev = events[0];
          const decoded = decodeEvent(ev.sampleData, ev.compressionData, athlete, { ballOz });
          cbs.onThrow(toDecodedThrow(decoded, ev.eventId, ev.timestamp), throwIndex);
          throwIndex++;
        }
      } catch (err: any) {
        cbs.onDecodeError?.(err?.message ?? 'decode failed', throwIndex);
      }

      // Advance the cursor so this throw is consumed — MUST happen, otherwise
      // the next 0x07 re-reads the same throw.
      try {
        await device.writeCmd(CMD.POP_OR_ADVANCE);
      } catch (advanceErr) {
        console.warn('[pulse live] cursor advance failed', advanceErr);
      }
    } finally {
      processing = false;
      pendingCount = Math.max(0, pendingCount - 1);
      // Mirror the sensor's post-POP_OR_ADVANCE state locally so the next
      // real tick is detected as a genuine increment.
      if (lastCounter != null && lastCounter > 0) lastCounter -= 1;
      if (active && pendingCount > 0) {
        void processNextThrow();
      }
    }
  }

  // Seed: if the sensor already has throws pending when we attach, drain them.
  void (async () => {
    try {
      const c = await device.readCounter();
      cbs.onCounterChange?.(c);
      if (lastCounter == null) {
        lastCounter = c;
        if (c > 0) {
          pendingCount += c;
          if (!processing) void processNextThrow();
        }
      }
    } catch {
      // ignore — first counter notification will seed instead
    }
  })();

  return {
    async stop() {
      active = false;
      device.removeEventListener('packet', packetHandler);
      device.removeEventListener('counter', counterHandler);
    },
  };
}
