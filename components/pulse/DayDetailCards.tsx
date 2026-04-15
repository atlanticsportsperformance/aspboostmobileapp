/**
 * DayDetailCards — two hero cards for the day-detail view of the athlete
 * dashboard:
 *
 *  - WorkloadDaySection: the standalone workload hero for days with an
 *    assigned target or logged throws but NO throwing workout. Tap → opens
 *    the WorkloadScreen.
 *  - CombinedThrowingDayCard: the fused hero for days with BOTH a workload
 *    target and a scheduled throwing workout. Tap → starts the workout.
 *
 * Both cards use the same palette logic and radial ring motif as the calendar
 * day rings and the full-circle RadialAcwr gauge.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { acwrColor, ACWR_HEX } from '../../lib/pulse/workload';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface WorkloadShape {
  target: number;
  actual: number;
  throwCount: number;
  acwr: number | null;
}

function useStatusAndHex(
  target: number,
  actual: number,
  acwr: number | null,
): { status: { label: string; hex: string }; hex: string } {
  const hasActual = actual > 0;
  const hasTarget = target > 0;
  const status = useMemo(() => {
    if (!hasTarget && !hasActual) return { label: 'No data', hex: '#4b5563' };
    if (!hasActual) return { label: 'No throws yet', hex: '#9BDDFF' };
    if (!hasTarget) return { label: 'Logged', hex: '#9BDDFF' };
    const ratio = actual / target;
    if (ratio < 0.5) return { label: 'Starting', hex: '#9BDDFF' };
    if (ratio < 0.9) return { label: 'On track', hex: '#34d399' };
    if (ratio <= 1.1) return { label: 'Hit target', hex: '#34d399' };
    if (ratio <= 1.3) return { label: 'Over target', hex: '#facc15' };
    return { label: 'Overload', hex: '#ef4444' };
  }, [hasTarget, hasActual, target, actual]);
  const hex = useMemo(() => {
    if (acwr != null) return ACWR_HEX[acwrColor(acwr)];
    return status.hex;
  }, [acwr, status.hex]);
  return { status, hex };
}

// ─────────────────────────────────────────────────────────────
// Shared animated ring for both cards
// ─────────────────────────────────────────────────────────────

function AnimatedRing({
  size,
  stroke,
  hex,
  pct,
  centerLabel,
}: {
  size: number;
  stroke: number;
  hex: string;
  pct: number;
  centerLabel: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(Math.min(1, pct), {
      duration: 1200,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
  }, [pct, progress]);

  const breathing = useSharedValue(0);
  useEffect(() => {
    breathing.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [breathing]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: c - c * progress.value,
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + breathing.value * 0.3,
    shadowOpacity: 0.4 + breathing.value * 0.3,
  }));

  return (
    <View
      style={{
        width: size,
        height: size,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            shadowColor: hex,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 0 },
            elevation: 10,
          },
          haloStyle,
        ]}
      />
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={hex}
          strokeOpacity={0.2}
          strokeWidth={stroke}
        />
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
      </Svg>
      <View style={StyleSheet.absoluteFillObject as any}>
        <View style={styles.ringCenter}>
          <Text
            style={[
              styles.ringNumber,
              {
                color: hex,
                textShadowColor: hex,
                textShadowRadius: 14,
              },
            ]}
          >
            {centerLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// WorkloadDaySection — standalone hero when no throwing workout exists
// ─────────────────────────────────────────────────────────────

export function WorkloadDaySection({
  workload,
  onPress,
}: {
  workload: WorkloadShape;
  onPress?: () => void;
}) {
  const { target, actual, throwCount, acwr } = workload;
  const { status, hex } = useStatusAndHex(target, actual, acwr);
  const hasActual = actual > 0;
  const hasTarget = target > 0;
  const pct = hasTarget ? actual / target : hasActual ? 1 : 0;
  const centerLabel = hasTarget
    ? `${Math.round((actual / target) * 100)}%`
    : hasActual
      ? actual.toFixed(1)
      : '—';

  return (
    <Animated.View entering={FadeInDown.duration(420).springify().damping(16)}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onPress?.();
        }}
        style={({ pressed }) => [
          styles.card,
          { borderColor: `${hex}33` },
          pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        ]}
      >
        <View
          style={[
            styles.cardGlow,
            { shadowColor: hex },
          ]}
          pointerEvents="none"
        />
        <View style={styles.row}>
          <AnimatedRing size={92} stroke={7} hex={hex} pct={pct} centerLabel={centerLabel} />
          <View style={styles.rightCol}>
            <Text style={styles.miniLabel}>WORKLOAD</Text>
            <Text
              style={[
                styles.bigMetric,
                { color: hex, textShadowColor: hex },
              ]}
            >
              {hasTarget && hasActual ? (
                <>
                  {actual.toFixed(1)}
                  <Text style={styles.bigMetricDim}> / </Text>
                  {target.toFixed(1)}
                  <Text style={styles.bigMetricUnit}> W</Text>
                </>
              ) : hasTarget ? (
                <>
                  0.0<Text style={styles.bigMetricDim}> / </Text>
                  {target.toFixed(1)}
                  <Text style={styles.bigMetricUnit}> W</Text>
                </>
              ) : (
                <>
                  {actual.toFixed(1)}
                  <Text style={styles.bigMetricUnit}> W</Text>
                </>
              )}
            </Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: status.hex,
                    shadowColor: status.hex,
                  },
                ]}
              />
              <Text style={[styles.statusLabel, { color: status.hex }]}>
                {status.label.toUpperCase()}
              </Text>
              {throwCount > 0 && (
                <>
                  <Text style={styles.dotSep}>·</Text>
                  <Text style={styles.statusMeta}>
                    {throwCount} throw{throwCount === 1 ? '' : 's'}
                  </Text>
                </>
              )}
              {acwr != null && (
                <>
                  <Text style={styles.dotSep}>·</Text>
                  <Text style={[styles.statusMeta, { color: hex }]}>
                    ACWR {acwr.toFixed(2)}
                  </Text>
                </>
              )}
            </View>
          </View>
          <Text style={[styles.chevron, { color: hex }]}>OPEN →</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────
// CombinedThrowingDayCard — fused hero when day has BOTH
// ─────────────────────────────────────────────────────────────

export function CombinedThrowingDayCard({
  workload,
  workoutName,
  durationMin,
  isCompleted,
  onStart,
}: {
  workload: WorkloadShape;
  workoutName: string;
  durationMin?: number | null;
  isCompleted: boolean;
  onStart: () => void;
}) {
  const { target, actual, throwCount, acwr } = workload;
  const { status, hex } = useStatusAndHex(target, actual, acwr);
  const hasActual = actual > 0;
  const hasTarget = target > 0;
  const pct = hasTarget ? actual / target : hasActual ? 1 : 0;
  const centerLabel = hasTarget
    ? `${Math.round((actual / target) * 100)}%`
    : hasActual
      ? actual.toFixed(1)
      : '—';

  return (
    <Animated.View entering={FadeInDown.duration(460).springify().damping(14)}>
      <View
        style={[
          styles.card,
          styles.combinedCard,
          {
            borderColor: `${hex}4D`,
            shadowColor: hex,
          },
        ]}
      >
        <View
          style={[styles.cardGlow, { shadowColor: hex }]}
          pointerEvents="none"
        />
        {/* Top row: badge + Start button */}
        <View style={styles.combinedTop}>
          <View
            style={[
              styles.badge,
              {
                borderColor: `${hex}66`,
                backgroundColor: `${hex}14`,
              },
            ]}
          >
            <Text style={[styles.badgeText, { color: hex }]}>THROWING</Text>
          </View>
          {isCompleted && (
            <View style={styles.completedBadge}>
              <Text style={styles.completedText}>✓</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onStart();
            }}
            style={({ pressed }) => [
              styles.startBtn,
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            <Text style={styles.startBtnText}>
              {isCompleted ? 'View' : 'Start'}
            </Text>
          </Pressable>
        </View>

        {/* Main row */}
        <View style={styles.row}>
          <AnimatedRing size={92} stroke={7} hex={hex} pct={pct} centerLabel={centerLabel} />
          <View style={styles.rightCol}>
            <Text style={styles.workoutTitle} numberOfLines={1}>
              {workoutName}
            </Text>
            {durationMin != null && (
              <Text style={styles.duration}>{durationMin} min</Text>
            )}
            <Text
              style={[
                styles.bigMetricCombined,
                { color: hex, textShadowColor: hex },
              ]}
            >
              {hasTarget && hasActual ? (
                <>
                  {actual.toFixed(1)}
                  <Text style={styles.bigMetricDim}> / </Text>
                  {target.toFixed(1)}
                  <Text style={styles.bigMetricUnit}> W</Text>
                </>
              ) : hasTarget ? (
                <>
                  0.0<Text style={styles.bigMetricDim}> / </Text>
                  {target.toFixed(1)}
                  <Text style={styles.bigMetricUnit}> W</Text>
                </>
              ) : (
                <>
                  {actual.toFixed(1)}
                  <Text style={styles.bigMetricUnit}> W</Text>
                </>
              )}
            </Text>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: status.hex,
                    shadowColor: status.hex,
                  },
                ]}
              />
              <Text style={[styles.statusLabel, { color: status.hex }]}>
                {status.label.toUpperCase()}
              </Text>
              {throwCount > 0 && (
                <>
                  <Text style={styles.dotSep}>·</Text>
                  <Text style={styles.statusMeta}>
                    {throwCount} throw{throwCount === 1 ? '' : 's'}
                  </Text>
                </>
              )}
              {acwr != null && (
                <>
                  <Text style={styles.dotSep}>·</Text>
                  <Text style={[styles.statusMeta, { color: hex }]}>
                    ACWR {acwr.toFixed(2)}
                  </Text>
                </>
              )}
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 8,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    position: 'relative',
    overflow: 'hidden',
  },
  combinedCard: {
    shadowOpacity: 0.3,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  cardGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    shadowOpacity: 0.25,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  rightCol: {
    flex: 1,
    minWidth: 0,
  },
  miniLabel: {
    color: '#4b5563',
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: '700',
  },
  workoutTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  duration: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },
  bigMetric: {
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 6,
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
  bigMetricCombined: {
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 6,
    textShadowRadius: 16,
    textShadowOffset: { width: 0, height: 0 },
  },
  bigMetricDim: {
    color: '#4b5563',
    fontWeight: '400',
  },
  bigMetricUnit: {
    color: '#4b5563',
    fontSize: 11,
    fontWeight: '400',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  statusLabel: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  dotSep: {
    color: '#374151',
  },
  statusMeta: {
    color: '#6b7280',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    opacity: 0.75,
    marginLeft: 8,
  },
  ringCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringNumber: {
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  combinedTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  completedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(52,211,153,0.2)',
    borderColor: 'rgba(52,211,153,0.4)',
    borderWidth: 1,
  },
  completedText: {
    color: '#6ee7b7',
    fontSize: 11,
    fontWeight: '800',
  },
  startBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#9BDDFF',
    shadowColor: '#9BDDFF',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  startBtnText: {
    color: '#000',
    fontWeight: '800',
    fontSize: 14,
  },
});
