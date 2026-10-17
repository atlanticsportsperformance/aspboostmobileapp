import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { lastSession, type LogRow, type SetResult } from '../lib/logger/lastWeek';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  PanResponder,
  Modal,
  Pressable,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import NumericKeypad from '../components/NumericKeypad';
import {
  backoffUpdates,
  fieldKey,
  intensityCaptionText,
  intensityFor,
  isBackoffReference,
  prescribedValue,
  resolveTarget,
  type IntensityResult,
} from '../lib/logger/targets';
import { parseInstructionBlock } from '../lib/instructionBlockParser';
import { formatRest } from '../lib/logger/rest';
import { canStep, showSteppers, stepValue, tableColumnWidth } from '../lib/logger/stepper';
import { normalizeScheme } from '../lib/logger/scheme';

// Types
import type {
  Measurement,
  SetConfiguration,
  LoggerRoutineExercise as RoutineExercise,
  LoggerRoutine as Routine,
} from '../types/logger';
import { neighborExercise, nextStep, type SeqStep } from '../lib/logger/sequence';
import RpeRow from '../components/logger/RpeRow';
import InlineDemoVideo from '../components/logger/InlineDemoVideo';
import VideoModal from '../components/logger/VideoModal';
import { hasVideo, youTubeId } from '../lib/video';
import { LOGGER_COLORS } from '../lib/logger/theme';
import { getMeasurementName, getMetricLabel, tableFieldsFor } from '../lib/logger/setLine';
import RackBanner, { type RackScreenProps } from '../components/logger/RackBanner';
import SensorButton, { type SensorButtonProps } from '../components/logger/SensorButton';
import LiveRepRow from '../components/logger/LiveRepRow';
import { RACK_COLORS, liveDoneLabel, rackSummaryLine, type ChipView, type LiveSource } from '../lib/rack/phoneView';

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

/** The live set on this exercise (rack VBT; Task 10b reuses it with source 'sensor'). */
export interface ExerciseLiveSet {
  /** 0-based row being lifted — from rack_sessions.set_number, NOT the phone's open row. */
  setIndex: number;
  source: LiveSource;
  rackName: string | null;
  chips: ChipView[];
  /** REPS cell = full reps only. */
  fullReps: number;
  /** Prescribed reps for that set ("3 / 5"); null when none. */
  repsTarget: number | null;
  /** A set is being lifted now (Done ends it on the rack). */
  lifting: boolean;
  /** "Speed dropped N% — rack it" threshold crossed (zone exercises only). */
  dropCue: number | null;
}

export interface ExerciseRackProps extends RackScreenProps {
  live: ExerciseLiveSet | null;
  /** Rack-owned sets waiting for the rack's row, by 0-based set of THIS exercise. */
  saving: Record<number, 'saving' | 'timeout'>;
  /** Sets the rack saved after 60 s with no rep. */
  idleSaved: number[];
  /** Done (or the circle) while a rack set is being lifted. */
  onLiveDone: () => void;
  /** Keypad open/closed — the phone never follows the rack while typing. */
  onEditingChange?: (editing: boolean) => void;
  /** Real pull-to-refresh: rack state + pending set rows. */
  onPullRefresh: () => void;
  refreshing: boolean;
  /** Pull-to-refresh only when the org has racks (not for the phone sensor alone). */
  canRefresh?: boolean;
  /** Extra rack sets past the prescription (set N+1…), read-only; live while being lifted. */
  extraSets?: ExtraRackSet[];
  /**
   * While active: where the rack goes once the set at `setIndex` is done and
   * this exercise is finished (same resolver as the iPad) — the Next CTA
   * points there instead of the logger's own next exercise. null = no change.
   */
  rackNextAfter?: (setIndex: number) => { reId: string; name: string } | null;
}

