import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getCoachRosterStatus, splitCoverage, coverageReason, severityTone, isNotLogging,
  sortNeedsAttention, daysSinceLog, RUNWAY_WARN_DAYS, RosterAthlete,
} from '../lib/coachRosterApi';

// The same key the roster writes, so the two screens never disagree about who counts.
const ROSTER_SCOPE_KEY = 'aspboost_coach_roster_scope';

type Tab = 'programming' | 'following';
type Section = { title: string; data: RosterAthlete[] };

export default function CoachCoverageScreen({ navigation, route }: any) {
  // Overview's tiles deep-link straight to the tab they count.
  const [tab, setTab] = useState<Tab>(route?.params?.tab === 'following' ? 'following' : 'programming');
  const [all, setAll] = useState<RosterAthlete[]>([]);
  const [includeAll, setIncludeAll] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [logsUnavailable, setLogsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ROSTER_SCOPE_KEY)
      .then((scope) => { if (scope === 'all') setIncludeAll(true); })
      .catch(() => {})
      .finally(() => setPrefsLoaded(true));
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const { athletes, logsUnavailable } = await getCoachRosterStatus({ includeAll });
      setAll(athletes);
      setLogsUnavailable(logsUnavailable);
    } catch (e: any) { setError(e?.message || 'Could not load'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [includeAll]);
  useEffect(() => { if (prefsLoaded) load(); }, [prefsLoaded, load]);

  const now = new Date();
  const { outNow, thisWeek } = useMemo(() => splitCoverage(all, now), [all]);
  const notLogging = useMemo(() => sortNeedsAttention(all.filter((a) => isNotLogging(a, now)), now), [all]);

  const programmingCount = outNow.length + thisWeek.length;

  const sections: Section[] = useMemo(() => {
    if (tab === 'following') {
      return notLogging.length ? [{ title: `Not following · ${notLogging.length}`, data: notLogging }] : [];
    }
    const s: Section[] = [];
    if (outNow.length) s.push({ title: `Out now · ${outNow.length}`, data: outNow });
    if (thisWeek.length) s.push({ title: `This week · ${thisWeek.length}`, data: thisWeek });
    return s;
  }, [tab, outNow, thisWeek, notLogging]);

  const showLoggingUnavailable = tab === 'following' && logsUnavailable;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}><Ionicons name="chevron-back" size={24} color="#9BDDFF" /></TouchableOpacity>
        <Text style={styles.title}>Coverage</Text>
        <Text style={styles.count}>{all.length} {includeAll ? 'athletes' : 'members'}</Text>
      </View>

      <View style={styles.tabbar}>
        {([
          ['programming', 'Needs programming', String(programmingCount)],
          ['following', 'Not following', logsUnavailable ? '—' : String(notLogging.length)],
        ] as const).map(([k, label, n]) => (
          <TouchableOpacity key={k} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)}>
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{label} · {n}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.ctxLine}>
        {tab === 'programming'
          ? `${includeAll ? 'Athletes' : 'Members'} out of programming, or running out inside ${RUNWAY_WARN_DAYS} days`
          : `${includeAll ? 'Athletes' : 'Members'} with work scheduled recently who have stopped logging`}
      </Text>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color="#9BDDFF" /> : error ? <Text style={styles.error}>{error}</Text> : showLoggingUnavailable ? (
        <Text style={styles.empty}>Activity unavailable right now</Text>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(a) => a.athlete_id}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#FFFFFF" />}
          renderSectionHeader={({ section }) => <Text style={styles.groupHeader}>{section.title}</Text>}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {tab === 'programming' ? 'Everyone has programming ahead' : 'Everyone with recent work has logged'}
            </Text>
          }
          renderItem={({ item }) => {
            const tone = severityTone(item);
            const since = daysSinceLog(item, now);
            return (
              <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('AthleteProgram', { athleteId: item.athlete_id, athleteName: item.athlete_name })}>
                <View style={[styles.stripe, tone === 'red' ? styles.stripeRed : tone === 'amber' ? styles.stripeAmber : styles.stripeNone]} />
                <View style={styles.rowMain}>
                  <Text style={styles.name} numberOfLines={1}>{item.athlete_name}</Text>
                  {tab === 'programming' ? (
                    <Text style={[styles.sub, tone === 'red' ? styles.subRed : tone === 'amber' ? styles.subAmber : null]} numberOfLines={1}>
                      {coverageReason(item)}
                    </Text>
                  ) : (
                    <Text style={styles.sub} numberOfLines={1}>
                      {since === null ? 'Never logged a set' : `Last log ${since} days ago`}
                      {item.last_completed_at ? '' : ' · no completed workouts'}
                    </Text>
                  )}
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
  tabbar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 4 },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  tabOn: { backgroundColor: 'rgba(155,221,255,0.10)', borderColor: 'rgba(155,221,255,0.30)' },
  tabText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: '#9BDDFF' },
  ctxLine: { color: '#6B7280', fontSize: 11.5, paddingHorizontal: 16, paddingTop: 12 },
  groupHeader: {
    color: '#6B7280', fontSize: 10.5, fontWeight: '700', letterSpacing: 1,
    textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 13, paddingRight: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  stripe: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3 },
  stripeRed: { backgroundColor: '#EF4444' },
  stripeAmber: { backgroundColor: '#F59E0B' },
  stripeNone: { backgroundColor: 'transparent' },
  rowMain: { flex: 1, minWidth: 0 },
  name: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  sub: { color: '#6B7280', fontSize: 11.5, marginTop: 2 },
  subRed: { color: '#F87171', fontWeight: '600' },
  subAmber: { color: '#FBBF24', fontWeight: '600' },
  empty: { color: '#6B7280', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  error: { color: '#F87171', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
});
