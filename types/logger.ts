// Shared types for the workout logger (WorkoutLoggerScreen, exercise-detail-view, block-overview).

export interface Measurement {
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

export interface Exercise {
  id: string;
  name: string;
  video_url?: string;
  description?: string;
  categories?: string[];
  category?: string;
  tags?: string[];
  is_placeholder?: boolean;
}

export interface IntensityTarget {
  id?: string;
  metric: string;
  metric_label?: string;
  percent: number;
  // Cross-exercise intensity fields
  source_exercise_id?: string | null;
  source_exercise_name?: string | null;
  source_metric_id?: string | null;
  // Set-relative intensity ("90% of Set 1"). When relative_to='set',
  // reference_set (1-indexed) names the prior set whose logged value is the
  // base instead of an all-time max. When relative_to is unset/'max', the
  // legacy max-anchored behavior applies.
  relative_to?: 'max' | 'set';
  reference_set?: number;
}

export interface SetConfiguration {
  metric_values?: Record<string, number>;
  is_amrap?: boolean;
  notes?: string;
  rpe?: number | null;
  rest_seconds?: number | null;
  intensity_targets?: IntensityTarget[];
}

export interface LoggerRoutineExercise {
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
  // Notes-only / placeholder rows hold warm-up text (and similar) — they have
  // no joined exercise.
  is_placeholder?: boolean;
  notes_only?: boolean;
  placeholder_name?: string | null;
  ask_rpe: boolean;
  // Exercise-level RPE target; per-set set_configurations[n].rpe wins.
  rpe_target?: number | null;
  velocity_min_mps: number | null;
  velocity_max_mps: number | null;
  speed_drop_stop_pct: number | null;
  rest_seconds: number | null;
  exercises: Exercise;
}

export interface LoggerRoutine {
  id: string;
  name: string;
  description?: string;
  notes?: string;
  text_info?: string;
  order_index: number;
  // DB stores 'straight'; legacy values include 'straight_sets'. See lib/logger/scheme.ts.
  scheme: string;
  rounds: number | null;
  rest_between_rounds_seconds: number | null;
  routine_exercises: LoggerRoutineExercise[];
}

export interface LoggerWorkout {
  id: string;
  name: string;
  category: string;
  notes?: string;
  description?: string;
  estimated_duration_minutes?: number;
  ask_session_rpe: boolean;
  routines: LoggerRoutine[];
}
