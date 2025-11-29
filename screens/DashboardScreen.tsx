import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Animated,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import HittingCard from '../components/dashboard/HittingCard';
import ForceProfileCard from '../components/dashboard/ForceProfileCard';
import ArmCareCard from '../components/dashboard/ArmCareCard';
import PitchingCard from '../components/dashboard/PitchingCard';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 16;
const HEADER_HEIGHT = SCREEN_HEIGHT * 0.12;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.34;
// Calculate calendar day size based on screen width (7 columns + gaps + padding)
const CALENDAR_DAY_SIZE = Math.floor((SCREEN_WIDTH - 32 - 48) / 7);

interface WorkoutInstance {
  id: string;
  scheduled_date: string;
  status: string;
  completed_at: string | null;
  workouts: {
    name: string;
    category: string;
    estimated_duration_minutes: number | null;
    notes: string | null;
    routines: Array<{
      id: string;
      name: string;
      scheme: string;
      order_index: number;
      notes: string | null;
      text_info: string | null;
      routine_exercises: Array<{
        id: string;
        order_index: number;
        sets: number;
        metric_targets: any;
        exercises: {
          id: string;
          name: string;
        };
      }>;
    }>;
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
  best_metric: { name: string; percentile: number; value: number } | null;
  worst_metric: { name: string; percentile: number; value: number } | null;
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

interface StuffPlusByPitch {
  pitchType: string;
  stuffPlus: number;
  date: string;
}

interface PitchingData {
  prs: {
    max_velo: { value: number; date: string } | null;
  };
  latest: {
    max_velo: number | null;
    avg_velo_30d: number | null;
    avg_velo_recent: number | null;
    timestamp: string | null;
  };
  stuffPlus: {
    allTimeBest: StuffPlusByPitch[]; // Best stuff+ for each pitch type (all-time)
    recentSession: StuffPlusByPitch[]; // Stuff+ for each pitch type (most recent session)
    overallBest: number | null; // Highest stuff+ overall
    overallRecent: number | null; // Highest stuff+ from recent session
  } | null;
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
  const [pitchingData, setPitchingData] = useState<PitchingData | null>(null);
  const [valdProfileId, setValdProfileId] = useState<string | null>(null);
  const [latestPrediction, setLatestPrediction] = useState<{ predicted_value: number; predicted_value_low?: number; predicted_value_high?: number } | null>(null);
  const [bodyweightData, setBodyweightData] = useState<{ current: number; previous: number | null; date: string } | null>(null);

  // Additional data presence flags for FAB (matching web app)
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasResourcesData, setHasResourcesData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [newResourcesCount, setNewResourcesCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  // FAB menu state
  const [fabOpen, setFabOpen] = useState(false);

  // Settings dropdown state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Expanded workout card state
  const [expandedWorkoutId, setExpandedWorkoutId] = useState<string | null>(null);

  // Resume workout modal state
  const [resumeWorkoutData, setResumeWorkoutData] = useState<{
    instanceId: string;
    workoutName: string;
    elapsedTime: number;
  } | null>(null);
  const [showResumeModal, setShowResumeModal] = useState(false);

  const hasAnyData = !!(forceProfile && valdProfileId) || !!armCareData || !!hittingData || !!pitchingData;

  // Refetch dashboard data when screen gains focus (e.g., after returning from workout)
  useFocusEffect(
    useCallback(() => {
      loadDashboard();
    }, [])
  );

  // Check if workout is in progress and show resume modal
  async function checkAndShowResumeModal(workout: WorkoutInstance) {
    try {
      // Check if this workout is in progress
      if (workout.status === 'in_progress') {
        // Check if there's saved state in AsyncStorage
        const savedData = await AsyncStorage.getItem(`workout_${workout.id}`);
        const elapsedTime = savedData ? JSON.parse(savedData).elapsedTime || 0 : 0;

        setResumeWorkoutData({
          instanceId: workout.id,
          workoutName: workout.workouts.name,
          elapsedTime,
        });
        setShowResumeModal(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error checking workout status:', error);
      return false;
    }
  }

  // Resume workout modal handlers
  async function handleResumeWorkout() {
    if (resumeWorkoutData) {
      setShowResumeModal(false);
      navigation.navigate('WorkoutLogger', { workoutInstanceId: resumeWorkoutData.instanceId, athleteId });
    }
  }

  async function handleRestartWorkout() {
    if (resumeWorkoutData) {
      // Clear saved state
      await AsyncStorage.removeItem(`workout_${resumeWorkoutData.instanceId}`);
      setShowResumeModal(false);
      navigation.navigate('WorkoutLogger', { workoutInstanceId: resumeWorkoutData.instanceId, athleteId });
    }
  }

  async function handleDiscardWorkout() {
    if (resumeWorkoutData) {
      const instanceId = resumeWorkoutData.instanceId;

      // Close modal first
      setShowResumeModal(false);
      setResumeWorkoutData(null);

      // Clear saved state from AsyncStorage
      await AsyncStorage.removeItem(`workout_${instanceId}`);

      // Delete all exercise logs for this workout instance
      await supabase
        .from('exercise_logs')
        .delete()
        .eq('workout_instance_id', instanceId);

      // Update workout instance status to 'not_started'
      await supabase
        .from('workout_instances')
        .update({ status: 'not_started' })
        .eq('id', instanceId);

      // Refresh the dashboard to show updated state
      await loadDashboard();
    }
  }

  function formatElapsedTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    if (mins < 60) {
      return `${mins} min${mins !== 1 ? 's' : ''} ago`;
    } else {
      const hours = Math.floor(mins / 60);
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }
  }

  async function fetchForceProfile(athleteIdParam: string, valdProfileIdParam: string | null) {
    console.log('📊 [Force Profile] Starting fetch for athlete:', athleteIdParam);

    // Get athlete's org_id for composite config
    const { data: athlete, error: athleteError } = await supabase
      .from('athletes')
      .select('org_id, play_level')
      .eq('id', athleteIdParam)
      .single();

    console.log('📊 [Force Profile] Athlete org_id:', athlete?.org_id, 'Error:', athleteError?.message);

    if (!athlete?.org_id) {
      console.log('📊 [Force Profile] No org_id, exiting');
      setValdProfileId(null);
      setForceProfile(null);
      return;
    }

    // Get the org's default composite config (matches web app logic)
    // First try default, then fall back to any config for the org
    let { data: compositeConfig, error: configError } = await supabase
      .from('composite_score_configs')
      .select('*')
      .eq('org_id', athlete.org_id)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();

    console.log('📊 [Force Profile] Default config:', compositeConfig?.name, 'Error:', configError?.message);

    // If no default, try any config for this org
    if (!compositeConfig) {
      const { data: anyConfig, error: anyErr } = await supabase
        .from('composite_score_configs')
        .select('*')
        .eq('org_id', athlete.org_id)
        .limit(1)
        .maybeSingle();
      console.log('📊 [Force Profile] Fallback config:', anyConfig?.name, 'Error:', anyErr?.message);
      compositeConfig = anyConfig;
      configError = anyErr;
    }

    // If still no config, use hardcoded default (same as seed script)
    if (!compositeConfig) {
      console.log('📊 [Force Profile] Using hardcoded default config');
      compositeConfig = {
        name: 'Overall Athleticism',
        metrics: [
          { test_type: 'imtp', metric: 'net_peak_vertical_force_trial_value' },
          { test_type: 'imtp', metric: 'relative_strength_trial_value' },
          { test_type: 'sj', metric: 'peak_takeoff_power_trial_value' },
          { test_type: 'cmj', metric: 'bodymass_relative_takeoff_power_trial_value' },
          { test_type: 'ppu', metric: 'peak_takeoff_force_trial_value' },
          { test_type: 'hj', metric: 'hop_mean_rsi_trial_value' },
        ],
      };
    }

    console.log('📊 [Force Profile] Config has', compositeConfig.metrics?.length, 'metrics:', JSON.stringify(compositeConfig.metrics));

    // Calculate composite score from force_plate_percentiles (matches web app calculateCompositeScore)
    const metrics = compositeConfig.metrics || [];
    const percentiles: Array<{ name: string; percentile: number; value: number; test_type: string; metric: string }> = [];

    for (const metricSpec of metrics) {
      console.log('📊 [Force Profile] Querying for', metricSpec.test_type, metricSpec.metric);

      const { data: percentileData, error } = await supabase
        .from('force_plate_percentiles')
        .select('test_id, test_date, percentiles')
        .eq('athlete_id', athleteIdParam)
        .eq('test_type', metricSpec.test_type)
        .order('test_date', { ascending: false })
        .limit(1)
        .single();

      console.log('📊 [Force Profile] Result for', metricSpec.test_type, ':', percentileData ? 'found' : 'not found', 'Error:', error?.message);

      if (!error && percentileData?.percentiles) {
        const metricPercentile = percentileData.percentiles[metricSpec.metric];
        console.log('📊 [Force Profile] Metric percentile for', metricSpec.metric, ':', metricPercentile);
        if (typeof metricPercentile === 'number' && !isNaN(metricPercentile)) {
          // Fetch the actual raw value from the test table
          let rawValue = 0;
          const { data: testData } = await supabase
            .from(`${metricSpec.test_type}_tests`)
            .select(metricSpec.metric)
            .eq('test_id', percentileData.test_id)
            .single();

          if (testData && testData[metricSpec.metric] !== undefined) {
            rawValue = Number(testData[metricSpec.metric]) || 0;
          }
          console.log('📊 [Force Profile] Raw value for', metricSpec.metric, ':', rawValue);

          // Get display name for the metric
          const displayName = getMetricDisplayName(metricSpec.test_type, metricSpec.metric);
          percentiles.push({
            name: displayName,
            percentile: Math.round(metricPercentile),
            value: rawValue,
            test_type: metricSpec.test_type,
            metric: metricSpec.metric,
          });
        }
      }
    }

    console.log('📊 [Force Profile] Collected percentiles:', percentiles.length, 'from', metrics.length, 'metrics');

    if (percentiles.length === 0) {
      console.log('📊 [Force Profile] No percentiles found, exiting');
      setValdProfileId(null);
      setForceProfile(null);
      return;
    }

    // Calculate composite as average of percentiles (matches web app)
    const compositeScore = Math.round(
      (percentiles.reduce((sum, p) => sum + p.percentile, 0) / percentiles.length) * 10
    ) / 10;

    // Find best and worst metrics
    percentiles.sort((a, b) => b.percentile - a.percentile);
    const best = percentiles[0];
    const worst = percentiles[percentiles.length - 1];

    // Set valdProfileId to indicate we have force data (even if no vald_profile_id)
    setValdProfileId(valdProfileIdParam || 'has_force_data');

    setForceProfile({
      composite_score: compositeScore,
      percentile_rank: compositeScore,
      best_metric: best,
      worst_metric: worst,
    });
  }

  // Helper function to get display names for metrics (matches web app format)
  function getMetricDisplayName(testType: string, metric: string): string {
    const displayMap: Record<string, string> = {
      // Using testType|metric format like web app
      'imtp|net_peak_vertical_force_trial_value': 'IMTP Net Force',
      'imtp|relative_strength_trial_value': 'IMTP Relative',
      'sj|peak_takeoff_power_trial_value': 'SJ Power',
      'cmj|bodymass_relative_takeoff_power_trial_value': 'CMJ Power/BM',
      'ppu|peak_takeoff_force_trial_value': 'PPU Force',
      'hj|hop_mean_rsi_trial_value': 'HJ RSI',
      // Additional metrics
      'cmj|peak_takeoff_power_trial_value': 'CMJ Power',
      'cmj|jump_height_trial_value': 'CMJ Height',
      'sj|jump_height_trial_value': 'SJ Height',
      'hj|contact_time_trial_value': 'HJ Contact',
      'ppu|peak_takeoff_force_bm_trial_value': 'PPU Force/BM',
    };
    const key = `${testType}|${metric}`;
    return displayMap[key] || metric.replace('_trial_value', '').replace(/_/g, ' ');
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

  async function fetchPredictions(athleteIdParam: string) {
    try {
      // Query the predictions table for the latest pitch velocity prediction
      const { data, error } = await supabase
        .from('predictions')
        .select('predicted_value, predicted_value_low, predicted_value_high, predicted_at')
        .eq('athlete_id', athleteIdParam)
        .order('predicted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Predictions query error:', error);
        setLatestPrediction(null);
        return;
      }

      if (data) {
        console.log('Latest prediction:', data);
        setLatestPrediction({
          predicted_value: data.predicted_value,
          predicted_value_low: data.predicted_value_low,
          predicted_value_high: data.predicted_value_high,
        });
      } else {
        setLatestPrediction(null);
      }
    } catch (err) {
      console.error('Failed to fetch predictions:', err);
      setLatestPrediction(null);
    }
  }

  async function fetchBodyweightData(athleteIdParam: string) {
    try {
      // Query CMJ tests for bodyweight - try multiple possible column names
      // Get the two most recent tests to calculate % change
      const { data: cmjTests, error } = await supabase
        .from('cmj_tests')
        .select('*')
        .eq('athlete_id', athleteIdParam)
        .order('created_at', { ascending: false })
        .limit(2);

      if (error) {
        console.error('Bodyweight query error:', error);
        setBodyweightData(null);
        return;
      }

      if (cmjTests && cmjTests.length > 0) {
        // Log all columns to find the right one
        console.log('CMJ test columns:', Object.keys(cmjTests[0]));

        // body_weight_trial_value is the VALD column name for bodyweight in kg
        const test = cmjTests[0];
        const currentWeight = test.body_weight_trial_value;

        if (!currentWeight) {
          console.log('No bodyweight found in CMJ test');
          setBodyweightData(null);
          return;
        }

        const previousTest = cmjTests.length > 1 ? cmjTests[1] : null;
        const previousWeight = previousTest?.body_weight_trial_value || null;

        // Convert kg to lbs (1 kg = 2.20462 lbs)
        const currentLbs = currentWeight * 2.20462;
        const previousLbs = previousWeight ? previousWeight * 2.20462 : null;

        console.log('Bodyweight data:', { currentLbs, previousLbs, date: cmjTests[0].created_at });

        setBodyweightData({
          current: currentLbs,
          previous: previousLbs,
          date: cmjTests[0].created_at,
        });
      } else {
        console.log('No CMJ tests found for athlete');
        setBodyweightData(null);
      }
    } catch (err) {
      console.error('Failed to fetch bodyweight:', err);
      setBodyweightData(null);
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

  async function fetchPitchingData(athleteIdParam: string) {
    // Query TrackMan pitch data for velocity metrics
    // Use JOIN to get Stuff+ data (matches web app pattern for RLS compatibility)
    const { data: pitches } = await supabase
      .from('trackman_pitch_data')
      .select(`
        *,
        stuff_plus:pitch_stuff_plus(stuff_plus, pitch_type_group, graded_at)
      `)
      .eq('athlete_id', athleteIdParam);

    console.log('📊 [Pitching] Pitches with Stuff+ join:', pitches?.length, 'First pitch stuff_plus:', pitches?.[0]?.stuff_plus);

    if (!pitches || pitches.length === 0) {
      setPitchingData(null);
      return;
    }

    // Get unique session IDs and fetch those sessions
    const uniqueSessionIds = [...new Set(pitches.map(p => p.session_id))];

    const { data: sessions } = await supabase
      .from('trackman_session')
      .select('id, game_date_utc')
      .in('id', uniqueSessionIds)
      .order('game_date_utc', { ascending: false });

    if (!sessions || sessions.length === 0) {
      setPitchingData(null);
      return;
    }

    // Calculate max velocity (all-time PR)
    let maxVelo = { value: 0, date: '' };
    for (const pitch of pitches) {
      const velo = parseFloat(pitch.rel_speed || '0');
      if (velo > maxVelo.value) {
        const session = sessions.find(s => s.id === pitch.session_id);
        maxVelo = { value: velo, date: session?.game_date_utc || pitch.created_at };
      }
    }

    // Get most recent session
    const mostRecentSession = sessions[0];
    const recentPitches = pitches.filter(p => p.session_id === mostRecentSession.id);

    // Calculate most recent max and average
    let recentMax = 0;
    let recentSum = 0;
    for (const pitch of recentPitches) {
      const velo = parseFloat(pitch.rel_speed || '0');
      if (velo > recentMax) recentMax = velo;
      recentSum += velo;
    }
    const recentAvg = recentPitches.length > 0 ? recentSum / recentPitches.length : 0;

    // Calculate 30-day average
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const last30DaySessions = sessions.filter(s => new Date(s.game_date_utc) >= thirtyDaysAgo);
    const last30DaySessionIds = last30DaySessions.map(s => s.id);
    const last30DayPitches = pitches.filter(p => last30DaySessionIds.includes(p.session_id));

    let sum30d = 0;
    for (const pitch of last30DayPitches) {
      sum30d += parseFloat(pitch.rel_speed || '0');
    }
    const avg30d = last30DayPitches.length > 0 ? sum30d / last30DayPitches.length : 0;

    console.log('Pitching PR:', maxVelo);
    console.log('Recent max:', recentMax, 'Recent avg:', recentAvg);
    console.log('30d avg:', avg30d);

    // Process Stuff+ data from the JOIN (no separate query needed)
    let stuffPlusData: {
      allTimeBest: StuffPlusByPitch[];
      recentSession: StuffPlusByPitch[];
      overallBest: number | null;
      overallRecent: number | null;
    } | null = null;

    // Extract Stuff+ grades from joined data
    // The stuff_plus field is an array (from the join) - get first element if exists
    const pitchesWithStuffPlus = pitches
      .filter(p => {
        const sp = p.stuff_plus;
        // Handle both array and object forms from Supabase join
        if (Array.isArray(sp) && sp.length > 0 && sp[0]?.stuff_plus != null) return true;
        if (sp && !Array.isArray(sp) && sp.stuff_plus != null) return true;
        return false;
      })
      .map(p => {
        const sp = Array.isArray(p.stuff_plus) ? p.stuff_plus[0] : p.stuff_plus;
        const session = sessions.find(s => s.id === p.session_id);
        return {
          pitch_uid: p.pitch_uid,
          stuff_plus: sp.stuff_plus as number,
          pitch_type_group: (sp.pitch_type_group || p.tagged_pitch_type || 'Unknown') as string,
          graded_at: sp.graded_at as string,
          session_id: p.session_id,
          session_date: session?.game_date_utc || p.created_at,
        };
      });

    console.log('📊 [Pitching] Pitches with Stuff+ grades:', pitchesWithStuffPlus.length);
    if (pitchesWithStuffPlus.length > 0) {
      console.log('📊 [Pitching] Sample Stuff+ data:', pitchesWithStuffPlus.slice(0, 3));
    }

    if (pitchesWithStuffPlus.length > 0) {
      // Get pitch_uids from the most recent session
      const recentSessionPitchUids = new Set(recentPitches.map(p => p.pitch_uid).filter(Boolean));

      // Group by pitch type and find best for each (all-time)
      const bestByPitchType = new Map<string, { stuffPlus: number; date: string }>();
      for (const grade of pitchesWithStuffPlus) {
        const pitchType = grade.pitch_type_group;
        const current = bestByPitchType.get(pitchType);
        if (!current || grade.stuff_plus > current.stuffPlus) {
          bestByPitchType.set(pitchType, { stuffPlus: grade.stuff_plus, date: grade.session_date });
        }
      }

      // Get stuff+ for most recent session by pitch type
      const recentByPitchType = new Map<string, { stuffPlus: number; date: string }>();
      for (const grade of pitchesWithStuffPlus) {
        if (recentSessionPitchUids.has(grade.pitch_uid)) {
          const pitchType = grade.pitch_type_group;
          const current = recentByPitchType.get(pitchType);
          // Get the best stuff+ for this pitch type in the recent session
          if (!current || grade.stuff_plus > current.stuffPlus) {
            recentByPitchType.set(pitchType, { stuffPlus: grade.stuff_plus, date: mostRecentSession.game_date_utc });
          }
        }
      }

      const allTimeBest: StuffPlusByPitch[] = Array.from(bestByPitchType.entries()).map(([pitchType, data]) => ({
        pitchType,
        stuffPlus: data.stuffPlus,
        date: data.date,
      }));

      const recentSession: StuffPlusByPitch[] = Array.from(recentByPitchType.entries()).map(([pitchType, data]) => ({
        pitchType,
        stuffPlus: data.stuffPlus,
        date: data.date,
      }));

      const overallBest = allTimeBest.length > 0 ? Math.max(...allTimeBest.map(p => p.stuffPlus)) : null;
      const overallRecent = recentSession.length > 0 ? Math.max(...recentSession.map(p => p.stuffPlus)) : null;

      console.log('📊 [Pitching] Stuff+ All-Time Best:', allTimeBest);
      console.log('📊 [Pitching] Stuff+ Recent Session:', recentSession);

      stuffPlusData = {
        allTimeBest,
        recentSession,
        overallBest,
        overallRecent,
      };
    }

    setPitchingData({
      prs: {
        max_velo: maxVelo.value > 0 ? maxVelo : null,
      },
      latest: {
        max_velo: recentMax || null,
        avg_velo_30d: avg30d || null,
        avg_velo_recent: recentAvg || null,
        timestamp: mostRecentSession.game_date_utc,
      },
      stuffPlus: stuffPlusData,
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
        setUserId(user.id);
        setFirstName(athlete.first_name || '');
        setAthleteName(`${athlete.first_name || ''} ${athlete.last_name || ''}`);
        setValdProfileId(athlete.vald_profile_id);

        // Check for pitching data (matching web app logic)
        const [trackmanPitches, commandSessions] = await Promise.all([
          supabase.from('trackman_pitch_data').select('id', { count: 'exact', head: true }).eq('athlete_id', athlete.id),
          supabase.from('command_training_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athlete.id),
        ]);
        setHasPitchingData((trackmanPitches.count || 0) > 0 || (commandSessions.count || 0) > 0);

        // Check for resources data
        const { count: resourcesCount } = await supabase
          .from('resources')
          .select('id', { count: 'exact', head: true })
          .eq('athlete_id', user.id);
        setHasResourcesData((resourcesCount || 0) > 0);

        // Count NEW resources (created after last viewed)
        const { data: athleteWithLastViewed } = await supabase
          .from('athletes')
          .select('last_viewed_resources_at')
          .eq('id', athlete.id)
          .single();

        if (athleteWithLastViewed) {
          const lastViewed = athleteWithLastViewed.last_viewed_resources_at || new Date(0).toISOString();
          const { count: newCount } = await supabase
            .from('resources')
            .select('id', { count: 'exact', head: true })
            .eq('athlete_id', user.id)
            .gt('created_at', lastViewed);
          setNewResourcesCount(newCount || 0);
        }

        // Fetch unread messages count
        try {
          const { count: unreadCount } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('recipient_id', user.id)
            .eq('is_read', false);
          setUnreadMessagesCount(unreadCount || 0);
        } catch (msgError) {
          console.log('Messages table may not exist or error fetching:', msgError);
          setUnreadMessagesCount(0);
        }

        // Load workout instances with full routine details
        const { data: workouts } = await supabase
          .from('workout_instances')
          .select(`
            id,
            scheduled_date,
            status,
            completed_at,
            workouts (
              name,
              category,
              estimated_duration_minutes,
              notes,
              routines (
                id,
                name,
                scheme,
                order_index,
                notes,
                text_info,
                routine_exercises (
                  id,
                  order_index,
                  sets,
                  metric_targets,
                  exercises (
                    id,
                    name
                  )
                )
              )
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

        // Load force profile (from force_plate_percentiles + composite_score_configs)
        await fetchForceProfile(athlete.id, athlete.vald_profile_id);

        // Load hitting data
        await fetchHittingData(athlete.id);

        // Load armcare data
        await fetchArmCareData(athlete.id);

        // Load pitching data
        await fetchPitchingData(athlete.id);

        // Load predictions
        await fetchPredictions(athlete.id);

        // Load bodyweight data from CMJ tests
        await fetchBodyweightData(athlete.id);
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
    setExpandedWorkoutId(null);
  }

  // Get week dates (Sunday through Saturday) for a given date
  function getWeekDates(centerDate: Date): Date[] {
    const dates: Date[] = [];
    const dayOfWeek = centerDate.getDay(); // 0 = Sunday, 6 = Saturday
    const sunday = new Date(centerDate);
    sunday.setDate(centerDate.getDate() - dayOfWeek);

    for (let i = 0; i < 7; i++) {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + i);
      dates.push(date);
    }

    return dates;
  }

  // Navigate to previous week
  function handlePrevDay() {
    if (!selectedDate) return;
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 7);
    setSelectedDate(newDate);
  }

  // Navigate to next week
  function handleNextDay() {
    if (!selectedDate) return;
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 7);
    setSelectedDate(newDate);
  }

  // Toggle workout expansion
  function toggleWorkoutExpanded(workoutId: string) {
    setExpandedWorkoutId(expandedWorkoutId === workoutId ? null : workoutId);
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
  if (pitchingData) snapshotSlides.push('pitching');

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
        <TouchableOpacity onPress={() => setSettingsOpen(true)} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Settings Dropdown Modal */}
      <Modal
        visible={settingsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <TouchableOpacity
          style={styles.settingsOverlay}
          activeOpacity={1}
          onPress={() => setSettingsOpen(false)}
        >
          <View style={styles.settingsDropdown}>
            <TouchableOpacity
              style={styles.settingsMenuItem}
              onPress={() => {
                setSettingsOpen(false);
                navigation.navigate('Profile');
              }}
            >
              <Ionicons name="person-outline" size={20} color="#FFFFFF" />
              <Text style={styles.settingsMenuLabel}>Profile Settings</Text>
            </TouchableOpacity>

            <View style={styles.settingsDivider} />

            <TouchableOpacity
              style={styles.settingsMenuItem}
              onPress={() => {
                setSettingsOpen(false);
                handleLogout();
              }}
            >
              <Ionicons name="log-out-outline" size={20} color="#EF4444" />
              <Text style={[styles.settingsMenuLabel, { color: '#EF4444' }]}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {viewMode === 'month' ? (
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
              {/* Cards rendered with proper index tracking for isActive */}
              {(() => {
                let cardIndex = 0;
                const cards = [];

                // Force Profile Card
                if (valdProfileId && forceProfile) {
                  const thisIndex = cardIndex++;
                  cards.push(
                    <View key="force-profile" style={[styles.snapshotCard, { width: CARD_WIDTH }]}>
                      <LinearGradient
                        colors={['rgba(255,255,255,0.1)', 'transparent', 'rgba(0,0,0,0.3)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.cardGloss}
                      />
                      <Text style={styles.cardTitle}>Force Profile</Text>
                      <ForceProfileCard data={forceProfile} latestPrediction={latestPrediction} bodyweight={bodyweightData} isActive={snapshotIndex === thisIndex} />
                    </View>
                  );
                }

                // ArmCare Card
                if (armCareData) {
                  const thisIndex = cardIndex++;
                  cards.push(
                    <View key="arm-care" style={[styles.snapshotCard, { width: CARD_WIDTH }]}>
                      <LinearGradient
                        colors={['rgba(255,255,255,0.1)', 'transparent', 'rgba(0,0,0,0.3)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.cardGloss}
                      />
                      <Text style={styles.cardTitle}>🏋️ ArmCare</Text>
                      <ArmCareCard data={armCareData} isActive={snapshotIndex === thisIndex} />
                    </View>
                  );
                }

                // Hitting Card
                if (hittingData) {
                  const thisIndex = cardIndex++;
                  cards.push(
                    <View key="hitting" style={[styles.snapshotCard, { width: CARD_WIDTH }]}>
                      <LinearGradient
                        colors={['rgba(255,255,255,0.1)', 'transparent', 'rgba(0,0,0,0.3)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.cardGloss}
                      />
                      <Text style={styles.cardTitle}>⚾ Hitting Performance</Text>
                      <HittingCard data={hittingData} isActive={snapshotIndex === thisIndex} />
                    </View>
                  );
                }

                // Pitching Card
                if (pitchingData) {
                  const thisIndex = cardIndex++;
                  cards.push(
                    <View key="pitching" style={[styles.snapshotCard, { width: CARD_WIDTH }]}>
                      <LinearGradient
                        colors={['rgba(255,255,255,0.1)', 'transparent', 'rgba(0,0,0,0.3)']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.cardGloss}
                      />
                      <Text style={styles.cardTitle}>⚾ Pitching Performance</Text>
                      <PitchingCard data={pitchingData} isActive={snapshotIndex === thisIndex} />
                    </View>
                  );
                }

                return cards;
              })()}
            </ScrollView>

          </View>
        )}

        {/* Calendar */}
        <View style={styles.calendarContainer}>
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
        </View>
        </ScrollView>
      ) : (
        <View style={styles.dayViewContainer}>
          {selectedDate && (
            <>
              {/* Back Button */}
              <View style={styles.dayViewHeader}>
                <TouchableOpacity onPress={handleBackToMonth} style={styles.backButton}>
                  <Text style={styles.backButtonText}>‹ Back</Text>
                </TouchableOpacity>
              </View>

              {/* Week Navigation Header - FIXED */}
              <View style={styles.weekNavHeader}>
                <TouchableOpacity onPress={handlePrevDay} style={styles.weekNavButton}>
                  <Text style={styles.weekNavButtonText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.weekNavTitle}>
                  {selectedDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                </Text>
                <TouchableOpacity onPress={handleNextDay} style={styles.weekNavButton}>
                  <Text style={styles.weekNavButtonText}>›</Text>
                </TouchableOpacity>
              </View>

              {/* Week View Grid - FIXED */}
              <View style={styles.weekViewContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekScroll}>
                  <View style={styles.weekGrid}>
                    {getWeekDates(selectedDate).map((date) => {
                      const isSelected = date.toDateString() === selectedDate.toDateString();
                      const today = isToday(date);
                      const dayWorkouts = getWorkoutsForDate(date);
                      const dayBookings = getBookingsForDate(date);

                      return (
                        <TouchableOpacity
                          key={date.toISOString()}
                          onPress={() => setSelectedDate(date)}
                          style={[
                            styles.weekDay,
                            isSelected && styles.weekDaySelected,
                            today && !isSelected && styles.weekDayToday
                          ]}
                        >
                          <Text style={[
                            styles.weekDayName,
                            isSelected && styles.weekDayNameSelected
                          ]}>
                            {date.toLocaleString('default', { weekday: 'short' })}
                          </Text>
                          <Text style={[
                            styles.weekDayNumber,
                            isSelected && styles.weekDayNumberSelected,
                            today && !isSelected && styles.weekDayNumberToday
                          ]}>
                            {date.getDate()}
                          </Text>
                          {/* Activity Dots */}
                          {(dayWorkouts.length > 0 || dayBookings.length > 0) && (
                            <View style={styles.weekDayDots}>
                              {dayWorkouts.slice(0, 3).map((workout, i) => (
                                <View
                                  key={`workout-${i}`}
                                  style={[
                                    styles.weekDayDot,
                                    { backgroundColor: CATEGORY_COLORS[workout.workouts?.category || 'strength_conditioning'].dot }
                                  ]}
                                />
                              ))}
                              {dayBookings.length > 0 && (
                                <View style={[styles.weekDayDot, { backgroundColor: '#a855f7' }]} />
                              )}
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              {/* Workouts for Selected Date - SCROLLABLE */}
              <ScrollView style={styles.workoutsScrollView} contentContainerStyle={styles.workoutsContainer}>
                {selectedDateWorkouts.length === 0 && selectedDateBookings.length === 0 ? (
                  <View style={styles.emptyDayView}>
                    <Text style={styles.emptyDayIcon}>📅</Text>
                    <Text style={styles.emptyDayText}>No activities scheduled</Text>
                  </View>
                ) : (
                  <>
                    {selectedDateWorkouts.map(workout => {
                      const categoryInfo = CATEGORY_COLORS[workout.workouts?.category || 'strength_conditioning'];
                      const isCompleted = workout.status === 'completed';
                      const isExpanded = expandedWorkoutId === workout.id;

                      return (
                        <View key={workout.id} style={styles.workoutCard}>
                          {/* Category Badge + Start Button */}
                          <View style={styles.workoutCardTopRow}>
                            <View style={[styles.categoryBadge, { backgroundColor: categoryInfo.bg }]}>
                              <Text style={[styles.categoryBadgeText, { color: categoryInfo.text }]}>
                                {categoryInfo.label}
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={[
                                styles.workoutActionButton,
                                isCompleted && styles.workoutActionButtonCompleted
                              ]}
                              onPress={async () => {
                                if (!isCompleted) {
                                  // Check if workout is in progress and show modal if needed
                                  const showedModal = await checkAndShowResumeModal(workout);
                                  // Only navigate directly if modal wasn't shown
                                  if (!showedModal) {
                                    navigation.navigate('WorkoutLogger', { workoutInstanceId: workout.id, athleteId });
                                  }
                                }
                              }}
                            >
                              <Text style={styles.workoutActionButtonText}>
                                {isCompleted ? 'View' : 'Start'}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {/* Workout Name + Duration + Accordion Toggle */}
                          <TouchableOpacity
                            style={styles.workoutCardHeader}
                            onPress={() => toggleWorkoutExpanded(workout.id)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.workoutCardHeaderLeft}>
                              <Text style={styles.workoutCardName}>{workout.workouts.name}</Text>
                              {workout.workouts.estimated_duration_minutes && (
                                <Text style={styles.workoutCardDuration}>
                                  {workout.workouts.estimated_duration_minutes} min
                                </Text>
                              )}
                            </View>
                            <View style={styles.expandButton}>
                              <Text style={[
                                styles.expandButtonText,
                                isExpanded && styles.expandButtonTextExpanded
                              ]}>
                                ›
                              </Text>
                            </View>
                          </TouchableOpacity>

                          {/* Workout Content - Accordion Dropdown */}
                          {isExpanded && (
                            <View style={styles.workoutPreview}>
                              {/* Workout Notes */}
                              {workout.workouts.notes && (
                                <View style={styles.workoutPreviewNotes}>
                                  <Text style={styles.workoutPreviewNotesText}>{workout.workouts.notes}</Text>
                                </View>
                              )}

                              {/* Routines */}
                              {workout.workouts.routines && workout.workouts.routines.length > 0 && (
                                <View style={styles.routinesList}>
                                  {workout.workouts.routines
                                    .sort((a, b) => a.order_index - b.order_index)
                                    .map((routine, routineIdx) => (
                                      <View key={routine.id} style={styles.routinePreview}>
                                        <View style={styles.routinePreviewHeader}>
                                          <Text style={styles.routinePreviewName}>{routine.name}</Text>
                                          {routine.scheme && (
                                            <Text style={styles.routinePreviewScheme}>{routine.scheme}</Text>
                                          )}
                                        </View>

                                        {/* Routine Notes/Info */}
                                        {(routine.notes || routine.text_info) && (
                                          <Text style={styles.routinePreviewInfo}>
                                            {routine.notes || routine.text_info}
                                          </Text>
                                        )}

                                        {/* Exercises - Show ALL */}
                                        {routine.routine_exercises && routine.routine_exercises.length > 0 && (
                                          <View style={styles.exercisesList}>
                                            {routine.routine_exercises
                                              .sort((a, b) => a.order_index - b.order_index)
                                              .map((routineExercise, exerciseIdx) => (
                                                <View key={routineExercise.id} style={styles.exercisePreview}>
                                                  <Text style={styles.exercisePreviewCode}>
                                                    {String.fromCharCode(65 + routineIdx)}{exerciseIdx + 1}
                                                  </Text>
                                                  <Text style={styles.exercisePreviewName}>
                                                    {routineExercise.exercises.name}
                                                  </Text>
                                                  <Text style={styles.exercisePreviewSets}>
                                                    {routineExercise.sets} sets
                                                  </Text>
                                                </View>
                                              ))}
                                          </View>
                                        )}
                                      </View>
                                    ))}
                                </View>
                              )}
                            </View>
                          )}
                        </View>
                      );
                    })}

                    {/* Bookings */}
                    {selectedDateBookings.map((booking, idx) => (
                      <View key={idx} style={styles.bookingCard}>
                        <Ionicons name="calendar" size={24} color="#3B82F6" style={{ marginRight: 12 }} />
                        <Text style={styles.bookingInfo}>
                          Class Booking - {new Date(booking.event.start_time).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </Text>
                      </View>
                    ))}
                  </>
                )}
              </ScrollView>
            </>
          )}
        </View>
      )}

      {/* Resume Workout Modal */}
      {showResumeModal && resumeWorkoutData && (
        <Modal
          visible={showResumeModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowResumeModal(false)}
        >
          {/* Backdrop */}
          <Pressable
            style={styles.resumeModalBackdrop}
            onPress={() => setShowResumeModal(false)}
          >
            {/* Modal Content - Pressable stops propagation */}
            <Pressable style={styles.resumeModalContainer} onPress={() => {}}>
              {/* Icon */}
              <View style={styles.resumeModalIconContainer}>
                <View style={styles.resumeModalIconBadge}>
                  <Text style={styles.resumeModalIconText}>⚡</Text>
                </View>
              </View>

              {/* Title */}
              <Text style={styles.resumeModalTitle}>Workout In Progress</Text>

              {/* Description */}
              <Text style={styles.resumeModalWorkoutName}>{resumeWorkoutData.workoutName}</Text>
              <Text style={styles.resumeModalTime}>
                Started {formatElapsedTime(resumeWorkoutData.elapsedTime)}
              </Text>

              {/* Info Box */}
              <View style={styles.resumeModalInfoBox}>
                <Text style={styles.resumeModalInfoTitle}>Your progress is saved</Text>
                <Text style={styles.resumeModalInfoText}>
                  Resume right where you left off or start fresh
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.resumeModalActions}>
                {/* Resume Button */}
                <TouchableOpacity
                  style={styles.resumeModalPrimaryButton}
                  onPress={handleResumeWorkout}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={['#9BDDFF', '#7BC5F0']}
                    style={styles.resumeModalPrimaryButtonGradient}
                  >
                    <Text style={styles.resumeModalPrimaryButtonText}>Resume Workout</Text>
                  </LinearGradient>
                </TouchableOpacity>

                {/* Restart Button */}
                <TouchableOpacity
                  style={styles.resumeModalSecondaryButton}
                  onPress={handleRestartWorkout}
                  activeOpacity={0.8}
                >
                  <Text style={styles.resumeModalSecondaryButtonText}>Restart from Beginning</Text>
                </TouchableOpacity>

                {/* Discard Button */}
                <TouchableOpacity
                  style={styles.resumeModalTertiaryButton}
                  onPress={handleDiscardWorkout}
                  activeOpacity={0.8}
                >
                  <Text style={styles.resumeModalTertiaryButtonText}>Discard Progress</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* FAB Button - Dynamic based on athlete data (matching web app) */}
      <View style={styles.fabContainer}>
        {/* Notification Badge on FAB */}
        {(unreadMessagesCount + newResourcesCount) > 0 && !fabOpen && (
          <View style={styles.fabNotificationBadge}>
            <Text style={styles.fabNotificationBadgeText}>
              {(unreadMessagesCount + newResourcesCount) > 99 ? '99+' : unreadMessagesCount + newResourcesCount}
            </Text>
          </View>
        )}
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

        {/* FAB Menu - Dynamic items based on athlete data */}
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
            <View style={styles.fabMenu} onStartShouldSetResponder={() => true}>
              {/* ALWAYS SHOWN: Home */}
              <TouchableOpacity
                style={[styles.fabMenuItem, styles.fabMenuItemActive]}
                onPress={() => {
                  setFabOpen(false);
                  // Already on home/dashboard
                }}
              >
                <Ionicons name="home" size={20} color="#9BDDFF" />
                <Text style={[styles.fabMenuLabel, styles.fabMenuLabelActive]}>Home</Text>
              </TouchableOpacity>

              {/* ALWAYS SHOWN: Messages with badge */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Messages');
                }}
              >
                <View style={styles.fabMenuIconContainer}>
                  <Ionicons name="chatbubble" size={20} color="#FFFFFF" />
                  {unreadMessagesCount > 0 && (
                    <View style={styles.fabMenuItemBadge}>
                      <Text style={styles.fabMenuItemBadgeText}>
                        {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.fabMenuLabel}>Messages</Text>
              </TouchableOpacity>

              {/* ALWAYS SHOWN: Performance */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Performance', { athleteId });
                }}
              >
                <Ionicons name="stats-chart" size={20} color="#FFFFFF" />
                <Text style={styles.fabMenuLabel}>Performance</Text>
              </TouchableOpacity>

              {/* ALWAYS SHOWN: Leaderboard */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Leaderboard');
                }}
              >
                <Ionicons name="trophy" size={20} color="#FFFFFF" />
                <Text style={styles.fabMenuLabel}>Leaderboard</Text>
              </TouchableOpacity>

              {/* CONDITIONAL: Hitting - only if hittingData */}
              {!!hittingData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('HittingPerformance');
                  }}
                >
                  <MaterialCommunityIcons name="baseball-bat" size={20} color="#EF4444" />
                  <Text style={styles.fabMenuLabel}>Hitting</Text>
                </TouchableOpacity>
              )}

              {/* CONDITIONAL: Pitching - only if hasPitchingData */}
              {hasPitchingData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('PitchingPerformance', { athleteId });
                  }}
                >
                  <MaterialCommunityIcons name="baseball" size={20} color="#3B82F6" />
                  <Text style={styles.fabMenuLabel}>Pitching</Text>
                </TouchableOpacity>
              )}

              {/* CONDITIONAL: Arm Care - only if hasArmCareData */}
              {!!armCareData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('ArmCare', { athleteId });
                  }}
                >
                  <MaterialCommunityIcons name="arm-flex" size={20} color="#10B981" />
                  <Text style={styles.fabMenuLabel}>Arm Care</Text>
                </TouchableOpacity>
              )}

              {/* CONDITIONAL: Force Profile - only if hasForceData */}
              {!!(forceProfile && valdProfileId) && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('ForceProfile', { athleteId });
                  }}
                >
                  <Ionicons name="trending-up" size={20} color="#A855F7" />
                  <Text style={styles.fabMenuLabel}>Force Profile</Text>
                </TouchableOpacity>
              )}

              {/* Notes/Resources - always visible, with badge for new items */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Resources', { athleteId, userId });
                }}
              >
                <View style={styles.fabMenuIconContainer}>
                  <Ionicons name="document-text" size={20} color="#F59E0B" />
                  {newResourcesCount > 0 && (
                    <View style={styles.fabMenuItemBadge}>
                      <Text style={styles.fabMenuItemBadgeText}>
                        {newResourcesCount > 9 ? '9+' : newResourcesCount}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.fabMenuLabel}>Notes/Resources</Text>
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
  calendarContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
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
    width: CALENDAR_DAY_SIZE,
    height: CALENDAR_DAY_SIZE,
  },
  calendarDay: {
    width: CALENDAR_DAY_SIZE,
    height: CALENDAR_DAY_SIZE,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
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
  dayViewContainer: {
    flex: 1,
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
  // FAB Dynamic styles (matching web app)
  fabNotificationBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    minWidth: 24,
    height: 24,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 20,
  },
  fabNotificationBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 4,
  },
  fabMenuItemActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
  },
  fabMenuLabelActive: {
    color: '#9BDDFF',
  },
  fabMenuIconContainer: {
    position: 'relative',
  },
  fabMenuItemBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    backgroundColor: '#EF4444',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  fabMenuItemBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 3,
  },
  // Enhanced Day View Styles
  workoutDetailCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#9BDDFF',
  },
  workoutDetailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  workoutDetailHeaderInfo: {
    flex: 1,
  },
  workoutDetailName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  workoutDetailMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  workoutDetailCategory: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  workoutDetailDuration: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  workoutDetailStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  workoutNotes: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  workoutNotesLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9BDDFF',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  workoutNotesText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 18,
  },
  routinesContainer: {
    gap: 12,
  },
  routineCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  routineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  routineName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  routineScheme: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
  },
  routineNotesBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#3b82f6',
  },
  routineNotesText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 16,
  },
  routineTextInfoBox: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#fbbf24',
  },
  routineTextInfoText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 16,
  },
  exercisesContainer: {
    gap: 8,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  exerciseCode: {
    fontSize: 14,
    fontWeight: '700',
    color: '#9BDDFF',
    width: 32,
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  exerciseDetails: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  workoutActions: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  startWorkoutButton: {
    backgroundColor: '#22c55e',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  startWorkoutButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  resumeWorkoutButton: {
    backgroundColor: '#f59e0b',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  resumeWorkoutButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  viewWorkoutButton: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#9BDDFF',
  },
  viewWorkoutButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9BDDFF',
  },
  bookingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#3b82f6',
  },
  bookingInfo: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  // Week View Styles
  weekNavHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  weekNavButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 20,
  },
  weekNavButtonText: {
    fontSize: 24,
    color: '#9BDDFF',
    fontWeight: '700',
  },
  weekNavTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  weekViewContainer: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 12,
  },
  weekScroll: {
    paddingHorizontal: 8,
  },
  weekGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  weekDay: {
    width: 50,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  weekDaySelected: {
    backgroundColor: '#9BDDFF',
  },
  weekDayToday: {
    borderWidth: 1,
    borderColor: '#9BDDFF',
  },
  weekDayName: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 4,
  },
  weekDayNameSelected: {
    color: '#0A0A0A',
    fontWeight: '600',
  },
  weekDayNumber: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  weekDayNumberSelected: {
    color: '#0A0A0A',
  },
  weekDayNumberToday: {
    color: '#9BDDFF',
  },
  weekDayDots: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 4,
  },
  weekDayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  workoutsScrollView: {
    flex: 1,
  },
  workoutsContainer: {
    padding: 16,
    paddingBottom: 100, // Extra space for FAB and content visibility
  },
  workoutCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 12,
    padding: 16,
  },
  workoutCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  workoutActionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#9BDDFF',
  },
  workoutActionButtonCompleted: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  workoutActionButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  workoutCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  workoutCardHeaderSimple: {
    marginBottom: 8,
  },
  workoutCardHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  workoutCardName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  workoutCardDuration: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  expandButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
  },
  expandButtonText: {
    fontSize: 20,
    color: '#9BDDFF',
    fontWeight: '700',
    transform: [{ rotate: '90deg' }],
  },
  expandButtonTextExpanded: {
    transform: [{ rotate: '-90deg' }],
  },
  workoutPreview: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  workoutPreviewNotes: {
    marginBottom: 12,
    padding: 12,
    backgroundColor: 'rgba(155, 221, 255, 0.05)',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#9BDDFF',
  },
  workoutPreviewNotesText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 18,
  },
  routinesList: {
    gap: 12,
  },
  routinePreview: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 8,
    padding: 12,
  },
  routinePreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  routinePreviewName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  routinePreviewScheme: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '600',
  },
  routinePreviewInfo: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  exercisesList: {
    gap: 6,
  },
  exercisePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  exercisePreviewCode: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9BDDFF',
    width: 28,
  },
  exercisePreviewName: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  exercisePreviewSets: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  exercisePreviewMore: {
    fontSize: 12,
    color: 'rgba(155, 221, 255, 0.7)',
    fontStyle: 'italic',
    marginTop: 4,
    paddingLeft: 36,
  },
  // Resume Workout Modal Styles
  resumeModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  resumeModalContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: 24,
    padding: 24,
    maxWidth: 400,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  resumeModalIconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  resumeModalIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resumeModalIconText: {
    fontSize: 32,
  },
  resumeModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  resumeModalWorkoutName: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    marginBottom: 4,
  },
  resumeModalTime: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    marginBottom: 20,
  },
  resumeModalInfoBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    padding: 16,
    marginBottom: 24,
  },
  resumeModalInfoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#60A5FA',
    marginBottom: 4,
  },
  resumeModalInfoText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  resumeModalActions: {
    gap: 12,
  },
  resumeModalPrimaryButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  resumeModalPrimaryButtonGradient: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  resumeModalPrimaryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  resumeModalSecondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  resumeModalSecondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  resumeModalTertiaryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  resumeModalTertiaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  // Settings dropdown styles
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  settingsDropdown: {
    position: 'absolute',
    top: 100,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 200,
    padding: 8,
  },
  settingsMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  settingsMenuLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  settingsDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 4,
  },
});
