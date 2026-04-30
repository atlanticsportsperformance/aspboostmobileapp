/**
 * ArmcareDayCard — coach-prescribed ArmCare test for a specific date,
 * rendered on the athlete's day-view alongside their workout cards.
 *
 * Tapping the card navigates into ArmCareWizardScreen with the
 * testInstanceId param so the wizard can stamp completed_session_id
 * back onto this row when the session saves.
 *
 * Editorial row layout: thin colored accent stripe on the left, hairline
 * rule above, compact start pill on the right. No card box / gradient /
 * halo — matches the rest of the dashboard's borderless feed style.
 */

import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const ACCENT = '#F87171';

interface Test {
  id: string;
  scheduled_date: string;
  status: 'not_started' | 'completed' | 'skipped';
  source_type: 'plan' | 'group' | 'one_off' | 'recurring' | 'ad_hoc';
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
  ad_hoc: 'Self-recorded',
};

export default function ArmcareDayCard({ test, onPress }: Props) {
  const isCompleted = test.status === 'completed';
  const pressOpacity = useRef(new Animated.Value(1)).current;

  const onPressIn = () =>
    Animated.timing(pressOpacity, {
      toValue: 0.55,
      duration: 80,
      useNativeDriver: true,
    }).start();
  const onPressOut = () =>
    Animated.timing(pressOpacity, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();

  return (
    <Animated.View style={[styles.row, { opacity: isCompleted ? 0.65 : pressOpacity }]}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={isCompleted ? 'View completed ArmCare test' : 'Take ArmCare test'}
        style={styles.pressable}
      >
        <View style={styles.hairline} />
        <View style={styles.inner}>
          {/* Soft tier-tinted wash that fades to transparent — gives the
              row a faint warm glow without re-introducing a card box. */}
          <LinearGradient
            colors={[`${ACCENT}14`, `${ACCENT}05`, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
          {/* Thin accent stripe on the left replaces the old colored box */}
          <View style={styles.accent} />

          <View style={styles.iconWrap}>
            <MaterialCommunityIcons name="arm-flex" size={18} color={ACCENT} />
          </View>

          <View style={styles.middle}>
            <View style={styles.eyebrowRow}>
              <Text style={styles.eyebrowText}>ARM CARE</Text>
              <Text style={styles.dotSep}>·</Text>
              <Text style={styles.sourceText}>{SOURCE_LABEL[test.source_type]}</Text>
            </View>
            <Text style={styles.title}>
              {isCompleted ? 'ArmCare check complete' : 'Take ArmCare test'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {test.notes ?? '4 strength tests · ~3 min'}
            </Text>
          </View>

          <View style={styles.right}>
            {isCompleted ? (
              test.armcare_sessions?.arm_score != null ? (
                <View style={styles.scoreBlock}>
                  <Text style={styles.scoreNumber}>
                    {Math.round(Number(test.armcare_sessions.arm_score))}
                  </Text>
                  <Text style={styles.scoreLabel}>ArmScore</Text>
                </View>
              ) : (
                <View style={styles.doneBadge}>
                  <Ionicons name="checkmark" size={12} color="#34D399" />
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
  row: {},
  pressable: {},
  hairline: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingRight: 4,
    gap: 12,
  },
  accent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: ACCENT,
    borderRadius: 2,
    marginRight: 4,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${ACCENT}14`,
  },
  middle: { flex: 1, gap: 2 },
  right: { marginLeft: 8 },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  eyebrowText: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  dotSep: { color: '#4b5563', fontSize: 10, fontWeight: '700' },
  sourceText: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '600',
  },
  title: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 11,
    lineHeight: 14,
  },
  startPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  startText: {
    color: '#0A0A0A',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(52,211,153,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.30)',
  },
  doneText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  scoreBlock: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 56,
  },
  scoreNumber: {
    color: '#34D399',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 24,
  },
  scoreLabel: {
    color: '#34D399',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 1,
  },
});
