import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

    // Apply filters
    for (const filter of filters) {
      if (filter.operator === 'in') {
        q = q.in(filter.column, filter.value);
      } else {
        q = q.eq(filter.column, filter.value);
      }
    }

    // Apply additional filters if provided
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

// Professional color palette matching HittingTrendsScreen
const COLORS = {
  primary: '#9BDDFF',
  primaryDark: '#7BC5F0',
  secondary: '#F5F0E6',
  gold: '#D4AF37',
  white: '#FFFFFF',
  gray100: '#F5F5F5',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
  black: '#000000',
};

interface SessionData {
  date: string;
  sessionId: string;
  avgExitVelo: number | null;
  maxExitVelo: number | null;
  avgLaunchAngle: number | null;
  maxDistance: number | null;
  avgDistance: number | null;
  swingCount: number;
}

interface HitTraxSwing {
  id: string;
  session_id: string;
  exit_velocity: number;
  launch_angle: number | null;
  distance: number | null;
  spray_chart_x: number;
  spray_chart_z: number;
  poi_x: number | null;
  poi_y: number | null;
  poi_z: number | null;
}

type TimeFilter = '1month' | '3months' | '6months' | 'all';

export default function BattedBallTrendsScreen({ navigation, route }: any) {
  const [allSessionData, setAllSessionData] = useState<SessionData[]>([]);
  const [filteredData, setFilteredData] = useState<SessionData[]>([]);
  const [allSwings, setAllSwings] = useState<HitTraxSwing[]>([]);
  const [filteredSwings, setFilteredSwings] = useState<HitTraxSwing[]>([]);
  const [playingLevel, setPlayingLevel] = useState<string>('high-school');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('3months');
  const [loading, setLoading] = useState(true);
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);
  const [fieldViewIndex, setFieldViewIndex] = useState(0);

  useEffect(() => {
    loadAthleteAndData();
  }, []);

  useEffect(() => {
    applyTimeFilter();
  }, [timeFilter, allSessionData, allSwings]);

  async function loadAthleteAndData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      // Use passed athleteId or fallback to looking up by user_id
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
        // If athleteId passed, fetch play_level
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
          'Pro': 'professional'
        };
        setPlayingLevel(levelMap[playLevel] || 'high-school');
      }

      await fetchBattedBallData(currentAthleteId!);
    } catch (error) {
      console.error('Error loading athlete:', error);
      setLoading(false);
    }
  }

  function applyTimeFilter() {
    if (allSessionData.length === 0) {
      setFilteredData([]);
      setFilteredSwings([]);
      return;
    }

    const now = new Date();
    let cutoffDate: Date;

    switch (timeFilter) {
      case '1month':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '3months':
        cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '6months':
        cutoffDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
        setFilteredData(allSessionData);
        setFilteredSwings(allSwings);
        return;
    }

    const filtered = allSessionData.filter(session =>
      new Date(session.date) >= cutoffDate
    );
    setFilteredData(filtered);

    const filteredSessionIds = filtered.map(s => s.sessionId);
    const filteredSwingsData = allSwings.filter(swing =>
      filteredSessionIds.includes(swing.session_id)
    );
    setFilteredSwings(filteredSwingsData);
  }

  async function fetchBattedBallData(id: string) {
    setLoading(true);

    // Interfaces for typed pagination
    interface HittraxSession {
      id: string;
      session_date: string;
      avg_exit_velocity: number | null;
      max_exit_velocity: number | null;
      avg_launch_angle: number | null;
      max_distance: number | null;
      total_swings: number | null;
    }

    // Use existing HitTraxSwing interface for type compatibility

    interface DistanceSwing {
      session_id: string;
      distance: number | null;
    }

    // Use paginated fetch to get ALL sessions (bypasses 1000 row limit)
    const hittraxSessions = await fetchAllPaginated<HittraxSession>(
      () => supabase.from('hittrax_sessions'),
      'id, session_date, avg_exit_velocity, max_exit_velocity, avg_launch_angle, max_distance, total_swings',
      [{ column: 'athlete_id', value: id }],
      'session_date',
      true
    );

    if (!hittraxSessions || hittraxSessions.length === 0) {
      setLoading(false);
      setAllSessionData([]);
      setAllSwings([]);
      return;
    }

    const sessionIds = hittraxSessions.map(s => s.id);

    // Use paginated fetch for swings with spray chart data (using existing HitTraxSwing interface)
    const swings = await fetchAllPaginated<HitTraxSwing>(
      () => supabase.from('hittrax_swings'),
      'id, session_id, exit_velocity, launch_angle, distance, spray_chart_x, spray_chart_z, poi_x, poi_y, poi_z',
      [{ column: 'session_id', value: sessionIds, operator: 'in' }],
      'id',
      true,
      (q) => q.not('spray_chart_x', 'is', null).not('spray_chart_z', 'is', null)
    );

    const allSwingsData = swings || [];
    setAllSwings(allSwingsData);

    // Use paginated fetch for distance data
    const allSwingsForDistance = await fetchAllPaginated<DistanceSwing>(
      () => supabase.from('hittrax_swings'),
      'session_id, distance',
      [{ column: 'session_id', value: sessionIds, operator: 'in' }],
      'id',
      true
    );

    const sessionDistances: { [sessionId: string]: number[] } = {};
    (allSwingsForDistance || []).forEach(swing => {
      if (swing.distance !== null && swing.distance > 0) {
        if (!sessionDistances[swing.session_id]) {
          sessionDistances[swing.session_id] = [];
        }
        sessionDistances[swing.session_id].push(swing.distance);
      }
    });

    const trends = hittraxSessions.map(session => {
      const distances = sessionDistances[session.id] || [];
      const avgDistance = distances.length > 0
        ? distances.reduce((sum, d) => sum + d, 0) / distances.length
        : null;

      return {
        date: session.session_date.split('T')[0],
        sessionId: session.id,
        avgExitVelo: session.avg_exit_velocity,
        maxExitVelo: session.max_exit_velocity,
        avgLaunchAngle: session.avg_launch_angle,
        maxDistance: session.max_distance,
        avgDistance: avgDistance,
        swingCount: session.total_swings || 0,
      };
    });

    setAllSessionData(trends);
    setLoading(false);
  }

  // Calculate overall stats
  const avgExitVelo = useMemo(() => {
    const validSessions = filteredData.filter(s => s.avgExitVelo !== null);
    return validSessions.length > 0
      ? validSessions.reduce((sum, s) => sum + (s.avgExitVelo || 0), 0) / validSessions.length
      : 0;
  }, [filteredData]);

  const peakExitVelo = useMemo(() => {
    const maxVelos = filteredData.map(s => s.maxExitVelo).filter((ev): ev is number => ev !== null);
    return maxVelos.length > 0 ? Math.max(...maxVelos) : 0;
  }, [filteredData]);

  const avgLaunchAngle = useMemo(() => {
    const validSessions = filteredData.filter(s => s.avgLaunchAngle !== null);
    return validSessions.length > 0
      ? validSessions.reduce((sum, s) => sum + (s.avgLaunchAngle || 0), 0) / validSessions.length
      : 0;
  }, [filteredData]);

  const peakDistance = useMemo(() => {
    const maxDists = filteredData.map(s => s.maxDistance).filter((d): d is number => d !== null);
    return maxDists.length > 0 ? Math.max(...maxDists) : 0;
  }, [filteredData]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={20} color={COLORS.gray400} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Batted Ball Trends</Text>
          <Text style={styles.subtitle}>
            Track your exit velocity and distance • {filteredData.length} sessions
          </Text>
        </View>

        {/* Time Filter Buttons */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterContainer}
          contentContainerStyle={styles.filterContent}
        >
          {(['1month', '3months', '6months', 'all'] as TimeFilter[]).map((filter) => (
            <TouchableOpacity
              key={filter}
              onPress={() => setTimeFilter(filter)}
              style={[
                styles.filterButton,
                timeFilter === filter && styles.filterButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.filterButtonText,
                  timeFilter === filter && styles.filterButtonTextActive,
                ]}
              >
                {filter === '1month' ? '1 Month' :
                 filter === '3months' ? '3 Months' :
                 filter === '6months' ? '6 Months' : 'All Time'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {allSessionData.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No batted ball data available</Text>
            <Text style={styles.emptySubtext}>Complete HitTrax sessions to track your trends</Text>
          </View>
        ) : filteredData.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No data for this time period</Text>
            <Text style={styles.emptySubtext}>Try selecting a different time range</Text>
          </View>
        ) : (
          <>
            {/* Exit Velocity PR Cards */}
            <View style={styles.prSection}>
              <Text style={styles.sectionTitle}>Exit Velocity</Text>
              <View style={styles.prRow}>
                <View style={styles.prItem}>
                  <Text style={styles.prValue}>{avgExitVelo.toFixed(1)}</Text>
                  <Text style={styles.prLabel}>Average</Text>
                  <Text style={styles.prUnit}>mph</Text>
                </View>
                <View style={[styles.prItem, styles.prItemBorder]}>
                  <View style={styles.prValueRow}>
                    <Ionicons name="star" size={12} color={COLORS.gold} />
                    <Text style={styles.prValueGold}>{peakExitVelo.toFixed(1)}</Text>
                  </View>
                  <Text style={styles.prLabel}>Peak</Text>
                  <Text style={styles.prUnit}>mph</Text>
                </View>
                <View style={styles.prItem}>
                  <Text style={styles.prValue}>{filteredData.length}</Text>
                  <Text style={styles.prLabel}>Sessions</Text>
                  <Text style={styles.prUnit}>total</Text>
                </View>
              </View>
            </View>

            {/* Exit Velocity Chart */}
            <ExitVelocityChart sessionData={filteredData} />

            {/* Launch Angle Section */}
            <View style={styles.prSection}>
              <Text style={styles.sectionTitle}>Launch Angle</Text>
              <View style={styles.singleStatRow}>
                <Text style={styles.prValue}>{avgLaunchAngle.toFixed(1)}°</Text>
                <Text style={styles.statDescription}>Average launch angle • Ideal: 10-30°</Text>
              </View>
            </View>

            {/* Launch Angle Chart */}
            <LaunchAngleChart sessionData={filteredData} />

            {/* Distance Section */}
            <View style={styles.prSection}>
              <Text style={styles.sectionTitle}>Distance</Text>
              <View style={styles.prRow}>
                <View style={styles.prItem}>
                  <View style={styles.prValueRow}>
                    <Ionicons name="star" size={12} color={COLORS.gold} />
                    <Text style={styles.prValueGold}>{peakDistance.toFixed(0)}</Text>
                  </View>
                  <Text style={styles.prLabel}>Max Distance</Text>
                  <Text style={styles.prUnit}>feet</Text>
                </View>
              </View>
            </View>

            {/* Distance Chart */}
            <DistanceChart sessionData={filteredData} />

            {/* Field Visualizations */}
            {filteredSwings.length > 0 && (
              <>
                <View style={styles.prSection}>
                  <Text style={styles.sectionTitle}>Field Analysis</Text>
                </View>

                {/* Toggle buttons */}
                <View style={styles.fieldToggle}>
                  <TouchableOpacity
                    onPress={() => setFieldViewIndex(0)}
                    style={[styles.fieldToggleButton, fieldViewIndex === 0 && styles.fieldToggleButtonActive]}
                  >
                    <Text style={[styles.fieldToggleText, fieldViewIndex === 0 && styles.fieldToggleTextActive]}>Spray Chart</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setFieldViewIndex(1)}
                    style={[styles.fieldToggleButton, fieldViewIndex === 1 && styles.fieldToggleButtonActive]}
                  >
                    <Text style={[styles.fieldToggleText, fieldViewIndex === 1 && styles.fieldToggleTextActive]}>Field Zones</Text>
                  </TouchableOpacity>
                </View>

                {fieldViewIndex === 0 ? (
                  <ExitVeloHeatmap swings={filteredSwings} playingLevel={playingLevel} />
                ) : (
                  <FieldZones swings={filteredSwings} />
                )}
              </>
            )}

            {/* Strike Zone EV Heatmap */}
            {filteredSwings.length > 0 && (
              <>
                <View style={styles.prSection}>
                  <Text style={styles.sectionTitle}>Strike Zone Exit Velocity</Text>
                  <Text style={styles.sectionSubtitle}>Average exit velocity by pitch location (catcher's view)</Text>
                </View>
                <StrikeZoneHeatmap swings={filteredSwings} playingLevel={playingLevel} />
              </>
            )}

            {/* Strike Zone Launch Angle */}
            {filteredSwings.length > 0 && (
              <>
                <View style={styles.prSection}>
                  <Text style={styles.sectionTitle}>Strike Zone Launch Angle</Text>
                  <Text style={styles.sectionSubtitle}>Average launch angle by pitch location (catcher's view)</Text>
                </View>
                <LaunchAngleStrikeZone swings={filteredSwings} />
              </>
            )}

            {/* Session Details Table */}
            <View style={styles.prSection}>
              <Text style={styles.sectionTitle}>Session History</Text>
            </View>
            <View style={styles.tableContainer}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderCell, { flex: 1.2 }]}>Date</Text>
                <Text style={[styles.tableHeaderCell, { flex: 0.8 }]}>Swings</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Avg EV</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Max EV</Text>
                <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Max Dist</Text>
              </View>
              {[...filteredData].reverse().slice(0, 10).map((session, idx) => (
                <View key={idx} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowAlt]}>
                  <Text style={[styles.tableCell, { flex: 1.2 }]}>
                    {new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                  <Text style={[styles.tableCell, { flex: 0.8 }]}>{session.swingCount}</Text>
                  <Text style={[styles.tableCell, { flex: 1, color: COLORS.primary }]}>
                    {session.avgExitVelo !== null ? `${session.avgExitVelo.toFixed(1)}` : '-'}
                  </Text>
                  <Text style={[styles.tableCell, { flex: 1, color: COLORS.secondary }]}>
                    {session.maxExitVelo !== null ? `${session.maxExitVelo.toFixed(1)}` : '-'}
                  </Text>
                  <Text style={[styles.tableCell, { flex: 1, color: COLORS.primary }]}>
                    {session.maxDistance !== null ? `${session.maxDistance.toFixed(0)}` : '-'}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* FAB Back Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.goBack()}
      >
        <Ionicons name="arrow-back" size={24} color={COLORS.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// Exit Velocity Chart Component
function ExitVelocityChart({ sessionData }: { sessionData: SessionData[] }) {
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; y: number; value: number; type: 'avg' | 'max'; date: string } | null>(null);

  if (sessionData.length === 0) return null;

  const chartWidth = SCREEN_WIDTH - 32;
  const chartHeight = 264;
  const padding = { top: 20, right: 35, bottom: 35, left: 40 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const allEVs = sessionData.flatMap(s => [s.avgExitVelo, s.maxExitVelo]).filter((v): v is number => v !== null);
  if (allEVs.length === 0) return null;

  const minEV = Math.floor(Math.min(...allEVs) / 10) * 10;
  const maxEV = Math.ceil(Math.max(...allEVs) / 10) * 10;

  const avgPoints = sessionData
    .map((session, index) => {
      if (session.avgExitVelo === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.avgExitVelo - minEV) / (maxEV - minEV)) * innerHeight;
      return { x, y, value: session.avgExitVelo, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const maxPoints = sessionData
    .map((session, index) => {
      if (session.maxExitVelo === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.maxExitVelo - minEV) / (maxEV - minEV)) * innerHeight;
      return { x, y, value: session.maxExitVelo, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const avgLinePath = avgPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const maxLinePath = maxPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const yAxisSteps = 5;
  const gridLines = Array.from({ length: yAxisSteps + 1 }, (_, i) => {
    const value = minEV + (i * (maxEV - minEV)) / yAxisSteps;
    const y = padding.top + innerHeight - (i / yAxisSteps) * innerHeight;
    return { y, value };
  });

  return (
    <View style={styles.chartContainer}>
      <View style={{ position: 'relative' }}>
        <Svg width={chartWidth} height={chartHeight}>
          {/* Grid lines */}
          {gridLines.map((line, i) => (
            <G key={i}>
              <Line x1={padding.left} y1={line.y} x2={padding.left + innerWidth} y2={line.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
              <SvgText x={padding.left - 5} y={line.y + 4} textAnchor="end" fontSize="10" fill={COLORS.gray500}>{Math.round(line.value)}</SvgText>
            </G>
          ))}

          {/* Max EV line */}
          <Path d={maxLinePath} fill="none" stroke={COLORS.secondary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Avg EV line */}
          <Path d={avgLinePath} fill="none" stroke={COLORS.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Max EV points */}
          {maxPoints.map((point, i) => (
            <Circle
              key={`max-${i}`}
              cx={point.x}
              cy={point.y}
              r={selectedPoint?.x === point.x && selectedPoint?.type === 'max' ? 7 : 5}
              fill={COLORS.secondary}
              stroke={COLORS.black}
              strokeWidth="2"
            />
          ))}

          {/* Avg EV points */}
          {avgPoints.map((point, i) => (
            <Circle
              key={`avg-${i}`}
              cx={point.x}
              cy={point.y}
              r={selectedPoint?.x === point.x && selectedPoint?.type === 'avg' ? 7 : 5}
              fill={COLORS.primary}
              stroke={COLORS.black}
              strokeWidth="2"
            />
          ))}
        </Svg>

        {/* Touch targets */}
        {maxPoints.map((point, i) => (
          <TouchableOpacity
            key={`max-touch-${i}`}
            style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
            onPress={() => setSelectedPoint(selectedPoint?.x === point.x && selectedPoint?.type === 'max' ? null : { ...point, type: 'max' })}
          />
        ))}
        {avgPoints.map((point, i) => (
          <TouchableOpacity
            key={`avg-touch-${i}`}
            style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
            onPress={() => setSelectedPoint(selectedPoint?.x === point.x && selectedPoint?.type === 'avg' ? null : { ...point, type: 'avg' })}
          />
        ))}

        {/* Tooltip */}
        {selectedPoint && (
          <Tooltip
            x={selectedPoint.x}
            y={selectedPoint.y}
            value={`${selectedPoint.value.toFixed(1)} mph`}
            label={selectedPoint.type === 'avg' ? 'Avg' : 'Max'}
            date={new Date(selectedPoint.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            color={selectedPoint.type === 'avg' ? COLORS.primary : COLORS.secondary}
          />
        )}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.primary }]} />
          <Text style={styles.legendText}>Average EV</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.secondary }]} />
          <Text style={styles.legendText}>Peak EV</Text>
        </View>
      </View>
    </View>
  );
}

// Launch Angle Chart Component
function LaunchAngleChart({ sessionData }: { sessionData: SessionData[] }) {
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; y: number; value: number; date: string } | null>(null);

  if (sessionData.length === 0) return null;

  const chartWidth = SCREEN_WIDTH - 32;
  const chartHeight = 240;
  const padding = { top: 20, right: 35, bottom: 35, left: 40 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const allLAs = sessionData.map(s => s.avgLaunchAngle).filter((la): la is number => la !== null);
  if (allLAs.length === 0) {
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.emptyChartText}>No launch angle data available</Text>
      </View>
    );
  }

  const minLA = Math.floor(Math.min(...allLAs) / 5) * 5 - 5;
  const maxLA = Math.ceil(Math.max(...allLAs) / 5) * 5 + 5;

  const laPoints = sessionData
    .map((session, index) => {
      if (session.avgLaunchAngle === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.avgLaunchAngle - minLA) / (maxLA - minLA)) * innerHeight;
      return { x, y, value: session.avgLaunchAngle, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const laLinePath = laPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Ideal range band (10-30 degrees)
  const idealMin = 10;
  const idealMax = 30;
  const idealMinY = padding.top + innerHeight - ((idealMin - minLA) / (maxLA - minLA)) * innerHeight;
  const idealMaxY = padding.top + innerHeight - ((idealMax - minLA) / (maxLA - minLA)) * innerHeight;

  const yAxisSteps = 5;
  const gridLines = Array.from({ length: yAxisSteps + 1 }, (_, i) => {
    const value = minLA + (i * (maxLA - minLA)) / yAxisSteps;
    const y = padding.top + innerHeight - (i / yAxisSteps) * innerHeight;
    return { y, value };
  });

  return (
    <View style={styles.chartContainer}>
      <View style={{ position: 'relative' }}>
        <Svg width={chartWidth} height={chartHeight}>
          {/* Grid lines */}
          {gridLines.map((line, i) => (
            <G key={i}>
              <Line x1={padding.left} y1={line.y} x2={padding.left + innerWidth} y2={line.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
              <SvgText x={padding.left - 5} y={line.y + 4} textAnchor="end" fontSize="10" fill={COLORS.gray500}>{Math.round(line.value)}°</SvgText>
            </G>
          ))}

          {/* Ideal range band */}
          <Rect
            x={padding.left}
            y={idealMaxY}
            width={innerWidth}
            height={idealMinY - idealMaxY}
            fill={COLORS.primary}
            opacity="0.15"
          />

          {/* Launch angle line */}
          <Path d={laLinePath} fill="none" stroke={COLORS.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Data points */}
          {laPoints.map((point, i) => (
            <Circle
              key={`la-${i}`}
              cx={point.x}
              cy={point.y}
              r={selectedPoint?.x === point.x ? 7 : 5}
              fill={COLORS.primary}
              stroke={COLORS.black}
              strokeWidth="2"
            />
          ))}
        </Svg>

        {/* Touch targets */}
        {laPoints.map((point, i) => (
          <TouchableOpacity
            key={`la-touch-${i}`}
            style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
            onPress={() => setSelectedPoint(selectedPoint?.x === point.x ? null : point)}
          />
        ))}

        {/* Tooltip */}
        {selectedPoint && (
          <Tooltip
            x={selectedPoint.x}
            y={selectedPoint.y}
            value={`${selectedPoint.value.toFixed(1)}°`}
            label="Launch Angle"
            date={new Date(selectedPoint.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            color={COLORS.primary}
          />
        )}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.primary }]} />
          <Text style={styles.legendText}>Avg Launch Angle</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: 'rgba(155,221,255,0.15)', borderColor: COLORS.primary }]} />
          <Text style={styles.legendText}>Ideal Range (10-30°)</Text>
        </View>
      </View>
    </View>
  );
}

// Distance Chart Component
function DistanceChart({ sessionData }: { sessionData: SessionData[] }) {
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; y: number; value: number; type: 'avg' | 'max'; date: string } | null>(null);

  if (sessionData.length === 0) return null;

  const chartWidth = SCREEN_WIDTH - 32;
  const chartHeight = 240;
  const padding = { top: 20, right: 35, bottom: 35, left: 45 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const maxDistances = sessionData.map(s => s.maxDistance).filter((d): d is number => d !== null);
  const avgDistances = sessionData.map(s => s.avgDistance).filter((d): d is number => d !== null);
  const allDistances = [...maxDistances, ...avgDistances];

  if (allDistances.length === 0) {
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.emptyChartText}>No distance data available</Text>
      </View>
    );
  }

  const minDist = Math.floor(Math.min(...allDistances) / 50) * 50 - 50;
  const maxDist = Math.ceil(Math.max(...allDistances) / 50) * 50 + 50;

  const maxDistPoints = sessionData
    .map((session, index) => {
      if (session.maxDistance === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.maxDistance - minDist) / (maxDist - minDist)) * innerHeight;
      return { x, y, value: session.maxDistance, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const avgDistPoints = sessionData
    .map((session, index) => {
      if (session.avgDistance === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.avgDistance - minDist) / (maxDist - minDist)) * innerHeight;
      return { x, y, value: session.avgDistance, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const maxDistLinePath = maxDistPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const avgDistLinePath = avgDistPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const yAxisSteps = 5;
  const gridLines = Array.from({ length: yAxisSteps + 1 }, (_, i) => {
    const value = minDist + (i * (maxDist - minDist)) / yAxisSteps;
    const y = padding.top + innerHeight - (i / yAxisSteps) * innerHeight;
    return { y, value };
  });

  return (
    <View style={styles.chartContainer}>
      <View style={{ position: 'relative' }}>
        <Svg width={chartWidth} height={chartHeight}>
          {/* Grid lines */}
          {gridLines.map((line, i) => (
            <G key={i}>
              <Line x1={padding.left} y1={line.y} x2={padding.left + innerWidth} y2={line.y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
              <SvgText x={padding.left - 5} y={line.y + 4} textAnchor="end" fontSize="10" fill={COLORS.gray500}>{Math.round(line.value)}</SvgText>
            </G>
          ))}

          {/* Avg distance line (dashed) */}
          {avgDistPoints.length > 0 && (
            <Path d={avgDistLinePath} fill="none" stroke={COLORS.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6,4" />
          )}

          {/* Max distance line */}
          <Path d={maxDistLinePath} fill="none" stroke={COLORS.secondary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Avg distance points */}
          {avgDistPoints.map((point, i) => (
            <Circle
              key={`avg-dist-${i}`}
              cx={point.x}
              cy={point.y}
              r={selectedPoint?.x === point.x && selectedPoint?.type === 'avg' ? 6 : 4}
              fill={COLORS.primary}
              stroke={COLORS.black}
              strokeWidth="1.5"
            />
          ))}

          {/* Max distance points */}
          {maxDistPoints.map((point, i) => (
            <Circle
              key={`max-dist-${i}`}
              cx={point.x}
              cy={point.y}
              r={selectedPoint?.x === point.x && selectedPoint?.type === 'max' ? 7 : 5}
              fill={COLORS.secondary}
              stroke={COLORS.black}
              strokeWidth="2"
            />
          ))}
        </Svg>

        {/* Touch targets */}
        {maxDistPoints.map((point, i) => (
          <TouchableOpacity
            key={`max-dist-touch-${i}`}
            style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
            onPress={() => setSelectedPoint(selectedPoint?.x === point.x && selectedPoint?.type === 'max' ? null : { ...point, type: 'max' })}
          />
        ))}
        {avgDistPoints.map((point, i) => (
          <TouchableOpacity
            key={`avg-dist-touch-${i}`}
            style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
            onPress={() => setSelectedPoint(selectedPoint?.x === point.x && selectedPoint?.type === 'avg' ? null : { ...point, type: 'avg' })}
          />
        ))}

        {/* Tooltip */}
        {selectedPoint && (
          <Tooltip
            x={selectedPoint.x}
            y={selectedPoint.y}
            value={`${selectedPoint.value.toFixed(0)} ft`}
            label={selectedPoint.type === 'avg' ? 'Avg Distance' : 'Max Distance'}
            date={new Date(selectedPoint.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            color={selectedPoint.type === 'avg' ? COLORS.primary : COLORS.secondary}
          />
        )}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.secondary }]} />
          <Text style={styles.legendText}>Max Distance</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLineDashed, { backgroundColor: COLORS.primary }]} />
          <Text style={styles.legendText}>Avg Distance</Text>
        </View>
      </View>
    </View>
  );
}

// Exit Velocity Heatmap Component (Spray Chart)
function ExitVeloHeatmap({ swings, playingLevel }: { swings: HitTraxSwing[]; playingLevel: string }) {
  const svgWidth = SCREEN_WIDTH - 32;
  const svgHeight = svgWidth * 0.8;
  const viewBox = "20 100 360 280";

  const evThresholds = (() => {
    switch (playingLevel) {
      case 'youth':
        return { hot: 80, warm: 72, cool: 64, cold: 55 };
      case 'high-school':
        return { hot: 98, warm: 90, cool: 82, cold: 70 };
      case 'college':
        return { hot: 105, warm: 98, cool: 90, cold: 80 };
      case 'professional':
        return { hot: 110, warm: 105, cool: 98, cold: 88 };
      default:
        return { hot: 98, warm: 90, cool: 82, cold: 70 };
    }
  })();

  const getHeatmapColor = (ev: number) => {
    if (ev >= evThresholds.hot) return '#dc2626';
    if (ev >= evThresholds.warm) return '#f97316';
    if (ev >= evThresholds.cool) return '#eab308';
    if (ev >= evThresholds.cold) return '#06b6d4';
    return '#3b82f6';
  };

  const swingPoints = swings.map(swing => {
    const scale = 0.6;
    const x = 200 + (swing.spray_chart_x * scale);
    const y = 370 - (swing.spray_chart_z * scale);
    return { x, y, ev: swing.exit_velocity };
  });

  return (
    <View style={styles.chartContainer}>
      <View style={styles.fieldContainer}>
        <Svg width={svgWidth} height={svgHeight} viewBox={viewBox}>
          <Rect width="400" height="400" fill="#000000" />

          {/* Foul lines */}
          <Line x1="200" y1="370" x2="60" y2="230" stroke={COLORS.gray600} strokeWidth="1.5" opacity="0.6" />
          <Line x1="200" y1="370" x2="340" y2="230" stroke={COLORS.gray600} strokeWidth="1.5" opacity="0.6" />

          {/* Outfield fence */}
          <Path d="M 60 230 Q 100 140 200 136 Q 300 140 340 230" fill="none" stroke={COLORS.gray500} strokeWidth="1.5" opacity="0.7" />

          {/* Infield arc */}
          <Path d="M 162 316 Q 200 292 238 316" fill="none" stroke={COLORS.gray500} strokeWidth="1.5" opacity="0.7" />

          {/* Heatmap circles - larger blurred circles */}
          {swingPoints.map((point, idx) => (
            <Circle
              key={`blur-${idx}`}
              cx={point.x}
              cy={point.y}
              r={18}
              fill={getHeatmapColor(point.ev)}
              opacity={0.35}
            />
          ))}

          {/* Swing points - smaller solid circles */}
          {swingPoints.map((point, idx) => (
            <Circle
              key={`point-${idx}`}
              cx={point.x}
              cy={point.y}
              r={6}
              fill={getHeatmapColor(point.ev)}
              opacity={0.8}
            />
          ))}
        </Svg>
      </View>

      {/* Legend */}
      <View style={styles.heatmapLegend}>
        <Text style={styles.heatmapLegendLabel}>Cold</Text>
        <View style={styles.heatmapGradient}>
          <LinearGradient colors={['#3b82f6', '#06b6d4', '#eab308', '#f97316', '#dc2626']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.gradientBar} />
        </View>
        <Text style={styles.heatmapLegendLabel}>Hot</Text>
      </View>
      <Text style={styles.heatmapLevelText}>{playingLevel.replace('-', ' ')} level thresholds</Text>
    </View>
  );
}

// Field Zones Component
function FieldZones({ swings }: { swings: HitTraxSwing[] }) {
  const svgWidth = SCREEN_WIDTH - 32;
  const svgHeight = svgWidth * 0.8;
  const viewBox = "20 100 360 280";

  const leftSwings = swings.filter(s => s.spray_chart_x < -50);
  const centerSwings = swings.filter(s => s.spray_chart_x >= -50 && s.spray_chart_x <= 50);
  const rightSwings = swings.filter(s => s.spray_chart_x > 50);

  const totalSwings = swings.length;

  const leftAvg = leftSwings.length > 0 ? leftSwings.reduce((sum, s) => sum + s.exit_velocity, 0) / leftSwings.length : 0;
  const leftPeak = leftSwings.length > 0 ? Math.max(...leftSwings.map(s => s.exit_velocity)) : 0;
  const leftPct = totalSwings > 0 ? (leftSwings.length / totalSwings) * 100 : 0;

  const centerAvg = centerSwings.length > 0 ? centerSwings.reduce((sum, s) => sum + s.exit_velocity, 0) / centerSwings.length : 0;
  const centerPeak = centerSwings.length > 0 ? Math.max(...centerSwings.map(s => s.exit_velocity)) : 0;
  const centerPct = totalSwings > 0 ? (centerSwings.length / totalSwings) * 100 : 0;

  const rightAvg = rightSwings.length > 0 ? rightSwings.reduce((sum, s) => sum + s.exit_velocity, 0) / rightSwings.length : 0;
  const rightPeak = rightSwings.length > 0 ? Math.max(...rightSwings.map(s => s.exit_velocity)) : 0;
  const rightPct = totalSwings > 0 ? (rightSwings.length / totalSwings) * 100 : 0;

  return (
    <View style={styles.chartContainer}>
      <View style={styles.fieldContainer}>
        <Svg width={svgWidth} height={svgHeight} viewBox={viewBox}>
          <Rect width="400" height="400" fill="#000000" />

          {/* Foul lines */}
          <Line x1="200" y1="370" x2="60" y2="230" stroke={COLORS.gray600} strokeWidth="1.5" opacity="0.6" />
          <Line x1="200" y1="370" x2="340" y2="230" stroke={COLORS.gray600} strokeWidth="1.5" opacity="0.6" />

          {/* Outfield fence */}
          <Path d="M 60 230 Q 100 140 200 136 Q 300 140 340 230" fill="none" stroke={COLORS.gray500} strokeWidth="1.5" opacity="0.7" />

          {/* Infield arc */}
          <Path d="M 162 316 Q 200 292 238 316" fill="none" stroke={COLORS.gray500} strokeWidth="1.5" opacity="0.7" />

          {/* Zone dividing lines */}
          <Line x1="200" y1="370" x2="140" y2="180" stroke={COLORS.primary} strokeWidth="2" strokeDasharray="6,4" opacity="0.8" />
          <Line x1="200" y1="370" x2="260" y2="180" stroke={COLORS.primary} strokeWidth="2" strokeDasharray="6,4" opacity="0.8" />

          {/* Left Field */}
          <SvgText x="100" y="190" textAnchor="middle" fontSize="12" fill={COLORS.white} fontWeight="bold">LEFT</SvgText>
          <SvgText x="100" y="207" textAnchor="middle" fontSize="10" fill={COLORS.gray400}>Avg:</SvgText>
          <SvgText x="100" y="224" textAnchor="middle" fontSize="18" fill={COLORS.primary} fontWeight="bold">{leftAvg > 0 ? leftAvg.toFixed(1) : '--'}</SvgText>
          <SvgText x="100" y="241" textAnchor="middle" fontSize="10" fill={COLORS.gray400}>Peak:</SvgText>
          <SvgText x="100" y="258" textAnchor="middle" fontSize="14" fill={COLORS.secondary} fontWeight="bold">{leftPeak > 0 ? leftPeak.toFixed(1) : '--'}</SvgText>
          <SvgText x="100" y="273" textAnchor="middle" fontSize="11" fill={COLORS.primaryDark} fontWeight="semibold">{leftPct > 0 ? leftPct.toFixed(0) + '%' : '--'}</SvgText>

          {/* Center Field */}
          <SvgText x="200" y="155" textAnchor="middle" fontSize="12" fill={COLORS.white} fontWeight="bold">CENTER</SvgText>
          <SvgText x="200" y="172" textAnchor="middle" fontSize="10" fill={COLORS.gray400}>Avg:</SvgText>
          <SvgText x="200" y="189" textAnchor="middle" fontSize="18" fill={COLORS.primary} fontWeight="bold">{centerAvg > 0 ? centerAvg.toFixed(1) : '--'}</SvgText>
          <SvgText x="200" y="206" textAnchor="middle" fontSize="10" fill={COLORS.gray400}>Peak:</SvgText>
          <SvgText x="200" y="223" textAnchor="middle" fontSize="14" fill={COLORS.secondary} fontWeight="bold">{centerPeak > 0 ? centerPeak.toFixed(1) : '--'}</SvgText>
          <SvgText x="200" y="238" textAnchor="middle" fontSize="11" fill={COLORS.primaryDark} fontWeight="semibold">{centerPct > 0 ? centerPct.toFixed(0) + '%' : '--'}</SvgText>

          {/* Right Field */}
          <SvgText x="300" y="190" textAnchor="middle" fontSize="12" fill={COLORS.white} fontWeight="bold">RIGHT</SvgText>
          <SvgText x="300" y="207" textAnchor="middle" fontSize="10" fill={COLORS.gray400}>Avg:</SvgText>
          <SvgText x="300" y="224" textAnchor="middle" fontSize="18" fill={COLORS.primary} fontWeight="bold">{rightAvg > 0 ? rightAvg.toFixed(1) : '--'}</SvgText>
          <SvgText x="300" y="241" textAnchor="middle" fontSize="10" fill={COLORS.gray400}>Peak:</SvgText>
          <SvgText x="300" y="258" textAnchor="middle" fontSize="14" fill={COLORS.secondary} fontWeight="bold">{rightPeak > 0 ? rightPeak.toFixed(1) : '--'}</SvgText>
          <SvgText x="300" y="273" textAnchor="middle" fontSize="11" fill={COLORS.primaryDark} fontWeight="semibold">{rightPct > 0 ? rightPct.toFixed(0) + '%' : '--'}</SvgText>

          {/* Home plate */}
          <Polygon points="200,370 195,365 200,360 205,365" fill={COLORS.primary} opacity="0.8" />
        </Svg>
      </View>

      {/* Directional Tendency */}
      <View style={styles.tendencyContainer}>
        <View style={styles.tendencyHeader}>
          <Text style={styles.tendencyLabel}>Pull Side</Text>
          <Text style={styles.tendencyLabelCenter}>Directional Tendency</Text>
          <Text style={styles.tendencyLabel}>Opposite Field</Text>
        </View>
        <View style={styles.tendencyBar}>
          <View style={styles.tendencyCenterMark} />
          {(() => {
            const meanX = swings.length > 0
              ? swings.reduce((sum, s) => sum + s.spray_chart_x, 0) / swings.length
              : 0;
            const normalizedPosition = ((meanX / 200) * 50) + 50;
            const clampedPosition = Math.max(0, Math.min(100, normalizedPosition));

            return (
              <View
                style={[
                  styles.tendencyIndicator,
                  {
                    left: `${clampedPosition}%`,
                    backgroundColor: clampedPosition < 40 ? '#f59e0b' : clampedPosition > 60 ? '#8b5cf6' : COLORS.primary,
                  }
                ]}
              />
            );
          })()}
        </View>
      </View>
    </View>
  );
}

// Strike Zone Heatmap Component
function StrikeZoneHeatmap({ swings, playingLevel }: { swings: HitTraxSwing[]; playingLevel: string }) {
  const svgWidth = SCREEN_WIDTH - 32;
  const svgHeight = svgWidth * 1.25;

  // EV thresholds based on playing level
  const evThresholds = (() => {
    switch (playingLevel) {
      case 'youth':
        return { hot: 80, warm: 72, cool: 64, cold: 55 };
      case 'high-school':
        return { hot: 98, warm: 90, cool: 82, cold: 70 };
      case 'college':
        return { hot: 105, warm: 98, cool: 90, cold: 80 };
      case 'professional':
        return { hot: 110, warm: 105, cool: 98, cold: 88 };
      default:
        return { hot: 98, warm: 90, cool: 82, cold: 70 };
    }
  })();

  // Filter swings with valid POI data
  const validSwings = swings.filter(s =>
    s.poi_x !== null &&
    s.poi_y !== null &&
    s.poi_y > 5 &&
    s.exit_velocity > 0
  );

  if (validSwings.length === 0) {
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.emptyChartText}>No pitch location data available</Text>
      </View>
    );
  }

  // Calculate bounds
  const allY = validSwings.map(s => s.poi_y!);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const allX = validSwings.map(s => s.poi_x!);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);

  // SVG dimensions for strike zone
  const viewBoxWidth = 400;
  const viewBoxHeight = 500;
  const zoneWidth = 280;
  const zoneHeight = 360;
  const zoneX = (viewBoxWidth - zoneWidth) / 2;
  const zoneY = (viewBoxHeight - zoneHeight) / 2 - 20;

  // 12x12 grid for heatmap
  const gridCols = 12;
  const gridRows = 12;
  const cellWidth = zoneWidth / gridCols;
  const cellHeight = zoneHeight / gridRows;

  const gridCells: Array<{ row: number; col: number; swings: typeof validSwings; avgEV: number }> = [];

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const swingsInCell = validSwings.filter(s => {
        let normalizedX = (s.poi_x! - minX) / (maxX - minX);
        let normalizedY = (s.poi_y! - minY) / (maxY - minY);
        normalizedX = 1 - normalizedX; // Catcher's view

        const colStart = col / gridCols;
        const colEnd = (col + 1) / gridCols;
        const rowStart = row / gridRows;
        const rowEnd = (row + 1) / gridRows;

        return normalizedX >= colStart && normalizedX < colEnd &&
               normalizedY >= rowStart && normalizedY < rowEnd;
      });

      if (swingsInCell.length > 0) {
        const avgEV = swingsInCell.reduce((sum, s) => sum + s.exit_velocity, 0) / swingsInCell.length;
        gridCells.push({ row, col, swings: swingsInCell, avgEV });
      }
    }
  }

  // Calculate 3x3 zone stats
  const zoneStats: Array<{ zoneRow: number; zoneCol: number; avgEV: number; count: number }> = [];
  for (let zoneRow = 0; zoneRow < 3; zoneRow++) {
    for (let zoneCol = 0; zoneCol < 3; zoneCol++) {
      const swingsInZone = validSwings.filter(s => {
        let normalizedX = (s.poi_x! - minX) / (maxX - minX);
        let normalizedY = (s.poi_y! - minY) / (maxY - minY);
        normalizedX = 1 - normalizedX;

        const colStart = zoneCol / 3;
        const colEnd = (zoneCol + 1) / 3;
        const rowStart = zoneRow / 3;
        const rowEnd = (zoneRow + 1) / 3;

        return normalizedX >= colStart && normalizedX < colEnd &&
               normalizedY >= rowStart && normalizedY < rowEnd;
      });

      if (swingsInZone.length > 0) {
        const avgEV = swingsInZone.reduce((sum, s) => sum + s.exit_velocity, 0) / swingsInZone.length;
        zoneStats.push({ zoneRow, zoneCol, avgEV, count: swingsInZone.length });
      }
    }
  }

  const getHeatmapColor = (avgEV: number) => {
    if (avgEV >= evThresholds.hot) return '#dc2626';
    if (avgEV >= evThresholds.warm) return '#f97316';
    if (avgEV >= evThresholds.cool) return '#eab308';
    if (avgEV >= evThresholds.cold) return '#06b6d4';
    return '#3b82f6';
  };

  return (
    <View style={styles.chartContainer}>
      <View style={styles.strikeZoneContainer}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}>
          <Rect width={viewBoxWidth} height={viewBoxHeight} fill="#000000" rx="8" />

          {/* Strike zone outline */}
          <Rect x={zoneX} y={zoneY} width={zoneWidth} height={zoneHeight} fill="none" stroke="#10b981" strokeWidth="2" opacity={0.6} />

          {/* Heatmap cells - blended rectangles for smooth heat effect */}
          {gridCells.map((cell, idx) => {
            const cellX = zoneX + (cell.col * cellWidth);
            const svgRow = (gridRows - 1) - cell.row;
            const cellY = zoneY + (svgRow * cellHeight);
            const color = getHeatmapColor(cell.avgEV);
            // Opacity based on swing count for intensity
            const baseOpacity = Math.min(0.5 + (cell.swings.length / 8) * 0.4, 0.9);

            return (
              <G key={idx}>
                {/* Outer glow - larger, more transparent */}
                <Rect
                  x={cellX - cellWidth * 0.3}
                  y={cellY - cellHeight * 0.3}
                  width={cellWidth * 1.6}
                  height={cellHeight * 1.6}
                  fill={color}
                  opacity={baseOpacity * 0.3}
                  rx="4"
                />
                {/* Main cell */}
                <Rect
                  x={cellX}
                  y={cellY}
                  width={cellWidth}
                  height={cellHeight}
                  fill={color}
                  opacity={baseOpacity}
                />
              </G>
            );
          })}

          {/* Strike zone outline (on top) */}
          <Rect x={zoneX} y={zoneY} width={zoneWidth} height={zoneHeight} fill="none" stroke="#10b981" strokeWidth="2" opacity={0.8} />

          {/* 3x3 Grid lines */}
          <Line x1={zoneX + zoneWidth / 3} y1={zoneY} x2={zoneX + zoneWidth / 3} y2={zoneY + zoneHeight} stroke="#10b981" strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />
          <Line x1={zoneX + (2 * zoneWidth) / 3} y1={zoneY} x2={zoneX + (2 * zoneWidth) / 3} y2={zoneY + zoneHeight} stroke="#10b981" strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />
          <Line x1={zoneX} y1={zoneY + zoneHeight / 3} x2={zoneX + zoneWidth} y2={zoneY + zoneHeight / 3} stroke="#10b981" strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />
          <Line x1={zoneX} y1={zoneY + (2 * zoneHeight) / 3} x2={zoneX + zoneWidth} y2={zoneY + (2 * zoneHeight) / 3} stroke="#10b981" strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />

          {/* Zone labels */}
          <SvgText x={zoneX - 8} y={zoneY + zoneHeight / 6 + 4} textAnchor="end" fontSize="10" fill={COLORS.gray500}>High</SvgText>
          <SvgText x={zoneX - 8} y={zoneY + zoneHeight / 2 + 4} textAnchor="end" fontSize="10" fill={COLORS.gray500}>Mid</SvgText>
          <SvgText x={zoneX - 8} y={zoneY + (5 * zoneHeight) / 6 + 4} textAnchor="end" fontSize="10" fill={COLORS.gray500}>Low</SvgText>

          {/* Zone statistics */}
          {zoneStats.map((stat, idx) => {
            const svgRow = 2 - stat.zoneRow;
            const centerX = zoneX + (stat.zoneCol * zoneWidth / 3) + (zoneWidth / 6);
            const centerY = zoneY + (svgRow * zoneHeight / 3) + (zoneHeight / 6);

            return (
              <G key={`stat-${idx}`}>
                <Rect x={centerX - 35} y={centerY - 22} width={70} height={44} fill="#000000" opacity={0.8} rx="6" />
                <SvgText x={centerX} y={centerY - 3} textAnchor="middle" fontSize="18" fill={COLORS.white} fontWeight="bold">{stat.avgEV.toFixed(1)}</SvgText>
                <SvgText x={centerX} y={centerY + 16} textAnchor="middle" fontSize="10" fill={COLORS.gray400}>{stat.count} swing{stat.count !== 1 ? 's' : ''}</SvgText>
              </G>
            );
          })}

          {/* Catcher's view label */}
          <SvgText x={viewBoxWidth / 2} y={viewBoxHeight - 20} textAnchor="middle" fontSize="10" fill={COLORS.gray500}>Catcher's View</SvgText>
        </Svg>
      </View>

      {/* Legend */}
      <View style={styles.heatmapLegend}>
        <Text style={styles.heatmapLegendLabel}>Cold</Text>
        <View style={styles.heatmapGradient}>
          <LinearGradient colors={['#3b82f6', '#06b6d4', '#eab308', '#f97316', '#dc2626']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.gradientBar} />
        </View>
        <Text style={styles.heatmapLegendLabel}>Hot</Text>
      </View>
      <Text style={styles.heatmapLevelText}>{playingLevel.replace('-', ' ')} level thresholds</Text>
    </View>
  );
}

