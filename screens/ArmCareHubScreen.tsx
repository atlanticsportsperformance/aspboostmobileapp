/**
 * ArmCareHubScreen — landing page for ArmCare on the iOS app.
 *
 * Reached by tapping the "Arm Care" tile on PitchingHubScreen. Shows:
 *  1. Hero card: 4-test radar (last session's throwing-arm peaks) with the
 *     ArmScore in the center.
 *  2. "Start Exam" red CTA → wizard flow.
 *  3. Quick-stat chips: ER:IR ratio, Total Strength, SVR.
 *  4. "View History" secondary action → ArmCareScreen (full history /
 *     trends / zones / recovery).
 *
 * Theme: dark, red accent (#F87171 / #EF4444) matching the brand.
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
import Svg, {
  Circle,
  Defs,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { supabase } from '../lib/supabase';
import {
  armScoreZone,
  colorFor,
  erIrZone,
  peakZone,
  svrZone,
  totalStrengthZone,
  type Zone,
} from '../lib/armcare/zones';

const ACCENT = '#F87171';
const ACCENT_DEEP = '#EF4444';

type RouteParams = { athleteId?: string };

interface ArmCareSession {
  id: string;
  exam_date: string;
  exam_time: string | null;
  arm_score: number | null;
  total_strength: number | null;
  weight_lbs: number | null;
  velo: number | null;
  svr: number | null;
  irtarm_max_lbs: number | null;
  ertarm_max_lbs: number | null;
  starm_max_lbs: number | null;
  gtarm_max_lbs: number | null;
  fresh_arm_feels: string | null;
}

export default function ArmCareHubScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const params = (route.params ?? {}) as RouteParams;

  const [athleteId, setAthleteId] = useState<string | null>(params.athleteId ?? null);
  const [last, setLast] = useState<ArmCareSession | null>(null);
  const [loading, setLoading] = useState(true);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (athleteId) return;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('athletes')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data?.id) setAthleteId(data.id);
    })();
  }, [athleteId]);

  useEffect(() => {
    if (!athleteId) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('armcare_sessions')
        .select(
          'id, exam_date, exam_time, arm_score, total_strength, weight_lbs, velo, svr, irtarm_max_lbs, ertarm_max_lbs, starm_max_lbs, gtarm_max_lbs, fresh_arm_feels',
        )
        .eq('athlete_id', athleteId)
        .order('exam_date', { ascending: false })
        .order('exam_time', { ascending: false })
        .limit(1)
        .maybeSingle();
      setLast((data ?? null) as ArmCareSession | null);
      setLoading(false);
    })();
  }, [athleteId]);

  const erIr = useMemo(() => {
    if (!last?.ertarm_max_lbs || !last?.irtarm_max_lbs) return null;
    return last.ertarm_max_lbs / last.irtarm_max_lbs;
  }, [last]);

  // Composite zone colors for everything on the hub. Bodyweight comes from
  // the saved session row (which the wizard set from the athlete profile).
  const zones = useMemo(() => {
    const bw = last?.weight_lbs ? Number(last.weight_lbs) : 0;
    const num = (n: number | null | undefined) => (n != null ? Number(n) : 0);
    return {
      armScore: armScoreZone(num(last?.arm_score)),
      total: totalStrengthZone(num(last?.total_strength), bw),
      svr: svrZone(num(last?.svr), true),
      erIr: erIrZone(erIr),
      ir: peakZone('ir', num(last?.irtarm_max_lbs), bw),
      er: peakZone('er', num(last?.ertarm_max_lbs), bw),
      scap: peakZone('scap', num(last?.starm_max_lbs), bw),
      grip: peakZone('grip', num(last?.gtarm_max_lbs), bw),
    };
  }, [last, erIr]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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
            <Ionicons name="medical" size={11} color={ACCENT} />
            <Text style={styles.eyebrowText}>ARM CARE</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        <Animated.View
          style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        >
          {/* Hero radar + ArmScore */}
          <HeroCard last={last} loading={loading} zones={zones} />

          {/* Quick stats chips — only if we have a last session */}
          {last && (
            <>
              <View style={styles.statRow}>
                <StatChip
                  label="ER : IR"
                  value={erIr != null ? erIr.toFixed(2) : '–'}
                  color={colorFor(zones.erIr)}
                />
                <StatChip
                  label="Total"
                  value={
                    last.total_strength != null
                      ? `${Math.round(last.total_strength)}`
                      : '–'
                  }
                  unit="lbs"
                  color={colorFor(zones.total)}
                />
                <StatChip
                  label="SVR"
                  value={last.svr != null ? last.svr.toFixed(2) : '–'}
                  color={colorFor(zones.svr)}
                />
              </View>
              <ZoneKey />
            </>
          )}

          {/* View history secondary — plain View wraps row layout, Pressable
              just owns the touch target so style-function quirks don't drop
              flexDirection. */}
          <Pressable
            onPress={() =>
              athleteId && navigation.navigate('ArmCare', { athleteId })
            }
            android_ripple={{ color: 'rgba(255,255,255,0.06)' }}
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.secondaryAction,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <View style={styles.secondaryIconWrap}>
                  <Ionicons name="trending-up" size={18} color={ACCENT} />
                </View>
                <View style={styles.secondaryTextCol}>
                  <Text style={styles.secondaryTitle} numberOfLines={1}>
                    View History
                  </Text>
                  <Text style={styles.secondarySubtitle} numberOfLines={1}>
                    Trends, recovery, ER/IR, SVR over time
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#6b7280" />
              </View>
            )}
          </Pressable>
        </Animated.View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Sticky footer: primary CTA + caption.
          Outer View carries the shadow (shadows + overflow:hidden conflict).
          LinearGradient IS the button surface; its own flex props center the
          icon + text inline as direct children. No absolute positioning. */}
      <View style={styles.footer}>
        <View style={styles.startBtnShadow}>
          <Pressable
            onPress={() =>
              athleteId && navigation.navigate('ArmCareWizard', { athleteId })
            }
            style={({ pressed }) => [
              styles.startBtnPressTarget,
              pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
            ]}
          >
            <LinearGradient
              colors={[ACCENT, ACCENT_DEEP]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.startBtnGradient}
            >
              <View style={styles.startBtnIconWrap}>
                <Ionicons name="play" size={13} color="#fff" />
              </View>
              <Text style={styles.startBtnText}>
                {last ? 'Start Exam' : 'Start Your First Exam'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
        <Text style={styles.ctaCaption}>
          Connect your Activ5 sensor and run the 4 strength tests.
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// HeroCard — radar + ArmScore center
// ─────────────────────────────────────────────────────────────

function HeroCard({
  last,
  loading,
  zones,
}: {
  last: ArmCareSession | null;
  loading: boolean;
  zones: {
    armScore: Zone;
    ir: Zone;
    er: Zone;
    scap: Zone;
    grip: Zone;
  };
}) {
  if (loading) {
    return (
      <View style={[styles.hero, { alignItems: 'center', justifyContent: 'center', height: 360 }]}>
        <Text style={styles.heroEmpty}>Loading…</Text>
      </View>
    );
  }

  if (!last) {
    return (
      <View style={[styles.hero, { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }]}>
        <View style={[styles.iconWrap, { borderColor: `${ACCENT}44`, backgroundColor: `${ACCENT}14` }]}>
          <MaterialCommunityIcons name="arm-flex" size={28} color={ACCENT} />
        </View>
        <Text style={styles.heroTitle}>No tests yet</Text>
        <Text style={styles.heroEmpty}>
          Run your first ArmCare exam to see your shoulder strength profile.
        </Text>
      </View>
    );
  }

  const peaks = {
    ir: Number(last.irtarm_max_lbs ?? 0),
    er: Number(last.ertarm_max_lbs ?? 0),
    scap: Number(last.starm_max_lbs ?? 0),
    grip: Number(last.gtarm_max_lbs ?? 0),
  };
  const armScore = Math.round(Number(last.arm_score ?? 0));

  return (
    <View style={styles.hero}>
      {/* Soft red glow behind the score ring */}
      <View style={styles.heroGlow} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="hero-glow" cx="50%" cy="32%" r="50%">
              <Stop offset="0%" stopColor={ACCENT} stopOpacity="0.20" />
              <Stop offset="60%" stopColor={ACCENT} stopOpacity="0.05" />
              <Stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="50%" cy="32%" r="50%" fill="url(#hero-glow)" />
        </Svg>
      </View>

      {/* Big ArmScore ring at the top — ring color reflects zone */}
      <ScoreRing armScore={armScore} ringColor={colorFor(zones.armScore)} />
      <Text style={styles.heroCenterCaption}>ARMSCORE</Text>
      <Text style={styles.heroDate}>
        Last test · {formatExamDate(last.exam_date)}
      </Text>
      {last.weight_lbs != null && (
        <Text style={styles.heroBodyweight}>
          Bodyweight {Math.round(Number(last.weight_lbs))} lbs
        </Text>
      )}

      {/* Divider */}
      <View style={styles.heroDivider} />

      {/* 4-test peak grid */}
      <View style={styles.peakGrid}>
        <PeakTile label="IR" lbf={peaks.ir} color={colorFor(zones.ir)} />
        <PeakTile label="ER" lbf={peaks.er} color={colorFor(zones.er)} />
        <PeakTile label="SCAP" lbf={peaks.scap} color={colorFor(zones.scap)} />
        <PeakTile label="GRIP" lbf={peaks.grip} color={colorFor(zones.grip)} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// ScoreRing — large ArmScore number wrapped in a thin red ring
// ─────────────────────────────────────────────────────────────

function ScoreRing({
  armScore,
  ringColor,
}: {
  armScore: number;
  ringColor: string;
}) {
  const SIZE = 168;
  const STROKE = 4;
  const R = SIZE / 2 - STROKE;
  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={SIZE}
        height={SIZE}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {/* Background ring */}
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={STROKE}
          fill="none"
        />
        {/* Active ring — color = zone */}
        <Circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={ringColor}
          strokeOpacity={0.9}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <Text style={styles.scoreNumber}>{armScore}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// PeakTile — one of the 4 per-test peak readouts in the grid
// ─────────────────────────────────────────────────────────────

function PeakTile({
  label,
  lbf,
  color,
}: {
  label: string;
  lbf: number;
  color: string;
}) {
  return (
    <View style={styles.peakTile}>
      <Text style={styles.peakLabel}>{label}</Text>
      <Text style={[styles.peakValue, { color }]}>
        {lbf > 0 ? lbf.toFixed(0) : '–'}
      </Text>
      <Text style={styles.peakUnit}>lbs</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// ZoneKey — small legend so green/amber/red don't read as decoration
// ─────────────────────────────────────────────────────────────

function ZoneKey() {
  return (
    <View style={styles.zoneKey}>
      <View style={styles.zoneKeyItem}>
        <View style={[styles.zoneKeyDot, { backgroundColor: '#34D399' }]} />
        <Text style={styles.zoneKeyLabel}>Normal</Text>
      </View>
      <View style={styles.zoneKeyItem}>
        <View style={[styles.zoneKeyDot, { backgroundColor: '#FBBF24' }]} />
        <Text style={styles.zoneKeyLabel}>Watch</Text>
      </View>
      <View style={styles.zoneKeyItem}>
        <View style={[styles.zoneKeyDot, { backgroundColor: '#F87171' }]} />
        <Text style={styles.zoneKeyLabel}>Warning</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// StatChip
// ─────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
}) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text style={[styles.statValue, color ? { color } : null]}>
          {value}
        </Text>
        {unit && <Text style={styles.statUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────

function formatExamDate(iso: string): string {
  const d = new Date(iso);
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
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
    backgroundColor: `${ACCENT}1F`,
    borderWidth: 1,
    borderColor: `${ACCENT}55`,
  },
  eyebrowText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },

  hero: {
    marginTop: 16,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 6,
  },
  heroEmpty: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  heroCenterCaption: {
    color: '#9ca3af',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontWeight: '800',
    marginTop: 14,
  },
  heroDate: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 6,
  },
  heroBodyweight: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  heroDivider: {
    width: '70%',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 22,
    marginBottom: 18,
  },
  scoreNumber: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '800',
    letterSpacing: -2,
    lineHeight: 60,
  },
  peakGrid: {
    flexDirection: 'row',
    width: '100%',
    paddingHorizontal: 4,
    gap: 8,
  },
  peakTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  peakLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  peakValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  peakUnit: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
  },

  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#0A0A0A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  // Start Exam button — outer wrap holds the shadow (no overflow:hidden so
  // the shadow renders), inner LinearGradient IS the visible button with
  // its own clipped rounded corners. Flex children are inline (no absolute).
  startBtnShadow: {
    alignSelf: 'stretch',
    borderRadius: 18,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  startBtnPressTarget: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  startBtnGradient: {
    height: 56,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  startBtnIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  startBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  ctaCaption: {
    color: '#6b7280',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },

  statRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
  },
  statChip: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  statValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statUnit: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
  },

  zoneKey: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
    marginTop: 12,
  },
  zoneKeyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  zoneKeyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  zoneKeyLabel: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  secondaryAction: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  secondaryIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${ACCENT}14`,
    borderWidth: 1,
    borderColor: `${ACCENT}33`,
    marginRight: 12,
  },
  secondaryTextCol: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  secondaryTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  secondarySubtitle: { color: '#6b7280', fontSize: 11, marginTop: 2 },
});
