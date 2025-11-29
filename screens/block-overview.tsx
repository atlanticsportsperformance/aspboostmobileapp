import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { formatExerciseMetrics } from '../lib/formatExerciseMetrics';

// Types
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
  category?: string;
  tags?: string[];
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

interface BlockOverviewProps {
  workout: Workout;
  customMeasurements: Measurement[];
  completedSets: Record<string, boolean[]>;
  timer: number; // seconds elapsed
  onExercisePress: (exerciseId: string) => void;
  onCompleteWorkout: () => void;
  onBack: () => void;
}

// Helper: Get YouTube video ID from URL
function getYouTubeVideoId(url: string | null): string | null {
  if (!url) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/embed\/([^&\n?#]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

// Helper: Get exercise code badge (A1, A2, B1, etc.)
function getExerciseCode(routineIndex: number, exerciseIndex: number): string {
  const letter = String.fromCharCode(65 + routineIndex); // A, B, C...
  return `${letter}${exerciseIndex + 1}`;
}

// Helper: Check if all sets are completed
function isExerciseCompleted(exerciseId: string, completedSets: Record<string, boolean[]>): boolean {
  const sets = completedSets[exerciseId];
  return sets ? sets.every(s => s === true) : false;
}

export default function BlockOverview({
  workout,
  customMeasurements,
  completedSets,
  timer,
  onExercisePress,
  onCompleteWorkout,
  onBack,
}: BlockOverviewProps) {
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});

  const toggleBlock = (routineId: string) => {
    setExpandedBlocks(prev => ({
      ...prev,
      [routineId]: !prev[routineId],
    }));
  };

  // Calculate progress
  const totalSets = workout.routines.reduce(
    (sum, routine) =>
      sum + routine.routine_exercises.reduce((s, ex) => s + ex.sets, 0),
    0
  );

  const completedSetsCount = Object.values(completedSets).reduce((sum, exerciseSets) => {
    return sum + exerciseSets.filter(isComplete => isComplete).length;
  }, 0);

  const progressPercent = totalSets > 0 ? (completedSetsCount / totalSets) * 100 : 0;
  const allSetsCompleted = completedSetsCount === totalSets && totalSets > 0;

  // Format timer display
  const minutes = Math.floor(timer / 60);
  const seconds = timer % 60;
  const timerDisplay = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  // Timer color based on duration
  const getTimerColor = () => {
    if (minutes < 30) return '#10B981';
    if (minutes < 60) return '#F59E0B';
    return '#EF4444';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header with Timer */}
      <View style={styles.header}>
        {/* Top Row: Back button and Workout Name */}
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            activeOpacity={0.7}
          >
            <Text style={styles.backButtonIcon}>‹</Text>
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.workoutTitle} numberOfLines={1}>
            {workout.name}
          </Text>
          <View style={styles.backButtonPlaceholder} />
        </View>

        {/* Timer */}
        <Text style={[styles.timerDisplay, { color: getTimerColor() }]}>
          {timerDisplay}
        </Text>

        {/* Progress Bar */}
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <LinearGradient
              colors={['#10B981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressBarFill, { width: `${progressPercent}%` }]}
            />
          </View>
        </View>

        <Text style={styles.progressText}>
          {completedSetsCount}/{totalSets} sets completed
        </Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Workout Notes */}
        {(workout.notes || workout.description) && (
          <View style={styles.workoutNotesBanner}>
            <Text style={styles.workoutNotes}>
              {workout.notes || workout.description}
            </Text>
          </View>
        )}

      {/* Exercise Blocks/Routines */}
      {workout.routines.map((routine, routineIndex) => {
        const isExpanded = expandedBlocks[routine.id] !== false; // Default expanded
        const blockLetter = String.fromCharCode(65 + routineIndex); // A, B, C...

        return (
          <View key={routine.id} style={styles.blockSection}>
            {/* Block Header */}
            <TouchableOpacity
              style={styles.blockHeader}
              onPress={() => toggleBlock(routine.id)}
              activeOpacity={0.7}
            >
              <View style={styles.blockHeaderContent}>
                <Text style={styles.blockName}>{routine.name}</Text>
                {routine.description && (
                  <Text style={styles.blockDescription}>{routine.description}</Text>
                )}
              </View>
              <Text style={styles.chevronIcon}>{isExpanded ? '▼' : '▶'}</Text>
            </TouchableOpacity>

            {/* Notes Section */}
            {isExpanded && routine.notes && (
              <View style={styles.blockNotesContainer}>
                <Text style={styles.blockNotes}>{routine.notes}</Text>
              </View>
            )}

            {/* Exercise List */}
            {isExpanded && (
              <View style={styles.exerciseList}>
                {routine.routine_exercises.map((exercise, exerciseIndex) => {
                  const exerciseCode = getExerciseCode(routineIndex, exerciseIndex);
                  const videoId = getYouTubeVideoId(exercise.exercises.video_url || null);
                  const isCompleted = isExerciseCompleted(exercise.id, completedSets);
                  const hasPRTracking = exercise.tracked_max_metrics && exercise.tracked_max_metrics.length > 0;

                  const metrics = formatExerciseMetrics({
                    exercise,
                    customMeasurements,
                    separator: ' • ',
                  });

                  return (
                    <TouchableOpacity
                      key={exercise.id}
                      style={styles.exerciseCard}
                      onPress={() => onExercisePress(exercise.id)}
                      activeOpacity={0.7}
                    >
                      {/* Left Section */}
                      <View style={styles.exerciseLeft}>
                        {/* Exercise Code Badge */}
                        <View style={styles.exerciseCodeBadge}>
                          <Text style={styles.exerciseCodeText}>{exerciseCode}</Text>
                        </View>

                        {/* Video Thumbnail */}
                        <View style={styles.videoThumbnail}>
                          {videoId ? (
                            <Image
                              source={{ uri: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` }}
                              style={styles.thumbnailImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <Text style={styles.playIcon}>▶</Text>
                          )}
                        </View>
                      </View>

                      {/* Center Section */}
                      <View style={styles.exerciseCenter}>
                        {/* Exercise Name Row */}
                        <View style={styles.exerciseNameRow}>
                          <Text style={styles.exerciseName} numberOfLines={2}>
                            {exercise.exercises.name}
                          </Text>
                          {hasPRTracking && <Text style={styles.prTrophy}>🏆</Text>}
                          {isCompleted && (
                            <View style={styles.completionCheckmark}>
                              <Text style={styles.checkmarkIcon}>✓</Text>
                            </View>
                          )}
                        </View>

                        {/* Metrics Display */}
                        {metrics && (
                          <Text style={styles.metricsDisplay} numberOfLines={3}>
                            {metrics}
                          </Text>
                        )}

                        {/* Exercise Notes */}
                        {exercise.notes && (
                          <Text style={styles.exerciseNotes} numberOfLines={2}>
                            {exercise.notes}
                          </Text>
                        )}

                        {/* Tempo */}
                        {exercise.tempo && (
                          <Text style={styles.tempo}>Tempo: {exercise.tempo}</Text>
                        )}
                      </View>

                      {/* Right Section */}
                      <View style={styles.exerciseRight}>
                        <Text style={styles.arrowIcon}>›</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
      </ScrollView>

      {/* Complete Workout Button (Fixed Bottom) */}
      <View style={styles.completeButtonContainer}>
        <LinearGradient
          colors={['transparent', 'rgba(10,10,10,0.98)', '#0A0A0A']}
          style={styles.completeButtonGradient}
        >
          <TouchableOpacity
            style={[
              styles.completeButton,
              !allSetsCompleted && styles.completeButtonDisabled,
            ]}
            onPress={onCompleteWorkout}
            disabled={!allSetsCompleted}
            activeOpacity={allSetsCompleted ? 0.8 : 1}
          >
            {allSetsCompleted ? (
              <LinearGradient
                colors={['#10B981', '#059669']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.completeButtonActive}
              >
                <Text style={styles.completeButtonIcon}>✓</Text>
                <Text style={styles.completeButtonText}>COMPLETE WORKOUT</Text>
              </LinearGradient>
            ) : (
              <View style={styles.completeButtonInactive}>
                <Text style={styles.lockIcon}>🔒</Text>
                <Text style={styles.completeButtonTextDisabled}>
                  Complete all sets to finish
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </LinearGradient>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 96,
    maxWidth: 672,
    alignSelf: 'center',
    width: '100%',
  },
  workoutNotes: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#D4D4D4',
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  blockSection: {
    marginBottom: 8,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderLeftWidth: 4,
    borderLeftColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  blockHeaderContent: {
    flex: 1,
  },
  blockName: {
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  blockDescription: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#A3A3A3',
    marginTop: 2,
  },
  chevronIcon: {
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 8,
  },
  blockNotesContainer: {
    marginTop: 8,
    marginBottom: 8,
    padding: 8,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 8,
  },
  blockNotes: {
    fontSize: 12,
    color: '#93C5FD',
  },
  exerciseList: {
    marginLeft: 24,
    gap: 6,
  },
  exerciseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  exerciseLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exerciseCodeBadge: {
    width: 24,
    height: 24,
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.4)',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exerciseCodeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#9BDDFF',
  },
  videoThumbnail: {
    width: 56,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  playIcon: {
    fontSize: 14,
    color: '#525252',
  },
  exerciseCenter: {
    flex: 1,
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exerciseName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  prTrophy: {
    fontSize: 14,
  },
  completionCheckmark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkIcon: {
    fontSize: 12,
    color: '#6EE7B7',
    fontWeight: 'bold',
  },
  metricsDisplay: {
    fontSize: 14,
    color: '#D4D4D4',
    marginTop: 2,
    maxHeight: 60,
  },
  exerciseNotes: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#A3A3A3',
    marginTop: 2,
  },
  tempo: {
    fontSize: 12,
    fontWeight: '500',
    color: '#9BDDFF',
    marginTop: 2,
  },
  exerciseRight: {
    justifyContent: 'center',
  },
  arrowIcon: {
    fontSize: 20,
    color: '#737373',
  },
  header: {
    backgroundColor: '#0A0A0A',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: 50,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    marginLeft: -8,
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
  workoutTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  backButtonPlaceholder: {
    width: 60,
  },
  timerDisplay: {
    fontSize: 32,
    fontWeight: '700',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  progressBarContainer: {
    marginTop: 8,
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 9999,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    borderRadius: 9999,
  },
  progressText: {
    marginTop: 4,
    fontSize: 12,
    color: '#A3A3A3',
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  workoutNotesBanner: {
    padding: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 8,
  },
  completeButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 40,
  },
  completeButtonGradient: {
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  completeButton: {
    width: '100%',
    maxWidth: 672,
    alignSelf: 'center',
    borderRadius: 12,
    overflow: 'hidden',
  },
  completeButtonDisabled: {
    opacity: 1,
  },
  completeButtonActive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  completeButtonInactive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: 'rgba(115, 115, 115, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(115, 115, 115, 0.3)',
    borderRadius: 12,
  },
  completeButtonIcon: {
    fontSize: 24,
    color: '#FFFFFF',
  },
  completeButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  lockIcon: {
    fontSize: 20,
    color: '#737373',
  },
  completeButtonTextDisabled: {
    fontSize: 14,
    color: '#A3A3A3',
  },
});