export interface ExtraRackSet {
  setNumber: number;
  /** "4 × 205" style values line (null while saving / live). */
  values: string | null;
  /** "RACK · avg 0.71 · best 0.78 m/s". */
  rackLine: string | null;
  live: boolean;
  saving: 'saving' | 'timeout' | null;
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
  allExercises: RoutineExercise[];
  // Whole-workout set order from buildSequence (lib/logger/sequence.ts)
  sequence: SeqStep[];
  hasPrev: boolean;
  hasNext: boolean;
  blockLabel?: string;
  exerciseHistory?: ExerciseHistory[];
  /** Raw completed logs for lastSession() — the LAST column. */
  lastWeekRows?: LogRow[];
  /** Today's workout instance — excluded from "last week". */
  workoutInstanceId?: string;
  /** Live rest countdown (useRestTimer); null when no rest is running. */
  restSecondsLeft?: number | null;
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
  /** Tap a set row → it becomes the current set (parent's currentSetIndex). */
  onSelectSet: (setIndex: number) => void;
  /** Rack VBT (banner + live row); absent / !hasRacks = the logger as before. */
  rack?: ExerciseRackProps | null;
  /** Phone-direct sensor control (Task 10b); null = hidden (on a rack / not self). */
  sensor?: SensorButtonProps | null;
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

// Dot color for a ball measurement (by name: plyo colors, then oz weights).
// "4 oz" is checked before 5 oz / baseball so it never reads as a 5 oz ball.
function ballColor(name: string): string {
  const t = name.toLowerCase();
  const oz = /\d\s*oz|\d_oz/.test(t);
  if (t.includes('blue')) return '#3B82F6';
  if (t.includes('red') && !oz) return '#E5534B';
  if (t.includes('yellow')) return '#E8C547';
  if (t.includes('gray') || t.includes('grey')) return '#6B7280';
  if (t.includes('green') && !oz) return '#22C55E';
  if (/\b7\s*oz\b|7_oz/.test(t)) return '#EA580C';
  if (/\b6\s*oz\b|6_oz/.test(t)) return '#7C3AED';
  if (/\b4\s*oz\b|4_oz/.test(t)) return '#2563EB';
  if (/\b3\s*oz\b|3_oz/.test(t)) return '#16A34A';
  if (/\b5\s*oz\b|5_oz/.test(t) || t.includes('baseball')) return '#F5F5F5';
  return 'rgba(255,255,255,0.4)';
}

// "Red Ball" → "Red"; anything else as written.
function shortBallName(name: string): string {
  return name.replace(/\s+ball$/i, '').trim() || name;
}

const isNumberText = (s: string) => /^-?\d+(\.\d+)?$/.test(s);

// A coach set note that says the same as the intensity caption: the same
// text, or only a percentage ("-10% of top set", "90%").
function noteRepeatsCaption(note: string, caption: string): boolean {
  const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
  const n = norm(note);
  if (n === norm(caption)) return true;
  return /^[-+]?\d+(\.\d+)?\s*%(\s+of\s+[a-z0-9 ]+)?\.?$/.test(n);
}
const isEmptyValue = (v: unknown) => v == null || v === '';

// One paired measurement (ball × reps × mph) — a line inside every set.
interface PairedLine {
  id: string;
  name: string;
  color: string;
  repsId: string | null;
  mphId: string | null;
  tracked: boolean;
}

export default function ExerciseDetailView({
  exercise,
  routine,
  customMeasurements,
  athleteMaxes,
  moundVelocity,
  exerciseInputs,
  completedSets,
  currentSetIndex,
  allExercises,
  sequence,
  hasPrev,
  hasNext,
  blockLabel,
  exerciseHistory,
  lastWeekRows,
  workoutInstanceId,
  restSecondsLeft,
  onInputChange,
  onToggleSetComplete,
  rpeValues,
  onRpeChange,
  onNextSet,
  onPrevExercise,
  onNextExercise,
  onBackToOverview,
  onSelectSet,
  rack,
  sensor = null,
}: ExerciseDetailViewProps) {
  // Rack VBT — every piece below is guarded by hasRacks + an active live set.
  const rackLive = rack?.hasRacks ? rack.live : null;
  const isLiveRow = (setIndex: number) => !!rackLive && rackLive.setIndex === setIndex;
  const rackSaving = (setIndex: number) => (rack?.hasRacks ? rack.saving[setIndex] ?? null : null);
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  // Text blocks have no joined exercise (navigation skips them; guard anyway).
  const exerciseName = exercise.exercises?.name ?? exercise.placeholder_name ?? '';
  const videoUrl = exercise.exercises?.video_url || null;
  const videoId = youTubeId(videoUrl);
  const [showHistory, setShowHistory] = useState(false);
  // Coach note: one line by default; "more" opens block notes + the library
  // description too.
  const [notesExpanded, setNotesExpanded] = useState(false);
  // PR popover — tapping the 🏆 pill in the header.
  const [prPopoverOpen, setPRPopoverOpen] = useState(false);
  // Auto-fill pulse tracker — "setIndex:metricId" keys just auto-filled;
  // those inputs briefly flash green so the athlete sees it happen.
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
  // ⤢ on the inline demo → full-screen VideoModal.
  const [fullVideoId, setFullVideoId] = useState<string | null>(null);
  // Measured bottom-bar height (scroll padding under the last set).
  const [bottomBarHeight, setBottomBarHeight] = useState(80);

  // Custom keypad state
  const [activeInput, setActiveInput] = useState<{
    setIndex: number;
    metricId: string;
    isDecimal: boolean;
  } | null>(null);

  // Sets render in set order and the current one opens in place, so a new
  // current set is scrolled into view: set 1 → top (coach note visible), a
  // later set → its row with the set before it still showing above.
  // setYRef holds each set's y in the scroll content (from onLayout); the
  // scroll runs once that layout is known — on the timer or, if the layout
  // lands later, on the current set's onLayout.
  const scrollViewRef = useRef<ScrollView>(null);
  const setYRef = useRef<Record<number, number>>({});
  const scrollPendingRef = useRef(false);
  const scrollToCurrentSet = () => {
    if (currentSetIndex <= 0) {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      return true;
    }
    const y = setYRef.current[currentSetIndex - 1] ?? setYRef.current[currentSetIndex];
    if (y == null) return false;
    scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    return true;
  };
  const onSetLayout = (setIndex: number, y: number) => {
    setYRef.current[setIndex] = y;
    if (setIndex === currentSetIndex && scrollPendingRef.current && scrollToCurrentSet()) {
      scrollPendingRef.current = false;
    }
  };
  useEffect(() => {
    scrollPendingRef.current = true;
    const t = setTimeout(() => {
      if (scrollPendingRef.current && scrollToCurrentSet()) scrollPendingRef.current = false;
    }, 100);
    return () => clearTimeout(t);
  }, [currentSetIndex, exercise.id]);

  // Rack VBT: the rack's live row scrolls into view when it isn't the open row.
  const rackLiveIndex = rackLive?.setIndex ?? null;
  useEffect(() => {
    if (rackLiveIndex == null || rackLiveIndex === currentSetIndex) return;
    const y = setYRef.current[rackLiveIndex];
    if (y != null) scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackLiveIndex]);

  // Rack VBT: tell the parent when a field is being typed in (follow waits for blur).
  const rackOnEditingChange = rack?.hasRacks ? rack.onEditingChange : undefined;
  useEffect(() => {
    rackOnEditingChange?.(activeInput != null);
  }, [activeInput != null, rackOnEditingChange]);

  // Done → advance, a tapped row, or a new exercise closes the keypad, so
  // keystrokes never land in a collapsed set or the next exercise.
  useEffect(() => {
    setActiveInput(null);
  }, [currentSetIndex, exercise.id]);

  // A custom measurement's metric type ('integer' | 'decimal' | …).
  const metricTypeOf = (metricId: string): string | undefined => {
    const m = customMeasurements.find((x) => x.primary_metric_id === metricId || x.secondary_metric_id === metricId);
    return m?.primary_metric_id === metricId ? m?.primary_metric_type : m?.secondary_metric_type;
  };
  const measurementOf = (metricId: string): Measurement | undefined =>
    customMeasurements.find((x) => x.primary_metric_id === metricId || x.secondary_metric_id === metricId);

  // Metric fields to log: enabled measurements plus anything the coach
  // prescribed (reps = 2 per set on a weight-only Back Squat); weight, reps,
  // then the rest (ball metrics heaviest → lightest).
  const metricFields = tableFieldsFor(exercise, customMeasurements);
  const trackedMetrics = exercise.tracked_max_metrics ?? [];

  // Table layout: every non-paired metric is its own column; paired
  // measurements (custom_measurements category 'paired', e.g. red_ball →
  // red_ball_reps / red_ball_velo) become one line per ball inside each set,
  // under shared BALL · REPS · MPH columns.
  const { singleMetrics, pairedLines } = useMemo(() => {
    const singles: string[] = [];
    const lines: PairedLine[] = [];
    const seen = new Set<string>();
    for (const metricId of metricFields) {
      const m = measurementOf(metricId);
      if (m?.category !== 'paired') {
        singles.push(metricId);
        continue;
      }
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const repsId = m.primary_metric_id && metricFields.includes(m.primary_metric_id) ? m.primary_metric_id : null;
      const mphId = m.secondary_metric_id && metricFields.includes(m.secondary_metric_id) ? m.secondary_metric_id : null;
      lines.push({
        id: m.id,
        name: shortBallName(m.name),
        color: ballColor(m.name),
        repsId,
        mphId,
        tracked: (!!repsId && trackedMetrics.includes(repsId)) || (!!mphId && trackedMetrics.includes(mphId)),
      });
    }
    return { singleMetrics: singles, pairedLines: lines };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from the exercise + measurements only
  }, [exercise, customMeasurements]);

  // Keypad order = screen order: single columns, then each ball's reps → mph.
  const inputOrder = useMemo(
    () => [
      ...singleMetrics,
      ...pairedLines.flatMap((l) => [l.repsId, l.mphId].filter((x): x is string => !!x)),
    ],
    [singleMetrics, pairedLines],
  );

  // Header for a column: "LB", "REPS", "TIME", "DISTANCE", custom name.
  const columnLabel = (metricId: string): string => {
    if (metricId === 'weight') return 'LB';
    if (metricId === 'reps') return 'REPS';
    if (metricId === 'time_seconds') return 'TIME';
    if (metricId === 'distance') return 'DISTANCE';
    return (getMeasurementName(metricId, customMeasurements) ?? getMetricLabel(metricId, customMeasurements)).toUpperCase();
  };
  // Unit after a number in a cell.
  const unitFor = (metricId: string): string | null => {
    if (metricId === 'weight') return 'lb';
    if (metricId === 'distance') return 'ft';
    if (metricId === 'time_seconds') return 's';
    return null;
  };
  const isVeloName = (name?: string) => /velo|mph|speed/i.test(name ?? '');
  // Paired column headers from the first measurement ("REPS" · "MPH").
  const pairedMeasurement = pairedLines.length ? customMeasurements.find((m) => m.id === pairedLines[0].id) : undefined;
  const pairedRepsLabel = (pairedMeasurement?.primary_metric_name || 'Reps').toUpperCase();
  const pairedMphLabel = !pairedMeasurement?.secondary_metric_name || isVeloName(pairedMeasurement.secondary_metric_name)
    ? 'MPH'
    : pairedMeasurement.secondary_metric_name.toUpperCase();
  const pairedIsBall = pairedLines.some((l) => /ball|oz|red|blue|yellow|gray|grey|green/i.test(l.name));
  // Grey hint inside an empty input with no target.
  const hintFor = (metricId: string): string => {
    if (metricId === 'weight') return 'lb';
    if (metricId === 'reps') return 'reps';
    if (metricId === 'time_seconds') return 'sec';
    if (metricId === 'distance') return 'ft';
    const m = measurementOf(metricId);
    if (m?.category === 'paired') {
      return m.secondary_metric_id === metricId
        ? pairedMphLabel.toLowerCase()
        : (m.primary_metric_name || 'reps').toLowerCase();
    }
    return '—';
  };

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
    onInputChange(setIndex, metricId, newValue);
  };

  const handleKeypadBackspace = () => {
    if (!activeInput) return;
    const { setIndex, metricId } = activeInput;
    const currentInputs = exerciseInputs[exercise.id] || [];
    const setData = currentInputs[setIndex] || {};
    const currentValue = setData[metricId]?.toString() || '';
    const newValue = currentValue.slice(0, -1);
    markFieldEdited(setIndex, metricId);
    onInputChange(setIndex, metricId, newValue);
  };

