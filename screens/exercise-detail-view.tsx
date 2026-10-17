import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { lastSession, deltaText, type LogRow } from '../lib/logger/lastWeek';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Animated,
  Linking,
  PanResponder,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import NumericKeypad from '../components/NumericKeypad';
import { backoffUpdates, fieldKey, intensityFor, prescribedValue, resolveTarget, type IntensityResult } from '../lib/logger/targets';
import { parseInstructionBlock } from '../lib/instructionBlockParser';
import { getSupersetContext } from '../lib/supersetContext';

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
import { nextStep, type SeqStep } from '../lib/logger/sequence';
import RpeRow from '../components/logger/RpeRow';
import FloatingVideoButton from '../components/logger/FloatingVideoButton';
import FloatingVideoWindow from '../components/logger/FloatingVideoWindow';
import VideoModal from '../components/logger/VideoModal';
import { hasVideo, youTubeId } from '../lib/video';
import { LOGGER_COLORS } from '../lib/logger/theme';
import {
  ballWeightOrder,
  formatSetMetrics as formatSetLine,
  formatWeightReps,
  getMeasurementName,
  getMetricLabel,
  isBallMetric,
  metricFieldsFor,
} from '../lib/logger/setLine';
interface PRAlert {
  metric: string;
  value: number;
}

interface ExerciseHistorySet {
  set_number: number;
  reps?: number;
  weight?: number;
  time_seconds?: number;
  distance?: number;
  [key: string]: any;
}

interface ExerciseHistory {
  id: string;
  date: string;
  sets: ExerciseHistorySet[];
}

interface ExerciseDetailViewProps {
  exercise: RoutineExercise;
  routine: Routine;
  customMeasurements: Measurement[];
  // athleteMaxes keyed by exercise_id -> metric_id -> value
  athleteMaxes: Record<string, Record<string, number>>;
  // Global mound velocity (5oz baseball PR) for throwing velocity fallback
  moundVelocity?: number | null;
  exerciseInputs: Record<string, any[]>;
  completedSets: Record<string, boolean[]>;
  currentSetIndex: number;
  currentSetIndexes: Record<string, number>;
  allExercises: RoutineExercise[];
  // Whole-workout set order from buildSequence (lib/logger/sequence.ts)
  sequence: SeqStep[];
  hasPrev: boolean;
  hasNext: boolean;
  blockLabel?: string;
  exerciseHistory?: ExerciseHistory[];
  /** Raw completed logs for lastSession() (Task 11 renders the line). */
  lastWeekRows?: LogRow[];
  /** Today's workout instance — excluded from "last week". */
  workoutInstanceId?: string;
  onInputChange: (
    setIndex: number,
    field: string,
    value: any,
    exerciseIdOverride?: string,
    isAutoFill?: boolean
  ) => void;
  onToggleSetComplete: (setIndex: number, autoFillValues?: Record<string, any>) => void;
  /** Per-set athlete RPE for this exercise, keyed `reId:setIndex`. */
  rpeValues?: Record<string, number | null>;
  onRpeChange?: (setIndex: number, value: number) => void;
  onNextSet: () => void;
  onPrevExercise: () => void;
  onNextExercise: () => void;
  onBackToOverview: () => void;
  prAlert?: PRAlert | null;
}

// Helper: Get relative time string
function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return '1 week ago';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 60) return '1 month ago';
  return `${Math.floor(diffDays / 30)} months ago`;
}

// Helper: Compute session stats from sets
function computeSessionStats(sets: ExerciseHistorySet[]): {
  totalReps: number;
  maxWeight: number;
  volume: number;
  setsCount: number;
} {
  let totalReps = 0;
  let maxWeight = 0;
  let volume = 0;

  sets.forEach(set => {
    const reps = set.reps || 0;
    const weight = set.weight || 0;
    totalReps += reps;
    if (weight > maxWeight) maxWeight = weight;
    volume += reps * weight;
  });

  return {
    totalReps,
    maxWeight,
    volume,
    setsCount: sets.length,
  };
}

// Helper: Get keyboard type for metric
function getKeyboardType(metricType?: string): 'default' | 'number-pad' | 'decimal-pad' {
  if (!metricType) return 'number-pad';
  if (metricType === 'integer') return 'number-pad';
  if (metricType === 'decimal') return 'decimal-pad';
  return 'number-pad';
}

// Helper: Get ball type from metric ID for grouping
// Uses regex for more precise matching to avoid "4 oz" matching "5oz" patterns
function getBallType(metricId: string, customMeasurements: Measurement[]): string | null {
  // Get the measurement name to check (not the UUID)
  const measurementName = getMeasurementName(metricId, customMeasurements);
  const textToCheck = measurementName || metricId;
  const lowerText = textToCheck.toLowerCase();

  // Check for specific oz patterns with word boundaries or common formats
  // "7oz", "7 oz", "7_oz" patterns
  if (/\b7\s*oz\b|7_oz/i.test(textToCheck)) return '7oz';
  if (/\b6\s*oz\b|6_oz/i.test(textToCheck)) return '6oz';
  // Check 4oz BEFORE 5oz/baseball since "4 oz" should not match "5oz"
  if (/\b4\s*oz\b|4_oz/i.test(textToCheck)) return '4oz';
  if (/\b3\s*oz\b|3_oz/i.test(textToCheck)) return '3oz';
  // 5oz and baseball - check both patterns
  if (/\b5\s*oz\b|5_oz/i.test(textToCheck)) return '5oz';
  // Baseball without explicit oz - treat as its own type
  if (lowerText.includes('baseball')) return 'baseball';

  // Plyo balls
  if (lowerText.includes('blue')) return 'blue';
  if (lowerText.includes('red') && !/\d\s*oz/i.test(textToCheck)) return 'red';
  if (lowerText.includes('yellow')) return 'yellow';
  if (lowerText.includes('gray') || lowerText.includes('grey')) return 'gray';
  if (lowerText.includes('green') && !/\d\s*oz/i.test(textToCheck)) return 'green';
  return null;
}

// Helper: Group metrics into paired ball groups
interface MetricGroup {
  ballType: string | null;
  metrics: string[];
}

function groupMetricsForDisplay(metricFields: string[], customMeasurements: Measurement[]): MetricGroup[] {
  const groups: MetricGroup[] = [];
  const processedMetrics = new Set<string>();

  // First, handle non-ball metrics
  metricFields.forEach(metricId => {
    if (!isBallMetric(metricId, customMeasurements)) {
      groups.push({ ballType: null, metrics: [metricId] });
      processedMetrics.add(metricId);
    }
  });

  // Group ball metrics by ball type
  const ballMetrics = metricFields.filter(m => isBallMetric(m, customMeasurements) && !processedMetrics.has(m));
  const ballGroups = new Map<string, string[]>();

  ballMetrics.forEach(metricId => {
    const ballType = getBallType(metricId, customMeasurements);
    if (ballType) {
      if (!ballGroups.has(ballType)) {
        ballGroups.set(ballType, []);
      }
      ballGroups.get(ballType)!.push(metricId);
    }
  });

  // Convert map to groups, maintaining sort order
  const sortedBallTypes = Array.from(ballGroups.keys()).sort((a, b) => {
    const weightA = ballWeightOrder[a] || 999;
    const weightB = ballWeightOrder[b] || 999;
    return weightA - weightB;
  });

  sortedBallTypes.forEach(ballType => {
    const metrics = ballGroups.get(ballType)!;
    // Sort within group: primary (reps) first, then secondary (velo)
    metrics.sort((a, b) => {
      const aIsPrimary = a.toLowerCase().includes('reps');
      const bIsPrimary = b.toLowerCase().includes('reps');
      if (aIsPrimary && !bIsPrimary) return -1;
      if (!aIsPrimary && bIsPrimary) return 1;
      return 0;
    });
    groups.push({ ballType, metrics });
  });

  return groups;
}

// Ball icon component for plyo balls and weighted balls
interface BallIconProps {
  metricId: string;
  customMeasurements: Measurement[];
}

function BallIcon({ metricId, customMeasurements }: BallIconProps): React.ReactElement | null {
  // Get measurement name to check (not the UUID)
  const measurementName = getMeasurementName(metricId, customMeasurements);
  const textToCheck = measurementName || metricId;
  const lowerText = textToCheck.toLowerCase();

  // Plyo balls - colored circles
  if (lowerText.includes('blue')) {
    return (
      <View style={ballIconStyles.plyoBall}>
        <View style={[ballIconStyles.plyoBallInner, { backgroundColor: '#3B82F6', borderColor: '#2563EB' }]} />
      </View>
    );
  }
  if (lowerText.includes('red') && !/\d\s*oz/i.test(textToCheck)) {
    return (
      <View style={ballIconStyles.plyoBall}>
        <View style={[ballIconStyles.plyoBallInner, { backgroundColor: '#EF4444', borderColor: '#DC2626' }]} />
      </View>
    );
  }
  if (lowerText.includes('yellow')) {
    return (
      <View style={ballIconStyles.plyoBall}>
        <View style={[ballIconStyles.plyoBallInner, { backgroundColor: '#EAB308', borderColor: '#CA8A04' }]} />
      </View>
    );
  }
  if (lowerText.includes('gray') || lowerText.includes('grey')) {
    return (
      <View style={ballIconStyles.plyoBall}>
        <View style={[ballIconStyles.plyoBallInner, { backgroundColor: '#6B7280', borderColor: '#4B5563' }]} />
      </View>
    );
  }
  if (lowerText.includes('green') && !/\d\s*oz/i.test(textToCheck)) {
    return (
      <View style={ballIconStyles.plyoBall}>
        <View style={[ballIconStyles.plyoBallInner, { backgroundColor: '#22C55E', borderColor: '#16A34A' }]} />
      </View>
    );
  }

  // Weighted balls - white circles with number
  // Use regex for patterns like "7oz", "7 oz", "7_oz"
  if (/\b7\s*oz\b|7_oz/i.test(textToCheck)) {
    return (
      <View style={ballIconStyles.weightedBall}>
        <Text style={[ballIconStyles.weightedBallText, { color: '#EA580C' }]}>7</Text>
      </View>
    );
  }
  if (/\b6\s*oz\b|6_oz/i.test(textToCheck)) {
    return (
      <View style={ballIconStyles.weightedBall}>
        <Text style={[ballIconStyles.weightedBallText, { color: '#7C3AED' }]}>6</Text>
      </View>
    );
  }
  // Check 4oz BEFORE 5oz/baseball
  if (/\b4\s*oz\b|4_oz/i.test(textToCheck)) {
    return (
      <View style={ballIconStyles.weightedBall}>
        <Text style={[ballIconStyles.weightedBallText, { color: '#2563EB' }]}>4</Text>
      </View>
    );
  }
  if (/\b3\s*oz\b|3_oz/i.test(textToCheck)) {
    return (
      <View style={ballIconStyles.weightedBall}>
        <Text style={[ballIconStyles.weightedBallText, { color: '#16A34A' }]}>3</Text>
      </View>
    );
  }
  // 5oz or baseball (standard 5oz ball)
  if (/\b5\s*oz\b|5_oz/i.test(textToCheck) || lowerText.includes('baseball')) {
    return (
      <View style={ballIconStyles.weightedBall}>
        <Text style={[ballIconStyles.weightedBallText, { color: '#DC2626' }]}>5</Text>
      </View>
    );
  }

  return null;
}

