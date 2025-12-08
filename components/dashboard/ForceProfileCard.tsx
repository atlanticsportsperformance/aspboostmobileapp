import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

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
}

interface BodyweightData {
  current: number;
  previous: number | null;
  date: string;
}

interface ForceProfileCardProps {
  data: ForceProfile;
  latestPrediction?: PredictedVelocity | null;
  bodyweight?: BodyweightData | null;
}

export default function ForceProfileCard({ data, latestPrediction, bodyweight, isActive = true }: ForceProfileCardProps & { isActive?: boolean }) {
  const { percentile_rank, best_metric, worst_metric } = data;

  // Animation values
  const circleAnim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const bestSliderAnim = useRef(new Animated.Value(0)).current;
  const worstSliderAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const predictionAnim = useRef(new Animated.Value(0)).current;

  // Track if animation has already run to prevent re-triggering on parent re-renders
  const hasAnimated = useRef(false);

  // Circle circumference
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - percentile_rank / 100);

  // Animate when card becomes active
  useEffect(() => {
    if (!isActive) return;

    // Only animate once per active cycle - prevents re-triggering on parent re-renders
    if (hasAnimated.current) return;
    hasAnimated.current = true;

    // NOTE: We no longer reset animation values to 0 here because if the component
    // remounts (e.g., when a modal opens/closes), we want to preserve the current values.
    // The animation values are initialized to 0 in useRef above, so first render will animate.

    // Scale in with bounce
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 50,
      useNativeDriver: true,
    }).start();

    // Circle draw animation (starts immediately)
    Animated.timing(circleAnim, {
      toValue: 1,
      duration: 1200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Score count up (slightly delayed)
    Animated.timing(scoreAnim, {
      toValue: percentile_rank,
      duration: 1000,
      delay: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Glow pulse after circle completes
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1500,
          delay: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Best slider with spring (slower, more dramatic)
    Animated.spring(bestSliderAnim, {
      toValue: best_metric?.percentile || 0,
      delay: 500,
      friction: 8,
      tension: 25,
      useNativeDriver: false,
    }).start();

    // Worst slider with spring (more staggered, slower)
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

  // NOTE: We no longer reset hasAnimated when inactive, because parent re-renders
  // (like opening/closing settings modal) would cause animations to replay.
  // The animation only runs once per component mount.

  // Interpolate circle stroke
  const animatedStrokeDashoffset = circleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, strokeDashoffset],
  });

  // Display score (rounded)
  const displayScore = scoreAnim.interpolate({
    inputRange: [0, 100],
    outputRange: [0, 100],
    extrapolate: 'clamp',
  });

  // Animated score text component
  const AnimatedScore = () => {
    const [displayValue, setDisplayValue] = React.useState(0);

    useEffect(() => {
      const listener = scoreAnim.addListener(({ value }) => {
        setDisplayValue(Math.round(value));
      });
      return () => scoreAnim.removeListener(listener);
    }, []);

    return (
      <Text style={[styles.circleScore, {
        color: percentile_rank >= 75 ? '#34d399' : percentile_rank >= 50 ? '#9BDDFF' : percentile_rank >= 25 ? '#fbbf24' : '#ef4444'
      }]}>{displayValue}</Text>
    );
  };

  return (
    <View style={styles.forceProfileContent}>
      {/* LEFT: Circle */}
      <View style={styles.leftColumn}>
        <Animated.View style={[styles.circleContainer, {
          transform: [{ scale: scaleAnim }],
          opacity: glowAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 1],
          }),
        }]}>
          {/* Glow effect behind circle */}
          <Animated.View style={[styles.circleGlow, {
            opacity: glowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.6],
            }),
            backgroundColor: percentile_rank >= 75 ? '#34d399' : percentile_rank >= 50 ? '#9BDDFF' : percentile_rank >= 25 ? '#fbbf24' : '#ef4444',
          }]} />
          <Svg width={160} height={160} style={{ transform: [{ rotate: '-90deg' }] }}>
            <Defs>
              <SvgLinearGradient id="forceGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor="#000000" />
                <Stop offset="30%" stopColor={percentile_rank >= 75 ? "#10b981" : percentile_rank >= 50 ? "#7BC5F0" : percentile_rank >= 25 ? "#f59e0b" : "#dc2626"} />
                <Stop offset="60%" stopColor={percentile_rank >= 75 ? "#34d399" : percentile_rank >= 50 ? "#9BDDFF" : percentile_rank >= 25 ? "#fbbf24" : "#ef4444"} />
                <Stop offset="100%" stopColor={percentile_rank >= 75 ? "#6ee7b7" : percentile_rank >= 50 ? "#B0E5FF" : percentile_rank >= 25 ? "#fcd34d" : "#f87171"} />
              </SvgLinearGradient>
            </Defs>
            <Circle cx="80" cy="80" r="68" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="12" fill="none" />
            <AnimatedCircle
              cx="80"
              cy="80"
              r="68"
              stroke="url(#forceGradient)"
              strokeWidth="12"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={animatedStrokeDashoffset}
            />
          </Svg>
          <View style={styles.circleText}>
            <AnimatedScore />
            <Text style={styles.circleLabel}>
              {percentile_rank >= 75 ? 'ELITE' : percentile_rank >= 50 ? 'OPTIMIZE' : percentile_rank >= 25 ? 'SHARPEN' : 'BUILD'}
            </Text>
          </View>
        </Animated.View>

        {/* Predicted Velocity - Below Circle */}
        {latestPrediction && (
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
            <Text style={styles.predictionValue}>
              {latestPrediction.predicted_value.toFixed(1)}
            </Text>
            {latestPrediction.predicted_value_low && latestPrediction.predicted_value_high && (
              <Text style={styles.predictionRange}>
                {latestPrediction.predicted_value_low.toFixed(1)}-{latestPrediction.predicted_value_high.toFixed(1)} mph
              </Text>
            )}
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
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
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
    fontSize: 10,
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
    fontSize: 9,
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
