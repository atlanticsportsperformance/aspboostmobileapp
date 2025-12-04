import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../lib/supabase';
import BlockOverview from './block-overview';
import ExerciseDetailView from './exercise-detail-view';
import WorkoutPreStartScreen from './WorkoutPreStartScreen';

// Types
type RootStackParamList = {
  WorkoutLogger: { workoutInstanceId: string; athleteId: string };
  Dashboard: undefined;
};

type WorkoutLoggerRouteProp = RouteProp<RootStackParamList, 'WorkoutLogger'>;
type WorkoutLoggerNavigationProp = StackNavigationProp<RootStackParamList, 'WorkoutLogger'>;

interface WorkoutInstance {
  id: string;
  workout_id: string;
  athlete_id: string;
  scheduled_date: string;
  status: 'pending' | 'in_progress' | 'completed';
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
  scheme: 'straight_sets' | 'superset' | 'circuit' | 'emom' | 'amrap';
  routine_exercises: RoutineExercise[];
}

interface IntensityTarget {
  id?: string;
  metric: string;
  metric_label?: string;
  percent: number;
  // Cross-exercise intensity fields
  source_exercise_id?: string | null;
  source_exercise_name?: string | null;
  source_metric_id?: string | null;
}

interface SetConfiguration {
  metric_values?: Record<string, number>;
  is_amrap?: boolean;
  notes?: string;
  intensity_targets?: IntensityTarget[];
}

interface Measurement {
  id: string;
  name: string;
  category: 'single' | 'paired';
  primary_metric_id?: string;
  primary_metric_name?: string;
  primary_metric_type?: string;
  secondary_metric_id?: string;
  secondary_metric_name?: string;
  secondary_metric_type?: string;
}

interface Exercise {
  id: string;
  name: string;
  video_url?: string;
  description?: string;
  categories?: string[];
  tags?: string[];
}

interface RoutineExercise {
  id: string;
  exercise_id: string;
  sets: number;
  reps?: string;
  weight?: string;
  tempo?: string;
  notes?: string;
  order_index: number;
  tracked_max_metrics?: string[];
  metric_targets?: Record<string, number>;
  intensity_targets?: IntensityTarget[];
  enabled_measurements?: string[];
  is_amrap?: boolean;
  set_configurations?: SetConfiguration[];
  exercises: Exercise;
}

interface PRAlert {
  metric: string;
  value: number;
}

