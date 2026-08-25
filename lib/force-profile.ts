import type { SupabaseClient } from '@supabase/supabase-js';
import { cohortConfidence, hasSufficientCohort, type CohortConfidence } from './percentile-display';

/**
 * Shared force-plate (VALD "force profile") loader.
 *
 * ForceProfileScreen, DashboardScreen and ParentDashboardScreen all resolve the
 * org composite config, pull the latest percentile snapshot per test type, and
 * look up the raw trial values — logic that used to be copy-pasted three times.
 * The copies drifted: ForceProfileScreen kept an N+1 (one query per metric) long
 * after the dashboards were batched. This module is the single source of truth.
 *
 * It only fetches + normalizes. Each screen still owns its own presentation
 * (radar vs circle/hex, composite/best/worst, sorting). Metrics are returned in
 * composite-config order; callers sort as they need.
 */

export interface ForceMetric {
  percentile: number;
  value: number;
  test_type: string;
  metric: string;
  date: string;
  /** How many athletes this percentile was computed against. */
  sampleSize: number;
  confidence: CohortConfidence;
  previous?: { percentile: number; value: number; date: string };
}

/** A metric the athlete has tested, held back because its cohort is too small to rank. */
export interface SuppressedMetric {
  test_type: string;
  metric: string;
  value: number;
  date: string;
  sampleSize: number;
}

export interface ForceProfileResult {
  /** Valid metrics, in composite-config order. Empty when there is no data. */
  metrics: ForceMetric[];
  /** Number of metrics the config asked for (for "X of N metrics" copy). */
  requestedCount: number;
  /**
   * Metrics with data but too small a cohort to express as a percentile. They still
   * have a real value worth showing — they just aren't a rank.
   */
  suppressed: SuppressedMetric[];
}

// Hardcoded fallback, matching the web seed script, used when an org has no
// composite_score_configs row at all.
export const DEFAULT_COMPOSITE_CONFIG = {
  name: 'Overall Athleticism',
  metrics: [
    { test_type: 'imtp', metric: 'net_peak_vertical_force_trial_value' },
    { test_type: 'imtp', metric: 'relative_strength_trial_value' },
    { test_type: 'sj', metric: 'peak_takeoff_power_trial_value' },
    { test_type: 'cmj', metric: 'bodymass_relative_takeoff_power_trial_value' },
    { test_type: 'ppu', metric: 'peak_takeoff_force_trial_value' },
    { test_type: 'hj', metric: 'hop_mean_rsi_trial_value' },
  ],
};

// NOTE: display names (metric → label) are intentionally NOT computed here.
// The screens use slightly different label maps (e.g. "CMJ Power/BW" vs
// "CMJ Power/BM", plus extra entries), so each maps `metric` to its own label.
// This helper only fetches + normalizes the underlying data.

async function resolveCompositeConfig(supabase: SupabaseClient, orgId: string): Promise<any> {
  // Prefer the org default, then any config for the org, then the hardcoded fallback.
  let { data: compositeConfig } = await supabase
    .from('composite_score_configs')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();

  if (!compositeConfig) {
    const { data: anyConfig } = await supabase
      .from('composite_score_configs')
      .select('*')
      .eq('org_id', orgId)
      .limit(1)
      .maybeSingle();
    compositeConfig = anyConfig;
  }

  return compositeConfig || DEFAULT_COMPOSITE_CONFIG;
}

/**
 * Load the athlete's force-profile metrics for the given org.
 *
 * - One grouped `force_plate_percentiles` query (`.in('test_type', types)`),
 *   latest (and, with `includePrevious`, previous) snapshot picked per type.
 * - One parallel, de-duped batch of `${test_type}_tests` raw-value lookups.
 */
