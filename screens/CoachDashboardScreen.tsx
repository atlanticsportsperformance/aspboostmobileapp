import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { performLogout } from '../lib/logout';
import FABMenu, { type FABMenuItem } from '../components/FABMenu';
import { SettingsMenu, type SettingsMenuItem } from '../components/SettingsMenu';
import { getCoachTodaysSessions, type CoachSession, type CoachBooking } from '../lib/coachScheduleApi';
import { useAuth } from '../contexts/AuthContext';
import { onBluetoothStateChange, openBluetoothSettings, type BluetoothPermissionState } from '../lib/ble/permissions';

const DEFAULT_COLOR = 'rgba(255,255,255,0.15)';

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function isSameDay(a: Date, b: Date): boolean { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function dayLabel(d: Date): string {
  const today = new Date();
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, addDays(today, 1))) return 'Tomorrow';
  if (isSameDay(d, addDays(today, -1))) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

interface Category { id: string; name: string; color: string }

export default function CoachDashboardScreen() {
  const navigation = useNavigation<any>();
  const { staffRole } = useAuth();
  const isAdmin = staffRole === 'admin' || staffRole === 'super_admin';

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [sessions, setSessions] = useState<CoachSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [fabOpen, setFabOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [btState, setBtState] = useState<BluetoothPermissionState>('unknown');
  const [catFilter, setCatFilter] = useState<string | null>(null); // null = All
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onBluetoothStateChange(setBtState, true);
    return () => unsub();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setExpandedId(null);
    try { setSessions(await getCoachTodaysSessions(selectedDate, undefined, !isAdmin)); }
    catch { setSessions([]); }
    finally { setLoading(false); }
  }, [selectedDate, isAdmin]);
  useEffect(() => { load(); }, [load]);

  // Unique categories present in the loaded day, for the filter row.
  const categories = useMemo<Category[]>(() => {
    const map = new Map<string, Category>();
    for (const s of sessions) {
      const c = s.template?.scheduling_categories;
      if (c && !map.has(c.id)) map.set(c.id, { id: c.id, name: c.name, color: c.color || DEFAULT_COLOR });
    }
    return [...map.values()];
  }, [sessions]);

  const visibleSessions = useMemo(() => {
    if (!catFilter) return sessions;
    return sessions.filter((s) => s.template?.scheduling_categories?.id === catFilter);
  }, [sessions, catFilter]);

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
    { id: 'schedule', label: 'Schedule', icon: 'home', isActive: true, onPress: () => {} },
    { id: 'tools', label: 'Tools', icon: 'construct', onPress: () => navigation.navigate('CoachTools') },
    { id: 'messages', label: 'Messages', icon: 'chatbubble', onPress: () => navigation.navigate('Messages') },
  ];

  const showToday = !isSameDay(selectedDate, new Date());

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Sessions</Text>
        <TouchableOpacity onPress={() => setSettingsOpen(true)} hitSlop={10}>
          <Ionicons name="settings-outline" size={22} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>

      {/* Date navigator */}
      <View style={styles.dateBar}>
        <TouchableOpacity style={styles.dateArrow} onPress={() => setSelectedDate((d) => addDays(d, -1))} hitSlop={8}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
        <View style={styles.dateLabelWrap}>
          <Text style={styles.dateLabel}>{dayLabel(selectedDate)}</Text>
          <Text style={styles.dateSub}>{selectedDate.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}</Text>
        </View>
        <TouchableOpacity style={styles.dateArrow} onPress={() => setSelectedDate((d) => addDays(d, 1))} hitSlop={8}>
          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
        {showToday && (
          <TouchableOpacity style={styles.todayBtn} onPress={() => setSelectedDate(new Date())}>
            <Text style={styles.todayTxt}>Today</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Category filter chips */}
      {categories.length > 0 && (
        <View style={styles.chipRowWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip label="All" active={!catFilter} color="#9BDDFF" onPress={() => setCatFilter(null)} />
            {categories.map((c) => (
              <Chip key={c.id} label={c.name} active={catFilter === c.id} color={c.color} onPress={() => setCatFilter(c.id)} />
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 120 }}>
        {loading && <ActivityIndicator color="#9BDDFF" style={{ marginTop: 40 }} />}
        {!loading && visibleSessions.length === 0 && (
          <Text style={styles.empty}>
            {sessions.length === 0 ? 'No sessions scheduled' : 'No sessions match this filter'}
          </Text>
        )}
        {!loading && visibleSessions.map((s) => (
          <SessionCard
            key={s.id}
            session={s}
            expanded={expandedId === s.id}
            onToggle={() => setExpandedId((id) => (id === s.id ? null : s.id))}
          />
        ))}
      </ScrollView>

      <FABMenu isOpen={fabOpen} onToggle={() => setFabOpen(!fabOpen)} items={fabItems} />
      <SettingsMenu visible={settingsOpen} onClose={() => setSettingsOpen(false)}
        items={settingsItems} btState={btState} onOpenBluetoothSettings={openBluetoothSettings} />
    </SafeAreaView>
  );
}

function Chip({ label, active, color, onPress }: { label: string; active: boolean; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: `${color}22`, borderColor: `${color}80` }]}
    >
      <View style={[styles.chipDot, { backgroundColor: color }]} />
      <Text style={[styles.chipTxt, active && { color: '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function statusInfo(status: string): { color: string; label: string } {
  switch (status) {
    case 'attended': return { color: '#34d399', label: 'In' };
    case 'no_show': return { color: '#f87171', label: 'No-show' };
    case 'waitlisted': return { color: '#fbbf24', label: 'Waitlist' };
    default: return { color: 'rgba(255,255,255,0.3)', label: 'Booked' };
  }
}

function SessionCard({ session, expanded, onToggle }: { session: CoachSession; expanded: boolean; onToggle: () => void }) {
  const color = session.template?.scheduling_categories?.color || DEFAULT_COLOR;
  const catName = session.template?.scheduling_categories?.name;
  const start = new Date(session.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const roster: CoachBooking[] = (session.allBookings && session.allBookings.length ? session.allBookings : session.bookings) || [];

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <TouchableOpacity style={styles.cardHead} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.cardTime}>{start}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{session.template?.name ?? 'Session'}</Text>
          <View style={styles.cardSubRow}>
            {catName ? <Text style={[styles.catBadge, { color, backgroundColor: `${color}1f` }]}>{catName}</Text> : null}
            {session.location?.name ? <Text style={styles.cardSub}>{session.location.name}</Text> : null}
          </View>
        </View>
        <Text style={styles.cap}>{session.currentBookings}/{session.capacity}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="rgba(255,255,255,0.3)" style={{ marginLeft: 6 }} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.roster}>
          {roster.length === 0 ? (
            <Text style={styles.rosterEmpty}>No athletes booked</Text>
          ) : (
            roster.map((b) => {
              const si = statusInfo(b.status);
              const a = b.athletes;
              const name = a ? `${a.first_name} ${a.last_name}` : 'Athlete';
              return (
                <View key={b.id} style={styles.rosterRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarTxt}>{a ? `${a.first_name?.[0] ?? ''}${a.last_name?.[0] ?? ''}` : '?'}</Text>
                  </View>
                  <Text style={styles.rosterName}>{name}</Text>
                  <View style={[styles.statusPill, { backgroundColor: `${si.color}22` }]}>
                    <Text style={[styles.statusTxt, { color: si.color }]}>{si.label}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  title: { fontSize: 22, fontWeight: '800', color: 'rgba(255,255,255,0.92)' },

  dateBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  dateArrow: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  dateLabelWrap: { flex: 1, alignItems: 'center' },
  dateLabel: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  dateSub: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 },
  todayBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: 'rgba(155,221,255,0.12)', borderWidth: 1, borderColor: 'rgba(155,221,255,0.3)' },
  todayTxt: { fontSize: 11, fontWeight: '700', color: '#9BDDFF' },

  chipRowWrap: { paddingBottom: 4 },
  chipRow: { paddingHorizontal: 14, gap: 8, flexDirection: 'row' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipTxt: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },

  empty: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 40 },

  card: { backgroundColor: '#131317', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderLeftWidth: 3, borderRadius: 14, marginBottom: 10, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  cardTime: { fontFamily: 'Menlo', fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)', width: 64 },
  cardName: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  cardSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' },
  catBadge: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' },
  cardSub: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  cap: { fontFamily: 'Menlo', fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },

  roster: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(255,255,255,0.015)', paddingHorizontal: 14, paddingVertical: 6 },
  rosterEmpty: { fontSize: 12, color: 'rgba(255,255,255,0.25)', paddingVertical: 10, textAlign: 'center' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  rosterName: { flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusTxt: { fontSize: 10, fontWeight: '700' },
});
