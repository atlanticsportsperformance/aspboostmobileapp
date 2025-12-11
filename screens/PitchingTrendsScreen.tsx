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
} from 'react-native-svg';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Professional color palette matching HittingTrendsScreen exactly
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
  chartPrimary: '#9BDDFF',
  chartSecondary: '#7BC5F0',
  chartAccent: '#B0E5FF',
};

// Pitch type colors for chart lines
const PITCH_TYPE_COLORS: Record<string, string> = {
  'Fastball': '#EF4444',
  'Four-Seam': '#EF4444',
  'FourSeamFastBall': '#EF4444',
  'Two-Seam': '#F97316',
  'Sinker': '#F97316',
  'Cutter': '#EC4899',
  'Slider': '#8B5CF6',
  'Curveball': '#3B82F6',
  'Curve': '#3B82F6',
  'Changeup': '#10B981',
  'ChangeUp': '#10B981',
  'Change': '#10B981',
  'Splitter': '#14B8A6',
  'Knuckleball': '#6B7280',
  'Other': '#9CA3AF',
};

interface SessionData {
  date: string;
  sessionId: number;
  pitchTypes: Record<string, { maxVelo: number; avgVelo: number; count: number }>;
}

type TimeFilter = '1month' | '3months' | '6months' | 'all';

