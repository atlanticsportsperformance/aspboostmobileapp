import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BluetoothStatusRow } from './BluetoothStatusRow';
import type { BluetoothPermissionState } from '../lib/ble/permissions';

export interface SettingsMenuItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  onPress: () => void;
  destructive?: boolean;
}

export function SettingsMenu({
  visible,
  onClose,
  items,
  btState,
  onOpenBluetoothSettings,
}: {
  visible: boolean;
  onClose: () => void;
  items: SettingsMenuItem[];
  btState: BluetoothPermissionState;
  onOpenBluetoothSettings: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.dropdown} onStartShouldSetResponder={() => true}>
          {items.map((it) => (
            <TouchableOpacity
              key={it.id}
              style={styles.item}
              onPress={() => {
                onClose();
                it.onPress();
              }}
            >
              <Ionicons name={it.icon as any} size={20} color={it.destructive ? '#F87171' : '#9BDDFF'} />
              <View style={styles.itemContent}>
                <Text style={[styles.label, it.destructive && { color: '#F87171' }]}>{it.label}</Text>
                {it.description ? <Text style={styles.desc}>{it.description}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
          <View style={styles.divider} />
          <BluetoothStatusRow
            state={btState}
            onOpenSettings={() => {
              onClose();
              onOpenBluetoothSettings();
            }}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  dropdown: {
    position: 'absolute',
    top: 100,
    right: 16,
    minWidth: 280,
    backgroundColor: '#0A0A0A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 8,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  itemContent: { flex: 1 },
  label: { fontSize: 14, fontWeight: '700', color: '#fff' },
  desc: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 4 },
});
