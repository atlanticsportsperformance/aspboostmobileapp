/**
 * DEV ONLY: floating controls for the fake OVR sensor (simulator / dev
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
    ['Drop connection', () => device.simulateDrop(3000)],
  ];
  return (
    <View style={styles.bar} pointerEvents="box-none">
      <Text style={styles.tag}>DEV SENSOR</Text>
      {buttons.map(([label, fn]) => (
        <TouchableOpacity key={label} style={styles.btn} onPress={fn}>
          <Text style={styles.txt}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 24,
    bottom: 124,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(20,21,24,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  tag: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, color: 'rgba(255,255,255,0.4)', marginHorizontal: 4 },
  btn: { borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingVertical: 8, paddingHorizontal: 11 },
  txt: { fontSize: 12, fontWeight: '600', color: '#cfd3d8' },
});
