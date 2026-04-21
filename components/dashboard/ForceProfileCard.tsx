import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient as SvgRadialGradient,
  Stop,
  Line,
} from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ForceProfile {
  composite_score: number;
  percentile_rank: number;
  best_metric: { name: string; percentile: number; value: number } | null;
  worst_metric: { name: string; percentile: number; value: number } | null;
}

interface PredictedVelocity {
  predicted_value: number;
  predicted_value_low?: number;
  predicted_value_high?: number;
  model_name?: string; // 'pitch_velocity' or 'bat_speed'
}

interface BodyweightData {
  current: number;
  previous: number | null;
  date: string;
}

interface ForceProfileCardProps {
  data: ForceProfile;
  latestPrediction?: PredictedVelocity | null;
  batSpeedPrediction?: PredictedVelocity | null;
  bodyweight?: BodyweightData | null;
}

export default function ForceProfileCard({ data, latestPrediction, batSpeedPrediction, bodyweight, isActive = true }: ForceProfileCardProps & { isActive?: boolean }) {
  const { percentile_rank, best_metric, worst_metric } = data;

  const hasAnimated = useRef(false);

  // Animation values
  const circleAnim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const bestSliderAnim = useRef(new Animated.Value(0)).current;
  const worstSliderAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const predictionAnim = useRef(new Animated.Value(0)).current;

  // Circle geometry — slightly bigger viewBox so the halo can bleed beyond the stroke.
  const SVG_SIZE = 180;
  const CX = SVG_SIZE / 2;
  const CY = SVG_SIZE / 2;
  const STROKE_W = 12;
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - percentile_rank / 100);

  // Tier → hex (single source of truth for arc, halo, rim, ticks, text color)
  const tier =
    percentile_rank >= 75 ? 'elite'
    : percentile_rank >= 50 ? 'optimize'
    : percentile_rank >= 25 ? 'sharpen'
    : 'build';
  const tierHex =
    tier === 'elite' ? '#34d399'
    : tier === 'optimize' ? '#9BDDFF'
    : tier === 'sharpen' ? '#fbbf24'
    : '#ef4444';
  const tierHexBright =
    tier === 'elite' ? '#6ee7b7'
    : tier === 'optimize' ? '#B0E5FF'
    : tier === 'sharpen' ? '#fcd34d'
    : '#f87171';
  const tierHexDeep =
    tier === 'elite' ? '#10b981'
    : tier === 'optimize' ? '#7BC5F0'
    : tier === 'sharpen' ? '#f59e0b'
    : '#dc2626';

  // Tier threshold tick marks at 25 / 50 / 75 — drawn in the SAME rotated frame
  // as the Svg (progress starts at top because the whole Svg is rotated -90°),
  // so t=0% is "up" and t=25% is "right". Math below matches that.
  const ticks = [25, 50, 75].map((t) => {
    const angle = (t / 100) * 2 * Math.PI;
    const rInner = radius - STROKE_W * 0.55;
    const rOuter = radius + STROKE_W * 0.55;
    return {
      key: `tick-${t}`,
      x1: CX + Math.cos(angle) * rInner,
      y1: CY + Math.sin(angle) * rInner,
      x2: CX + Math.cos(angle) * rOuter,
      y2: CY + Math.sin(angle) * rOuter,
      major: t === 50,
    };
  });

  // Reset when card becomes inactive
  useEffect(() => {
    if (!isActive) {
      hasAnimated.current = false;
    }
  }, [isActive]);

  // Animate when card becomes active
  useEffect(() => {
    if (!isActive) return;
    if (hasAnimated.current) return;
    hasAnimated.current = true;

    // Reset values
    circleAnim.setValue(0);
    scoreAnim.setValue(0);
    bestSliderAnim.setValue(0);
    worstSliderAnim.setValue(0);
    scaleAnim.setValue(0.8);
    predictionAnim.setValue(0);

    // Scale in with bounce
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 50,
      useNativeDriver: true,
    }).start();

    // Circle draw animation
    Animated.timing(circleAnim, {
      toValue: 1,
      duration: 1200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Score count up
    Animated.timing(scoreAnim, {
      toValue: percentile_rank,
      duration: 1000,
      delay: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Best slider with spring
    Animated.spring(bestSliderAnim, {
      toValue: best_metric?.percentile || 0,
      delay: 500,
      friction: 8,
      tension: 25,
      useNativeDriver: false,
    }).start();

    // Worst slider with spring
    Animated.spring(worstSliderAnim, {
      toValue: worst_metric?.percentile || 0,
      delay: 800,
      friction: 8,
      tension: 25,
      useNativeDriver: false,
    }).start();

    // Prediction fade in
    if (latestPrediction) {
      Animated.timing(predictionAnim, {
        toValue: 1,
        duration: 500,
        delay: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [isActive]);

  // Interpolate circle stroke
  const animatedStrokeDashoffset = circleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, strokeDashoffset],
  });

  // Display score state - start at target value so it shows correctly even after remount
  const [displayScore, setDisplayScore] = React.useState(percentile_rank);

  // Listen to score animation and update display value
  useEffect(() => {
    const listener = scoreAnim.addListener(({ value }) => {
      setDisplayScore(Math.round(value));
    });
    return () => scoreAnim.removeListener(listener);
  }, [scoreAnim]);

  return (
    <View style={styles.forceProfileContent}>
      {/* LEFT: Circle */}
      <View style={styles.leftColumn}>
        <Animated.View
          style={[
            styles.circleContainer,
            {
              transform: [{ scale: scaleAnim }],
              shadowColor: tierHex,
              shadowOpacity: tier === 'elite' ? 0.55 : 0.35,
              shadowRadius: 22,
              shadowOffset: { width: 0, height: 0 },
            },
          ]}
        >
          {/* Radial halo glow bleeds beyond the ring for depth */}
          <View style={styles.halo} pointerEvents="none">
            <Svg width="100%" height="100%">
              <Defs>
                <SvgRadialGradient id="forceHalo" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={tierHex} stopOpacity="0.45" />
                  <Stop offset="40%" stopColor={tierHex} stopOpacity="0.15" />
                  <Stop offset="78%" stopColor={tierHex} stopOpacity="0" />
                </SvgRadialGradient>
              </Defs>
              <Circle cx="50%" cy="50%" r="50%" fill="url(#forceHalo)" />
            </Svg>
          </View>

          <Svg
            width={SVG_SIZE}
            height={SVG_SIZE}
            style={{ transform: [{ rotate: '-90deg' }] }}
          >
            <Defs>
              {/* Arc gradient stays in the tier hue the whole way around — no
                  more fade-to-black at the start, which was killing visibility. */}
              <SvgLinearGradient id="forceGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={tierHexDeep} />
                <Stop offset="50%" stopColor={tierHex} />
                <Stop offset="100%" stopColor={tierHexBright} />
              </SvgLinearGradient>
              {/* Top-to-bottom glass rim — mimics the Pulse bubble */}
              <SvgLinearGradient id="forceRim" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
                <Stop offset="40%" stopColor={tierHex} stopOpacity="0.30" />
                <Stop offset="100%" stopColor={tierHex} stopOpacity="0.10" />
              </SvgLinearGradient>
            </Defs>

            {/* Outer rim — subtle glass highlight */}
            <Circle
              cx={CX}
              cy={CY}
              r={radius + STROKE_W * 0.45}
              fill="none"
              stroke="url(#forceRim)"
              strokeWidth={1.5}
            />

            {/* Track */}
            <Circle
              cx={CX}
              cy={CY}
              r={radius}
              stroke={tierHex}
              strokeOpacity={0.1}
              strokeWidth={STROKE_W}
              fill="none"
            />

            {/* Inner rim — second glass hit for depth */}
            <Circle
              cx={CX}
              cy={CY}
              r={radius - STROKE_W * 0.55}
              fill="none"
              stroke="url(#forceRim)"
              strokeWidth={1}
              strokeOpacity={0.55}
            />

            {/* Tier threshold tick marks (25 / 50 / 75) */}
            {ticks.map((t) => (
              <Line
                key={t.key}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke={tierHex}
                strokeOpacity={t.major ? 0.5 : 0.25}
                strokeWidth={t.major ? 2 : 1.2}
              />
            ))}

            {/* Animated progress arc */}
            <AnimatedCircle
              cx={CX}
              cy={CY}
              r={radius}
              stroke="url(#forceGradient)"
              strokeWidth={STROKE_W}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={animatedStrokeDashoffset}
            />
          </Svg>

          <View style={styles.circleText}>
            <Text style={[styles.circleScore, { color: tierHex }]}>
              {displayScore}
            </Text>
            <Text style={[styles.circleLabel, { color: `${tierHex}CC` }]}>
              {tier === 'elite' ? 'ELITE' : tier === 'optimize' ? 'OPTIMIZE' : tier === 'sharpen' ? 'SHARPEN' : 'BUILD'}
            </Text>
          </View>
        </Animated.View>

        {/* Predicted Velocities - Below Circle */}
        {(latestPrediction || batSpeedPrediction) && (
          <Animated.View style={[styles.predictionContainer, {
            opacity: predictionAnim,
            transform: [{
              translateY: predictionAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              })
            }]
          }]}>
            <View style={styles.predictionHeader}>
              <Text style={styles.predictionLabel}>Pred. Velo</Text>
              <View style={styles.betaBadge}>
                <Text style={styles.betaText}>Beta</Text>
              </View>
            </View>
            <View style={styles.predictionsRow}>
              {/* Pitching Prediction */}
              {latestPrediction && (
                <View style={styles.predictionItem}>
                  <Text style={styles.predictionTypeLabel}>Pitch</Text>
                  <Text style={styles.predictionValue}>
                    {latestPrediction.predicted_value.toFixed(1)}
                  </Text>
                  {latestPrediction.predicted_value_low && latestPrediction.predicted_value_high && (
                    <Text style={styles.predictionRange}>
                      {latestPrediction.predicted_value_low.toFixed(1)}-{latestPrediction.predicted_value_high.toFixed(1)}
                    </Text>
                  )}
                </View>
              )}
              {/* Bat Speed Prediction */}
              {batSpeedPrediction && (
                <View style={styles.predictionItem}>
                  <Text style={styles.predictionTypeLabel}>Bat</Text>
                  <Text style={[styles.predictionValue, styles.batSpeedValue]}>
                    {batSpeedPrediction.predicted_value.toFixed(1)}
                  </Text>
                  {batSpeedPrediction.predicted_value_low && batSpeedPrediction.predicted_value_high && (
                    <Text style={styles.predictionRange}>
                      {batSpeedPrediction.predicted_value_low.toFixed(1)}-{batSpeedPrediction.predicted_value_high.toFixed(1)}
                    </Text>
                  )}
                </View>
              )}
            </View>
          </Animated.View>
        )}
      </View>

      {/* RIGHT: Best & Worst Metrics */}
      <View style={styles.rightColumn}>
        {/* Best Metric */}
        {best_metric && (
          <Animated.View style={[styles.metricSlider, {
            opacity: bestSliderAnim.interpolate({
              inputRange: [0, best_metric.percentile * 0.3, best_metric.percentile],
              outputRange: [0, 1, 1],
            }),
            transform: [{
              translateX: bestSliderAnim.interpolate({
                inputRange: [0, best_metric.percentile],
                outputRange: [-20, 0],
              })
            }]
          }]}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Strongest</Text>
              <AnimatedPercentile anim={bestSliderAnim} color="#34d399" />
            </View>
            <View style={styles.sliderTrackBg}>
              <Animated.View style={{
                width: bestSliderAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
                height: '100%',
                overflow: 'hidden',
                borderRadius: 999,
              }}>
                <LinearGradient
                  colors={['#000000', '#10b981', '#34d399', '#6ee7b7']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.sliderTrackFillFull}
                />
              </Animated.View>
            </View>
            <View style={styles.sliderFooter}>
              <Text style={styles.sliderMetricName}>{best_metric.name}</Text>
              <Text style={styles.sliderValueBest}>
                {best_metric.value.toFixed(1)}
                <Text style={styles.sliderUnit}>
                  {best_metric.name.includes('Power/BM') ? ' W/kg' :
                   best_metric.name.includes('Power') ? ' W' :
                   best_metric.name.includes('Force') ? ' N' : ''}
                </Text>
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Worst Metric */}
        {worst_metric && (
          <Animated.View style={[styles.metricSlider, {
            opacity: worstSliderAnim.interpolate({
              inputRange: [0, worst_metric.percentile * 0.3, worst_metric.percentile],
              outputRange: [0, 1, 1],
            }),
            transform: [{
              translateX: worstSliderAnim.interpolate({
                inputRange: [0, worst_metric.percentile],
                outputRange: [-20, 0],
              })
            }]
          }]}>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>Focus Area</Text>
              <AnimatedPercentile anim={worstSliderAnim} color="#ef4444" />
            </View>
            <View style={styles.sliderTrackBg}>
              <Animated.View style={{
                width: worstSliderAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
                height: '100%',
                overflow: 'hidden',
                borderRadius: 999,
              }}>
                <LinearGradient
                  colors={['#000000', '#dc2626', '#ef4444', '#f87171']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.sliderTrackFillFull}
                />
              </Animated.View>
            </View>
            <View style={styles.sliderFooter}>
              <Text style={styles.sliderMetricName}>{worst_metric.name}</Text>
              <Text style={styles.sliderValueWorst}>
                {worst_metric.value.toFixed(1)}
                <Text style={styles.sliderUnit}>
                  {worst_metric.name.includes('Power/BM') ? ' W/kg' :
                   worst_metric.name.includes('Power') ? ' W' :
                   worst_metric.name.includes('Force') ? ' N' : ''}
                </Text>
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Bodyweight - Below Sliders */}
        {bodyweight && (
          <Animated.View style={[styles.bodyweightContainer, {
            opacity: predictionAnim,
            transform: [{
              translateY: predictionAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              })
            }]
          }]}>
            <View style={styles.bodyweightRow}>
              <Text style={styles.bodyweightLabel}>Bodyweight</Text>
              <View style={styles.bodyweightValueRow}>
                <Text style={styles.bodyweightValue}>
                  {bodyweight.current.toFixed(0)}
                  <Text style={styles.bodyweightUnit}> lbs</Text>
                </Text>
                {bodyweight.previous && (
                  <Text style={[styles.bodyweightChange, {
                    color: bodyweight.current >= bodyweight.previous ? '#6ee7b7' : '#fca5a5'
                  }]}>
                    {bodyweight.current >= bodyweight.previous ? '+' : ''}
                    {(((bodyweight.current - bodyweight.previous) / bodyweight.previous) * 100).toFixed(1)}%
                  </Text>
                )}
              </View>
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

// Animated percentile display component
function AnimatedPercentile({ anim, color }: { anim: Animated.Value; color: string }) {
  const [displayValue, setDisplayValue] = React.useState(0);

  useEffect(() => {
    const listener = anim.addListener(({ value }) => {
      setDisplayValue(Math.round(value));
    });
    return () => anim.removeListener(listener);
  }, []);

  return (
    <Text style={[styles.sliderPercentBest, { color }]}>{displayValue}th</Text>
  );
}

const styles = StyleSheet.create({
  forceProfileContent: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  leftColumn: {
    alignItems: 'center',
    gap: 8,
  },
  circleContainer: {
    width: 180,
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
  },
  halo: {
    position: 'absolute',
    width: 220,
    height: 220,
    top: -20,
    left: -20,
  },
  circleGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 30,
    shadowOpacity: 1,
  },
  circleText: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleScore: {
    fontSize: 48,
    fontWeight: '700',
  },
  circleLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    letterSpacing: 2,
    marginTop: 4,
  },
  predictionContainer: {
    alignItems: 'center',
    marginTop: 8,
  },
  predictionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  predictionLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  betaBadge: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.4)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  betaText: {
    fontSize: 10,
    color: '#9BDDFF',
    fontWeight: '600',
  },
  predictionValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#9BDDFF',
  },
  predictionRange: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  predictionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  predictionItem: {
    alignItems: 'center',
  },
  predictionTypeLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 2,
  },
  batSpeedValue: {
    color: '#34d399',
  },
  bodyweightContainer: {
    marginTop: 8,
  },
  bodyweightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bodyweightLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  bodyweightValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bodyweightValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  bodyweightUnit: {
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  bodyweightChange: {
    fontSize: 12,
    fontWeight: '600',
  },
  rightColumn: {
    flex: 1,
    gap: 16,
  },
  metricSlider: {
    gap: 6,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  sliderPercentBest: {
    fontSize: 20,
    fontWeight: '700',
    color: '#34d399',
  },
  sliderPercentWorst: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ef4444',
  },
  sliderTrackBg: {
    height: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  sliderTrackFill: {
    height: '100%',
    borderRadius: 999,
  },
  sliderTrackFillFull: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
  },
  sliderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderMetricName: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  sliderValueBest: {
    fontSize: 14,
    fontWeight: '700',
    color: '#34d399',
  },
  sliderValueWorst: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ef4444',
  },
  sliderUnit: {
    fontSize: 11,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.5)',
  },
});