export default function WorkoutLoggerScreen() {
  const route = useRoute<WorkoutLoggerRouteProp>();
  const navigation = useNavigation<WorkoutLoggerNavigationProp>();
  const { workoutInstanceId, athleteId } = route.params;

  // State
  const [loading, setLoading] = useState(true);
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [workoutInstance, setWorkoutInstance] = useState<WorkoutInstance | null>(null);
  const [allExercises, setAllExercises] = useState<RoutineExercise[]>([]);
  const [viewMode, setViewMode] = useState<'prestart' | 'overview' | 'exercise'>('prestart');
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [customMeasurements, setCustomMeasurements] = useState<Measurement[]>([]);
  const [exerciseInputs, setExerciseInputs] = useState<Record<string, any[]>>({});
  const [completedSets, setCompletedSets] = useState<Record<string, boolean[]>>({});
  const [currentSetIndexes, setCurrentSetIndexes] = useState<Record<string, number>>({});
  // athleteMaxes keyed by exercise_id -> metric_id -> value
  const [athleteMaxes, setAthleteMaxes] = useState<Record<string, Record<string, number>>>({});
  const [prAlert, setPRAlert] = useState<PRAlert | null>(null);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [timer, setTimer] = useState(0); // seconds elapsed
  // Exercise history keyed by exercise_id
  const [exerciseHistory, setExerciseHistory] = useState<Record<string, any[]>>({});

  // Load workout data
  useEffect(() => {
    loadWorkout();
  }, [workoutInstanceId]);

  const loadWorkout = async () => {
    try {
      // Fetch workout instance
      const { data: instance, error: instanceError } = await supabase
        .from('workout_instances')
        .select('*')
        .eq('id', workoutInstanceId)
        .single();

      if (instanceError) throw instanceError;
      setWorkoutInstance(instance);

      // Fetch full workout with nested data
      const { data: workoutData, error: workoutError } = await supabase
        .from('workouts')
        .select(`
          *,
          routines (
            *,
            routine_exercises (
              *,
              exercises (
                id,
                name,
                video_url,
                description,
                categories,
                tags
              )
            )
          )
        `)
        .eq('id', instance.workout_id)
        .single();

      if (workoutError) throw workoutError;

      // Sort routines and exercises by order_index
      workoutData.routines.sort((a: Routine, b: Routine) => a.order_index - b.order_index);
      workoutData.routines.forEach((routine: Routine) => {
        routine.routine_exercises.sort((a, b) => a.order_index - b.order_index);

        // Log any exercises with missing joined data
        routine.routine_exercises.forEach((re: RoutineExercise) => {
          if (!re.exercises) {
            console.warn(`[WorkoutLogger] Missing exercise data for routine_exercise ${re.id}, exercise_id: ${re.exercise_id}, sets: ${re.sets}, reps: ${re.reps}`);
          }
        });
      });

      setWorkout(workoutData);

      // Flatten all exercises into single array
      const exercises = workoutData.routines.flatMap((r: Routine) => r.routine_exercises);
      setAllExercises(exercises);

      // Initialize current set indexes
      const indexes: Record<string, number> = {};
      exercises.forEach((ex: RoutineExercise) => {
        indexes[ex.id] = 0;
      });
      setCurrentSetIndexes(indexes);

      // Fetch custom measurements
      const { data: measurements } = await supabase
        .from('custom_measurements')
        .select('*');
      setCustomMeasurements(measurements || []);

      // Collect all exercise IDs we need maxes for (current exercises + source exercises)
      const exerciseIdsToFetch = new Set<string>();
      exercises.forEach((ex: RoutineExercise) => {
        exerciseIdsToFetch.add(ex.exercise_id);

        // Check exercise-level intensity_targets for source_exercise_id
        ex.intensity_targets?.forEach((target: IntensityTarget) => {
          if (target.source_exercise_id) {
            exerciseIdsToFetch.add(target.source_exercise_id);
          }
        });

        // Check set_configurations for source_exercise_id
        ex.set_configurations?.forEach((setConfig: SetConfiguration) => {
          setConfig.intensity_targets?.forEach((target: IntensityTarget) => {
            if (target.source_exercise_id) {
              exerciseIdsToFetch.add(target.source_exercise_id);
            }
          });
        });
      });

      // Fetch athlete's maxes for all needed exercises
      const { data: maxes } = await supabase
        .from('athlete_maxes')
        .select('exercise_id, metric_id, max_value, achieved_on')
        .eq('athlete_id', athleteId)
        .in('exercise_id', Array.from(exerciseIdsToFetch))
        .order('achieved_on', { ascending: false });

      // Group by exercise_id -> metric_id, keeping most recent
      const maxesMap: Record<string, Record<string, number>> = {};
      maxes?.forEach((m: any) => {
        if (!maxesMap[m.exercise_id]) {
          maxesMap[m.exercise_id] = {};
        }
        // Only keep first (most recent) value for each metric
        if (maxesMap[m.exercise_id][m.metric_id] === undefined) {
          maxesMap[m.exercise_id][m.metric_id] = m.max_value;
        }
      });

      setAthleteMaxes(maxesMap);

      // Fetch existing logs (if resuming workout)
      const { data: logs } = await supabase
        .from('exercise_logs')
        .select('*')
        .eq('workout_instance_id', workoutInstanceId)
        .order('set_number');

      // Populate exerciseInputs from existing logs
      const inputsMap: Record<string, any[]> = {};
      const completedMap: Record<string, boolean[]> = {};

      exercises.forEach((ex: RoutineExercise) => {
        const exLogs = logs?.filter((l: any) => l.routine_exercise_id === ex.id) || [];

        // Initialize arrays for all sets
        const setsData = Array(ex.sets).fill(null).map(() => ({}));
        const completedArray = Array(ex.sets).fill(false);

        // Fill in logged data
        exLogs.forEach((log: any) => {
          const setIndex = log.set_number - 1; // Convert to 0-indexed
          if (setIndex >= 0 && setIndex < ex.sets) {
            setsData[setIndex] = {
              reps: log.reps,
              weight: log.weight,
              time_seconds: log.time_seconds,
              distance: log.distance,
              notes: log.notes,
              ...log.custom_metrics,
            };

            // Mark as completed if has data
            const setDataObj = setsData[setIndex];
            const hasData = Object.keys(setDataObj).some(
              key => setDataObj[key as keyof typeof setDataObj] != null &&
                     setDataObj[key as keyof typeof setDataObj] !== '' &&
                     key !== 'notes'
            );
            completedArray[setIndex] = hasData;
          }
        });

        inputsMap[ex.id] = setsData;
        completedMap[ex.id] = completedArray;
      });

      setExerciseInputs(inputsMap);
      setCompletedSets(completedMap);

      // Fetch previous workout history for all exercises
      const exerciseIds = exercises.map((ex: RoutineExercise) => ex.exercise_id);
      const uniqueExerciseIds = [...new Set(exerciseIds)];

      const { data: historyData } = await supabase
        .from('exercise_logs')
        .select(`
          id,
          routine_exercise_id,
          set_number,
          reps,
          weight,
          time_seconds,
          distance,
          notes,
          custom_metrics,
          workout_instances!inner (
            id,
            scheduled_date,
            completed_at,
            athlete_id
          ),
          routine_exercises!inner (
            exercise_id
          )
        `)
        .eq('workout_instances.athlete_id', athleteId)
        .in('routine_exercises.exercise_id', uniqueExerciseIds)
        .neq('workout_instances.id', workoutInstanceId)
        .not('workout_instances.completed_at', 'is', null)
        .order('workout_instances(completed_at)', { ascending: false })
        .limit(100);

      // Group history by exercise_id, then by workout date
      const historyMap: Record<string, any[]> = {};
      if (historyData) {
        historyData.forEach((log: any) => {
          const exerciseId = log.routine_exercises?.exercise_id;
          if (!exerciseId) return;

          if (!historyMap[exerciseId]) {
            historyMap[exerciseId] = [];
          }

          const workoutDate = log.workout_instances?.completed_at || log.workout_instances?.scheduled_date;
          const workoutId = log.workout_instances?.id;

          // Find or create workout entry
          let workoutEntry = historyMap[exerciseId].find(w => w.id === workoutId);
          if (!workoutEntry) {
            workoutEntry = {
              id: workoutId,
              date: workoutDate,
              sets: [],
            };
            historyMap[exerciseId].push(workoutEntry);
          }

          workoutEntry.sets.push({
            set_number: log.set_number,
            reps: log.reps,
            weight: log.weight,
            time_seconds: log.time_seconds,
            distance: log.distance,
            notes: log.notes,
            ...log.custom_metrics,
          });
        });

        // Sort sets within each workout and limit to last 5 workouts per exercise
        Object.keys(historyMap).forEach(exId => {
          historyMap[exId].forEach(workout => {
            workout.sets.sort((a: any, b: any) => a.set_number - b.set_number);
          });
          historyMap[exId] = historyMap[exId].slice(0, 5);
        });
      }
      setExerciseHistory(historyMap);

      // Set view mode based on workout status
      if (instance.status === 'pending') {
        setViewMode('prestart');
      } else if (instance.status === 'in_progress') {
        setViewMode('overview');
        // Calculate elapsed time if already started
        if (instance.started_at) {
          const startTime = new Date(instance.started_at).getTime();
          const now = Date.now();
          const elapsedSeconds = Math.floor((now - startTime) / 1000);
          setTimer(elapsedSeconds);
        }
      }

      setLoading(false);
    } catch (error: any) {
      Alert.alert('Error', `Failed to load workout: ${error?.message || 'Unknown error'}`);
      setLoading(false);
    }
  };

  // Timer effect
  useEffect(() => {
    if (viewMode === 'overview' || viewMode === 'exercise') {
      const interval = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [viewMode]);

  const handleStartWorkout = async () => {
    try {
      await supabase
        .from('workout_instances')
        .update({
          status: 'in_progress',
        })
        .eq('id', workoutInstanceId);

      setWorkoutInstance(prev => prev ? {
        ...prev,
        status: 'in_progress',
      } : null);

      setTimer(0);
      setViewMode('overview');
    } catch (error) {
      console.error('Error starting workout:', error);
      Alert.alert('Error', 'Failed to start workout');
    }
  };

  const handleCompleteWorkout = async () => {
    try {
      await supabase
        .from('workout_instances')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', workoutInstanceId);

      Alert.alert(
        'Workout Complete!',
        'Great job! Your workout has been saved.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      console.error('Error completing workout:', error);
      Alert.alert('Error', 'Failed to complete workout');
    }
  };

  const handleExitWorkout = () => {
    Alert.alert(
      'Exit Workout',
      'Are you sure you want to exit? Your progress has been saved and you can resume later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Exit', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  };

  // Save set data to database (debounced)
  const saveSetData = async (
    exerciseId: string,
    setIndex: number,
    field: string,
    value: any
  ) => {
    try {
      const exercise = allExercises.find(ex => ex.id === exerciseId);
      if (!exercise) return;

      // Check if log already exists
      const { data: existingLog } = await supabase
        .from('exercise_logs')
        .select('id, custom_metrics')
        .eq('workout_instance_id', workoutInstanceId)
        .eq('routine_exercise_id', exerciseId)
        .eq('set_number', setIndex + 1)
        .maybeSingle();

      // Build update/insert data
      const logData: any = {
        workout_instance_id: workoutInstanceId,
        routine_exercise_id: exerciseId,
        set_number: setIndex + 1,
      };

      // Map fields to DB columns
      if (field === 'reps') logData.reps = value || null;
      else if (field === 'weight') logData.weight = value || null;
      else if (field === 'time_seconds') logData.time_seconds = value || null;
      else if (field === 'distance') logData.distance = value || null;
      else if (field === 'notes') logData.notes = value || null;
      else {
        // Custom measurement - store in custom_metrics JSON
        const existingMetrics = existingLog?.custom_metrics || {};
        logData.custom_metrics = {
          ...existingMetrics,
          [field]: value,
        };
      }

      if (existingLog) {
        // Update existing log
        await supabase
          .from('exercise_logs')
          .update(logData)
          .eq('id', existingLog.id);
      } else {
        // Insert new log
        await supabase
          .from('exercise_logs')
          .insert(logData);
      }

    } catch (error) {
      // Silent fail - data will be saved on next attempt
    }
  };

  // Helper to get max value from athleteMaxes
  const getMaxValue = (exerciseId: string, metricId: string): number | null => {
    return athleteMaxes[exerciseId]?.[metricId] ?? null;
  };

  // Check and save PR
  const checkAndSavePR = async (
    routineExerciseId: string,
    metric: string,
    value: number
  ) => {
    try {
      const exercise = allExercises.find(ex => ex.id === routineExerciseId);
      if (!exercise || !exercise.tracked_max_metrics?.includes(metric)) {
        return; // Not tracking this metric
      }

      const currentMax = getMaxValue(exercise.exercise_id, metric) || 0;

      if (value > currentMax) {
        // NEW PR!
        await supabase
          .from('athlete_maxes')
          .upsert({
            athlete_id: athleteId,
            exercise_id: exercise.exercise_id,
            metric_id: metric,
            max_value: value,
            achieved_on: new Date().toISOString(),
            workout_instance_id: workoutInstanceId,
          });

        // Update local state
        setAthleteMaxes(prev => ({
          ...prev,
          [exercise.exercise_id]: {
            ...(prev[exercise.exercise_id] || {}),
            [metric]: value,
          },
        }));

        // Show PR alert
        setPRAlert({ metric, value });
        setTimeout(() => setPRAlert(null), 4000);
      }
    } catch (error) {
      console.error('Error checking PR:', error);
    }
  };

  // Handle input change
  const handleInputChange = useCallback((
    setIndex: number,
    field: string,
    value: any,
    exerciseIdOverride?: string,
    isAutoFill: boolean = false
  ) => {
    const targetExerciseId = exerciseIdOverride || activeExerciseId;
    const targetExercise = allExercises.find(ex => ex.id === targetExerciseId);

    if (!targetExercise || !targetExerciseId) return;

    // 1. Update local state
    setExerciseInputs(prev => {
      const exerciseData = prev[targetExerciseId] || [];
      const updatedData = [...exerciseData];

      // Ensure array is long enough
      while (updatedData.length <= setIndex) {
        updatedData.push({});
      }

      // Update the field
      updatedData[setIndex] = {
        ...updatedData[setIndex],
        [field]: value,
      };

      return {
        ...prev,
        [targetExerciseId]: updatedData,
      };
    });

    // 2. Save to database (debounced)
    if (saveTimeout) clearTimeout(saveTimeout);
    const timeout = setTimeout(() => {
      saveSetData(targetExerciseId, setIndex, field, value);
    }, 500);
    setSaveTimeout(timeout);

    // 3. Check if set has data now
    const setData = exerciseInputs[targetExerciseId]?.[setIndex] || { [field]: value };
    const hasData = Object.keys(setData).some(key =>
      setData[key] && setData[key] !== '' && setData[key] !== 0 && key !== 'notes'
    );

    // 4. Mark set as completed (only if NOT auto-filled)
    if (hasData && !isAutoFill) {
      setCompletedSets(prev => {
        const exerciseSets = prev[targetExerciseId] || Array(targetExercise.sets).fill(false);
        const updatedSets = [...exerciseSets];
        updatedSets[setIndex] = true;
        return { ...prev, [targetExerciseId]: updatedSets };
      });
    }

    // 5. Check for PR (if tracked metric)
    if (targetExercise.tracked_max_metrics?.includes(field)) {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        checkAndSavePR(targetExerciseId, field, numValue);
      }
    }
  }, [activeExerciseId, allExercises, exerciseInputs, saveTimeout]);

  // Handle next set / done - behavior changes based on routine scheme
  const handleNextSet = useCallback(() => {
    if (!activeExerciseId || !workout) return;

    const exercise = allExercises.find(ex => ex.id === activeExerciseId);
    if (!exercise) return;

    // Find current routine for this exercise
    const currentRoutine = workout.routines.find(r =>
      r.routine_exercises.some(re => re.id === exercise.id)
    );
    if (!currentRoutine) return;

    const isSuperset = currentRoutine.scheme === 'superset' || currentRoutine.scheme === 'circuit';
    const routineExercises = currentRoutine.routine_exercises;
    const exerciseIndexInRoutine = routineExercises.findIndex(re => re.id === exercise.id);

    const currentSetIndex = currentSetIndexes[activeExerciseId] || 0;
    const currentSetData = exerciseInputs[activeExerciseId]?.[currentSetIndex] || {};

    // Mark current set as completed
    setCompletedSets(prev => {
      const exerciseSets = prev[activeExerciseId] || Array(exercise.sets).fill(false);
      const updatedSets = [...exerciseSets];
      updatedSets[currentSetIndex] = true;
      return { ...prev, [activeExerciseId]: updatedSets };
    });

    if (isSuperset) {
      // SUPERSET/CIRCUIT: Alternate between exercises until one finishes, then continue the rest
      // Example: A1 has 2 sets, A2 has 9 sets
      // Order: A1(1) -> A2(1) -> A1(2) -> A2(2) -> A2(3) -> A2(4) -> ... -> A2(9)

      // Increment current exercise's set index
      const newCurrentSetIndex = currentSetIndex + 1;

      // Update indexes - always update the current exercise's index
      const newIndexes = { ...currentSetIndexes };
      newIndexes[activeExerciseId] = newCurrentSetIndex;

      // Find next exercise in rotation that still has sets remaining
      let nextExerciseId: string | null = null;

      // Look for the next exercise in rotation order
      for (let i = 1; i <= routineExercises.length; i++) {
        const idx = (exerciseIndexInRoutine + i) % routineExercises.length;
        const candidateExercise = routineExercises[idx];

        // Get the candidate's current set index from newIndexes
        const candidateSetIndex = newIndexes[candidateExercise.id] || 0;

        // Check if this exercise still has sets to do
        if (candidateSetIndex < candidateExercise.sets) {
          nextExerciseId = candidateExercise.id;
          break;
        }
      }

      setCurrentSetIndexes(newIndexes);

      if (nextExerciseId) {
        setActiveExerciseId(nextExerciseId);
      } else {
        // All exercises in routine done, go to next routine or overview
        const routineIndex = workout.routines.findIndex(r => r.id === currentRoutine.id);
        if (routineIndex < workout.routines.length - 1) {
          const nextRoutine = workout.routines[routineIndex + 1];
          if (nextRoutine.routine_exercises.length > 0) {
            setActiveExerciseId(nextRoutine.routine_exercises[0].id);
          } else {
            setViewMode('overview');
            setActiveExerciseId(null);
          }
        } else {
          setViewMode('overview');
          setActiveExerciseId(null);
        }
      }
    } else {
      // STRAIGHT SETS: Complete all sets of current exercise before moving on
      if (currentSetIndex >= exercise.sets - 1) {
        // Done with this exercise, go to next exercise
        const currentExerciseIndex = allExercises.findIndex(ex => ex.id === activeExerciseId);
        if (currentExerciseIndex < allExercises.length - 1) {
          const nextExercise = allExercises[currentExerciseIndex + 1];
          setActiveExerciseId(nextExercise.id);
          setCurrentSetIndexes(prev => ({ ...prev, [nextExercise.id]: 0 }));
        } else {
          setViewMode('overview');
          setActiveExerciseId(null);
        }
      } else {
        // Move to next set of same exercise
        const nextSetIndex = currentSetIndex + 1;

        // Auto-fill from previous set
        Object.keys(currentSetData).forEach(field => {
          if (field !== 'notes' && currentSetData[field] != null && currentSetData[field] !== '') {
            handleInputChange(nextSetIndex, field, currentSetData[field], activeExerciseId, true);
          }
        });

        setCurrentSetIndexes(prev => ({
          ...prev,
          [activeExerciseId]: nextSetIndex,
        }));
      }
    }
  }, [activeExerciseId, workout, allExercises, currentSetIndexes, exerciseInputs, completedSets, handleInputChange]);

  // Navigation handlers
  const handleExercisePress = (exerciseId: string) => {
    setActiveExerciseId(exerciseId);
    setViewMode('exercise');
  };

  const handleBackToOverview = () => {
    setViewMode('overview');
    setActiveExerciseId(null);
  };

  const handlePrevExercise = () => {
    if (!activeExerciseId) return;
    const currentIndex = allExercises.findIndex(ex => ex.id === activeExerciseId);
    if (currentIndex > 0) {
      setActiveExerciseId(allExercises[currentIndex - 1].id);
    }
  };

  const handleNextExercise = () => {
    if (!activeExerciseId) return;
    const currentIndex = allExercises.findIndex(ex => ex.id === activeExerciseId);
    if (currentIndex < allExercises.length - 1) {
      setActiveExerciseId(allExercises[currentIndex + 1].id);
    }
  };

  // Toggle set completion (for clicking checkboxes)
  // When checking a set, autoFillValues contains placeholder values to fill in empty fields
  const handleToggleSetComplete = useCallback((setIndex: number, autoFillValues?: Record<string, any>) => {
    if (!activeExerciseId) return;
    const exercise = allExercises.find(ex => ex.id === activeExerciseId);
    if (!exercise) return;

    const currentlyCompleted = completedSets[activeExerciseId]?.[setIndex] === true;

    // If checking (not unchecking) and we have auto-fill values, apply them
    if (!currentlyCompleted && autoFillValues) {
      Object.entries(autoFillValues).forEach(([field, value]) => {
        handleInputChange(setIndex, field, value, activeExerciseId, true);
      });
    }

    setCompletedSets(prev => {
      const exerciseSets = prev[activeExerciseId] || Array(exercise.sets).fill(false);
      const updatedSets = [...exerciseSets];
      updatedSets[setIndex] = !updatedSets[setIndex]; // Toggle
      return { ...prev, [activeExerciseId]: updatedSets };
    });
  }, [activeExerciseId, allExercises, completedSets, handleInputChange]);

  // Get current exercise and routine
  const currentExercise = useMemo(() => {
    return allExercises.find(ex => ex.id === activeExerciseId);
  }, [allExercises, activeExerciseId]);

  const currentRoutine = useMemo(() => {
    if (!workout || !currentExercise) return null;
    return workout.routines.find(r =>
      r.routine_exercises.some(re => re.id === currentExercise.id)
    );
  }, [workout, currentExercise]);

  const currentExerciseIndex = useMemo(() => {
    return allExercises.findIndex(ex => ex.id === activeExerciseId);
  }, [allExercises, activeExerciseId]);

  const blockLabel = useMemo(() => {
    if (!workout || !currentRoutine) return undefined;
    const routineIndex = workout.routines.findIndex(r => r.id === currentRoutine.id);
    return String.fromCharCode(65 + routineIndex); // A, B, C...
  }, [workout, currentRoutine]);

  if (loading || !workout) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9BDDFF" />
      </View>
    );
  }

  if (viewMode === 'prestart') {
    return (
      <WorkoutPreStartScreen
        workout={workout}
        customMeasurements={customMeasurements}
        onStart={handleStartWorkout}
      />
    );
  }

  if (viewMode === 'overview') {
    return (
      <BlockOverview
        workout={workout}
        customMeasurements={customMeasurements}
        completedSets={completedSets}
        timer={timer}
        onExercisePress={handleExercisePress}
        onCompleteWorkout={handleCompleteWorkout}
        onBack={handleExitWorkout}
      />
    );
  }

  if (viewMode === 'exercise' && currentExercise && currentRoutine) {
    return (
      <ExerciseDetailView
        exercise={currentExercise}
        routine={currentRoutine}
        customMeasurements={customMeasurements}
        athleteMaxes={athleteMaxes}
        exerciseInputs={exerciseInputs}
        completedSets={completedSets}
        currentSetIndex={currentSetIndexes[currentExercise.id] || 0}
        currentSetIndexes={currentSetIndexes}
        allExercises={allExercises}
        hasPrev={currentExerciseIndex > 0}
        hasNext={currentExerciseIndex < allExercises.length - 1}
        blockLabel={blockLabel}
        exerciseHistory={exerciseHistory[currentExercise.exercise_id]}
        onInputChange={handleInputChange}
        onToggleSetComplete={handleToggleSetComplete}
        onNextSet={handleNextSet}
        onPrevExercise={handlePrevExercise}
        onNextExercise={handleNextExercise}
        onBackToOverview={handleBackToOverview}
        prAlert={prAlert}
      />
    );
  }

  return null;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
