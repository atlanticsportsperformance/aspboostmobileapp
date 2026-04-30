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
import Svg, { Circle, Line, Defs, RadialGradient, Stop, LinearGradient, Ellipse } from 'react-native-svg';
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

// The heavy SVG tree (halo, ring track, glass rims, 24 tick marks) uses a
// fixed neutral color (#9BDDFF — the Pulse brand cyan). The ACWR bucket
// color is carried ONLY by the animated progress arc and the center text
// (dayW number + ACWR chip), so the shell never needs to rebuild when the
// selected day changes — it renders exactly once per mount.
// Previous behavior rebuilt the entire ~30-node SVG tree through the RN
// bridge on every day switch (~40ms on mid-tier phones). Now it's ~0ms.
const SHELL_HEX = '#9BDDFF';
function GaugeShell({ size, stroke, r, cx, cy }: {
  size: number; stroke: number; r: number; cx: number; cy: number;
}) {
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
    <>
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
              <Stop offset="0%" stopColor={SHELL_HEX} stopOpacity="0.35" />
              <Stop offset="35%" stopColor={SHELL_HEX} stopOpacity="0.12" />
              <Stop offset="70%" stopColor={SHELL_HEX} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50%" cy="50%" r="50%" fill="url(#halo)" />
        </Svg>
      </View>

      <Svg width={size} height={size} style={StyleSheet.absoluteFill as any}>
        <Defs>
          <LinearGradient id="bubbleRim" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <Stop offset="35%" stopColor={SHELL_HEX} stopOpacity="0.35" />
            <Stop offset="100%" stopColor={SHELL_HEX} stopOpacity="0.12" />
          </LinearGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={r + stroke * 0.35} fill="none" stroke="url(#bubbleRim)" strokeWidth={1.5} />
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke={SHELL_HEX} strokeOpacity={0.12} strokeWidth={stroke} />
        <Circle cx={cx} cy={cy} r={r - stroke * 0.55} fill="none" stroke="url(#bubbleRim)" strokeWidth={1} strokeOpacity={0.6} />
        {ticks.map((t) => (
          <Line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={SHELL_HEX}
            strokeOpacity={t.isMajor ? 0.45 : 0.18}
            strokeWidth={t.isMajor ? 1.8 : 1}
          />
        ))}
      </Svg>
    </>
  );
}
const MemoGaugeShell = React.memo(GaugeShell);

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

  // Status color is driven by today's workload vs the scheduled target.
  // ACWR is shown as a separate informational chip — it doesn't drive the
  // main gauge color anymore. Red = overload (threw MORE than scheduled).
  //   - no target → neutral cyan (nothing to compare against)
  //   - dayW > target → red (overload, the one we warn on)
  //   - dayW >= target → emerald (hit it)
  //   - else → cyan (in progress / rest)
  const hasTarget = target != null && target > 0;
  const status: 'neutral' | 'met' | 'over' = !hasTarget
    ? 'neutral'
    : dayW > (target as number)
      ? 'over'
      : dayW >= (target as number)
        ? 'met'
        : 'neutral';
  const hex =
    status === 'over' ? '#ef4444'
    : status === 'met' ? '#34d399'
    : SHELL_HEX;

  // Ceiling: prefer explicit target, else chronic × 1.3, else 5 W
  const arcCeiling = useMemo(() => {
    if (target != null && target > 0) return target;
    if (chronic > 0.05) return chronic * 1.3;
    return 5;
  }, [target, chronic]);
  const progressPct = Math.min(1, Math.max(0, dayW / arcCeiling));

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

  // Gauge color model:
  //   - Red    = today went OVER scheduled target (the warning)
  //   - Green  = today met scheduled target (positive signal)
  //   - Cyan   = under target / no target (neutral)
  // ACWR is shown as a neutral informational chip — it's a trend indicator,
  // not a verdict on today's activity, so it doesn't drive the color.
  return (
    <View style={[styles.container, { width: size, height: size + 80 }]}>
      <View style={{ width: size, height: size }}>
        <MemoGaugeShell size={size} stroke={stroke} r={r} cx={cx} cy={cy} />

        {value != null && (
          <Svg width={size} height={size} style={StyleSheet.absoluteFill as any} pointerEvents="none">
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
          </Svg>
        )}

        <View
          style={[styles.centerStack, { width: size, height: size }]}
          pointerEvents="none"
        >
          <Text style={[styles.bigNumber, { fontSize: size * 0.22, color: hex }]}>
            {dayW.toFixed(1)}
          </Text>
          <Text style={styles.label}>W TODAY</Text>
          {value != null && (
            <Text style={[styles.acwrChip, { color: '#9ca3af' }]}>
              ACWR {value.toFixed(2)}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.statRow}>
        {hasTarget ? (
          <View style={styles.statBlock}>
            <Text style={styles.statLabel}>TARGET</Text>
            <Text style={[styles.statValue, { color: '#e5e7eb' }]}>{(target as number).toFixed(1)}</Text>
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
          <Text style={[styles.statValue, { color: '#e5e7eb' }]}>{chronic.toFixed(2)}</Text>
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
    color: '#9ca3af',
    fontSize: 10,
    letterSpacing: 3,
    marginTop: 6,
    fontWeight: '700',
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
    color: '#9ca3af',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  statSub: {
    color: '#9ca3af',
    fontSize: 10,
    marginTop: 2,
    fontWeight: '500',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
});
