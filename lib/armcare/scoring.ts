/**
 * ArmCare session math — single-arm protocol.
 *
 * Each test (IR / ER / Scaption / Grip) is performed TWICE on the same arm.
 * The official "peak" for that test is max(rep1, rep2). All downstream
 * formulas use those four top peaks.
 *
 *   total_strength = top_ir + top_er + top_scap + top_grip
 *   arm_score      = (total_strength / bodyweight_lbs) × 100
 *   shoulder_balance = top_er / top_ir         (same arm — matches the
 *                                               ArmCare app's "Shoulder
 *                                               Balance" tab)
 *   svr            = total_strength / max_velo
 *   percent_of_total = top_per_test / total_strength
 */

import type { RepNum, RepResult, SessionResult, TestType } from './types';

export function peakOf(samples: { lbf: number }[]): number {
  let max = 0;
  for (const s of samples) if (s.lbf > max) max = s.lbf;
  return max;
}

export function meanOf(samples: { lbf: number }[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s.lbf;
  return sum / samples.length;
}

export function computeSession(args: {
  athleteId: string;
  examDate: string;
  bodyweightLbs: number;
  reps: RepResult[];
  armFeels?: number | null;
}): SessionResult {
  const { athleteId, examDate, bodyweightLbs, reps, armFeels = null } = args;

  const peaks: Record<`${TestType}_${RepNum}`, number> = {
    ir_1: 0, ir_2: 0,
    er_1: 0, er_2: 0,
    scaption_1: 0, scaption_2: 0,
    grip_1: 0, grip_2: 0,
  };
  for (const rep of reps) {
    peaks[`${rep.testType}_${rep.repNum}`] = rep.peakLbf;
  }

  const topPerTest: Record<TestType, number> = {
    ir: Math.max(peaks.ir_1, peaks.ir_2),
    er: Math.max(peaks.er_1, peaks.er_2),
    scaption: Math.max(peaks.scaption_1, peaks.scaption_2),
    grip: Math.max(peaks.grip_1, peaks.grip_2),
  };

  const totalStrengthLbf =
    topPerTest.ir + topPerTest.er + topPerTest.scaption + topPerTest.grip;

  const armScore =
    bodyweightLbs > 0 ? (totalStrengthLbf / bodyweightLbs) * 100 : 0;

  const erIrRatio = topPerTest.ir > 0 ? topPerTest.er / topPerTest.ir : 0;

  const totalNonZero = totalStrengthLbf > 0 ? totalStrengthLbf : 1;
  const percentOfTotal: Record<TestType, number> = {
    ir: topPerTest.ir / totalNonZero,
    er: topPerTest.er / totalNonZero,
    scaption: topPerTest.scaption / totalNonZero,
    grip: topPerTest.grip / totalNonZero,
  };

  return {
    athleteId,
    examDate,
    bodyweightLbs,
    armFeels,
    reps,
    totalStrengthLbf,
    armScore,
    peaks,
    topPerTest,
    erIrRatio,
    percentOfTotal,
  };
}

/**
 * Map a SessionResult onto the column shape of public.armcare_sessions.
 *
 * Single-arm protocol: the four top peaks are written to the *_tarm_*
 * columns (the legacy "throwing arm" slots, now used as the only-arm
 * slots). The *_ntarm_* columns are explicitly nulled so any historical
 * mapping/aggregation that joined on the non-throwing-arm columns degrades
 * to empty rather than reading stale zeros.
 *
 * shoulder_balance is the ER:IR ratio on the tested arm, matching the
 * official ArmCare app's "Shoulder Balance" definition.
 */
export function toArmcareSessionRow(
  s: SessionResult,
  velo: number | null = null,
) {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const svr =
    velo != null && velo > 0 && s.totalStrengthLbf > 0
      ? Math.round((s.totalStrengthLbf / velo) * 100) / 100
      : null;

  return {
    athlete_id: s.athleteId,
    exam_date: s.examDate,
    exam_time: new Date().toTimeString().slice(0, 8),
    exam_type: 'direct_capture',

    arm_score: round2(s.armScore),
    total_strength: round2(s.totalStrengthLbf),
    weight_lbs: s.bodyweightLbs,

    velo: velo != null ? Math.round(velo * 10) / 10 : null,
    svr,

    // Top peaks (max of rep 1, rep 2) → tested-arm columns.
    irtarm_max_lbs: round2(s.topPerTest.ir),
    ertarm_max_lbs: round2(s.topPerTest.er),
    starm_max_lbs: round2(s.topPerTest.scaption),
    gtarm_max_lbs: round2(s.topPerTest.grip),

    // Non-tested-arm columns intentionally null — single-arm protocol.
    irntarm_max_lbs: null,
    erntarm_max_lbs: null,
    sntarm_max_lbs: null,
    gntarm_max_lbs: null,

    // Legacy *_strength columns mirror the tested-arm peak (kept for any
    // aggregations that hit these rather than *_max_lbs).
    irtarm_strength: round2(s.topPerTest.ir),
    ertarm_strength: round2(s.topPerTest.er),
    starm_strength: round2(s.topPerTest.scaption),
    gtarm_strength: round2(s.topPerTest.grip),

    // Shoulder Balance = ER:IR ratio on the tested arm (matches ArmCare app).
    shoulder_balance: round2(s.erIrRatio),

    fresh_arm_feels: s.armFeels != null ? String(s.armFeels) : null,

    raw_csv_data: {
      source: 'direct_capture_v1_ios',
      protocol: 'single_arm_2reps_per_test',
      erIrRatio: s.erIrRatio,
      topPerTest: s.topPerTest,
      percentOfTotal: s.percentOfTotal,
      reps: s.reps.map((r) => ({
        testType: r.testType,
        repNum: r.repNum,
        startedAt: r.startedAt,
        durationMs: r.durationMs,
        peakLbf: r.peakLbf,
        meanLbf: r.meanLbf,
        samples: r.samples,
      })),
    },
  };
}
