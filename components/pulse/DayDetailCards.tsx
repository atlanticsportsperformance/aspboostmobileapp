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
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

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
  _acwr: number | null,
): { status: { label: string; hex: string }; hex: string } {
  const hasActual = actual > 0;
  const hasTarget = target > 0;
  // Color model (matches the gauge + the calendar rings):
  //   red   = over scheduled target (overload)
  //   green = hit/met target
  //   cyan  = in progress / no target (neutral)
  // ACWR is no longer a color driver; it's a separate trend signal.
  const status = useMemo(() => {
    if (!hasTarget && !hasActual) return { label: 'No data', hex: '#4b5563' };
    if (!hasActual) return { label: 'No throws yet', hex: '#9BDDFF' };
    if (!hasTarget) return { label: 'Logged', hex: '#9BDDFF' };
    if (actual > target) return { label: 'Overload', hex: '#ef4444' };
    if (actual >= target) return { label: 'Hit target', hex: '#34d399' };
    if (actual >= target * 0.5) return { label: 'On track', hex: '#9BDDFF' };
    return { label: 'Starting', hex: '#9BDDFF' };
  }, [hasTarget, hasActual, target, actual]);
  return { status, hex: status.hex };
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
      <View style={combinedStyles.row}>
        {/* Hairline rule on top — matches the rest of the day-detail
            stack (workouts, armcare, bookings). */}
        <View style={combinedStyles.hairline} />
        <View style={combinedStyles.inner}>
          {/* Faint cyan-tinted wash for category identity. */}
          <LinearGradient
            colors={[`${hex}14`, `${hex}05`, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
          {/* Thin colored accent stripe on the left. */}
          <View style={[combinedStyles.accent, { backgroundColor: hex }]} />

          <View style={combinedStyles.body}>
            {/* Eyebrow row — THROWING + Done chip + Start pill on right */}
            <View style={combinedStyles.headerRow}>
              <View style={combinedStyles.eyebrowRow}>
                <Text style={[combinedStyles.eyebrow, { color: hex }]}>
                  THROWING
                </Text>
                {isCompleted && (
                  <>
                    <Text style={combinedStyles.dotSep}>·</Text>
                    <Text style={combinedStyles.doneInline}>Done</Text>
                  </>
                )}
              </View>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                  onStart();
                }}
                hitSlop={8}
              >
                {({ pressed }) => (
                  <View
                    style={[
                      combinedStyles.startPill,
                      { backgroundColor: hex },
                      pressed && { opacity: 0.82 },
                    ]}
                  >
                    <Text style={combinedStyles.startPillText}>
                      {isCompleted ? 'View' : 'Start'}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>

            {/* Title + duration */}
            <Text style={combinedStyles.workoutName} numberOfLines={1}>
              {workoutName}
            </Text>
            {durationMin != null && (
              <Text style={combinedStyles.duration}>{durationMin} min</Text>
            )}

            {/* Compact ring + metric strip — workload at a glance without
                the boxed hero look. */}
            <View style={combinedStyles.heroRow}>
              <AnimatedRing
                size={56}
                stroke={5}
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
                  {throwCount > 0 && (
                    <>
                      <Text style={combinedStyles.dotSep}>·</Text>
                      <Text style={combinedStyles.meta}>
                        {throwCount} throw{throwCount === 1 ? '' : 's'}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const combinedStyles = StyleSheet.create({
  // Editorial row — matches Workout / ArmCare / Booking rows above and
  // below it in the day-detail stack. Hairline + 3px accent + soft
  // tinted gradient wash, no boxed card.
  row: {},
  hairline: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingTop: 14,
    paddingBottom: 16,
    paddingRight: 4,
    gap: 0,
    position: 'relative',
  },
  accent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginRight: 12,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  dotSep: { color: '#4b5563', fontSize: 10, fontWeight: '700' },
  doneInline: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  startPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  startPillText: {
    color: '#0A0A0A',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  workoutName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
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
    gap: 12,
    marginTop: 12,
  },
  metricCol: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    color: '#6b7280',
    fontSize: 9,
    letterSpacing: 1.4,
    fontWeight: '800',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  statusDot: {
    width: 5,
    height: 5,
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
