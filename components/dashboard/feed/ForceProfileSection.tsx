/**
 * ForceProfileSection — hexagon radar of force-plate metrics.
 *
 * Replaces the composite-score circle gauge with a 6-axis radar plot.
 * Each axis is one tested metric (aggregated by test type when multiple
 * metrics share a type), plotted at its percentile (0–100). A dashed
 * 50th-percentile reference ring sits behind so the athlete instantly
 * sees which dimensions exceed average vs which lag.
 *
 * Composite score and tier label are shown beside the radar (no longer
 * locked inside a ring) plus the existing Strongest / Focus Area
 * percentile bars and predictions footer.
 *
 * No card container.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import Svg, {
  Polygon,
  Line as SvgLine,
  Circle as SvgCircle,
  Text as SvgText,
  Defs,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { useInView } from '../../../hooks/useInView';

interface MetricEntry {
  name: string;
  percentile: number;
  value: number;
  test_type: string;
  metric: string;
}

interface ForceProfileShape {
  composite_score: number;
  percentile_rank: number;
  best_metric: { name: string; percentile: number; value: number } | null;
  worst_metric: { name: string; percentile: number; value: number } | null;
  metrics: MetricEntry[];
}

interface PredictedVelocity {
  predicted_value: number;
  predicted_value_low?: number;
  predicted_value_high?: number;
  model_name?: string;
}

interface BodyweightData {
  current: number;
  previous: number | null;
  date: string;
}

interface Props {
  data: ForceProfileShape;
  pitchPrediction?: PredictedVelocity | null;
  batSpeedPrediction?: PredictedVelocity | null;
  bodyweight?: BodyweightData | null;
  onOpen: () => void;
}

// Hexagon slots — fixed at 6 so the radar grid always looks the same
// regardless of how much data the athlete has. Each slot is keyed by
// (test_type) plus an optional `metric` filter when we want to break a
// single test type into multiple axes (e.g. IMTP gets both an absolute
// strength axis and a relative strength axis). Slots with no matching
// data show '—' and collapse their vertex toward the center.
type HexSlot = {
  key: string;
  label: string;
  test_type: string;
  /** When set, only percentiles whose `metric` matches are aggregated
   *  into this slot. When null, averages all metrics for the test type. */
  metric: string | null;
  /** When set, percentiles whose `metric` matches are EXCLUDED from this
   *  slot (used to keep the generic IMTP axis from double-counting the
   *  IMTP-RS axis). */
  excludeMetric?: string;
};

const HEX_SLOTS: readonly HexSlot[] = [
  { key: 'imtp', label: 'IMTP', test_type: 'imtp', metric: null, excludeMetric: 'relative_strength_trial_value' },
  { key: 'cmj', label: 'CMJ', test_type: 'cmj', metric: null },
  { key: 'sj', label: 'SJ', test_type: 'sj', metric: null },
  { key: 'ppu', label: 'PPU', test_type: 'ppu', metric: null },
  { key: 'hj', label: 'HJ', test_type: 'hj', metric: null },
  { key: 'imtp_rs', label: 'IMTP RS', test_type: 'imtp', metric: 'relative_strength_trial_value' },
];

function getTier(percentile: number) {
  if (percentile >= 75)
    return { key: 'elite', label: 'ELITE', hex: '#34d399', bright: '#6ee7b7', deep: '#10b981' };
  if (percentile >= 50)
    return { key: 'optimize', label: 'OPTIMIZE', hex: '#9BDDFF', bright: '#B0E5FF', deep: '#7BC5F0' };
  if (percentile >= 25)
    return { key: 'sharpen', label: 'SHARPEN', hex: '#fbbf24', bright: '#fcd34d', deep: '#f59e0b' };
  return { key: 'build', label: 'BUILD', hex: '#ef4444', bright: '#f87171', deep: '#dc2626' };
}

/**
 * Build a fixed 6-slot axis array. Each slot averages the athlete's
 * percentiles for the configured test_type (optionally filtered to /
 * away from a specific metric), returning `null` when no matching data
 * exists. Always exactly 6 entries → reliably a hexagon.
 */
