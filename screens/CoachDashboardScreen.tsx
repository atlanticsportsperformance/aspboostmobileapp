import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import FABMenu, { type FABMenuItem } from '../components/FABMenu';
import { SettingsMenu, type SettingsMenuItem } from '../components/SettingsMenu';
import { getCoachTodaysSessions, type CoachSession } from '../lib/coachScheduleApi';
import { onBluetoothStateChange, openBluetoothSettings, type BluetoothPermissionState } from '../lib/ble/permissions';

export default function CoachDashboardScreen() {
  const navigation = useNavigation<any>();
  const { signOut } = useAuth();
  const [sessions, setSessions] = useState<CoachSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [fabOpen, setFabOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [btState, setBtState] = useState<BluetoothPermissionState>('unknown');

  useEffect(() => {
    const unsub = onBluetoothStateChange(setBtState, true);
    return () => unsub();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSessions(await getCoachTodaysSessions(new Date())); }
    catch { setSessions([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const settingsItems: SettingsMenuItem[] = [
    { id: 'profile', label: 'Profile', icon: 'person-outline', onPress: () => navigation.navigate('Profile') },
    { id: 'notifications', label: 'Notifications', icon: 'notifications-outline', onPress: () => navigation.navigate('NotificationSettings') },
    { id: 'signout', label: 'Sign Out', icon: 'log-out-outline', destructive: true, onPress: () => { void signOut(); } },
  ];

  const fabItems: FABMenuItem[] = [
    { id: 'schedule', label: 'Schedule', icon: 'home', isActive: true, onPress: () => {} },
    { id: 'tools', label: 'Tools', icon: 'construct', onPress: () => navigation.navigate('CoachTools') },
    { id: 'messages', label: 'Messages', icon: 'chatbubble', onPress: () => navigation.navigate('Messages') },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Today's Sessions</Text>
        <TouchableOpacity onPress={() => setSettingsOpen(true)}>
          <Ionicons name="settings-outline" size={22} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 120 }}>
        {loading && <ActivityIndicator color="#9BDDFF" style={{ marginTop: 40 }} />}
        {!loading && sessions.length === 0 && <Text style={styles.empty}>No sessions scheduled today</Text>}
        {!loading && sessions.map((s) => <SessionCard key={s.id} session={s} />)}
      </ScrollView>
      <FABMenu isOpen={fabOpen} onToggle={() => setFabOpen(!fabOpen)} items={fabItems} />
      <SettingsMenu visible={settingsOpen} onClose={() => setSettingsOpen(false)}
        items={settingsItems} btState={btState} onOpenBluetoothSettings={openBluetoothSettings} />
    </SafeAreaView>
  );
}

function SessionCard({ session }: { session: CoachSession }) {
  const color = session.template?.scheduling_categories?.color || 'rgba(255,255,255,0.1)';
  const start = new Date(session.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <Text style={styles.cardTime}>{start}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardName}>{session.template?.name ?? 'Session'}</Text>
        <Text style={styles.cardSub}>{session.location?.name ?? ''}</Text>
      </View>
      <Text style={styles.cap}>{session.currentBookings}/{session.capacity}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { fontSize: 20, fontWeight: '800', color: 'rgba(255,255,255,0.9)' },
  empty: { color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 40 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#131317',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderLeftWidth: 3, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTime: { fontFamily: 'Menlo', fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  cardName: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  cardSub: { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 },
  cap: { fontFamily: 'Menlo', fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
});
