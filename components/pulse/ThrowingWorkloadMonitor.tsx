/**
 * ThrowingWorkloadMonitor — slim Pulse workload + BLE control panel that
 * mounts ABOVE the existing workout logger on throwing-category workouts.
 *
 * Renders: ACWR gauge (with target swap), sensor chip (Connect/battery/
 * counter/disconnect), Start Live button, Sync Throws button, live status
 * pill. Does NOT touch drill state or exerciseInputs. The throws feed
 * (ThrowingThrowsFeed) renders BELOW the logger and reads from pulse_throws
 * directly.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { RadialAcwr } from './RadialAcwr';
import { usePulse } from '../../lib/pulse/PulseProvider';
import { simulatePlan } from '../../lib/pulse/workload';
import { queuedFetch } from '../../lib/pulse/fetch-queue';

const SEED_DAYS = 28;

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toISO(dt);
}

export interface MonitorData {
  heightInches: number | null;
  weightLbs: number | null;
  acwr: number | null;
  chronic: number;
  actualWDay: number;
  targetWDay: number | null;
}

interface Props {
  athleteId: string;
  orgId: string;
  /**
   * ISO date (YYYY-MM-DD) of the workout being viewed. Drives the target
   * lookup + actual w_day seed + the date label on the gauge. When omitted,
   * falls back to today — used by the standalone WorkloadScreen.
   */
  scheduledDate?: string;
  /**
   * External mode: when provided, the monitor is fully controlled by the
   * parent — no self-fetch for anthro or workload. Used by WorkloadScreen's
   * pre-fetch-once architecture to avoid the day-switcher wedge.
   */
  data?: MonitorData;
}

