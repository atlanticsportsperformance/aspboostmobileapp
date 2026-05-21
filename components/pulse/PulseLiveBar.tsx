// components/pulse/PulseLiveBar.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { usePulse } from '../../lib/pulse/PulseProvider';

export default function PulseLiveBar() {
  const { live } = usePulse();
  const pulseVal = useSharedValue(1);

  React.useEffect(() => {
    if (live.status === 'running') {
      pulseVal.value = withRepeat(
        withSequence(
          withTiming(1.4, { duration: 600, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.sin) }),
        ), -1, false,
      );
    } else {
      pulseVal.value = 1;
    }
  }, [live.status, pulseVal]);

  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulseVal.value }] }));

  if (live.status !== 'running') return null;

  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.dot, dotStyle]} />
      <Text style={styles.live}>LIVE</Text>
      <Text style={styles.count}>{live.throwCount}</Text>
      <Text style={styles.sub}>{live.throwCount === 1 ? 'throw' : 'throws'}</Text>
      <TouchableOpacity style={styles.stop} activeOpacity={0.8} onPress={() => live.stop().catch(() => {})}>
        <Ionicons name="stop" size={12} color="#fca5a5" />
        <Text style={styles.stopText}>Stop</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 8,
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14,
    backgroundColor: 'rgba(248,113,113,0.12)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.5)' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#f87171' },
  live: { color: '#fca5a5', fontWeight: '800', letterSpacing: 1.5, fontSize: 13 },
  count: { color: '#fff', fontWeight: '800', fontFamily: 'Menlo', fontSize: 14 },
  sub: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  stop: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: 'rgba(248,113,113,0.2)', borderWidth: 1, borderColor: '#f87171' },
  stopText: { color: '#fca5a5', fontWeight: '700', fontSize: 12 },
});
