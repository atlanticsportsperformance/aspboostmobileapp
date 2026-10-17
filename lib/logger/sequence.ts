// The one set-order engine for the workout logger (spec §11.1).
//
// straight → every set of an exercise, then the next exercise.
// grouped  → rounds = routine.rounds ?? max(sets); each round takes one set
//            of every exercise that still has a set left, top to bottom.
// Text blocks (warm_up / notes) and notes_only rows have no sets to log and
// are left out of the sequence. Rounds only exist in grouped blocks, so
// endsRound is always false in straight blocks.

import type { LoggerRoutine, LoggerRoutineExercise } from '../../types/logger';
import { normalizeScheme } from './scheme';

export type SeqStep = {
  routineId: string;
  reId: string;
  setIndex: number;
  round: number;
  endsRound: boolean;
};

// Matches how the logger counts sets today (Array(exercise.sets)).
function setCount(re: LoggerRoutineExercise): number {
  return Math.max(0, re.sets || 0);
}

export function buildSequence(routines: LoggerRoutine[]): SeqStep[] {
  const seq: SeqStep[] = [];
  for (const routine of routines) {
    const scheme = normalizeScheme(routine.scheme);
    if (scheme === 'text') continue;
    const rows = (routine.routine_exercises || []).filter(re => !re.notes_only && setCount(re) > 0);
    if (rows.length === 0) continue;

    if (scheme === 'straight') {
      for (const re of rows) {
        const n = setCount(re);
        for (let i = 0; i < n; i++) {
          seq.push({ routineId: routine.id, reId: re.id, setIndex: i, round: i + 1, endsRound: false });
        }
      }
      continue;
    }

    const rounds = routine.rounds ?? Math.max(...rows.map(setCount));
    for (let r = 0; r < rounds; r++) {
      const inRound = rows.filter(re => r < setCount(re));
      inRound.forEach((re, i) => {
        seq.push({
          routineId: routine.id,
          reId: re.id,
          setIndex: r,
          round: r + 1,
          endsRound: i === inRound.length - 1,
        });
      });
    }
  }
  return seq;
}

// First not-done step after `from`, wrapping to the first not-done step of the
// workout; null when every step is done. A `from` that isn't in the sequence
// searches from the start.
export function nextStep(
  seq: SeqStep[],
  done: Record<string, boolean[]>,
  from?: { reId: string; setIndex: number },
): SeqStep | null {
  if (seq.length === 0) return null;
  const isDone = (s: SeqStep) => done[s.reId]?.[s.setIndex] === true;
  const start = from ? seq.findIndex(s => s.reId === from.reId && s.setIndex === from.setIndex) : -1;
  for (let k = 1; k <= seq.length; k++) {
    const step = seq[(start + k + seq.length) % seq.length];
    if (!isDone(step)) return step;
  }
  return null;
}
