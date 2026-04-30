/**
 * ArmCareScreen — history + insights view.
 *
 * Reached from the Pitching screen's "Arm Care" inline button (and a few
 * legacy entry points). Shows the athlete's recent ArmCare sessions in
 * trend form, plus a "Can I throw today?" judgment based on the most recent
 * session's zones.
 *
 * Reads only — all writes happen in ArmCareWizardScreen.
 *
 * Sections (top → bottom):
 *   1. Header           — back, athlete name, date range selector
 *   2. Can I throw today? card
 *   3. ArmScore trend   — line chart with green/amber/red bands
 *   4. IR vs ER trend   — peak overlay
 *   5. Shoulder Balance — ER:IR ratio over time, healthy band shaded
 *   6. Recovery card    — latest deltas vs previous session
 *   7. Recent history   — last 10 sessions, compact list
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
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

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  exam_date: string;
  exam_time: string | null;
  arm_score: number | null;
  total_strength: number | null;
  weight_lbs: number | null;
  velo: number | null;
  svr: number | null;
  irtarm_max_lbs: number | null;
  irntarm_max_lbs: number | null;
  ertarm_max_lbs: number | null;
  erntarm_max_lbs: number | null;
  starm_max_lbs: number | null;
  sntarm_max_lbs: number | null;
  gtarm_max_lbs: number | null;
  gntarm_max_lbs: number | null;
  shoulder_balance: number | null;
  fresh_arm_feels: string | null;
}

type DateRange = 30 | 90 | 180 | 0; // 0 = all

const RANGE_OPTIONS: { label: string; value: DateRange }[] = [
  { label: '30D', value: 30 },
  { label: '90D', value: 90 },
  { label: '180D', value: 180 },
  { label: 'All', value: 0 },
];

const ACCENT = '#F87171';

// ─────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────

export default function ArmCareScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const athleteId = route?.params?.athleteId as string | undefined;

  const [athleteName, setAthleteName] = useState<string>('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<DateRange>(90);

  const fetchAll = useCallback(async () => {
    if (!athleteId) return;
    const [profileRes, sessionsRes] = await Promise.all([
      supabase
        .from('athletes')
        .select('first_name, last_name')
        .eq('id', athleteId)
        .maybeSingle(),
      supabase
        .from('armcare_sessions')
        .select(
          'id, exam_date, exam_time, arm_score, total_strength, weight_lbs, velo, svr, irtarm_max_lbs, irntarm_max_lbs, ertarm_max_lbs, erntarm_max_lbs, starm_max_lbs, sntarm_max_lbs, gtarm_max_lbs, gntarm_max_lbs, shoulder_balance, fresh_arm_feels',
        )
        .eq('athlete_id', athleteId)
        .order('exam_date', { ascending: false })
        .order('exam_time', { ascending: false })
        .limit(200),
    ]);
    const p = profileRes.data;
    if (p) {
      setAthleteName(`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim());
    }
    setSessions((sessionsRes.data ?? []) as SessionRow[]);
  }, [athleteId]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        await fetchAll();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  }, [fetchAll]);

  // ─── Derived: filter sessions to the selected range ───
  const filtered = useMemo(() => {
    if (range === 0) return sessions;
    const cutoff = new Date(Date.now() - range * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return sessions.filter((s) => s.exam_date >= cutoff);
  }, [sessions, range]);

  // Sessions in chronological order for the trend charts (oldest → newest).
  const chronological = useMemo(
    () => [...filtered].reverse(),
    [filtered],
  );
  const latest = sessions[0] ?? null;
  const previous = sessions[1] ?? null;

  if (!athleteId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Text style={styles.bodyText}>No athlete selected.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />
        }
      >
        <Header
          athleteName={athleteName}
          range={range}
          setRange={setRange}
          onBack={() => navigation.goBack()}
        />

        {loading && sessions.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={ACCENT} />
          </View>
        ) : sessions.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Hero analysis card + sub-tabs — modeled on the official ArmCare
                app's STRENGTH tab. Big ring with the 70 goal pip, bodyweight
                +  total strength split below, then SVR / Arm Strength /
                Shoulder Balance sub-tabs. */}
            <HeroAnalysisCard latest={latest} />
            <AnalysisTabs latest={latest} />

            <CanIThrowCard latest={latest} previous={previous} />
            <ArmScoreTrendCard sessions={chronological} />
            <IrErTrendCard sessions={chronological} />
            <ShoulderBalanceTrendCard sessions={chronological} />
            <RecoveryCard latest={latest} previous={previous} />
            <RecentHistoryList sessions={filtered.slice(0, 10)} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────

