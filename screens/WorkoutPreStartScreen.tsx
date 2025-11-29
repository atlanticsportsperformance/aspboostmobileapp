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

// Types
interface Exercise {
  id: string;
  name: string;
  video_url?: string;
  description?: string;
  category?: string;
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

interface WorkoutPreStartScreenProps {
  workout: Workout;
  scheduledDate?: string;
  onStart: () => void;
}

// Format prescription: "3x8" or "3x1,1,1"
function formatRx(ex: RoutineExercise): string {
  if (!ex.reps) return `${ex.sets} sets`;
  return `${ex.sets}x${ex.reps}`;
}

export default function WorkoutPreStartScreen({
  workout,
  scheduledDate,
  onStart,
}: WorkoutPreStartScreenProps) {
  const totalExercises = workout.routines.reduce(
    (sum, r) => sum + r.routine_exercises.length, 0
  );
  const totalSets = workout.routines.reduce(
    (sum, r) => sum + r.routine_exercises.reduce((s, ex) => s + ex.sets, 0), 0
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
                {routine.routine_exercises.map((ex) => (
                  <View key={ex.id} style={styles.exercise}>
                    <Text style={styles.exName}>{ex.exercises.name}</Text>
                    <Text style={styles.exRx}>
                      {formatRx(ex)}
                      {ex.weight ? ` @ ${ex.weight}` : ''}
                      {ex.tempo ? ` (${ex.tempo})` : ''}
                    </Text>
                    {ex.notes && <Text style={styles.exNotes}>{ex.notes}</Text>}
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Start Button */}
      <TouchableOpacity style={styles.startBtn} onPress={onStart} activeOpacity={0.8}>
        <LinearGradient
          colors={['#10B981', '#059669']}
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
    color: '#525252',
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
  exName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFF',
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
