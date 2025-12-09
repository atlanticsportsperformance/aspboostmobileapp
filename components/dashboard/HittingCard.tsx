import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';

interface HittingData {
  prs: {
    bat_speed?: { value: number; date: string };
    exit_velocity?: { value: number; date: string };
    distance?: { value: number; date: string };
  };
  latest: {
    bat_speed?: number;
    exit_velocity?: number;
    distance?: number;
    timestamp?: string;
  };
}

interface HittingCardProps {
  data: HittingData;
}

export default function HittingCard({ data, isActive = true }: HittingCardProps & { isActive?: boolean }) {
  const { prs, latest } = data;

  // Animation values for each metric
  const batSpeedPrAnim = useRef(new Animated.Value(0)).current;
  const batSpeedRecentAnim = useRef(new Animated.Value(0)).current;
  const exitVeloPrAnim = useRef(new Animated.Value(0)).current;
  const exitVeloRecentAnim = useRef(new Animated.Value(0)).current;
  const distancePrAnim = useRef(new Animated.Value(0)).current;
  const distanceRecentAnim = useRef(new Animated.Value(0)).current;

  // Fade and slide anims for sections
  const section1Anim = useRef(new Animated.Value(0)).current;
  const section2Anim = useRef(new Animated.Value(0)).current;
  const section3Anim = useRef(new Animated.Value(0)).current;

  // Track if animation has already run to prevent re-triggering on parent re-renders
  const hasAnimated = useRef(false);

  // Calculate target widths
  const batSpeedPrWidth = prs.bat_speed ? Math.min(100, (prs.bat_speed.value / 100) * 100) : 0;
  const batSpeedRecentWidth = Math.min(100, ((latest.bat_speed || 0) / 100) * 100);
  const exitVeloPrWidth = prs.exit_velocity ? Math.min(100, (prs.exit_velocity.value / 130) * 100) : 0;
  const exitVeloRecentWidth = Math.min(100, ((latest.exit_velocity || 0) / 130) * 100);
  const distancePrWidth = prs.distance ? Math.min(100, (prs.distance.value / 450) * 100) : 0;
  const distanceRecentWidth = Math.min(100, ((latest.distance || 0) / 450) * 100);

  // Reset hasAnimated when card becomes inactive (swiped away)
  // This allows animation to replay when user swipes back to this card
  useEffect(() => {
    if (!isActive) {
      hasAnimated.current = false;
    }
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;

    // Only animate once per active cycle - prevents re-triggering on parent re-renders
    if (hasAnimated.current) return;
    hasAnimated.current = true;

    // Reset all animations
    batSpeedPrAnim.setValue(0);
    batSpeedRecentAnim.setValue(0);
    exitVeloPrAnim.setValue(0);
    exitVeloRecentAnim.setValue(0);
    distancePrAnim.setValue(0);
    distanceRecentAnim.setValue(0);
    section1Anim.setValue(0);
    section2Anim.setValue(0);
    section3Anim.setValue(0);

    // Section fade-in animations (staggered, slower)
    Animated.stagger(200, [
      Animated.timing(section1Anim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(section2Anim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(section3Anim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // Bat Speed bars with spring (slower, more dramatic)
    if (prs.bat_speed) {
      Animated.spring(batSpeedPrAnim, {
        toValue: batSpeedPrWidth,
        delay: 300,
        friction: 8,
        tension: 25,
        useNativeDriver: false,
      }).start();

      Animated.spring(batSpeedRecentAnim, {
        toValue: batSpeedRecentWidth,
        delay: 550,
        friction: 8,
        tension: 25,
        useNativeDriver: false,
      }).start();
    }

    // Exit Velocity bars with spring (slower)
    if (prs.exit_velocity) {
      Animated.spring(exitVeloPrAnim, {
        toValue: exitVeloPrWidth,
        delay: 700,
        friction: 8,
        tension: 25,
        useNativeDriver: false,
      }).start();

      Animated.spring(exitVeloRecentAnim, {
        toValue: exitVeloRecentWidth,
        delay: 950,
        friction: 8,
        tension: 25,
        useNativeDriver: false,
      }).start();
    }

    // Distance bars with spring (slower)
    if (prs.distance) {
      Animated.spring(distancePrAnim, {
        toValue: distancePrWidth,
        delay: 1100,
        friction: 8,
        tension: 25,
        useNativeDriver: false,
      }).start();

      Animated.spring(distanceRecentAnim, {
        toValue: distanceRecentWidth,
        delay: 1350,
        friction: 8,
        tension: 25,
        useNativeDriver: false,
      }).start();
    }
  }, [isActive]);

  return (
    <View style={styles.hittingContent}>
      {/* Bat Speed */}
      {prs.bat_speed && (
        <Animated.View style={[styles.hittingSection, {
          opacity: section1Anim,
          transform: [{
            translateX: section1Anim.interpolate({
              inputRange: [0, 1],
              outputRange: [-20, 0],
            })
          }]
        }]}>
          <Text style={styles.hittingSectionTitle}>Bat Speed</Text>

          {/* PR Bar */}
          <View style={styles.progressBarRow}>
            <Text style={styles.progressLabel}>ALL-TIME BEST</Text>
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBg}>
                <Animated.View style={[styles.progressBarFill, {
                  width: batSpeedPrAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: '#ef4444'
                }]} />
              </View>
            </View>
            <View style={styles.progressValueContainer}>
              <Text style={[styles.progressValue, { color: '#fca5a5' }]}>
                {prs.bat_speed.value.toFixed(1)}
                <Text style={styles.progressUnit}> mph</Text>
              </Text>
              <Text style={styles.progressDate}>
                {new Date(prs.bat_speed.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
            </View>
          </View>

          {/* Recent Bar */}
          <View style={styles.progressBarRow}>
            <Text style={styles.progressLabel}>
              {latest.timestamp ? new Date(latest.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : 'MOST RECENT'}
            </Text>
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBg}>
                <Animated.View style={[styles.progressBarFill, {
                  width: batSpeedRecentAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: (latest.bat_speed || 0) >= prs.bat_speed.value ? '#10b981' : '#dc2626'
                }]} />
              </View>
            </View>
            <View style={styles.progressValueContainer}>
              <Text style={styles.progressValue}>
                {(latest.bat_speed || 0).toFixed(1)}
                <Text style={styles.progressUnit}> mph</Text>
              </Text>
              {latest.bat_speed && prs.bat_speed.value > 0 && (
                <Text style={[styles.progressPercentage, {
                  color: latest.bat_speed >= prs.bat_speed.value ? '#6ee7b7' : '#fca5a5'
                }]}>
                  {latest.bat_speed >= prs.bat_speed.value ? '+' : ''}
                  {(((latest.bat_speed - prs.bat_speed.value) / prs.bat_speed.value) * 100).toFixed(1)}%
                </Text>
              )}
            </View>
          </View>
        </Animated.View>
      )}

      {/* Exit Velocity */}
      {prs.exit_velocity && (
        <Animated.View style={[styles.hittingSection, {
          opacity: section2Anim,
          transform: [{
            translateX: section2Anim.interpolate({
              inputRange: [0, 1],
              outputRange: [-20, 0],
            })
          }]
        }]}>
          <Text style={styles.hittingSectionTitle}>Exit Velocity</Text>

          {/* PR Bar */}
          <View style={styles.progressBarRow}>
            <Text style={styles.progressLabel}>ALL-TIME BEST</Text>
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBg}>
                <Animated.View style={[styles.progressBarFill, {
                  width: exitVeloPrAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: '#f97316'
                }]} />
              </View>
            </View>
            <View style={styles.progressValueContainer}>
              <Text style={[styles.progressValue, { color: '#fb923c' }]}>
                {prs.exit_velocity.value.toFixed(1)}
                <Text style={styles.progressUnit}> mph</Text>
              </Text>
              <Text style={styles.progressDate}>
                {new Date(prs.exit_velocity.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
            </View>
          </View>

          {/* Recent Bar */}
          <View style={styles.progressBarRow}>
            <Text style={styles.progressLabel}>
              {latest.timestamp ? new Date(latest.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : 'MOST RECENT'}
            </Text>
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBg}>
                <Animated.View style={[styles.progressBarFill, {
                  width: exitVeloRecentAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: (latest.exit_velocity || 0) >= prs.exit_velocity.value ? '#10b981' : '#dc2626'
                }]} />
              </View>
            </View>
            <View style={styles.progressValueContainer}>
              <Text style={styles.progressValue}>
                {(latest.exit_velocity || 0).toFixed(1)}
                <Text style={styles.progressUnit}> mph</Text>
              </Text>
              {latest.exit_velocity && prs.exit_velocity.value > 0 && (
                <Text style={[styles.progressPercentage, {
                  color: latest.exit_velocity >= prs.exit_velocity.value ? '#6ee7b7' : '#fca5a5'
                }]}>
                  {latest.exit_velocity >= prs.exit_velocity.value ? '+' : ''}
                  {(((latest.exit_velocity - prs.exit_velocity.value) / prs.exit_velocity.value) * 100).toFixed(1)}%
                </Text>
              )}
            </View>
          </View>
        </Animated.View>
      )}

      {/* Distance */}
      {prs.distance && (
        <Animated.View style={[styles.hittingSection, {
          opacity: section3Anim,
          transform: [{
            translateX: section3Anim.interpolate({
              inputRange: [0, 1],
              outputRange: [-20, 0],
            })
          }]
        }]}>
          <Text style={styles.hittingSectionTitle}>Distance</Text>

          {/* PR Bar */}
          <View style={styles.progressBarRow}>
            <Text style={styles.progressLabel}>ALL-TIME BEST</Text>
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBg}>
                <Animated.View style={[styles.progressBarFill, {
                  width: distancePrAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: '#eab308'
                }]} />
              </View>
            </View>
            <View style={styles.progressValueContainer}>
              <Text style={[styles.progressValue, { color: '#facc15' }]}>
                {Math.round(prs.distance.value)}
                <Text style={styles.progressUnit}> ft</Text>
              </Text>
              <Text style={styles.progressDate}>
                {new Date(prs.distance.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
            </View>
          </View>

          {/* Recent Bar */}
          <View style={styles.progressBarRow}>
            <Text style={styles.progressLabel}>
              {latest.timestamp ? new Date(latest.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : 'MOST RECENT'}
            </Text>
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBg}>
                <Animated.View style={[styles.progressBarFill, {
                  width: distanceRecentAnim.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: (latest.distance || 0) >= prs.distance.value ? '#10b981' : '#dc2626'
                }]} />
              </View>
            </View>
            <View style={styles.progressValueContainer}>
              <Text style={styles.progressValue}>
                {Math.round(latest.distance || 0)}
                <Text style={styles.progressUnit}> ft</Text>
              </Text>
              {latest.distance && prs.distance.value > 0 && (
                <Text style={[styles.progressPercentage, {
                  color: latest.distance >= prs.distance.value ? '#6ee7b7' : '#fca5a5'
                }]}>
                  {latest.distance >= prs.distance.value ? '+' : ''}
                  {(((latest.distance - prs.distance.value) / prs.distance.value) * 100).toFixed(1)}%
                </Text>
              )}
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hittingContent: {
    flex: 1,
    gap: 8,
    paddingVertical: 0,
  },
  hittingSection: {
    marginBottom: 0,
  },
  hittingSectionTitle: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '700',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  progressBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  progressLabel: {
    fontSize: 8,
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
    width: 58,
  },
  progressBarContainer: {
    flex: 1,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 60,
    justifyContent: 'flex-end',
  },
  progressValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  progressUnit: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
  },
  progressDate: {
    fontSize: 8,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  progressPercentage: {
    fontSize: 10,
    fontWeight: '700',
  },
});
