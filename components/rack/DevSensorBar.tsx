/**
 * DEV ONLY: header-docked controls for the fake OVR sensor (simulator / dev
 * toggle). Never rendered in production builds — the screen guards it with
 * `__DEV__`, and so does this component.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { FakeOvrDevice } from '../../lib/ovr/fake-ovr';

export interface DevSensorBarProps {
  device: FakeOvrDevice;
  zone: [number, number] | null;
}

export default function DevSensorBar({ device, zone }: DevSensorBarProps) {
  if (!__DEV__) return null;
  const mid = zone ? Math.round(((zone[0] + zone[1]) / 2) * 100) / 100 : 0.8;
  const slow = zone ? Math.max(0.1, Math.round((zone[0] - 0.08) * 100) / 100) : 0.4;
  const jitter = () => Math.round((mid + (Math.random() - 0.5) * 0.06) * 100) / 100;
  const buttons: [string, () => void][] = [
    ['Rep', () => device.emitRep({ meanV: jitter() })],
    ['Slow rep', () => device.emitRep({ meanV: slow })],
    ['Partial', () => device.emitRep({ meanV: jitter(), romIn: 4 })],
    ['Drop conn', () => device.simulateDrop(3000)],
  ];
  return (
    <View style={styles.bar}>
      <Text style={styles.tag}>DEV</Text>
      {buttons.map(([label, fn]) => (
        <TouchableOpacity key={label} style={styles.btn} onPress={fn}>
          <Text style={styles.txt}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Docked in the header row as small pills (never over the THIS SET bars).
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tag: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, color: 'rgba(255,255,255,0.4)' },
  btn: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', paddingVertical: 5, paddingHorizontal: 9 },
  txt: { fontSize: 11, fontWeight: '600', color: '#cfd3d8' },
});
