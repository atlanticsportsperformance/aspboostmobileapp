import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Line, Path, Text as SvgText, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { getOrgIdForAthlete } from '../lib/orgSecurity';
import { useAthlete } from '../contexts/AthleteContext';
import FABMenu from '../components/FABMenu';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface RadarDataPoint {
  name: string;
  displayName: string;
  unit: string;
  testType: string;
  current: {
    percentile: number;
    value: number;
    date: string;
  } | null;
  previous: {
    percentile: number;
    value: number;
    date: string;
  } | null;
}

interface PredictedVelocity {
  predicted_value: number;
  predicted_value_low?: number;
  predicted_value_high?: number;
}

// Metric display map
const METRIC_DISPLAY_MAP: Record<string, { displayName: string; unit: string }> = {
  'imtp|net_peak_vertical_force_trial_value': { displayName: 'IMTP Net Force', unit: 'N' },
  'imtp|relative_strength_trial_value': { displayName: 'IMTP Relative', unit: '' },
  'sj|peak_takeoff_power_trial_value': { displayName: 'SJ Power', unit: 'W' },
  'cmj|bodymass_relative_takeoff_power_trial_value': { displayName: 'CMJ Power/BW', unit: 'W/kg' },
  'ppu|peak_takeoff_force_trial_value': { displayName: 'PPU Force', unit: 'N' },
  'hj|hop_mean_rsi_trial_value': { displayName: 'HJ RSI', unit: '' },
};

// Hardcoded default config
const DEFAULT_COMPOSITE_CONFIG = {
  metrics: [
    { test_type: 'imtp', metric: 'net_peak_vertical_force_trial_value', weight: 1 },
    { test_type: 'imtp', metric: 'relative_strength_trial_value', weight: 1 },
    { test_type: 'sj', metric: 'peak_takeoff_power_trial_value', weight: 1 },
    { test_type: 'cmj', metric: 'bodymass_relative_takeoff_power_trial_value', weight: 1 },
    { test_type: 'ppu', metric: 'peak_takeoff_force_trial_value', weight: 1 },
    { test_type: 'hj', metric: 'hop_mean_rsi_trial_value', weight: 1 },
  ],
};

// Zone helpers
const getZoneColor = (percentile: number) => {
  if (percentile >= 75) return '#4ADE80';
  if (percentile >= 50) return '#9BDDFF';
  if (percentile >= 25) return '#FCD34D';
  return '#EF4444';
};

const getZoneLabel = (percentile: number) => {
  if (percentile >= 75) return 'ELITE';
  if (percentile >= 50) return 'OPTIMIZE';
  if (percentile >= 25) return 'SHARPEN';
  return 'BUILD';
};

const getZoneBgColor = (percentile: number) => {
  if (percentile >= 75) return 'rgba(74, 222, 128, 0.2)';
  if (percentile >= 50) return 'rgba(155, 221, 255, 0.2)';
  if (percentile >= 25) return 'rgba(252, 211, 77, 0.2)';
  return 'rgba(239, 68, 68, 0.2)';
};

