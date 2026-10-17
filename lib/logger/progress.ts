// Workout progress derived from the set-order sequence (spec §11), so counts
// match what the athlete can actually log (uneven supersets, text rows, etc.).

import type { SeqStep } from './sequence';

type Done = Record<string, boolean[]>;

export function workoutProgress(seq: SeqStep[], done: Done): { doneSets: number; totalSets: number } {
  let doneSets = 0;
  for (const s of seq) if (done[s.reId]?.[s.setIndex] === true) doneSets++;
  return { doneSets, totalSets: seq.length };
}

export function exerciseDashes(
  reId: string,
  seq: SeqStep[],
  done: Done,
  current?: { reId: string; setIndex: number },
): ('done' | 'current' | 'todo')[] {
  return seq
    .filter(s => s.reId === reId)
    .sort((a, b) => a.setIndex - b.setIndex)
    .map(s => {
      if (done[reId]?.[s.setIndex] === true) return 'done';
      if (current && current.reId === reId && current.setIndex === s.setIndex) return 'current';
      return 'todo';
    });
}

// Minutes beyond this are a stale started_at (a workout resumed a day later),
// not real session time — the line then shows sets only.
export const MAX_ELAPSED_MIN = 240;

export function progressLine(p: { doneSets: number; totalSets: number }, elapsedMin: number): string {
  const base = `${p.doneSets}/${p.totalSets} sets`;
  return elapsedMin > 0 && elapsedMin <= MAX_ELAPSED_MIN ? `${base} · ${elapsedMin} min` : base;
}