// Ball icon styles
const ballIconStyles = StyleSheet.create({
  plyoBall: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  plyoBallInner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  weightedBall: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  weightedBallText: {
    fontSize: 10,
    fontWeight: '700',
  },
});

export default function ExerciseDetailView({
  exercise,
  routine,
  customMeasurements,
  athleteMaxes,
  moundVelocity,
  exerciseInputs,
  completedSets,
  currentSetIndex,
  currentSetIndexes,
  allExercises,
  sequence,
  hasPrev,
  hasNext,
  blockLabel,
  exerciseHistory,
  lastWeekRows,
  workoutInstanceId,
  onInputChange,
  onToggleSetComplete,
  rpeValues,
  onRpeChange,
  onNextSet,
  onPrevExercise,
  onNextExercise,
  onBackToOverview,
  prAlert,
}: ExerciseDetailViewProps) {
  const insets = useSafeAreaInsets();
  const videoUrl = exercise.exercises.video_url || null;
  const videoId = youTubeId(videoUrl);
  const [prAlertVisible, setPRAlertVisible] = useState(false);
  const [prAnimation] = useState(new Animated.Value(0));
  const [showHistory, setShowHistory] = useState(false);
  // Coach instructions card: collapsed shows a short preview (the coach's
  // first cues); "more" opens block notes + the library description too.
  const [notesExpanded, setNotesExpanded] = useState(false);
  // PR popover visibility — tapping the trophy icon in the header.
  const [prPopoverOpen, setPRPopoverOpen] = useState(false);
  // Set indices the user has explicitly expanded (e.g. tapped a collapsed
  // completed set to re-edit it). The current set is always expanded; all
  // other sets default to a one-line summary.
  const [manuallyExpandedSets, setManuallyExpandedSets] = useState<Set<number>>(new Set());
  // Tiny "Saved" indicator timestamp — bumped on every onInputChange.
  // Used to fade a small confirmation under the active set so the
  // athlete knows the keystroke landed.
  const [lastSavedTick, setLastSavedTick] = useState<number>(0);
  const [savedVisible, setSavedVisible] = useState(false);
  useEffect(() => {
    if (!lastSavedTick) return;
    setSavedVisible(true);
    const t = setTimeout(() => setSavedVisible(false), 900);
    return () => clearTimeout(t);
  }, [lastSavedTick]);
  // Auto-fill pulse tracker — set of "setIndex:metricId" keys that
  // were just auto-filled by the placeholder logic. Inputs with a key
  // here briefly flash green so the athlete sees the auto-fill happened.
  const [autoFilledKeys, setAutoFilledKeys] = useState<Set<string>>(new Set());
  // Fields ("set:metric") the athlete changed by hand (keypad), per routine
  // exercise. A hand-edited back-off field is never overwritten by back-off
  // auto-fill; other fields of that set still follow.
  const editedFieldsRef = useRef<Record<string, Set<string>>>({});
  const markFieldEdited = (setIndex: number, metricId: string) => {
    const fields = editedFieldsRef.current[exercise.id] ?? new Set<string>();
    fields.add(fieldKey(setIndex, metricId));
    editedFieldsRef.current[exercise.id] = fields;
  };
  const flashAutoFill = useCallback((setIndex: number, metricId: string) => {
    const key = `${setIndex}:${metricId}`;
    setAutoFilledKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    setTimeout(() => {
      setAutoFilledKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 600);
  }, []);
  // Floating demo video: closed by default; ⤢ hands off to the full modal.
  const [floatingVideoOpen, setFloatingVideoOpen] = useState(false);
  const [fullVideoId, setFullVideoId] = useState<string | null>(null);
  // Measured bottom-bar height so the ▶ / window sit just above it.
  const [bottomBarHeight, setBottomBarHeight] = useState(80);

  // Custom keypad state
  const [activeInput, setActiveInput] = useState<{
    setIndex: number;
    metricId: string;
    isDecimal: boolean;
  } | null>(null);

  // A new exercise starts with its video closed.
  useEffect(() => {
    setFloatingVideoOpen(false);
    setFullVideoId(null);
  }, [exercise.id]);

  // YouTube → floating window; any other link opens full screen outside.
  const openVideo = () => {
    if (videoId) setFloatingVideoOpen(true);
    else if (videoUrl) Linking.openURL(videoUrl.trim()).catch(() => {});
  };

  // The current set always renders first (right under the coach card), so
  // a new current set just scrolls back to the top.
  const scrollViewRef = useRef<ScrollView>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);
    // Clear any manually-expanded sets when the active set changes —
    // keeps the screen tight as the athlete progresses. They can tap
    // any collapsed row to re-open it.
    setManuallyExpandedSets(new Set());
    return () => clearTimeout(t);
  }, [currentSetIndex, exercise.id]);

  // Wrap the parent's onInputChange so we can bump the "Saved" indicator
  // tick on every successful save. Keeps the parent prop API unchanged.
  const onInputChangeWithTick = useCallback(
    (
      setIndex: number,
      metricId: string,
      value: string | number,
      targetExerciseId?: string,
      autoComplete?: boolean,
    ) => {
      onInputChange(setIndex, metricId, value, targetExerciseId, autoComplete);
      setLastSavedTick(Date.now());
    },
    [onInputChange],
  );

  // Custom keypad handlers
  const handleKeypadPress = (key: string) => {
    if (!activeInput) return;
    const { setIndex, metricId } = activeInput;
    const currentInputs = exerciseInputs[exercise.id] || [];
    const setData = currentInputs[setIndex] || {};
    const currentValue = setData[metricId]?.toString() || '';

    // Prevent multiple decimals
    if (key === '.' && currentValue.includes('.')) return;

    const newValue = currentValue + key;
    markFieldEdited(setIndex, metricId);
    onInputChangeWithTick(setIndex, metricId, newValue);
  };

  const handleKeypadBackspace = () => {
    if (!activeInput) return;
    const { setIndex, metricId } = activeInput;
    const currentInputs = exerciseInputs[exercise.id] || [];
    const setData = currentInputs[setIndex] || {};
    const currentValue = setData[metricId]?.toString() || '';
    const newValue = currentValue.slice(0, -1);
    markFieldEdited(setIndex, metricId);
    onInputChangeWithTick(setIndex, metricId, newValue);
  };

  const handleKeypadDone = () => {
    if (!activeInput) {
      setActiveInput(null);
      return;
    }

    const { setIndex, metricId } = activeInput;
    const currentMetricIndex = metricFields.indexOf(metricId);
    const currentInputs = exerciseInputs[exercise.id] || [];
    const setData = currentInputs[setIndex] || {};

    // When user enters a value, auto-fill any empty fields with their placeholder values
    // This ensures reps get filled when weight is entered, etc.
    const currentValue = setData[metricId];
    if (currentValue != null && currentValue !== '') {
      const placeholders = getPlaceholderValuesForSet(setIndex);
      metricFields.forEach(field => {
        const fieldValue = setData[field];
        // If this field is empty and has a placeholder, auto-fill it
        if ((fieldValue === undefined || fieldValue === null || fieldValue === '') && placeholders[field] !== undefined) {
          onInputChangeWithTick(setIndex, field, placeholders[field], undefined, true);
          flashAutoFill(setIndex, field);
        }
      });
    }

    // Check if there's a next metric in the current set
    if (currentMetricIndex < metricFields.length - 1) {
      // Move to next metric in same set
      const nextMetricId = metricFields[currentMetricIndex + 1];
      const nextMeasurement = customMeasurements.find(
        m => m.primary_metric_id === nextMetricId || m.secondary_metric_id === nextMetricId
      );
      const nextMetricType = nextMeasurement?.primary_metric_id === nextMetricId
        ? nextMeasurement?.primary_metric_type
        : nextMeasurement?.secondary_metric_type;
      const isDecimal = nextMetricType === 'decimal';

      setActiveInput({ setIndex, metricId: nextMetricId, isDecimal });
    } else {
      // All metrics filled, close keypad
      setActiveInput(null);
    }
  };

  // Show PR alert animation
  useEffect(() => {
    if (prAlert) {
      setPRAlertVisible(true);
      Animated.sequence([
        Animated.spring(prAnimation, {
          toValue: 1,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }),
        Animated.delay(3000),
        Animated.timing(prAnimation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setPRAlertVisible(false);
      });
    }
  }, [prAlert]);

  // Get metric fields to display (sorted by ball weight for throwing exercises)
  const getMetricFields = (): string[] => metricFieldsFor(exercise, customMeasurements);

  const metricFields = getMetricFields();

  // Get set configuration for current set
  const getSetConfig = (setIndex: number): SetConfiguration | null => {
    if (exercise.set_configurations && exercise.set_configurations[setIndex]) {
      return exercise.set_configurations[setIndex];
    }
    return null;
  };

  // Target logic lives in lib/logger/targets.ts (pure); these closures bind
  // it to this exercise's props.
  const targetArgs = (setIndex: number, metricId: string) => ({
    re: exercise,
    setIndex,
    metric: metricId,
    maxes: athleteMaxes,
    logged: exerciseInputs[exercise.id] || [],
    moundVelocity,
  });

  // Get target value for a metric in a specific set (per-set metric_values,
  // else exercise metric_targets).
  const getTargetValue = (setIndex: number, metricId: string): number | undefined =>
    prescribedValue(exercise, setIndex, metricId);

  // Reps-type metric flagged AMRAP for this set (per-set flag OR the
  // exercise-level flag). Per-set is_amrap was typed but never rendered.
  const isAmrapFor = (setIndex: number, metricId: string): boolean => {
    const repsLike = metricId === 'reps' || metricId.toLowerCase().endsWith('_reps');
    if (!repsLike) return false;
    return !!(getSetConfig(setIndex)?.is_amrap || exercise.is_amrap);
  };

  // Get intensity target for a metric in a specific set — "% of set K"
  // from what was logged for set K, % of max (cross-exercise aware), or the
  // mound-velocity fallback for throwing velocity.
  const getIntensityTarget = (setIndex: number, metricId: string): IntensityResult | null =>
    intensityFor(targetArgs(setIndex, metricId));

  // Check if set is completed
  const isSetCompleted = (setIndex: number): boolean => {
    return completedSets[exercise.id]?.[setIndex] === true;
  };

  // Last completed session of this exercise, never today's instance.
  // bySet is keyed by 1-indexed set_number.
  const lastWeek = useMemo(
    () => lastSession(lastWeekRows ?? [], exercise.exercise_id, workoutInstanceId ?? ''),
    [lastWeekRows, exercise.exercise_id, workoutInstanceId],
  );
  // Same set number from last session. Only a set that isn't a back-off
  // (set 1, or no "% of set K" target) may fall back to last session's top
  // set — a back-off compared with last week's top set reads as a big drop.
  const lastWeekFor = (setIndex: number) => {
    const same = lastWeek?.bySet[setIndex + 1];
    if (same) return same;
    return setIndex === 0 || !isBackoffSet(setIndex) ? lastWeek?.best ?? null : null;
  };

  // "N of M" — this exercise's position among the workout's loggable
  // exercises (sequence order). Rows outside the sequence show nothing.
  const exercisePosition = useMemo(() => {
    const ids: string[] = [];
    sequence.forEach((s) => {
      if (!ids.includes(s.reId)) ids.push(s.reId);
    });
    const index = ids.indexOf(exercise.id);
    return index === -1 ? null : { index: index + 1, total: ids.length };
  }, [sequence, exercise.id]);

  // Prescribed as "% of set K" for an earlier K — a back-off set.
  function isBackoffSet(setIndex: number): boolean {
    const targets = exercise.set_configurations?.[setIndex]?.intensity_targets || exercise.intensity_targets;
    return !!targets?.some(
      (t) => t.relative_to === 'set' && t.reference_set != null && t.reference_set - 1 >= 0 && t.reference_set - 1 < setIndex,
    );
  }

  // A set other sets are prescribed as a % of ("90% of set 1") — the top set.
  const isTopSet = (setIndex: number): boolean => {
    for (let j = setIndex + 1; j < (exercise.sets || 0); j++) {
      const targets = exercise.set_configurations?.[j]?.intensity_targets || exercise.intensity_targets;
      if (targets?.some((t) => t.relative_to === 'set' && t.reference_set === setIndex + 1)) return true;
    }
    return false;
  };

  // Muted caption for a set's intensity prescription: "90% of set 1",
  // "70% of Back Squat max", "80% of max".
  const intensityCaption = (setIndex: number): string | null => {
    const t = metricFields.map((m) => getIntensityTarget(setIndex, m)).find((x) => x !== null);
    if (!t) return null;
    const src = t.sourceExerciseName || null;
    if (src && /^Set \d/.test(src)) return `${t.percent}% of ${src.replace(/^Set/, 'set')}`;
    return src ? `${t.percent}% of ${src} max` : `${t.percent}% of max`;
  };

  const numeric = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Get all placeholder values for a set (for auto-fill when checking)
  const getPlaceholderValuesForSet = (setIndex: number): Record<string, any> => {
    const values: Record<string, any> = {};
    metricFields.forEach(metricId => {
      const placeholderValue = resolveTarget(targetArgs(setIndex, metricId));
      if (placeholderValue != null) {
        values[metricId] = placeholderValue;
      }
    });
    return values;
  };

  // Back-off sets ("90% of set 1") that were already logged follow their
  // reference set when it changes (spec §7) — unless the athlete edited the
  // back-off by hand. Sets not logged yet need nothing: their placeholder is
  // computed live from the reference set and auto-fills on completion.
  // The decision lives in backoffUpdates (lib/logger/targets.ts); this keeps
  // its `expected` map between runs. Runs when the keypad closes or moves to
  // another field, and on exercise change — not per keystroke.
  const backoffExpectedRef = useRef<Record<string, Record<string, number>>>({});
  useEffect(() => {
    const { apply, expected } = backoffUpdates({
      re: exercise,
      metrics: metricFields,
      maxes: athleteMaxes,
      logged: exerciseInputs[exercise.id] || [],
      moundVelocity,
      edited: editedFieldsRef.current[exercise.id] ?? new Set<string>(),
      expected: backoffExpectedRef.current[exercise.id] ?? {},
      active: activeInput ? { setIndex: activeInput.setIndex, metric: activeInput.metricId } : null,
    });
    backoffExpectedRef.current[exercise.id] = expected;
    apply.forEach(({ setIndex, metric, value }) => {
      onInputChangeWithTick(setIndex, metric, value, undefined, true);
      flashAutoFill(setIndex, metric);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed to commit points (keypad field change/close, exercise change), not inputs: running per keystroke would move back-offs off half-typed values. Current props are read from this render's closure.
  }, [exercise.id, activeInput?.setIndex, activeInput?.metricId, activeInput == null]);

  // Handle checkbox toggle - compute auto-fill values if checking
  const handleCheckboxToggle = (setIndex: number) => {
    const isCompleted = isSetCompleted(setIndex);
    const setData = exerciseInputs[exercise.id]?.[setIndex] || {};

    if (!isCompleted) {
      // Checking the box - compute values to auto-fill for empty fields
      const autoFillValues: Record<string, any> = {};
      const placeholders = getPlaceholderValuesForSet(setIndex);

      metricFields.forEach(metricId => {
        const currentValue = setData[metricId];
        // If field is empty and has a placeholder, use the placeholder
        if ((currentValue === undefined || currentValue === null || currentValue === '') && placeholders[metricId] !== undefined) {
          autoFillValues[metricId] = placeholders[metricId];
        }
      });

      onToggleSetComplete(setIndex, Object.keys(autoFillValues).length > 0 ? autoFillValues : undefined);
      // Flash any field we just auto-filled so the athlete sees what
      // changed (was previously silent — values just appeared).
      Object.keys(autoFillValues).forEach((metricId) => flashAutoFill(setIndex, metricId));
    } else {
      // Unchecking - no auto-fill needed
      onToggleSetComplete(setIndex);
    }
  };

  // Handle Next button press - two-phase: first tap checks set, second tap advances
  const handleNextButtonPress = () => {
    const currentSetCompleted = isSetCompleted(currentSetIndex);

    if (!currentSetCompleted) {
      // First tap: mark the current set as complete (don't advance)
      handleCheckboxToggle(currentSetIndex);
    } else {
      // Second tap: set is already complete, advance to next
      onNextSet();
    }
  };

  // Swipe gesture handler for exercise navigation
  const SWIPE_THRESHOLD = 120; // bumped up so accidental swipes mid-input
                               // don't kick the user to another exercise
  const SWIPE_VELOCITY_THRESHOLD = 0.5; // require a clear flick

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // Disable swipe-between-exercises while the numeric keypad is open —
      // users were swiping to reach number keys and accidentally
      // jumping to the next/prev exercise.
      if (activeInput) return false;
      // Only capture horizontal swipes that are more horizontal than vertical
      const { dx, dy } = gestureState;
      return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30;
    },
    onPanResponderRelease: (_, gestureState) => {
      const { dx, vx } = gestureState;

      // Check for a hard swipe (either by distance or velocity)
      const isHardSwipe = Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(vx) > SWIPE_VELOCITY_THRESHOLD;

      if (isHardSwipe) {
        if (dx > 0 && hasPrev) {
          // Swipe right → previous exercise
          onPrevExercise();
        } else if (dx < 0 && hasNext) {
          // Swipe left → next exercise
          onNextExercise();
        }
      }
    },
  }), [hasPrev, hasNext, onPrevExercise, onNextExercise, activeInput]);

  // One compact line for a collapsed set (lib/logger/setLine).
  const formatSetMetrics = (valueOf: (metricId: string) => unknown): string =>
    formatSetLine(metricFields, valueOf, customMeasurements);

  const renderSetCards = () => {
    // Notes-only exercises (no measurement fields and/or notes_only=true)
    // are instruction cards, not loggable sets. Render the parsed
    // structured notes (sections + bullets + callouts) instead of looping
    // exercise.sets-many fake set cards (which would either be 0 — null
    // coerces to 0 in the for-loop — OR if some upstream caller fell back
    // to 3, three "No metrics configured" placeholders that demand input
    // and never complete).
    const isNotesOnly = metricFields.length === 0 || (exercise as any).notes_only;
    if (isNotesOnly) {
      const notesText: string | null | undefined = (exercise as any).notes;
      const parsed = parseInstructionBlock(notesText);
      if (parsed.sections.length === 0 && parsed.callouts.length === 0) {
        return (
          <View style={instructionStyles.empty}>
            <Text style={instructionStyles.emptyText}>Instruction block</Text>
          </View>
        );
      }
      return (
        <View style={instructionStyles.container}>
          {parsed.sections.map((section, sIdx) => (
            <View
              key={sIdx}
              style={sIdx > 0 ? instructionStyles.sectionSpaced : undefined}
            >
              {section.header && (
                <Text style={instructionStyles.header}>{section.header}</Text>
              )}
              {section.items.map((item, iIdx) => (
                <View key={iIdx} style={instructionStyles.bulletRow}>
                  <Text style={instructionStyles.bullet}>•</Text>
                  <Text style={instructionStyles.item}>{item}</Text>
                </View>
              ))}
            </View>
          ))}
          {parsed.callouts.length > 0 && (
            <View style={instructionStyles.callout}>
              {parsed.callouts.map((callout, cIdx) => (
                <View key={cIdx} style={instructionStyles.calloutRow}>
                  <Text style={instructionStyles.calloutIcon}>⚠</Text>
                  <Text style={instructionStyles.calloutText}>{callout}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      );
    }

    const sets = [];
    // The current set leads (right under the coach card); the rest follow
    // in set order — done sets as a green result line, upcoming as targets.
    const setCount = exercise.sets || 0;
    const order: number[] = [];
    if (currentSetIndex >= 0 && currentSetIndex < setCount) order.push(currentSetIndex);
    for (let k = 0; k < setCount; k++) if (k !== currentSetIndex) order.push(k);
    for (const i of order) {
      const setData = exerciseInputs[exercise.id]?.[i] || {};
      const setConfig = getSetConfig(i);
      const isCompleted = isSetCompleted(i);
      const isCurrentSet = i === currentSetIndex;
      const isExpanded = isCurrentSet || manuallyExpandedSets.has(i);
      const topSet = isTopSet(i);
      const caption = intensityCaption(i);
      const last = lastWeekFor(i);

      // Collapsed row — done sets show their result, upcoming sets their
      // target. Tap (or "edit") to expand and change any set.
      if (!isExpanded) {
        let line: string;
        if (isCompleted) {
          const parts: string[] = [];
          const base = formatSetMetrics((m) => setData[m]);
          if (base) parts.push(base);
          const rpe = rpeValues?.[`${exercise.id}:${i}`];
          if (rpe != null) parts.push(`RPE ${rpe}`);
          const delta = deltaText(numeric(setData.weight), last?.weight ?? null);
          if (delta) parts.push(delta);
          line = parts.join(' · ') || 'done';
        } else {
          const valueOrTarget = (m: string) => {
            const v = setData[m];
            if (v != null && v !== '') return v;
            if (isAmrapFor(i, m)) return 'AMRAP';
            return resolveTarget(targetArgs(i, m));
          };
          const parts: string[] = [];
          const base = formatSetMetrics(valueOrTarget);
          if (base) parts.push(base);
          if (caption) parts.push(caption);
          line = parts.join(' · ') || '—';
        }
        sets.push(
          <TouchableOpacity
            key={i}
            onPress={() => {
              setManuallyExpandedSets((prev) => {
                const next = new Set(prev);
                next.add(i);
                return next;
              });
            }}
            activeOpacity={0.7}
            style={[
              styles.setRowCollapsed,
              isCompleted && styles.setRowCollapsedDone,
            ]}
          >
            <View
              style={[
                styles.setRowCheck,
                isCompleted && styles.setRowCheckDone,
              ]}
            >
              {isCompleted ? <Text style={styles.setRowCheckIcon}>✓</Text> : null}
            </View>
            <View style={styles.setRowBody}>
              <View style={styles.setRowTitleLine}>
                <Text style={styles.setRowLabel}>
                  Set {i + 1}{topSet ? ' · top set' : ''}
                </Text>
                {isCompleted && exercise.ask_rpe && rpeValues?.[`${exercise.id}:${i}`] == null && (
                  <Text style={styles.setRowRpeMissing}>RPE?</Text>
                )}
              </View>
              <Text
                style={isCompleted ? styles.setResultLine : styles.setTargetLine}
                numberOfLines={1}
              >
                {line}
              </Text>
            </View>
            {!isCompleted && <Text style={styles.setRowEdit}>edit</Text>}
          </TouchableOpacity>,
        );
        continue;
      }

      sets.push(
        <View
          key={i}
          style={[
            styles.setCard,
            isCompleted && styles.setCardCompleted,
            isCurrentSet && styles.setCardCurrent,
          ]}
        >
          {/* Set header — "Set 2 of 3 · top set", intensity caption, check */}
          <View style={styles.setHeader}>
            <Text style={styles.setHeaderText} numberOfLines={1}>
              Set {i + 1} of {exercise.sets}{topSet ? ' · top set' : ''}
            </Text>
            <View style={styles.setHeaderRight}>
              {!!caption && (
                <Text style={styles.setHeaderCaption} numberOfLines={1}>{caption}</Text>
              )}
              <TouchableOpacity
                style={[
                  styles.completionCheckmark,
                  isCompleted && styles.completionCheckmarkCompleted,
                ]}
                onPress={() => handleCheckboxToggle(i)}
                activeOpacity={0.7}
                hitSlop={8}
                accessibilityLabel={isCompleted ? 'Mark set not done' : 'Mark set done'}
              >
                <Text style={[
                  styles.checkmarkIcon,
                  !isCompleted && styles.checkmarkIconEmpty,
                ]}>
                  {isCompleted ? '✓' : ''}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Last week's result for this set (Task 7 reference) */}
          {(() => {
            const wr = last ? formatWeightReps(last.weight, last.reps) : null;
            return wr ? <Text style={styles.lastWeekLine}>{`last week ${wr}`}</Text> : null;
          })()}
          {/* Metric Inputs Grid - with grouped ball metrics */}
          <View style={styles.metricsGrid}>
            {(() => {
              const metricGroups = groupMetricsForDisplay(metricFields, customMeasurements);

              // Separate ball groups from non-ball metrics
              const ballGroups = metricGroups.filter(g => g.ballType);
              const nonBallMetrics = metricGroups.filter(g => !g.ballType).flatMap(g => g.metrics);

              return (
                <>
                  {/* Non-ball metrics in a row */}
                  {nonBallMetrics.length > 0 && (
                    <View style={styles.nonBallMetricsRow}>
                      {nonBallMetrics.map(metricId => {
                        const label = getMetricLabel(metricId, customMeasurements);
                        const targetValue = getTargetValue(i, metricId);
                        const intensityTarget = getIntensityTarget(i, metricId);
                        const currentValue = setData[metricId];
                        const measurement = customMeasurements.find(
                          m => m.primary_metric_id === metricId || m.secondary_metric_id === metricId
                        );
                        const metricType =
                          measurement?.primary_metric_id === metricId
                            ? measurement?.primary_metric_type
                            : measurement?.secondary_metric_type;
                        const placeholderValue = intensityTarget?.calculatedValue ?? targetValue;
                        const isDecimal = metricType === 'decimal';
                        const isActive = activeInput?.setIndex === i && activeInput?.metricId === metricId;

                        const justFilled = autoFilledKeys.has(`${i}:${metricId}`);
                        const isEmpty = currentValue == null || currentValue === '';
                        const shown = !isEmpty
                          ? String(currentValue)
                          : isAmrapFor(i, metricId)
                            ? 'AMRAP'
                            : intensityTarget?.percent && !intensityTarget.calculatedValue && !targetValue
                              // A % was prescribed but there's no max on file — say so.
                              ? `${intensityTarget.percent}% · no max set`
                              : placeholderValue ? String(placeholderValue) : `Enter ${label}`;
                        // Prompts ("Enter Reps", "80% · no max set") sit smaller than numbers.
                        const isPrompt = isEmpty && !/^-?\d+(\.\d+)?$/.test(shown);
                        return (
                          <View
                            key={metricId}
                            style={[styles.metricInput, metricId === 'weight' && styles.metricInputWide]}
                          >
                            <View style={styles.metricLabelRow}>
                              <Text style={styles.metricLabel} numberOfLines={1}>{label.toUpperCase()}</Text>
                            </View>
                            <TouchableOpacity
                              style={[
                                styles.input,
                                currentValue != null && currentValue !== '' && styles.inputFilled,
                                isActive && styles.inputActive,
                                justFilled && styles.inputAutoFilled,
                              ]}
                              onPress={() => setActiveInput({ setIndex: i, metricId, isDecimal })}
                              activeOpacity={0.7}
                            >
                              <Text
                                style={[
                                  styles.inputText,
                                  isEmpty && styles.inputPlaceholder,
                                  isPrompt && styles.inputPrompt,
                                ]}
                                numberOfLines={1}
                              >
                                {shown}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Ball metric groups - each takes full width, 2 columns for reps/velo */}
                  {ballGroups.map((group) => (
                    <View key={`group-${group.ballType}`} style={styles.ballMetricGroup}>
                      {/* Ball icon header for the group */}
                      <View style={styles.ballGroupHeader}>
                        <BallIcon metricId={group.metrics[0]} customMeasurements={customMeasurements} />
                      </View>
                      {/* Individual metrics in the group - always 2 columns */}
                      <View style={styles.ballGroupInputs}>
                        {group.metrics.map(metricId => {
                          const label = getMetricLabel(metricId, customMeasurements);
                          const targetValue = getTargetValue(i, metricId);
                          const intensityTarget = getIntensityTarget(i, metricId);
                          const currentValue = setData[metricId];
                          const measurement = customMeasurements.find(
                            m => m.primary_metric_id === metricId || m.secondary_metric_id === metricId
                          );
                          const metricType =
                            measurement?.primary_metric_id === metricId
                              ? measurement?.primary_metric_type
                              : measurement?.secondary_metric_type;
                          const placeholderValue = intensityTarget?.calculatedValue ?? targetValue;
                          const isDecimal = metricType === 'decimal';
                          const isActive = activeInput?.setIndex === i && activeInput?.metricId === metricId;

                          const justFilledBall = autoFilledKeys.has(`${i}:${metricId}`);
                          return (
                            <View key={metricId} style={styles.ballGroupMetricInput}>
                              <Text style={styles.ballGroupMetricLabel}>{label}</Text>
                              <TouchableOpacity
                                style={[
                                  styles.ballGroupInput,
                                  currentValue != null && currentValue !== '' && styles.inputFilled,
                                  isActive && styles.inputActive,
                                  justFilledBall && styles.inputAutoFilled,
                                ]}
                                onPress={() => setActiveInput({ setIndex: i, metricId, isDecimal })}
                                activeOpacity={0.7}
                              >
                                <Text style={[
                                  styles.inputText,
                                  (currentValue == null || currentValue === '') && styles.inputPlaceholder,
                                ]}>
                                  {currentValue != null && currentValue !== ''
                                    ? String(currentValue)
                                    : placeholderValue ? String(placeholderValue) : '-'}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </>
              );
            })()}
          </View>

          {exercise.ask_rpe && onRpeChange && (
            <RpeRow
              target={setConfig?.rpe ?? null}
              value={rpeValues?.[`${exercise.id}:${i}`] ?? null}
              onChange={(v) => onRpeChange(i, v)}
            />
          )}

          {/* Per-set notes from coach (read-only display) */}
          {setConfig?.notes && (
            <View style={styles.setNotesDisplay}>
              <Text style={styles.setNotesText}>{setConfig.notes}</Text>
            </View>
          )}
          {/* Subtle "Saved" affordance under the active set so the
              athlete sees their input landed (the actual DB write is
              debounced in the parent — this fires on every state push). */}
          {isCurrentSet && savedVisible && (
            <Text style={styles.savedTick}>· Saved</Text>
          )}
        </View>
      );
    }
    return sets;
  };

  // Helper to truncate exercise name for button
  const truncateName = (name: string, maxLength: number = 14): string => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 1) + '…';
  };

  // Dynamic button text based on workout type and progress
  // Shows "Next Set" when staying on same exercise, or the actual exercise name when switching.
  // The next step comes from the sequence engine, as if the current set were done.
  const getNextButtonText = () => {
    // Rows outside the sequence (notes-only, text blocks) step to the next row
    // in the list — same as the parent's handleNextSet.
    if (!sequence.some(s => s.reId === exercise.id)) {
      const currentExerciseIndex = allExercises.findIndex(ex => ex.id === exercise.id);
      const following = allExercises[currentExerciseIndex + 1];
      return following ? truncateName(following.exercises?.name ?? following.placeholder_name ?? '') + ' →' : 'DONE';
    }

    const done = { ...completedSets };
    const updatedSets = [...(done[exercise.id] || Array(exercise.sets).fill(false))];
    updatedSets[currentSetIndex] = true;
    done[exercise.id] = updatedSets;

    const next = nextStep(sequence, done, { reId: exercise.id, setIndex: currentSetIndex });
    if (!next) return 'DONE';
    if (next.reId === exercise.id) return 'Next Set →';

    const nextExercise = allExercises.find(ex => ex.id === next.reId);
    return nextExercise ? truncateName(nextExercise.exercises.name) + ' →' : 'DONE';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        {...panResponder.panHandlers}
      >
        {/* Header Section */}
        <View style={styles.header}>
        {/* PR Alert Banner */}
        {prAlertVisible && prAlert && (
          <Animated.View
            style={[
              styles.prAlertBanner,
              {
                transform: [
                  {
                    translateY: prAnimation.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-100, 0],
                    }),
                  },
                ],
                opacity: prAnimation,
              },
            ]}
          >
            <LinearGradient
              colors={['#FBBF24', '#F59E0B']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.prAlertGradient}
            >
              <Text style={styles.prAlertTrophy}>🏆</Text>
              <View>
                <Text style={styles.prAlertTitle}>NEW PERSONAL RECORD!</Text>
                <Text style={styles.prAlertMetric}>
                  {getMetricLabel(prAlert.metric, customMeasurements)}: {prAlert.value}
                </Text>
              </View>
            </LinearGradient>
          </Animated.View>
        )}

        {/* Exercise Title Row */}
        <View style={styles.titleRow}>
          {/* Back to Overview Button */}
          <TouchableOpacity
            style={styles.backToOverviewButton}
            onPress={onBackToOverview}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={16} color={LOGGER_COLORS.muted} />
          </TouchableOpacity>

          {/* Block Label as a visible pill — was tiny grey text, easy to
              miss. Now a small bordered chip beside the exercise name so
              superset (A1/A2) grouping is glanceable. */}
          {blockLabel && (
            <View style={styles.blockPill}>
              <Text style={styles.blockPillText}>{blockLabel}</Text>
            </View>
          )}

          {/* Exercise Name */}
          <Text style={styles.exerciseName} numberOfLines={2}>
            {exercise.exercises.name}
          </Text>

          {/* Position in the workout — "4 of 7" */}
          {exercisePosition && (
            <Text style={styles.exercisePosition}>
              {`${exercisePosition.index} of ${exercisePosition.total}`}
            </Text>
          )}

          {/* PR Trophy — now tappable, opens the PR popover. */}
          {exercise.tracked_max_metrics && exercise.tracked_max_metrics.length > 0 && (
            <TouchableOpacity
              onPress={() => setPRPopoverOpen(true)}
              hitSlop={10}
              activeOpacity={0.6}
              accessibilityLabel="View personal records"
            >
              <Text style={styles.headerPrTrophy}>🏆</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Variation chip — was buried in parentheses next to the
            exercise name. Now its own purple-tinted pill so the athlete
            sees they're on a variation at a glance. */}
        {exercise.selected_variation && (
          <View style={styles.variationPillWrap}>
            <View style={styles.variationPill}>
              <Text style={styles.variationPillText}>
                {exercise.selected_variation.toUpperCase()}
              </Text>
            </View>
          </View>
        )}

        {/* Tempo only shown in header */}
        {exercise.tempo && (
          <View style={styles.exerciseDetailsInline}>
            <Text style={styles.inlineDetail}>⏱ {exercise.tempo}</Text>
          </View>
        )}
      </View>

      {/* Superset progress pills — for supersets/circuits, show a small
          horizontal row of pills with each exercise's letter+number and
          set progress ("A1 2/3 · A2 1/3"). Current exercise highlighted in
          accent, completed exercises in green, others muted. */}
      {(() => {
        const ctx = getSupersetContext(routine, exercise.id, currentSetIndex, completedSets);
        if (!ctx || ctx.exercises.length <= 1) return null;
        return (
          <View style={styles.supersetPillsWrap}>
            {ctx.blockName && (
              <Text style={styles.supersetBlockName}>{ctx.blockName.toUpperCase()}</Text>
            )}
            <View style={styles.supersetPillsRow}>
              {(() => {
                // Block letter reflects the routine's position in the
                // workout (A, B, C…). blockLabel string from the parent
                // would be ideal, but we can derive a stable letter from
                // the FIRST exercise's code letter via the prop. Fall back
                // to 'A' if not provided — same convention used elsewhere.
                const blockLetter = (blockLabel || 'A').toString().charAt(0).toUpperCase();
                return ctx.exercises.map((ex, idx) => {
                  const code = `${blockLetter}${idx + 1}`; // A1, A2, A3…
                  const isCurrent = idx === ctx.currentExerciseIndex;
                  const isDone = ex.completedSets >= ex.totalSets;
                  const stateStyle = isCurrent
                    ? styles.supersetPillCurrent
                    : isDone
                    ? styles.supersetPillDone
                    : styles.supersetPillIdle;
                  const textStyle = isCurrent
                    ? styles.supersetPillTextCurrent
                    : isDone
                    ? styles.supersetPillTextDone
                    : styles.supersetPillTextIdle;
                  return (
                    <View key={ex.id} style={[styles.supersetPill, stateStyle]}>
                      <Text style={[styles.supersetPillLetter, textStyle]}>{code}</Text>
                      <Text style={[styles.supersetPillProgress, textStyle]}>
                        {ex.completedSets}/{ex.totalSets}
                      </Text>
                    </View>
                  );
                });
              })()}
            </View>
          </View>
        );
      })()}

      {/* Sets Section */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.setsScrollView}
        contentContainerStyle={styles.setsContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Coach Instructions — prominent, always-visible panel that
            consolidates everything the athlete needs to read before lifting
            (scrolls with the sets):
            block-level notes (routine.notes / text_info), the coach's
            exercise-level note (parsed with the same bullet logic the
            overview uses, so "; "-separated cues become a checklist), and
            the exercise library description in a muted style.
            Collapsed to a short preview by default; "more" opens it all. */}
        {(() => {
          const trim = (s: string | null | undefined) => (s ?? '').trim();
          const routineNote = trim((routine as any).notes);
          const routineTextInfo = trim((routine as any).text_info);
          const exerciseCoachNote = trim((exercise as any).notes);
          const exerciseDescription = trim((exercise.exercises as any)?.description);
          const parsedNote = exerciseCoachNote ? parseInstructionBlock(exerciseCoachNote) : null;
          // A coach note counts only if it parses to cues or callouts (a
          // headers-only note would leave an empty card).
          const noteHasContent =
            !!parsedNote &&
            (parsedNote.sections.some((sec) => sec.items.length > 0) || parsedNote.callouts.length > 0);
          const hasAnything =
            !!routineNote || !!routineTextInfo || noteHasContent || !!exerciseDescription;
          if (!hasAnything) return null;
          // Collapsed preview: the coach's first two cues, else the first
          // note we have. "more" appears only when there is more to read.
          const allCues = parsedNote ? parsedNote.sections.flatMap((sec) => sec.items) : [];
          const previewItems = allCues.slice(0, 2);
          const callouts = parsedNote?.callouts ?? [];
          const previewText = routineNote || routineTextInfo || exerciseDescription || callouts[0] || '';
          const hasMore = previewItems.length > 0
            ? allCues.length > 2 ||
              callouts.length > 0 ||
              (parsedNote?.sections.some((sec) => !!sec.header) ?? false) ||
              !!routineNote || !!routineTextInfo || !!exerciseDescription
            : [routineNote, routineTextInfo, exerciseDescription, ...callouts].filter(Boolean).length > 1 ||
              previewText.length > 120;
          // Nothing more to read → the preview is the whole card.
          const expanded = notesExpanded && hasMore;
          return (
            <View style={styles.coachPanel}>
              <TouchableOpacity
                style={styles.coachPanelHeader}
                onPress={() => hasMore && setNotesExpanded((v) => !v)}
                activeOpacity={hasMore ? 0.7 : 1}
                hitSlop={6}
              >
                <Text style={styles.coachPanelTitle}>Coach Instructions</Text>
                {hasMore && (
                  <Text style={styles.coachPanelChev}>{expanded ? 'less ▴' : 'more ▾'}</Text>
                )}
              </TouchableOpacity>
              {!expanded && (
                <View style={styles.coachPreview}>
                  {previewItems.length > 0
                    ? previewItems.map((item, idx) => (
                        <View key={idx} style={styles.coachBulletRow}>
                          <Text style={styles.coachBullet}>•</Text>
                          <Text style={styles.coachBulletText}>{item}</Text>
                        </View>
                      ))
                    : (
                        <Text style={styles.coachSectionBody} numberOfLines={3}>
                          {previewText}
                        </Text>
                      )}
                </View>
              )}
              {expanded && (
                <View style={styles.coachPanelBody}>
                  {/* Block context — what the coach said for this section */}
                  {!!routineNote && (
                    <View style={styles.coachSection}>
                      <Text style={styles.coachSectionLabel}>BLOCK NOTE</Text>
                      <Text style={styles.coachSectionBody}>{routineNote}</Text>
                    </View>
                  )}
                  {!!routineTextInfo && (
                    <View style={styles.coachSection}>
                      <Text style={styles.coachSectionLabel}>BLOCK INFO</Text>
                      <Text style={styles.coachSectionBody}>{routineTextInfo}</Text>
                    </View>
                  )}
                  {/* Exercise-level coach note, bullet-parsed */}
                  {!!parsedNote && (parsedNote.sections.length > 0 || parsedNote.callouts.length > 0) && (
                    <View style={styles.coachSection}>
                      <Text style={styles.coachSectionLabel}>COACH NOTE</Text>
                      {parsedNote.sections.map((section, sIdx) => (
                        <View key={sIdx} style={sIdx > 0 ? { marginTop: 6 } : undefined}>
                          {!!section.header && (
                            <Text style={styles.coachSectionHeader}>{section.header}</Text>
                          )}
                          {section.items.map((item, iIdx) => (
                            <View key={iIdx} style={styles.coachBulletRow}>
                              <Text style={styles.coachBullet}>•</Text>
                              <Text style={styles.coachBulletText}>{item}</Text>
                            </View>
                          ))}
                        </View>
                      ))}
                      {parsedNote.callouts.length > 0 && (
                        <View style={{ marginTop: 6 }}>
                          {parsedNote.callouts.map((c, cIdx) => (
                            <View key={cIdx} style={styles.coachBulletRow}>
                              <Text style={styles.coachCalloutIcon}>⚠</Text>
                              <Text style={styles.coachCalloutText}>{c}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                  {/* Library description — muted, italic, last */}
                  {!!exerciseDescription && (
                    <View style={styles.coachSection}>
                      <Text style={styles.coachSectionLabel}>HOW IT WORKS</Text>
                      <Text style={styles.coachDescription}>{exerciseDescription}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })()}
        {renderSetCards()}
      </ScrollView>

      {/* History — slide-up bottom sheet. Was previously an overlay panel
          that floated over the set cards; now it's a proper sheet with a
          dim backdrop, dismissable by tapping outside. */}
      <Modal
        visible={showHistory}
        transparent
        animationType="slide"
        onRequestClose={() => setShowHistory(false)}
      >
        <Pressable
          style={styles.historySheetBackdrop}
          onPress={() => setShowHistory(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={styles.historySheetCard}
          >
          <View style={styles.historySheetGrabber} />
          <View style={styles.historyPanelHeader}>
            <Text style={styles.historyPanelTitle}>Workout History</Text>
            <TouchableOpacity onPress={() => setShowHistory(false)} activeOpacity={0.7}>
              <Text style={styles.historyPanelClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.historyPanelScroll} showsVerticalScrollIndicator={false}>
            {(!exerciseHistory || exerciseHistory.length === 0) ? (
              <View style={styles.historyEmpty}>
                <Text style={styles.historyEmptyText}>No previous workout history for this exercise</Text>
              </View>
            ) : (
              exerciseHistory.slice(0, 10).map((workout, wIndex) => {
                const stats = computeSessionStats(workout.sets);
                const dateFormatted = new Date(workout.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                });
                const relativeTime = getRelativeTime(workout.date);

                return (
                  <View key={workout.id || wIndex} style={styles.historyWorkout}>
                    <View style={styles.historyDateRow}>
                      <Text style={styles.historyRelative}>{relativeTime}</Text>
                      <Text style={styles.historyDateFormatted}>{dateFormatted}</Text>
                    </View>
                    <View style={styles.historyStatsRow}>
                      {stats.totalReps > 0 && (
                        <View style={styles.historyStat}>
                          <Text style={styles.historyStatValue}>{stats.totalReps}</Text>
                          <Text style={styles.historyStatLabel}>reps</Text>
                        </View>
                      )}
                      {stats.maxWeight > 0 && (
                        <View style={styles.historyStat}>
                          <Text style={styles.historyStatValue}>{stats.maxWeight}</Text>
                          <Text style={styles.historyStatLabel}>max lb</Text>
                        </View>
                      )}
                      {stats.volume > 0 && (
                        <View style={styles.historyStat}>
                          <Text style={styles.historyStatValue}>{(stats.volume / 1000).toFixed(1)}k</Text>
                          <Text style={styles.historyStatLabel}>volume</Text>
                        </View>
                      )}
                      <View style={styles.historyStat}>
                        <Text style={styles.historyStatValue}>{stats.setsCount}</Text>
                        <Text style={styles.historyStatLabel}>sets</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Fixed Bottom Navigation */}
      <View
        style={styles.bottomNav}
        onLayout={(e) => setBottomBarHeight(e.nativeEvent.layout.height)}
      >
        <View style={[styles.bottomNavGradient, { paddingBottom: Math.max(insets.bottom - 8, 16) }]}>
          <View style={styles.bottomNavContainer}>
            {/* History Button — anchors the left edge so the bar reads
                [utility] [primary CTA centered] [utility]. The previous
                layout bunched both squares on the left and shoved Log Set
                to the right, which felt off-balance. */}
            <TouchableOpacity
              style={[styles.historyButton, showHistory && styles.historyButtonActive]}
              onPress={() => setShowHistory(!showHistory)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="History"
            >
              <Ionicons
                name="stats-chart"
                size={18}
                color={showHistory ? LOGGER_COLORS.accent : 'rgba(255,255,255,0.7)'}
              />
            </TouchableOpacity>

            {/* Next Set / Next Exercise / DONE Button */}
            {(() => {
              const currentSetCompleted = isSetCompleted(currentSetIndex);
              const nextText = getNextButtonText();
              const isNotesOnly = metricFields.length === 0;

              // For notes-only exercises, always show navigation (skip "Log Set")
              // They just need to see the content and move on
              if (isNotesOnly) {
                // For notes-only, determine what to show
                const currentExerciseIndex = allExercises.findIndex(ex => ex.id === exercise.id);
                const isLastExercise = currentExerciseIndex >= allExercises.length - 1;

                if (isLastExercise) {
                  return (
                    <TouchableOpacity
                      style={styles.nextSetButton}
                      onPress={onNextSet}
                      activeOpacity={0.85}
                    >
                      <LinearGradient
                        colors={['#10B981', '#059669']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.nextSetButtonGradient}
                      >
                        <Text style={[styles.nextSetButtonIcon, { color: '#FFFFFF' }]}>✓</Text>
                        <Text style={[styles.nextSetButtonText, { color: '#FFFFFF' }]}>DONE</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  );
                }

                // Show next exercise name
                const nextExercise = allExercises[currentExerciseIndex + 1];
                const nextExerciseName = nextExercise ? truncateName(nextExercise.exercises.name) + ' →' : 'Next';

                return (
                  <TouchableOpacity
                    style={styles.nextSetButton}
                    onPress={onNextSet}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={['#9BDDFF', '#5BB8E8'] as const}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.nextSetButtonGradient}
                    >
                      <Text style={styles.nextSetButtonIcon}>›</Text>
                      <Text style={styles.nextSetButtonText}>{nextExerciseName}</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              }

              const isDone = nextText === 'DONE' && currentSetCompleted;
              const gradientColors = isDone
                ? (['#10B981', '#059669'] as const)
                : (['#9BDDFF', '#5BB8E8'] as const);
              const label = isDone
                ? 'DONE'
                : !currentSetCompleted
                  ? 'Log Set'
                  : nextText;
              const icon = isDone || !currentSetCompleted ? '✓' : '›';

              const contentColorStyle = isDone ? { color: '#FFFFFF' } : null;

              return (
                <TouchableOpacity
                  style={styles.nextSetButton}
                  onPress={handleNextButtonPress}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={gradientColors}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.nextSetButtonGradient}
                  >
                    <Text style={[styles.nextSetButtonIcon, contentColorStyle]}>{icon}</Text>
                    <Text style={[styles.nextSetButtonText, contentColorStyle]}>{label}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              );
            })()}

            {/* Overview Button — anchors the right edge to balance History */}
            <TouchableOpacity
              style={styles.overviewButton}
              onPress={onBackToOverview}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Overview"
            >
              <Ionicons name="menu" size={20} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>

      {/* Floating demo video — overlays the screen without blocking logging;
          while the numeric keypad is open the ▶ hides and an open window
          collapses (paused), coming back when the keypad closes. */}
      {hasVideo(videoUrl) && !activeInput && !floatingVideoOpen && (
        <FloatingVideoButton url={videoUrl} bottom={bottomBarHeight + 14} onPress={openVideo} />
      )}
      {floatingVideoOpen && videoId && (
        <FloatingVideoWindow
          videoId={videoId}
          title={exercise.exercises.name}
          bottom={bottomBarHeight + 12}
          keypadOpen={!!activeInput}
          onClose={() => setFloatingVideoOpen(false)}
          onExpand={() => {
            setFloatingVideoOpen(false);
            setFullVideoId(videoId);
          }}
        />
      )}
      <VideoModal videoId={fullVideoId} onClose={() => setFullVideoId(null)} />

      {/* Custom Numeric Keypad */}
      {activeInput && (
        <NumericKeypad
          onKeyPress={handleKeypadPress}
          onBackspace={handleKeypadBackspace}
          onDone={handleKeypadDone}
          showDecimal={true}
          hasNextField={metricFields.indexOf(activeInput.metricId) < metricFields.length - 1}
        />
      )}

      {/* PR popover — opens when the trophy in the header is tapped.
          Reads from the cached athleteMaxes object that's already on
          this component, so no fetch needed. Lists each tracked metric
          with the athlete's all-time best. */}
      <Modal
        visible={prPopoverOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPRPopoverOpen(false)}
      >
        <Pressable
          style={styles.prPopoverBackdrop}
          onPress={() => setPRPopoverOpen(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={styles.prPopoverCard}
          >
            <View style={styles.prPopoverHeader}>
              <Text style={styles.prPopoverEyebrow}>PERSONAL RECORDS</Text>
              <Text style={styles.prPopoverTitle} numberOfLines={1}>
                {exercise.exercises.name}
              </Text>
            </View>
            {(exercise.tracked_max_metrics ?? []).length === 0 ? (
              <Text style={styles.prPopoverEmpty}>
                No tracked PR metrics on this exercise yet.
              </Text>
            ) : (
              <View style={styles.prPopoverList}>
                {(exercise.tracked_max_metrics ?? []).map((metricId) => {
                  const max = athleteMaxes[exercise.exercise_id]?.[metricId] ?? null;
                  const label = getMetricLabel(metricId, customMeasurements);
                  return (
                    <View key={metricId} style={styles.prPopoverRow}>
                      <Text style={styles.prPopoverRowLabel}>{label}</Text>
                      <Text
                        style={[
                          styles.prPopoverRowValue,
                          { color: max != null ? '#FBBF24' : '#4b5563' },
                        ]}
                      >
                        {max != null ? max : '—'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
            <TouchableOpacity
              style={styles.prPopoverCloseBtn}
              onPress={() => setPRPopoverOpen(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.prPopoverCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: LOGGER_COLORS.bg,
  },
  keyboardAvoidingContainer: {
    flex: 1,
    backgroundColor: LOGGER_COLORS.bg,
  },
  header: {
    backgroundColor: LOGGER_COLORS.bg,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.07)',
  },
  prAlertBanner: {
    marginBottom: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
  prAlertGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
  prAlertTrophy: {
    fontSize: 20,
  },
  prAlertTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#000000',
  },
  prAlertMetric: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backToOverviewButton: {
    width: 34,
    height: 30,
    backgroundColor: '#111214',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prevButton: {
    width: 32,
    height: 32,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prevButtonIcon: {
    fontSize: 16,
    color: '#60A5FA',
  },
  blockLabelText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    marginRight: 8,
  },
  // Block pill — replaces the dim "A3" text with a visible cyan-tinted
  // chip so superset grouping is obvious at a glance.
  blockPill: {
    minWidth: 30,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockPillText: {
    color: LOGGER_COLORS.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  // Variation pill — was tiny text in parens, now a purple-tinted chip
  // on its own row under the exercise name. Same visual language as
  // category pills used elsewhere on the dashboard.
  variationPillWrap: {
    flexDirection: 'row',
    paddingTop: 6,
    paddingLeft: 44, // align under the code chip (past the back btn)
  },
  variationPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(192,132,252,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.35)',
  },
  variationPillText: {
    color: '#C084FC',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  // PR popover (opens when the trophy is tapped)
  prPopoverBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  prPopoverCard: {
    width: '100%',
    backgroundColor: '#0d0d0d',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.25)',
    overflow: 'hidden',
  },
  prPopoverHeader: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  prPopoverEyebrow: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  prPopoverTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 4,
  },
  prPopoverEmpty: {
    color: '#9ca3af',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 24,
    paddingHorizontal: 18,
    textAlign: 'center',
  },
  prPopoverList: {
    paddingVertical: 6,
  },
  prPopoverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  prPopoverRowLabel: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '700',
  },
  prPopoverRowValue: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  prPopoverCloseBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  prPopoverCloseText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
  },
  exerciseName: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.6,
    color: LOGGER_COLORS.text,
  },
  exercisePosition: {
    color: LOGGER_COLORS.muted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  variationText: {
    color: '#C084FC',
    fontSize: 14,
    fontWeight: 'normal',
    textTransform: 'none',
  },
  headerPrTrophy: {
    fontSize: 18,
  },
  nextButton: {
    width: 32,
    height: 32,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextButtonIcon: {
    fontSize: 16,
    color: '#6EE7B7',
  },
  exerciseDetailsInline: {
    marginTop: 6,
    paddingLeft: 44,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inlineDetail: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 16,
  },
  // Legacy styles kept for compatibility
  exerciseDetailsSection: {
    marginTop: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  tempoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.2)',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
  },
  tempoIcon: {
    fontSize: 14,
  },
  tempoText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9BDDFF',
  },
  notesContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  notesIcon: {
    fontSize: 14,
    marginTop: 2,
  },
  exerciseNotes: {
    flex: 1,
    fontSize: 13,
    color: '#D4D4D4',
    lineHeight: 18,
  },
  descriptionContainer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  descriptionIcon: {
    fontSize: 14,
    marginTop: 2,
  },
  exerciseDescription: {
    flex: 1,
    fontSize: 12,
    color: '#A3A3A3',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  exerciseNotesSection: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  // Collapsible notes accordion — replaces the always-visible notes box.
  notesAccordion: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  // Prominent coach-instructions panel — replaces the muted accordion so the
  // athlete actually sees what the coach wrote, with bulleted parsing for
  // "; "-separated cues.
  // Superset progress pills (A1 2/3 · A2 1/3)
  supersetPillsWrap: {
    marginHorizontal: 14,
    marginTop: 10,
  },
  supersetBlockName: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 6,
  },
  supersetPillsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  supersetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  supersetPillCurrent: {
    backgroundColor: 'rgba(155,221,255,0.16)',
    borderColor: 'rgba(155,221,255,0.55)',
  },
  supersetPillDone: {
    backgroundColor: 'rgba(0,255,85,0.10)',
    borderColor: 'rgba(0,255,85,0.35)',
  },
  supersetPillIdle: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  supersetPillLetter: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  supersetPillProgress: {
    fontSize: 11,
    fontWeight: '600',
  },
  supersetPillTextCurrent: { color: '#9BDDFF' },
  supersetPillTextDone: { color: '#7ef0a8' },
  supersetPillTextIdle: { color: 'rgba(255,255,255,0.6)' },
  coachPanel: {
    backgroundColor: '#111214',
    borderWidth: 1,
    borderColor: LOGGER_COLORS.hairline,
    borderLeftWidth: 3,
    borderLeftColor: LOGGER_COLORS.accent,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  coachPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  coachPanelTitle: {
    flex: 1,
    color: LOGGER_COLORS.text,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  coachPanelChev: { color: LOGGER_COLORS.muted, fontSize: 11 },
  coachPanelBody: { marginTop: 8, gap: 10 },
  coachPreview: { marginTop: 6 },
  coachSection: { gap: 4 },
  coachSectionLabel: {
    color: LOGGER_COLORS.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  coachSectionBody: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    lineHeight: 18,
  },
  coachSectionHeader: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  coachBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 3,
  },
  coachBullet: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    lineHeight: 18,
    width: 8,
  },
  coachBulletText: {
    flex: 1,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    lineHeight: 18,
  },
  coachCalloutIcon: {
    color: '#FBBF24',
    fontSize: 13,
    lineHeight: 19,
    width: 14,
  },
  coachCalloutText: {
    flex: 1,
    color: '#FCD34D',
    fontSize: 13,
    lineHeight: 19,
  },
  coachDescription: {
    color: '#A3A3A3',
    fontSize: 13,
    lineHeight: 19,
    fontStyle: 'italic',
  },
  notesAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  notesAccordionIcon: { fontSize: 13 },
  notesAccordionTitle: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  notesAccordionChev: { color: '#9ca3af', fontSize: 11 },
  notesAccordionBody: {
    paddingTop: 8,
    paddingHorizontal: 4,
    gap: 6,
  },
  coachNoteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  coachNoteIcon: {
    fontSize: 14,
    marginTop: 1,
  },
  coachNoteText: {
    flex: 1,
    fontSize: 14,
    color: '#E5E5E5',
    lineHeight: 20,
  },
  descriptionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  descriptionText: {
    flex: 1,
    fontSize: 13,
    color: '#A3A3A3',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  setsScrollView: {
    flex: 1,
  },
  setsContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 130,
    gap: 8,
  },
  historySection: {
    marginBottom: 12,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#A3A3A3',
  },
  historyToggle: {
    fontSize: 10,
    color: '#737373',
  },
  historyContent: {
    marginTop: 8,
    gap: 8,
  },
  // Slide-up sheet wrapper for the workout-history Modal.
  historySheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  historySheetCard: {
    maxHeight: '70%',
    backgroundColor: '#0d0d0d',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingBottom: 20,
  },
  historySheetGrabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginTop: 10,
    marginBottom: 8,
  },
  historyPanel: {
    position: 'absolute',
    bottom: 75,
    left: 8,
    right: 8,
    maxHeight: 250,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#404040',
    zIndex: 50,
    overflow: 'hidden',
  },
  historyPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
    backgroundColor: '#222222',
  },
  historyPanelTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E5E5E5',
  },
  historyPanelClose: {
    fontSize: 16,
    color: '#737373',
    padding: 4,
  },
  historyPanelScroll: {
    padding: 12,
  },
  historyEmpty: {
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 6,
    alignItems: 'center',
  },
  historyEmptyText: {
    fontSize: 13,
    color: '#525252',
    fontStyle: 'italic',
  },
  historyWorkout: {
    marginBottom: 8,
    padding: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 6,
    borderLeftWidth: 2,
    borderLeftColor: '#525252',
  },
  historyDateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historyRelative: {
    fontSize: 12,
    fontWeight: '600',
    color: '#A3A3A3',
  },
  historyDateFormatted: {
    fontSize: 11,
    color: '#525252',
  },
  historyStatsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  historyStat: {
    alignItems: 'center',
  },
  historyStatValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E5E5E5',
  },
  historyStatLabel: {
    fontSize: 10,
    color: '#737373',
    marginTop: 2,
  },
  setCard: {
    backgroundColor: '#0E1013',
    borderWidth: 1,
    borderColor: LOGGER_COLORS.hairline,
    borderRadius: 14,
    padding: 12,
  },
  // Collapsed set row — used for completed and upcoming sets so only the
  // active set occupies a full card. One-line summary, tappable to expand.
  setRowCollapsed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0E0F11',
    borderWidth: 1,
    borderColor: LOGGER_COLORS.hairline,
  },
  setRowCollapsedDone: {
    backgroundColor: 'rgba(16,185,129,0.04)',
  },
  setRowCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setRowCheckDone: {
    backgroundColor: LOGGER_COLORS.green,
    borderColor: LOGGER_COLORS.green,
  },
  setRowCheckIcon: {
    color: '#04130C',
    fontSize: 11,
    fontWeight: '900',
  },
  setRowLabel: {
    color: LOGGER_COLORS.text,
    fontSize: 14,
    fontWeight: '700',
  },
  setRowBody: { flex: 1, minWidth: 0 },
  setRowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Done set: "220 × 2 · RPE 8.5 · +5 lb over last week" in green.
  setResultLine: {
    marginTop: 2,
    color: LOGGER_COLORS.green,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  // Upcoming set: its target, muted.
  setTargetLine: {
    marginTop: 2,
    color: LOGGER_COLORS.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  setRowRpeMissing: {
    color: LOGGER_COLORS.rpe,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  setRowEdit: {
    color: LOGGER_COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  // Subtle "Saved" tick under the active set. Briefly visible on each
  // input change so the athlete knows the value landed.
  savedTick: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 8,
    alignSelf: 'flex-end',
  },
  // Brief green highlight applied to inputs that just got auto-filled
  // (either by completing the set checkbox or by the inter-metric
  // auto-fill on Done/Next). Visible for ~600ms.
  inputAutoFilled: {
    borderColor: LOGGER_COLORS.green,
    backgroundColor: 'rgba(16,185,129,0.10)',
  },
  setCardCompleted: {
    borderColor: 'rgba(16, 185, 129, 0.3)',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  setCardCurrent: {
    borderColor: 'rgba(155, 221, 255, 0.45)',
  },
  setHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  setHeaderText: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
    color: LOGGER_COLORS.text,
  },
  setHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  setHeaderCaption: {
    color: LOGGER_COLORS.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  // "last week 215 × 2" under the set header.
  lastWeekLine: {
    marginTop: 3,
    color: '#737373',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  completionCheckmark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  completionCheckmarkCompleted: {
    backgroundColor: LOGGER_COLORS.green,
    borderColor: LOGGER_COLORS.green,
  },
  checkmarkIcon: {
    fontSize: 11,
    color: '#04130C',
    fontWeight: '900',
  },
  checkmarkIconEmpty: {
    color: 'transparent',
  },
  // Unused legacy styles kept for reference
  _targetIcon: {
    fontSize: 16,
  },
  _intensityText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#93C5FD',
  },
  metricsGrid: {
    flexDirection: 'column',
    gap: 10,
    marginTop: 10,
  },
  nonBallMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricInput: {
    flex: 1,
    minWidth: '40%',
  },
  metricInputWide: {
    flex: 1.4,
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
    gap: 6,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: LOGGER_COLORS.muted,
  },
  metricLabelWithIcon: {
    marginLeft: 0,
  },
  input: {
    height: 48,
    paddingHorizontal: 12,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: LOGGER_COLORS.hairline,
    borderRadius: 10,
    justifyContent: 'center',
  },
  inputText: {
    fontSize: 22,
    fontWeight: '700',
    color: LOGGER_COLORS.text,
    fontVariant: ['tabular-nums'],
  },
  inputPlaceholder: {
    color: '#737373',
  },
  inputPrompt: {
    fontSize: 14,
    fontWeight: '500',
  },
  inputActive: {
    borderColor: LOGGER_COLORS.accent,
  },
  inputFilled: {
    borderColor: 'rgba(155, 221, 255, 0.3)',
  },
  // Ball metric group styles
  ballMetricGroup: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
    padding: 8,
    gap: 8,
    minWidth: '100%',
  },
  ballGroupHeader: {
    width: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 16,
  },
  ballGroupInputs: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ballGroupMetricInput: {
    flexBasis: '45%',
    flexGrow: 1,
    maxWidth: '48%',
  },
  ballGroupMetricLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    color: LOGGER_COLORS.muted,
    marginBottom: 4,
    textAlign: 'center',
  },
  ballGroupInput: {
    height: 44,
    paddingHorizontal: 8,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: LOGGER_COLORS.hairline,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Per-set coach note — repainted from amber to the brand cyan so it
  // matches the rest of the app's accent palette (#9BDDFF). The amber
  // had drifted out of the global theme.
  setNotesDisplay: {
    width: '100%',
    backgroundColor: 'rgba(155, 221, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
  },
  setNotesText: {
    fontSize: 13,
    color: '#9BDDFF',
    fontStyle: 'italic',
  },
  notesField: {
    width: '100%',
  },
  notesInput: {
    minHeight: 60,
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 21,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 40,
  },
  bottomNavGradient: {
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: LOGGER_COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  bottomNavContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    width: '100%',
  },
  // History + Overview are compact icon-only squares so the primary
  // Log Set / Next action can dominate the bottom bar instead of being
  // visually equal to two utility buttons.
  historyButton: {
    width: 52,
    height: 52,
    backgroundColor: '#111214',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyButtonActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.12)',
    borderColor: LOGGER_COLORS.accent,
  },
  overviewButton: {
    width: 52,
    height: 52,
    backgroundColor: '#111214',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prevExerciseButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: '#1E3A5F',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  prevExerciseButtonIcon: {
    fontSize: 14,
    color: '#93C5FD',
  },
  prevExerciseButtonText: {
    fontSize: 9,
    color: '#93C5FD',
    marginTop: 2,
  },
  // Primary action button — solid gradient fill, slightly taller than the
  // 44px utility squares so the CTA wins the visual hierarchy. The shell
  // is just a container; the gradient does the painting.
  nextSetButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
    minWidth: 0,
  },
  nextSetButtonGradient: {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  nextSetButtonIcon: {
    fontSize: 16,
    fontWeight: '900',
    color: '#06202E',
  },
  nextSetButtonText: {
    fontSize: 16,
    color: '#06202E',
    fontWeight: '800',
  },
  emptyButton: {
    flex: 1,
  },
});

const instructionStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sectionSpaced: {
    marginTop: 14,
  },
  header: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A5B4FC',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  bullet: {
    fontSize: 14,
    color: '#818CF8',
    marginRight: 8,
    lineHeight: 20,
  },
  item: {
    flex: 1,
    fontSize: 14,
    color: '#E5E7EB',
    lineHeight: 20,
  },
  callout: {
    marginTop: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  calloutIcon: {
    fontSize: 14,
    color: '#FBBF24',
    marginRight: 8,
    lineHeight: 18,
  },
  calloutText: {
    flex: 1,
    fontSize: 13,
    color: '#FCD34D',
    lineHeight: 18,
  },
  empty: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  emptyText: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#A5B4FC',
    textAlign: 'center',
  },
});
