import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  LayoutChangeEvent,
  useWindowDimensions,
  Linking,
  Image,
  PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import YoutubePlayer from 'react-native-youtube-iframe';
import NumericKeypad from '../components/NumericKeypad';
import { calculateThrowingTarget, isThrowingVelocityMetric } from '../lib/throwingConversions';

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
  categories?: string[];
  tags?: string[];
}

interface IntensityTarget {
  id?: string;
  metric: string;
  metric_label?: string;
  percent: number;
  // Cross-exercise intensity fields
  source_exercise_id?: string | null;
  source_exercise_name?: string | null;
  source_metric_id?: string | null;
}

interface SetConfiguration {
  metric_values?: Record<string, number>;
  is_amrap?: boolean;
  notes?: string;
  intensity_targets?: IntensityTarget[];
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
  intensity_targets?: IntensityTarget[];
  enabled_measurements?: string[];
  is_amrap?: boolean;
  set_configurations?: SetConfiguration[];
  selected_variation?: string | null;
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
  hasPrev: boolean;
  hasNext: boolean;
  blockLabel?: string;
  exerciseHistory?: ExerciseHistory[];
  onInputChange: (
    setIndex: number,
    field: string,
    value: any,
    exerciseIdOverride?: string,
    isAutoFill?: boolean
  ) => void;
  onToggleSetComplete: (setIndex: number, autoFillValues?: Record<string, any>) => void;
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

// Helper: Get keyboard type for metric
function getKeyboardType(metricType?: string): 'default' | 'number-pad' | 'decimal-pad' {
  if (!metricType) return 'number-pad';
  if (metricType === 'integer') return 'number-pad';
  if (metricType === 'decimal') return 'decimal-pad';
  return 'number-pad';
}

// Helper: Get metric label
function getMetricLabel(
  metricId: string,
  customMeasurements: Measurement[]
): string {
  // Check for standard metrics
  if (metricId === 'reps') return 'Reps';
  if (metricId === 'weight') return 'Weight (lb)';
  if (metricId === 'time_seconds') return 'Time (sec)';
  if (metricId === 'distance') return 'Distance (ft)';

  // Check custom measurements
  for (const measurement of customMeasurements) {
    if (measurement.primary_metric_id === metricId) {
      // For ball metrics, include the measurement name (e.g., "Red Ball Reps")
      const metricName = measurement.primary_metric_name || 'Reps';
      return `${measurement.name} ${metricName}`;
    }
    if (measurement.secondary_metric_id === metricId) {
      // For ball metrics, include the measurement name (e.g., "Red Ball Velo")
      const metricName = measurement.secondary_metric_name || 'Velo';
      return `${measurement.name} ${metricName}`;
    }
  }

  return metricId;
}

// Ball weight order for sorting (heaviest to lightest)
const ballWeightOrder: Record<string, number> = {
  '7oz': 1,
  '7_oz': 1,
  '6oz': 2,
  '6_oz': 2,
  '5oz': 3,
  '5_oz': 3,
  'baseball': 3,
  '4oz': 4,
  '4_oz': 4,
  '3oz': 5,
  '3_oz': 5,
  'blue': 6,
  'blue_ball': 6,
  'red': 7,
  'red_ball': 7,
  'yellow': 8,
  'yellow_ball': 8,
  'gray': 9,
  'gray_ball': 9,
  'grey': 9,
  'grey_ball': 9,
  'green': 10,
  'green_ball': 10,
};

// Helper: Get ball weight for sorting
function getBallWeight(metricId: string, customMeasurements: Measurement[]): number {
  // Get the measurement name to check (not the UUID)
  const measurementName = customMeasurements.find(
    m => m.primary_metric_id === metricId || m.secondary_metric_id === metricId
  )?.name;
  const textToCheck = (measurementName || metricId).toLowerCase();

  for (const [key, weight] of Object.entries(ballWeightOrder)) {
    if (textToCheck.includes(key)) {
      return weight;
    }
  }
  return 999; // Non-ball metrics go last
}

// Helper: Get measurement name from metricId (looks up in customMeasurements)
function getMeasurementName(metricId: string, customMeasurements: Measurement[]): string | null {
  for (const measurement of customMeasurements) {
    if (measurement.primary_metric_id === metricId || measurement.secondary_metric_id === metricId) {
      return measurement.name;
    }
  }
  return null;
}

// Helper: Check if metric is a ball-related metric
function isBallMetric(metricId: string, customMeasurements: Measurement[]): boolean {
  // First check the measurement name from customMeasurements
  const measurementName = getMeasurementName(metricId, customMeasurements);
  const textToCheck = measurementName || metricId;
  const lowerText = textToCheck.toLowerCase();

  const ballKeywords = ['oz', 'ball', 'blue', 'red', 'yellow', 'gray', 'grey', 'green', 'baseball'];
  return ballKeywords.some(keyword => lowerText.includes(keyword));
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
  hasPrev,
  hasNext,
  blockLabel,
  exerciseHistory,
  onInputChange,
  onToggleSetComplete,
  onNextSet,
  onPrevExercise,
  onNextExercise,
  onBackToOverview,
  prAlert,
}: ExerciseDetailViewProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const videoId = getYouTubeVideoId(exercise.exercises.video_url || null);
  const [prAlertVisible, setPRAlertVisible] = useState(false);
  const [prAnimation] = useState(new Animated.Value(0));
  const [showHistory, setShowHistory] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [shouldRenderPlayer, setShouldRenderPlayer] = useState(false);

