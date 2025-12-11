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

// Color palette matching the app theme
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
  'Fastball': '#EF4444',      // Red
  'Four-Seam': '#EF4444',     // Red
  'Two-Seam': '#F97316',      // Orange
  'Sinker': '#F97316',        // Orange
  'Cutter': '#EC4899',        // Pink
  'Slider': '#8B5CF6',        // Purple
  'Curveball': '#3B82F6',     // Blue
  'Curve': '#3B82F6',         // Blue
  'Changeup': '#10B981',      // Green
  'Change': '#10B981',        // Green
  'Splitter': '#14B8A6',      // Teal
  'Knuckleball': '#6B7280',   // Gray
  'Other': '#9CA3AF',         // Light Gray
};

const DEFAULT_LINE_COLOR = '#9BDDFF';

interface PitchData {
  date: string;
  pitchType: string;
  maxVelo: number;
  avgVelo: number;
  count: number;
}

interface SessionData {
  date: string;
  pitchTypes: Record<string, { maxVelo: number; avgVelo: number; count: number }>;
}

type TimeFilter = '1month' | '3months' | '6months' | 'all';

export default function PitchingTrendsScreen({ navigation, route }: any) {
  const [allSessionData, setAllSessionData] = useState<SessionData[]>([]);
  const [filteredData, setFilteredData] = useState<SessionData[]>([]);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('3months');
  const [loading, setLoading] = useState(true);
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);
  const [allPitchTypes, setAllPitchTypes] = useState<string[]>([]);

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

    // Fetch TrackMan pitches grouped by session date and pitch type
    const { data: pitches, error } = await supabase
      .from('trackman_pitches')
      .select('rel_speed, tagged_pitch_type, game_date_utc')
      .eq('athlete_id', id)
      .not('rel_speed', 'is', null)
      .order('game_date_utc', { ascending: true });

    if (!pitches || pitches.length === 0) {
      setLoading(false);
      return;
    }

    // Group by date and pitch type
    const sessionMap = new Map<string, Record<string, { velocities: number[]; count: number }>>();
    const pitchTypesSet = new Set<string>();

    pitches.forEach(pitch => {
      if (!pitch.game_date_utc || !pitch.rel_speed) return;

      const date = pitch.game_date_utc.split('T')[0];
      const pitchType = normalizePitchType(pitch.tagged_pitch_type || 'Other');
      pitchTypesSet.add(pitchType);

      if (!sessionMap.has(date)) {
        sessionMap.set(date, {});
      }

      const dateData = sessionMap.get(date)!;
      if (!dateData[pitchType]) {
        dateData[pitchType] = { velocities: [], count: 0 };
      }

      dateData[pitchType].velocities.push(pitch.rel_speed);
      dateData[pitchType].count++;
    });

    // Convert to session data array
    const sessions: SessionData[] = [];
    sessionMap.forEach((pitchTypes, date) => {
      const pitchTypeData: Record<string, { maxVelo: number; avgVelo: number; count: number }> = {};

      Object.entries(pitchTypes).forEach(([type, data]) => {
        const maxVelo = Math.max(...data.velocities);
        const avgVelo = data.velocities.reduce((a, b) => a + b, 0) / data.velocities.length;
        pitchTypeData[type] = {
          maxVelo: Math.round(maxVelo * 10) / 10,
          avgVelo: Math.round(avgVelo * 10) / 10,
          count: data.count,
        };
      });

      sessions.push({ date, pitchTypes: pitchTypeData });
    });

    // Sort by date
    sessions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setAllPitchTypes(Array.from(pitchTypesSet).sort());
    setAllSessionData(sessions);
    setLoading(false);
  }

  function normalizePitchType(type: string): string {
    const normalized = type.trim();
    // Map common variations
    if (normalized.toLowerCase().includes('four') || normalized.toLowerCase() === 'ff') return 'Fastball';
    if (normalized.toLowerCase().includes('two') || normalized.toLowerCase() === 'ft') return 'Two-Seam';
    if (normalized.toLowerCase() === 'si') return 'Sinker';
    if (normalized.toLowerCase() === 'fc') return 'Cutter';
    if (normalized.toLowerCase() === 'sl') return 'Slider';
    if (normalized.toLowerCase() === 'cu' || normalized.toLowerCase() === 'cb') return 'Curveball';
    if (normalized.toLowerCase() === 'ch') return 'Changeup';
    if (normalized.toLowerCase() === 'fs') return 'Splitter';
    return normalized || 'Other';
  }

  // Get pitch types present in filtered data
  const activePitchTypes = useMemo(() => {
    const types = new Set<string>();
    filteredData.forEach(session => {
      Object.keys(session.pitchTypes).forEach(type => types.add(type));
    });
    return Array.from(types).sort();
  }, [filteredData]);

  // Chart dimensions
  const chartWidth = SCREEN_WIDTH - 48;
  const chartHeight = 200;
  const chartPadding = { top: 20, right: 20, bottom: 40, left: 45 };
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;

  // Render line chart for velocity data
  function renderVelocityChart(
    title: string,
    dataKey: 'maxVelo' | 'avgVelo',
    subtitle?: string
  ) {
    if (filteredData.length === 0) {
      return (
        <View style={styles.chartContainer}>
          <Text style={styles.chartTitle}>{title}</Text>
          <View style={styles.emptyChart}>
            <Text style={styles.emptyChartText}>No data available</Text>
          </View>
        </View>
      );
    }

    // Calculate min/max for Y axis
    let minVelo = Infinity;
    let maxVelo = -Infinity;

    filteredData.forEach(session => {
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

    // Ensure reasonable range
    if (maxVelo - minVelo < 10) {
      const mid = (maxVelo + minVelo) / 2;
      minVelo = mid - 5;
      maxVelo = mid + 5;
    }

    const xScale = (index: number) =>
      chartPadding.left + (index / Math.max(filteredData.length - 1, 1)) * plotWidth;

    const yScale = (value: number) =>
      chartPadding.top + plotHeight - ((value - minVelo) / (maxVelo - minVelo)) * plotHeight;

    // Generate Y axis labels
    const yLabels = [];
    const yStep = (maxVelo - minVelo) / 4;
    for (let i = 0; i <= 4; i++) {
      yLabels.push(Math.round(minVelo + yStep * i));
    }

    // Generate X axis labels (dates)
    const xLabels: { index: number; label: string }[] = [];
    const maxLabels = 5;
    const step = Math.max(1, Math.floor(filteredData.length / maxLabels));
    for (let i = 0; i < filteredData.length; i += step) {
      const date = new Date(filteredData[i].date);
      xLabels.push({
        index: i,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
      });
    }

    // Generate path for each pitch type
    const paths: { type: string; path: string; color: string }[] = [];

    activePitchTypes.forEach(pitchType => {
      let pathData = '';
      let lastX = 0;
      let lastY = 0;
      let hasStarted = false;

      filteredData.forEach((session, index) => {
        const typeData = session.pitchTypes[pitchType];
        if (typeData) {
          const x = xScale(index);
          const y = yScale(typeData[dataKey]);

          if (!hasStarted) {
            pathData = `M ${x} ${y}`;
            hasStarted = true;
          } else {
            pathData += ` L ${x} ${y}`;
          }
          lastX = x;
          lastY = y;
        }
      });

      if (pathData) {
        paths.push({
          type: pitchType,
          path: pathData,
          color: PITCH_TYPE_COLORS[pitchType] || DEFAULT_LINE_COLOR,
        });
      }
    });

    return (
      <View style={styles.chartContainer}>
        <Text style={styles.chartTitle}>{title}</Text>
        {subtitle && <Text style={styles.chartSubtitle}>{subtitle}</Text>}

        <Svg width={chartWidth} height={chartHeight}>
          <Defs>
            <SvgLinearGradient id="gridGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.1" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.02" />
            </SvgLinearGradient>
          </Defs>

          {/* Background */}
          <Rect
            x={chartPadding.left}
            y={chartPadding.top}
            width={plotWidth}
            height={plotHeight}
            fill="url(#gridGradient)"
          />

          {/* Horizontal grid lines */}
          {yLabels.map((label, i) => (
            <G key={`grid-${i}`}>
              <Line
                x1={chartPadding.left}
                y1={yScale(label)}
                x2={chartPadding.left + plotWidth}
                y2={yScale(label)}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={1}
              />
              <SvgText
                x={chartPadding.left - 8}
                y={yScale(label) + 4}
                fill={COLORS.gray400}
                fontSize={10}
                textAnchor="end"
              >
                {label}
              </SvgText>
            </G>
          ))}

          {/* X axis labels */}
          {xLabels.map(({ index, label }) => (
            <SvgText
              key={`x-${index}`}
              x={xScale(index)}
              y={chartHeight - 10}
              fill={COLORS.gray400}
              fontSize={10}
              textAnchor="middle"
            >
              {label}
            </SvgText>
          ))}

          {/* Lines for each pitch type */}
          {paths.map(({ type, path, color }) => (
            <Path
              key={type}
              d={path}
              stroke={color}
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Data points */}
          {activePitchTypes.map(pitchType => (
            filteredData.map((session, index) => {
              const typeData = session.pitchTypes[pitchType];
              if (!typeData) return null;

              return (
                <Circle
                  key={`${pitchType}-${index}`}
                  cx={xScale(index)}
                  cy={yScale(typeData[dataKey])}
                  r={3}
                  fill={PITCH_TYPE_COLORS[pitchType] || DEFAULT_LINE_COLOR}
                />
              );
            })
          ))}
        </Svg>

        {/* Legend */}
        <View style={styles.legend}>
          {activePitchTypes.map(type => (
            <View key={type} style={styles.legendItem}>
              <View
                style={[
                  styles.legendColor,
                  { backgroundColor: PITCH_TYPE_COLORS[type] || DEFAULT_LINE_COLOR }
                ]}
              />
              <Text style={styles.legendText}>{type}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <LinearGradient colors={['#0A0A0A', '#1A1A1A', '#0A0A0A']} style={styles.gradient}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Loading pitching trends...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LinearGradient colors={['#0A0A0A', '#1A1A1A', '#0A0A0A']} style={styles.gradient}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Pitching Trends</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Time Filter */}
        <View style={styles.timeFilterContainer}>
          {(['1month', '3months', '6months', 'all'] as TimeFilter[]).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[
                styles.timeFilterButton,
                timeFilter === filter && styles.timeFilterButtonActive,
              ]}
              onPress={() => setTimeFilter(filter)}
            >
              <Text
                style={[
                  styles.timeFilterText,
                  timeFilter === filter && styles.timeFilterTextActive,
                ]}
              >
                {filter === '1month' ? '1M' :
                 filter === '3months' ? '3M' :
                 filter === '6months' ? '6M' : 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {filteredData.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="baseball-outline" size={48} color={COLORS.gray500} />
              <Text style={styles.emptyStateTitle}>No Pitching Data</Text>
              <Text style={styles.emptyStateText}>
                TrackMan data will appear here once available
              </Text>
            </View>
          ) : (
            <>
              {/* Max Velocity Chart */}
              {renderVelocityChart(
                'Max Velocity by Pitch Type',
                'maxVelo',
                'Peak velocity for each pitch type over time'
              )}

              {/* Average Velocity Chart */}
              {renderVelocityChart(
                'Average Velocity by Pitch Type',
                'avgVelo',
                'Mean velocity for each pitch type over time'
              )}

              {/* Stats Summary */}
              <View style={styles.statsContainer}>
                <Text style={styles.statsTitle}>Summary Stats</Text>
                <View style={styles.statsGrid}>
                  {activePitchTypes.map(type => {
                    // Calculate overall stats for this pitch type
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

                    return (
                      <View key={type} style={styles.statCard}>
                        <View style={styles.statCardHeader}>
                          <View
                            style={[
                              styles.statCardDot,
                              { backgroundColor: PITCH_TYPE_COLORS[type] || DEFAULT_LINE_COLOR }
                            ]}
                          />
                          <Text style={styles.statCardTitle}>{type}</Text>
                        </View>
                        <View style={styles.statCardBody}>
                          <View style={styles.statItem}>
                            <Text style={styles.statValue}>{maxVelo.toFixed(1)}</Text>
                            <Text style={styles.statLabel}>Max MPH</Text>
                          </View>
                          <View style={styles.statItem}>
                            <Text style={styles.statValue}>{avgVelo.toFixed(1)}</Text>
                            <Text style={styles.statLabel}>Avg MPH</Text>
                          </View>
                          <View style={styles.statItem}>
                            <Text style={styles.statValue}>{totalCount}</Text>
                            <Text style={styles.statLabel}>Pitches</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  gradient: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: COLORS.gray400,
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.white,
  },
  headerSpacer: {
    width: 40,
  },
  timeFilterContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  timeFilterButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  timeFilterButtonActive: {
    backgroundColor: 'rgba(155,221,255,0.15)',
    borderColor: COLORS.primary,
  },
  timeFilterText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray400,
  },
  timeFilterTextActive: {
    color: COLORS.primary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
    marginTop: 16,
  },
  emptyStateText: {
    fontSize: 14,
    color: COLORS.gray400,
    marginTop: 8,
    textAlign: 'center',
  },
  chartContainer: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 4,
  },
  chartSubtitle: {
    fontSize: 12,
    color: COLORS.gray400,
    marginBottom: 12,
  },
  emptyChart: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 8,
  },
  emptyChartText: {
    color: COLORS.gray500,
    fontSize: 14,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 12,
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 12,
    color: COLORS.gray400,
  },
  statsContainer: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  statsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 16,
  },
  statsGrid: {
    gap: 12,
  },
  statCard: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
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
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.gray400,
    marginTop: 2,
  },
});
