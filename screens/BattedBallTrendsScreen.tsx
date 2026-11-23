/**
 * BattedBallTrendsScreen — exit velocity, launch angle and distance trends
 * across HitTrax + Full Swing sessions, field analysis (3D spray, 2D spray
 * heatmap, field zones), real-size strike-zone grids and session history.
 * Steel look (components/hitting/steel.tsx).
 */

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
  Polygon,
} from 'react-native-svg';
import { supabase } from '../lib/supabase';
import {
  STEEL,
  fmt,
  Section,
  Kpi,
  KpiRow,
  TimeChips,
  Segmented,
  ScreenHeader,
  steelStyles,
  HARD_HIT_MPH,
  SWEET_SPOT,
  type TimeRange,
} from '../components/hitting/steel';
import { BallField3D, type BattedBall } from '../components/hitting/BallField3D';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_W = SCREEN_WIDTH - 32;

// Supabase has a default 1000 row limit - this fetches ALL records with pagination
const BATCH_SIZE = 1000;
async function fetchAllPaginated<T>(
  query: () => ReturnType<typeof supabase.from>,
  selectColumns: string,
  filters: { column: string; value: any; operator?: 'eq' | 'in' }[],
  orderColumn: string,
  orderAscending: boolean = true,
  additionalFilters?: (q: any) => any
): Promise<T[]> {
  const allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let q = query().select(selectColumns);
    for (const filter of filters) {
      if (filter.operator === 'in') {
        q = q.in(filter.column, filter.value);
      } else {
        q = q.eq(filter.column, filter.value);
      }
    }
    if (additionalFilters) {
      q = additionalFilters(q);
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

/** Numeric columns can arrive as strings; coerce and drop NaN. */
function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function parseDay(d: string) {
  return new Date(`${d}T00:00:00`);
}
function shortDate(d: string) {
  return parseDay(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const LEVEL_COLORS = { hot: '#dc2626', warm: '#f97316', cool: '#eab308', cold: '#06b6d4', ice: '#3b82f6' };

function levelThresholds(playingLevel: string) {
  switch (playingLevel) {
    case 'youth':
      return { hot: 80, warm: 72, cool: 64, cold: 55 };
    case 'college':
      return { hot: 105, warm: 98, cool: 90, cold: 80 };
    case 'professional':
      return { hot: 110, warm: 105, cool: 98, cold: 88 };
    case 'high-school':
    default:
      return { hot: 98, warm: 90, cool: 82, cold: 70 };
  }
}
function levelColor(ev: number, t: ReturnType<typeof levelThresholds>) {
  if (ev >= t.hot) return LEVEL_COLORS.hot;
  if (ev >= t.warm) return LEVEL_COLORS.warm;
  if (ev >= t.cool) return LEVEL_COLORS.cool;
  if (ev >= t.cold) return LEVEL_COLORS.cold;
  return LEVEL_COLORS.ice;
}

interface SessionData {
  date: string;
  sessionId: string;
  avgExitVelo: number | null;
  maxExitVelo: number | null;
  avgLaunchAngle: number | null;
  maxDistance: number | null;
  avgDistance: number | null;
  swingCount: number;
  source: 'hittrax' | 'fullswing';
}

/** Unified swing (HitTrax + Full Swing). Spray/POI fields may be null. */
interface SpraySwing {
  id: string;
  session_id: string;
  exit_velocity: number | null;
  launch_angle: number | null;
  distance: number | null;
  /** Spray angle in degrees: negative = left field, positive = right field. */
  spray_angle: number | null;
  spray_chart_x: number | null;
  spray_chart_z: number | null;
  poi_x: number | null;
  poi_y: number | null;
  poi_z: number | null;
  sz_bottom: number | null;
  sz_top: number | null;
  sz_width: number | null;
  source: 'hittrax' | 'fullswing';
}

const FIELD_VIEWS: { key: 'spray3d' | 'spray' | 'zones'; label: string }[] = [
  { key: 'spray3d', label: '3D Spray' },
  { key: 'spray', label: 'Spray Chart' },
  { key: 'zones', label: 'Field Zones' },
];

const RANGE_DAYS: Record<Exclude<TimeRange, 'all'>, number> = { '1m': 30, '3m': 90, '6m': 180 };

export default function BattedBallTrendsScreen({ navigation, route }: any) {
  const [allSessionData, setAllSessionData] = useState<SessionData[]>([]);
  const [allSwings, setAllSwings] = useState<SpraySwing[]>([]);
  const [playingLevel, setPlayingLevel] = useState<string>('high-school');
  const [timeFilter, setTimeFilter] = useState<TimeRange>('3m');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);
  const [fieldView, setFieldView] = useState<'spray3d' | 'spray' | 'zones'>('spray3d');

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
      let playLevel: string | null = null;

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
        playLevel = athlete.play_level;
      } else {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('play_level')
          .eq('id', currentAthleteId)
          .single();
        playLevel = athlete?.play_level || null;
      }

      if (playLevel) {
        const levelMap: { [key: string]: string } = {
          'Youth': 'youth',
          'High School': 'high-school',
          'College': 'college',
          'Pro': 'professional',
        };
        setPlayingLevel(levelMap[playLevel] || 'high-school');
      }

      await fetchBattedBallData(currentAthleteId!);
    } catch (error) {
      console.error('Error loading athlete:', error);
      setLoading(false);
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (athleteId) {
        await fetchBattedBallData(athleteId, { silent: true });
      } else {
        await loadAthleteAndData();
      }
    } finally {
      setRefreshing(false);
    }
  }, [athleteId]);

  // Time filter applied to sessions AND swings (Set lookup, O(n+m)).
  const { filteredData, filteredSwings } = useMemo(() => {
    if (timeFilter === 'all') return { filteredData: allSessionData, filteredSwings: allSwings };
    const cutoff = Date.now() - RANGE_DAYS[timeFilter] * 24 * 60 * 60 * 1000;
    const sessions = allSessionData.filter((s) => parseDay(s.date).getTime() >= cutoff);
    const ids = new Set(sessions.map((s) => s.sessionId));
    return { filteredData: sessions, filteredSwings: allSwings.filter((sw) => ids.has(sw.session_id)) };
  }, [timeFilter, allSessionData, allSwings]);

  async function fetchBattedBallData(id: string, opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);

    interface HittraxSession {
      id: string;
      session_date: string;
      avg_exit_velocity: number | null;
      max_exit_velocity: number | null;
      avg_launch_angle: number | null;
      max_distance: number | null;
      total_swings: number | null;
    }
    interface FullSwingSession extends HittraxSession {
      avg_distance: number | null;
    }

    const [hittraxSessions, fullSwingSessions] = await Promise.all([
      fetchAllPaginated<HittraxSession>(
        () => supabase.from('hittrax_sessions'),
        'id, session_date, avg_exit_velocity, max_exit_velocity, avg_launch_angle, max_distance, total_swings',
        [{ column: 'athlete_id', value: id }],
        'session_date',
        true
      ),
      fetchAllPaginated<FullSwingSession>(
        () => supabase.from('fullswing_sessions'),
        'id, session_date, avg_exit_velocity, max_exit_velocity, avg_launch_angle, avg_distance, max_distance, total_swings',
        [{ column: 'athlete_id', value: id }],
        'session_date',
        true
      ),
    ]);

    if (hittraxSessions.length === 0 && fullSwingSessions.length === 0) {
      setLoading(false);
      setAllSessionData([]);
      setAllSwings([]);
      return;
    }

    // One swings query per source (distance folded in — no second HitTrax fetch).
    const [hittraxSwings, fullSwingSwings] = await Promise.all([
      hittraxSessions.length
        ? fetchAllPaginated<any>(
            () => supabase.from('hittrax_swings'),
            'id, session_id, exit_velocity, launch_angle, distance, horizontal_angle, spray_chart_x, spray_chart_z, poi_x, poi_y, poi_z, strike_zone_bottom, strike_zone_top, strike_zone_width',
            [{ column: 'session_id', value: hittraxSessions.map((s) => s.id), operator: 'in' }],
            'id',
            true
          )
        : Promise.resolve([] as any[]),
      fullSwingSessions.length
        ? fetchAllPaginated<any>(
            () => supabase.from('fullswing_swings'),
            'id, session_id, exit_velocity, launch_angle, spray_angle, distance',
            [{ column: 'session_id', value: fullSwingSessions.map((s) => s.id), operator: 'in' }],
            'id',
            true
          )
        : Promise.resolve([] as any[]),
    ]);

    const swings: SpraySwing[] = [];
    for (const s of hittraxSwings) {
      let x = num(s.spray_chart_x);
      let z = num(s.spray_chart_z);
      let spray = num(s.horizontal_angle);
      if (spray == null && x != null && z != null && (x !== 0 || z !== 0)) {
        spray = (Math.atan2(x, z) * 180) / Math.PI;
      }
      // Some imports have no spray_chart_x/z; derive from angle + distance.
      const dist = num(s.distance);
      if ((x == null || z == null || (x === 0 && z === 0)) && spray != null && dist != null) {
        const r = (spray * Math.PI) / 180;
        x = dist * Math.sin(r);
        z = dist * Math.cos(r);
      }
      swings.push({
        id: s.id,
        session_id: s.session_id,
        exit_velocity: num(s.exit_velocity),
        launch_angle: num(s.launch_angle),
        distance: num(s.distance),
        spray_angle: spray,
        spray_chart_x: x,
        spray_chart_z: z,
        poi_x: num(s.poi_x),
        poi_y: num(s.poi_y),
        poi_z: num(s.poi_z),
        sz_bottom: num(s.strike_zone_bottom),
        sz_top: num(s.strike_zone_top),
        sz_width: num(s.strike_zone_width),
        source: 'hittrax',
      });
    }
    for (const s of fullSwingSwings) {
      const spray = num(s.spray_angle);
      const dist = num(s.distance);
      const rad = spray != null ? (spray * Math.PI) / 180 : null;
      swings.push({
        id: s.id,
        session_id: s.session_id,
        exit_velocity: num(s.exit_velocity),
        launch_angle: num(s.launch_angle),
        distance: dist,
        spray_angle: spray,
        spray_chart_x: rad != null && dist != null ? dist * Math.sin(rad) : null,
        spray_chart_z: rad != null && dist != null ? dist * Math.cos(rad) : null,
        poi_x: null,
        poi_y: null,
        poi_z: null,
        sz_bottom: null,
        sz_top: null,
        sz_width: null,
        source: 'fullswing',
      });
    }
    setAllSwings(swings);

    // Per-session swing aggregates — fallback when the session row's aggregate is null.
    const bySession = new Map<string, SpraySwing[]>();
    for (const sw of swings) {
      const arr = bySession.get(sw.session_id);
      if (arr) arr.push(sw);
      else bySession.set(sw.session_id, [sw]);
    }
    const agg = (sid: string) => {
      const list = bySession.get(sid) || [];
      const evs = list.map((s) => s.exit_velocity).filter((v): v is number => v != null && v > 0);
      const las = list.filter((s) => s.exit_velocity != null && s.exit_velocity > 0).map((s) => s.launch_angle).filter((v): v is number => v != null);
      const ds = list.map((s) => s.distance).filter((v): v is number => v != null && v > 0);
      return {
        avgEV: mean(evs),
        maxEV: evs.length ? Math.max(...evs) : null,
        avgLA: mean(las),
        avgDist: mean(ds),
        maxDist: ds.length ? Math.max(...ds) : null,
        count: list.length,
      };
    };

    const build = (
      session: HittraxSession & { avg_distance?: number | null },
      source: 'hittrax' | 'fullswing'
    ): SessionData => {
      const a = agg(session.id);
      return {
        date: session.session_date.split('T')[0],
        sessionId: session.id,
        avgExitVelo: num(session.avg_exit_velocity) ?? a.avgEV,
        maxExitVelo: num(session.max_exit_velocity) ?? a.maxEV,
        avgLaunchAngle: num(session.avg_launch_angle) ?? a.avgLA,
        maxDistance: num(session.max_distance) ?? a.maxDist,
        // HitTrax has no session avg distance; always from swings.
        avgDistance: source === 'fullswing' ? num(session.avg_distance) ?? a.avgDist : a.avgDist,
        swingCount: session.total_swings || a.count,
        source,
      };
    };

    const allTrends = [
      ...hittraxSessions.map((s) => build(s, 'hittrax')),
      ...fullSwingSessions.map((s) => build(s, 'fullswing')),
    ].sort((a, b) => parseDay(a.date).getTime() - parseDay(b.date).getTime());

    setAllSessionData(allTrends);
    setLoading(false);
  }

  // ---- Stats ----
  const stats = useMemo(() => {
    const avgs = filteredData.map((s) => s.avgExitVelo).filter((v): v is number => v != null);
    const maxes = filteredData.map((s) => s.maxExitVelo).filter((v): v is number => v != null);
    const las = filteredData.map((s) => s.avgLaunchAngle).filter((v): v is number => v != null);
    const maxDists = filteredData.map((s) => s.maxDistance).filter((v): v is number => v != null);

    const contact = filteredSwings.filter((s) => s.exit_velocity != null && s.exit_velocity > 0);
    const withLA = contact.filter((s) => s.launch_angle != null);
    const dists = filteredSwings.map((s) => s.distance).filter((v): v is number => v != null && v > 0);

    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
    return {
      avgEV: mean(avgs),
      peakEV: maxes.length ? Math.max(...maxes) : null,
      evDelta: avgs.length >= 2 ? avgs[avgs.length - 1] - avgs[0] : null,
      firstDate: filteredData.find((s) => s.avgExitVelo != null)?.date ?? null,
      hardHit: pct(contact.filter((s) => s.exit_velocity! >= HARD_HIT_MPH).length, contact.length),
      avgLA: mean(las),
      sweetSpot: pct(withLA.filter((s) => s.launch_angle! >= SWEET_SPOT[0] && s.launch_angle! <= SWEET_SPOT[1]).length, withLA.length),
      groundBall: pct(withLA.filter((s) => s.launch_angle! < SWEET_SPOT[0]).length, withLA.length),
      maxDist: maxDists.length ? Math.max(...maxDists) : dists.length ? Math.max(...dists) : null,
      avgDist: mean(dists) ?? mean(filteredData.map((s) => s.avgDistance).filter((v): v is number => v != null)),
      over300: dists.length ? dists.filter((d) => d >= 300).length : null,
    };
  }, [filteredData, filteredSwings]);

  const contactSwings = useMemo(
    () => filteredSwings.filter((s) => s.exit_velocity != null && s.exit_velocity > 0),
    [filteredSwings]
  );
  const sprayChartSwings = useMemo(
    () => contactSwings.filter((s) => s.spray_chart_x != null && s.spray_chart_z != null),
    [contactSwings]
  );
  const zoneSwings = useMemo(() => contactSwings.filter((s) => s.spray_angle != null), [contactSwings]);

  // Most recent ~30 balls in range for the 3D field.
  const balls3d = useMemo<BattedBall[]>(() => {
    const order = new Map(filteredData.map((s, i) => [s.sessionId, i]));
    return contactSwings
      .filter((s) => s.distance != null && s.distance > 0 && s.launch_angle != null)
      .map((s, i) => ({ s, i, o: order.get(s.session_id) ?? -1 }))
      .sort((a, b) => a.o - b.o || a.i - b.i)
      .slice(-30)
      .map(({ s }) => ({
        exit_velocity: s.exit_velocity,
        launch_angle: s.launch_angle,
        horizontal_angle: s.spray_angle,
        distance: s.distance,
      }));
  }, [contactSwings, filteredData]);

  const hasFieldData = sprayChartSwings.length > 0 || zoneSwings.length > 0 || balls3d.length > 0;
  const hasPoi = contactSwings.some((s) => s.poi_x != null && s.poi_y != null);

  if (loading) {
    return (
      <View style={[steelStyles.screen, styles.center]}>
        <ActivityIndicator size="large" color={STEEL.force} />
      </View>
    );
  }

  const dates = filteredData.map((s) => s.date);

  return (
    <SafeAreaView style={steelStyles.screen} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={STEEL.force} colors={[STEEL.force]} progressBackgroundColor="#1A1A1A" />
        }
      >
        <ScreenHeader
          title="Batted Ball"
          subtitle={`Exit velocity, launch and distance · ${filteredData.length} session${filteredData.length === 1 ? '' : 's'}`}
          onBack={() => navigation.goBack()}
        />

        <View style={steelStyles.body}>
          <View style={{ paddingTop: 8, paddingBottom: 4 }}>
            <TimeChips value={timeFilter} onChange={setTimeFilter} />
          </View>

          {allSessionData.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No batted ball data available</Text>
              <Text style={styles.emptySubtext}>Complete HitTrax or Full Swing sessions to track your trends</Text>
            </View>
          ) : filteredData.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No data for this time period</Text>
              <Text style={styles.emptySubtext}>Try selecting a different time range</Text>
            </View>
          ) : (
            <>
              {/* EXIT VELOCITY */}
              <Section title="EXIT VELOCITY" right="tap a point" first>
                <KpiRow>
                  <Kpi
                    label="AVG"
                    value={fmt(stats.avgEV)}
                    unit="mph"
                    delta={stats.evDelta}
                    note={stats.evDelta != null && stats.firstDate ? `since ${shortDate(stats.firstDate)}` : undefined}
                  />
                  <Kpi label="PEAK" value={fmt(stats.peakEV)} unit="mph" color={STEEL.hitting} />
                  <Kpi label="HARD-HIT" value={fmt(stats.hardHit, 0)} unit="%" note={`≥${HARD_HIT_MPH} mph`} />
                  <Kpi label="SESSIONS" value={String(filteredData.length)} />
                </KpiRow>
                <TrendChart
                  dates={dates}
                  height={190}
                  step={10}
                  series={[
                    { key: 'avg', label: 'Avg EV', color: STEEL.force, values: filteredData.map((s) => s.avgExitVelo), fill: true, format: (v) => `${v.toFixed(1)} mph` },
                    { key: 'max', label: 'Peak EV', color: STEEL.hitting, values: filteredData.map((s) => s.maxExitVelo), dashed: true, format: (v) => `${v.toFixed(1)} mph` },
                  ]}
                />
              </Section>

              {/* LAUNCH ANGLE */}
              <Section title="LAUNCH ANGLE" right={`ideal ${SWEET_SPOT[0]}–${SWEET_SPOT[1]}°`}>
                <KpiRow>
                  <Kpi label="AVG" value={fmt(stats.avgLA)} unit="°" />
                  <Kpi label="SWEET SPOT" value={fmt(stats.sweetSpot, 0)} unit="%" color={STEEL.good} />
                  <Kpi label="GROUND BALL" value={fmt(stats.groundBall, 0)} unit="%" note={`LA < ${SWEET_SPOT[0]}°`} />
                </KpiRow>
                <TrendChart
                  dates={dates}
                  height={170}
                  step={5}
                  unit="°"
                  band={SWEET_SPOT}
                  emptyText="No launch angle data available"
                  series={[
                    { key: 'la', label: 'Avg Launch Angle', color: STEEL.purple, values: filteredData.map((s) => s.avgLaunchAngle), fill: true, format: (v) => `${v.toFixed(1)}°` },
                  ]}
                />
              </Section>

              {/* DISTANCE */}
              <Section title="DISTANCE">
                <KpiRow>
                  <Kpi label="MAX" value={fmt(stats.maxDist, 0)} unit="ft" color={STEEL.good} />
                  <Kpi label="AVG" value={fmt(stats.avgDist, 0)} unit="ft" />
                  <Kpi label="300+ FT" value={stats.over300 == null ? '—' : String(stats.over300)} note="balls" />
                </KpiRow>
                <TrendChart
                  dates={dates}
                  height={170}
                  step={50}
                  emptyText="No distance data available"
                  series={[
                    { key: 'avg', label: 'Avg Distance', color: STEEL.force, values: filteredData.map((s) => s.avgDistance), fill: true, format: (v) => `${v.toFixed(0)} ft` },
                    { key: 'max', label: 'Max Distance', color: STEEL.good, values: filteredData.map((s) => s.maxDistance), dashed: true, format: (v) => `${v.toFixed(0)} ft` },
                  ]}
                />
              </Section>

              {/* FIELD ANALYSIS */}
              {hasFieldData && (
                <Section title="FIELD ANALYSIS" right={fieldView === 'spray3d' ? `last ${balls3d.length} balls` : `${fieldView === 'spray' ? sprayChartSwings.length : zoneSwings.length} balls`}>
                  <Segmented options={FIELD_VIEWS} value={fieldView} onChange={setFieldView} />
                  <View style={{ marginTop: 14 }}>
                    {fieldView === 'spray3d' ? (
                      balls3d.length > 0 ? (
                        <BallField3D balls={balls3d} height={240} caption="Most recent balls in range · color = exit velo" />
                      ) : (
                        <Text style={steelStyles.empty}>No ball-flight data in this range</Text>
                      )
                    ) : fieldView === 'spray' ? (
                      sprayChartSwings.length > 0 ? (
                        <ExitVeloHeatmap swings={sprayChartSwings} playingLevel={playingLevel} />
                      ) : (
                        <Text style={steelStyles.empty}>No spray data in this range</Text>
                      )
                    ) : zoneSwings.length > 0 ? (
                      <FieldZones swings={zoneSwings} />
                    ) : (
                      <Text style={steelStyles.empty}>No spray data in this range</Text>
                    )}
                  </View>
                </Section>
              )}

              {/* STRIKE ZONE EV */}
              {contactSwings.length > 0 && (
                <Section title="STRIKE ZONE · EXIT VELO" right="catcher's view">
                  <Text style={styles.sectionSub}>Average exit velocity by pitch location</Text>
                  {hasPoi ? (
                    <StrikeZoneHeatmap swings={contactSwings} playingLevel={playingLevel} />
                  ) : (
                    <Text style={steelStyles.empty}>No pitch location data available</Text>
                  )}
                </Section>
              )}

              {/* STRIKE ZONE LA */}
              {contactSwings.length > 0 && (
                <Section title="STRIKE ZONE · LAUNCH ANGLE" right="catcher's view">
                  <Text style={styles.sectionSub}>Average launch angle by pitch location</Text>
                  <LaunchAngleStrikeZone swings={contactSwings} />
                </Section>
              )}

              {/* SESSION HISTORY */}
              <Section title="SESSION HISTORY" right={filteredData.length > 10 ? 'latest 10' : undefined}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { flex: 1.4, textAlign: 'left' }]}>DATE</Text>
                  <Text style={[styles.th, { flex: 0.7 }]}>SWINGS</Text>
                  <Text style={[styles.th, { flex: 0.9 }]}>AVG EV</Text>
                  <Text style={[styles.th, { flex: 0.9 }]}>MAX EV</Text>
                  <Text style={[styles.th, { flex: 0.9 }]}>MAX DIST</Text>
                </View>
                {[...filteredData].reverse().slice(0, 10).map((session) => (
                  <View key={session.sessionId} style={styles.tr}>
                    <View style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[styles.td, { textAlign: 'left', color: STEEL.day }]}>{shortDate(session.date)}</Text>
                      <Text style={[styles.sourceTag, session.source === 'fullswing' ? styles.sourceTagFullSwing : styles.sourceTagHittrax]}>
                        {session.source === 'fullswing' ? 'FS' : 'HT'}
                      </Text>
                    </View>
                    <Text style={[styles.td, { flex: 0.7 }]}>{session.swingCount}</Text>
                    <Text style={[styles.td, { flex: 0.9, color: STEEL.force }]}>{fmt(session.avgExitVelo)}</Text>
                    <Text style={[styles.td, { flex: 0.9, color: STEEL.hitting }]}>{fmt(session.maxExitVelo)}</Text>
                    <Text style={[styles.td, { flex: 0.9, color: STEEL.good }]}>{fmt(session.maxDistance, 0)}</Text>
                  </View>
                ))}
              </Section>
            </>
          )}
        </View>

        <View style={{ height: 96 }} />
      </ScrollView>

      {/* FAB Back Button */}
      <TouchableOpacity style={styles.fab} onPress={() => navigation.goBack()} accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={24} color={STEEL.text} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Trend chart: N series over sessions, optional ideal band, tap tooltips.
