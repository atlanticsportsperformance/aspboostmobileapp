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

// Professional color palette matching HittingPerformanceScreen
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

interface SessionData {
  date: string;
  avgBatSpeed: number | null;
  maxBatSpeed: number | null;
  avgAttackAngle: number | null;
  attackAngleStdDev: number | null;
  avgConnectionAtImpact: number | null;
  avgEarlyConnection: number | null;
  swingCount: number;
}

type TimeFilter = '1month' | '3months' | '6months' | 'all';

export default function HittingTrendsScreen({ navigation, route }: any) {
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

      // Use passed athleteId or fallback to looking up by user_id
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

    const { data: blastSwings, error } = await supabase
      .from('blast_swings')
      .select('bat_speed, attack_angle, connection_at_impact, early_connection, recorded_date')
      .eq('athlete_id', id)
      .order('recorded_date', { ascending: true });

    if (!blastSwings || blastSwings.length === 0) {
      setLoading(false);
      return;
    }

    const groupedByDate = blastSwings.reduce((acc: { [key: string]: { batSpeeds: number[], attackAngles: number[], connectionAtImpacts: number[], earlyConnections: number[] } }, swing) => {
      const date = swing.recorded_date.split('T')[0];
      if (!acc[date]) acc[date] = { batSpeeds: [], attackAngles: [], connectionAtImpacts: [], earlyConnections: [] };

      if (swing.bat_speed !== null && swing.bat_speed > 0) {
        acc[date].batSpeeds.push(swing.bat_speed);
      }
      if (swing.attack_angle !== null) {
        acc[date].attackAngles.push(swing.attack_angle);
      }
      if (swing.connection_at_impact !== null) {
        acc[date].connectionAtImpacts.push(swing.connection_at_impact);
      }
      if (swing.early_connection !== null) {
        acc[date].earlyConnections.push(swing.early_connection);
      }
      return acc;
    }, {});

    const trends: SessionData[] = Object.keys(groupedByDate)
      .map(date => {
        const { batSpeeds, attackAngles, connectionAtImpacts, earlyConnections } = groupedByDate[date];

        let attackAngleStdDev = null;
        if (attackAngles.length > 1) {
          const mean = attackAngles.reduce((sum, a) => sum + a, 0) / attackAngles.length;
          const variance = attackAngles.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / attackAngles.length;
          attackAngleStdDev = Math.sqrt(variance);
        }

        return {
          date,
          avgBatSpeed: batSpeeds.length > 0 ? batSpeeds.reduce((sum, s) => sum + s, 0) / batSpeeds.length : null,
          maxBatSpeed: batSpeeds.length > 0 ? Math.max(...batSpeeds) : null,
          avgAttackAngle: attackAngles.length > 0 ? attackAngles.reduce((sum, a) => sum + a, 0) / attackAngles.length : null,
          attackAngleStdDev,
          avgConnectionAtImpact: connectionAtImpacts.length > 0 ? connectionAtImpacts.reduce((sum, c) => sum + c, 0) / connectionAtImpacts.length : null,
          avgEarlyConnection: earlyConnections.length > 0 ? earlyConnections.reduce((sum, e) => sum + e, 0) / earlyConnections.length : null,
          swingCount: Math.max(batSpeeds.length, attackAngles.length, connectionAtImpacts.length, earlyConnections.length),
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setAllSessionData(trends);
    setLoading(false);
  }

  const avgOfAvgs = useMemo(() => {
    const validSessions = filteredData.filter(s => s.avgBatSpeed !== null);
    return validSessions.length > 0
      ? validSessions.reduce((sum, s) => sum + (s.avgBatSpeed || 0), 0) / validSessions.length
      : 0;
  }, [filteredData]);

  const maxOfMaxs = useMemo(() => {
    return filteredData.length > 0 ? Math.max(...filteredData.map(s => s.maxBatSpeed || 0)) : 0;
  }, [filteredData]);

  const avgAttackAngle = useMemo(() => {
    const validSessions = filteredData.filter(s => s.avgAttackAngle !== null);
    return validSessions.length > 0
      ? validSessions.reduce((sum, s) => sum + (s.avgAttackAngle || 0), 0) / validSessions.length
      : 0;
  }, [filteredData]);

  const avgConnectionAtImpact = useMemo(() => {
    const validSessions = filteredData.filter(s => s.avgConnectionAtImpact !== null);
    return validSessions.length > 0
      ? validSessions.reduce((sum, s) => sum + (s.avgConnectionAtImpact || 0), 0) / validSessions.length
      : null;
  }, [filteredData]);

  const avgEarlyConnection = useMemo(() => {
    const validSessions = filteredData.filter(s => s.avgEarlyConnection !== null);
    return validSessions.length > 0
      ? validSessions.reduce((sum, s) => sum + (s.avgEarlyConnection || 0), 0) / validSessions.length
      : null;
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
          <Text style={styles.title}>Swing Trends</Text>
          <Text style={styles.subtitle}>
            Track your performance over time • {filteredData.length} sessions
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
            {/* Bat Speed PR Cards */}
            <View style={styles.prSection}>
              <Text style={styles.sectionTitle}>Bat Speed</Text>
              <View style={styles.prRow}>
                <View style={styles.prItem}>
                  <Text style={styles.prValue}>{avgOfAvgs.toFixed(1)}</Text>
                  <Text style={styles.prLabel}>Average</Text>
                  <Text style={styles.prUnit}>mph</Text>
                </View>
                <View style={[styles.prItem, styles.prItemBorder]}>
                  <View style={styles.prValueRow}>
                    <Ionicons name="star" size={12} color={COLORS.gold} />
                    <Text style={styles.prValueGold}>{maxOfMaxs.toFixed(1)}</Text>
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

            {/* Bat Speed Chart */}
            <BatSpeedChart sessionData={filteredData} />

            {/* Attack Angle Section */}
            <View style={styles.prSection}>
              <Text style={styles.sectionTitle}>Attack Angle</Text>
              <View style={styles.singleStatRow}>
                <Text style={styles.prValue}>{avgAttackAngle.toFixed(1)}°</Text>
                <Text style={styles.statDescription}>Average swing path • Ideal: 5-20°</Text>
              </View>
            </View>

            {/* Attack Angle Chart */}
            <AttackAngleChart sessionData={filteredData} />

            {/* Connection Section */}
            <View style={styles.prSection}>
              <Text style={styles.sectionTitle}>Connection Metrics</Text>
              <View style={styles.prRow}>
                <View style={styles.prItem}>
                  <Text style={styles.prValue}>
                    {avgConnectionAtImpact !== null ? avgConnectionAtImpact.toFixed(1) : '--'}°
                  </Text>
                  <Text style={styles.prLabel}>At Impact</Text>
                  <Text style={styles.prUnit}>connection</Text>
                </View>
                <View style={[styles.prItem, styles.prItemBorder]}>
                  <Text style={styles.prValue}>
                    {avgEarlyConnection !== null ? avgEarlyConnection.toFixed(1) : '--'}°
                  </Text>
                  <Text style={styles.prLabel}>Early</Text>
                  <Text style={styles.prUnit}>connection</Text>
                </View>
                <View style={styles.prItem}>
                  <Text style={styles.prValueSmall}>80-95°</Text>
                  <Text style={styles.prLabel}>Ideal</Text>
                  <Text style={styles.prUnit}>range</Text>
                </View>
              </View>
            </View>

            {/* Connection Chart */}
            <ConnectionChart sessionData={filteredData} />

            {/* Session Details Table */}
            <View style={styles.tableContainer}>
              <Text style={styles.sectionTitle}>Session Details</Text>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, { flex: 1.2 }]}>Date</Text>
                  <Text style={[styles.tableHeaderText, { flex: 0.6 }]}>Swings</Text>
                  <Text style={[styles.tableHeaderText, { flex: 0.8 }]}>Avg</Text>
                  <Text style={[styles.tableHeaderText, { flex: 0.8 }]}>Max</Text>
                  <Text style={[styles.tableHeaderText, { flex: 0.7 }]}>AA</Text>
                </View>
                {filteredData.slice().reverse().slice(0, 15).map((session, index) => (
                  <View key={index} style={[styles.tableRow, index % 2 === 0 && styles.tableRowEven]}>
                    <Text style={[styles.tableCell, { flex: 1.2, color: COLORS.white }]}>
                      {new Date(session.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 0.6 }]}>{session.swingCount}</Text>
                    <Text style={[styles.tableCell, { flex: 0.8, color: COLORS.primary, fontWeight: '600' }]}>
                      {session.avgBatSpeed?.toFixed(1) || '--'}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 0.8, color: COLORS.secondary, fontWeight: '600' }]}>
                      {session.maxBatSpeed?.toFixed(1) || '--'}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 0.7, color: COLORS.gray300, fontWeight: '600' }]}>
                      {session.avgAttackAngle?.toFixed(1) || '--'}°
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating Back Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.goBack()}
      >
        <LinearGradient
          colors={[COLORS.primary, COLORS.primaryDark]}
          style={styles.fabGradient}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.black} />
        </LinearGradient>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// Tooltip Component
