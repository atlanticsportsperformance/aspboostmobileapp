/**
 * WorkloadSection — feed section for throwing workload.
 *
 * Lifts the existing RadialAcwr gauge into the editorial scrollable feed.
 * No card container — just an eyebrow row, hero numbers, the gauge, a
 * 14-day sparkline, and a footer line. Renders nothing if the athlete has
 * no recent workload data at all (handled by the parent feed already, but
 * we double-gate here for safety).
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Path, Line as SvgLine } from 'react-native-svg';
import { RadialAcwr } from '../../pulse/RadialAcwr';
import type { WorkloadDayEntry } from '../../../lib/pulse/useWorkloadMonth';

interface Props {
  workloadByDate: Map<string, WorkloadDayEntry>;
  onOpen: () => void;
}

function toIsoKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function WorkloadSection({ workloadByDate, onOpen }: Props) {
  const today = useMemo(() => new Date(), []);

  const todayEntry = workloadByDate.get(toIsoKey(today));
  const dayW = todayEntry?.actual ?? 0;
  const target = todayEntry?.target ?? null;
  const throwsToday = todayEntry?.throwCount ?? 0;
  const acwr = todayEntry?.acwr ?? null;

  // Last 14 days series (oldest → newest) for the sparkline + week summary.
  const last14 = useMemo(() => {
    const out: { iso: string; w: number; throws: number; isToday: boolean }[] = [];
    const cursor = new Date(today);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() - i);
      const iso = toIsoKey(d);
      const entry = workloadByDate.get(iso);
      out.push({
        iso,
        w: entry?.actual ?? 0,
        throws: entry?.throwCount ?? 0,
        isToday: i === 0,
      });
    }
    return out;
  }, [workloadByDate, today]);

  const throwsThisWeek = last14.slice(-7).reduce((s, d) => s + d.throws, 0);
  const chronic =
    last14.reduce((s, d) => s + d.w, 0) / Math.max(1, last14.length);

  // If we have absolutely nothing — no target today, no actual today, and
  // no throws in the trailing window — the section is noise. Hide it.
  const hasAnySignal =
    dayW > 0 ||
    (target ?? 0) > 0 ||
    throwsThisWeek > 0 ||
    last14.some((d) => d.w > 0);

  if (!hasAnySignal) return null;

  const dateLabel = today.toLocaleString('en-US', { month: 'short', day: 'numeric' });

  return (
    <View style={styles.section}>
      <View style={styles.hairline} />

      <Pressable onPress={onOpen} hitSlop={6} style={styles.eyebrowRow}>
        <Text style={styles.eyebrow}>WORKLOAD</Text>
        <Text style={styles.eyebrowAction}>Open →</Text>
      </Pressable>

      <View style={styles.gaugeRow}>
        <RadialAcwr
          value={acwr}
          dayW={dayW}
          chronic={chronic}
          target={target}
          dateLabel={dateLabel}
          size={220}
        />
      </View>

      <Spark14Day data={last14} target={target ?? undefined} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          <Text style={styles.footerNum}>{throwsToday}</Text> today
          {'  ·  '}
          <Text style={styles.footerNum}>{throwsThisWeek}</Text> this week
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Inline 14-day sparkline (full-width, no card)
// ─────────────────────────────────────────────────────────────

function Spark14Day({
  data,
  target,
}: {
  data: { iso: string; w: number; isToday: boolean }[];
  target?: number;
}) {
  const W = 320;
  const H = 36;

  const max = Math.max(target ?? 0, ...data.map((d) => d.w), 0.5);
  const xStep = W / (data.length - 1);

  const path = data
    .map((d, i) => {
      const x = i * xStep;
      const y = H - (d.w / max) * H;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  // Fill underneath the line for a soft area shape
  const areaPath = `${path} L ${W.toFixed(1)} ${H} L 0 ${H} Z`;

  const targetY = target && target > 0 ? H - (target / max) * H : null;

  return (
    <View style={styles.sparkWrap}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* faint baseline */}
        <SvgLine x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        {/* target line */}
        {targetY != null && (
          <SvgLine
            x1={0}
            y1={targetY}
            x2={W}
            y2={targetY}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        )}
        {/* area under the curve */}
        <Path d={areaPath} fill="rgba(155,221,255,0.12)" />
        {/* line itself */}
        <Path d={path} fill="none" stroke="#9BDDFF" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <Text style={styles.sparkAxis}>14d</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 24,
    paddingBottom: 28,
    paddingHorizontal: 16,
  },
  hairline: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 18,
  },
  eyebrowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  eyebrow: {
    color: '#e5e7eb',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },
  eyebrowAction: {
    color: '#9BDDFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  gaugeRow: {
    alignItems: 'center',
    marginTop: 4,
  },
  sparkWrap: {
    marginTop: 14,
    paddingHorizontal: 0,
  },
  sparkAxis: {
    color: '#4b5563',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'right',
    marginTop: 2,
  },
  footer: {
    marginTop: 10,
    alignItems: 'center',
  },
  footerText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  footerNum: {
    color: '#fff',
    fontWeight: '800',
  },
});
