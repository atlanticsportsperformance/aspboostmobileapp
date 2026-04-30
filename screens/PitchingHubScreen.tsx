/**
 * PitchingHubScreen — landing page for anything pitching-related.
 *
 * Opened when the user taps "Pitching" in the FAB. Shows two large option
 * cards: Performance (data / trackman / stuff+) and Workload (throwing
 * workload, ACWR, daily targets). Workload is gated on active membership
 * since it's powered by the Motus Pulse sensor subscription.
 *
 * Design goals: feel like a premium feature-pick screen (think DraftKings
 * "Pick your sport"). Big icon marks, radial glow behind each card, data
 * chips that preview what's inside, tap-scale feedback.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { useAthleteLifecycle } from '../lib/useAthleteLifecycle';

type RouteParams = { athleteId?: string };

export default function PitchingHubScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const params = (route.params ?? {}) as RouteParams;
  const { isMember } = useAthleteLifecycle();

  const [athleteId, setAthleteId] = useState<string | null>(params.athleteId ?? null);
  const [prVelo, setPrVelo] = useState<number | null>(null);
  const [todayW, setTodayW] = useState<number | null>(null);
  const [todayThrows, setTodayThrows] = useState<number>(0);
  const [lastArmScore, setLastArmScore] = useState<number | null>(null);
  const [lastArmExamDate, setLastArmExamDate] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(slideAnim, { toValue: 0, duration: 420, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();
  }, []);

  // Resolve athleteId from user if not passed in (so nav calls stay simple).
  useEffect(() => {
    if (athleteId) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('athletes')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data?.id) setAthleteId(data.id);
    })();
  }, [athleteId]);

  // Fetch the two hero stats. Single queries; fail silently.
  useEffect(() => {
    if (!athleteId) return;
    (async () => {
      const todayIso = new Date().toISOString().split('T')[0];
      const [pr, today, lastArm] = await Promise.all([
        supabase
          .from('trackman_pitch_data')
          .select('rel_speed')
          .eq('athlete_id', athleteId)
          .order('rel_speed', { ascending: false })
          .limit(1),
        supabase
          .from('pulse_daily_workload')
          .select('w_day, throw_count')
          .eq('athlete_id', athleteId)
          .eq('training_date', todayIso)
          .maybeSingle(),
        supabase
          .from('armcare_sessions')
          .select('arm_score, exam_date')
          .eq('athlete_id', athleteId)
          .not('arm_score', 'is', null)
          .order('exam_date', { ascending: false })
          .order('exam_time', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (pr.data?.[0]?.rel_speed) setPrVelo(Number(pr.data[0].rel_speed));
      if (today.data) {
        setTodayW(today.data.w_day != null ? Number(today.data.w_day) : null);
        setTodayThrows(today.data.throw_count ?? 0);
      }
      if (lastArm.data?.arm_score != null) {
        setLastArmScore(Number(lastArm.data.arm_score));
        setLastArmExamDate(lastArm.data.exam_date ?? null);
      }
    })();
  }, [athleteId]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.5 }]}
          >
            <Ionicons name="chevron-back" size={22} color="#9ca3af" />
          </Pressable>
          <View style={styles.eyebrowBadge}>
            <Ionicons name="flash" size={11} color="#9BDDFF" />
            <Text style={styles.eyebrowText}>PITCHING</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Hero title */}
          <Text style={styles.title}>Your <Text style={styles.titleAccent}>arm.</Text></Text>
          <Text style={styles.subtitle}>What are we doing today?</Text>

          {/* Option cards */}
          <HubCard
            accent="#9BDDFF"
            accentDeep="#38BDF8"
            icon={<MaterialCommunityIcons name="baseball" size={28} color="#9BDDFF" />}
            eyebrow="DATA"
            title="Performance"
            subtitle="Velocity, Stuff+, command, session trends"
            stat={prVelo != null ? `${prVelo.toFixed(1)} mph · PR` : 'Trackman data'}
            onPress={() =>
              athleteId && navigation.navigate('PitchingPerformance', { athleteId })
            }
          />

          {isMember && (
            <HubCard
              accent="#34D399"
              accentDeep="#10B981"
              icon={<Ionicons name="pulse" size={28} color="#34D399" />}
              eyebrow="TRAIN"
              title="Workload"
              subtitle="Pulse sensor · ACWR · daily targets"
              stat={
                todayW != null
                  ? `${todayW.toFixed(1)} W today · ${todayThrows} throws`
                  : todayThrows > 0
                    ? `${todayThrows} throws today`
                    : 'Connect your Pulse to start'
              }
              onPress={() => navigation.navigate('Workload')}
            />
          )}

          {!isMember && (
            <View style={styles.membershipHint}>
              <Ionicons name="lock-closed-outline" size={14} color="#6b7280" />
              <Text style={styles.membershipHintText}>
                Workload tracking is a member feature.
              </Text>
            </View>
          )}

          <HubCard
            accent="#F87171"
            accentDeep="#EF4444"
            icon={<MaterialCommunityIcons name="arm-flex" size={28} color="#F87171" />}
            eyebrow="ASSESS"
            title="Arm Care"
            subtitle="Activ5 strength test · ArmScore · ER:IR balance"
            stat={
              lastArmScore != null
                ? `ArmScore ${lastArmScore.toFixed(0)}${lastArmExamDate ? ' · ' + formatRelativeDate(lastArmExamDate) : ''}`
                : 'Take your first test'
            }
            onPress={() =>
              athleteId && navigation.navigate('ArmCareHub', { athleteId })
            }
          />
        </Animated.View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────

function formatRelativeDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (today.getTime() - target.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────
// HubCard — the big option tile
// ─────────────────────────────────────────────────────────────

function HubCard({
  accent,
  accentDeep,
  icon,
  eyebrow,
  title,
  subtitle,
  stat,
  onPress,
}: {
  accent: string;
  accentDeep: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  stat: string;
  onPress: () => void;
}) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const onPressIn = () =>
    Animated.spring(pressScale, { toValue: 0.975, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const onPressOut = () =>
    Animated.spring(pressScale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start();

  return (
    <Animated.View
      style={[
        styles.cardShell,
        {
          transform: [{ scale: pressScale }],
          shadowColor: accent,
        },
      ]}
    >
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
        {/* Radial halo — bleeds under the card */}
        <View style={styles.cardHalo} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id={`halo-${eyebrow}`} cx="15%" cy="50%" r="65%">
                <Stop offset="0%" stopColor={accent} stopOpacity="0.35" />
                <Stop offset="55%" stopColor={accent} stopOpacity="0.08" />
                <Stop offset="100%" stopColor={accent} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle cx="15%" cy="50%" r="65%" fill={`url(#halo-${eyebrow})`} />
          </Svg>
        </View>

        <LinearGradient
          colors={[`${accentDeep}18`, `${accent}08`, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={styles.cardInner}>
          <View style={styles.cardLeft}>
            <View style={[styles.iconWrap, { borderColor: `${accent}44`, backgroundColor: `${accent}14` }]}>
              {icon}
            </View>
          </View>
          <View style={styles.cardMiddle}>
            <View style={[styles.eyebrow, { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}>
              <Text style={[styles.eyebrowTxt, { color: accent }]}>{eyebrow}</Text>
            </View>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardSubtitle}>{subtitle}</Text>
            <View style={styles.statRow}>
              <View style={[styles.statDot, { backgroundColor: accent }]} />
              <Text style={[styles.statText, { color: accent }]}>{stat}</Text>
            </View>
          </View>
          <View style={styles.cardRight}>
            <Ionicons name="chevron-forward" size={22} color={accent} />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 40 },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  eyebrowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(155,221,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.3)',
  },
  eyebrowText: { color: '#9BDDFF', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },

  title: {
    color: '#fff',
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1,
    marginTop: 16,
  },
  titleAccent: { color: '#9BDDFF' },
  subtitle: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 28,
  },

  cardShell: {
    borderRadius: 22,
    marginBottom: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  cardHalo: {
    position: 'absolute',
    inset: 0 as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 14,
  },
  cardLeft: {},
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cardMiddle: { flex: 1, gap: 4 },
  cardRight: { marginLeft: 4 },
  eyebrow: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 4,
  },
  eyebrowTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  cardTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 16,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  statDot: { width: 5, height: 5, borderRadius: 3 },
  statText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  membershipHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  membershipHintText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
});
