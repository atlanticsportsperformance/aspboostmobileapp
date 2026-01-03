import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { formatExerciseMetrics } from '../lib/formatExerciseMetrics';

// Types
interface Exercise {
  id: string;
  name: string;
  video_url?: string;
  description?: string;
  category?: string;
  tags?: string[];
  is_placeholder?: boolean;
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
  intensity_targets?: Array<{ metric: string; percent: number }>;
  enabled_measurements?: string[];
  is_amrap?: boolean;
  set_configurations?: SetConfiguration[];
  exercises: Exercise;
}

interface CustomMeasurement {
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

interface Workout {
  id: string;
  name: string;
  category: string;
  notes?: string;
  description?: string;
  estimated_duration_minutes?: number;
  routines: Routine[];
}

interface WorkoutPreStartScreenProps {
  workout: Workout;
  customMeasurements: CustomMeasurement[];
  scheduledDate?: string;
  onStart: () => void;
}

// Format prescription: "3x8" or "3x1,1,1"
function formatRx(ex: RoutineExercise): string {
  if (!ex.reps) return `${ex.sets} sets`;
  return `${ex.sets}x${ex.reps}`;
}

// Get button gradient colors based on workout category
function getCategoryButtonColors(category: string): [string, string] {
  const cat = category?.toLowerCase() || '';
  if (cat.includes('hitting')) return ['#dc2626', '#b91c1c']; // red
  if (cat.includes('throwing')) return ['#2563eb', '#1d4ed8']; // blue
  return ['#10B981', '#059669']; // green (strength/conditioning default)
}

// Check if exercise is notes-only (no trackable metrics)
function isNotesOnlyExercise(ex: RoutineExercise): boolean {
  const enabledMeasurements = ex.enabled_measurements || [];
  const hasMetricTargets = ex.metric_targets && Object.keys(ex.metric_targets).length > 0;
  const hasLegacyReps = !!ex.reps;

  return enabledMeasurements.length === 0 && !hasMetricTargets && !hasLegacyReps;
}

export default function WorkoutPreStartScreen({
  workout,
  customMeasurements,
  onStart,
}: WorkoutPreStartScreenProps) {
  const totalExercises = workout.routines.reduce(
    (sum, r) => sum + r.routine_exercises.filter(ex => !ex.exercises?.is_placeholder).length, 0
  );
  // Only count sets for exercises that have trackable metrics (not notes-only)
  const totalSets = workout.routines.reduce(
    (sum, r) => sum + r.routine_exercises
      .filter(ex => !ex.exercises?.is_placeholder && !isNotesOnlyExercise(ex))
      .reduce((s, ex) => s + ex.sets, 0), 0
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <Text style={styles.title}>{workout.name}</Text>
        <Text style={styles.meta}>
          {totalExercises} exercises • {totalSets} sets
          {workout.estimated_duration_minutes ? ` • ~${workout.estimated_duration_minutes}min` : ''}
        </Text>

        {/* Workout notes */}
        {(workout.notes || workout.description) && (
          <Text style={styles.workoutNotes}>{workout.notes || workout.description}</Text>
        )}

        {/* Blocks */}
        {workout.routines.map((routine, ri) => {
          const letter = String.fromCharCode(65 + ri);
          const blockNotes = routine.notes || routine.description || routine.text_info;

          return (
            <View key={routine.id} style={styles.block}>
              <View style={styles.blockHeader}>
                <Text style={styles.blockLetter}>{letter}</Text>
                <Text style={styles.blockName}>{routine.name}</Text>
              </View>
              {blockNotes && <Text style={styles.blockNotes}>{blockNotes}</Text>}

              <View style={styles.exerciseList}>
                {routine.routine_exercises
                  .filter(ex => !ex.exercises?.is_placeholder)
                  .map((ex) => {
                  const hasPRTracking = ex.tracked_max_metrics && ex.tracked_max_metrics.length > 0;
                  const notesOnly = isNotesOnlyExercise(ex);
                  const metrics = notesOnly ? null : formatExerciseMetrics({
                    exercise: ex,
                    customMeasurements,
                    separator: ' • ',
                  });

                  return (
                    <View key={ex.id} style={styles.exercise}>
                      <View style={styles.exNameRow}>
                        <Text style={styles.exName}>{ex.exercises.name}</Text>
                        {hasPRTracking && <Text style={styles.prTrophy}>🏆</Text>}
                      </View>
                      {notesOnly ? (
                        // Notes-only exercise - just show notes or description
                        <>
                          {ex.notes && <Text style={styles.exNotesOnly}>{ex.notes}</Text>}
                          {ex.exercises.description && !ex.notes && (
                            <Text style={styles.exDescription}>{ex.exercises.description}</Text>
                          )}
                        </>
                      ) : (
                        // Regular exercise with metrics
                        <>
                          <Text style={styles.exRx}>
                            {metrics || formatRx(ex)}
                            {!metrics && ex.weight ? ` @ ${ex.weight}` : ''}
                            {ex.tempo ? ` • ${ex.tempo}` : ''}
                          </Text>
                          {ex.notes && <Text style={styles.exNotes}>{ex.notes}</Text>}
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Start Button */}
      <TouchableOpacity style={styles.startBtn} onPress={onStart} activeOpacity={0.8}>
        <LinearGradient
          colors={getCategoryButtonColors(workout.category)}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.startGradient}
        >
          <Text style={styles.startText}>START WORKOUT</Text>
        </LinearGradient>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
  },
  meta: {
    fontSize: 13,
    color: '#737373',
    marginTop: 4,
  },
  workoutNotes: {
    fontSize: 13,
    color: '#A3A3A3',
    marginTop: 12,
    lineHeight: 18,
  },
  block: {
    marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  blockLetter: {
    fontSize: 14,
    fontWeight: '700',
    color: '#737373',
  },
  blockName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E5E5E5',
  },
  blockNotes: {
    fontSize: 12,
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 8,
    fontStyle: 'italic',
  },
  exerciseList: {
    padding: 8,
  },
  exercise: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  exNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  exName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFF',
    flex: 1,
  },
  prTrophy: {
    fontSize: 14,
  },
  exRx: {
    fontSize: 13,
    color: '#9BDDFF',
    marginTop: 2,
  },
  exNotes: {
    fontSize: 11,
    color: '#525252',
    marginTop: 4,
  },
  exNotesOnly: {
    fontSize: 13,
    color: '#A3A3A3',
    marginTop: 4,
    fontStyle: 'italic',
  },
  exDescription: {
    fontSize: 12,
    color: '#737373',
    marginTop: 4,
    fontStyle: 'italic',
  },
  startBtn: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  startGradient: {
    alignItems: 'center',
    padding: 16,
  },
  startText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
});