  const handleKeypadDone = () => {
    if (!activeInput) {
      setActiveInput(null);
      return;
    }

    const { setIndex, metricId } = activeInput;
    const currentMetricIndex = inputOrder.indexOf(metricId);
    const currentInputs = exerciseInputs[exercise.id] || [];
    const setData = currentInputs[setIndex] || {};

    // When user enters a value, auto-fill any empty fields with their placeholder values
    // This ensures reps get filled when weight is entered, etc. Only after a
    // real edit in this keypad (typed / backspaced): opening the keypad on a
    // row and closing it untouched never writes.
    const currentValue = setData[metricId];
    const typedHere = editedFieldsRef.current[exercise.id]?.has(fieldKey(setIndex, metricId)) ?? false;
    if (typedHere && currentValue != null && currentValue !== '') {
      const placeholders = getPlaceholderValuesForSet(setIndex);
      metricFields.forEach(field => {
        const fieldValue = setData[field];
        // If this field is empty and has a placeholder, auto-fill it
        if ((fieldValue === undefined || fieldValue === null || fieldValue === '') && placeholders[field] !== undefined) {
          onInputChange(setIndex, field, placeholders[field], undefined, true);
          flashAutoFill(setIndex, field);
        }
      });
    }

    // Next field of the same set, else close the keypad.
    if (currentMetricIndex < inputOrder.length - 1) {
      const nextMetricId = inputOrder[currentMetricIndex + 1];
      setActiveInput({ setIndex, metricId: nextMetricId, isDecimal: metricTypeOf(nextMetricId) === 'decimal' });
    } else {
      setActiveInput(null);
    }
  };

  // Get set configuration for a set
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

  // Reps-type metric flagged AMRAP for this set (per-set flag OR the
  // exercise-level flag).
  const isAmrapFor = (setIndex: number, metricId: string): boolean => {
    const repsLike = metricId === 'reps' || metricId.toLowerCase().endsWith('_reps');
    if (!repsLike) return false;
    return !!(getSetConfig(setIndex)?.is_amrap || exercise.is_amrap);
  };

  // Intensity target for a metric in a set — "% of set K" from what was
  // logged for set K, % of max (cross-exercise aware), or the mound-velocity
  // fallback for throwing velocity.
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

  // Prescribed as "% of set K" for an earlier K — a back-off set.
  function isBackoffSet(setIndex: number): boolean {
    const targets = exercise.set_configurations?.[setIndex]?.intensity_targets || exercise.intensity_targets;
    return !!targets?.some(
      (t) => t.relative_to === 'set' && t.reference_set != null && t.reference_set - 1 >= 0 && t.reference_set - 1 < setIndex,
    );
  }

  // LAST column — weight-tracked exercises that have a previous session.
  const showLast = metricFields.includes('weight') && lastWeek != null;
  // Steppers only where a cell can hold [−] value [+]: ≤ 2 metric columns
  // and ≥ 90 pt wide (lib/logger/stepper); else the tappable number alone.
  const stepperFits = (metricId: string): boolean => {
    const flexes = [...singleMetrics.map(() => 1), ...(pairedLines.length ? [0.9, 1, 1.1] : [])];
    const metricColumns = singleMetrics.length + (pairedLines.length ? 2 : 0);
    // single and paired-reps columns are flex 1; paired mph is 1.1
    const flex = pairedLines.some((l) => l.mphId === metricId) ? 1.1 : 1;
    const width = tableColumnWidth({ screenWidth, showLast, flexes, flex });
    return showSteppers(metricColumns, width);
  };
  const lastText = (r: SetResult | null): string => {
    if (!r) return '—';
    if (r.weight != null && r.reps != null) return `${r.weight}×${r.reps}`;
    if (r.weight != null) return String(r.weight);
    if (r.reps != null) return `×${r.reps}`;
    return '—';
  };

  // Caption under the open set: "90% of set 2 · 279 → 280".
  const intensityCaption = (setIndex: number): string | null => {
    for (const m of metricFields) {
      const t = intensityCaptionText(targetArgs(setIndex, m));
      if (t) return t;
    }
    return null;
  };

