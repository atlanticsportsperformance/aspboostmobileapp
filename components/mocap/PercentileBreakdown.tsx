import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import Svg, { Path, Line, Circle, Polygon, Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import {
  type PercentileTable,
  type RowData,
  GROUPS,
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
const CHART_H = 45;

function zoneColor(pct: number): string {
  if (pct >= 75) return GREEN;
  if (pct >= 50) return ACCENT;
  if (pct >= 25) return AMBER;
  return RED;
}

function zoneLabel(pct: number): string {
  if (pct >= 75) return 'ELITE';
  if (pct >= 50) return 'OPTIMIZE';
  if (pct >= 25) return 'SHARPEN';
  return 'BUILD';
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

const RADAR_W = SCREEN_WIDTH - 24;
const RADAR_H = 380;
const CX = RADAR_W / 2;
const CY = RADAR_H / 2;
const R = 130;
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

function ringPath(pct: number) {
  return AXES.map((a, i) => {
    const p = rp(a.angle, pct);
    return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ') + ' Z';
}

function RadarChart({ groupAvgs, overallPct }: { groupAvgs: number[]; overallPct: number }) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(scaleAnim, { toValue: 1, damping: 16, stiffness: 70, delay: 200, useNativeDriver: true }).start();
  }, []);

  const pts = groupAvgs.map((pct, i) => rp(AXES[i].angle, pct));
  const athletePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
  const oc = zoneColor(overallPct);

  // Label positions pushed further out with alignment adjustments
  const labelPositions = AXES.map((a, i) => {
    const lp = rp(a.angle, 130);
    const align = a.angle === 0 ? 'flex-start' : a.angle === 180 ? 'flex-end' : 'center';
    return { ...lp, align };
  });

  return (
    <View style={styles.radarContainer}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Svg width={RADAR_W} height={RADAR_H} viewBox={`0 0 ${RADAR_W} ${RADAR_H}`}>
          {/* Grid rings at 25/50/75/100 */}
          {[25, 50, 75, 100].map(p => (
            <Path key={p} d={ringPath(p)} fill="none"
              stroke={p === 50 ? 'rgba(255,255,255,0.18)' : p === 75 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)'}
              strokeWidth={p === 50 ? 1.5 : 1}
              strokeDasharray={p === 100 ? '4 4' : undefined} />
          ))}

          {/* Axis lines */}
          {AXES.map((a, i) => {
            const tip = rp(a.angle, 105);
            return <Line key={i} x1={CX} y1={CY} x2={tip.x} y2={tip.y}
              stroke="rgba(255,255,255,0.1)" strokeWidth="1" />;
          })}

          {/* Athlete fill + stroke */}
          <Defs>
            <LinearGradient id="radarGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ACCENT} stopOpacity="0.25" />
              <Stop offset="1" stopColor={ACCENT} stopOpacity="0.04" />
            </LinearGradient>
          </Defs>
          <Path d={athletePath} fill="url(#radarGrad)" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" />

          {/* Vertex dots */}
          {pts.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y} r={5} fill={zoneColor(groupAvgs[i])}
              stroke="#0A0A0A" strokeWidth="2" />
          ))}

          {/* Center score */}
          <SvgText x={CX} y={CY + 12} textAnchor="middle"
            fontSize="34" fontWeight="900" fill={oc}>{Math.round(overallPct)}</SvgText>

          {/* Vertex labels + scores rendered in SVG for perfect positioning */}
          {AXES.map((a, i) => {
            const lp = rp(a.angle, 122);
            const c = zoneColor(groupAvgs[i]);
            const anchor = a.angle === 0 ? 'start' : a.angle === 180 ? 'end' : 'middle';
            const dy = a.angle === -90 ? -8 : a.angle === 90 ? 18 : 0;
            const dx = a.angle === 0 ? 8 : a.angle === 180 ? -8 : 0;
            return (
              <React.Fragment key={i}>
                <SvgText x={lp.x + dx} y={lp.y + dy} textAnchor={anchor}
                  fontSize="20" fontWeight="900" fill={c}>{Math.round(groupAvgs[i])}</SvgText>
                <SvgText x={lp.x + dx} y={lp.y + dy + 14} textAnchor={anchor}
                  fontSize="9" fontWeight="600" fill="rgba(255,255,255,0.3)"
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
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
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
    <Animated.View style={{ opacity: fadeAnim }}>
      <Svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
        <Defs>
          <LinearGradient id={`df-${percKey}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.18" />
            <Stop offset="1" stopColor={color} stopOpacity="0.01" />
          </LinearGradient>
        </Defs>
        <Path d={path} fill={`url(#df-${percKey})`} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
        <Line x1={p50X} y1={0} x2={p50X} y2={CHART_H} stroke="rgba(74,222,128,0.2)" strokeWidth="1" strokeDasharray="2 2" />
        {athleteX != null && (
          <>
            <Line x1={athleteX} y1={2} x2={athleteX} y2={CHART_H} stroke={color} strokeWidth="1.5" />
            <Circle cx={athleteX} cy={3} r={3} fill={color} />
          </>
        )}
      </Svg>
    </Animated.View>
  );
}

// ─── Single Metric Row ───────────────────────────────────────────────────────

function MetricRow({ d, delay, percentileData }: {
  d: RowData; delay: number; percentileData: PercentileTable | null;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const barAnim = useRef(new Animated.Value(0)).current;

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
        Animated.spring(barAnim, { toValue: Math.max(d.pct, 2), damping: 14, stiffness: 50, useNativeDriver: false }).start();
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

      {/* Metric name with colored left accent */}
      <View style={[styles.metricNameRow, { borderLeftColor: color }]}>
        <Text style={styles.metricName}>{d.axisLabel}</Text>
      </View>

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
  const groupAvgs = allGroupData.map(data => data.reduce((s, d) => s + d.pct, 0) / data.length);
  const allData = allGroupData.flat();
  const overallPct = allData.reduce((s, d) => s + d.pct, 0) / allData.length;

  const switchGroup = (idx: number) => {
    if (idx === activeGroup) return;
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setActiveGroup(idx);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  const activeData = allGroupData[activeGroup];
  const activeAvg = groupAvgs[activeGroup];
  const activeColor = zoneColor(activeAvg);

  // Short tab labels
  const TAB_LABELS = ['Drive', 'Posture', 'Block', 'Arm'];

  return (
    <View style={styles.container}>

      {/* ── Hero Radar ── */}
      <RadarChart groupAvgs={groupAvgs} overallPct={overallPct} />

      {/* ── Zone Legend ── */}
      <View style={styles.zoneLegend}>
        {[
          { label: 'BUILD', color: RED },
          { label: 'SHARPEN', color: AMBER },
          { label: 'OPTIMIZE', color: ACCENT },
          { label: 'ELITE', color: GREEN },
        ].map(z => (
          <View key={z.label} style={styles.zoneItem}>
            <View style={[styles.zoneDot, { backgroundColor: z.color }]} />
            <Text style={[styles.zoneText, { color: `${z.color}80` }]}>{z.label}</Text>
          </View>
        ))}
      </View>

      {/* ── Subtitle ── */}
      <Text style={styles.subtitle}>
        vs {percentileData.sampleSize} elite pitches ({percentileData.cohort} mph)
      </Text>

      {/* ── Group Tabs ── */}
      <View style={styles.tabRow}>
        {GROUPS.map((g, i) => {
          const isActive = i === activeGroup;
          const tc = zoneColor(groupAvgs[i]);
          return (
            <TouchableOpacity
              key={g.title}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => switchGroup(i)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabScore, { color: isActive ? tc : 'rgba(255,255,255,0.2)' }]}>
                {Math.round(groupAvgs[i])}
              </Text>
              <Text style={[styles.tabLabel, isActive && { color: 'rgba(255,255,255,0.7)' }]}>
                {TAB_LABELS[i]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Active Group Content ── */}
      <Animated.View style={{ opacity: fadeAnim }}>
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

  loadingContainer: { alignItems: 'center', paddingVertical: 48 },
  loadingText: { fontSize: 12, color: 'rgba(255,255,255,0.2)' },

  // Radar
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
  rawValue: { fontSize: 14, fontFamily: 'Courier', fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  rawUnit: { fontSize: 10, color: 'rgba(255,255,255,0.2)' },

  metricNameRow: { borderLeftWidth: 2, paddingLeft: 10, marginBottom: 10 },
  metricName: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.65)' },

  barTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden', position: 'relative', marginBottom: 6 },
  barP50: { position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', backgroundColor: 'rgba(74,222,128,0.25)', zIndex: 10 },
  barFill: { position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 3 },

  compRow: { flexDirection: 'row', marginBottom: 8 },
  compElite: { fontSize: 10, fontFamily: 'Courier', color: 'rgba(74,222,128,0.45)' },
  compIndustry: { fontSize: 10, fontFamily: 'Courier', color: 'rgba(251,191,36,0.4)' },

  explanation: { fontSize: 11, color: 'rgba(255,255,255,0.2)', lineHeight: 16, marginTop: 6 },
});