export default function PitchingTrendsScreen({ navigation, route }: any) {
  const [allSessionData, setAllSessionData] = useState<SessionData[]>([]);
  const [filteredData, setFilteredData] = useState<SessionData[]>([]);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('3months');
  const [loading, setLoading] = useState(true);
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);

  useEffect(() => {
    loadAthleteAndData();
  }, []);

  useEffect(() => {
    applyTimeFilter();
  }, [timeFilter, allSessionData]);

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
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (!athlete) {
          setLoading(false);
          return;
        }
        currentAthleteId = athlete.id;
        setAthleteId(athlete.id);
      }

      await fetchTrendsData(currentAthleteId!);
    } catch (error) {
      console.error('Error loading athlete:', error);
      setLoading(false);
    }
  }

  function applyTimeFilter() {
    if (allSessionData.length === 0) {
      setFilteredData([]);
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
        return;
    }

    const filtered = allSessionData.filter(session =>
      new Date(session.date) >= cutoffDate
    );
    setFilteredData(filtered);
  }

  async function fetchTrendsData(id: string) {
    setLoading(true);

    try {
      // First get all unique session IDs for this athlete
      const { data: pitchSessionIds } = await supabase
        .from('trackman_pitch_data')
        .select('session_id')
        .eq('athlete_id', id);

      if (!pitchSessionIds || pitchSessionIds.length === 0) {
        setLoading(false);
        return;
      }

      const uniqueSessionIds = [...new Set(pitchSessionIds.map(p => p.session_id))];

      // Get session info with dates
      const { data: sessions } = await supabase
        .from('trackman_session')
        .select('id, game_date_utc')
        .in('id', uniqueSessionIds)
        .order('game_date_utc', { ascending: true });

      if (!sessions || sessions.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch all pitches for this athlete
      const { data: pitches, error } = await supabase
        .from('trackman_pitch_data')
        .select('session_id, rel_speed, tagged_pitch_type')
        .eq('athlete_id', id)
        .not('rel_speed', 'is', null);

      if (error) {
        console.error('Error fetching pitches:', error);
        setLoading(false);
        return;
      }

      if (!pitches || pitches.length === 0) {
        setLoading(false);
        return;
      }

      // Create a map of session_id -> date
      const sessionDateMap = new Map<number, string>();
      sessions.forEach(s => {
        if (s.game_date_utc) {
          sessionDateMap.set(s.id, s.game_date_utc);
        }
      });

      // Group pitches by session
      const sessionMap = new Map<number, Record<string, number[]>>();

      pitches.forEach(pitch => {
        if (!pitch.session_id || !pitch.rel_speed) return;

        const pitchType = normalizePitchType(pitch.tagged_pitch_type || 'Other');

        if (!sessionMap.has(pitch.session_id)) {
          sessionMap.set(pitch.session_id, {});
        }

        const sessionData = sessionMap.get(pitch.session_id)!;
        if (!sessionData[pitchType]) {
          sessionData[pitchType] = [];
        }

        sessionData[pitchType].push(pitch.rel_speed);
      });

      // Convert to session data array
      const sessionDataArray: SessionData[] = [];

      sessionMap.forEach((pitchTypes, sessionId) => {
        const date = sessionDateMap.get(sessionId);
        if (!date) return;

        const pitchTypeData: Record<string, { maxVelo: number; avgVelo: number; count: number }> = {};

        Object.entries(pitchTypes).forEach(([type, velocities]) => {
          if (velocities.length === 0) return;
          const maxVelo = Math.max(...velocities);
          const avgVelo = velocities.reduce((a, b) => a + b, 0) / velocities.length;
          pitchTypeData[type] = {
            maxVelo: Math.round(maxVelo * 10) / 10,
            avgVelo: Math.round(avgVelo * 10) / 10,
            count: velocities.length,
          };
        });

        if (Object.keys(pitchTypeData).length > 0) {
          sessionDataArray.push({ date, sessionId, pitchTypes: pitchTypeData });
        }
      });

      // Sort by date
      sessionDataArray.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      setAllSessionData(sessionDataArray);
      setLoading(false);
    } catch (error) {
      console.error('Error in fetchTrendsData:', error);
      setLoading(false);
    }
  }

  function normalizePitchType(type: string): string {
    if (!type) return 'Other';
    const normalized = type.trim();
    const lower = normalized.toLowerCase();

    if (lower.includes('four') || lower === 'ff' || lower.includes('fastball')) return 'Fastball';
    if (lower.includes('two') || lower === 'ft' || lower.includes('sinker') || lower === 'si') return 'Sinker';
    if (lower === 'fc' || lower.includes('cutter')) return 'Cutter';
    if (lower === 'sl' || lower.includes('slider')) return 'Slider';
    if (lower === 'cu' || lower === 'cb' || lower.includes('curve')) return 'Curveball';
    if (lower === 'ch' || lower.includes('change')) return 'Changeup';
    if (lower === 'fs' || lower.includes('split')) return 'Splitter';

    return normalized || 'Other';
  }

  // Get all unique pitch types from filtered data
  const activePitchTypes = useMemo(() => {
    const types = new Set<string>();
    filteredData.forEach(session => {
      Object.keys(session.pitchTypes).forEach(type => types.add(type));
    });
    return Array.from(types).sort();
  }, [filteredData]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={20} color={COLORS.gray400} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Pitching Trends</Text>
          <Text style={styles.subtitle}>Velocity trends by pitch type over time</Text>
        </View>

        {/* Time Filter */}
        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
            {(['1month', '3months', '6months', 'all'] as TimeFilter[]).map((filter) => (
              <TouchableOpacity
                key={filter}
                style={[styles.filterButton, timeFilter === filter && styles.filterButtonActive]}
                onPress={() => setTimeFilter(filter)}
              >
                <Text style={[styles.filterButtonText, timeFilter === filter && styles.filterButtonTextActive]}>
                  {filter === '1month' ? '1 Month' :
                   filter === '3months' ? '3 Months' :
                   filter === '6months' ? '6 Months' : 'All Time'}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {filteredData.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="baseball-outline" size={48} color={COLORS.gray500} />
            <Text style={styles.emptyText}>No pitching data</Text>
            <Text style={styles.emptySubtext}>TrackMan data will appear here once available</Text>
          </View>
        ) : (
          <>
            {/* Max Velocity Chart */}
            <View style={styles.sectionTitle}>
              <Text style={styles.sectionTitleText}>Max Velocity by Pitch Type</Text>
            </View>
            <VelocityChart
              sessionData={filteredData}
              dataKey="maxVelo"
              activePitchTypes={activePitchTypes}
            />

            {/* Average Velocity Chart */}
            <View style={styles.sectionTitle}>
              <Text style={styles.sectionTitleText}>Average Velocity by Pitch Type</Text>
            </View>
            <VelocityChart
              sessionData={filteredData}
              dataKey="avgVelo"
              activePitchTypes={activePitchTypes}
            />

            {/* Summary Stats */}
            <View style={styles.sectionTitle}>
              <Text style={styles.sectionTitleText}>Summary by Pitch Type</Text>
            </View>
            <View style={styles.statsContainer}>
              {activePitchTypes.map(type => {
                let totalCount = 0;
                let maxVelo = 0;
                let totalVelo = 0;
                let veloCount = 0;

                filteredData.forEach(session => {
                  const typeData = session.pitchTypes[type];
                  if (typeData) {
                    totalCount += typeData.count;
                    if (typeData.maxVelo > maxVelo) maxVelo = typeData.maxVelo;
                    totalVelo += typeData.avgVelo * typeData.count;
                    veloCount += typeData.count;
                  }
                });

                const avgVelo = veloCount > 0 ? totalVelo / veloCount : 0;
                const color = PITCH_TYPE_COLORS[type] || COLORS.primary;

                return (
                  <View key={type} style={styles.statCard}>
                    <View style={styles.statCardHeader}>
                      <View style={[styles.statCardDot, { backgroundColor: color }]} />
                      <Text style={styles.statCardTitle}>{type}</Text>
                    </View>
                    <View style={styles.statCardBody}>
                      <View style={styles.statItem}>
                        <Text style={[styles.statValue, { color }]}>{maxVelo.toFixed(1)}</Text>
                        <Text style={styles.statLabel}>Max MPH</Text>
                      </View>
                      <View style={styles.statItem}>
                        <Text style={styles.statValueSecondary}>{avgVelo.toFixed(1)}</Text>
                        <Text style={styles.statLabel}>Avg MPH</Text>
                      </View>
                      <View style={styles.statItem}>
                        <Text style={styles.statValueSecondary}>{totalCount}</Text>
                        <Text style={styles.statLabel}>Pitches</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating Back Button */}
      <TouchableOpacity style={styles.fab} onPress={() => navigation.goBack()}>
        <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.fabGradient}>
          <Ionicons name="chevron-back" size={24} color={COLORS.black} />
        </LinearGradient>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// Velocity Chart Component
function VelocityChart({
  sessionData,
  dataKey,
  activePitchTypes,
}: {
  sessionData: SessionData[];
  dataKey: 'maxVelo' | 'avgVelo';
  activePitchTypes: string[];
}) {
  const [selectedPoint, setSelectedPoint] = useState<{
    x: number;
    y: number;
    value: number;
    type: string;
    date: string;
  } | null>(null);

  if (sessionData.length === 0) return null;

  const chartWidth = SCREEN_WIDTH - 32;
  const chartHeight = 264;
  const padding = { top: 20, right: 35, bottom: 35, left: 40 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Calculate min/max velocities across all pitch types
  let minVelo = Infinity;
  let maxVelo = -Infinity;

  sessionData.forEach(session => {
    Object.values(session.pitchTypes).forEach(data => {
      const value = data[dataKey];
      if (value < minVelo) minVelo = value;
      if (value > maxVelo) maxVelo = value;
    });
  });

  // Add padding to range
  const range = maxVelo - minVelo;
  minVelo = Math.floor(minVelo - range * 0.1);
  maxVelo = Math.ceil(maxVelo + range * 0.1);

  if (maxVelo - minVelo < 10) {
    const mid = (maxVelo + minVelo) / 2;
    minVelo = mid - 5;
    maxVelo = mid + 5;
  }

  const yAxisSteps = 4;
  const gridLines = Array.from({ length: yAxisSteps + 1 }, (_, i) => {
    const value = minVelo + (i * (maxVelo - minVelo)) / yAxisSteps;
    const y = padding.top + innerHeight - (i / yAxisSteps) * innerHeight;
    return { y, value };
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Generate paths for each pitch type
  const pitchTypePaths: { type: string; path: string; points: { x: number; y: number; value: number; date: string }[]; color: string }[] = [];

  activePitchTypes.forEach(pitchType => {
    const points: { x: number; y: number; value: number; date: string }[] = [];

    sessionData.forEach((session, index) => {
      const typeData = session.pitchTypes[pitchType];
      if (typeData) {
        const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
        const y = padding.top + innerHeight - ((typeData[dataKey] - minVelo) / (maxVelo - minVelo)) * innerHeight;
        points.push({ x, y, value: typeData[dataKey], date: session.date });
      }
    });

    if (points.length > 0) {
      const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      pitchTypePaths.push({
        type: pitchType,
        path,
        points,
        color: PITCH_TYPE_COLORS[pitchType] || COLORS.primary,
      });
    }
  });

  return (
    <View style={styles.chartContainer}>
      <Svg width={chartWidth} height={chartHeight}>
        <Defs>
          <SvgLinearGradient id="chartBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.05" />
            <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0.01" />
          </SvgLinearGradient>
        </Defs>

        {/* Background */}
        <Rect
          x={padding.left}
          y={padding.top}
          width={innerWidth}
          height={innerHeight}
          fill="rgba(0,0,0,0.3)"
          stroke={COLORS.gray700}
          strokeWidth={1}
          rx={4}
        />

        {/* Grid lines */}
        {gridLines.map((line, i) => (
          <G key={i}>
            <Line
              x1={padding.left}
              y1={line.y}
              x2={padding.left + innerWidth}
              y2={line.y}
              stroke={COLORS.gray700}
              strokeWidth={1}
              strokeDasharray="3,3"
              opacity={0.5}
            />
            <SvgText
              x={padding.left - 6}
              y={line.y + 4}
              textAnchor="end"
              fontSize={9}
              fill={COLORS.gray500}
            >
              {Math.round(line.value)}
            </SvgText>
          </G>
        ))}

        {/* Lines for each pitch type */}
        {pitchTypePaths.map(({ type, path, color }) => (
          <Path
            key={type}
            d={path}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Data points */}
        {pitchTypePaths.map(({ type, points, color }) =>
          points.map((point, i) => (
            <Circle
              key={`${type}-${i}`}
              cx={point.x}
              cy={point.y}
              r={selectedPoint?.x === point.x && selectedPoint?.type === type ? 6 : 4}
              fill={color}
              stroke={COLORS.white}
              strokeWidth={1.5}
            />
          ))
        )}

        {/* X axis label */}
        <SvgText
          x={chartWidth / 2}
          y={chartHeight - 6}
          textAnchor="middle"
          fontSize={10}
          fill={COLORS.gray500}
        >
          Sessions
        </SvgText>
      </Svg>

      {/* Touch targets */}
      {pitchTypePaths.map(({ type, points, color }) =>
        points.map((point, i) => (
          <TouchableOpacity
            key={`touch-${type}-${i}`}
            style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
            onPress={() =>
              setSelectedPoint(
                selectedPoint?.x === point.x && selectedPoint?.type === type
                  ? null
                  : { ...point, type }
              )
            }
          />
        ))
      )}

      {/* Tooltip */}
      {selectedPoint && (
        <View
          style={[
            styles.tooltip,
            {
              left: Math.max(10, Math.min(selectedPoint.x - 45, chartWidth - 100)),
              top: Math.max(5, selectedPoint.y - 60),
            },
          ]}
        >
          <Text style={[styles.tooltipValue, { color: PITCH_TYPE_COLORS[selectedPoint.type] || COLORS.primary }]}>
            {selectedPoint.value.toFixed(1)} mph
          </Text>
          <Text style={styles.tooltipLabel}>{selectedPoint.type}</Text>
          <Text style={styles.tooltipDate}>{formatDate(selectedPoint.date)}</Text>
        </View>
      )}

      {/* Legend */}
      <View style={styles.legend}>
        {activePitchTypes.map(type => (
          <View key={type} style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: PITCH_TYPE_COLORS[type] || COLORS.primary }]} />
            <Text style={styles.legendText}>{type}</Text>
          </View>
        ))}
      </View>
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
    marginTop: 16,
  },
  emptySubtext: {
    color: COLORS.gray500,
    fontSize: 14,
    marginTop: 8,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  sectionTitleText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  chartContainer: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginBottom: 16,
    position: 'relative',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendLine: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 10,
    color: COLORS.gray400,
  },
  touchTarget: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.9)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
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
    marginTop: 2,
  },
  statsContainer: {
    gap: 12,
  },
  statCard: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  statCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  statCardDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  statCardBody: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  statValueSecondary: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.white,
  },
  statLabel: {
    fontSize: 10,
    color: COLORS.gray500,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