// Launch Angle Strike Zone Component
function LaunchAngleStrikeZone({ swings }: { swings: HitTraxSwing[] }) {
  const svgWidth = SCREEN_WIDTH - 32;
  const svgHeight = svgWidth * 1.25;

  // Filter swings with valid POI data and launch angle
  const validSwings = swings.filter(s =>
    s.poi_x !== null &&
    s.poi_y !== null &&
    s.poi_y > 5 &&
    s.launch_angle !== null
  );

  if (validSwings.length === 0) {
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.emptyChartText}>No launch angle data available</Text>
      </View>
    );
  }

  // Calculate bounds
  const poiXValues = validSwings.map(s => s.poi_x!);
  const poiYValues = validSwings.map(s => s.poi_y!);
  const minX = Math.min(...poiXValues);
  const maxX = Math.max(...poiXValues);
  const minY = Math.min(...poiYValues);
  const maxY = Math.max(...poiYValues);

  // SVG dimensions
  const viewBoxWidth = 400;
  const viewBoxHeight = 500;
  const zoneWidth = 280;
  const zoneHeight = 360;
  const zoneX = (viewBoxWidth - zoneWidth) / 2;
  const zoneY = (viewBoxHeight - zoneHeight) / 2 - 20;

  // Calculate 3x3 zone stats
  const zoneStats: Array<{ zoneRow: number; zoneCol: number; avgLA: number; count: number }> = [];
  for (let zoneRow = 0; zoneRow < 3; zoneRow++) {
    for (let zoneCol = 0; zoneCol < 3; zoneCol++) {
      const swingsInZone = validSwings.filter(s => {
        let normalizedX = (s.poi_x! - minX) / (maxX - minX);
        let normalizedY = (s.poi_y! - minY) / (maxY - minY);
        normalizedX = 1 - normalizedX; // Catcher's view

        const colStart = zoneCol / 3;
        const colEnd = (zoneCol + 1) / 3;
        const rowStart = zoneRow / 3;
        const rowEnd = (zoneRow + 1) / 3;

        return normalizedX >= colStart && normalizedX < colEnd &&
               normalizedY >= rowStart && normalizedY < rowEnd;
      });

      if (swingsInZone.length > 0) {
        const avgLA = swingsInZone.reduce((sum, s) => sum + s.launch_angle!, 0) / swingsInZone.length;
        zoneStats.push({ zoneRow, zoneCol, avgLA, count: swingsInZone.length });
      }
    }
  }

  return (
    <View style={styles.chartContainer}>
      <View style={styles.strikeZoneContainer}>
        <Svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}>
          <Rect width={viewBoxWidth} height={viewBoxHeight} fill="#000000" rx="8" />

          {/* Strike zone outline */}
          <Rect x={zoneX} y={zoneY} width={zoneWidth} height={zoneHeight} fill="none" stroke="#8b5cf6" strokeWidth="2" opacity={0.6} />

          {/* 3x3 Grid lines */}
          <Line x1={zoneX + zoneWidth / 3} y1={zoneY} x2={zoneX + zoneWidth / 3} y2={zoneY + zoneHeight} stroke="#8b5cf6" strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />
          <Line x1={zoneX + (2 * zoneWidth) / 3} y1={zoneY} x2={zoneX + (2 * zoneWidth) / 3} y2={zoneY + zoneHeight} stroke="#8b5cf6" strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />
          <Line x1={zoneX} y1={zoneY + zoneHeight / 3} x2={zoneX + zoneWidth} y2={zoneY + zoneHeight / 3} stroke="#8b5cf6" strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />
          <Line x1={zoneX} y1={zoneY + (2 * zoneHeight) / 3} x2={zoneX + zoneWidth} y2={zoneY + (2 * zoneHeight) / 3} stroke="#8b5cf6" strokeWidth="1" opacity={0.4} strokeDasharray="4,4" />

          {/* Zone labels */}
          <SvgText x={zoneX - 8} y={zoneY + zoneHeight / 6 + 4} textAnchor="end" fontSize="10" fill={COLORS.gray500}>High</SvgText>
          <SvgText x={zoneX - 8} y={zoneY + zoneHeight / 2 + 4} textAnchor="end" fontSize="10" fill={COLORS.gray500}>Mid</SvgText>
          <SvgText x={zoneX - 8} y={zoneY + (5 * zoneHeight) / 6 + 4} textAnchor="end" fontSize="10" fill={COLORS.gray500}>Low</SvgText>

          {/* Zone statistics */}
          {zoneStats.map((stat, idx) => {
            const svgRow = 2 - stat.zoneRow;
            const centerX = zoneX + (stat.zoneCol * zoneWidth / 3) + (zoneWidth / 6);
            const centerY = zoneY + (svgRow * zoneHeight / 3) + (zoneHeight / 6);

            return (
              <G key={idx}>
                <Rect x={centerX - 35} y={centerY - 22} width={70} height={44} fill="#000000" opacity={0.8} rx="6" />
                <SvgText x={centerX} y={centerY - 3} textAnchor="middle" fontSize="18" fill="#a78bfa" fontWeight="bold">{stat.avgLA.toFixed(1)}°</SvgText>
                <SvgText x={centerX} y={centerY + 16} textAnchor="middle" fontSize="10" fill={COLORS.gray400}>{stat.count} swing{stat.count !== 1 ? 's' : ''}</SvgText>
              </G>
            );
          })}

          {/* Catcher's view label */}
          <SvgText x={viewBoxWidth / 2} y={viewBoxHeight - 20} textAnchor="middle" fontSize="10" fill={COLORS.gray500}>Catcher's View</SvgText>
        </Svg>
      </View>

      {/* Info text */}
      <Text style={styles.strikeZoneInfoText}>Ideal launch angle: 10-30° for line drives</Text>
    </View>
  );
}