  // Custom keypad state
  const [activeInput, setActiveInput] = useState<{
    setIndex: number;
    metricId: string;
    isDecimal: boolean;
  } | null>(null);

  // Calculate video dimensions
  const videoWidth = Math.min(screenWidth - 32, 400);
  const videoHeight = videoWidth * (9 / 16);

  // Handle video state changes
  const onVideoStateChange = useCallback((state: string) => {
    if (state === 'ended') {
      setVideoPlaying(false);
    }
  }, []);

  // Handle video ready
  const onVideoReady = useCallback(() => {
    setVideoReady(true);
  }, []);

  // Handle video errors
  const onVideoError = useCallback((error: string) => {
    setVideoError(true);
  }, []);

  // Reset video state when exercise changes and delay player render
  useEffect(() => {
    setVideoError(false);
    setVideoReady(false);
    setVideoPlaying(false);
    setShouldRenderPlayer(false);

    // Delay rendering the player to avoid mount issues
    const timer = setTimeout(() => {
      setShouldRenderPlayer(true);
    }, 100);

    return () => clearTimeout(timer);
  }, [exercise.id]);

  // Scroll refs for auto-scrolling to current set
  const scrollViewRef = useRef<ScrollView>(null);
  const setCardPositions = useRef<Record<number, number>>({});

