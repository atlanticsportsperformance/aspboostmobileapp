import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// aliased: react-native-svg also exports a LinearGradient
import { LinearGradient as Gradient } from 'expo-linear-gradient';
import Svg, { Path, Line, Circle, Polygon, Defs, LinearGradient, RadialGradient, Stop } from 'react-native-svg';
import {
  type PercentileTable,
  type RowData,
  GROUPS,
  computeScore,
  INDUSTRY_MEDIAN,
  computeGroupData,
  computePercentile,
  getMetricData,
  buildDistributionPath,
} from '../../lib/mocap/percentiles';

// ─── Tier ladder ─────────────────────────────────────────────────────────────
// Color only ever means tier. Athlete data is white. The ladder runs
// alarming -> neutral -> alive -> precious so the top of the scale is the
// one that reads as a reward.
const NEEDS_WORK = '#FF5C7A';
const EMERGING = '#8B93A7';
const GOOD = '#4ADE80';
const ADVANCED = '#E3B341';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PAGE_PAD = 20;
const CARD_W = SCREEN_WIDTH - PAGE_PAD * 2 - 34;
const CHART_W = SCREEN_WIDTH - 48;
const CHART_H = 60;

function zoneColor(pct: number): string {
  if (pct >= 75) return ADVANCED;
  if (pct >= 50) return GOOD;
  if (pct >= 25) return EMERGING;
  return NEEDS_WORK;
}

/** 1 -> 1st, 22 -> 22nd, 13 -> 13th. */
function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function zoneLabel(pct: number): string {
  if (pct >= 75) return 'ADVANCED';
  if (pct >= 50) return 'GOOD';
  if (pct >= 25) return 'EMERGING';
  return 'NEEDS WORK';
}

// ─── Animated Number ─────────────────────────────────────────────────────────

function CountUp({ value, decimals = 0, delay = 0, prefix = '', style }: {
  value: number; decimals?: number; delay?: number; prefix?: string; style?: any;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.spring(anim, { toValue: value, damping: 22, stiffness: 100, useNativeDriver: false }).start();
    }, delay);
    const id = anim.addListener(({ value: v }) => setDisplay(v));
    return () => { clearTimeout(t); anim.removeListener(id); };
  }, [value, delay]);

  return <Text style={style}>{prefix}{display.toFixed(decimals)}</Text>;
}

// ─── Octagon Radar ───────────────────────────────────────────────────────────
// Flat octagonal grid — eight spokes so it reads as a proper radar — with the
// four measured groups on the cardinal axes. The white contour is smoothed
// through those four points; dots mark only what was actually measured, so
// the diagonals stay unclaimed.

const RADAR_W = SCREEN_WIDTH - PAGE_PAD * 2;
const R = Math.min(RADAR_W / 2 - 62, 118);
const PILL_ROOM = 46;
const RADAR_H = 2 * (R + PILL_ROOM);
const CX = RADAR_W / 2;
const CY = RADAR_H / 2;
const PILL_W = 56;

const AXES = [
  { label: 'Drive', angle: -90 },    // top
  { label: 'Posture', angle: 0 },    // right
  { label: 'Block', angle: 90 },     // bottom
  { label: 'Arm', angle: 180 },      // left
];

/** Eight cage spokes: the four measured axes plus four empty guides. */
const CAGE_ANGLES = [-90, -45, 0, 45, 90, 135, 180, 225];

function rp(angleDeg: number, pct: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CX + (pct / 100) * R * Math.cos(rad),
    y: CY + (pct / 100) * R * Math.sin(rad),
  };
}