// Tooltip Component
function Tooltip({ x, y, value, label, date, color }: { x: number; y: number; value: string; label: string; date: string; color: string }) {
  const tooltipWidth = 90;
  let adjustedX = x - tooltipWidth / 2;
  if (adjustedX < 5) adjustedX = 5;
  if (adjustedX > SCREEN_WIDTH - 32 - tooltipWidth - 5) adjustedX = SCREEN_WIDTH - 32 - tooltipWidth - 5;

  return (
    <View style={[styles.tooltip, { left: adjustedX, top: Math.max(5, y - 70) }]}>
      <Text style={[styles.tooltipValue, { color }]}>{value}</Text>
      <Text style={styles.tooltipLabel}>{label}</Text>
      <Text style={styles.tooltipDate}>{date}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.black,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    paddingTop: 8,
    marginBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backText: {
    color: COLORS.gray400,
    fontSize: 14,
    marginLeft: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.gray400,
  },
  filterContainer: {
    marginBottom: 20,
  },
  filterContent: {
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterButtonActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.15)',
    borderColor: 'rgba(155, 221, 255, 0.3)',
  },
  filterButtonText: {
    color: COLORS.gray400,
    fontSize: 14,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: COLORS.primary,
  },
  emptyState: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    color: COLORS.gray400,
    fontSize: 16,
  },
  emptySubtext: {
    color: COLORS.gray500,
    fontSize: 14,
    marginTop: 8,
  },
  prSection: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.gray500,
    marginBottom: 12,
  },
  prRow: {
    flexDirection: 'row',
  },
  prItem: {
    flex: 1,
    alignItems: 'center',
  },
  prItemBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  prValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  prValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  prValueGold: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.secondary,
  },
  prLabel: {
    fontSize: 9,
    color: COLORS.gray500,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 2,
  },
  prUnit: {
    fontSize: 12,
    color: COLORS.gray400,
  },
  singleStatRow: {
    alignItems: 'center',
  },
  statDescription: {
    fontSize: 12,
    color: COLORS.gray500,
    marginTop: 4,
  },
  chartContainer: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginBottom: 16,
  },
  emptyChartText: {
    color: COLORS.gray500,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 40,
  },
  touchTarget: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    gap: 20,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendLine: {
    width: 20,
    height: 3,
    borderRadius: 2,
    marginRight: 6,
  },
  legendLineDashed: {
    width: 20,
    height: 3,
    borderRadius: 2,
    marginRight: 6,
  },
  legendBox: {
    width: 16,
    height: 10,
    borderRadius: 2,
    marginRight: 6,
    borderWidth: 1,
  },
  legendText: {
    fontSize: 11,
    color: COLORS.gray400,
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: 'rgba(31,41,55,0.95)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    minWidth: 80,
    alignItems: 'center',
  },
  tooltipValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  tooltipLabel: {
    fontSize: 10,
    color: COLORS.gray400,
    marginTop: 2,
  },
  tooltipDate: {
    fontSize: 9,
    color: COLORS.gray500,
    marginTop: 1,
  },
  fieldToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  fieldToggleButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  fieldToggleButtonActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.15)',
  },
  fieldToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.gray400,
  },
  fieldToggleTextActive: {
    color: COLORS.primary,
  },
  fieldContainer: {
    alignItems: 'center',
  },
  heatmapLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 8,
  },
  heatmapLegendLabel: {
    fontSize: 10,
    color: COLORS.gray500,
  },
  heatmapGradient: {
    flex: 1,
    marginHorizontal: 8,
  },
  gradientBar: {
    height: 8,
    borderRadius: 4,
  },
  heatmapLevelText: {
    fontSize: 9,
    color: COLORS.gray500,
    textAlign: 'center',
    marginTop: 4,
    textTransform: 'capitalize',
  },
  tendencyContainer: {
    marginTop: 16,
    paddingHorizontal: 8,
  },
  tendencyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tendencyLabel: {
    fontSize: 9,
    color: COLORS.gray500,
  },
  tendencyLabelCenter: {
    fontSize: 10,
    color: COLORS.gray400,
    fontWeight: '600',
  },
  tendencyBar: {
    height: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 6,
    position: 'relative',
  },
  tendencyCenterMark: {
    position: 'absolute',
    left: '50%',
    top: 0,
    width: 2,
    height: 12,
    backgroundColor: COLORS.gray600,
    marginLeft: -1,
  },
  tendencyIndicator: {
    position: 'absolute',
    top: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
  },
  tableContainer: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  tableHeaderCell: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.gray400,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  tableRowAlt: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  tableCell: {
    fontSize: 12,
    color: COLORS.white,
  },
  strikeZoneContainer: {
    alignItems: 'center',
  },
  strikeZoneInfoText: {
    fontSize: 10,
    color: COLORS.gray500,
    textAlign: 'center',
    marginTop: 12,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
