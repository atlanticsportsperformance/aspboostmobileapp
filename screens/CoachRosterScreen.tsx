import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { filterAthletes } from '../lib/coachAthletes';
import {
  getCoachRosterStatus, runwaySubtitle, activitySubtitle, severityTone, programmedCategories,
  sortNeedsAttention, sortAlpha, splitName, CATEGORY_ORDER, RosterAthlete, WorkoutType,
} from '../lib/coachRosterApi';

const ROSTER_SORT_KEY = 'aspboost_coach_roster_sort';
const ROSTER_SCOPE_KEY = 'aspboost_coach_roster_scope';
type SortMode = 'attention' | 'alpha';

const CAT_DOT: Record<WorkoutType, string> = {
  strength_conditioning: '#60A5FA', throwing: '#F87171', hitting: '#34D399',
};
const SUBTITLE_COLOR: Record<'red' | 'amber' | 'grey', string> = {
  red: '#F87171', amber: '#FBBF24', grey: '#6B7280',
};

export default function CoachRosterScreen({ navigation }: any) {
  const [all, setAll] = useState<RosterAthlete[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('attention');
  const [includeAll, setIncludeAll] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logsUnavailable, setLogsUnavailable] = useState(false);

  // Both preferences resolve before the first fetch, so the screen never loads
  // the member list and then immediately reloads with everyone.
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(ROSTER_SORT_KEY), AsyncStorage.getItem(ROSTER_SCOPE_KEY)])
      .then(([s, scope]) => {
        if (s === 'alpha' || s === 'attention') setSort(s);
        if (scope === 'all') setIncludeAll(true);
      })
      .catch(() => {})
      .finally(() => setPrefsLoaded(true));
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { athletes, logsUnavailable } = await getCoachRosterStatus({ includeAll });
      setAll(athletes);
      setLogsUnavailable(logsUnavailable);
    }
    catch (e: any) { setError(e?.message || 'Could not load roster'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [includeAll]);
  useEffect(() => { if (prefsLoaded) load(); }, [prefsLoaded, load]);

  const changeSort = (m: SortMode) => { setSort(m); AsyncStorage.setItem(ROSTER_SORT_KEY, m).catch(() => {}); };
  const toggleScope = () => {
    const next = !includeAll;
    setIncludeAll(next);
    setLoading(true);
    AsyncStorage.setItem(ROSTER_SCOPE_KEY, next ? 'all' : 'member').catch(() => {});
  };

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
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}><Ionicons name="chevron-back" size={24} color="#9BDDFF" /></TouchableOpacity>
        <Text style={styles.title}>Roster</Text>
        <Text style={styles.count}>{rows.length} {includeAll ? 'athletes' : 'members'}</Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={15} color="#6B7280" />
        <TextInput
          style={styles.search}
          placeholder="Search athletes"
          placeholderTextColor="#6B7280"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
      </View>

      <View style={styles.controls}>
        <View style={styles.segment}>
          {(['attention', 'alpha'] as SortMode[]).map((m) => (
            <TouchableOpacity key={m} style={[styles.segBtn, sort === m && styles.segBtnActive]} onPress={() => changeSort(m)}>
              <Text style={[styles.segText, sort === m && styles.segTextActive]}>{m === 'attention' ? 'Needs attention' : 'A–Z'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.toggle, includeAll && styles.toggleOn]}
          onPress={toggleScope}
          accessibilityRole="switch"
          accessibilityState={{ checked: includeAll }}
          accessibilityLabel="Show every athlete, not only members"
        >
          <View style={[styles.switch, includeAll && styles.switchOn]}>
            <View style={[styles.knob, includeAll && styles.knobOn]} />
          </View>
          <Text style={[styles.toggleText, includeAll && styles.toggleTextOn]}>All</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.ctxLine}>
        {sort === 'attention' ? 'Sorted by programming left, then days since last log' : 'Sorted by last name'}
        {logsUnavailable ? ' · activity unavailable right now' : ''}
      </Text>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color="#9BDDFF" /> : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => a.athlete_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#FFFFFF" />}
          ListEmptyComponent={<Text style={styles.empty}>{includeAll ? 'No athletes' : 'No active members'}</Text>}
          renderItem={({ item }) => {
            const n = splitName(item.athlete_name);
            const runway = runwaySubtitle(item);
            const tone = severityTone(item);
            const programmed = programmedCategories(item);
            return (
              <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('AthleteProgram', { athleteId: item.athlete_id, athleteName: item.athlete_name })}>
                <View style={[styles.stripe, tone === 'red' ? styles.stripeRed : tone === 'amber' ? styles.stripeAmber : styles.stripeNone]} />
                <View style={[styles.avatar, tone === 'red' && styles.avatarAlert]}>
                  <Text style={[styles.avatarTxt, tone === 'red' && styles.avatarTxtAlert]}>{n.first[0] || ''}{n.last[0] || ''}</Text>
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.name} numberOfLines={1}>{item.athlete_name}</Text>
                  <View style={styles.subRow}>
                    <Text style={[styles.sub, { color: SUBTITLE_COLOR[runway.tone] }]} numberOfLines={1}>{runway.text}</Text>
                    {!logsUnavailable && (
                      <>
                        <View style={styles.dotSep} />
                        <Text style={styles.sub} numberOfLines={1}>{activitySubtitle(item, now)}</Text>
                      </>
                    )}
                  </View>
                </View>
                <View style={styles.catDots}>
                  {CATEGORY_ORDER.map((c) => (
                    <View key={c} style={[styles.catDot, programmed.includes(c) ? { backgroundColor: CAT_DOT[c] } : styles.catDotOff]} />
                  ))}
                </View>
                <Ionicons name="chevron-forward" size={16} color="#4B5563" />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', flex: 1, letterSpacing: -0.2 },
  count: { color: '#9CA3AF', fontSize: 13 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10, paddingHorizontal: 12,
  },
  search: { flex: 1, color: '#FFFFFF', paddingVertical: 9, fontSize: 15 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  segment: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 9, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 7, borderRadius: 7, alignItems: 'center' },
  segBtnActive: { backgroundColor: 'rgba(255,255,255,0.10)' },
  segText: { color: '#9CA3AF', fontSize: 12.5, fontWeight: '600' },
  segTextActive: { color: '#FFFFFF' },
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 7,
    borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  toggleOn: { backgroundColor: 'rgba(155,221,255,0.08)', borderColor: 'rgba(155,221,255,0.28)' },
  toggleText: { color: '#9CA3AF', fontSize: 12.5, fontWeight: '600' },
  toggleTextOn: { color: '#9BDDFF' },
  switch: { width: 26, height: 15, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center' },
  switchOn: { backgroundColor: 'rgba(155,221,255,0.35)' },
  knob: { width: 11, height: 11, borderRadius: 999, backgroundColor: '#6B7280', marginLeft: 2 },
  knobOn: { backgroundColor: '#9BDDFF', marginLeft: 13 },
  ctxLine: { color: '#6B7280', fontSize: 11.5, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11, paddingLeft: 13, paddingRight: 16, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  stripe: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  stripeRed: { backgroundColor: '#EF4444' },
  stripeAmber: { backgroundColor: '#F59E0B' },
  stripeNone: { backgroundColor: 'transparent' },
  avatar: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  avatarAlert: { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.28)' },
  avatarTxt: { color: '#9CA3AF', fontWeight: '700', fontSize: 12 },
  avatarTxtAlert: { color: '#F87171' },
  rowMain: { flex: 1, minWidth: 0 },
  name: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 },
  sub: { color: '#6B7280', fontSize: 11.5 },
  dotSep: { width: 2.5, height: 2.5, borderRadius: 2, backgroundColor: '#4B5563' },
  catDots: { flexDirection: 'row', gap: 3 },
  catDot: { width: 5, height: 5, borderRadius: 3 },
  catDotOff: { backgroundColor: 'rgba(255,255,255,0.13)' },
  empty: { color: '#6B7280', textAlign: 'center', marginTop: 40 },
  error: { color: '#F87171', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
});