  // Auto-scroll to current set when it changes
  useEffect(() => {
    const position = setCardPositions.current[currentSetIndex];
    if (position !== undefined && scrollViewRef.current) {
      // Small delay to ensure layout is complete
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({
          y: position,
          animated: true,
        });
      }, 100);
    }
  }, [currentSetIndex]);

  // Handle set card layout to track positions
  const handleSetCardLayout = (index: number, event: LayoutChangeEvent) => {
    const { y } = event.nativeEvent.layout;
    setCardPositions.current[index] = y;
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
    onInputChange(setIndex, metricId, newValue);
  };

  const handleKeypadBackspace = () => {
    if (!activeInput) return;
    const { setIndex, metricId } = activeInput;
    const currentInputs = exerciseInputs[exercise.id] || [];
    const setData = currentInputs[setIndex] || {};
    const currentValue = setData[metricId]?.toString() || '';
    const newValue = currentValue.slice(0, -1);
    onInputChange(setIndex, metricId, newValue);
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
          onInputChange(setIndex, field, placeholders[field], undefined, true);
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
  const getMetricFields = (): string[] => {
    let fields: string[] = [];

    if (exercise.enabled_measurements && exercise.enabled_measurements.length > 0) {
      // Use custom measurements
      exercise.enabled_measurements.forEach(measurementId => {
        const measurement = customMeasurements.find(m => m.id === measurementId);
        if (measurement) {
          if (measurement.primary_metric_id) fields.push(measurement.primary_metric_id);
          if (measurement.secondary_metric_id) fields.push(measurement.secondary_metric_id);
        }
      });
    } else if (exercise.metric_targets && Object.keys(exercise.metric_targets).length > 0) {
      // Fallback to metric_targets if explicitly set
      fields = Object.keys(exercise.metric_targets);
    } else if (exercise.reps || exercise.weight) {
      // Legacy fallback - only if exercise has legacy reps/weight set
      fields = ['reps'];
      if (exercise.weight) fields.push('weight');
    }
    // If no metrics configured, fields stays empty (notes-only exercise)

    // Sort ball metrics by weight (heaviest to lightest)
    // Group primary metrics (reps) and secondary metrics (velo) together per ball type
    const hasBallMetrics = fields.some(f => isBallMetric(f, customMeasurements));
    if (hasBallMetrics) {
      // Separate ball and non-ball metrics
      const ballMetrics = fields.filter(f => isBallMetric(f, customMeasurements));
      const nonBallMetrics = fields.filter(f => !isBallMetric(f, customMeasurements));

      // Sort ball metrics by weight, keeping primary (reps) before secondary (velo) for same ball
      ballMetrics.sort((a, b) => {
        const weightA = getBallWeight(a, customMeasurements);
        const weightB = getBallWeight(b, customMeasurements);
        if (weightA !== weightB) return weightA - weightB;
        // Same ball type - primary (reps) comes before secondary (velo)
        const isAPrimary = a.toLowerCase().includes('reps');
        const isBPrimary = b.toLowerCase().includes('reps');
        if (isAPrimary && !isBPrimary) return -1;
        if (!isAPrimary && isBPrimary) return 1;
        return 0;
      });

      fields = [...nonBallMetrics, ...ballMetrics];
    }

    return fields;
  };

  const metricFields = getMetricFields();

  // Get set configuration for current set
  const getSetConfig = (setIndex: number): SetConfiguration | null => {
    if (exercise.set_configurations && exercise.set_configurations[setIndex]) {
      return exercise.set_configurations[setIndex];
    }
    return null;
  };

  // Get target value for a metric in a specific set
  const getTargetValue = (setIndex: number, metricId: string): number | undefined => {
    const setConfig = getSetConfig(setIndex);
    if (setConfig?.metric_values?.[metricId]) {
      return setConfig.metric_values[metricId];
    }
    if (exercise.metric_targets?.[metricId]) {
      return exercise.metric_targets[metricId];
    }
    return undefined;
  };

  // Helper to get max value from athleteMaxes
  const getMaxValue = (exerciseId: string, metricId: string): number | null => {
    return athleteMaxes[exerciseId]?.[metricId] ?? null;
  };

  // Get intensity target for a metric in a specific set
  // Supports cross-exercise intensity (e.g., DB Bench at 50% of Barbell Bench max)
  // For throwing velocity metrics, falls back to mound velocity conversion if no specific PR
  const getIntensityTarget = (setIndex: number, metricId: string): {
    percent: number;
    calculatedValue?: number;
    sourceExerciseName?: string | null;
  } | null => {
    const setConfig = getSetConfig(setIndex);
    const intensityTargets = setConfig?.intensity_targets || exercise.intensity_targets;

    if (intensityTargets) {
      const target = intensityTargets.find(t => t.metric === metricId);
      if (target) {
        // Determine source exercise for max lookup
        // If source_exercise_id is set, use that exercise's max
        // Otherwise, use the current exercise's max
        const sourceExerciseId = target.source_exercise_id || exercise.exercise_id;
        const sourceMetricId = target.source_metric_id || metricId;

        const maxValue = getMaxValue(sourceExerciseId, sourceMetricId);

        // For throwing velocity metrics, use calculateThrowingTarget which handles:
        // 1. Using athlete's specific max if available
        // 2. Falling back to mound velocity conversion if not
        if (isThrowingVelocityMetric(metricId)) {
          const calculatedValue = calculateThrowingTarget(
            maxValue,
            moundVelocity ?? null,
            metricId,
            target.percent
          );

          if (calculatedValue !== null) {
            return {
              percent: target.percent,
              calculatedValue,
              sourceExerciseName: target.source_exercise_name,
            };
          }
          // Return intensity even without calculated value
          return {
            percent: target.percent,
            sourceExerciseName: target.source_exercise_name,
          };
        }

        // Non-throwing metrics: simple percentage calculation
        if (maxValue) {
          const calculatedValue = Math.round(maxValue * (target.percent / 100));
          return {
            percent: target.percent,
            calculatedValue,
            sourceExerciseName: target.source_exercise_name,
          };
        }
        // Return intensity even without a max value (so we show the percentage)
        return {
          percent: target.percent,
          sourceExerciseName: target.source_exercise_name,
        };
      }
    }
    return null;
  };

  // Check if set is completed
  const isSetCompleted = (setIndex: number): boolean => {
    return completedSets[exercise.id]?.[setIndex] === true;
  };

  // Get all placeholder values for a set (for auto-fill when checking)
  const getPlaceholderValuesForSet = (setIndex: number): Record<string, any> => {
    const values: Record<string, any> = {};
    metricFields.forEach(metricId => {
      const targetValue = getTargetValue(setIndex, metricId);
      const intensityTarget = getIntensityTarget(setIndex, metricId);
      const placeholderValue = intensityTarget?.calculatedValue ?? targetValue;
      if (placeholderValue !== undefined) {
        values[metricId] = placeholderValue;
      }
    });
    return values;
  };

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
  const SWIPE_THRESHOLD = 100; // Minimum distance for a "hard" swipe
  const SWIPE_VELOCITY_THRESHOLD = 0.3; // Minimum velocity for swipe

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // Only capture horizontal swipes that are more horizontal than vertical
      const { dx, dy } = gestureState;
      return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20;
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
  }), [hasPrev, hasNext, onPrevExercise, onNextExercise]);

  // Render set cards
  const renderSetCards = () => {
    const sets = [];
    for (let i = 0; i < exercise.sets; i++) {
      const setData = exerciseInputs[exercise.id]?.[i] || {};
      const setConfig = getSetConfig(i);
      const isCompleted = isSetCompleted(i);
      const isCurrentSet = i === currentSetIndex;

      sets.push(
        <View
          key={i}
          onLayout={(e) => handleSetCardLayout(i, e)}
          style={[
            styles.setCard,
            isCompleted && styles.setCardCompleted,
            isCurrentSet && styles.setCardCurrent,
          ]}
        >
          {/* Set Header */}
          <View style={styles.setHeader}>
            <Text style={styles.setHeaderText}>
              Set {i + 1} of {exercise.sets}
            </Text>
            <TouchableOpacity
              style={[
                styles.completionCheckmark,
                isCompleted && styles.completionCheckmarkCompleted,
              ]}
              onPress={() => handleCheckboxToggle(i)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.checkmarkIcon,
                !isCompleted && styles.checkmarkIconEmpty,
              ]}>
                {isCompleted ? '✓' : ''}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Intensity indicator - only show if there's an intensity target */}
          {(() => {
            const intensityTarget = metricFields
              .map(metricId => getIntensityTarget(i, metricId))
              .find(t => t !== null);
            if (!intensityTarget) return null;

            return (
              <View style={styles.intensityTag}>
                <Text style={styles.intensityTagText}>
                  @{intensityTarget.percent}%{intensityTarget.sourceExerciseName ? ` ${intensityTarget.sourceExerciseName}` : ''}
                </Text>
              </View>
            );
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

                        return (
                          <View key={metricId} style={styles.metricInput}>
                            <View style={styles.metricLabelRow}>
                              <Text style={styles.metricLabel}>{label}</Text>
                            </View>
                            <TouchableOpacity
                              style={[
                                styles.input,
                                currentValue != null && currentValue !== '' && styles.inputFilled,
                                isActive && styles.inputActive,
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
                                  : placeholderValue ? String(placeholderValue) : `Enter ${label}`}
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

                          return (
                            <View key={metricId} style={styles.ballGroupMetricInput}>
                              <Text style={styles.ballGroupMetricLabel}>{label}</Text>
                              <TouchableOpacity
                                style={[
                                  styles.ballGroupInput,
                                  currentValue != null && currentValue !== '' && styles.inputFilled,
                                  isActive && styles.inputActive,
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

          {/* Per-set notes from coach (read-only display) */}
          {setConfig?.notes && (
            <View style={styles.setNotesDisplay}>
              <Text style={styles.setNotesText}>{setConfig.notes}</Text>
            </View>
          )}
        </View>
      );
    }
    return sets;
  };

  const isLastSetOfExercise = currentSetIndex >= exercise.sets - 1;
  const isSuperset = routine.scheme === 'superset' || routine.scheme === 'circuit';

  // Helper to truncate exercise name for button
  const truncateName = (name: string, maxLength: number = 14): string => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 1) + '…';
  };

  // Dynamic button text based on workout type and progress
  // Shows "Next Set" when staying on same exercise, or the actual exercise name when switching
  const getNextButtonText = () => {
    const routineExercises = routine.routine_exercises;
    const exerciseIndexInRoutine = routineExercises.findIndex(re => re.id === exercise.id);

    if (isSuperset) {
      // SUPERSET/CIRCUIT: Determine what exercise comes next in rotation
      // After pressing next, the current exercise's set index will be incremented

      const newCurrentSetIndex = currentSetIndex + 1;

      // Simulate what the new indexes would be after pressing next
      const simulatedIndexes = { ...currentSetIndexes };
      simulatedIndexes[exercise.id] = newCurrentSetIndex;

      // Find next exercise in rotation that still has sets remaining
      let nextExercise: RoutineExercise | null = null;

      for (let i = 1; i <= routineExercises.length; i++) {
        const idx = (exerciseIndexInRoutine + i) % routineExercises.length;
        const candidateExercise = routineExercises[idx];
        const candidateSetIndex = simulatedIndexes[candidateExercise.id] || 0;

        if (candidateSetIndex < candidateExercise.sets) {
          nextExercise = candidateExercise;
          break;
        }
      }

      if (!nextExercise) {
        // No more exercises in this routine have sets - check next routine
        const currentExerciseGlobalIndex = allExercises.findIndex(ex => ex.id === exercise.id);
        const isLastExerciseGlobally = currentExerciseGlobalIndex >= allExercises.length - 1;

        if (isLastExerciseGlobally) {
          return 'DONE';
        }

        // Find next exercise from a different routine
        const nextGlobalExercise = allExercises[currentExerciseGlobalIndex + 1];
        if (nextGlobalExercise) {
          return truncateName(nextGlobalExercise.exercises.name) + ' →';
        }
        return 'DONE';
      }

      // If next exercise is the same as current, show "Next Set"
      if (nextExercise.id === exercise.id) {
        return 'Next Set →';
      }

      // Otherwise show the next exercise's name
      return truncateName(nextExercise.exercises.name) + ' →';

    } else {
      // STRAIGHT SETS: Complete all sets of current exercise before moving on
      if (isLastSetOfExercise) {
        // Done with this exercise, check what's next
        const currentExerciseIndex = allExercises.findIndex(ex => ex.id === exercise.id);
        const isLastExercise = currentExerciseIndex >= allExercises.length - 1;

        if (isLastExercise) {
          return 'DONE';
        }

        // Show next exercise's name
        const nextExercise = allExercises[currentExerciseIndex + 1];
        return truncateName(nextExercise.exercises.name) + ' →';
      }

      // Not on last set, show "Next Set"
      return 'Next Set →';
    }
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
            <Text style={styles.backToOverviewIcon}>←</Text>
          </TouchableOpacity>

          {/* Block Label - Simple text */}
          {blockLabel && (
            <Text style={styles.blockLabelText}>{blockLabel}</Text>
          )}

          {/* Exercise Name */}
          <Text style={styles.exerciseName} numberOfLines={2}>
            {exercise.exercises.name}
          </Text>
          {exercise.selected_variation && (
            <Text style={styles.variationText}> ({exercise.selected_variation})</Text>
          )}

          {/* PR Trophy */}
          {exercise.tracked_max_metrics && exercise.tracked_max_metrics.length > 0 && (
            <Text style={styles.headerPrTrophy}>🏆</Text>
          )}
        </View>

        {/* Tempo only shown in header */}
        {exercise.tempo && (
          <View style={styles.exerciseDetailsInline}>
            <Text style={styles.inlineDetail}>⏱ {exercise.tempo}</Text>
          </View>
        )}
      </View>

      {/* Video Section - YouTube Player with fallback (hidden when keyboard is active) */}
      {videoId && !activeInput && (
        videoError ? (
          // Fallback: Thumbnail that opens YouTube app
          <TouchableOpacity
            style={[styles.videoContainer, styles.videoFallback, { width: videoWidth, height: videoHeight }]}
            onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`)}
            activeOpacity={0.8}
          >
            <Image
              source={{ uri: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` }}
              style={styles.videoThumbnail}
              resizeMode="cover"
            />
            <View style={styles.playButtonOverlay}>
              <View style={styles.playButton}>
                <Text style={styles.playButtonIcon}>▶</Text>
              </View>
              <Text style={styles.watchOnYouTubeText}>Watch on YouTube</Text>
            </View>
          </TouchableOpacity>
        ) : (
          // YouTube Player
          <View style={[styles.videoContainer, { width: videoWidth, height: videoHeight }]}>
            {(!videoReady || !shouldRenderPlayer) && (
              <View style={styles.videoLoading}>
                <Text style={styles.videoLoadingText}>Loading video...</Text>
              </View>
            )}
            {shouldRenderPlayer && (
              <YoutubePlayer
                height={videoHeight}
                width={videoWidth}
                play={videoPlaying}
                videoId={videoId}
                onChangeState={onVideoStateChange}
                onReady={onVideoReady}
                onError={onVideoError}
                webViewProps={{
                  allowsInlineMediaPlayback: true,
                  mediaPlaybackRequiresUserAction: false,
                }}
              />
            )}
          </View>
        )
      )}

      {/* Exercise Notes/Description - Below video, above sets */}
      {(exercise.notes || exercise.exercises.description) && (
        <View style={styles.exerciseNotesSection}>
          {exercise.notes && (
            <View style={styles.coachNoteRow}>
              <Text style={styles.coachNoteIcon}>📝</Text>
              <Text style={styles.coachNoteText}>{exercise.notes}</Text>
            </View>
          )}
          {exercise.exercises.description && (
            <View style={styles.descriptionRow}>
              <Text style={styles.descriptionIcon}>ℹ️</Text>
              <Text style={styles.descriptionText}>{exercise.exercises.description}</Text>
            </View>
          )}
        </View>
      )}

      {/* Sets Section */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.setsScrollView}
        contentContainerStyle={styles.setsContent}
        showsVerticalScrollIndicator={false}
      >
        {renderSetCards()}
      </ScrollView>

      {/* History Panel - shows above bottom nav when expanded */}
      {showHistory && (
        <View style={styles.historyPanel}>
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
        </View>
      )}

      {/* Fixed Bottom Navigation */}
      <View style={styles.bottomNav}>
        <View style={styles.bottomNavGradient}>
          <View style={styles.bottomNavContainer}>
            {/* History Button */}
            <TouchableOpacity
              style={[styles.historyButton, showHistory && styles.historyButtonActive]}
              onPress={() => setShowHistory(!showHistory)}
              activeOpacity={0.7}
            >
              <Text style={styles.historyButtonIcon}>📊</Text>
              <Text style={styles.historyButtonText}>History</Text>
            </TouchableOpacity>

            {/* Overview Button */}
            <TouchableOpacity
              style={styles.overviewButton}
              onPress={onBackToOverview}
              activeOpacity={0.7}
            >
              <Text style={styles.overviewButtonIcon}>☰</Text>
              <Text style={styles.overviewButtonText}>Overview</Text>
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
                      style={[styles.nextSetButton, styles.doneButton]}
                      onPress={onNextSet}
                      activeOpacity={0.7}
                    >
                      <LinearGradient
                        colors={['#10B981', '#059669']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.doneButtonGradient}
                      >
                        <Text style={styles.doneButtonIcon}>✓</Text>
                        <Text style={styles.doneButtonText}>DONE</Text>
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
                    activeOpacity={0.7}
                  >
                    <Text style={styles.nextSetButtonIcon}>›</Text>
                    <Text style={styles.nextSetButtonText}>{nextExerciseName}</Text>
                  </TouchableOpacity>
                );
              }

              return (
                <TouchableOpacity
                  style={[
                    styles.nextSetButton,
                    nextText === 'DONE' && currentSetCompleted && styles.doneButton,
                  ]}
                  onPress={handleNextButtonPress}
                  activeOpacity={0.7}
                >
                  {nextText === 'DONE' && currentSetCompleted ? (
                    <LinearGradient
                      colors={['#10B981', '#059669']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.doneButtonGradient}
                    >
                      <Text style={styles.doneButtonIcon}>✓</Text>
                      <Text style={styles.doneButtonText}>DONE</Text>
                    </LinearGradient>
                  ) : !currentSetCompleted ? (
                    <>
                      <Text style={styles.nextSetButtonIcon}>✓</Text>
                      <Text style={styles.nextSetButtonText}>Log Set</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.nextSetButtonIcon}>›</Text>
                      <Text style={styles.nextSetButtonText}>{nextText}</Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            })()}
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  keyboardAvoidingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  header: {
    backgroundColor: '#0A0A0A',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
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
    gap: 8,
  },
  backToOverviewButton: {
    width: 28,
    height: 28,
    backgroundColor: 'rgba(115, 115, 115, 0.2)',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backToOverviewIcon: {
    fontSize: 14,
    color: '#A3A3A3',
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
  exerciseName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  variationText: {
    color: '#C084FC',
    fontSize: 14,
    fontWeight: 'normal',
    textTransform: 'none',
  },
  headerPrTrophy: {
    fontSize: 18,
    marginLeft: 4,
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
    marginTop: 8,
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
  videoContainer: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
    borderRadius: 8,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  videoLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    zIndex: 1,
  },
  videoLoadingText: {
    color: '#737373',
    fontSize: 14,
  },
  videoFallback: {
    position: 'relative',
  },
  videoThumbnail: {
    width: '100%',
    height: '100%',
  },
  playButtonOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonIcon: {
    fontSize: 24,
    color: '#FFFFFF',
    marginLeft: 4,
  },
  watchOnYouTubeText: {
    marginTop: 8,
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
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
    padding: 16,
    paddingBottom: 120,
    gap: 12,
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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 12,
  },
  setCardCompleted: {
    borderColor: 'rgba(16, 185, 129, 0.3)',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  setCardCurrent: {
    borderColor: 'rgba(155, 221, 255, 0.4)',
    borderWidth: 2,
  },
  setHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  setHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  completionCheckmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(115, 115, 115, 0.2)',
    borderWidth: 2,
    borderColor: 'rgba(115, 115, 115, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  completionCheckmarkCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: '#10B981',
  },
  checkmarkIcon: {
    fontSize: 14,
    color: '#6EE7B7',
    fontWeight: 'bold',
  },
  checkmarkIconEmpty: {
    color: 'transparent',
  },
  intensityTag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.3)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  intensityTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#60A5FA',
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
    gap: 12,
    marginBottom: 12,
  },
  nonBallMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricInput: {
    flex: 1,
    minWidth: '45%',
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  metricLabel: {
    fontSize: 11,
    color: '#A3A3A3',
  },
  metricLabelWithIcon: {
    marginLeft: 0,
  },
  input: {
    height: 44,
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    justifyContent: 'center',
  },
  inputText: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  inputPlaceholder: {
    color: '#737373',
  },
  inputActive: {
    borderColor: '#10B981',
    borderWidth: 2,
  },
  inputFilled: {
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
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
    color: '#737373',
    marginBottom: 4,
    textAlign: 'center',
  },
  ballGroupInput: {
    height: 40,
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  setNotesDisplay: {
    width: '100%',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.3)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 4,
  },
  setNotesText: {
    fontSize: 13,
    color: '#FCD34D',
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
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#0A0A0A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  bottomNavContainer: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 12,
    maxWidth: 380,
    alignSelf: 'center',
    width: '100%',
  },
  historyButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: '#262626',
    borderWidth: 1,
    borderColor: '#404040',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  historyButtonActive: {
    backgroundColor: '#3D2F1F',
    borderColor: '#F59E0B',
  },
  historyButtonIcon: {
    fontSize: 14,
  },
  historyButtonText: {
    fontSize: 9,
    color: '#E5E5E5',
    marginTop: 2,
  },
  overviewButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: '#262626',
    borderWidth: 1,
    borderColor: '#404040',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  overviewButtonIcon: {
    fontSize: 14,
    color: '#E5E5E5',
  },
  overviewButtonText: {
    fontSize: 9,
    color: '#E5E5E5',
    marginTop: 2,
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
  nextSetButton: {
    flex: 1.2,
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: '#0C4A6E',
    borderWidth: 1,
    borderColor: '#9BDDFF',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  nextSetButtonIcon: {
    fontSize: 14,
    color: '#9BDDFF',
  },
  nextSetButtonText: {
    fontSize: 9,
    color: '#9BDDFF',
    marginTop: 2,
  },
  doneButton: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  doneButtonGradient: {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
  },
  doneButtonIcon: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  doneButtonText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyButton: {
    flex: 1,
  },
});