export async function loadForceProfileMetrics(
  supabase: SupabaseClient,
  athleteId: string,
  orgId: string,
  opts: { includePrevious?: boolean } = {},
): Promise<ForceProfileResult> {
  const compositeConfig = await resolveCompositeConfig(supabase, orgId);
  const metrics = compositeConfig.metrics || [];
  const requestedCount = metrics.length;
  const uniqueTestTypes = [...new Set(metrics.map((m: any) => m.test_type))];

  if (uniqueTestTypes.length === 0) return { metrics: [], requestedCount, suppressed: [] };

  const { data: allPercentiles } = await supabase
    .from('force_plate_percentiles')
    .select('test_id, test_date, test_type, percentiles, sample_sizes')
    .eq('athlete_id', athleteId)
    .in('test_type', uniqueTestTypes)
    .order('test_date', { ascending: false });

  if (!allPercentiles || allPercentiles.length === 0) return { metrics: [], requestedCount, suppressed: [] };

  // Group by type, preserving the test_date DESC order → [0] latest, [1] previous.
  const byType: Record<string, any[]> = {};
  for (const p of allPercentiles) {
    (byType[p.test_type] ||= []).push(p);
  }

  // Plan the current (+ previous) raw-value lookups, then fetch them in parallel.
  const plan: Array<{ metricSpec: any; current: any; metricPercentile: number; sampleSize: number; prev?: any; prevPercentile?: number }> = [];
  const suppressedPlan: Array<{ metricSpec: any; current: any; sampleSize: number }> = [];
  const rawJobs = new Map<string, { test_type: string; test_id: string; metric: string }>();
  const jobKey = (testId: string, metric: string) => `${testId}:${metric}`;

  for (const metricSpec of metrics) {
    const snaps = byType[metricSpec.test_type];
    if (!snaps || snaps.length === 0) continue;
    const current = snaps[0];
    const metricPercentile = current.percentiles?.[metricSpec.metric];
    if (typeof metricPercentile !== 'number' || isNaN(metricPercentile)) continue;

    const sampleSize = Number(current.sample_sizes?.[metricSpec.metric] ?? 0);

    // Too few comparisons to be a rank. Keep the raw value — the athlete still
    // tested — but route it away from the radar so it can be labelled honestly.
    if (!hasSufficientCohort(sampleSize)) {
      rawJobs.set(jobKey(current.test_id, metricSpec.metric), { test_type: metricSpec.test_type, test_id: current.test_id, metric: metricSpec.metric });
      suppressedPlan.push({ metricSpec, current, sampleSize });
      continue;
    }

    rawJobs.set(jobKey(current.test_id, metricSpec.metric), { test_type: metricSpec.test_type, test_id: current.test_id, metric: metricSpec.metric });

    const prev = opts.includePrevious ? snaps[1] : undefined;
    const prevPercentile = prev?.percentiles?.[metricSpec.metric];
    const prevSampleSize = Number(prev?.sample_sizes?.[metricSpec.metric] ?? 0);
    if (prev && typeof prevPercentile === 'number' && hasSufficientCohort(prevSampleSize)) {
      rawJobs.set(jobKey(prev.test_id, metricSpec.metric), { test_type: metricSpec.test_type, test_id: prev.test_id, metric: metricSpec.metric });
      plan.push({ metricSpec, current, metricPercentile, sampleSize, prev, prevPercentile });
    } else {
      plan.push({ metricSpec, current, metricPercentile, sampleSize });
    }
  }

  const jobs = Array.from(rawJobs.entries());
  const rawResults = await Promise.all(
    jobs.map(([, j]) =>
      supabase.from(`${j.test_type}_tests`).select(j.metric).eq('test_id', j.test_id).single()
    )
  );
  const rawByKey = new Map<string, number>();
  jobs.forEach(([key, j], i) => {
    const d = rawResults[i].data as any;
    rawByKey.set(key, d && d[j.metric] !== undefined ? Number(d[j.metric]) || 0 : 0);
  });

  const result: ForceMetric[] = [];
  for (const { metricSpec, current, metricPercentile, sampleSize, prev, prevPercentile } of plan) {
    let previous: ForceMetric['previous'] = undefined;
    if (prev && typeof prevPercentile === 'number') {
      previous = {
        percentile: prevPercentile,
        value: rawByKey.get(jobKey(prev.test_id, metricSpec.metric)) ?? 0,
        date: prev.test_date,
      };
    }
    result.push({
      percentile: Math.round(metricPercentile),
      value: rawByKey.get(jobKey(current.test_id, metricSpec.metric)) ?? 0,
      test_type: metricSpec.test_type,
      metric: metricSpec.metric,
      date: current.test_date,
      sampleSize,
      confidence: cohortConfidence(sampleSize),
      previous,
    });
  }

  const suppressed: SuppressedMetric[] = suppressedPlan.map(({ metricSpec, current, sampleSize }) => ({
    test_type: metricSpec.test_type,
    metric: metricSpec.metric,
    value: rawByKey.get(jobKey(current.test_id, metricSpec.metric)) ?? 0,
    date: current.test_date,
    sampleSize,
  }));

  return { metrics: result, requestedCount, suppressed };
}
