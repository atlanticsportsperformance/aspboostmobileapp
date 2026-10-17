// RPE options for the athlete's picker: whole 6–10, plus the coach's target
// when it is a half step inside that range (8.5 → 6,7,8,8.5,9,10).
const WHOLE = [6, 7, 8, 9, 10];

export function rpeOptions(target: number | null): number[] {
  if (target == null || !Number.isFinite(target) || target < 6 || target > 10) return [...WHOLE];
  if (WHOLE.includes(target)) return [...WHOLE];
  if (target * 2 !== Math.round(target * 2)) return [...WHOLE];
  return [...WHOLE, target].sort((a, b) => a - b);
}