function octagon(pct: number) {
  return CAGE_ANGLES
    .map(a => {
      const p = rp(a, pct);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
}

/** Closed Catmull-Rom through the four vertices, as a cubic bezier path. */
function smoothClosedPath(pts: { x: number; y: number }[]) {
  const n = pts.length;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

/** Where a vertex pill sits, in absolute coords inside the radar box. */
function pillBox(angle: number) {
  if (angle === -90) return { left: CX - PILL_W / 2, top: CY - R - 42 };
  if (angle === 90) return { left: CX - PILL_W / 2, top: CY + R + 8 };
  if (angle === 0) return { left: CX + R + 4, top: CY - 18 };
  return { left: CX - R - PILL_W - 4, top: CY - 18 };
}

function VertexPill({ score, label, angle }: { score: number; label: string; angle: number }) {
  const color = zoneColor(score);
  const isSlate = color === EMERGING;
  return (
    <View style={[styles.vertexPill, pillBox(angle)]}>
      <View style={[
        styles.vertexChip,
        { backgroundColor: isSlate ? 'rgba(139,147,167,0.28)' : color },
      ]}>
        <Text style={[styles.vertexChipText, { color: isSlate ? '#FFFFFF' : '#0A0A0B' }]}>
          {Math.round(score)}
        </Text>
      </View>
      <Text style={styles.vertexLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

function RadarChart({ groupScores }: { groupScores: number[] }) {
  const cageOpacity = useRef(new Animated.Value(0)).current;
  const athleteScale = useRef(new Animated.Value(0.6)).current;
  const athleteOpacity = useRef(new Animated.Value(0)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(cageOpacity, { toValue: 1, duration: 500, delay: 100, useNativeDriver: true }).start();
    Animated.parallel([
      Animated.timing(athleteOpacity, { toValue: 1, duration: 420, delay: 380, useNativeDriver: true }),
      Animated.spring(athleteScale, { toValue: 1, damping: 18, stiffness: 110, delay: 380, useNativeDriver: true }),
    ]).start();
    Animated.timing(pillOpacity, { toValue: 1, duration: 420, delay: 700, useNativeDriver: true }).start();
  }, []);

  const athletePts = groupScores.map((pct, i) => rp(AXES[i].angle, Math.max(pct, 3)));
  const athletePath = smoothClosedPath(athletePts);

  return (
    <View style={styles.radarContainer}>
      {/* Grid — octagon rings and eight spokes */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: cageOpacity }]}>
        <Svg width={RADAR_W} height={RADAR_H} viewBox={`0 0 ${RADAR_W} ${RADAR_H}`}>
          <Polygon points={octagon(100)} fill="none" stroke="#35353E" strokeWidth="1" />
          <Polygon points={octagon(75)} fill="none" stroke="#2A2A31" strokeWidth="1" opacity={0.85} />
          <Polygon points={octagon(50)} fill="none" stroke="#2A2A31" strokeWidth="1" opacity={0.7} />
          <Polygon points={octagon(25)} fill="none" stroke="#2A2A31" strokeWidth="1" opacity={0.5} />

          {CAGE_ANGLES.map((a, i) => {
            const f = rp(a, 100);
            const measured = i % 2 === 0;
            return (
              <Line key={`spoke-${a}`} x1={CX} y1={CY} x2={f.x} y2={f.y}
                stroke={measured ? '#33333B' : '#232329'} strokeWidth="1" />
            );
          })}
        </Svg>
      </Animated.View>

      {/* This pitch — white contour, no tier color */}
      <Animated.View style={[
        styles.radarSvgLayer,
        { opacity: athleteOpacity, transform: [{ scale: athleteScale }] },
      ]}>
        <Svg width={RADAR_W} height={RADAR_H} viewBox={`0 0 ${RADAR_W} ${RADAR_H}`}>
          <Path d={athletePath} fill="rgba(255,255,255,0.05)" stroke="#FFFFFF" strokeWidth="2" />
          {athletePts.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#FFFFFF" />
          ))}
        </Svg>
      </Animated.View>

      {/* Vertex pills */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: pillOpacity, height: RADAR_H }]}>
        {AXES.map((a, i) => (
          <VertexPill key={a.label} score={groupScores[i]} label={a.label} angle={a.angle} />
        ))}
      </Animated.View>
    </View>
  );
}

// ─── Distribution Chart ──────────────────────────────────────────────────────

