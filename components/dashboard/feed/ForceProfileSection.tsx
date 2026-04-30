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

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Polygon, Line as SvgLine, Circle as SvgCircle } from 'react-native-svg';

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

  return (
    <View style={styles.section}>
      <View style={styles.hairline} />

      <Pressable onPress={onOpen} hitSlop={6} style={styles.eyebrowRow}>
        <Text style={styles.eyebrow}>FORCE PROFILE</Text>
        <Text style={[styles.eyebrowAction, { color: tier.hex }]}>View profile →</Text>
      </Pressable>

      {/* Radar + composite-score side panel */}
      <View style={styles.heroRow}>
        <HexRadar axes={axes} hex={tier.hex} />
        <View style={styles.scorePanel}>
          <Text style={styles.scoreLabel}>COMPOSITE</Text>
          <Text style={[styles.scoreNumber, { color: tier.hex }]}>
            {Math.round(data.composite_score)}
          </Text>
          <View
            style={[
              styles.tierPill,
              { backgroundColor: `${tier.hex}1A`, borderColor: `${tier.hex}55` },
            ]}
          >
            <Text style={[styles.tierPillText, { color: tier.hex }]}>{tier.label}</Text>
          </View>
          <Text style={styles.scoreFootnote}>
            {axes.filter((a) => a.percentile != null).length} of 6 tested
          </Text>
        </View>
      </View>

      <View style={styles.metricsBlock}>
        {data.best_metric && (
          <MetricRow label="STRONGEST" metric={data.best_metric} hex="#34d399" />
        )}
        {data.worst_metric && (
          <MetricRow label="FOCUS AREA" metric={data.worst_metric} hex="#ef4444" />
        )}
      </View>

      {(pitchPrediction || batSpeedPrediction || bodyweight) && (
        <View style={styles.metaRow}>
          {pitchPrediction && (
            <Meta label="Predicted pitch" value={`${pitchPrediction.predicted_value.toFixed(1)} mph`} />
          )}
          {batSpeedPrediction && (
            <Meta label="Predicted bat" value={`${batSpeedPrediction.predicted_value.toFixed(1)} mph`} />
          )}
          {bodyweight && (
            <Meta
              label="Bodyweight"
              value={`${bodyweight.current.toFixed(0)} lbs`}
              delta={
                bodyweight.previous && bodyweight.previous > 0
                  ? ((bodyweight.current - bodyweight.previous) / bodyweight.previous) * 100
                  : null
              }
            />
          )}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Hexagon radar (or N-gon if there are fewer axes)
// ─────────────────────────────────────────────────────────────

function HexRadar({
  axes,
  hex,
}: {
  axes: Array<{ key: string; label: string; percentile: number | null }>;
  hex: string;
}) {
  // Fixed hexagon — 6 axes, top vertex pointing up. Grid is always 6-sided
  // so the visual identity stays consistent regardless of how much of the
  // athlete's force-test battery is populated. Empty slots (no data for
  // that test type) plot at center and label as '—'.
  const SIZE = 200;
  const PAD = 22;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = SIZE / 2 - PAD;
  const N = 6;
  const angleStep = (2 * Math.PI) / N;
  const startAngle = -Math.PI / 2;

  const point = (axisIndex: number, ratio: number) => ({
    x: CX + Math.cos(startAngle + axisIndex * angleStep) * R * ratio,
    y: CY + Math.sin(startAngle + axisIndex * angleStep) * R * ratio,
  });

  const gridRings = [0.33, 0.66, 1].map((r) =>
    Array.from({ length: N }, (_, i) => {
      const p = point(i, r);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' '),
  );

  const fiftyRing = Array.from({ length: N }, (_, i) => {
    const p = point(i, 0.5);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');

  // Athlete shape — vertex per slot. Empty slots collapse to center (0)
  // so the polygon still has 6 vertices and the visual is anchored.
  const shapePoints = axes
    .map((a, i) => {
      const ratio =
        a.percentile == null ? 0 : Math.max(0.04, Math.min(1, a.percentile / 100));
      const p = point(i, ratio);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');

  const filledCount = axes.filter((a) => a.percentile != null).length;

  return (
    <View style={radarStyles.wrap}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {gridRings.map((pts, i) => (
          <Polygon
            key={`grid-${i}`}
            points={pts}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1}
          />
        ))}
        <Polygon
          points={fiftyRing}
          fill="none"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        {Array.from({ length: N }).map((_, i) => {
          const p = point(i, 1);
          return (
            <SvgLine
              key={`axis-${i}`}
              x1={CX}
              y1={CY}
              x2={p.x}
              y2={p.y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          );
        })}
        {filledCount > 0 && (
          <Polygon
            points={shapePoints}
            fill={`${hex}33`}
            stroke={hex}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        )}
        {axes.map((a, i) => {
          if (a.percentile == null) return null;
          const ratio = Math.max(0.04, Math.min(1, a.percentile / 100));
          const p = point(i, ratio);
          return <SvgCircle key={`dot-${a.key}`} cx={p.x} cy={p.y} r={2.5} fill={hex} />;
        })}
      </Svg>
      {/* Axis labels — six fixed positions so the hexagon always reads
          IMTP / CMJ / SJ / PPU / HJ / DJ even when some slots are empty. */}
      {axes.map((a, i) => {
        const p = point(i, 1.18);
        const above = p.y < CY - 2;
        const below = p.y > CY + 2;
        const yOffset = above ? -10 : below ? 0 : -5;
        const empty = a.percentile == null;
        return (
          <View
            key={`lbl-${a.key}`}
            pointerEvents="none"
            style={[
              radarStyles.axisLabel,
              { left: p.x - 28, top: p.y + yOffset },
            ]}
          >
            <Text
              style={[
                radarStyles.axisLabelText,
                empty && { color: '#4b5563' },
              ]}
            >
              {a.label}
            </Text>
            <Text
              style={[
                radarStyles.axisLabelPct,
                { color: empty ? '#4b5563' : `${hex}CC` },
              ]}
            >
              {empty ? '—' : Math.round(a.percentile!)}
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
}: {
  label: string;
  metric: { name: string; percentile: number; value: number };
  hex: string;
}) {
  const pct = Math.min(100, Math.max(0, metric.percentile));
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
        <View style={[metricStyles.fill, { width: `${pct}%`, backgroundColor: hex }]} />
      </View>
      <Text style={metricStyles.metricName}>{metric.name}</Text>
    </View>
  );
}

function Meta({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number | null;
}) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
      {delta != null && (
        <Text style={[styles.metaDelta, { color: delta >= 0 ? '#6ee7b7' : '#fca5a5' }]}>
          {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)}%
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

  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 22,
  },
  scorePanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingRight: 4,
  },
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
    lineHeight: 64,
    textAlign: 'center',
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
    marginTop: 2,
    textAlign: 'center',
  },

  metricsBlock: { gap: 16, marginBottom: 18 },
  metaRow: { flexDirection: 'row', gap: 18, marginTop: 4 },
  meta: { flex: 1, gap: 2 },
  metaLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  metaValue: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  metaDelta: { fontSize: 11, fontWeight: '700' },
});

const radarStyles = StyleSheet.create({
  wrap: {
    width: 200,
    height: 200,
    position: 'relative',
  },
  axisLabel: {
    position: 'absolute',
    width: 56,
    alignItems: 'center',
  },
  axisLabelText: {
    color: '#9ca3af',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  axisLabelPct: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 1,
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
