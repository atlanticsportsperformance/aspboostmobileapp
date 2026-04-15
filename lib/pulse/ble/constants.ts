/**
 * Motus Pulse BLE protocol constants.
 *
 * All values sourced verbatim from pulse_integration/PROTOCOL.md and
 * pulse_integration/FINAL_FORMULAS.md. This file is the single source of truth
 * for UUIDs, command bytes, and hardware scale factors — do NOT duplicate these
 * constants anywhere else in the codebase.
 *
 * Verified on hardware version 3 (Pulse 2.0 sensor, firmware 1.32).
 */

export const PULSE = {
  CONTROL_SERVICE_UUID: '07a5adb3-2366-41e3-8ed6-1e831f4e1866',

  /** CMD register — write command bytes here (R/W/N, 1 byte) */
  CMD_CHAR_UUID: '02860ec2-cc02-4c26-8ca7-99afe6ad4892',
  /** Throw counter — uint16 LE, notifies on every stored throw (R/N, 2 bytes) */
  COUNTER_CHAR_UUID: 'c776642b-ed0d-435d-8edc-4e07ab5c7b62',
  /** Throw data stream — 18-byte IMU packets (notify only) */
  DATA_CHAR_UUID: '5f5a57dd-8a18-4e06-8f41-ffd15f219636',
  /** Session init slot — optional write of 3 zero bytes per session */
  SESSION_INIT_UUID: '9289459a-1c6c-4d7f-9309-adf046a9af4a',

  /** Standard battery service (uint8 percent) */
  BATTERY_SERVICE_UUID: 0x180f,
  BATTERY_LEVEL_UUID: 0x2a19,
} as const;

/** CMD register command bytes */
export const CMD = {
  /** Bulk sync — non-destructive dump of ALL stored throws (~290 packets/throw). */
  BULK_SYNC: 0x01,
  /**
   * Pop/advance.
   * - Written ALONE (no preceding 0x07): wipes all flash. DESTRUCTIVE.
   * - Written AFTER 0x07: advances the cursor by one throw (also decrements counter).
   * - Written AFTER 0x01 succeeds: wipes the flash that was just synced.
   */
  POP_OR_ADVANCE: 0x04,
  /** Per-throw fetch — returns one throw on the data characteristic (~290 packets). */
  PER_THROW_FETCH: 0x07,
  /** Pop exactly one throw (decrements counter by 1). */
  POP_SINGLE: 0x08,
} as const;

// ────────────────────────────────────────────────────────────────────
// Hardware scale factors (Pulse 2.0 / hardware version 3)
// Extracted from PPCommon.framework at offset 0xf300 (accel) and 0xf330 (gyro).
// ────────────────────────────────────────────────────────────────────

/** m/s² per int16 accelerometer count */
export const ACCEL_SCALE = 0.0039;
/** rad/s per int16 gyro count (stored-data path, cmd 0x01 sync) */
export const GYRO_SCALE = 0.0010642;

/** 18-byte packet layout constants */
export const PACKET_BYTES = 18;
export const PACKET_FIELDS = {
  SAMPLE_INDEX_OFFSET: 0,
  ACCEL_X_OFFSET: 2,
  ACCEL_Y_OFFSET: 4,
  ACCEL_Z_OFFSET: 6,
  GYRO_X_OFFSET: 8,
  GYRO_Y_OFFSET: 10,
  GYRO_Z_OFFSET: 12,
  ACCEL_X2_OFFSET: 14,
  ACCEL_Y2_OFFSET: 16,
} as const;

/**
 * Silence window (ms). When no packet arrives for this long during a sync,
 * we consider the bulk transfer finished. Pulse has no "done" signal; silence
 * detection is the only reliable termination (per IOS_INTEGRATION.md).
 */
export const SYNC_SILENCE_MS = 500;

/**
 * Silence window for per-throw fetches in LIVE mode. Same 500ms floor as
 * bulk sync — an earlier attempt at 150ms triggered silence before the
 * sensor even started responding to 0x07, returning an empty clip and
 * silently losing the throw. 500ms is the proven value.
 */
export const LIVE_SILENCE_MS = 500;

/** How many samples of the clip head we average for bias correction. */
export const BIAS_SAMPLE_COUNT = 20;

/**
 * Minimum clip length after junk stripping for a throw to be decodable.
 * Shorter clips are almost always noise/partial captures.
 */
export const MIN_CLIP_LENGTH = 50;
