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
import { markWorkoutListDirty } from '../lib/workoutRefreshSignal';

interface ExerciseLog {
  id: string;
  exercise_id: string;
  routine_exercise_id: string;
  set_number: number;
  actual_reps: number | null;
  actual_weight: number | null;
  actual_duration_seconds: number | null;
  actual_distance: number | null;
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
  notes?: string;
  description?: string;
  text_info?: string;
  routine_exercises: RoutineExercise[];
}

interface WorkoutInstance {
  id: string;
  athlete_id: string;
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
  const [reopening, setReopening] = useState(false);
  // Custom measurements with primary/secondary metric IDs + names — used to
  // give paired-metric logs (e.g. Baseball (5oz) reps + mph) proper labels
  // and units instead of dumping raw numbers.
  const [customMeasurements, setCustomMeasurements] = useState<any[]>([]);

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
          athlete_id,
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
              scheme,
              order_index,
              notes,
              description,
              text_info,
              rest_between_rounds_seconds,
              superset_block_name,
              routine_exercises (
                id,
                exercise_id,
                sets,
                order_index,
                notes,
                notes_only,
                is_placeholder,
                placeholder_name,
                is_amrap,
                selected_variation,
                tempo,
                rest_seconds,
                metric_targets,
                enabled_measurements,
                set_configurations,
                intensity_targets,
                tracked_max_metrics,
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
          actual_duration_seconds,
          actual_distance,
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

      // Fetch custom measurements scoped to the athlete's org. Platform-wide
      // entries (org_id IS NULL) stay visible to everyone. Without the filter
      // the dropdown leaks every other facility's measurement library.
      const athleteOrgId =
        workoutData && (workoutData as any).athlete_id
          ? (
              await supabase
                .from('athletes')
                .select('org_id')
                .eq('id', (workoutData as any).athlete_id)
                .maybeSingle()
            ).data?.org_id ?? null
          : null;
      const measCols =
        'id, name, category, primary_metric_id, primary_metric_name, secondary_metric_id, secondary_metric_name';
      const measQuery = athleteOrgId
        ? supabase
            .from('custom_measurements')
            .select(measCols)
            .or(`org_id.eq.${athleteOrgId},org_id.is.null`)
        : supabase.from('custom_measurements').select(measCols).is('org_id', null);
      const { data: measData } = await measQuery;
      setCustomMeasurements(measData || []);

    } catch (error) {
      console.error('Error loading completed workout:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleReopenWorkout() {
    if (!workout) return;
    try {
      setReopening(true);

      // Flip status back to in_progress and clear completed_at. All logged
      // exercise_logs stay put — the athlete can tweak/add to existing sets
      // instead of redoing the workout from scratch.
      const { error } = await supabase
        .from('workout_instances')
        .update({
          status: 'in_progress',
          completed_at: null,
        })
        .eq('id', workoutInstanceId);

      if (error) {
        Alert.alert('Could not reopen workout', error.message || 'Please try again.');
        return;
      }

      // Signal the dashboard/workload that the list is stale so the card
      // re-renders as in_progress on the next focus.
      markWorkoutListDirty();

      // Replace this screen in the stack with the logger so tapping Back
      // returns to Dashboard, not to the stale completed view.
      navigation.replace('WorkoutLogger', {
        workoutInstanceId,
        athleteId: workout.athlete_id,
      });
    } catch (err: any) {
      console.error('[CompletedWorkout] reopen failed', err);
      Alert.alert('Could not reopen workout', err?.message ?? 'Please try again.');
    } finally {
      setReopening(false);
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

  // Paired-measurement aware log formatter. Looks up each metric_id in the
  // custom_measurements library to render proper labels and unit suffixes,
  // so a weighted-ball log of {baseball_5oz_reps: 8, baseball_5oz_mph: 85}
  // shows "8 reps · 85 mph (Baseball (5oz))" instead of "8 · 85".
  function labelForMetricId(metricId: string): { label: string; unit: string; group: string | null } {
    // Built-ins first.
    if (metricId === 'reps') return { label: 'Reps', unit: 'reps', group: null };
    if (metricId === 'weight') return { label: 'Weight', unit: 'lbs', group: null };
    if (metricId === 'time') return { label: 'Time', unit: 's', group: null };
    if (metricId === 'distance') return { label: 'Distance', unit: '', group: null };
    // Custom measurement: find by primary or secondary metric id.
    for (const m of customMeasurements) {
      if (m.primary_metric_id === metricId) {
        return {
          label: m.primary_metric_name || metricId,
          unit: (m.primary_metric_name || '').toLowerCase(),
          group: m.name,
        };
      }
      if (m.secondary_metric_id === metricId) {
        return {
          label: m.secondary_metric_name || metricId,
          unit: (m.secondary_metric_name || '').toLowerCase(),
          group: m.name,
        };
      }
    }
    // Last-resort: render the raw id with no unit.
    return { label: metricId, unit: '', group: null };
  }

  function formatSetLog(log: ExerciseLog): string {
    const parts: string[] = [];
    const groups = new Set<string>();

    if (log.actual_reps != null) parts.push(`${log.actual_reps} reps`);
    if (log.actual_weight != null) parts.push(`${log.actual_weight} lbs`);
    // Cardio / timed-isometric exercises live in actual_duration_seconds +
    // actual_distance. Previously the select dropped them and formatSetLog
    // skipped them, so any timed plank, sled push, or run logged via mobile
    // rendered as a bare "Completed" with no numbers visible.
    if (log.actual_duration_seconds != null) {
      const secs = log.actual_duration_seconds;
      const formatted =
        secs >= 60
          ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
          : `${secs}s`;
      parts.push(formatted);
    }
    if (log.actual_distance != null) parts.push(`${log.actual_distance} ft`);

    if (log.metric_data) {
      for (const [key, value] of Object.entries(log.metric_data)) {
        if (value == null || value === '' || key === 'reps' || key === 'weight') continue;
        const info = labelForMetricId(key);
        parts.push(info.unit ? `${value} ${info.unit}` : `${value}`);
        if (info.group) groups.add(info.group);
      }
    }

    if (parts.length === 0) return 'Completed';
    const joined = parts.join(' · ');
    return groups.size > 0 ? `${joined} (${Array.from(groups).join(', ')})` : joined;
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
          .map((routine, routineIndex) => {
            const routineNotes = routine.notes || routine.description || routine.text_info;

            return (
            <View key={routine.id} style={styles.routineSection}>
              <View style={styles.routineHeader}>
                <Text style={styles.routineLetter}>
                  {String.fromCharCode(65 + routineIndex)}
                </Text>
                <Text style={styles.routineName}>{routine.name}</Text>
              </View>

              {/* Block Notes */}
              {routineNotes && (
                <View style={styles.routineNotesContainer}>
                  <Text style={styles.routineNotes}>{routineNotes}</Text>
                </View>
              )}

              {routine.routine_exercises
                .filter((ex: any) => !ex.is_placeholder || ex.notes_only)
                .sort((a: any, b: any) => a.order_index - b.order_index)
                .map((exercise: any, exerciseIndex: number) => {
                  const logs = getLogsForExercise(exercise.id);
                  const hasLogs = logs.length > 0;
                  // CSV-imported notes-only blocks (and any other coach
                  // instruction rows that landed as placeholders) carry their
                  // title in placeholder_name, not exercises.name. Without
                  // this fallback the renderer null-derefs and the entire
                  // workout review screen crashes for plans with warmups.
                  const displayName =
                    exercise.exercises?.name ||
                    exercise.placeholder_name ||
                    'Unnamed';

                  return (
                    <View key={exercise.id} style={styles.exerciseCard}>
                      <View style={styles.exerciseHeader}>
                        <View style={styles.exerciseCodeBadge}>
                          <Text style={styles.exerciseCode}>
                            {String.fromCharCode(65 + routineIndex)}{exerciseIndex + 1}
                          </Text>
                        </View>
                        <Text style={styles.exerciseName}>
                          {displayName}
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
          );
          })}


        {/* Reopen Button — non-destructive: keeps all logged data and
            drops you back into the logger as in_progress. */}
        <TouchableOpacity
          style={styles.reopenButton}
          onPress={handleReopenWorkout}
          disabled={reopening}
          activeOpacity={0.7}
        >
          {reopening ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.reopenButtonIcon}>▸</Text>
              <Text style={styles.reopenButtonText}>Reopen Workout</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Reset Button — destructive: deletes all logged data */}
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
  routineNotesContainer: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  routineNotes: {
    fontSize: 14,
    color: '#93C5FD',
    lineHeight: 20,
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
  reopenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(155, 221, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.35)',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 24,
  },
  reopenButtonIcon: {
    fontSize: 16,
    color: '#9BDDFF',
  },
  reopenButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#9BDDFF',
    letterSpacing: 0.3,
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
    marginTop: 12,
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
