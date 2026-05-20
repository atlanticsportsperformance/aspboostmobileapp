import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function CoachToolsScreen() {
  const navigation = useNavigation<any>();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
        <Text style={styles.title}>Tools</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={{ padding: 16, gap: 12 }}>
        <TouchableOpacity style={[styles.tool, styles.toolPrimary]}
          onPress={() => navigation.navigate('CoachArmCareSearch')}>
          <View style={styles.toolIcon}><Ionicons name="fitness" size={22} color="#F87171" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toolTitle}>ArmCare Test</Text>
            <Text style={styles.toolDesc}>Activ5 sensor · run as an athlete</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="rgba(248,113,113,0.7)" />
        </TouchableOpacity>

        <View style={[styles.tool, { opacity: 0.4 }]}>
          <View style={styles.toolIcon}><Ionicons name="baseball" size={22} color="rgba(255,255,255,0.5)" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toolTitle}>Pulse Workload</Text>
            <Text style={styles.toolDesc}>Coming soon (v2)</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#131317',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 16 },
  toolPrimary: { borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.06)' },
  toolIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(248,113,113,0.15)',
    alignItems: 'center', justifyContent: 'center' },
  toolTitle: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  toolDesc: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
});