function DistributionSvg({ percKey, athleteValue, athletePct, delay, percentileData }: {
  percKey: string; athleteValue: number | null; athletePct: number; delay: number;
  percentileData: PercentileTable | null;
}) {
  // Left-to-right reveal: animate the width of a clipping View
  const revealWidth = useRef(new Animated.Value(0)).current;
  const markerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      // Draw left to right over 800ms
      Animated.timing(revealWidth, { toValue: CHART_W, duration: 800, useNativeDriver: false }).start(() => {
        // Then pop in the athlete marker
        Animated.timing(markerOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      });
    }, delay);
    return () => clearTimeout(t);
  }, [delay]);

  const md = getMetricData(percKey, percentileData);
  if (!md) return null;

  const pcts = md.percentiles;
  const p1 = pcts['1'], p99 = pcts['99'], range = p99 - p1 || 1;
  const athleteX = athleteValue != null ? Math.max(0, Math.min(1, (athleteValue - p1) / range)) * CHART_W : null;
  const p50X = ((pcts['50'] - p1) / range) * CHART_W;
  const path = buildDistributionPath(pcts, CHART_W, CHART_H);
  const color = zoneColor(athletePct);

  return (
    <View style={{ height: CHART_H, overflow: 'hidden' }}>
      {/* Animated clip — reveals the SVG left to right */}
      <Animated.View style={{ width: revealWidth, height: CHART_H, overflow: 'hidden' }}>
        <Svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
          <Defs>
            <LinearGradient id={`df-${percKey}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.50" />
              <Stop offset="1" stopColor={color} stopOpacity="0.08" />
            </LinearGradient>
          </Defs>
          <Path d={path} fill={`url(#df-${percKey})`} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
          <Line x1={p50X} y1={0} x2={p50X} y2={CHART_H} stroke="rgba(74,222,128,0.5)" strokeWidth="1.5" strokeDasharray="3 2" />
        </Svg>
      </Animated.View>

      {/* Athlete marker — pops in after the draw completes */}
      {athleteX != null && (
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: markerOpacity }}>
          <Svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
            <Line x1={athleteX} y1={2} x2={athleteX} y2={CHART_H} stroke={color} strokeWidth="2.5" />
            <Circle cx={athleteX} cy={3} r={5} fill={color} />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
}

// ─── Group Tile ──────────────────────────────────────────────────────────────
// Four tier-tinted buttons in a 2x2 grid. Tapping one drives the metric list
// below, so they need to read as pressable, not as decoration.

const TILE_GAP = 8;
const TILE_W = (SCREEN_WIDTH - PAGE_PAD * 2 - TILE_GAP) / 2;
const TILE_H = 116;

function GroupTile({ title, score, metrics, active, onPress }: {
  title: string; score: number; metrics: RowData[];
  active: boolean; onPress: () => void;
}) {
  const color = zoneColor(score);

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.groupTile,
        { borderColor: active ? `${color}9E` : 'rgba(255,255,255,0.08)' },
      ]}
    >
      <Gradient
        colors={[`${color}${active ? '57' : '38'}`, `${color}0D`, 'rgba(255,255,255,0.02)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.65, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* top sheen — the thing that makes a flat tile read as a raised button */}
      <View
        style={[styles.tileSheen, { backgroundColor: active ? `${color}80` : 'rgba(255,255,255,0.12)' }]}
        pointerEvents="none"
      />

      <Text style={[styles.tileScore, { color }]}>{Math.round(score)}</Text>

      <View>
        <Text
          style={[styles.tileName, active && { color: `${color}F2` }]}
          numberOfLines={2}
        >
          {title.toUpperCase()}
        </Text>
        <Text style={styles.tileSub}>{metrics.length} metrics</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Metric Detail Modal ─────────────────────────────────────────────────────

function MetricDetailModal({ metric, visible, onClose, percentileData }: {
  metric: RowData | null; visible: boolean; onClose: () => void;
  percentileData: PercentileTable | null;
}) {
  if (!metric) return null;

  const color = zoneColor(metric.pct);
  const zone = zoneLabel(metric.pct);
  const md = getMetricData(metric.percKey, percentileData);
  const eliteP50 = md?.percentiles['50'];
  const industry = INDUSTRY_MEDIAN[metric.key];
  const scoringType = metric.scoring === 'higher' ? 'Higher is better' : 'Optimal near elite median';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <View style={modalStyles.container}>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {/* Header */}
            <View style={modalStyles.header}>
              <View style={{ flex: 1 }}>
                <Text style={[modalStyles.percentile, { color }]}>P{Math.round(metric.pct)}</Text>
                <Text style={modalStyles.title}>{metric.axisLabel}</Text>
                {metric.timing && (
                  <Text style={modalStyles.timing}>{metric.timing}</Text>
                )}
              </View>
              <TouchableOpacity onPress={onClose} style={modalStyles.closeButton}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            {/* Zone + scoring type */}
            <View style={modalStyles.tagRow}>
              <View style={[modalStyles.tag, { borderColor: `${color}40` }]}>
                <View style={[modalStyles.tagDot, { backgroundColor: color }]} />
                <Text style={[modalStyles.tagText, { color }]}>{zone}</Text>
              </View>
              <View style={[modalStyles.tag, { borderColor: 'rgba(255,255,255,0.1)' }]}>
                <Ionicons name={metric.scoring === 'higher' ? 'arrow-up' : 'swap-horizontal'} size={12} color="rgba(255,255,255,0.4)" />
                <Text style={modalStyles.tagTextSubtle}>{scoringType}</Text>
              </View>
            </View>

            {/* Cohort distribution — the hero of the sheet */}
            <View style={{ paddingHorizontal: 24, marginBottom: 6 }}>
              <DistributionSvg
                percKey={metric.percKey}
                athleteValue={metric.raw}
                athletePct={metric.pct}
                delay={120}
                percentileData={percentileData}
              />
              <View style={modalStyles.distAxis}>
                <Text style={modalStyles.distAxisText}>weakest</Text>
                <Text style={modalStyles.distAxisText}>
                  {eliteP50 != null ? `elite median ${eliteP50.toFixed(1)}` : 'median'}
                </Text>
                <Text style={modalStyles.distAxisText}>strongest</Text>
              </View>
            </View>

            {/* Values */}
            <View style={modalStyles.valuesGrid}>
              <View style={modalStyles.valueCell}>
                <Text style={modalStyles.valueCellLabel}>YOUR VALUE</Text>
                <Text style={[modalStyles.valueCellNumber, { color }]}>
                  {metric.raw != null ? metric.raw.toFixed(1) : '--'}
                </Text>
                <Text style={modalStyles.valueCellUnit}>{metric.unit}</Text>
              </View>
              {eliteP50 != null && (
                <View style={modalStyles.valueCell}>
                  <Text style={[modalStyles.valueCellLabel, { color: 'rgba(74,222,128,0.6)' }]}>ELITE P50</Text>
                  <Text style={[modalStyles.valueCellNumber, { color: 'rgba(74,222,128,0.7)' }]}>
                    {eliteP50.toFixed(1)}
                  </Text>
                  <Text style={[modalStyles.valueCellUnit, { color: 'rgba(74,222,128,0.4)' }]}>{metric.unit}</Text>
                </View>
              )}
              {industry && (
                <View style={modalStyles.valueCell}>
                  <Text style={[modalStyles.valueCellLabel, { color: 'rgba(251,191,36,0.6)' }]}>INDUSTRY</Text>
                  <Text style={[modalStyles.valueCellNumber, { color: 'rgba(251,191,36,0.7)' }]}>
                    {industry.value}
                  </Text>
                  <Text style={[modalStyles.valueCellUnit, { color: 'rgba(251,191,36,0.4)' }]}>{metric.unit}</Text>
                </View>
              )}
            </View>

            {/* Divider */}
            <View style={modalStyles.divider} />

            {/* Detail text */}
            <Text style={modalStyles.detailTitle}>What is this?</Text>
            <Text style={modalStyles.detailText}>{metric.detail}</Text>

            {/* Score explanation */}
            <View style={modalStyles.divider} />
            <Text style={modalStyles.detailTitle}>How is this scored?</Text>
            <Text style={modalStyles.detailText}>
              {metric.scoring === 'higher'
                ? 'This is a power/velocity metric where higher values directly contribute to performance. Your percentile rank is your score — the higher the better.'
                : 'This is a positional metric where the elite median (p50) represents the optimal value. Being too far above or below the elite average can indicate inefficiency or injury risk. Your score is based on how close you are to the optimal range.'}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Single Metric Row ───────────────────────────────────────────────────────

function MetricRow({ d, delay, percentileData }: {
  d: RowData; delay: number; percentileData: PercentileTable | null;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const barAnim = useRef(new Animated.Value(0)).current;
  const accentHeight = useRef(new Animated.Value(0)).current;

  const color = zoneColor(d.pct);
  const md = getMetricData(d.percKey, percentileData);
  const eliteP50 = md?.percentiles['50'];
  const industry = INDUSTRY_MEDIAN[d.key];

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.spring(fadeAnim, { toValue: 1, damping: 20, stiffness: 90, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, damping: 20, stiffness: 90, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(barAnim, { toValue: Math.max(d.pct, 2), damping: 14, stiffness: 50, useNativeDriver: false }),
          Animated.spring(accentHeight, { toValue: 20, damping: 12, stiffness: 60, useNativeDriver: false }),
        ]).start();
      }, 200);
    }, delay);
    return () => clearTimeout(t);
  }, [delay, d.pct]);

  const barWidth = barAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity
        style={styles.metricCard}
        activeOpacity={0.8}
        onPress={() => setShowDetail(true)}
      >
        {/* Name and the actual measurement lead — percentile is the caption */}
        <View style={styles.metricCardTop}>
          <Text style={styles.metricCardName} numberOfLines={1}>{d.axisLabel}</Text>
          <Text style={styles.metricCardRaw}>
            {d.raw != null ? d.raw.toFixed(1) : '--'}
            <Text style={styles.metricCardUnit}> {d.unit}</Text>
          </Text>
        </View>

        <View style={styles.barTrack}>
          <Animated.View style={[styles.barFill, { width: barWidth, backgroundColor: color }]} />
          <View style={styles.barP50} />
        </View>

        <View style={styles.metricCardFoot}>
          <Text style={[styles.metricCardPct, { color }]}>
            {d.raw != null ? `${ordinal(Math.round(d.pct))} percentile` : 'no reading'}
            {d.scoring === 'goldilocks' ? ' · target band' : ''}
          </Text>
          <Text style={styles.metricCardCmp}>
            {eliteP50 != null ? `elite median ${eliteP50.toFixed(1)}` : ''}
          </Text>
        </View>
      </TouchableOpacity>

      <MetricDetailModal
        metric={d}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        percentileData={percentileData}
      />
    </Animated.View>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface Props {
  scalarMetrics: Record<string, number>;
  percentileData: PercentileTable | null;
  velocity?: number | null;
  pitchType?: string;
}

