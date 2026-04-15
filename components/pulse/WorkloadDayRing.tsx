/**
 * WorkloadDayRing — compact SVG ring that lives inside a calendar day cell.
 * Shows target vs actual workload as a radial fill. Color driven by ACWR
 * bucket when available, else cyan. Slow pulse on the "today" variant.
 */

import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { acwrColor, ACWR_HEX } from '../../lib/pulse/workload';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  target: number;
  actual: number;
  acwr: number | null;
  size?: number;
  isToday?: boolean;
}

export function WorkloadDayRing({
  target,
  actual,
  acwr,
  size = 30,
  isToday = false,
}: Props) {
  const hasActual = actual > 0;
  const hasTarget = target > 0;
  if (!hasActual && !hasTarget) return null;

  const hex = useMemo(() => {
    if (acwr != null) return ACWR_HEX[acwrColor(acwr)];
    return '#9BDDFF';
  }, [acwr]);

  const stroke = 3.2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = hasTarget
    ? Math.min(1, Math.max(0, actual / target))
    : hasActual
      ? 1
      : 0;

  // Animated fill sweep
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(pct, {
      duration: 900,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [pct, progress]);

  // Today — slow breathing pulse on the glow
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (isToday && hasActual) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    } else {
      pulse.value = 0;
    }
  }, [isToday, hasActual, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + pulse.value * 0.35,
  }));

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: c - c * progress.value,
  }));

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size },
      ]}
      pointerEvents="none"
    >
      <Animated.View
        style={[
          styles.halo,
          { width: size, height: size, shadowColor: hex },
          haloStyle,
        ]}
      />
      <Svg width={size} height={size}>
        {/* Track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={hex}
          strokeOpacity={0.22}
          strokeWidth={stroke}
        />
        {/* Progress arc */}
        {pct > 0 && (
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={hex}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            animatedProps={animatedProps}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    borderRadius: 100,
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
});
