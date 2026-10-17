import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { formatExerciseMetrics } from '../lib/formatExerciseMetrics';
import { parseInstructionBlock } from '../lib/instructionBlockParser';
import { buildSequence, nextStep } from '../lib/logger/sequence';
import { exerciseDashes, progressLine, workoutProgress } from '../lib/logger/progress';
import { formatRest } from '../lib/logger/rest';
import { formatSetMetrics, metricFieldsFor } from '../lib/logger/setLine';
import { needsWeightEntry, prescribedValue, resolveTarget } from '../lib/logger/targets';
import { LOGGER_COLORS } from '../lib/logger/theme';
import { youTubeId } from '../lib/video';
import VideoModal from '../components/logger/VideoModal';

// Types
import type {
  Measurement,
  LoggerRoutineExercise as RoutineExercise,
  LoggerRoutine as Routine,
  LoggerWorkout as Workout,
} from '../types/logger';
interface BlockOverviewProps {
  workout: Workout;
  customMeasurements: Measurement[];
  completedSets: Record<string, boolean[]>;
  /** Values per exercise per set (results on done / current rows). */
  exerciseInputs: Record<string, any[]>;
  /** rpe per `reId:setIndex`. */
  rpeValues: Record<string, number | null>;
  /** exercise_id -> metric_id -> max, for the current row's next-set target. */
  athleteMaxes: Record<string, Record<string, number>>;
  moundVelocity: number | null;
  /** Rest countdown (useRestTimer in WorkoutLoggerScreen); null when idle. */
  restSecondsLeft: number | null;
  timer: number; // seconds elapsed
  onExercisePress: (exerciseId: string) => void;
  /** Continue: open the next set's exercise ON that set (nextStep). */
  onContinue: (exerciseId: string, setIndex: number) => void;
  onCompleteWorkout: () => void;
  /** Finish is saving (pre-finish flush + completion): buttons show "Saving…". */
  finishing?: boolean;
  onToggleExerciseComplete: (exerciseId: string, sets: number) => void;
  onBack: () => void;
  /** Optional slot rendered at the TOP of the scroll content (above notes + routines). */
  headerSlot?: React.ReactNode;
  /** Optional slot rendered at the BOTTOM of the scroll content (below routines). */
  footerSlot?: React.ReactNode;
  /** Optional slot rendered in the top-right of the screen header (in line
   *  with the Back button + workout title). Used by throwing workouts to
   *  surface the Pulse-sensor entry point next to navigation, NOT inside
   *  the scrollable workload panel. */
  topRightSlot?: React.ReactNode;
  /** Throwing-only: throws feed content. When provided, BlockOverview
   *  renders a [Workout / Throws] segmented control between the header
   *  and body; selecting Throws swaps the exercise list out for this
   *  content so a long throws log can't push the workout off-screen. */
  throwsTabContent?: React.ReactNode;
}

// Helper: Get exercise code badge (A1, A2, B1, etc.)
function getExerciseCode(routineIndex: number, exerciseIndex: number): string {
  const letter = String.fromCharCode(65 + routineIndex); // A, B, C...
  return `${letter}${exerciseIndex + 1}`;
}

// Rows the list shows: keep notes_only / placeholder text rows (warm-up
// blocks), drop only "true" placeholders. Matches CompletedWorkoutScreen.tsx:439.
function visibleExercises(routine: Routine): RoutineExercise[] {
  return routine.routine_exercises.filter(
    ex => !((ex as any).is_placeholder || (ex as any).exercises?.is_placeholder) || (ex as any).notes_only,
  );
}

// "4 × 3 · all done" — prescribed sets × reps of a finished exercise.
function doneSummary(exercise: RoutineExercise): string {
  const reps = prescribedValue(exercise, 0, 'reps') ?? (exercise.reps || null);
  const sets = exercise.sets || 0;
  return reps != null ? `${sets} × ${reps} · all done` : `${sets} sets · all done`;
}

// Helper: Check if all sets are completed
function isExerciseCompleted(exerciseId: string, completedSets: Record<string, boolean[]>): boolean {
  const sets = completedSets[exerciseId];
  return sets ? sets.every(s => s === true) : false;
}

// Segmented tab control used when a throwing workout has both a workout
// body and a throws feed — letting the athlete swap between them rather
// than scroll one past the other.
function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
      hitSlop={6}
    >
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// Page background — plain black for every category.
function getCategoryGradient(category: string): [string, string, string, string, string] {
  // Background is plain black across all categories — the previous design
  // bled a category-tinted color into the bottom of the screen (deep blue
  // for throwing, deep red for hitting, etc) which read as a stray glowing
  // line above the home indicator. Category coloring lives in the header
  // accent + dots, not the page background.
  return ['#000000', '#000000', '#000000', '#000000', '#000000'];
}

