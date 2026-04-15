/**
 * WorkloadScreen — standalone workload hub for athletes.
 *
 * Architecture: pre-fetch-once + filter-client-side. On mount we pull a
 * 35-day window of (anthro, daily w_day series, targets, throws) in a single
 * burst. Day switching is a pure UI operation — zero network — which fixes
 * the RN HTTP-pool wedge that plagued the per-day-refetch design.
 *
 * `ThrowingWorkloadMonitor` and `ThrowingThrowsFeed` are mounted in their
 * "external" modes here — parent owns the data, children render from props.
 * The throws feed refetches only (the cheap query) when `pulseEvents` fires
 * a commit (live throw landed or sync completed).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Pressable,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Svg, { Rect } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ThrowingWorkloadMonitor, MonitorData } from '../components/pulse/ThrowingWorkloadMonitor';
import { ThrowingThrowsFeed, Throw } from '../components/pulse/ThrowingThrowsFeed';
import { PulseProvider } from '../lib/pulse/PulseProvider';
import { PulseWizardModal } from '../components/pulse/PulseWizardModal';
import {
  acwrColor,
  ACWR_HEX,
  acwr as acwrFn,
  chronicWorkload,
} from '../lib/pulse/workload';
import { pulseEvents } from '../lib/pulse/ble/pulse-events';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** How many days of history we pre-fetch at mount. 35 = 28 for ACWR chronic
 *  window + up to 7 days of user-visible sparkline backslide. */
const WINDOW_DAYS = 35;

type NavProp = StackNavigationProp<any>;

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toISO(dt);
}
function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

type Anthro = { heightInches: number | null; weightLbs: number | null };

type ThrowingWorkoutInstance = {
  id: string;
  workout_id: string;
  scheduled_date: string;
  status: 'not_started' | 'in_progress' | 'completed';
  name: string;
  exerciseCount: number;
};

