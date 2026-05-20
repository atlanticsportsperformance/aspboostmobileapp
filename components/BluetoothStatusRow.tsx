import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BluetoothPermissionState } from '../lib/ble/permissions';

// ─── Bluetooth inline status row (used inside Settings dropdowns) ──────────
// Standalone, reusable version of the athlete dashboard's row. The state →
// {color,label,sublabel} mapping is reproduced verbatim from there. The row
// is always tappable (deep-links to iOS Settings → Bluetooth) so the user
// has a single place to fix any of these states.
export function BluetoothStatusRow({
  state,
  onOpenSettings,
}: {
  state: BluetoothPermissionState;
  onOpenSettings: () => void;
}) {
  const tone = (() => {
    switch (state) {
      case 'on':
        return { color: '#34D399', label: 'Bluetooth', sub: 'Ready' };
      case 'off':
        return { color: '#FBBF24', label: 'Bluetooth', sub: 'Off — tap to open Settings' };
      case 'unauthorized':
        return { color: '#F87171', label: 'Bluetooth', sub: 'Permission needed — tap to open Settings' };
      case 'resetting':
        return { color: '#9BDDFF', label: 'Bluetooth', sub: 'Resetting…' };
      case 'unsupported':
        return { color: '#9CA3AF', label: 'Bluetooth', sub: 'Not supported on this device' };
      case 'native-missing':
        return { color: '#9CA3AF', label: 'Bluetooth', sub: 'Unavailable in this build' };
      case 'unknown':
      default:
        return { color: '#9CA3AF', label: 'Bluetooth', sub: 'Checking…' };
    }
  })();

  return (
    <TouchableOpacity style={styles.row} onPress={onOpenSettings}>
      <Ionicons name="bluetooth-outline" size={20} color={tone.color} />
      <View style={styles.content}>
        <Text style={styles.label}>{tone.label}</Text>
        <Text style={[styles.sub, { color: tone.color }]}>{tone.sub}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  content: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  sub: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
});
