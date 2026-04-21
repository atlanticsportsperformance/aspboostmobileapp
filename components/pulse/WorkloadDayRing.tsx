/**
 * WorkloadDayRing — subtle bottom bar indicator for calendar day cells.
 * Shows workload as a thin horizontal fill at the bottom of the cell.
 *
 * Color model (matches the gauge):
 *   - Red   = went OVER the scheduled target (overload)
 *   - Green = hit/met the scheduled target
 *   - Cyan  = under target / no target (neutral)
 * ACWR is no longer a color driver — it's a separate trend signal.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface Props {
  target: number;
  actual: number;
  acwr: number | null;
  size?: number; // kept for API compat, unused
}

export function WorkloadDayRing({ target, actual }: Props) {
  const hasActual = actual > 0;
  const hasTarget = target > 0;
  const shouldRender = hasActual || hasTarget;

  const hex = hasTarget
    ? actual > target
      ? '#ef4444' // red — over target
      : actual >= target
        ? '#34d399' // emerald — met target
        : '#9BDDFF' // cyan — in progress
    : '#9BDDFF'; // cyan — no target

  const pct = hasTarget
    ? Math.min(1, Math.max(0, actual / target))
    : hasActual
      ? 1
      : 0;

  const progress = useSharedValue(0);
  useEffect(() => {
    if (shouldRender) {
      progress.value = withTiming(pct, {
        duration: 600,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      });
    }
  }, [pct, shouldRender]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  if (!shouldRender) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={[styles.track, { backgroundColor: `${hex}22` }]}>
        <Animated.View style={[styles.fill, { backgroundColor: hex }, fillStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 3,
  },
  track: {
    height: 2.5,
    borderRadius: 1.25,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 1.25,
  },
});
