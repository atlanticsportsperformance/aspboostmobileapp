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

const NUMBER = /^-?\d+(\.\d+)?$/;

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
