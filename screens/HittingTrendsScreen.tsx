import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Rect,
  Line,
  Path,
  Circle,
  Text as SvgText,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  G,
} from 'react-native-svg';
import { supabase } from '../lib/supabase';
import {
  STEEL,
  fmt,
  Section,
  Kpi,
  KpiRow,
  TimeChips,
  ScreenHeader,
  steelStyles,
  type TimeRange,
} from '../components/hitting/steel';
import { BAT_SPEED_NORMS, percentileFor, normalizePlayLevel, type Level } from '../lib/norms';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Supabase has a default 1000 row limit - this fetches ALL records with pagination
const BATCH_SIZE = 1000;
async function fetchAllPaginated<T>(
  query: () => ReturnType<typeof supabase.from>,
  selectColumns: string,
  filters: { column: string; value: any }[],
  orderColumn: string,
  orderAscending: boolean = true
): Promise<T[]> {
  const allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let q = query().select(selectColumns);
    for (const filter of filters) {
      q = q.eq(filter.column, filter.value);
    }
    const { data, error } = await q
      .order(orderColumn, { ascending: orderAscending })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Pagination fetch error:', error);
      break;
    }
    if (data && data.length > 0) {
      allData.push(...(data as T[]));
      offset += BATCH_SIZE;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }
  return allData;
}

// Meaning colors for this screen
const C = {
  bat: STEEL.hitting, // #fb923c
  batMax: STEEL.hitting2,
  aa: STEEL.purple, // #a78bfa
  conn: STEEL.cyan, // #22D3EE
  early: '#8d939c',
  band: STEEL.good,
  fab: '#9BDDFF',
  fab2: '#7BC5F0',
};

const AA_IDEAL: [number, number] = [5, 20];
const CONN_IDEAL: [number, number] = [80, 95];

const LEVEL_ABBR: Record<Level, string> = { Youth: 'Youth', 'High School': 'HS', College: 'College', Pro: 'Pro' };

interface SessionData {
  date: string;
  avgBatSpeed: number | null;
  maxBatSpeed: number | null;
  avgAttackAngle: number | null;
  attackAngleStdDev: number | null;
  avgConnectionAtImpact: number | null;
  avgEarlyConnection: number | null;
  swingCount: number;
  /** Per-swing values, kept so range-wide KPIs are computed over swings, not session means. */
  attackAngles: number[];
  onPlane: number[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const stdDev = (xs: number[]) => {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};
const ordinal = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};
const pctColor = (p: number) => (p >= 75 ? '#34d399' : p >= 50 ? '#9BDDFF' : p >= 25 ? '#fbbf24' : '#ef4444');
const formatDate = (dateStr: string) =>
  new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function HittingTrendsScreen({ navigation, route }: any) {
  const [allSessionData, setAllSessionData] = useState<SessionData[]>([]);
  const [timeFilter, setTimeFilter] = useState<TimeRange>('3m');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);
  const [playLevel, setPlayLevel] = useState<Level | null>(null);

  useEffect(() => {
    loadAthleteAndData();
  }, []);

  async function loadAthleteAndData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      let currentAthleteId = athleteId;
      if (!currentAthleteId) {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id, play_level')
          .eq('user_id', user.id)
          .single();

        if (!athlete) {
          setLoading(false);
          return;
        }
        currentAthleteId = athlete.id;
        setAthleteId(athlete.id);
        setPlayLevel(normalizePlayLevel(athlete.play_level));
      } else {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('play_level')
          .eq('id', currentAthleteId)
          .maybeSingle();
        setPlayLevel(normalizePlayLevel(athlete?.play_level));
      }

