/** Header pills: sensor status (connected / reconnecting / not paired) and "Syncing…". */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RACK_COLORS, type SensorPill as SensorPillModel } from '../../lib/rack/viewModel';

const TONE = {
  connected: { border: 'rgba(16,185,129,0.35)', text: RACK_COLORS.greenText, dot: RACK_COLORS.green },
  reconnecting: { border: 'rgba(240,136,62,0.4)', text: RACK_COLORS.amberText, dot: RACK_COLORS.amber },
  notPaired: { border: 'rgba(255,255,255,0.15)', text: 'rgba(255,255,255,0.55)', dot: 'rgba(255,255,255,0.35)' },
  syncing: { border: 'rgba(155,221,255,0.35)', text: RACK_COLORS.acc, dot: RACK_COLORS.acc },
} as const;

export function Pill({ tone, label }: { tone: keyof typeof TONE; label: string }) {
  const t = TONE[tone];
  return (
    <View style={[styles.pill, { borderColor: t.border }]}>
      <View style={[styles.dot, { backgroundColor: t.dot }]} />
      <Text style={[styles.txt, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function SensorPill({ pill }: { pill: SensorPillModel }) {
  return <Pill tone={pill.kind} label={pill.label} />;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 999 },
  txt: { fontSize: 12, fontWeight: '700' },
});
