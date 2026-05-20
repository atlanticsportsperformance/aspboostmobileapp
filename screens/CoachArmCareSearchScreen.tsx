import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { getLinkedAthletes, getOrgAthletes, filterAthletes, type LinkedAthlete } from '../lib/coachAthletes';

export default function CoachArmCareSearchScreen() {
  const navigation = useNavigation<any>();
  const { user, staffRole, staffOrgId } = useAuth();
  const [all, setAll] = useState<LinkedAthlete[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LinkedAthlete | null>(null);
  const isAdmin = staffRole === 'admin' || staffRole === 'super_admin';

  useEffect(() => {
    const admin = staffRole === 'admin' || staffRole === 'super_admin';
    if (admin && staffOrgId) {
      getOrgAthletes(staffOrgId).then(setAll);
    } else if (user?.id) {
      getLinkedAthletes(user.id).then(setAll);
    }
  }, [user?.id, staffRole, staffOrgId]);

  const results = useMemo(() => filterAthletes(all, query), [all, query]);

  const start = () => {
    if (!selected) return;
    navigation.navigate('ArmCareHub', { athleteId: selected.id, coachActAs: true });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
        <Text style={styles.title}>ArmCare Test</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color="rgba(255,255,255,0.3)" />
        <TextInput style={styles.input} placeholder={isAdmin ? 'Search all athletes' : 'Search your athletes'}
          placeholderTextColor="rgba(255,255,255,0.3)" value={query} onChangeText={setQuery} autoFocus />
      </View>

      <FlatList
        data={results}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item }) => {
          const sel = selected?.id === item.id;
          return (
            <TouchableOpacity style={[styles.row, sel && styles.rowSel]} onPress={() => setSelected(item)}>
              <View style={[styles.avatar, sel && styles.avatarSel]}>
                <Text style={[styles.avatarTxt, sel && { color: '#F87171' }]}>
                  {item.firstName[0]}{item.lastName[0]}
                </Text>
              </View>
              <Text style={styles.name}>{item.firstName} {item.lastName}</Text>
              {sel && <Ionicons name="checkmark-circle" size={20} color="#F87171" />}
            </TouchableOpacity>
          );
        }}
      />

      {selected && (
        <TouchableOpacity style={styles.cta} onPress={start}>
          <Text style={styles.ctaTxt}>Start ArmCare Test — {selected.firstName} {selected.lastName}</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 16, marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  input: { flex: 1, color: '#fff', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12 },
  rowSel: { backgroundColor: 'rgba(248,113,113,0.08)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)' },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center' },
  avatarSel: { borderWidth: 2, borderColor: 'rgba(248,113,113,0.4)' },
  avatarTxt: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  name: { flex: 1, fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  cta: { position: 'absolute', left: 16, right: 16, bottom: 24, padding: 15, borderRadius: 14,
    backgroundColor: '#F87171', alignItems: 'center' },
  ctaTxt: { fontSize: 15, fontWeight: '700', color: '#2a0a0a' },
});
