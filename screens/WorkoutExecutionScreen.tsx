import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Dimensions,
  Modal,
  Image,
  KeyboardAvoidingView,
  Platform,
  Linking,
  BackHandler,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatExerciseMetrics } from '../lib/formatExerciseMetrics';
import {
  isThrowingVelocityMetric,
  calculateThrowingTarget,
  calculateStrengthTarget
} from '../lib/throwingConversions';

// Types
type RootStackParamList = {
  WorkoutExecution: { instanceId: string };
  Dashboard: undefined;
};

type WorkoutExecutionRouteProp = RouteProp<RootStackParamList, 'WorkoutExecution'>;
type WorkoutExecutionNavigationProp = StackNavigationProp<RootStackParamList, 'WorkoutExecution'>;

interface WorkoutInstance {
  id: string;
  workout_id: string;
  athlete_id: string;
  scheduled_date: string;
  status: 'not_started' | 'in_progress' | 'completed';
  started_at?: string;
  completed_at?: string;
}

interface Workout {
  id: string;
  name: string;
  category: string;
  notes?: string;
  description?: string;
  estimated_duration_minutes?: number;
  routines: Routine[];
}

interface Routine {
  id: string;
  name: string;
  description?: string;
  notes?: string;
  text_info?: string;
  order_index: number;
  routine_exercises: RoutineExercise[];
}

interface SetConfiguration {
  metric_values?: Record<string, number>;
  is_amrap?: boolean;
  notes?: string;
  intensity_targets?: Array<{
    metric: string;
    percent: number;
  }>;
}

interface Measurement {
  id: string;
  name: string;
  type: string;
  unit?: string;
  enabled?: boolean;
}

interface RoutineExercise {
  id: string;
  exercise_id: string;
  sets: number;
  reps?: string;  // Legacy
  weight?: string;  // Legacy
  tempo?: string;
  notes?: string;
  order_index: number;
  tracked_max_metrics?: string[];

  // Modern configuration
  metric_targets?: Record<string, number>;
  intensity_targets?: Array<{
    metric: string;
    percent: number;
  }>;
  enabled_measurements?: string[];
  is_amrap?: boolean;
  set_configurations?: SetConfiguration[];

  exercises: Exercise;
}

interface Exercise {
  id: string;
  name: string;
  video_url?: string;
  instructions?: string;
  equipment?: string;
  is_placeholder?: boolean;
  category?: string;
  metric_schema?: {
    measurements: Measurement[];
  };
}

interface ExerciseInput {
  reps?: number | string;
  weight?: number | string;
  [key: string]: any; // For custom metrics
}

interface WorkoutState {
  workoutInstanceId: string;
  athleteId: string;
  athleteName: string;
  workoutName: string;
  startedAt: string;
  currentExerciseIndex: number;
  exercises: Array<{
    id: string;
    name: string;
    sets: number;
    reps: string;
    weight: string;
    notes: string;
    completedSets: number;
    setLogs: Array<any>;
  }>;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; button: string }> = {
  hitting: { bg: '#ef4444', text: '#fff', button: '#dc2626' },
  throwing: { bg: '#3b82f6', text: '#fff', button: '#2563eb' },
  strength_conditioning: { bg: '#22c55e', text: '#fff', button: '#16a34a' },
  armcare: { bg: '#8b5cf6', text: '#fff', button: '#7c3aed' },
};

