import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { LogRow } from '../lib/logger/lastWeek';
import {
  View,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Pressable,
  Text,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import BlockOverview from './block-overview';
import ExerciseDetailView from './exercise-detail-view';
import { ThrowingWorkloadMonitor } from '../components/pulse/ThrowingWorkloadMonitor';
import { ThrowingThrowsFeed } from '../components/pulse/ThrowingThrowsFeed';
import { PulseProvider } from '../lib/pulse/PulseProvider';
import { PulseWizardModal } from '../components/pulse/PulseWizardModal';
import { PulseHeaderChip } from '../components/pulse/PulseHeaderChip';
import PulseLiveBar from '../components/pulse/PulseLiveBar';
import { markWorkoutListDirty } from '../lib/workoutRefreshSignal';
import { isSetDoneFromLog, isValidSetIndex, logToSetInputs, mergeLogsWithPending } from '../lib/loggerResume';

// Types
import type {
  Measurement,
  Exercise,
  IntensityTarget,
  SetConfiguration,
  LoggerRoutineExercise as RoutineExercise,
  LoggerRoutine as Routine,
  LoggerWorkout as Workout,
} from '../types/logger';
import { buildSequence, nextStep } from '../lib/logger/sequence';
import { normalizeScheme } from '../lib/logger/scheme';
import { nextSetPrefill } from '../lib/logger/targets';
import { buildLogRow, completeForEdit, upsertSet } from '../lib/logger/saveSet';
import { loggerOutbox } from '../lib/logger/outbox';
import { pendingCompletions } from '../lib/logger/pendingComplete';
import SessionRpeSheet from '../components/logger/SessionRpeSheet';
import { restAfter } from '../lib/logger/rest';
import { useRestTimer } from '../hooks/useRestTimer';

// Log Set's double-tap guard is held at least this long, so a fast second
// tap can't un-check the set it just logged.
const COMPLETION_GUARD_MS = 600;
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
  status: 'not_started' | 'in_progress' | 'completed';
  started_at?: string;
  completed_at?: string;
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
  const [viewMode, setViewMode] = useState<'overview' | 'exercise'>('overview');
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [customMeasurements, setCustomMeasurements] = useState<Measurement[]>([]);
  const [exerciseInputs, setExerciseInputs] = useState<Record<string, any[]>>({});
  const [completedSets, setCompletedSets] = useState<Record<string, boolean[]>>({});
  const [currentSetIndexes, setCurrentSetIndexes] = useState<Record<string, number>>({});
  // athleteMaxes keyed by exercise_id -> metric_id -> value
  const [athleteMaxes, setAthleteMaxes] = useState<Record<string, Record<string, number>>>({});
  // Mound velocity for throwing velocity fallback (5oz baseball PR)
  const [moundVelocity, setMoundVelocity] = useState<number | null>(null);
  const [prAlert, setPRAlert] = useState<PRAlert | null>(null);
  // Draft-save debounce, one timer PER SET (`reId:setIndex`). The timer
  // writes every field edited since the last save (draftFieldsRef), with the
  // values read from inputsRef when it fires, so typing reps then weight
  // inside 500 ms still saves both. useRef (not useState) so a rapid second
  // edit cancels the first timer synchronously.
  const draftTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const draftFieldsRef = useRef<Record<string, Set<string>>>({});
  // Synchronous mirrors of exerciseInputs / completedSets. Saves build rows
  // from these so a write never uses a value from a stale render closure.
  const inputsRef = useRef<Record<string, any[]>>({});
  const completedRef = useRef<Record<string, boolean[]>>({});
  // rpe per `reId:setIndex` (loaded + tapped). Only an RPE tap sends it —
  // the upsert RPC leaves columns a write doesn't name untouched.
  const rpeRef = useRef<Record<string, number | null>>({});
  // Render mirror of rpeRef (the RPE row reads it).
  const [rpeValues, setRpeValues] = useState<Record<string, number | null>>({});
  const restTimer = useRestTimer();
  // Sets whose completion toggle is still saving — a fast double-tap on Log
  // Set is ignored instead of flipping the set back locally.
  const completionInFlightRef = useRef<Set<string>>(new Set());
  const [timer, setTimer] = useState(0); // seconds elapsed
  // Exercise history keyed by exercise_id
  const [exerciseHistory, setExerciseHistory] = useState<Record<string, any[]>>({});
  // Raw completed-log rows for the "last week" reference (lib/logger/lastWeek).
  const [lastWeekRows, setLastWeekRows] = useState<LogRow[]>([]);
  // Org id for pulse monitor (separate fetch; keeps the existing athlete query untouched)
  const [orgId, setOrgId] = useState<string | null>(null);
  // Per-athlete preference for showing the workload tracker (Pulse Monitor +
  // throws feed) on throwing workouts. Persisted in AsyncStorage so an
  // athlete who doesn't own a Pulse sensor can hide it once and never see it
  // again.
  const [pulseTrackerHidden, setPulseTrackerHidden] = useState<boolean>(false);
  // Whether the day this workout is scheduled for has a coach-prescribed
  // workload target (`pulse_athlete_workload_day` row). When false the
  // Pulse tracker auto-hides so a non-throwing-load day doesn't hand the
  // athlete a giant 0/no-target gauge to ignore.
  const [hasWorkloadTarget, setHasWorkloadTarget] = useState<boolean | null>(null);
  // Session-level override — set when the athlete explicitly taps the
  // "Show Pulse tracker" row on a no-target day. Wins over the auto-hide
  // gate so the athlete can engage the sensor for a free-form session
  // without a coach-prescribed target. Not persisted; resets on next
  // workout open.
  const [manualShowPulse, setManualShowPulse] = useState(false);
  useEffect(() => {
    if (!athleteId) return;
    (async () => {
      const { data } = await supabase
        .from('athletes')
        .select('org_id')
        .eq('id', athleteId)
        .maybeSingle();
      if (data?.org_id) setOrgId(data.org_id);
    })();
  }, [athleteId]);

  // Probe whether the scheduled day has a workload target set. We do a
  // tiny count query so the result lands fast on screen open. If there's
  // no row, the Pulse cluster stays hidden until the athlete opts in.
  useEffect(() => {
    if (!athleteId || !workoutInstance?.scheduled_date) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('pulse_athlete_workload_day')
        .select('target_w_day')
        .eq('athlete_id', athleteId)
        .eq('target_date', workoutInstance.scheduled_date)
        .maybeSingle();
      if (cancelled) return;
      const hasTarget = !!data && Number(data.target_w_day) > 0;
      setHasWorkloadTarget(hasTarget);
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, workoutInstance?.scheduled_date]);

  // Load workout data, then push anything still queued on this device.
  useEffect(() => {
    loadWorkout().finally(() => {
      void loggerOutbox.flush({ foreground: true });
    });
  }, [workoutInstanceId]);
  // (Foreground sync of the outbox lives at app level:
  // hooks/useOutboxForegroundSync, mounted in App.tsx.)

  // Fetch mound velocity for throwing velocity fallback
  useEffect(() => {
    async function fetchMoundVelocity() {
      if (!athleteId) return;

      // Fetch the global 5oz mound velocity PR (exercise_id is null for global measurements)
      const { data } = await supabase
        .from('athlete_maxes')
        .select('max_value')
        .eq('athlete_id', athleteId)
        .eq('metric_id', '5oz_mound_velo')
        .is('exercise_id', null)
        .single();

      if (data) {
        setMoundVelocity(data.max_value);
        console.log(`🎯 Loaded mound velocity for fallback: ${data.max_value} mph`);
      }
    }

    fetchMoundVelocity();
  }, [athleteId]);

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
                tags,
                is_placeholder
              )
            )
          )
        `)
        .eq('id', instance.workout_id)
        .single();

      if (workoutError) throw workoutError;
      // `.single()` returns null data without an error when the row doesn't
      // exist (e.g. coach deleted the workout between assignment and the
      // athlete opening it). Without this guard the .sort() below throws
      // TypeError before the catch block can render a friendly alert.
      if (!workoutData) {
        throw new Error('Workout not found — it may have been deleted.');
      }

      // Sort routines and exercises by order_index, filter out placeholders
      workoutData.routines.sort((a: Routine, b: Routine) => a.order_index - b.order_index);
      workoutData.routines.forEach((routine: Routine) => {
        // Keep notes_only rows (e.g. warm-up text blocks stored as
        // is_placeholder=true, notes_only=true, exercises=null) so the block
        // can render their placeholder_name + parsed bulleted notes. Drop
        // only "true" placeholders (placeholder without notes_only).
        // Matches CompletedWorkoutScreen.tsx:439.
        routine.routine_exercises = routine.routine_exercises.filter(
          (re: RoutineExercise) => !(re.is_placeholder || re.exercises?.is_placeholder) || re.notes_only
        );
        routine.routine_exercises.sort((a, b) => a.order_index - b.order_index);

        // Log any exercises with missing joined data
        routine.routine_exercises.forEach((re: RoutineExercise) => {
          if (!re.exercises) {
            console.warn(`[WorkoutLogger] Missing exercise data for routine_exercise ${re.id}, exercise_id: ${re.exercise_id}, sets: ${re.sets}, reps: ${re.reps}`);
          }
        });
      });

      setWorkout(workoutData);

      // Flatten all exercises into single array (placeholders already filtered above)
      const exercises = workoutData.routines.flatMap((r: Routine) => r.routine_exercises);
      setAllExercises(exercises);

      // Initialize current set indexes
      const indexes: Record<string, number> = {};
      exercises.forEach((ex: RoutineExercise) => {
        indexes[ex.id] = 0;
      });
      setCurrentSetIndexes(indexes);

      // Fetch custom measurements scoped to the athlete's org. Platform-wide
      // entries (org_id IS NULL) stay visible to everyone. Without this
      // filter the dropdown leaks every facility's measurement library.
      const { data: athleteOrgRow } = await supabase
        .from('athletes')
        .select('org_id')
        .eq('id', athleteId)
        .maybeSingle();
      const measQuery = athleteOrgRow?.org_id
        ? supabase
            .from('custom_measurements')
            .select('*')
            .or(`org_id.eq.${athleteOrgRow.org_id},org_id.is.null`)
        : supabase.from('custom_measurements').select('*').is('org_id', null);
      const { data: measurements } = await measQuery;
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

      // Rows saved on this device but not synced yet are newer than the
      // server's — overlay them so a reopened workout shows every set.
      // Snapshot them BEFORE reading the server: a flush finishing in
      // between would otherwise drop the row from both reads.
      const pendingRows = await loggerOutbox.pending().catch(() => []);

      // Fetch existing logs (if resuming workout)
      const { data: logs } = await supabase
        .from('exercise_logs')
        .select('*')
        .eq('workout_instance_id', workoutInstanceId)
        .order('set_number');

      const allLogs = mergeLogsWithPending(logs, pendingRows, workoutInstanceId);
      const rpeMap: Record<string, number | null> = {};
      allLogs.forEach((l: any) => {
        if ('rpe' in l) rpeMap[`${l.routine_exercise_id}:${l.set_number - 1}`] = l.rpe ?? null;
      });
      rpeRef.current = rpeMap;
      setRpeValues(rpeMap);

      // Populate exerciseInputs from existing logs
      const inputsMap: Record<string, any[]> = {};
      const completedMap: Record<string, boolean[]> = {};

      exercises.forEach((ex: RoutineExercise) => {
        const exLogs = allLogs.filter((l: any) => l.routine_exercise_id === ex.id);

        // Initialize arrays for all sets
        const setsData = Array(ex.sets).fill(null).map(() => ({}));
        const completedArray = Array(ex.sets).fill(false);

        // Fill in logged data. DB stores actual values in dedicated columns
        // (actual_reps/actual_weight/actual_duration_seconds/actual_distance)
        // and custom metrics in metric_data JSONB. Map back to the local
        // property names the rest of the screen consumes.
        exLogs.forEach((log: any) => {
          const setIndex = log.set_number - 1; // Convert to 0-indexed
          if (setIndex >= 0 && setIndex < ex.sets) {
            setsData[setIndex] = logToSetInputs(log);

            // Done only if is_complete — drafts resume not-done with values.
            completedArray[setIndex] = isSetDoneFromLog(log);
          }
        });

        inputsMap[ex.id] = setsData;
        completedMap[ex.id] = completedArray;
      });

      inputsRef.current = inputsMap;
      completedRef.current = completedMap;
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
          actual_reps,
          actual_weight,
          actual_duration_seconds,
          actual_distance,
          notes,
          metric_data,
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

          // Map dedicated actual_* DB columns back to local field names so
          // history-rendering code keeps reading the same shape.
          workoutEntry.sets.push({
            set_number: log.set_number,
            reps: log.actual_reps,
            weight: log.actual_weight,
            time_seconds: log.actual_duration_seconds,
            distance: log.actual_distance,
            notes: log.notes,
            ...(log.metric_data || {}),
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
      setLastWeekRows(
        (historyData ?? []).flatMap((log: any): LogRow[] => {
          const exId = log.routine_exercises?.exercise_id;
          const instId = log.workout_instances?.id;
          if (!exId || !instId) return [];
          return [{
            workout_instance_id: instId,
            exercise_id: exId,
            set_number: log.set_number,
            actual_weight: log.actual_weight ?? null,
            actual_reps: log.actual_reps ?? null,
            completed_at: log.workout_instances?.completed_at ?? null,
          }];
        }),
      );

      // Auto-start the workout if it's still not_started. Mirrors how Strong /
      // Hevy / Apple Fitness work: tap a workout from the day card → straight
      // into the logger, no preview gate. We await the DB write so if the
      // network drops the athlete sees an alert and can retry, instead of
      // silently landing on a logger for a workout the backend thinks is
      // still pending (which would re-auto-start on next open and reset the
      // elapsed timer).
      if (instance.status === 'not_started') {
        setTimer(0);
        const startedAt = new Date().toISOString();
        const { error: startErr } = await supabase
          .from('workout_instances')
          .update({ status: 'in_progress', started_at: startedAt })
          .eq('id', workoutInstanceId);
        if (startErr) {
          console.error('[WorkoutLogger] auto-start failed', startErr);
          Alert.alert(
            'Could not start workout',
            startErr.message ?? 'Please check your connection and try again.',
          );
          navigation.goBack();
          return;
        }
        // Keep local state in sync with the DB write so later logic that
        // reads workoutInstance.status sees 'in_progress'.
        setWorkoutInstance({ ...instance, status: 'in_progress', started_at: startedAt });
      } else if (instance.status === 'in_progress' && instance.started_at) {
        const startTime = new Date(instance.started_at).getTime();
        const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        setTimer(elapsedSeconds);
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

  // Hydrate per-athlete Pulse-tracker preference from AsyncStorage on mount.
  // Athletes without a Pulse can hide the tracker once; this restores their
  // choice across app launches.
  useEffect(() => {
    if (!athleteId) return;
    let active = true;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(pulseTrackerKey(athleteId));
        if (active && v === '1') setPulseTrackerHidden(true);
      } catch {
        // non-fatal — default to shown
      }
    })();
    return () => {
      active = false;
    };
  }, [athleteId]);

  const savePulseTrackerHidden = useCallback(
    (hidden: boolean) => {
      setPulseTrackerHidden(hidden);
      if (athleteId) {
        AsyncStorage.setItem(
          pulseTrackerKey(athleteId),
          hidden ? '1' : '0',
        ).catch(() => {});
      }
    },
    [athleteId],
  );

  // Finish / Complete Anyway (spec §4.5): ask session RPE first when the
  // workout wants it, then finalize. Skip finalizes without session_rpe.
  const [showSessionRpe, setShowSessionRpe] = useState(false);
  const finishingRef = useRef(false);
  const handleCompleteWorkout = () => {
    if (finishingRef.current) return;
    if (workout?.ask_session_rpe) {
      setShowSessionRpe(true);
      return;
    }
    void finalizeWorkout();
  };
  const handleSessionRpe = (value: number) => {
    setShowSessionRpe(false);
    void finalizeWorkout(value);
  };
  // Android back / dismiss: cancel — stay on the logger, don't complete.
  const handleCancelSessionRpe = () => setShowSessionRpe(false);
  const handleSkipSessionRpe = () => {
    setShowSessionRpe(false);
    void finalizeWorkout();
  };

  // Flush the set outbox, then mark the workout complete. Never blocks on
  // being offline: an unsent completion is queued and replayed by the
  // foreground sync (lib/logger/pendingComplete.ts).
  const finalizeWorkout = async (sessionRpe?: number) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      try {
        await loggerOutbox.flush({ foreground: true });
      } catch (e) {
        console.error('[WorkoutLogger] outbox flush before finish failed', e);
      }
      const intent = {
        workoutInstanceId,
        completedAt: new Date().toISOString(),
        ...(sessionRpe != null ? { sessionRpe } : {}),
      };
      const outcome = await pendingCompletions.complete(intent);
      if (outcome.status === 'rejected') {
        // Server said no — don't queue, keep the athlete here.
        console.error('[WorkoutLogger] complete failed', outcome.message);
        Alert.alert('Could not save workout', outcome.message || 'Please try again.');
        return;
      }

      // Signal the dashboard that its workout list is stale so the next
      // focus bypasses the 30s refetch throttle and we see `status: completed`.
      markWorkoutListDirty();

      Alert.alert(
        'Workout Complete!',
        outcome.status === 'queued'
          ? 'Saved on this device. It will sync when you are back online.'
          : 'Great job! Your workout has been saved.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } finally {
      finishingRef.current = false;
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

  // Whole-workout set order (lib/logger/sequence.ts) — the single source of
  // "which exercise/set comes next" for both handleNextSet and the Next label.
  const sequence = useMemo(() => (workout ? buildSequence(workout.routines) : []), [workout]);

  // Local-state writers that keep the synchronous refs in step.
  const commitInputs = (next: Record<string, any[]>) => {
    inputsRef.current = next;
    setExerciseInputs(next);
  };
  const commitCompleted = (exerciseId: string, update: (sets: boolean[]) => boolean[], totalSets: number) => {
    const current = completedRef.current[exerciseId] || Array(totalSets).fill(false);
    const next = { ...completedRef.current, [exerciseId]: update([...current]) };
    completedRef.current = next;
    setCompletedSets(next);
  };
  // Cancels a set's pending draft save and returns the fields it would have
  // written — the caller's write carries them instead, so nothing typed in
  // the last 500 ms is lost.
  const cancelDraft = (exerciseId: string, setIndex: number): string[] => {
    const k = `${exerciseId}:${setIndex}`;
    const pending = draftTimersRef.current[k];
    if (pending) clearTimeout(pending);
    delete draftTimersRef.current[k];
    const fields = draftFieldsRef.current[k];
    delete draftFieldsRef.current[k];
    return fields ? [...fields] : [];
  };

  // Save one set (spec §7 / §11.2 / final review I4): build a row with ONLY
  // what this write means to change, put it in the device outbox (merged per
  // set), then sync. `complete` (Log Set / check / circle / un-check) sends
  // is_complete; `fields` sends those fields' current values (drafts don't
  // touch is_complete); `rpe` sends the set's rpe. Resolves true once the row
  // is safely queued (or sent).
  const persistSet = useCallback(async (
    exerciseId: string,
    setIndex: number,
    write: { complete?: boolean; fields?: string[]; rpe?: boolean },
  ): Promise<boolean> => {
    const exercise = allExercises.find(ex => ex.id === exerciseId);
    if (!exercise) return false;
    // Notes-only rows have no exercise_id (NOT NULL) — nothing to persist.
    if (!exercise.exercise_id) return false;
    // A finished superset exercise leaves its set index at `sets`; never
    // persist a phantom set_number past the prescribed sets.
    if (!isValidSetIndex(setIndex, exercise.sets)) return false;

    const row = buildLogRow(
      { workoutInstanceId, routineExerciseId: exerciseId, setNumber: setIndex + 1 },
      inputsRef.current[exerciseId]?.[setIndex] || {},
      {
        complete: write.complete,
        fields: write.fields ?? [],
        athleteId,
        exerciseId: exercise.exercise_id,
        // org_id was never written from mobile before — web writes it; any
        // org-scoped RLS/report misses mobile logs without it.
        orgId,
        rpe: write.rpe ? rpeRef.current[`${exerciseId}:${setIndex}`] ?? null : undefined,
      },
    );
    try {
      await loggerOutbox.enqueue(row);
    } catch (error) {
      // Device storage failed — fall back to a direct write.
      console.error('logger outbox enqueue failed, writing directly:', error);
      return (await upsertSet(supabase, row)).ok;
    }
    void loggerOutbox.flush();
    return true;
  }, [allExercises, athleteId, orgId, workoutInstanceId]);

  // Rest after a logged set (spec §11.6); the overview shows the countdown.
  const startRestAfter = useCallback((exerciseId: string, setIndex: number) => {
    const step = sequence.find(s => s.reId === exerciseId && s.setIndex === setIndex);
    if (!step || !workout) return;
    const routine = workout.routines.find(r => r.id === step.routineId);
    const re = allExercises.find(ex => ex.id === exerciseId);
    if (!routine || !re) return;
    const sec = restAfter(step, re, routine);
    if (sec != null) restTimer.start(sec);
  }, [sequence, workout, allExercises, restTimer.start]);

  // Quick-complete: Toggle all sets for an exercise
  const handleToggleExerciseComplete = async (exerciseId: string, totalSets: number) => {
    const currentSets = completedRef.current[exerciseId] || Array(totalSets).fill(false);
    const allCompleted = currentSets.every(s => s === true);

    // Toggle: if all complete, uncomplete all; otherwise complete all
    const newStatus = !allCompleted;

    // Update local state immediately for responsiveness
    commitCompleted(exerciseId, () => Array(totalSets).fill(newStatus), totalSets);

    // Persist each set's completion ONLY (plus any draft still pending) — the
    // circle never re-sends values, so it can't overwrite sets a coach or
    // another device entered. Un-completing writes is_complete:false too —
    // resume trusts is_complete.
    for (let setIndex = 0; setIndex < totalSets; setIndex++) {
      const fields = cancelDraft(exerciseId, setIndex);
      await persistSet(exerciseId, setIndex, { complete: newStatus, fields });
    }
  };

  // Helper to get max value from athleteMaxes
  const getMaxValue = (exerciseId: string, metricId: string): number | null => {
    return athleteMaxes[exerciseId]?.[metricId] ?? null;
  };

  // Check and save PR.
  //
  // athlete_maxes is ONE row per (athlete, exercise, metric), enforced by
  // the partial unique index idx_athlete_maxes_exercise_unique
  // (... WHERE exercise_id IS NOT NULL). The previous upsert named that
  // key in onConflict, but Postgres only infers a PARTIAL unique index when
  // the predicate is supplied — which PostgREST can't send — so every call
  // errored ("no unique constraint matching") and no mobile PR ever saved.
  // Select-then-update-or-insert sidesteps inference entirely. Same shape
  // as the web execute pages now use.
  //
  // reps_at_max is recorded from the same set so a coach can see a 250×5
  // vs a 245×1; a higher weight replaces the row regardless of rep count
  // (250×5 implies a higher 1RM than 245×1).
  const checkAndSavePR = async (
    routineExerciseId: string,
    metric: string,
    value: number,
    repsAtMax?: number | null
  ) => {
    try {
      const exercise = allExercises.find(ex => ex.id === routineExerciseId);
      if (!exercise || !exercise.tracked_max_metrics?.includes(metric)) {
        return; // Not tracking this metric
      }

      const currentMax = getMaxValue(exercise.exercise_id, metric) || 0;
      if (value <= currentMax) return;

      const { data: existing } = await supabase
        .from('athlete_maxes')
        .select('id, max_value')
        .eq('athlete_id', athleteId)
        .eq('exercise_id', exercise.exercise_id)
        .eq('metric_id', metric)
        .maybeSingle();

      if (existing && value <= Number(existing.max_value)) {
        // Local cache was stale (e.g. a web PR landed since load) — sync it.
        setAthleteMaxes(prev => ({
          ...prev,
          [exercise.exercise_id]: { ...(prev[exercise.exercise_id] || {}), [metric]: Number(existing.max_value) },
        }));
        return;
      }

      const reps = repsAtMax != null && Number.isFinite(repsAtMax) && repsAtMax > 0 ? Math.round(repsAtMax) : 1;
      const row = {
        max_value: value,
        reps_at_max: reps,
        achieved_on: new Date().toISOString().split('T')[0], // date column
        source: 'logged', // "Auto" badge in PerformanceScreen MaxCard
        ...(orgId ? { org_id: orgId } : {}),
      };

      const { error } = existing
        ? await supabase.from('athlete_maxes').update(row).eq('id', existing.id)
        : await supabase.from('athlete_maxes').insert({
            athlete_id: athleteId,
            exercise_id: exercise.exercise_id,
            metric_id: metric,
            ...row,
          });
      if (error) {
        console.error('PR save failed:', error);
        return;
      }

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
    // Auto-fill saves a draft like a typed edit (spec §11.2); kept for callers.
    _isAutoFill: boolean = false
  ) => {
    const targetExerciseId = exerciseIdOverride || activeExerciseId;
    const targetExercise = allExercises.find(ex => ex.id === targetExerciseId);

    if (!targetExercise || !targetExerciseId) return;

    // 1. Update local state (and its synchronous mirror)
    const exerciseData = [...(inputsRef.current[targetExerciseId] || [])];
    while (exerciseData.length <= setIndex) exerciseData.push({});
    exerciseData[setIndex] = { ...exerciseData[setIndex], [field]: value };
    commitInputs({ ...inputsRef.current, [targetExerciseId]: exerciseData });
    const setData = exerciseData[setIndex];

    // 2. Save a draft (debounced 500 ms per set). An edit — typed or
    // auto-filled — never logs a set; Log Set does (spec §11.2). Editing an
    // already-logged set keeps it logged. Drafts persist so they survive an
    // app kill and resume not-done with their values. The timer reads the
    // latest values and completion when it fires, and targetExerciseId is
    // captured here, so navigating away inside 500 ms still saves the
    // right row.
    // The draft sends only the edited fields — never is_complete, so editing
    // a logged set keeps it logged and a draft can't un-log a set another
    // device logged.
    const timerKey = `${targetExerciseId}:${setIndex}`;
    const pending = draftTimersRef.current[timerKey];
    if (pending) clearTimeout(pending);
    if (!draftFieldsRef.current[timerKey]) draftFieldsRef.current[timerKey] = new Set();
    draftFieldsRef.current[timerKey].add(field);
    draftTimersRef.current[timerKey] = setTimeout(() => {
      delete draftTimersRef.current[timerKey];
      const fields = [...(draftFieldsRef.current[timerKey] ?? [])];
      delete draftFieldsRef.current[timerKey];
      persistSet(targetExerciseId, setIndex, { fields });
    }, 500);

    // 5. Check for PR (if tracked metric). Carry the reps from the same set
    // so reps_at_max is recorded (a reps-metric PR uses its own value).
    if (targetExercise.tracked_max_metrics?.includes(field)) {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        const repsRaw = field === 'reps' ? value : setData.reps;
        const repsNum = repsRaw == null || repsRaw === '' ? null : parseFloat(repsRaw);
        checkAndSavePR(targetExerciseId, field, numValue, repsNum);
      }
    }
  }, [activeExerciseId, allExercises, persistSet]);

  // Handle next set / done - the set order comes from the sequence engine
  const handleNextSet = useCallback(() => {
    if (!activeExerciseId || !workout) return;

    const exercise = allExercises.find(ex => ex.id === activeExerciseId);
    if (!exercise) return;

    // Find current routine for this exercise
    const currentRoutine = workout.routines.find(r =>
      r.routine_exercises.some(re => re.id === exercise.id)
    );
    if (!currentRoutine) return;

    const isStraight = normalizeScheme(currentRoutine.scheme) === 'straight';
    const currentSetIndex = currentSetIndexes[activeExerciseId] || 0;
    const currentSetData = inputsRef.current[activeExerciseId]?.[currentSetIndex] || {};

    // Mark current set as completed and log it (rest starts only if this
    // tap is what logged it — Log Set already started it otherwise).
    const wasDone = completeForEdit(completedRef.current[activeExerciseId], currentSetIndex);
    const markDone = (sets: boolean[] | undefined) => {
      const updatedSets = [...(sets || Array(exercise.sets).fill(false))];
      updatedSets[currentSetIndex] = true;
      return updatedSets;
    };
    commitCompleted(activeExerciseId, markDone, exercise.sets);
    const draftFields = cancelDraft(activeExerciseId, currentSetIndex);
    persistSet(activeExerciseId, currentSetIndex, { complete: true, fields: draftFields }).then(ok => {
      if (ok && !wasDone) startRestAfter(activeExerciseId, currentSetIndex);
    });

    const goToOverview = () => {
      setViewMode('overview');
      setActiveExerciseId(null);
    };

    // Notes-only rows / text blocks have no sets in the sequence: step to the
    // next row in the list (what their button label shows).
    if (!sequence.some(s => s.reId === activeExerciseId)) {
      const currentExerciseIndex = allExercises.findIndex(ex => ex.id === activeExerciseId);
      if (currentExerciseIndex < allExercises.length - 1) {
        setActiveExerciseId(allExercises[currentExerciseIndex + 1].id);
      } else {
        goToOverview();
      }
      return;
    }

    const done = completedRef.current;
    const next = nextStep(sequence, done, { reId: activeExerciseId, setIndex: currentSetIndex });

    if (!next) {
      goToOverview();
      return;
    }

    // Straight sets staying on the same exercise: pre-fill the next set from
    // the one just logged — except fields the next set has its own target
    // for (prescribed value, % of max) and measured values; back-off fields
    // get their computed value (lib/logger/targets nextSetPrefill).
    if (isStraight && next.reId === activeExerciseId) {
      const prefill = nextSetPrefill({
        re: exercise,
        nextSetIndex: next.setIndex,
        prev: currentSetData,
        logged: inputsRef.current[activeExerciseId] || [],
        maxes: athleteMaxes,
        moundVelocity,
      });
      Object.entries(prefill).forEach(([field, value]) => {
        handleInputChange(next.setIndex, field, value, activeExerciseId, true);
      });
    }

    setCurrentSetIndexes(prev => ({
      ...prev,
      // Grouped blocks advance the exercise being left past the set just done
      ...(isStraight ? {} : { [activeExerciseId]: currentSetIndex + 1 }),
      [next.reId]: next.setIndex,
    }));
    setActiveExerciseId(next.reId);
  }, [activeExerciseId, workout, allExercises, sequence, currentSetIndexes, handleInputChange, persistSet, startRestAfter, athleteMaxes, moundVelocity]);

  // Navigation handlers
  const handleExercisePress = (exerciseId: string) => {
    setActiveExerciseId(exerciseId);
    setViewMode('exercise');
  };

  // Overview Continue: open nextStep's exercise on nextStep's set, so a
  // superset A1 → A2 → A1 lands on the right round.
  const handleContinue = (exerciseId: string, setIndex: number) => {
    setCurrentSetIndexes(prev => ({ ...prev, [exerciseId]: setIndex }));
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

    const inFlightKey = `${activeExerciseId}:${setIndex}`;
    if (completionInFlightRef.current.has(inFlightKey)) return;

    const currentlyCompleted = completeForEdit(completedRef.current[activeExerciseId], setIndex);

    // If checking (not unchecking) and we have auto-fill values, apply them
    if (!currentlyCompleted && autoFillValues) {
      Object.entries(autoFillValues).forEach(([field, value]) => {
        handleInputChange(setIndex, field, value, activeExerciseId, true);
      });
    }

    commitCompleted(activeExerciseId, sets => {
      sets[setIndex] = !currentlyCompleted; // Toggle
      return sets;
    }, exercise.sets);

    // Log Set / check → complete:true; uncheck → complete:false. The row
    // carries the set's full values (incl. the auto-fill just applied).
    completionInFlightRef.current.add(inFlightKey);
    // Sends is_complete plus any fields edited/auto-filled since the last save.
    const draftFields = cancelDraft(activeExerciseId, setIndex);
    persistSet(activeExerciseId, setIndex, { complete: !currentlyCompleted, fields: draftFields })
      .then(ok => {
        if (ok && !currentlyCompleted) startRestAfter(activeExerciseId, setIndex);
      })
      .finally(() => {
        setTimeout(() => completionInFlightRef.current.delete(inFlightKey), COMPLETION_GUARD_MS);
      });
  }, [activeExerciseId, allExercises, handleInputChange, persistSet, startRestAfter]);

  // RPE tap: update the set's rpe and save at once — rpe only (plus any
  // pending draft fields); completion is left alone.
  const handleRpeChange = useCallback((setIndex: number, value: number) => {
    if (!activeExerciseId) return;
    const next = { ...rpeRef.current, [`${activeExerciseId}:${setIndex}`]: value };
    rpeRef.current = next;
    setRpeValues(next);
    const draftFields = cancelDraft(activeExerciseId, setIndex);
    persistSet(activeExerciseId, setIndex, { rpe: true, fields: draftFields });
  }, [activeExerciseId, persistSet]);

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
    if (!workout || !currentRoutine || !activeExerciseId) return undefined;
    const routineIndex = workout.routines.findIndex(r => r.id === currentRoutine.id);
    // Same visibility rule as the overview list (keeps notes_only instruction
    // cards) so A1/A2 numbering matches what the athlete sees.
    const exerciseIndex = currentRoutine.routine_exercises
      .filter(ex => !(ex.is_placeholder || ex.exercises?.is_placeholder) || ex.notes_only)
      .findIndex(ex => ex.id === activeExerciseId);
    if (exerciseIndex === -1) return undefined;
    const letter = String.fromCharCode(65 + routineIndex); // A, B, C...
    return `${letter}${exerciseIndex + 1}`; // A1, A2, B1...
  }, [workout, currentRoutine, activeExerciseId]);

  if (loading || !workout) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9BDDFF" />
      </View>
    );
  }

  // Throwing-only pulse slots. Mounted into BlockOverview / ExerciseDetailView
  // via their optional headerSlot + footerSlot props. Does NOT touch drill state.
  const isThrowing = workout.category === 'throwing';
  const scheduledDate = workoutInstance?.scheduled_date ?? undefined;
  // Default-hide the Pulse tracker on throwing days that don't have a
  // coach-prescribed workload target — those are usually flat-throwing /
  // recovery days where the gauge would just show "no target / 0.0 W"
  // and clutter the screen. Athlete can still un-hide via the "Show
  // Pulse tracker" row (sets manualShowPulse), and the AsyncStorage
  // pulseTrackerHidden preference still hides it when explicitly set.
  const showPulseTracker =
    isThrowing &&
    !pulseTrackerHidden &&
    (hasWorkloadTarget === null || hasWorkloadTarget === true || manualShowPulse);
  // The workload monitor (gauge + Start Live / Sync controls) pins above
  // the body. The throws feed lives in a separate tab so a long throws
  // log can't push the workout below the fold.
  const throwingHeaderSlot =
    isThrowing && athleteId && orgId ? (
      showPulseTracker ? (
        <ThrowingWorkloadMonitor
          athleteId={athleteId}
          orgId={orgId}
          scheduledDate={scheduledDate}
          onHide={() => {
            savePulseTrackerHidden(true);
            setManualShowPulse(false);
          }}
        />
      ) : (
        <Pressable
          style={loggerStyles.showPulseRow}
          onPress={() => {
            savePulseTrackerHidden(false);
            setManualShowPulse(true);
          }}
          hitSlop={6}
        >
          <Ionicons name="bluetooth-outline" size={14} color="#9BDDFF" />
          <Text style={loggerStyles.showPulseText}>Show Pulse tracker</Text>
        </Pressable>
      )
    ) : null;

  // Throws-tab content. BlockOverview renders a [Workout / Throws]
  // segmented control above the body when this is provided; tapping
  // Throws swaps the exercise list for this feed. Hidden entirely when
  // the Pulse tracker is hidden (athlete doesn't want it).
  const throwingThrowsContent =
    isThrowing && athleteId && showPulseTracker ? (
      <ThrowingThrowsFeed
        athleteId={athleteId}
        scheduledDate={scheduledDate}
      />
    ) : null;

  // Footer slot retired — throws feed lives in the Throws tab.
  const throwingFooterSlot = null;

  // Pulse-sensor chip in the screen header (in line with Back + workout
  // title). Only shows when the user hasn't hidden the tracker.
  const throwingTopRightSlot = showPulseTracker ? <PulseHeaderChip /> : null;

  const body =
    viewMode === 'overview' ? (
      <BlockOverview
        workout={workout}
        customMeasurements={customMeasurements}
        completedSets={completedSets}
        exerciseInputs={exerciseInputs}
        rpeValues={rpeValues}
        athleteMaxes={athleteMaxes}
        moundVelocity={moundVelocity}
        restSecondsLeft={restTimer.secondsLeft}
        timer={timer}
        onExercisePress={handleExercisePress}
        onContinue={handleContinue}
        onCompleteWorkout={handleCompleteWorkout}
        onToggleExerciseComplete={handleToggleExerciseComplete}
        onBack={handleExitWorkout}
        headerSlot={throwingHeaderSlot}
        footerSlot={throwingFooterSlot}
        topRightSlot={throwingTopRightSlot}
        throwsTabContent={throwingThrowsContent}
      />
    ) : viewMode === 'exercise' && currentExercise && currentRoutine ? (
      <ExerciseDetailView
        exercise={currentExercise}
        routine={currentRoutine}
        customMeasurements={customMeasurements}
        athleteMaxes={athleteMaxes}
        moundVelocity={moundVelocity}
        exerciseInputs={exerciseInputs}
        completedSets={completedSets}
        currentSetIndex={currentSetIndexes[currentExercise.id] || 0}
        currentSetIndexes={currentSetIndexes}
        allExercises={allExercises}
        sequence={sequence}
        hasPrev={currentExerciseIndex > 0}
        hasNext={currentExerciseIndex < allExercises.length - 1}
        blockLabel={blockLabel}
        exerciseHistory={exerciseHistory[currentExercise.exercise_id]}
        lastWeekRows={lastWeekRows}
        workoutInstanceId={workoutInstanceId}
        onInputChange={handleInputChange}
        onToggleSetComplete={handleToggleSetComplete}
        rpeValues={rpeValues}
        onRpeChange={handleRpeChange}
        onNextSet={handleNextSet}
        onPrevExercise={handlePrevExercise}
        onNextExercise={handleNextExercise}
        onBackToOverview={handleBackToOverview}
        prAlert={prAlert}
      />
    ) : null;

  const sessionRpeSheet = workout?.ask_session_rpe ? (
    <SessionRpeSheet
      visible={showSessionRpe}
      onSelect={handleSessionRpe}
      onSkip={handleSkipSessionRpe}
      onCancel={handleCancelSessionRpe}
    />
  ) : null;

  // Wrap throwing workouts in the PulseProvider so the Monitor can read BLE
  // state from context and the wizard modal has somewhere to live. Non-throwing
  // workouts don't mount the Monitor, so they skip the provider entirely.
  // Athletes who've hidden the tracker still see the "Show Pulse tracker"
  // chip from the header slot but don't pay BLE/wizard cost — only re-enter
  // the provider tree when they un-hide.
  if (isThrowing && athleteId && orgId && showPulseTracker) {
    return (
      <PulseProvider athleteId={athleteId} orgId={orgId}>
        <PulseLiveBar />
        {body}
        {sessionRpeSheet}
        <PulseWizardModal scheduledDate={scheduledDate} />
        {/* PulseAutoOpener removed — the wizard is no longer forced on
            mount. Athletes open the connect flow explicitly via the
            Monitor's "Connect Pulse" / "Open Pulse" button when they
            actually want to capture throws. */}
      </PulseProvider>
    );
  }

  return (
    <>
      {body}
      {sessionRpeSheet}
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

// AsyncStorage key for the per-athlete "hide Pulse tracker" preference.
function pulseTrackerKey(athleteId: string): string {
  return `pulse_tracker_hidden:${athleteId}`;
}

// Inline styles for the hide/show Pulse-tracker controls.
const loggerStyles = StyleSheet.create({
  showPulseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.18)',
    backgroundColor: 'rgba(155,221,255,0.04)',
  },
  showPulseText: {
    color: '#9BDDFF',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
