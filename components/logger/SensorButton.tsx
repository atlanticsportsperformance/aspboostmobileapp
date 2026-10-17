// Phone-direct OVR (Task 10b): a small control on the exercise screen, shown
// only when the athlete is NOT on a rack. Off → "Connect sensor"; scanning →
// "Looking for sensor…"; scan timed out → "Sensor busy (on a rack?)" + Retry;
// connected → "OVR_Velocity-6C8E" + Disconnect. In dev / the simulator the
// fake sensor's rep buttons sit underneath.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RACK_COLORS } from '../../lib/rack/phoneView';
import { SENSOR_BUSY_TEXT } from '../../lib/rack/solo';
import type { OvrConnState } from '../../lib/ovr/ovr-device';
import type { FakeOvrDevice } from '../../lib/ovr/fake-ovr';
import DevSensorBar from '../rack/DevSensorBar';

export interface SensorButtonProps {
  on: boolean;
  state: OvrConnState;
  deviceName: string | null;
  busy: boolean;
  error: string | null;
  fake: FakeOvrDevice | null;
  zone: [number, number] | null;
  onConnect: (anySensor?: boolean) => void;
  onDisconnect: () => void;
}

export default function SensorButton(p: SensorButtonProps) {
  if (!p.on) {
    return (
      <TouchableOpacity
        style={styles.connect}
        onPress={() => p.onConnect()}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Connect sensor"
      >
        <Ionicons name="bluetooth-outline" size={13} color={RACK_COLORS.zone} />
        <Text style={styles.connectText}>Connect sensor</Text>
      </TouchableOpacity>
    );
  }

  const connected = p.state === 'connected';
  const text = connected
    ? p.deviceName ?? 'Sensor'
    : p.busy
      ? SENSOR_BUSY_TEXT
      : p.state === 'error'
        ? p.error ?? 'Sensor error'
        : p.state === 'reconnecting'
          ? 'Reconnecting…'
          : 'Looking for sensor…';
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={[styles.dot, connected ? styles.dotOn : styles.dotOff]} />
        <Text style={styles.status} numberOfLines={1}>{text}</Text>
        {(p.busy || p.state === 'error') && (
          <TouchableOpacity
            style={styles.btn}
            onPress={() => p.onConnect(true)}
            accessibilityRole="button"
            accessibilityLabel="Retry sensor"
          >
            <Text style={styles.btnText}>Retry</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.btn}
          onPress={p.onDisconnect}
          accessibilityRole="button"
          accessibilityLabel="Disconnect sensor"
        >
          <Text style={styles.btnText}>Disconnect</Text>
        </TouchableOpacity>
      </View>
      {__DEV__ && p.fake && connected && <DevSensorBar device={p.fake} zone={p.zone} />}
    </View>
  );
}

const styles = StyleSheet.create({
  connect: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: RACK_COLORS.tagBorder,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  connectText: { color: RACK_COLORS.zone, fontSize: 12, fontWeight: '700' },
  wrap: { marginHorizontal: 16, marginBottom: 10, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotOn: { backgroundColor: RACK_COLORS.zone },
  dotOff: { backgroundColor: 'rgba(255,255,255,0.3)' },
  status: { flex: 1, color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  btn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  btnText: { color: '#cfd3d8', fontSize: 11, fontWeight: '600' },
});