      await fetchTrendsData(currentAthleteId!);
    } catch (error) {
      console.error('Error loading athlete:', error);
      setLoading(false);
    }
  }

  const filteredData = useMemo(() => {
    if (timeFilter === 'all') return allSessionData;
    const days = timeFilter === '1m' ? 30 : timeFilter === '3m' ? 90 : 180;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return allSessionData.filter((s) => new Date(s.date) >= cutoff);
  }, [timeFilter, allSessionData]);

  async function fetchTrendsData(id: string, opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);

    interface BlastSwing {
      bat_speed: number | null;
      attack_angle: number | null;
      connection_at_impact: number | null;
      early_connection: number | null;
      on_plane_efficiency: number | null;
      recorded_date: string;
    }

    interface FullSwingSession {
      session_date: string;
      avg_bat_speed: number | null;
      max_bat_speed: number | null;
      total_swings: number | null;
    }

    const blastSwings = await fetchAllPaginated<BlastSwing>(
      () => supabase.from('blast_swings'),
      'bat_speed, attack_angle, connection_at_impact, early_connection, on_plane_efficiency, recorded_date',
      [{ column: 'athlete_id', value: id }],
      'recorded_date',
      true
    );

    const fullSwingSessions = await fetchAllPaginated<FullSwingSession>(
      () => supabase.from('fullswing_sessions'),
      'session_date, avg_bat_speed, max_bat_speed, total_swings',
      [{ column: 'athlete_id', value: id }],
      'session_date',
      true
    );

    if ((!blastSwings || blastSwings.length === 0) && (!fullSwingSessions || fullSwingSessions.length === 0)) {
      setAllSessionData([]);
      setLoading(false);
      return;
    }

    type Bucket = {
      batSpeeds: number[];
      attackAngles: number[];
      connectionAtImpacts: number[];
      earlyConnections: number[];
      onPlane: number[];
      fsSpeedSum: number; // Σ(avg × swings) across Full Swing sessions that day
      fsSpeedWeight: number;
      fsMax: number | null;
      fsSwings: number;
    };
    const grouped: Record<string, Bucket> = {};
    const bucket = (date: string) =>
      (grouped[date] ??= {
        batSpeeds: [],
        attackAngles: [],
        connectionAtImpacts: [],
        earlyConnections: [],
        onPlane: [],
        fsSpeedSum: 0,
        fsSpeedWeight: 0,
        fsMax: null,
        fsSwings: 0,
      });
    const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

    (blastSwings || []).forEach((swing) => {
      const b = bucket(swing.recorded_date.split('T')[0]);
      if (ok(swing.bat_speed) && swing.bat_speed > 0) b.batSpeeds.push(swing.bat_speed);
      if (ok(swing.attack_angle)) b.attackAngles.push(swing.attack_angle);
      if (ok(swing.connection_at_impact)) b.connectionAtImpacts.push(swing.connection_at_impact);
      if (ok(swing.early_connection)) b.earlyConnections.push(swing.early_connection);
      if (ok(swing.on_plane_efficiency)) b.onPlane.push(swing.on_plane_efficiency);
    });

    (fullSwingSessions || []).forEach((session) => {
      const b = bucket(session.session_date.split('T')[0]);
      const swings = session.total_swings ?? 0;
      if (ok(session.avg_bat_speed) && session.avg_bat_speed > 0) {
        const w = Math.max(1, swings);
        b.fsSpeedSum += session.avg_bat_speed * w;
        b.fsSpeedWeight += w;
      }
      if (ok(session.max_bat_speed)) b.fsMax = b.fsMax == null ? session.max_bat_speed : Math.max(b.fsMax, session.max_bat_speed);
      b.fsSwings += swings;
    });

    const trends: SessionData[] = Object.keys(grouped)
      .map((date) => {
        const b = grouped[date];

        // Swing-count-weighted average across Blast + Full Swing (was Math.max of the two averages).
        const blastSum = b.batSpeeds.reduce((s, v) => s + v, 0);
        const totalW = b.batSpeeds.length + b.fsSpeedWeight;
        const avgBatSpeed = totalW > 0 ? (blastSum + b.fsSpeedSum) / totalW : null;

        const blastMax = b.batSpeeds.length ? Math.max(...b.batSpeeds) : null;
        const maxCandidates = [blastMax, b.fsMax].filter(ok);
        const maxBatSpeed = maxCandidates.length ? Math.max(...maxCandidates) : null;

        const totalSwingCount = b.batSpeeds.length + b.fsSwings;

        return {
          date,
          avgBatSpeed,
          maxBatSpeed,
          avgAttackAngle: mean(b.attackAngles),
          attackAngleStdDev: stdDev(b.attackAngles),
          avgConnectionAtImpact: mean(b.connectionAtImpacts),
          avgEarlyConnection: mean(b.earlyConnections),
          swingCount:
            totalSwingCount > 0
              ? totalSwingCount
              : Math.max(b.attackAngles.length, b.connectionAtImpacts.length, b.earlyConnections.length),
          attackAngles: b.attackAngles,
          onPlane: b.onPlane,
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setAllSessionData(trends);
    setLoading(false);
  }

  const onRefresh = useCallback(async () => {
    if (!athleteId) return;
    setRefreshing(true);
    try {
      await fetchTrendsData(athleteId, { silent: true });
    } catch (error) {
      console.error('Error refreshing trends:', error);
    } finally {
      setRefreshing(false);
    }
  }, [athleteId]);

  const stats = useMemo(() => {
    const avgOf = (vals: (number | null)[]) => mean(vals.filter((v): v is number => v != null));
    const speedSessions = filteredData.filter((s) => s.avgBatSpeed != null);
    const maxes = filteredData.map((s) => s.maxBatSpeed).filter((v): v is number => v != null);
    const angles = filteredData.flatMap((s) => s.attackAngles);
    const onPlane = filteredData.flatMap((s) => s.onPlane);
    const batAvg = avgOf(filteredData.map((s) => s.avgBatSpeed));
    const batDelta =
      speedSessions.length >= 2
        ? speedSessions[speedSessions.length - 1].avgBatSpeed! - speedSessions[0].avgBatSpeed!
        : null;
    const norms = playLevel ? BAT_SPEED_NORMS[playLevel] : undefined;
    const batPct = norms && batAvg != null ? percentileFor(batAvg, norms) : null;
    return {
      batAvg,
      batPeak: maxes.length ? Math.max(...maxes) : null,
      batDelta,
      batPct,
      aaAvg: avgOf(filteredData.map((s) => s.avgAttackAngle)),
      aaInRange: angles.length
        ? (angles.filter((a) => a >= AA_IDEAL[0] && a <= AA_IDEAL[1]).length / angles.length) * 100
        : null,
      aaStd: stdDev(angles),
      connImpact: avgOf(filteredData.map((s) => s.avgConnectionAtImpact)),
      connEarly: avgOf(filteredData.map((s) => s.avgEarlyConnection)),
      onPlane: mean(onPlane),
    };
  }, [filteredData, playLevel]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={C.bat} />
      </View>
    );
  }

  return (
    <SafeAreaView style={steelStyles.screen} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.bat} colors={[C.bat]} progressBackgroundColor="#1A1A1A" />
        }
      >
        <ScreenHeader
          title="Swing Trends"
          subtitle={`Track your performance over time · ${filteredData.length} sessions`}
          onBack={() => navigation.goBack()}
        />

        <View style={steelStyles.body}>
          <View style={{ paddingTop: 8, paddingBottom: 4 }}>
            <TimeChips value={timeFilter} onChange={setTimeFilter} />
          </View>

          {allSessionData.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No swing data available</Text>
              <Text style={styles.emptySubtext}>Complete Blast Motion sessions to track your trends</Text>
            </View>
          ) : filteredData.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No data for this time period</Text>
              <Text style={styles.emptySubtext}>Try selecting a different time range</Text>
            </View>
          ) : (
            <>
              <Section title="BAT SPEED" right={`${filteredData.length} sessions`}>
                <KpiRow>
                  <Kpi label="AVERAGE" value={fmt(stats.batAvg)} unit="mph" color={C.bat} delta={stats.batDelta} />
                  <Kpi label="PEAK" value={fmt(stats.batPeak)} unit="mph" color={C.batMax} />
                  <Kpi
                    label="PERCENTILE"
                    value={stats.batPct != null ? ordinal(stats.batPct) : '—'}
                    color={stats.batPct != null ? pctColor(stats.batPct) : STEEL.text}
                    note={playLevel ? `vs ${LEVEL_ABBR[playLevel]}` : 'Set play level'}
                  />
                </KpiRow>
                <TrendChart
                  sessionData={filteredData}
                  height={240}
                  unit=" mph"
                  domain={(vals) => [Math.floor(Math.min(...vals) / 10) * 10, Math.ceil(Math.max(...vals) / 10) * 10]}
                  series={[
                    { key: 'avg', label: 'Avg Speed', color: C.bat, area: true, get: (s) => s.avgBatSpeed },
                    { key: 'max', label: 'Max Speed', color: C.batMax, dashed: true, get: (s) => s.maxBatSpeed },
                  ]}
                />
              </Section>

              <Section title="ATTACK ANGLE" right="Ideal 5–20°">
                <KpiRow>
                  <Kpi label="AVERAGE" value={fmt(stats.aaAvg)} unit="°" color={C.aa} />
                  <Kpi
                    label="IN RANGE"
                    value={fmt(stats.aaInRange, 0)}
                    unit="%"
                    color={stats.aaInRange != null && stats.aaInRange >= 50 ? STEEL.good : STEEL.text}
                  />
                  <Kpi label="STD DEV" value={fmt(stats.aaStd)} unit="°" />
                </KpiRow>
                <TrendChart
                  sessionData={filteredData}
                  height={220}
                  unit="°"
                  emptyText="No attack angle data available"
                  band={AA_IDEAL}
                  bandLabel="Ideal (5-20°)"
                  domain={() => {
                    const lows = filteredData.map((s) =>
                      s.avgAttackAngle != null ? s.avgAttackAngle - (s.attackAngleStdDev ?? 0) : null
                    ).filter((v): v is number => v != null);
                    const highs = filteredData.map((s) =>
                      s.avgAttackAngle != null ? s.avgAttackAngle + (s.attackAngleStdDev ?? 0) : null
                    ).filter((v): v is number => v != null);
                    return [Math.floor(Math.min(...lows) / 5) * 5, Math.ceil(Math.max(...highs) / 5) * 5];
                  }}
                  series={[{ key: 'aa', label: 'Attack Angle', color: C.aa, get: (s) => s.avgAttackAngle }]}
                />
              </Section>

              <Section title="CONNECTION" right="Ideal 80–95°">
                <KpiRow>
                  <Kpi label="AT IMPACT" value={fmt(stats.connImpact)} unit="°" color={C.conn} />
                  <Kpi label="EARLY" value={fmt(stats.connEarly)} unit="°" color={STEEL.day} />
                  <Kpi label="ON-PLANE" value={fmt(stats.onPlane, 0)} unit="%" />
                </KpiRow>
                <TrendChart
                  sessionData={filteredData}
                  height={220}
                  unit="°"
                  emptyText="No connection data available"
                  band={CONN_IDEAL}
                  bandLabel="Ideal"
                  domain={(vals) => [
                    Math.min(Math.floor(Math.min(...vals) / 10) * 10, 70),
                    Math.max(Math.ceil(Math.max(...vals) / 10) * 10, 100),
                  ]}
                  series={[
                    { key: 'impact', label: 'At Impact', color: C.conn, get: (s) => s.avgConnectionAtImpact },
                    { key: 'early', label: 'Early', color: C.early, dashed: true, get: (s) => s.avgEarlyConnection },
                  ]}
                />
              </Section>

              <Section title="SESSION DETAILS" right="Last 15">
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { flex: 1.2, textAlign: 'left' }]}>DATE</Text>
                  <Text style={[styles.th, { flex: 0.7 }]}>SWINGS</Text>
                  <Text style={[styles.th, { flex: 0.8 }]}>AVG</Text>
                  <Text style={[styles.th, { flex: 0.8 }]}>MAX</Text>
                  <Text style={[styles.th, { flex: 0.7 }]}>AA</Text>
                </View>
                {filteredData.slice().reverse().slice(0, 15).map((session) => (
                  <View key={session.date} style={styles.tableRow}>
                    <Text style={[styles.td, { flex: 1.2, textAlign: 'left', color: STEEL.text, fontWeight: '700' }]}>
                      {formatDate(session.date)}
                    </Text>
                    <Text style={[styles.td, { flex: 0.7 }]}>{session.swingCount}</Text>
                    <Text style={[styles.td, styles.tdNum, { flex: 0.8, color: C.bat }]}>{fmt(session.avgBatSpeed)}</Text>
                    <Text style={[styles.td, styles.tdNum, { flex: 0.8, color: C.batMax }]}>{fmt(session.maxBatSpeed)}</Text>
                    <Text style={[styles.td, styles.tdNum, { flex: 0.7, color: C.aa }]}>
                      {session.avgAttackAngle != null ? `${fmt(session.avgAttackAngle)}°` : '—'}
                    </Text>
                  </View>
                ))}
              </Section>
            </>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating Back Button */}
      <TouchableOpacity style={styles.fab} onPress={() => navigation.goBack()}>
        <LinearGradient colors={[C.fab, C.fab2]} style={styles.fabGradient}>
          <Ionicons name="chevron-back" size={24} color="#000" />
        </LinearGradient>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── Shared chart helpers (one chart, three configurations) ───────────────────

