/**
 * PulseHeaderChip — the three-state Pulse entry-point button that lives in
 * the screen header (next to Back / workout title), NOT inside the workload
 * monitor panel. Tapping it opens the PulseWizardModal in any state.
 *
 * States:
 *   • LIVE              — pulsing red dot + "LIVE · N throws"
 *   • CONNECTED idle    — green dot + battery % (+ cached counter badge)
 *   • Disconnected      — bluetooth icon + "Pulse" label
 *
 * Renders nothing until inside a <PulseProvider/> — the consumer
 * (WorkoutLoggerScreen) only mounts this when `isThrowing && showPulseTracker`,
 * which guarantees the provider is also mounted.
 */

import React, { useEffect } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { usePulse } from '../../lib/pulse/PulseProvider';

export function PulseHeaderChip() {
  const { dev, live, openWizard } = usePulse();

  // Pulsing live dot — same loop the Monitor uses, scoped here so the chip
  // is self-contained.
  const pulseVal = useSharedValue(1);
  useEffect(() => {
    if (live.status === 'running') {
      pulseVal.value = withRepeat(
        withSequence(
          withTiming(1.6, { duration: 600, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseVal);
      pulseVal.value = 1;
    }
    return () => cancelAnimation(pulseVal);
  }, [live.status, pulseVal]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseVal.value }],
    opacity: live.status === 'running' ? 2 - pulseVal.value : 1,
  }));

  if (live.status === 'running') {
    return (
      <Pressable
        onPress={openWizard}
        style={({ pressed }) => [styles.live, pressed && { opacity: 0.8 }]}
        hitSlop={6}
      >
        <Animated.View style={[styles.liveDot, pulseStyle]} />
        <Text style={styles.liveText}>LIVE</Text>
        {live.throwCount > 0 && (
          <Text style={styles.liveCount}>· {live.throwCount}</Text>
        )}
      </Pressable>
    );
  }

  if (dev.state === 'connected') {
    const hasCached = (dev.counter ?? 0) > 0;
    return (
      <Pressable
        onPress={openWizard}
        style={({ pressed }) => [styles.connected, pressed && { opacity: 0.8 }]}
        hitSlop={6}
      >
        <View style={styles.connectedDot} />
        <Text style={styles.connectedText}>
          {dev.battery != null ? `${dev.battery}%` : 'Pulse'}
        </Text>
        {hasCached && (
          <View style={styles.cachedBadge}>
            <Ionicons name="flash" size={10} color="#000" />
            <Text style={styles.cachedBadgeText}>{dev.counter}</Text>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={openWizard}
      style={({ pressed }) => [styles.idle, pressed && { opacity: 0.8 }]}
      hitSlop={6}
    >
      <Ionicons name="bluetooth" size={14} color="#9BDDFF" />
      <Text style={styles.idleText}>Pulse</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Disconnected: small pill-shaped cyan-tinted button
  idle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(155,221,255,0.16)',
    borderColor: 'rgba(155,221,255,0.55)',
    borderWidth: 1,
    flexShrink: 0,
  },
  idleText: {
    color: '#9BDDFF',
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  // Connected: green dot + battery
  connected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(52,211,153,0.14)',
    borderColor: 'rgba(52,211,153,0.55)',
    borderWidth: 1,
    flexShrink: 0,
  },
  connectedDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#34d399',
  },
  connectedText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  cachedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: '#9BDDFF',
    marginLeft: 2,
  },
  cachedBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  // Live: pulsing red dot
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(248,113,113,0.16)',
    borderColor: 'rgba(248,113,113,0.55)',
    borderWidth: 1,
    flexShrink: 0,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#f87171',
  },
  liveText: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    includeFontPadding: false,
  },
  liveCount: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
