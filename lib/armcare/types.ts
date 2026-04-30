/**
 * Shared types + constants for the ArmCare wizard. Mirrors the web app's
 * lib/armcare/types.ts so the two stay in lock-step.
 */

export type TestType = 'ir' | 'er' | 'scaption' | 'grip';
/**
 * Each test is performed twice on the SAME arm (the throwing arm / arm of
 * record). The higher of the two attempt peaks is used as the official peak
 * for that test. There is no left/right comparison — single-arm protocol.
 */
export type RepNum = 1 | 2;

export interface RepSample {
  t: number;   // ms since rep started
  lbf: number; // post-tare, post-scale
}

export interface RepResult {
  testType: TestType;
  repNum: RepNum;
  startedAt: number;       // ms since epoch when push window started
  durationMs: number;
  peakLbf: number;
  meanLbf: number;
  samples?: RepSample[];   // optional, for replay / QA
}

export interface SessionResult {
  athleteId: string;
  examDate: string;        // YYYY-MM-DD
  bodyweightLbs: number;
  armFeels: number | null; // 1-10 self-report
  reps: RepResult[];

  // computed
  totalStrengthLbf: number;
  armScore: number;        // (top-per-test sum / bw) × 100
  /** Both attempts kept for UI; the higher one is the official peak. */
  peaks: Record<`${TestType}_${RepNum}`, number>;
  /** Top peak per test = max(rep1, rep2). */
  topPerTest: Record<TestType, number>;
  /** ER:IR ratio (same arm). */
  erIrRatio: number;
  /** Each test's share of total strength, 0..1, sums to 1. */
  percentOfTotal: Record<TestType, number>;
}

export const TEST_LABELS: Record<TestType, string> = {
  ir: 'Internal Rotation',
  er: 'External Rotation',
  scaption: 'Scaption',
  grip: 'Grip',
};

export const REP_LABELS: Record<RepNum, string> = {
  1: 'Rep 1 of 2',
  2: 'Rep 2 of 2',
};

// Two attempts per test on the same arm. Higher peak wins.
export const REP_SCHEDULE: { testType: TestType; repNum: RepNum }[] = [
  { testType: 'ir', repNum: 1 },
  { testType: 'ir', repNum: 2 },
  { testType: 'er', repNum: 1 },
  { testType: 'er', repNum: 2 },
  { testType: 'scaption', repNum: 1 },
  { testType: 'scaption', repNum: 2 },
  { testType: 'grip', repNum: 1 },
  { testType: 'grip', repNum: 2 },
];

export const POSITION_CUES: Record<TestType, string> = {
  ir: 'Lie on back, supinated forearm, elbow on ground. Push wrist toward midline.',
  er: 'Lie on back, supinated forearm, elbow on ground. Push wrist away from midline.',
  scaption:
    'Supinated forearm, arm raised 45° in scapular plane. Push up against the sensor.',
  grip: 'Kneeling, elbow at 90/90. Squeeze the sensor.',
};

// Map test types to bundled position images (require() at module scope so
// Metro can statically resolve them).
export const POSITION_IMAGES: Record<TestType, number> = {
  ir: require('../../assets/armcare/ir.jpg'),
  er: require('../../assets/armcare/er.jpg'),
  scaption: require('../../assets/armcare/scaption.jpg'),
  grip: require('../../assets/armcare/grip.jpg'),
};

export const WIZARD_TIMING = {
  TARE_MS: 2000,
  COUNTDOWN_MS: 3000,
  PUSH_MS: 3000,
  RESULT_MS: 1500,
} as const;
