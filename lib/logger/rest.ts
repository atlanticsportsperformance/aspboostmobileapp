// Rest rules for the workout logger (spec §11.6). Pure; the hook lives in
// hooks/useRestTimer.ts.

import type { LoggerRoutine, LoggerRoutineExercise } from '../../types/logger';
import type { SeqStep } from './sequence';
import { normalizeScheme } from './scheme';

// Seconds to rest after logging `step`. 0 = "no rest, go" (mid-round in a
// grouped block); null = nothing prescribed, no timer.
export function restAfter(step: SeqStep, re: LoggerRoutineExercise, routine: LoggerRoutine): number | null {
  if (normalizeScheme(routine.scheme) !== 'straight') {
    return step.endsRound ? routine.rest_between_rounds_seconds ?? null : 0;
  }
  return re.set_configurations?.[step.setIndex]?.rest_seconds ?? re.rest_seconds ?? null;
}

export function formatRest(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Whole seconds left until `endAt` (ms epoch), rounded up, never negative.
export function secondsRemaining(endAt: number, now: number): number {
  return Math.max(0, Math.ceil((endAt - now) / 1000));
}
