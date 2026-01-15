import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
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
  selected_variation?: string | null;
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
  onBack?: () => void;
}

function getCategoryButtonColors(category: string): [string, string] {
  const cat = category?.toLowerCase() || '';
  if (cat.includes('hitting')) return ['#dc2626', '#b91c1c'];
  if (cat.includes('throwing')) return ['#2563eb', '#1d4ed8'];
  return ['#10B981', '#059669'];
}

function isNotesOnlyExercise(ex: RoutineExercise): boolean {
  const enabledMeasurements = ex.enabled_measurements || [];
  const hasMetricTargets = ex.metric_targets && Object.keys(ex.metric_targets).length > 0;
  const hasLegacyReps = !!ex.reps;
  return enabledMeasurements.length === 0 && !hasMetricTargets && !hasLegacyReps;
}

function getYouTubeVideoId(url: string | null | undefined): string | null {
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
}

function getThumbnail(videoUrl: string | null | undefined): string | null {
  const videoId = getYouTubeVideoId(videoUrl);
  return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
}

export default function WorkoutPreStartScreen({
  workout,
  customMeasurements,
  onStart,
  onBack,
}: WorkoutPreStartScreenProps) {
  // Track which blocks are collapsed
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, boolean>>({});

  const toggleBlock = (blockId: string) => {
    setCollapsedBlocks(prev => ({
      ...prev,
      [blockId]: !prev[blockId]
    }));
  };

  const schemeNames = ['exercise', 'superset', 'emom', 'circuit', 'amrap', 'straight_sets'];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color="#9BDDFF" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>{workout.name}</Text>
      </View>


      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {workout.routines.map((routine, routineIdx) => {
          const hasBlockTitle = routine.name && !schemeNames.includes(routine.name.toLowerCase());
          const exercises = (routine.routine_exercises || []).filter(ex => !ex.exercises?.is_placeholder);
          const blockLetter = String.fromCharCode(65 + routineIdx);
          const isCollapsed = collapsedBlocks[routine.id] || false;

          // Check if this block has any exercises with metrics (not notes-only)
          const hasDetailedExercises = exercises.some(ex => !isNotesOnlyExercise(ex));

          return (
            <View key={routine.id} style={styles.blockSection}>
              {/* Block Header - Tappable to collapse/expand */}
              <TouchableOpacity
                style={styles.blockHeaderRow}
                onPress={() => toggleBlock(routine.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.blockTitle}>
                  {hasBlockTitle ? routine.name : `Block ${blockLetter}`}
                </Text>
                <View style={styles.blockHeaderLine} />
                <Ionicons
                  name={isCollapsed ? "chevron-forward" : "chevron-down"}
                  size={20}
                  color="rgba(255,255,255,0.3)"
                />
              </TouchableOpacity>

              {/* Block content - hidden when collapsed */}
              {!isCollapsed && (
                <>
                  {/* Block notes (like "2 Rounds") */}
                  {routine.text_info && (
                    <Text style={styles.blockNotes}>{routine.text_info}</Text>
                  )}
                  {routine.notes && !routine.text_info && (
                    <Text style={styles.blockNotes}>{routine.notes}</Text>
                  )}

                  {/* Exercises */}
                  {exercises.map((ex, exIdx) => {
                    const exercise = ex.exercises;
                    if (!exercise) return null;

                    const exerciseCode = `${blockLetter}${exIdx + 1}`;
                    const thumbnail = getThumbnail(exercise.video_url);
                    const notesOnly = isNotesOnlyExercise(ex);

                    const metricsDisplay = formatExerciseMetrics({
                      exercise: ex,
                      customMeasurements,
                      separator: '\n',
                    });

                    // For notes-only exercises, just show the name and notes in italic cyan
                    if (notesOnly) {
                      return (
                        <Text key={ex.id} style={styles.notesOnlyExercise}>
                          {exercise.name}{ex.notes ? ` ${ex.notes}` : ''}
                        </Text>
                      );
                    }

                    // For exercises with metrics, show code + thumbnail + details (NO checkbox)
                    return (
                      <View key={ex.id} style={styles.exerciseRow}>
                        <Text style={styles.exerciseCode}>{exerciseCode}</Text>

                        {/* Thumbnail */}
                        <View style={styles.thumbnail}>
                          {thumbnail ? (
                            <Image source={{ uri: thumbnail }} style={styles.thumbnailImage} />
                          ) : (
                            <View style={styles.thumbnailPlaceholder}>
                              <Ionicons name="barbell" size={20} color="rgba(255,255,255,0.3)" />
                            </View>
                          )}
                        </View>

                        {/* Exercise info */}
                        <View style={styles.exerciseInfo}>
                          <View style={styles.exerciseNameRow}>
                            <Text style={styles.exerciseName}>{exercise.name.toUpperCase()}</Text>
                            {ex.selected_variation && (
                              <Text style={styles.variationText}> ({ex.selected_variation})</Text>
                            )}
                          </View>
                          <Text style={styles.exerciseMetrics}>{metricsDisplay}</Text>
                          {ex.notes && (
                            <Text style={styles.exerciseNotes}>{ex.notes}</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Start Button */}
      <View style={styles.startButtonContainer}>
        <TouchableOpacity onPress={onStart} activeOpacity={0.8}>
          <LinearGradient
            colors={getCategoryButtonColors(workout.category)}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.startButton}
          >
            <Text style={styles.startButtonText}>START WORKOUT</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  backText: {
    color: '#9BDDFF',
    fontSize: 17,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  blockSection: {
    marginBottom: 24,
  },
  blockHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 4,
  },
  blockTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#9BDDFF',
    marginRight: 12,
  },
  blockHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginRight: 12,
  },
  blockNotes: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 12,
  },
  notesOnlyExercise: {
    fontSize: 14,
    color: '#9BDDFF',
    fontStyle: 'italic',
    marginBottom: 4,
    lineHeight: 20,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  exerciseCode: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
    width: 28,
  },
  thumbnail: {
    width: 56,
    height: 42,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginRight: 12,
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
  exerciseInfo: {
    flex: 1,
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 2,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  variationText: {
    color: '#C084FC',
    fontSize: 14,
    fontWeight: 'normal',
  },
  exerciseMetrics: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 18,
  },
  exerciseNotes: {
    fontSize: 12,
    color: '#F59E0B',
    marginTop: 4,
    lineHeight: 16,
  },
  startButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: '#000000',
  },
  startButton: {
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  startButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
