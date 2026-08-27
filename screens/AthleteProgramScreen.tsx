import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { addDays, isSameDay, toLocalDateKey, weekStartingMonday } from '../lib/coachDates';
import { CATEGORY_LABEL, CATEGORY_ORDER, groupDayWorkouts, getCoachRosterStatus, RosterAthlete, WorkoutType } from '../lib/coachRosterApi';

type Instance = {
  id: string; scheduled_date: string; status: string; completed_at: string | null;
  workouts: {
    name: string; category: string; estimated_duration_minutes: number | null; notes: string | null;
    routines: Array<{ id: string; name: string; order_index: number | null; routine_exercises: Array<{ id: string; order_index: number | null; sets: number | null; placeholder_name: string | null; exercises: { id: string; name: string } | null }> }>;
  } | null;
};

const CAT_DOT: Record<string, string> = { strength_conditioning: '#60A5FA', throwing: '#F87171', hitting: '#34D399' };
const STATUS_LABEL: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };

function runwayLine(t: WorkoutType, a: RosterAthlete | null): string {
  const c = a?.workouts?.[t];
  const label = CATEGORY_LABEL[t];
  if (!c || c.workout_count === 0 || c.days_until_next === null || !c.last_workout_date) return `${label}: never programmed`;
  if (c.days_until_next <= 0) return `${label}: ran out ${Math.abs(c.days_until_next)} days ago`;
  const [y, m, d] = c.last_workout_date.split('-').map(Number);
  const pretty = new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${label}: Programming through ${pretty} (${c.days_until_next} days)`;
}

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

  const week = useMemo(() => weekStartingMonday(anchor), [anchor]);

  const load = useCallback(async () => {
    const from = toLocalDateKey(addDays(week[0], -7));
    const to = toLocalDateKey(addDays(week[6], 7));
    const { data } = await supabase
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
    setInstances((data || []) as unknown as Instance[]);
    try {
      const { athletes } = await getCoachRosterStatus();
      setStatus(athletes.find((a) => a.athlete_id === athleteId) || null);
    } catch { /* banner is best-effort */ }
    setLoading(false); setRefreshing(false);
  }, [athleteId, week]);
  useEffect(() => { load(); }, [load]);

  const dayKey = toLocalDateKey(selected);
  const dayItems = useMemo(() => instances.filter((w) => w.scheduled_date === dayKey), [instances, dayKey]);
  const groups = useMemo(() => groupDayWorkouts(dayItems), [dayItems]);
  const dotsFor = (d: Date) => {
    const k = toLocalDateKey(d);
    const cats = new Set(instances.filter((w) => w.scheduled_date === k).map((w) => w.workouts?.category || ''));
    return CATEGORY_ORDER.filter((c) => cats.has(c));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}><Ionicons name="chevron-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{athleteName}</Text>
      </View>

      <View style={styles.banner}>
        {CATEGORY_ORDER.map((t) => <Text key={t} style={styles.bannerLine}>{runwayLine(t, status)}</Text>)}
      </View>

      <View style={styles.weekBar}>
        <TouchableOpacity onPress={() => setAnchor((d) => addDays(d, -7))} hitSlop={8}><Ionicons name="chevron-back" size={20} color="#fff" /></TouchableOpacity>
        <View style={styles.weekCells}>
          {week.map((d) => {
            const sel = isSameDay(d, selected);
            return (
              <TouchableOpacity key={toLocalDateKey(d)} style={[styles.cell, sel && styles.cellSel]} onPress={() => setSelected(d)}>
                <Text style={[styles.cellDow, sel && styles.cellTextSel]}>{d.toLocaleDateString([], { weekday: 'narrow' })}</Text>
                <Text style={[styles.cellDay, sel && styles.cellTextSel]}>{d.getDate()}</Text>
                <View style={styles.dots}>{dotsFor(d).map((c) => <View key={c} style={[styles.dot, { backgroundColor: CAT_DOT[c] }]} />)}</View>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity onPress={() => setAnchor((d) => addDays(d, 7))} hitSlop={8}><Ionicons name="chevron-forward" size={20} color="#fff" /></TouchableOpacity>
      </View>
      {!isSameDay(selected, new Date()) && (
        <TouchableOpacity style={styles.todayBtn} onPress={() => { const t = new Date(); setAnchor(t); setSelected(t); }}><Text style={styles.todayText}>Today</Text></TouchableOpacity>
      )}

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#fff" />}>
        {loading ? <ActivityIndicator color="#9BDDFF" /> : groups.length === 0 ? (
          <Text style={styles.empty}>Nothing scheduled</Text>
        ) : groups.map((g) => (
          <View key={g.category} style={{ marginBottom: 16 }}>
            <Text style={styles.groupHeader}>{CATEGORY_LABEL[g.category as WorkoutType] || g.category}</Text>
            {g.items.map((w) => {
              const done = w.status === 'completed';
              const open = expanded === w.id;
              return (
                <TouchableOpacity key={w.id} style={styles.card}
                  onPress={() => done ? navigation.navigate('CompletedWorkout', { workoutInstanceId: w.id, readOnly: true }) : setExpanded(open ? null : w.id)}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardName} numberOfLines={1}>{w.workouts?.name || 'Workout'}</Text>
                    <Text style={[styles.pill, done && styles.pillDone]}>{STATUS_LABEL[w.status] || w.status}</Text>
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
        <TouchableOpacity style={styles.moreRow} onPress={() => navigation.navigate('Performance', { athleteId })}>
          <Text style={styles.moreText}>Performance</Text>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.moreRow} onPress={() => navigation.navigate('ForceProfile', { athleteId })}>
          <Text style={styles.moreText}>Force profile</Text>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.moreRow} onPress={() => navigation.navigate('HittingPerformance', { athleteId })}>
          <Text style={styles.moreText}>Hitting</Text>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.moreRow} onPress={() => navigation.navigate('PitchingHub', { athleteId })}>
          <Text style={styles.moreText}>Pitching</Text>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.moreRow} onPress={() => navigation.navigate('Resources', { athleteId })}>
          <Text style={styles.moreText}>Resources</Text>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F14' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', flex: 1 },
  banner: { marginHorizontal: 16, padding: 12, borderRadius: 10, backgroundColor: 'rgba(155,221,255,0.08)', gap: 2 },
  bannerLine: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  weekBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 12 },
  weekCells: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  cell: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6, borderRadius: 10, minWidth: 38 },
  cellSel: { backgroundColor: 'rgba(155,221,255,0.18)' },
  cellDow: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },
  cellDay: { color: '#fff', fontSize: 15, fontWeight: '600' },
  cellTextSel: { color: '#9BDDFF' },
  dots: { flexDirection: 'row', gap: 3, marginTop: 3, height: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  todayBtn: { alignSelf: 'center', marginTop: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  todayText: { color: '#9BDDFF', fontSize: 12, fontWeight: '600' },
  empty: { color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 24 },
  groupHeader: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 12, marginBottom: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardName: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  pill: { color: 'rgba(255,255,255,0.6)', fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  pillDone: { color: '#34D399', backgroundColor: 'rgba(52,211,153,0.15)' },
  cardMeta: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4 },
  routine: { marginTop: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  routineName: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  exercise: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginLeft: 6 },
  moreHeader: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
  moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  moreText: { color: '#fff', fontSize: 15 },
});
