/**
 * ArmcareDayCard — coach-prescribed ArmCare test for a specific date,
 * rendered on the athlete's day-view alongside their workout cards.
 *
 * Tapping the card navigates into ArmCareWizardScreen with the
 * testInstanceId param so the wizard can stamp completed_session_id
 * back onto this row when the session saves.
 */

import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

const ACCENT = '#F87171';
const ACCENT_DEEP = '#EF4444';

interface Test {
  id: string;
  scheduled_date: string;
  status: 'not_started' | 'completed' | 'skipped';
  source_type: 'plan' | 'group' | 'one_off' | 'recurring';
  notes: string | null;
  completed_session_id: string | null;
  armcare_sessions: {
    arm_score: number | null;
    total_strength: number | null;
  } | null;
}

interface Props {
  test: Test;
  onPress: () => void;
}

const SOURCE_LABEL: Record<Test['source_type'], string> = {
  plan: 'From plan',
  group: 'From group',
  one_off: 'Coach prescribed',
  recurring: 'Recurring check',
};

export default function ArmcareDayCard({ test, onPress }: Props) {
  const isCompleted = test.status === 'completed';
  const pressScale = useRef(new Animated.Value(1)).current;

  const onPressIn = () =>
    Animated.spring(pressScale, { toValue: 0.985, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const onPressOut = () =>
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();

  return (
    <Animated.View
      style={[
        styles.shell,
        {
          transform: [{ scale: pressScale }],
          shadowColor: ACCENT,
          opacity: isCompleted ? 0.7 : 1,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={isCompleted ? 'View completed ArmCare test' : 'Take ArmCare test'}
      >
        {/* Red glow */}
        <View style={styles.halo} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="ac-card-halo" cx="20%" cy="50%" r="65%">
                <Stop offset="0%" stopColor={ACCENT} stopOpacity="0.30" />
                <Stop offset="55%" stopColor={ACCENT} stopOpacity="0.08" />
                <Stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle cx="20%" cy="50%" r="65%" fill="url(#ac-card-halo)" />
          </Svg>
        </View>

        <LinearGradient
          colors={[`${ACCENT_DEEP}18`, `${ACCENT}08`, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={styles.inner}>
          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="arm-flex" size={24} color={ACCENT} />
          </View>

          <View style={styles.middle}>
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrow}>
                <Ionicons name="medical" size={9} color={ACCENT} />
                <Text style={styles.eyebrowText}>ARM CARE</Text>
              </View>
              <Text style={styles.sourceText}>{SOURCE_LABEL[test.source_type]}</Text>
            </View>
            <Text style={styles.title}>
              {isCompleted ? 'ArmCare check complete' : 'Take ArmCare test'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {test.notes ?? '4 strength tests · ~3 min'}
            </Text>
          </View>

          <View style={styles.right}>
            {isCompleted ? (
              // Show the actual ArmScore on the completed card. Falls back
              // to a "Done" badge if the joined session row isn't loaded
              // (e.g. legacy completed test pre-dating this query).
              test.armcare_sessions?.arm_score != null ? (
                <View style={styles.scoreBlock}>
                  <Text style={styles.scoreNumber}>
                    {Math.round(Number(test.armcare_sessions.arm_score))}
                  </Text>
                  <Text style={styles.scoreLabel}>ArmScore</Text>
                </View>
              ) : (
                <View style={styles.doneBadge}>
                  <Ionicons name="checkmark" size={14} color="#10B981" />
                  <Text style={styles.doneText}>Done</Text>
                </View>
              )
            ) : (
              <View style={styles.startPill}>
                <Text style={styles.startText}>Start</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 22,
    marginBottom: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: `${ACCENT}33`,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
  },
  halo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${ACCENT}14`,
    borderWidth: 1,
    borderColor: `${ACCENT}44`,
  },
  middle: { flex: 1, gap: 4 },
  right: { marginLeft: 6 },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: `${ACCENT}1F`,
    borderWidth: 1,
    borderColor: `${ACCENT}55`,
  },
  eyebrowText: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  sourceText: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '600',
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 2,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
  },
  startPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  startText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.35)',
  },
  doneText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
  },
  // Completed state with score — replaces the generic "Done" badge so the
  // athlete sees the headline outcome inline on the card.
  scoreBlock: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.30)',
    minWidth: 64,
  },
  scoreNumber: {
    color: '#10B981',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  scoreLabel: {
    color: '#10B981',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 1,
  },
});