export default function ForceProfileScreen({ route, navigation }: any) {
  const { isParent, linkedAthletes } = useAthlete();
  const { athleteId } = route.params || {};

  // Guard: If parent arrives without athleteId, go back (they should use FAB which passes athleteId)
  useEffect(() => {
    if (isParent && !athleteId && linkedAthletes.length > 0) {
      navigation.goBack();
    }
  }, [isParent, athleteId, linkedAthletes]);
  const [loading, setLoading] = useState(true);
  const [radarData, setRadarData] = useState<RadarDataPoint[]>([]);
  const [compositeScore, setCompositeScore] = useState<number | null>(null);
  const [metricsInfo, setMetricsInfo] = useState<{ included: number; requested: number }>({ included: 0, requested: 6 });
  const [latestPrediction, setLatestPrediction] = useState<PredictedVelocity | null>(null);
  const [athleteName, setAthleteName] = useState('');
  const [playLevel, setPlayLevel] = useState('');

  // FAB state and data presence (matching DashboardScreen exactly)
  const [fabOpen, setFabOpen] = useState(false);
  const [hasHittingData, setHasHittingData] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasArmCareData, setHasArmCareData] = useState(false);
  const [hasMocapData, setHasMocapData] = useState(false);
  const [hasResourcesData, setHasResourcesData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [newResourcesCount, setNewResourcesCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchForceProfileData();
    fetchFabData();
  }, [athleteId]);

  // Fetch data for FAB menu (matching DashboardScreen exactly)
  async function fetchFabData() {
    try {
      // Get user session
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      // Get org_id for security filtering
      const orgId = await getOrgIdForAthlete(athleteId);
      if (!orgId) {
        console.error('[ForceProfileScreen] No org_id found for athlete');
        return;
      }

      // Check for hitting data (Blast + HitTrax)
      const [blastSwings, hittraxSessions] = await Promise.all([
        supabase.from('blast_swings').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
        supabase.from('hittrax_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
      ]);
      setHasHittingData((blastSwings.count || 0) > 0 || (hittraxSessions.count || 0) > 0);

      // Check for pitching data (TrackMan + Command)
      const [trackmanPitches, commandSessions] = await Promise.all([
        supabase.from('trackman_pitch_data').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
        supabase.from('command_training_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
      ]);
      setHasPitchingData((trackmanPitches.count || 0) > 0 || (commandSessions.count || 0) > 0);

      // Check for arm care data
      const { count: armCareCount } = await supabase
        .from('armcare_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasArmCareData((armCareCount || 0) > 0);

      // Check for mocap data
      const { count: mocapCount } = await supabase
        .from('mocap_pitches')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteId)
        .not('r2_uploaded_at', 'is', null);
      setHasMocapData((mocapCount || 0) > 0);

      // Check for resources data
      const { count: resourcesCount } = await supabase
        .from('resources')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('athlete_id', user.id);
      setHasResourcesData((resourcesCount || 0) > 0);

      // Count NEW resources (created after last viewed)
      const { data: athleteWithLastViewed } = await supabase
        .from('athletes')
        .select('last_viewed_resources_at')
        .eq('id', athleteId)
        .single();

      if (athleteWithLastViewed?.last_viewed_resources_at) {
        const { count: newCount } = await supabase
          .from('resources')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('athlete_id', user.id)
          .gt('created_at', athleteWithLastViewed.last_viewed_resources_at);
        setNewResourcesCount(newCount || 0);
      } else {
        setNewResourcesCount(resourcesCount || 0);
      }

      // Count unread messages
      const { count: unreadCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', user.id)
        .eq('read', false);
      setUnreadMessagesCount(unreadCount || 0);
    } catch (err) {
      console.error('Error fetching FAB data:', err);
    }
  }

  function getMetricDisplayName(testType: string, metric: string): string {
    const displayMap: Record<string, string> = {
      'imtp|net_peak_vertical_force_trial_value': 'IMTP Net Force',
      'imtp|relative_strength_trial_value': 'IMTP Relative',
      'sj|peak_takeoff_power_trial_value': 'SJ Power',
      'cmj|bodymass_relative_takeoff_power_trial_value': 'CMJ Power/BW',
      'ppu|peak_takeoff_force_trial_value': 'PPU Force',
      'hj|hop_mean_rsi_trial_value': 'HJ RSI',
    };
    return displayMap[`${testType}|${metric}`] || metric.replace('_trial_value', '').replace(/_/g, ' ');
  }

  async function fetchForceProfileData() {
    try {
      setLoading(true);

      const { data: athlete } = await supabase
        .from('athletes')
        .select('first_name, last_name, org_id, play_level')
        .eq('id', athleteId)
        .single();

      if (athlete) {
        setAthleteName(`${athlete.first_name} ${athlete.last_name}`);
        setPlayLevel(athlete.play_level || '');
      }

      if (!athlete?.org_id) {
        setLoading(false);
        return;
      }

      // Get composite config
      let { data: compositeConfig } = await supabase
        .from('composite_score_configs')
        .select('*')
        .eq('org_id', athlete.org_id)
        .eq('is_default', true)
        .limit(1)
        .maybeSingle();

      if (!compositeConfig) {
        const { data: anyConfig } = await supabase
          .from('composite_score_configs')
          .select('*')
          .eq('org_id', athlete.org_id)
          .limit(1)
          .maybeSingle();
        compositeConfig = anyConfig;
      }

      if (!compositeConfig) {
        compositeConfig = DEFAULT_COMPOSITE_CONFIG;
      }

      const metrics = compositeConfig.metrics || [];
      const percentiles: Array<{
        name: string;
        percentile: number;
        value: number;
        test_type: string;
        metric: string;
        date: string;
        previous?: { percentile: number; value: number; date: string };
      }> = [];

      for (const metricSpec of metrics) {
        const { data: currentData } = await supabase
          .from('force_plate_percentiles')
          .select('test_id, test_date, percentiles')
          .eq('athlete_id', athleteId)
          .eq('test_type', metricSpec.test_type)
          .order('test_date', { ascending: false })
          .limit(2);

        if (!currentData || currentData.length === 0) continue;

        const currentSnapshot = currentData[0];
        const metricPercentile = currentSnapshot.percentiles?.[metricSpec.metric];

        if (typeof metricPercentile !== 'number' || isNaN(metricPercentile)) continue;

        let rawValue = 0;
        const { data: testData } = await supabase
          .from(`${metricSpec.test_type}_tests`)
          .select(metricSpec.metric)
          .eq('test_id', currentSnapshot.test_id)
          .single();

        if (testData && testData[metricSpec.metric] !== undefined) {
          rawValue = Number(testData[metricSpec.metric]) || 0;
        }

        let previous = undefined;
        if (currentData.length > 1) {
          const prevSnapshot = currentData[1];
          const prevPercentile = prevSnapshot.percentiles?.[metricSpec.metric];
          if (typeof prevPercentile === 'number') {
            const { data: prevTestData } = await supabase
              .from(`${metricSpec.test_type}_tests`)
              .select(metricSpec.metric)
              .eq('test_id', prevSnapshot.test_id)
              .single();

            previous = {
              percentile: prevPercentile,
              value: Number(prevTestData?.[metricSpec.metric]) || 0,
              date: prevSnapshot.test_date,
            };
          }
        }

        percentiles.push({
          name: getMetricDisplayName(metricSpec.test_type, metricSpec.metric),
          percentile: Math.round(metricPercentile),
          value: rawValue,
          test_type: metricSpec.test_type,
          metric: metricSpec.metric,
          date: currentSnapshot.test_date,
          previous,
        });
      }

      if (percentiles.length === 0) {
        setRadarData([]);
        setCompositeScore(null);
        setLoading(false);
        return;
      }

      const data: RadarDataPoint[] = percentiles.map((p) => ({
        name: p.metric,
        displayName: p.name,
        unit: METRIC_DISPLAY_MAP[`${p.test_type}|${p.metric}`]?.unit || '',
        testType: p.test_type,
        current: { percentile: p.percentile, value: p.value, date: p.date },
        previous: p.previous || null,
      }));

      setRadarData(data);
      setMetricsInfo({ included: percentiles.length, requested: metrics.length });

      const avgPercentile = Math.round(
        (percentiles.reduce((sum, p) => sum + p.percentile, 0) / percentiles.length) * 10
      ) / 10;
      setCompositeScore(avgPercentile);

      // Get prediction
      const { data: prediction } = await supabase
        .from('predictions')
        .select('predicted_value, predicted_value_low, predicted_value_high')
        .eq('athlete_id', athleteId)
        .order('predicted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prediction) {
        setLatestPrediction(prediction);
      }
    } catch (err) {
      console.error('Error fetching force profile:', err);
    } finally {
      setLoading(false);
    }
  }

  const availableMetrics = radarData.filter((m) => m.current !== null);
  const hasFullComposite = metricsInfo.included === metricsInfo.requested;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
          <Text style={styles.loadingText}>Loading force profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Force Profile</Text>
          <Text style={styles.headerSubtitle}>{athleteName}</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {availableMetrics.length === 0 ? (
          <View style={styles.noDataContainer}>
            <Ionicons name="warning" size={48} color="#FCD34D" />
            <Text style={styles.noDataTitle}>No Force Profile Data</Text>
            <Text style={styles.noDataText}>
              Complete force plate tests (SJ, HJ, PPU, IMTP) to view your Force Profile.
            </Text>
          </View>
        ) : (
          <>
            {/* Partial Metrics Banner */}
            {!hasFullComposite && (
              <View style={styles.partialBanner}>
                <Ionicons name="information-circle" size={18} color="#60A5FA" />
                <View style={styles.partialBannerText}>
                  <Text style={styles.partialTitle}>
                    Partial Composite ({metricsInfo.included} of {metricsInfo.requested} metrics)
                  </Text>
                  <Text style={styles.partialSubtitle}>
                    Complete more tests to get your full score
                  </Text>
                </View>
              </View>
            )}

            {/* Zone Badge Header */}
            {compositeScore !== null && hasFullComposite && (
              <View style={styles.zoneHeader}>
                <View style={[styles.zoneBadge, { backgroundColor: getZoneBgColor(compositeScore) }]}>
                  <Text style={[styles.zoneBadgeText, { color: getZoneColor(compositeScore) }]}>
                    {getZoneLabel(compositeScore)}
                  </Text>
                </View>
                <Text style={styles.zoneDescription}>
                  Force production analysis vs {playLevel || 'peer'} athletes
                </Text>
              </View>
            )}

            {/* Main Radar Section — no container box */}
            {compositeScore !== null && availableMetrics.length >= 3 && (
              <View style={{ marginBottom: 24 }}>
                {/* Stats row above chart */}
                <View style={styles.radarStatsRow}>
                  {/* Predicted Velocity */}
                  {latestPrediction ? (
                    <View>
                      <Text style={styles.predictedVeloValue}>
                        {latestPrediction.predicted_value.toFixed(1)}
                        <Text style={styles.predictedVeloUnit}> mph</Text>
                      </Text>
                      <View style={styles.predictedVeloLabel}>
                        <Text style={styles.predictedVeloLabelText}>Predicted Velo</Text>
                        <View style={styles.betaBadge}>
                          <Text style={styles.betaBadgeText}>BETA</Text>
                        </View>
                      </View>
                      {latestPrediction.predicted_value_low && latestPrediction.predicted_value_high && (
                        <Text style={styles.predictedVeloRange}>
                          Range: {latestPrediction.predicted_value_low.toFixed(1)}-{latestPrediction.predicted_value_high.toFixed(1)} mph
                        </Text>
                      )}
                    </View>
                  ) : <View />}

                  {/* Composite Score */}
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.compositeValue, { color: getZoneColor(compositeScore) }]}>
                      {Math.round(compositeScore)}
                    </Text>
                    <Text style={styles.compositeLabel}>Composite</Text>
                  </View>
                </View>

                {/* Radar Chart — floats on background */}
                <RadarChart data={availableMetrics} />

                {/* Legend */}
                <View style={styles.radarLegend}>
                  <View style={styles.legendItem}>
                    <View style={styles.legendDotCurrent} />
                    <Text style={styles.legendText}>Current</Text>
                  </View>
                  {availableMetrics.some((m) => m.previous) && (
                    <View style={styles.legendItem}>
                      <View style={styles.legendLineDashed} />
                      <Text style={styles.legendText}>Previous</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Individual Metrics */}
            <Text style={styles.sectionTitle}>Individual Metrics</Text>
            {availableMetrics.map((metric, index) => (
              <MetricRow
                key={metric.name}
                metric={metric}
                delay={index * 120}
                onPress={() => {
                  navigation.navigate('TestDetail', { athleteId, testType: metric.testType });
                }}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* FAB Menu */}
      <FABMenu
        isOpen={fabOpen}
        onToggle={() => setFabOpen(!fabOpen)}
        totalBadgeCount={unreadMessagesCount + newResourcesCount}
        items={[
          { id: 'home', label: 'Home', icon: 'home', onPress: () => navigation.navigate(isParent ? 'ParentDashboard' : 'Dashboard') },
          { id: 'messages', label: 'Messages', icon: 'chatbubble', badge: unreadMessagesCount, onPress: () => navigation.navigate('Messages') },
          { id: 'performance', label: 'Performance', icon: 'stats-chart', onPress: () => navigation.navigate('Performance', { athleteId }) },
          ...(hasHittingData ? [{ id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('HittingPerformance', { athleteId }) }] : []),
          ...(hasPitchingData ? [{ id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('PitchingPerformance', { athleteId }) }] : []),
          ...(hasMocapData ? [{ id: 'mocap', label: 'Motion Capture', icon: 'body', onPress: () => navigation.navigate('MocapSessions', { athleteId }) }] : []),
          ...(hasArmCareData ? [{ id: 'armcare', label: 'Arm Care', icon: 'arm-flex', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('ArmCare', { athleteId }) }] : []),
          { id: 'force', label: 'Force Profile', icon: 'lightning-bolt', iconFamily: 'material-community' as const, isActive: true, onPress: () => setFabOpen(false) },
          { id: 'resources', label: 'Notes/Resources', icon: 'document-text', badge: newResourcesCount, onPress: () => navigation.navigate('Resources', { athleteId }) },
          { id: 'book', label: 'Book a Class', icon: 'calendar', isBookButton: true, onPress: () => navigation.navigate('Booking') },
        ]}
      />
    </SafeAreaView>
  );
}

// Radar Chart Component — mocap-style layered animation
function RadarChart({ data }: { data: RadarDataPoint[] }) {
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const size = SCREEN_WIDTH - 48;
  const center = size / 2;
  const padding = 45;
  const maxRadius = (size / 2) - padding;

  const angleStep = (2 * Math.PI) / data.length;

  // Animation values — staggered reveal from center outward
  const gridScale = useRef(new Animated.Value(0)).current;
  const axisOpacity = useRef(new Animated.Value(0)).current;
  const polygonScale = useRef(new Animated.Value(0)).current;
  const dotsOpacity = useRef(new Animated.Value(0)).current;
  const labelsOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(gridScale, { toValue: 1, duration: 600, delay: 100, useNativeDriver: true }).start();
    Animated.timing(axisOpacity, { toValue: 1, duration: 400, delay: 300, useNativeDriver: true }).start();
    Animated.timing(polygonScale, { toValue: 1, duration: 500, delay: 500, useNativeDriver: true }).start();
    Animated.timing(dotsOpacity, { toValue: 1, duration: 400, delay: 700, useNativeDriver: true }).start();
    Animated.timing(labelsOpacity, { toValue: 1, duration: 500, delay: 800, useNativeDriver: true }).start();
  }, []);

  // Build path strings
  const currentPath = data
    .map((d, i) => {
      const angle = angleStep * i - Math.PI / 2;
      const radius = ((d.current?.percentile || 0) / 100) * maxRadius;
      const x = center + radius * Math.cos(angle);
      const y = center + radius * Math.sin(angle);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ') + ' Z';

  const previousPath = data.some(d => d.previous)
    ? data
        .map((d, i) => {
          const angle = angleStep * i - Math.PI / 2;
          const radius = ((d.previous?.percentile || 0) / 100) * maxRadius;
          const x = center + radius * Math.cos(angle);
          const y = center + radius * Math.sin(angle);
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ') + ' Z'
    : null;

  // Point positions for touch targets + tooltip
  const pointPositions = data.map((d, i) => {
    if (!d.current) return null;
    const angle = angleStep * i - Math.PI / 2;
    const radius = (d.current.percentile / 100) * maxRadius;
    return {
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
    };
  });

  const selectedData = selectedPoint !== null ? data[selectedPoint] : null;
  const selectedPosition = selectedPoint !== null ? pointPositions[selectedPoint] : null;

  const vb = `0 0 ${size} ${size}`;

  return (
    <View style={[styles.radarChartContainer, { width: size, height: size }]}>
      {/* Layer 1 — Grid rings (scale from center) */}
      <Animated.View style={[styles.radarSvgLayer, { transform: [{ scale: gridScale }] }]}>
        <Svg width={size} height={size} viewBox={vb}>
          {[25, 50, 75, 100].map(p => {
            const r = (p / 100) * maxRadius;
            return (
              <Circle
                key={`grid-${p}`}
                cx={center}
                cy={center}
                r={r}
                fill="none"
                stroke={p === 50 ? 'rgba(255,255,255,0.40)' : p === 75 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.20)'}
                strokeWidth={p === 50 ? 2 : 1}
                strokeDasharray={p === 100 ? '4 4' : undefined}
              />
            );
          })}
        </Svg>
      </Animated.View>

      {/* Layer 2 — Axis lines (fade in) */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: axisOpacity }]}>
        <Svg width={size} height={size} viewBox={vb}>
          {data.map((_, i) => {
            const angle = angleStep * i - Math.PI / 2;
            return (
              <Line
                key={`axis-${i}`}
                x1={center}
                y1={center}
                x2={center + maxRadius * 1.05 * Math.cos(angle)}
                y2={center + maxRadius * 1.05 * Math.sin(angle)}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1}
              />
            );
          })}
        </Svg>
      </Animated.View>

      {/* Layer 3 — Polygons (scale from center) */}
      <Animated.View style={[styles.radarSvgLayer, { transform: [{ scale: polygonScale }] }]}>
        <Svg width={size} height={size} viewBox={vb}>
          <Defs>
            <SvgLinearGradient id="fpRadarGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#9BDDFF" stopOpacity="0.45" />
              <Stop offset="1" stopColor="#9BDDFF" stopOpacity="0.12" />
            </SvgLinearGradient>
          </Defs>
          {/* Previous polygon (dashed) */}
          {previousPath && (
            <Path
              d={previousPath}
              fill="none"
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1.5}
              strokeDasharray="5,5"
            />
          )}
          {/* Current polygon */}
          <Path
            d={currentPath}
            fill="url(#fpRadarGrad)"
            stroke="#9BDDFF"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>

      {/* Layer 4 — Touch targets only (no visible dots) */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: dotsOpacity }]} />

      {/* Layer 5 — Labels (fade in) */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: labelsOpacity }]}>
        <Svg width={size} height={size} viewBox={vb}>
          {data.map((d, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const labelRadius = maxRadius + 25;
            const x = center + labelRadius * Math.cos(angle);
            const y = center + labelRadius * Math.sin(angle);
            return (
              <SvgText
                key={`label-${i}`}
                x={x}
                y={y}
                fill="rgba(255,255,255,0.6)"
                fontSize={10}
                fontWeight="600"
                textAnchor="middle"
                alignmentBaseline="middle"
              >
                {d.displayName}
              </SvgText>
            );
          })}
        </Svg>
      </Animated.View>

      {/* Touch targets for data points */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: dotsOpacity }]}>
        {pointPositions.map((pos, i) => {
          if (!pos) return null;
          return (
            <TouchableOpacity
              key={`touch-${i}`}
              style={{
                position: 'absolute',
                left: pos.x - 20,
                top: pos.y - 20,
                width: 40,
                height: 40,
                borderRadius: 20,
              }}
              onPress={() => setSelectedPoint(selectedPoint === i ? null : i)}
              activeOpacity={0.7}
            />
          );
        })}
      </Animated.View>

      {/* Tooltip */}
      {selectedData && selectedPosition && selectedData.current && (
        <View
          style={[
            styles.radarTooltip,
            {
              left: Math.min(Math.max(selectedPosition.x - 80, 10), size - 170),
              top: selectedPosition.y > center ? selectedPosition.y - 95 : selectedPosition.y + 20,
            },
          ]}
        >
          <View
            style={[
              styles.radarTooltipArrow,
              selectedPosition.y > center
                ? { bottom: -6, top: 'auto' as any, transform: [{ rotate: '180deg' }] }
                : { top: -6 },
              { left: Math.min(Math.max(selectedPosition.x - (Math.min(Math.max(selectedPosition.x - 80, 10), size - 170)) - 6, 10), 140) },
            ]}
          />
          <View style={styles.radarTooltipHeader}>
            <Text style={styles.radarTooltipTitle}>{selectedData.displayName}</Text>
            <TouchableOpacity onPress={() => setSelectedPoint(null)} style={styles.radarTooltipClose}>
              <Ionicons name="close" size={14} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
          <View style={styles.radarTooltipRow}>
            <View style={styles.radarTooltipCol}>
              <Text style={styles.radarTooltipLabel}>Percentile</Text>
              <Text style={[styles.radarTooltipValue, { color: getZoneColor(selectedData.current.percentile) }]}>
                {selectedData.current.percentile}th
              </Text>
            </View>
            <View style={styles.radarTooltipCol}>
              <Text style={styles.radarTooltipLabel}>Raw Value</Text>
              <Text style={styles.radarTooltipValue}>
                {selectedData.current.value.toFixed(1)}{selectedData.unit ? ` ${selectedData.unit}` : ''}
              </Text>
            </View>
          </View>
          <View style={[styles.radarTooltipZoneBadge, { backgroundColor: getZoneBgColor(selectedData.current.percentile), borderColor: getZoneColor(selectedData.current.percentile) + '50' }]}>
            <Text style={[styles.radarTooltipZoneText, { color: getZoneColor(selectedData.current.percentile) }]}>
              {getZoneLabel(selectedData.current.percentile)}
            </Text>
          </View>
          {selectedData.previous && (
            <View style={styles.radarTooltipChange}>
              <Ionicons
                name={selectedData.current.percentile > selectedData.previous.percentile ? 'arrow-up' : selectedData.current.percentile < selectedData.previous.percentile ? 'arrow-down' : 'remove'}
                size={12}
                color={selectedData.current.percentile > selectedData.previous.percentile ? '#4ADE80' : selectedData.current.percentile < selectedData.previous.percentile ? '#EF4444' : '#9CA3AF'}
              />
              <Text style={[
                styles.radarTooltipChangeText,
                { color: selectedData.current.percentile > selectedData.previous.percentile ? '#4ADE80' : selectedData.current.percentile < selectedData.previous.percentile ? '#EF4444' : '#9CA3AF' }
              ]}>
                {Math.abs(selectedData.current.percentile - selectedData.previous.percentile)} pts from previous
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Tap hint */}
      <Animated.View style={[styles.radarSvgLayer, { opacity: labelsOpacity, bottom: -20, top: undefined }]}>
        {selectedPoint === null && (
          <Text style={styles.radarTapHint}>Tap a data point for details</Text>
        )}
      </Animated.View>
    </View>
  );
}

// Metric Row — mocap-style full-width animated row
function MetricRow({ metric, delay, onPress }: { metric: RadarDataPoint; delay: number; onPress?: () => void }) {
  const { current, previous, displayName, unit } = metric;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const barAnim = useRef(new Animated.Value(0)).current;
  const accentHeight = useRef(new Animated.Value(0)).current;

  if (!current) return null;

  const color = getZoneColor(current.percentile);
  const zone = getZoneLabel(current.percentile);
  const change = previous ? current.percentile - previous.percentile : 0;

  const getDescription = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('sj') && lower.includes('power')) return 'Explosive strength';
    if (lower.includes('hj') && lower.includes('rsi')) return 'Reactive power';
    if (lower.includes('ppu') && lower.includes('force')) return 'Plyo push power';
    if (lower.includes('imtp') && lower.includes('force')) return 'Raw strength';
    if (lower.includes('cmj') && lower.includes('power')) return 'Dynamic power';
    if (lower.includes('relative')) return 'Strength/BW';
    return 'Force metric';
  };

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.spring(fadeAnim, { toValue: 1, damping: 20, stiffness: 90, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, damping: 20, stiffness: 90, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(barAnim, { toValue: Math.max(current.percentile, 2), damping: 14, stiffness: 50, useNativeDriver: false }),
          Animated.spring(accentHeight, { toValue: 24, damping: 12, stiffness: 60, useNativeDriver: false }),
        ]).start();
      }, 200);
    }, delay);
    return () => clearTimeout(t);
  }, [delay, current.percentile]);

  const barWidth = barAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <Animated.View style={[styles.metricRow, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {/* Top line: hero percentile + raw value */}
        <View style={styles.metricTopLine}>
          <Text style={[styles.heroPercentile, { color }]}>{Math.round(current.percentile)}</Text>
          <Text style={styles.rawValueMono}>
            {current.value.toFixed(1)}
            <Text style={styles.rawUnitMono}> {unit}</Text>
          </Text>
        </View>

        {/* Metric name with accent bar */}
        <View style={styles.metricNameRow}>
          <Animated.View style={[styles.metricAccentBar, { height: accentHeight, backgroundColor: color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.metricRowName}>{displayName}</Text>
            <Text style={styles.metricRowDesc}>{getDescription(displayName)}</Text>
          </View>
          <View style={[styles.metricZonePill, { borderColor: color + '40' }]}>
            <Text style={[styles.metricZonePillText, { color }]}>{zone}</Text>
          </View>
        </View>

        {/* Current bar with P50 marker */}
        <View style={styles.metricBarRow}>
          <Text style={styles.metricBarLabel}>Now</Text>
          <View style={{ flex: 1 }}>
            <View style={styles.metricBarTrack}>
              <View style={styles.metricBarP50} />
              <Animated.View style={[styles.metricBarFill, { width: barWidth, backgroundColor: color }]} />
            </View>
          </View>
          <Text style={[styles.metricBarValue, { color }]}>{Math.round(current.percentile)}%</Text>
        </View>

        {/* Previous bar */}
        {previous && (
          <View style={styles.metricBarRow}>
            <Text style={styles.metricBarLabel}>Prev</Text>
            <View style={{ flex: 1 }}>
              <View style={styles.metricBarTrack}>
                <View style={styles.metricBarP50} />
                <View style={[styles.metricBarFillStatic, { width: `${previous.percentile}%`, backgroundColor: getZoneColor(previous.percentile) + '50' }]} />
              </View>
            </View>
            <Text style={styles.metricBarValuePrev}>{Math.round(previous.percentile)}%</Text>
          </View>
        )}

        {/* Change indicator */}
        {previous && change !== 0 && (
          <View style={styles.metricChangeRow}>
            <Ionicons
              name={change > 0 ? 'arrow-up' : 'arrow-down'}
              size={11}
              color={change > 0 ? '#4ADE80' : '#EF4444'}
            />
            <Text style={[styles.metricChangeText, { color: change > 0 ? '#4ADE80' : '#EF4444' }]}>
              {Math.round(Math.abs(change))} pts
            </Text>
          </View>
        )}

        {/* View History hint */}
        <View style={styles.metricViewHistory}>
          <Text style={styles.metricViewHistoryText}>View History</Text>
          <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.3)" />
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#9CA3AF',
    marginTop: 12,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  noDataContainer: {
    backgroundColor: 'rgba(252, 211, 77, 0.1)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(252, 211, 77, 0.2)',
  },
  noDataTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FCD34D',
    marginTop: 12,
  },
  noDataText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
  },
  partialBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.2)',
    gap: 10,
  },
  partialBannerText: {
    flex: 1,
  },
  partialTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#60A5FA',
  },
  partialSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  zoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  zoneBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  zoneBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  zoneDescription: {
    fontSize: 12,
    color: '#9CA3AF',
    flex: 1,
  },
  radarStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  radarSvgLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  predictedVeloValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#9BDDFF',
  },
  predictedVeloUnit: {
    fontSize: 20,
    fontWeight: '600',
  },
  predictedVeloLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  predictedVeloLabelText: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  betaBadge: {
    backgroundColor: 'rgba(96, 165, 250, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.4)',
  },
  betaBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#60A5FA',
    letterSpacing: 0.5,
  },
  predictedVeloRange: {
    fontSize: 9,
    color: '#6B7280',
    marginTop: 4,
  },
  compositeContainer: {
    alignItems: 'flex-end',
  },
  compositeValue: {
    fontSize: 48,
    fontWeight: '800',
  },
  compositeLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  radarChartContainer: {
    alignSelf: 'center',
  },
  radarTapHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 8,
    textAlign: 'center',
  },
  radarTooltip: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.95)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    minWidth: 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 100,
  },
  radarTooltipArrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(255,255,255,0.15)',
  },
  radarTooltipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  radarTooltipTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  radarTooltipClose: {
    padding: 2,
  },
  radarTooltipRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  radarTooltipCol: {
    flex: 1,
  },
  radarTooltipLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 2,
  },
  radarTooltipValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  radarTooltipZoneBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  radarTooltipZoneText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  radarTooltipChange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  radarTooltipChangeText: {
    fontSize: 10,
    fontWeight: '500',
  },
  radarLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDotCurrent: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5E7EB',
  },
  legendLineDashed: {
    width: 16,
    height: 2,
    backgroundColor: '#9CA3AF',
    borderStyle: 'dashed',
  },
  legendText: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  // Metric rows — mocap style
  metricRow: {
    marginBottom: 24,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  metricTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  heroPercentile: {
    fontSize: 32,
    fontWeight: '900',
  },
  rawValueMono: {
    fontSize: 14,
    fontFamily: 'Courier',
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  rawUnitMono: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
  },
  metricNameRow: {
    paddingLeft: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  metricAccentBar: {
    width: 2,
    borderRadius: 1,
    position: 'absolute' as const,
    left: 0,
    top: 0,
  },
  metricRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
  },
  metricRowDesc: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 1,
  },
  metricZonePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  metricZonePillText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metricBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  metricBarLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.35)',
    width: 28,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricBarValue: {
    fontSize: 11,
    fontWeight: '700',
    width: 32,
    textAlign: 'right',
  },
  metricBarValuePrev: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.35)',
    width: 32,
    textAlign: 'right',
  },
  metricBarFillStatic: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    borderRadius: 3,
  },
  metricBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    position: 'relative' as const,
    marginBottom: 8,
  },
  metricBarP50: {
    position: 'absolute' as const,
    left: '50%',
    top: 0,
    width: 2,
    height: '100%',
    backgroundColor: 'rgba(74,222,128,0.55)',
    zIndex: 10,
  },
  metricBarFill: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    borderRadius: 3,
  },
  metricChangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  metricChangeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  metricViewHistory: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
  },
  metricViewHistoryText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
  },
});
