import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  getCoachRosterStatus, runwayDays, runwayChip, activityChip, isNotLogging, sortNeedsAttention, daysSinceLog,
  CATEGORY_ORDER, CATEGORY_LABEL, RUNWAY_WARN_DAYS, RosterAthlete,
} from '../lib/coachRosterApi';

type Tab = 'runway' | 'logging';

export default function CoachCoverageScreen({ navigation }: any) {
  const [tab, setTab] = useState<Tab>('runway');
  const [all, setAll] = useState<RosterAthlete[]>([]);
  const [logsUnavailable, setLogsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { athletes, logsUnavailable } = await getCoachRosterStatus();
      setAll(athletes);
      setLogsUnavailable(logsUnavailable);
    } catch (e: any) { setError(e?.message || 'Could not load'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const now = new Date();
  const neverProgrammedCats = (a: RosterAthlete) => CATEGORY_ORDER.filter((t) => {
    const workout_count = a.workouts?.[t]?.workout_count ?? 0;
    return workout_count === 0;
  });

  const runningOut = useMemo(() => {
    const list = all.filter((a) => { const r = runwayDays(a); return r === null || r <= RUNWAY_WARN_DAYS || neverProgrammedCats(a).length > 0; });
    // never-programmed athletes sort first because sortNeedsAttention treats null runway as -Infinity
    return sortNeedsAttention(list, now);
  }, [all]);
  const notLogging = useMemo(() => sortNeedsAttention(all.filter((a) => isNotLogging(a, now)), now), [all]);

  const data = tab === 'runway' ? runningOut : notLogging;
  const showLoggingUnavailable = tab === 'logging' && logsUnavailable;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}><Ionicons name="chevron-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.title}>Coverage</Text>
      </View>
      <View style={styles.segment}>
        {([['runway', 'Running out', String(runningOut.length)], ['logging', 'Not logging', logsUnavailable ? '—' : String(notLogging.length)]] as const).map(([k, label, n]) => (
          <TouchableOpacity key={k} style={[styles.segBtn, tab === k && styles.segBtnActive]} onPress={() => setTab(k)}>
            <Text style={[styles.segText, tab === k && styles.segTextActive]}>{label} · {n}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color="#9BDDFF" /> : error ? <Text style={styles.error}>{error}</Text> : showLoggingUnavailable ? (
        <Text style={styles.empty}>Activity unavailable right now</Text>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(a) => a.athlete_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#fff" />}
          ListEmptyComponent={<Text style={styles.empty}>{tab === 'runway' ? 'Everyone has programming ahead' : 'Everyone with recent work has logged'}</Text>}
          renderItem={({ item }) => {
            const never = neverProgrammedCats(item);
            const r = runwayChip(item);
            const a = activityChip(item, now);
            const since = daysSinceLog(item, now);
            return (
              <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('AthleteProgram', { athleteId: item.athlete_id, athleteName: item.athlete_name })}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.athlete_name}</Text>
                  {tab === 'runway' ? (
                    <Text style={styles.sub}>
                      {never.length > 0 ? `Never programmed: ${never.map((t) => CATEGORY_LABEL[t]).join(', ')}` : r?.text || ''}
                    </Text>
                  ) : (
                    <Text style={styles.sub}>{since === null ? 'Never logged a set' : `Last log ${since} days ago`}{item.last_completed_at ? '' : ' · no completed workouts'}</Text>
                  )}
                </View>
                {tab === 'runway' && r && <Text style={[styles.chip, r.tone === 'red' ? styles.red : r.tone === 'amber' ? styles.amber : styles.grey]}>{r.text}</Text>}
                {tab === 'logging' && a && <Text style={[styles.chip, a.tone === 'amber' ? styles.amber : styles.grey]}>{a.text}</Text>}
                <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0B0F14' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', flex: 1 },
  segment: { flexDirection: 'row', margin: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnActive: { backgroundColor: 'rgba(155,221,255,0.18)' },
  segText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  segTextActive: { color: '#9BDDFF' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  name: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sub: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 },
  chip: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  red: { color: '#F87171', backgroundColor: 'rgba(239,68,68,0.18)' },
  amber: { color: '#FBBF24', backgroundColor: 'rgba(245,158,11,0.18)' },
  grey: { color: 'rgba(255,255,255,0.55)', backgroundColor: 'rgba(255,255,255,0.08)' },
  empty: { color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  error: { color: '#F87171', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
});