export default function WorkoutExecutionScreen() {
  const route = useRoute<WorkoutExecutionRouteProp>();
  const navigation = useNavigation<WorkoutExecutionNavigationProp>();
  const { instanceId } = route.params;

  // State
  const [loading, setLoading] = useState(true);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [instance, setInstance] = useState<WorkoutInstance | null>(null);
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);

  // Exercise inputs - keyed by exercise ID
  const [exerciseInputs, setExerciseInputs] = useState<Record<string, ExerciseInput[]>>({});

  // Timer
  const [timer, setTimer] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);

  // View mode: 'overview' | 'exercise'
  const [viewMode, setViewMode] = useState<'overview' | 'exercise'>('overview');
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [currentSetIndex, setCurrentSetIndex] = useState(0);

  // Custom measurements (for formatting)
  const [customMeasurements, setCustomMeasurements] = useState<any[]>([]);

  // Athlete maxes - shared across all exercises in the workout
  // Format: { exerciseId: { metricId: maxValue } }
  const [athleteMaxes, setAthleteMaxes] = useState<Record<string, Record<string, number>>>({});
  const [moundVelocity, setMoundVelocity] = useState<number | null>(null);

  // Exercise history - Format: { exerciseId: Array<HistoryEntry> }
  const [exerciseHistory, setExerciseHistory] = useState<Record<string, any[]>>({});
  const [showHistoryForExercise, setShowHistoryForExercise] = useState<string | null>(null);

  // FAB menu
  const [showFabMenu, setShowFabMenu] = useState(false);

  // Incomplete warning modal
  const [showIncompleteWarning, setShowIncompleteWarning] = useState(false);
  const [incompleteExercises, setIncompleteExercises] = useState<any[]>([]);

  // Fetch athlete ID on mount
  useEffect(() => {
    fetchAthleteId();
  }, []);

  // Fetch data when athlete ID and instance ID are available
  useEffect(() => {
    if (instanceId && athleteId) {
      fetchWorkoutData();
    }
  }, [instanceId, athleteId]);

  // Timer effect
  useEffect(() => {
    if (timerActive) {
      timerInterval.current = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    } else {
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
        timerInterval.current = null;
      }
    }

    return () => {
      if (timerInterval.current) {
        clearInterval(timerInterval.current);
      }
    };
  }, [timerActive]);

  // Auto-save workout state
  useEffect(() => {
    if (instance && instance.status === 'in_progress' && workout && routines.length > 0) {
      saveWorkoutState();
    }
  }, [exerciseInputs, instance, workout, routines]);

  // Hardware back button handler (Android)
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (instance?.status === 'in_progress') {
        handleExitWorkout();
        return true; // Prevent default back behavior
      }
      return false; // Allow default back behavior
    });

    return () => backHandler.remove();
  }, [instance?.status]);

  async function fetchAthleteId() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'Not logged in');
        navigation.goBack();
        return;
      }

      const { data: athlete, error } = await supabase
        .from('athletes')
        .select('id, org_id')
        .eq('user_id', user.id)
        .single();

      if (error || !athlete) {
        Alert.alert('Error', 'Could not find athlete profile');
        navigation.goBack();
        return;
      }

      setAthleteId(athlete.id);
    } catch (err) {
      console.error('Error fetching athlete ID:', err);
      Alert.alert('Error', 'Failed to load profile');
      navigation.goBack();
    }
  }

  // Fetch athlete maxes for all exercises in the workout
  async function fetchAthleteMaxes(athleteId: string, routines: Routine[]) {
    try {
      // First, fetch mound velocity (5oz baseball velocity with null exercise_id)
      const { data: moundData } = await supabase
        .from('athlete_maxes')
        .select('max_value')
        .eq('athlete_id', athleteId)
        .is('exercise_id', null)
        .like('metric_id', '%5oz%')
        .order('achieved_on', { ascending: false })
        .limit(1)
        .single();

      if (moundData?.max_value) {
        setMoundVelocity(moundData.max_value);
      }

      // Collect all exercise IDs from all routines
      const exerciseIds: string[] = [];
      routines.forEach((routine) => {
        routine.routine_exercises?.forEach((ex) => {
          if (ex.exercise_id) {
            exerciseIds.push(ex.exercise_id);
          }
        });
      });

      if (exerciseIds.length === 0) return;

      // Fetch maxes for all exercises in this workout
      const { data: maxesData } = await supabase
        .from('athlete_maxes')
        .select('exercise_id, metric_id, max_value, achieved_on')
        .eq('athlete_id', athleteId)
        .in('exercise_id', exerciseIds)
        .order('achieved_on', { ascending: false });

      if (maxesData && maxesData.length > 0) {
        // Group by exercise_id and metric_id, keeping only most recent max
        const maxesByExercise: Record<string, Record<string, number>> = {};

        maxesData.forEach((max: any) => {
          const { exercise_id, metric_id, max_value } = max;

          if (!maxesByExercise[exercise_id]) {
            maxesByExercise[exercise_id] = {};
          }

          // Only store if we haven't seen this metric yet (already sorted by date desc)
          if (!maxesByExercise[exercise_id][metric_id]) {
            maxesByExercise[exercise_id][metric_id] = max_value;
          }
        });

        setAthleteMaxes(maxesByExercise);
      }
    } catch (err) {
      console.error('Error fetching athlete maxes:', err);
      // Non-fatal error - continue without maxes
    }
  }

  // Update athlete max (called when PR is logged during workout)
  function updateAthleteMax(exerciseId: string, metricId: string, maxValue: number) {
    setAthleteMaxes(prev => ({
      ...prev,
      [exerciseId]: {
        ...(prev[exerciseId] || {}),
        [metricId]: maxValue
      }
    }));
  }

  // Fetch exercise history for a specific exercise
  async function fetchExerciseHistory(exerciseId: string) {
    if (!athleteId || exerciseHistory[exerciseId]) return; // Already fetched or no athlete

    try {
      // Fetch last 5 workout sessions where this exercise was performed
      const { data: historyData, error } = await supabase
        .from('set_logs')
        .select(`
          *,
          workout_instances!inner (
            id,
            scheduled_date,
            completed_at,
            workouts!inner (
              name
            )
          )
        `)
        .eq('athlete_id', athleteId)
        .eq('exercise_id', exerciseId)
        .not('workout_instances.completed_at', 'is', null)
        .order('workout_instances(completed_at)', { ascending: false })
        .limit(50); // Fetch more sets to group into sessions

      if (error) {
        console.error('Error fetching exercise history:', error);
        return;
      }

      if (historyData && historyData.length > 0) {
        // Group set logs by workout instance
        const sessionMap = new Map<string, any>();

        historyData.forEach((log: any) => {
          const instanceId = log.workout_instances.id;
          if (!sessionMap.has(instanceId)) {
            sessionMap.set(instanceId, {
              instanceId,
              workoutName: log.workout_instances.workouts.name,
              completedAt: log.workout_instances.completed_at,
              sets: []
            });
          }
          sessionMap.get(instanceId)!.sets.push(log);
        });

        // Convert to array and take only the last 5 sessions
        const sessions = Array.from(sessionMap.values())
          .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
          .slice(0, 5);

        setExerciseHistory(prev => ({
          ...prev,
          [exerciseId]: sessions
        }));
      }
    } catch (err) {
      console.error('Error fetching exercise history:', err);
    }
  }

  async function fetchWorkoutData() {
    try {
      setLoading(true);

      // Fetch workout instance
      const { data: inst, error: instError } = await supabase
        .from('workout_instances')
        .select('*')
        .eq('id', instanceId)
        .single();

      if (instError || !inst) {
        Alert.alert('Error', 'Workout not found');
        navigation.goBack();
        return;
      }

      setInstance(inst);

      // Fetch workout with full routine and exercise data
      const { data: wo, error: woError } = await supabase
        .from('workouts')
        .select(`
          *,
          routines (
            *,
            routine_exercises (
              *,
              exercises (
                *
              )
            )
          )
        `)
        .eq('id', inst.workout_id)
        .single();

      if (woError || !wo) {
        Alert.alert('Error', 'Could not load workout details');
        navigation.goBack();
        return;
      }

      setWorkout(wo as Workout);

      // Sort routines and exercises by order_index
      const sorted = (wo.routines || []).sort((a: any, b: any) => a.order_index - b.order_index);
      sorted.forEach((routine: any) => {
        if (routine.routine_exercises) {
          routine.routine_exercises.sort((a: any, b: any) => a.order_index - b.order_index);
        }
      });

      setRoutines(sorted);

      // Fetch custom measurements for metric formatting
      const { data: measurements } = await supabase
        .from('custom_measurements')
        .select('*')
        .order('name');

      if (measurements) {
        setCustomMeasurements(measurements);
      }

      // Fetch athlete maxes (including mound velocity)
      if (inst.athlete_id) {
        await fetchAthleteMaxes(inst.athlete_id, sorted);
      }

      // Try to restore saved state
      await restoreSavedState(inst, sorted);

      setLoading(false);
    } catch (err) {
      console.error('Error fetching workout data:', err);
      Alert.alert('Error', 'Failed to load workout');
      navigation.goBack();
    }
  }

  async function restoreSavedState(inst: WorkoutInstance, sorted: Routine[]) {
    try {
      const saved = await AsyncStorage.getItem(`workout_${instanceId}`);
      if (!saved) {
        // No saved state, but if workout is in progress, start the timer
        if (inst.status === 'in_progress') {
          setTimerActive(true);
        }
        return;
      }

      const state: WorkoutState = JSON.parse(saved);

      // Restore inputs
      const restoredInputs: Record<string, ExerciseInput[]> = {};
      state.exercises.forEach(ex => {
        restoredInputs[ex.id] = ex.setLogs.map(log => {
          const { setNumber, completedAt, ...inputData } = log;
          return inputData;
        });
      });

      setExerciseInputs(restoredInputs);

      // If workout is in progress, start the timer
      if (inst.status === 'in_progress') {
        setTimerActive(true);
      }

      console.log('✅ Restored workout state');
    } catch (err) {
      console.error('Error restoring state:', err);
    }
  }

  async function saveWorkoutState() {
    if (!workout || !instance || !athleteId) return;

    const allExercises = routines.flatMap(r =>
      (r.routine_exercises || []).filter(ex => !ex.exercises?.is_placeholder)
    );

    const state: WorkoutState = {
      workoutInstanceId: instanceId,
      athleteId,
      athleteName: 'Athlete', // TODO: Get actual name
      workoutName: workout.name,
      startedAt: instance.started_at || new Date().toISOString(),
      currentExerciseIndex: allExercises.findIndex(ex => ex.id === activeExerciseId),
      exercises: allExercises.map(ex => ({
        id: ex.id,
        name: ex.exercises.name,
        sets: ex.sets,
        reps: ex.reps || '',
        weight: ex.weight || '',
        notes: ex.notes || '',
        completedSets: (exerciseInputs[ex.id] || []).filter(input =>
          input && (input.reps || input.weight)
        ).length,
        setLogs: (exerciseInputs[ex.id] || []).map((input, idx) => ({
          setNumber: idx + 1,
          ...input,
          completedAt: new Date().toISOString(),
        })),
      })),
    };

    await AsyncStorage.setItem(`workout_${instanceId}`, JSON.stringify(state));
  }

  async function startWorkout() {
    try {
      // Update instance status
      const { error } = await supabase
        .from('workout_instances')
        .update({
          status: 'in_progress',
        })
        .eq('id', instanceId);

      if (error) throw error;

      // Update local state
      setInstance(prev => prev ? {
        ...prev,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      } : null);

      // Start timer
      setTimerActive(true);
    } catch (err) {
      console.error('Error starting workout:', err);
      Alert.alert('Error', 'Failed to start workout');
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function handleExitWorkout() {
    Alert.alert(
      'Exit Workout',
      'Are you sure you want to exit? Your progress has been saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9BDDFF" />
        <Text style={styles.loadingText}>Loading workout...</Text>
      </View>
    );
  }

  if (!instance || !workout) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Workout not found</Text>
      </View>
    );
  }

  const allExercises = routines.flatMap(r =>
    (r.routine_exercises || []).filter(ex => !ex.exercises?.is_placeholder)
  );

  const categoryInfo = CATEGORY_COLORS[workout.category] || CATEGORY_COLORS.strength_conditioning;

  // Render pre-workout start page
  if (instance.status === 'not_started') {
    return (
      <View style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* Header */}
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle}>{workout.name}</Text>
            <Text style={styles.previewSubtitle}>
              {allExercises.length} exercises • {routines.length} {routines.length === 1 ? 'block' : 'blocks'}
            </Text>
          </View>

          {/* Workout Notes */}
          {(workout.notes || workout.description) && (
            <Text style={styles.workoutNotesSimple}>
              {workout.notes || workout.description}
            </Text>
          )}

          {/* Blocks and Exercises Preview */}
          {routines.map((routine, routineIdx) => {
            const schemeNames = ['exercise', 'superset', 'emom', 'circuit', 'amrap', 'straight_sets'];
            const hasBlockTitle = routine.name && !schemeNames.includes(routine.name.toLowerCase());
            const exercises = (routine.routine_exercises || []).filter(ex => !ex.exercises?.is_placeholder);
            const blockLetter = String.fromCharCode(65 + routineIdx);

            return (
              <View key={routine.id} style={styles.blockSection}>
                {/* Block Header */}
                {hasBlockTitle && (
                  <View style={styles.blockHeader}>
                    <Text style={styles.blockTitle}>{routine.name.toUpperCase()}</Text>
                    {routine.description && (
                      <Text style={styles.blockDescription}>{routine.description}</Text>
                    )}
                    {routine.notes && (
                      <Text style={styles.blockNotesText}>{routine.notes}</Text>
                    )}
                    {routine.text_info && (
                      <Text style={styles.blockTextInfoText}>{routine.text_info}</Text>
                    )}
                  </View>
                )}

                {/* Exercises - flat list */}
                {exercises.map((ex, exIdx) => {
                  const exercise = ex.exercises;
                  if (!exercise) return null;

                  const exerciseCode = `${blockLetter}${exIdx + 1}`;
                  const tracksPR = ex.tracked_max_metrics && ex.tracked_max_metrics.length > 0;

                  const metricsDisplay = formatExerciseMetrics({
                    exercise: ex,
                    customMeasurements,
                    separator: '|||'
                  });

                  const metricRows = metricsDisplay ? metricsDisplay.split('|||') : [];

                  return (
                    <View key={ex.id} style={styles.exerciseRow}>
                      <View style={styles.exerciseCodeBadge}>
                        <Text style={styles.exerciseCodeText}>{exerciseCode}</Text>
                      </View>
                      <View style={styles.exerciseContent}>
                        <Text style={styles.exerciseName}>
                          {exercise.name}
                          {tracksPR && ' 🏆'}
                        </Text>
                        {metricRows.map((row, idx) => (
                          <Text key={idx} style={styles.metricRow}>{row.trim()}</Text>
                        ))}
                        {ex.tempo && (
                          <Text style={styles.tempoText}>Tempo: {ex.tempo}</Text>
                        )}
                        {ex.notes && (
                          <Text style={styles.exerciseNotesText}>{ex.notes}</Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>

        {/* Start Workout Button */}
        <View style={styles.startButtonContainer}>
          <TouchableOpacity
            style={[styles.startButton, { backgroundColor: categoryInfo.button }]}
            onPress={startWorkout}
          >
            <Text style={styles.startButtonText}>Start Workout</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Render workout execution interface
  return (
    <View style={styles.container}>
      {/* Header with timer and progress */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={viewMode === 'exercise' ? () => { setViewMode('overview'); setActiveExerciseId(null); } : handleExitWorkout}
          style={styles.exitButton}
        >
          <Text style={styles.exitButtonText}>{viewMode === 'exercise' ? '‹' : '✕'}</Text>
        </TouchableOpacity>

        <View style={styles.headerCenter}>
          <Text style={styles.workoutName}>{workout.name}</Text>
          <Text style={styles.timer}>{formatTime(timer)}</Text>
        </View>

        <View style={styles.headerRight} />
      </View>

      {/* Workout Execution Content */}
      {viewMode === 'overview' ? (
        // BLOCK OVERVIEW MODE - List of all exercises
        <ScrollView style={styles.executionScroll} contentContainerStyle={styles.executionScrollContent}>
          {/* Workout Notes */}
          {(workout.notes || workout.description) && (
            <Text style={styles.workoutNotesSimple}>
              {workout.notes || workout.description}
            </Text>
          )}

          {routines.map((routine, routineIdx) => {
            const schemeNames = ['exercise', 'superset', 'emom', 'circuit', 'amrap', 'straight_sets'];
            const hasBlockTitle = routine.name && !schemeNames.includes(routine.name.toLowerCase());
            const exercises = (routine.routine_exercises || []).filter(ex => !ex.exercises?.is_placeholder);
            const blockLetter = String.fromCharCode(65 + routineIdx);

            return (
              <View key={routine.id} style={styles.blockSection}>
                {/* Block Header */}
                {hasBlockTitle && (
                  <View style={styles.blockHeader}>
                    <Text style={styles.blockTitle}>{routine.name.toUpperCase()}</Text>
                    {routine.description && (
                      <Text style={styles.blockDescription}>{routine.description}</Text>
                    )}
                    {routine.notes && (
                      <Text style={styles.blockNotesText}>{routine.notes}</Text>
                    )}
                    {routine.text_info && (
                      <Text style={styles.blockTextInfoText}>{routine.text_info}</Text>
                    )}
                  </View>
                )}

                {/* Exercises - flat list */}
                {exercises.map((ex, exIdx) => {
                  const exercise = ex.exercises;
                  if (!exercise) return null;

                  const exerciseCode = `${blockLetter}${exIdx + 1}`;
                  const tracksPR = ex.tracked_max_metrics && ex.tracked_max_metrics.length > 0;

                  const metricsDisplay = formatExerciseMetrics({
                    exercise: ex,
                    customMeasurements,
                    separator: '|||'
                  });

                  const metricRows = metricsDisplay ? metricsDisplay.split('|||') : [];
                  const totalSets = ex.sets || 3;

                  const inputs = exerciseInputs[ex.id] || [];
                  const completedSets = inputs.filter(input =>
                    input && Object.keys(input).some(key =>
                      key !== 'notes' && input[key] && input[key] !== '' && input[key] !== 0
                    )
                  ).length;

                  const getYouTubeVideoId = (url: string | null | undefined): string | null => {
                    if (!url) return null;
                    const patterns = [
                      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
                      /youtube\.com\/embed\/([^&\n?#]+)/
                    ];
                    for (const pattern of patterns) {
                      const match = url.match(pattern);
                      if (match && match[1]) return match[1];
                    }
                    return null;
                  };

                  const getThumbnail = (videoUrl: string | null | undefined): string | null => {
                    const videoId = getYouTubeVideoId(videoUrl);
                    return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
                  };

                  const thumbnail = getThumbnail(exercise.video_url);

                  return (
                    <TouchableOpacity
                      key={ex.id}
                      onPress={() => {
                        setActiveExerciseId(ex.id);
                        setViewMode('exercise');
                        setCurrentSetIndex(0);
                      }}
                      activeOpacity={0.7}
                      style={styles.exerciseRow}
                    >
                      <View style={styles.exerciseCodeBadge}>
                        <Text style={styles.exerciseCodeText}>{exerciseCode}</Text>
                      </View>

                      {/* Video Thumbnail */}
                      <View style={styles.videoThumbnail}>
                        {thumbnail ? (
                          <Image
                            source={{ uri: thumbnail }}
                            style={styles.thumbnailImage}
                          />
                        ) : (
                          <View style={styles.thumbnailPlaceholder}>
                            <Text style={styles.playIcon}>▶</Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.exerciseContent}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={styles.exerciseName}>
                            {exercise.name}
                            {tracksPR && ' 🏆'}
                          </Text>
                          <Text style={styles.progressBadge}>
                            {completedSets}/{totalSets}
                          </Text>
                        </View>
                        {metricRows.map((row, idx) => {
                          // Parse the row to highlight percentages in blue (e.g., @72%)
                          const parts = row.trim().split(/(@\d+%)/g);
                          return (
                            <Text key={idx} style={styles.metricRow}>
                              {idx === 0 && <Text style={{ fontWeight: '600' }}>{totalSets} × </Text>}
                              {parts.map((part, partIdx) => {
                                if (/@\d+%/.test(part)) {
                                  return (
                                    <Text key={partIdx} style={{ color: '#9BDDFF' }}>
                                      {part}
                                    </Text>
                                  );
                                }
                                return part;
                              })}
                            </Text>
                          );
                        })}
                        {ex.tempo && (
                          <Text style={styles.tempoText}>Tempo: {ex.tempo}</Text>
                        )}
                        {ex.notes && (
                          <Text style={styles.exerciseNotesText}>{ex.notes}</Text>
                        )}
                      </View>

                      {/* Arrow indicator */}
                      <Text style={styles.arrowIndicator}>›</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}

          <View style={{ height: 100 }} />
        </ScrollView>
      ) : (
        // EXERCISE DETAIL MODE - Full set logger
        (() => {
          const allExercises = routines.flatMap(r =>
            (r.routine_exercises || []).filter(ex => !ex.exercises?.is_placeholder)
          );
          const currentIndex = allExercises.findIndex(ex => ex.id === activeExerciseId);
          const currentExercise = allExercises[currentIndex];

          if (!currentExercise) {
            return (
              <View style={styles.executionContainer}>
                <Text style={styles.placeholderText}>Exercise not found</Text>
              </View>
            );
          }

          const exercise = currentExercise.exercises;
          const targetSets = currentExercise.sets || 3;
          const inputs = exerciseInputs[activeExerciseId!] || [];

          // Find block label
          let blockLabel = '';
          let routineIdx = 0;
          for (const routine of routines) {
            const exercises = routine.routine_exercises || [];
            const exIdx = exercises.findIndex(ex => ex.id === activeExerciseId);
            if (exIdx !== -1) {
              const blockLetter = String.fromCharCode(65 + routineIdx);
              blockLabel = `${blockLetter}${exIdx + 1}`;
              break;
            }
            routineIdx++;
          }

          // Handle input change
          const handleInputChange = (setIndex: number, field: string, value: string) => {
            setExerciseInputs(prev => {
              const exerciseData = prev[activeExerciseId!] || [];
              const updatedData = [...exerciseData];

              while (updatedData.length <= setIndex) {
                updatedData.push({});
              }

              updatedData[setIndex] = {
                ...updatedData[setIndex],
                [field]: value,
              };

              return {
                ...prev,
                [activeExerciseId!]: updatedData,
              };
            });
          };

          // Find current block and position
          const getCurrentBlock = () => {
            for (const routine of routines) {
              const exercises = routine.routine_exercises || [];
              const exIdx = exercises.findIndex(ex => ex.id === activeExerciseId);
              if (exIdx !== -1) {
                return {
                  routine,
                  exercises,
                  indexInBlock: exIdx,
                  isSuperset: exercises.length > 1
                };
              }
            }
            return null;
          };

          const currentBlock = getCurrentBlock();

          // Navigation handlers - block-aware
          const handleNext = () => {
            if (!currentBlock) return;

            const { routine, exercises, indexInBlock, isSuperset } = currentBlock;

            // STRAIGHT SETS: Auto-advance to next set if not all sets complete
            if (!isSuperset) {
              // Check if current set has data
              const currentSetData = inputs[currentSetIndex] || {};
              const hasData = Object.keys(currentSetData).some(key =>
                key !== 'notes' && currentSetData[key] && currentSetData[key] !== '' && currentSetData[key] !== 0
              );

              // If current set has data and there are more sets, go to next set
              if (hasData && currentSetIndex < targetSets - 1) {
                setCurrentSetIndex(currentSetIndex + 1);
                return;
              }

              // Otherwise, go to next exercise
              if (currentIndex < allExercises.length - 1) {
                setActiveExerciseId(allExercises[currentIndex + 1].id);
                setCurrentSetIndex(0);
              } else {
                setViewMode('overview');
                setActiveExerciseId(null);
              }
              return;
            }

            // SUPERSET: Cycle through ALL exercises in block for current round, then move to next round
            if (isSuperset) {
              // If not the last exercise in block, go to next exercise in same round
              if (indexInBlock < exercises.length - 1) {
                setActiveExerciseId(exercises[indexInBlock + 1].id);
                // Keep same set index (round)
                return;
              }
              // Last exercise in block - check if there are more rounds
              if (currentSetIndex < targetSets - 1) {
                // More rounds remaining - go back to first exercise, next round
                setActiveExerciseId(exercises[0].id);
                setCurrentSetIndex(currentSetIndex + 1);
                return;
              }
              // All rounds complete - find next block
              const currentRoutineIdx = routines.findIndex(r => r.id === routine.id);
              if (currentRoutineIdx < routines.length - 1) {
                const nextRoutine = routines[currentRoutineIdx + 1];
                const nextExercises = nextRoutine.routine_exercises || [];
                if (nextExercises.length > 0) {
                  setActiveExerciseId(nextExercises[0].id);
                  setCurrentSetIndex(0);
                  return;
                }
              }
              // No more blocks
              setViewMode('overview');
              setActiveExerciseId(null);
            }
          };

          const handlePrev = () => {
            if (!currentBlock) return;

            const { routine, exercises, indexInBlock, isSuperset } = currentBlock;

            // SUPERSET: Go back through exercises in block
            if (isSuperset) {
              // If not the first exercise in block, go to previous exercise
              if (indexInBlock > 0) {
                setActiveExerciseId(exercises[indexInBlock - 1].id);
                setCurrentSetIndex(0);
                return;
              }
              // If first exercise in block, find previous block
              const currentRoutineIdx = routines.findIndex(r => r.id === routine.id);
              if (currentRoutineIdx > 0) {
                const prevRoutine = routines[currentRoutineIdx - 1];
                const prevExercises = prevRoutine.routine_exercises || [];
                if (prevExercises.length > 0) {
                  // Go to last exercise of previous block
                  setActiveExerciseId(prevExercises[prevExercises.length - 1].id);
                  setCurrentSetIndex(0);
                  return;
                }
              }
            }
            // STRAIGHT SETS: Just go to previous exercise in flat list
            else {
              if (currentIndex > 0) {
                setActiveExerciseId(allExercises[currentIndex - 1].id);
                setCurrentSetIndex(0);
              }
            }
          };

          // Helper to get ball icon component based on metric key
          const getBallIcon = (metricKey: string): JSX.Element | null => {
            // Plyo balls - colored dots
            if (metricKey.includes('blue')) {
              return <View style={[styles.ballIcon, { backgroundColor: '#3B82F6', borderColor: '#2563EB' }]} />;
            }
            if (metricKey.includes('red')) {
              return <View style={[styles.ballIcon, { backgroundColor: '#EF4444', borderColor: '#DC2626' }]} />;
            }
            if (metricKey.includes('yellow')) {
              return <View style={[styles.ballIcon, { backgroundColor: '#FACC15', borderColor: '#EAB308' }]} />;
            }
            if (metricKey.includes('gray')) {
              return <View style={[styles.ballIcon, { backgroundColor: '#9CA3AF', borderColor: '#6B7280' }]} />;
            }
            if (metricKey.includes('green')) {
              return <View style={[styles.ballIcon, { backgroundColor: '#22C55E', borderColor: '#16A34A' }]} />;
            }

            // Weighted balls - white baseballs with colored text showing oz
            if (metricKey.includes('7oz')) {
              return (
                <View style={[styles.baseballIcon, { borderColor: '#DC2626' }]}>
                  <Text style={[styles.baseballText, { color: '#EA580C' }]}>7</Text>
                </View>
              );
            }
            if (metricKey.includes('6oz')) {
              return (
                <View style={[styles.baseballIcon, { borderColor: '#DC2626' }]}>
                  <Text style={[styles.baseballText, { color: '#F97316' }]}>6</Text>
                </View>
              );
            }
            if (metricKey.includes('5oz')) {
              return (
                <View style={[styles.baseballIcon, { borderColor: '#DC2626' }]}>
                  <Text style={[styles.baseballText, { color: '#1F2937' }]}>5</Text>
                </View>
              );
            }
            if (metricKey.includes('4oz')) {
              return (
                <View style={[styles.baseballIcon, { borderColor: '#DC2626' }]}>
                  <Text style={[styles.baseballText, { color: '#0891B2' }]}>4</Text>
                </View>
              );
            }
            if (metricKey.includes('3oz')) {
              return (
                <View style={[styles.baseballIcon, { borderColor: '#DC2626' }]}>
                  <Text style={[styles.baseballText, { color: '#06B6D4' }]}>3</Text>
                </View>
              );
            }

            return null;
          };

          // Helper to get ball weight for sorting (heaviest to lightest)
          const getBallWeight = (metricKey: string): number => {
            const ballWeightOrder: Record<string, number> = {
              '7oz': 1, '6oz': 2, '5oz': 3, '4oz': 4, '3oz': 5,
              'blue': 6, 'red': 7, 'yellow': 8, 'gray': 9, 'green': 10,
            };
            if (metricKey.includes('7oz')) return ballWeightOrder['7oz'];
            if (metricKey.includes('6oz')) return ballWeightOrder['6oz'];
            if (metricKey.includes('5oz')) return ballWeightOrder['5oz'];
            if (metricKey.includes('4oz')) return ballWeightOrder['4oz'];
            if (metricKey.includes('3oz')) return ballWeightOrder['3oz'];
            if (metricKey.includes('blue')) return ballWeightOrder['blue'];
            if (metricKey.includes('red')) return ballWeightOrder['red'];
            if (metricKey.includes('yellow')) return ballWeightOrder['yellow'];
            if (metricKey.includes('gray')) return ballWeightOrder['gray'];
            if (metricKey.includes('green')) return ballWeightOrder['green'];
            return 999; // Unknown balls go to the end
          };

          const tracksPR = currentExercise.tracked_max_metrics && currentExercise.tracked_max_metrics.length > 0;

          return (
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
            >
              <ScrollView style={styles.exerciseDetailScroll} contentContainerStyle={styles.exerciseDetailScrollContent}>
                {/* Exercise Header */}
                <View style={styles.exerciseDetailHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <View style={styles.exerciseCodeBadge}>
                      <Text style={styles.exerciseCodeText}>{blockLabel}</Text>
                    </View>
                    {currentBlock?.isSuperset && (
                      <Text style={styles.supersetRoundText}>
                        Round {currentSetIndex + 1} of {targetSets}
                      </Text>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[styles.exerciseDetailName, { flex: 1 }]}>{exercise.name}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        if (showHistoryForExercise === currentExercise.id) {
                          setShowHistoryForExercise(null);
                        } else {
                          fetchExerciseHistory(currentExercise.exercise_id);
                          setShowHistoryForExercise(currentExercise.id);
                        }
                      }}
                      style={styles.historyButton}
                    >
                      <Text style={styles.historyButtonText}>
                        {showHistoryForExercise === currentExercise.id ? '✕' : '📊'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {currentExercise.notes && (
                    <Text style={styles.exerciseNotesInDetail}>{currentExercise.notes}</Text>
                  )}
                </View>

                {/* Exercise History Panel */}
                {showHistoryForExercise === currentExercise.id && exerciseHistory[currentExercise.exercise_id] && (
                  <View style={styles.historyPanel}>
                    <Text style={styles.historyPanelTitle}>Recent Sessions</Text>
                    {exerciseHistory[currentExercise.exercise_id].map((session: any, sessionIdx: number) => {
                      const completedDate = new Date(session.completedAt);
                      const now = new Date();
                      const diffMs = now.getTime() - completedDate.getTime();
                      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                      let dateDisplay = '';
                      if (diffDays === 0) {
                        dateDisplay = 'Today';
                      } else if (diffDays === 1) {
                        dateDisplay = 'Yesterday';
                      } else if (diffDays < 7) {
                        dateDisplay = `${diffDays} days ago`;
                      } else if (diffDays < 30) {
                        const weeks = Math.floor(diffDays / 7);
                        dateDisplay = `${weeks} week${weeks > 1 ? 's' : ''} ago`;
                      } else {
                        dateDisplay = completedDate.toLocaleDateString();
                      }

                      return (
                        <View key={session.instanceId} style={styles.historySession}>
                          <View style={styles.historySessionHeader}>
                            <Text style={styles.historySessionDate}>{dateDisplay}</Text>
                            <Text style={styles.historySessionWorkout}>{session.workoutName}</Text>
                          </View>
                          <View style={styles.historySetsList}>
                            {session.sets.map((set: any, setIdx: number) => (
                              <View key={setIdx} style={styles.historySetRow}>
                                <Text style={styles.historySetNumber}>Set {set.set_number}</Text>
                                <View style={styles.historySetMetrics}>
                                  {set.metric_values && Object.entries(set.metric_values).map(([metricId, value]: [string, any]) => {
                                    const metric = customMeasurements.find(m =>
                                      m.primary_metric_id === metricId || m.secondary_metric_id === metricId
                                    );
                                    const metricName = metric?.primary_metric_id === metricId
                                      ? metric?.primary_metric_name
                                      : metric?.secondary_metric_name || metricId;

                                    // Check if this metric was a PR
                                    const isPR = set.is_pr && set.pr_metric_id === metricId;

                                    return (
                                      <View key={metricId} style={[
                                        styles.historyMetricValueContainer,
                                        isPR && styles.historyMetricValuePR
                                      ]}>
                                        <Text style={styles.historyMetricValue}>
                                          {value} {metricName}
                                        </Text>
                                        {isPR && <Text style={styles.historyPRIcon}>🏆</Text>}
                                      </View>
                                    );
                                  })}
                                </View>
                              </View>
                            ))}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Video Section */}
                {exercise.video_url && (() => {
                  const getYouTubeVideoId = (url: string): string | null => {
                    const patterns = [
                      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
                      /youtube\.com\/embed\/([^&\n?#]+)/
                    ];
                    for (const pattern of patterns) {
                      const match = url.match(pattern);
                      if (match && match[1]) return match[1];
                    }
                    return null;
                  };

                  const videoId = getYouTubeVideoId(exercise.video_url);
                  if (!videoId) return null;

                  return (
                    <View style={styles.videoContainer}>
                      <WebView
                        style={styles.video}
                        source={{ uri: `https://www.youtube.com/embed/${videoId}` }}
                        allowsFullscreenVideo={true}
                        allowsInlineMediaPlayback={true}
                        javaScriptEnabled={true}
                        domStorageEnabled={true}
                        scrollEnabled={false}
                        bounces={false}
                        startInLoadingState={true}
                        renderLoading={() => (
                          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
                            <ActivityIndicator size="large" color="#9BDDFF" />
                          </View>
                        )}
                      />
                    </View>
                  );
                })()}

                {/* Set Logger */}
                {Array.from({ length: targetSets }).map((_, setIndex) => {
                  const setData = inputs[setIndex] || {};
                  const isActive = setIndex === currentSetIndex;

                  // Get configuration for this set (or fallback to exercise-level config)
                  const setConfig = currentExercise.set_configurations?.[setIndex];
                  const isAMRAP = setConfig?.is_amrap || currentExercise.is_amrap;
                  const notes = setConfig?.notes;

                  // Get measurements to display - GROUP by measurement (not individual metrics)
                  const measurements = (() => {
                    // Use enabled_measurements (measurement IDs) if available
                    if (currentExercise.enabled_measurements && currentExercise.enabled_measurements.length > 0) {
                      return currentExercise.enabled_measurements
                        .map((measurementId: string) => {
                          const measurement = customMeasurements.find(m => m.id === measurementId);

                          if (measurement) {
                            return {
                              id: measurement.id,
                              name: measurement.name,
                              category: measurement.category,
                              primary_metric_id: measurement.primary_metric_id,
                              primary_metric_name: measurement.primary_metric_name,
                              primary_metric_type: measurement.primary_metric_type,
                              secondary_metric_id: measurement.secondary_metric_id,
                              secondary_metric_name: measurement.secondary_metric_name,
                              secondary_metric_type: measurement.secondary_metric_type,
                            };
                          }

                          return null;
                        })
                        .filter(m => m !== null);
                    }

                    // Fallback: collect individual metric IDs and try to group them
                    const metricIds = new Set<string>();

                    if (currentExercise.metric_targets) {
                      Object.keys(currentExercise.metric_targets).forEach(id => metricIds.add(id));
                    }

                    if (currentExercise.set_configurations) {
                      currentExercise.set_configurations.forEach((config: any) => {
                        if (config.metric_values) {
                          Object.keys(config.metric_values).forEach(id => metricIds.add(id));
                        }
                      });
                    }

                    if (metricIds.size > 0) {
                      // Group metrics by measurement
                      const measurementMap = new Map();

                      Array.from(metricIds).forEach(metricId => {
                        const measurement = customMeasurements.find(m =>
                          m.primary_metric_id === metricId || m.secondary_metric_id === metricId
                        );

                        if (measurement) {
                          if (!measurementMap.has(measurement.id)) {
                            measurementMap.set(measurement.id, {
                              id: measurement.id,
                              name: measurement.name,
                              category: measurement.category,
                              primary_metric_id: measurement.primary_metric_id,
                              primary_metric_name: measurement.primary_metric_name,
                              primary_metric_type: measurement.primary_metric_type,
                              secondary_metric_id: measurement.secondary_metric_id,
                              secondary_metric_name: measurement.secondary_metric_name,
                              secondary_metric_type: measurement.secondary_metric_type,
                            });
                          }
                        }
                      });

                      return Array.from(measurementMap.values());
                    }

                    // Ultimate fallback
                    return [
                      {
                        id: 'reps',
                        name: 'Reps',
                        category: 'single',
                        primary_metric_id: 'reps',
                        primary_metric_name: 'Reps',
                        primary_metric_type: 'number'
                      },
                      {
                        id: 'weight',
                        name: 'Weight',
                        category: 'single',
                        primary_metric_id: 'weight',
                        primary_metric_name: 'lbs',
                        primary_metric_type: 'number'
                      }
                    ];
                  })();

                  // Get target values for this set
                  const getTargetValue = (metricId: string) => {
                    // First check set_configurations for explicit values
                    if (setConfig?.metric_values?.[metricId]) {
                      return setConfig.metric_values[metricId];
                    }
                    // Then check metric_targets for explicit values
                    if (currentExercise.metric_targets?.[metricId]) {
                      return currentExercise.metric_targets[metricId];
                    }

                    // If no explicit value, check for intensity-based target
                    const intensityPercent = getIntensityPercent(metricId);
                    if (intensityPercent && intensityPercent > 0) {
                      const exerciseMaxes = athleteMaxes[currentExercise.exercise_id] || {};
                      const athleteMax = exerciseMaxes[metricId];

                      if (isThrowingVelocityMetric(metricId)) {
                        // For throwing metrics, use smart fallback to mound velocity
                        const calculatedTarget = calculateThrowingTarget(
                          athleteMax || null,
                          moundVelocity,
                          metricId,
                          intensityPercent
                        );
                        return calculatedTarget;
                      } else if (athleteMax) {
                        // For non-throwing metrics, simple percentage calculation
                        const category = currentExercise.exercises?.category;
                        return calculateStrengthTarget(athleteMax, intensityPercent, category);
                      }
                    }

                    return null;
                  };

                  // Get intensity % for this set
                  const getIntensityPercent = (metricId: string) => {
                    // First check set-level intensity
                    if (setConfig?.intensity_targets) {
                      const intensityTarget = setConfig.intensity_targets.find(t => t.metric === metricId);
                      if (intensityTarget) return intensityTarget.percent;
                    }
                    // Then check exercise-level intensity
                    if (currentExercise.intensity_targets) {
                      const intensityTarget = currentExercise.intensity_targets.find(t => t.metric === metricId);
                      if (intensityTarget) return intensityTarget.percent;
                    }
                    return null;
                  };

                  // Check if set is completed - check all primary metrics are filled
                  const isCompleted = measurements.length > 0 && measurements.every((m: any) => {
                    // For completion, we only require primary metric to be filled
                    const primaryVal = m.primary_metric_id ? setData[m.primary_metric_id] : null;
                    return primaryVal !== undefined && primaryVal !== null && primaryVal !== '' && primaryVal !== 0;
                  });

                  // Check if previous sets are all completed (for chronological enforcement)
                  const canAccess = (() => {
                    // Can always access first set
                    if (setIndex === 0) return true;
                    // Can access current or completed sets
                    if (setIndex <= currentSetIndex || isCompleted) return true;
                    // Check if all previous sets are completed
                    for (let i = 0; i < setIndex; i++) {
                      const prevSetData = inputs[i] || {};
                      const prevCompleted = measurements.length > 0 && measurements.every((m: any) => {
                        const primaryVal = m.primary_metric_id ? prevSetData[m.primary_metric_id] : null;
                        return primaryVal !== undefined && primaryVal !== null && primaryVal !== '' && primaryVal !== 0;
                      });
                      if (!prevCompleted) return false;
                    }
                    return true;
                  })();

                  return (
                    <TouchableOpacity
                      key={setIndex}
                      style={[
                        styles.setCard,
                        isActive && styles.setCardActive,
                        isCompleted && styles.setCardCompleted,
                        !canAccess && styles.setCardDisabled,
                      ]}
                      onPress={() => {
                        if (canAccess) {
                          setCurrentSetIndex(setIndex);
                        }
                      }}
                      activeOpacity={canAccess ? 0.8 : 1}
                      disabled={!canAccess}
                    >
                      <View style={styles.setHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={styles.setNumber}>Set {setIndex + 1}</Text>
                          {(() => {
                            // Get intensity targets for this set
                            const intensityTargets = setConfig?.intensity_targets || currentExercise.intensity_targets || [];
                            const firstIntensity = intensityTargets[0]?.percent;

                            if (firstIntensity && firstIntensity > 0) {
                              return (
                                <Text style={styles.intensityBadgeText}>@{firstIntensity}%</Text>
                              );
                            }
                            return null;
                          })()}
                        </View>
                        {isCompleted && <Text style={styles.completedCheckmark}>✓</Text>}
                      </View>

                      {isActive && (
                        <>
                          {currentExercise.tempo && (
                            <Text style={styles.tempoDisplay}>Tempo: {currentExercise.tempo}</Text>
                          )}

                          {(() => {
                            // Sort measurements by ball weight (heaviest first)
                            const sortedMeasurements = [...measurements].sort((a, b) => {
                              const aWeight = getBallWeight(a.primary_metric_id || a.id);
                              const bWeight = getBallWeight(b.primary_metric_id || b.id);
                              return aWeight - bWeight;
                            });

                            // Separate paired and single measurements
                            const pairedMeasurements = sortedMeasurements.filter(m => m.category === 'paired');
                            const singleMeasurements = sortedMeasurements.filter(m => m.category !== 'paired');

                            return (
                              <View style={{ flexDirection: 'column', gap: 4 }}>
                                {/* Single measurements in one row (reps, weight, etc.) */}
                                {singleMeasurements.length > 0 && (
                                  <View style={{ flexDirection: 'row', gap: 4 }}>
                                    {singleMeasurements.map((measurement: any) => {
                                      const ballIcon = getBallIcon(measurement.primary_metric_id || measurement.id);
                                      const primaryMetricId = measurement.primary_metric_id;
                                      const primaryTarget = primaryMetricId ? getTargetValue(primaryMetricId) : null;
                                      const isPRTracked = currentExercise.tracked_max_metrics?.includes(primaryMetricId);
                                      const isReps = primaryMetricId?.toLowerCase().includes('reps');
                                      const isAMRAP = isReps && (setConfig?.is_amrap || currentExercise.is_amrap);

                                      return (
                                        <View key={measurement.id} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                                          {ballIcon && (
                                            <View style={styles.ballIconContainer}>
                                              {ballIcon}
                                            </View>
                                          )}
                                          <View style={{ flex: 1 }}>
                                            <Text style={styles.metricLabel}>
                                              {measurement.name || measurement.primary_metric_name || 'Reps'}
                                            </Text>
                                            {isAMRAP ? (
                                              <View style={styles.amrapBadge}>
                                                <Text style={styles.amrapText}>AMRAP</Text>
                                              </View>
                                            ) : (
                                              <TextInput
                                                style={[styles.primaryInput, isPRTracked && styles.inputPR]}
                                                value={(setData[primaryMetricId] || primaryTarget)?.toString() || ''}
                                                onChangeText={(val) => handleInputChange(setIndex, primaryMetricId, val)}
                                                keyboardType="numeric"
                                                placeholder="0"
                                                placeholderTextColor="rgba(255,255,255,0.3)"
                                                textAlign="center"
                                              />
                                            )}
                                          </View>
                                          {isPRTracked && (
                                            <View style={styles.prIconContainer}>
                                              <Text style={styles.prIconText}>🏆</Text>
                                            </View>
                                          )}
                                        </View>
                                      );
                                    })}
                                  </View>
                                )}

                                {/* Paired measurements - each in its own row */}
                                {pairedMeasurements.map((measurement: any) => {
                                  const ballIcon = getBallIcon(measurement.primary_metric_id || measurement.id);
                                  const primaryMetricId = measurement.primary_metric_id;
                                  const secondaryMetricId = measurement.secondary_metric_id;
                                  const primaryTarget = primaryMetricId ? getTargetValue(primaryMetricId) : null;
                                  const secondaryTarget = secondaryMetricId ? getTargetValue(secondaryMetricId) : null;
                                  const isPRTracked = currentExercise.tracked_max_metrics?.includes(primaryMetricId || secondaryMetricId);
                                  const isReps = primaryMetricId?.toLowerCase().includes('reps');
                                  const isAMRAP = isReps && (setConfig?.is_amrap || currentExercise.is_amrap);

                                  return (
                                    <View key={measurement.id} style={{ flexDirection: 'row', gap: 4 }}>
                                      {/* PRIMARY METRIC (LEFT) */}
                                      {primaryMetricId && (
                                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                                          {ballIcon && (
                                            <View style={styles.ballIconContainer}>
                                              {ballIcon}
                                            </View>
                                          )}
                                          <View style={{ flex: 1 }}>
                                            <Text style={styles.metricLabel}>
                                              {measurement.name || measurement.primary_metric_name || 'Reps'}
                                            </Text>
                                            {isAMRAP ? (
                                              <View style={styles.amrapBadge}>
                                                <Text style={styles.amrapText}>AMRAP</Text>
                                              </View>
                                            ) : (
                                              <TextInput
                                                style={[styles.primaryInput, isPRTracked && styles.inputPR]}
                                                value={(setData[primaryMetricId] || primaryTarget)?.toString() || ''}
                                                onChangeText={(val) => handleInputChange(setIndex, primaryMetricId, val)}
                                                keyboardType="numeric"
                                                placeholder="0"
                                                placeholderTextColor="rgba(255,255,255,0.3)"
                                                textAlign="center"
                                              />
                                            )}
                                          </View>
                                          {isPRTracked && (
                                            <View style={styles.prIconContainer}>
                                              <Text style={styles.prIconText}>🏆</Text>
                                            </View>
                                          )}
                                        </View>
                                      )}

                                      {/* SECONDARY METRIC (RIGHT) */}
                                      {secondaryMetricId && (
                                        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
                                          <View style={{ flex: 1 }}>
                                            <Text style={styles.metricLabel}>
                                              {measurement.secondary_metric_name || 'Velocity'}
                                            </Text>
                                            <TextInput
                                              style={[styles.secondaryInput, isPRTracked && styles.inputPR]}
                                              value={(setData[secondaryMetricId] || secondaryTarget)?.toString() || ''}
                                              onChangeText={(val) => handleInputChange(setIndex, secondaryMetricId, val)}
                                              keyboardType="numeric"
                                              placeholder={secondaryTarget?.toString() || '0'}
                                              placeholderTextColor="rgba(255,255,255,0.3)"
                                              textAlign="center"
                                            />
                                          </View>
                                        </View>
                                      )}
                                    </View>
                                  );
                                })}
                              </View>
                            );
                          })()}

                          {notes && (
                            <Text style={styles.setNotesText}>💡 {notes}</Text>
                          )}
                        </>
                      )}

                      {!isActive && Object.keys(setData).length > 0 && (
                        <View style={styles.setPreview}>
                          <Text style={styles.setPreviewText}>
                            {measurements.map((m: any) => {
                              const primaryValue = m.primary_metric_id ? setData[m.primary_metric_id] : null;
                              const secondaryValue = m.secondary_metric_id ? setData[m.secondary_metric_id] : null;
                              if (!primaryValue && !secondaryValue) return null;

                              const parts = [];
                              if (primaryValue) parts.push(`${primaryValue} ${m.primary_metric_name || m.name}`);
                              if (secondaryValue) parts.push(`${secondaryValue} ${m.secondary_metric_name}`);

                              return parts.length > 0 ? parts.join(' @ ') + ' ' : '';
                            }).filter(Boolean).join(' × ')}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}

                <View style={{ height: 100 }} />
              </ScrollView>

              {/* Navigation Buttons */}
              <View style={styles.exerciseDetailNav}>
                <View style={styles.navButtonContainer}>
                  <TouchableOpacity
                    style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
                    onPress={handlePrev}
                    disabled={currentIndex === 0}
                  >
                    <Text style={styles.navButtonText}>‹ Previous</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.navButton}
                    onPress={() => {
                      setViewMode('overview');
                      setActiveExerciseId(null);
                    }}
                  >
                    <Text style={styles.navButtonText}>Overview</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.navButton}
                    onPress={handleNext}
                  >
                    <Text style={styles.navButtonText}>
                      {currentIndex < allExercises.length - 1 ? 'Next ›' : 'Finish'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          );
        })()
      )}

      {/* Complete Workout FAB (only in overview mode) */}
      {viewMode === 'overview' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            Alert.alert(
              'Complete Workout',
              'Are you sure you want to finish this workout?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Complete', style: 'default', onPress: () => {
                  // TODO: Implement complete workout logic
                  Alert.alert('Success', 'Workout completed!');
                  navigation.goBack();
                }},
              ]
            );
          }}
        >
          <Text style={styles.fabIcon}>✓</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const { width, height } = Dimensions.get('window');

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
    color: '#FFFFFF',
    marginTop: 16,
    fontSize: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 60,
    paddingBottom: 100,
  },

  // Preview Header
  previewHeader: {
    marginBottom: 24,
  },
  previewTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  previewSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
  },

  // Workout Notes - simple
  workoutNotesSimple: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    fontStyle: 'italic',
    paddingHorizontal: 12,
    marginBottom: 12,
  },

  // Blocks
  blockSection: {
    marginBottom: 16,
  },
  blockHeader: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderLeftWidth: 4,
    borderLeftColor: 'rgba(255, 255, 255, 0.3)',
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 6,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  blockDescription: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
    fontStyle: 'italic',
  },
  blockNotesText: {
    fontSize: 12,
    color: '#93C5FD',
    marginTop: 4,
  },
  blockTextInfoText: {
    fontSize: 12,
    color: '#FDE047',
    marginTop: 4,
  },

  // Exercise Row - flat, no container
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingLeft: 8,
  },
  exerciseCodeBadge: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    minWidth: 24,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseCodeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#9BDDFF',
  },
  videoThumbnail: {
    width: 56,
    height: 36,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  exerciseContent: {
    flex: 1,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 2,
    flex: 1,
  },
  progressBadge: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9BDDFF',
    marginLeft: 8,
  },
  metricRow: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  tempoText: {
    fontSize: 11,
    color: '#9BDDFF',
    marginTop: 2,
  },
  exerciseNotesText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
    fontStyle: 'italic',
  },
  arrowIndicator: {
    fontSize: 24,
    color: 'rgba(255, 255, 255, 0.3)',
    marginLeft: 8,
  },

  // Start Button
  startButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: '#0A0A0A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  startButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },

  // Execution Interface
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 60,
    backgroundColor: '#0A0A0A',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  exitButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  exitButtonText: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  workoutName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  timer: {
    fontSize: 14,
    color: '#9BDDFF',
    fontFamily: 'monospace',
  },
  headerRight: {
    width: 32,
  },
  executionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  // Block Overview Styles
  executionScroll: {
    flex: 1,
  },
  executionScrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  blockOverviewSection: {
    marginBottom: 24,
  },
  blockOverviewHeader: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderLeftWidth: 4,
    borderLeftColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  blockOverviewTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  blockOverviewDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
    fontStyle: 'italic',
  },
  blockOverviewNotes: {
    marginTop: 8,
    padding: 8,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 6,
  },
  blockOverviewNotesText: {
    fontSize: 12,
    color: '#93C5FD',
  },
  blockOverviewTextInfo: {
    marginTop: 8,
    padding: 8,
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.2)',
    borderRadius: 6,
  },
  blockOverviewTextInfoText: {
    fontSize: 12,
    color: '#FDE047',
  },

  // Exercise Overview Card
  exerciseOverviewCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  exerciseOverviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exerciseOverviewCodeBadge: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 12,
  },
  exerciseOverviewCodeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#9BDDFF',
  },
  exerciseOverviewNameContainer: {
    flex: 1,
  },
  exerciseOverviewName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginRight: 4,
  },
  exerciseOverviewMetrics: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 4,
  },
  exerciseOverviewExNotes: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
    fontStyle: 'italic',
  },
  exerciseOverviewProgressContainer: {
    alignItems: 'center',
  },
  exerciseOverviewProgress: {
    fontSize: 14,
    color: '#9BDDFF',
    fontWeight: '600',
  },
  exerciseOverviewArrow: {
    fontSize: 20,
    color: 'rgba(255, 255, 255, 0.3)',
  },

  // Exercise Detail View
  exerciseDetailScroll: {
    flex: 1,
  },
  exerciseDetailScrollContent: {
    padding: 16,
  },
  exerciseDetailHeader: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  supersetRoundText: {
    fontSize: 13,
    color: '#9BDDFF',
    fontWeight: '600',
    marginLeft: 12,
  },
  exerciseNotesInDetail: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    fontStyle: 'italic',
    marginTop: 8,
  },
  exerciseDetailCodeBadge: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 12,
  },
  exerciseDetailCodeText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#9BDDFF',
  },
  exerciseDetailNameContainer: {
    flex: 1,
  },
  exerciseDetailName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginRight: 6,
  },
  exerciseDetailProgress: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
  },
  prescribedMetrics: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
  },
  prIcon: {
    fontSize: 20,
    marginLeft: 6,
  },

  // Video Container
  videoContainer: {
    width: '100%',
    height: 200,
    marginBottom: 20,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: '100%',
  },

  // History Panel
  historyButton: {
    padding: 8,
    marginLeft: 8,
  },
  historyButtonText: {
    fontSize: 18,
  },
  historyPanel: {
    backgroundColor: 'rgba(155, 221, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.2)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  historyPanelTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9BDDFF',
    marginBottom: 12,
  },
  historySession: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  historySessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historySessionDate: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  historySessionWorkout: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  historySetsList: {
    gap: 4,
  },
  historySetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historySetNumber: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    width: 40,
  },
  historySetMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  historyMetricValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  historyMetricValuePR: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  historyMetricValue: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  historyPRIcon: {
    fontSize: 12,
  },

  // Set Card
  setCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  setCardActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    borderColor: '#9BDDFF',
  },
  setCardCompleted: {
    borderColor: 'rgba(34, 197, 94, 0.5)',
  },
  setCardDisabled: {
    opacity: 0.4,
  },
  setHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  setNumber: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  setInputs: {
    marginTop: 8,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  inputGroup: {
    minWidth: 120,
    marginRight: 12,
  },
  inputScrollContainer: {
    maxHeight: 150,
  },
  inputScrollContent: {
    paddingRight: 12,
  },
  inputLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 6,
    fontWeight: '600',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
    minWidth: 80,
  },
  repsInput: {
    flex: 1,
    minWidth: 60,
  },
  repsInputWithButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  repButton: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.4)',
    borderRadius: 8,
    width: 28,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  repButtonText: {
    color: '#9BDDFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  inputPR: {
    borderWidth: 2,
    borderColor: 'rgba(155, 221, 255, 0.4)',
  },
  inputIntensity: {
    fontSize: 11,
    color: '#9BDDFF',
    fontWeight: 'bold',
  },
  inputWithIntensity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputIntensityRight: {
    fontSize: 16,
    color: '#9BDDFF',
    fontWeight: 'bold',
  },
  intensityBadgeText: {
    fontSize: 16,
    color: '#9BDDFF',
    fontWeight: 'bold',
  },
  tempoDisplay: {
    fontSize: 13,
    color: '#9BDDFF',
    marginBottom: 12,
  },
  completedCheckmark: {
    fontSize: 20,
    color: '#22C55E',
  },
  setNotesText: {
    fontSize: 12,
    color: '#93C5FD',
    marginTop: 12,
    fontStyle: 'italic',
  },
  setPreview: {
    marginTop: 8,
  },
  setPreviewText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },

  // Exercise Detail Navigation
  exerciseDetailNav: {
    padding: 16,
    paddingTop: 8,
    backgroundColor: '#0A0A0A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  navButtonContainer: {
    flexDirection: 'row',
    gap: 8,
    maxWidth: '90%',
    width: '100%',
  },
  navButton: {
    flex: 1,
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.4)',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  navButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9BDDFF',
  },

  // FAB (Floating Action Button)
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabIcon: {
    fontSize: 28,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },

  // Ball Icons
  ballIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  baseballIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  baseballText: {
    fontSize: 10,
    fontWeight: 'bold',
  },

  // 2-Column Metrics Layout
  metricsContainer: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 8,
  },
  metricColumn: {
    flexDirection: 'column',
    gap: 4,
  },
  metricInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  ballIconContainer: {
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  metricInputWrapper: {
    // No fixed width - let flexbox handle it
  },
  metricLabel: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
    marginBottom: 4,
  },
  primaryInput: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: 'bold',
    textAlign: 'center',
    height: 34,
    width: 100,
  },
  secondaryInput: {
    backgroundColor: '#404040',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: 'bold',
    textAlign: 'center',
    height: 34,
    width: 100,
  },
  prIconContainer: {
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prIconText: {
    fontSize: 14,
  },
  amrapBadge: {
    width: 100,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  amrapText: {
    color: '#60A5FA',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
