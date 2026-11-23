import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Circle, Line, Path, Text as SvgText, G } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { useAthlete } from '../contexts/AthleteContext';
import ContactPoint3D from '../components/ContactPoint3D';
import FABMenu from '../components/FABMenu';
import { BallField3D } from '../components/hitting/BallField3D';
import {
  STEEL,
  evColor,
  fmt,
  Section,
  Kpi,
  KpiRow,
  ScreenHeader,
  steelStyles,
  HARD_HIT_MPH,
  SWEET_SPOT,
} from '../components/hitting/steel';


interface HitTraxSwing {
  id: string;
  exit_velocity: number;
  launch_angle: number | null;
  distance: number | null;
  horizontal_angle: number | null;
  spray_chart_x: number;
  spray_chart_z: number;
  poi_x: number | null;
  poi_y: number | null;
  poi_z: number | null;
  strike_zone_bottom: number | null;
  strike_zone_top: number | null;
  strike_zone_width: number | null;
  result: string;
  hit_type: string;
  swing_timestamp: string;
  pitch_velocity: number;
  pitch_type: string;
}

interface BlastSwing {
  id: string;
  bat_speed: number | null;
  attack_angle: number | null;
  on_plane_efficiency: number | null;
  peak_hand_speed: number | null;
  time_to_contact: number | null;
  power: number | null;
  recorded_date: string;
  recorded_time: string;
  created_at_utc: string;
}

interface PairedSwingData {
  blastSwing: BlastSwing | null;
  hittraxSwing: HitTraxSwing | null;
  timeDiff: number;
}

interface FullSwingSwing {
  id: string;
  session_id: string;
  pitch_number: number | null;
  swing_date: string | null;
  swing_time: string | null;
  bat_speed: number | null;
  exit_velocity: number | null;
  launch_angle: number | null;
  spray_angle: number | null;
  distance: number | null;
  smash_factor: number | null;
  squared_up: number | null;
  pitch_speed: number | null;
}

interface FullSwingSession {
  id: string;
  session_date: string;
  total_swings: number;
  contact_swings: number;
  avg_exit_velocity: number | null;
  max_exit_velocity: number | null;
  avg_launch_angle: number | null;
  avg_distance: number | null;
  max_distance: number | null;
  avg_bat_speed: number | null;
  max_bat_speed: number | null;
  avg_smash_factor: number | null;
  max_smash_factor?: number | null;
  squared_up_rate: number | null;
  hard_hit_count: number;
  hard_hit_rate: number | null;
}

type SessionType = 'hittrax' | 'blast' | 'paired' | 'fullswing';