export default function WorkloadScreen() {
  const navigation = useNavigation<NavProp>();
  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(toISO(new Date()));

  // Pre-fetched data (35-day window ending at today)
  const [anthro, setAnthro] = useState<Anthro>({ heightInches: null, weightLbs: null });
  const [series, setSeries] = useState<number[]>([]);
  const [dateKeys, setDateKeys] = useState<string[]>([]);
  const [targets, setTargets] = useState<Map<string, number>>(new Map());
  const [throws, setThrows] = useState<Throw[]>([]);
  const [throwingWorkouts, setThrowingWorkouts] = useState<
    Map<string, ThrowingWorkoutInstance>
  >(new Map());
  const [dataLoading, setDataLoading] = useState(true);

  // Load athlete profile once
  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          navigation.goBack();
          return;
        }
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id, org_id')
          .eq('user_id', user.id)
          .single();
        if (athlete) {
          setAthleteId(athlete.id);
          setOrgId(athlete.org_id);
        }
      } finally {
        setProfileLoading(false);
      }
    })();
  }, [navigation]);

  // ─────────────────────────────────────────────────────────────
  // Mount-time data fetch — runs ONCE per (athleteId, token).
  // Day switching never triggers network. All four queries run in parallel.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!athleteId || !token) return;

    const today = toISO(new Date());
    const windowStart = addDaysISO(today, -(WINDOW_DAYS - 1));

    let cancelled = false;
    const base = process.env.EXPO_PUBLIC_SUPABASE_URL!;
    const headers = {
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${token}`,
    };

    const getJson = async (tag: string, path: string): Promise<any> => {
      try {
        const r = await fetch(`${base}/rest/v1/${path}`, { headers });
        if (!r.ok) {
          console.log(`[Workload] ${tag} !ok`, r.status);
          return null;
        }
        return await r.json();
      } catch (err: any) {
        console.log(`[Workload] ${tag} ERR`, err?.message);
        return null;
      }
    };

    const run = async () => {
      const t0 = Date.now();
      console.log('[Workload] mount fetch START window=', windowStart, '→', today);
      setDataLoading(true);

      const [athRows, dailyRows, targetRows, throwsRows, workoutRows] = await Promise.all([
        getJson('anthro', `athletes?select=height_inches,weight_lbs&id=eq.${athleteId}&limit=1`),
        getJson(
          'daily',
          `pulse_daily_workload?select=training_date,w_day&athlete_id=eq.${athleteId}` +
            `&training_date=gte.${windowStart}&training_date=lte.${today}` +
            `&order=training_date.asc`,
        ),
        getJson(
          'targets',
          `pulse_athlete_workload_day?select=target_date,target_w_day&athlete_id=eq.${athleteId}` +
            `&target_date=gte.${windowStart}&target_date=lte.${today}`,
        ),
        getJson(
          'throws',
          `pulse_throws?select=id,thrown_at,training_date,torque_nm,arm_speed_dps,arm_slot_deg,workload,source,is_valid` +
            `&athlete_id=eq.${athleteId}&is_valid=eq.true` +
            `&training_date=gte.${windowStart}&training_date=lte.${today}` +
            `&order=thrown_at.desc&limit=2000`,
        ),
        // Throwing workouts assigned in this window. Uses PostgREST inline-join
        // filter to keep the payload small — only category=throwing instances
        // come back. exerciseCount comes from the joined routines aggregate.
        getJson(
          'throwingWorkouts',
          `workout_instances?select=id,workout_id,scheduled_date,status,` +
            `workouts!inner(id,name,category,routines(routine_exercises(id)))` +
            `&athlete_id=eq.${athleteId}` +
            `&scheduled_date=gte.${windowStart}&scheduled_date=lte.${today}` +
            `&workouts.category=eq.throwing`,
        ),
      ]);
      if (cancelled) return;

      // Build continuous series (one entry per day in window, missing days = 0)
      const byDate = new Map<string, number>();
      if (Array.isArray(dailyRows)) {
        for (const r of dailyRows) byDate.set(r.training_date, Number(r.w_day) || 0);
      }
      const newSeries: number[] = [];
      const newKeys: string[] = [];
      let cursor = windowStart;
      while (cursor <= today) {
        newKeys.push(cursor);
        newSeries.push(byDate.get(cursor) ?? 0);
        cursor = addDaysISO(cursor, 1);
      }

      // Targets map
      const newTargets = new Map<string, number>();
      if (Array.isArray(targetRows)) {
        for (const r of targetRows) {
          newTargets.set(r.target_date, Number(r.target_w_day) || 0);
        }
      }

      // Anthro — athletes row only (the fallback chain to test tables lived in
      // the old self-fetch path; if this row is missing values the monitor
      // shows a "missing" warning and the athlete can set them in their profile)
      const ath = Array.isArray(athRows) && athRows.length > 0 ? athRows[0] : null;
      const newAnthro: Anthro = {
        heightInches: ath?.height_inches != null ? Number(ath.height_inches) : null,
        weightLbs: ath?.weight_lbs != null ? Math.round(Number(ath.weight_lbs) * 10) / 10 : null,
      };

      const newThrows: Throw[] = Array.isArray(throwsRows) ? (throwsRows as Throw[]) : [];

      // Build throwing-workout-by-date map. One workout per day is the common
      // case; if there are multiple on the same day we keep the first (most
      // recent by scheduled_date order).
      const newThrowingWorkouts = new Map<string, ThrowingWorkoutInstance>();
      if (Array.isArray(workoutRows)) {
        for (const r of workoutRows) {
          if (newThrowingWorkouts.has(r.scheduled_date)) continue;
          const routines = r.workouts?.routines ?? [];
          const exerciseCount = routines.reduce(
            (sum: number, rt: any) => sum + (rt.routine_exercises?.length ?? 0),
            0,
          );
          newThrowingWorkouts.set(r.scheduled_date, {
            id: r.id,
            workout_id: r.workout_id,
            scheduled_date: r.scheduled_date,
            status: r.status,
            name: r.workouts?.name ?? 'Throwing workout',
            exerciseCount,
          });
        }
      }

      setSeries(newSeries);
      setDateKeys(newKeys);
      setTargets(newTargets);
      setAnthro(newAnthro);
      setThrows(newThrows);
      setThrowingWorkouts(newThrowingWorkouts);
      setDataLoading(false);

      console.log(
        '[Workload] mount fetch DONE',
        Date.now() - t0,
        'ms | daily=',
        Array.isArray(dailyRows) ? dailyRows.length : 0,
        'targets=',
        Array.isArray(targetRows) ? targetRows.length : 0,
        'throws=',
        newThrows.length,
      );
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [athleteId, token]);

  // Throws-only refetch (cheapest query) triggered by live/sync commit events
  const refetchThrows = useCallback(async () => {
    if (!athleteId || !token) return;
    const today = toISO(new Date());
    const windowStart = addDaysISO(today, -(WINDOW_DAYS - 1));
    const url =
      `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/pulse_throws?` +
      `select=id,thrown_at,training_date,torque_nm,arm_speed_dps,arm_slot_deg,workload,source,is_valid` +
      `&athlete_id=eq.${athleteId}&is_valid=eq.true` +
      `&training_date=gte.${windowStart}&training_date=lte.${today}` +
      `&order=thrown_at.desc&limit=2000`;
    try {
      const r = await fetch(url, {
        headers: {
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${token}`,
        },
      });
      if (!r.ok) return;
      const body = await r.json();
      if (Array.isArray(body)) setThrows(body as Throw[]);
    } catch {
      // swallow — next event will try again
    }
  }, [athleteId, token]);

  useEffect(() => {
    const unsub = pulseEvents.onThrowsCommitted(() => {
      refetchThrows();
    });
    return unsub;
  }, [refetchThrows]);

  // ─────────────────────────────────────────────────────────────
  // Derived state for the currently selected day. ZERO network.
  // ─────────────────────────────────────────────────────────────

  const todayIso = toISO(new Date());
  const isToday = selectedDate === todayIso;
  const isFuture = selectedDate > todayIso;

  const anchorIdx = useMemo(() => dateKeys.indexOf(selectedDate), [dateKeys, selectedDate]);

  const monitorData = useMemo<MonitorData>(() => {
    if (anchorIdx < 0) {
      return {
        heightInches: anthro.heightInches,
        weightLbs: anthro.weightLbs,
        acwr: null,
        chronic: 0,
        actualWDay: 0,
        targetWDay: targets.get(selectedDate) ?? null,
      };
    }
    return {
      heightInches: anthro.heightInches,
      weightLbs: anthro.weightLbs,
      acwr: acwrFn(series, anchorIdx),
      chronic: chronicWorkload(series, anchorIdx),
      actualWDay: series[anchorIdx] ?? 0,
      targetWDay: targets.get(selectedDate) ?? null,
    };
  }, [anthro, series, anchorIdx, targets, selectedDate]);

  const dayThrows = useMemo(
    () => throws.filter((t) => t.training_date === selectedDate),
    [throws, selectedDate],
  );

  const dayThrowingWorkout = useMemo(
    () => throwingWorkouts.get(selectedDate) ?? null,
    [throwingWorkouts, selectedDate],
  );

  const sparklineBars = useMemo(() => {
    if (anchorIdx < 0 || series.length === 0) return [];
    const from = Math.max(0, anchorIdx - 6);
    const to = anchorIdx;
    let max = 0;
    const raw: Array<{ date: string; w: number; color: string }> = [];
    for (let i = from; i <= to; i++) {
      const w = series[i];
      const a = acwrFn(series, i);
      const hex = a != null ? ACWR_HEX[acwrColor(a)] : '#9BDDFF';
      if (w > max) max = w;
      raw.push({ date: dateKeys[i], w, color: hex });
    }
    return raw.map((b) => ({ ...b, max }));
  }, [series, dateKeys, anchorIdx]);

  const handlePrev = useCallback(() => setSelectedDate((cur) => addDaysISO(cur, -1)), []);
  const handleNext = useCallback(() => setSelectedDate((cur) => addDaysISO(cur, 1)), []);
  const handleToday = useCallback(() => setSelectedDate(todayIso), [todayIso]);

  const dateLabel = useMemo(() => {
    const d = fromISO(selectedDate);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, [selectedDate]);

  const onThrowDeleted = useCallback((id: string) => {
    setThrows((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // End a throwing workout right from the workload view — same DB write the
  // logger does (status = 'completed' + completed_at). Optimistically updates
  // the local map so the card flips to "Completed" immediately.
  const endThrowingWorkout = useCallback(
    (instance: ThrowingWorkoutInstance) => {
      Alert.alert(
        'End workout?',
        `Mark "${instance.name}" as complete. You can still review it later.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'End workout',
            style: 'destructive',
            onPress: async () => {
              // Optimistic update
              setThrowingWorkouts((prev) => {
                const next = new Map(prev);
                const existing = next.get(instance.scheduled_date);
                if (existing) {
                  next.set(instance.scheduled_date, {
                    ...existing,
                    status: 'completed',
                  });
                }
                return next;
              });
              try {
                const { error } = await supabase
                  .from('workout_instances')
                  .update({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                  })
                  .eq('id', instance.id);
                if (error) throw error;
              } catch (err: any) {
                // Roll back on failure
                setThrowingWorkouts((prev) => {
                  const next = new Map(prev);
                  next.set(instance.scheduled_date, instance);
                  return next;
                });
                Alert.alert(
                  'Failed to end workout',
                  err?.message ?? 'Please try again.',
                );
              }
            },
          },
        ],
      );
    },
    [],
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Workload</Text>
        <View style={styles.rightSpacer} />
      </View>

      {profileLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
        </View>
      ) : athleteId && orgId ? (
        <PulseProvider
          athleteId={athleteId}
          orgId={orgId}
          initialAnthro={anthro}
        >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.dayNavStrip}>
            <Pressable onPress={handlePrev} hitSlop={12} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={20} color="#e5e7eb" />
            </Pressable>
            <Pressable
              onPress={handleToday}
              style={styles.dayNavCenter}
              disabled={isToday}
            >
              <Text style={styles.dayNavLabel}>{dateLabel}</Text>
              {!isToday && <Text style={styles.todayHint}>TAP FOR TODAY</Text>}
            </Pressable>
            <Pressable
              onPress={handleNext}
              hitSlop={12}
              style={styles.navBtn}
              disabled={isFuture}
            >
              <Ionicons
                name="chevron-forward"
                size={20}
                color={isFuture ? '#374151' : '#e5e7eb'}
              />
            </Pressable>
          </View>

          {dataLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#9BDDFF" />
            </View>
          ) : (
            <>
              <ThrowingWorkloadMonitor
                athleteId={athleteId}
                orgId={orgId}
                scheduledDate={selectedDate}
                data={monitorData}
              />

              <Sparkline
                bars={sparklineBars}
                selectedDate={selectedDate}
                onDatePress={setSelectedDate}
              />

              {dayThrowingWorkout && athleteId && (
                <ThrowingWorkoutCard
                  instance={dayThrowingWorkout}
                  onOpen={() =>
                    navigation.navigate('WorkoutLogger', {
                      workoutInstanceId: dayThrowingWorkout.id,
                      athleteId: athleteId,
                    })
                  }
                  onEnd={() => endThrowingWorkout(dayThrowingWorkout)}
                />
              )}

              <ThrowingThrowsFeed
                athleteId={athleteId}
                scheduledDate={selectedDate}
                throws={dayThrows}
                throwsLoading={false}
                onThrowDeleted={onThrowDeleted}
              />
            </>
          )}
        </ScrollView>
        <PulseWizardModal scheduledDate={selectedDate} />
        </PulseProvider>
      ) : (
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Could not load your athlete profile.</Text>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// ThrowingWorkoutCard — bridges the workload view to a scheduled
// throwing workout. Tap → opens the workout logger. Status pill shifts
// the vibe (pending = neutral, in_progress = accent, completed = green).
// ─────────────────────────────────────────────────────────────

function ThrowingWorkoutCard({
  instance,
  onOpen,
  onEnd,
}: {
  instance: ThrowingWorkoutInstance;
  onOpen: () => void;
  onEnd: () => void;
}) {
  const statusMeta = (() => {
    switch (instance.status) {
      case 'in_progress':
        return { label: 'In progress', color: '#9BDDFF', bg: 'rgba(155,221,255,0.1)' };
      case 'completed':
        return { label: 'Completed', color: '#34d399', bg: 'rgba(52,211,153,0.1)' };
      default:
        return { label: 'Scheduled', color: '#9ca3af', bg: 'rgba(255,255,255,0.05)' };
    }
  })();

  const cta =
    instance.status === 'completed'
      ? 'Review workout'
      : instance.status === 'in_progress'
      ? 'Resume workout'
      : 'Open workout';

  const isInProgress = instance.status === 'in_progress';

  return (
    <View style={styles.workoutCardWrap}>
      <Text style={styles.workoutCardLabel}>TODAY'S THROWING WORKOUT</Text>
      <View style={styles.workoutCard}>
        <View style={styles.workoutCardTop}>
          <View style={styles.workoutCardLeft}>
            <Text style={styles.workoutCardName} numberOfLines={1}>
              {instance.name}
            </Text>
            <Text style={styles.workoutCardMeta}>
              {instance.exerciseCount}{' '}
              {instance.exerciseCount === 1 ? 'exercise' : 'exercises'}
            </Text>
          </View>
          <View
            style={[
              styles.workoutCardPill,
              { backgroundColor: statusMeta.bg },
            ]}
          >
            <Text style={[styles.workoutCardPillText, { color: statusMeta.color }]}>
              {statusMeta.label}
            </Text>
          </View>
        </View>

        <View style={styles.workoutCardActions}>
          <Pressable
            onPress={onOpen}
            style={({ pressed }) => [
              styles.workoutCardPrimary,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.workoutCardPrimaryText}>{cta} →</Text>
          </Pressable>
          {isInProgress && (
            <Pressable
              onPress={onEnd}
              style={({ pressed }) => [
                styles.workoutCardSecondary,
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text style={styles.workoutCardSecondaryText}>End</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Sparkline — pure renderer, takes pre-computed bars as props.
// ─────────────────────────────────────────────────────────────

type SparkBar = { date: string; w: number; color: string; max: number };

function Sparkline({
  bars,
  selectedDate,
  onDatePress,
}: {
  bars: SparkBar[];
  selectedDate: string;
  onDatePress: (iso: string) => void;
}) {
  if (bars.length === 0) {
    return <View style={{ height: 72 }} />;
  }

  const chartHeight = 56;
  const chartWidth = 320;
  const barSpacing = 4;
  const barWidth = (chartWidth - barSpacing * (bars.length - 1)) / bars.length;

  return (
    <View style={styles.sparklineWrap}>
      <Text style={styles.sparklineLabel}>PAST 7 DAYS</Text>
      <View style={styles.sparklineBars}>
        {bars.map((bar) => {
          const isSelected = bar.date === selectedDate;
          const ratio = bar.max > 0 ? bar.w / bar.max : 0;
          const height = Math.max(ratio * chartHeight, bar.w > 0 ? 2 : 1);
          const label = fromISO(bar.date)
            .toLocaleDateString('en-US', { weekday: 'narrow' })
            .toUpperCase();
          return (
            <Pressable
              key={bar.date}
              onPress={() => onDatePress(bar.date)}
              hitSlop={4}
              style={[styles.barColumn, { width: barWidth }]}
            >
              <View style={[styles.barContainer, { height: chartHeight }]}>
                <AnimatedBar hex={bar.color} heightPx={height} dimmed={!isSelected} />
              </View>
              <Text
                style={[
                  styles.barDayLabel,
                  isSelected && { color: bar.color, fontWeight: '800' },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function AnimatedBar({
  hex,
  heightPx,
  dimmed,
}: {
  hex: string;
  heightPx: number;
  dimmed: boolean;
}) {
  const h = useSharedValue(0);
  useEffect(() => {
    h.value = withTiming(heightPx, {
      duration: 650,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [heightPx, h]);

  const animatedProps = useAnimatedProps(() => ({
    height: h.value,
    y: 56 - h.value,
  }));

  return (
    <Svg width="100%" height={56}>
      <AnimatedRect
        x={0}
        width="100%"
        rx={2}
        ry={2}
        fill={hex}
        opacity={dimmed ? 0.45 : 1}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 12,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rightSpacer: {
    width: 32,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  errorText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  dayNavStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 10,
  },
  navBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  dayNavCenter: {
    flex: 1,
    alignItems: 'center',
  },
  dayNavLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  todayHint: {
    color: '#4b5563',
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: '700',
    marginTop: 2,
  },
  workoutCardWrap: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  workoutCardLabel: {
    color: '#4b5563',
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  workoutCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(155,221,255,0.04)',
    borderColor: 'rgba(155,221,255,0.18)',
    borderWidth: 1,
    gap: 14,
  },
  workoutCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workoutCardLeft: {
    flex: 1,
    gap: 4,
    marginRight: 12,
  },
  workoutCardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  workoutCardPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(155,221,255,0.1)',
    borderColor: 'rgba(155,221,255,0.3)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutCardPrimaryText: {
    color: '#9BDDFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  workoutCardSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderColor: 'rgba(248,113,113,0.3)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workoutCardSecondaryText: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  workoutCardName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  workoutCardMeta: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
  },
  workoutCardRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  workoutCardPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  workoutCardPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  workoutCardCta: {
    color: '#9BDDFF',
    fontSize: 11,
    fontWeight: '700',
  },
  sparklineWrap: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 14,
    borderColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
  },
  sparklineLabel: {
    color: '#4b5563',
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 8,
  },
  sparklineBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 80,
  },
  barColumn: {
    alignItems: 'center',
  },
  barContainer: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  barDayLabel: {
    color: '#374151',
    fontSize: 9,
    marginTop: 4,
    fontWeight: '600',
  },
});
