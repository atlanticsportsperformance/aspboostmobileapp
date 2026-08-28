import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { addDays, isSameDay, toLocalDateKey, weekStartingMonday } from '../lib/coachDates';
import {
  CATEGORY_LABEL, CATEGORY_NAME, CATEGORY_ORDER, groupDayWorkouts, getCoachRosterStatus,
  categoryTile, isMissedInstance, RosterAthlete, WorkoutType,
} from '../lib/coachRosterApi';

type Instance = {
  id: string; scheduled_date: string; status: string; completed_at: string | null;
  workouts: {
    name: string; category: string; estimated_duration_minutes: number | null; notes: string | null;
    routines: Array<{ id: string; name: string; order_index: number | null; routine_exercises: Array<{ id: string; order_index: number | null; sets: number | null; placeholder_name: string | null; exercises: { id: string; name: string } | null }> }>;
  } | null;
};

const CAT_COLOR: Record<string, string> = { strength_conditioning: '#60A5FA', throwing: '#F87171', hitting: '#34D399' };
const STATUS_LABEL: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
const TILE_COLOR: Record<'red' | 'amber' | 'grey' | 'none', string> = {
  red: '#F87171', amber: '#FBBF24', grey: '#FFFFFF', none: '#4B5563',
};

export default function AthleteProgramScreen({ navigation, route }: any) {
  const athleteId: string = route.params.athleteId;
  const athleteName: string = route.params.athleteName || 'Athlete';
  const [anchor, setAnchor] = useState(new Date());
  const [selected, setSelected] = useState(new Date());
  const [instances, setInstances] = useState<Instance[]>([]);
  const [status, setStatus] = useState<RosterAthlete | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const week = useMemo(() => weekStartingMonday(anchor), [anchor]);

  // Banner status is keyed on the athlete only, not the visible week: it must
  // not refetch (or flicker) every time the coach pages the week strip, and a
  // failure here is best-effort — it must never block the agenda below.
  // includeAll: this screen is reachable for a non-member (via the roster's All
  // toggle), and the runway tiles have to resolve for them too.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { athletes } = await getCoachRosterStatus({ includeAll: true });
        if (cancelled) return;
        setStatus(athletes.find((a) => a.athlete_id === athleteId) || null);
      } catch { /* banner is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [athleteId]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const from = toLocalDateKey(addDays(week[0], -7));
      const to = toLocalDateKey(addDays(week[6], 7));
      const { data, error } = await supabase
        .from('workout_instances')
        .select(`
          id, scheduled_date, status, completed_at,
          workouts (
            name, category, estimated_duration_minutes, notes,
            routines (
              id, name, order_index,
              routine_exercises (
                id, order_index, sets, placeholder_name,
                exercises ( id, name )
              )
            )
          )
        `)
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', from)
        .lte('scheduled_date', to)
        .order('scheduled_date');
      if (error) {
        setError("Could not load this athlete's program");
        setInstances([]);
        return;
      }
      setInstances((data || []) as unknown as Instance[]);
    } catch {
      setError("Could not load this athlete's program");
      setInstances([]);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [athleteId, week]);
  useEffect(() => { load(); }, [load]);

  const today = new Date();
  const todayKey = toLocalDateKey(today);
  const dayKey = toLocalDateKey(selected);
  const dayItems = useMemo(() => instances.filter((w) => w.scheduled_date === dayKey), [instances, dayKey]);
  const groups = useMemo(() => groupDayWorkouts(dayItems), [dayItems]);
  const dotsFor = (d: Date) => {
    const k = toLocalDateKey(d);
    const cats = new Set(instances.filter((w) => w.scheduled_date === k).map((w) => w.workouts?.category || ''));
    return CATEGORY_ORDER.filter((c) => cats.has(c));
  };

  const dayHeading = isSameDay(selected, today)
    ? `Today · ${selected.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`
    : selected.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}><Ionicons name="chevron-back" size={24} color="#9BDDFF" /></TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{athleteName}</Text>
      </View>

      <View style={styles.runway}>
        {CATEGORY_ORDER.map((t) => {
          const tile = categoryTile(status || ({ workouts: {} } as any), t);
          return (
            <View key={t} style={styles.tile}>
              <View style={styles.tileLabelRow}>
                <View style={[styles.tileDot, { backgroundColor: CAT_COLOR[t] }]} />
                <Text style={styles.tileLabel}>{CATEGORY_NAME[t as WorkoutType]}</Text>
              </View>
              <Text style={[styles.tileValue, { color: TILE_COLOR[tile.tone] }, tile.tone === 'none' && styles.tileValueNone]}>{tile.value}</Text>
              <Text style={styles.tileFoot}>{tile.foot}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.weekBar}>
        <TouchableOpacity onPress={() => setAnchor((d) => addDays(d, -7))} hitSlop={8}><Ionicons name="chevron-back" size={18} color="#6B7280" /></TouchableOpacity>
        <View style={styles.weekCells}>
          {week.map((d) => {
            const sel = isSameDay(d, selected);
            const isToday = isSameDay(d, today);
            return (
              <TouchableOpacity key={toLocalDateKey(d)} style={[styles.cell, sel && styles.cellSel]} onPress={() => setSelected(d)}>
                <Text style={[styles.cellDow, sel && styles.cellDowSel]}>{d.toLocaleDateString([], { weekday: 'narrow' })}</Text>
                <Text style={[styles.cellDay, isToday && styles.cellDayToday]}>{d.getDate()}</Text>
                <View style={styles.dots}>{dotsFor(d).map((c) => <View key={c} style={[styles.dot, { backgroundColor: CAT_COLOR[c] }]} />)}</View>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity onPress={() => setAnchor((d) => addDays(d, 7))} hitSlop={8}><Ionicons name="chevron-forward" size={18} color="#6B7280" /></TouchableOpacity>
      </View>

      <View style={styles.dayBar}>
        <Text style={styles.dayHeading}>{dayHeading}</Text>
        {isSameDay(selected, today) ? (
          <Text style={styles.dayCount}>{dayItems.length === 1 ? '1 workout' : `${dayItems.length} workouts`}</Text>
        ) : (
          <TouchableOpacity onPress={() => { const t = new Date(); setAnchor(t); setSelected(t); }} hitSlop={8}>
            <Text style={styles.todayLink}>Today</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#FFFFFF" />}>
        {loading ? <ActivityIndicator style={{ marginTop: 24 }} color="#9BDDFF" /> : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : groups.length === 0 ? (
          <Text style={styles.empty}>Nothing scheduled</Text>
        ) : groups.map((g) => (
          <View key={g.category} style={{ marginBottom: 8 }}>
            <Text style={styles.groupHeader}>{CATEGORY_LABEL[g.category as WorkoutType] || g.category}</Text>
            {g.items.map((w) => {
              const done = w.status === 'completed';
              const missed = isMissedInstance(w, todayKey);
              const open = expanded === w.id;
              return (
                <TouchableOpacity key={w.id} style={styles.card}
                  onPress={() => done ? navigation.navigate('CompletedWorkout', { workoutInstanceId: w.id, readOnly: true }) : setExpanded(open ? null : w.id)}>
                  <View style={[styles.cardEdge, { backgroundColor: CAT_COLOR[w.workouts?.category || ''] || 'rgba(255,255,255,0.15)' }]} />
                  <View style={styles.cardTop}>
                    <Text style={styles.cardName} numberOfLines={1}>{w.workouts?.name || 'Workout'}</Text>
                    <Text style={[styles.pill, done && styles.pillDone, missed && styles.pillMissed]}>
                      {missed ? 'Missed' : STATUS_LABEL[w.status] || w.status}
                    </Text>
                  </View>
                  <Text style={styles.cardMeta}>
                    {w.workouts?.estimated_duration_minutes ? `${w.workouts.estimated_duration_minutes} min · ` : ''}
                    {(w.workouts?.routines || []).length} routines
                  </Text>
                  {open && !done && (w.workouts?.routines || []).slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((r) => (
                    <View key={r.id} style={styles.routine}>
                      <Text style={styles.routineName}>{r.name}</Text>
                      {(r.routine_exercises || []).slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((re) => (
                        <Text key={re.id} style={styles.exercise}>• {re.exercises?.name || re.placeholder_name || 'Exercise'}{re.sets ? ` × ${re.sets}` : ''}</Text>
                      ))}
                    </View>
                  ))}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        <Text style={styles.moreHeader}>More</Text>
        <View style={styles.moreWrap}>
          <TouchableOpacity style={styles.moreRow} onPress={() => navigation.navigate('Performance', { athleteId })}>
            <Text style={styles.moreText}>Performance</Text>
            <Ionicons name="chevron-forward" size={16} color="#4B5563" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.moreRow} onPress={() => navigation.navigate('ForceProfile', { athleteId })}>
            <Text style={styles.moreText}>Force profile</Text>
            <Ionicons name="chevron-forward" size={16} color="#4B5563" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.moreRow} onPress={() => navigation.navigate('HittingPerformance', { athleteId })}>
            <Text style={styles.moreText}>Hitting</Text>
            <Ionicons name="chevron-forward" size={16} color="#4B5563" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.moreRow} onPress={() => navigation.navigate('PitchingHub', { athleteId })}>
            <Text style={styles.moreText}>Pitching</Text>
            <Ionicons name="chevron-forward" size={16} color="#4B5563" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.moreRow, styles.moreRowLast]} onPress={() => navigation.navigate('Resources', { athleteId })}>
            <Text style={styles.moreText}>Resources</Text>
            <Ionicons name="chevron-forward" size={16} color="#4B5563" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', flex: 1, letterSpacing: -0.2 },

  runway: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  tile: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 11, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 9,
  },
  tileLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  tileDot: { width: 5, height: 5, borderRadius: 3 },
  tileLabel: { color: '#6B7280', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  tileValue: { fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  tileValueNone: { fontSize: 15, fontWeight: '600' },
  tileFoot: { color: '#6B7280', fontSize: 10, marginTop: 2 },

  weekBar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingBottom: 12 },
  weekCells: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  cell: { width: 40, alignItems: 'center', paddingVertical: 6, borderRadius: 10 },
  cellSel: { backgroundColor: 'rgba(255,255,255,0.09)' },
  cellDow: { color: '#6B7280', fontSize: 10, fontWeight: '600' },
  cellDowSel: { color: '#9BDDFF' },
  cellDay: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', marginTop: 1 },
  cellDayToday: { color: '#9BDDFF' },
  dots: { flexDirection: 'row', gap: 2.5, marginTop: 4, height: 5 },
  dot: { width: 4, height: 4, borderRadius: 2 },

  dayBar: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  dayHeading: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  dayCount: { color: '#6B7280', fontSize: 11.5 },
  todayLink: { color: '#9BDDFF', fontSize: 11.5, fontWeight: '600' },

  empty: { color: '#6B7280', textAlign: 'center', marginTop: 24 },
  error: { color: '#F87171', textAlign: 'center', marginTop: 24, paddingHorizontal: 24 },
  groupHeader: {
    color: '#6B7280', fontSize: 10.5, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6,
  },
  card: {
    marginHorizontal: 16, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12,
    paddingVertical: 11, paddingLeft: 12, paddingRight: 12, overflow: 'hidden',
  },
  cardEdge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardName: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '600', flex: 1 },
  pill: {
    color: '#9CA3AF', fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden',
  },
  pillDone: { color: '#34D399', backgroundColor: 'rgba(52,211,153,0.13)' },
  pillMissed: { color: '#F87171', backgroundColor: 'rgba(239,68,68,0.13)' },
  cardMeta: { color: '#6B7280', fontSize: 11.5, marginTop: 4 },
  routine: { marginTop: 9, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  routineName: { color: '#9CA3AF', fontSize: 12, fontWeight: '600' },
  exercise: { color: '#6B7280', fontSize: 11.5, marginTop: 2, marginLeft: 6 },

  moreHeader: {
    color: '#6B7280', fontSize: 10.5, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
  },
  moreWrap: {
    marginHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden',
  },
  moreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  moreRowLast: { borderBottomWidth: 0 },
  moreText: { color: '#FFFFFF', fontSize: 14.5 },
});