// ── Animated Section Wrapper ────────────────────────────────────────────────
function AnimatedSection({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 500, delay, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

/** Spray chart x/z (ft). Uses HitTrax's own coordinates when present, else
 *  derives them from horizontal_angle (0 = center, + = right) and distance. */
function sprayXZ(swing: any): { spray_chart_x: number; spray_chart_z: number } {
  const x = swing.spray_chart_x != null ? parseFloat(swing.spray_chart_x) : NaN;
  const z = swing.spray_chart_z != null ? parseFloat(swing.spray_chart_z) : NaN;
  if (Number.isFinite(x) && Number.isFinite(z) && (x !== 0 || z !== 0)) return { spray_chart_x: x, spray_chart_z: z };
  const d = swing.distance != null ? parseFloat(swing.distance) : NaN;
  const a = swing.horizontal_angle != null ? parseFloat(swing.horizontal_angle) : NaN;
  if (Number.isFinite(d) && Number.isFinite(a)) {
    const r = (a * Math.PI) / 180;
    return { spray_chart_x: d * Math.sin(r), spray_chart_z: d * Math.cos(r) };
  }
  return { spray_chart_x: 0, spray_chart_z: 0 };
}

export default function HittingSessionScreen({ route, navigation }: any) {
  const { isParent } = useAthlete();
  const { sessionId, date, athleteId: passedAthleteId, source: passedSource } = route.params;

  const [hittraxSwings, setHittraxSwings] = useState<HitTraxSwing[]>([]);
  const [blastSwings, setBlastSwings] = useState<BlastSwing[]>([]);
  const [pairedSwingData, setPairedSwingData] = useState<PairedSwingData[]>([]);
  const [fullSwingSwings, setFullSwingSwings] = useState<FullSwingSwing[]>([]);
  const [fullSwingSession, setFullSwingSession] = useState<FullSwingSession | null>(null);
  const [sessionType, setSessionType] = useState<SessionType>('hittrax');
  const [sessionDate, setSessionDate] = useState<string>(date || '');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSwing, setSelectedSwing] = useState<HitTraxSwing | null>(null);
  const [athleteId, setAthleteId] = useState<string | null>(passedAthleteId || null);

  // FAB state
  const [fabOpen, setFabOpen] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasArmCareData, setHasArmCareData] = useState(false);
  const [hasForceData, setHasForceData] = useState(false);
  const [hasHittingData, setHasHittingData] = useState(true);
  const [hasResourcesData, setHasResourcesData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [newResourcesCount, setNewResourcesCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [sessionId]);

  async function loadData() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }
      setUserId(user.id);

      let currentAthleteId = athleteId;
      if (!currentAthleteId) {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (athlete) {
          currentAthleteId = athlete.id;
          setAthleteId(athlete.id);
        }
      }

      if (currentAthleteId) {
        await fetchSessionData(currentAthleteId);
        await fetchFabData(currentAthleteId, user.id);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchFabData(athleteId: string, currentUserId: string) {
    try {
      const { count: pitchingCount } = await supabase
        .from('trackman_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasPitchingData((pitchingCount || 0) > 0);

      const { count: armCareCount } = await supabase
        .from('armcare_pr_data')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasArmCareData((armCareCount || 0) > 0);

      const { count: forceCount } = await supabase
        .from('cmj_tests')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasForceData((forceCount || 0) > 0);

      const { count: resourcesCount } = await supabase
        .from('athlete_resources')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasResourcesData((resourcesCount || 0) > 0);

      const { count: unreadCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', currentUserId)
        .eq('read', false);
      setUnreadMessagesCount(unreadCount || 0);
    } catch (error) {
      console.error('Error fetching FAB data:', error);
    }
  }

  // Parse HitTrax timestamp format: "MM/DD/YYYY HH:MM:SS.fff" or ISO format
  function parseHitTraxTimestamp(timestamp: string): number {
    if (!timestamp) return 0;
    if (timestamp.includes('T') || timestamp.includes('Z')) {
      return new Date(timestamp).getTime();
    }
    const [datePart, timePart] = timestamp.split(' ');
    if (!datePart || !timePart) return new Date(timestamp).getTime();
    const [month, day, year] = datePart.split('/').map(Number);
    const [hours, minutes, secondsWithMs] = timePart.split(':');
    const seconds = parseFloat(secondsWithMs) || 0;
    const dateObj = new Date(year, month - 1, day, Number(hours), Number(minutes), Math.floor(seconds));
    dateObj.setMilliseconds((seconds % 1) * 1000);
    return dateObj.getTime();
  }

  // Parse Blast timestamp - prefer UTC, fallback to local
  function parseBlastTimestamp(blast: BlastSwing): number {
    if (blast.created_at_utc) {
      return new Date(blast.created_at_utc).getTime();
    }
    const [year, month, day] = blast.recorded_date.split('-').map(Number);
    const [hours, minutes, seconds] = (blast.recorded_time || '00:00:00').split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes, seconds).getTime();
  }

  async function fetchSessionData(currentAthleteId: string) {
    // Check if sessionId is a UUID (HitTrax/FullSwing) or a date string (Blast-only)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);

    // Check for Full Swing session first if source is 'fullswing' or if it's a UUID
    if (passedSource === 'fullswing' || (isUUID && !passedSource)) {
      // Try Full Swing first
      const { data: fullSwingSessionData } = await supabase
        .from('fullswing_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (fullSwingSessionData) {
        setSessionDate(fullSwingSessionData.session_date);
        setSessionType('fullswing');
        setFullSwingSession(fullSwingSessionData as FullSwingSession);

        // Get all Full Swing swings for this session
        const { data: fullSwingSwingsData } = await supabase
          .from('fullswing_swings')
          .select('*')
          .eq('session_id', sessionId)
          .order('pitch_number', { ascending: true });

        if (fullSwingSwingsData && fullSwingSwingsData.length > 0) {
          setFullSwingSwings(fullSwingSwingsData as FullSwingSwing[]);
        }
        return;
      }
    }

    if (isUUID) {
      // HitTrax session (could be paired)
      const { data: session } = await supabase
        .from('hittrax_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (session) {
        setSessionDate(session.session_date);

        // Get all HitTrax swings for this session
        const { data: hittraxSwingsData } = await supabase
          .from('hittrax_swings')
          .select('*')
          .eq('session_id', sessionId)
          .order('swing_timestamp', { ascending: true });

        let parsedHittraxSwings: HitTraxSwing[] = [];

        if (hittraxSwingsData && hittraxSwingsData.length > 0) {
          parsedHittraxSwings = hittraxSwingsData
            .filter(swing => swing.spray_chart_x !== 0 || swing.spray_chart_z !== 0)
            .map(swing => ({
              id: swing.id,
              exit_velocity: parseFloat(swing.exit_velocity || '0'),
              launch_angle: swing.launch_angle ? parseFloat(swing.launch_angle) : null,
              distance: swing.distance ? parseFloat(swing.distance) : null,
              horizontal_angle: swing.horizontal_angle ? parseFloat(swing.horizontal_angle) : null,
              // Spray position in feet. Some imports have no spray_chart_x/z;
              // derive it from spray angle + distance so the 2D chart still plots.
              ...sprayXZ(swing),
              poi_x: swing.poi_x ? parseFloat(swing.poi_x) : null,
              poi_y: swing.poi_y ? parseFloat(swing.poi_y) : null,
              poi_z: swing.poi_z ? parseFloat(swing.poi_z) : null,
              strike_zone_bottom: swing.strike_zone_bottom ? parseFloat(swing.strike_zone_bottom) : null,
              strike_zone_top: swing.strike_zone_top ? parseFloat(swing.strike_zone_top) : null,
              strike_zone_width: swing.strike_zone_width ? parseFloat(swing.strike_zone_width) : null,
              result: swing.result || '',
              hit_type: swing.hit_type || '',
              swing_timestamp: swing.swing_timestamp,
              pitch_velocity: parseFloat(swing.pitch_velocity || '0'),
              pitch_type: swing.pitch_type || '',
            }));
          setHittraxSwings(parsedHittraxSwings);
        }

        // Check for paired Blast data on same LOCAL date
        const sessionTimestamp = new Date(session.session_date);
        const localYear = sessionTimestamp.getFullYear();
        const localMonth = String(sessionTimestamp.getMonth() + 1).padStart(2, '0');
        const localDay = String(sessionTimestamp.getDate()).padStart(2, '0');
        const localDateStr = `${localYear}-${localMonth}-${localDay}`;

        const { data: blastSwingsData } = await supabase
          .from('blast_swings')
          .select('*')
          .eq('athlete_id', currentAthleteId)
          .eq('recorded_date', localDateStr)
          .order('created_at_utc', { ascending: true });

        if (blastSwingsData && blastSwingsData.length > 0) {
          setBlastSwings(blastSwingsData as BlastSwing[]);

          // Perform timestamp-based matching (7-second window)
          const maxTimeDiff = 7;
          const pairedData: PairedSwingData[] = [];
          const matchedHittraxIds = new Set<string>();

          blastSwingsData.forEach((blast: any) => {
            const blastTime = parseBlastTimestamp(blast as BlastSwing);
            let closestHittrax: HitTraxSwing | null = null;
            let minDiff = Infinity;

            parsedHittraxSwings.forEach((hittrax: HitTraxSwing) => {
              if (matchedHittraxIds.has(hittrax.id)) return;
              const hittraxTime = parseHitTraxTimestamp(hittrax.swing_timestamp);
              const diff = Math.abs(blastTime - hittraxTime) / 1000;

              if (diff <= maxTimeDiff && diff < minDiff) {
                minDiff = diff;
                closestHittrax = hittrax;
              }
            });

            if (closestHittrax) {
              matchedHittraxIds.add((closestHittrax as HitTraxSwing).id);
              pairedData.push({
                blastSwing: blast as BlastSwing,
                hittraxSwing: closestHittrax as HitTraxSwing,
                timeDiff: minDiff,
              });
            }
          });

          setPairedSwingData(pairedData);
          // Paired only when at least one Blast swing matched a HitTrax swing
          // within the 7s window — same-day Blast data alone is not a pairing.
          setSessionType(pairedData.length > 0 ? 'paired' : 'hittrax');
        } else {
          setBlastSwings([]);
          setPairedSwingData([]);
          setSessionType('hittrax');
        }
      }
    } else {
      // Date string - Blast-only session
      setSessionDate(sessionId);
      setSessionType('blast');

      const { data: blastSwingsData } = await supabase
        .from('blast_swings')
        .select('*')
        .eq('athlete_id', currentAthleteId)
        .eq('recorded_date', sessionId)
        .order('created_at_utc', { ascending: true });

      if (blastSwingsData && blastSwingsData.length > 0) {
        setBlastSwings(blastSwingsData as BlastSwing[]);
      }
    }
  }

  // Null-safe helpers: empty sets return null (rendered as "—" via fmt), never NaN/-Infinity.
  const nums = (arr: Array<number | null | undefined>) =>
    arr.filter((v): v is number => v != null && Number.isFinite(v));
  const avgOf = (arr: Array<number | null | undefined>) => {
    const v = nums(arr);
    return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const maxOf = (arr: Array<number | null | undefined>) => {
    const v = nums(arr);
    return v.length > 0 ? Math.max(...v) : null;
  };

  // Calculate Blast metrics
  const blastStats = {
    totalSwings: blastSwings.length,
    maxBatSpeed: maxOf(blastSwings.map(s => s.bat_speed)),
    avgBatSpeed: avgOf(blastSwings.map(s => s.bat_speed)),
    avgAttackAngle: avgOf(blastSwings.map(s => s.attack_angle)),
  };

  // Calculate HitTrax metrics
  const htEVs = nums(hittraxSwings.map(s => s.exit_velocity)).filter(v => v > 0);
  const htLAs = nums(hittraxSwings.map(s => s.launch_angle));
  const hittraxStats = {
    totalSwings: hittraxSwings.length,
    maxExitVelocity: maxOf(htEVs),
    avgExitVelocity: avgOf(htEVs),
    maxDistance: maxOf(hittraxSwings.map(s => s.distance)),
    avgHorizontalAngle: avgOf(hittraxSwings.map(s => s.horizontal_angle)),
    hardHitPct: htEVs.length > 0 ? (htEVs.filter(v => v >= HARD_HIT_MPH).length / htEVs.length) * 100 : null,
    sweetSpotPct: htLAs.length > 0
      ? (htLAs.filter(v => v >= SWEET_SPOT[0] && v <= SWEET_SPOT[1]).length / htLAs.length) * 100
      : null,
  };

  // Calculate Full Swing metrics
  const fullSwingStats = {
    totalSwings: fullSwingSwings.length,
    contactSwings: fullSwingSwings.filter(s => s.exit_velocity && s.exit_velocity > 0).length,
    maxBatSpeed: maxOf(fullSwingSwings.map(s => s.bat_speed)) ?? fullSwingSession?.max_bat_speed ?? null,
    avgBatSpeed: avgOf(fullSwingSwings.map(s => s.bat_speed)) ?? fullSwingSession?.avg_bat_speed ?? null,
    maxExitVelocity: maxOf(fullSwingSwings.map(s => s.exit_velocity)) ?? fullSwingSession?.max_exit_velocity ?? null,
    avgExitVelocity: avgOf(fullSwingSwings.map(s => s.exit_velocity)) ?? fullSwingSession?.avg_exit_velocity ?? null,
    maxDistance: maxOf(fullSwingSwings.map(s => s.distance)) ?? fullSwingSession?.max_distance ?? null,
    avgSmashFactor: avgOf(fullSwingSwings.map(s => s.smash_factor)) ?? fullSwingSession?.avg_smash_factor ?? null,
    squaredUpRate: fullSwingSession?.squared_up_rate ?? null,
    hardHitCount: fullSwingSession?.hard_hit_count || 0,
    hardHitRate: fullSwingSession?.hard_hit_rate ?? null,
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }


  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={STEEL.hitting} />
        <Text style={styles.loadingText}>Loading session data...</Text>
      </View>
    );
  }

  // Header: weekday + date. Bare YYYY-MM-DD strings are parsed as local dates
  // (new Date('2026-01-05') is UTC midnight and would show the previous day).
  function headerTitle(dateStr: string): string {
    if (!dateStr) return 'Session';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateStr);
    if (isNaN(d.getTime())) return formatDate(dateStr) || 'Session';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  const sourceLabel: Record<SessionType, string> = {
    hittrax: 'HitTrax',
    paired: 'HitTrax + Blast',
    blast: 'Blast',
    fullswing: 'Full Swing',
  };
  const swingCount =
    sessionType === 'blast' ? blastSwings.length
      : sessionType === 'fullswing' ? fullSwingSwings.length
        : hittraxSwings.length;
  const showPairPill = sessionType === 'paired' || (sessionType === 'hittrax' && blastSwings.length > 0);

  // 3D hero balls
  const heroBalls =
    sessionType === 'fullswing'
      ? fullSwingSwings.map(s => ({
          exit_velocity: s.exit_velocity,
          launch_angle: s.launch_angle,
          horizontal_angle: s.spray_angle,
          distance: s.distance,
        }))
      : hittraxSwings.map(s => ({
          exit_velocity: s.exit_velocity,
          launch_angle: s.launch_angle,
          horizontal_angle: s.horizontal_angle,
          distance: s.distance,
        }));
  const heroHasFlight = heroBalls.some(b => b.distance && b.distance > 0 && b.launch_angle != null);

  const pct = (v: number | null) => (v == null ? null : v > 1 ? v : v * 100);

  const evLegend = (
    <View style={styles.legendRow}>
      {[
        { c: '#8d939c', l: `<90` },
        { c: STEEL.hitting2, l: '90-94' },
        { c: STEEL.hitting, l: `${HARD_HIT_MPH}+` },
      ].map(x => (
        <View key={x.l} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: x.c }]} />
          <Text style={styles.legendText}>{x.l} mph</Text>
        </View>
      ))}
    </View>
  );

  function SprayField({ points }: { points: Array<{ id: string; x: number; z: number; ev: number; onPress?: () => void; r: number }> }) {
    return (
      <View style={styles.sprayChartContainer}>
        <Svg viewBox="20 100 360 280" style={styles.sprayChart}>
          <Rect width="400" height="400" fill={STEEL.bg} />
          {/* Foul lines */}
          <Line x1="200" y1="370" x2="60" y2="230" stroke="#9ca3af" strokeWidth="1.5" opacity={0.6} />
          <Line x1="200" y1="370" x2="340" y2="230" stroke="#9ca3af" strokeWidth="1.5" opacity={0.6} />
          {/* Outfield fence */}
          <Path d="M 60 230 Q 100 140 200 136 Q 300 140 340 230" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity={0.35} />
          {/* Infield arc */}
          <Path d="M 162 316 Q 200 292 238 316" fill="none" stroke="#6b7280" strokeWidth="1.5" opacity={0.8} />
          {points.map(p => {
            const scale = 0.6;
            const x = 200 + p.x * scale;
            const y = 370 - p.z * scale;
            return (
              <Circle
                key={p.id}
                cx={Math.max(20, Math.min(380, x))}
                cy={Math.max(100, Math.min(380, y))}
                r={String(p.r)}
                fill={evColor(p.ev)}
                opacity={0.9}
                onPress={p.onPress}
              />
            );
          })}
        </Svg>
      </View>
    );
  }

  const summaryLine = (
    <Text style={styles.totalSwingsText}>
      {hittraxStats.totalSwings} HitTrax | {blastStats.totalSwings} Blast | {pairedSwingData.length} Paired
    </Text>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={STEEL.hitting} colors={[STEEL.hitting]} progressBackgroundColor="#11161d" />}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <AnimatedSection delay={0}>
          <View style={{ paddingTop: 44 }}>
            <ScreenHeader
              title={headerTitle(sessionDate)}
              subtitle={`${sourceLabel[sessionType]} session · ${swingCount} swings`}
              onBack={() => navigation.goBack()}
            />
            <View style={styles.headerMetaRow}>
              <Text style={styles.headerDate}>{formatDate(sessionDate)}</Text>
              {sessionType === 'paired' ? (
                <View style={styles.pairedBadge}>
                  <Ionicons name="link" size={10} color={STEEL.good} />
                  <Text style={styles.pairedBadgeText}>PAIRED</Text>
                </View>
              ) : showPairPill ? (
                <View style={styles.notPairedBadge}>
                  <Text style={styles.notPairedBadgeText}>NOT PAIRED</Text>
                </View>
              ) : null}
            </View>
          </View>
        </AnimatedSection>

        {/* 3D ball-flight hero (HitTrax / Paired / Full Swing) */}
        {sessionType !== 'blast' && heroHasFlight && (
          <AnimatedSection delay={100}>
            <View style={steelStyles.body}>
              <Section first title="BALL FLIGHT" right={`${heroBalls.filter(b => b.distance && b.distance > 0).length} balls`}>
                <BallField3D balls={heroBalls} height={260} bleed={16} caption="Every ball in play · colored by exit velo" />
              </Section>
            </View>
          </AnimatedSection>
        )}

        {/* No ball flight for Blast-only */}
        {sessionType === 'blast' && (
          <View style={steelStyles.body}>
            <Section first title="BALL FLIGHT">
              <Text style={steelStyles.empty}>No ball-flight data for Blast sessions</Text>
            </Section>
          </View>
        )}

        {/* Spray Chart (HitTrax & Paired) — tap a ball for details */}
        {(sessionType === 'hittrax' || sessionType === 'paired') && hittraxSwings.length > 0 && (
          <AnimatedSection delay={200}>
            <View style={steelStyles.body}>
              <Section title="SPRAY CHART" right="Tap a ball">
                <SprayField
                  points={hittraxSwings.map(swing => ({
                    id: swing.id,
                    x: swing.spray_chart_x,
                    z: swing.spray_chart_z,
                    ev: swing.exit_velocity,
                    r: 8,
                    onPress: () => setSelectedSwing(swing),
                  }))}
                />
                {evLegend}
              </Section>
            </View>
          </AnimatedSection>
        )}

        {/* Spray Chart for Full Swing */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={steelStyles.body}>
            <Section title="SPRAY CHART">
              <SprayField
                points={fullSwingSwings
                  .filter(s => s.spray_angle !== null && s.distance !== null && s.exit_velocity !== null)
                  .map(swing => {
                    // convert spray_angle + distance to x/z
                    const radians = (swing.spray_angle! * Math.PI) / 180;
                    return {
                      id: swing.id,
                      x: swing.distance! * Math.sin(radians),
                      z: swing.distance! * Math.cos(radians),
                      ev: swing.exit_velocity!,
                      r: 6,
                    };
                  })}
              />
              {evLegend}
            </Section>
          </View>
        )}

        {/* Contact Point 3D (HitTrax & Paired) */}
        {(sessionType === 'hittrax' || sessionType === 'paired') &&
          hittraxSwings.some((s) => s.poi_x != null && s.poi_z != null) && (
          <View style={steelStyles.body}>
            <Section title="CONTACT POINT">
              <ContactPoint3D hittraxSwings={hittraxSwings} />
            </Section>
          </View>
        )}

        {/* Session Summary Stats */}
        <AnimatedSection delay={400}>
          <View style={steelStyles.body}>
            <Section title="SESSION SUMMARY">
              {/* Blast Only */}
              {sessionType === 'blast' && (
                <KpiRow>
                  <Kpi label="SWINGS" value={String(blastStats.totalSwings)} />
                  <Kpi label="MAX BAT" value={fmt(blastStats.maxBatSpeed)} unit="mph" color={STEEL.cyan} />
                  <Kpi label="AVG BAT" value={fmt(blastStats.avgBatSpeed)} unit="mph" color={STEEL.cyan} />
                  <Kpi label="AVG AA" value={fmt(blastStats.avgAttackAngle)} unit="°" color={STEEL.purple} />
                </KpiRow>
              )}

              {/* HitTrax Only */}
              {sessionType === 'hittrax' && (
                <View style={{ gap: 16 }}>
                  <KpiRow>
                    <Kpi label="SWINGS" value={String(hittraxStats.totalSwings)} />
                    <Kpi label="MAX EV" value={fmt(hittraxStats.maxExitVelocity)} unit="mph" color={STEEL.hitting} />
                    <Kpi label="AVG EV" value={fmt(hittraxStats.avgExitVelocity)} unit="mph" color={STEEL.hitting2} />
                  </KpiRow>
                  <KpiRow>
                    <Kpi label="MAX DIST" value={fmt(hittraxStats.maxDistance, 0)} unit="ft" />
                    <Kpi label="HARD HIT" value={fmt(hittraxStats.hardHitPct, 0)} unit="%" color={STEEL.hitting} note={`${HARD_HIT_MPH}+ mph`} />
                    <Kpi label="SWEET SPOT" value={fmt(hittraxStats.sweetSpotPct, 0)} unit="%" color={STEEL.good} note={`${SWEET_SPOT[0]}–${SWEET_SPOT[1]}° LA`} />
                  </KpiRow>
                </View>
              )}

              {/* Paired */}
              {sessionType === 'paired' && (
                <View>
                  <Text style={styles.sourceLabel}>HITTRAX</Text>
                  <KpiRow>
                    <Kpi label="MAX EV" value={fmt(hittraxStats.maxExitVelocity)} unit="mph" color={STEEL.hitting} size={20} />
                    <Kpi label="AVG EV" value={fmt(hittraxStats.avgExitVelocity)} unit="mph" color={STEEL.hitting2} size={20} />
                    <Kpi label="MAX DIST" value={fmt(hittraxStats.maxDistance, 0)} unit="ft" size={20} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={styles.kpiLabelLocal}>SPRAY DIR</Text>
                      {hittraxStats.avgHorizontalAngle !== null ? (
                        <View style={styles.sprayDirectionRow}>
                          <Ionicons
                            name="arrow-up"
                            size={14}
                            color="#FFFFFF"
                            style={{ transform: [{ rotate: `${-hittraxStats.avgHorizontalAngle}deg` }] }}
                          />
                          <Text style={styles.kpiValueLocal}>{fmt(Math.abs(hittraxStats.avgHorizontalAngle))}°</Text>
                        </View>
                      ) : (
                        <Text style={[styles.kpiValueLocal, { color: STEEL.past }]}>—</Text>
                      )}
                    </View>
                  </KpiRow>

                  <View style={styles.sourceDivider} />
                  <Text style={[styles.sourceLabel, { color: STEEL.cyan }]}>BLAST</Text>
                  <KpiRow>
                    <Kpi label="MAX BAT" value={fmt(blastStats.maxBatSpeed)} unit="mph" color={STEEL.cyan} size={20} />
                    <Kpi label="AVG BAT" value={fmt(blastStats.avgBatSpeed)} unit="mph" color={STEEL.cyan} size={20} />
                    <Kpi label="AVG AA" value={fmt(blastStats.avgAttackAngle)} unit="°" color={STEEL.purple} size={20} />
                  </KpiRow>

                  <View style={styles.sourceDivider} />
                  {summaryLine}
                </View>
              )}

              {/* Full Swing grid */}
              {sessionType === 'fullswing' && (
                <View style={{ gap: 16 }}>
                  <KpiRow>
                    <Kpi label="SWINGS" value={String(fullSwingStats.totalSwings)} />
                    <Kpi label="MAX BAT" value={fmt(fullSwingStats.maxBatSpeed)} unit="mph" color={STEEL.cyan} note={`Avg ${fmt(fullSwingStats.avgBatSpeed)}`} />
                    <Kpi label="MAX EV" value={fmt(fullSwingStats.maxExitVelocity)} unit="mph" color={STEEL.hitting} note={`Avg ${fmt(fullSwingStats.avgExitVelocity)}`} />
                  </KpiRow>
                  <KpiRow>
                    <Kpi label="MAX DIST" value={fmt(fullSwingStats.maxDistance, 0)} unit="ft" />
                    <Kpi
                      label="SMASH"
                      value={fmt(fullSwingStats.avgSmashFactor, 2)}
                      color={STEEL.purple}
                      note={fullSwingSession?.max_smash_factor != null ? `Max ${fmt(fullSwingSession.max_smash_factor, 2)}` : undefined}
                    />
                    {fullSwingStats.squaredUpRate !== null && (
                      <Kpi label="SQUARED UP" value={fmt(pct(fullSwingStats.squaredUpRate), 0)} unit="%" color={STEEL.good} />
                    )}
                    {fullSwingStats.hardHitRate !== null && (
                      <Kpi
                        label="HARD HIT"
                        value={fmt(pct(fullSwingStats.hardHitRate), 0)}
                        unit="%"
                        color={STEEL.bad}
                        note={`${fullSwingStats.hardHitCount} hits`}
                      />
                    )}
                  </KpiRow>
                </View>
              )}
            </Section>
          </View>
        </AnimatedSection>

        {/* Every swing (HitTrax) — tap a row for the swing sheet */}
        {sessionType === 'hittrax' && hittraxSwings.length > 0 && (
          <View style={steelStyles.body}>
            <Section title="EVERY SWING" right={`${hittraxSwings.length} swings`}>
              <View style={styles.everyHeader}>
                <Text style={[styles.everyHead, { flex: 0.5, textAlign: 'left' }]}>#</Text>
                <Text style={styles.everyHead}>EV</Text>
                <Text style={styles.everyHead}>LA</Text>
                <Text style={styles.everyHead}>DIST</Text>
                <Text style={styles.everyHead}>SPRAY</Text>
              </View>
              {hittraxSwings.map((swing, idx) => (
                <TouchableOpacity key={swing.id} style={styles.everyRow} onPress={() => setSelectedSwing(swing)} activeOpacity={0.6}>
                  <Text style={[styles.everyCell, { flex: 0.5, textAlign: 'left', color: STEEL.mute }]}>{idx + 1}</Text>
                  <Text style={[styles.everyCell, styles.everyStrong, { color: evColor(swing.exit_velocity) }]}>{fmt(swing.exit_velocity)}</Text>
                  <Text style={styles.everyCell}>{swing.launch_angle != null ? `${fmt(swing.launch_angle, 0)}°` : '—'}</Text>
                  <Text style={styles.everyCell}>{fmt(swing.distance, 0)}</Text>
                  <Text style={styles.everyCell}>
                    {swing.horizontal_angle != null ? `${fmt(swing.horizontal_angle, 0)}°` : '—'}
                  </Text>
                </TouchableOpacity>
              ))}
            </Section>
          </View>
        )}

        <AnimatedSection delay={600}>
        {/* Full Swing: Bat Speed vs Exit Velocity Chart */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="BAT SPEED VS EXIT VELOCITY" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Each swing showing the relationship between bat speed and exit velocity. Higher smash factor = more efficient energy transfer.
            </Text>

            {(() => {
              const validSwings = fullSwingSwings.filter(s => s.bat_speed && s.exit_velocity);
              if (validSwings.length === 0) return <Text style={styles.noDataText}>No data available</Text>;

              const batSpeeds = validSwings.map(s => s.bat_speed!);
              const exitVelos = validSwings.map(s => s.exit_velocity!);
              const minBS = Math.max(0, Math.floor(Math.min(...batSpeeds) / 5) * 5 - 5);
              const maxBS = Math.ceil(Math.max(...batSpeeds) / 5) * 5 + 5;
              const minEV = Math.max(0, Math.floor(Math.min(...exitVelos) / 10) * 10 - 10);
              const maxEV = Math.ceil(Math.max(...exitVelos) / 10) * 10 + 10;

              const avgBS = batSpeeds.reduce((a, b) => a + b, 0) / batSpeeds.length;
              const avgEV = exitVelos.reduce((a, b) => a + b, 0) / exitVelos.length;

              // Scale to match HitTrax charts: viewBox 360x360
              const scaleX = (val: number) => 30 + ((val - minBS) / (maxBS - minBS)) * 320;
              const scaleY = (val: number) => 330 - ((val - minEV) / (maxEV - minEV)) * 320;

              return (
                <View style={styles.scatterChartContainer}>
                  <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                    <Rect width="360" height="360" fill="#000000" />

                    {/* Grid lines */}
                    {Array.from({ length: 5 }, (_, i) => {
                      const y = 10 + (i * 320 / 4);
                      const val = maxEV - (i * (maxEV - minEV) / 4);
                      return (
                        <G key={`h-${i}`}>
                          <Line x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />
                          <SvgText x="25" y={y + 4} textAnchor="end" fontSize="9" fill="#6b7280">{Math.round(val)}</SvgText>
                        </G>
                      );
                    })}
                    {Array.from({ length: 5 }, (_, i) => {
                      const x = 30 + (i * 320 / 4);
                      const val = minBS + (i * (maxBS - minBS) / 4);
                      return (
                        <G key={`v-${i}`}>
                          <Line x1={x} y1="10" x2={x} y2="330" stroke="#1f2937" strokeWidth="0.5" />
                          <SvgText x={x} y="345" textAnchor="middle" fontSize="9" fill="#6b7280">{Math.round(val)}</SvgText>
                        </G>
                      );
                    })}

                    {/* Axes */}
                    <Line x1="30" y1="330" x2="350" y2="330" stroke="#6b7280" strokeWidth="2" />
                    <Line x1="30" y1="10" x2="30" y2="330" stroke="#6b7280" strokeWidth="2" />

                    {/* Data points */}
                    {validSwings.map((swing, idx) => {
                      const smash = swing.smash_factor || (swing.exit_velocity! / swing.bat_speed!);
                      let color = '#3d4f5f';
                      if (smash >= 1.3) color = '#fb923c';
                      else if (smash >= 1.2) color = '#fdba74';
                      else if (smash >= 1.1) color = '#8d939c';
                      return (
                        <Circle
                          key={idx}
                          cx={Math.max(30, Math.min(350, scaleX(swing.bat_speed!)))}
                          cy={Math.max(10, Math.min(330, scaleY(swing.exit_velocity!)))}
                          r="4"
                          fill={color}
                          opacity={0.8}
                        />
                      );
                    })}

                    {/* Average lines */}
                    <Line
                      x1={scaleX(avgBS)}
                      y1="10"
                      x2={scaleX(avgBS)}
                      y2="330"
                      stroke="#22D3EE"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      opacity={0.8}
                    />
                    <Line
                      x1="30"
                      y1={scaleY(avgEV)}
                      x2="350"
                      y2={scaleY(avgEV)}
                      stroke="#fb923c"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      opacity={0.8}
                    />

                    {/* Stats box */}
                    <Rect x="235" y="15" width="110" height="60" fill="#000000" opacity={0.85} rx="4" />
                    <SvgText x="290" y="32" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
                    <SvgText x="240" y="47" fill="#22D3EE" fontSize="9">Bat Speed:</SvgText>
                    <SvgText x="340" y="47" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgBS.toFixed(1)} mph</SvgText>
                    <SvgText x="240" y="62" fill="#fb923c" fontSize="9">Exit Velo:</SvgText>
                    <SvgText x="340" y="62" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgEV.toFixed(1)} mph</SvgText>

                    {/* Axis labels */}
                    <SvgText x="190" y="355" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Bat Speed (mph)</SvgText>
                  </Svg>
                </View>
              );
            })()}

            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#fb923c' }]} />
                <Text style={styles.legendText}>Smash 1.3+</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#fdba74' }]} />
                <Text style={styles.legendText}>1.2-1.29</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#8d939c' }]} />
                <Text style={styles.legendText}>1.1-1.19</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#3d4f5f' }]} />
                <Text style={styles.legendText}>&lt;1.1</Text>
              </View>
            </View>
          </View>
        )}

        {/* Full Swing: Exit Velocity Distribution Histogram */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="EXIT VELOCITY DISTRIBUTION" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Distribution of exit velocities across all swings (5 mph buckets).
            </Text>

            {(() => {
              const validSwings = fullSwingSwings.filter(s => s.exit_velocity && s.exit_velocity > 0);
              if (validSwings.length === 0) return <Text style={styles.noDataText}>No data available</Text>;

              const velocities = validSwings.map(s => s.exit_velocity!);
              const minEV = Math.floor(Math.min(...velocities) / 5) * 5;
              const maxEV = Math.ceil(Math.max(...velocities) / 5) * 5;
              const avgEV = velocities.reduce((sum, v) => sum + v, 0) / velocities.length;

              // Create 5 mph buckets
              const buckets: { min: number; max: number; count: number }[] = [];
              for (let i = minEV; i < maxEV; i += 5) {
                const count = velocities.filter(v => v >= i && v < i + 5).length;
                buckets.push({ min: i, max: i + 5, count });
              }

              const maxCount = Math.max(...buckets.map(b => b.count));
              if (maxCount === 0) return <Text style={styles.noDataText}>No data available</Text>;

              const chartWidth = 320;
              const chartHeight = 220;
              const barWidth = chartWidth / buckets.length - 2;

              // Create smooth curve path
              const points = buckets.map((bucket, idx) => {
                const x = 30 + (idx * (chartWidth / buckets.length)) + (chartWidth / buckets.length / 2);
                const y = 250 - (bucket.count / maxCount) * chartHeight;
                return { x, y };
              });

              // Create smooth bezier curve through points
              let pathD = `M ${points[0].x} ${points[0].y}`;
              for (let i = 1; i < points.length; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                const cpx1 = prev.x + (curr.x - prev.x) / 3;
                const cpx2 = prev.x + 2 * (curr.x - prev.x) / 3;
                pathD += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
              }

              // Area fill path
              const areaPath = pathD + ` L ${points[points.length - 1].x} 250 L ${points[0].x} 250 Z`;

              return (
                <View>
                  <View style={styles.barChartContainer}>
                    <Svg viewBox="0 0 360 300" style={styles.barChart}>
                      <Rect width="360" height="300" fill="#000000" />

                      {/* Grid lines */}
                      {[0.25, 0.5, 0.75, 1].map((pct, idx) => {
                        const y = 250 - pct * chartHeight;
                        return (
                          <G key={idx}>
                            <Line x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />
                          </G>
                        );
                      })}

                      {/* Bars with gradient effect */}
                      {buckets.map((bucket, idx) => {
                        const x = 30 + (idx * (chartWidth / buckets.length)) + 1;
                        const barHeight = (bucket.count / maxCount) * chartHeight;
                        const y = 250 - barHeight;

                        return (
                          <Rect
                            key={idx}
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            fill="#fb923c"
                            opacity={0.4}
                            rx={2}
                          />
                        );
                      })}

                      {/* Smooth curve area fill */}
                      <Path d={areaPath} fill="#fb923c" opacity={0.2} />

                      {/* Smooth curve line */}
                      <Path d={pathD} stroke="#fb923c" strokeWidth="3" fill="none" />

                      {/* Data points */}
                      {points.map((point, idx) => (
                        <Circle key={idx} cx={point.x} cy={point.y} r="4" fill="#fb923c" />
                      ))}

                      {/* Average line */}
                      {(() => {
                        const avgX = 30 + ((avgEV - minEV) / (maxEV - minEV)) * chartWidth;
                        return (
                          <G>
                            <Line x1={avgX} y1="30" x2={avgX} y2="250" stroke="#F5F0E6" strokeWidth="2" strokeDasharray="4,4" />
                            <SvgText x={avgX} y="22" fill="#F5F0E6" fontSize="10" textAnchor="middle" fontWeight="600">Avg: {avgEV.toFixed(1)}</SvgText>
                          </G>
                        );
                      })()}

                      {/* X-axis labels */}
                      {buckets.filter((_, idx) => idx % 2 === 0 || buckets.length <= 8).map((bucket, idx) => {
                        const actualIdx = buckets.indexOf(bucket);
                        const x = 30 + (actualIdx * (chartWidth / buckets.length)) + (chartWidth / buckets.length / 2);
                        return (
                          <SvgText key={idx} x={x} y="268" fill="#9ca3af" fontSize="9" textAnchor="middle">
                            {bucket.min}
                          </SvgText>
                        );
                      })}

                      {/* Axes */}
                      <Line x1="30" y1="250" x2="350" y2="250" stroke="#6b7280" strokeWidth="1.5" />
                      <Line x1="30" y1="30" x2="30" y2="250" stroke="#6b7280" strokeWidth="1.5" />

                      {/* Y-axis label */}
                      <SvgText x="15" y="140" fill="#9ca3af" fontSize="9" textAnchor="middle" transform="rotate(-90, 15, 140)">Count</SvgText>

                      {/* X-axis label */}
                      <SvgText x="190" y="288" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Exit Velocity (mph)</SvgText>
                    </Svg>
                  </View>

                  {/* Stats summary row */}
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Avg: <Text style={{ color: '#fb923c', fontWeight: '600' }}>{avgEV.toFixed(1)} mph</Text></Text>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Max: <Text style={{ color: '#F5F0E6', fontWeight: '600' }}>{Math.max(...velocities).toFixed(1)} mph</Text></Text>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Swings: <Text style={{ color: '#ffffff', fontWeight: '600' }}>{validSwings.length}</Text></Text>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Full Swing: Bat Speed Distribution Histogram */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="BAT SPEED DISTRIBUTION" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Distribution of bat speeds across all swings (1 mph increments).
            </Text>

            {(() => {
              const validSwings = fullSwingSwings.filter(s => s.bat_speed && s.bat_speed > 0);
              if (validSwings.length === 0) return <Text style={styles.noDataText}>No bat speed data available</Text>;

              const speeds = validSwings.map(s => s.bat_speed!);
              const minBS = Math.floor(Math.min(...speeds));
              const maxBS = Math.ceil(Math.max(...speeds));
              const avgBS = speeds.reduce((sum, v) => sum + v, 0) / speeds.length;

              // Create 1 mph buckets
              const buckets: { speed: number; count: number }[] = [];
              for (let i = minBS; i <= maxBS; i++) {
                const count = speeds.filter(v => Math.floor(v) === i).length;
                buckets.push({ speed: i, count });
              }

              const maxCount = Math.max(...buckets.map(b => b.count));
              if (maxCount === 0) return <Text style={styles.noDataText}>No data available</Text>;

              const chartWidth = 320;
              const chartHeight = 220;
              const barWidth = Math.max(2, chartWidth / buckets.length - 1);

              // Create smooth curve path
              const points = buckets.map((bucket, idx) => {
                const x = 30 + (idx * (chartWidth / buckets.length)) + (chartWidth / buckets.length / 2);
                const y = 250 - (bucket.count / maxCount) * chartHeight;
                return { x, y };
              });

              // Create smooth bezier curve through points
              let pathD = `M ${points[0].x} ${points[0].y}`;
              for (let i = 1; i < points.length; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                const cpx1 = prev.x + (curr.x - prev.x) / 3;
                const cpx2 = prev.x + 2 * (curr.x - prev.x) / 3;
                pathD += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
              }

              // Area fill path
              const areaPath = pathD + ` L ${points[points.length - 1].x} 250 L ${points[0].x} 250 Z`;

              return (
                <View>
                  <View style={styles.barChartContainer}>
                    <Svg viewBox="0 0 360 300" style={styles.barChart}>
                      <Rect width="360" height="300" fill="#000000" />

                      {/* Grid lines */}
                      {[0.25, 0.5, 0.75, 1].map((pct, idx) => {
                        const y = 250 - pct * chartHeight;
                        return (
                          <G key={idx}>
                            <Line x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />
                          </G>
                        );
                      })}

                      {/* Bars with gradient effect */}
                      {buckets.map((bucket, idx) => {
                        const x = 30 + (idx * (chartWidth / buckets.length)) + 0.5;
                        const barHeight = (bucket.count / maxCount) * chartHeight;
                        const y = 250 - barHeight;

                        return (
                          <Rect
                            key={idx}
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            fill="#22D3EE"
                            opacity={0.4}
                            rx={1}
                          />
                        );
                      })}

                      {/* Smooth curve area fill */}
                      <Path d={areaPath} fill="#22D3EE" opacity={0.2} />

                      {/* Smooth curve line */}
                      <Path d={pathD} stroke="#22D3EE" strokeWidth="3" fill="none" />

                      {/* Data points - only show if few enough buckets */}
                      {buckets.length <= 20 && points.map((point, idx) => (
                        <Circle key={idx} cx={point.x} cy={point.y} r="3" fill="#22D3EE" />
                      ))}

                      {/* Average line */}
                      {(() => {
                        const avgX = 30 + ((avgBS - minBS) / (maxBS - minBS)) * chartWidth;
                        return (
                          <G>
                            <Line x1={avgX} y1="30" x2={avgX} y2="250" stroke="#F5F0E6" strokeWidth="2" strokeDasharray="4,4" />
                            <SvgText x={avgX} y="22" fill="#F5F0E6" fontSize="10" textAnchor="middle" fontWeight="600">Avg: {avgBS.toFixed(1)}</SvgText>
                          </G>
                        );
                      })()}

                      {/* X-axis labels - show every nth label based on bucket count */}
                      {(() => {
                        const step = buckets.length > 15 ? Math.ceil(buckets.length / 8) : 1;
                        return buckets.filter((_, idx) => idx % step === 0).map((bucket) => {
                          const actualIdx = buckets.indexOf(bucket);
                          const x = 30 + (actualIdx * (chartWidth / buckets.length)) + (chartWidth / buckets.length / 2);
                          return (
                            <SvgText key={bucket.speed} x={x} y="268" fill="#9ca3af" fontSize="9" textAnchor="middle">
                              {bucket.speed}
                            </SvgText>
                          );
                        });
                      })()}

                      {/* Axes */}
                      <Line x1="30" y1="250" x2="350" y2="250" stroke="#6b7280" strokeWidth="1.5" />
                      <Line x1="30" y1="30" x2="30" y2="250" stroke="#6b7280" strokeWidth="1.5" />

                      {/* Y-axis label */}
                      <SvgText x="15" y="140" fill="#9ca3af" fontSize="9" textAnchor="middle" transform="rotate(-90, 15, 140)">Count</SvgText>

                      {/* X-axis label */}
                      <SvgText x="190" y="288" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Bat Speed (mph)</SvgText>
                    </Svg>
                  </View>

                  {/* Stats summary row */}
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Avg: <Text style={{ color: '#22D3EE', fontWeight: '600' }}>{avgBS.toFixed(1)} mph</Text></Text>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Max: <Text style={{ color: '#F5F0E6', fontWeight: '600' }}>{Math.max(...speeds).toFixed(1)} mph</Text></Text>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Swings: <Text style={{ color: '#ffffff', fontWeight: '600' }}>{validSwings.length}</Text></Text>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Full Swing: Exit Velocity vs Launch Angle */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="EXIT VELOCITY VS LAUNCH ANGLE" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Relationship between exit velocity and launch angle. Sweet spot launch angle: 8-32°.
            </Text>

            {(() => {
              const validSwings = fullSwingSwings.filter(s => s.exit_velocity && s.launch_angle !== null);
              if (validSwings.length === 0) return <Text style={styles.noDataText}>No data available</Text>;

              const avgExitVelo = validSwings.reduce((sum, s) => sum + s.exit_velocity!, 0) / validSwings.length;
              const avgLaunchAngle = validSwings.reduce((sum, s) => sum + s.launch_angle!, 0) / validSwings.length;

              // Use same scale as HitTrax: 40-120 mph EV, -20 to 80 degrees LA
              const scaleX = (val: number) => 30 + ((val - 40) / 80) * 320;
              const scaleY = (val: number) => 330 - ((val + 20) / 100) * 320;

              return (
                <View>
                  <View style={styles.scatterChartContainer}>
                    <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                      <Rect width="360" height="360" fill="#000000" />

                      {/* Ideal launch angle zone (SWEET_SPOT 8-32°) */}
                      {(() => {
                        const yMin = 330 - ((SWEET_SPOT[1] + 20) / 100) * 320;
                        const yMax = 330 - ((SWEET_SPOT[0] + 20) / 100) * 320;
                        return <Rect x={30} y={yMin} width={320} height={yMax - yMin} fill="#34d399" opacity={0.07} />;
                      })()}

                      {/* Grid lines */}
                      {[40, 60, 80, 100, 120].map(val => {
                        const x = 30 + ((val - 40) / 80) * 320;
                        return <Line key={`v-${val}`} x1={x} y1="10" x2={x} y2="330" stroke="#1f2937" strokeWidth="0.5" />;
                      })}
                      {[-20, 0, 20, 40, 60, 80].map(val => {
                        const y = 330 - ((val + 20) / 100) * 320;
                        return <Line key={`h-${val}`} x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />;
                      })}

                      {/* Axes */}
                      <Line x1="30" y1="330" x2="350" y2="330" stroke="#6b7280" strokeWidth="2" />
                      <Line x1="30" y1="10" x2="30" y2="330" stroke="#6b7280" strokeWidth="2" />

                      {/* Plot points */}
                      {validSwings.map((swing, idx) => {
                        const x = scaleX(swing.exit_velocity!);
                        const y = scaleY(swing.launch_angle!);
                        const inIdealRange = swing.launch_angle! >= SWEET_SPOT[0] && swing.launch_angle! <= SWEET_SPOT[1];

                        return (
                          <Circle
                            key={idx}
                            cx={Math.max(30, Math.min(350, x))}
                            cy={Math.max(10, Math.min(330, y))}
                            r="4"
                            fill={inIdealRange ? '#fb923c' : '#6b7280'}
                            opacity={0.8}
                          />
                        );
                      })}

                      {/* Average lines */}
                      <Line
                        x1={scaleX(avgExitVelo)}
                        y1="10"
                        x2={scaleX(avgExitVelo)}
                        y2="330"
                        stroke="#fb923c"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={scaleY(avgLaunchAngle)}
                        x2="350"
                        y2={scaleY(avgLaunchAngle)}
                        stroke="#fb923c"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="235" y="15" width="110" height="60" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="290" y="32" fill="#fb923c" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
                      <SvgText x="240" y="47" fill="#9ca3af" fontSize="9">Exit Velo:</SvgText>
                      <SvgText x="340" y="47" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgExitVelo.toFixed(1)} mph</SvgText>
                      <SvgText x="240" y="62" fill="#9ca3af" fontSize="9">Launch Angle:</SvgText>
                      <SvgText x="340" y="62" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgLaunchAngle.toFixed(1)}°</SvgText>

                      {/* Axis labels */}
                      <SvgText x="190" y="355" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Exit Velocity (mph)</SvgText>
                    </Svg>
                  </View>
                </View>
              );
            })()}

            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#fb923c' }]} />
                <Text style={styles.legendText}>95+ mph</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#fdba74' }]} />
                <Text style={styles.legendText}>85-94</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#8d939c' }]} />
                <Text style={styles.legendText}>75-84</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#3d4f5f' }]} />
                <Text style={styles.legendText}>&lt;75</Text>
              </View>
            </View>
          </View>
        )}

        {/* Full Swing: Launch Angle vs Distance */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="LAUNCH ANGLE VS DISTANCE" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              How launch angle affects ball distance. Sweet spot launch angle: 8-32°.
            </Text>

            {(() => {
              const validSwings = fullSwingSwings.filter(s => s.launch_angle !== null && s.distance && s.distance > 0);
              if (validSwings.length === 0) return <Text style={styles.noDataText}>No data available</Text>;

              const avgLA = validSwings.reduce((sum, s) => sum + s.launch_angle!, 0) / validSwings.length;
              const avgDist = validSwings.reduce((sum, s) => sum + s.distance!, 0) / validSwings.length;
              const maxDist = Math.max(...validSwings.map(s => s.distance!));

              // Scale: -20 to 80 degrees LA, 0 to 450 ft distance
              const scaleX = (val: number) => 30 + ((val + 20) / 100) * 320;
              const scaleY = (val: number) => 330 - (val / 450) * 320;

              return (
                <View>
                  <View style={styles.scatterChartContainer}>
                    <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                      <Rect width="360" height="360" fill="#000000" />

                      {/* Ideal launch angle zone (SWEET_SPOT 8-32°) */}
                      {(() => {
                        const xMin = scaleX(SWEET_SPOT[0]);
                        const xMax = scaleX(SWEET_SPOT[1]);
                        return <Rect x={xMin} y={10} width={xMax - xMin} height={320} fill="#34d399" opacity={0.07} />;
                      })()}

                      {/* Grid lines */}
                      {[-20, 0, 20, 40, 60, 80].map(val => {
                        const x = scaleX(val);
                        return <Line key={`v-${val}`} x1={x} y1="10" x2={x} y2="330" stroke="#1f2937" strokeWidth="0.5" />;
                      })}
                      {[0, 100, 200, 300, 400].map(val => {
                        const y = scaleY(val);
                        return <Line key={`h-${val}`} x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />;
                      })}

                      {/* Axes */}
                      <Line x1="30" y1="330" x2="350" y2="330" stroke="#6b7280" strokeWidth="2" />
                      <Line x1="30" y1="10" x2="30" y2="330" stroke="#6b7280" strokeWidth="2" />

                      {/* Plot points */}
                      {validSwings.map((swing, idx) => {
                        let color = '#3d4f5f';
                        if (swing.distance! >= 300) color = '#fb923c';
                        else if (swing.distance! >= 250) color = '#fdba74';
                        else if (swing.distance! >= 200) color = '#8d939c';
                        const inIdealRange = swing.launch_angle! >= SWEET_SPOT[0] && swing.launch_angle! <= SWEET_SPOT[1];

                        return (
                          <Circle
                            key={idx}
                            cx={Math.max(30, Math.min(350, scaleX(swing.launch_angle!)))}
                            cy={Math.max(10, Math.min(330, scaleY(swing.distance!)))}
                            r="4"
                            fill={inIdealRange ? color : '#6b7280'}
                            opacity={0.8}
                          />
                        );
                      })}

                      {/* Average lines */}
                      <Line
                        x1={scaleX(avgLA)}
                        y1="10"
                        x2={scaleX(avgLA)}
                        y2="330"
                        stroke="#fb923c"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={scaleY(avgDist)}
                        x2="350"
                        y2={scaleY(avgDist)}
                        stroke="#fb923c"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="235" y="15" width="110" height="60" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="290" y="32" fill="#fb923c" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
                      <SvgText x="240" y="47" fill="#9ca3af" fontSize="9">Launch Angle:</SvgText>
                      <SvgText x="340" y="47" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgLA.toFixed(1)}°</SvgText>
                      <SvgText x="240" y="62" fill="#9ca3af" fontSize="9">Distance:</SvgText>
                      <SvgText x="340" y="62" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgDist.toFixed(0)} ft</SvgText>

                      {/* Axis labels */}
                      <SvgText x="190" y="355" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Launch Angle (°)</SvgText>
                    </Svg>
                  </View>
                </View>
              );
            })()}

            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#fb923c' }]} />
                <Text style={styles.legendText}>300+ ft</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#fdba74' }]} />
                <Text style={styles.legendText}>250-299</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#8d939c' }]} />
                <Text style={styles.legendText}>200-249</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#3d4f5f' }]} />
                <Text style={styles.legendText}>&lt;200</Text>
              </View>
            </View>
          </View>
        )}

        {/* Full Swing: Smash Factor Distribution */}
        {sessionType === 'fullswing' && (fullSwingSwings.length > 0 || fullSwingSession?.avg_smash_factor) && (
          <View style={styles.chartSection}>
            <Section title="SMASH FACTOR DISTRIBUTION" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Energy transfer efficiency (Exit Velo ÷ Bat Speed). Elite hitters achieve 1.3+ consistently.
            </Text>

            {(() => {
              const validSwings = fullSwingSwings.filter(s => s.bat_speed && s.exit_velocity);

              // Fallback to session-level data when swing-level data is missing
              if (validSwings.length === 0) {
                if (fullSwingSession?.avg_smash_factor) {
                  const avgSmash = fullSwingSession.avg_smash_factor;
                  const maxSmash = fullSwingSession.max_smash_factor || avgSmash;

                  // Estimate distribution based on avg smash factor
                  const estimatedLevel = avgSmash >= 1.3 ? 'Elite' : avgSmash >= 1.2 ? 'Excellent' : avgSmash >= 1.1 ? 'Good' : avgSmash >= 1.0 ? 'Average' : 'Below';
                  const levelColor = avgSmash >= 1.3 ? '#fb923c' : avgSmash >= 1.2 ? '#fdba74' : avgSmash >= 1.1 ? '#8d939c' : avgSmash >= 1.0 ? '#6b7280' : '#3d4f5f';

                  return (
                    <View>
                      <View style={styles.barChartContainer}>
                        <Svg viewBox="0 0 360 200" style={styles.barChart}>
                          <Rect width="360" height="200" fill="#000000" />

                          {/* Session Average Display */}
                          <SvgText x="180" y="40" fill="#9ca3af" fontSize="12" textAnchor="middle">Session Averages</SvgText>

                          <SvgText x="180" y="80" fill={levelColor} fontSize="48" fontWeight="bold" textAnchor="middle">{avgSmash.toFixed(2)}</SvgText>
                          <SvgText x="180" y="100" fill="#9ca3af" fontSize="11" textAnchor="middle">Average Smash Factor</SvgText>

                          <SvgText x="100" y="140" fill="#9ca3af" fontSize="10" textAnchor="middle">Max</SvgText>
                          <SvgText x="100" y="160" fill="#ffffff" fontSize="16" fontWeight="600" textAnchor="middle">{maxSmash.toFixed(2)}</SvgText>

                          <SvgText x="260" y="140" fill="#9ca3af" fontSize="10" textAnchor="middle">Level</SvgText>
                          <SvgText x="260" y="160" fill={levelColor} fontSize="14" fontWeight="600" textAnchor="middle">{estimatedLevel}</SvgText>
                        </Svg>
                      </View>
                    </View>
                  );
                }
                return <Text style={styles.noDataText}>No data available</Text>;
              }

              const smashFactors = validSwings.map(s => s.smash_factor || (s.exit_velocity! / s.bat_speed!));
              const avgSmash = smashFactors.reduce((a, b) => a + b, 0) / smashFactors.length;
              const maxSmash = Math.max(...smashFactors);

              // Distribution buckets
              const elite = smashFactors.filter(s => s >= 1.3).length;
              const excellent = smashFactors.filter(s => s >= 1.2 && s < 1.3).length;
              const good = smashFactors.filter(s => s >= 1.1 && s < 1.2).length;
              const average = smashFactors.filter(s => s >= 1.0 && s < 1.1).length;
              const below = smashFactors.filter(s => s < 1.0).length;

              const total = validSwings.length;
              const pctElite = (elite / total) * 100;
              const pctExcellent = (excellent / total) * 100;
              const pctGood = (good / total) * 100;
              const pctAverage = (average / total) * 100;
              const pctBelow = (below / total) * 100;

              const buckets = [
                { label: 'Elite (1.3+)', count: elite, pct: pctElite, color: '#fb923c' },
                { label: 'Excellent (1.2-1.29)', count: excellent, pct: pctExcellent, color: '#fdba74' },
                { label: 'Good (1.1-1.19)', count: good, pct: pctGood, color: '#8d939c' },
                { label: 'Average (1.0-1.09)', count: average, pct: pctAverage, color: '#6b7280' },
                { label: 'Below (<1.0)', count: below, pct: pctBelow, color: '#3d4f5f' },
              ];

              const maxPct = Math.max(...buckets.map(b => b.pct), 1);

              return (
                <View>
                  <View style={styles.barChartContainer}>
                    <Svg viewBox="0 0 360 300" style={styles.barChart}>
                      <Rect width="360" height="300" fill="#000000" />

                      {/* Horizontal bars */}
                      {buckets.map((bucket, idx) => {
                        const y = 30 + (idx * 50);
                        const barWidth = (bucket.pct / maxPct) * 240;

                        return (
                          <G key={bucket.label}>
                            <SvgText x="10" y={y + 15} fill={bucket.color} fontSize="10" fontWeight="600">{bucket.label}</SvgText>
                            <Rect x="10" y={y + 22} width={barWidth} height={20} fill={bucket.color} opacity={0.9} rx="3" />
                            <SvgText x={barWidth + 18} y={y + 36} fill="#ffffff" fontSize="10" fontWeight="600">{bucket.pct.toFixed(0)}%</SvgText>
                            <SvgText x="350" y={y + 36} fill="#6b7280" fontSize="9" textAnchor="end">{bucket.count} swings</SvgText>
                          </G>
                        );
                      })}

                      {/* Stats */}
                      <Rect x="260" y="10" width="90" height="55" fill="#000000" opacity={0.9} rx="4" />
                      <SvgText x="305" y="27" fill="#9ca3af" fontSize="9" textAnchor="middle">Session Stats</SvgText>
                      <SvgText x="265" y="42" fill="#9ca3af" fontSize="9">Avg:</SvgText>
                      <SvgText x="345" y="42" fill="#fb923c" fontSize="10" textAnchor="end" fontWeight="600">{avgSmash.toFixed(2)}</SvgText>
                      <SvgText x="265" y="55" fill="#9ca3af" fontSize="9">Max:</SvgText>
                      <SvgText x="345" y="55" fill="#ffffff" fontSize="10" textAnchor="end" fontWeight="600">{maxSmash.toFixed(2)}</SvgText>
                    </Svg>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Full Swing: Squared Up Analysis */}
        {sessionType === 'fullswing' && (fullSwingSwings.length > 0 || fullSwingSession?.squared_up_rate !== null) && (
          <View style={styles.chartSection}>
            <Section title="SQUARED UP ANALYSIS" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Swings with 80%+ barrel contact are squared up, producing better ball flight and exit velocity.
            </Text>

            {(() => {
              // Use session-level squared_up_rate if available, otherwise calculate from swings
              // Session squared_up_rate is stored as percentage (e.g., 45.5 = 45.5%)
              if (fullSwingSession?.squared_up_rate !== null && fullSwingSession?.squared_up_rate !== undefined) {
                // Use session-level data
                const sessionSquaredRate = fullSwingSession.squared_up_rate > 1
                  ? fullSwingSession.squared_up_rate
                  : fullSwingSession.squared_up_rate * 100;
                // Use session contact_swings when swing-level data is missing
                const totalSwings = fullSwingSwings.length > 0 ? fullSwingStats.totalSwings : (fullSwingSession.contact_swings || fullSwingSession.total_swings || 0);
                const squaredCount = Math.round((sessionSquaredRate / 100) * totalSwings);
                const notSquaredCount = totalSwings - squaredCount;

                // Calculate avg EV for squared vs not (from swings with squared_up >= 80)
                const validSwings = fullSwingSwings.filter(s => s.squared_up !== null);
                const squaredSwings = validSwings.filter(s => s.squared_up! >= 80);
                const notSquaredSwings = validSwings.filter(s => s.squared_up! < 80);

                // Use swing-level data if available, otherwise use session average
                const avgEVSquared = squaredSwings.length > 0
                  ? squaredSwings.filter(s => s.exit_velocity).reduce((a, s) => a + s.exit_velocity!, 0) / squaredSwings.filter(s => s.exit_velocity).length
                  : (fullSwingSession.avg_exit_velocity || 0);
                const avgEVNotSquared = notSquaredSwings.length > 0
                  ? notSquaredSwings.filter(s => s.exit_velocity).reduce((a, s) => a + s.exit_velocity!, 0) / notSquaredSwings.filter(s => s.exit_velocity).length
                  : 0;

                return (
                  <View>
                    <View style={styles.scatterChartContainer}>
                      <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                        <Rect width="360" height="360" fill="#000000" />
                        <Circle cx="180" cy="160" r="100" fill="none" stroke="#3d4f5f" strokeWidth="30" />
                        <Circle
                          cx="180"
                          cy="160"
                          r="100"
                          fill="none"
                          stroke="#34d399"
                          strokeWidth="30"
                          strokeDasharray={`${(sessionSquaredRate / 100) * 628} ${628}`}
                          strokeLinecap="round"
                          transform="rotate(-90 180 160)"
                        />
                        <SvgText x="180" y="150" fill="#34d399" fontSize="36" fontWeight="bold" textAnchor="middle">{sessionSquaredRate.toFixed(0)}%</SvgText>
                        <SvgText x="180" y="175" fill="#9ca3af" fontSize="12" textAnchor="middle">Squared Up</SvgText>
                        <Circle cx="100" cy="300" r="8" fill="#34d399" />
                        <SvgText x="115" y="304" fill="#ffffff" fontSize="11">Squared: {squaredCount}</SvgText>
                        <Circle cx="230" cy="300" r="8" fill="#3d4f5f" />
                        <SvgText x="245" y="304" fill="#ffffff" fontSize="11">Not Squared: {notSquaredCount}</SvgText>
                      </Svg>
                    </View>
                    {avgEVSquared > 0 && avgEVNotSquared > 0 && (
                      <View style={styles.levelGrid}>
                        <View style={[styles.levelCard, { borderColor: 'rgba(16,185,129,0.3)', backgroundColor: 'rgba(16,185,129,0.1)' }]}>
                          <View style={styles.levelCardHeader}>
                            <Text style={[styles.levelCardLabel, { color: '#34d399' }]}>Squared Up</Text>
                            <Text style={[styles.levelCardPct, { color: '#34d399' }]}>{avgEVSquared.toFixed(1)}</Text>
                          </View>
                          <Text style={styles.levelCardCount}>Avg Exit Velo (mph)</Text>
                        </View>
                        <View style={[styles.levelCard, { borderColor: 'rgba(107,114,128,0.3)', backgroundColor: 'rgba(107,114,128,0.1)' }]}>
                          <View style={styles.levelCardHeader}>
                            <Text style={[styles.levelCardLabel, { color: '#6b7280' }]}>Not Squared</Text>
                            <Text style={[styles.levelCardPct, { color: '#6b7280' }]}>{avgEVNotSquared.toFixed(1)}</Text>
                          </View>
                          <Text style={styles.levelCardCount}>Avg Exit Velo (mph)</Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              }

              // Fallback: calculate from individual swings (squared_up >= 80 means squared)
              const validSwings = fullSwingSwings.filter(s => s.squared_up !== null);
              if (validSwings.length === 0) return <Text style={styles.noDataText}>No squared up data available</Text>;

              const squaredCount = validSwings.filter(s => s.squared_up! >= 80).length;
              const notSquaredCount = validSwings.length - squaredCount;
              const squaredPct = (squaredCount / validSwings.length) * 100;

              const squaredSwings = validSwings.filter(s => s.squared_up! >= 80);
              const notSquaredSwings = validSwings.filter(s => s.squared_up! < 80);

              const avgEVSquared = squaredSwings.length > 0
                ? squaredSwings.filter(s => s.exit_velocity).reduce((a, s) => a + s.exit_velocity!, 0) / squaredSwings.filter(s => s.exit_velocity).length
                : 0;
              const avgEVNotSquared = notSquaredSwings.length > 0
                ? notSquaredSwings.filter(s => s.exit_velocity).reduce((a, s) => a + s.exit_velocity!, 0) / notSquaredSwings.filter(s => s.exit_velocity).length
                : 0;

              return (
                <View>
                  {/* Donut-style visualization */}
                  <View style={styles.scatterChartContainer}>
                    <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                      <Rect width="360" height="360" fill="#000000" />

                      {/* Background circle */}
                      <Circle cx="180" cy="160" r="100" fill="none" stroke="#3d4f5f" strokeWidth="30" />

                      {/* Squared up arc */}
                      <Circle
                        cx="180"
                        cy="160"
                        r="100"
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="30"
                        strokeDasharray={`${(squaredPct / 100) * 628} ${628}`}
                        strokeLinecap="round"
                        transform="rotate(-90 180 160)"
                      />

                      {/* Center text */}
                      <SvgText x="180" y="150" fill="#34d399" fontSize="36" fontWeight="bold" textAnchor="middle">{squaredPct.toFixed(0)}%</SvgText>
                      <SvgText x="180" y="175" fill="#9ca3af" fontSize="12" textAnchor="middle">Squared Up</SvgText>

                      {/* Legend at bottom */}
                      <Circle cx="100" cy="300" r="8" fill="#34d399" />
                      <SvgText x="115" y="304" fill="#ffffff" fontSize="11">Squared: {squaredCount}</SvgText>

                      <Circle cx="230" cy="300" r="8" fill="#3d4f5f" />
                      <SvgText x="245" y="304" fill="#ffffff" fontSize="11">Not Squared: {notSquaredCount}</SvgText>
                    </Svg>
                  </View>

                  {/* Comparison cards */}
                  {avgEVSquared > 0 && avgEVNotSquared > 0 && (
                    <View style={styles.levelGrid}>
                      <View style={[styles.levelCard, { borderColor: 'rgba(16,185,129,0.3)', backgroundColor: 'rgba(16,185,129,0.1)' }]}>
                        <View style={styles.levelCardHeader}>
                          <Text style={[styles.levelCardLabel, { color: '#34d399' }]}>Squared Up</Text>
                          <Text style={[styles.levelCardPct, { color: '#34d399' }]}>{avgEVSquared.toFixed(1)}</Text>
                        </View>
                        <Text style={styles.levelCardCount}>Avg Exit Velo (mph)</Text>
                      </View>
                      <View style={[styles.levelCard, { borderColor: 'rgba(107,114,128,0.3)', backgroundColor: 'rgba(107,114,128,0.1)' }]}>
                        <View style={styles.levelCardHeader}>
                          <Text style={[styles.levelCardLabel, { color: '#6b7280' }]}>Not Squared</Text>
                          <Text style={[styles.levelCardPct, { color: '#6b7280' }]}>{avgEVNotSquared.toFixed(1)}</Text>
                        </View>
                        <Text style={styles.levelCardCount}>Avg Exit Velo (mph)</Text>
                      </View>
                    </View>
                  )}
                </View>
              );
            })()}
          </View>
        )}

        {/* Full Swing: Whiff Rate by Pitch Speed */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="WHIFF RATE BY PITCH SPEED" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Contact rate broken down by pitch velocity. Lower whiff % = better contact ability at that speed.
            </Text>

            {(() => {
              // Filter swings with pitch speed data
              const swingsWithPitch = fullSwingSwings.filter(s => s.pitch_speed && s.pitch_speed > 0);
              if (swingsWithPitch.length === 0) return <Text style={styles.noDataText}>No pitch speed data available</Text>;

              // Define speed buckets
              const buckets = [
                { label: '<60', min: 0, max: 60 },
                { label: '60-69', min: 60, max: 70 },
                { label: '70-79', min: 70, max: 80 },
                { label: '80-89', min: 80, max: 90 },
                { label: '90+', min: 90, max: 200 },
              ];

              const bucketData = buckets.map(bucket => {
                const swingsInBucket = swingsWithPitch.filter(s => s.pitch_speed! >= bucket.min && s.pitch_speed! < bucket.max);
                const whiffs = swingsInBucket.filter(s => !s.exit_velocity || s.exit_velocity === 0).length;
                const contacts = swingsInBucket.length - whiffs;
                const whiffPct = swingsInBucket.length > 0 ? (whiffs / swingsInBucket.length) * 100 : 0;

                return {
                  label: bucket.label,
                  total: swingsInBucket.length,
                  whiffs,
                  contacts,
                  whiffPct,
                };
              }).filter(b => b.total > 0);

              if (bucketData.length === 0) return <Text style={styles.noDataText}>No pitch speed data available</Text>;

              return (
                <View>
                  <View style={styles.barChartContainer}>
                    <Svg viewBox="0 0 360 300" style={styles.barChart}>
                      <Rect width="360" height="300" fill="#000000" />

                      {/* Y-axis labels */}
                      {[0, 25, 50, 75, 100].map(val => {
                        const y = 250 - (val / 100) * 200;
                        return (
                          <G key={val}>
                            <Line x1="50" y1={y} x2="340" y2={y} stroke="#1f2937" strokeWidth="0.5" />
                            <SvgText x="45" y={y + 4} fill="#6b7280" fontSize="9" textAnchor="end">{val}%</SvgText>
                          </G>
                        );
                      })}

                      {/* Bars */}
                      {bucketData.map((bucket, idx) => {
                        const barWidth = 240 / bucketData.length - 10;
                        const x = 60 + (idx * (240 / bucketData.length)) + 5;
                        const barHeight = (bucket.whiffPct / 100) * 200;
                        const y = 250 - barHeight;

                        // Color based on whiff rate (green = low, red = high)
                        let barColor = '#34d399';
                        if (bucket.whiffPct >= 40) barColor = '#ef4444';
                        else if (bucket.whiffPct >= 25) barColor = '#F59E0B';
                        else if (bucket.whiffPct >= 15) barColor = '#fdba74';

                        return (
                          <G key={bucket.label}>
                            <Rect x={x} y={y} width={barWidth} height={barHeight} fill={barColor} opacity={0.9} rx="4" />
                            <SvgText x={x + barWidth / 2} y={y - 5} fill="#ffffff" fontSize="10" fontWeight="600" textAnchor="middle">{bucket.whiffPct.toFixed(0)}%</SvgText>
                            <SvgText x={x + barWidth / 2} y="268" fill="#9ca3af" fontSize="9" textAnchor="middle">{bucket.label}</SvgText>
                            <SvgText x={x + barWidth / 2} y="282" fill="#6b7280" fontSize="8" textAnchor="middle">({bucket.total})</SvgText>
                          </G>
                        );
                      })}

                      {/* X-axis label */}
                      <SvgText x="195" y="298" fill="#9ca3af" fontSize="10" textAnchor="middle">Pitch Speed (mph)</SvgText>
                    </Svg>
                  </View>

                  {/* Legend */}
                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#34d399' }]} />
                      <Text style={styles.legendText}>&lt;15%</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#fdba74' }]} />
                      <Text style={styles.legendText}>15-24%</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                      <Text style={styles.legendText}>25-39%</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
                      <Text style={styles.legendText}>40%+</Text>
                    </View>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Ideal Range Chart (Paired Only) */}
        {sessionType === 'paired' && pairedSwingData.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="IDEAL RANGE" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Optimal swing path alignment. Green zone shows ideal launch angle (8-32°) and attack angle (5-20°) for maximum power and consistency.
              <Text style={{ color: '#22D3EE' }}> ({pairedSwingData.length} paired swings)</Text>
            </Text>

            {(() => {
              const pairedSwings = pairedSwingData
                .filter(p => p.blastSwing?.attack_angle !== null && p.hittraxSwing?.launch_angle !== null)
                .map(p => ({
                  attackAngle: p.blastSwing!.attack_angle!,
                  launchAngle: p.hittraxSwing!.launch_angle!,
                }));

              const swingsInZone = pairedSwings.filter(s =>
                s.attackAngle >= 5 && s.attackAngle <= 20 &&
                s.launchAngle >= SWEET_SPOT[0] && s.launchAngle <= SWEET_SPOT[1]
              ).length;

              const percentageInZone = pairedSwings.length > 0
                ? (swingsInZone / pairedSwings.length) * 100
                : 0;

              return (
                <View>
                  <View style={styles.scatterChartContainer}>
                    <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                      <Rect width="360" height="360" fill="#000000" />

                      {/* Ideal Range Zone (gray box) */}
                      {(() => {
                        const x1 = 30 + ((SWEET_SPOT[0] + 10) / 60) * 320;
                        const x2 = 30 + ((SWEET_SPOT[1] + 10) / 60) * 320;
                        const y1 = 330 - ((20 + 10) / 40) * 320;
                        const y2 = 330 - ((5 + 10) / 40) * 320;
                        return (
                          <Rect
                            x={x1}
                            y={y1}
                            width={x2 - x1}
                            height={y2 - y1}
                            fill="#34d399"
                            opacity={0.07}
                          />
                        );
                      })()}

                      {/* Grid lines */}
                      {[-10, 0, 10, 20, 30, 40, 50].map(val => {
                        const x = 30 + ((val + 10) / 60) * 320;
                        return <Line key={`v-${val}`} x1={x} y1="10" x2={x} y2="330" stroke="#1f2937" strokeWidth="0.5" />;
                      })}
                      {[-10, 0, 10, 20, 30].map(val => {
                        const y = 330 - ((val + 10) / 40) * 320;
                        return <Line key={`h-${val}`} x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />;
                      })}

                      {/* Axes */}
                      <Line x1="30" y1="330" x2="350" y2="330" stroke="#6b7280" strokeWidth="2" />
                      <Line x1="30" y1="10" x2="30" y2="330" stroke="#6b7280" strokeWidth="2" />

                      {/* Plot points */}
                      {pairedSwings.map((swing, idx) => {
                        const x = 30 + ((swing.launchAngle + 10) / 60) * 320;
                        const y = 330 - ((swing.attackAngle + 10) / 40) * 320;
                        const inZone = swing.attackAngle >= 5 && swing.attackAngle <= 20 &&
                                      swing.launchAngle >= SWEET_SPOT[0] && swing.launchAngle <= SWEET_SPOT[1];

                        return (
                          <Circle
                            key={idx}
                            cx={Math.max(30, Math.min(350, x))}
                            cy={Math.max(10, Math.min(330, y))}
                            r="5"
                            fill={inZone ? '#fb923c' : '#6b7280'}
                            opacity={0.8}
                          />
                        );
                      })}

                      {/* Axis labels */}
                      <SvgText x="190" y="355" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Launch Angle (°)</SvgText>
                      <SvgText x="8" y="180" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600" transform="rotate(-90, 8, 180)">Attack Angle (°)</SvgText>

                      {/* Stats box */}
                      <Rect x="240" y="15" width="105" height="45" fill="#000000" opacity={0.8} rx="4" />
                      <SvgText x="292" y="35" fill="#fb923c" fontSize="18" textAnchor="middle" fontWeight="700">
                        {percentageInZone.toFixed(0)}%
                      </SvgText>
                      <SvgText x="292" y="52" fill="#9ca3af" fontSize="9" textAnchor="middle">
                        In Ideal Range
                      </SvgText>
                    </Svg>
                  </View>

                  {/* Legend */}
                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#fb923c' }]} />
                      <Text style={styles.legendText}>Ideal Range</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#6b7280' }]} />
                      <Text style={styles.legendText}>Other</Text>
                    </View>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Squared Up Rate Chart (Paired Only) */}
        {sessionType === 'paired' && pairedSwingData.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="SQUARED UP RATE" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              How much exit velocity was obtained compared to the maximum possible exit velocity available, given the speed of the swing and pitch.
            </Text>

            {(() => {
              const squaredUpData = pairedSwingData.map((pair, idx) => {
                const blast = pair.blastSwing;
                const hittrax = pair.hittraxSwing;
                if (!blast?.bat_speed || !hittrax?.pitch_velocity || !hittrax?.exit_velocity) return null;

                const pitchAtPlate = hittrax.pitch_velocity;
                let pitchCoefficient: number;
                // TODO(verify): coefficient table looks non-monotonic (0.50 below 40 mph, then 0.10 for 40–55).
                // Left as-is intentionally — confirm against the source formula before changing.
                if (pitchAtPlate < 40) pitchCoefficient = 0.50;
                else if (pitchAtPlate < 55) pitchCoefficient = 0.10;
                else if (pitchAtPlate < 70) pitchCoefficient = 0.17;
                else pitchCoefficient = 0.23;

                const maxPotentialEV = (1.23 * blast.bat_speed) + (pitchCoefficient * pitchAtPlate);
                const actualEV = hittrax.exit_velocity;
                const squaredUpRate = (actualEV / maxPotentialEV) * 100;

                return {
                  swingNum: idx + 1,
                  maxPotentialEV,
                  actualEV,
                  squaredUpRate: Math.min(squaredUpRate, 100),
                };
              }).filter(d => d !== null) as Array<{swingNum: number, maxPotentialEV: number, actualEV: number, squaredUpRate: number}>;

              const wellSquaredSwings = squaredUpData.filter(d => d.squaredUpRate >= 80).length;
              const wellSquaredPercentage = squaredUpData.length > 0
                ? (wellSquaredSwings / squaredUpData.length) * 100
                : 0;

              const maxEV = squaredUpData.length > 0 ? Math.max(...squaredUpData.map(d => d.maxPotentialEV)) : 100;
              const evScale = 220 / maxEV;

              return (
                <View>
                  <View style={styles.barChartContainer}>
                    <Svg viewBox="0 0 360 280" style={styles.barChart}>
                      <Rect width="360" height="280" fill="#000000" />

                      {/* Y-axis grid lines */}
                      {[0, 25, 50, 75, 100, 125].filter(v => v <= maxEV).map(val => {
                        const y = 250 - (val * evScale);
                        return (
                          <G key={val}>
                            <Line x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />
                            <SvgText x="20" y={y + 3} fill="#9ca3af" fontSize="8" textAnchor="end">{val}</SvgText>
                          </G>
                        );
                      })}

                      {/* Bars */}
                      {squaredUpData.map((data, idx) => {
                        const barWidth = Math.max(1, (320 / squaredUpData.length) - 2);
                        const x = 30 + (idx * (320 / squaredUpData.length)) + 1;
                        const maxBarHeight = data.maxPotentialEV * evScale;
                        const maxBarY = 250 - maxBarHeight;
                        const actualBarHeight = data.actualEV * evScale;
                        const actualBarY = 250 - actualBarHeight;

                        let color = '#ef4444';
                        if (data.squaredUpRate >= 80) color = '#fb923c';
                        else if (data.squaredUpRate >= 65) color = '#6b7280';

                        return (
                          <G key={idx}>
                            <Rect x={x} y={maxBarY} width={barWidth} height={maxBarHeight} fill="#6b7280" opacity={0.3} />
                            <Rect x={x} y={actualBarY} width={barWidth} height={actualBarHeight} fill={color} opacity={0.9} />
                          </G>
                        );
                      })}

                      {/* Stats box */}
                      <Rect x="240" y="5" width="110" height="45" fill="#000000" opacity={0.8} rx="4" />
                      <SvgText x="295" y="28" fill="#fb923c" fontSize="20" textAnchor="middle" fontWeight="700">
                        {wellSquaredPercentage.toFixed(0)}%
                      </SvgText>
                      <SvgText x="295" y="42" fill="#9ca3af" fontSize="9" textAnchor="middle">
                        Well Squared
                      </SvgText>

                      {/* Axes */}
                      <Line x1="30" y1="250" x2="350" y2="250" stroke="#6b7280" strokeWidth="2" />
                      <Line x1="30" y1="30" x2="30" y2="250" stroke="#6b7280" strokeWidth="2" />

                      <SvgText x="190" y="270" fill="#9ca3af" fontSize="9" textAnchor="middle" fontWeight="600">Swing Number</SvgText>
                    </Svg>
                  </View>

                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#fb923c', borderRadius: 2 }]} />
                      <Text style={styles.legendText}>≥80% (Squared-Up)</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#6b7280', borderRadius: 2 }]} />
                      <Text style={styles.legendText}>65-79%</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#ef4444', borderRadius: 2 }]} />
                      <Text style={styles.legendText}>&lt;65%</Text>
                    </View>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Attack Angle vs Bat Speed (Blast & Paired) */}
        {(sessionType === 'blast' || sessionType === 'paired') && blastSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="ATTACK ANGLE VS BAT SPEED" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Relationship between swing path (attack angle) and swing speed. Ideal attack angle: 5-20°.
            </Text>

            {(() => {
              const validSwings = blastSwings.filter(s =>
                s.bat_speed !== null && s.attack_angle !== null &&
                !isNaN(s.bat_speed!) && !isNaN(s.attack_angle!)
              );

              if (validSwings.length === 0) {
                return <Text style={styles.noDataText}>No valid data for this visualization</Text>;
              }

              const avgBatSpeed = validSwings.reduce((sum, s) => sum + (s.bat_speed || 0), 0) / validSwings.length;
              const avgAttackAngle = validSwings.reduce((sum, s) => sum + (s.attack_angle || 0), 0) / validSwings.length;

              return (
                <View>
                  <View style={styles.scatterChartContainer}>
                    <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                      <Rect width="360" height="360" fill="#000000" />

                      {/* Ideal attack angle zone (5-20°) */}
                      {(() => {
                        const yMin = 330 - ((20 + 20) / 60) * 320;
                        const yMax = 330 - ((5 + 20) / 60) * 320;
                        return <Rect x={30} y={yMin} width={320} height={yMax - yMin} fill="#34d399" opacity={0.07} />;
                      })()}

                      {/* Grid lines */}
                      {[30, 40, 50, 60, 70, 80, 90].map(val => {
                        const x = 30 + ((val - 30) / 70) * 320;
                        return <Line key={`v-${val}`} x1={x} y1="10" x2={x} y2="330" stroke="#1f2937" strokeWidth="0.5" />;
                      })}
                      {[-20, -10, 0, 10, 20, 30, 40].map(val => {
                        const y = 330 - ((val + 20) / 60) * 320;
                        return <Line key={`h-${val}`} x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />;
                      })}

                      {/* Axes */}
                      <Line x1="30" y1="330" x2="350" y2="330" stroke="#6b7280" strokeWidth="2" />
                      <Line x1="30" y1="10" x2="30" y2="330" stroke="#6b7280" strokeWidth="2" />

                      {/* Plot points */}
                      {validSwings.map((swing, idx) => {
                        const x = 30 + ((swing.bat_speed! - 30) / 70) * 320;
                        const y = 330 - ((swing.attack_angle! + 20) / 60) * 320;
                        const inIdealRange = swing.attack_angle! >= 5 && swing.attack_angle! <= 20;

                        return (
                          <Circle
                            key={idx}
                            cx={Math.max(30, Math.min(350, x))}
                            cy={Math.max(10, Math.min(330, y))}
                            r="4"
                            fill={inIdealRange ? '#a78bfa' : '#6b7280'}
                            opacity={0.8}
                          />
                        );
                      })}

                      {/* Average lines */}
                      <Line
                        x1={30 + ((avgBatSpeed - 30) / 70) * 320}
                        y1="10"
                        x2={30 + ((avgBatSpeed - 30) / 70) * 320}
                        y2="330"
                        stroke="#a78bfa"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={330 - ((avgAttackAngle + 20) / 60) * 320}
                        x2="350"
                        y2={330 - ((avgAttackAngle + 20) / 60) * 320}
                        stroke="#a78bfa"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="240" y="15" width="105" height="60" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="292" y="32" fill="#a78bfa" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
                      <SvgText x="245" y="47" fill="#9ca3af" fontSize="9">Bat Speed:</SvgText>
                      <SvgText x="340" y="47" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgBatSpeed.toFixed(1)} mph</SvgText>
                      <SvgText x="245" y="62" fill="#9ca3af" fontSize="9">Attack Angle:</SvgText>
                      <SvgText x="340" y="62" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgAttackAngle.toFixed(1)}°</SvgText>

                      {/* Axis labels */}
                      <SvgText x="190" y="355" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Bat Speed (mph)</SvgText>
                    </Svg>
                  </View>

                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#a78bfa' }]} />
                      <Text style={styles.legendText}>Ideal Range (5-20°)</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#6b7280' }]} />
                      <Text style={styles.legendText}>Other</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDash, { backgroundColor: '#a78bfa' }]} />
                      <Text style={styles.legendText}>Average</Text>
                    </View>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Exit Velocity vs Launch Angle (HitTrax & Paired) */}
        {(sessionType === 'hittrax' || sessionType === 'paired') && hittraxSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="EXIT VELOCITY VS LAUNCH ANGLE" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Relationship between exit velocity and launch angle. Sweet spot launch angle: 8-32°.
            </Text>

            {(() => {
              const validSwings = hittraxSwings.filter(s =>
                s.exit_velocity > 0 && s.launch_angle !== null &&
                !isNaN(s.exit_velocity) && !isNaN(s.launch_angle!)
              );

              if (validSwings.length === 0) {
                return <Text style={styles.noDataText}>No valid data for this visualization</Text>;
              }

              const avgExitVelo = validSwings.reduce((sum, s) => sum + s.exit_velocity, 0) / validSwings.length;
              const avgLaunchAngle = validSwings.reduce((sum, s) => sum + (s.launch_angle || 0), 0) / validSwings.length;

              return (
                <View>
                  <View style={styles.scatterChartContainer}>
                    <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                      <Rect width="360" height="360" fill="#000000" />

                      {/* Ideal launch angle zone (SWEET_SPOT 8-32°) */}
                      {(() => {
                        const yMin = 330 - ((SWEET_SPOT[1] + 20) / 100) * 320;
                        const yMax = 330 - ((SWEET_SPOT[0] + 20) / 100) * 320;
                        return <Rect x={30} y={yMin} width={320} height={yMax - yMin} fill="#34d399" opacity={0.07} />;
                      })()}

                      {/* Grid lines */}
                      {[40, 60, 80, 100, 120].map(val => {
                        const x = 30 + ((val - 40) / 80) * 320;
                        return <Line key={`v-${val}`} x1={x} y1="10" x2={x} y2="330" stroke="#1f2937" strokeWidth="0.5" />;
                      })}
                      {[-20, 0, 20, 40, 60, 80].map(val => {
                        const y = 330 - ((val + 20) / 100) * 320;
                        return <Line key={`h-${val}`} x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />;
                      })}

                      {/* Axes */}
                      <Line x1="30" y1="330" x2="350" y2="330" stroke="#6b7280" strokeWidth="2" />
                      <Line x1="30" y1="10" x2="30" y2="330" stroke="#6b7280" strokeWidth="2" />

                      {/* Plot points */}
                      {validSwings.map((swing, idx) => {
                        const x = 30 + ((swing.exit_velocity - 40) / 80) * 320;
                        const y = 330 - ((swing.launch_angle! + 20) / 100) * 320;
                        const inIdealRange = swing.launch_angle! >= SWEET_SPOT[0] && swing.launch_angle! <= SWEET_SPOT[1];

                        return (
                          <Circle
                            key={idx}
                            cx={Math.max(30, Math.min(350, x))}
                            cy={Math.max(10, Math.min(330, y))}
                            r="4"
                            fill={inIdealRange ? '#fb923c' : '#6b7280'}
                            opacity={0.8}
                          />
                        );
                      })}

                      {/* Average lines */}
                      <Line
                        x1={30 + ((avgExitVelo - 40) / 80) * 320}
                        y1="10"
                        x2={30 + ((avgExitVelo - 40) / 80) * 320}
                        y2="330"
                        stroke="#fb923c"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={330 - ((avgLaunchAngle + 20) / 100) * 320}
                        x2="350"
                        y2={330 - ((avgLaunchAngle + 20) / 100) * 320}
                        stroke="#fb923c"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="235" y="15" width="110" height="60" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="290" y="32" fill="#fb923c" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
                      <SvgText x="240" y="47" fill="#9ca3af" fontSize="9">Exit Velo:</SvgText>
                      <SvgText x="340" y="47" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgExitVelo.toFixed(1)} mph</SvgText>
                      <SvgText x="240" y="62" fill="#9ca3af" fontSize="9">Launch Angle:</SvgText>
                      <SvgText x="340" y="62" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgLaunchAngle.toFixed(1)}°</SvgText>

                      {/* Axis labels */}
                      <SvgText x="190" y="355" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Exit Velocity (mph)</SvgText>
                    </Svg>
                  </View>

                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#fb923c' }]} />
                      <Text style={styles.legendText}>Sweet Spot (8-32°)</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#6b7280' }]} />
                      <Text style={styles.legendText}>Other</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDash, { backgroundColor: '#fb923c' }]} />
                      <Text style={styles.legendText}>Average</Text>
                    </View>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Exit Velocity Distribution Histogram (HitTrax & Paired) */}
        {(sessionType === 'hittrax' || sessionType === 'paired') && hittraxSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="EXIT VELOCITY DISTRIBUTION" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Distribution of exit velocities across all swings (5 mph buckets).
            </Text>

            {(() => {
              const validSwings = hittraxSwings.filter(s => s.exit_velocity > 0 && !isNaN(s.exit_velocity));
              if (validSwings.length === 0) {
                return <Text style={styles.noDataText}>No valid exit velocity data</Text>;
              }

              const velocities = validSwings.map(s => s.exit_velocity);
              const minEV = Math.floor(Math.min(...velocities) / 5) * 5;
              const maxEV = Math.ceil(Math.max(...velocities) / 5) * 5;
              const avgEV = velocities.reduce((sum, v) => sum + v, 0) / velocities.length;

              // Create 5 mph buckets
              const buckets: { min: number; max: number; count: number }[] = [];
              for (let i = minEV; i < maxEV; i += 5) {
                const count = velocities.filter(v => v >= i && v < i + 5).length;
                buckets.push({ min: i, max: i + 5, count });
              }

              const maxCount = Math.max(...buckets.map(b => b.count));
              if (maxCount === 0) return <Text style={styles.noDataText}>No data available</Text>;

              const chartWidth = 320;
              const chartHeight = 220;
              const barWidth = chartWidth / buckets.length - 2;

              // Create smooth curve path
              const points = buckets.map((bucket, idx) => {
                const x = 30 + (idx * (chartWidth / buckets.length)) + (chartWidth / buckets.length / 2);
                const y = 250 - (bucket.count / maxCount) * chartHeight;
                return { x, y };
              });

              // Create smooth bezier curve through points
              let pathD = `M ${points[0].x} ${points[0].y}`;
              for (let i = 1; i < points.length; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                const cpx1 = prev.x + (curr.x - prev.x) / 3;
                const cpx2 = prev.x + 2 * (curr.x - prev.x) / 3;
                pathD += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
              }

              // Area fill path
              const areaPath = pathD + ` L ${points[points.length - 1].x} 250 L ${points[0].x} 250 Z`;

              return (
                <View>
                  <View style={styles.barChartContainer}>
                    <Svg viewBox="0 0 360 300" style={styles.barChart}>
                      <Rect width="360" height="300" fill="#000000" />

                      {/* Grid lines */}
                      {[0.25, 0.5, 0.75, 1].map((pct, idx) => {
                        const y = 250 - pct * chartHeight;
                        return (
                          <G key={idx}>
                            <Line x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />
                          </G>
                        );
                      })}

                      {/* Bars with gradient effect */}
                      {buckets.map((bucket, idx) => {
                        const x = 30 + (idx * (chartWidth / buckets.length)) + 1;
                        const barHeight = (bucket.count / maxCount) * chartHeight;
                        const y = 250 - barHeight;

                        return (
                          <Rect
                            key={idx}
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            fill="#fb923c"
                            opacity={0.4}
                            rx={2}
                          />
                        );
                      })}

                      {/* Smooth curve area fill */}
                      <Path d={areaPath} fill="#fb923c" opacity={0.2} />

                      {/* Smooth curve line */}
                      <Path d={pathD} stroke="#fb923c" strokeWidth="3" fill="none" />

                      {/* Data points */}
                      {points.map((point, idx) => (
                        <Circle key={idx} cx={point.x} cy={point.y} r="4" fill="#fb923c" />
                      ))}

                      {/* Average line */}
                      {(() => {
                        const avgX = 30 + ((avgEV - minEV) / (maxEV - minEV)) * chartWidth;
                        return (
                          <G>
                            <Line x1={avgX} y1="30" x2={avgX} y2="250" stroke="#F5F0E6" strokeWidth="2" strokeDasharray="4,4" />
                            <SvgText x={avgX} y="22" fill="#F5F0E6" fontSize="10" textAnchor="middle" fontWeight="600">Avg: {avgEV.toFixed(1)}</SvgText>
                          </G>
                        );
                      })()}

                      {/* X-axis labels */}
                      {buckets.filter((_, idx) => idx % 2 === 0 || buckets.length <= 8).map((bucket, idx) => {
                        const actualIdx = buckets.indexOf(bucket);
                        const x = 30 + (actualIdx * (chartWidth / buckets.length)) + (chartWidth / buckets.length / 2);
                        return (
                          <SvgText key={idx} x={x} y="268" fill="#9ca3af" fontSize="9" textAnchor="middle">
                            {bucket.min}
                          </SvgText>
                        );
                      })}

                      {/* Axes */}
                      <Line x1="30" y1="250" x2="350" y2="250" stroke="#6b7280" strokeWidth="1.5" />
                      <Line x1="30" y1="30" x2="30" y2="250" stroke="#6b7280" strokeWidth="1.5" />

                      {/* Y-axis label */}
                      <SvgText x="15" y="140" fill="#9ca3af" fontSize="9" textAnchor="middle" transform="rotate(-90, 15, 140)">Count</SvgText>

                      {/* X-axis label */}
                      <SvgText x="190" y="288" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Exit Velocity (mph)</SvgText>
                    </Svg>
                  </View>

                  {/* Stats summary row */}
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Avg: <Text style={{ color: '#fb923c', fontWeight: '600' }}>{avgEV.toFixed(1)} mph</Text></Text>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Max: <Text style={{ color: '#F5F0E6', fontWeight: '600' }}>{Math.max(...velocities).toFixed(1)} mph</Text></Text>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Swings: <Text style={{ color: '#ffffff', fontWeight: '600' }}>{validSwings.length}</Text></Text>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Bat Speed Distribution Histogram (Blast & Paired) */}
        {(sessionType === 'blast' || sessionType === 'paired') && blastSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="BAT SPEED DISTRIBUTION" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Distribution of bat speeds across all swings (1 mph increments).
            </Text>

            {(() => {
              const validSwings = blastSwings.filter(s => s.bat_speed !== null && !isNaN(s.bat_speed!) && s.bat_speed! > 0);
              if (validSwings.length === 0) {
                return <Text style={styles.noDataText}>No valid bat speed data</Text>;
              }

              const speeds = validSwings.map(s => s.bat_speed!);
              const minBS = Math.floor(Math.min(...speeds));
              const maxBS = Math.ceil(Math.max(...speeds));
              const avgBS = speeds.reduce((sum, v) => sum + v, 0) / speeds.length;

              // Create 1 mph buckets
              const buckets: { speed: number; count: number }[] = [];
              for (let i = minBS; i <= maxBS; i++) {
                const count = speeds.filter(v => Math.floor(v) === i).length;
                buckets.push({ speed: i, count });
              }

              const maxCount = Math.max(...buckets.map(b => b.count));
              if (maxCount === 0) return <Text style={styles.noDataText}>No data available</Text>;

              const chartWidth = 320;
              const chartHeight = 220;
              const barWidth = Math.max(2, chartWidth / buckets.length - 1);

              // Create smooth curve path
              const points = buckets.map((bucket, idx) => {
                const x = 30 + (idx * (chartWidth / buckets.length)) + (chartWidth / buckets.length / 2);
                const y = 250 - (bucket.count / maxCount) * chartHeight;
                return { x, y };
              });

              // Create smooth bezier curve through points
              let pathD = `M ${points[0].x} ${points[0].y}`;
              for (let i = 1; i < points.length; i++) {
                const prev = points[i - 1];
                const curr = points[i];
                const cpx1 = prev.x + (curr.x - prev.x) / 3;
                const cpx2 = prev.x + 2 * (curr.x - prev.x) / 3;
                pathD += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
              }

              // Area fill path
              const areaPath = pathD + ` L ${points[points.length - 1].x} 250 L ${points[0].x} 250 Z`;

              return (
                <View>
                  <View style={styles.barChartContainer}>
                    <Svg viewBox="0 0 360 300" style={styles.barChart}>
                      <Rect width="360" height="300" fill="#000000" />

                      {/* Grid lines */}
                      {[0.25, 0.5, 0.75, 1].map((pct, idx) => {
                        const y = 250 - pct * chartHeight;
                        return (
                          <G key={idx}>
                            <Line x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />
                          </G>
                        );
                      })}

                      {/* Bars with gradient effect */}
                      {buckets.map((bucket, idx) => {
                        const x = 30 + (idx * (chartWidth / buckets.length)) + 0.5;
                        const barHeight = (bucket.count / maxCount) * chartHeight;
                        const y = 250 - barHeight;

                        return (
                          <Rect
                            key={idx}
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            fill="#22D3EE"
                            opacity={0.4}
                            rx={1}
                          />
                        );
                      })}

                      {/* Smooth curve area fill */}
                      <Path d={areaPath} fill="#22D3EE" opacity={0.2} />

                      {/* Smooth curve line */}
                      <Path d={pathD} stroke="#22D3EE" strokeWidth="3" fill="none" />

                      {/* Data points - only show if few enough buckets */}
                      {buckets.length <= 20 && points.map((point, idx) => (
                        <Circle key={idx} cx={point.x} cy={point.y} r="3" fill="#22D3EE" />
                      ))}

                      {/* Average line */}
                      {(() => {
                        const avgX = 30 + ((avgBS - minBS) / (maxBS - minBS)) * chartWidth;
                        return (
                          <G>
                            <Line x1={avgX} y1="30" x2={avgX} y2="250" stroke="#F5F0E6" strokeWidth="2" strokeDasharray="4,4" />
                            <SvgText x={avgX} y="22" fill="#F5F0E6" fontSize="10" textAnchor="middle" fontWeight="600">Avg: {avgBS.toFixed(1)}</SvgText>
                          </G>
                        );
                      })()}

                      {/* X-axis labels - show every nth label based on bucket count */}
                      {(() => {
                        const step = buckets.length > 15 ? Math.ceil(buckets.length / 8) : 1;
                        return buckets.filter((_, idx) => idx % step === 0).map((bucket) => {
                          const actualIdx = buckets.indexOf(bucket);
                          const x = 30 + (actualIdx * (chartWidth / buckets.length)) + (chartWidth / buckets.length / 2);
                          return (
                            <SvgText key={bucket.speed} x={x} y="268" fill="#9ca3af" fontSize="9" textAnchor="middle">
                              {bucket.speed}
                            </SvgText>
                          );
                        });
                      })()}

                      {/* Axes */}
                      <Line x1="30" y1="250" x2="350" y2="250" stroke="#6b7280" strokeWidth="1.5" />
                      <Line x1="30" y1="30" x2="30" y2="250" stroke="#6b7280" strokeWidth="1.5" />

                      {/* Y-axis label */}
                      <SvgText x="15" y="140" fill="#9ca3af" fontSize="9" textAnchor="middle" transform="rotate(-90, 15, 140)">Count</SvgText>

                      {/* X-axis label */}
                      <SvgText x="190" y="288" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Bat Speed (mph)</SvgText>
                    </Svg>
                  </View>

                  {/* Stats summary row */}
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 8, marginBottom: 4 }}>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Avg: <Text style={{ color: '#22D3EE', fontWeight: '600' }}>{avgBS.toFixed(1)} mph</Text></Text>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Max: <Text style={{ color: '#F5F0E6', fontWeight: '600' }}>{Math.max(...speeds).toFixed(1)} mph</Text></Text>
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Swings: <Text style={{ color: '#ffffff', fontWeight: '600' }}>{validSwings.length}</Text></Text>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Launch Angle vs Distance (HitTrax & Paired) */}
        {(sessionType === 'hittrax' || sessionType === 'paired') && hittraxSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="LAUNCH ANGLE VS DISTANCE" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              How launch angle affects ball distance. Sweet spot launch angle: 8-32°.
            </Text>

            {(() => {
              const validData = hittraxSwings
                .filter(s => s.launch_angle !== null && s.distance !== null && !isNaN(s.launch_angle!) && !isNaN(s.distance!) && s.distance! > 0)
                .map(s => ({ launchAngle: s.launch_angle!, distance: s.distance! }));

              if (validData.length === 0) {
                return <Text style={styles.noDataText}>No valid data for this visualization</Text>;
              }

              const avgLaunchAngle = validData.reduce((sum, d) => sum + d.launchAngle, 0) / validData.length;
              const avgDistance = validData.reduce((sum, d) => sum + d.distance, 0) / validData.length;
              const maxDistance = Math.max(...validData.map(d => d.distance));

              return (
                <View>
                  <View style={styles.scatterChartContainer}>
                    <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                      <Rect width="360" height="360" fill="#000000" />

                      {/* Ideal launch angle zone (SWEET_SPOT 8-32°) */}
                      {(() => {
                        const xMin = 30 + ((SWEET_SPOT[0] + 20) / 100) * 320;
                        const xMax = 30 + ((SWEET_SPOT[1] + 20) / 100) * 320;
                        return <Rect x={xMin} y={10} width={xMax - xMin} height={320} fill="#34d399" opacity={0.07} />;
                      })()}

                      {/* Grid lines */}
                      {[-20, 0, 20, 40, 60, 80].map(val => {
                        const x = 30 + ((val + 20) / 100) * 320;
                        return <Line key={`v-${val}`} x1={x} y1="10" x2={x} y2="330" stroke="#1f2937" strokeWidth="0.5" />;
                      })}
                      {[0, 100, 200, 300, 400].map(val => {
                        const y = 330 - (val / 400) * 320;
                        return <Line key={`h-${val}`} x1="30" y1={y} x2="350" y2={y} stroke="#1f2937" strokeWidth="0.5" />;
                      })}

                      {/* Axes */}
                      <Line x1="30" y1="330" x2="350" y2="330" stroke="#6b7280" strokeWidth="2" />
                      <Line x1="30" y1="10" x2="30" y2="330" stroke="#6b7280" strokeWidth="2" />

                      {/* Plot points */}
                      {validData.map((point, idx) => {
                        const x = 30 + ((point.launchAngle + 20) / 100) * 320;
                        const y = 330 - (point.distance / 400) * 320;

                        let color = '#3d4f5f';
                        if (point.distance >= 350) color = '#fb923c';
                        else if (point.distance >= 300) color = '#fdba74';
                        else if (point.distance >= 250) color = '#8d939c';

                        return (
                          <Circle
                            key={idx}
                            cx={Math.max(30, Math.min(350, x))}
                            cy={Math.max(10, Math.min(330, y))}
                            r="4"
                            fill={color}
                            opacity={0.8}
                          />
                        );
                      })}

                      {/* Average lines */}
                      <Line
                        x1={30 + ((avgLaunchAngle + 20) / 100) * 320}
                        y1="10"
                        x2={30 + ((avgLaunchAngle + 20) / 100) * 320}
                        y2="330"
                        stroke="#fb923c"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={330 - (avgDistance / 400) * 320}
                        x2="350"
                        y2={330 - (avgDistance / 400) * 320}
                        stroke="#fb923c"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="230" y="15" width="115" height="75" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="287" y="32" fill="#fb923c" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
                      <SvgText x="235" y="47" fill="#9ca3af" fontSize="9">Launch Angle:</SvgText>
                      <SvgText x="340" y="47" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgLaunchAngle.toFixed(1)}°</SvgText>
                      <SvgText x="235" y="62" fill="#9ca3af" fontSize="9">Distance:</SvgText>
                      <SvgText x="340" y="62" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgDistance.toFixed(0)} ft</SvgText>
                      <SvgText x="235" y="77" fill="#9ca3af" fontSize="9">Max:</SvgText>
                      <SvgText x="340" y="77" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{maxDistance.toFixed(0)} ft</SvgText>

                      {/* Axis labels */}
                      <SvgText x="190" y="355" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Launch Angle (°)</SvgText>
                    </Svg>
                  </View>

                  <View style={styles.legendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#fb923c' }]} />
                      <Text style={styles.legendText}>350+ ft</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#fdba74' }]} />
                      <Text style={styles.legendText}>300-349 ft</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#8d939c' }]} />
                      <Text style={styles.legendText}>250-299 ft</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#3d4f5f' }]} />
                      <Text style={styles.legendText}>&lt;250 ft</Text>
                    </View>
                  </View>
                </View>
              );
            })()}
          </View>
        )}

        {/* Full Swing Individual Swings Table */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Section title="INDIVIDUAL SWINGS" style={styles.chartHead} />
            <Text style={styles.chartDescription}>
              Each swing with bat speed, exit velocity, and smash factor.
            </Text>
            <View style={styles.swingsTable}>
              <View style={styles.swingsTableHeader}>
                <View style={{ flex: 0.5 }}><Text style={styles.swingsTableHeaderCell}>#</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.swingsTableHeaderCell}>Bat Spd</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.swingsTableHeaderCell}>Exit Velo</Text></View>
                <View style={{ flex: 0.8 }}><Text style={styles.swingsTableHeaderCell}>Smash</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.swingsTableHeaderCell}>Distance</Text></View>
                <View style={{ flex: 0.7 }}><Text style={styles.swingsTableHeaderCell}>Sq Up</Text></View>
              </View>
              {fullSwingSwings.map((swing, idx) => (
                <View key={swing.id} style={[styles.swingsTableRow, idx % 2 === 0 && styles.swingsTableRowAlt]}>
                  <View style={{ flex: 0.5 }}><Text style={styles.swingsTableCell}>{swing.pitch_number || idx + 1}</Text></View>
                  <View style={{ flex: 1 }}><Text style={[styles.swingsTableCell, { color: '#22D3EE' }]}>
                    {swing.bat_speed ? swing.bat_speed.toFixed(1) : '-'}
                  </Text></View>
                  <View style={{ flex: 1 }}><Text style={[styles.swingsTableCell, { color: swing.exit_velocity ? evColor(swing.exit_velocity) : STEEL.mute, fontWeight: '800' }]}>
                    {swing.exit_velocity ? swing.exit_velocity.toFixed(1) : '-'}
                  </Text></View>
                  <View style={{ flex: 0.8 }}><Text style={[styles.swingsTableCell, { color: '#a78bfa' }]}>
                    {swing.smash_factor ? swing.smash_factor.toFixed(2) : '-'}
                  </Text></View>
                  <View style={{ flex: 1 }}><Text style={[styles.swingsTableCell, { color: '#8d939c' }]}>
                    {swing.distance ? Math.round(swing.distance) : '-'}
                  </Text></View>
                  <View style={{ flex: 0.7 }}><Text style={[styles.swingsTableCell, { color: swing.squared_up === 1 ? '#34d399' : '#6b7280' }]}>
                    {swing.squared_up === 1 ? 'Yes' : swing.squared_up === 0 ? 'No' : '-'}
                  </Text></View>
                </View>
              ))}
            </View>
          </View>
        )}
        </AnimatedSection>
      </ScrollView>

      {/* Swing Detail Modal */}
      {selectedSwing && (
        <Modal
          visible={true}
          transparent
          animationType="slide"
          onRequestClose={() => setSelectedSwing(null)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setSelectedSwing(null)}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Swing Details</Text>

              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Exit Velocity</Text>
                <Text style={[styles.modalValue, { color: evColor(selectedSwing.exit_velocity) }]}>{fmt(selectedSwing.exit_velocity)} mph</Text>
              </View>

              {selectedSwing.distance != null && selectedSwing.distance > 0 && (
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Distance</Text>
                  <Text style={styles.modalValue}>{Math.round(selectedSwing.distance)} ft</Text>
                </View>
              )}

              {selectedSwing.launch_angle !== null && (
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Launch Angle</Text>
                  <Text style={styles.modalValue}>{selectedSwing.launch_angle.toFixed(1)}°</Text>
                </View>
              )}

              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Pitch Speed</Text>
                <Text style={styles.modalValue}>{selectedSwing.pitch_velocity > 0 ? `${fmt(selectedSwing.pitch_velocity)} mph` : '—'}</Text>
              </View>

              {!!selectedSwing.result && (
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Result</Text>
                  <Text style={styles.modalValue}>{selectedSwing.result}</Text>
                </View>
              )}

              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setSelectedSwing(null)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      <FABMenu
        isOpen={fabOpen}
        onToggle={() => setFabOpen(!fabOpen)}
        totalBadgeCount={unreadMessagesCount + newResourcesCount}
        items={[
          { id: 'home', label: 'Home', icon: 'home', onPress: () => navigation.navigate(isParent ? 'ParentDashboard' : 'Dashboard') },
          { id: 'messages', label: 'Messages', icon: 'chatbubble', badge: unreadMessagesCount, onPress: () => navigation.navigate('Messages') },
          { id: 'leaderboard', label: 'Leaderboard', icon: 'trophy', onPress: () => navigation.navigate('Leaderboard') },
          { id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community', isActive: true, onPress: () => navigation.navigate('HittingPerformance', { athleteId }) },
          ...(hasPitchingData || hasArmCareData ? [{ id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('PitchingPerformance', { athleteId }) }] : []),
          ...(hasForceData ? [{ id: 'forceprofile', label: 'Force Profile', icon: 'trending-up', onPress: () => navigation.navigate('ForceProfile', { athleteId }) }] : []),
          { id: 'resources', label: 'Notes/Resources', icon: 'document-text', badge: newResourcesCount, onPress: () => navigation.navigate('Resources', { athleteId, userId }) },
          { id: 'book', label: 'Book a Class', icon: 'calendar', isBookButton: true, onPress: () => navigation.navigate('Booking') },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: '#9CA3AF',
    fontSize: 14,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 16,
  },
  backText: {
    color: '#9CA3AF',
    fontSize: 15,
    fontWeight: '500',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  pairedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(52,211,153,0.12)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.35)',
    gap: 4,
  },
  pairedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: STEEL.good,
  },
  subtitle: {
    fontSize: 13,
    color: '#fb923c',
  },
  headerAccent: {
    height: 1,
    backgroundColor: 'rgba(155,221,255,0.15)',
    marginTop: 16,
  },
  chartSection: {
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  chartHead: {
    paddingBottom: 0,
  },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  headerDate: {
    color: STEEL.mute,
    fontSize: 12,
    fontWeight: '600',
  },
  notPairedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: STEEL.hair,
  },
  notPairedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: STEEL.mute,
  },
  kpiLabelLocal: { color: STEEL.mute, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  kpiValueLocal: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  everyHeader: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: STEEL.rule,
  },
  everyHead: { flex: 1, textAlign: 'right', color: STEEL.mute, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2 },
  everyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: STEEL.rule,
  },
  everyCell: { flex: 1, textAlign: 'right', color: STEEL.day, fontSize: 13, fontVariant: ['tabular-nums'] },
  everyStrong: { fontWeight: '800' },
  chartTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  chartDescription: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 12,
    lineHeight: 17,
  },
  sprayChartContainer: {
    width: '100%',
    aspectRatio: 5/4,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  sprayChart: {
    width: '100%',
    height: '100%',
  },
  noChartContainer: {
    backgroundColor: 'rgba(17,24,39,0.5)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 24,
    alignItems: 'center',
  },
  noChartText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendDash: {
    width: 24,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 11,
    color: '#6B7280',
  },
  summarySection: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  summaryTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 2,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 4,
    textAlign: 'center',
  },
  // Compact summary grid for Full Swing sessions
  summaryGrid: {
    gap: 8,
  },
  summaryCardRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  summaryCardValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  summaryCardLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 3,
    textAlign: 'center',
  },
  summaryCardSub: {
    fontSize: 8,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 2,
  },
  sourceLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#EF4444',
    letterSpacing: 1,
    marginBottom: 8,
  },
  sourceDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 12,
  },
  sprayDirectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  totalSwingsText: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  scatterChartContainer: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#000000',
    borderRadius: 8,
    overflow: 'hidden',
  },
  scatterChart: {
    width: '100%',
    height: '100%',
  },
  barChartContainer: {
    width: '100%',
    aspectRatio: 360/300,
    backgroundColor: '#000000',
    borderRadius: 8,
    overflow: 'hidden',
  },
  barChart: {
    width: '100%',
    height: '100%',
  },
  noDataText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 32,
  },
  levelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  levelCard: {
    width: '48%',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  levelCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  levelCardLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  levelCardPct: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  levelCardCount: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#11161d',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 48,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  modalLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },
  modalValue: {
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    color: '#ffffff',
  },
  modalCloseButton: {
    backgroundColor: '#1b2430',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a3442',
    paddingVertical: 14,
    marginTop: 24,
    alignItems: 'center',
  },
  modalCloseButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  swingsTable: {
    marginTop: 8,
  },
  swingsTableHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: STEEL.rule,
  },
  swingsTableHeaderCell: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: STEEL.mute,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  swingsTableRow: {
    flexDirection: 'row',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: STEEL.rule,
  },
  swingsTableRowAlt: {},
  swingsTableCell: {
    fontSize: 12.5,
    color: '#ffffff',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