function Tooltip({ x, y, value, label, date, color }: { x: number; y: number; value: string; label: string; date: string; color: string }) {
  const tooltipWidth = 90;
  const tooltipHeight = 48;
  const adjustedX = Math.max(10, Math.min(x - tooltipWidth / 2, SCREEN_WIDTH - 32 - tooltipWidth - 10));
  const adjustedY = y - tooltipHeight - 12;

  return (
    <View style={[styles.tooltip, { left: adjustedX, top: Math.max(5, adjustedY) }]}>
      <Text style={[styles.tooltipValue, { color }]}>{value}</Text>
      <Text style={styles.tooltipLabel}>{label}</Text>
      <Text style={styles.tooltipDate}>{date}</Text>
    </View>
  );
}

// Bat Speed Chart Component
function BatSpeedChart({ sessionData }: { sessionData: SessionData[] }) {
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; y: number; value: number; type: 'avg' | 'max'; date: string } | null>(null);

  if (sessionData.length === 0) return null;

  const chartWidth = SCREEN_WIDTH - 32;
  const chartHeight = 264;
  const padding = { top: 20, right: 35, bottom: 35, left: 40 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const allSpeeds = sessionData.flatMap(s => [s.avgBatSpeed, s.maxBatSpeed]).filter((v): v is number => v !== null);
  const minSpeed = Math.floor(Math.min(...allSpeeds) / 10) * 10;
  const maxSpeed = Math.ceil(Math.max(...allSpeeds) / 10) * 10;

  const avgPoints = sessionData
    .map((session, index) => {
      if (session.avgBatSpeed === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.avgBatSpeed - minSpeed) / (maxSpeed - minSpeed)) * innerHeight;
      return { x, y, value: session.avgBatSpeed, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const maxPoints = sessionData
    .map((session, index) => {
      if (session.maxBatSpeed === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.maxBatSpeed - minSpeed) / (maxSpeed - minSpeed)) * innerHeight;
      return { x, y, value: session.maxBatSpeed, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const avgLinePath = avgPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const maxLinePath = maxPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const avgAreaPath = avgPoints.length > 0
    ? `${avgLinePath} L ${avgPoints[avgPoints.length - 1].x} ${padding.top + innerHeight} L ${padding.left} ${padding.top + innerHeight} Z`
    : '';

  const yAxisSteps = 4;
  const gridLines = Array.from({ length: yAxisSteps + 1 }, (_, i) => {
    const value = minSpeed + (i * (maxSpeed - minSpeed)) / yAxisSteps;
    const y = padding.top + innerHeight - (i / yAxisSteps) * innerHeight;
    return { y, value };
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <View style={styles.chartContainer}>
      <Svg width={chartWidth} height={chartHeight}>
        <Defs>
          <SvgLinearGradient id="avgGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor={COLORS.primary} stopOpacity="0.3" />
            <Stop offset="100%" stopColor={COLORS.primary} stopOpacity="0.02" />
          </SvgLinearGradient>
        </Defs>

        <Rect x={padding.left} y={padding.top} width={innerWidth} height={innerHeight} fill="rgba(0,0,0,0.3)" stroke={COLORS.gray700} strokeWidth={1} rx={4} />

        {gridLines.map((line, i) => (
          <G key={i}>
            <Line x1={padding.left} y1={line.y} x2={padding.left + innerWidth} y2={line.y} stroke={COLORS.gray700} strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
            <SvgText x={padding.left - 6} y={line.y + 4} textAnchor="end" fontSize={9} fill={COLORS.gray500}>{Math.round(line.value)}</SvgText>
          </G>
        ))}

        <Path d={avgAreaPath} fill="url(#avgGradient)" />
        <Path d={avgLinePath} fill="none" stroke={COLORS.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {avgPoints.map((point, i) => (
          <Circle key={`avg-${i}`} cx={point.x} cy={point.y} r={selectedPoint?.x === point.x && selectedPoint?.type === 'avg' ? 6 : 4} fill={COLORS.primary} stroke={COLORS.primaryDark} strokeWidth={2} />
        ))}

        <Path d={maxLinePath} fill="none" stroke={COLORS.secondary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6,3" />

        {maxPoints.map((point, i) => (
          <Circle key={`max-${i}`} cx={point.x} cy={point.y} r={selectedPoint?.x === point.x && selectedPoint?.type === 'max' ? 6 : 4} fill={COLORS.secondary} stroke={COLORS.gold} strokeWidth={2} />
        ))}

        <SvgText x={chartWidth / 2} y={chartHeight - 6} textAnchor="middle" fontSize={10} fill={COLORS.gray500}>Sessions</SvgText>
      </Svg>

      {/* Touch targets for avg points */}
      {avgPoints.map((point, i) => (
        <TouchableOpacity
          key={`avg-touch-${i}`}
          style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
          onPress={() => setSelectedPoint(selectedPoint?.x === point.x && selectedPoint?.type === 'avg' ? null : { ...point, type: 'avg' })}
        />
      ))}

      {/* Touch targets for max points */}
      {maxPoints.map((point, i) => (
        <TouchableOpacity
          key={`max-touch-${i}`}
          style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
          onPress={() => setSelectedPoint(selectedPoint?.x === point.x && selectedPoint?.type === 'max' ? null : { ...point, type: 'max' })}
        />
      ))}

      {/* Tooltip */}
      {selectedPoint && (
        <Tooltip
          x={selectedPoint.x}
          y={selectedPoint.y}
          value={`${selectedPoint.value.toFixed(1)} mph`}
          label={selectedPoint.type === 'avg' ? 'Average' : 'Max'}
          date={formatDate(selectedPoint.date)}
          color={selectedPoint.type === 'avg' ? COLORS.primary : COLORS.secondary}
        />
      )}

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.primary }]} />
          <Text style={styles.legendText}>Avg Speed</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.secondary }]} />
          <Text style={styles.legendText}>Max Speed</Text>
        </View>
      </View>
    </View>
  );
}

// Attack Angle Chart Component
function AttackAngleChart({ sessionData }: { sessionData: SessionData[] }) {
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; y: number; value: number; date: string } | null>(null);

  if (sessionData.length === 0) return null;

  const chartWidth = SCREEN_WIDTH - 32;
  const chartHeight = 240;
  const padding = { top: 20, right: 35, bottom: 35, left: 40 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const allAngles = sessionData.map(s => s.avgAttackAngle).filter((v): v is number => v !== null);

  if (allAngles.length === 0) {
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.emptyChartText}>No attack angle data available</Text>
      </View>
    );
  }

  const minAngleWithStdDev = Math.min(...sessionData.map((s) =>
    s.avgAttackAngle !== null && s.attackAngleStdDev !== null
      ? s.avgAttackAngle - s.attackAngleStdDev
      : s.avgAttackAngle || 0
  ));
  const maxAngleWithStdDev = Math.max(...sessionData.map((s) =>
    s.avgAttackAngle !== null && s.attackAngleStdDev !== null
      ? s.avgAttackAngle + s.attackAngleStdDev
      : s.avgAttackAngle || 0
  ));

  const minAngle = Math.floor(minAngleWithStdDev / 5) * 5;
  const maxAngle = Math.ceil(maxAngleWithStdDev / 5) * 5;

  const avgPoints = sessionData
    .map((session, index) => {
      if (session.avgAttackAngle === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.avgAttackAngle - minAngle) / (maxAngle - minAngle)) * innerHeight;
      return { x, y, value: session.avgAttackAngle, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const avgLinePath = avgPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const yAxisSteps = 4;
  const gridLines = Array.from({ length: yAxisSteps + 1 }, (_, i) => {
    const value = minAngle + (i * (maxAngle - minAngle)) / yAxisSteps;
    const y = padding.top + innerHeight - (i / yAxisSteps) * innerHeight;
    return { y, value };
  });

  const idealMin = 5;
  const idealMax = 20;
  const yIdealMax = padding.top + innerHeight - ((idealMax - minAngle) / (maxAngle - minAngle)) * innerHeight;
  const yIdealMin = padding.top + innerHeight - ((idealMin - minAngle) / (maxAngle - minAngle)) * innerHeight;
  const idealHeight = yIdealMin - yIdealMax;
  const showIdealRange = idealMax >= minAngle && idealMin <= maxAngle;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <View style={styles.chartContainer}>
      <Svg width={chartWidth} height={chartHeight}>
        <Rect x={padding.left} y={padding.top} width={innerWidth} height={innerHeight} fill="rgba(0,0,0,0.3)" stroke={COLORS.gray700} strokeWidth={1} rx={4} />

        {showIdealRange && (
          <Rect x={padding.left} y={Math.max(padding.top, yIdealMax)} width={innerWidth} height={Math.min(idealHeight, innerHeight)} fill={COLORS.primary} opacity={0.08} />
        )}

        {gridLines.map((line, i) => (
          <G key={i}>
            <Line x1={padding.left} y1={line.y} x2={padding.left + innerWidth} y2={line.y} stroke={COLORS.gray700} strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
            <SvgText x={padding.left - 6} y={line.y + 4} textAnchor="end" fontSize={9} fill={COLORS.gray500}>{Math.round(line.value)}°</SvgText>
          </G>
        ))}

        <Path d={avgLinePath} fill="none" stroke={COLORS.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {avgPoints.map((point, i) => (
          <Circle key={`attack-${i}`} cx={point.x} cy={point.y} r={selectedPoint?.x === point.x ? 6 : 4} fill={COLORS.primary} stroke={COLORS.primaryDark} strokeWidth={2} />
        ))}

        <SvgText x={chartWidth / 2} y={chartHeight - 6} textAnchor="middle" fontSize={10} fill={COLORS.gray500}>Sessions</SvgText>
      </Svg>

      {/* Touch targets */}
      {avgPoints.map((point, i) => (
        <TouchableOpacity
          key={`attack-touch-${i}`}
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
          label="Attack Angle"
          date={formatDate(selectedPoint.date)}
          color={COLORS.primary}
        />
      )}

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.primary }]} />
          <Text style={styles.legendText}>Attack Angle</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: 'rgba(155, 221, 255, 0.15)', borderColor: COLORS.primary }]} />
          <Text style={styles.legendText}>Ideal (5-20°)</Text>
        </View>
      </View>
    </View>
  );
}