export default function BlockOverview({
  workout,
  customMeasurements,
  completedSets,
  exerciseInputs,
  rpeValues,
  athleteMaxes,
  moundVelocity,
  restSecondsLeft,
  timer,
  onExercisePress,
  onContinue,
  onCompleteWorkout,
  finishing = false,
  onToggleExerciseComplete,
  onBack,
  headerSlot,
  footerSlot,
  topRightSlot,
  throwsTabContent,
}: BlockOverviewProps) {
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);
  // Throwing-only tab toggle. Workout = exercise list, Throws = sensor feed.
  const [viewMode, setViewMode] = useState<'workout' | 'throws'>('workout');
  const hasThrowsTab = !!throwsTabContent;
  const [videoModalId, setVideoModalId] = useState<string | null>(null);

  const gradientColors = getCategoryGradient(workout.category);

  // Video modal handlers
  const openVideoModal = (videoId: string) => {
    setVideoModalId(videoId);
  };

  const closeVideoModal = () => {
    setVideoModalId(null);
  };

  const toggleBlock = (routineId: string) => {
    setExpandedBlocks(prev => ({
      ...prev,
      [routineId]: !prev[routineId],
    }));
  };

  // Progress comes from the set-order sequence so it counts exactly the sets
  // the athlete can log (no text/notes rows, uneven supersets respected).
  const sequence = useMemo(() => buildSequence(workout.routines), [workout.routines]);
  const progress = workoutProgress(sequence, completedSets);
  const { doneSets: completedSetsCount, totalSets } = progress;
  // The current exercise = the exercise of the next set to log. Continue
  // opens it on that set (a row tap keeps the exercise's own set index).
  const next = nextStep(sequence, completedSets);

  // A1, A2, B1… per visible row — the list and the Continue label share it.
  // Also an id → row map for the Continue name lookup.
  const { codeById, exerciseById } = useMemo(() => {
    const codes: Record<string, string> = {};
    const byId: Record<string, RoutineExercise> = {};
    workout.routines.forEach((routine, routineIndex) => {
      visibleExercises(routine).forEach((ex, exerciseIndex) => {
        codes[ex.id] = getExerciseCode(routineIndex, exerciseIndex);
        byId[ex.id] = ex;
      });
    });
    return { codeById: codes, exerciseById: byId };
  }, [workout.routines]);
  const nextExercise = next ? exerciseById[next.reId] : undefined;
  const continueLabel = next
    ? `Continue · ${codeById[next.reId] ?? ''} ${nextExercise?.exercises?.name ?? ''}`.trim()
    : '';

  // One set's result: "220 × 2 @8.5".
  const setResult = (exercise: RoutineExercise, fields: string[], setIndex: number): string => {
    const values = exerciseInputs[exercise.id]?.[setIndex] || {};
    const base = formatSetMetrics(fields, m => values[m], customMeasurements);
    const rpe = rpeValues[`${exercise.id}:${setIndex}`];
    return [base, rpe != null ? `@${rpe}` : ''].filter(Boolean).join(' ') || 'done';
  };

  // Current row: "220 × 2 @8.5" (logged so far) + "set 2 next: 200 × 2".
  const currentLine = (exercise: RoutineExercise, fields: string[], setIndex: number) => {
    const inputs = exerciseInputs[exercise.id] || [];
    const logged = (completedSets[exercise.id] || [])
      .map((isDone, i) => (isDone ? setResult(exercise, fields, i) : null))
      .filter((x): x is string => x !== null)
      .join(', ');
    const target = formatSetMetrics(
      fields,
      m => {
        const v = inputs[setIndex]?.[m];
        if (v != null && v !== '') return v;
        return resolveTarget({
          re: exercise,
          setIndex,
          metric: m,
          maxes: athleteMaxes,
          logged: inputs,
          moundVelocity,
        });
      },
      customMeasurements,
    );
    return { logged, next: `set ${setIndex + 1} next${target ? `: ${target}` : ''}` };
  };

  // "enter weight" hint: the row's next set (the Continue set on the current
  // row, else the first set not logged) has no weight to show — nothing
  // prescribed and no % that works out to a number.
  const showWeightHint = (exercise: RoutineExercise, fields: string[]): boolean => {
    const done = completedSets[exercise.id] || [];
    let setIndex = -1;
    if (next && next.reId === exercise.id) setIndex = next.setIndex;
    else for (let i = 0; i < (exercise.sets || 0); i++) if (done[i] !== true) { setIndex = i; break; }
    if (setIndex < 0) return false;
    return needsWeightEntry({
      re: exercise,
      setIndex,
      maxes: athleteMaxes,
      logged: exerciseInputs[exercise.id] || [],
      moundVelocity,
      fields,
    });
  };

  const progressPercent = totalSets > 0 ? (completedSetsCount / totalSets) * 100 : 0;
  const allSetsCompleted = completedSetsCount === totalSets && totalSets > 0;

  return (
    <LinearGradient
      colors={gradientColors}
      locations={[0, 0.3, 0.7, 0.9, 1]}
      style={styles.gradientContainer}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
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
          {/* Right side of the header — used by throwing workouts for the
              Pulse-sensor chip (mirrors Back's footprint on the left).
              Falls back to an invisible placeholder so the title stays
              centered when there's no slot content. */}
          {topRightSlot ? (
            <View style={styles.headerTopRight}>{topRightSlot}</View>
          ) : (
            <View style={styles.backButtonPlaceholder} />
          )}
        </View>

        {/* Progress Bar */}
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <LinearGradient
              colors={[LOGGER_COLORS.accent, LOGGER_COLORS.accentEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressBarFill, { width: `${progressPercent}%` }]}
            />
          </View>
        </View>

        {/* "7/16 sets · 24 min" + the rest countdown on the right. */}
        <View style={styles.progressMetaRow}>
          <Text style={styles.progressText}>
            {progressLine(progress, Math.floor(timer / 60))}
          </Text>
          {restSecondsLeft != null && (
            <Text style={styles.restText}>Rest {formatRest(restSecondsLeft)}</Text>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Optional top slot — throwing workload monitor mounts here */}
        {headerSlot}

        {/* Throwing-only tab bar — splits the body between the workout
            (exercises) and the throws feed so a long throws log doesn't
            compete with the exercise list for vertical space. */}
        {hasThrowsTab && (
          <View style={styles.tabBar}>
            <TabButton
              label="Workout"
              active={viewMode === 'workout'}
              onPress={() => setViewMode('workout')}
            />
            <TabButton
              label="Throws"
              active={viewMode === 'throws'}
              onPress={() => setViewMode('throws')}
            />
          </View>
        )}

        {/* THROWS tab — render the feed and skip the workout body below. */}
        {hasThrowsTab && viewMode === 'throws' && (
          <View style={styles.throwsTabBody}>{throwsTabContent}</View>
        )}

        {/* WORKOUT tab (default when no tab bar) — render notes + body. */}
        {(!hasThrowsTab || viewMode === 'workout') && (
          <>
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
        const rows = visibleExercises(routine);
        // Every row checked off → the block dims and its header shows ✓.
        // An empty completion array (a row with 0 sets) never counts as done.
        const blockDone =
          rows.length > 0 &&
          rows.every(ex => (completedSets[ex.id]?.length ?? 0) > 0 && isExerciseCompleted(ex.id, completedSets));
        // Dim per element (RN opacity cascades to children) so the green
        // "all done" result line stays at full strength.
        const dim = blockDone ? styles.dimmed : null;

        return (
          <View key={routine.id} style={styles.blockSection}>
            {/* Block Header */}
            <TouchableOpacity
              style={[styles.blockHeader, dim]}
              onPress={() => toggleBlock(routine.id)}
              activeOpacity={0.7}
            >
              <View style={styles.blockHeaderContent}>
                <View style={styles.blockNameRow}>
                  <Text style={styles.blockName}>{routine.name}</Text>
                  <View style={styles.blockDividerLine} />
                </View>
                {routine.description && (
                  <Text style={styles.blockDescription}>{routine.description}</Text>
                )}
              </View>
              {blockDone ? (
                <Text style={styles.blockDoneIcon}>✓</Text>
              ) : (
                <Text style={styles.chevronIcon}>{isExpanded ? '▼' : '▶'}</Text>
              )}
            </TouchableOpacity>

            {/* Notes Section */}
            {isExpanded && routine.notes && (
              <View style={[styles.blockNotesContainer, dim]}>
                <Text style={styles.blockNotes}>{routine.notes}</Text>
              </View>
            )}

            {/* Inter-round rest pill — coaches prescribe this on supersets/
                circuits/EMOMs. Previously the value was on the routine row
                but never surfaced to the athlete. */}
            {isExpanded && (routine as any).rest_between_rounds_seconds ? (
              <View style={[styles.restBetweenRoundsRow, dim]}>
                <Text style={styles.restBetweenRoundsLabel}>
                  ⏱ Rest between rounds: {(routine as any).rest_between_rounds_seconds}s
                </Text>
              </View>
            ) : null}

            {/* Exercise List */}
            {isExpanded && (
              <View style={styles.exerciseList}>
                {rows.map((exercise, exerciseIndex) => {
                  const isNotesOnlyRow = !exercise.exercises || !!(exercise as any).notes_only;
                  // Bail only when we have neither an exercise join NOR notes-only
                  // content — those rows have nothing to show.
                  if (!exercise.exercises && !isNotesOnlyRow) {
                    console.warn(`Missing exercise data for routine_exercise ${exercise.id}`);
                    return null;
                  }
                  const exerciseCode = getExerciseCode(routineIndex, exerciseIndex);
                  const videoId = youTubeId(exercise.exercises?.video_url || null);
                  const isCompleted = isExerciseCompleted(exercise.id, completedSets);
                  const hasPRTracking = exercise.tracked_max_metrics && exercise.tracked_max_metrics.length > 0;
                  // Current exercise (exercise of the next set to log): sky
                  // rail + tint, logged-so-far + next-set line, set dashes.
                  const isCurrent = !!next && next.reId === exercise.id;
                  const fields = isNotesOnlyRow ? [] : metricFieldsFor(exercise, customMeasurements);
                  const dashes = isNotesOnlyRow
                    ? []
                    : exerciseDashes(exercise.id, sequence, completedSets, next ?? undefined);
                  const showDashes = dashes.length > 0 && (isCurrent || dashes.includes('done'));
                  const current = isCurrent && next ? currentLine(exercise, fields, next.setIndex) : null;
                  const showRpeTag = exercise.ask_rpe === true;
                  const showSpeedTag = exercise.velocity_min_mps != null && exercise.velocity_max_mps != null;

                  // Use newline separator for paired measurements (each ball type on its own line)
                  const metrics = formatExerciseMetrics({
                    exercise,
                    customMeasurements,
                    separator: '\n',
                  });

                  // Notes-only exercises (no measurements, no metric targets,
                  // no legacy reps) carry all their value in `notes` — those
                  // shouldn't be truncated at 2 lines like a metrics-row's
                  // optional coach note. The complete-checkbox branch below
                  // already detects this case; mirror that detection here so
                  // the notes rendering matches.
                  const enabledMeasurementIds = exercise.enabled_measurements || [];
                  const hasMetricTargets =
                    exercise.metric_targets &&
                    Object.keys(exercise.metric_targets).length > 0;
                  const hasLegacyReps = !!exercise.reps;
                  const isNotesOnly =
                    enabledMeasurementIds.length === 0 &&
                    !hasMetricTargets &&
                    !hasLegacyReps;
                  // Finished exercise with sets → green "4 × 3 · all done".
                  const showDoneLine = isCompleted && !isNotesOnly && !isNotesOnlyRow && (exercise.sets || 0) > 0;
                  const weightHint = !isNotesOnlyRow && !isCompleted && showWeightHint(exercise, fields);

                  return (
                    <TouchableOpacity
                      key={exercise.id}
                      style={[styles.exerciseCard, isCurrent && styles.exerciseCardCurrent]}
                      // Notes-only rows have no exercise-detail page to open
                      // (no joined exercise) and opening one crashes. They also
                      // already show their full content inline, so tapping the
                      // card is pointless. Make it a no-op + non-feedback press.
                      onPress={isNotesOnlyRow ? undefined : () => onExercisePress(exercise.id)}
                      activeOpacity={isNotesOnlyRow ? 1 : 0.7}
                    >
                      {/* Left Section */}
                      <View style={[styles.exerciseLeft, dim]}>
                        {/* Exercise Code - Simple text */}
                        <Text style={[styles.exerciseCodeText, isCurrent && styles.exerciseCodeTextCurrent]}>
                          {exerciseCode}
                        </Text>

                        {/* Video Thumbnail — hidden for notes-only rows (no
                            exercise = no video; the empty ▶ icon previously
                            shown would crash on tap). */}
                        {!isNotesOnlyRow && (
                          <TouchableOpacity
                            style={[styles.videoThumbnail, isCurrent && styles.videoThumbnailCurrent]}
                            onPress={(e) => {
                              if (videoId) {
                                e.stopPropagation();
                                openVideoModal(videoId);
                              }
                            }}
                            activeOpacity={videoId ? 0.7 : 1}
                            disabled={!videoId}
                          >
                            {videoId ? (
                              <Image
                                source={{ uri: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` }}
                                style={styles.thumbnailImage}
                                resizeMode="cover"
                              />
                            ) : (
                              <View style={styles.noVideoPlaceholder}>
                                <Text style={styles.playIcon}>▶</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Center Section */}
                      <View style={styles.exerciseCenter}>
                        {/* Exercise Name Row */}
                        <View style={[styles.exerciseNameRow, dim]}>
                          <Text style={styles.exerciseName} numberOfLines={2}>
                            {exercise.exercises?.name || (exercise as any).placeholder_name || 'Exercise'}
                          </Text>
                          {exercise.selected_variation && (
                            <Text style={styles.variationText}> ({exercise.selected_variation})</Text>
                          )}
                          {hasPRTracking && <Text style={styles.prTrophy}>🏆</Text>}
                          {showRpeTag && (
                            <View style={styles.rpeTag}>
                              <Text style={styles.rpeTagText}>RPE</Text>
                            </View>
                          )}
                          {showSpeedTag && (
                            <View style={styles.speedTag}>
                              <Text style={styles.speedTagText}>RACK · SPEED</Text>
                            </View>
                          )}
                        </View>

                        {/* Done → green summary; current → logged so far +
                            next set; otherwise today's prescription. */}
                        {showDoneLine ? (
                          <Text style={styles.doneLine}>{doneSummary(exercise)}</Text>
                        ) : current ? (
                          <Text style={styles.currentLine} numberOfLines={2}>
                            {current.logged ? `${current.logged} · ` : ''}
                            <Text style={styles.currentNext}>{current.next}</Text>
                            {weightHint && <Text style={styles.weightHint}> · enter weight</Text>}
                          </Text>
                        ) : metrics ? (
                          <Text style={[styles.metricsDisplay, dim]} numberOfLines={6}>
                            {metrics}
                            {weightHint && <Text style={styles.weightHint}> · enter weight</Text>}
                          </Text>
                        ) : weightHint ? (
                          <Text style={[styles.metricsDisplay, styles.weightHint, dim]}>enter weight</Text>
                        ) : null}

                        {showDashes && (
                          <View style={[styles.dashRow, dim]}>
                            {dashes.map((d, i) => (
                              <View
                                key={i}
                                style={[
                                  styles.dash,
                                  d === 'done' && styles.dashDone,
                                  d === 'current' && styles.dashCurrent,
                                ]}
                              />
                            ))}
                          </View>
                        )}

                        {/* Exercise Notes — for notes-only rows, parse the
                            structured-instruction grammar into sections +
                            bullets so a wall-of-text warmup ("HEADER: x; y;
                            z. NEXT HEADER: ...") becomes a readable
                            checklist. For exercises with metrics, the notes
                            cell is just a coaching cue — render the original
                            2-line truncated text. */}
                        {exercise.notes && isNotesOnly ? (
                          (() => {
                            const parsed = parseInstructionBlock(exercise.notes);
                            return (
                              <View style={[styles.instructionBlock, dim]}>
                                {parsed.sections.map((section, sIdx) => (
                                  <View
                                    key={sIdx}
                                    style={sIdx > 0 ? styles.instructionSectionSpaced : undefined}
                                  >
                                    {section.header && (
                                      <Text style={styles.instructionHeader}>
                                        {section.header}
                                      </Text>
                                    )}
                                    {section.items.map((item, iIdx) => (
                                      <View key={iIdx} style={styles.instructionBulletRow}>
                                        <Text style={styles.instructionBullet}>•</Text>
                                        <Text style={styles.instructionItem}>{item}</Text>
                                      </View>
                                    ))}
                                  </View>
                                ))}
                                {parsed.callouts.length > 0 && (
                                  <View style={styles.instructionCallout}>
                                    {parsed.callouts.map((callout, cIdx) => (
                                      <View key={cIdx} style={styles.instructionCalloutRow}>
                                        <Text style={styles.instructionCalloutIcon}>⚠</Text>
                                        <Text style={styles.instructionCalloutText}>{callout}</Text>
                                      </View>
                                    ))}
                                  </View>
                                )}
                              </View>
                            );
                          })()
                        ) : exercise.notes && !showDoneLine && !isCurrent ? (
                          <Text style={[styles.exerciseNotes, dim]} numberOfLines={2}>
                            {exercise.notes}
                          </Text>
                        ) : null}

                        {/* Tempo */}
                        {exercise.tempo && !showDoneLine && !isCurrent && (
                          <Text style={[styles.tempo, dim]}>Tempo: {exercise.tempo}</Text>
                        )}
                      </View>

                      {/* Right Section - Quick Complete Checkbox.
                          `isNotesOnly` is hoisted above so notes-rendering and
                          this branch share the same detection logic. */}
                      {(() => {
                        if (isNotesOnly) {
                          // Notes-only exercises show a simple complete checkbox
                          return (
                            <TouchableOpacity
                              style={[styles.exerciseRight, dim]}
                              onPress={(e) => {
                                e.stopPropagation();
                                onToggleExerciseComplete(exercise.id, 1);
                              }}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                              <View style={[
                                styles.quickCompleteCheckbox,
                                isCompleted && styles.quickCompleteCheckboxChecked
                              ]}>
                                {isCompleted && (
                                  <Text style={styles.quickCompleteCheckmark}>✓</Text>
                                )}
                              </View>
                            </TouchableOpacity>
                          );
                        }

                        // All exercises with metrics get a quick-complete checkbox
                        return (
                          <TouchableOpacity
                            style={[styles.exerciseRight, dim]}
                            onPress={(e) => {
                              e.stopPropagation();
                              onToggleExerciseComplete(exercise.id, exercise.sets);
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          >
                            <View style={[
                              styles.quickCompleteCheckbox,
                              isCurrent && styles.quickCompleteCheckboxCurrent,
                              isCompleted && styles.quickCompleteCheckboxChecked
                            ]}>
                              {isCompleted && (
                                <Text style={styles.quickCompleteCheckmark}>✓</Text>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })()}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}
          </>
        )}

      {/* Optional bottom slot — kept for any future use; throws feed
          is no longer routed here (lives in the Throws tab above). */}
      {footerSlot}
      </ScrollView>

      {/* Complete Workout / Finish Early Button (Fixed Bottom).
          When all sets are completed it's a full-width primary action;
          when there's still work left it's a compact secondary pill so
          it doesn't dominate the screen and accidentally invite
          early-quit taps. */}
      <View style={styles.completeButtonContainer}>
        <LinearGradient
          colors={['transparent', 'rgba(10,10,10,0.98)', LOGGER_COLORS.bg]}
          style={styles.completeButtonGradient}
        >
          {allSetsCompleted ? (
            <TouchableOpacity
              style={styles.completeButton}
              onPress={onCompleteWorkout}
              disabled={finishing}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[LOGGER_COLORS.green, '#059669']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.completeButtonActive}
              >
                {finishing ? (
                  <ActivityIndicator color="#FFFFFF" style={styles.completeButtonSpinner} />
                ) : (
                  <Text style={styles.completeButtonIcon}>✓</Text>
                )}
                <Text style={styles.completeButtonText}>{finishing ? 'SAVING…' : 'COMPLETE WORKOUT'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : next ? (
            // Work left: Finish early + Continue to the next set's exercise.
            <View style={styles.bottomBar}>
              <TouchableOpacity
                style={styles.finishEarlyButton}
                onPress={() => setShowIncompleteModal(true)}
                disabled={finishing}
                activeOpacity={0.7}
              >
                <Text style={styles.finishEarlyText}>{finishing ? 'Saving…' : 'Finish early'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.continueButton}
                onPress={() => onContinue(next.reId, next.setIndex)}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={[LOGGER_COLORS.accent, LOGGER_COLORS.accentEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.continueButtonFill}
                >
                  <Text style={styles.continueButtonText} numberOfLines={1}>
                    {continueLabel}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.finishEarlyPill}
              onPress={() => setShowIncompleteModal(true)}
              disabled={finishing}
              activeOpacity={0.7}
              hitSlop={6}
            >
              <Text style={styles.finishEarlyText}>{finishing ? 'Saving…' : 'Finish early'}</Text>
            </TouchableOpacity>
          )}
        </LinearGradient>
      </View>

      {/* Incomplete Workout Warning Modal */}
      <Modal
        visible={showIncompleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowIncompleteModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowIncompleteModal(false)}
        >
          <Pressable style={styles.modalContainer} onPress={() => {}}>
            <View style={styles.modalIconContainer}>
              <Text style={styles.modalIcon}>⚠️</Text>
            </View>

            <Text style={styles.modalTitle}>Finish Early?</Text>
            <Text style={styles.modalSubtitle}>
              You've completed {completedSetsCount} of {totalSets} sets
            </Text>

            <View style={styles.modalProgressBar}>
              <View
                style={[
                  styles.modalProgressFill,
                  { width: `${progressPercent}%` }
                ]}
              />
            </View>

            <Text style={styles.modalDescription}>
              Unlogged exercises won't be saved.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalPrimaryButton}
                onPress={() => {
                  setShowIncompleteModal(false);
                  onCompleteWorkout();
                }}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['#F59E0B', '#D97706']}
                  style={styles.modalPrimaryButtonGradient}
                >
                  <Text style={styles.modalPrimaryButtonText}>Complete Anyway</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSecondaryButton}
                onPress={() => setShowIncompleteModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalSecondaryButtonText}>Keep Logging</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Video Modal */}
      <VideoModal videoId={videoModalId} onClose={closeVideoModal} />
    </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradientContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  // Throwing-only [Workout / Throws] segmented control
  tabBar: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 999,
    padding: 3,
    marginTop: 8,
    marginBottom: 14,
  },
  tabBtn: {
    paddingHorizontal: 22,
    paddingVertical: 8,
    borderRadius: 999,
  },
  tabBtnActive: {
    backgroundColor: LOGGER_COLORS.accent,
  },
  tabBtnText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  tabBtnTextActive: {
    color: '#000',
  },
  throwsTabBody: {
    minHeight: 240,
  },

  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 110,
    maxWidth: 672,
    alignSelf: 'center',
    width: '100%',
  },
  workoutNotes: {
    fontSize: 14,
    fontStyle: 'italic',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  blockSection: {
    marginBottom: 20,
  },
  // Done block: header + rows dim; the green result line does not.
  dimmed: {
    opacity: 0.55,
  },
  blockDoneIcon: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.6)',
    marginLeft: 8,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 4,
  },
  blockHeaderContent: {
    flex: 1,
  },
  blockNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  blockName: {
    fontSize: 16,
    fontWeight: '600',
    fontStyle: 'italic',
    letterSpacing: 0.5,
    color: LOGGER_COLORS.accent,
  },
  blockDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    maxWidth: 100,
  },
  blockDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },
  chevronIcon: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    marginLeft: 8,
  },
  blockNotesContainer: {
    marginBottom: 8,
    paddingLeft: 2,
  },
  blockNotes: {
    fontSize: 12,
    fontStyle: 'italic',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  exerciseList: {
    gap: 2,
  },
  exerciseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  // Current exercise: sky left rail + faint sky tint. The negative margin
  // keeps the code column aligned with the other rows.
  exerciseCardCurrent: {
    backgroundColor: 'rgba(155, 221, 255, 0.05)',
    borderLeftWidth: 3,
    borderLeftColor: LOGGER_COLORS.accent,
    marginLeft: -16,
    paddingLeft: 13,
    marginRight: -16,
    paddingRight: 16,
  },
  exerciseLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exerciseCodeText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.4)',
    minWidth: 28,
  },
  exerciseCodeTextCurrent: {
    color: LOGGER_COLORS.accent,
  },
  videoThumbnail: {
    width: 48,
    height: 32,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  videoThumbnailCurrent: {
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.4)',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  noVideoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.2)',
  },
  exerciseCenter: {
    flex: 1,
  },
  exerciseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Shrinks so a long name wraps/truncates instead of pushing the
  // RPE / RACK · SPEED tags off the row.
  exerciseName: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  variationText: {
    color: '#C084FC',
    fontSize: 13,
    fontWeight: 'normal',
  },
  prTrophy: {
    fontSize: 14,
  },
  // Outlined tags after the name: RPE (amber, ask_rpe) and RACK · SPEED
  // (sky, velocity band set).
  rpeTag: {
    borderWidth: 1,
    borderColor: LOGGER_COLORS.rpeBorder,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  rpeTagText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    color: LOGGER_COLORS.rpe,
  },
  speedTag: {
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.4)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  speedTagText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    color: LOGGER_COLORS.accent,
  },
  doneLine: {
    fontSize: 13,
    color: LOGGER_COLORS.green,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  currentLine: {
    fontSize: 13,
    color: LOGGER_COLORS.text,
    marginTop: 4,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  currentNext: {
    color: LOGGER_COLORS.muted,
  },
  dashRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  dash: {
    width: 16,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  dashDone: {
    backgroundColor: LOGGER_COLORS.green,
  },
  dashCurrent: {
    backgroundColor: LOGGER_COLORS.accent,
  },
  // "enter weight" — low-key, ink-2, inline with the rx line.
  weightHint: {
    color: LOGGER_COLORS.muted,
  },
  metricsDisplay: {
    fontSize: 13,
    color: '#D4D4D4',
    marginTop: 4,
    lineHeight: 18,
  },
  exerciseNotes: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#A3A3A3',
    marginTop: 2,
  },
  // Inter-round rest indicator on supersets/circuits/EMOMs.
  restBetweenRoundsRow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(155, 221, 255, 0.08)',
    borderLeftWidth: 3,
    borderLeftColor: LOGGER_COLORS.accent,
  },
  restBetweenRoundsLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: LOGGER_COLORS.accent,
  },
  // Structured instruction block (parsed notes_only content): header +
  // bulleted items + optional bracketed callouts.
  instructionBlock: {
    marginTop: 6,
  },
  instructionSectionSpaced: {
    marginTop: 8,
  },
  instructionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A5B4FC',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    lineHeight: 16,
  },
  instructionBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 3,
  },
  instructionBullet: {
    fontSize: 13,
    color: '#818CF8',
    marginRight: 6,
    marginTop: 0,
    lineHeight: 18,
  },
  instructionItem: {
    flex: 1,
    fontSize: 13,
    color: '#D4D4D4',
    lineHeight: 18,
  },
  instructionCallout: {
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  instructionCalloutRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  instructionCalloutIcon: {
    fontSize: 12,
    color: '#FBBF24',
    marginRight: 6,
    lineHeight: 16,
  },
  instructionCalloutText: {
    flex: 1,
    fontSize: 12,
    color: '#FCD34D',
    lineHeight: 16,
  },
  tempo: {
    fontSize: 12,
    fontWeight: '500',
    color: LOGGER_COLORS.accent,
    marginTop: 2,
  },
  exerciseRight: {
    justifyContent: 'center',
  },
  header: {
    backgroundColor: 'transparent',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
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
    color: LOGGER_COLORS.accent,
  },
  backButtonText: {
    fontSize: 16,
    color: LOGGER_COLORS.accent,
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
  headerTopRight: {
    minWidth: 60,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 4,
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
  progressMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  progressText: {
    fontSize: 13,
    color: LOGGER_COLORS.muted,
    fontVariant: ['tabular-nums'],
  },
  restText: {
    fontSize: 13,
    fontWeight: '700',
    color: LOGGER_COLORS.accent,
    fontVariant: ['tabular-nums'],
  },
  scrollView: {
    flex: 1,
  },
  workoutNotesBanner: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
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
  completeButtonActive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    shadowColor: LOGGER_COLORS.green,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
  completeButtonIcon: {
    fontSize: 24,
    color: '#FFFFFF',
  },
  completeButtonSpinner: {
    marginRight: 2,
  },
  completeButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  // Compact "Finish early" pill — only shown when the workout still has
  // sets remaining. Deliberately small so it reads as a secondary
  // affordance instead of competing with the per-exercise primary CTAs.
  finishEarlyPill: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
    backgroundColor: 'rgba(245,158,11,0.10)',
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    maxWidth: 672,
    alignSelf: 'center',
  },
  finishEarlyButton: {
    width: 96,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
    backgroundColor: '#111214',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
  },
  continueButtonFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#06202E',
  },
  finishEarlyText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // Quick Complete Checkbox Styles
  quickCompleteCheckbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCompleteCheckboxCurrent: {
    borderColor: LOGGER_COLORS.accent,
  },
  quickCompleteCheckboxChecked: {
    backgroundColor: LOGGER_COLORS.green,
    borderColor: LOGGER_COLORS.green,
  },
  // Same dark tick on green as the exercise screen's set circles.
  quickCompleteCheckmark: {
    fontSize: 14,
    fontWeight: '900',
    color: '#04130C',
  },
  // Modal Styles
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
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalIcon: {
    fontSize: 32,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 16,
    color: '#9CA3AF',
    marginBottom: 16,
  },
  modalProgressBar: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    marginBottom: 16,
    overflow: 'hidden',
  },
  modalProgressFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
    borderRadius: 4,
  },
  modalDescription: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  modalActions: {
    width: '100%',
    gap: 12,
  },
  modalPrimaryButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  modalPrimaryButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalPrimaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalSecondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  modalSecondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
