/**
 * Rack mode — PLACEHOLDER. Task 9 builds the real rack screen (tiles, dial,
 * useRackSession). Landscape comes from lib/rack/orientation (App.tsx syncs it
 * per route). There is no sign-out here: the only way out is the PIN exit,
 * which drains the rack queues first.
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { readRackDevice, type RackDevice } from '../../lib/rack/device';
import { useRackStaffGuard } from '../../hooks/useRackStaffGuard';

export default function RackModeScreen() {
  const navigation = useNavigation<any>();
  useRackStaffGuard();
  const [rack, setRack] = useState<RackDevice | null>(null);

  useEffect(() => {
    readRackDevice().then(setRack);
  }, []);

  // Android back never leaves Rack mode.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>{rack?.rackName ?? 'Rack'}</Text>
        <TouchableOpacity style={styles.exit} onPress={() => navigation.navigate('RackPinExit')}>
          <Text style={styles.exitText}>Exit</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.body}>
        <Text style={styles.muted}>Rack mode</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  title: { fontSize: 22, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  exit: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  exitText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { fontSize: 14, color: 'rgba(255,255,255,0.4)' },
});
