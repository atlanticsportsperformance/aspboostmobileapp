import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ArmCareData {
  latest: {
    arm_score: number;
    total_strength: number;
    avg_strength_30d: number;
    tests_30d: number;
  };
  pr: {
    arm_score: number;
    date: string;
  };
}

interface ArmCareCardProps {
  data: ArmCareData;
}

export default function ArmCareCard({ data, isActive = true }: ArmCareCardProps & { isActive?: boolean }) {
  const { latest, pr } = data;

  // Animation values
  const circleAnim = useRef(new Animated.Value(0)).current;
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const prBarAnim = useRef(new Animated.Value(0)).current;
  const recentBarAnim = useRef(new Animated.Value(0)).current;
  const strengthAnim = useRef(new Animated.Value(0)).current;
  const testsAnim = useRef(new Animated.Value(0)).current;

  // Circle circumference
  const radius = 75;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - latest.arm_score / 100);

  // Animate when card becomes active
  useEffect(() => {
    if (!isActive) return;

    // Reset all animations to start fresh
    circleAnim.setValue(0);
    scoreAnim.setValue(0);
    scaleAnim.setValue(0.8);
    glowAnim.setValue(0);
    prBarAnim.setValue(0);
    recentBarAnim.setValue(0);
    strengthAnim.setValue(0);
    testsAnim.setValue(0);

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
      toValue: latest.arm_score,
      duration: 1000,
      delay: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    // Glow pulse
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

    // PR bar spring animation
    Animated.spring(prBarAnim, {
      toValue: Math.min(100, pr.arm_score),
      delay: 400,
      friction: 6,
      tension: 40,
      useNativeDriver: false,
    }).start();

    // Recent bar spring animation (staggered)
    Animated.spring(recentBarAnim, {
      toValue: Math.min(100, latest.arm_score),
      delay: 600,
      friction: 6,
      tension: 40,
      useNativeDriver: false,
    }).start();

    // Strength box fade in
    Animated.timing(strengthAnim, {
      toValue: 1,
      duration: 500,
      delay: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Tests count pop
    Animated.spring(testsAnim, {
      toValue: 1,
      delay: 1000,
      friction: 4,
      tension: 60,
      useNativeDriver: true,
    }).start();
  }, [isActive]);

  // Interpolate circle stroke
  const animatedStrokeDashoffset = circleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, strokeDashoffset],
  });

  // Animated score text component
  const AnimatedScore = () => {
    const [displayValue, setDisplayValue] = React.useState(0);

    useEffect(() => {
      const listener = scoreAnim.addListener(({ value }) => {
        setDisplayValue(value);
      });
      return () => scoreAnim.removeListener(listener);
    }, []);

    return (
      <Text style={[styles.circleScore, { color: '#9BDDFF', fontSize: 48 }]}>
        {displayValue.toFixed(1)}
      </Text>
    );
  };

  return (
    <View style={styles.armCareContent}>
      {/* LEFT: Circle + Tests Count */}
      <View style={styles.armCareLeftColumn}>
        <Animated.View style={[styles.armCareCircleContainer, {
          transform: [{ scale: scaleAnim }],
        }]}>
          {/* Glow effect behind circle */}
          <Animated.View style={[styles.circleGlow, {
            opacity: glowAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.6],
            }),
            backgroundColor: '#9BDDFF',
          }]} />
          <Svg width={176} height={176} style={{ transform: [{ rotate: '-90deg' }] }}>
            <Defs>
              <SvgLinearGradient id="armcareGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor="#000000" />
                <Stop offset="30%" stopColor="#7BC5F0" />
                <Stop offset="60%" stopColor="#9BDDFF" />
                <Stop offset="100%" stopColor="#B0E5FF" />
              </SvgLinearGradient>
            </Defs>
            <Circle cx="88" cy="88" r="75" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="12" fill="none" />
            <AnimatedCircle
              cx="88"
              cy="88"
              r="75"
              stroke="url(#armcareGradient)"
              strokeWidth="12"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={animatedStrokeDashoffset}
            />
          </Svg>
          <View style={styles.circleText}>
            <AnimatedScore />
            <Text style={[styles.circleLabel, { fontSize: 12, marginTop: 4 }]}>Arm Score</Text>
          </View>
        </Animated.View>

        {/* Tests count - below circle */}
        <Animated.View style={[styles.testsCount, {
          opacity: testsAnim,
          transform: [{
            scale: testsAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.5, 1],
            })
          }]
        }]}>
          <Text style={styles.testsCountLabel}>Tests (30d)</Text>
          <Text style={styles.testsCountValue}>{latest.tests_30d}</Text>
        </Animated.View>
      </View>

      {/* RIGHT: PR Bars + Strength */}
      <View style={styles.armCareMetrics}>
        {/* Personal Record Section */}
        <View style={styles.armCareSection}>
          <Text style={styles.armCareSectionTitle}>PERSONAL RECORD</Text>

          {/* ALL-TIME BEST Bar */}
          <Animated.View style={[styles.armCareBarRow, {
            opacity: prBarAnim.interpolate({
              inputRange: [0, pr.arm_score * 0.3, pr.arm_score],
              outputRange: [0, 1, 1],
            }),
            transform: [{
              translateX: prBarAnim.interpolate({
                inputRange: [0, Math.min(100, pr.arm_score)],
                outputRange: [-15, 0],
              })
            }]
          }]}>
            <Text style={styles.armCareBarLabel}>BEST</Text>
            <View style={styles.armCareBarContainer}>
              <View style={styles.armCareBarBg}>
                <Animated.View style={{
                  width: prBarAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  height: '100%',
                  overflow: 'hidden',
                  borderRadius: 999,
                }}>
                  <LinearGradient
                    colors={['#000000', '#7BC5F0', '#9BDDFF', '#B0E5FF']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.armCareBarFillFull}
                  />
                </Animated.View>
              </View>
            </View>
            <View style={styles.armCareBarValue}>
              <AnimatedBarValue anim={prBarAnim} maxValue={pr.arm_score} />
            </View>
          </Animated.View>

          {/* 90D AVERAGE Bar */}
          <Animated.View style={[styles.armCareBarRow, {
            opacity: recentBarAnim.interpolate({
              inputRange: [0, latest.arm_score * 0.3, latest.arm_score],
              outputRange: [0, 1, 1],
            }),
            transform: [{
              translateX: recentBarAnim.interpolate({
                inputRange: [0, Math.min(100, latest.arm_score)],
                outputRange: [-15, 0],
              })
            }]
          }]}>
            <Text style={styles.armCareBarLabel}>90D</Text>
            <View style={styles.armCareBarContainer}>
              <View style={styles.armCareBarBg}>
                <Animated.View style={{
                  width: recentBarAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  height: '100%',
                  overflow: 'hidden',
                  borderRadius: 999,
                }}>
                  <LinearGradient
                    colors={
                      latest.arm_score >= pr.arm_score
                        ? ['#000000', '#065f46', '#059669', '#10b981']
                        : ['#000000', '#7f1d1d', '#991b1b', '#dc2626']
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.armCareBarFillFull}
                  />
                </Animated.View>
              </View>
            </View>
            <View style={styles.armCareBarValue}>
              <AnimatedBarValue anim={recentBarAnim} maxValue={latest.arm_score} />
              {pr.arm_score > 0 && (
                <Text style={[
                  styles.armCareBarPercentage,
                  { color: latest.arm_score >= pr.arm_score ? '#10b981' : '#dc2626' }
                ]}>
                  {latest.arm_score >= pr.arm_score ? '+' : ''}
                  {(((latest.arm_score - pr.arm_score) / pr.arm_score) * 100).toFixed(1)}%
                </Text>
              )}
            </View>
          </Animated.View>
        </View>

        {/* Strength Section */}
        <Animated.View style={{
          opacity: strengthAnim,
          transform: [{
            translateY: strengthAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            })
          }]
        }}>
          <Text style={styles.metricLabel}>Strength (90d Avg)</Text>
          <View style={styles.strengthBox}>
            <View style={styles.strengthRow}>
              <Text style={styles.strengthLabel}>Total</Text>
              <Text style={styles.strengthValue}>
                {latest.total_strength.toFixed(0)}
                <Text style={styles.strengthUnit}> lbs</Text>
              </Text>
            </View>
            <View style={styles.strengthDivider} />
            <View style={styles.strengthRow}>
              <Text style={styles.strengthLabel}>Average</Text>
              <Text style={styles.strengthValue}>
                {latest.avg_strength_30d.toFixed(0)}
                <Text style={styles.strengthUnit}> lbs</Text>
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

