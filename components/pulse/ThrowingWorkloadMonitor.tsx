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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import {
  Bluetooth,
  BluetoothOff,
  Battery,
  BatteryLow,
  Zap,
  Play,
  Square,
  Download,
  Check,
  X,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import { RadialAcwr } from './RadialAcwr';
import {
  useBluetoothSupport,
  usePulseDevice,
  useLiveSession,
  usePulseSync,
} from '../../lib/pulse/ble/hooks';
import { simulatePlan } from '../../lib/pulse/workload';

const SEED_DAYS = 28;
const WINDOW_DAYS = 90;

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return toISO(dt);
}

interface Props {
  athleteId: string;
  orgId: string;
}

export function ThrowingWorkloadMonitor({ athleteId, orgId }: Props) {
  const [heightInches, setHeightInches] = useState<number | null>(null);
  const [weightLbs, setWeightLbs] = useState<number | null>(null);
  const [acwr, setAcwr] = useState<number | null>(null);
  const [chronic, setChronic] = useState<number>(0);
  const [targetWDay, setTargetWDay] = useState<number | null>(null);
  const [actualWDay, setActualWDay] = useState<number>(0);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: ath } = await supabase
        .from('athletes')
        .select('height_inches, weight_lbs')
        .eq('id', athleteId)
        .maybeSingle();
      if (!active) return;
      let h: number | null = ath?.height_inches ?? null;
      let w: number | null = ath?.weight_lbs ?? null;
      if (w == null) {
        const { data: cmj } = await supabase
          .from('cmj_tests')
          .select('body_weight_trial_value')
          .eq('athlete_id', athleteId)
          .order('recorded_utc', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cmj?.body_weight_trial_value) {
          w = Math.round(Number(cmj.body_weight_trial_value) * 2.20462 * 10) / 10;
        }
      }
      setHeightInches(h);
      setWeightLbs(w);

      const today = toISO(new Date());
      const rangeStart = addDaysISO(today, -(WINDOW_DAYS - 1));
      const seedStart = addDaysISO(rangeStart, -SEED_DAYS);
      const [{ data: daily }, { data: todayTarget }] = await Promise.all([
        supabase
          .from('pulse_daily_workload')
          .select('training_date, w_day')
          .eq('athlete_id', athleteId)
          .gte('training_date', seedStart)
          .lte('training_date', today)
          .order('training_date', { ascending: true }),
        supabase
          .from('pulse_athlete_workload_day')
          .select('target_w_day')
          .eq('athlete_id', athleteId)
          .eq('target_date', today)
          .maybeSingle(),
      ]);
      if (!active) return;
      const byDate = new Map<string, number>();
      for (const r of daily ?? []) byDate.set(r.training_date, Number(r.w_day) || 0);
      const seed: number[] = [];
      for (let i = 0; i < SEED_DAYS; i++) {
        const iso = addDaysISO(rangeStart, -SEED_DAYS + i);
        seed.push(byDate.get(iso) ?? 0);
      }
      const plan: number[] = [];
      for (let i = 0; i < WINDOW_DAYS; i++) {
        const iso = addDaysISO(rangeStart, i);
        plan.push(byDate.get(iso) ?? 0);
      }
      const sim = simulatePlan({ seed, plan });
      const last = sim[sim.length - 1];
      setAcwr(last?.acwr ?? null);
      setChronic(last?.wChronic ?? 0);
      setActualWDay(byDate.get(today) ?? 0);
      const t = todayTarget?.target_w_day;
      setTargetWDay(t != null && t > 0 ? Number(t) : null);
    })();
    return () => {
      active = false;
    };
  }, [athleteId]);

  const heightM = (heightInches ?? 0) * 0.0254;
  const weightKg = (weightLbs ?? 0) * 0.453592;
  const profileComplete = heightM > 0 && weightKg > 0;

  const ble = useBluetoothSupport();
  const dev = usePulseDevice();

  const live = useLiveSession({
    device: dev.device,
    athlete: { heightM, weightKg },
    supabase: supabase as any,
    orgId,
    athleteId,
  });

  const syncM = usePulseSync({
    device: dev.device,
    athlete: { heightM, weightKg },
    supabase: supabase as any,
    orgId,
    athleteId,
  });

  // Optimistic gauge bump when new live throws land
  const prevLiveLen = React.useRef(0);
  useEffect(() => {
    const prev = prevLiveLen.current;
    const now = live.throws.length;
    if (now <= prev) {
      prevLiveLen.current = now;
      return;
    }
    const news = live.throws.slice(prev);
    for (const t of news) {
      setActualWDay((cur) => cur + (Number(t.wThrow) || 0));
    }
    prevLiveLen.current = now;
    // Gentle haptic per throw
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [live.throws]);

  // When a bulk sync commits, bump the running total
  useEffect(() => {
    if (syncM.status === 'done' && syncM.committedCount > 0) {
      const committed = syncM.decoded.slice(-syncM.committedCount);
      const addW = committed.reduce((a, t) => a + (Number(t.wThrow) || 0), 0);
      setActualWDay((cur) => cur + addW);
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

  const onConnect = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    await dev.connect();
  }, [dev]);

  const onStartLive = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await live.start();
  }, [live]);

  const onStopLive = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await live.stop();
  }, [live]);

  const onSync = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await syncM.run();
    await syncM.commit();
  }, [syncM]);

  // Live red dot pulse
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
      pulseVal.value = 1;
    }
  }, [live.status, pulseVal]);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseVal.value }],
    opacity: live.status === 'running' ? 2 - pulseVal.value : 1,
  }));

  return (
    <View style={styles.container}>
      {/* Top strip — label + sensor chip */}
      <View style={styles.topRow}>
        <Text style={styles.panelLabel}>WORKLOAD MONITOR</Text>
        <SensorChip
          supported={ble.supported}
          state={dev.state}
          deviceName={dev.device?.name ?? 'Pulse'}
          battery={dev.battery}
          counter={dev.counter}
          onConnect={onConnect}
          onDisconnect={dev.disconnect}
        />
      </View>

      {/* Gauge */}
      <View style={{ alignItems: 'center' }}>
        <RadialAcwr
          value={acwr}
          dayW={actualWDay}
          chronic={chronic}
          target={targetWDay}
          dateLabel={new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
          size={240}
        />
        {!profileComplete && (
          <Text style={styles.profileWarn}>
            Height/weight missing — workload math is approximate
          </Text>
        )}
      </View>

      {/* Action buttons (only when connected) */}
      {dev.state === 'connected' && (
        <View style={styles.actionsRow}>
          {live.status === 'running' ? (
            <>
              <View style={styles.liveChip}>
                <Animated.View style={[styles.liveDot, pulseStyle]} />
                <Text style={styles.liveChipText}>LIVE</Text>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.stopBtn,
                  pressed && { opacity: 0.7 },
                ]}
                onPress={onStopLive}
              >
                <Square size={14} color="#fca5a5" fill="#fca5a5" />
                <Text style={styles.stopBtnText}>Stop</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [
                  styles.liveBtn,
                  !profileComplete && { opacity: 0.4 },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}
                disabled={!profileComplete}
                onPress={onStartLive}
              >
                <Play size={14} color="#000" fill="#000" />
                <Text style={styles.liveBtnText}>Start live</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.syncBtn,
                  (!profileComplete || syncM.status === 'syncing') && {
                    opacity: 0.4,
                  },
                  pressed && { transform: [{ scale: 0.96 }] },
                ]}
                disabled={!profileComplete || syncM.status === 'syncing'}
                onPress={onSync}
              >
                {syncM.status === 'syncing' || syncM.status === 'committing' ? (
                  <ActivityIndicator size="small" color="#e5e7eb" />
                ) : syncM.status === 'done' ? (
                  <Check size={14} color="#34d399" />
                ) : syncM.status === 'error' ? (
                  <X size={14} color="#f87171" />
                ) : (
                  <Download size={14} color="#e5e7eb" />
                )}
                <Text style={styles.syncBtnText}>Sync throws</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {syncM.error && <Text style={styles.errText}>{syncM.error}</Text>}
      {syncM.status === 'syncing' && (
        <Text style={styles.progressText}>
          Syncing…{' '}
          {syncM.progress?.throwsDecoded != null
            ? `${syncM.progress.throwsDecoded} throws decoded`
            : ''}
        </Text>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Sensor chip
// ─────────────────────────────────────────────────────────────

function SensorChip({
  supported,
  state,
  deviceName,
  battery,
  counter,
  onConnect,
  onDisconnect,
}: {
  supported: boolean;
  state: ReturnType<typeof usePulseDevice>['state'];
  deviceName: string;
  battery: number | null;
  counter: number | null;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (!supported) {
    return (
      <View style={styles.chipGhost}>
        <Text style={styles.chipGhostText}>Dev Client required</Text>
      </View>
    );
  }

  if (state === 'idle') {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.chipConnect,
          pressed && { opacity: 0.7 },
        ]}
        onPress={onConnect}
      >
        <Bluetooth size={12} color="#9BDDFF" />
        <Text style={styles.chipConnectText}>Connect Pulse</Text>
      </Pressable>
    );
  }

  if (state === 'requesting' || state === 'connecting') {
    return (
      <View style={styles.chipGhost}>
        <ActivityIndicator size="small" color="#9CA3AF" />
        <Text style={styles.chipLoadingText}>…</Text>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <Pressable onPress={onConnect} style={styles.chipGhost}>
        <BluetoothOff size={12} color="#f87171" />
        <Text style={styles.chipRetryText}>Retry</Text>
      </Pressable>
    );
  }

  const lowBattery = battery != null && battery < 20;
  return (
    <Pressable
      onPress={onDisconnect}
      style={({ pressed }) => [
        styles.chipConnected,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.connectedDot} />
      <Text style={styles.chipDeviceName} numberOfLines={1}>
        {deviceName}
      </Text>
      {battery != null && (
        <View style={styles.chipBatteryRow}>
          {lowBattery ? (
            <BatteryLow size={12} color="#f87171" />
          ) : (
            <Battery size={12} color="#9CA3AF" />
          )}
          <Text
            style={[
              styles.chipBattery,
              lowBattery && { color: '#f87171' },
            ]}
          >
            {battery}%
          </Text>
        </View>
      )}
      {counter != null && counter > 0 && (
        <View style={styles.chipCounterRow}>
          <Zap size={12} color="#9BDDFF" />
          <Text style={styles.chipCounter}>{counter}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    overflow: 'hidden',
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
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    flexWrap: 'wrap',
  },
  liveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#9BDDFF',
    shadowColor: '#9BDDFF',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  liveBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 12,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
  },
  syncBtnText: {
    color: '#e5e7eb',
    fontWeight: '700',
    fontSize: 12,
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
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
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderColor: 'rgba(248,113,113,0.3)',
    borderWidth: 1,
  },
  stopBtnText: {
    color: '#fca5a5',
    fontWeight: '600',
    fontSize: 11,
  },
  errText: {
    color: '#f87171',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
  progressText: {
    color: '#9ca3af',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  // chip styles
  chipGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  chipGhostText: {
    color: '#6b7280',
    fontSize: 10,
  },
  chipLoadingText: {
    color: '#9ca3af',
    fontSize: 10,
  },
  chipRetryText: {
    color: '#f87171',
    fontSize: 10,
  },
  chipConnect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(155, 221, 255, 0.08)',
    borderColor: 'rgba(155, 221, 255, 0.3)',
    borderWidth: 1,
  },
  chipConnectText: {
    color: '#9BDDFF',
    fontSize: 10,
    fontWeight: '600',
  },
  chipConnected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(52, 211, 153, 0.05)',
    borderColor: 'rgba(52, 211, 153, 0.2)',
    borderWidth: 1,
    maxWidth: 220,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34d399',
    shadowColor: '#34d399',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  chipDeviceName: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
    maxWidth: 60,
  },
  chipBatteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  chipBattery: {
    color: '#d1d5db',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  chipCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  chipCounter: {
    color: '#9BDDFF',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
});
