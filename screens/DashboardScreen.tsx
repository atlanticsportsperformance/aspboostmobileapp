import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Animated,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 16;
const HEADER_HEIGHT = SCREEN_HEIGHT * 0.12;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.34;
const CALENDAR_HEIGHT = SCREEN_HEIGHT * 0.54;

interface WorkoutInstance {
  id: string;
  scheduled_date: string;
  status: string;
  workouts: {
    name: string;
    category: string;
    estimated_duration_minutes: number | null;
  };
}

interface Booking {
  event: {
    start_time: string;
    scheduling_templates?: {
      scheduling_categories?: {
        color?: string;
      };
    };
  };
}

interface ForceProfile {
  composite_score: number;
  percentile_rank: number;
}

interface HittingData {
  latest: {
    bat_speed?: number;
    exit_velocity?: number;
    distance?: number;
    timestamp?: string;
  };
  prs: {
    bat_speed?: { value: number; date: string };
    exit_velocity?: { value: number; date: string };
    distance?: { value: number; date: string };
  };
}

interface ArmCareData {
  latest: {
    arm_score: number;
    total_strength: number;
    avg_strength_30d: number;
    tests_30d: number;
  };
  pr: {
    arm_score: number;
    date: string;
  };
}

const CATEGORY_COLORS: { [key: string]: { bg: string; text: string; dot: string; label: string } } = {
  hitting: {
    bg: '#7f1d1d',
    text: '#fca5a5',
    dot: '#ef4444',
    label: 'Hitting',
  },
  throwing: {
    bg: '#1e3a8a',
    text: '#93c5fd',
    dot: '#3b82f6',
    label: 'Throwing',
  },
  strength_conditioning: {
    bg: '#065f46',
    text: '#6ee7b7',
    dot: '#10b981',
    label: 'Strength',
  },
};

