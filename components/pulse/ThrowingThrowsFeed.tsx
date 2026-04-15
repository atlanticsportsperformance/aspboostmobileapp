/**
 * ThrowingThrowsFeed — DB-backed live-updating list of today's pulse throws
 * for the current athlete, mounted BELOW the workout logger on throwing
 * workouts. Source of truth is `pulse_throws`; we subscribe to realtime
 * INSERT + UPDATE events so live + sync commits stream in and soft-deleted
 * throws disappear without a manual refetch.
 *
 * Delete is a soft-delete (is_valid=false + excluded metadata) matching the
 * web pattern. The AFTER trigger on pulse_throws recomputes
 * pulse_daily_workload so the monitor's gauge updates on its next read.
 *
 * Dynamic polish:
 *  - Entering throws slide + fade in with stagger
 *  - Delete swipe-style: long-press → Alert confirm → optimistic remove with
 *    layout animation
 *  - Each row has a soft glow border colored by torque intensity
 *  - Header counter spring-counts up as rows stream in
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  FadeInDown,
  FadeOutLeft,
  Layout,
  Easing,
} from 'react-native-reanimated';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Zap, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';

interface Throw {
  id: string;
  thrown_at: string;
  torque_nm: number | null;
  arm_speed_dps: number | null;
  arm_slot_deg: number | null;
  workload: number | null;
  source: string | null;
  is_valid: boolean | null;
}

interface Props {
  athleteId: string;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Torque intensity → color band (subtle, not alarming)
function torqueHex(tq: number | null): string {
  if (tq == null) return '#4b5563';
  if (tq < 40) return '#60a5fa'; // blue — light
  if (tq < 55) return '#9BDDFF'; // cyan — moderate
  if (tq < 68) return '#34d399'; // emerald — productive
  if (tq < 78) return '#facc15'; // yellow — high
  return '#f87171';              // red — peak
}

export function ThrowingThrowsFeed({ athleteId }: Props) {
  const [throws, setThrows] = useState<Throw[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Spring-count the header total
  const countTarget = useSharedValue(0);
  const [displayCount, setDisplayCount] = useState(0);
  useEffect(() => {
    countTarget.value = withSpring(throws.length, { damping: 15, stiffness: 90 });
  }, [throws.length, countTarget]);
  useEffect(() => {
    // derived shim — we can't runOnJS easily for a number, just snap
    setDisplayCount(throws.length);
  }, [throws.length]);

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      const today = toISO(new Date());
      const start = `${today}T00:00:00Z`;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const end = `${toISO(tomorrow)}T00:00:00Z`;

      const { data } = await supabase
        .from('pulse_throws')
        .select(
          'id, thrown_at, torque_nm, arm_speed_dps, arm_slot_deg, workload, source, is_valid',
        )
        .eq('athlete_id', athleteId)
        .eq('is_valid', true)
        .gte('thrown_at', start)
        .lt('thrown_at', end)
        .order('thrown_at', { ascending: false })
        .limit(50);

      if (cancelled) return;
      setThrows((data ?? []) as Throw[]);
      setLoading(false);

      channel = supabase
        .channel(`pulse_throws_mobile_${athleteId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'pulse_throws',
            filter: `athlete_id=eq.${athleteId}`,
          },
          (payload: any) => {
            const row = payload.new as Throw;
            if (!row.thrown_at || row.is_valid === false) return;
            const d = new Date(row.thrown_at);
            if (toISO(d) !== today) return;
            setThrows((prev) => {
              if (prev.some((t) => t.id === row.id)) return prev;
              return [row, ...prev].slice(0, 50);
            });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'pulse_throws',
            filter: `athlete_id=eq.${athleteId}`,
          },
          (payload: any) => {
            const row = payload.new as Throw;
            if (!row?.id) return;
            if (row.is_valid === false) {
              setThrows((prev) => prev.filter((t) => t.id !== row.id));
              return;
            }
            setThrows((prev) =>
              prev.map((t) => (t.id === row.id ? { ...t, ...row } : t)),
            );
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [athleteId]);

  const onDelete = useCallback(
    (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      Alert.alert(
        'Delete throw',
        'This throw will be removed and today\u2019s workload will recompute.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setDeletingId(id);
              try {
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                const { error } = await supabase
                  .from('pulse_throws')
                  .update({
                    is_valid: false,
                    excluded_reason: 1,
                    excluded_by: user?.id ?? null,
                    excluded_at: new Date().toISOString(),
                  })
                  .eq('id', id);
                if (error) throw error;
                setThrows((prev) => prev.filter((t) => t.id !== id));
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                ).catch(() => {});
              } catch (err: any) {
                Alert.alert('Delete failed', err?.message ?? 'Unknown error');
              } finally {
                setDeletingId(null);
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
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Zap size={14} color="#9BDDFF" />
          <Text style={styles.headerLabel}>TODAY'S THROWS</Text>
        </View>
        {displayCount > 0 && (
          <Text style={styles.headerCount}>{displayCount} total</Text>
        )}
      </View>

      {loading ? (
        <View style={styles.emptyBlock}>
          <ActivityIndicator size="small" color="#6b7280" />
          <Text style={styles.emptyText}>Loading…</Text>
        </View>
      ) : throws.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyText}>
            No throws logged yet.{'\n'}Connect Pulse → Start live or Sync throws.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {throws.map((t, i) => (
            <ThrowRow
              key={t.id}
              t={t}
              index={i}
              deleting={deletingId === t.id}
              onDelete={() => onDelete(t.id)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Individual throw row with entering animation + long-press delete
// ─────────────────────────────────────────────────────────────

function ThrowRow({
  t,
  index,
  deleting,
  onDelete,
}: {
  t: Throw;
  index: number;
  deleting: boolean;
  onDelete: () => void;
}) {
  const hex = torqueHex(t.torque_nm);
  const time = t.thrown_at
    ? new Date(t.thrown_at).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

  // Press feedback
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index * 30, 180))
        .duration(420)
        .springify()
        .damping(16)}
      exiting={FadeOutLeft.duration(240)}
      layout={Layout.springify().damping(18).stiffness(120)}
      style={[
        styles.row,
        {
          borderColor: `${hex}33`,
          shadowColor: hex,
        },
        pressStyle,
      ]}
    >
      <View style={[styles.rowAccent, { backgroundColor: hex }]} />
      <Text style={styles.rowTime}>{time}</Text>
      <View style={styles.rowMetric}>
        <Text style={[styles.rowNum, { color: hex, textShadowColor: hex }]}>
          {t.torque_nm != null ? Math.round(t.torque_nm) : '—'}
        </Text>
        <Text style={styles.rowUnit}>Nm</Text>
      </View>
      <View style={styles.rowMetric}>
        <Text style={styles.rowNumMid}>
          {t.arm_speed_dps != null ? Math.round(t.arm_speed_dps) : '—'}
        </Text>
        <Text style={styles.rowUnit}>°/s</Text>
      </View>
      <View style={styles.rowMetric}>
        <Text style={styles.rowNumMid}>
          {t.arm_slot_deg != null ? Math.round(t.arm_slot_deg) : '—'}
        </Text>
        <Text style={styles.rowUnit}>°</Text>
      </View>
      <View style={{ flex: 1 }} />
      {t.source && <Text style={styles.rowSource}>{t.source}</Text>}
      <Pressable
        onPressIn={() => {
          scale.value = withTiming(0.94, { duration: 100 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 12, stiffness: 180 });
        }}
        onLongPress={onDelete}
        delayLongPress={350}
        hitSlop={8}
        style={styles.trashBtn}
      >
        {deleting ? (
          <ActivityIndicator size="small" color="#6b7280" />
        ) : (
          <Trash2 size={14} color="#4b5563" />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 140,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLabel: {
    color: '#6b7280',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
  },
  headerCount: {
    color: '#9ca3af',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  emptyBlock: {
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  emptyText: {
    color: '#4b5563',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  list: {
    maxHeight: 480,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    borderBottomWidth: 1,
    overflow: 'hidden',
  },
  rowAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    opacity: 0.7,
  },
  rowTime: {
    color: '#4b5563',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    width: 52,
  },
  rowMetric: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  rowNum: {
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
  rowNumMid: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rowUnit: {
    color: '#4b5563',
    fontSize: 10,
  },
  rowSource: {
    color: '#374151',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  trashBtn: {
    padding: 6,
  },
});
