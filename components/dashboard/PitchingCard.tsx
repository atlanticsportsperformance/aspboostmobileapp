import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface StuffPlusByPitch {
  pitchType: string;
  stuffPlus: number;
  date: string;
}

interface PitchingData {
  prs: {
    max_velo: { value: number; date: string } | null;
  };
  latest: {
    max_velo: number | null;
    avg_velo_30d: number | null;
    avg_velo_recent: number | null;
    timestamp: string | null;
  };
  stuffPlus: {
    allTimeBest: StuffPlusByPitch[];
    recentSession: StuffPlusByPitch[];
    overallBest: number | null;
    overallRecent: number | null;
  } | null;
}

interface PitchingCardProps {
  data: PitchingData;
}

// Pitch type colors
const PITCH_COLORS: Record<string, string> = {
  'Fastball': '#ef4444',
  'FF': '#ef4444',
  'Slider': '#f59e0b',
  'SL': '#f59e0b',
  'Curveball': '#8b5cf6',
  'CB': '#8b5cf6',
  'CU': '#8b5cf6',
  'Changeup': '#10b981',
  'CH': '#10b981',
  'Cutter': '#3b82f6',
  'FC': '#3b82f6',
  'Sinker': '#ec4899',
  'SI': '#ec4899',
  'Splitter': '#06b6d4',
  'FS': '#06b6d4',
  'Sweeper': '#f97316',
  'SW': '#f97316',
  'Unknown': '#6b7280',
};

const getPitchColor = (pitchType: string): string => {
  return PITCH_COLORS[pitchType] || PITCH_COLORS['Unknown'];
};

const getPitchAbbrev = (pitchType: string): string => {
  const abbrevMap: Record<string, string> = {
    'Fastball': 'FF',
    'Slider': 'SL',
    'Curveball': 'CB',
    'Changeup': 'CH',
    'Cutter': 'FC',
    'Sinker': 'SI',
    'Splitter': 'FS',
    'Sweeper': 'SW',
  };
  return abbrevMap[pitchType] || pitchType.substring(0, 2).toUpperCase();
};

