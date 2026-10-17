/**
 * Header pills: sensor status and "Syncing…". Logger v2 restraint — no warm
 * hues: connected = green, reconnecting = blue with a pulsing dot, not paired
 * = dim white.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { RACK_COLORS, type SensorPill as SensorPillModel } from '../../lib/rack/viewModel';

const TONE = {
  connected: { border: 'rgba(16,185,129,0.35)', text: RACK_COLORS.greenText, dot: RACK_COLORS.green, pulse: false },
  reconnecting: { border: 'rgba(155,221,255,0.35)', text: RACK_COLORS.acc, dot: RACK_COLORS.acc, pulse: true },
  notPaired: { border: 'rgba(255,255,255,0.15)', text: 'rgba(255,255,255,0.55)', dot: 'rgba(255,255,255,0.35)', pulse: false },
  syncing: { border: 'rgba(155,221,255,0.35)', text: RACK_COLORS.acc, dot: RACK_COLORS.acc, pulse: true },
} as const;

export function Pill({ tone, label }: { tone: keyof typeof TONE; label: string }) {
  const t = TONE[tone];
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!t.pulse) {
      op.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(op, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(op, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t.pulse, op]);
  return (
    <View style={[styles.pill, { borderColor: t.border }]}>
      <Animated.View style={[styles.dot, { backgroundColor: t.dot, opacity: op }]} />
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