export default function DashboardScreen({ navigation }: any) {
  const [athleteId, setAthleteId] = useState('');
  const [athleteName, setAthleteName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [workoutInstances, setWorkoutInstances] = useState<WorkoutInstance[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'day'>('month');
  const [snapshotIndex, setSnapshotIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  // Data presence flags
  const [forceProfile, setForceProfile] = useState<ForceProfile | null>(null);
  const [hittingData, setHittingData] = useState<HittingData | null>(null);
  const [armCareData, setArmCareData] = useState<ArmCareData | null>(null);
  const [valdProfileId, setValdProfileId] = useState<string | null>(null);

  // FAB menu state
  const [fabOpen, setFabOpen] = useState(false);

  const hasAnyData = !!(forceProfile && valdProfileId) || !!armCareData || !!hittingData;

  useEffect(() => {
    loadDashboard();
  }, []);

  async function fetchForceProfile(athleteIdParam: string, valdProfileIdParam: string | null) {
    // Get athlete's play level
    const { data: athlete } = await supabase
      .from('athletes')
      .select('play_level')
      .eq('id', athleteIdParam)
      .single();

    if (!athlete?.play_level || !valdProfileIdParam) {
      setValdProfileId(null);
      setForceProfile(null);
      return;
    }

    setValdProfileId(valdProfileIdParam);

    // Fetch latest FORCE_PROFILE composite from athlete_percentile_history
    const { data: composite } = await supabase
      .from('athlete_percentile_history')
      .select('percentile_play_level, test_date')
      .eq('athlete_id', athleteIdParam)
      .eq('test_type', 'FORCE_PROFILE')
      .eq('play_level', athlete.play_level)
      .order('test_date', { ascending: false })
      .limit(1)
      .single();

    console.log('Force profile composite:', composite);

    if (!composite) {
      setValdProfileId(null);
      setForceProfile(null);
      return;
    }

    setForceProfile({
      composite_score: Math.round(composite.percentile_play_level || 0),
      percentile_rank: Math.round(composite.percentile_play_level || 0),
    });
  }

  async function fetchHittingData(athleteIdParam: string) {
    // Query Blast Motion swings for bat speed
    const { data: blastSwings } = await supabase
      .from('blast_swings')
      .select('*')
      .eq('athlete_id', athleteIdParam)
      .order('recorded_date', { ascending: false })
      .order('recorded_time', { ascending: false });

    console.log('Blast swings:', blastSwings);

    // Query HitTrax sessions to get session IDs linked to this athlete
    const { data: hittraxSessions } = await supabase
      .from('hittrax_sessions')
      .select('id, session_date')
      .eq('athlete_id', athleteIdParam)
      .order('session_date', { ascending: false });

    console.log('HitTrax sessions:', hittraxSessions);

    // Query HitTrax swings for exit velocity and distance
    const hittraxSessionIds = hittraxSessions?.map((s) => s.id) || [];
    const { data: hittraxSwings } = hittraxSessionIds.length > 0
      ? await supabase
          .from('hittrax_swings')
          .select('*')
          .in('session_id', hittraxSessionIds)
          .order('swing_timestamp', { ascending: false })
      : { data: null };

    console.log('HitTrax swings:', hittraxSwings);

    // Calculate PRs for bat speed (from Blast), exit velocity and distance (from HitTrax)
    let maxBatSpeed = { value: 0, date: '' };
    let maxExitVelo = { value: 0, date: '' };
    let maxDistance = { value: 0, date: '' };

    // Process Blast swings for bat speed
    if (blastSwings && blastSwings.length > 0) {
      for (const swing of blastSwings) {
        const batSpeed = parseFloat(swing.metrics?.swing_speed?.value || '0');
        if (batSpeed > maxBatSpeed.value) {
          maxBatSpeed = { value: batSpeed, date: swing.recorded_date };
        }
      }
    }

    // Process HitTrax swings for exit velocity and distance
    if (hittraxSwings && hittraxSwings.length > 0) {
      for (const swing of hittraxSwings) {
        const exitVelo = parseFloat(swing.exit_velocity || '0');
        const distance = parseFloat(swing.distance || '0');

        if (exitVelo > maxExitVelo.value) {
          // Find the session date for this swing
          const session = hittraxSessions?.find((s) => s.id === swing.session_id);
          maxExitVelo = { value: exitVelo, date: session?.session_date || '' };
        }
        if (distance > maxDistance.value) {
          const session = hittraxSessions?.find((s) => s.id === swing.session_id);
          maxDistance = { value: distance, date: session?.session_date || '' };
        }
      }
    }

    // Get latest values
    const latestBatSpeed = blastSwings && blastSwings.length > 0
      ? parseFloat(blastSwings[0].metrics?.swing_speed?.value || '0')
      : 0;
    const latestExitVelo = hittraxSwings && hittraxSwings.length > 0
      ? parseFloat(hittraxSwings[0].exit_velocity || '0')
      : 0;
    const latestDistance = hittraxSwings && hittraxSwings.length > 0
      ? parseFloat(hittraxSwings[0].distance || '0')
      : 0;

    const latestTimestamp = blastSwings && blastSwings.length > 0
      ? `${blastSwings[0].recorded_date} ${blastSwings[0].recorded_time}`
      : hittraxSwings && hittraxSwings.length > 0
        ? hittraxSwings[0].swing_timestamp
        : null;

    // Only set hitting data if there's at least one valid value
    const hasAnyHittingData = maxBatSpeed.value > 0 || maxExitVelo.value > 0 || maxDistance.value > 0;

    console.log('Has hitting data:', hasAnyHittingData);
    console.log('Bat speed PR:', maxBatSpeed);
    console.log('Exit velo PR:', maxExitVelo);
    console.log('Distance PR:', maxDistance);

    if (hasAnyHittingData) {
      setHittingData({
        prs: {
          bat_speed: maxBatSpeed.value > 0 ? maxBatSpeed : undefined,
          exit_velocity: maxExitVelo.value > 0 ? maxExitVelo : undefined,
          distance: maxDistance.value > 0 ? maxDistance : undefined,
        },
        latest: {
          bat_speed: latestBatSpeed || undefined,
          exit_velocity: latestExitVelo || undefined,
          distance: latestDistance || undefined,
          timestamp: latestTimestamp || undefined,
        },
      });
    } else {
      setHittingData(null);
    }
  }

  async function fetchArmCareData(athleteIdParam: string) {
    // Query ArmCare sessions for this athlete
    const { data: sessions, error } = await supabase
      .from('armcare_sessions')
      .select('*')
      .eq('athlete_id', athleteIdParam)
      .order('exam_date', { ascending: false })
      .order('exam_time', { ascending: false });

    console.log('ArmCare sessions:', sessions, 'Error:', error);

    if (!sessions || sessions.length === 0) {
      setArmCareData(null);
      return;
    }

    // Calculate PR (highest arm score)
    let maxArmScore = { value: 0, date: '' };
    for (const session of sessions) {
      const armScore = session.arm_score || 0;
      if (armScore > maxArmScore.value) {
        maxArmScore = { value: armScore, date: session.exam_date };
      }
    }

    // Calculate 90-day average
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const recentSessions = sessions.filter((session) => {
      const sessionDate = new Date(session.exam_date);
      return sessionDate >= ninetyDaysAgo;
    });

    let avg90DayArmScore = 0;
    let avg90DayTotalStrength = 0;

    if (recentSessions.length > 0) {
      const totalArmScore = recentSessions.reduce((sum, session) => sum + (session.arm_score || 0), 0);
      const totalStrength = recentSessions.reduce((sum, session) => sum + (session.total_strength || 0), 0);
      avg90DayArmScore = totalArmScore / recentSessions.length;
      avg90DayTotalStrength = totalStrength / recentSessions.length;
    } else {
      // If no sessions in last 90 days, use latest session
      avg90DayArmScore = sessions[0].arm_score || 0;
      avg90DayTotalStrength = sessions[0].total_strength || 0;
    }

    // Count tests in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const tests30d = sessions.filter((session) => {
      const sessionDate = new Date(session.exam_date);
      return sessionDate >= thirtyDaysAgo;
    }).length;

    console.log('ArmCare PR:', maxArmScore);
    console.log('90d avg arm score:', avg90DayArmScore);
    console.log('90d avg total strength:', avg90DayTotalStrength);
    console.log('Tests in 30d:', tests30d);

    setArmCareData({
      pr: maxArmScore.value > 0 ? { arm_score: maxArmScore.value, date: maxArmScore.date } : { arm_score: 0, date: '' },
      latest: {
        arm_score: avg90DayArmScore,
        total_strength: avg90DayTotalStrength,
        avg_strength_30d: avg90DayTotalStrength, // 90-day average of total strength
        tests_30d: tests30d,
      },
    });
  }

  async function loadDashboard() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      const { data: athlete } = await supabase
        .from('athletes')
        .select('id, first_name, last_name, vald_profile_id')
        .eq('user_id', user.id)
        .single();

      if (athlete) {
        console.log('Athlete loaded:', athlete);
        setAthleteId(athlete.id);
        setFirstName(athlete.first_name || '');
        setAthleteName(`${athlete.first_name || ''} ${athlete.last_name || ''}`);
        setValdProfileId(athlete.vald_profile_id);

        // Load workout instances
        const { data: workouts } = await supabase
          .from('workout_instances')
          .select(`
            id,
            scheduled_date,
            status,
            workouts (
              name,
              category,
              estimated_duration_minutes
            )
          `)
          .eq('athlete_id', athlete.id)
          .order('scheduled_date');

        setWorkoutInstances((workouts as any) || []);

        // Load bookings
        const { data: bookingsData } = await supabase
          .from('scheduling_bookings')
          .select(`
            event:scheduling_events (
              start_time,
              scheduling_templates (
                scheduling_categories (
                  color
                )
              )
            )
          `)
          .eq('athlete_id', athlete.id);

        setBookings((bookingsData as any) || []);

        // Load force profile (from athlete_percentile_history table, not vald_composite_scores)
        await fetchForceProfile(athlete.id, athlete.vald_profile_id);

        // Load hitting data
        await fetchHittingData(athlete.id);

        // Load armcare data
        await fetchArmCareData(athlete.id);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 4 && hour < 12) return 'Good morning';
    return 'Welcome back';
  }

  function getDaysInMonth(date: Date): (Date | null)[] {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: (Date | null)[] = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  }

  function getWorkoutsForDate(date: Date): WorkoutInstance[] {
    const dateStr = date.toISOString().split('T')[0];
    return workoutInstances.filter(w => w.scheduled_date === dateStr);
  }

  function getBookingsForDate(date: Date): Booking[] {
    const dateStr = date.toISOString().split('T')[0];
    return bookings.filter(b => b.event.start_time.startsWith(dateStr));
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }

  function handleDayClick(date: Date) {
    setSelectedDate(date);
    setViewMode('day');
  }

  function handleBackToMonth() {
    setViewMode('month');
    setSelectedDate(null);
  }

  function handlePrevMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  }

  function handleNextMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigation.replace('Login');
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9BDDFF" />
        <Text style={styles.loadingText}>Loading your dashboard...</Text>
      </View>
    );
  }

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const days = getDaysInMonth(currentDate);
  const selectedDateWorkouts = selectedDate ? getWorkoutsForDate(selectedDate) : [];
  const selectedDateBookings = selectedDate ? getBookingsForDate(selectedDate) : [];

  const snapshotSlides = [];
  if (valdProfileId && forceProfile) snapshotSlides.push('force');
  if (armCareData) snapshotSlides.push('armcare');
  if (hittingData) snapshotSlides.push('hitting');

  console.log('Has any data:', hasAnyData);
  console.log('Snapshot slides:', snapshotSlides);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{getGreeting()}, {firstName}</Text>
          <Text style={styles.date}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9BDDFF" />
        }
      >
        {/* Snapshot Cards */}
        {hasAnyData && viewMode === 'month' && (
          <View style={styles.snapshotContainer}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={Animated.event(
                [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                {
                  useNativeDriver: false,
                  listener: (event: any) => {
                    const offsetX = event.nativeEvent.contentOffset.x;
                    const index = Math.round(offsetX / CARD_WIDTH);
                    setSnapshotIndex(index);
                  }
                }
              )}
              scrollEventThrottle={16}
            >
              {/* Force Profile Card */}
              {valdProfileId && forceProfile && (
                <View style={[styles.snapshotCard, { width: CARD_WIDTH }]}>
                  <LinearGradient
                    colors={['rgba(255,255,255,0.1)', 'transparent', 'rgba(0,0,0,0.3)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.cardGloss}
                  />
                  <Text style={styles.cardTitle}>Force Profile</Text>

                  <View style={styles.forceProfileContent}>
                    <View style={styles.circleContainer}>
                      <Svg width={160} height={160} style={{ transform: [{ rotate: '-90deg' }] }}>
                        <Defs>
                          <SvgLinearGradient id="forceGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <Stop offset="0%" stopColor="#000000" />
                            <Stop offset="30%" stopColor={forceProfile.percentile_rank >= 75 ? "#10b981" : forceProfile.percentile_rank >= 50 ? "#7BC5F0" : forceProfile.percentile_rank >= 25 ? "#f59e0b" : "#dc2626"} />
                            <Stop offset="60%" stopColor={forceProfile.percentile_rank >= 75 ? "#34d399" : forceProfile.percentile_rank >= 50 ? "#9BDDFF" : forceProfile.percentile_rank >= 25 ? "#fbbf24" : "#ef4444"} />
                            <Stop offset="100%" stopColor={forceProfile.percentile_rank >= 75 ? "#6ee7b7" : forceProfile.percentile_rank >= 50 ? "#B0E5FF" : forceProfile.percentile_rank >= 25 ? "#fcd34d" : "#f87171"} />
                          </SvgLinearGradient>
                        </Defs>
                        <Circle cx="80" cy="80" r="68" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="12" fill="none" />
                        <Circle cx="80" cy="80" r="68" stroke="url(#forceGradient)" strokeWidth="12" fill="none" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 68}`} strokeDashoffset={`${2 * Math.PI * 68 * (1 - forceProfile.percentile_rank / 100)}`} />
                      </Svg>
                      <View style={styles.circleText}>
                        <Text style={styles.circleScore}>{forceProfile.composite_score.toFixed(1)}</Text>
                        <Text style={styles.circleLabel}>Composite</Text>
                      </View>
                    </View>
                    <View style={styles.forceMetrics}>
                      <Text style={styles.metricLabel}>Percentile Rank</Text>
                      <Text style={styles.metricValue}>{forceProfile.percentile_rank}%</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* ArmCare Card */}
              {armCareData && (
                <View style={[styles.snapshotCard, { width: CARD_WIDTH }]}>
                  <LinearGradient
                    colors={['rgba(255,255,255,0.1)', 'transparent', 'rgba(0,0,0,0.3)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.cardGloss}
                  />
                  <Text style={styles.cardTitle}>🏋️ ArmCare</Text>

                  <View style={styles.armCareContent}>
                    {/* LEFT: Circle */}
                    <View style={styles.circleContainer}>
                      <Svg width={176} height={176} style={{ transform: [{ rotate: '-90deg' }] }}>
                        <Defs>
                          <SvgLinearGradient id="armcareGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <Stop offset="0%" stopColor="#000000" />
                            <Stop offset="30%" stopColor="#7BC5F0" />
                            <Stop offset="60%" stopColor="#9BDDFF" />
                            <Stop offset="100%" stopColor="#B0E5FF" />
                          </SvgLinearGradient>
                        </Defs>
                        <Circle cx="88" cy="88" r="75" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="12" fill="none" />
                        <Circle cx="88" cy="88" r="75" stroke="url(#armcareGradient)" strokeWidth="12" fill="none" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 75}`} strokeDashoffset={`${2 * Math.PI * 75 * (1 - armCareData.latest.arm_score / 100)}`} />
                      </Svg>
                      <View style={styles.circleText}>
                        <Text style={[styles.circleScore, { color: '#9BDDFF', fontSize: 32 }]}>{armCareData.latest.arm_score.toFixed(1)}</Text>
                        <Text style={[styles.circleLabel, { fontSize: 11 }]}>Arm Score</Text>
                      </View>
                      <View style={styles.testsCount}>
                        <Text style={styles.testsCountLabel}>Tests (30d)</Text>
                        <Text style={[styles.testsCountValue, { fontSize: 18 }]}>{armCareData.latest.tests_30d}</Text>
                      </View>
                    </View>

                    {/* RIGHT: PR Bars + Strength */}
                    <View style={styles.armCareMetrics}>
                      {/* Personal Record Section */}
                      <View style={styles.armCareSection}>
                        <Text style={styles.armCareSectionTitle}>PERSONAL RECORD</Text>

                        {/* ALL-TIME BEST Bar */}
                        <View style={styles.armCareBarRow}>
                          <Text style={styles.armCareBarLabel}>BEST</Text>
                          <View style={styles.armCareBarContainer}>
                            <View style={styles.armCareBarBg}>
                              <LinearGradient
                                colors={['#000000', '#7BC5F0', '#9BDDFF', '#B0E5FF']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={[
                                  styles.armCareBarFill,
                                  { width: `${Math.min(100, armCareData.pr.arm_score)}%` }
                                ]}
                              />
                            </View>
                          </View>
                          <View style={styles.armCareBarValue}>
                            <Text style={styles.armCareBarValueText}>{armCareData.pr.arm_score.toFixed(1)}</Text>
                          </View>
                        </View>

                        {/* 90D AVERAGE Bar */}
                        <View style={styles.armCareBarRow}>
                          <Text style={styles.armCareBarLabel}>90D</Text>
                          <View style={styles.armCareBarContainer}>
                            <View style={styles.armCareBarBg}>
                              <LinearGradient
                                colors={
                                  armCareData.latest.arm_score >= armCareData.pr.arm_score
                                    ? ['#000000', '#065f46', '#059669', '#10b981']
                                    : ['#000000', '#7f1d1d', '#991b1b', '#dc2626']
                                }
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={[
                                  styles.armCareBarFill,
                                  { width: `${Math.min(100, armCareData.latest.arm_score)}%` }
                                ]}
                              />
                            </View>
                          </View>
                          <View style={styles.armCareBarValue}>
                            <Text style={styles.armCareBarValueText}>{armCareData.latest.arm_score.toFixed(1)}</Text>
                            {armCareData.pr.arm_score > 0 && (
                              <Text style={[
                                styles.armCareBarPercentage,
                                { color: armCareData.latest.arm_score >= armCareData.pr.arm_score ? '#10b981' : '#dc2626' }
                              ]}>
                                {armCareData.latest.arm_score >= armCareData.pr.arm_score ? '+' : ''}
                                {(((armCareData.latest.arm_score - armCareData.pr.arm_score) / armCareData.pr.arm_score) * 100).toFixed(1)}%
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>

                      {/* Strength Section */}
                      <Text style={styles.metricLabel}>Strength (90d Avg)</Text>
                      <View style={styles.strengthBox}>
                        <View style={styles.strengthRow}>
                          <Text style={styles.strengthLabel}>Total</Text>
                          <Text style={styles.strengthValue}>
                            {armCareData.latest.total_strength.toFixed(0)}
                            <Text style={styles.strengthUnit}> lbs</Text>
                          </Text>
                        </View>
                        <View style={styles.strengthDivider} />
                        <View style={styles.strengthRow}>
                          <Text style={styles.strengthLabel}>Average</Text>
                          <Text style={styles.strengthValue}>
                            {armCareData.latest.avg_strength_30d.toFixed(0)}
                            <Text style={styles.strengthUnit}> lbs</Text>
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              )}

              {/* Hitting Card */}
              {hittingData && (
                <View style={[styles.snapshotCard, { width: CARD_WIDTH }]}>
                  <LinearGradient
                    colors={['rgba(255,255,255,0.1)', 'transparent', 'rgba(0,0,0,0.3)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.cardGloss}
                  />
                  <Text style={styles.cardTitle}>⚾ Hitting Performance</Text>

                  <View style={styles.hittingContent}>
                    {/* Bat Speed */}
                    {hittingData.prs.bat_speed && (
                      <View style={styles.hittingSection}>
                        <Text style={styles.hittingSectionTitle}>Bat Speed</Text>

                        {/* PR Bar */}
                        <View style={styles.progressBarRow}>
                          <Text style={styles.progressLabel}>ALL-TIME BEST</Text>
                          <View style={styles.progressBarContainer}>
                            <View style={styles.progressBarBg}>
                              <View style={[styles.progressBarFill, {
                                width: `${Math.min(100, (hittingData.prs.bat_speed.value / 100) * 100)}%`,
                                backgroundColor: '#ef4444'
                              }]} />
                            </View>
                          </View>
                          <View style={styles.progressValueContainer}>
                            <Text style={[styles.progressValue, { color: '#fca5a5' }]}>
                              {hittingData.prs.bat_speed.value.toFixed(1)}
                              <Text style={styles.progressUnit}> mph</Text>
                            </Text>
                            <Text style={styles.progressDate}>
                              {new Date(hittingData.prs.bat_speed.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </Text>
                          </View>
                        </View>

                        {/* Recent Bar */}
                        <View style={styles.progressBarRow}>
                          <Text style={styles.progressLabel}>
                            {hittingData.latest.timestamp ? new Date(hittingData.latest.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : 'MOST RECENT'}
                          </Text>
                          <View style={styles.progressBarContainer}>
                            <View style={styles.progressBarBg}>
                              <View style={[styles.progressBarFill, {
                                width: `${Math.min(100, ((hittingData.latest.bat_speed || 0) / 100) * 100)}%`,
                                backgroundColor: (hittingData.latest.bat_speed || 0) >= hittingData.prs.bat_speed.value ? '#10b981' : '#dc2626'
                              }]} />
                            </View>
                          </View>
                          <View style={styles.progressValueContainer}>
                            <Text style={styles.progressValue}>
                              {(hittingData.latest.bat_speed || 0).toFixed(1)}
                              <Text style={styles.progressUnit}> mph</Text>
                            </Text>
                            {hittingData.latest.bat_speed && hittingData.prs.bat_speed.value > 0 && (
                              <Text style={[styles.progressPercentage, {
                                color: hittingData.latest.bat_speed >= hittingData.prs.bat_speed.value ? '#6ee7b7' : '#fca5a5'
                              }]}>
                                {hittingData.latest.bat_speed >= hittingData.prs.bat_speed.value ? '+' : ''}
                                {(((hittingData.latest.bat_speed - hittingData.prs.bat_speed.value) / hittingData.prs.bat_speed.value) * 100).toFixed(1)}%
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>
                    )}

                    {/* Exit Velocity */}
                    {hittingData.prs.exit_velocity && (
                      <View style={styles.hittingSection}>
                        <Text style={styles.hittingSectionTitle}>Exit Velocity</Text>

                        {/* PR Bar */}
                        <View style={styles.progressBarRow}>
                          <Text style={styles.progressLabel}>ALL-TIME BEST</Text>
                          <View style={styles.progressBarContainer}>
                            <View style={styles.progressBarBg}>
                              <View style={[styles.progressBarFill, {
                                width: `${Math.min(100, (hittingData.prs.exit_velocity.value / 130) * 100)}%`,
                                backgroundColor: '#f97316'
                              }]} />
                            </View>
                          </View>
                          <View style={styles.progressValueContainer}>
                            <Text style={[styles.progressValue, { color: '#fb923c' }]}>
                              {hittingData.prs.exit_velocity.value.toFixed(1)}
                              <Text style={styles.progressUnit}> mph</Text>
                            </Text>
                            <Text style={styles.progressDate}>
                              {new Date(hittingData.prs.exit_velocity.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </Text>
                          </View>
                        </View>

                        {/* Recent Bar */}
                        <View style={styles.progressBarRow}>
                          <Text style={styles.progressLabel}>
                            {hittingData.latest.timestamp ? new Date(hittingData.latest.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : 'MOST RECENT'}
                          </Text>
                          <View style={styles.progressBarContainer}>
                            <View style={styles.progressBarBg}>
                              <View style={[styles.progressBarFill, {
                                width: `${Math.min(100, ((hittingData.latest.exit_velocity || 0) / 130) * 100)}%`,
                                backgroundColor: (hittingData.latest.exit_velocity || 0) >= hittingData.prs.exit_velocity.value ? '#10b981' : '#dc2626'
                              }]} />
                            </View>
                          </View>
                          <View style={styles.progressValueContainer}>
                            <Text style={styles.progressValue}>
                              {(hittingData.latest.exit_velocity || 0).toFixed(1)}
                              <Text style={styles.progressUnit}> mph</Text>
                            </Text>
                            {hittingData.latest.exit_velocity && hittingData.prs.exit_velocity.value > 0 && (
                              <Text style={[styles.progressPercentage, {
                                color: hittingData.latest.exit_velocity >= hittingData.prs.exit_velocity.value ? '#6ee7b7' : '#fca5a5'
                              }]}>
                                {hittingData.latest.exit_velocity >= hittingData.prs.exit_velocity.value ? '+' : ''}
                                {(((hittingData.latest.exit_velocity - hittingData.prs.exit_velocity.value) / hittingData.prs.exit_velocity.value) * 100).toFixed(1)}%
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>
                    )}

                    {/* Distance */}
                    {hittingData.prs.distance && (
                      <View style={styles.hittingSection}>
                        <Text style={styles.hittingSectionTitle}>Distance</Text>

                        {/* PR Bar */}
                        <View style={styles.progressBarRow}>
                          <Text style={styles.progressLabel}>ALL-TIME BEST</Text>
                          <View style={styles.progressBarContainer}>
                            <View style={styles.progressBarBg}>
                              <View style={[styles.progressBarFill, {
                                width: `${Math.min(100, (hittingData.prs.distance.value / 450) * 100)}%`,
                                backgroundColor: '#eab308'
                              }]} />
                            </View>
                          </View>
                          <View style={styles.progressValueContainer}>
                            <Text style={[styles.progressValue, { color: '#facc15' }]}>
                              {Math.round(hittingData.prs.distance.value)}
                              <Text style={styles.progressUnit}> ft</Text>
                            </Text>
                            <Text style={styles.progressDate}>
                              {new Date(hittingData.prs.distance.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </Text>
                          </View>
                        </View>

                        {/* Recent Bar */}
                        <View style={styles.progressBarRow}>
                          <Text style={styles.progressLabel}>
                            {hittingData.latest.timestamp ? new Date(hittingData.latest.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : 'MOST RECENT'}
                          </Text>
                          <View style={styles.progressBarContainer}>
                            <View style={styles.progressBarBg}>
                              <View style={[styles.progressBarFill, {
                                width: `${Math.min(100, ((hittingData.latest.distance || 0) / 450) * 100)}%`,
                                backgroundColor: (hittingData.latest.distance || 0) >= hittingData.prs.distance.value ? '#10b981' : '#dc2626'
                              }]} />
                            </View>
                          </View>
                          <View style={styles.progressValueContainer}>
                            <Text style={styles.progressValue}>
                              {Math.round(hittingData.latest.distance || 0)}
                              <Text style={styles.progressUnit}> ft</Text>
                            </Text>
                            {hittingData.latest.distance && hittingData.prs.distance.value > 0 && (
                              <Text style={[styles.progressPercentage, {
                                color: hittingData.latest.distance >= hittingData.prs.distance.value ? '#6ee7b7' : '#fca5a5'
                              }]}>
                                {hittingData.latest.distance >= hittingData.prs.distance.value ? '+' : ''}
                                {(((hittingData.latest.distance - hittingData.prs.distance.value) / hittingData.prs.distance.value) * 100).toFixed(1)}%
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              )}
            </ScrollView>

          </View>
        )}

        {/* Calendar */}
        <View style={styles.calendarContainer}>
          {viewMode === 'month' ? (
            <>
              <View style={styles.monthHeader}>
                <TouchableOpacity onPress={handlePrevMonth} style={styles.monthButton}>
                  <Text style={styles.monthButtonText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.monthTitle}>{monthName}</Text>
                <TouchableOpacity onPress={handleNextMonth} style={styles.monthButton}>
                  <Text style={styles.monthButtonText}>›</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.dayHeaders}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <Text key={day} style={styles.dayHeader}>{day}</Text>
                ))}
              </View>

              <View style={styles.calendarGrid}>
                {days.map((date, index) => {
                  if (!date) {
                    return <View key={`empty-${index}`} style={styles.emptyDay} />;
                  }

                  const dayWorkouts = getWorkoutsForDate(date);
                  const dayBookings = getBookingsForDate(date);
                  const today = isToday(date);

                  return (
                    <TouchableOpacity
                      key={date.toISOString()}
                      onPress={() => handleDayClick(date)}
                      style={[styles.calendarDay, today && styles.calendarDayToday]}
                    >
                      <Text style={[styles.dayNumber, today && styles.dayNumberToday]}>
                        {date.getDate()}
                      </Text>
                      {(dayWorkouts.length > 0 || dayBookings.length > 0) && (
                        <View style={styles.dayDots}>
                          {dayWorkouts.slice(0, 3).map((workout, i) => (
                            <View
                              key={`workout-${i}`}
                              style={[styles.dayDot, { backgroundColor: CATEGORY_COLORS[workout.workouts?.category || 'strength_conditioning'].dot }]}
                            />
                          ))}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : (
            <>
              <View style={styles.dayViewHeader}>
                <TouchableOpacity onPress={handleBackToMonth} style={styles.backButton}>
                  <Text style={styles.backButtonText}>‹ Back</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.dayViewContent}>
                {selectedDate && (
                  <>
                    <Text style={styles.dayViewDate}>
                      {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </Text>

                    {selectedDateWorkouts.length === 0 && selectedDateBookings.length === 0 ? (
                      <View style={styles.emptyDayView}>
                        <Text style={styles.emptyDayIcon}>📅</Text>
                        <Text style={styles.emptyDayText}>No activities scheduled</Text>
                      </View>
                    ) : (
                      <>
                        {selectedDateWorkouts.map(workout => (
                          <View key={workout.id} style={styles.workoutCard}>
                            <View style={[styles.workoutDot, { backgroundColor: CATEGORY_COLORS[workout.workouts?.category || 'strength_conditioning'].dot }]} />
                            <View style={styles.workoutInfo}>
                              <Text style={styles.workoutName}>{workout.workouts.name}</Text>
                              <Text style={styles.workoutCategory}>
                                {CATEGORY_COLORS[workout.workouts?.category || 'strength_conditioning'].label}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </>
                    )}
                  </>
                )}
              </ScrollView>
            </>
          )}
        </View>
      </ScrollView>

      {/* FAB Button */}
      <View style={styles.fabContainer}>
        <TouchableOpacity
          onPress={() => setFabOpen(!fabOpen)}
          style={styles.fab}
        >
          <LinearGradient
            colors={['#9BDDFF', '#B0E5FF', '#7BC5F0']}
            style={styles.fabGradient}
          >
            <Text style={styles.fabIcon}>{fabOpen ? '✕' : '☰'}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* FAB Menu */}
        <Modal
          visible={fabOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setFabOpen(false)}
        >
          <TouchableOpacity
            style={styles.fabOverlay}
            activeOpacity={1}
            onPress={() => setFabOpen(false)}
          >
            <View style={styles.fabMenu}>
              <TouchableOpacity style={styles.fabMenuItem}>
                <Text style={styles.fabMenuIcon}>🏠</Text>
                <Text style={styles.fabMenuLabel}>Home</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.fabMenuItem}>
                <Text style={styles.fabMenuIcon}>💬</Text>
                <Text style={styles.fabMenuLabel}>Messages</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.fabMenuItem}>
                <Text style={styles.fabMenuIcon}>📊</Text>
                <Text style={styles.fabMenuLabel}>Performance</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
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
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
  },
  loadingText: {
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 16,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#0A0A0A',
  },
  greeting: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  date: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  settingsButton: {
    padding: 8,
  },
  settingsIcon: {
    fontSize: 24,
  },
  scrollView: {
    flex: 1,
  },
  snapshotContainer: {
    height: CARD_HEIGHT,
    marginBottom: 0,
    position: 'relative',
  },
  snapshotCard: {
    backgroundColor: '#000000',
    borderRadius: 24,
    padding: 16,
    marginHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.8,
    shadowRadius: 60,
    elevation: 10,
    position: 'relative',
  },
  cardGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
    zIndex: 10,
  },
  forceProfileContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
  },
  circleContainer: {
    position: 'relative',
    width: 176,
    height: 176,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleText: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 20,
  },
  circleScore: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  circleLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  testsCount: {
    marginTop: 8,
    alignItems: 'center',
  },
  testsCountLabel: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  testsCountValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  forceMetrics: {
    flex: 1,
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 8,
  },
  metricValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  armCareContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
  },
  armCareMetrics: {
    flex: 1,
    justifyContent: 'center',
  },
  armCareSection: {
    marginBottom: 8,
  },
  armCareSectionTitle: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '500',
    marginBottom: 6,
  },
  armCareBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 4,
  },
  armCareBarLabel: {
    fontSize: 7,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    width: 55,
  },
  armCareBarContainer: {
    flex: 1,
  },
  armCareBarBg: {
    height: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  armCareBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  armCareBarValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 45,
  },
  armCareBarValueText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  armCareBarDate: {
    fontSize: 7,
    color: '#6B7280',
  },
  armCareBarPercentage: {
    fontSize: 8,
    fontWeight: '600',
  },
  strengthBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  strengthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  strengthDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 8,
  },
  strengthLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  strengthValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  strengthUnit: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  hittingContent: {
    flex: 1,
    gap: 12,
  },
  hittingSection: {
    marginBottom: 8,
  },
  hittingSectionTitle: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
    marginBottom: 6,
  },
  progressBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  progressLabel: {
    fontSize: 8,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    width: 65,
  },
  progressBarContainer: {
    flex: 1,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 70,
    justifyContent: 'flex-end',
  },
  progressValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  progressUnit: {
    fontSize: 9,
    color: '#9CA3AF',
  },
  progressDate: {
    fontSize: 8,
    color: '#6B7280',
  },
  progressPercentage: {
    fontSize: 9,
    fontWeight: '600',
  },
  calendarContainer: {
    height: CALENDAR_HEIGHT,
    paddingHorizontal: 16,
    paddingBottom: 80,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  monthButton: {
    padding: 8,
  },
  monthButtonText: {
    fontSize: 24,
    color: '#FFFFFF',
  },
  monthTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  dayHeaders: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  dayHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    color: '#9CA3AF',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emptyDay: {
    width: (SCREEN_WIDTH - 32 - 48) / 7,
    height: 56,
  },
  calendarDay: {
    width: (SCREEN_WIDTH - 32 - 48) / 7,
    height: 56,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  calendarDayToday: {
    borderColor: '#9BDDFF',
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
  },
  dayNumber: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  dayNumberToday: {
    color: '#9BDDFF',
  },
  dayDots: {
    flexDirection: 'row',
    gap: 2,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  dayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dayViewHeader: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  dayViewContent: {
    flex: 1,
    padding: 16,
  },
  dayViewDate: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 24,
  },
  emptyDayView: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  emptyDayIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyDayText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  workoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  workoutDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  workoutInfo: {
    flex: 1,
  },
  workoutName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  workoutCategory: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: '#9BDDFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabIcon: {
    fontSize: 24,
    color: '#000000',
    fontWeight: 'bold',
  },
  fabOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 24,
    paddingBottom: 100,
  },
  fabMenu: {
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 220,
    padding: 8,
  },
  fabMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  fabMenuIcon: {
    fontSize: 20,
  },
  fabMenuLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
});
