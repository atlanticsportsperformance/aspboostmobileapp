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

import React, { useEffect, useState, useCallback } from 'react';
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
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { Zap, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { pulseEvents } from '../../lib/pulse/ble/pulse-events';
import { queuedFetch } from '../../lib/pulse/fetch-queue';

export interface Throw {
  id: string;
  thrown_at: string;
  training_date?: string;
  torque_nm: number | null;
  arm_speed_dps: number | null;
  arm_slot_deg: number | null;
  workload: number | null;
  source: string | null;
  is_valid: boolean | null;
}

interface Props {
  athleteId: string;
  /** ISO date (YYYY-MM-DD) of the workout being viewed. Defaults to today. */
  scheduledDate?: string;
  /**
   * External mode: when `throws` is provided, this component is fully
   * controlled — no self-fetch, no loading spinner sourced internally.
   * Parent owns the data (used by WorkloadScreen's pre-fetch architecture).
   */
  throws?: Throw[];
  throwsLoading?: boolean;
  /** Called after a successful soft-delete so the parent can drop the row. */
  onThrowDeleted?: (id: string) => void;
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

export function ThrowingThrowsFeed({
  athleteId,
  scheduledDate,
  throws: externalThrows,
  throwsLoading: externalLoading,
  onThrowDeleted,
}: Props) {
  const external = externalThrows !== undefined;

  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const [internalThrows, setInternalThrows] = useState<Throw[]>([]);
  const [internalLoading, setInternalLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const throws = external ? (externalThrows as Throw[]) : internalThrows;
  const loading = external ? (externalLoading ?? false) : internalLoading;
  const displayCount = throws.length;

  // Self-fetch path — only runs when parent doesn't provide `throws`. Used
  // by WorkoutExecutionScreen / WorkoutLoggerScreen where we don't have a
  // rapid day-switcher. WorkloadScreen uses external mode and filters a
  // pre-fetched 35-day window client-side.
  useEffect(() => {
    if (external) return;

    const anchorIso = scheduledDate ?? toISO(new Date());
    if (!athleteId) {
      setInternalLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setInternalLoading(true);
      let tk = token;
      if (!tk) {
        try {
          const res = await Promise.race([
            supabase.auth.getSession(),
            new Promise<any>((_, rej) => setTimeout(() => rej(new Error('session timeout')), 2000)),
          ]);
          tk = res?.data?.session?.access_token ?? null;
        } catch {
          tk = null;
        }
      }
      if (cancelled) return;
      if (!tk) {
        setInternalThrows([]);
        setInternalLoading(false);
        return;
      }

      try {
        const url =
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/pulse_throws?` +
          `select=id,thrown_at,training_date,torque_nm,arm_speed_dps,arm_slot_deg,workload,source,is_valid` +
          `&athlete_id=eq.${athleteId}` +
          `&is_valid=eq.true` +
          `&training_date=eq.${anchorIso}` +
          `&order=thrown_at.desc` +
          `&limit=50`;
        const res = await queuedFetch('feed', url, {
          headers: {
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${tk}`,
          },
        });
        const body = await res.json();
        if (cancelled) return;
        setInternalThrows(res.ok && Array.isArray(body) ? (body as Throw[]) : []);
      } catch {
        if (!cancelled) setInternalThrows([]);
      } finally {
        if (!cancelled) setInternalLoading(false);
      }
    };

    run();

    const unsubscribe = pulseEvents.onThrowsCommitted(() => {
      run();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [external, athleteId, scheduledDate, token]);

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
                if (external) {
                  onThrowDeleted?.(id);
                } else {
                  setInternalThrows((prev) => prev.filter((t) => t.id !== id));
                }
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
    [external, onThrowDeleted],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Zap size={14} color="#9BDDFF" />
          <Text style={styles.headerLabel}>
            {scheduledDate && scheduledDate !== toISO(new Date())
              ? `THROWS · ${new Date(`${scheduledDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}`
              : "TODAY'S THROWS"}
          </Text>
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
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(160)}
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
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 140,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 12,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    borderBottomWidth: 1,
    marginBottom: 10,
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