export function ThrowingWorkloadMonitor({ athleteId, orgId, scheduledDate, data }: Props) {
  // PERF instrumentation — log render time for this component.
  const _perfT0 = performance.now();
  useEffect(() => {
    const dt = performance.now() - _perfT0;
    if (dt > 2) console.log(`[WorkloadPerf]   Monitor render: ${dt.toFixed(1)}ms (date=${scheduledDate})`);
  });

  const external = data !== undefined;
  const navigation = useNavigation<any>();
  // Determine date mode: today / past / future. Past/future days cannot use
  // live mode (Pulse only generates packets in real time). Past days can still
  // sync to commit any stored throws from the device buffer; future days can do
  // nothing.
  const dateMode = useMemo<'today' | 'past' | 'future'>(() => {
    if (!scheduledDate) return 'today';
    const today = toISO(new Date());
    if (scheduledDate < today) return 'past';
    if (scheduledDate > today) return 'future';
    return 'today';
  }, [scheduledDate]);

  const { session } = useAuth();
  const token = session?.access_token ?? null;

  const [heightInches, setHeightInches] = useState<number | null>(null);
  const [weightLbs, setWeightLbs] = useState<number | null>(null);
  const [acwr, setAcwr] = useState<number | null>(null);
  const [chronic, setChronic] = useState<number>(0);
  const [targetWDay, setTargetWDay] = useState<number | null>(null);
  const [actualWDay, setActualWDay] = useState<number>(0);

  // Anthro fetch — only runs when athleteId changes, NOT on every day switch.
  // Uses plain fetch() to PostgREST because the supabase JS client gets into
  // a bad state on rapid re-renders and hangs queries silently.
  useEffect(() => {
    if (external) return;
    if (!token) return;
    let active = true;
    (async () => {
      const base = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const headers = {
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
      };
      const pick1 = async (tag: string, path: string): Promise<any | null> => {
        try {
          const r = await queuedFetch(tag, `${base}/rest/v1/${path}`, { headers });
          if (!r.ok) return null;
          const j = await r.json();
          return Array.isArray(j) && j.length > 0 ? j[0] : null;
        } catch {
          return null;
        }
      };

      // Try athletes row first — it's the common case. Only fall back to test
      // tables if height/weight are missing. Fallbacks run SERIALLY to avoid
      // saturating RN's single-socket fetch pool which wedges the other
      // monitor/feed queries on rapid day-switches.
      const ath = await pick1(
        'athletes',
        `athletes?select=height_inches,weight_lbs&id=eq.${athleteId}&limit=1`,
      );
      if (!active) return;
      let h: number | null = ath?.height_inches ?? null;
      let w: number | null = ath?.weight_lbs ?? null;

      if (w == null) {
        const cmj = await pick1(
          'cmj',
          `cmj_tests?select=body_weight_lbs_trial_value&athlete_id=eq.${athleteId}&order=recorded_utc.desc&limit=1`,
        );
        if (!active) return;
        if (cmj?.body_weight_lbs_trial_value != null) {
          w = cmj.body_weight_lbs_trial_value;
        }
      }
      if (w == null || h == null) {
        const mocap = await pick1(
          'mocap',
          `mocap_sessions?select=athlete_height_inches,athlete_weight_lbs&athlete_id=eq.${athleteId}&order=session_date.desc&limit=1`,
        );
        if (!active) return;
        if (h == null && mocap?.athlete_height_inches != null) {
          h = mocap.athlete_height_inches;
        }
        if (w == null && mocap?.athlete_weight_lbs != null) {
          w = mocap.athlete_weight_lbs;
        }
      }

      setHeightInches(h != null ? Number(h) : null);
      setWeightLbs(w != null ? Math.round(Number(w) * 10) / 10 : null);
    })();
    return () => {
      active = false;
    };
  }, [external, athleteId, token]);

  // Workload fetch — runs on date switch. Narrow range: we only need enough
  // history for ACWR at the anchor date, not a 90-day plan simulation.
  // Workload fetch — plain fetch() to bypass the supabase client hang bug.
  useEffect(() => {
    if (external) return;
    setTargetWDay(null);
    setActualWDay(0);
    if (!token) return;
    let active = true;
    (async () => {
      const anchor = scheduledDate ?? toISO(new Date());
      const seedStart = addDaysISO(anchor, -(SEED_DAYS - 1));

      const base = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const headers = {
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
      };

      const fetchJson = async (tag: string, path: string): Promise<any[]> => {
        try {
          const r = await queuedFetch(tag, `${base}/rest/v1/${path}`, { headers });
          if (!r.ok) return [];
          const j = await r.json();
          return Array.isArray(j) ? j : [];
        } catch {
          return [];
        }
      };

      const [daily, targetRows] = await Promise.all([
        fetchJson(
          'daily',
          `pulse_daily_workload?select=training_date,w_day&athlete_id=eq.${athleteId}&training_date=gte.${seedStart}&training_date=lte.${anchor}&order=training_date.asc`,
        ),
        fetchJson(
          'target',
          `pulse_athlete_workload_day?select=target_w_day,target_date&athlete_id=eq.${athleteId}&target_date=eq.${anchor}`,
        ),
      ]);
      if (!active) return;

      const byDate = new Map<string, number>();
      for (const r of daily) byDate.set(r.training_date, Number(r.w_day) || 0);

      const seed: number[] = [];
      for (let i = 0; i < SEED_DAYS; i++) {
        const iso = addDaysISO(seedStart, i);
        seed.push(byDate.get(iso) ?? 0);
      }
      const sim = simulatePlan({ seed, plan: [seed[seed.length - 1]] });
      const last = sim[sim.length - 1];
      setAcwr(last?.acwr ?? null);
      setChronic(last?.wChronic ?? 0);
      setActualWDay(byDate.get(anchor) ?? 0);
      const t = targetRows[0]?.target_w_day;
      setTargetWDay(t != null ? Number(t) : null);
    })();
    return () => {
      active = false;
    };
  }, [external, athleteId, scheduledDate, token]);

  // Optimistic "extra" workload for live throws that haven't been picked up
  // by a parent refetch yet. In external mode the parent owns the base
  // actualWDay; we add extraW on top so the gauge updates instantly while
  // the pulseEvents-driven refetch is in flight.
  const [extraW, setExtraW] = useState(0);
  useEffect(() => {
    setExtraW(0);
  }, [scheduledDate]);

  const effHeightInches = external ? data!.heightInches : heightInches;
  const effWeightLbs = external ? data!.weightLbs : weightLbs;
  const effAcwr = external ? data!.acwr : acwr;
  const effChronic = external ? data!.chronic : chronic;
  const effActualWDay = (external ? data!.actualWDay : actualWDay) + extraW;
  const effTargetWDay = external ? data!.targetWDay : targetWDay;

  const heightM = (effHeightInches ?? 0) * 0.0254;
  const weightKg = (effWeightLbs ?? 0) * 0.453592;
  const profileComplete = heightM > 0 && weightKg > 0;

  // BLE + sync + live state all come from the PulseProvider context. This
  // means the Monitor, the wizard modal, and any other pulse consumer on the
  // same screen share ONE device connection. Also gives us openWizard().
  const { ble, dev, live, sync: syncM, openWizard } = usePulse();

  // Contextual wizard hint — one sentence telling the athlete what to do next.
  const wizardHint = (() => {
    if (!ble.supported) return 'Pulse requires a dev build or TestFlight app.';
    if (dev.state === 'idle' || dev.state === 'disconnected') {
      return 'Connect your Pulse to start tracking throws.';
    }
    if (dev.state === 'connecting' || dev.state === 'requesting') {
      return 'Connecting to Pulse…';
    }
    if (dev.state === 'error') {
      return 'Pulse connection failed — tap the chip to retry.';
    }
    // connected
    if (live.status === 'running') {
      return 'Live — every throw streams to your gauge in real time.';
    }
    if (syncM.status === 'syncing' || syncM.status === 'committing') {
      return 'Pulling throws from your sensor…';
    }
    if ((dev.counter ?? 0) > 0) {
      return `${dev.counter} cached ${dev.counter === 1 ? 'throw' : 'throws'} on sensor — sync first, then go live.`;
    }
    if (effTargetWDay != null && effTargetWDay > 0 && effActualWDay >= effTargetWDay) {
      return `You hit today's target of ${effTargetWDay.toFixed(1)}.`;
    }
    if (effTargetWDay != null && effTargetWDay > 0) {
      return `Start a live session and throw toward your ${effTargetWDay.toFixed(1)} target.`;
    }
    return 'Start a live session, or throw freely and sync later.';
  })();

  // Track whether a throw is being processed (counter ticked but decode
  // hasn't finished yet). Shows a processing indicator under the gauge.
  // Only fires when the counter INCREASES during a live session (otherwise
  // a sync that resets the counter 5→0 was falsely triggering the indicator
  // and leaving it stuck on forever). 2s hard timeout as a safety net so
  // the indicator can never stay up indefinitely if decode silently fails.
  const [processingThrow, setProcessingThrow] = useState(false);
  const prevCounterRef = useRef<number | null>(dev.counter ?? null);
  useEffect(() => {
    if (live.status !== 'running') {
      // Not live → clear indicator + snapshot current counter so the next
      // live start doesn't immediately falsely trigger.
      setProcessingThrow(false);
      prevCounterRef.current = dev.counter ?? null;
      return;
    }
    const current = dev.counter ?? null;
    const prev = prevCounterRef.current;
    if (current != null && prev != null && current > prev) {
      setProcessingThrow(true);
    }
    prevCounterRef.current = current;
  }, [dev.counter, live.status]);

  useEffect(() => {
    if (!processingThrow) return;
    const t = setTimeout(() => setProcessingThrow(false), 2000);
    return () => clearTimeout(t);
  }, [processingThrow]);

  // Optimistic gauge bump when new live throws land. Depends on the scalar
  // signals (throwCount / lastThrow) — NOT the ref-backed throws array —
  // because the array's identity is stable across the session and wouldn't
  // wake this effect. 99% of the time delta=1 so we read lastThrow directly;
  // in the rare case React batches multiple throws into one render we slice
  // the tail of the ref.
  const prevLiveLen = React.useRef(0);
  useEffect(() => {
    const prev = prevLiveLen.current;
    const now = live.throwCount;
    if (now <= prev) {
      prevLiveLen.current = now;
      return;
    }
    setProcessingThrow(false);
    const delta = now - prev;
    let addW = 0;
    if (delta === 1 && live.lastThrow) {
      addW = Number(live.lastThrow.wThrow) || 0;
    } else {
      const tail = live.throws.slice(-delta);
      addW = tail.reduce((a, t) => a + (Number(t.wThrow) || 0), 0);
    }
    if (external) {
      setExtraW((cur) => cur + addW);
    } else {
      setActualWDay((cur) => cur + addW);
    }
    prevLiveLen.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [live.throwCount, live.lastThrow]);

  // When a bulk sync commits, bump the running total
  useEffect(() => {
    if (syncM.status === 'done' && syncM.committedCount > 0) {
      const committed = syncM.decoded.slice(-syncM.committedCount);
      const addW = committed.reduce((a, t) => a + (Number(t.wThrow) || 0), 0);
      if (external) {
        setExtraW((cur) => cur + addW);
      } else {
        setActualWDay((cur) => cur + addW);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      syncM.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncM.status, syncM.committedCount]);

  // Stop live on unmount
  useEffect(() => {
    return () => {
      if (live.status === 'running') {
        live.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live red dot pulse. The withRepeat(-1) loop must be explicitly cancelled
  // when live stops or on unmount — reassigning `pulseVal.value = 1` does NOT
  // cancel the underlying worklet loop, which would leak across start/stop
  // cycles and contribute to the idle slowdown.
  const pulseVal = useSharedValue(1);
  useEffect(() => {
    if (live.status === 'running') {
      pulseVal.value = withRepeat(
        withSequence(
          withTiming(1.6, { duration: 600, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseVal);
      pulseVal.value = 1;
    }
    return () => {
      cancelAnimation(pulseVal);
    };
  }, [live.status, pulseVal]);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseVal.value }],
    opacity: live.status === 'running' ? 2 - pulseVal.value : 1,
  }));

  // Memoize the date-derived strings so we don't allocate a Date + run
  // Intl.DateTimeFormat on every Monitor render. Saves two Date allocations
  // and two formatter invocations per day switch (and per re-render in
  // general).
  const dateHeader = useMemo(() => {
    if (!scheduledDate) return 'WORKLOAD MONITOR';
    const d = new Date(`${scheduledDate}T12:00:00`);
    const label = d
      .toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
      .toUpperCase();
    return `WORKLOAD · ${label}`;
  }, [scheduledDate]);

  const gaugeDateLabel = useMemo(() => {
    const anchor = scheduledDate
      ? new Date(`${scheduledDate}T12:00:00`)
      : new Date();
    return anchor.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }, [scheduledDate]);

  return (
    <View style={styles.container}>
      {/* Top strip — date label on the left, single pulse entry point on
          the right. The right slot flips between three states:
            • LIVE chip when a live session is running (tap to open wizard)
            • Connected info button (battery + cached throw count) when idle
            • "Open Pulse" button when disconnected
          Every tap opens the wizard modal — there's no inline action UI. */}
      <View style={styles.topRow}>
        <Text style={styles.panelLabel}>{dateHeader}</Text>
        {live.status === 'running' ? (
          <Pressable
            style={({ pressed }) => [
              styles.topLiveChip,
              pressed && { opacity: 0.8 },
            ]}
            onPress={openWizard}
          >
            <Animated.View style={[styles.liveDot, pulseStyle]} />
            <Text style={styles.liveChipText}>LIVE</Text>
            {live.throwCount > 0 && (
              <Text style={styles.liveChipCount}>· {live.throwCount}</Text>
            )}
          </Pressable>
        ) : dev.state === 'connected' ? (
          <Pressable
            onPress={openWizard}
            style={({ pressed }) => [
              styles.topConnectedBtn,
              pressed && { opacity: 0.8 },
            ]}
          >
            <View style={styles.connectedDot} />
            <Text style={styles.topConnectedText}>
              {dev.battery != null ? `${dev.battery}%` : 'Pulse'}
            </Text>
            {(dev.counter ?? 0) > 0 && (
              <View style={styles.topCachedBadge}>
                <Ionicons name="flash" size={10} color="#000" />
                <Text style={styles.topCachedBadgeText}>{dev.counter}</Text>
              </View>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={openWizard}
            style={({ pressed }) => [
              styles.topOpenBtn,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Ionicons name="bluetooth" size={14} color="#9BDDFF" />
            <Text style={styles.topOpenBtnText}>Open Pulse</Text>
          </Pressable>
        )}
      </View>

      {/* Gauge */}
      <View style={{ alignItems: 'center' }}>
        <RadialAcwr
          value={effAcwr}
          dayW={effActualWDay}
          chronic={effChronic}
          target={effTargetWDay}
          dateLabel={gaugeDateLabel}
          size={290}
        />
        {!profileComplete && (
          <Text style={styles.profileWarn}>
            Height/weight missing — set them in the web app's Workload page before syncing.
          </Text>
        )}
      </View>

      {/* Action buttons when connected — Start Live Session + Sync. Placed
          directly under the gauge so the athlete doesn't have to dig into
          the wizard modal just to kick off a session. The wizard still
          exists for error / connect / permissions flows via the top chip. */}
      {/* Processing throw indicator — shows between counter tick and decode */}
      {processingThrow && live.status === 'running' && (
        <View style={styles.processingRow}>
          <ActivityIndicator size="small" color="#9BDDFF" />
          <Text style={styles.processingText}>Processing throw…</Text>
        </View>
      )}

      {/* Always-visible Start Live + Sync buttons right under the gauge stats.
          When not connected they're dimmed and tapping opens the wizard to
          connect first. When live is already running they're hidden.
          When profile is incomplete (no height/weight) BOTH buttons are
          gated — the DB trigger computes workload = 0 for any throw we
          sync without those values, which would pollute ACWR. The user
          gets a clear Alert pointing at the web workload page since the
          mobile app doesn't (yet) have a profile editor. */}
      {live.status !== 'running' && (
        <View style={styles.quickActionRow}>
          <TouchableOpacity
            style={[
              styles.quickActionBtnPrimary,
              { backgroundColor: '#9BDDFF' },
              (dev.state !== 'connected' || !profileComplete) && { opacity: 0.35 },
            ]}
            activeOpacity={0.8}
            onPress={() => {
              if (!profileComplete) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                Alert.alert(
                  'Set your height & weight',
                  "Workload can't be computed without your height and weight. Tap Open profile to add them now.",
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Open profile',
                      onPress: () => navigation.navigate('Profile'),
                    },
                  ],
                );
                return;
              }
              if (dev.state !== 'connected') {
                openWizard();
                return;
              }
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              live.start().catch((err) => console.warn('[monitor] live start failed', err));
            }}
          >
            <Ionicons name="play" size={20} color="#000" />
            <Text style={styles.quickActionPrimaryText}>Start Live</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.quickActionBtnSecondary,
              { backgroundColor: 'rgba(155,221,255,0.1)', borderColor: '#9BDDFF' },
              (dev.state !== 'connected' || !profileComplete) && { opacity: 0.35 },
            ]}
            activeOpacity={0.8}
            onPress={() => {
              if (!profileComplete) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                Alert.alert(
                  'Set your height & weight',
                  "Workload can't be computed without your height and weight. Tap Open profile to add them now.",
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Open profile',
                      onPress: () => navigation.navigate('Profile'),
                    },
                  ],
                );
                return;
              }
              if (dev.state !== 'connected') {
                openWizard();
                return;
              }
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              syncM.runAndCommit().catch((err) =>
                console.warn('[monitor] sync failed', err),
              );
            }}
          >
            <Ionicons name="cloud-download" size={20} color="#9BDDFF" />
            <Text style={styles.quickActionSecondaryText}>
              {(dev.counter ?? 0) > 0 ? `Sync ${dev.counter}` : 'Sync'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {live.status === 'running' && (
        <Text style={styles.wizardHint}>Live — every throw streams to your gauge in real time.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 20,
    paddingTop: 8,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  panelLabel: {
    color: '#6b7280',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '600',
  },
  profileWarn: {
    color: 'rgba(253, 224, 71, 0.85)',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 260,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(155, 221, 255, 0.08)',
    alignSelf: 'center',
  },
  processingText: {
    color: '#9BDDFF',
    fontSize: 12,
    fontWeight: '600',
  },
  wizardHint: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 4,
    paddingHorizontal: 24,
    lineHeight: 17,
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    marginBottom: 4,
    justifyContent: 'center',
  },
  quickActionBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: '#9BDDFF',
  },
  quickActionPrimaryText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '700',
  },
  quickActionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    borderWidth: 1.5,
    borderColor: '#9BDDFF',
  },
  quickActionSecondaryText: {
    color: '#9BDDFF',
    fontSize: 12,
    fontWeight: '700',
  },
  // Top-right pulse entry point — three variants (disconnected / connected / live)
  topOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(155,221,255,0.08)',
    borderColor: 'rgba(155,221,255,0.3)',
    borderWidth: 1,
  },
  topOpenBtnText: {
    color: '#9BDDFF',
    fontSize: 13,
    fontWeight: '700',
  },
  topConnectedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(52,211,153,0.05)',
    borderColor: 'rgba(52,211,153,0.25)',
    borderWidth: 1,
  },
  topConnectedText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  topCachedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#9BDDFF',
  },
  topCachedBadgeText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  topLiveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderColor: 'rgba(248,113,113,0.3)',
    borderWidth: 1,
  },
  liveChipCount: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f87171',
    shadowColor: '#f87171',
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  liveChipText: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34d399',
    shadowColor: '#34d399',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});
