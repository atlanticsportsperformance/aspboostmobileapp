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
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LeaderboardEntry {
  rank: number;
  athlete_id: string;
  athlete_name: string;
  play_level: string;
  value: number;
  unit: string;
  date: string;
  percentile?: number;
}

interface LeaderboardData {
  technology: string;
  play_level: string;
  time_period: string;
  metric: string;
  leaderboard: LeaderboardEntry[];
}

interface Technology {
  id: string;
  name: string;
  icon: string;
  iconType: 'ionicons' | 'materialcommunity';
  gradientColors: [string, string];
  color: string;
  hasDualColumns?: boolean;
  swingMetrics?: { value: string; label: string }[];
  battedBallMetrics?: { value: string; label: string }[];
  metrics?: { value: string; label: string }[];
}

const TECHNOLOGIES: Technology[] = [
  {
    id: 'hitting',
    name: 'Hitting',
    icon: 'crosshairs',
    iconType: 'materialcommunity',
    gradientColors: ['#F59E0B', '#EA580C'],
    color: '#FFB800',
    hasDualColumns: true,
    swingMetrics: [
      { value: 'bat_speed', label: 'Bat Speed' },
      { value: 'power', label: 'Power' },
      { value: 'on_plane_efficiency', label: 'On-Plane %' },
      { value: 'peak_hand_speed', label: 'Peak Hand Speed' },
      { value: 'attack_angle', label: 'Attack Angle' },
    ],
    battedBallMetrics: [
      { value: 'exit_velocity', label: 'Exit Velocity' },
      { value: 'distance', label: 'Distance' },
      { value: 'launch_angle', label: 'Launch Angle' },
      { value: 'hang_time', label: 'Hang Time' },
    ],
  },
  {
    id: 'pitching',
    name: 'Pitching',
    icon: 'baseball',
    iconType: 'materialcommunity',
    gradientColors: ['#EF4444', '#E11D48'],
    color: '#FF3B30',
    metrics: [
      { value: 'rel_speed', label: 'Velocity' },
      { value: 'stuff_plus', label: 'Stuff+' },
    ],
  },
  {
    id: 'force',
    name: 'Force',
    icon: 'flash',
    iconType: 'ionicons',
    gradientColors: ['#22D3EE', '#3B82F6'],
    color: '#9BDDFF',
    metrics: [
      { value: 'cmj_jump_height_trial_value', label: 'CMJ Jump Height' },
      { value: 'cmj_peak_takeoff_power_trial_value', label: 'CMJ Peak Power' },
      { value: 'sj_jump_height_trial_value', label: 'SJ Jump Height' },
      { value: 'sj_peak_takeoff_power_trial_value', label: 'SJ Peak Power' },
      { value: 'imtp_net_peak_vertical_force_trial_value', label: 'IMTP Net Peak Force' },
      { value: 'imtp_relative_strength_trial_value', label: 'IMTP Relative Strength' },
      { value: 'hj_hop_mean_rsi_trial_value', label: 'HJ Mean RSI' },
      { value: 'ppu_peak_takeoff_force_trial_value', label: 'PPU Takeoff Peak Force' },
    ],
  },
  {
    id: 'armcare',
    name: 'Arm Care',
    icon: 'trending-up',
    iconType: 'ionicons',
    gradientColors: ['#4ADE80', '#059669'],
    color: '#34C759',
    metrics: [
      { value: 'arm_score', label: 'Arm Score' },
      { value: 'total_strength', label: 'Total Strength' },
      { value: 'velo', label: 'Velocity' },
      { value: 'shoulder_balance', label: 'Shoulder Balance' },
      { value: 'trunk_balance', label: 'Trunk Balance' },
    ],
  },
];