// ---------------------------------------------------------------------------

type TrendSeries = {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  fill?: boolean;
  format: (v: number) => string;
};

function TrendChart({
  dates,
  series,
  height,
  step,
  unit = '',
  band,
  emptyText,
}: {
  dates: string[];
  series: TrendSeries[];
  height: number;
  step: number;
  unit?: string;
  band?: [number, number];
  emptyText?: string;
}) {
  const [selected, setSelected] = useState<{ key: string; i: number } | null>(null);
  const pad = { top: 14, right: 12, bottom: 22, left: 36 };
  const innerW = CHART_W - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = dates.length;

  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null && Number.isFinite(v));
  if (all.length === 0) {
    return emptyText ? <Text style={steelStyles.empty}>{emptyText}</Text> : null;
  }

  let lo = Math.min(...all, ...(band ? [band[0]] : []));
  let hi = Math.max(...all, ...(band ? [band[1]] : []));
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi - lo < step) hi = lo + step;
  if (hi === lo) hi = lo + step;

  const xAt = (i: number) => pad.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const baseY = pad.top + innerH;

  const pts = series.map((s) => ({
    s,
    points: s.values
      .map((v, i) => (v != null && Number.isFinite(v) ? { i, x: xAt(i), y: yAt(v), v } : null))
      .filter((p): p is { i: number; x: number; y: number; v: number } => p !== null),
  }));

  const grid = Array.from({ length: 5 }, (_, k) => lo + (k * (hi - lo)) / 4);
  const gradId = (k: string) => `grad-${series.map((s) => s.key).join('-')}-${k}`;

  const sel = selected ? pts.find((p) => p.s.key === selected.key)?.points.find((p) => p.i === selected.i) : null;
  const selSeries = selected ? series.find((s) => s.key === selected.key) : null;

  return (
    <View style={{ marginTop: 16 }}>
      <View style={{ position: 'relative' }}>
        <Svg width={CHART_W} height={height}>
          <Defs>
            {pts.filter((p) => p.s.fill).map(({ s }) => (
              <SvgLinearGradient key={s.key} id={gradId(s.key)} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={s.color} stopOpacity={0.22} />
                <Stop offset="1" stopColor={s.color} stopOpacity={0} />
              </SvgLinearGradient>
            ))}
          </Defs>

          {grid.map((v, k) => (
            <G key={k}>
              <Line x1={pad.left} y1={yAt(v)} x2={pad.left + innerW} y2={yAt(v)} stroke={STEEL.rule} strokeWidth="1" />
              <SvgText x={pad.left - 6} y={yAt(v) + 3.5} textAnchor="end" fontSize="9.5" fill={STEEL.mute}>
                {`${Math.round(v)}${unit}`}
              </SvgText>
            </G>
          ))}

          {band && (
            <Rect
              x={pad.left}
              y={yAt(band[1])}
              width={innerW}
              height={Math.max(0, yAt(band[0]) - yAt(band[1]))}
              fill={STEEL.good}
              opacity={0.07}
            />
          )}

          {pts.map(({ s, points }) => {
            if (points.length === 0) return null;
            const line = points.map((p, k) => `${k === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            const area = points.length > 1
              ? `${line} L ${points[points.length - 1].x} ${baseY} L ${points[0].x} ${baseY} Z`
              : null;
            return (
              <G key={s.key}>
                {s.fill && area && <Path d={area} fill={`url(#${gradId(s.key)})`} />}
                <Path
                  d={line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.dashed ? 1.8 : 2.4}
                  strokeDasharray={s.dashed ? '5,4' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {points.map((p) => {
                  const on = selected?.key === s.key && selected.i === p.i;
                  return (
                    <Circle key={p.i} cx={p.x} cy={p.y} r={on ? 5.5 : 3.2} fill={s.dashed ? STEEL.bg : s.color} stroke={s.color} strokeWidth={s.dashed ? 1.6 : 0} />
                  );
                })}
              </G>
            );
          })}

          {n > 1 && (
            <>
              <SvgText x={pad.left} y={height - 6} fontSize="9.5" fill={STEEL.mute}>{shortDate(dates[0])}</SvgText>
              <SvgText x={pad.left + innerW} y={height - 6} fontSize="9.5" fill={STEEL.mute} textAnchor="end">{shortDate(dates[n - 1])}</SvgText>
            </>
          )}
        </Svg>

        {pts.map(({ s, points }) =>
          points.map((p) => (
            <TouchableOpacity
              key={`${s.key}-t-${p.i}`}
              style={[styles.touchTarget, { left: p.x - 14, top: p.y - 14 }]}
              onPress={() => setSelected(selected?.key === s.key && selected.i === p.i ? null : { key: s.key, i: p.i })}
            />
          ))
        )}

        {sel && selSeries && (
          <Tooltip x={sel.x} y={sel.y} value={selSeries.format(sel.v)} label={selSeries.label} date={shortDate(dates[sel.i])} color={selSeries.color} />
        )}
      </View>

      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: s.color, opacity: s.dashed ? 0.8 : 1, width: s.dashed ? 10 : 16 }]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
        {band && (
          <View style={styles.legendItem}>
            <View style={[styles.legendBox, { backgroundColor: 'rgba(52,211,153,0.18)' }]} />
            <Text style={styles.legendText}>{`Ideal ${band[0]}–${band[1]}${unit}`}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Field drawings
// ---------------------------------------------------------------------------

function FieldOutline() {
  return (
    <>
      <Line x1="200" y1="370" x2="60" y2="230" stroke={STEEL.past} strokeWidth="1.5" opacity="0.7" />
      <Line x1="200" y1="370" x2="340" y2="230" stroke={STEEL.past} strokeWidth="1.5" opacity="0.7" />
      <Path d="M 60 230 Q 100 140 200 136 Q 300 140 340 230" fill="none" stroke={STEEL.mute} strokeWidth="1.5" opacity="0.7" />
      <Path d="M 162 316 Q 200 292 238 316" fill="none" stroke={STEEL.mute} strokeWidth="1.5" opacity="0.7" />
    </>
  );
}

function LevelLegend({ playingLevel }: { playingLevel: string }) {
  return (
    <>
      <View style={styles.heatmapLegend}>
        <Text style={styles.heatmapLegendLabel}>Cold</Text>
        <View style={styles.heatmapGradient}>
          <LinearGradient
            colors={[LEVEL_COLORS.ice, LEVEL_COLORS.cold, LEVEL_COLORS.cool, LEVEL_COLORS.warm, LEVEL_COLORS.hot]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.gradientBar}
          />
        </View>
        <Text style={styles.heatmapLegendLabel}>Hot</Text>
      </View>
      <Text style={styles.heatmapLevelText}>{playingLevel.replace('-', ' ')} level thresholds</Text>
    </>
  );
}

// Exit Velocity Heatmap (2D spray chart, level thresholds)
function ExitVeloHeatmap({ swings, playingLevel }: { swings: SpraySwing[]; playingLevel: string }) {
  const svgWidth = CHART_W;
  const svgHeight = svgWidth * 0.8;
  const t = levelThresholds(playingLevel);

  const swingPoints = swings.map((swing) => ({
    x: 200 + swing.spray_chart_x! * 0.6,
    y: 370 - swing.spray_chart_z! * 0.6,
    color: levelColor(swing.exit_velocity!, t),
  }));

  return (
    <View>
      <View style={styles.fieldContainer}>
        <Svg width={svgWidth} height={svgHeight} viewBox="20 100 360 280">
          <FieldOutline />
          {swingPoints.map((p, idx) => (
            <Circle key={`blur-${idx}`} cx={p.x} cy={p.y} r={18} fill={p.color} opacity={0.3} />
          ))}
          {swingPoints.map((p, idx) => (
            <Circle key={`point-${idx}`} cx={p.x} cy={p.y} r={6} fill={p.color} opacity={0.85} />
          ))}
        </Svg>
      </View>
      <LevelLegend playingLevel={playingLevel} />
    </View>
  );
}

// Field Zones: split by spray angle (left < -15°, center ±15°, right > 15°).
const ZONE_SPLIT_DEG = 15;
function FieldZones({ swings }: { swings: SpraySwing[] }) {
  const svgWidth = CHART_W;
  const svgHeight = svgWidth * 0.8;

  const zone = (filter: (a: number) => boolean) => {
    const list = swings.filter((s) => filter(s.spray_angle!));
    const evs = list.map((s) => s.exit_velocity!);
    return {
      avg: mean(evs),
      peak: evs.length ? Math.max(...evs) : null,
      pct: swings.length ? (list.length / swings.length) * 100 : null,
    };
  };
  const left = zone((a) => a < -ZONE_SPLIT_DEG);
  const center = zone((a) => a >= -ZONE_SPLIT_DEG && a <= ZONE_SPLIT_DEG);
  const right = zone((a) => a > ZONE_SPLIT_DEG);

  // Divider rays at ±15° from home (200,370), length ~200 view units.
  const ray = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return { x: 200 + 200 * Math.sin(r), y: 370 - 200 * Math.cos(r) };
  };
  const lRay = ray(-ZONE_SPLIT_DEG);
  const rRay = ray(ZONE_SPLIT_DEG);

  const label = (x: number, y: number, name: string, z: ReturnType<typeof zone>) => (
    <G>
      <SvgText x={x} y={y} textAnchor="middle" fontSize="11" fill={STEEL.sub} fontWeight="800" letterSpacing="1.5">{name}</SvgText>
      <SvgText x={x} y={y + 22} textAnchor="middle" fontSize="20" fill={z.avg == null ? STEEL.past : STEEL.force} fontWeight="800">{fmt(z.avg)}</SvgText>
      <SvgText x={x} y={y + 36} textAnchor="middle" fontSize="9" fill={STEEL.mute}>avg mph</SvgText>
      <SvgText x={x} y={y + 54} textAnchor="middle" fontSize="13" fill={z.peak == null ? STEEL.past : STEEL.hitting} fontWeight="800">{fmt(z.peak)}</SvgText>
      <SvgText x={x} y={y + 66} textAnchor="middle" fontSize="9" fill={STEEL.mute}>peak</SvgText>
      <SvgText x={x} y={y + 82} textAnchor="middle" fontSize="11" fill={STEEL.day} fontWeight="700">{z.pct == null || z.pct === 0 ? '—' : `${z.pct.toFixed(0)}%`}</SvgText>
    </G>
  );

  const meanAngle = mean(swings.map((s) => s.spray_angle!)) ?? 0;
  const position = Math.max(0, Math.min(100, (meanAngle / 45) * 50 + 50));

  return (
    <View>
      <View style={styles.fieldContainer}>
        <Svg width={svgWidth} height={svgHeight} viewBox="20 100 360 280">
          <FieldOutline />
          <Line x1="200" y1="370" x2={lRay.x} y2={lRay.y} stroke={STEEL.force} strokeWidth="1.5" strokeDasharray="6,4" opacity="0.6" />
          <Line x1="200" y1="370" x2={rRay.x} y2={rRay.y} stroke={STEEL.force} strokeWidth="1.5" strokeDasharray="6,4" opacity="0.6" />
          {label(100, 190, 'LEFT', left)}
          {label(200, 150, 'CENTER', center)}
          {label(300, 190, 'RIGHT', right)}
          <Polygon points="200,370 195,365 200,360 205,365" fill={STEEL.force} opacity="0.8" />
        </Svg>
      </View>

      <View style={styles.tendencyContainer}>
        <View style={styles.tendencyHeader}>
          <Text style={styles.tendencyLabel}>Left</Text>
          <Text style={styles.tendencyLabelCenter}>DIRECTIONAL TENDENCY</Text>
          <Text style={styles.tendencyLabel}>Right</Text>
        </View>
        <View style={styles.tendencyBar}>
          <View style={styles.tendencyCenterMark} />
          <View
            style={[
              styles.tendencyIndicator,
              { left: `${position}%`, backgroundColor: position < 40 ? STEEL.warn : position > 60 ? STEEL.purple : STEEL.force },
            ]}
          />
        </View>
        <Text style={styles.zoneNote}>{`Zones split at ±${ZONE_SPLIT_DEG}° spray angle`}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Strike zone: real zone size. HitTrax per-swing strike_zone_* (inches) when
// present, else 17" wide × 1.6–3.5 ft. Edges are included.
// ---------------------------------------------------------------------------

const DEFAULT_ZONE = { width: 17, bottom: 1.6 * 12, top: 3.5 * 12 };

function zoneCell(s: SpraySwing, n: number): { row: number; col: number } | null {
  if (s.poi_x == null || s.poi_y == null || s.poi_y <= 5) return null;
  let w = s.sz_width ?? DEFAULT_ZONE.width;
  let b = s.sz_bottom ?? DEFAULT_ZONE.bottom;
  let t = s.sz_top ?? DEFAULT_ZONE.top;
  if (!(w > 0) || !(t > b)) {
    w = DEFAULT_ZONE.width;
    b = DEFAULT_ZONE.bottom;
    t = DEFAULT_ZONE.top;
  }
  const nx = (s.poi_x + w / 2) / w;
  const ny = (s.poi_y - b) / (t - b);
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  const cx = 1 - nx; // catcher's view
  return { col: Math.min(n - 1, Math.floor(cx * n)), row: Math.min(n - 1, Math.floor(ny * n)) };
}

function bucket(swings: SpraySwing[], n: number, value: (s: SpraySwing) => number | null) {
  const cells = new Map<string, { row: number; col: number; sum: number; count: number }>();
  let outside = 0;
  for (const s of swings) {
    const v = value(s);
    if (v == null) continue;
    const c = zoneCell(s, n);
    if (!c) {
      if (s.poi_x != null && s.poi_y != null && s.poi_y > 5) outside++;
      continue;
    }
    const k = `${c.row}:${c.col}`;
    const cell = cells.get(k);
    if (cell) {
      cell.sum += v;
      cell.count++;
    } else cells.set(k, { ...c, sum: v, count: 1 });
  }
  return { cells: [...cells.values()].map((c) => ({ ...c, avg: c.sum / c.count })), outside };
}

const VB_W = 400;
const VB_H = 500;
const ZONE_W = 280;
const ZONE_H = 360;
const ZONE_X = (VB_W - ZONE_W) / 2;
const ZONE_Y = (VB_H - ZONE_H) / 2 - 20;

function ZoneFrame({ color, children }: { color: string; children?: React.ReactNode }) {
  return (
    <>
      {children}
      <Rect x={ZONE_X} y={ZONE_Y} width={ZONE_W} height={ZONE_H} fill="none" stroke={color} strokeWidth="2" opacity={0.8} />
      {[1, 2].map((k) => (
        <G key={k}>
          <Line x1={ZONE_X + (k * ZONE_W) / 3} y1={ZONE_Y} x2={ZONE_X + (k * ZONE_W) / 3} y2={ZONE_Y + ZONE_H} stroke={color} strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />
          <Line x1={ZONE_X} y1={ZONE_Y + (k * ZONE_H) / 3} x2={ZONE_X + ZONE_W} y2={ZONE_Y + (k * ZONE_H) / 3} stroke={color} strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />
        </G>
      ))}
      <SvgText x={ZONE_X - 8} y={ZONE_Y + ZONE_H / 6 + 4} textAnchor="end" fontSize="10" fill={STEEL.mute}>High</SvgText>
      <SvgText x={ZONE_X - 8} y={ZONE_Y + ZONE_H / 2 + 4} textAnchor="end" fontSize="10" fill={STEEL.mute}>Mid</SvgText>
      <SvgText x={ZONE_X - 8} y={ZONE_Y + (5 * ZONE_H) / 6 + 4} textAnchor="end" fontSize="10" fill={STEEL.mute}>Low</SvgText>
      <SvgText x={VB_W / 2} y={VB_H - 20} textAnchor="middle" fontSize="10" fill={STEEL.mute}>Catcher's View</SvgText>
    </>
  );
}

function ZoneStatLabels({ stats, color, format }: { stats: { row: number; col: number; avg: number; count: number }[]; color: string; format: (v: number) => string }) {
  return (
    <>
      {stats.map((stat) => {
        const svgRow = 2 - stat.row;
        const cx = ZONE_X + (stat.col * ZONE_W) / 3 + ZONE_W / 6;
        const cy = ZONE_Y + (svgRow * ZONE_H) / 3 + ZONE_H / 6;
        return (
          <G key={`${stat.row}-${stat.col}`}>
            <Rect x={cx - 35} y={cy - 22} width={70} height={44} fill="#000000" opacity={0.8} rx="6" />
            <SvgText x={cx} y={cy - 3} textAnchor="middle" fontSize="18" fill={color} fontWeight="bold">{format(stat.avg)}</SvgText>
            <SvgText x={cx} y={cy + 16} textAnchor="middle" fontSize="10" fill={STEEL.sub}>{`${stat.count} swing${stat.count !== 1 ? 's' : ''}`}</SvgText>
          </G>
        );
      })}
    </>
  );
}

function StrikeZoneHeatmap({ swings, playingLevel }: { swings: SpraySwing[]; playingLevel: string }) {
  const svgWidth = CHART_W;
  const svgHeight = svgWidth * 1.25;
  const t = levelThresholds(playingLevel);
  const GRID = 12;
  const cellW = ZONE_W / GRID;
  const cellH = ZONE_H / GRID;

  const ev = (s: SpraySwing) => (s.exit_velocity != null && s.exit_velocity > 0 ? s.exit_velocity : null);
  const heat = bucket(swings, GRID, ev);
  const zones = bucket(swings, 3, ev);

  if (heat.cells.length === 0) {
    return <Text style={steelStyles.empty}>No pitches inside the strike zone in this range</Text>;
  }

  return (
    <View>
      <View style={styles.strikeZoneContainer}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${VB_W} ${VB_H}`}>
          <ZoneFrame color={STEEL.good}>
            {heat.cells.map((cell) => {
              const x = ZONE_X + cell.col * cellW;
              const y = ZONE_Y + (GRID - 1 - cell.row) * cellH;
              const color = levelColor(cell.avg, t);
              const op = Math.min(0.5 + (cell.count / 8) * 0.4, 0.9);
              return (
                <G key={`${cell.row}-${cell.col}`}>
                  <Rect x={x - cellW * 0.3} y={y - cellH * 0.3} width={cellW * 1.6} height={cellH * 1.6} fill={color} opacity={op * 0.3} rx="4" />
                  <Rect x={x} y={y} width={cellW} height={cellH} fill={color} opacity={op} />
                </G>
              );
            })}
          </ZoneFrame>
          <ZoneStatLabels stats={zones.cells} color={STEEL.text} format={(v) => v.toFixed(1)} />
        </Svg>
      </View>
      <LevelLegend playingLevel={playingLevel} />
      {heat.outside > 0 && <Text style={styles.zoneNote}>{`${heat.outside} pitch${heat.outside === 1 ? '' : 'es'} outside the zone not shown`}</Text>}
    </View>
  );
}

function LaunchAngleStrikeZone({ swings }: { swings: SpraySwing[] }) {
  const svgWidth = CHART_W;
  const svgHeight = svgWidth * 1.25;
  const zones = bucket(swings, 3, (s) => s.launch_angle);

  if (zones.cells.length === 0) {
    return <Text style={steelStyles.empty}>No launch angle data available</Text>;
  }

  return (
    <View>
      <View style={styles.strikeZoneContainer}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${VB_W} ${VB_H}`}>
          <ZoneFrame color={STEEL.purple} />
          <ZoneStatLabels stats={zones.cells} color={STEEL.purple} format={(v) => `${v.toFixed(1)}°`} />
        </Svg>
      </View>
      <Text style={styles.zoneNote}>{`Ideal launch angle: ${SWEET_SPOT[0]}–${SWEET_SPOT[1]}° for line drives and fly balls`}</Text>
    </View>
  );
}

// Tooltip
function Tooltip({ x, y, value, label, date, color }: { x: number; y: number; value: string; label: string; date: string; color: string }) {
  const tooltipWidth = 96;
  let adjustedX = x - tooltipWidth / 2;
  if (adjustedX < 5) adjustedX = 5;
  if (adjustedX > CHART_W - tooltipWidth - 5) adjustedX = CHART_W - tooltipWidth - 5;
  return (
    <View pointerEvents="none" style={[styles.tooltip, { left: adjustedX, top: Math.max(0, y - 66), width: tooltipWidth }]}>
      <Text style={[styles.tooltipValue, { color }]}>{value}</Text>
      <Text style={styles.tooltipLabel}>{label}</Text>
      <Text style={styles.tooltipDate}>{date}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 56, gap: 6 },
  emptyText: { color: STEEL.day, fontSize: 15, fontWeight: '700' },
  emptySubtext: { color: STEEL.mute, fontSize: 13, textAlign: 'center' },
  sectionSub: { color: STEEL.mute, fontSize: 12, marginTop: -6, marginBottom: 8 },
  touchTarget: { position: 'absolute', width: 28, height: 28 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLine: { height: 3, borderRadius: 2 },
  legendBox: { width: 14, height: 10, borderRadius: 2 },
  legendText: { color: STEEL.sub, fontSize: 11, fontWeight: '600' },
  tooltip: {
    position: 'absolute',
    backgroundColor: STEEL.card,
    borderColor: STEEL.hair,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  tooltipValue: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tooltipLabel: { color: STEEL.sub, fontSize: 10, fontWeight: '600' },
  tooltipDate: { color: STEEL.mute, fontSize: 10 },
  fieldContainer: { alignItems: 'center' },
  strikeZoneContainer: { alignItems: 'center' },
  heatmapLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 },
  heatmapLegendLabel: { color: STEEL.mute, fontSize: 11, fontWeight: '600' },
  heatmapGradient: { width: 160, height: 8, borderRadius: 4, overflow: 'hidden' },
  gradientBar: { flex: 1 },
  heatmapLevelText: { color: STEEL.mute, fontSize: 10.5, textAlign: 'center', marginTop: 6, textTransform: 'capitalize' },
  zoneNote: { color: STEEL.mute, fontSize: 10.5, textAlign: 'center', marginTop: 8 },
  tendencyContainer: { marginTop: 12 },
  tendencyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tendencyLabel: { color: STEEL.sub, fontSize: 11, fontWeight: '600' },
  tendencyLabelCenter: { color: STEEL.mute, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  tendencyBar: { height: 6, borderRadius: 3, backgroundColor: STEEL.card, position: 'relative', justifyContent: 'center' },
  tendencyCenterMark: { position: 'absolute', left: '50%', width: 1, height: 12, backgroundColor: STEEL.hair },
  tendencyIndicator: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, borderWidth: 2, borderColor: STEEL.bg },
  tableHeader: { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: STEEL.hair },
  th: { color: STEEL.mute, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.1, textAlign: 'right' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: STEEL.rule },
  td: { color: STEEL.text, fontSize: 13, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  sourceTag: { fontSize: 8, fontWeight: '800', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 3, marginLeft: 6, overflow: 'hidden' },
  sourceTagHittrax: { backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' },
  sourceTagFullSwing: { backgroundColor: 'rgba(168, 85, 247, 0.2)', color: '#a855f7' },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1b2430',
    borderWidth: 1,
    borderColor: '#2a3442',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
