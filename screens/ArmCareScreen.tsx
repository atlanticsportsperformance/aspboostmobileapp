import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Alert,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Path, Text as SvgText, G, Polygon, Polyline, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { useAthlete } from '../contexts/AthleteContext';
import FABMenu from '../components/FABMenu';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ArmCareSession {
  id: string;
  exam_date: string;
  exam_time: string | null;
  exam_type: string | null;
  arm_score: number | null;
  total_strength: number | null;
  irtarm_strength: number | null;
  ertarm_strength: number | null;
  starm_strength: number | null;
  gtarm_strength: number | null;
  shoulder_balance: number | null;
  trunk_balance: number | null;
  manually_mapped: boolean;
  created_at: string;
}

export default function ArmCareScreen({ navigation, route }: any) {
  const { isParent } = useAthlete();
  const athleteId = route?.params?.athleteId;
  const [sessions, setSessions] = useState<ArmCareSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<'30' | '90' | '180' | 'all'>('all');
  const [userId, setUserId] = useState<string | null>(null);
  const [currentAthleteId, setCurrentAthleteId] = useState<string | null>(athleteId || null);
  // Tooltip state for radar chart
  const [tooltipData, setTooltipData] = useState<{
    label: string;
    currentValue: number;
    prevValue: number | null;
  } | null>(null);

  // FAB state
  const [fabOpen, setFabOpen] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasHittingData, setHasHittingData] = useState(false);
  const [hasForceData, setHasForceData] = useState(false);
  const [hasResourcesData, setHasResourcesData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [newResourcesCount, setNewResourcesCount] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }
      setUserId(user.id);

      // Get athlete ID if not provided
      let athId: string = currentAthleteId || '';
      if (!athId) {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (!athlete) {
          navigation.goBack();
          return;
        }
        athId = athlete.id;
        setCurrentAthleteId(athId);
      }

      await Promise.all([
        loadSessions(athId),
        checkDataPresence(athId, user.id),
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadSessions(athId: string) {
    const { data, error } = await supabase
      .from('armcare_sessions')
      .select('*')
      .eq('athlete_id', athId)
      .order('exam_date', { ascending: false })
      .order('exam_time', { ascending: false });

    if (error) {
      console.error('Error loading ArmCare sessions:', error);
    } else {
      setSessions(data || []);
    }
  }

  async function checkDataPresence(athId: string, currentUserId: string) {
    const [
      blastSwings,
      hittraxSessions,
      trackmanPitches,
      cmjTests,
      resourcesCount,
      unreadCount,
    ] = await Promise.all([
      supabase.from('blast_swings').select('id', { count: 'exact', head: true }).eq('athlete_id', athId),
      supabase.from('hittrax_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athId),
      supabase.from('trackman_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athId),
      supabase.from('cmj_tests').select('id', { count: 'exact', head: true }).eq('athlete_id', athId),
      supabase.from('resources').select('id', { count: 'exact', head: true }).eq('athlete_id', currentUserId),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('recipient_id', currentUserId).eq('read', false),
    ]);

    setHasHittingData((blastSwings.count || 0) > 0 || (hittraxSessions.count || 0) > 0);
    setHasPitchingData((trackmanPitches.count || 0) > 0);
    setHasForceData((cmjTests.count || 0) > 0);
    setHasResourcesData((resourcesCount.count || 0) > 0);
    setUnreadMessagesCount(unreadCount.count || 0);

    // Get new resources count
    if ((resourcesCount.count || 0) > 0) {
      const { data: athleteData } = await supabase
        .from('athletes')
        .select('last_viewed_resources_at')
        .eq('id', athId)
        .single();

      if (athleteData) {
        const lastViewed = athleteData.last_viewed_resources_at || new Date(0).toISOString();
        const { count: newCount } = await supabase
          .from('resources')
          .select('id', { count: 'exact', head: true })
          .eq('athlete_id', currentUserId)
          .gt('created_at', lastViewed);
        setNewResourcesCount(newCount || 0);
      }
    }
  }

  function formatDate(dateString: string) {
    const [year, month, day] = dateString.split('T')[0].split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  async function handleDeleteSession(sessionId: string) {
    Alert.alert(
      'Delete Test',
      'Are you sure you want to delete this arm care test? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('armcare_sessions')
                .delete()
                .eq('id', sessionId);

              if (error) throw error;

              Alert.alert('Success', 'Arm care test deleted successfully!');
              if (currentAthleteId) {
                await loadSessions(currentAthleteId);
              }
            } catch (error: any) {
              console.error('Error deleting session:', error);
              Alert.alert('Error', error.message || 'Failed to delete test');
            }
          },
        },
      ]
    );
  }

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Filter sessions by date range
  const getFilteredSessions = () => {
    if (dateRange === 'all') return sessions;

    const daysAgo = parseInt(dateRange);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysAgo);

    return sessions.filter((session) => {
      const sessionDate = new Date(session.exam_date);
      return sessionDate >= cutoffDate;
    });
  };

  const filteredSessions = getFilteredSessions();

  // Get most recent and previous sessions for radar chart
  const mostRecent = sessions[0] || null;
  const previous = sessions[1] || null;

  // Prepare radar chart data
  const radarMetrics = mostRecent ? [
    { label: 'Internal\nRotation', key: 'irtarm_strength', value: mostRecent.irtarm_strength || 0, prev: previous?.irtarm_strength || 0 },
    { label: 'External\nRotation', key: 'ertarm_strength', value: mostRecent.ertarm_strength || 0, prev: previous?.ertarm_strength || 0 },
    { label: 'Scaption\nStrength', key: 'starm_strength', value: mostRecent.starm_strength || 0, prev: previous?.starm_strength || 0 },
    { label: 'Grip\nStrength', key: 'gtarm_strength', value: mostRecent.gtarm_strength || 0, prev: previous?.gtarm_strength || 0 },
  ] : [];

  // Prepare chart data for trends
  const chartData = [...filteredSessions].reverse().map((session) => ({
    date: formatDate(session.exam_date),
    armScore: session.arm_score || 0,
    totalStrength: session.total_strength || 0,
    irtarmStrength: session.irtarm_strength || 0,
    ertarmStrength: session.ertarm_strength || 0,
    starmStrength: session.starm_strength || 0,
    gtarmStrength: session.gtarm_strength || 0,
  }));

  // Helper function to calculate linear regression
  const calculateRegression = (values: number[]) => {
    if (values.length < 2) return values.map(() => null);

    const n = values.length;
    const sumX = values.reduce((sum, _, i) => sum + i, 0);
    const sumY = values.reduce((sum, v) => sum + v, 0);
    const sumXY = values.reduce((sum, v, i) => sum + i * v, 0);
    const sumX2 = values.reduce((sum, _, i) => sum + i * i, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return values.map((_, i) => slope * i + intercept);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9BDDFF" />
        <Text style={styles.loadingText}>Loading ArmCare data...</Text>
      </View>
    );
  }

  if (sessions.length === 0) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color="#9CA3AF" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateIcon}>🏋️</Text>
          <Text style={styles.emptyStateTitle}>No ArmCare Sessions Yet</Text>
          <Text style={styles.emptyStateText}>
            ArmCare assessments will appear here once uploaded
          </Text>
        </View>
      </View>
    );
  }

  // Radar Chart Component - raw lbs with auto-scaling (matches web app)
  const RadarChart = () => {
    const size = SCREEN_WIDTH - 48;
    const center = size / 2;
    const radius = size * 0.32;
    const levels = 5;

    // Calculate max value for auto-scaling (like web app)
    const allValues = radarMetrics.flatMap(m => [m.value, m.prev]).filter(v => v > 0);
    const maxValue = allValues.length > 0 ? Math.max(...allValues) * 1.1 : 100; // 10% buffer

    // Calculate points for polygon
    const getPoint = (index: number, value: number) => {
      const angle = (Math.PI * 2 * index) / radarMetrics.length - Math.PI / 2;
      const normalizedValue = (value / maxValue) * radius;
      return {
        x: center + normalizedValue * Math.cos(angle),
        y: center + normalizedValue * Math.sin(angle),
      };
    };

    const currentPoints = radarMetrics.map((m, i) => getPoint(i, m.value));
    const prevPoints = radarMetrics.map((m, i) => getPoint(i, m.prev));

    const currentPath = currentPoints.map(p => `${p.x},${p.y}`).join(' ');
    const prevPath = prevPoints.map(p => `${p.x},${p.y}`).join(' ');

    // Handle metric point tap for tooltip
    const handleMetricTap = (metric: typeof radarMetrics[0]) => {
      setTooltipData({
        label: metric.label.replace('\n', ' '),
        currentValue: metric.value,
        prevValue: previous ? metric.prev : null,
      });
    };

    return (
      <View>
        <Svg width={size} height={size + 50}>
          {/* Grid circles */}
          {Array.from({ length: levels }).map((_, i) => (
            <Circle
              key={i}
              cx={center}
              cy={center}
              r={(radius / levels) * (i + 1)}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth={1}
              fill="none"
            />
          ))}

          {/* Grid lines */}
          {radarMetrics.map((_, i) => {
            const angle = (Math.PI * 2 * i) / radarMetrics.length - Math.PI / 2;
            const endX = center + radius * Math.cos(angle);
            const endY = center + radius * Math.sin(angle);
            return (
              <Line
                key={i}
                x1={center}
                y1={center}
                x2={endX}
                y2={endY}
                stroke="rgba(255,255,255,0.1)"
                strokeWidth={1}
              />
            );
          })}

          {/* Previous data polygon (dashed) */}
          {previous && (
            <Polygon
              points={prevPath}
              fill="transparent"
              stroke="rgba(229,231,235,0.35)"
              strokeWidth={2}
              strokeDasharray="5,5"
            />
          )}

          {/* Current data polygon */}
          <Polygon
            points={currentPath}
            fill="rgba(229,231,235,0.12)"
            stroke="#E5E7EB"
            strokeWidth={2.5}
          />

          {/* Data points (tappable for tooltip) */}
          {radarMetrics.map((metric, i) => {
            const point = currentPoints[i];
            return (
              <Circle
                key={`point-${i}`}
                cx={point.x}
                cy={point.y}
                r={8}
                fill="#9BDDFF"
                stroke="#FFFFFF"
                strokeWidth={2}
                onPress={() => handleMetricTap(metric)}
              />
            );
          })}

          {/* Labels */}
          {radarMetrics.map((metric, i) => {
            const angle = (Math.PI * 2 * i) / radarMetrics.length - Math.PI / 2;
            const labelRadius = radius + 40;
            const x = center + labelRadius * Math.cos(angle);
            const y = center + labelRadius * Math.sin(angle);
            const lines = metric.label.split('\n');

            return (
              <G key={i}>
                {lines.map((line, lineIndex) => (
                  <SvgText
                    key={lineIndex}
                    x={x}
                    y={y + (lineIndex * 14) - ((lines.length - 1) * 7)}
                    fill="#fff"
                    fontSize={11}
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {line}
                  </SvgText>
                ))}
              </G>
            );
          })}

          {/* Legend */}
          <G transform={`translate(${center - 90}, ${size + 10})`}>
            <Line x1={0} y1={0} x2={20} y2={0} stroke="#E5E7EB" strokeWidth={2} />
            <SvgText x={25} y={4} fill="#fff" fontSize={10}>Most Recent ({mostRecent ? formatDate(mostRecent.exam_date) : ''})</SvgText>
          </G>
          {previous && (
            <G transform={`translate(${center - 90}, ${size + 25})`}>
              <Line x1={0} y1={0} x2={20} y2={0} stroke="rgba(229,231,235,0.35)" strokeWidth={2} strokeDasharray="5,5" />
              <SvgText x={25} y={4} fill="#fff" fontSize={10}>Previous ({formatDate(previous.exam_date)})</SvgText>
            </G>
          )}
        </Svg>

        {/* Tooltip */}
        {tooltipData && (
          <TouchableOpacity
            style={styles.tooltipContainer}
            onPress={() => setTooltipData(null)}
            activeOpacity={0.9}
          >
            <View style={styles.tooltip}>
              <Text style={styles.tooltipTitle}>{tooltipData.label}</Text>
              <View style={styles.tooltipRow}>
                <View style={styles.tooltipDot} />
                <Text style={styles.tooltipLabel}>Current:</Text>
                <Text style={styles.tooltipValue}>{tooltipData.currentValue.toFixed(1)} lbs</Text>
              </View>
              {tooltipData.prevValue !== null && (
                <View style={styles.tooltipRow}>
                  <View style={[styles.tooltipDot, styles.tooltipDotPrev]} />
                  <Text style={styles.tooltipLabel}>Previous:</Text>
                  <Text style={styles.tooltipValue}>{tooltipData.prevValue.toFixed(1)} lbs</Text>
                </View>
              )}
              <Text style={styles.tooltipHint}>Tap to dismiss</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // Line Chart Component
  const LineChartComponent = ({
    data,
    dataKey,
    color,
    title
  }: {
    data: typeof chartData;
    dataKey: keyof typeof chartData[0];
    color: string;
    title: string;
  }) => {
    if (data.length === 0) return null;

    const width = SCREEN_WIDTH - 48;
    const height = 200;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const values = data.map(d => d[dataKey] as number);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue || 1;
    const buffer = valueRange * 0.1;
    const yMin = Math.max(0, minValue - buffer);
    const yMax = maxValue + buffer;

    const getX = (index: number) => padding.left + (index / (data.length - 1 || 1)) * chartWidth;
    const getY = (value: number) => padding.top + chartHeight - ((value - yMin) / (yMax - yMin || 1)) * chartHeight;

    // Create path for main line
    const linePath = data.map((d, i) => {
      const x = getX(i);
      const y = getY(d[dataKey] as number);
      return i === 0 ? `M${x},${y}` : `L${x},${y}`;
    }).join(' ');

    // Create regression line
    const regression = calculateRegression(values);
    const regressionPath = regression.map((v, i) => {
      if (v === null) return '';
      const x = getX(i);
      const y = getY(v);
      return i === 0 ? `M${x},${y}` : `L${x},${y}`;
    }).join(' ');

    // Y-axis labels
    const yLabels = [yMin, yMin + (yMax - yMin) / 2, yMax];

    return (
      <View style={styles.chartContainer}>
        <Text style={styles.chartTitle}>{title}</Text>
        <Svg width={width} height={height}>
          {/* Grid lines */}
          {yLabels.map((value, i) => {
            const y = getY(value);
            return (
              <G key={i}>
                <Line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#374151"
                  strokeWidth={1}
                  strokeDasharray="3,3"
                />
                <SvgText
                  x={padding.left - 8}
                  y={y + 4}
                  fill="#9ca3af"
                  fontSize={10}
                  textAnchor="end"
                >
                  {value.toFixed(0)}
                </SvgText>
              </G>
            );
          })}

          {/* X-axis labels */}
          {data.map((d, i) => {
            // Only show a few labels to avoid crowding
            if (data.length > 5 && i % Math.ceil(data.length / 4) !== 0 && i !== data.length - 1) return null;
            return (
              <SvgText
                key={i}
                x={getX(i)}
                y={height - 10}
                fill="#9ca3af"
                fontSize={9}
                textAnchor="middle"
              >
                {d.date.split(',')[0]}
              </SvgText>
            );
          })}

          {/* Regression line */}
          <Path
            d={regressionPath}
            stroke="#6366f1"
            strokeWidth={2}
            strokeDasharray="5,5"
            fill="none"
          />

          {/* Main line */}
          <Path
            d={linePath}
            stroke={color}
            strokeWidth={2}
            fill="none"
          />

          {/* Data points */}
          {data.map((d, i) => (
            <Circle
              key={i}
              cx={getX(i)}
              cy={getY(d[dataKey] as number)}
              r={4}
              fill={color}
            />
          ))}
        </Svg>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9BDDFF" />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color="#9CA3AF" />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.pageTitle}>🏋️ ArmCare Analysis</Text>
          <Text style={styles.pageSubtitle}>Detailed strength assessment and trends</Text>
        </View>

        {/* Radar Chart Card - Arm Score Profile */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Arm Score Profile</Text>
            <Text style={styles.cardDescription}>
              Visual comparison of your shoulder strength across four key measurements. The white area shows your most recent test, while the dotted line indicates your previous assessment.
            </Text>
          </View>

          <View style={styles.radarContainer}>
            <RadarChart />
          </View>

          {/* Info Cards */}
          <View style={styles.infoCardsRow}>
            <View style={styles.infoCard}>
              <Text style={styles.infoCardLabel}>Total Strength</Text>
              <Text style={styles.infoCardValue}>
                {mostRecent?.total_strength?.toFixed(0) || 'N/A'}
                <Text style={styles.infoCardUnit}> lbs</Text>
              </Text>
            </View>
            <View style={styles.infoCard}>
              <Text style={styles.infoCardLabel}>Arm Score</Text>
              <Text style={styles.infoCardValue}>
                {mostRecent?.arm_score?.toFixed(1) || 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {/* Trend Charts Card */}
        <View style={styles.card}>
          <View style={styles.trendHeader}>
            <Text style={styles.cardTitle}>Trend Charts</Text>
            <View style={styles.dateRangeButtons}>
              {(['30', '90', '180', 'all'] as const).map((range) => (
                <TouchableOpacity
                  key={range}
                  onPress={() => setDateRange(range)}
                  style={[
                    styles.dateRangeButton,
                    dateRange === range && styles.dateRangeButtonActive,
                  ]}
                >
                  {dateRange === range ? (
                    <LinearGradient
                      colors={['#9BDDFF', '#7BC5F0']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.dateRangeButtonGradient}
                    >
                      <Text style={styles.dateRangeButtonTextActive}>
                        {range === 'all' ? 'All' : range === '180' ? '6mo' : `${range}d`}
                      </Text>
                    </LinearGradient>
                  ) : (
                    <Text style={styles.dateRangeButtonText}>
                      {range === 'all' ? 'All' : range === '180' ? '6mo' : `${range}d`}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.chartsContainer}>
            <LineChartComponent data={chartData} dataKey="armScore" color="#9BDDFF" title="Arm Score" />
            <LineChartComponent data={chartData} dataKey="totalStrength" color="#10b981" title="Total Strength (lbs)" />
            <LineChartComponent data={chartData} dataKey="irtarmStrength" color="#f59e0b" title="Internal Rotation Strength (lbs)" />
            <LineChartComponent data={chartData} dataKey="ertarmStrength" color="#8b5cf6" title="External Rotation Strength (lbs)" />
            <LineChartComponent data={chartData} dataKey="starmStrength" color="#ec4899" title="Scaption Strength (lbs)" />
            <LineChartComponent data={chartData} dataKey="gtarmStrength" color="#06b6d4" title="Grip Strength (lbs)" />
          </View>
        </View>

        {/* Test History List */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Test History</Text>
          <View style={styles.sessionsList}>
            {sessions.map((session) => (
              <View key={session.id} style={styles.sessionItem}>
                <View style={styles.sessionInfo}>
                  <View style={styles.sessionHeaderRow}>
                    <Text style={styles.sessionDate}>{formatDate(session.exam_date)}</Text>
                    {session.manually_mapped && (
                      <View style={styles.manualBadge}>
                        <Text style={styles.manualBadgeText}>Manual</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.sessionMetrics}>
                    <Text style={styles.sessionMetricLabel}>
                      Arm Score: <Text style={styles.sessionMetricValue}>{session.arm_score?.toFixed(1) || 'N/A'}</Text>
                    </Text>
                    <Text style={styles.sessionMetricLabel}>
                      Total Strength: <Text style={styles.sessionMetricValue}>{session.total_strength?.toFixed(0) || 'N/A'} lbs</Text>
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => handleDeleteSession(session.id)}
                  style={styles.deleteButton}
                >
                  <Ionicons name="trash-outline" size={20} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

        {/* Bottom padding for FAB */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB Menu */}
      <FABMenu
        isOpen={fabOpen}
        onToggle={() => setFabOpen(!fabOpen)}
        totalBadgeCount={unreadMessagesCount + newResourcesCount}
        items={[
          { id: 'home', label: 'Home', icon: 'home', onPress: () => navigation.navigate(isParent ? 'ParentDashboard' : 'Dashboard') },
          { id: 'messages', label: 'Messages', icon: 'chatbubble', badge: unreadMessagesCount, onPress: () => navigation.navigate('Messages') },
          { id: 'performance', label: 'Performance', icon: 'stats-chart', onPress: () => navigation.navigate('Performance', { athleteId: currentAthleteId }) },
          { id: 'leaderboard', label: 'Leaderboard', icon: 'trophy', onPress: () => navigation.navigate('Leaderboard') },
          ...(hasHittingData ? [{ id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('HittingPerformance', { athleteId: currentAthleteId }) }] : []),
          ...(hasPitchingData ? [{ id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('PitchingPerformance', { athleteId: currentAthleteId }) }] : []),
          { id: 'armcare', label: 'Arm Care', icon: 'arm-flex', iconFamily: 'material-community' as const, isActive: true, onPress: () => setFabOpen(false) },
          ...(hasForceData ? [{ id: 'force', label: 'Force Profile', icon: 'trending-up', onPress: () => navigation.navigate('ForceProfile', { athleteId: currentAthleteId }) }] : []),
          { id: 'resources', label: 'Notes/Resources', icon: 'document-text', badge: newResourcesCount, onPress: () => navigation.navigate('Resources', { athleteId: currentAthleteId }) },
          { id: 'book', label: 'Book a Class', icon: 'calendar', isBookButton: true, onPress: () => navigation.navigate('Booking') },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 16,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backButtonText: {
    color: '#9CA3AF',
    fontSize: 16,
    marginLeft: 4,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    marginHorizontal: 16,
    backgroundColor: '#000000',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  emptyStateIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#000000',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
  },
  cardHeader: {
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 18,
  },
  radarContainer: {
    alignItems: 'center',
    marginVertical: -20,
  },
  infoCardsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  infoCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 12,
  },
  infoCardLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  infoCardValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  infoCardUnit: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  trendHeader: {
    flexDirection: 'column',
    gap: 12,
    marginBottom: 16,
  },
  dateRangeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  dateRangeButton: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#374151',
  },
  dateRangeButtonActive: {
    backgroundColor: 'transparent',
  },
  dateRangeButtonGradient: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  dateRangeButtonText: {
    color: '#D1D5DB',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  dateRangeButtonTextActive: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  chartsContainer: {
    gap: 24,
  },
  chartContainer: {
    marginBottom: 8,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  sessionsList: {
    gap: 8,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sessionDate: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  manualBadge: {
    backgroundColor: 'rgba(59,130,246,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.5)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  manualBadgeText: {
    fontSize: 10,
    color: '#93C5FD',
    fontWeight: '500',
  },
  sessionMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sessionMetricLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  sessionMetricValue: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  deleteButton: {
    padding: 8,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: 8,
    marginLeft: 12,
  },
  // Tooltip styles
  tooltipContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  tooltip: {
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
    padding: 16,
    minWidth: 200,
    shadowColor: '#9BDDFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
  },
  tooltipTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9BDDFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  tooltipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  tooltipDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5E7EB',
  },
  tooltipDotPrev: {
    backgroundColor: 'rgba(229, 231, 235, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(229, 231, 235, 0.5)',
    borderStyle: 'dashed',
  },
  tooltipLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  tooltipValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'right',
  },
  tooltipHint: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    marginTop: 8,
  },
});
