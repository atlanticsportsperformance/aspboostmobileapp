/**
 * High-level Pulse sync flow.
 *
 * Wraps the PulseDevice + codec into a single "press a button, get decoded
 * throws back" operation the UI can await.
 *
 *   1. Subscribe to 'packet' notifications
 *   2. Write CMD.BULK_SYNC (0x01) to the CMD register
 *   3. Buffer every 18-byte packet
 *   4. Wait for silence (SYNC_SILENCE_MS with no new packet = done)
 *   5. Split the buffer at sentinel markers
 *   6. Decode each clip via pulse-codec
 *   7. Return the decoded throws — WITHOUT writing 0x04 (flash wipe)
 *
 * The caller is responsible for committing to Supabase first, then calling
 * `device.wipeFlashAfterSync()`. This is intentional: if anything goes wrong
 * between "decoded successfully" and "persisted to DB", we want the sensor's
 * flash to still hold the raw data so the sync can be retried.
 */

import { PulseDeviceRN as PulseDevice } from './pulse-device-rn';
import { CMD, SYNC_SILENCE_MS, LIVE_SILENCE_MS, PACKET_BYTES } from './constants';
import {
  parsePacket,
  splitBySentinel,
  decodeClip,
  type Sample,
  type DecodedThrow,
  type AthleteAnthro,
} from './pulse-codec';

export interface SyncProgress {
  /** Number of 18-byte packets received from the sensor so far. */
  packetsReceived: number;
  /** Decoded throws so far (populated only after the sync completes and clips are split). */
  throwsDecoded: number;
  /** Whether the silence timer has fired and the sync has finished collecting. */
  done: boolean;
}

export interface SyncResult {
  throws: DecodedThrow[];
  /** Clips the decoder skipped (too short or malformed). */
  skipped: number;
  /** Total raw samples received (pre-sentinel-split). */
  sampleCount: number;
}

/**
 * Run a full bulk sync against a connected PulseDevice and return the decoded
 * throws. Does NOT wipe flash — that's the caller's job after a successful commit.
 */
export async function syncAllThrows(
  device: PulseDevice,
  athlete: AthleteAnthro,
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncResult> {
  const buffer: Sample[] = [];
  let lastPacketAt = Date.now();
  let packetCount = 0;

  const handler = (view: DataView) => {
    if (!view || view.byteLength < PACKET_BYTES) return;
    buffer.push(parsePacket(view));
    packetCount++;
    lastPacketAt = Date.now();
    onProgress?.({ packetsReceived: packetCount, throwsDecoded: 0, done: false });
  };
  device.addEventListener('packet', handler);

  try {
    await device.writeCmd(CMD.BULK_SYNC);

    // Poll until we've had SYNC_SILENCE_MS of quiet on the packet stream. We
    // can't trust the counter here; the sensor has no "done" marker.
    await waitForSilence(() => lastPacketAt, SYNC_SILENCE_MS, 30_000);
  } finally {
    device.removeEventListener('packet', handler);
  }

  // Split the accumulated stream into per-throw clips at sentinel boundaries,
  // then decode each one. Decoder handles its own junk filtering.
  const clips = splitBySentinel(buffer);
  const throws: DecodedThrow[] = [];
  let skipped = 0;
  for (const clip of clips) {
    try {
      throws.push(decodeClip(clip, athlete));
    } catch {
      skipped++;
    }
  }

  onProgress?.({
    packetsReceived: packetCount,
    throwsDecoded: throws.length,
    done: true,
  });

  return { throws, skipped, sampleCount: buffer.length };
}

/**
 * Resolve once the supplied `lastEventAtRef` has been unchanged for `silenceMs`.
 * Rejects if `maxWaitMs` elapses from the start of the call.
 */
async function waitForSilence(
  lastEventAtRef: () => number,
  silenceMs: number,
  maxWaitMs: number,
): Promise<void> {
  const start = Date.now();
  // Seed — give the sensor a moment to even start responding
  await delay(200);
  while (true) {
    const now = Date.now();
    if (now - lastEventAtRef() >= silenceMs) return;
    if (now - start >= maxWaitMs) {
      throw new Error(`sync timed out after ${maxWaitMs}ms without silence`);
    }
    await delay(100);
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
//   2. Write 0x07 to CMD  → sensor streams that one throw's packets
//   3. Wait for silence   → decode the clip
//   4. Write 0x04 to CMD  → advances the cursor (decrements counter)
//   5. Loop back to (1) for the next throw
//
// Returns a handle with stop() to tear down the listeners.
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
 * throw, decode it, and call onThrow.
 *
 * Assumes the device is already connected and counter + data notifications
 * are subscribed (PulseDevice.connect() handles both).
 */
export function startLiveSession(
  device: PulseDevice,
  athlete: AthleteAnthro,
  cbs: LiveSessionCallbacks,
): LiveSessionHandle {
  let active = true;
  let throwIndex = 0;
  // pendingCount tracks how many throws we've been notified about but haven't
  // yet fetched. Simpler and correct compared to comparing counter values —
  // the sensor's counter resets after POP_OR_ADVANCE so n-vs-n comparisons
  // end up dropping throws. Each counter tick == one throw queued, full stop.
  let pendingCount = 0;
  let processing = false;
  const pending: Sample[] = [];
  let lastPacketAt = 0;

  const packetHandler = (view: DataView) => {
    if (!processing) return;
    if (!view || view.byteLength < PACKET_BYTES) return;
    pending.push(parsePacket(view));
    lastPacketAt = Date.now();
  };
  device.addEventListener('packet', packetHandler);

  const counterHandler = (n: number) => {
    cbs.onCounterChange?.(n);
    // Any counter notification means a new throw is queued on the sensor.
    // Don't compare to a previous value — POP_OR_ADVANCE resets the sensor
    // counter after each fetch, so comparisons would incorrectly drop throws.
    pendingCount++;
    if (!processing) void processNextThrow();
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
      // single throw's packet burst is much shorter than a bulk sync clip.
      await waitForSilence(() => lastPacketAt, LIVE_SILENCE_MS, 10_000);

      // Single-clip decode — strip any sentinel trailers via stripJunk (handled
      // inside decodeClip)
      try {
        const decoded = decodeClip(pending, athlete);
        cbs.onThrow(decoded, throwIndex);
        throwIndex++;
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
      // If more throws queued up while we were decoding, drain them.
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
      if (c > 0) {
        pendingCount += c;
        if (!processing) void processNextThrow();
      }
    } catch {
      // ignore
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

