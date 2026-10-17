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
import { buildSequence, neighborExercise, nextStep } from '../lib/logger/sequence';
import { normalizeScheme } from '../lib/logger/scheme';
import { nextSetPrefill, prescribedValue } from '../lib/logger/targets';
import { buildLogRow, completeForEdit, upsertSet } from '../lib/logger/saveSet';
import { loggerOutbox } from '../lib/logger/outbox';
import { pendingCompletions } from '../lib/logger/pendingComplete';
import { flushWithCap, syncAll } from '../lib/logger/syncAll';
import SessionRpeSheet from '../components/logger/SessionRpeSheet';
import { prCandidates } from '../lib/logger/pr';
import { restAfter } from '../lib/logger/rest';
import { useRestTimer } from '../hooks/useRestTimer';
import { useRackPhone } from '../hooks/useRackPhone';
import {
  RACK_WRITE_TIMEOUT_MS,
  applyRackLog,
  chipViews,
  contextLoad,
  firstIncompleteSet,
  followTarget,
  fullRepCount,
  liveRackSet,
  loadFromInput,
  loadSyncValue,
  pressDone,
  rackContextOf,
  rackSafeWrite,
  rackSummaryLine,
  speedDropCue,
  followOnFinish,
  phoneRackNow,
  rackFollowToast,
  rackStripLine,
  withRackSet,
  type OpenState,
  type OpenTrack,
  zoneOf,
  type EndedSet,
} from '../lib/rack/phoneView';
import { rackInstanceFromLogger, rackLogsFromCompleted, resolveRackSet } from '../lib/rack/resolveRackSet';
import type { ExerciseRackProps, ExtraRackSet } from './exercise-detail-view';
import type { RackScreenProps } from '../components/logger/RackBanner';

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
  // Rack VBT refs (see the rack block below handleRpeChange).
  const rackWeightEditAtRef = useRef<Record<string, number>>({});
  // Weight cells holding a logged value (`reId:setIndex`) — sent to the rack as the athlete's LB.
  const rackLoggedWeightRef = useRef<Record<string, true>>({});
  // Set the rack owns (being lifted, or ended and its row not landed yet):
  // the phone never writes is_complete / reps for it (rackSafeWrite).
  const rackOwnsSetRef = useRef<(reId: string, setIndex: number) => boolean>(() => false);
  // Rack VBT: extra sets the rack wrote past the prescription (reId → set_number → log row).
  const [rackExtra, setRackExtra] = useState<Record<string, Record<number, Record<string, any>>>>({});
  // Rack VBT: where Next goes once the open exercise is finished (set later, with the rack hook).
  const rackNextAfterRef = useRef<(reId: string, setIndex: number) => { reId: string; setNumber: number } | null>(() => null);
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
      const extraMap: Record<string, Record<number, Record<string, any>>> = {};

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
            if (log.actual_weight != null) rackLoggedWeightRef.current[`${ex.id}:${setIndex}`] = true;

            // Done only if is_complete — drafts resume not-done with values.
            completedArray[setIndex] = isSetDoneFromLog(log);
          } else if (setIndex >= ex.sets && log.metric_data?.vbt?.source === 'rack') {
            // An extra set the rack logged past the prescription (shown read-only).
            (extraMap[ex.id] ??= {})[log.set_number] = log;
          }
        });

        inputsMap[ex.id] = setsData;
        completedMap[ex.id] = completedArray;
      });

      inputsRef.current = inputsMap;
      completedRef.current = completedMap;
      setExerciseInputs(inputsMap);
      setCompletedSets(completedMap);
      setRackExtra(extraMap);

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
  // Drives the "Saving…" state on the finish buttons.
  const [finishing, setFinishing] = useState(false);
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

  // Flush the set outbox (at most FINISH_FLUSH_CAP_MS), then mark the
  // workout complete. Never blocks on a bad network: if this workout's sets
  // are still queued after the cap, the completion is queued too and syncAll
  // replays it after the sets (sets-before-completion ordering). An offline
  // completion is queued the same way (lib/logger/pendingComplete.ts).
  const finalizeWorkout = async (sessionRpe?: number) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    try {
      const inTime = await flushWithCap(() => loggerOutbox.flush({ foreground: true }));
      if (!inTime) console.warn('[WorkoutLogger] set flush still running at finish — completing behind it');
      const setsQueued = (await loggerOutbox.pending().catch(() => []))
        .some(r => r.workout_instance_id === workoutInstanceId);
      const intent = {
        workoutInstanceId,
        completedAt: new Date().toISOString(),
        ...(sessionRpe != null ? { sessionRpe } : {}),
      };
      const outcome = setsQueued
        ? await pendingCompletions.queue(intent)
        : await pendingCompletions.complete(intent);
      if (setsQueued) void syncAll();
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
          ? 'Saved on this device. It will finish syncing automatically.'
          : 'Great job! Your workout has been saved.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } finally {
      finishingRef.current = false;
      setFinishing(false);
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
    requested: { complete?: boolean; fields?: string[]; rpe?: boolean },
  ): Promise<boolean> => {
    // Rack VBT: a set the rack owns never gets is_complete / reps from the phone.
    const write = rackSafeWrite(requested, rackOwnsSetRef.current(exerciseId, setIndex));
    if (write.complete === undefined && !write.rpe && (write.fields ?? []).length === 0) return true;
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
      // Sets this logs get their PR check (on whatever values they hold).
      if (newStatus && !currentSets[setIndex]) checkPRsRef.current(exerciseId, setIndex);
      const fields = cancelDraft(exerciseId, setIndex);
      await persistSet(exerciseId, setIndex, { complete: newStatus, fields });
    }
  };

  // Helper to get max value from athleteMaxes. Reads a ref so a PR check
  // started from a memoized callback compares against the latest maxes.
  const athleteMaxesRef = useRef(athleteMaxes);
  athleteMaxesRef.current = athleteMaxes;
  const getMaxValue = (exerciseId: string, metricId: string): number | null => {
    return athleteMaxesRef.current[exerciseId]?.[metricId] ?? null;
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
    // Rack VBT: a typed LB edit wins over the rack's load for 3 s (load sync).
    if (field === 'weight' && !_isAutoFill) rackWeightEditAtRef.current[timerKey] = Date.now();
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

    // PRs are not checked on edits — only when the set is logged (below).
  }, [activeExerciseId, allExercises, persistSet]);

  // PR check once per logged set (Done / circle), on the set's final values
  // incl. auto-fill — never per edit, so stepping 300 → 310 → 300 can't save
  // a phantom 310. Called through a ref so memoized callbacks get the latest.
  const checkPRsForSet = (routineExerciseId: string, setIndex: number) => {
    const re = allExercises.find(ex => ex.id === routineExerciseId);
    const setData = inputsRef.current[routineExerciseId]?.[setIndex] || {};
    prCandidates(re?.tracked_max_metrics, setData).forEach(({ metric, value, reps }) => {
      checkAndSavePR(routineExerciseId, metric, value, reps);
    });
  };
  const checkPRsRef = useRef(checkPRsForSet);
  checkPRsRef.current = checkPRsForSet;

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
    if (!wasDone) checkPRsRef.current(activeExerciseId, currentSetIndex);
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
      const following = neighborExercise(allExercises, activeExerciseId, 1);
      if (following) {
        setActiveExerciseId(following.id);
      } else {
        goToOverview();
      }
      return;
    }

    const done = completedRef.current;
    // On a rack: once this exercise is finished, go where the rack goes (the
    // same resolver as the iPad) — never the logger's own next exercise.
    const rackNext = rackNextAfterRef.current(activeExerciseId, currentSetIndex);
    if (rackNext && rackNext.reId !== activeExerciseId) {
      setCurrentSetIndexes(prev => ({ ...prev, [rackNext.reId]: rackNext.setNumber - 1 }));
      setActiveExerciseId(rackNext.reId);
      return;
    }
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
    setRackFocus(null);
    setActiveExerciseId(exerciseId);
    setViewMode('exercise');
  };

  // Overview Continue: open nextStep's exercise on nextStep's set, so a
  // superset A1 → A2 → A1 lands on the right round.
  const handleContinue = (exerciseId: string, setIndex: number) => {
    setRackFocus(null);
    setCurrentSetIndexes(prev => ({ ...prev, [exerciseId]: setIndex }));
    setActiveExerciseId(exerciseId);
    setViewMode('exercise');
  };

  // Tapping a set row on the exercise screen makes it THE current set (one
  // open set at a time; the Done button then logs that set).
  const handleSelectSet = useCallback((setIndex: number) => {
    if (!activeExerciseId) return;
    setCurrentSetIndexes(prev => ({ ...prev, [activeExerciseId]: setIndex }));
  }, [activeExerciseId]);

  const handleBackToOverview = () => {
    setViewMode('overview');
    setActiveExerciseId(null);
  };

  // Prev / next / swipe skip text blocks (no joined exercise) — the
  // exercise screen can't render them (lib/logger/sequence neighborExercise).
  const handlePrevExercise = () => {
    const prev = neighborExercise(allExercises, activeExerciseId, -1);
    if (prev) setActiveExerciseId(prev.id);
  };

  const handleNextExercise = () => {
    const following = neighborExercise(allExercises, activeExerciseId, 1);
    if (following) setActiveExerciseId(following.id);
  };

  // Toggle set completion (for clicking checkboxes)
  // When checking a set, autoFillValues contains placeholder values to fill in empty fields
  const handleToggleSetComplete = useCallback((setIndex: number, autoFillValues?: Record<string, any>) => {
    if (!activeExerciseId) return;
    const exercise = allExercises.find(ex => ex.id === activeExerciseId);
    if (!exercise) return;

    const inFlightKey = `${activeExerciseId}:${setIndex}`;
    if (completionInFlightRef.current.has(inFlightKey)) return;
    // Rack VBT: a set the rack owns (being lifted, or its row not landed) is
    // never checked or un-checked from the phone — the rack's row decides.
    if (rackOwnsSetRef.current(activeExerciseId, setIndex)) return;

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
    if (!currentlyCompleted) checkPRsRef.current(activeExerciseId, setIndex);

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


  // ── Rack VBT (phone side). Self-only (the hook checks athletes.user_id =
  // auth.uid()) and inert unless the org has an active rack. rack_sessions +
  // exercise_logs are the one shared record: the phone sends its open
  // exercise / set / LB, follows the rack's exercise + load, and fills a set
  // in from the row the rack writes (never writing vbt, reps or is_complete
  // for a set the rack owns).
  const [rackSaving, setRackSaving] = useState<Record<string, 'saving' | 'timeout'>>({});
  const rackSavingRef = useRef<Record<string, 'saving' | 'timeout'>>({});
  const [rackIdleSaved, setRackIdleSaved] = useState<Record<string, true>>({});
  const [rackFocus, setRackFocus] = useState<{ reId: string; setIndex: number } | null>(null);
  const [rackToast, setRackToast] = useState<string | null>(null);
  const [rackRefreshing, setRackRefreshing] = useState(false);
  const rackEditingRef = useRef(false);
  const rackPendingFollowRef = useRef<string | null>(null);
  // Pending rack writes: key `reId:setIndex` → { setNumber, started }.
  const rackPendingRef = useRef<Record<string, { setNumber: number; started: number }>>({});
  const rackFastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rackSeenRef = useRef<{ exercise: string | null | undefined; load: number | null | undefined }>({
    exercise: undefined,
    load: undefined,
  });
  const rackToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rackOnSetEndedRef = useRef<(e: EndedSet) => void>(() => undefined);
  const rackOnTickRef = useRef<() => void>(() => undefined);

  const rack = useRackPhone({
    athleteId,
    onSetEnded: e => rackOnSetEndedRef.current(e),
    onTick: () => rackOnTickRef.current(),
  });
  const rackActive = rack.hasRacks && !!rack.activeSession;
  const rackLive = rack.hasRacks ? liveRackSet(rack.activeSession, athleteId, workoutInstanceId) : null;

  const setRackSavingState = (update: (prev: Record<string, 'saving' | 'timeout'>) => Record<string, 'saving' | 'timeout'>) => {
    const next = update(rackSavingRef.current);
    if (next === rackSavingRef.current) return;
    rackSavingRef.current = next;
    setRackSaving(next);
  };
  rackOwnsSetRef.current = (reId, setIndex) =>
    !!rackSavingRef.current[`${reId}:${setIndex}`] ||
    (!!rackLive && rackLive.routineExerciseId === reId && rackLive.setNumber === setIndex + 1);

  const showRackToast = useCallback((text: string) => {
    if (rackToastTimerRef.current) clearTimeout(rackToastTimerRef.current);
    setRackToast(text);
    rackToastTimerRef.current = setTimeout(() => setRackToast(null), 3000);
  }, []);

  // A rack-written row landed: fill the set in, check it off, open the next set.
  const applyRackWrittenLog = useCallback((log: Record<string, any>) => {
    const reId = log.routine_exercise_id as string;
    const ex = allExercises.find(e => e.id === reId);
    if (!ex) return;
    const n = Number(log.set_number);
    if (Number.isInteger(n) && n > (ex.sets ?? 1)) {
      // An extra set past the prescription: its own read-only row.
      const key = `${reId}:${n - 1}`;
      delete rackPendingRef.current[key];
      setRackSavingState(prev => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setRackExtra(prev => ({ ...prev, [reId]: { ...(prev[reId] ?? {}), [n]: log } }));
      return;
    }
    const res = applyRackLog({
      inputs: inputsRef.current[reId],
      completed: completedRef.current[reId],
      sets: ex.sets,
      log,
      toInputs: logToSetInputs,
    });
    if (!res) return;
    const key = `${reId}:${res.setIndex}`;
    delete rackPendingRef.current[key];
    setRackSavingState(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    // The rack's row is the truth for this set: drop any pending phone draft
    // (e.g. a prefilled reps value) so it can't overwrite the rack's reps.
    cancelDraft(reId, res.setIndex);
    if (log.actual_weight != null) rackLoggedWeightRef.current[key] = true;
    commitInputs({ ...inputsRef.current, [reId]: res.inputs });
    commitCompleted(reId, () => res.completed, ex.sets);
    if (res.idle) setRackIdleSaved(prev => ({ ...prev, [key]: true }));
    if (log.is_complete === true && !res.wasDone) {
      checkPRsRef.current(reId, res.setIndex);
      startRestAfter(reId, res.setIndex);
      // The next set opens (only moves forward from the set just written).
      if (res.nextIndex != null && res.nextIndex > res.setIndex) {
        const nextIndex = res.nextIndex;
        setCurrentSetIndexes(prev =>
          (prev[reId] ?? 0) <= res.setIndex ? { ...prev, [reId]: nextIndex } : prev,
        );
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- commit* read refs
  }, [allExercises, startRestAfter]);

  // Re-read every pending rack write once; past 10 s the copy switches to
  // "pull to refresh" but the 10 s tick keeps re-reading until the row lands.
  const readPendingRackWrites = useCallback(async () => {
    const entries = Object.entries(rackPendingRef.current);
    for (const [key, p] of entries) {
      const reId = key.split(':')[0];
      try {
        const { data } = await supabase
          .from('exercise_logs')
          .select('*')
          .eq('workout_instance_id', workoutInstanceId)
          .eq('routine_exercise_id', reId)
          .eq('set_number', p.setNumber)
          .maybeSingle();
        if (!(key in rackPendingRef.current)) continue;
        if (data && (data as any).is_complete === true) {
          applyRackWrittenLog(data as Record<string, any>);
          continue;
        }
      } catch (e) {
        console.warn('[rack phone] set read failed', e);
      }
      if (key in rackPendingRef.current && Date.now() - p.started >= RACK_WRITE_TIMEOUT_MS) {
        setRackSavingState(prev => (prev[key] === 'saving' ? { ...prev, [key]: 'timeout' } : prev));
      }
    }
  }, [workoutInstanceId, applyRackWrittenLog]);

  // Wait for the rack's write of one set (phone Done, or any set that stopped
  // being lifted): the set is rack-owned ("Saving…") until its row lands.
  // Fast re-reads (1 s) for the first 10 s, then the 10 s tick.
  const awaitRackWrite = useCallback((reId: string, setNumber: number) => {
    const key = `${reId}:${setNumber - 1}`;
    if (!rackPendingRef.current[key]) rackPendingRef.current[key] = { setNumber, started: Date.now() };
    setRackSavingState(prev => (prev[key] === 'saving' ? prev : { ...prev, [key]: 'saving' }));
    const fast = () => {
      rackFastTimerRef.current = null;
      const live = Object.values(rackPendingRef.current).some(p => Date.now() - p.started < RACK_WRITE_TIMEOUT_MS + 1000);
      void readPendingRackWrites().finally(() => {
        if (live && Object.keys(rackPendingRef.current).length > 0 && !rackFastTimerRef.current) {
          rackFastTimerRef.current = setTimeout(fast, 1000);
        }
      });
    };
    if (!rackFastTimerRef.current) rackFastTimerRef.current = setTimeout(fast, 600);
  }, [readPendingRackWrites]);

  rackOnTickRef.current = () => {
    if (Object.keys(rackPendingRef.current).length > 0) void readPendingRackWrites();
  };

  // N3: left the rack or bumped off it — one more read of the rack's pending
  // rows now and after RACK_WRITE_TIMEOUT_MS, then the phone owns those sets
  // again (manual logging works). Back on the rack first → nothing is released.
  const rackWasActiveRef = useRef(false);
  useEffect(() => {
    if (rackActive) {
      rackWasActiveRef.current = true;
      return;
    }
    if (!rackWasActiveRef.current) return;
    rackWasActiveRef.current = false;
    void readPendingRackWrites();
    const release = setTimeout(() => {
      void readPendingRackWrites().finally(() => {
        if (rackWasActiveRef.current) return; // active again
        rackPendingRef.current = {};
        setRackSavingState(prev => (Object.keys(prev).length ? {} : prev));
      });
    }, RACK_WRITE_TIMEOUT_MS);
    return () => clearTimeout(release);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackActive]);

  // Real pull-to-refresh: my rack state + every pending set row.
  const handleRackPullRefresh = useCallback(async () => {
    setRackRefreshing(true);
    try {
      await Promise.all([rack.refresh(), readPendingRackWrites()]);
    } finally {
      setRackRefreshing(false);
    }
  }, [rack.refresh, readPendingRackWrites]);

  useEffect(() => () => {
    if (rackFastTimerRef.current) clearTimeout(rackFastTimerRef.current);
    if (rackToastTimerRef.current) clearTimeout(rackToastTimerRef.current);
  }, []);

  // A set this athlete was lifting stopped (phone Done, iPad Done, 60 s idle,
  // switch, leave): it is rack-owned until the rack's row lands.
  rackOnSetEndedRef.current = (e: EndedSet) => {
    if (e.workoutInstanceId && e.workoutInstanceId !== workoutInstanceId) return;
    if (!e.routineExerciseId || e.setNumber == null) return;
    // Extra sets past the prescription are awaited too (shown as their own row).
    if (!allExercises.some(x => x.id === e.routineExerciseId)) return;
    awaitRackWrite(e.routineExerciseId, e.setNumber);
  };

  // Phone → rack: open exercise, current set and the athlete's own LB (typed /
  // stepped / logged — never the prescription), debounced 300 ms (immediate
  // when the set advances); only while active and on the exercise screen. A
  // finished exercise sends {instance, exercise, set: prescribed + 1} — "done
  // through N" — so the iPad moves on (phone instance first) and never takes
  // a hand-saved last set. The current set comes from resolveRackSet — the
  // same function, over the same logs, that the iPad runs — with the open
  // exercise as the phone context, so the two can't disagree.
  const rackInstance = useMemo(
    () => (rack.hasRacks && workout ? rackInstanceFromLogger(workoutInstanceId, workout.routines) : null),
    [rack.hasRacks, workout, workoutInstanceId],
  );
  const rackLogs = useMemo(() => {
    const logs = rackLogsFromCompleted(workoutInstanceId, completedSets);
    for (const [re, byNo] of Object.entries(rackExtra)) {
      for (const no of Object.keys(byNo)) logs.push({ workoutInstanceId, routineExerciseId: re, setNumber: Number(no), isComplete: true });
    }
    return logs;
  }, [workoutInstanceId, completedSets, rackExtra]);
  const ctxExercise = viewMode === 'exercise' ? allExercises.find(ex => ex.id === activeExerciseId) : undefined;
  const phoneRackSet =
    rackInstance && ctxExercise
      ? resolveRackSet({ instances: [rackInstance], logs: rackLogs, phone: { workoutInstanceId, routineExerciseId: ctxExercise.id } })
      : null;
  // The resolver's set when it serves the open exercise; otherwise (a superset
  // partner, a row the iPad doesn't serve) the open exercise's own first
  // incomplete set — the same rule — so the row still says what's open.
  const ctxSetIndex = ctxExercise
    ? phoneRackSet && !phoneRackSet.none && phoneRackSet.routineExerciseId === ctxExercise.id
      ? phoneRackSet.setNumber - 1
      : firstIncompleteSet(completedSets[ctxExercise.id], ctxExercise.sets ?? 1)
    : null;
  // The iPad's auto-pick for this phone's state (no phone context): a null→X
  // to exactly this is not a coach override (followTarget, N4).
  const rackAutoPick = useMemo(() => {
    if (!rackInstance) return null;
    const r = resolveRackSet({ instances: [rackInstance], logs: rackLogs });
    return r.none ? null : r.routineExerciseId;
  }, [rackInstance, rackLogs]);
  const ctxKey = ctxExercise && ctxSetIndex != null ? `${ctxExercise.id}:${ctxSetIndex}` : null;
  const ctxOwnWeight =
    ctxExercise && ctxSetIndex != null && ctxKey &&
    (rackWeightEditAtRef.current[ctxKey] != null || rackLoggedWeightRef.current[ctxKey])
      ? exerciseInputs[ctxExercise.id]?.[ctxSetIndex]?.weight ?? null
      : null;
  const ctxLoad =
    ctxExercise && ctxSetIndex != null
      ? contextLoad({
          ownWeight: ctxOwnWeight,
          rack: rackContextOf(rack.activeSession),
          routineExerciseId: ctxExercise.id,
          setNumber: ctxSetIndex + 1,
        })
      : null;
  const rackActivation = rack.activation;
  const rackActivationSentRef = useRef(0);
  const rackLastCtxRef = useRef<{ reId: string; setIndex: number | null } | null>(null);
  useEffect(() => {
    if (!rackActive) {
      rack.setContext(null);
      rackLastCtxRef.current = null;
      return;
    }
    if (!ctxExercise || !ctxExercise.exercise_id) {
      rack.setContext(null); // overview / text block: send nothing
      rackLastCtxRef.current = null;
      return;
    }
    // I3: on becoming active the phone's open exercise wins — send at once.
    // N1: so does a set advancing on the open exercise (manual Done, or the
    // rack's row landing) — the iPad must never start the set just saved.
    const prev = rackLastCtxRef.current;
    const advanced = !!prev && prev.reId === ctxExercise.id && prev.setIndex !== ctxSetIndex;
    rackLastCtxRef.current = { reId: ctxExercise.id, setIndex: ctxSetIndex };
    const immediate = rackActivationSentRef.current !== rackActivation || advanced;
    rackActivationSentRef.current = rackActivation;
    rack.setContext(
      ctxSetIndex == null
        ? // I4: finished — "done through N" (set N+1), never an empty context.
          { workoutInstanceId, routineExerciseId: ctxExercise.id, setNumber: (ctxExercise.sets ?? 1) + 1, loadLb: null }
        : { workoutInstanceId, routineExerciseId: ctxExercise.id, setNumber: ctxSetIndex + 1, loadLb: ctxLoad },
      { immediate },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackActive, rackActivation, ctxExercise?.id, ctxSetIndex, ctxLoad, workoutInstanceId, rack.setContext]);

  // The rack's current set on the phone — the same resolver, data and wording
  // as the iPad's athlete card. Drives the banner strip (both screens), the
  // overview's Continue, the Next CTA once an exercise is finished, and the
  // follow when the open exercise finishes.
  const rackNow = rackActive
    ? phoneRackNow({
        instance: rackInstance,
        logs: rackLogs,
        session: rack.activeSession,
        athleteId,
        workoutInstanceId,
        openExerciseId: viewMode === 'exercise' ? activeExerciseId : null,
        isEcho: rack.isEcho,
      })
    : null;
  const rackNowEx = rackNow ? allExercises.find(x => x.id === rackNow.routineExerciseId) : undefined;
  const rackNowName = rackNowEx ? rackNowEx.exercises?.name ?? rackNowEx.placeholder_name ?? 'Exercise' : null;
  const rackSetStrip =
    rackNow && rackNowName ? rackStripLine(rack.activeRackName, rackNowName, rackNow.setNumber, rackNowEx?.sets ?? null) : null;

  /** Does the open exercise's grouped block still have sets (the athlete does the partner next)? */
  const blockHasMore = (reId: string, done: Record<string, boolean[]>) => {
    const routine = workout?.routines.find(r => r.routine_exercises.some(x => x.id === reId));
    if (!routine || normalizeScheme(routine.scheme) !== 'grouped') return false;
    return routine.routine_exercises.some(
      x => x.id !== reId && !x.notes_only && (x.sets ?? 0) > 0 && firstIncompleteSet(done[x.id], x.sets) != null,
    );
  };

  // Next CTA: once the set at setIndex is done and this exercise is finished
  // (and its block has nothing left), where the rack goes.
  rackNextAfterRef.current = (reId, setIndex) => {
    if (!rackActive || !rackInstance) return null;
    const ex = allExercises.find(x => x.id === reId);
    if (!ex) return null;
    const flags = [...(completedRef.current[reId] ?? Array(ex.sets).fill(false))];
    flags[setIndex] = true;
    if (firstIncompleteSet(flags, ex.sets ?? 1) != null) return null;
    const done = { ...completedRef.current, [reId]: flags };
    if (blockHasMore(reId, done)) return null;
    const now = phoneRackNow({
      instance: rackInstance,
      logs: rackLogsFromCompleted(workoutInstanceId, done),
      session: rack.activeSession,
      athleteId,
      workoutInstanceId,
      openExerciseId: reId,
      isEcho: rack.isEcho,
    });
    return now && now.routineExerciseId !== reId ? { reId: now.routineExerciseId, setNumber: now.setNumber } : null;
  };
  const rackNextAfter = (setIndex: number) => {
    if (!activeExerciseId) return null;
    const r = rackNextAfterRef.current(activeExerciseId, setIndex);
    const ex = r ? allExercises.find(x => x.id === r.reId) : undefined;
    return r && ex ? { reId: r.reId, name: ex.exercises?.name ?? ex.placeholder_name ?? 'Exercise' } : null;
  };

  // Follow on finish: the open exercise just finished while active → go where
  // the rack is (exercise screen) with a toast; the overview's Continue points there.
  const rackOpenPrevRef = useRef<OpenTrack | null>(null);
  const rackOpenId = viewMode === 'exercise' ? activeExerciseId : null;
  const rackOpenEx = rackOpenId ? allExercises.find(x => x.id === rackOpenId) : undefined;
  const rackOpenFinished = !!rackOpenEx && firstIncompleteSet(completedSets[rackOpenEx.id], rackOpenEx.sets ?? 1) == null;
  useEffect(() => {
    const cur: OpenState = { openId: rackOpenId, finished: rackOpenFinished, active: rackActive };
    // N2: only a finish DURING this open of an exercise opened unfinished.
    const { track, follow: target } = followOnFinish({
      ...cur,
      prev: rackOpenPrevRef.current,
      rackNow,
      blockHasMore: !!rackOpenId && blockHasMore(rackOpenId, completedRef.current),
    });
    rackOpenPrevRef.current = track;
    if (!target || !rackNow || rackEditingRef.current) return;
    const ex = allExercises.find(x => x.id === target);
    if (!ex) return;
    setCurrentSetIndexes(prev => ({ ...prev, [target]: rackNow.setNumber - 1 }));
    setActiveExerciseId(target);
    showRackToast(rackFollowToast(rack.activeRackName, ex.exercises?.name ?? ex.placeholder_name ?? 'the next exercise', rackNow.setNumber));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackOpenId, rackOpenFinished, rackActive, rackNow?.routineExerciseId, rackNow?.setNumber]);

  // Rack → phone: follow the rack's exercise (coach override on the iPad).
  const followRackExercise = useCallback((reId: string) => {
    const ex = allExercises.find(x => x.id === reId);
    if (!ex) return;
    const ctx = rackContextOf(rack.activeSession);
    const done = completedRef.current[reId];
    const sNo = ctx.routineExerciseId === reId && ctx.setNumber != null ? ctx.setNumber - 1 : null;
    const setIndex =
      sNo != null && sNo >= 0 && sNo < ex.sets && done?.[sNo] !== true
        ? sNo
        : firstIncompleteSet(done, ex.sets) ?? 0;
    if (viewMode === 'exercise') {
      setCurrentSetIndexes(prev => ({ ...prev, [reId]: setIndex }));
      setActiveExerciseId(reId);
      setRackFocus(null);
    } else {
      setRackFocus({ reId, setIndex });
    }
  }, [allExercises, rack.activeSession, viewMode]);

  const rackExerciseName = (reId: string) => {
    const ex = allExercises.find(x => x.id === reId);
    return ex?.exercises?.name ?? ex?.placeholder_name ?? 'the next exercise';
  };

  // A new activation: the first read is the baseline, not an override (I3).
  useEffect(() => {
    rackSeenRef.current = { exercise: undefined, load: undefined };
  }, [rackActivation]);

  useEffect(() => {
    if (!rack.hasRacks) return;
    const s = rack.activeSession;
    if (!s) {
      rackSeenRef.current = { exercise: undefined, load: undefined };
      setRackFocus(null);
      return;
    }
    const now = Date.now();
    const ctx = rackContextOf(s);
    const target = followTarget({
      session: s,
      prevRackExercise: rackSeenRef.current.exercise,
      sentThisActivation: rack.sentThisActivation(),
      athleteId,
      workoutInstanceId,
      openExerciseId: viewMode === 'exercise' ? activeExerciseId : null,
      isEcho: rack.isEcho,
      autoPickExerciseId: rackAutoPick,
      isFinishedOnPhone: reId => {
        const ex = allExercises.find(x => x.id === reId);
        return !!ex && firstIncompleteSet(completedRef.current[reId], ex.sets ?? 1) == null;
      },
    });
    // Load: the rack's LB → the phone's LB cell for the SAME (exercise, set) the
    // rack is set up for (pending group mid-set → the next set's row).
    if (ctx.routineExerciseId && (!ctx.workoutInstanceId || ctx.workoutInstanceId === workoutInstanceId)) {
      const reId = ctx.routineExerciseId;
      const ex = allExercises.find(x => x.id === reId);
      const idx = ex ? (ctx.setNumber != null ? ctx.setNumber - 1 : firstIncompleteSet(completedRef.current[reId], ex.sets)) : null;
      if (ex && idx != null && idx >= 0 && idx < ex.sets && completedRef.current[reId]?.[idx] !== true) {
        const v = loadSyncValue({
          rackLoad: ctx.loadLb,
          prevRackLoad: rackSeenRef.current.load,
          phoneLoad: loadFromInput(inputsRef.current[reId]?.[idx]?.weight),
          lastEditAt: rackWeightEditAtRef.current[`${reId}:${idx}`] ?? 0,
          now,
          editing: rackEditingRef.current,
        });
        if (v != null) {
          const data = [...(inputsRef.current[reId] || [])];
          while (data.length <= idx) data.push({});
          data[idx] = { ...data[idx], weight: String(v) };
          commitInputs({ ...inputsRef.current, [reId]: data });
        }
      }
    }
    rackSeenRef.current = { exercise: ctx.routineExerciseId, load: ctx.loadLb };
    if (!target) return;
    showRackToast(`${rack.activeRackName ?? 'The rack'} switched you to ${rackExerciseName(target)}`);
    if (rackEditingRef.current) {
      rackPendingFollowRef.current = target; // never while typing — after blur
      return;
    }
    followRackExercise(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rack.activeSession]);

  // Keypad open/closed on the exercise screen; a deferred follow runs on blur.
  const handleRackEditingChange = useCallback((editing: boolean) => {
    rackEditingRef.current = editing;
    if (editing) return;
    const target = rackPendingFollowRef.current;
    rackPendingFollowRef.current = null;
    if (!target) return;
    if (rackContextOf(rack.activeSession).routineExerciseId === target) followRackExercise(target);
  }, [rack.activeSession, followRackExercise]);

  // The exercise screen unmounts with its keypad: not typing any more.
  useEffect(() => {
    if (viewMode !== 'exercise') handleRackEditingChange(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

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

  // Rack VBT props for the two screens (null-safe: no racks → nothing renders).
  const rackScreen: RackScreenProps = {
    hasRacks: rack.hasRacks,
    banner: withRackSet(rack.banner, rackSetStrip),
    error: rack.error,
    busy: rack.busy,
    onJoin: rack.join,
    onImUp: rack.imUp,
    onLeave: rack.leave,
  };
  /** Extra rack sets (past the prescription) of one exercise: landed, saving or live. */
  const extraRackSets = (reId: string, sets: number): ExtraRackSet[] => {
    const nos = new Set<number>(Object.keys(rackExtra[reId] ?? {}).map(Number));
    Object.keys(rackSaving).forEach(k => {
      const [re, idx] = k.split(':');
      if (re === reId && Number(idx) + 1 > sets) nos.add(Number(idx) + 1);
    });
    if (rackLive && rackLive.routineExerciseId === reId && rackLive.setNumber > sets) nos.add(rackLive.setNumber);
    return [...nos].sort((a, b) => a - b).map(n => {
      const log = rackExtra[reId]?.[n];
      const vbt = log?.metric_data?.vbt;
      const line = rackSummaryLine(vbt);
      const reps = log?.actual_reps;
      const lb = log?.actual_weight;
      return {
        setNumber: n,
        values: log ? [reps != null ? `${reps} reps` : null, lb != null ? `${lb} lb` : null].filter(Boolean).join(' × ') || null : null,
        rackLine: line ? `RACK · ${line}` : null,
        live: !!rackLive && rackLive.routineExerciseId === reId && rackLive.setNumber === n,
        saving: rackSaving[`${reId}:${n - 1}`] ?? null,
      };
    });
  };
  const rackExerciseProps: ExerciseRackProps | null = (() => {
    if (!rack.hasRacks || !currentExercise) return null;
    const reId = currentExercise.id;
    const s = rack.activeSession;
    // I1: the live set comes from rack_sessions (exercise + set_number), never
    // the phone's open row.
    let live: ExerciseRackProps['live'] = null;
    if (s && rackLive && rackLive.routineExerciseId === reId) {
      const chips = rack.chipsFor(workoutInstanceId, reId, rackLive.setNumber);
      const zone = zoneOf(currentExercise.velocity_min_mps, currentExercise.velocity_max_mps);
      const target = prescribedValue(currentExercise, rackLive.setNumber - 1, 'reps');
      live = {
        setIndex: rackLive.setNumber - 1,
        source: 'rack',
        rackName: rack.activeRackName,
        chips: chipViews(chips, zone),
        fullReps: fullRepCount(chips),
        repsTarget: typeof target === 'number' ? target : null,
        lifting: true,
        dropCue: speedDropCue(chips, zone, currentExercise.speed_drop_stop_pct),
      };
    }
    const saving: Record<number, 'saving' | 'timeout'> = {};
    Object.entries(rackSaving).forEach(([k, v]) => {
      const [re, idx] = k.split(':');
      if (re === reId) saving[Number(idx)] = v;
    });
    const idleSaved = Object.keys(rackIdleSaved)
      .filter(k => k.startsWith(`${reId}:`))
      .map(k => Number(k.split(':')[1]));
    return {
      ...rackScreen,
      live,
      saving,
      idleSaved,
      extraSets: extraRackSets(reId, currentExercise.sets ?? 1),
      rackNextAfter,
      refreshing: rackRefreshing,
      onPullRefresh: handleRackPullRefresh,
      onEditingChange: handleRackEditingChange,
      onLiveDone: () => {
        if (!s || !rackLive) return;
        const liveRe = rackLive.routineExerciseId;
        const liveNo = rackLive.setNumber;
        // Done while live: the rack ends the set and writes the row; the phone
        // waits for it (no local save of reps / is_complete / metric_data.vbt).
        pressDone(
          { rackId: s.rack_id, lifting: true },
          {
            requestEndSet: rack.requestEndSet,
            awaitRackWrite: () => awaitRackWrite(liveRe, liveNo),
            saveSet: () => undefined,
          },
        );
      },
    };
  })();

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
        finishing={finishing}
        onToggleExerciseComplete={handleToggleExerciseComplete}
        onBack={handleExitWorkout}
        headerSlot={throwingHeaderSlot}
        footerSlot={throwingFooterSlot}
        topRightSlot={throwingTopRightSlot}
        throwsTabContent={throwingThrowsContent}
        rack={rackScreen}
        rackFocus={rack.hasRacks ? (rackNow ? { reId: rackNow.routineExerciseId, setIndex: rackNow.setNumber - 1 } : rackFocus) : null}
        rackRefreshing={rackRefreshing}
        onRackRefresh={handleRackPullRefresh}
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
        allExercises={allExercises}
        sequence={sequence}
        hasPrev={neighborExercise(allExercises, currentExercise.id, -1) != null}
        hasNext={neighborExercise(allExercises, currentExercise.id, 1) != null}
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
        onSelectSet={handleSelectSet}
        restSecondsLeft={restTimer.secondsLeft}
        rack={rackExerciseProps}
      />
    ) : null;

  const rackToastView = rackToast ? (
    <View pointerEvents="none" style={styles.rackToast}>
      <Text style={styles.rackToastText} numberOfLines={2}>{rackToast}</Text>
    </View>
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
        {rackToastView}
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
      {rackToastView}
      {sessionRpeSheet}
    </>
  );
}

const styles = StyleSheet.create({
  rackToast: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.3)',
    backgroundColor: '#101113',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  rackToastText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
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