export default function PitchingCard({ data, isActive = true }: PitchingCardProps & { isActive?: boolean }) {
  const { prs, latest, stuffPlus } = data;

  // Animation values
  const section1Anim = useRef(new Animated.Value(0)).current;
  const section2Anim = useRef(new Animated.Value(0)).current;
  const section3Anim = useRef(new Animated.Value(0)).current;

  const maxVeloPrAnim = useRef(new Animated.Value(0)).current;
  const maxVeloRecentAnim = useRef(new Animated.Value(0)).current;
  const avgVelo30dAnim = useRef(new Animated.Value(0)).current;
  const avgVeloRecentAnim = useRef(new Animated.Value(0)).current;

  // Animation for each hash mark
  const hashMarkAnims = useRef<Animated.Value[]>([]).current;

  // Track if animation has already run to prevent re-triggering on parent re-renders
  const hasAnimated = useRef(false);

  // Calculate target widths
  const maxVeloPrWidth = prs.max_velo ? Math.min(100, (prs.max_velo.value / 110) * 100) : 0;
  const maxVeloRecentWidth = latest.max_velo !== null ? Math.min(100, (latest.max_velo / 110) * 100) : 0;
  const avgVelo30dWidth = latest.avg_velo_30d ? Math.min(100, (latest.avg_velo_30d / 110) * 100) : 0;
  const avgVeloRecentWidth = latest.avg_velo_recent !== null ? Math.min(100, (latest.avg_velo_recent / 110) * 100) : 0;

  // Ensure we have enough hash mark animations
  const numHashMarks = stuffPlus?.allTimeBest?.length || 0;
  while (hashMarkAnims.length < numHashMarks) {
    hashMarkAnims.push(new Animated.Value(0));
  }

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
    section1Anim.setValue(0);
    section2Anim.setValue(0);
    section3Anim.setValue(0);
    maxVeloPrAnim.setValue(0);
    maxVeloRecentAnim.setValue(0);
    avgVelo30dAnim.setValue(0);
    avgVeloRecentAnim.setValue(0);
    hashMarkAnims.forEach(anim => anim.setValue(0));

    // Section fade-in animations (slower, more dramatic)
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

    // Max Velocity bars (slower spring, more bounce)
    if (prs.max_velo) {
      Animated.spring(maxVeloPrAnim, {
        toValue: maxVeloPrWidth,
        delay: 300,
        friction: 8,
        tension: 25,
        useNativeDriver: false,
      }).start();

      if (latest.max_velo !== null) {
        Animated.spring(maxVeloRecentAnim, {
          toValue: maxVeloRecentWidth,
          delay: 550,
          friction: 8,
          tension: 25,
          useNativeDriver: false,
        }).start();
      }
    }

    // Avg Velocity bars (slower spring)
    if (latest.avg_velo_30d) {
      Animated.spring(avgVelo30dAnim, {
        toValue: avgVelo30dWidth,
        delay: 700,
        friction: 8,
        tension: 25,
        useNativeDriver: false,
      }).start();

      if (latest.avg_velo_recent !== null) {
        Animated.spring(avgVeloRecentAnim, {
          toValue: avgVeloRecentWidth,
          delay: 950,
          friction: 8,
          tension: 25,
          useNativeDriver: false,
        }).start();
      }
    }

    // Hash marks pop in staggered (more delay between each)
    if (stuffPlus && stuffPlus.allTimeBest.length > 0) {
      hashMarkAnims.slice(0, numHashMarks).forEach((anim, index) => {
        Animated.spring(anim, {
          toValue: 1,
          delay: 1100 + (index * 150),
          friction: 5,
          tension: 50,
          useNativeDriver: true,
        }).start();
      });
    }
  }, [isActive]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Calculate percentage difference between recent and PR
  const getPercentDiff = (recent: number, pr: number) => {
    if (pr === 0) return 0;
    return ((recent - pr) / pr) * 100;
  };

  // Calculate dynamic range for stuff+ slider with 10-point buffer on each side
  const getStuffPlusRange = () => {
    if (!stuffPlus) return { min: 90, max: 110 };

    const allValues = [
      ...stuffPlus.allTimeBest.map(p => p.stuffPlus),
      ...stuffPlus.recentSession.map(p => p.stuffPlus),
    ];

    if (allValues.length === 0) return { min: 90, max: 110 };

    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);

    // Add exactly 10 points buffer on each side, round to nice numbers
    return {
      min: Math.floor((minVal - 10) / 5) * 5,
      max: Math.ceil((maxVal + 10) / 5) * 5,
    };
  };

  const stuffPlusRange = getStuffPlusRange();

  // Calculate position percentage on the slider
  const getPositionPercent = (value: number) => {
    const range = stuffPlusRange.max - stuffPlusRange.min;
    return ((value - stuffPlusRange.min) / range) * 100;
  };

  return (
    <View style={styles.container}>
      {/* Max Velocity Section */}
      <Animated.View style={[styles.metricSection, {
        opacity: section1Anim,
        transform: [{
          translateX: section1Anim.interpolate({
            inputRange: [0, 1],
            outputRange: [-20, 0],
          })
        }]
      }]}>
        <Text style={styles.metricLabel}>Max Velocity</Text>

        {prs.max_velo ? (
          <>
            {/* PR Slider */}
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>All-Time Best</Text>
              <View style={styles.sliderTrackContainer}>
                <View style={styles.sliderTrackBg}>
                  <Animated.View style={{
                    width: maxVeloPrAnim.interpolate({
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
              </View>
              <View style={styles.valueContainer}>
                <Text style={styles.prValue}>{prs.max_velo.value.toFixed(1)}</Text>
                <Text style={styles.unit}>mph</Text>
              </View>
            </View>

            {/* Recent Max Slider */}
            {latest.max_velo !== null && (
              <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>
                  {latest.timestamp ? formatDate(latest.timestamp) : 'Recent'}
                </Text>
                <View style={styles.sliderTrackContainer}>
                  <View style={styles.sliderTrackBg}>
                    <Animated.View style={{
                      width: maxVeloRecentAnim.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0%', '100%'],
                      }),
                      height: '100%',
                      overflow: 'hidden',
                      borderRadius: 999,
                    }}>
                      <LinearGradient
                        colors={
                          latest.max_velo >= prs.max_velo.value
                            ? ['#000000', '#065f46', '#059669', '#10b981']
                            : ['#000000', '#7f1d1d', '#991b1b', '#dc2626']
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.sliderTrackFillFull}
                      />
                    </Animated.View>
                  </View>
                </View>
                <View style={styles.valueContainer}>
                  <Text style={styles.recentValue}>{latest.max_velo.toFixed(1)}</Text>
                  <Text style={styles.unit}>mph</Text>
                  {prs.max_velo.value > 0 && (
                    <Text style={[
                      styles.percentDiff,
                      latest.max_velo >= prs.max_velo.value ? styles.percentPositive : styles.percentNegative
                    ]}>
                      {latest.max_velo >= prs.max_velo.value ? '+' : ''}
                      {getPercentDiff(latest.max_velo, prs.max_velo.value).toFixed(1)}%
                    </Text>
                  )}
                </View>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.noData}>No data available</Text>
        )}
      </Animated.View>

      {/* Average Velocity Section */}
      <Animated.View style={[styles.metricSection, {
        opacity: section2Anim,
        transform: [{
          translateX: section2Anim.interpolate({
            inputRange: [0, 1],
            outputRange: [-20, 0],
          })
        }]
      }]}>
        <Text style={styles.metricLabel}>Avg Velocity</Text>

        {latest.avg_velo_30d ? (
          <>
            {/* 30 Day Average Slider */}
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Last 30 Days</Text>
              <View style={styles.sliderTrackContainer}>
                <View style={styles.sliderTrackBg}>
                  <Animated.View style={{
                    width: avgVelo30dAnim.interpolate({
                      inputRange: [0, 100],
                      outputRange: ['0%', '100%'],
                    }),
                    height: '100%',
                    overflow: 'hidden',
                    borderRadius: 999,
                  }}>
                    <LinearGradient
                      colors={['#000000', '#ea580c', '#f97316', '#fb923c']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.sliderTrackFillFull}
                    />
                  </Animated.View>
                </View>
              </View>
              <View style={styles.valueContainer}>
                <Text style={styles.avgValue}>{latest.avg_velo_30d.toFixed(1)}</Text>
                <Text style={styles.unit}>mph</Text>
              </View>
            </View>

            {/* Recent Session Average */}
            {latest.avg_velo_recent !== null && (
              <View style={styles.sliderRow}>
                <Text style={styles.sliderLabel}>
                  {latest.timestamp ? formatDate(latest.timestamp) : 'Recent'}
                </Text>
                <View style={styles.sliderTrackContainer}>
                  <View style={styles.sliderTrackBg}>
                    <Animated.View style={{
                      width: avgVeloRecentAnim.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0%', '100%'],
                      }),
                      height: '100%',
                      overflow: 'hidden',
                      borderRadius: 999,
                    }}>
                      <LinearGradient
                        colors={['#000000', '#ca8a04', '#eab308', '#facc15']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.sliderTrackFillFull}
                      />
                    </Animated.View>
                  </View>
                </View>
                <View style={styles.valueContainer}>
                  <Text style={styles.recentValue}>{latest.avg_velo_recent.toFixed(1)}</Text>
                  <Text style={styles.unit}>mph</Text>
                </View>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.noData}>No data available</Text>
        )}
      </Animated.View>

      {/* Stuff+ Section - Single slider with all pitches */}
      {stuffPlus && stuffPlus.allTimeBest.length > 0 && (
        <Animated.View style={[styles.stuffPlusSection, {
          opacity: section3Anim,
          transform: [{
            translateY: section3Anim.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            })
          }]
        }]}>
          {/* Header with label and legend */}
          <View style={styles.stuffPlusHeader}>
            <Text style={styles.stuffPlusTitle}>Stuff+</Text>
            <View style={styles.stuffPlusLegend}>
              {stuffPlus.allTimeBest.map((pitch) => (
                <View key={pitch.pitchType} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: getPitchColor(pitch.pitchType) }]} />
                  <Text style={[styles.legendText, { color: getPitchColor(pitch.pitchType) }]}>
                    {getPitchAbbrev(pitch.pitchType)}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Single unified slider track */}
          <View style={styles.stuffPlusSlider}>
            {/* Track background with gradient */}
            <View style={styles.stuffPlusTrack}>
              <LinearGradient
                colors={['#0f172a', '#1e293b', '#334155', '#475569']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.stuffPlusTrackGradient}
              />
              {/* Center line at 100 */}
              <View
                style={[
                  styles.centerLine,
                  { left: `${getPositionPercent(100)}%` }
                ]}
              />
            </View>

            {/* Hash marks for each pitch - All Time Best (top) */}
            {stuffPlus.allTimeBest.map((pitch, index) => {
              const pos = getPositionPercent(pitch.stuffPlus);
              const color = getPitchColor(pitch.pitchType);
              const anim = hashMarkAnims[index];
              return (
                <Animated.View
                  key={`best-${pitch.pitchType}`}
                  style={[styles.hashMarkContainer, {
                    left: `${pos}%`,
                    opacity: anim,
                    transform: [{
                      scale: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 1],
                      })
                    }, {
                      translateY: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [10, 0],
                      })
                    }]
                  }]}
                >
                  {/* Value label above */}
                  <Text style={[styles.hashValue, { color }]}>
                    {Math.round(pitch.stuffPlus)}
                  </Text>
                  {/* Vertical bar */}
                  <View style={[styles.hashBar, { backgroundColor: color }]} />
                  {/* Pitch type below */}
                  <Text style={[styles.hashPitchType, { color }]}>
                    {getPitchAbbrev(pitch.pitchType)}
                  </Text>
                </Animated.View>
              );
            })}

            {/* Min/Max labels */}
            <Text style={styles.rangeMin}>{stuffPlusRange.min}</Text>
            <Text style={styles.rangeMax}>{stuffPlusRange.max}</Text>
          </View>

          {/* Best overall badge */}
          {stuffPlus.overallBest && (
            <View style={styles.bestBadge}>
              <Text style={styles.bestBadgeLabel}>Best</Text>
              <Text style={styles.bestBadgeValue}>{Math.round(stuffPlus.overallBest)}</Text>
            </View>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 10,
  },
  metricSection: {
    gap: 4,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 2,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  sliderLabel: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    width: 70,
  },
  sliderTrackContainer: {
    flex: 1,
  },
  sliderTrackBg: {
    height: 8,
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
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    minWidth: 70,
    justifyContent: 'flex-end',
  },
  prValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f87171',
  },
  avgValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fb923c',
  },
  recentValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  unit: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.5)',
    marginLeft: 2,
  },
  dateText: {
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.4)',
    marginLeft: 4,
  },
  percentDiff: {
    fontSize: 9,
    fontWeight: '600',
    marginLeft: 3,
  },
  percentPositive: {
    color: '#34d399',
  },
  percentNegative: {
    color: '#ef4444',
  },
  noData: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  // Stuff+ Section Styles
  stuffPlusSection: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  stuffPlusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stuffPlusTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
  },
  stuffPlusLegend: {
    flexDirection: 'row',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    fontWeight: '700',
  },
  stuffPlusSlider: {
    height: 50,
    position: 'relative',
    marginHorizontal: 4,
  },
  stuffPlusTrack: {
    position: 'absolute',
    top: 18,
    left: 0,
    right: 0,
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
  },
  stuffPlusTrackGradient: {
    flex: 1,
  },
  centerLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    marginLeft: -1,
  },
  hashMarkContainer: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    width: 36,
    marginLeft: -18,
  },
  hashValue: {
    fontSize: 11,
    fontWeight: '800',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  hashBar: {
    width: 4,
    height: 20,
    borderRadius: 2,
    marginVertical: 2,
  },
  hashPitchType: {
    fontSize: 9,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  rangeMin: {
    position: 'absolute',
    left: -2,
    bottom: -4,
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: '500',
  },
  rangeMax: {
    position: 'absolute',
    right: -2,
    bottom: -4,
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: '500',
  },
  bestBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    marginTop: 8,
  },
  bestBadgeLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bestBadgeValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#9BDDFF',
  },
});
