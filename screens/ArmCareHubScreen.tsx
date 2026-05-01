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
import Svg, { Circle, Path, Line } from 'react-native-svg';
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

// `testInstanceId` is optional and only present when the hub is opened
// from a coach-prescribed test card on the dashboard. We hold onto it
// here and forward it to the wizard when the athlete taps Start Exam, so
// the wizard can stamp `completed_session_id` back onto that row after
// saving.
type RouteParams = { athleteId?: string; testInstanceId?: string };

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
  const testInstanceId = params.testInstanceId;
  const [recent, setRecent] = useState<ArmCareSession[]>([]);
  const last = recent[0] ?? null;
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
      // Pull up to the 10 most recent sessions: index 0 drives the hero,
      // the rest power the ArmScore sparkline below it.
      const { data } = await supabase
        .from('armcare_sessions')
        .select(
          'id, exam_date, exam_time, arm_score, total_strength, weight_lbs, velo, svr, irtarm_max_lbs, ertarm_max_lbs, starm_max_lbs, gtarm_max_lbs, fresh_arm_feels',
        )
        .eq('athlete_id', athleteId)
        .order('exam_date', { ascending: false })
        .order('exam_time', { ascending: false })
        .limit(10);
      setRecent((data ?? []) as ArmCareSession[]);
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
          {/* Hero — borderless, sits on the canvas */}
          <Hero last={last} loading={loading} zones={zones} />

          {/* Quick stats — naked numbers in a row, no card, hairline above */}
          {last && (
            <>
              <View style={styles.sectionRule} />
              <View style={styles.statRow}>
                <StatNaked
                  label="ER : IR"
                  value={erIr != null ? erIr.toFixed(2) : '–'}
                  color={colorFor(zones.erIr)}
                />
                <StatNaked
                  label="Total"
                  value={
                    last.total_strength != null
                      ? `${Math.round(last.total_strength)}`
                      : '–'
                  }
                  unit="lbs"
                  color={colorFor(zones.total)}
                />
                <StatNaked
                  label="SVR"
                  value={last.svr != null ? last.svr.toFixed(2) : '–'}
                  color={colorFor(zones.svr)}
                />
              </View>
              <ZoneKey />
            </>
          )}

          {/* ArmScore sparkline — only renders when we have ≥2 sessions */}
          {recent.filter((s) => s.arm_score != null).length >= 2 && (
            <>
              <View style={styles.sectionRule} />
              <View style={styles.trendHeader}>
                <Text style={styles.trendEyebrow}>RECENT ARMSCORES</Text>
                <Text style={styles.trendCount}>
                  Last {recent.filter((s) => s.arm_score != null).length}
                </Text>
              </View>
              <ArmScoreSparkline sessions={recent} />
            </>
          )}

          {/* View history — naked row, hairline above */}
          <View style={styles.sectionRule} />
          <Pressable
            onPress={() =>
              athleteId && navigation.navigate('ArmCare', { athleteId })
            }
            android_ripple={{ color: 'rgba(255,255,255,0.04)' }}
          >
            {({ pressed }) => (
              <View
                style={[
                  styles.viewHistoryRow,
                  pressed && { opacity: 0.55 },
                ]}
              >
                <Ionicons name="trending-up" size={18} color={ACCENT} />
                <View style={styles.viewHistoryText}>
                  <Text style={styles.viewHistoryTitle}>View Full History</Text>
                  <Text style={styles.viewHistorySubtitle}>
                    Trends, recovery, ER/IR, SVR over time
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#4b5563" />
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
              athleteId &&
              navigation.navigate('ArmCareWizard', {
                athleteId,
                ...(testInstanceId ? { testInstanceId } : {}),
              })
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
// Hero — borderless ArmScore ring + meta + 4 naked peak readouts.
// Sits on the page background (no card surface).
// ─────────────────────────────────────────────────────────────

function Hero({
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
      <View style={styles.heroEmptyWrap}>
        <Text style={styles.heroEmpty}>Loading…</Text>
      </View>
    );
  }

  if (!last) {
    return (
      <View style={styles.heroEmptyWrap}>
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
      {/* Big ArmScore ring */}
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

      {/* 4-test peaks — naked, evenly spaced */}
      <View style={styles.peakRow}>
        <PeakNaked label="IR" lbf={peaks.ir} color={colorFor(zones.ir)} />
        <PeakNaked label="ER" lbf={peaks.er} color={colorFor(zones.er)} />
        <PeakNaked label="SCAP" lbf={peaks.scap} color={colorFor(zones.scap)} />
        <PeakNaked label="GRIP" lbf={peaks.grip} color={colorFor(zones.grip)} />
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
// PeakNaked — naked per-test peak readout (no card / border).
// ─────────────────────────────────────────────────────────────

function PeakNaked({
  label,
  lbf,
  color,
}: {
  label: string;
  lbf: number;
  color: string;
}) {
  return (
    <View style={styles.peakNaked}>
      <Text style={styles.peakLabel}>{label}</Text>
      <Text style={[styles.peakValue, { color }]}>
        {lbf > 0 ? lbf.toFixed(0) : '–'}
      </Text>
      <Text style={styles.peakUnit}>lbs</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// ArmScoreSparkline — tiny SVG line chart of recent ArmScores.
// Uses the same red accent as the rest of the hub. Sessions are
// passed in newest-first; we reverse for the x-axis so time runs
// left → right.
// ─────────────────────────────────────────────────────────────

function ArmScoreSparkline({ sessions }: { sessions: ArmCareSession[] }) {
  // Filter out sessions without an arm_score so we don't plot zeros.
  const points = sessions
    .filter((s) => s.arm_score != null)
    .map((s) => Number(s.arm_score))
    .reverse(); // oldest → newest

  if (points.length < 2) return null;

  const W = 320;
  const H = 96;
  const PAD_X = 8;
  const PAD_Y = 12;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  const minV = Math.min(...points);
  const maxV = Math.max(...points);
  // Add a small bottom/top buffer so the line never sits exactly on
  // the chart edges (looks pinched otherwise).
  const range = Math.max(1, maxV - minV);
  const yMin = minV - range * 0.15;
  const yMax = maxV + range * 0.15;
  const yRange = Math.max(1, yMax - yMin);

  const xFor = (i: number) =>
    PAD_X + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yFor = (v: number) => PAD_Y + innerH - ((v - yMin) / yRange) * innerH;

  // Cubic-ish smooth path using midpoint method (no external lib).
  let d = `M ${xFor(0)} ${yFor(points[0])}`;
  for (let i = 1; i < points.length; i++) {
    const x0 = xFor(i - 1);
    const y0 = yFor(points[i - 1]);
    const x1 = xFor(i);
    const y1 = yFor(points[i]);
    const cx = (x0 + x1) / 2;
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
  }

  const lastIdx = points.length - 1;

  return (
    <View style={styles.sparklineWrap}>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* Hairline mid-rule for visual reference */}
        <Line
          x1={PAD_X}
          y1={H / 2}
          x2={W - PAD_X}
          y2={H / 2}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={1}
        />
        {/* Trend line */}
        <Path d={d} stroke={ACCENT} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Per-session dots */}
        {points.map((v, i) => (
          <Circle
            key={i}
            cx={xFor(i)}
            cy={yFor(v)}
            r={i === lastIdx ? 3.5 : 2}
            fill={i === lastIdx ? ACCENT : '#0A0A0A'}
            stroke={ACCENT}
            strokeWidth={i === lastIdx ? 0 : 1.5}
          />
        ))}
      </Svg>
      <View style={styles.sparklineMetaRow}>
        <Text style={styles.sparklineMeta}>min {Math.round(minV)}</Text>
        <Text style={styles.sparklineMeta}>max {Math.round(maxV)}</Text>
      </View>
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
// StatNaked — flex column on the canvas (no card / border).
// ─────────────────────────────────────────────────────────────

function StatNaked({
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
    <View style={styles.statNaked}>
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

  // Hero sits naked on the canvas — no fill, no border.
  hero: {
    marginTop: 24,
    alignItems: 'center',
  },
  heroEmptyWrap: {
    marginTop: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
  scoreNumber: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '800',
    letterSpacing: -2,
    lineHeight: 60,
  },
  peakRow: {
    flexDirection: 'row',
    width: '100%',
    paddingHorizontal: 4,
    gap: 8,
    marginTop: 26,
  },
  peakNaked: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
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
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  peakUnit: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
  },

  // Hairline used between sections instead of card boundaries.
  sectionRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 24,
    marginBottom: 18,
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
  },
  statNaked: {
    flex: 1,
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
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  statUnit: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
  },

  trendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  trendEyebrow: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  trendCount: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
  },
  sparklineWrap: {
    width: '100%',
  },
  sparklineMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: 4,
  },
  sparklineMeta: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
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

  viewHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 12,
  },
  viewHistoryText: { flex: 1, minWidth: 0 },
  viewHistoryTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  viewHistorySubtitle: { color: '#6b7280', fontSize: 11, marginTop: 2 },
});
