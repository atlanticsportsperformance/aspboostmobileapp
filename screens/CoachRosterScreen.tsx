import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { filterAthletes } from '../lib/coachAthletes';
import { getCoachRosterStatus, runwayChip, activityChip, sortNeedsAttention, sortAlpha, splitName, RosterAthlete } from '../lib/coachRosterApi';

const ROSTER_SORT_KEY = 'aspboost_coach_roster_sort';
type SortMode = 'attention' | 'alpha';

const TONE: Record<'red' | 'amber' | 'grey', { bg: string; fg: string }> = {
  red: { bg: 'rgba(239,68,68,0.18)', fg: '#F87171' },
  amber: { bg: 'rgba(245,158,11,0.18)', fg: '#FBBF24' },
  grey: { bg: 'rgba(255,255,255,0.08)', fg: 'rgba(255,255,255,0.55)' },
};

function Chip({ text, tone }: { text: string; tone: 'red' | 'amber' | 'grey' }) {
  return (
    <View style={[styles.chip, { backgroundColor: TONE[tone].bg }]}>
      <Text style={[styles.chipText, { color: TONE[tone].fg }]}>{text}</Text>
    </View>
  );
}

export default function CoachRosterScreen({ navigation }: any) {
  const [all, setAll] = useState<RosterAthlete[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('attention');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logsUnavailable, setLogsUnavailable] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ROSTER_SORT_KEY).then((v) => { if (v === 'alpha' || v === 'attention') setSort(v); }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { athletes, logsUnavailable } = await getCoachRosterStatus();
      setAll(athletes);
      setLogsUnavailable(logsUnavailable);
    }
    catch (e: any) { setError(e?.message || 'Could not load roster'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const changeSort = (m: SortMode) => { setSort(m); AsyncStorage.setItem(ROSTER_SORT_KEY, m).catch(() => {}); };

  const rows = useMemo(() => {
    const now = new Date();
    const sorted = sort === 'alpha' ? sortAlpha(all) : sortNeedsAttention(all, now);
    if (!query.trim()) return sorted;
    // filterAthletes is the existing first/last-name matcher; adapt the row shape for it.
    const shaped = sorted.map((a) => { const n = splitName(a.athlete_name); return { id: a.athlete_id, firstName: n.first, lastName: n.last }; });
    const keep = new Set(filterAthletes(shaped, query).map((x) => x.id));
    return sorted.filter((a) => keep.has(a.athlete_id));
  }, [all, query, sort]);

  const now = new Date();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}><Ionicons name="chevron-back" size={24} color="#fff" /></TouchableOpacity>
        <Text style={styles.title}>Roster</Text>
        <Text style={styles.count}>{rows.length}</Text>
      </View>
      <TextInput style={styles.search} placeholder="Search athletes" placeholderTextColor="rgba(255,255,255,0.4)" value={query} onChangeText={setQuery} autoCorrect={false} />
      {logsUnavailable && <Text style={styles.unavailable}>Activity unavailable right now</Text>}
      <View style={styles.segment}>
        {(['attention', 'alpha'] as SortMode[]).map((m) => (
          <TouchableOpacity key={m} style={[styles.segBtn, sort === m && styles.segBtnActive]} onPress={() => changeSort(m)}>
            <Text style={[styles.segText, sort === m && styles.segTextActive]}>{m === 'attention' ? 'Needs attention' : 'A–Z'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color="#9BDDFF" /> : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => a.athlete_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#fff" />}
          ListEmptyComponent={<Text style={styles.empty}>No athletes</Text>}
          renderItem={({ item }) => {
            const n = splitName(item.athlete_name);
            const r = runwayChip(item);
            const a = logsUnavailable ? null : activityChip(item, now);
            return (
              <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('AthleteProgram', { athleteId: item.athlete_id, athleteName: item.athlete_name })}>
                <View style={styles.avatar}><Text style={styles.avatarTxt}>{n.first[0] || ''}{n.last[0] || ''}</Text></View>
                <Text style={styles.name} numberOfLines={1}>{item.athlete_name}</Text>
                <View style={styles.chips}>
                  {r && <Chip text={r.text} tone={r.tone} />}
                  {a && <Chip text={a.text} tone={a.tone} />}
                </View>
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
  count: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  search: { marginHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  unavailable: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginHorizontal: 16, marginTop: 6 },
  segment: { flexDirection: 'row', margin: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnActive: { backgroundColor: 'rgba(155,221,255,0.18)' },
  segText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  segTextActive: { color: '#9BDDFF' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(155,221,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#9BDDFF', fontWeight: '700', fontSize: 13 },
  name: { color: '#fff', fontSize: 15, flex: 1 },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipText: { fontSize: 11, fontWeight: '600' },
  empty: { color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 40 },
  error: { color: '#F87171', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
});
