/**
 * RadialAcwr — React Native twin of the web gauge, dialed up.
 *
 * Full circle ring, draw-in animation, number counter spring, color-shifts
 * with ACWR, ambient radial glow halo, subtle pulse on the active color,
 * 24 tick marks. Uses react-native-svg + react-native-reanimated.
 *
 * This is the signature component of the pulse system — it should feel
 * premium, fluid, and native. It's deliberately more animated than the web
 * version (the web was constrained by framer-motion). On iOS it should
 * breathe.
 */

import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { acwrColor, ACWR_HEX } from '../../lib/pulse/workload';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  /** ACWR value drives the gauge color. null = not enough history yet. */
  value: number | null;
  /** W_day for the selected day — the big centered number. */
  dayW: number;
  /** Chronic (28-day mean) — shown when no target. */
  chronic: number;
  /** Plan target W_day for the selected day. Swaps the secondary stat. */
  target?: number | null;
  /** Short date label ("Apr 15"). */
  dateLabel: string;
  size?: number;
}

function RadialAcwrInner({
  value,
  dayW,
  chronic,
  target = null,
  dateLabel,
  size = 260,
}: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = size * 0.065;
  const r = size / 2 - stroke * 1.6;
  const circumference = 2 * Math.PI * r;

  // Color driven by ACWR bucket
  const baseHex = '#9BDDFF';
  const hex = value == null ? baseHex : ACWR_HEX[acwrColor(value)];

  // Ceiling: prefer explicit target, else chronic × 1.3, else 5 W
  const arcCeiling = useMemo(() => {
    if (target != null && target > 0) return target;
    if (chronic > 0.05) return chronic * 1.3;
    return 5;
  }, [target, chronic]);
  const progressPct = Math.min(1, Math.max(0, dayW / arcCeiling));

  // ─── Reanimated state ───
  // Only the progress ring animates. The breathing halo loop and number spring
  // were both removed because they were causing the WorkloadScreen to freeze
  // after a few minutes — the breathing withRepeat(-1) loop ran 60fps forever
  // on the UI thread, which compounds dev-mode bookkeeping into JS-thread
  // starvation. The halo is now static (still visible, just doesn't pulse).
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(progressPct, {
      duration: 1400,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
    return () => {
      cancelAnimation(progress);
    };
  }, [progressPct, progress]);

  const animatedRingProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference - circumference * progress.value,
  }));

  // Tick marks — 24 around 360°
  const ticks = useMemo(() => {
    const TICK_COUNT = 24;
    return Array.from({ length: TICK_COUNT }, (_, i) => {
      const angle = (i / TICK_COUNT) * 360 - 90;
      const rad = (angle * Math.PI) / 180;
      const isMajor = i % 6 === 0;
      const outerR = r - stroke * 0.55;
      const innerR = r - stroke * (isMajor ? 0.2 : 0.4);
      return {
        key: i,
        x1: cx + innerR * Math.cos(rad),
        y1: cy + innerR * Math.sin(rad),
        x2: cx + outerR * Math.cos(rad),
        y2: cy + outerR * Math.sin(rad),
        isMajor,
      };
    });
  }, [r, stroke, cx, cy]);

  return (
    <View style={[styles.container, { width: size }]}>
      {/* Ambient halo behind the gauge — static opacity (no breathing pulse) */}
      <View
        style={[
          styles.halo,
          {
            width: size * 1.4,
            height: size * 1.4,
            top: -size * 0.2,
            left: -size * 0.2,
            opacity: 0.55,
          },
        ]}
        pointerEvents="none"
      >
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={hex} stopOpacity="0.35" />
              <Stop offset="35%" stopColor={hex} stopOpacity="0.12" />
              <Stop offset="70%" stopColor={hex} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50%" cy="50%" r="50%" fill="url(#halo)" />
        </Svg>
      </View>

      <Svg width={size} height={size}>
        {/* Track — faint full ring */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={hex}
          strokeOpacity={0.12}
          strokeWidth={stroke}
        />

        {/* Progress ring — animated draw-in */}
        {value != null && (
          <AnimatedCircle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={hex}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            animatedProps={animatedRingProps}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}

        {/* Tick marks */}
        {ticks.map((t) => (
          <Line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={hex}
            strokeOpacity={t.isMajor ? 0.45 : 0.18}
            strokeWidth={t.isMajor ? 1.8 : 1}
          />
        ))}
      </Svg>

      {/* Centered text — W today + ACWR chip */}
      <View
        style={[
          styles.centerStack,
          { width: size, height: size },
        ]}
        pointerEvents="none"
      >
        <Text
          style={[
            styles.bigNumber,
            {
              fontSize: size * 0.22,
              color: hex,
            },
          ]}
        >
          {dayW.toFixed(1)}
        </Text>
        <Text style={styles.label}>W TODAY</Text>
        {value != null && (
          <Text
            style={[
              styles.acwrChip,
              { color: hex },
            ]}
          >
            ACWR {value.toFixed(2)}
          </Text>
        )}
      </View>

      {/* Secondary stat pair below the ring */}
      <View style={styles.statRow}>
        {target != null && target > 0 ? (
          <View style={styles.statBlock}>
            <Text style={styles.statLabel}>TARGET</Text>
            <Text
              style={[styles.statValue, { color: hex }]}
            >
              {target.toFixed(1)}
            </Text>
            <Text style={styles.statSub}>W planned</Text>
          </View>
        ) : (
          <View style={styles.statBlock}>
            <Text style={styles.statLabel}>{dateLabel.toUpperCase()}</Text>
            <Text style={[styles.statValue, { color: '#e5e7eb' }]}>
              {dayW > 0 ? '✓' : '—'}
            </Text>
            <Text style={styles.statSub}>no target</Text>
          </View>
        )}
        <View style={styles.divider} />
        <View style={styles.statBlock}>
          <Text style={styles.statLabel}>CHRONIC</Text>
          <Text style={[styles.statValue, { color: hex }]}>
            {chronic.toFixed(2)}
          </Text>
          <Text style={styles.statSub}>28-day</Text>
        </View>
      </View>
    </View>
  );
}

// Memoize so idle parent re-renders (AuthContext token refresh, etc.) don't
// re-render the entire SVG tree. Props are all primitives so shallow compare
// via React.memo's default equality is correct.
export const RadialAcwr = React.memo(RadialAcwrInner);

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    position: 'relative',
  },
  halo: {
    position: 'absolute',
  },
  centerStack: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigNumber: {
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
    // No textShadow — RN clips text shadow to the glyph's bounding box which
    // reads as a square halo. The gauge's own radial SVG halo does the glow.
  },
  label: {
    color: '#6b7280',
    fontSize: 10,
    letterSpacing: 3,
    marginTop: 6,
    fontWeight: '600',
  },
  acwrChip: {
    marginTop: 6,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 32,
    marginTop: 22,
  },
  statBlock: {
    alignItems: 'center',
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 9,
    letterSpacing: 2,
    fontWeight: '600',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  statSub: {
    color: '#4b5563',
    fontSize: 9,
    marginTop: 2,
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
});
