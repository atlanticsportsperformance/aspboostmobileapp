/**
 * WorkloadDayRing — subtle bottom bar indicator for calendar day cells.
 * Shows workload as a thin horizontal fill at the bottom of the cell,
 * color-coded by ACWR bucket. Much cleaner than a ring wrapping the day number.
 */

import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { acwrColor, ACWR_HEX } from '../../lib/pulse/workload';

interface Props {
  target: number;
  actual: number;
  acwr: number | null;
  size?: number; // kept for API compat, unused
}

export function WorkloadDayRing({ target, actual, acwr }: Props) {
  const hasActual = actual > 0;
  const hasTarget = target > 0;
  const shouldRender = hasActual || hasTarget;

  const hex = acwr != null ? ACWR_HEX[acwrColor(acwr)] : '#9BDDFF';

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