export default function PercentileBreakdown({ scalarMetrics, percentileData, velocity, pitchType }: Props) {
  const [activeGroup, setActiveGroup] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  if (!percentileData) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading percentile data...</Text>
      </View>
    );
  }

  const allGroupData = GROUPS.map(g => computeGroupData(g, scalarMetrics, percentileData));
  const groupScores = allGroupData.map(data => data.reduce((s, d) => s + d.score, 0) / data.length);
  const allData = allGroupData.flat();
  const overallScore = allData.reduce((s, d) => s + d.score, 0) / allData.length;

  const slideX = useRef(new Animated.Value(0)).current;

  const switchGroup = (idx: number) => {
    if (idx === activeGroup) return;
    const direction = idx > activeGroup ? 1 : -1;
    // Slide out in direction, swap content, slide in from opposite
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
      Animated.timing(slideX, { toValue: -direction * 30, duration: 100, useNativeDriver: true }),
    ]).start(() => {
      setActiveGroup(idx);
      slideX.setValue(direction * 30);
      Animated.parallel([
        Animated.spring(fadeAnim, { toValue: 1, damping: 20, stiffness: 120, useNativeDriver: true }),
        Animated.spring(slideX, { toValue: 0, damping: 20, stiffness: 120, useNativeDriver: true }),
      ]).start();
    });
  };

  const activeData = allGroupData[activeGroup];
  const activeAvg = groupScores[activeGroup];
  const activeColor = zoneColor(activeAvg);
  const overallColor = zoneColor(overallScore);

  // Strongest group first — the weakest lands last, where it reads as the ask.
  const order = GROUPS.map((_, i) => i).sort((a, b) => groupScores[b] - groupScores[a]);

  return (
    <View style={styles.container}>
      {/* Ambient wash, tinted by the composite's tier */}
      <Gradient
        colors={[`${overallColor}1C`, 'transparent']}
        style={styles.ambient}
        pointerEvents="none"
      />

      {/* ── Tier badge + cohort line ── */}
      <View style={styles.zoneHeader}>
        <View style={[styles.zoneBadge, { backgroundColor: `${overallColor}1F` }]}>
          <Text style={[styles.zoneBadgeText, { color: overallColor }]}>
            {zoneLabel(overallScore)}
          </Text>
        </View>
        <Text style={styles.zoneDescription}>
          Biomechanics analysis vs {percentileData.sampleSize} elite pitches
        </Text>
      </View>

      {/* ── Velocity left, composite right ── */}
      <View style={styles.statsRow}>
        <View>
          {velocity != null && (
            <Text style={styles.velocityValue}>
              {velocity}
              <Text style={styles.velocityUnit}> mph</Text>
            </Text>
          )}
          <Text style={styles.velocityLabel}>
            {pitchType || 'Pitch'} · {percentileData.cohort} mph cohort
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.compositeValue}>{Math.round(overallScore)}</Text>
          <Text style={styles.compositeLabel}>COMPOSITE</Text>
        </View>
      </View>

      {/* ── Cage radar ── */}
      <RadarChart groupScores={groupScores} />

      {/* ── Tier legend, one capsule ── */}
      <View style={styles.legendCapsule}>
        {[
          { label: 'Needs Work', color: NEEDS_WORK },
          { label: 'Emerging', color: EMERGING },
          { label: 'Good', color: GOOD },
          { label: 'Advanced', color: ADVANCED },
        ].map(z => (
          <View key={z.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: z.color }]} />
            <Text style={styles.legendText}>{z.label}</Text>
          </View>
        ))}
      </View>

      {/* ── Groups ── */}
      <Text style={styles.sectionLabel}>GROUPS</Text>
      <View style={styles.tileGrid}>
        {order.map(i => (
          <GroupTile
            key={GROUPS[i].title}
            title={GROUPS[i].title}
            score={groupScores[i]}
            metrics={allGroupData[i]}
            active={i === activeGroup}
            onPress={() => switchGroup(i)}
          />
        ))}
      </View>

      {/* ── Metrics for the selected group ── */}
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateX: slideX }] }}>
        <View style={styles.groupHeader}>
          <Text style={styles.groupTitle}>{GROUPS[activeGroup].title}</Text>
          <View style={[styles.groupPercentileBadge, { borderColor: `${activeColor}30` }]}>
            <Text style={[styles.groupPercentileLabel, { color: activeColor }]}>P</Text>
            <Text style={[styles.groupPercentileValue, { color: activeColor }]}>{Math.round(activeAvg)}</Text>
          </View>
        </View>

        {activeData.map((d, i) => (
          <MetricRow key={d.key} d={d} delay={80 + i * 60} percentileData={percentileData} />
        ))}
      </Animated.View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { paddingHorizontal: PAGE_PAD, paddingTop: 24 },

  // Ambient wash, tinted by the composite's tier
  ambient: { position: 'absolute', top: -24, left: -PAGE_PAD, right: -PAGE_PAD, height: 340 },

  zoneHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  zoneBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  zoneBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  zoneDescription: { fontSize: 13, color: '#9CA3AF', flex: 1 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  velocityValue: { fontSize: 36, fontWeight: '800', color: '#FFFFFF' },
  velocityUnit: { fontSize: 16, fontWeight: '500', color: 'rgba(255,255,255,0.5)' },
  velocityLabel: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  // The pitch is white. Tier color is reserved for the judgment about it.
  compositeValue: { fontSize: 46, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1.6 },
  compositeLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: 'rgba(255,255,255,0.34)', marginTop: 5 },

  loadingContainer: { alignItems: 'center', paddingVertical: 48 },
  loadingText: { fontSize: 12, color: 'rgba(255,255,255,0.2)' },

  // ── Cage radar ──
  radarSvgLayer: { position: 'absolute', top: 0, left: 0, right: 0 },
  radarContainer: { alignSelf: 'center', width: RADAR_W, height: RADAR_H, marginBottom: 10 },
  vertexPill: { position: 'absolute', width: PILL_W, alignItems: 'center', gap: 2 },
  vertexChip: { paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 10 },
  vertexChipText: { fontSize: 12.5, fontWeight: '800', letterSpacing: -0.2 },
  vertexLabel: { fontSize: 8.5, fontWeight: '700', letterSpacing: 1.1, color: 'rgba(255,255,255,0.34)' },

  // ── Tier legend, one capsule ──
  legendCapsule: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 10.5, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.36)', marginTop: 24, marginBottom: 10,
  },

  // ── Group tiles (2x2 button grid) ──
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP },
  groupTile: {
    width: TILE_W, height: TILE_H,
    borderRadius: 16, borderWidth: 1,
    padding: 14, overflow: 'hidden', position: 'relative',
    justifyContent: 'space-between',
  },
  tileSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: 1 },
  tileScore: { fontSize: 38, fontWeight: '800', letterSpacing: -1.6, lineHeight: 40 },
  tileName: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.5)',
  },
  tileSub: { fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 3 },

  // ── Selected group header ──
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 12 },
  groupTitle: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 2 },
  groupPercentileBadge: {
    flexDirection: 'row', alignItems: 'baseline',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.03)',
  },
  groupPercentileLabel: { fontSize: 12, fontWeight: '600', marginRight: 1 },
  groupPercentileValue: { fontSize: 20, fontWeight: '900' },

  // ── Metric card — name and measurement lead, percentile is the caption ──
  metricCard: {
    backgroundColor: 'rgba(255,255,255,0.032)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8,
  },
  metricCardTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  metricCardName: { fontSize: 14.5, fontWeight: '600', color: 'rgba(255,255,255,0.9)', flex: 1 },
  metricCardRaw: { fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
  metricCardUnit: { fontSize: 10.5, color: 'rgba(255,255,255,0.3)' },
  metricCardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  metricCardPct: { fontSize: 11, fontWeight: '700' },
  metricCardCmp: { fontSize: 10.5, color: 'rgba(255,255,255,0.33)' },

  barTrack: {
    height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.09)',
    position: 'relative', marginTop: 11, marginBottom: 8,
  },
  barFill: { position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 3 },
  barP50: {
    position: 'absolute', left: '50%', top: -2, width: 1.5, height: 9,
    backgroundColor: 'rgba(255,255,255,0.34)', borderRadius: 1,
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '80%', paddingBottom: 40,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: 24, paddingBottom: 16,
  },
  percentile: { fontSize: 36, fontWeight: '900', marginBottom: 4 },
  title: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  timing: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4, fontStyle: 'italic' },
  closeButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },

  tagRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 24, marginBottom: 20 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
  },
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  tagText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  tagTextSubtle: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },

  valuesGrid: {
    flexDirection: 'row', paddingHorizontal: 24, gap: 12, marginBottom: 20,
  },
  valueCell: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12, padding: 14, alignItems: 'center',
  },
  valueCellLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5, color: 'rgba(155,221,255,0.6)', marginBottom: 6 },
  valueCellNumber: { fontSize: 24, fontWeight: '900' },
  valueCellUnit: { fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 },

  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 24, marginVertical: 16 },

  distAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  distAxisText: { fontSize: 9.5, color: 'rgba(255,255,255,0.3)' },

  detailTitle: { fontSize: 13, fontWeight: '800', color: 'rgba(255,255,255,0.6)', paddingHorizontal: 24, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  detailText: { fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 22, paddingHorizontal: 24 },
});