type Series = {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  area?: boolean;
  get: (s: SessionData) => number | null;
};
type Pt = { x: number; y: number; value: number; date: string };

function Tooltip({ x, y, value, label, date, color, chartWidth }: { x: number; y: number; value: string; label: string; date: string; color: string; chartWidth: number }) {
  const tooltipWidth = 90;
  const tooltipHeight = 48;
  const left = Math.max(4, Math.min(x - tooltipWidth / 2, chartWidth - tooltipWidth - 4));
  const top = Math.max(0, y - tooltipHeight - 12);
  return (
    <View pointerEvents="none" style={[styles.tooltip, { left, top, borderColor: color + '66' }]}>
      <Text style={[styles.tooltipValue, { color }]}>{value}</Text>
      <Text style={styles.tooltipLabel}>{label}</Text>
      <Text style={styles.tooltipDate}>{date}</Text>
    </View>
  );
}

function TrendChart({
  sessionData,
  series,
  height,
  unit,
  domain,
  band,
  bandLabel,
  emptyText,
}: {
  sessionData: SessionData[];
  series: Series[];
  height: number;
  unit: string;
  domain: (vals: number[]) => [number, number];
  band?: [number, number];
  bandLabel?: string;
  emptyText?: string;
}) {
  const [selected, setSelected] = useState<(Pt & { key: string }) | null>(null);

  if (sessionData.length === 0) return null;

  const allVals = sessionData.flatMap((s) => series.map((sr) => sr.get(s))).filter((v): v is number => v != null && Number.isFinite(v));
  if (allVals.length === 0) {
    return emptyText ? <Text style={styles.emptyChartText}>{emptyText}</Text> : null;
  }

  const chartWidth = SCREEN_WIDTH - 32;
  const padding = { top: 16, right: 12, bottom: 24, left: 32 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  let [lo, hi] = domain(allVals);
  if (!(hi > lo)) {
    lo -= 5;
    hi += 5;
  }
  const yOf = (v: number) => padding.top + innerHeight - ((v - lo) / (hi - lo)) * innerHeight;
  const xOf = (i: number) => padding.left + (sessionData.length === 1 ? innerWidth / 2 : (i / (sessionData.length - 1)) * innerWidth);

  const pointsBy = series.map((sr) =>
    sessionData
      .map((s, i) => {
        const v = sr.get(s);
        return v != null && Number.isFinite(v) ? { x: xOf(i), y: yOf(v), value: v, date: s.date } : null;
      })
      .filter((p): p is Pt => p !== null)
  );
  const linePath = (pts: Pt[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const bottom = padding.top + innerHeight;

  const steps = 4;
  const grid = Array.from({ length: steps + 1 }, (_, i) => ({
    y: padding.top + innerHeight - (i / steps) * innerHeight,
    value: lo + (i * (hi - lo)) / steps,
  }));

  let bandRect: { y: number; h: number } | null = null;
  if (band && band[1] >= lo && band[0] <= hi) {
    const yTop = yOf(Math.min(band[1], hi));
    const yBot = yOf(Math.max(band[0], lo));
    bandRect = { y: yTop, h: yBot - yTop };
  }
  const degree = unit === '°';

  return (
    <View style={styles.chart}>
      <Svg width={chartWidth} height={height}>
        <Defs>
          {series.filter((s) => s.area).map((s) => (
            <SvgLinearGradient key={s.key} id={`area-${s.key}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <Stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
            </SvgLinearGradient>
          ))}
        </Defs>

        {bandRect && <Rect x={padding.left} y={bandRect.y} width={innerWidth} height={bandRect.h} fill={C.band} opacity={0.07} />}

        {grid.map((g, i) => (
          <G key={i}>
            <Line x1={padding.left} y1={g.y} x2={padding.left + innerWidth} y2={g.y} stroke={STEEL.rule} strokeWidth={1} />
            <SvgText x={padding.left - 6} y={g.y + 3} textAnchor="end" fontSize={9} fill={STEEL.mute}>
              {Math.round(g.value)}{degree ? '°' : ''}
            </SvgText>
          </G>
        ))}

        {series.map((sr, si) => {
          const pts = pointsBy[si];
          if (pts.length === 0) return null;
          const d = linePath(pts);
          return (
            <G key={sr.key}>
              {sr.area && (
                <Path d={`${d} L ${pts[pts.length - 1].x} ${bottom} L ${pts[0].x} ${bottom} Z`} fill={`url(#area-${sr.key})`} />
              )}
              <Path
                d={d}
                fill="none"
                stroke={sr.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={sr.dashed ? '6,3' : undefined}
              />
              {pts.map((p, i) => {
                const on = selected?.key === sr.key && selected.x === p.x;
                return <Circle key={i} cx={p.x} cy={p.y} r={on ? 5.5 : 3} fill={sr.dashed ? STEEL.bg : sr.color} stroke={sr.color} strokeWidth={on ? 2 : 1.5} />;
              })}
            </G>
          );
        })}

        <SvgText x={chartWidth / 2} y={height - 6} textAnchor="middle" fontSize={9} fill={STEEL.mute}>Sessions</SvgText>
      </Svg>

      {series.map((sr, si) =>
        pointsBy[si].map((p, i) => (
          <TouchableOpacity
            key={`${sr.key}-t-${i}`}
            style={[styles.touchTarget, { left: p.x - 15, top: p.y - 15 }]}
            onPress={() => setSelected(selected?.key === sr.key && selected.x === p.x ? null : { ...p, key: sr.key })}
          />
        ))
      )}

      {selected && (() => {
        const sr = series.find((s) => s.key === selected.key)!;
        return (
          <Tooltip
            x={selected.x}
            y={selected.y}
            chartWidth={chartWidth}
            value={`${fmt(selected.value)}${unit}`}
            label={sr.label}
            date={formatDate(selected.date)}
            color={sr.color}
          />
        );
      })()}

      <View style={styles.legend}>
        {series.map((sr) => (
          <View key={sr.key} style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: sr.color, opacity: sr.dashed ? 0.7 : 1 }]} />
            <Text style={styles.legendText}>{sr.label}</Text>
          </View>
        ))}
        {band && (
          <View style={styles.legendItem}>
            <View style={styles.legendBox} />
            <Text style={styles.legendText}>{bandLabel ?? 'Ideal'}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: STEEL.bg, justifyContent: 'center', alignItems: 'center' },
  emptyState: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: STEEL.sub, fontSize: 15, fontWeight: '600' },
  emptySubtext: { color: STEEL.mute, fontSize: 13, marginTop: 6 },
  chart: { marginTop: 14, position: 'relative' },
  emptyChartText: { color: STEEL.mute, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { width: 14, height: 2, borderRadius: 1 },
  legendBox: { width: 12, height: 8, borderRadius: 2, backgroundColor: 'rgba(52,211,153,0.18)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.5)' },
  legendText: { fontSize: 10, color: STEEL.sub },
  tableHeader: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: STEEL.rule },
  th: { fontSize: 9, fontWeight: '700', color: STEEL.mute, letterSpacing: 1.2, textAlign: 'right' },
  tableRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: STEEL.rule },
  td: { fontSize: 12.5, color: STEEL.sub, textAlign: 'right', fontVariant: ['tabular-nums'] },
  tdNum: { fontWeight: '800' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: C.fab,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: { width: '100%', height: '100%', borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  touchTarget: { position: 'absolute', width: 30, height: 30, borderRadius: 15 },
  tooltip: {
    position: 'absolute',
    backgroundColor: 'rgba(12,16,22,0.96)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    minWidth: 80,
    alignItems: 'center',
  },
  tooltipValue: { fontSize: 14, fontWeight: '800' },
  tooltipLabel: { fontSize: 10, color: STEEL.sub, marginTop: 2 },
  tooltipDate: { fontSize: 9, color: STEEL.mute, marginTop: 2 },
});
