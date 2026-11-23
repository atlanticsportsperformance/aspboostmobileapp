import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { buildPercentileTable, METRIC_KEYS, type PercentileTable } from '../../../lib/mocap/percentiles';
import { buildModel, HITTING_METRIC_KEYS, sportOf, type ReportDetail, type ReportModel, type Tier } from './model';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

export interface CohortState {
  table: PercentileTable | null;
  /** n rows with scalar metrics in the cohort (0 = honest "No cohort"). */
  sampleSize: number | null;
  label: string;
  loading: boolean;
  /** Softball pitching: the web skips percentiles, so do we. */
  skipped: boolean;
}

interface CohortQuery { url: string; keys: string[]; hitting: boolean; sex: string | null; category: string }

function cohortQuery(d: ReportDetail): CohortQuery | null {
  const p = d.pitch;
  const cat = p.category || 'baseball_pitching';
  if (cat === 'softball_pitching') return null;
  if (sportOf(p) === 'hitting') {
    const sex = p.sex === 'M' || p.sex === 'F' ? p.sex : null;
    const category = 'baseball_hitting';
    return {
      url: `${API_URL}/api/mocap/percentiles?category=${category}&velocity_min=0${sex ? `&sex=${sex}` : ''}`,
      keys: HITTING_METRIC_KEYS, hitting: true, sex, category,
    };
  }
  return {
    url: `${API_URL}/api/mocap/percentiles?category=${encodeURIComponent(cat)}&velocity_min=90`,
    keys: METRIC_KEYS, hitting: false, sex: null, category: cat,
  };
}

interface Fetched { table: PercentileTable | null; n: number; label: string }
const cache = new Map<string, Promise<Fetched>>();

async function load(q: CohortQuery): Promise<Fetched> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('no session');
  const res = await fetch(q.url, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) throw new Error(`percentiles ${res.status}`);
  const json = await res.json();
  const rows = (json.metrics || []) as Record<string, number>[];
  const n = typeof json.sampleSize === 'number' ? json.sampleSize : rows.length;
  const r = json.cohort?.research as { nAthletes?: number; version?: number } | null | undefined;
  const label = q.hitting
    ? `${q.category} · velocity_min 0${q.sex ? ` · sex ${q.sex}` : ''} · n=${n} swings`
    : `90+ mph · n=${n} pitches${r?.nAthletes != null ? ` · ${r.nAthletes} athletes` : ''}${r?.version != null ? ` · v${r.version}` : ''}`;
  const table = rows.length > 0 ? buildPercentileTable(rows, q.keys, q.hitting ? 'all' : '90+') : null;
  return { table, n, label };
}

export function useCohort(detail: ReportDetail): CohortState {
  const q = useMemo(() => cohortQuery(detail), [detail.pitch.category, detail.pitch.sex]);
  const [st, setSt] = useState<CohortState>(() => ({
    table: null, sampleSize: null, label: q ? '' : 'Softball pitching · no percentile cohort', loading: !!q, skipped: !q,
  }));
  useEffect(() => {
    if (!q) {
      setSt({ table: null, sampleSize: null, label: 'Softball pitching · no percentile cohort', loading: false, skipped: true });
      return;
    }
    let off = false;
    setSt((s) => ({ ...s, loading: true, skipped: false }));
    let pr = cache.get(q.url);
    if (!pr) {
      pr = load(q);
      cache.set(q.url, pr);
      pr.catch(() => cache.delete(q!.url));
    }
    pr.then(
      (f) => { if (!off) setSt({ table: f.table, sampleSize: f.n, label: f.label, loading: false, skipped: false }); },
      (e) => {
        console.warn('[mocap report] cohort fetch failed', e);
        if (!off) setSt({ table: null, sampleSize: null, label: 'Cohort unavailable', loading: false, skipped: false });
      },
    );
    return () => { off = true; };
  }, [q?.url]);
  return st;
}

export function useReportModel(detail: ReportDetail): { model: ReportModel; cohort: CohortState } {
  const cohort = useCohort(detail);
  const model = useMemo(() => buildModel(detail.pitch, cohort.table), [detail.pitch, cohort.table]);
  return { model, cohort };
}

export function useMocapScores(detail: ReportDetail): {
  composite: number | null;
  tier: { label: string; color: string } | null;
  cohortLabel: string;
  loading: boolean;
} {
  const { model, cohort } = useReportModel(detail);
  const t: Tier | null = model.tier;
  return {
    composite: model.composite,
    tier: t ? { label: t.label, color: t.color } : null,
    cohortLabel: cohort.label,
    loading: cohort.loading,
  };
}