function Header({
  athleteName,
  range,
  setRange,
  onBack,
}: {
  athleteName: string;
  range: DateRange;
  setRange: (r: DateRange) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.headerWrap}>
      <View style={styles.headerTop}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#9ca3af" />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>Arm Care</Text>
      {athleteName ? (
        <Text style={styles.subtitle}>{athleteName}</Text>
      ) : null}

      <View style={styles.rangeRow}>
        {RANGE_OPTIONS.map((opt) => {
          const active = opt.value === range;
          return (
            <Pressable
              key={opt.value}
              onPress={() => setRange(opt.value)}
              style={[styles.rangeChip, active && styles.rangeChipActive]}
            >
              <Text
                style={[styles.rangeChipText, active && styles.rangeChipTextActive]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Hero analysis ring — modeled on the ArmCare app's STRENGTH tab:
// big circular ArmScore with a 70-goal pip, plus a Total Strength /
// Bodyweight footer split. The ring stroke color reflects the ArmScore zone.
// ─────────────────────────────────────────────────────────────────────────

const RING_GOAL = 70;  // ArmScore "normal" threshold from the report glossary
const RING_MAX = 100;  // Ring is calibrated to 100. >100 draws a thin overflow arc.

function HeroAnalysisCard({ latest }: { latest: SessionRow | null }) {
  if (!latest) return null;

  const armScore = latest.arm_score != null ? Number(latest.arm_score) : 0;
  const total = latest.total_strength != null ? Number(latest.total_strength) : null;
  const bw = latest.weight_lbs != null ? Number(latest.weight_lbs) : null;
  const z = armScoreZone(armScore || null);

  // SVG canvas is wider than the ring so the outer "70 / Goal" callout has
  // room to sit fully outside the stroke without being clipped.
  const SVG_SIZE = 280;
  const ringSize = 220;
  const stroke = 12;
  const r = (ringSize - stroke) / 2;
  const cx = SVG_SIZE / 2;
  const cy = SVG_SIZE / 2;
  const circumference = 2 * Math.PI * r;

  // Calibrated to 100. Anything above 100 spawns a thin inset overflow arc.
  const mainPct = Math.min(1, Math.max(0, armScore / RING_MAX));
  const overflowPct = armScore > RING_MAX
    ? Math.min(1, (armScore - RING_MAX) / RING_MAX)
    : 0;
  const mainDashOffset = circumference * (1 - mainPct);

  // Goal indicator at 70/100 = 70% around clockwise from 12 o'clock.
  // 0% = top (-90°), 25% = right (0°), 50% = bottom (90°), 75% = left (180°).
  // 70% lands at -90° + 252° = 162°  → lower-left, ~7:30 position.
  const goalAngleDeg = -90 + (RING_GOAL / RING_MAX) * 360;
  const goalRad = (goalAngleDeg * Math.PI) / 180;
  const cosA = Math.cos(goalRad);
  const sinA = Math.sin(goalRad);

  // Tick mark spans across the ring stroke at the goal angle so the goal is
  // visibly registered ON the ring without overlapping the colored arc.
  const tickInner = r - stroke / 2 - 2;
  const tickOuter = r + stroke / 2 + 2;
  const tickX1 = cx + cosA * tickInner;
  const tickY1 = cy + sinA * tickInner;
  const tickX2 = cx + cosA * tickOuter;
  const tickY2 = cy + sinA * tickOuter;

  // "70 / Goal" label sits just outside the tick.
  const labelR = r + stroke / 2 + 22;
  const labelX = cx + cosA * labelR;
  const labelY = cy + sinA * labelR;

  // Overflow arc sits slightly inside the main ring (a "second lap").
  const overflowR = r - stroke - 2;
  const overflowCircumference = 2 * Math.PI * overflowR;
  const overflowDashOffset = overflowCircumference * (1 - overflowPct);

  const ringColor = colorFor(z);

  // Animation — sweep the arc from empty → final value on mount or whenever
  // the score changes. Use react-native Animated (SVG props can't run on the
  // native driver, so useNativeDriver:false here).
  const ringAnim = useRef(new Animated.Value(0)).current;
  const overflowAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    ringAnim.setValue(0);
    overflowAnim.setValue(0);
    Animated.timing(ringAnim, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      if (overflowPct > 0) {
        Animated.timing(overflowAnim, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      }
    });
  }, [armScore, ringAnim, overflowAnim, overflowPct]);

  const animatedMainOffset = ringAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, mainDashOffset],
  });
  const animatedOverflowOffset = overflowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [overflowCircumference, overflowDashOffset],
  });

  return (
    <View style={styles.heroCard}>
      <View style={[styles.heroRingWrap, { width: SVG_SIZE, height: SVG_SIZE }]}>
        <Svg width={SVG_SIZE} height={SVG_SIZE}>
          {/* Background track */}
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={stroke}
            fill="none"
          />
          {/* Main progress arc (animated) */}
          <AnimatedCircle
            cx={cx}
            cy={cy}
            r={r}
            stroke={ringColor}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={animatedMainOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
          {/* Overflow arc when score > 100 — thinner inner ring (animated) */}
          {overflowPct > 0 && (
            <AnimatedCircle
              cx={cx}
              cy={cy}
              r={overflowR}
              stroke="#ffffff"
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${overflowCircumference} ${overflowCircumference}`}
              strokeDashoffset={animatedOverflowOffset}
              transform={`rotate(-90 ${cx} ${cy})`}
              opacity={0.85}
            />
          )}
          {/* Goal tick on the ring (sits OUTSIDE the colored stroke so it
              never overlaps the progress arc). */}
          <Line
            x1={tickX1}
            y1={tickY1}
            x2={tickX2}
            y2={tickY2}
            stroke="#fff"
            strokeWidth={2}
            strokeLinecap="round"
          />
          {/* "70" + "Goal" label outside the ring at the goal angle */}
          <SvgText
            x={labelX}
            y={labelY - 4}
            fontSize={16}
            fontWeight="800"
            fill="#fff"
            textAnchor="middle"
          >
            {RING_GOAL}
          </SvgText>
          <SvgText
            x={labelX}
            y={labelY + 11}
            fontSize={9}
            fontWeight="700"
            fill="#9ca3af"
            textAnchor="middle"
            letterSpacing={1.2}
          >
            GOAL
          </SvgText>
        </Svg>

        {/* Center text */}
        <View style={styles.heroRingCenter} pointerEvents="none">
          <Text style={styles.heroNumber}>
            {armScore > 0 ? Math.round(armScore) : '—'}
          </Text>
          <Text style={styles.heroLabel}>ARM SCORE</Text>
        </View>
      </View>

      {/* Footer split — Total Strength | Bodyweight */}
      <View style={styles.heroFooter}>
        <View style={styles.heroStat}>
          <Text style={styles.heroStatValue}>
            {total != null ? total.toFixed(1) : '—'}
          </Text>
          <Text style={styles.heroStatLabel}>TOTAL STRENGTH</Text>
        </View>
        <View style={styles.heroStatDivider} />
        <View style={styles.heroStat}>
          <Text style={styles.heroStatValue}>
            {bw != null ? Math.round(bw) : '—'}
          </Text>
          <Text style={styles.heroStatLabel}>BODYWEIGHT</Text>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Analysis sub-tabs — SVR · Arm Strength · Shoulder Balance
// (mirrors the ArmCare app's secondary tab strip on the STRENGTH page)
// ─────────────────────────────────────────────────────────────────────────

type AnalysisTab = 'svr' | 'strength' | 'balance';

function AnalysisTabs({ latest }: { latest: SessionRow | null }) {
  const [tab, setTab] = useState<AnalysisTab>('svr');
  if (!latest) return null;

  return (
    <View style={styles.analysisCard}>
      <View style={styles.tabRow}>
        <TabBtn label="SVR" active={tab === 'svr'} onPress={() => setTab('svr')} />
        <TabBtn label="Arm Strength" active={tab === 'strength'} onPress={() => setTab('strength')} />
        <TabBtn label="Shoulder Balance" active={tab === 'balance'} onPress={() => setTab('balance')} />
      </View>

      <View style={styles.zoneLegend}>
        <ZoneDot color={colorFor('normal')} label="Normal" />
        <ZoneDot color={colorFor('watch')} label="Watch" />
        <ZoneDot color={colorFor('warning')} label="Warning" />
      </View>

      {tab === 'svr' && <SvrTabContent latest={latest} />}
      {tab === 'strength' && <ArmStrengthTabContent latest={latest} />}
      {tab === 'balance' && <ShoulderBalanceTabContent latest={latest} />}
    </View>
  );
}

function TabBtn({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text
        style={[styles.tabBtnText, active && styles.tabBtnTextActive]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ZoneDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.zoneDotRow}>
      <View style={[styles.zoneDotMark, { backgroundColor: color }]} />
      <Text style={styles.zoneDotLabel}>{label}</Text>
    </View>
  );
}

// ─── SVR sub-tab ─────────────────────────────────────────────────────────

function SvrTabContent({ latest }: { latest: SessionRow }) {
  const svr = latest.svr != null ? Number(latest.svr) : null;
  const velo = latest.velo != null ? Number(latest.velo) : null;
  const z = svrZone(svr);
  const color = colorFor(z);

  return (
    <View style={styles.tabContent}>
      <Text style={styles.tabSectionTitle}>Strength Velocity Ratio</Text>
      <View style={[styles.svrBox, { borderColor: `${color}55` }]}>
        <Text style={[styles.svrValue, { color }]}>
          {svr != null ? svr.toFixed(2) : '—'}
        </Text>
        {svr != null && <ZonePill zone={z} />}
      </View>

      <View style={styles.svrFootRow}>
        <View>
          <Text style={styles.svrFootLabel}>Max Velocity</Text>
          <Text style={styles.svrFootValue}>
            {velo != null ? velo.toFixed(1) : '—'}
            <Text style={styles.svrFootUnit}> mph</Text>
          </Text>
        </View>
        <View style={styles.svrTargetCol}>
          <Text style={styles.svrFootLabel}>Target</Text>
          <Text style={styles.svrFootValue}>
            ≥ 1.6
          </Text>
        </View>
      </View>
      <Text style={styles.tabHint}>
        SVR = total strength ÷ max velocity. Higher means more strength per mph.
      </Text>
    </View>
  );
}

// ─── Arm Strength sub-tab ────────────────────────────────────────────────
// Per-test rows showing current %BW vs goal %BW, with zone-colored badges.

function ArmStrengthTabContent({ latest }: { latest: SessionRow }) {
  const bw = latest.weight_lbs != null ? Number(latest.weight_lbs) : 0;

  type Row = {
    label: string;
    peakLbs: number;
    test: 'ir' | 'er' | 'scap' | 'grip';
    goalPct: number;
  };
  const rows: Row[] = [
    {
      label: 'Internal Rotation',
      peakLbs: Number(latest.irtarm_max_lbs ?? 0),
      test: 'ir',
      goalPct: 20,
    },
    {
      label: 'External Rotation',
      peakLbs: Number(latest.ertarm_max_lbs ?? 0),
      test: 'er',
      goalPct: 20,
    },
    {
      label: 'Scaption',
      peakLbs: Number(latest.starm_max_lbs ?? 0),
      test: 'scap',
      goalPct: 15,
    },
    {
      label: 'Grip',
      peakLbs: Number(latest.gtarm_max_lbs ?? 0),
      test: 'grip',
      goalPct: 15,
    },
  ];

  return (
    <View style={styles.tabContent}>
      <View style={styles.strengthHeaderRow}>
        <Text style={[styles.strengthHeaderLabel, styles.strengthHeaderTest]}>TEST</Text>
        <Text style={[styles.strengthHeaderLabel, styles.strengthHeaderGoal]}>GOAL</Text>
        <Text style={[styles.strengthHeaderLabel, styles.strengthHeaderCurrent]}>CURRENT</Text>
      </View>
      {rows.map((row) => {
        const pct = bw > 0 && row.peakLbs > 0 ? (row.peakLbs / bw) * 100 : 0;
        const z = peakZone(row.test, row.peakLbs, bw);
        const color = colorFor(z);
        return (
          <View key={row.label} style={styles.strengthRow}>
            <Text style={styles.strengthRowLabel}>{row.label}</Text>
            <Text style={styles.strengthRowGoal}>+{row.goalPct}%</Text>
            <View
              style={[
                styles.strengthRowBadge,
                { borderColor: `${color}88`, backgroundColor: `${color}1f` },
              ]}
            >
              <Text style={[styles.strengthRowBadgeText, { color }]}>
                {pct > 0 ? `${pct.toFixed(1)}%` : '—'}
              </Text>
            </View>
          </View>
        );
      })}

      {/* Total strength as % of bodyweight — sits below the 4 rows */}
      <View style={styles.strengthTotalRow}>
        <Text style={styles.strengthTotalLabel}>Total · % bodyweight</Text>
        {(() => {
          const total = Number(latest.total_strength ?? 0);
          const pct = bw > 0 && total > 0 ? (total / bw) * 100 : 0;
          const z = totalStrengthZone(total || null, bw || null);
          const color = colorFor(z);
          return (
            <View
              style={[
                styles.strengthRowBadge,
                { borderColor: `${color}88`, backgroundColor: `${color}1f` },
              ]}
            >
              <Text style={[styles.strengthRowBadgeText, { color }]}>
                {pct > 0 ? `${pct.toFixed(1)}%` : '—'}
              </Text>
            </View>
          );
        })()}
      </View>
    </View>
  );
}

// ─── Shoulder Balance sub-tab ────────────────────────────────────────────
// Horizontal gradient bar with markers for the zone thresholds and the
// athlete's current value pinned to where they fall.

function ShoulderBalanceTabContent({ latest }: { latest: SessionRow }) {
  const ratio =
    latest.ertarm_max_lbs && latest.irtarm_max_lbs && Number(latest.irtarm_max_lbs) > 0
      ? Number(latest.ertarm_max_lbs) / Number(latest.irtarm_max_lbs)
      : null;
  const z = erIrZone(ratio);

  // Pin the bar to a 0.5 → 1.5 visible range, clamp the marker.
  const min = 0.5;
  const max = 1.5;
  const pct = ratio != null ? Math.min(1, Math.max(0, (ratio - min) / (max - min))) : 0;

  const verdict =
    z === 'normal' ? 'Balanced' : z === 'watch' ? 'Borderline' : z === 'warning' ? 'Imbalanced' : 'No data';
  const verdictColor = colorFor(z);

  const detailLine =
    ratio == null
      ? 'Need both IR and ER throwing-arm peaks to compute the ratio.'
      : ratio < 0.85
      ? 'Your external rotators are weak relative to internal rotators.'
      : ratio > 1.05
      ? 'Your internal rotators are weak relative to external rotators.'
      : 'Internal and external rotators are well matched.';

  return (
    <View style={styles.tabContent}>
      <Text style={styles.tabSectionTitle}>Shoulder Balance</Text>

      <View style={styles.balanceBarWrap}>
        {/* Color bands */}
        <View style={[styles.balanceBand, { left: '0%', width: '20%', backgroundColor: 'rgba(248,113,113,0.55)' }]} />
        <View style={[styles.balanceBand, { left: '20%', width: '15%', backgroundColor: 'rgba(251,191,36,0.55)' }]} />
        <View style={[styles.balanceBand, { left: '35%', width: '20%', backgroundColor: 'rgba(52,211,153,0.55)' }]} />
        <View style={[styles.balanceBand, { left: '55%', width: '15%', backgroundColor: 'rgba(251,191,36,0.55)' }]} />
        <View style={[styles.balanceBand, { left: '70%', width: '30%', backgroundColor: 'rgba(248,113,113,0.55)' }]} />

        {/* Threshold tick labels */}
        <View style={[styles.balanceTickLabel, { left: '20%' }]}>
          <Text style={styles.balanceTickText}>0.70</Text>
        </View>
        <View style={[styles.balanceTickLabel, { left: '35%' }]}>
          <Text style={styles.balanceTickText}>0.85</Text>
        </View>
        <View style={[styles.balanceTickLabel, { left: '55%' }]}>
          <Text style={styles.balanceTickText}>1.05</Text>
        </View>
        <View style={[styles.balanceTickLabel, { left: '70%' }]}>
          <Text style={styles.balanceTickText}>1.20</Text>
        </View>

        {/* Current value marker */}
        {ratio != null && (
          <View style={[styles.balanceMarker, { left: `${pct * 100}%` }]}>
            <View style={[styles.balanceMarkerDot, { borderColor: verdictColor }]}>
              <Text
                style={[styles.balanceMarkerNum, { color: verdictColor }]}
                numberOfLines={1}
              >
                {ratio.toFixed(2)}
              </Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.balanceVerdictRow}>
        <View
          style={[
            styles.balanceVerdictPill,
            { borderColor: `${verdictColor}55`, backgroundColor: `${verdictColor}1f` },
          ]}
        >
          <Text style={[styles.balanceVerdictText, { color: verdictColor }]}>
            {verdict}
          </Text>
        </View>
      </View>
      <Text style={styles.tabHint}>{detailLine}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Can I throw today?
// ─────────────────────────────────────────────────────────────────────────

function CanIThrowCard({
  latest,
  previous,
}: {
  latest: SessionRow | null;
  previous: SessionRow | null;
}) {
  if (!latest) return null;

  const armZ = armScoreZone(latest.arm_score);
  const balanceZ = erIrZone(
    latest.ertarm_max_lbs && latest.irtarm_max_lbs
      ? latest.ertarm_max_lbs / latest.irtarm_max_lbs
      : null,
  );

  // Recovery delta — compare total strength to previous session.
  let recoveryPct: number | null = null;
  if (
    previous?.total_strength &&
    latest?.total_strength &&
    previous.total_strength > 0
  ) {
    recoveryPct =
      ((latest.total_strength - previous.total_strength) / previous.total_strength) * 100;
  }

  // Verdict logic:
  //   Yes      → ArmScore normal, balance normal, no >10% strength drop
  //   Reduced  → any one of: ArmScore watch, balance watch, 5–10% drop
  //   No       → ArmScore warning, balance warning, or >10% drop
  let verdict: 'yes' | 'reduced' | 'no' = 'yes';
  let reason = 'ArmScore is in the normal zone.';

  if (armZ === 'warning') {
    verdict = 'no';
    reason = 'ArmScore is below 60. Recover before throwing.';
  } else if (recoveryPct != null && recoveryPct < -10) {
    verdict = 'no';
    reason = `Strength dropped ${Math.abs(recoveryPct).toFixed(0)}% vs last exam.`;
  } else if (balanceZ === 'warning') {
    verdict = 'no';
    reason = 'ER:IR balance is outside the safe range.';
  } else if (armZ === 'watch') {
    verdict = 'reduced';
    reason = 'ArmScore is in the watch zone — light throwing only.';
  } else if (recoveryPct != null && recoveryPct < -5) {
    verdict = 'reduced';
    reason = `Strength dipped ${Math.abs(recoveryPct).toFixed(0)}% vs last exam.`;
  } else if (balanceZ === 'watch') {
    verdict = 'reduced';
    reason = 'ER:IR balance is borderline — moderate volume.';
  }

  const styleMap = {
    yes: { color: '#34D399', label: 'YES', icon: 'checkmark-circle' as const },
    reduced: { color: '#FBBF24', label: 'REDUCED', icon: 'alert-circle' as const },
    no: { color: '#F87171', label: 'NOT TODAY', icon: 'close-circle' as const },
  };
  const v = styleMap[verdict];

  return (
    <View style={[styles.card, { borderColor: `${v.color}55` }]}>
      <View style={styles.cardHeader}>
        <Ionicons name={v.icon} size={18} color={v.color} />
        <Text style={[styles.cardEyebrow, { color: v.color }]}>CAN I THROW TODAY?</Text>
      </View>
      <Text style={[styles.verdict, { color: v.color }]}>{v.label}</Text>
      <Text style={styles.cardBody}>{reason}</Text>
      <Text style={styles.cardMeta}>
        Last exam · {fmtDate(latest.exam_date)}
        {latest.fresh_arm_feels ? ` · feels ${latest.fresh_arm_feels}/10` : ''}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ArmScore trend
// ─────────────────────────────────────────────────────────────────────────

function ArmScoreTrendCard({ sessions }: { sessions: SessionRow[] }) {
  const points = sessions
    .map((s) => (s.arm_score != null ? Number(s.arm_score) : null))
    .filter((v): v is number => v != null);
  if (points.length < 1) return null;

  const latest = points[points.length - 1];
  const z = armScoreZone(latest);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="trending-up" size={16} color="#9ca3af" />
        <Text style={styles.cardEyebrow}>ARM SCORE</Text>
      </View>
      <View style={styles.headlineRow}>
        <Text style={styles.headlineNum}>{Math.round(latest)}</Text>
        <ZonePill zone={z} />
      </View>
      <ZoneBandedChart
        values={points}
        references={[
          { value: 60, label: '60', color: 'rgba(248,113,113,0.45)' },
          { value: 70, label: '70', color: 'rgba(52,211,153,0.45)' },
        ]}
        yMin={50}
        yMax={Math.max(110, ...points) + 5}
        stroke="#fff"
      />
      <Text style={styles.cardMeta}>
        Last {points.length} {points.length === 1 ? 'exam' : 'exams'} · target ≥ 70
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// IR vs ER trend
// ─────────────────────────────────────────────────────────────────────────

function IrErTrendCard({ sessions }: { sessions: SessionRow[] }) {
  // Use the throwing-arm peaks for both IR and ER. (Non-throwing arm is in
  // the per-test trend visible from the trends screen.)
  const ir = sessions
    .map((s) => (s.irtarm_max_lbs != null ? Number(s.irtarm_max_lbs) : null))
    .filter((v): v is number => v != null);
  const er = sessions
    .map((s) => (s.ertarm_max_lbs != null ? Number(s.ertarm_max_lbs) : null))
    .filter((v): v is number => v != null);
  if (ir.length < 1 && er.length < 1) return null;

  const latestIr = ir[ir.length - 1] ?? 0;
  const latestEr = er[er.length - 1] ?? 0;
  const all = [...ir, ...er];
  const yMax = Math.max(...all, 30) * 1.15;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="git-compare" size={16} color="#9ca3af" />
        <Text style={styles.cardEyebrow}>IR vs ER · over time</Text>
      </View>
      <View style={styles.legendRow}>
        <Legend dotColor="#A78BFA" label={`IR ${latestIr.toFixed(0)} lbs`} />
        <Legend dotColor="#7DD3FC" label={`ER ${latestEr.toFixed(0)} lbs`} />
      </View>
      <DualLineChart
        primary={ir}
        primaryColor="#A78BFA"
        secondary={er}
        secondaryColor="#7DD3FC"
        yMin={0}
        yMax={yMax}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shoulder Balance trend (ER:IR ratio)
// ─────────────────────────────────────────────────────────────────────────

function ShoulderBalanceTrendCard({ sessions }: { sessions: SessionRow[] }) {
  const ratios = sessions
    .map((s) => {
      if (!s.ertarm_max_lbs || !s.irtarm_max_lbs) return null;
      return Number(s.ertarm_max_lbs) / Number(s.irtarm_max_lbs);
    })
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);

  if (ratios.length < 1) return null;
  const latest = ratios[ratios.length - 1];
  const z = erIrZone(latest);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons name="scale-balance" size={16} color="#9ca3af" />
        <Text style={styles.cardEyebrow}>SHOULDER BALANCE · ER ÷ IR</Text>
      </View>
      <View style={styles.headlineRow}>
        <Text style={styles.headlineNum}>{latest.toFixed(2)}</Text>
        <ZonePill zone={z} />
      </View>
      <ZoneBandedChart
        values={ratios}
        references={[
          { value: 0.85, label: '0.85', color: 'rgba(52,211,153,0.45)' },
          { value: 1.05, label: '1.05', color: 'rgba(52,211,153,0.45)' },
        ]}
        yMin={0.5}
        yMax={1.5}
        stroke="#fff"
      />
      <Text style={styles.cardMeta}>healthy band 0.85 – 1.05</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Recovery card — total strength delta + per-muscle deltas vs previous
// ─────────────────────────────────────────────────────────────────────────

function RecoveryCard({
  latest,
  previous,
}: {
  latest: SessionRow | null;
  previous: SessionRow | null;
}) {
  if (!latest || !previous) return null;
  const totalA = Number(latest.total_strength ?? 0);
  const totalB = Number(previous.total_strength ?? 0);
  if (totalA <= 0 || totalB <= 0) return null;

  const deltaTotal = totalA - totalB;
  const deltaTotalPct = (deltaTotal / totalB) * 100;

  const rows = [
    {
      label: 'Internal Rotation',
      a: Number(latest.irtarm_max_lbs ?? 0),
      b: Number(previous.irtarm_max_lbs ?? 0),
    },
    {
      label: 'External Rotation',
      a: Number(latest.ertarm_max_lbs ?? 0),
      b: Number(previous.ertarm_max_lbs ?? 0),
    },
    {
      label: 'Scaption',
      a: Number(latest.starm_max_lbs ?? 0),
      b: Number(previous.starm_max_lbs ?? 0),
    },
    {
      label: 'Grip',
      a: Number(latest.gtarm_max_lbs ?? 0),
      b: Number(previous.gtarm_max_lbs ?? 0),
    },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="repeat" size={16} color="#9ca3af" />
        <Text style={styles.cardEyebrow}>RECOVERY · vs previous</Text>
      </View>
      <View style={styles.recoveryHeadline}>
        <Text style={styles.headlineNum}>
          {deltaTotal >= 0 ? '+' : ''}
          {deltaTotal.toFixed(1)}
          <Text style={styles.headlineUnit}> lbs total</Text>
        </Text>
        <DeltaPill pct={deltaTotalPct} />
      </View>

      <View style={styles.recoveryRows}>
        {rows.map((row) => {
          const d = row.a - row.b;
          const pct = row.b > 0 ? (d / row.b) * 100 : null;
          const color = pct == null ? '#9ca3af' : pct < -10 ? '#F87171' : pct < 0 ? '#FBBF24' : '#34D399';
          return (
            <View key={row.label} style={styles.recoveryRow}>
              <Text style={styles.recoveryLabel}>{row.label}</Text>
              <View style={styles.recoveryValues}>
                <Text style={styles.recoveryValue}>{row.a.toFixed(0)} lbs</Text>
                <Text style={[styles.recoveryDelta, { color }]}>
                  {d >= 0 ? '+' : ''}
                  {d.toFixed(1)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={styles.cardMeta}>
        previous exam · {fmtDate(previous.exam_date)}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Recent history list
// ─────────────────────────────────────────────────────────────────────────

function RecentHistoryList({ sessions }: { sessions: SessionRow[] }) {
  if (sessions.length === 0) return null;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="time-outline" size={16} color="#9ca3af" />
        <Text style={styles.cardEyebrow}>RECENT EXAMS</Text>
      </View>
      <View style={styles.historyList}>
        {sessions.map((s, i) => {
          const z = armScoreZone(s.arm_score);
          return (
            <View
              key={s.id}
              style={[
                styles.historyRow,
                i < sessions.length - 1 && styles.historyRowDivider,
              ]}
            >
              <Text style={styles.historyDate}>{fmtDate(s.exam_date)}</Text>
              <View style={styles.historyMid}>
                <Text style={styles.historyScore}>
                  {s.arm_score != null ? Math.round(Number(s.arm_score)) : '—'}
                </Text>
                <Text style={styles.historyScoreLabel}>ArmScore</Text>
              </View>
              <ZonePill zone={z} small />
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────

function EmptyState() {
  const navigation = useNavigation<any>();
  return (
    <View style={[styles.card, styles.emptyCard]}>
      <Ionicons name="medical-outline" size={36} color="#9ca3af" />
      <Text style={styles.emptyTitle}>No arm care exams yet</Text>
      <Text style={styles.emptyBody}>
        Run the wizard with an Activ5 sensor to start tracking strength,
        balance, and recovery over time.
      </Text>
      <Pressable
        onPress={() => navigation.navigate('ArmCareHub')}
        style={styles.emptyCta}
      >
        <Text style={styles.emptyCtaText}>Go to ArmCare</Text>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────────────────

/**
 * Refined trend chart — single white line on canvas with thin dashed
 * reference lines at the zone thresholds. No saturated colored bands.
 *
 * Optional `references` array draws a 1px dashed horizontal line at each
 * value with a tiny inline label at the right edge ("70" etc.).
 */
function ZoneBandedChart({
  values,
  references,
  yMin,
  yMax,
  stroke = '#fff',
}: {
  values: number[];
  references?: { value: number; label?: string; color?: string }[];
  yMin: number;
  yMax: number;
  stroke?: string;
}) {
  const W = 320;
  const H = 160;
  const padX = 12;
  const padTop = 12;
  const padBot = 22; // room for x-axis end labels under the line
  const w = W - padX * 2;
  const h = H - padTop - padBot;
  const span = yMax - yMin || 1;
  const yFor = (v: number) => padTop + h - ((v - yMin) / span) * h;

  if (values.length === 0) return null;

  const stepX = values.length === 1 ? 0 : w / (values.length - 1);
  const points = values.map((v, i) => ({
    x: padX + i * stepX,
    y: yFor(v),
  }));

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const mx = (prev.x + cur.x) / 2;
    const my = (prev.y + cur.y) / 2;
    d += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  d += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {/* Reference lines (dashed) */}
      {(references ?? []).map((ref, i) => {
        const y = yFor(ref.value);
        if (y < padTop || y > padTop + h) return null;
        return (
          <React.Fragment key={i}>
            <Line
              x1={padX}
              y1={y}
              x2={W - padX - 28}
              y2={y}
              stroke={ref.color ?? 'rgba(255,255,255,0.22)'}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
            {ref.label != null && (
              <SvgText
                x={W - padX}
                y={y + 4}
                fontSize={10}
                fontWeight="700"
                fill={ref.color ?? 'rgba(255,255,255,0.5)'}
                textAnchor="end"
              >
                {ref.label}
              </SvgText>
            )}
          </React.Fragment>
        );
      })}
      {/* Trend line */}
      <Path d={d} stroke={stroke} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Trailing point */}
      {points.length > 0 && (
        <>
          <Circle cx={last.x} cy={last.y} r={6} fill="rgba(255,255,255,0.16)" />
          <Circle cx={last.x} cy={last.y} r={3.5} fill={stroke} />
        </>
      )}
    </Svg>
  );
}

function DualLineChart({
  primary,
  primaryColor,
  secondary,
  secondaryColor,
  yMin,
  yMax,
}: {
  primary: number[];
  primaryColor: string;
  secondary: number[];
  secondaryColor: string;
  yMin: number;
  yMax: number;
}) {
  const W = 320;
  const H = 160;
  const padX = 12;
  const padY = 14;
  const w = W - padX * 2;
  const h = H - padY * 2;
  const span = yMax - yMin || 1;
  const yFor = (v: number) => padY + h - ((v - yMin) / span) * h;

  const buildPath = (vals: number[]): string => {
    if (vals.length === 0) return '';
    const stepX = vals.length === 1 ? 0 : w / (vals.length - 1);
    const pts = vals.map((v, i) => ({ x: padX + i * stepX, y: yFor(v) }));
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const mx = (prev.x + cur.x) / 2;
      const my = (prev.y + cur.y) / 2;
      d += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
    }
    const last = pts[pts.length - 1];
    d += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
    return d;
  };

  const dP = buildPath(primary);
  const dS = buildPath(secondary);
  const lastP = primary.length > 0 ? { x: w, y: yFor(primary[primary.length - 1]) } : null;
  const lastS = secondary.length > 0 ? { x: w, y: yFor(secondary[secondary.length - 1]) } : null;

  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {/* Light grid line at midpoint */}
      <Line
        x1={0}
        y1={yFor((yMin + yMax) / 2)}
        x2={W}
        y2={yFor((yMin + yMax) / 2)}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={1}
      />
      {dP && <Path d={dP} stroke={primaryColor} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {dS && <Path d={dS} stroke={secondaryColor} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {lastP && <Circle cx={padX + lastP.x} cy={lastP.y} r={3} fill={primaryColor} />}
      {lastS && <Circle cx={padX + lastS.x} cy={lastS.y} r={3} fill={secondaryColor} />}
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Small bits
// ─────────────────────────────────────────────────────────────────────────

function ZonePill({ zone, small = false }: { zone: Zone; small?: boolean }) {
  const labels: Record<Zone, string> = {
    normal: 'NORMAL',
    watch: 'WATCH',
    warning: 'WARNING',
    unknown: '—',
  };
  const color = colorFor(zone);
  return (
    <View
      style={[
        styles.zonePill,
        small && styles.zonePillSmall,
        { borderColor: `${color}55`, backgroundColor: `${color}1f` },
      ]}
    >
      <Text style={[styles.zonePillText, { color }]}>{labels[zone]}</Text>
    </View>
  );
}

function DeltaPill({ pct }: { pct: number }) {
  const color = pct < -10 ? '#F87171' : pct < 0 ? '#FBBF24' : '#34D399';
  return (
    <View
      style={[
        styles.deltaPill,
        { borderColor: `${color}55`, backgroundColor: `${color}1f` },
      ]}
    >
      <Ionicons
        name={pct >= 0 ? 'arrow-up' : 'arrow-down'}
        size={11}
        color={color}
      />
      <Text style={[styles.deltaPillText, { color }]}>
        {pct >= 0 ? '+' : ''}
        {pct.toFixed(1)}%
      </Text>
    </View>
  );
}

function Legend({ dotColor, label }: { dotColor: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: dotColor }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 60,
  },
  bodyText: {
    color: '#d1d5db',
    fontSize: 14,
    padding: 16,
  },
  loadingWrap: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  // ─── Header ───
  headerWrap: {
    paddingTop: 8,
    paddingBottom: 16,
    gap: 8,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 4,
  },
  backText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 14,
  },
  rangeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  // Range "chips" sit naked on the canvas — only the active one shows a
  // tinted underline. No surrounding pill fills (per the no-container rule).
  rangeChip: {
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  rangeChipActive: {
    borderBottomColor: ACCENT,
  },
  rangeChipText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  rangeChipTextActive: {
    color: '#fff',
  },
  // ─── Section shell ───
  // Per the no-container rule: sections sit directly on the black canvas
  // separated by generous spacing + a thin top hairline. No background fills,
  // no borders, no card radii. Spacing is intentionally large — the user
  // wants the sections to breathe.
  card: {
    paddingTop: 38,
    paddingBottom: 22,
    marginTop: 28,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  cardEyebrow: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  cardBody: {
    color: '#d1d5db',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  cardMeta: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 8,
    letterSpacing: 0.2,
  },
  // ─── Verdict ───
  verdict: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 4,
    marginBottom: 4,
  },
  // ─── Headline + zone pill ───
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 2,
    marginBottom: 8,
  },
  headlineNum: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  headlineUnit: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
  zonePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 4,
  },
  zonePillSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  zonePillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  // ─── Delta ───
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 4,
  },
  deltaPillText: {
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  // ─── Legend (dual line chart) ───
  legendRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
  },
  // ─── Recovery rows ───
  recoveryHeadline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginBottom: 12,
  },
  recoveryRows: {
    gap: 8,
  },
  recoveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recoveryLabel: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
  },
  recoveryValues: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recoveryValue: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  recoveryDelta: {
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    minWidth: 44,
    textAlign: 'right',
  },
  // ─── History list ───
  historyList: {
    marginTop: 4,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  historyRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  historyDate: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  historyMid: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginRight: 12,
  },
  historyScore: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  historyScoreLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  // ─── Empty ───
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  emptyBody: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
  emptyCta: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: ACCENT,
    borderRadius: 12,
  },
  emptyCtaText: {
    color: '#0A0A0A',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // ─────────────────────────────────────────────────────────
  // Hero analysis ring (modeled on the ArmCare app)
  // No container surface — ring + footer sit naked on canvas.
  // ─────────────────────────────────────────────────────────
  heroCard: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 24,
    marginTop: 4,
  },
  heroRingWrap: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRingCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroNumber: {
    color: '#fff',
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
    lineHeight: 68,
  },
  heroLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginTop: 2,
  },
  goalChip: {
    position: 'absolute',
    top: 6,
    left: 6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  goalChipNum: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  goalChipText: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginTop: 18,
    paddingHorizontal: 8,
  },
  heroStat: {
    flex: 1,
    alignItems: 'center',
  },
  heroStatValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  heroStatLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 4,
  },
  heroStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  // ─────────────────────────────────────────────────────────
  // Analysis tabs (SVR / Arm Strength / Shoulder Balance)
  // No container — bare tab strip with underline indicator.
  // ─────────────────────────────────────────────────────────
  analysisCard: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    marginBottom: 14,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1, // overlap the row hairline so the active border reads as one line
  },
  tabBtnActive: {
    borderBottomColor: ACCENT,
  },
  tabBtnText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  tabBtnTextActive: {
    color: '#fff',
  },
  zoneLegend: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 14,
  },
  zoneDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  zoneDotMark: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  zoneDotLabel: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  tabContent: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  tabSectionTitle: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  tabHint: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 14,
  },
  // ─── SVR sub-tab ───
  svrBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  svrValue: {
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
    lineHeight: 60,
  },
  svrFootRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 14,
  },
  svrTargetCol: {
    alignItems: 'flex-end',
  },
  svrFootLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  svrFootValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  svrFootUnit: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '500',
  },
  // ─── Arm Strength sub-tab (rows on canvas) ───
  // Column widths shared between header + row so the labels align with the
  // values underneath them. Earlier rev had the header right-aligned in a
  // flex zone which pushed "TEST" to the wrong position.
  strengthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    marginBottom: 4,
  },
  strengthHeaderLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  strengthHeaderTest: {
    flex: 1,
    textAlign: 'left',
  },
  strengthHeaderGoal: {
    width: 64,
    textAlign: 'right',
    marginRight: 12,
  },
  strengthHeaderCurrent: {
    width: 76,
    textAlign: 'center',
    marginLeft: 4,
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  strengthRowLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  strengthRowGoal: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
    width: 64,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    marginRight: 12,
  },
  strengthRowBadge: {
    width: 76,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    marginLeft: 4,
  },
  strengthRowBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
  strengthTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    marginTop: 4,
  },
  strengthTotalLabel: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // ─── Shoulder Balance sub-tab (gradient bar) ───
  balanceBarWrap: {
    height: 64,
    marginTop: 18,
    marginBottom: 56,
    position: 'relative',
  },
  balanceBand: {
    position: 'absolute',
    top: 16,
    height: 16,
    borderRadius: 2,
  },
  balanceTickLabel: {
    position: 'absolute',
    top: 38,
    transform: [{ translateX: -16 }],
    width: 32,
    alignItems: 'center',
  },
  balanceTickText: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  // Marker container is wide enough to fit "0.72" / "1.05" without wrapping.
  // translateX is -½ of width so the marker center sits exactly at the
  // computed left% position on the gradient bar.
  balanceMarker: {
    position: 'absolute',
    top: -2,
    transform: [{ translateX: -34 }],
    width: 68,
    alignItems: 'center',
  },
  balanceMarkerDot: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 2,
    backgroundColor: '#0A0A0A',
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceMarkerNum: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
  balanceVerdictRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  balanceVerdictPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  balanceVerdictText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
