import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { performLogout } from '../lib/logout';
import FABMenu, { type FABMenuItem } from '../components/FABMenu';
import { SettingsMenu, type SettingsMenuItem } from '../components/SettingsMenu';
import { getCoachTodaysSessions, type CoachSession } from '../lib/coachScheduleApi';
import { getCoachRosterStatus, splitCoverage, isNotLogging, attentionList, splitName, RosterAthlete } from '../lib/coachRosterApi';
import { splitToday, startsInLabel, bookedPreview, formatSessionTime, getUnreadSummary, joinUrlFor } from '../lib/coachOverviewApi';
import { useAuth } from '../contexts/AuthContext';
import { onBluetoothStateChange, openBluetoothSettings, type BluetoothPermissionState } from '../lib/ble/permissions';

const DEFAULT_COLOR = 'rgba(255,255,255,0.15)';

interface Counts {
  members: number | null;
  needsProgramming: number | null;
  outNow: number;
  notFollowing: number | null;
}

const EMPTY_COUNTS: Counts = {
  members: null, needsProgramming: null, outNow: 0, notFollowing: null,
};

export default function CoachOverviewScreen() {
  const navigation = useNavigation<any>();
  const { staffRole } = useAuth();
  const isAdmin = staffRole === 'admin' || staffRole === 'super_admin';

  const [sessions, setSessions] = useState<CoachSession[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [unread, setUnread] = useState<{ messages: number; conversations: number }>({ messages: 0, conversations: 0 });
  const [attention, setAttention] = useState<Array<{ athlete: RosterAthlete; reason: string; tone: 'red' | 'amber' }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [btState, setBtState] = useState<BluetoothPermissionState>('unknown');
  // Re-render once a minute so "Starts in 48 min" stays honest while the
  // screen sits open on a desk.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const unsub = onBluetoothStateChange(setBtState, true);
    return () => unsub();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const today = new Date();
    // Every block loads independently: a failure in one must not blank the
    // others, so each settles on its own and falls back to a dash.
    // Deliberately ONE plan-expirations call. A second one with `includeAll`
    // would buy only a footnote ("of 213 athletes") and would double the
    // heaviest request on the coach's landing — that route pages exercise_logs.
    const [sessionsRes, memberRes, unreadRes] = await Promise.allSettled([
      getCoachTodaysSessions(today, undefined, !isAdmin),
      getCoachRosterStatus(),
      getUnreadSummary(),
    ]);

    setSessions(sessionsRes.status === 'fulfilled' ? sessionsRes.value : []);

    if (memberRes.status === 'fulfilled') {
      const members = memberRes.value.athletes;
      const { outNow, thisWeek } = splitCoverage(members, today);
      setCounts((c) => ({
        ...c,
        members: members.length,
        needsProgramming: outNow.length + thisWeek.length,
        outNow: outNow.length,
        notFollowing: memberRes.value.logsUnavailable
          ? null
          : members.filter((a) => isNotLogging(a, today)).length,
      }));
      setAttention(attentionList(members, today));
    } else {
      setCounts((c) => ({ ...c, members: null, needsProgramming: null, notFollowing: null }));
      setAttention([]);
    }

    setUnread(unreadRes.status === 'fulfilled' ? unreadRes.value : { messages: 0, conversations: 0 });

    setNow(new Date());
    if (!opts?.silent) setLoading(false);
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load({ silent: true }); }
    finally { setRefreshing(false); }
  }, [load]);

  const { current, later } = useMemo(() => splitToday(sessions, now), [sessions, now]);

  async function handleLogout() {
    await performLogout();
    navigation.replace('Login', { skipAutoLogin: true });
  }

  const settingsItems: SettingsMenuItem[] = [
    { id: 'profile', label: 'Profile', icon: 'person-outline', onPress: () => navigation.navigate('Profile') },
    { id: 'notifications', label: 'Notifications', icon: 'notifications-outline', onPress: () => navigation.navigate('NotificationSettings') },
    { id: 'signout', label: 'Sign Out', icon: 'log-out-outline', destructive: true, onPress: () => { void handleLogout(); } },
  ];

  const fabItems: FABMenuItem[] = [
    { id: 'overview', label: 'Overview', icon: 'grid', isActive: true, onPress: () => {} },
    { id: 'schedule', label: 'Schedule', icon: 'home', onPress: () => navigation.navigate('CoachDashboard') },
    { id: 'roster', label: 'Roster', icon: 'people', onPress: () => navigation.navigate('CoachRoster') },
    { id: 'tools', label: 'Tools', icon: 'construct', onPress: () => navigation.navigate('CoachTools') },
    { id: 'messages', label: 'Messages', icon: 'chatbubble', badge: unread.messages, onPress: () => navigation.navigate('Messages') },
  ];

  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const num = (v: number | null) => (v === null ? '—' : String(v));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.head}>
        <View>
          <Text style={styles.greet}>{greeting}</Text>
          <Text style={styles.date}>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        </View>
        <TouchableOpacity onPress={() => setSettingsOpen(true)} hitSlop={10}>
          <Ionicons name="settings-outline" size={22} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9BDDFF" colors={['#9BDDFF']} progressBackgroundColor="#1A1A1A" />}
      >
        {loading ? <ActivityIndicator color="#9BDDFF" style={{ marginTop: 40 }} /> : (
          <>
            <View style={styles.secHdr}>
              <Text style={styles.secTitle}>Up next</Text>
              <TouchableOpacity onPress={() => navigation.navigate('CoachDashboard')} hitSlop={8}>
                <Text style={styles.secAction}>All sessions ›</Text>
              </TouchableOpacity>
            </View>

            {current ? (
              <TouchableOpacity style={styles.next} onPress={() => navigation.navigate('CoachDashboard')} activeOpacity={0.8}>
                <View style={[styles.nextEdge, { backgroundColor: current.template?.scheduling_categories?.color || DEFAULT_COLOR }]} />
                <Text style={styles.nextLabel}>{startsInLabel(current, now)}</Text>
                <View style={styles.nextRow1}>
                  <Text style={styles.nextTime}>{formatSessionTime(current.startTime)}</Text>
                  <Text style={styles.nextEnd}>– {formatSessionTime(current.endTime)}</Text>
                </View>
                <Text style={styles.nextName} numberOfLines={1}>{current.template?.name ?? 'Session'}</Text>
                <View style={styles.nextMeta}>
                  {current.template?.scheduling_categories ? (
                    <Text style={[styles.catBadge, {
                      color: current.template.scheduling_categories.color || DEFAULT_COLOR,
                      backgroundColor: `${current.template.scheduling_categories.color || '#FFFFFF'}1F`,
                    }]}>
                      {current.template.scheduling_categories.name}
                    </Text>
                  ) : null}
                  <Text style={styles.nextSub}>{current.is_remote ? 'Video call' : current.location?.name || ''}</Text>
                </View>
                {(() => {
                  const p = bookedPreview(current);
                  return (
                    <View style={styles.who}>
                      <View style={styles.stack}>
                        {p.initials.map((ini, i) => (
                          <View key={`${ini}-${i}`} style={styles.stackAv}><Text style={styles.stackTxt}>{ini}</Text></View>
                        ))}
                        {p.overflow > 0 && (
                          <View style={styles.stackAv}><Text style={styles.stackTxt}>+{p.overflow}</Text></View>
                        )}
                      </View>
                      <Text style={styles.cap}>{p.booked} / {p.capacity} booked</Text>
                    </View>
                  );
                })()}
                {(() => {
                  const url = joinUrlFor(current, now);
                  if (!url) return null;
                  return (
                    <TouchableOpacity
                      style={styles.joinBtn}
                      onPress={() => Linking.openURL(url)}
                      accessibilityRole="button"
                      accessibilityLabel="Join video call"
                    >
                      <Ionicons name="videocam" size={16} color="#0A0A0A" />
                      <Text style={styles.joinText}>Join video call</Text>
                    </TouchableOpacity>
                  );
                })()}
              </TouchableOpacity>
            ) : (
              <View style={styles.next}>
                <Text style={styles.nextName}>{sessions.length === 0 ? 'No sessions today' : 'Done for today'}</Text>
                <Text style={styles.nextSub}>
                  {sessions.length === 0 ? 'Nothing on your schedule' : `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} finished`}
                </Text>
              </View>
            )}

            {later.length > 0 && (
              <>
                <View style={styles.secHdr}>
                  <Text style={styles.secTitle}>Later today · {later.length}</Text>
                </View>
                <View style={styles.laterList}>
                  {later.slice(0, 3).map((s) => (
                    <TouchableOpacity key={s.id} style={styles.later} onPress={() => navigation.navigate('CoachDashboard')}>
                      <Text style={styles.laterTime}>{formatSessionTime(s.startTime)}</Text>
                      <View style={[styles.laterDot, { backgroundColor: s.template?.scheduling_categories?.color || DEFAULT_COLOR }]} />
                      <Text style={styles.laterName} numberOfLines={1}>{s.template?.name ?? 'Session'}</Text>
                      {(() => {
                        const url = joinUrlFor(s, now);
                        if (!url) return <Text style={styles.laterCap}>{s.currentBookings}/{s.capacity}</Text>;
                        return (
                          <TouchableOpacity
                            style={styles.joinPill}
                            onPress={() => Linking.openURL(url)}
                            accessibilityRole="button"
                            accessibilityLabel="Join video call"
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="videocam" size={12} color="#0A0A0A" />
                            <Text style={styles.joinPillText}>Join</Text>
                          </TouchableOpacity>
                        );
                      })()}
                    </TouchableOpacity>
                  ))}
                  {later.length > 3 && (
                    <TouchableOpacity onPress={() => navigation.navigate('CoachDashboard')}>
                      <Text style={styles.laterMore}>+{later.length - 3} more</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

            <View style={styles.secHdr}>
              <Text style={styles.secTitle}>Your athletes</Text>
              <TouchableOpacity onPress={() => navigation.navigate('CoachRoster')} hitSlop={8}>
                <Text style={styles.secAction}>Roster ›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.grid}>
              <TouchableOpacity style={styles.stat} onPress={() => navigation.navigate('CoachRoster')}>
                <View style={[styles.statEdge, { backgroundColor: 'rgba(255,255,255,0.12)' }]} />
                <Text style={styles.statKey}>Members</Text>
                <Text style={styles.statVal}>{num(counts.members)}</Text>
                <Text style={styles.statFoot}>active memberships</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.stat} onPress={() => navigation.navigate('Messages')}>
                <View style={[styles.statEdge, { backgroundColor: unread.messages > 0 ? '#9BDDFF' : 'rgba(255,255,255,0.12)' }]} />
                <Text style={styles.statKey}>Unread</Text>
                <Text style={[styles.statVal, unread.messages > 0 && styles.statValBlue]}>{unread.messages}</Text>
                <Text style={styles.statFoot}>
                  {unread.conversations === 0 ? 'all caught up' : `${unread.conversations} ${unread.conversations === 1 ? 'conversation' : 'conversations'}`}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.stat} onPress={() => navigation.navigate('CoachCoverage', { tab: 'programming' })}>
                <View style={[styles.statEdge, { backgroundColor: counts.needsProgramming ? '#EF4444' : 'rgba(255,255,255,0.12)' }]} />
                <Text style={styles.statKey}>Needs programming</Text>
                <Text style={[styles.statVal, !!counts.needsProgramming && styles.statValRed]}>{num(counts.needsProgramming)}</Text>
                <Text style={styles.statFoot}>{counts.outNow} out now</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.stat} onPress={() => navigation.navigate('CoachCoverage', { tab: 'following' })}>
                <View style={[styles.statEdge, { backgroundColor: counts.notFollowing ? '#F59E0B' : 'rgba(255,255,255,0.12)' }]} />
                <Text style={styles.statKey}>Not following</Text>
                <Text style={[styles.statVal, !!counts.notFollowing && styles.statValAmber]}>{num(counts.notFollowing)}</Text>
                <Text style={styles.statFoot}>{counts.notFollowing === null ? 'activity unavailable' : 'no logs in 7d'}</Text>
              </TouchableOpacity>
            </View>

            {attention.length > 0 && (
              <>
                <View style={styles.secHdr}>
                  <Text style={styles.secTitle}>Needs attention</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('CoachCoverage', { tab: 'programming' })} hitSlop={8}>
                    <Text style={styles.secAction}>Coverage ›</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.attentionWrap}>
                  {attention.map(({ athlete, reason, tone }) => {
                    const n = splitName(athlete.athlete_name);
                    return (
                      <TouchableOpacity
                        key={athlete.athlete_id}
                        style={styles.attentionRow}
                        onPress={() => navigation.navigate('AthleteProgram', { athleteId: athlete.athlete_id, athleteName: athlete.athlete_name })}
                      >
                        <View style={[styles.attentionAv, tone === 'red' && styles.attentionAvRed]}>
                          <Text style={[styles.attentionAvTxt, tone === 'red' && styles.attentionAvTxtRed]}>
                            {n.first[0] || ''}{n.last[0] || ''}
                          </Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.attentionName} numberOfLines={1}>{athlete.athlete_name}</Text>
                          <Text style={[styles.attentionReason, tone === 'red' ? styles.toneRed : styles.toneAmber]} numberOfLines={1}>
                            {reason}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="#4B5563" />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            <View style={styles.secHdr}>
              <Text style={styles.secTitle}>Quick actions</Text>
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('Messages')}>
                <Ionicons name="chatbubble-ellipses-outline" size={19} color="#9BDDFF" />
                <Text style={styles.actionText}>Message an athlete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.action} onPress={() => navigation.navigate('CoachArmCareSearch')}>
                <Ionicons name="fitness-outline" size={19} color="#F87171" />
                <Text style={styles.actionText}>ArmCare test</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      <FABMenu isOpen={fabOpen} onToggle={() => setFabOpen(!fabOpen)} items={fabItems} />
      <SettingsMenu visible={settingsOpen} onClose={() => setSettingsOpen(false)}
        items={settingsItems} btState={btState} onOpenBluetoothSettings={openBluetoothSettings} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  greet: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4 },
  date: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },

  secHdr: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  secTitle: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: '#6B7280' },
  secAction: { fontSize: 11.5, fontWeight: '600', color: '#9BDDFF' },

  next: {
    marginHorizontal: 16, borderRadius: 14, padding: 14, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  nextEdge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  nextLabel: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: '#9BDDFF', marginBottom: 7 },
  nextRow1: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  nextTime: { fontFamily: 'Menlo', fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  nextEnd: { fontSize: 11.5, color: '#9CA3AF' },
  nextName: { fontSize: 15, fontWeight: '600', color: '#FFFFFF', marginTop: 5 },
  nextMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  catBadge: {
    fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
  },
  nextSub: { fontSize: 11.5, color: '#6B7280' },
  who: { flexDirection: 'row', alignItems: 'center', marginTop: 11 },
  stack: { flexDirection: 'row' },
  stackAv: {
    width: 24, height: 24, borderRadius: 12, marginRight: -7,
    backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1.5, borderColor: '#0A0A0A',
    alignItems: 'center', justifyContent: 'center',
  },
  stackTxt: { fontSize: 9, fontWeight: '700', color: '#9CA3AF' },
  cap: { marginLeft: 14, fontSize: 11.5, color: '#9CA3AF' },

  laterList: { paddingHorizontal: 16 },
  later: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.05)' },
  laterTime: { fontFamily: 'Menlo', fontSize: 12, fontWeight: '700', color: '#9CA3AF', width: 62 },
  laterDot: { width: 6, height: 6, borderRadius: 3 },
  laterName: { flex: 1, fontSize: 13.5, color: '#FFFFFF' },
  laterCap: { fontFamily: 'Menlo', fontSize: 11.5, color: '#6B7280' },
  laterMore: { fontSize: 11.5, color: '#9BDDFF', fontWeight: '600', paddingTop: 10 },
  joinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: '#9BDDFF', borderRadius: 12, paddingVertical: 11, marginTop: 12,
  },
  joinText: { color: '#0A0A0A', fontSize: 14, fontWeight: '700' },
  joinPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#9BDDFF', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10,
  },
  joinPillText: { color: '#0A0A0A', fontSize: 11.5, fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  stat: {
    width: '48%', flexGrow: 1, backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 12, overflow: 'hidden',
  },
  statEdge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  statKey: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: '#6B7280' },
  statVal: { fontSize: 26, fontWeight: '700', letterSpacing: -0.6, color: '#FFFFFF', marginTop: 4 },
  statValRed: { color: '#F87171' },
  statValAmber: { color: '#FBBF24' },
  statValBlue: { color: '#9BDDFF' },
  statFoot: { fontSize: 10.5, color: '#6B7280', marginTop: 1 },

  attentionWrap: {
    marginHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden',
  },
  attentionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  attentionAv: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  attentionAvRed: { backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.28)' },
  attentionAvTxt: { fontSize: 11, fontWeight: '700', color: '#9CA3AF' },
  attentionAvTxtRed: { color: '#F87171' },
  attentionName: { fontSize: 14.5, fontWeight: '600', color: '#FFFFFF' },
  attentionReason: { fontSize: 11.5, marginTop: 1 },
  toneRed: { color: '#F87171' },
  toneAmber: { color: '#FBBF24' },

  actions: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  action: {
    flex: 1, alignItems: 'center', gap: 7, paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12,
  },
  actionText: { fontSize: 12, fontWeight: '600', color: '#FFFFFF', textAlign: 'center' },
});