  // What a set's cell shows before anything is typed: "max" (AMRAP), the
  // target as the coach wrote it (280, "5 LB DB", "10 yards"), the short
  // pending % ("90% S1" until set 1 is logged, "80%" with no max on file),
  // else null. The full "90% of set 1" is the open row's caption.
  const targetCell = (setIndex: number, metricId: string): { text: string; amrap?: boolean; pending?: boolean } | null => {
    if (isAmrapFor(setIndex, metricId)) return { text: 'max', amrap: true };
    const target: unknown = resolveTarget(targetArgs(setIndex, metricId));
    if (!isEmptyValue(target)) return { text: String(target) };
    const t = getIntensityTarget(setIndex, metricId);
    if (t && t.calculatedValue == null) {
      return { text: t.referenceSet != null ? `${t.percent}% S${t.referenceSet}` : `${t.percent}%`, pending: true };
    }
    return null;
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
  // Bumped when a stepper changes a set that back-offs reference — a stepper
  // tap is a commit point too (the keypad never opened or closed).
  const [backoffTick, setBackoffTick] = useState(0);
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
      onInputChange(setIndex, metric, value, undefined, true);
      flashAutoFill(setIndex, metric);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed to commit points (keypad field change/close, exercise change), not inputs: running per keystroke would move back-offs off half-typed values. Current props are read from this render's closure.
  }, [exercise.id, activeInput?.setIndex, activeInput?.metricId, activeInput == null, backoffTick]);

  // Handle checkbox toggle - compute auto-fill values if checking
  const handleCheckboxToggle = (setIndex: number) => {
    const isCompleted = isSetCompleted(setIndex);
    // Rack VBT: the live row's circle ends the set on the rack (no phone
    // save) — also on a row the phone already shows complete (a stray rep
    // right after a manual save, N1): never a local un-check.
    if (rack && rackLive?.lifting && isLiveRow(setIndex)) {
      rack.onLiveDone();
      return;
    }
    // Rack-owned (ended, row not landed): no phone save or un-check — a tap after 10 s re-reads.
    if (rack && rackSaving(setIndex)) {
      if (rackSaving(setIndex) === 'timeout') rack.onPullRefresh();
      return;
    }
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
      // Flash any field we just auto-filled so the athlete sees what changed.
      Object.keys(autoFillValues).forEach((metricId) => flashAutoFill(setIndex, metricId));
    } else {
      // Unchecking - no auto-fill needed
      onToggleSetComplete(setIndex);
    }
  };

  // Done button — two-phase: first tap logs the set, second tap advances.
  const handleNextButtonPress = () => {
    const currentSetCompleted = isSetCompleted(currentSetIndex);

    // A rack set being lifted on this exercise: Done ends it (any open row,
    // even when the phone shows that row complete — N1).
    if (rack && rackLive?.lifting) {
      rack.onLiveDone();
      return;
    }
    if (!currentSetCompleted) {
      // A rack-owned set → handleCheckboxToggle never saves it from the phone.
      handleCheckboxToggle(currentSetIndex);
    } else {
      onNextSet();
    }
  };

  // Swipe gesture handler for exercise navigation
  const SWIPE_THRESHOLD = 120; // high so accidental swipes mid-input don't
                               // kick the user to another exercise
  const SWIPE_VELOCITY_THRESHOLD = 0.5; // require a clear flick

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // No swipe-between-exercises while the numeric keypad is open.
      if (activeInput) return false;
      // Only capture horizontal swipes that are more horizontal than vertical
      const { dx, dy } = gestureState;
      return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30;
    },
    onPanResponderRelease: (_, gestureState) => {
      const { dx, vx } = gestureState;
      const isHardSwipe = Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(vx) > SWIPE_VELOCITY_THRESHOLD;
      if (isHardSwipe) {
        if (dx > 0 && hasPrev) {
          onPrevExercise();
        } else if (dx < 0 && hasNext) {
          onNextExercise();
        }
      }
    },
  }), [hasPrev, hasNext, onPrevExercise, onNextExercise, activeInput]);

  // ── Superset / circuit context ────────────────────────────────────────
  const isGrouped = normalizeScheme(routine.scheme) === 'grouped';
  // "A2" for a row of this routine — same visibility rule as the parent's
  // blockLabel, so codes match the overview.
  const codeFor = (reId: string): string => {
    const letter = (blockLabel || 'A').charAt(0).toUpperCase();
    const idx = (routine.routine_exercises || [])
      .filter(ex => !(ex.is_placeholder || ex.exercises?.is_placeholder) || ex.notes_only)
      .findIndex(ex => ex.id === reId);
    return idx >= 0 ? `${letter}${idx + 1}` : letter;
  };
  const nameOf = (reId: string): string => {
    const re = allExercises.find(ex => ex.id === reId);
    return re ? re.exercises?.name ?? re.placeholder_name ?? '' : '';
  };
  // The next step as if the current set were done (sequence engine).
  const nextAfterCurrent = (): SeqStep | null => {
    const done = { ...completedSets };
    const updatedSets = [...(done[exercise.id] || Array(exercise.sets).fill(false))];
    updatedSets[currentSetIndex] = true;
    done[exercise.id] = updatedSets;
    return nextStep(sequence, done, { reId: exercise.id, setIndex: currentSetIndex });
  };
  const routineSteps = sequence.filter(s => s.routineId === routine.id);
  const currentRound = currentSetIndex + 1;
  const totalRounds = routineSteps.reduce((n, s) => Math.max(n, s.round), 0) || exercise.sets || 0;
  // Next exercise in this round of the block, if there is one.
  const nextInRound = (): SeqStep | null => {
    if (!isGrouped) return null;
    const next = nextAfterCurrent();
    return next && next.routineId === routine.id && next.round === currentRound && next.reId !== exercise.id
      ? next
      : null;
  };
  const schemeName = (() => {
    switch (routine.scheme) {
      case 'circuit': return 'Circuit';
      case 'emom': return 'EMOM';
      case 'amrap': return 'AMRAP';
      case 'giant_set': return 'Giant set';
      default: return 'Superset';
    }
  })();

  // ── The one rx line under the header ──────────────────────────────────
  const rxLine = (): string => {
    const parts: string[] = [];
    const sets = exercise.sets || 0;
    if (isGrouped) {
      parts.push(schemeName);
      if (totalRounds) parts.push(`round ${currentRound} of ${totalRounds}`);
      const next = nextInRound();
      if (next) parts.push(`next ${codeFor(next.reId)} ${nameOf(next.reId)}`);
      const rest = routine.rest_between_rounds_seconds;
      if (rest) {
        const last = routineSteps.find(s => s.round === currentRound && s.endsRound);
        parts.push(last ? `rest ${formatRest(rest)} after ${codeFor(last.reId)}` : `rest ${formatRest(rest)}`);
      }
    } else if (pairedLines.length > 0) {
      parts.push(`${sets} ${sets === 1 ? 'round' : 'rounds'}`);
      pairedLines.forEach((l) => {
        const reps: unknown = l.repsId ? prescribedValue(exercise, 0, l.repsId) : undefined;
        parts.push(isEmptyValue(reps) ? l.name : `${l.name} ${reps}`);
      });
    } else if (metricFields.includes('reps')) {
      const values = Array.from({ length: sets }, (_, i) => prescribedValue(exercise, i, 'reps'))
        .filter((v) => !isEmptyValue(v))
        .map(String);
      const unique = Array.from(new Set(values));
      if (unique.length === 1) parts.push(`${sets} × ${unique[0]}`);
      else if (unique.length > 1) parts.push(`${sets} × ${values.join('/')}`);
      else parts.push(`${sets} ${sets === 1 ? 'set' : 'sets'}`);
    } else if (sets > 0) {
      parts.push(`${sets} ${sets === 1 ? 'set' : 'sets'}`);
    }
    if (!isGrouped) {
      if (exercise.is_amrap) parts.push('AMRAP');
      else {
        const amrapSets = Array.from({ length: sets }, (_, i) => i).filter((i) => getSetConfig(i)?.is_amrap);
        if (amrapSets.length === 1 && amrapSets[0] === sets - 1 && sets > 1) parts.push('last set AMRAP');
        else if (amrapSets.length > 0) parts.push(`set ${amrapSets.map((i) => i + 1).join(', ')} AMRAP`);
      }
      const rest = exercise.rest_seconds ?? getSetConfig(0)?.rest_seconds ?? null;
      if (rest) parts.push(`rest ${formatRest(rest)}`);
    }
    if (exercise.tempo) parts.push(`tempo ${exercise.tempo}`);
    if (exercise.selected_variation) parts.push(exercise.selected_variation);
    return parts.join(' · ');
  };

  // Footer: prescribed rest + the live countdown.
  const footerRest = isGrouped
    ? routine.rest_between_rounds_seconds
      ? `Rest ${formatRest(routine.rest_between_rounds_seconds)} between rounds`
      : null
    : (() => {
        const rest = getSetConfig(currentSetIndex)?.rest_seconds ?? exercise.rest_seconds ?? null;
        return rest ? `Rest ${formatRest(rest)} between sets` : null;
      })();

  // ── PR pill: "🏆 max 315" / "🏆 Red max 61.2" ─────────────────────────
  const prPillText = (() => {
    if (trackedMetrics.length === 0) return null;
    const maxes = athleteMaxes[exercise.exercise_id] ?? {};
    const metric = trackedMetrics.find((m) => maxes[m] != null) ?? trackedMetrics[0];
    const value = maxes[metric];
    const line = pairedLines.find((l) => l.repsId === metric || l.mphId === metric);
    if (value == null) return '🏆 tracked';
    return `🏆 ${line ? `${line.name} ` : ''}max ${value}`;
  })();

  // ── Cells ─────────────────────────────────────────────────────────────
  type Tone = 'done' | 'dim' | 'plain';
  const renderCell = (text: string, unit: string | null, tone: Tone, amrap = false, key?: string) => (
    <View key={key} style={styles.cell}>
      <Text
        style={[styles.v, tone === 'done' && styles.vDone, tone === 'dim' && styles.vDim]}
        numberOfLines={1}
      >
        {text}
        {unit && isNumberText(text) ? <Text style={styles.u}>{` ${unit}`}</Text> : null}
      </Text>
      {amrap && (
        <View style={styles.amrapTag}>
          <Text style={styles.amrapTagText}>AMRAP</Text>
        </View>
      )}
    </View>
  );

  // One metric of one set: read-only value (done = green, upcoming = grey
  // prescription) or, on an open set, the keypad input.
  const renderMetric = (setIndex: number, metricId: string, open: boolean, done: boolean) => {
    const setData = exerciseInputs[exercise.id]?.[setIndex] || {};
    const value = setData[metricId];
    const unit = unitFor(metricId);
    // Live rack row: REPS = full reps from the rack ("3 / 5"; read-only, never written here).
    if (rackLive && isLiveRow(setIndex) && metricId === 'reps') {
      const text = rackLive.repsTarget != null ? `${rackLive.fullReps} / ${rackLive.repsTarget}` : String(rackLive.fullReps);
      return renderCell(text, null, 'plain', false, metricId);
    }
    if (!open) {
      if (!isEmptyValue(value)) return renderCell(String(value), unit, done ? 'done' : 'dim', false, metricId);
      if (done) {
        // Ticked with nothing typed: "done" in green once, not a row of dashes.
        if (inputOrder.every((m) => isEmptyValue(setData[m]))) {
          return renderCell(metricId === inputOrder[0] ? 'done' : '', null, 'done', false, metricId);
        }
        return renderCell('—', null, 'dim', false, metricId);
      }
      const target = targetCell(setIndex, metricId);
      return renderCell(target?.text ?? '—', unit, 'dim', !!target?.amrap, metricId);
    }
    const empty = isEmptyValue(value);
    const target = empty ? targetCell(setIndex, metricId) : null;
    const text = empty ? target?.text ?? hintFor(metricId) : String(value);
    const isActive = activeInput?.setIndex === setIndex && activeInput?.metricId === metricId;
    const justFilled = autoFilledKeys.has(`${setIndex}:${metricId}`);
    // What −/+ step from: the typed value, else the prescribed number shown
    // as the placeholder, else 0 (AMRAP / pending %). Free text — typed or
    // prescribed ("5 LB DB") — gets no steppers.
    const stepBase: unknown = !empty ? value : target && !target.amrap && !target.pending ? target.text : '';
    const steppable = canStep(stepBase) && stepperFits(metricId);
    const step = (dir: 1 | -1) => {
      const next = stepValue(metricId, stepBase, dir);
      if (next == null) return;
      setActiveInput(null);
      markFieldEdited(setIndex, metricId);
      onInputChange(setIndex, metricId, String(next));
      if (isBackoffReference(exercise, setIndex)) setBackoffTick((t) => t + 1);
    };
    const label = getMetricLabel(metricId, customMeasurements);
    const stepper = (dir: 1 | -1) => (
      <TouchableOpacity
        style={styles.stepBtn}
        onPress={() => step(dir)}
        // Slop only on the outer side, so it never overlaps the value's touch area.
        hitSlop={dir > 0 ? { top: 0, bottom: 0, left: 0, right: 12 } : { top: 0, bottom: 0, left: 12, right: 0 }}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`${dir > 0 ? 'Increase' : 'Decrease'} set ${setIndex + 1} ${label}`}
      >
        <Text style={styles.stepText}>{dir > 0 ? '+' : '−'}</Text>
      </TouchableOpacity>
    );
    return (
      <View key={metricId} style={[styles.cell, styles.stepRow]}>
        {steppable && stepper(-1)}
        <TouchableOpacity
          style={[styles.in, steppable && styles.inStepped, isActive && styles.inFocus, justFilled && styles.inAutoFilled]}
          onPress={() => setActiveInput({ setIndex, metricId, isDecimal: metricTypeOf(metricId) === 'decimal' })}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Set ${setIndex + 1} ${label}`}
        >
          <Text style={[styles.inText, empty && styles.ph]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {text}
            {unit && isNumberText(text) ? <Text style={styles.u}>{` ${unit}`}</Text> : null}
          </Text>
          {target?.amrap && (
            <View style={styles.amrapTag}>
              <Text style={styles.amrapTagText}>AMRAP</Text>
            </View>
          )}
        </TouchableOpacity>
        {steppable && stepper(1)}
      </View>
    );
  };

  // The completion circle — right edge of every set. Toggles done; never
  // opens/closes the set.
  const renderSetCheck = (setIndex: number, isCompleted: boolean) => (
    <TouchableOpacity
      style={[styles.ck, isCompleted && styles.ckOn]}
      onPress={() => handleCheckboxToggle(setIndex)}
      activeOpacity={0.7}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={isCompleted ? `Mark set ${setIndex + 1} not done` : `Mark set ${setIndex + 1} done`}
    >
      {isCompleted ? <Text style={styles.ckIcon}>✓</Text> : null}
    </TouchableOpacity>
  );

  // Header 🏆 on PR-tracked columns.
  const trophy = <Text style={styles.thTrophy}> 🏆</Text>;
  const pairedRepsTracked = pairedLines.some((l) => !!l.repsId && trackedMetrics.includes(l.repsId));
  const pairedMphTracked = pairedLines.some((l) => !!l.mphId && trackedMetrics.includes(l.mphId));

  const headerCell = (key: string, colStyle: object, label: string, tracked = false) => (
    <View key={key} style={colStyle}>
      <Text style={styles.thText} numberOfLines={1}>
        {label}
        {tracked ? trophy : null}
      </Text>
    </View>
  );
  const renderTableHeader = () => (
    <View key="th" style={styles.th}>
      {headerCell('set', styles.colSet, 'SET')}
      {showLast && headerCell('last', styles.colLast, 'LAST')}
      {singleMetrics.map((m) => headerCell(m, styles.colMetric, columnLabel(m), trackedMetrics.includes(m)))}
      {pairedLines.length > 0 && headerCell('ball', styles.colBall, pairedIsBall ? 'BALL' : 'TYPE')}
      {pairedLines.length > 0 && headerCell('preps', styles.colPairReps, pairedRepsLabel, pairedRepsTracked)}
      {pairedLines.length > 0 && headerCell('pmph', styles.colPairMph, pairedMphLabel, pairedMphTracked)}
      <View style={styles.colCheck} />
    </View>
  );

  const renderSets = () => {
    // Notes-only exercises (no measurement fields and/or notes_only=true)
    // are instruction cards, not loggable sets: render the parsed notes.
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

    const sets: React.ReactNode[] = [renderTableHeader()];
    // Always set order (1, 2, 3…). The current set is open in place (inline
    // inputs); done sets show their values in green, upcoming ones their
    // prescription in grey. Tap a row to open it; the circle toggles done.
    const setCount = exercise.sets || 0;
    for (let i = 0; i < setCount; i++) {
      const setConfig = getSetConfig(i);
      const isCompleted = isSetCompleted(i);
      const isCurrentSet = i === currentSetIndex;
      // Exactly one open set: the current one. Tapping another row makes it
      // current (parent state), and this one collapses to plain text.
      const isOpen = isCurrentSet;
      const rpe = rpeValues?.[`${exercise.id}:${i}`] ?? null;

      // Lines of the set: one for plain metrics, or one per ball (the first
      // also carries SET, LAST, the single columns and the circle).
      const lineCount = Math.max(1, pairedLines.length);
      const lines: React.ReactNode[] = [];
      for (let k = 0; k < lineCount; k++) {
        const first = k === 0;
        const ball = pairedLines[k];
        lines.push(
          <View key={k} style={[styles.tr, !first && styles.trSub]}>
            <View style={styles.colSet}>
              <Text style={[styles.n, isCurrentSet && styles.nCur]}>{first ? i + 1 : ''}</Text>
            </View>
            {showLast && (
              <View style={styles.colLast}>
                <Text style={styles.last} numberOfLines={1}>{first ? lastText(lastWeekFor(i)) : ''}</Text>
              </View>
            )}
            {singleMetrics.map((m) =>
              first ? (
                <View key={m} style={styles.colMetric}>{renderMetric(i, m, isOpen, isCompleted)}</View>
              ) : (
                <View key={m} style={styles.colMetric} />
              ),
            )}
            {ball && (
              <>
                <View style={[styles.colBall, styles.ball]}>
                  <View style={[styles.dot, { backgroundColor: ball.color }]} />
                  <Text style={styles.ballName} numberOfLines={1}>
                    {ball.name}
                    {ball.tracked ? <Text style={styles.ballTrophy}> 🏆</Text> : null}
                  </Text>
                </View>
                <View style={styles.colPairReps}>
                  {ball.repsId ? renderMetric(i, ball.repsId, isOpen, isCompleted) : renderCell('—', null, 'dim')}
                </View>
                <View style={styles.colPairMph}>
                  {ball.mphId ? renderMetric(i, ball.mphId, isOpen, isCompleted) : renderCell('—', null, 'dim')}
                </View>
              </>
            )}
            <View style={styles.colCheck}>{first ? renderSetCheck(i, isCompleted) : null}</View>
          </View>,
        );
      }

      const caption = isOpen ? intensityCaption(i) : null;
      // A coach set note that only restates the % ("-10% of top set") is
      // dropped where the intensity caption already says it.
      const showNote = !!setConfig?.notes && !(caption && noteRepeatsCaption(setConfig.notes, caption));
      const body = (
        <>
          {isCurrentSet && <View style={styles.rail} />}
          {lines}
          {rackLive && isLiveRow(i) && (
            <LiveRepRow source={rackLive.source} rackName={rackLive.rackName} chips={rackLive.chips} />
          )}
          {rackSaving(i) === 'saving' && <Text style={styles.caption}>Saving…</Text>}
          {rackSaving(i) === 'timeout' && <Text style={styles.caption}>Saved on the rack · pull to refresh</Text>}
          {rack?.hasRacks && rack.idleSaved.includes(i) && !isOpen && (
            <Text style={styles.caption}>Saved · tap to edit</Text>
          )}
          {isCompleted && !isLiveRow(i) && rackSummaryLine(exerciseInputs[exercise.id]?.[i]?.vbt) && (
            <Text style={styles.rackSummary}>{`${exerciseInputs[exercise.id]?.[i]?.vbt?.source === 'phone' ? 'SENSOR' : 'RACK'} · ${rackSummaryLine(exerciseInputs[exercise.id]?.[i]?.vbt)}`}</Text>
          )}
          {showNote && <Text style={styles.cn}>{setConfig?.notes}</Text>}
          {!!caption && <Text style={styles.caption}>{caption}</Text>}
          {isOpen && exercise.ask_rpe && onRpeChange && (
            <View style={styles.rpeStrip}>
              <RpeRow
                compact
                target={setConfig?.rpe ?? exercise.rpe_target ?? null}
                value={rpe}
                onChange={(v) => onRpeChange(i, v)}
              />
            </View>
          )}
          {!isOpen && isCompleted && exercise.ask_rpe && rpeValues && (
            rpe != null
              ? <Text style={styles.rpeDone}>{`RPE ${rpe}`}</Text>
              : <Text style={styles.rpeMissing}>RPE?</Text>
          )}
        </>
      );

      sets.push(
        isOpen ? (
          <View
            key={i}
            onLayout={(e) => onSetLayout(i, e.nativeEvent.layout.y)}
            style={[styles.set, styles.setCur]}
          >
            {body}
          </View>
        ) : (
          <TouchableOpacity
            key={i}
            onLayout={(e) => onSetLayout(i, e.nativeEvent.layout.y)}
            onPress={() => {
              setActiveInput(null);
              onSelectSet(i);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Open set ${i + 1}`}
            style={[styles.set, isLiveRow(i) && styles.setCur]}
          >
            {body}
          </TouchableOpacity>
        ),
      );
    }

    // Rack VBT: extra sets the rack logged past the prescription — read-only.
    for (const x of rack?.hasRacks ? rack.extraSets ?? [] : []) {
      sets.push(
        <View key={`x${x.setNumber}`} style={[styles.set, x.live && styles.setCur]} accessibilityLabel={`Extra set ${x.setNumber}`}>
          <View style={styles.tr}>
            <Text style={styles.caption}>{`SET ${x.setNumber} · EXTRA${x.values ? ` · ${x.values}` : ''}`}</Text>
          </View>
          {x.live && rackLive && rackLive.setIndex === x.setNumber - 1 && (
            <LiveRepRow source={rackLive.source} rackName={rackLive.rackName} chips={rackLive.chips} />
          )}
          {x.saving === 'saving' && <Text style={styles.caption}>Saving…</Text>}
          {x.saving === 'timeout' && <Text style={styles.caption}>Saved on the rack · pull to refresh</Text>}
          {x.rackLine && <Text style={styles.rackSummary}>{x.rackLine}</Text>}
        </View>,
      );
    }

    // While the rack's speed has dropped, its cue takes the rest footer's place.
    const rackDropText = rackLive?.dropCue != null ? `Speed dropped ${rackLive.dropCue}% — rack it` : null;
    if (footerRest || restSecondsLeft != null || rackDropText) {
      sets.push(
        <View key="foot" style={styles.foot}>
          {rackDropText
            ? <Text style={[styles.footText, styles.rackDrop]}>{rackDropText}</Text>
            : <Text style={styles.footText}>{footerRest ?? ''}</Text>}
          {restSecondsLeft != null && (
            <Text style={styles.footTimer}>{`Rest ${formatRest(restSecondsLeft)}`}</Text>
          )}
        </View>,
      );
    }
    return sets;
  };

  // Helper to truncate exercise name for button
  const truncateName = (name: string, maxLength: number = 14): string => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 1) + '…';
  };

  // After the set is logged: where the next tap goes — "Next Set →", the
  // next exercise's name, or DONE. Comes from the sequence engine.
  const getNextButtonText = () => {
    // Rows outside the sequence (notes-only, text blocks) step to the next row
    // in the list — same as the parent's handleNextSet.
    if (!sequence.some(s => s.reId === exercise.id)) {
      const following = neighborExercise(allExercises, exercise.id, 1);
      return following ? truncateName(following.exercises?.name ?? following.placeholder_name ?? '') + ' →' : 'DONE';
    }

    const done = { ...completedSets };
    const updatedSets = [...(done[exercise.id] || Array(exercise.sets).fill(false))];
    updatedSets[currentSetIndex] = true;
    done[exercise.id] = updatedSets;

    const next = nextStep(sequence, done, { reId: exercise.id, setIndex: currentSetIndex });
    // On a rack: once this exercise is finished, Next goes where the rack goes.
    const rackNext = rack?.hasRacks ? rack.rackNextAfter?.(currentSetIndex) ?? null : null;
    if (rackNext && rackNext.reId !== exercise.id) return truncateName(rackNext.name) + ' →';
    if (!next) return 'DONE';
    if (next.reId === exercise.id) return 'Next Set →';

    const nextExercise = allExercises.find(ex => ex.id === next.reId);
    return nextExercise ? truncateName(nextExercise.exercises?.name ?? nextExercise.placeholder_name ?? '') + ' →' : 'DONE';
  };

  // Before the set is logged: "Done · set 3", "Done → A2 Box Jump" (next in
  // the round), "Done · round 2" (round ends here).
  const doneLabel = (): string => {
    if (!isGrouped) return `Done · set ${currentSetIndex + 1}`;
    const next = nextInRound();
    if (next) return `Done → ${codeFor(next.reId)} ${truncateName(nameOf(next.reId), 16)}`;
    return `Done · round ${currentRound}`;
  };

  // ── Coach note (one line; "more" expands) ─────────────────────────────
  const renderCoachNote = () => {
    const trim = (s: string | null | undefined) => (s ?? '').trim();
    const routineNote = trim((routine as any).notes);
    const routineTextInfo = trim((routine as any).text_info);
    const exerciseCoachNote = trim((exercise as any).notes);
    const exerciseDescription = trim((exercise.exercises as any)?.description);
    const parsedNote = exerciseCoachNote ? parseInstructionBlock(exerciseCoachNote) : null;
    // A coach note counts only if it parses to cues or callouts.
    const noteHasContent =
      !!parsedNote &&
      (parsedNote.sections.some((sec) => sec.items.length > 0) || parsedNote.callouts.length > 0);
    const hasAnything =
      !!routineNote || !!routineTextInfo || noteHasContent || !!exerciseDescription;
    if (!hasAnything) return null;
    const allCues = parsedNote ? parsedNote.sections.flatMap((sec) => sec.items) : [];
    const callouts = parsedNote?.callouts ?? [];
    const previewText = allCues.length > 0
      ? allCues.slice(0, 2).join(' ')
      : routineNote || routineTextInfo || exerciseDescription || callouts[0] || '';
    const hasMore = allCues.length > 0
      ? allCues.length > 2 ||
        callouts.length > 0 ||
        (parsedNote?.sections.some((sec) => !!sec.header) ?? false) ||
        !!routineNote || !!routineTextInfo || !!exerciseDescription
      : [routineNote, routineTextInfo, exerciseDescription, ...callouts].filter(Boolean).length > 1 ||
        previewText.length > 90;
    const expanded = notesExpanded && hasMore;
    return (
      <TouchableOpacity
        style={styles.note}
        onPress={() => hasMore && setNotesExpanded((v) => !v)}
        activeOpacity={hasMore ? 0.7 : 1}
        accessibilityRole={hasMore ? 'button' : undefined}
        accessibilityLabel={hasMore ? (expanded ? 'Show less coach notes' : 'Show more coach notes') : undefined}
      >
        {!expanded ? (
          <Text style={styles.noteText} numberOfLines={2}>
            <Text style={styles.noteLabel}>COACH  </Text>
            {previewText}
            {hasMore ? <Text style={styles.noteMore}>  more</Text> : null}
          </Text>
        ) : (
          <View style={styles.noteBody}>
            {!!routineNote && (
              <View style={styles.noteSection}>
                <Text style={styles.noteLabel}>BLOCK NOTE</Text>
                <Text style={styles.noteText}>{routineNote}</Text>
              </View>
            )}
            {!!routineTextInfo && (
              <View style={styles.noteSection}>
                <Text style={styles.noteLabel}>BLOCK INFO</Text>
                <Text style={styles.noteText}>{routineTextInfo}</Text>
              </View>
            )}
            {!!parsedNote && (parsedNote.sections.length > 0 || parsedNote.callouts.length > 0) && (
              <View style={styles.noteSection}>
                <Text style={styles.noteLabel}>COACH</Text>
                {parsedNote.sections.map((section, sIdx) => (
                  <View key={sIdx} style={sIdx > 0 ? { marginTop: 6 } : undefined}>
                    {!!section.header && (
                      <Text style={styles.noteHeader}>{section.header}</Text>
                    )}
                    {section.items.map((item, iIdx) => (
                      <View key={iIdx} style={styles.noteBulletRow}>
                        <Text style={styles.noteBullet}>•</Text>
                        <Text style={[styles.noteText, styles.noteBulletText]}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ))}
                {parsedNote.callouts.map((c, cIdx) => (
                  <View key={cIdx} style={styles.noteBulletRow}>
                    <Text style={styles.noteCalloutIcon}>⚠</Text>
                    <Text style={[styles.noteCalloutText, styles.noteBulletText]}>{c}</Text>
                  </View>
                ))}
              </View>
            )}
            {!!exerciseDescription && (
              <View style={styles.noteSection}>
                <Text style={styles.noteLabel}>HOW IT WORKS</Text>
                <Text style={styles.noteDescription}>{exerciseDescription}</Text>
              </View>
            )}
            <Text style={styles.noteMore}>less</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const rx = rxLine();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        {...panResponder.panHandlers}
      >
        {/* Header: ← · code chip · NAME · 🏆 max */}
        <View style={styles.hdr}>
          <TouchableOpacity
            style={styles.back}
            onPress={onBackToOverview}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back to overview"
          >
            <Ionicons name="arrow-back" size={16} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
          {blockLabel && (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{blockLabel}</Text>
            </View>
          )}
          <Text style={styles.ttl} numberOfLines={2}>
            {exerciseName.toUpperCase()}
          </Text>
          {prPillText && (
            <TouchableOpacity
              style={styles.pr}
              onPress={() => setPRPopoverOpen(true)}
              hitSlop={8}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="View personal records"
            >
              <Text style={styles.prText} numberOfLines={1}>{prPillText}</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.setsScrollView}
          contentContainerStyle={[styles.setsContent, { paddingBottom: bottomBarHeight + 80 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            rack?.hasRacks && rack.canRefresh !== false ? (
              <RefreshControl refreshing={rack.refreshing} onRefresh={rack.onPullRefresh} tintColor={LOGGER_COLORS.accent} />
            ) : undefined
          }
        >
          {rack?.hasRacks && rack.banner && (
            <RackBanner
              banner={rack.banner}
              error={rack.error}
              busy={rack.busy}
              onJoin={rack.onJoin}
              onImUp={rack.onImUp}
              onLeave={rack.onLeave}
            />
          )}
          {sensor && <SensorButton {...sensor} />}
          {!!rx && <Text style={styles.rx}>{rx}</Text>}
          {/* Demo video inline at the top (muted, looping; "▶ DEMO" strip
              collapses it; hidden + paused while the keypad is open). */}
          {hasVideo(videoUrl) && (
            <InlineDemoVideo
              key={exercise.id}
              videoId={videoId}
              url={videoUrl!}
              keypadOpen={!!activeInput}
              paused={showHistory || prPopoverOpen || fullVideoId != null}
              onExpand={setFullVideoId}
            />
          )}
          {renderCoachNote()}
          {renderSets()}
        </ScrollView>

        {/* History — slide-up bottom sheet with a dim backdrop. */}
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

        {/* Bottom bar: History · Done · menu */}
        <View
          style={styles.bottomNav}
          onLayout={(e) => setBottomBarHeight(e.nativeEvent.layout.height)}
        >
          <View style={[styles.bottomNavInner, { paddingBottom: Math.max(insets.bottom - 8, 16) }]}>
            <TouchableOpacity
              style={[styles.g, showHistory && styles.gActive]}
              onPress={() => setShowHistory(!showHistory)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="History"
            >
              <Ionicons
                name="stats-chart"
                size={16}
                color={showHistory ? LOGGER_COLORS.accent : 'rgba(255,255,255,0.7)'}
              />
              <Text style={[styles.gLabel, showHistory && styles.gLabelActive]}>History</Text>
            </TouchableOpacity>

            {(() => {
              const currentSetCompleted = isSetCompleted(currentSetIndex);
              const isNotesOnly = metricFields.length === 0;

              // Notes-only rows: no set to log — step to the next row.
              if (isNotesOnly) {
                const nextExercise = neighborExercise(allExercises, exercise.id, 1);
                const isLast = nextExercise == null;
                const notesLabel = nextExercise
                  ? `${truncateName(nextExercise.exercises?.name ?? nextExercise.placeholder_name ?? '')} →`
                  : '✓ DONE';
                return (
                  <TouchableOpacity style={styles.lb} onPress={onNextSet} activeOpacity={0.85}>
                    <LinearGradient
                      colors={isLast ? ([LOGGER_COLORS.green, '#059669'] as const) : ([LOGGER_COLORS.accent, LOGGER_COLORS.accentEnd] as const)}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.lbFill}
                    >
                      <Text style={[styles.lbText, isLast && styles.lbTextOnGreen]} numberOfLines={1}>
                        {notesLabel}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                );
              }

              const nextText = getNextButtonText();
              const isDone = nextText === 'DONE' && currentSetCompleted;
              // Rack: a lift in progress → "✓ Done · N reps" (any open row); a
              // rack-owned set waiting for its row → "Saving…" (Done disabled).
              const rackLabel = rackLive?.lifting
                ? liveDoneLabel(rackLive.fullReps)
                : currentSetCompleted
                  ? null
                  : rackSaving(currentSetIndex)
                    ? 'Saving…'
                    : null;
              const label = rackLive?.lifting && rackLabel
                ? rackLabel
                : isDone
                ? '✓ DONE'
                : rackLabel
                  ? rackLabel
                  : !currentSetCompleted
                    ? `✓ ${doneLabel()}`
                    : nextText;
              return (
                <TouchableOpacity
                  style={[styles.lb, rackLabel === 'Saving…' && styles.lbDisabled]}
                  onPress={handleNextButtonPress}
                  disabled={rackLabel === 'Saving…' && rackSaving(currentSetIndex) === 'saving'}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                >
                  <LinearGradient
                    colors={isDone ? ([LOGGER_COLORS.green, '#059669'] as const) : ([LOGGER_COLORS.accent, LOGGER_COLORS.accentEnd] as const)}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.lbFill}
                  >
                    <Text style={[styles.lbText, isDone && styles.lbTextOnGreen]} numberOfLines={1}>{label}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              );
            })()}

            <TouchableOpacity
              style={styles.g}
              onPress={onBackToOverview}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Overview"
            >
              <Ionicons name="menu" size={20} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <VideoModal videoId={fullVideoId} onClose={() => setFullVideoId(null)} />

      {/* Custom Numeric Keypad */}
      {activeInput && (
        <NumericKeypad
          onKeyPress={handleKeypadPress}
          onBackspace={handleKeypadBackspace}
          onDone={handleKeypadDone}
          showDecimal={true}
          hasNextField={inputOrder.indexOf(activeInput.metricId) < inputOrder.length - 1}
        />
      )}

      {/* PR popover — the 🏆 pill. Each tracked metric with the athlete's
          all-time best, from the cached athleteMaxes (no fetch). */}
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
                {exerciseName}
              </Text>
            </View>
            {trackedMetrics.length === 0 ? (
              <Text style={styles.prPopoverEmpty}>
                No tracked PR metrics on this exercise yet.
              </Text>
            ) : (
              <View style={styles.prPopoverList}>
                {trackedMetrics.map((metricId) => {
                  const max = athleteMaxes[exercise.exercise_id]?.[metricId] ?? null;
                  const label = getMetricLabel(metricId, customMeasurements);
                  return (
                    <View key={metricId} style={styles.prPopoverRow}>
                      <Text style={styles.prPopoverRowLabel}>{label}</Text>
                      <Text
                        style={[
                          styles.prPopoverRowValue,
                          max != null ? styles.prPopoverRowValueOn : styles.prPopoverRowValueOff,
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

// Mock: docs/superpowers/mockups/logger-v2/exercise-table.html (web repo).
const INK_2 = 'rgba(255,255,255,0.6)';
const INK_3 = 'rgba(255,255,255,0.4)';
const ROW_LINE = 'rgba(255,255,255,0.06)';
const SKY_BORDER = 'rgba(155,221,255,0.45)';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: LOGGER_COLORS.bg,
  },
  keyboardAvoidingContainer: {
    flex: 1,
    backgroundColor: LOGGER_COLORS.bg,
  },
  // Header
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    backgroundColor: LOGGER_COLORS.bg,
  },
  back: {
    width: 32,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    minWidth: 30,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: SKY_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    color: LOGGER_COLORS.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  ttl: {
    flex: 1,
    color: LOGGER_COLORS.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  pr: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: LOGGER_COLORS.prBorder,
    maxWidth: 150,
  },
  prText: {
    color: LOGGER_COLORS.prText,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  // rx line + coach note
  rx: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    color: INK_2,
    fontSize: 13,
  },
  note: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 10,
  },
  noteLabel: {
    color: LOGGER_COLORS.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  noteText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    lineHeight: 18,
  },
  noteMore: {
    color: LOGGER_COLORS.accent,
    fontSize: 12,
  },
  noteBody: { gap: 10 },
  noteSection: { gap: 4 },
  noteHeader: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  noteBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 3,
  },
  noteBullet: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    lineHeight: 18,
    width: 8,
  },
  noteBulletText: { flex: 1 },
  noteCalloutIcon: {
    color: '#FBBF24',
    fontSize: 13,
    lineHeight: 18,
    width: 14,
  },
  noteCalloutText: {
    color: '#FCD34D',
    fontSize: 13,
    lineHeight: 18,
  },
  noteDescription: {
    color: LOGGER_COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  setsScrollView: {
    flex: 1,
  },
  setsContent: {
    paddingTop: 0,
  },
  // Table — SET 24 · LAST 64 · metric columns · circle 32, gap 8
  th: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  thText: {
    color: INK_3,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  thTrophy: {
    color: LOGGER_COLORS.prText,
    fontSize: 9.5,
  },
  // Table grid (mock phone 1): 24 px SET · [64 px LAST] · equal-width
  // metric columns · 32 px circle, 8 px between columns. Spacing is a left
  // margin on every column after SET — no gap / auto margins.
  colSet: { width: 24 },
  colLast: { width: 64, marginLeft: 8 },
  colMetric: { flex: 1, minWidth: 0, marginLeft: 8 },
  // Paired: mock had 1.1 / 0.7 / 1; reps/mph widened so the current set's
  // [−] value [+] fits (a 0.7 reps column left ~7 px for the number).
  colBall: { flex: 0.9, minWidth: 0, marginLeft: 8 },
  colPairReps: { flex: 1, minWidth: 0, marginLeft: 8 },
  colPairMph: { flex: 1.1, minWidth: 0, marginLeft: 8 },
  colCheck: { width: 32, marginLeft: 8, alignItems: 'flex-end' },
  set: {
    borderBottomWidth: 1,
    borderBottomColor: ROW_LINE,
  },
  setCur: {
    backgroundColor: 'rgba(155,221,255,0.06)',
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: LOGGER_COLORS.accent,
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 64,
  },
  trSub: { minHeight: 48 }, // extra ball lines inside a set
  n: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  nCur: { color: LOGGER_COLORS.text },
  last: {
    color: INK_3,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  v: {
    flexShrink: 1,
    color: LOGGER_COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  vDone: { color: LOGGER_COLORS.greenText },
  vDim: { color: 'rgba(255,255,255,0.5)' },
  u: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
    fontWeight: '600',
  },
  amrapTag: {
    marginLeft: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.4)',
  },
  amrapTagText: {
    color: LOGGER_COLORS.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  in: {
    flex: 1,
    maxWidth: 120,
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  inFocus: { borderColor: LOGGER_COLORS.accent },
  // Current set: [−] value [+]. Buttons are 24 wide + 6 px hit slop each side
  // (36 pt targets) so two columns still fit beside SET / LAST.
  stepRow: { flex: 1, maxWidth: 176 },
  inStepped: { maxWidth: '100%', paddingHorizontal: 6, justifyContent: 'center' },
  stepBtn: {
    width: 24,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    color: LOGGER_COLORS.accent,
    fontSize: 20,
    fontWeight: '700',
  },
  inAutoFilled: {
    borderColor: LOGGER_COLORS.green,
    backgroundColor: 'rgba(16,185,129,0.12)',
  },
  inText: {
    flexShrink: 1,
    color: LOGGER_COLORS.text,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  ph: { color: 'rgba(255,255,255,0.32)' },
  ck: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ckOn: {
    backgroundColor: LOGGER_COLORS.green,
    borderColor: LOGGER_COLORS.green,
  },
  ckIcon: {
    color: '#04130C',
    fontSize: 15,
    fontWeight: '900',
  },
  ball: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  ballName: {
    flexShrink: 1,
    color: LOGGER_COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  ballTrophy: { fontSize: 11 },
  // Under a row: coach set note, intensity caption, RPE
  cn: {
    paddingLeft: 48,
    paddingRight: 16,
    paddingBottom: 8,
    color: LOGGER_COLORS.accent,
    fontSize: 12,
    fontStyle: 'italic',
  },
  caption: {
    paddingLeft: 48,
    paddingRight: 16,
    paddingBottom: 8,
    color: LOGGER_COLORS.accent,
    fontSize: 12,
    fontStyle: 'italic',
    fontVariant: ['tabular-nums'],
  },
  rpeStrip: {
    paddingLeft: 48,
    paddingRight: 16,
    paddingBottom: 10,
  },
  rpeDone: {
    paddingLeft: 48,
    paddingBottom: 8,
    color: LOGGER_COLORS.rpe,
    fontSize: 11,
    fontWeight: '700',
  },
  rpeMissing: {
    paddingLeft: 48,
    paddingBottom: 8,
    color: LOGGER_COLORS.rpe,
    fontSize: 11,
    fontWeight: '800',
  },
  rackDrop: {
    color: RACK_COLORS.slow,
    fontWeight: '700',
  },
  rackSummary: {
    paddingLeft: 48,
    paddingRight: 16,
    paddingBottom: 8,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
  },
  lbDisabled: { opacity: 0.6 },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  footText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
  },
  footTimer: {
    color: LOGGER_COLORS.accent,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  // PR popover
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
    borderColor: LOGGER_COLORS.prBorder,
    overflow: 'hidden',
  },
  prPopoverHeader: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: ROW_LINE,
  },
  prPopoverEyebrow: {
    color: LOGGER_COLORS.prText,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  prPopoverTitle: {
    color: LOGGER_COLORS.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 4,
  },
  prPopoverEmpty: {
    color: LOGGER_COLORS.muted,
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
  prPopoverRowValueOn: { color: LOGGER_COLORS.text },
  prPopoverRowValueOff: { color: '#4b5563' },
  prPopoverCloseBtn: {
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  prPopoverCloseText: {
    color: LOGGER_COLORS.muted,
    fontSize: 13,
    fontWeight: '700',
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
    color: LOGGER_COLORS.muted,
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
  // Bottom bar: History (labelled) · Done · menu
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 40,
  },
  bottomNavInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    paddingHorizontal: 14,
    backgroundColor: LOGGER_COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: ROW_LINE,
  },
  g: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111214',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  gActive: {
    backgroundColor: 'rgba(155,221,255,0.12)',
    borderColor: LOGGER_COLORS.accent,
  },
  gLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontWeight: '600',
  },
  gLabelActive: { color: LOGGER_COLORS.accent },
  lb: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
    minWidth: 0,
  },
  lbFill: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  lbText: {
    color: '#06202E',
    fontSize: 15,
    fontWeight: '800',
  },
  lbTextOnGreen: { color: LOGGER_COLORS.text },
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