// Animated bar value component
function AnimatedBarValue({ anim, maxValue }: { anim: Animated.Value; maxValue: number }) {
  const [displayValue, setDisplayValue] = React.useState(0);

  useEffect(() => {
    const listener = anim.addListener(({ value }) => {
      setDisplayValue((value / 100) * maxValue);
    });
    return () => anim.removeListener(listener);
  }, [maxValue]);

  return (
    <Text style={styles.armCareBarValueText}>{displayValue.toFixed(1)}</Text>
  );
}

const styles = StyleSheet.create({
  armCareContent: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  armCareLeftColumn: {
    alignItems: 'center',
    gap: 8,
  },
  armCareCircleContainer: {
    width: 176,
    height: 176,
    justifyContent: 'center',
    alignItems: 'center',
  },
  circleGlow: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
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
    fontWeight: '700',
  },
  circleLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  testsCount: {
    alignItems: 'center',
    marginTop: 4,
  },
  testsCountLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  testsCountValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  armCareMetrics: {
    flex: 1,
    gap: 12,
  },
  armCareSection: {
    gap: 8,
  },
  armCareSectionTitle: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 1,
    fontWeight: '600',
  },
  armCareBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  armCareBarLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
    width: 32,
    fontWeight: '600',
  },
  armCareBarContainer: {
    flex: 1,
  },
  armCareBarBg: {
    height: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  armCareBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  armCareBarFillFull: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
  },
  armCareBarValue: {
    alignItems: 'flex-end',
    minWidth: 50,
  },
  armCareBarValueText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  armCareBarPercentage: {
    fontSize: 10,
    fontWeight: '600',
  },
  metricLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },
  strengthBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 12,
  },
  strengthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  strengthLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  strengthValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  strengthUnit: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  strengthDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 8,
  },
});
