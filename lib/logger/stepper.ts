// +/− steppers on the exercise table's current set. Pure.

// Step per tap: weight 5 lb, reps 1, velocity (mph) 0.5, time 5 s,
// distance 5, any other numeric metric 1. Paired metric ids carry their
// kind in the name (red_ball_reps, red_ball_velo, baseball_5oz_mph).
export function stepFor(metric: string): number {
  const m = metric.toLowerCase();
  if (m === 'weight') return 5;
  if (m === 'reps' || m.endsWith('_reps')) return 1;
  if (/velo|mph|speed/.test(m)) return 0.5;
  if (m === 'time_seconds') return 5;
  if (m === 'distance') return 5;
  return 1;
}

// A plain number, incl. mid-typing forms ("12.", ".5").
const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;

// Can this value be stepped? Empty (starts from 0) or a plain number —
// free text the coach wrote ("5 LB DB", "10 yards") cannot.
export function canStep(value: unknown): boolean {
  if (value == null || value === '') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return NUMBER.test(String(value).trim());
}

// The value after one tap of + (dir 1) or − (dir -1); never below 0. null
// for free text. Empty counts as 0.
export function stepValue(metric: string, value: unknown, dir: 1 | -1): number | null {
  if (!canStep(value)) return null;
  const n = value == null || value === '' ? 0 : Number(value);
  const next = n + dir * stepFor(metric);
  return Math.max(0, Math.round(next * 100) / 100);
}

// Width (pt) of one metric column of the exercise table. Mirrors the table
// styles in exercise-detail-view: 16 pt row padding each side, SET 24, LAST
// 64 + 8, circle 32 + 8, and 8 pt before every metric column; the metric
// columns share the rest by flex (single 1; paired ball 0.9 · reps 1 · mph 1.1).
export function tableColumnWidth(args: {
  screenWidth: number;
  showLast: boolean;
  flexes: number[];
  flex: number;
}): number {
  const { screenWidth, showLast, flexes, flex } = args;
  const fixed = 32 + 24 + (showLast ? 72 : 0) + 40 + 8 * flexes.length;
  const total = flexes.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return Math.max(0, ((screenWidth - fixed) * flex) / total);
}

// Below this a cell can't hold [−] value [+] and still show the number.
export const MIN_STEPPER_CELL = 90;

// Steppers only when the row has at most 2 metric columns and this cell is
// wide enough; otherwise the cell is the tappable number alone (keypad).
export function showSteppers(metricColumns: number, cellWidth: number): boolean {
  return metricColumns <= 2 && cellWidth >= MIN_STEPPER_CELL;
}
