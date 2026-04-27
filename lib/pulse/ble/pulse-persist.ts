/**
 * Supabase persistence for decoded Pulse throws.
 *
 * The pulse_throws table has a BEFORE INSERT trigger that computes both
 * training_date (in org timezone) and workload (from athlete height/weight).
 * We do not pre-compute those on the client — the trigger is authoritative.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DecodedThrow } from './pulse-sync';

export interface CommitThrowsInput {
  supabase: SupabaseClient;
  orgId: string;
  athleteId: string;
  throws: readonly DecodedThrow[];
  /**
   * Timestamp of the sync session. Each decoded throw gets stamped at
   * (sessionTimestamp + i seconds) so they preserve ordering without
   * colliding. Real per-throw timestamps are not available in the bulk
   * sync payload — this is a best-effort ordering.
   */
  sessionTimestamp?: Date;
  /** 'S' = sync (bulk flash dump), 'L' = live, 'M' = manual. */
  source?: 'S' | 'L' | 'M';
  /** Optional device uuid if we've persisted the sensor via pulse_devices. */
  deviceId?: string | null;
  /** Default ball weight for every throw in this commit. */
  ballWeightOz?: number;
}

export interface CommitThrowsResult {
  inserted: number;
  error: string | null;
}

export async function commitThrows({
  supabase,
  orgId,
  athleteId,
  throws,
  sessionTimestamp = new Date(),
  source = 'S',
  deviceId = null,
  ballWeightOz = 5,
}: CommitThrowsInput): Promise<CommitThrowsResult> {
  if (throws.length === 0) return { inserted: 0, error: null };

  const rows = throws.map((t, i) => ({
    org_id: orgId,
    athlete_id: athleteId,
    device_id: deviceId,
    // Stamp each throw 1 second apart so ordering is preserved
    thrown_at: new Date(sessionTimestamp.getTime() + i * 1000).toISOString(),
    torque_nm: t.torqueNm,
    arm_speed_dps: t.armSpeedDps,
    arm_slot_deg: t.armSlotDeg,
    ball_weight_oz: ballWeightOz,
    source,
    is_valid: true,
  }));

  const { error, count } = await supabase
    .from('pulse_throws')
    .insert(rows, { count: 'exact' });

  return { inserted: count ?? 0, error: error?.message ?? null };
}
