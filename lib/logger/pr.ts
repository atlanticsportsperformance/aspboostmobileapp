// PR candidates for one logged set (pure). The logger checks PRs once per
// set, when it is logged (Done / circle), on the set's final values — never
// per edit, so stepping past a max and back can't record a phantom PR.

export interface PrCandidate {
  metric: string;
  value: number;
  // reps_at_max: the set's reps (a reps-metric PR uses its own value).
  reps: number | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

export function prCandidates(tracked: string[] | null | undefined, setData: Record<string, unknown>): PrCandidate[] {
  const out: PrCandidate[] = [];
  for (const metric of tracked ?? []) {
    const value = num(setData[metric]);
    if (value == null || value <= 0) continue;
    out.push({ metric, value, reps: num(metric === 'reps' ? setData[metric] : setData.reps) });
  }
  return out;
}