function buildAxes(
  metrics: MetricEntry[] | undefined,
): Array<{ key: string; label: string; percentile: number | null }> {
  const all = metrics ?? [];
  return HEX_SLOTS.map((slot) => {
    const matches = all.filter((m) => {
      if (m.test_type.toLowerCase() !== slot.test_type) return false;
      if (slot.metric && m.metric !== slot.metric) return false;
      if (slot.excludeMetric && m.metric === slot.excludeMetric) return false;
      return true;
    });
    const avg =
      matches.length > 0
        ? matches.reduce((s, m) => s + m.percentile, 0) / matches.length
        : null;
    return { key: slot.key, label: slot.label, percentile: avg };
  });
}

export function ForceProfileSection({
  data,
  pitchPrediction,
  batSpeedPrediction,
  bodyweight,
  onOpen,
}: Props) {
  const tier = getTier(data.percentile_rank);
  const axes = useMemo(() => buildAxes(data.metrics ?? []), [data.metrics]);
  const tested = axes.filter((a) => a.percentile != null).length;
  const { ref: viewRef, inView } = useInView(0.3);
  const progress = useGrowProgress(axes.map((a) => a.percentile ?? 0).join(','), inView);
  const composite = Math.round(data.composite_score * easeOut(Math.min(1, progress / 1.3)));

  return (
    <View ref={viewRef} collapsable={false} style={styles.section}>
      <View style={styles.hairline} />

      <Pressable onPress={onOpen} hitSlop={6} style={styles.eyebrowRow}>
        <Text style={styles.eyebrow}>FORCE PROFILE</Text>
        <Text style={[styles.eyebrowAction, { color: '#9BDDFF' }]}>View profile →</Text>
      </Pressable>

      <View style={styles.topRow}>
        <View>
          <Text style={styles.scoreLabel}>COMPOSITE</Text>
          <View style={styles.scoreLine}>
            <Text style={[styles.scoreNumber, { color: tier.hex }]}>{composite}</Text>
            <Text style={styles.scoreOf}>/100</Text>
          </View>
        </View>
        <View style={styles.topRight}>
          <View style={[styles.tierPill, { backgroundColor: `${tier.hex}1A`, borderColor: `${tier.hex}55` }]}>
            <Text style={[styles.tierPillText, { color: tier.hex }]}>{tier.label}</Text>
          </View>
          <Text style={styles.scoreFootnote}>{tested} of 6 tested</Text>
        </View>
      </View>

      <HexRadar axes={axes} progress={progress} />

      {(pitchPrediction || batSpeedPrediction || bodyweight) && (
        <View style={styles.predRow}>
          {pitchPrediction && (
            <Meta label="Predicted pitch velo" value={pitchPrediction.predicted_value.toFixed(1)} unit="mph" />
          )}
          {batSpeedPrediction && (
            <Meta label="Predicted bat speed" value={batSpeedPrediction.predicted_value.toFixed(1)} unit="mph" />
          )}
          {bodyweight && (
            <Meta
              label="Bodyweight"
              value={bodyweight.current.toFixed(0)}
              unit="lbs"
              delta={
                bodyweight.previous && bodyweight.previous > 0
                  ? ((bodyweight.current - bodyweight.previous) / bodyweight.previous) * 100
                  : null
              }
            />
          )}
        </View>
      )}

      <View style={styles.metricsBlock}>
        {data.best_metric && (
          <MetricRow label="STRONGEST" metric={data.best_metric} hex="#34d399" progress={progress} />
        )}
        {data.worst_metric && (
          <MetricRow label="FOCUS AREA" metric={data.worst_metric} hex="#ef4444" progress={progress} />
        )}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Grow-in clock: seconds since the data first arrived (or changed),
// driven by rAF for ~1.8s then frozen. One clock drives the radar
// burst, composite count-up and bar fills so they stay in step.
// ─────────────────────────────────────────────────────────────

const GROW_SECONDS = 1.8;
function useGrowProgress(key: string, active: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) {
      setT(0);
      return;
    }
    let raf = 0;
    const t0 = Date.now();
    const tick = () => {
      const s = (Date.now() - t0) / 1000;
      setT(Math.min(s, GROW_SECONDS));
      if (s < GROW_SECONDS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, active]);
  return t;
}
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
/** Overshoot-and-settle so each vertex "pops" out of the center. */
const easeBack = (k: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
};

// ─────────────────────────────────────────────────────────────
// Full-width hexagon radar. Tier rings at 25/50/75/100 match the
// tier cutoffs; the band past 75 is tinted as the Elite zone. Each
// vertex bursts out from the center in turn. Strongest axis is green,
// weakest red, both haloed.
// ─────────────────────────────────────────────────────────────

const LABEL_SPACE = 34;

function HexRadar({
  axes,
  progress,
}: {
  axes: Array<{ key: string; label: string; percentile: number | null }>;
  progress: number;
}) {
  const { width } = useWindowDimensions();
  const W = Math.min(width - 32, 420);
  const H = W * 0.94;
  const CX = W / 2;
  const CY = H / 2;
  const R = Math.min(W / 2, H / 2) - LABEL_SPACE;
  const N = 6;
  const step = (2 * Math.PI) / N;
  const start = -Math.PI / 2;
  const FORCE = '#9BDDFF';

  const point = (i: number, ratio: number) => ({
    x: CX + Math.cos(start + i * step) * R * ratio,
    y: CY + Math.sin(start + i * step) * R * ratio,
  });
  const ring = (ratio: number) =>
    Array.from({ length: N }, (_, i) => {
      const p = point(i, ratio);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');

  const filled = axes.filter((a) => a.percentile != null);
  const pcts = filled.map((a) => a.percentile!);
  const bestKey = filled.length > 1 ? filled.find((a) => a.percentile === Math.max(...pcts))?.key : undefined;
  const worstKey = filled.length > 1 ? filled.find((a) => a.percentile === Math.min(...pcts))?.key : undefined;

  // Per-axis animated ratio: staggered burst from the center.
  const ratios = axes.map((a, i) => {
    if (a.percentile == null) return 0;
    const target = Math.max(0.04, Math.min(1, a.percentile / 100));
    const k = Math.min(1, Math.max(0, (progress - 0.15 - i * 0.07) / 0.75));
    return target * easeBack(k);
  });
  const shape = ratios
    .map((r, i) => {
      const p = point(i, r);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
  const elite = point(0, 0.75);

  return (
    <View style={{ width: W, height: H, alignSelf: 'center', marginVertical: 4 }}>
      <Svg width={W} height={H}>
        <Defs>
          <RadialGradient id="fpFill" cx="50%" cy="50%" r="55%">
            <Stop offset="0" stopColor={FORCE} stopOpacity={0.04} />
            <Stop offset="1" stopColor={FORCE} stopOpacity={0.28} />
          </RadialGradient>
        </Defs>
        {/* Faint top-quartile band (75–100), neutral so only the data carries color */}
        <Polygon points={ring(1)} fill="#ffffff" fillOpacity={0.025} />
        <Polygon points={ring(0.75)} fill="#0a0b0d" />
        {[0.25, 0.5, 1].map((r) => (
          <Polygon key={r} points={ring(r)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
        ))}
        <Polygon points={ring(0.75)} fill="none" stroke="#ffffff" strokeOpacity={0.14} strokeWidth={1} strokeDasharray="2 4" />
        {Array.from({ length: N }).map((_, i) => {
          const p = point(i, 1);
          return <SvgLine key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />;
        })}
        <SvgText x={elite.x + 5} y={elite.y + 3} fill="#6b7280" fontSize={8} fontWeight="700">
          75
        </SvgText>
        {filled.length > 0 && (
          <>
            <Polygon points={shape} fill="url(#fpFill)" stroke={FORCE} strokeWidth={2} strokeLinejoin="round" />
          </>
        )}
        {axes.map((a, i) => {
          if (a.percentile == null) return null;
          const p = point(i, ratios[i]);
          const accent = a.key === bestKey ? '#34d399' : a.key === worstKey ? '#ef4444' : FORCE;
          const big = accent !== FORCE;
          return (
            <React.Fragment key={a.key}>
              <SvgCircle cx={p.x} cy={p.y} r={big ? 4.5 : 3.2} fill={big ? accent : '#0a0b0d'} stroke={accent} strokeWidth={2} />
            </React.Fragment>
          );
        })}
      </Svg>
      {axes.map((a, i) => {
        const p = point(i, 1 + LABEL_SPACE / R * 0.62);
        const empty = a.percentile == null;
        const accent = a.key === bestKey ? '#34d399' : a.key === worstKey ? '#ef4444' : '#e5e7eb';
        const shown = empty ? null : Math.round((ratios[i] / Math.max(0.04, a.percentile! / 100)) * a.percentile!);
        return (
          <View key={a.key} pointerEvents="none" style={[radarStyles.axisLabel, { left: p.x - 36, top: p.y - 17 }]}>
            <Text style={[radarStyles.axisLabelText, empty && { color: '#4b5563' }]}>{a.label}</Text>
            <Text style={[radarStyles.axisLabelPct, { color: empty ? '#4b5563' : accent }]}>
              {empty ? '—' : Math.max(0, Math.min(100, shown!))}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Strongest / Focus Area metric rows
// ─────────────────────────────────────────────────────────────

function MetricRow({
  label,
  metric,
  hex,
  progress = GROW_SECONDS,
}: {
  label: string;
  metric: { name: string; percentile: number; value: number };
  hex: string;
  progress?: number;
}) {
  const pct = Math.min(100, Math.max(0, metric.percentile));
  const shownPct = pct * easeOut(Math.min(1, Math.max(0, (progress - 0.6) / 1)));
  return (
    <View style={metricStyles.row}>
      <View style={metricStyles.headerRow}>
        <Text style={metricStyles.label}>{label}</Text>
        <Text style={[metricStyles.percent, { color: hex }]}>
          {Math.round(pct)}
          <Text style={metricStyles.percentTh}>th</Text>
        </Text>
      </View>
      <View style={metricStyles.track}>
        <View style={[metricStyles.fill, { width: `${shownPct}%`, backgroundColor: hex }]} />
      </View>
      <Text style={metricStyles.metricName}>{metric.name}</Text>
    </View>
  );
}

function Meta({
  label,
  value,
  unit,
  delta,
}: {
  label: string;
  value: string;
  unit: string;
  delta?: number | null;
}) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>
        {value}
        <Text style={styles.metaUnit}> {unit}</Text>
      </Text>
      {delta != null && (
        <Text style={[styles.metaDelta, { color: delta >= 0 ? '#34d399' : '#ef4444' }]}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 24, paddingBottom: 28, paddingHorizontal: 16 },
  hairline: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 18,
  },
  eyebrowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 18,
  },
  eyebrow: { color: '#e5e7eb', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  eyebrowAction: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 4,
  },
  topRight: { alignItems: 'flex-end', gap: 6, paddingBottom: 6 },
  scoreLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  scoreOf: { color: '#6b7280', fontSize: 13, fontWeight: '700' },
  scoreLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  scoreNumber: {
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: -2.6,
    lineHeight: 66,
    fontVariant: ['tabular-nums'],
  },
  tierPill: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  tierPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  scoreFootnote: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  metricsBlock: { gap: 16, marginTop: 18 },
  predRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  meta: { flex: 1, gap: 2 },
  metaLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  metaValue: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  metaUnit: { color: '#6b7280', fontSize: 10, fontWeight: '700' },
  metaDelta: { fontSize: 11, fontWeight: '700' },
});

const radarStyles = StyleSheet.create({
  axisLabel: {
    position: 'absolute',
    width: 72,
    alignItems: 'center',
  },
  axisLabelText: {
    color: '#9ca3af',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  axisLabelPct: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
});

const metricStyles = StyleSheet.create({
  row: { gap: 6 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  label: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  percent: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  percentTh: { fontSize: 10, fontWeight: '700' },
  track: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 4 },
  metricName: { color: '#9ca3af', fontSize: 11, fontWeight: '600' },
});
