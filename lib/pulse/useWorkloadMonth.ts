/**
 * useWorkloadMonth — fetches per-date workload info for the athlete across
 * a month window (±14d buffer for the ACWR seed). Returns a Map keyed by
 * 'YYYY-MM-DD' with { target, actual, throwCount, acwr }.
 *
 * Used by the Dashboard calendar to paint rings on day cells and by the
 * day-detail view to render the standalone WorkloadDaySection or the
 * CombinedThrowingDayCard.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { acwr as acwrFn } from './workload';

export interface WorkloadDayEntry {
  target: number;
  actual: number;
  throwCount: number;
  acwr: number | null;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toISO(dt);
}

export function useWorkloadMonth(
  athleteId: string | null,
  monthDate: Date,
): Map<string, WorkloadDayEntry> {
  const [byDate, setByDate] = useState<Map<string, WorkloadDayEntry>>(new Map());

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      // Range: first day of month - 28 (seed) through last day of month
      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      const startIso = toISO(monthStart);
      const endIso = toISO(monthEnd);
      const seedStart = addDaysISO(startIso, -28);

      const [{ data: daily }, { data: targets }] = await Promise.all([
        supabase
          .from('pulse_daily_workload')
          .select('training_date, w_day, throw_count')
          .eq('athlete_id', athleteId)
          .gte('training_date', seedStart)
          .lte('training_date', endIso)
          .order('training_date', { ascending: true }),
        supabase
          .from('pulse_athlete_workload_day')
          .select('target_date, target_w_day')
          .eq('athlete_id', athleteId)
          .gte('target_date', startIso)
          .lte('target_date', endIso),
      ]);
      if (cancelled) return;

      // Build the continuous actuals series from seedStart to endIso
      const actualsByDate = new Map<string, number>();
      const throwsByDate = new Map<string, number>();
      for (const r of daily ?? []) {
        actualsByDate.set(r.training_date, Number(r.w_day) || 0);
        throwsByDate.set(r.training_date, Number(r.throw_count) || 0);
      }

      const series: number[] = [];
      const dateKeys: string[] = [];
      let cursor = seedStart;
      while (cursor <= endIso) {
        series.push(actualsByDate.get(cursor) ?? 0);
        dateKeys.push(cursor);
        cursor = addDaysISO(cursor, 1);
      }

      const targetByDate = new Map<string, number>();
      for (const r of targets ?? []) {
        targetByDate.set(r.target_date, Number(r.target_w_day) || 0);
      }

      // Compute ACWR per day (only for month dates, not seed)
      const result = new Map<string, WorkloadDayEntry>();
      for (let i = 28; i < series.length; i++) {
        const date = dateKeys[i];
        const actual = series[i];
        const target = targetByDate.get(date) ?? 0;
        const throwCount = throwsByDate.get(date) ?? 0;
        const val = acwrFn(series, i);
        if (target > 0 || actual > 0) {
          result.set(date, {
            target,
            actual,
            throwCount,
            acwr: val,
          });
        }
      }
      setByDate(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, monthDate.getFullYear(), monthDate.getMonth()]);

  return byDate;
}