const PLAY_LEVELS = [
  { value: '', label: 'All Levels', gradientColors: ['#4B5563', '#374151'] as [string, string] },
  { value: 'Youth', label: 'Youth', gradientColors: ['#EAB308', '#D97706'] as [string, string] },
  { value: 'High School', label: 'High School', gradientColors: ['#22C55E', '#059669'] as [string, string] },
  { value: 'College', label: 'College', gradientColors: ['#3B82F6', '#4F46E5'] as [string, string] },
  { value: 'Pro', label: 'Pro', gradientColors: ['#A855F7', '#7C3AED'] as [string, string] },
];

const TIME_PERIODS = [
  { value: 'all', label: 'All Time' },
  { value: 'year', label: 'This Year' },
  { value: 'month', label: 'This Month' },
  { value: 'week', label: 'This Week' },
  { value: 'day', label: 'Today' },
];

export default function LeaderboardScreen({ navigation }: any) {
  const [selectedTech, setSelectedTech] = useState('hitting');
  const [playLevel, setPlayLevel] = useState('');
  const [timePeriod, setTimePeriod] = useState('all');
  const [selectedSwingMetric, setSelectedSwingMetric] = useState('bat_speed');
  const [selectedBattedBallMetric, setSelectedBattedBallMetric] = useState('exit_velocity');
  const [selectedMetric, setSelectedMetric] = useState('rel_speed');
  const [swingData, setSwingData] = useState<LeaderboardData | null>(null);
  const [battedBallData, setBattedBallData] = useState<LeaderboardData | null>(null);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [athleteId, setAthleteId] = useState<string | null>(null);

  const currentTech = TECHNOLOGIES.find((t) => t.id === selectedTech)!;
  const currentLevel = PLAY_LEVELS.find((l) => l.value === playLevel) || PLAY_LEVELS[0];

  // Fetch user's org_id on mount
  useEffect(() => {
    async function loadUserData() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        // Get athlete data
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id, org_id')
          .eq('user_id', user.id)
          .single();

        if (athlete) {
          setAthleteId(athlete.id);
          setOrgId(athlete.org_id);
        }
      }
    }
    loadUserData();
  }, []);

  // Reset metric when switching technologies
  useEffect(() => {
    if (!currentTech.hasDualColumns && currentTech.metrics && currentTech.metrics.length > 0) {
      setSelectedMetric(currentTech.metrics[0].value);
    }
  }, [selectedTech]);

  // Fetch leaderboard data
  useEffect(() => {
    if (currentTech.hasDualColumns || (currentTech.metrics && currentTech.metrics.some((m) => m.value === selectedMetric))) {
      fetchLeaderboard();
    }
  }, [selectedTech, playLevel, timePeriod, selectedSwingMetric, selectedBattedBallMetric, selectedMetric, orgId]);

  async function fetchLeaderboard() {
    setLoading(true);
    try {
      if (currentTech.hasDualColumns) {
        const [swingRes, battedBallRes] = await Promise.all([
          fetchSingleLeaderboard('hitting', selectedSwingMetric),
          fetchSingleLeaderboard('batted-ball', selectedBattedBallMetric),
        ]);
        setSwingData(swingRes);
        setBattedBallData(battedBallRes);
      } else {
        const result = await fetchSingleLeaderboard(selectedTech, selectedMetric);
        setData(result);
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function fetchSingleLeaderboard(technology: string, metric: string): Promise<LeaderboardData> {
    // Build the API query parameters
    const params = new URLSearchParams({
      technology,
      time_period: timePeriod,
      metric,
      limit: '10',
    });

    if (playLevel) {
      params.append('play_level', playLevel);
    }

    if (orgId) {
      params.append('org_id', orgId);
    }

    // For mobile, we need to call the API through a web URL or implement the logic directly
    // Since we can't call the Next.js API directly, we'll implement the Supabase queries directly
    return await fetchLeaderboardFromSupabase(technology, metric, playLevel, timePeriod, orgId);
  }

  async function fetchLeaderboardFromSupabase(
    technology: string,
    metric: string,
    playLevelFilter: string,
    timePeriodFilter: string,
    orgIdFilter: string | null
  ): Promise<LeaderboardData> {
    // Calculate date filter
    let startDate: Date | null = null;
    const now = new Date();

    switch (timePeriodFilter) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
    }

    let leaderboard: LeaderboardEntry[] = [];

    switch (technology) {
      case 'hitting':
        leaderboard = await getHittingLeaderboard(metric, playLevelFilter, startDate, orgIdFilter);
        break;
      case 'batted-ball':
        leaderboard = await getBattedBallLeaderboard(metric, playLevelFilter, startDate, orgIdFilter);
        break;
      case 'pitching':
        leaderboard = await getPitchingLeaderboard(metric, playLevelFilter, startDate, orgIdFilter);
        break;
      case 'force':
        leaderboard = await getForceLeaderboard(metric, playLevelFilter, startDate, orgIdFilter);
        break;
      case 'armcare':
        leaderboard = await getArmCareLeaderboard(metric, playLevelFilter, startDate, orgIdFilter);
        break;
    }

    return {
      technology,
      play_level: playLevelFilter || 'all',
      time_period: timePeriodFilter,
      metric,
      leaderboard,
    };
  }

  async function getHittingLeaderboard(
    metric: string,
    playLevelFilter: string,
    startDate: Date | null,
    orgIdFilter: string | null
  ): Promise<LeaderboardEntry[]> {
    // Fetch all swings with athlete data in a single query
    let query = supabase
      .from('blast_swings')
      .select(`
        ${metric},
        recorded_date,
        athlete_id,
        athletes!inner (
          id,
          first_name,
          last_name,
          play_level,
          org_id
        )
      `)
      .not(metric, 'is', null)
      .in('swing_details', ['front toss overhand', 'front toss underhand', 'live pitch', 'pitching machine', 'in game'])
      .order(metric, { ascending: false })
      .limit(1000);

    if (playLevelFilter) {
      query = query.eq('athletes.play_level', playLevelFilter);
    }
    if (orgIdFilter) {
      query = query.eq('athletes.org_id', orgIdFilter);
    }
    if (startDate) {
      query = query.gte('recorded_date', startDate.toISOString().split('T')[0]);
    }

    const { data } = await query;
    if (!data || data.length === 0) return [];

    // Get best value per athlete using a Map
    const athleteMap = new Map<string, any>();
    data.forEach((swing: any) => {
      const athleteId = swing.athlete_id;
      const existing = athleteMap.get(athleteId);
      if (!existing || swing[metric] > existing[metric]) {
        athleteMap.set(athleteId, swing);
      }
    });

    // Sort and return top 10
    const sorted = Array.from(athleteMap.values())
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, 10);

    return sorted.map((entry, index) => ({
      rank: index + 1,
      athlete_id: entry.athlete_id,
      athlete_name: `${entry.athletes.first_name} ${entry.athletes.last_name}`,
      play_level: entry.athletes.play_level || '',
      value: entry[metric],
      unit: getMetricUnit(metric),
      date: entry.recorded_date,
    }));
  }

  async function getBattedBallLeaderboard(
    metric: string,
    playLevelFilter: string,
    startDate: Date | null,
    orgIdFilter: string | null
  ): Promise<LeaderboardEntry[]> {
    // Single query with joins through hittrax_sessions to get athlete info
    let query = supabase
      .from('hittrax_swings')
      .select(`
        ${metric},
        created_at,
        session_id,
        hittrax_sessions!inner (
          athlete_id,
          athletes!inner (
            id,
            first_name,
            last_name,
            play_level,
            org_id
          )
        )
      `)
      .not(metric, 'is', null)
      .order(metric, { ascending: false })
      .limit(1000);

    if (playLevelFilter) {
      query = query.eq('hittrax_sessions.athletes.play_level', playLevelFilter);
    }
    if (orgIdFilter) {
      query = query.eq('hittrax_sessions.athletes.org_id', orgIdFilter);
    }
    if (startDate) {
      query = query.gte('created_at', startDate.toISOString());
    }

    const { data } = await query;
    if (!data || data.length === 0) return [];

    // Get best value per athlete
    const athleteMap = new Map<string, any>();
    data.forEach((swing: any) => {
      const athleteId = swing.hittrax_sessions?.athlete_id;
      if (!athleteId) return;
      const existing = athleteMap.get(athleteId);
      if (!existing || swing[metric] > existing[metric]) {
        athleteMap.set(athleteId, swing);
      }
    });

    const sorted = Array.from(athleteMap.values())
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, 10);

    return sorted.map((entry, index) => ({
      rank: index + 1,
      athlete_id: entry.hittrax_sessions.athlete_id,
      athlete_name: `${entry.hittrax_sessions.athletes.first_name} ${entry.hittrax_sessions.athletes.last_name}`,
      play_level: entry.hittrax_sessions.athletes.play_level || '',
      value: entry[metric],
      unit: getMetricUnit(metric),
      date: entry.created_at,
    }));
  }

  async function getPitchingLeaderboard(
    metric: string,
    playLevelFilter: string,
    startDate: Date | null,
    orgIdFilter: string | null
  ): Promise<LeaderboardEntry[]> {
    // Single query with athlete join
    let query = supabase
      .from('trackman_pitch_data')
      .select(`
        ${metric},
        created_at,
        athlete_id,
        athletes!inner (
          id,
          first_name,
          last_name,
          play_level,
          org_id
        )
      `)
      .not(metric, 'is', null)
      .order(metric, { ascending: false })
      .limit(500);

    if (playLevelFilter) {
      query = query.eq('athletes.play_level', playLevelFilter);
    }
    if (orgIdFilter) {
      query = query.eq('athletes.org_id', orgIdFilter);
    }
    if (startDate) {
      query = query.gte('created_at', startDate.toISOString());
    }

    const { data } = await query;
    if (!data || data.length === 0) return [];

    // Get best value per athlete
    const athleteMap = new Map<string, any>();
    data.forEach((pitch: any) => {
      const athleteId = pitch.athlete_id;
      const existing = athleteMap.get(athleteId);
      if (!existing || pitch[metric] > existing[metric]) {
        athleteMap.set(athleteId, pitch);
      }
    });

    const sorted = Array.from(athleteMap.values())
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, 10);

    return sorted.map((entry, index) => ({
      rank: index + 1,
      athlete_id: entry.athlete_id,
      athlete_name: `${entry.athletes.first_name} ${entry.athletes.last_name}`,
      play_level: entry.athletes.play_level || '',
      value: entry[metric],
      unit: getMetricUnit(metric),
      date: entry.created_at,
    }));
  }

  async function getForceLeaderboard(
    metricKey: string,
    playLevelFilter: string,
    startDate: Date | null,
    orgIdFilter: string | null
  ): Promise<LeaderboardEntry[]> {
    const testType = metricKey.split('_')[0]; // e.g., cmj, sj, imtp
    const tableName = `${testType}_tests`;
    const metricName = metricKey.substring(testType.length + 1); // Remove prefix

    // Single query with athlete join
    let query = supabase
      .from(tableName)
      .select(`
        ${metricName},
        recorded_utc,
        athlete_id,
        athletes!inner (
          id,
          first_name,
          last_name,
          play_level,
          org_id
        )
      `)
      .not(metricName, 'is', null)
      .order(metricName, { ascending: false })
      .limit(500);

    if (playLevelFilter) {
      query = query.eq('athletes.play_level', playLevelFilter);
    }
    if (orgIdFilter) {
      query = query.eq('athletes.org_id', orgIdFilter);
    }
    if (startDate) {
      query = query.gte('recorded_utc', startDate.toISOString());
    }

    const { data } = await query;
    if (!data || data.length === 0) return [];

    // Get best value per athlete
    const athleteMap = new Map<string, any>();
    data.forEach((test: any) => {
      const athleteId = test.athlete_id;
      const existing = athleteMap.get(athleteId);
      if (!existing || test[metricName] > existing[metricName]) {
        athleteMap.set(athleteId, test);
      }
    });

    const sorted = Array.from(athleteMap.values())
      .sort((a, b) => b[metricName] - a[metricName])
      .slice(0, 10);

    return sorted.map((entry, index) => ({
      rank: index + 1,
      athlete_id: entry.athlete_id,
      athlete_name: `${entry.athletes.first_name} ${entry.athletes.last_name}`,
      play_level: entry.athletes.play_level || '',
      value: entry[metricName],
      unit: getMetricUnit(metricKey),
      date: entry.recorded_utc,
    }));
  }

  async function getArmCareLeaderboard(
    metric: string,
    playLevelFilter: string,
    startDate: Date | null,
    orgIdFilter: string | null
  ): Promise<LeaderboardEntry[]> {
    // Single query with athlete join - already optimized
    let query = supabase.from('armcare_sessions').select(`
        ${metric},
        exam_date,
        athlete_id,
        athletes!inner (
          first_name,
          last_name,
          play_level,
          org_id
        )
      `)
      .not(metric, 'is', null)
      .order(metric, { ascending: false })
      .limit(500);

    if (playLevelFilter) {
      query = query.eq('athletes.play_level', playLevelFilter);
    }

    if (orgIdFilter) {
      query = query.eq('athletes.org_id', orgIdFilter);
    }

    if (startDate) {
      query = query.gte('exam_date', startDate.toISOString());
    }

    const { data } = await query;
    if (!data || data.length === 0) return [];

    // Get best value per athlete
    const athleteMap = new Map<string, any>();
    data.forEach((session: any) => {
      const existing = athleteMap.get(session.athlete_id);
      if (!existing || session[metric] > existing[metric]) {
        athleteMap.set(session.athlete_id, session);
      }
    });

    const sorted = Array.from(athleteMap.values())
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, 10);

    return sorted.map((entry, index) => ({
      rank: index + 1,
      athlete_id: entry.athlete_id,
      athlete_name: `${entry.athletes.first_name} ${entry.athletes.last_name}`,
      play_level: entry.athletes.play_level || '',
      value: entry[metric],
      unit: getMetricUnit(metric),
      date: entry.exam_date,
    }));
  }

  function getMetricUnit(metric: string): string {
    const units: Record<string, string> = {
      bat_speed: 'mph',
      power: 'kW',
      on_plane_efficiency: '%',
      attack_angle: '\u00B0',
      vertical_bat_angle: '\u00B0',
      peak_hand_speed: 'mph',
      time_to_contact: 'ms',
      exit_velocity: 'mph',
      launch_angle: '\u00B0',
      distance: 'ft',
      hang_time: 's',
      rel_speed: 'mph',
      stuff_plus: '',
      spin_rate: 'rpm',
      cmj_jump_height_trial_value: 'cm',
      cmj_peak_takeoff_power_trial_value: 'W',
      sj_jump_height_trial_value: 'cm',
      sj_peak_takeoff_power_trial_value: 'W',
      imtp_net_peak_vertical_force_trial_value: 'N',
      imtp_relative_strength_trial_value: 'N/kg',
      hj_hop_mean_rsi_trial_value: 'RSI',
      ppu_peak_takeoff_force_trial_value: 'N',
      arm_score: '',
      total_strength: 'lbs',
      velo: 'mph',
      shoulder_balance: '',
      trunk_balance: '',
    };
    return units[metric] || '';
  }

  function getRankDisplay(rank: number) {
    if (rank === 1) {
      return (
        <View style={styles.rankCrown}>
          <View style={styles.rankCrownGlow} />
          <Ionicons name="trophy" size={32} color="#FFB800" />
        </View>
      );
    }
    if (rank === 2) {
      return (
        <View style={styles.rankMedal}>
          <Ionicons name="medal" size={28} color="#D1D5DB" />
        </View>
      );
    }
    if (rank === 3) {
      return (
        <View style={styles.rankMedal}>
          <Ionicons name="medal" size={28} color="#FB923C" />
        </View>
      );
    }
    return (
      <View style={styles.rankNumber}>
        <Text style={styles.rankNumberText}>{rank}</Text>
      </View>
    );
  }

  function getPlayLevelBadge(level: string) {
    const levelConfig = PLAY_LEVELS.find((l) => l.value === level);
    if (!levelConfig) return null;

    return (
      <LinearGradient colors={levelConfig.gradientColors} style={styles.playLevelBadge}>
        <Text style={styles.playLevelBadgeText}>{level}</Text>
      </LinearGradient>
    );
  }

  function renderTechIcon(tech: Technology, isActive: boolean) {
    const color = isActive ? tech.color : '#9CA3AF';
    const size = 20;

    if (tech.iconType === 'ionicons') {
      return <Ionicons name={tech.icon as any} size={size} color={color} />;
    }
    return <MaterialCommunityIcons name={tech.icon as any} size={size} color={color} />;
  }

  function CompactCard({ entry, tech }: { entry: LeaderboardEntry; tech: Technology }) {
    return (
      <View
        style={[
          styles.compactCard,
          entry.rank <= 3 && { shadowColor: tech.color, shadowOpacity: 0.3, shadowRadius: 8 },
        ]}
      >
        {entry.rank <= 3 && (
          <LinearGradient
            colors={[...tech.gradientColors.map((c) => c + '15')] as [string, string]}
            style={StyleSheet.absoluteFill}
          />
        )}

        <View style={styles.compactCardContent}>
          {/* Rank */}
          <View style={styles.compactCardRank}>{getRankDisplay(entry.rank)}</View>

          {/* Info */}
          <View style={styles.compactCardInfo}>
            <Text style={styles.compactCardName} numberOfLines={1}>
              {entry.athlete_name}
            </Text>
            <View style={styles.compactCardMeta}>
              {getPlayLevelBadge(entry.play_level)}
              <Text style={styles.compactCardDate}>
                {new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
            </View>
          </View>

          {/* Value */}
          <View style={styles.compactCardValue}>
            <Text style={[styles.compactCardValueText, { color: tech.color }]}>
              {entry.value.toFixed(1)}
            </Text>
            <Text style={styles.compactCardUnit}>{entry.unit}</Text>
          </View>
        </View>
      </View>
    );
  }

  function EmptyState({ message }: { message: string }) {
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyStateIcon}>
          <Ionicons name="trophy-outline" size={32} color="#4B5563" />
        </View>
        <Text style={styles.emptyStateText}>{message}</Text>
      </View>
    );
  }

  const onRefresh = () => {
    setRefreshing(true);
    fetchLeaderboard();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.headerTitle}>
            <View style={styles.headerTitleIcon}>
              <Ionicons name="trophy" size={20} color="#FFFFFF" />
            </View>
            <Text style={[styles.headerTitleText, { color: currentTech.color }]}>LEADERBOARD</Text>
          </View>

          <TouchableOpacity onPress={() => setShowFilters(!showFilters)} style={styles.filterButton}>
            <Ionicons name="options" size={20} color={showFilters ? '#FFFFFF' : '#9CA3AF'} />
          </TouchableOpacity>
        </View>

        {/* Tech Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.techTabs}>
          {TECHNOLOGIES.map((tech) => {
            const isActive = selectedTech === tech.id;
            return (
              <TouchableOpacity
                key={tech.id}
                onPress={() => setSelectedTech(tech.id)}
                style={[styles.techTab, isActive && styles.techTabActive]}
              >
                {isActive && (
                  <LinearGradient
                    colors={[...tech.gradientColors.map((c) => c + '20')] as [string, string]}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                {renderTechIcon(tech, isActive)}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Filters */}
        {showFilters && (
          <View style={styles.filtersContainer}>
            {/* Metric Selection */}
            {currentTech.hasDualColumns ? (
              <View style={styles.filterRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                  {currentTech.swingMetrics?.map((m) => (
                    <TouchableOpacity
                      key={m.value}
                      style={[styles.filterChip, selectedSwingMetric === m.value && styles.filterChipActive]}
                      onPress={() => setSelectedSwingMetric(m.value)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          selectedSwingMetric === m.value && styles.filterChipTextActive,
                        ]}
                      >
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <View style={styles.filterRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                  {currentTech.metrics?.map((m) => (
                    <TouchableOpacity
                      key={m.value}
                      style={[styles.filterChip, selectedMetric === m.value && styles.filterChipActive]}
                      onPress={() => setSelectedMetric(m.value)}
                    >
                      <Text
                        style={[styles.filterChipText, selectedMetric === m.value && styles.filterChipTextActive]}
                      >
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Play Level & Time Period */}
            <View style={styles.filterRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                {PLAY_LEVELS.map((level) => (
                  <TouchableOpacity
                    key={level.value}
                    style={[styles.filterChip, playLevel === level.value && styles.filterChipActive]}
                    onPress={() => setPlayLevel(level.value)}
                  >
                    <Text
                      style={[styles.filterChipText, playLevel === level.value && styles.filterChipTextActive]}
                    >
                      {level.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.filterRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                {TIME_PERIODS.map((period) => (
                  <TouchableOpacity
                    key={period.value}
                    style={[styles.filterChip, timePeriod === period.value && styles.filterChipActive]}
                    onPress={() => setTimePeriod(period.value)}
                  >
                    <Text
                      style={[styles.filterChipText, timePeriod === period.value && styles.filterChipTextActive]}
                    >
                      {period.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        )}
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9BDDFF" />}
        contentContainerStyle={styles.contentContainer}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={currentTech.color} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : currentTech.hasDualColumns ? (
          <View style={styles.dualColumns}>
            {/* Swing Metrics */}
            <View style={styles.column}>
              <Text style={styles.columnTitle}>Swing Metrics</Text>
              {swingData && swingData.leaderboard.length > 0 ? (
                swingData.leaderboard.map((entry, index) => (
                  <CompactCard key={`swing-${entry.athlete_id}-${index}`} entry={entry} tech={currentTech} />
                ))
              ) : (
                <EmptyState message="No swing data" />
              )}
            </View>

            {/* Batted Ball */}
            <View style={styles.column}>
              <Text style={styles.columnTitle}>Batted Ball</Text>
              {battedBallData && battedBallData.leaderboard.length > 0 ? (
                battedBallData.leaderboard.map((entry, index) => (
                  <CompactCard key={`batted-${entry.athlete_id}-${index}`} entry={entry} tech={currentTech} />
                ))
              ) : (
                <EmptyState message="No batted ball data" />
              )}
            </View>
          </View>
        ) : data && data.leaderboard.length > 0 ? (
          <View style={styles.singleColumn}>
            {data.leaderboard.map((entry) => (
              <CompactCard key={entry.athlete_id} entry={entry} tech={currentTech} />
            ))}
          </View>
        ) : (
          <EmptyState message="No rankings available" />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 50,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  headerTitleIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleText: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1,
  },
  filterButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  techTabs: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  techTab: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    overflow: 'hidden',
  },
  techTabActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  filtersContainer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  filterRow: {
    flexDirection: 'row',
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  filterChipText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 12,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#9CA3AF',
  },
  dualColumns: {
    gap: 24,
  },
  column: {
    gap: 8,
  },
  columnTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  singleColumn: {
    gap: 8,
  },
  compactCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    marginBottom: 8,
  },
  compactCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  compactCardRank: {
    width: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankCrown: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankCrownGlow: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFB800',
    opacity: 0.2,
  },
  rankMedal: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankNumber: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankNumberText: {
    fontSize: 16,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  compactCardInfo: {
    flex: 1,
    minWidth: 0,
  },
  compactCardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  compactCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactCardDate: {
    fontSize: 10,
    color: '#6B7280',
  },
  compactCardValue: {
    alignItems: 'flex-end',
  },
  compactCardValueText: {
    fontSize: 24,
    fontWeight: '900',
  },
  compactCardUnit: {
    fontSize: 10,
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  playLevelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  playLevelBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    gap: 16,
  },
  emptyStateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