// Connection Chart Component
function ConnectionChart({ sessionData }: { sessionData: SessionData[] }) {
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; y: number; value: number; type: 'impact' | 'early'; date: string } | null>(null);

  if (sessionData.length === 0) return null;

  const chartWidth = SCREEN_WIDTH - 32;
  const chartHeight = 240;
  const padding = { top: 20, right: 35, bottom: 35, left: 40 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const allConnections = sessionData.flatMap(s => [s.avgConnectionAtImpact, s.avgEarlyConnection]).filter((v): v is number => v !== null);

  if (allConnections.length === 0) {
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.emptyChartText}>No connection data available</Text>
      </View>
    );
  }

  const minConnection = Math.min(Math.floor(Math.min(...allConnections) / 10) * 10, 70);
  const maxConnection = Math.max(Math.ceil(Math.max(...allConnections) / 10) * 10, 100);

  const connectionAtImpactPoints = sessionData
    .map((session, index) => {
      if (session.avgConnectionAtImpact === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.avgConnectionAtImpact - minConnection) / (maxConnection - minConnection)) * innerHeight;
      return { x, y, value: session.avgConnectionAtImpact, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const earlyConnectionPoints = sessionData
    .map((session, index) => {
      if (session.avgEarlyConnection === null) return null;
      const x = padding.left + (index / Math.max(1, sessionData.length - 1)) * innerWidth;
      const y = padding.top + innerHeight - ((session.avgEarlyConnection - minConnection) / (maxConnection - minConnection)) * innerHeight;
      return { x, y, value: session.avgEarlyConnection, date: session.date };
    })
    .filter((p): p is { x: number; y: number; value: number; date: string } => p !== null);

  const connectionAtImpactLinePath = connectionAtImpactPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const earlyConnectionLinePath = earlyConnectionPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const idealMin = 80;
  const idealMax = 95;
  const idealMinY = padding.top + innerHeight - ((idealMin - minConnection) / (maxConnection - minConnection)) * innerHeight;
  const idealMaxY = padding.top + innerHeight - ((idealMax - minConnection) / (maxConnection - minConnection)) * innerHeight;
  const idealBandHeight = idealMinY - idealMaxY;

  const yAxisSteps = 4;
  const gridLines = Array.from({ length: yAxisSteps + 1 }, (_, i) => {
    const value = minConnection + (i * (maxConnection - minConnection)) / yAxisSteps;
    const y = padding.top + innerHeight - (i / yAxisSteps) * innerHeight;
    return { y, value };
  });

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <View style={styles.chartContainer}>
      <Svg width={chartWidth} height={chartHeight}>
        <Rect x={padding.left} y={padding.top} width={innerWidth} height={innerHeight} fill="rgba(0,0,0,0.3)" stroke={COLORS.gray700} strokeWidth={1} rx={4} />

        {gridLines.map((line, i) => (
          <G key={i}>
            <Line x1={padding.left} y1={line.y} x2={padding.left + innerWidth} y2={line.y} stroke={COLORS.gray700} strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
            <SvgText x={padding.left - 6} y={line.y + 4} textAnchor="end" fontSize={9} fill={COLORS.gray500}>{Math.round(line.value)}°</SvgText>
          </G>
        ))}

        <Rect x={padding.left} y={idealMaxY} width={innerWidth} height={idealBandHeight} fill={COLORS.primary} opacity={0.08} />

        <Path d={connectionAtImpactLinePath} fill="none" stroke={COLORS.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {connectionAtImpactPoints.map((point, i) => (
          <Circle key={`conn-impact-${i}`} cx={point.x} cy={point.y} r={selectedPoint?.x === point.x && selectedPoint?.type === 'impact' ? 6 : 4} fill={COLORS.primary} stroke={COLORS.primaryDark} strokeWidth={2} />
        ))}

        <Path d={earlyConnectionLinePath} fill="none" stroke={COLORS.gray400} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6,3" />

        {earlyConnectionPoints.map((point, i) => (
          <Circle key={`early-conn-${i}`} cx={point.x} cy={point.y} r={selectedPoint?.x === point.x && selectedPoint?.type === 'early' ? 6 : 4} fill={COLORS.gray400} stroke={COLORS.gray500} strokeWidth={2} />
        ))}

        <SvgText x={chartWidth / 2} y={chartHeight - 6} textAnchor="middle" fontSize={10} fill={COLORS.gray500}>Sessions</SvgText>
      </Svg>

      {/* Touch targets for impact points */}
      {connectionAtImpactPoints.map((point, i) => (
        <TouchableOpacity
          key={`impact-touch-${i}`}
          style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
          onPress={() => setSelectedPoint(selectedPoint?.x === point.x && selectedPoint?.type === 'impact' ? null : { ...point, type: 'impact' })}
        />
      ))}

      {/* Touch targets for early points */}
      {earlyConnectionPoints.map((point, i) => (
        <TouchableOpacity
          key={`early-touch-${i}`}
          style={[styles.touchTarget, { left: point.x - 15, top: point.y - 15 }]}
          onPress={() => setSelectedPoint(selectedPoint?.x === point.x && selectedPoint?.type === 'early' ? null : { ...point, type: 'early' })}
        />
      ))}

      {/* Tooltip */}
      {selectedPoint && (
        <Tooltip
          x={selectedPoint.x}
          y={selectedPoint.y}
          value={`${selectedPoint.value.toFixed(1)}°`}
          label={selectedPoint.type === 'impact' ? 'At Impact' : 'Early'}
          date={formatDate(selectedPoint.date)}
          color={selectedPoint.type === 'impact' ? COLORS.primary : COLORS.gray400}
        />
      )}

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.primary }]} />
          <Text style={styles.legendText}>At Impact</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: COLORS.gray400 }]} />
          <Text style={styles.legendText}>Early</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBox, { backgroundColor: 'rgba(155, 221, 255, 0.15)', borderColor: COLORS.primary }]} />
          <Text style={styles.legendText}>Ideal</Text>
        </View>
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
  prValueSmall: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.gray400,
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
    position: 'relative',
  },
  emptyChartText: {
    color: COLORS.gray400,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 32,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 8,
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
  legendBox: {
    width: 12,
    height: 8,
    borderRadius: 2,
    borderWidth: 1,
  },
  legendText: {
    fontSize: 10,
    color: COLORS.gray400,
  },
  tableContainer: {
    marginTop: 8,
  },
  table: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  tableHeaderText: {
    fontSize: 9,
    fontWeight: '600',
    color: COLORS.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.03)',
  },
  tableRowEven: {
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  tableCell: {
    fontSize: 12,
    color: COLORS.gray300,
    textAlign: 'center',
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
});
