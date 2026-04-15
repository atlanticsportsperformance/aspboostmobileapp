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
  FadeIn,
  useSharedValue,
  useAnimatedProps,
  withTiming,
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

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: c - c * progress.value,
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
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          shadowColor: hex,
          shadowOpacity: 0.35,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 0 },
          elevation: 8,
        }}
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
          <Text style={[styles.ringNumber, { color: hex }]}>
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
    <Animated.View entering={FadeIn.duration(260)}>
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
        <View style={styles.row}>
          <AnimatedRing size={92} stroke={7} hex={hex} pct={pct} centerLabel={centerLabel} />
          <View style={styles.rightCol}>
            <Text style={styles.miniLabel}>WORKLOAD</Text>
            <Text
              style={[
                styles.bigMetric,
                { color: hex },
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

  const showMetric =
    hasTarget || hasActual
      ? hasTarget && hasActual
        ? `${actual.toFixed(1)} / ${target.toFixed(1)} W`
        : hasTarget
          ? `0.0 / ${target.toFixed(1)} W`
          : `${actual.toFixed(1)} W`
      : '— W';

  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <View
        style={[
          combinedStyles.shell,
          { borderColor: `${hex}40` },
        ]}
      >
        {/* Top strip — badge + start button on right */}
        <View style={combinedStyles.topStrip}>
          <View
            style={[
              combinedStyles.badge,
              {
                borderColor: `${hex}66`,
                backgroundColor: `${hex}15`,
              },
            ]}
          >
            <Text style={[combinedStyles.badgeText, { color: hex }]}>
              THROWING
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          {isCompleted && (
            <View style={combinedStyles.completedChip}>
              <Text style={combinedStyles.completedChipText}>✓ DONE</Text>
            </View>
          )}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onStart();
            }}
            hitSlop={8}
            style={{ marginLeft: 8 }}
          >
            {({ pressed }) => (
              <View style={[combinedStyles.startButtonCompact, pressed && { opacity: 0.82 }]}>
                <Text style={combinedStyles.startButtonCompactText}>
                  {isCompleted ? 'View' : 'Start'}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        <Text style={combinedStyles.workoutName} numberOfLines={1}>
          {workoutName}
        </Text>
        {durationMin != null && (
          <Text style={combinedStyles.duration}>{durationMin} min</Text>
        )}

        {/* Hero row — big ring + metric stack */}
        <View style={combinedStyles.heroRow}>
          <AnimatedRing
            size={84}
            stroke={7}
            hex={hex}
            pct={pct}
            centerLabel={centerLabel}
          />
          <View style={combinedStyles.metricCol}>
            <Text style={combinedStyles.metricLabel}>TODAY&rsquo;S TARGET</Text>
            <Text style={[combinedStyles.metricValue, { color: hex }]}>
              {showMetric}
            </Text>
            <View style={combinedStyles.statusRow}>
              <View
                style={[
                  combinedStyles.statusDot,
                  { backgroundColor: status.hex },
                ]}
              />
              <Text
                style={[combinedStyles.statusLabel, { color: status.hex }]}
              >
                {status.label.toUpperCase()}
              </Text>
            </View>
            {(throwCount > 0 || acwr != null) && (
              <View style={combinedStyles.metaRow}>
                {throwCount > 0 && (
                  <Text style={combinedStyles.meta}>
                    {throwCount} throw{throwCount === 1 ? '' : 's'}
                  </Text>
                )}
                {throwCount > 0 && acwr != null && (
                  <Text style={combinedStyles.metaDot}>·</Text>
                )}
                {acwr != null && (
                  <Text style={[combinedStyles.meta, { color: hex }]}>
                    ACWR {acwr.toFixed(2)}
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>

      </View>
    </Animated.View>
  );
}

const combinedStyles = StyleSheet.create({
  shell: {
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(155,221,255,0.04)',
  },
  topStrip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badge: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  completedChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(52,211,153,0.15)',
    borderColor: 'rgba(52,211,153,0.4)',
    borderWidth: 1,
  },
  completedChipText: {
    color: '#6ee7b7',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  workoutName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 10,
    letterSpacing: -0.3,
  },
  duration: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 12,
    marginBottom: 12,
  },
  metricCol: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    color: '#4b5563',
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: '700',
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  meta: {
    color: '#6b7280',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  metaDot: {
    color: '#374151',
    fontSize: 10,
  },
  startButtonCompact: {
    backgroundColor: '#9BDDFF',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButtonCompactText: {
    color: '#0A0A0A',
    fontSize: 14,
    fontWeight: '700',
  },
});

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
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#9BDDFF',
    borderWidth: 1,
    borderColor: '#B3E6FF',
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
