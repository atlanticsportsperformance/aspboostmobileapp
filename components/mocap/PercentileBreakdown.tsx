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
import Svg, { Path, Line, Circle, Polygon, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import {
  type PercentileTable,
  type RowData,
  GROUPS,
  computeScore,
  INDUSTRY_MEDIAN,
  computeGroupData,
  getMetricData,
  buildDistributionPath,
} from '../../lib/mocap/percentiles';

const ACCENT = '#9BDDFF';
const GREEN = '#4ADE80';
const AMBER = '#FBBF24';
const RED = '#F87171';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_W = SCREEN_WIDTH - 48;
const CHART_H = 60;

function zoneColor(pct: number): string {
  if (pct >= 75) return GREEN;
  if (pct >= 50) return ACCENT;
  if (pct >= 25) return AMBER;
  return RED;
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

// ─── Radar Chart ─────────────────────────────────────────────────────────────

const RADAR_W = SCREEN_WIDTH - 16;
const RADAR_H = SCREEN_WIDTH - 16;
const CX = RADAR_W / 2;
const CY = RADAR_H / 2;
const R = (SCREEN_WIDTH - 16) / 2 - 62;
const AXES = [
  { label: 'Drive', angle: -90 },    // top
  { label: 'Posture', angle: 0 },    // right
  { label: 'Block', angle: 90 },     // bottom
  { label: 'Arm', angle: 180 },      // left
];

function rp(angleDeg: number, pct: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + (pct / 100) * R * Math.cos(rad), y: CY + (pct / 100) * R * Math.sin(rad) };
}

// Grid rings are true circles — athlete polygon stays straight
function ringRadius(pct: number) {
  return (pct / 100) * R;
}

function RadarChart({ groupScores, overallScore }: { groupScores: number[]; overallScore: number }) {
  const gridScale = useRef(new Animated.Value(0)).current;
  const axisOpacity = useRef(new Animated.Value(0)).current;
  const athleteScale = useRef(new Animated.Value(0)).current;
  const dotsOpacity = useRef(new Animated.Value(0)).current;
  const scoreOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered reveal from center outward — no bouncing, clean fades
    Animated.timing(gridScale, { toValue: 1, duration: 600, delay: 100, useNativeDriver: true }).start();
    Animated.timing(axisOpacity, { toValue: 1, duration: 400, delay: 300, useNativeDriver: true }).start();
    Animated.timing(athleteScale, { toValue: 1, duration: 500, delay: 500, useNativeDriver: true }).start();
    Animated.timing(dotsOpacity, { toValue: 1, duration: 400, delay: 700, useNativeDriver: true }).start();
    Animated.timing(scoreOpacity, { toValue: 1, duration: 500, delay: 800, useNativeDriver: true }).start();
  }, []);

  const pts = groupScores.map((pct, i) => rp(AXES[i].angle, pct));
  const athletePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

  // Label positions pushed further out with alignment adjustments
  const labelPositions = AXES.map((a, i) => {
    const lp = rp(a.angle, 130);
    const align = a.angle === 0 ? 'flex-start' : a.angle === 180 ? 'flex-end' : 'center';
    return { ...lp, align };
  });

  return (
    <View style={styles.radarContainer}>
      {/* Grid rings — scale from center */}
      <Animated.View style={[styles.radarSvgLayer, { transform: [{ scale: gridScale }] }]}>
        <Svg width={RADAR_W} height={RADAR_H} viewBox={`0 0 ${RADAR_W} ${RADAR_H}`}>
          {[25, 50, 75, 100].map(p => (
            <Circle key={p} cx={CX} cy={CY} r={ringRadius(p)} fill="none"
              stroke={p === 50 ? 'rgba(255,255,255,0.40)' : p === 75 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.20)'}
              strokeWidth={p === 50 ? 2 : 1}
              strokeDasharray={p === 100 ? '4 4' : undefined} />
          ))}
        </Svg>
      </Animated.View>

      {/* Axis lines — fade in */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: axisOpacity }]}>
        <Svg width={RADAR_W} height={RADAR_H} viewBox={`0 0 ${RADAR_W} ${RADAR_H}`}>
          {AXES.map((a, i) => {
            const tip = rp(a.angle, 105);
            return <Line key={i} x1={CX} y1={CY} x2={tip.x} y2={tip.y}
              stroke="rgba(255,255,255,0.25)" strokeWidth="1" />;
          })}
        </Svg>
      </Animated.View>

      {/* Athlete polygon — spring from center */}
      <Animated.View style={[styles.radarSvgLayer, { transform: [{ scale: athleteScale }] }]}>
        <Svg width={RADAR_W} height={RADAR_H} viewBox={`0 0 ${RADAR_W} ${RADAR_H}`}>
          <Defs>
            <LinearGradient id="radarGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ACCENT} stopOpacity="0.45" />
              <Stop offset="1" stopColor={ACCENT} stopOpacity="0.12" />
            </LinearGradient>
          </Defs>
          <Path d={athletePath} fill="url(#radarGrad)" stroke={ACCENT} strokeWidth="2.5" strokeLinejoin="round" />
        </Svg>
      </Animated.View>

      {/* Dots + scores — fade in last */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: dotsOpacity }]}>
        <Svg width={RADAR_W} height={RADAR_H} viewBox={`0 0 ${RADAR_W} ${RADAR_H}`}>
          {pts.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={5} fill={ACCENT}
              stroke="#0A0A0A" strokeWidth="2" />
          ))}
        </Svg>
      </Animated.View>

      {/* Center score — fade in */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: scoreOpacity }]}>
        <Svg width={RADAR_W} height={RADAR_H} viewBox={`0 0 ${RADAR_W} ${RADAR_H}`}>
          <SvgText x={CX} y={CY + 12} textAnchor="middle"
            fontSize="34" fontWeight="900" fill="#FFFFFF">{Math.round(overallScore)}</SvgText>

          {/* Vertex labels + scores rendered in SVG for perfect positioning */}
          {AXES.map((a, i) => {
            const labelDist = (a.angle === 0 || a.angle === 180) ? 105 : 110;
            const lp = rp(a.angle, labelDist);
            const anchor = a.angle === 0 ? 'start' : a.angle === 180 ? 'end' : 'middle';
            const dy = a.angle === -90 ? -8 : a.angle === 90 ? 18 : 0;
            const dx = a.angle === 0 ? 8 : a.angle === 180 ? -8 : 0;
            return (
              <React.Fragment key={i}>
                <SvgText x={lp.x + dx} y={lp.y + dy} textAnchor={anchor}
                  fontSize="20" fontWeight="900" fill="#FFFFFF">{Math.round(groupScores[i])}</SvgText>
                <SvgText x={lp.x + dx} y={lp.y + dy + 14} textAnchor={anchor}
                  fontSize="9" fontWeight="600" fill="rgba(255,255,255,0.35)"
                  letterSpacing={1}>{a.label.toUpperCase()}</SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
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
                <Text style={[modalStyles.percentile, { color }]}>p{Math.round(metric.pct)}</Text>
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
    <Animated.View style={[styles.metricRow, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      {/* Hero percentile + raw value */}
      <View style={styles.metricTopLine}>
        {d.raw != null ? (
          <CountUp value={Math.round(d.pct)} delay={delay + 200}
            style={[styles.heroPercentile, { color }]} />
        ) : (
          <Text style={[styles.heroPercentile, { color: '#4B5563' }]}>--</Text>
        )}
        <Text style={styles.rawValue}>
          {d.raw != null ? d.raw.toFixed(1) : '--'}
          <Text style={styles.rawUnit}> {d.unit}</Text>
        </Text>
      </View>

      {/* Metric name with animated colored left accent + info button */}
      <View style={styles.metricNameRow}>
        <Animated.View style={[styles.metricAccentBar, { height: accentHeight, backgroundColor: color }]} />
        <Text style={styles.metricName}>{d.axisLabel}</Text>
        <TouchableOpacity onPress={() => setShowDetail(true)} style={styles.infoButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="information-circle-outline" size={18} color="rgba(255,255,255,0.3)" />
        </TouchableOpacity>
      </View>

      {/* Detail modal */}
      <MetricDetailModal metric={d} visible={showDetail} onClose={() => setShowDetail(false)} percentileData={percentileData} />

      {/* Bar */}
      <View style={styles.barTrack}>
        <View style={styles.barP50} />
        <Animated.View style={[styles.barFill, { width: barWidth, backgroundColor: color }]} />
      </View>

      {/* Comparison values */}
      <View style={styles.compRow}>
        {eliteP50 != null && (
          <Text style={styles.compElite}>elite {eliteP50.toFixed(1)}</Text>
        )}
        {industry && (
          <Text style={styles.compIndustry}> · industry {industry.value}</Text>
        )}
      </View>

      {/* Distribution */}
      <DistributionSvg
        percKey={d.percKey}
        athleteValue={d.raw}
        athletePct={d.pct}
        delay={delay + 500}
        percentileData={percentileData}
      />

      {/* Explanation */}
      <Text style={styles.explanation}>{d.explanation}</Text>
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

export default function PercentileBreakdown({ scalarMetrics, percentileData }: Props) {
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

  // Short tab labels
  const TAB_LABELS = ['Drive', 'Posture', 'Block', 'Arm'];

  // Staggered slide-in from left for tabs
  const tabAnims = useRef(TAB_LABELS.map(() => ({
    opacity: new Animated.Value(0),
    translateX: new Animated.Value(-40),
  }))).current;

  useEffect(() => {
    tabAnims.forEach((anim, i) => {
      Animated.parallel([
        Animated.timing(anim.opacity, { toValue: 1, duration: 400, delay: 900 + i * 120, useNativeDriver: true }),
        Animated.timing(anim.translateX, { toValue: 0, duration: 400, delay: 900 + i * 120, useNativeDriver: true }),
      ]).start();
    });
  }, []);

  return (
    <View style={styles.container}>

      {/* ── Report Header ── */}
      <View style={styles.reportHeader}>
        <Text style={styles.reportTitle}>Biomechanics Analysis</Text>
        <Text style={styles.reportDesc}>
          Composite scores across 19 metrics ranked against {percentileData.sampleSize} elite pitches at {percentileData.cohort} mph.
        </Text>
      </View>

      {/* ── Hero Radar ── */}
      <RadarChart groupScores={groupScores} overallScore={overallScore} />

      {/* ── Zone Legend ── */}
      <View style={styles.zoneLegend}>
        {[
          { label: 'NEEDS WORK', color: RED },
          { label: 'EMERGING', color: AMBER },
          { label: 'GOOD', color: ACCENT },
          { label: 'ADVANCED', color: GREEN },
        ].map(z => (
          <View key={z.label} style={styles.zoneItem}>
            <View style={[styles.zoneDot, { backgroundColor: z.color }]} />
            <Text style={[styles.zoneText, { color: `${z.color}80` }]}>{z.label}</Text>
          </View>
        ))}
      </View>

      {/* ── Spacer to push tabs below fold ── */}
      <View style={{ height: 32 }} />

      {/* ── Group Tabs — staggered slide from left ── */}
      <View style={styles.tabRow}>
        {GROUPS.map((g, i) => {
          const isActive = i === activeGroup;
          return (
            <Animated.View key={g.title} style={{ flex: 1, opacity: tabAnims[i].opacity, transform: [{ translateX: tabAnims[i].translateX }] }}>
              <TouchableOpacity
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => switchGroup(i)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabScore, { color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.2)' }]}>
                  {Math.round(groupScores[i])}
                </Text>
                <Text style={[styles.tabLabel, isActive && { color: 'rgba(255,255,255,0.6)' }]}>
                  {TAB_LABELS[i]}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>

      {/* ── Active Group Content ── */}
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateX: slideX }] }}>
        {/* Group header */}
        <View style={styles.groupHeader}>
          <Text style={styles.groupTitle}>{GROUPS[activeGroup].title}</Text>
          <Text style={[styles.groupAvg, { color: activeColor }]}>p{Math.round(activeAvg)}</Text>
        </View>
        <View style={styles.hairline} />

        {/* Metrics */}
        {activeData.map((d, i) => (
          <React.Fragment key={d.key}>
            <MetricRow d={d} delay={100 + i * 80} percentileData={percentileData} />
            {i < activeData.length - 1 && <View style={styles.metricSeparator} />}
          </React.Fragment>
        ))}
      </Animated.View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 24 },

  reportHeader: { alignItems: 'center', marginBottom: 12 },
  reportTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5, marginBottom: 8 },
  reportDesc: { fontSize: 12, color: 'rgba(255,255,255,0.35)', textAlign: 'center', lineHeight: 18, paddingHorizontal: 12 },

  loadingContainer: { alignItems: 'center', paddingVertical: 48 },
  loadingText: { fontSize: 12, color: 'rgba(255,255,255,0.2)' },

  // Radar
  radarSvgLayer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
  },
  radarContainer: { alignSelf: 'center', width: RADAR_W, height: RADAR_H, marginBottom: 8 },

  // Zone legend
  zoneLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 6 },
  zoneItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  zoneDot: { width: 6, height: 6, borderRadius: 3 },
  zoneText: { fontSize: 8, fontWeight: '700', letterSpacing: 1.5 },

  subtitle: { textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.2)', marginBottom: 20 },

  // Tabs
  tabRow: {
    flexDirection: 'row', gap: 8, marginBottom: 24, paddingHorizontal: 4,
  },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6,
    borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  tabActive: {
    backgroundColor: 'rgba(155,221,255,0.08)',
    borderColor: 'rgba(155,221,255,0.2)',
  },
  tabScore: { fontSize: 20, fontWeight: '900', marginBottom: 2 },
  tabLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: 0.5 },

  hairline: { height: 1, backgroundColor: 'rgba(255,255,255,0.04)', marginBottom: 20 },

  // Group content
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  groupTitle: { fontSize: 13, fontWeight: '800', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 3 },
  groupAvg: { fontSize: 22, fontWeight: '900' },

  metricSeparator: { height: 1, backgroundColor: 'rgba(255,255,255,0.03)', marginVertical: 20 },

  // Metric row — NO container, just content on void
  metricRow: {},
  metricTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  heroPercentile: { fontSize: 32, fontWeight: '900' },
  rawValue: { fontSize: 14, fontFamily: 'Courier', fontWeight: '600', color: 'rgba(255,255,255,0.6)' },
  rawUnit: { fontSize: 10, color: 'rgba(255,255,255,0.35)' },

  metricNameRow: { paddingLeft: 10, marginBottom: 10, flexDirection: 'row', alignItems: 'center' },
  metricAccentBar: { width: 2, borderRadius: 1, position: 'absolute' as const, left: 0, top: 0 },
  metricName: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)', flex: 1 },
  infoButton: { padding: 4 },

  barTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden', position: 'relative', marginBottom: 6 },
  barP50: { position: 'absolute', left: '50%', top: 0, width: 2, height: '100%', backgroundColor: 'rgba(74,222,128,0.55)', zIndex: 10 },
  barFill: { position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 3 },

  compRow: { flexDirection: 'row', marginBottom: 8 },
  compElite: { fontSize: 10, fontFamily: 'Courier', color: 'rgba(74,222,128,0.6)' },
  compIndustry: { fontSize: 10, fontFamily: 'Courier', color: 'rgba(251,191,36,0.55)' },

  explanation: { fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 16, marginTop: 6 },
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

  detailTitle: { fontSize: 13, fontWeight: '800', color: 'rgba(255,255,255,0.6)', paddingHorizontal: 24, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  detailText: { fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 22, paddingHorizontal: 24 },
});
