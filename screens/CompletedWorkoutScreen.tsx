import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';

interface ExerciseLog {
  id: string;
  exercise_id: string;
  routine_exercise_id: string;
  set_number: number;
  actual_reps: number | null;
  actual_weight: number | null;
  metric_data: Record<string, any> | null;
  exercises: {
    id: string;
    name: string;
  };
}

interface RoutineExercise {
  id: string;
  exercise_id: string;
  sets: number;
  order_index: number;
  exercises: {
    id: string;
    name: string;
  };
}

interface Routine {
  id: string;
  name: string;
  order_index: number;
  routine_exercises: RoutineExercise[];
}

interface WorkoutInstance {
  id: string;
  status: string;
  scheduled_date: string;
  completed_at: string | null;
  workouts: {
    id: string;
    name: string;
    category: string;
    routines: Routine[];
  };
}

export default function CompletedWorkoutScreen({ route, navigation }: any) {
  const { workoutInstanceId } = route.params;

  const [loading, setLoading] = useState(true);
  const [workout, setWorkout] = useState<WorkoutInstance | null>(null);
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>([]);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    loadCompletedWorkout();
  }, [workoutInstanceId]);

  async function loadCompletedWorkout() {
    try {
      setLoading(true);

      // Fetch workout instance with workout details
      const { data: workoutData, error: workoutError } = await supabase
        .from('workout_instances')
        .select(`
          id,
          status,
          scheduled_date,
          completed_at,
          workouts (
            id,
            name,
            category,
            routines (
              id,
              name,
              order_index,
              routine_exercises (
                id,
                exercise_id,
                sets,
                order_index,
                exercises (
                  id,
                  name
                )
              )
            )
          )
        `)
        .eq('id', workoutInstanceId)
        .single();

      if (workoutError) throw workoutError;
      setWorkout(workoutData);

      // Fetch exercise logs for this workout
      const { data: logsData, error: logsError } = await supabase
        .from('exercise_logs')
        .select(`
          id,
          exercise_id,
          routine_exercise_id,
          set_number,
          actual_reps,
          actual_weight,
          metric_data,
          exercises (
            id,
            name
          )
        `)
        .eq('workout_instance_id', workoutInstanceId)
        .order('set_number');

      if (logsError) throw logsError;
      setExerciseLogs(logsData || []);

    } catch (error) {
      console.error('Error loading completed workout:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetWorkout() {
    try {
      setResetting(true);

      // Delete all exercise logs for this workout
      await supabase
        .from('exercise_logs')
        .delete()
        .eq('workout_instance_id', workoutInstanceId);

      // Reset workout instance status
      await supabase
        .from('workout_instances')
        .update({
          status: 'not_started',
          completed_at: null
        })
        .eq('id', workoutInstanceId);

      setShowResetModal(false);

      // Navigate back to dashboard
      navigation.goBack();

    } catch (error) {
      console.error('Error resetting workout:', error);
      Alert.alert('Error', 'Failed to reset workout. Please try again.');
    } finally {
      setResetting(false);
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatTime(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function getLogsForExercise(routineExerciseId: string): ExerciseLog[] {
    return exerciseLogs
      .filter(log => log.routine_exercise_id === routineExerciseId)
      .sort((a, b) => a.set_number - b.set_number);
  }

  function formatSetLog(log: ExerciseLog): string {
    const parts: string[] = [];

    if (log.actual_reps != null) {
      parts.push(`${log.actual_reps} reps`);
    }

    if (log.actual_weight != null) {
      parts.push(`${log.actual_weight} lbs`);
    }

    // Check metric_data for additional values
    if (log.metric_data) {
      Object.entries(log.metric_data).forEach(([key, value]) => {
        if (value != null && key !== 'reps' && key !== 'weight') {
          parts.push(`${value}`);
        }
      });
    }

    return parts.length > 0 ? parts.join(' @ ') : 'Completed';
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
          <Text style={styles.loadingText}>Loading workout...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!workout) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Workout not found</Text>
          <TouchableOpacity
            style={styles.backButtonLarge}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonLargeText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const totalSetsLogged = exerciseLogs.length;
  const completedDate = workout.completed_at
    ? formatDate(workout.completed_at)
    : formatDate(workout.scheduled_date);
  const completedTime = workout.completed_at
    ? formatTime(workout.completed_at)
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Text style={styles.backButtonIcon}>‹</Text>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Completed Workout</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Workout Summary Card */}
        <LinearGradient
          colors={['rgba(16, 185, 129, 0.2)', 'rgba(16, 185, 129, 0.05)']}
          style={styles.summaryCard}
        >
          <View style={styles.completedBadge}>
            <Text style={styles.completedBadgeIcon}>✓</Text>
            <Text style={styles.completedBadgeText}>COMPLETED</Text>
          </View>

          <Text style={styles.workoutName}>{workout.workouts.name}</Text>

          <View style={styles.summaryDetails}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Date</Text>
              <Text style={styles.summaryValue}>{completedDate}</Text>
            </View>
            {completedTime && (
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Time</Text>
                <Text style={styles.summaryValue}>{completedTime}</Text>
              </View>
            )}
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Sets Logged</Text>
              <Text style={styles.summaryValue}>{totalSetsLogged}</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Exercise Logs */}
        <Text style={styles.sectionTitle}>Exercise Logs</Text>

        {workout.workouts.routines
          .sort((a, b) => a.order_index - b.order_index)
          .map((routine, routineIndex) => (
            <View key={routine.id} style={styles.routineSection}>
              <View style={styles.routineHeader}>
                <Text style={styles.routineLetter}>
                  {String.fromCharCode(65 + routineIndex)}
                </Text>
                <Text style={styles.routineName}>{routine.name}</Text>
              </View>

              {routine.routine_exercises
                .sort((a, b) => a.order_index - b.order_index)
                .map((exercise, exerciseIndex) => {
                  const logs = getLogsForExercise(exercise.id);
                  const hasLogs = logs.length > 0;

                  return (
                    <View key={exercise.id} style={styles.exerciseCard}>
                      <View style={styles.exerciseHeader}>
                        <View style={styles.exerciseCodeBadge}>
                          <Text style={styles.exerciseCode}>
                            {String.fromCharCode(65 + routineIndex)}{exerciseIndex + 1}
                          </Text>
                        </View>
                        <Text style={styles.exerciseName}>
                          {exercise.exercises.name}
                        </Text>
                        {hasLogs ? (
                          <View style={styles.loggedBadge}>
                            <Text style={styles.loggedBadgeText}>✓</Text>
                          </View>
                        ) : (
                          <View style={styles.skippedBadge}>
                            <Text style={styles.skippedBadgeText}>—</Text>
                          </View>
                        )}
                      </View>

                      {hasLogs ? (
                        <View style={styles.setsContainer}>
                          {logs.map((log, idx) => (
                            <View key={log.id} style={styles.setRow}>
                              <Text style={styles.setNumber}>Set {log.set_number}</Text>
                              <Text style={styles.setData}>{formatSetLog(log)}</Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.noLogsText}>Not logged</Text>
                      )}
                    </View>
                  );
                })}
            </View>
          ))}

        {/* Reset Button */}
        <TouchableOpacity
          style={styles.resetButton}
          onPress={() => setShowResetModal(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.resetButtonIcon}>↺</Text>
          <Text style={styles.resetButtonText}>Reset & Redo Workout</Text>
        </TouchableOpacity>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Reset Confirmation Modal */}
      <Modal
        visible={showResetModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowResetModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowResetModal(false)}
        >
          <Pressable style={styles.modalContainer} onPress={() => {}}>
            <View style={styles.modalIconContainer}>
              <Text style={styles.modalIcon}>↺</Text>
            </View>

            <Text style={styles.modalTitle}>Reset Workout?</Text>
            <Text style={styles.modalDescription}>
              This will delete all logged data for this workout and reset it to "not started". This action cannot be undone.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalDangerButton}
                onPress={handleResetWorkout}
                disabled={resetting}
                activeOpacity={0.8}
              >
                {resetting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalDangerButtonText}>Reset Workout</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowResetModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
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
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  errorText: {
    fontSize: 18,
    color: '#EF4444',
    marginBottom: 16,
  },
  backButtonLarge: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonLargeText: {
    color: '#9BDDFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backButtonIcon: {
    fontSize: 24,
    fontWeight: '600',
    color: '#9BDDFF',
  },
  backButtonText: {
    fontSize: 16,
    color: '#9BDDFF',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerPlaceholder: {
    width: 60,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  summaryCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  completedBadgeIcon: {
    fontSize: 14,
    color: '#10B981',
  },
  completedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: 1,
  },
  workoutName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  summaryDetails: {
    flexDirection: 'row',
    gap: 24,
  },
  summaryItem: {
    gap: 4,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  routineSection: {
    marginBottom: 20,
  },
  routineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  routineLetter: {
    fontSize: 14,
    fontWeight: '800',
    color: '#9BDDFF',
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  routineName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  exerciseCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  exerciseCodeBadge: {
    backgroundColor: 'rgba(155, 221, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  exerciseCode: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9BDDFF',
  },
  exerciseName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  loggedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loggedBadgeText: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: 'bold',
  },
  skippedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(156, 163, 175, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  skippedBadgeText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: 'bold',
  },
  setsContainer: {
    gap: 6,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  setNumber: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  setData: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  noLogsText: {
    fontSize: 13,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 24,
  },
  resetButtonIcon: {
    fontSize: 18,
    color: '#EF4444',
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
  },
  bottomSpacer: {
    height: 40,
  },
  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalIcon: {
    fontSize: 32,
    color: '#EF4444',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  modalActions: {
    width: '100%',
    gap: 12,
  },
  modalDangerButton: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalDangerButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalCancelButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  modalCancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
