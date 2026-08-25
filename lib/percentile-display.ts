/**
 * Read-path rules for showing a force plate percentile.
 *
 * Mirrors `lib/vald/percentile-display.ts` in the web app — the two apps are separate
 * packages and cannot share a module, so the threshold is duplicated here deliberately.
 * Keep the two in sync; MIN_COHORT_SIZE is the number that matters.
 *
 * Why it exists: most force plate metrics have no reference cohort. Driveline seed data
 * covers 34 of 874 metric columns and only male athletes at College, High School and Pro.
 * Everything else is ranked against ASP's own athletes, which for some cohorts is single
 * digits — a percentile against 9 people reads as a score but isn't one.
 */

/** Below this many comparison values, a percentile is not shown. */
export const MIN_COHORT_SIZE = 20;

/** Large enough to show, still small enough to caveat. */
export const PROVISIONAL_COHORT_SIZE = 100;

export type CohortConfidence = 'insufficient' | 'provisional' | 'established';

export function cohortConfidence(sampleSize: number | null | undefined): CohortConfidence {
  if (sampleSize == null || sampleSize < MIN_COHORT_SIZE) return 'insufficient';
  if (sampleSize < PROVISIONAL_COHORT_SIZE) return 'provisional';
  return 'established';
}

export function hasSufficientCohort(sampleSize: number | null | undefined): boolean {
  return cohortConfidence(sampleSize) !== 'insufficient';
}

/**
 * Short label explaining why a percentile is missing or qualified.
 * Written for athletes and parents, not coaches reading a stats table.
 */
export function cohortNote(sampleSize: number | null | undefined): string | null {
  switch (cohortConfidence(sampleSize)) {
    case 'insufficient':
      return sampleSize && sampleSize > 0
        ? `Building baseline — ${sampleSize} of ${MIN_COHORT_SIZE} comparisons needed`
        : 'Building baseline — no comparison data yet';
    case 'provisional':
      return `Early baseline — compared against ${sampleSize} athletes`;
    case 'established':
      return null;
  }
}
