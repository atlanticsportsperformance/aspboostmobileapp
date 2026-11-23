import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { getOrgIdForAthlete } from '../lib/orgSecurity';
import { getUnreadMessagesCount } from '../lib/unreadMessages';
import { useAthlete } from '../contexts/AthleteContext';
import FABMenu from '../components/FABMenu';
import { useAthleteLifecycle } from '../lib/useAthleteLifecycle';
import {
  STEEL,
  fmt,
  Section,
  Kpi,
  KpiRow,
  ScreenHeader,
  steelStyles,
  HARD_HIT_MPH,
  SWEET_SPOT,
} from '../components/hitting/steel';
import { BallField3D, type BattedBall } from '../components/hitting/BallField3D';
import {
  EXIT_VELO_NORMS,
  BAT_SPEED_NORMS,
  DISTANCE_NORMS,
  percentileFor,
  normalizePlayLevel,
  type Level,
  type Pcts,
} from '../lib/norms';

// Supabase has a default 1000 row limit - this fetches ALL records with pagination
const BATCH_SIZE = 1000;
async function fetchAllPaginated<T>(
  query: () => ReturnType<typeof supabase.from>,
  selectColumns: string,
  filters: { column: string; value: any; operator?: 'eq' | 'in' }[],
  orderColumn: string,
  orderAscending: boolean = true,
  additionalFilters?: (q: any) => any
): Promise<T[]> {
  const allData: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let q = query().select(selectColumns);

    for (const filter of filters) {
      if (filter.operator === 'in') {
        q = q.in(filter.column, filter.value);
      } else {
        q = q.eq(filter.column, filter.value);
      }
    }

    if (additionalFilters) {
      q = additionalFilters(q);
    }

    const { data, error } = await q
      .order(orderColumn, { ascending: orderAscending })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Pagination fetch error:', error);
      break;
    }

    if (data && data.length > 0) {
      allData.push(...(data as T[]));
      offset += BATCH_SIZE;
      hasMore = data.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allData;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const avg = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const maxOf = (xs: number[]) => (xs.length > 0 ? Math.max(...xs) : null);

/** 'YYYY-MM-DD' from a date/timestamp string; null when unusable. */
function dayKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

/** Local-midnight Date for a 'YYYY-MM-DD'-ish string (null-safe). */
function dayDate(raw: string | null | undefined): Date | null {
  const k = dayKey(raw);
  if (!k) return null;
  const [y, mo, d] = k.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

type Window = { start: Date; end: Date };
const inWin = (d: Date | null, w: Window) => d != null && d >= w.start && d < w.end;

interface WindowStats {
  avgEV: number | null;
  hardHitPct: number | null;
  avgLA: number | null;
  sweetSpotPct: number | null;
  avgDist: number | null;
  avgSpray: number | null;
  avgBatSpeed: number | null;
  avgAttackAngle: number | null; // Blast-only
  avgOnPlane: number | null; // Blast-only
}

interface OverviewStats {
  blastSwingsAllTime: number;
  hittraxSwingsAllTime: number;
  batSpeedPR: number | null;
  exitVeloPR: number | null;
  distancePR: number | null;
  last30: WindowStats;
  prior30: WindowStats;
  playLevel: Level | null;
  hittraxSessionCount: number;
  fullSwingSessionCount: number;
}

interface Session {
  id: string;
  session_date: string;
  total_swings: number;
  contact_swings: number;
  avg_exit_velocity: number | null;
  max_exit_velocity: number | null;
  max_distance: number | null;
  hard_hit_count: number;
  source: 'hittrax' | 'blast' | 'fullswing';
  isPaired?: boolean;
  blast_swings_count?: number;
  hittrax_swings_count?: number;
  paired_swings_count?: number;
  avg_bat_speed?: number | null;
  avg_attack_angle?: number | null;
  avg_on_plane_efficiency?: number | null;
  evs?: number[]; // HitTrax contact EVs in swing order, for the sparkline
  balls?: BattedBall[]; // HitTrax batted balls, for the 3D field
}

interface FullSwingSession {
  id: string;
  athlete_id: string;
  session_date: string | null;
  total_swings: number | null;
  contact_swings: number | null;
  avg_exit_velocity: number | null;
  max_exit_velocity: number | null;
  avg_launch_angle: number | null;
  avg_distance: number | null;
  max_distance: number | null;
  avg_bat_speed: number | null;
  max_bat_speed: number | null;
  avg_smash_factor: number | null;
  squared_up_rate: number | null;
  hard_hit_count: number | null;
  hard_hit_rate: number | null;
}

const SOURCE_COLOR = {
  fullswing: '#22D3EE',
  hittrax: '#9BDDFF',
  paired: '#A78BFA',
  blast: '#6B7280',
};

function tierFor(pct: number) {
  if (pct >= 75) return { label: 'ELITE', color: '#34d399' };
  if (pct >= 50) return { label: 'OPTIMIZE', color: '#9BDDFF' };
  if (pct >= 25) return { label: 'SHARPEN', color: '#fbbf24' };
  return { label: 'BUILD', color: '#ef4444' };
}

// Parse Blast timestamp (same logic as web app); null when invalid
function parseBlastTimestamp(swing: any): Date | null {
  if (!swing) return null;
  let d: Date | null = null;
  if (swing.created_at_utc) {
    d = new Date(swing.created_at_utc);
  } else if (swing.recorded_date && swing.recorded_time) {
    d = new Date(`${swing.recorded_date}T${swing.recorded_time}`);
  }
  return d && Number.isFinite(d.getTime()) ? d : null;
}

// Parse HitTrax timestamp: "10/30/2025 19:18:31.573" (also tolerates ISO); null when unusable
function parseHitTraxTimestamp(timestamp: string | null | undefined): Date | null {
  if (!timestamp || typeof timestamp !== 'string') return null;
  const m = timestamp.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);
  if (m) {
    const secs = m[6] ? parseFloat(m[6]) : 0;
    const d = new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], Math.floor(secs), Math.round((secs % 1) * 1000));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d/.test(timestamp)) {
    const d = new Date(timestamp);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

// Match swings by timestamp (7-second window) - like the web app
function matchSwingsByTime(blastSwings: any[], hittraxSwings: any[], maxTimeDifferenceSeconds: number = 7) {
  const pairs: { blastSwing: any; hittraxSwing: any }[] = [];
  const matchedHittraxIds = new Set<string>();
  const unmatchedBlast: any[] = [];

  const hittraxWithTime = hittraxSwings
    .map((swing) => ({ swing, t: parseHitTraxTimestamp(swing?.swing_timestamp) }))
    .filter((x): x is { swing: any; t: Date } => x.t !== null);

  blastSwings.forEach((blastSwing) => {
    const bt = parseBlastTimestamp(blastSwing);
    if (!bt) {
      unmatchedBlast.push(blastSwing);
      return;
    }
    let best: { swing: any; diff: number } | null = null;
    for (const { swing, t } of hittraxWithTime) {
      if (matchedHittraxIds.has(swing.id)) continue;
      const diff = Math.abs(bt.getTime() - t.getTime()) / 1000;
      if (diff <= maxTimeDifferenceSeconds && (!best || diff < best.diff)) best = { swing, diff };
    }
    if (best) {
      matchedHittraxIds.add(best.swing.id);
      pairs.push({ blastSwing, hittraxSwing: best.swing });
    } else {
      unmatchedBlast.push(blastSwing);
    }
  });

  return { pairs, unmatchedBlast };
}

function formatDate(dateStr: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  const d = dayDate(dateStr);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', opts ?? { month: 'short', day: 'numeric', year: 'numeric' });
}

function Sparkline({ values, color = STEEL.hitting, width = 60, height = 18 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const range = mx - mn || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - mn) / range) * (height - 2) - 1).toFixed(1)}`)
    .join(' ');
  return (
    <Svg width={width} height={height} style={{ marginTop: 4 }}>
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

function PrColumn({
  label,
  unit,
  value,
  digits,
  accent,
  norms,
  level,
  missing,
}: {
  label: string;
  unit: string;
  value: number | null;
  digits: number;
  accent: string;
  norms: Partial<Record<Level, Pcts>>;
  level: Level | null;
  missing: string;
}) {
  const has = isNum(value) && value > 0;
  let line: React.ReactNode;
  if (!has) {
    line = <Text style={styles.prNote}>{missing}</Text>;
  } else if (!level) {
    line = <Text style={styles.prNote}>Set play level</Text>;
  } else if (!norms[level]) {
    line = <Text style={styles.prNote}>Not enough {level} data</Text>;
  } else {
    const pct = percentileFor(value!, norms[level]!);
    const tier = tierFor(pct);
    line = (
      <Text style={styles.prNote}>
        <Text style={{ color: STEEL.day, fontWeight: '800' }}>{pct}th</Text>
        <Text> · </Text>
        <Text style={{ color: tier.color, fontWeight: '800', letterSpacing: 0.8 }}>{tier.label}</Text>
      </Text>
    );
  }
  return (
    <View style={styles.prCol}>
      <Text style={styles.prLabel}>{label}</Text>
      <Text style={[styles.prValue, !has && { color: STEEL.past }]}>
        {has ? fmt(value, digits) : '—'}
        {has ? <Text style={styles.prUnit}> {unit}</Text> : null}
      </Text>
      <View style={[styles.prBar, { backgroundColor: accent }]} />
      {line}
    </View>
  );
}

export default function HittingPerformanceScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { isParent, linkedAthletes } = useAthlete();
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);

  // Guard: If parent arrives without athleteId, go back (they should use FAB which passes athleteId)
  useEffect(() => {
    if (isParent && !route?.params?.athleteId && linkedAthletes.length > 0) {
      navigation.goBack();
    }
  }, [isParent, route?.params?.athleteId, linkedAthletes]);
  const [overviewStats, setOverviewStats] = useState<OverviewStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // FAB state
  const [fabOpen, setFabOpen] = useState(false);
  const { isMember } = useAthleteLifecycle();
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasArmCareData, setHasArmCareData] = useState(false);
  const [hasForceData, setHasForceData] = useState(false);
  const [hasMocapData, setHasMocapData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [newResourcesCount, setNewResourcesCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  // Pagination
  const [displayedSessions, setDisplayedSessions] = useState(20);
  const [allSessions, setAllSessions] = useState<Session[]>([]);

  const isMountedRef = useRef(true);
  const isLoadingRef = useRef(false);
  const lastLoadTimeRef = useRef<number>(0);

  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;
      const now = Date.now();
      const timeSinceLastLoad = now - lastLoadTimeRef.current;

      // Only reload if not currently loading and at least 30 seconds since last load
      if (!isLoadingRef.current && timeSinceLastLoad > 30000) {
        loadAthleteAndData();
      }

      return () => {
        isMountedRef.current = false;
      };
    }, [])
  );

  async function loadAthleteAndData() {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    lastLoadTimeRef.current = Date.now();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }
      if (isMountedRef.current) setUserId(user.id);

      let currentAthleteId = athleteId;
      if (!currentAthleteId) {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (!athlete) {
          navigation.goBack();
          return;
        }
        currentAthleteId = athlete.id;
        if (isMountedRef.current) setAthleteId(athlete.id);
      }

      if (!isMountedRef.current) return;

      await Promise.all([
        fetchData(currentAthleteId!),
        fetchFabData(currentAthleteId!, user.id),
      ]);
    } catch (error) {
      console.error('Error loading athlete:', error);
    } finally {
      isLoadingRef.current = false;
      if (isMountedRef.current) setLoading(false);
    }
  }

  async function fetchFabData(athleteId: string, currentUserId: string) {
    try {
      const orgId = await getOrgIdForAthlete(athleteId);
      if (!orgId) {
        console.error('[HittingPerformanceScreen] No org_id found for athlete');
        return;
      }

      const { count: pitchingCount } = await supabase
        .from('trackman_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasPitchingData((pitchingCount || 0) > 0);

      const { count: armCareCount } = await supabase
        .from('armcare_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasArmCareData((armCareCount || 0) > 0);

      const { count: forceCount } = await supabase
        .from('cmj_tests')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasForceData((forceCount || 0) > 0);

      const { count: mocapCount } = await supabase
        .from('mocap_pitches')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteId)
        .not('r2_uploaded_at', 'is', null);
      setHasMocapData((mocapCount || 0) > 0);

      // Resources count gates the new-resources badge lookup below
      const { count: resourcesCount } = await supabase
        .from('resources')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('athlete_id', currentUserId);

      setUnreadMessagesCount(await getUnreadMessagesCount(currentUserId));

      if ((resourcesCount || 0) > 0) {
        const { data: athleteWithLastViewed } = await supabase
          .from('athletes')
          .select('last_viewed_resources_at')
          .eq('id', athleteId)
          .single();

        if (athleteWithLastViewed) {
          const lastViewed = athleteWithLastViewed.last_viewed_resources_at || new Date(0).toISOString();
          const { count: newCount } = await supabase
            .from('resources')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', orgId)
            .eq('athlete_id', currentUserId)
            .gt('created_at', lastViewed);
          setNewResourcesCount(newCount || 0);
        }
      }
    } catch (error) {
      console.error('Error fetching FAB data:', error);
    }
  }

  async function fetchData(id: string) {
    await Promise.all([fetchOverviewStats(id), fetchSessions(id)]);
  }

  async function fetchOverviewStats(id: string) {
    try {
      const now = new Date();
      const last30: Window = { start: new Date(now.getTime() - 30 * DAY_MS), end: new Date(now.getTime() + DAY_MS) };
      const prior30: Window = { start: new Date(now.getTime() - 60 * DAY_MS), end: last30.start };

      interface BlastSwing {
        bat_speed: number | null;
        recorded_date: string | null;
        attack_angle: number | null;
        on_plane_efficiency: number | null;
      }
      interface HittraxSession {
        id: string;
        session_date: string | null;
      }
      interface HittraxSwing {
        session_id: string;
        exit_velocity: number | null;
        distance: number | null;
        launch_angle: number | null;
        horizontal_angle: number | null;
      }

      const [{ data: athleteRow }, blastSwings, hittraxSessions, fullSwingSessions] = await Promise.all([
        supabase.from('athletes').select('play_level').eq('id', id).maybeSingle(),
        fetchAllPaginated<BlastSwing>(
          () => supabase.from('blast_swings'),
          'bat_speed, recorded_date, attack_angle, on_plane_efficiency',
          [{ column: 'athlete_id', value: id }],
          'recorded_date',
          false
        ),
        fetchAllPaginated<HittraxSession>(
          () => supabase.from('hittrax_sessions'),
          'id, session_date',
          [{ column: 'athlete_id', value: id }],
          'session_date',
          false
        ),
        fetchAllPaginated<FullSwingSession>(
          () => supabase.from('fullswing_sessions'),
          'id, session_date, total_swings, contact_swings, avg_bat_speed, max_bat_speed, avg_exit_velocity, max_exit_velocity, avg_launch_angle, avg_distance, max_distance, hard_hit_count',
          [{ column: 'athlete_id', value: id }],
          'session_date',
          false
        ),
      ]);

      const sessionIds = hittraxSessions.map((s) => s.id);
      const sessionDate = new Map(hittraxSessions.map((s) => [s.id, dayDate(s.session_date)]));

      // ALL HitTrax swings once: PRs + both 30-day windows
      const hittraxSwings =
        sessionIds.length > 0
          ? await fetchAllPaginated<HittraxSwing>(
              () => supabase.from('hittrax_swings'),
              'session_id, exit_velocity, distance, launch_angle, horizontal_angle',
              [{ column: 'session_id', value: sessionIds, operator: 'in' }],
              'created_at',
              false
            )
          : [];
      const contact = hittraxSwings.filter((s) => isNum(s.exit_velocity) && s.exit_velocity > 0);

      const fsEVmax = fullSwingSessions.map((s) => s.max_exit_velocity).filter(isNum);
      const fsDistMax = fullSwingSessions.map((s) => s.max_distance).filter((d): d is number => isNum(d) && d > 0);
      const exitVeloPR = maxOf([...contact.map((s) => s.exit_velocity!), ...fsEVmax]);
      const distancePR = maxOf([
        ...contact.map((s) => s.distance).filter((d): d is number => isNum(d) && d > 0),
        ...fsDistMax,
      ]);
      const batSpeedPR = maxOf([
        ...blastSwings.map((s) => s.bat_speed).filter((v): v is number => isNum(v) && v > 0),
        ...fullSwingSessions.map((s) => s.max_bat_speed).filter((v): v is number => isNum(v) && v > 0),
      ]);

      // Weighted mean across HitTrax swings (weight 1 each) and Full Swing session averages (weight = swing count)
      const blend = (htVals: number[], fs: { v: number | null; n: number | null }[]) => {
        let sum = htVals.reduce((a, b) => a + b, 0);
        let n = htVals.length;
        for (const { v, n: w } of fs) {
          if (isNum(v) && isNum(w) && w > 0) {
            sum += v * w;
            n += w;
          }
        }
        return n > 0 ? sum / n : null;
      };

      const windowStats = (w: Window): WindowStats => {
        const ht = contact.filter((s) => inWin(sessionDate.get(s.session_id) ?? null, w));
        const fs = fullSwingSessions.filter((s) => inWin(dayDate(s.session_date), w));
        const bl = blastSwings.filter((s) => inWin(dayDate(s.recorded_date), w));

        const evs = ht.map((s) => s.exit_velocity!);
        const las = ht.map((s) => s.launch_angle).filter(isNum);
        const dists = ht.map((s) => s.distance).filter((d): d is number => isNum(d) && d > 0);

        // Hard-hit %: HitTrax swings + Full Swing hard_hit_count / contact_swings
        let hhNum = evs.filter((v) => v >= HARD_HIT_MPH).length;
        let hhDen = evs.length;
        for (const s of fs) {
          if (isNum(s.contact_swings) && s.contact_swings > 0 && isNum(s.hard_hit_count)) {
            hhNum += s.hard_hit_count;
            hhDen += s.contact_swings;
          }
        }

        const blastBat = bl.map((s) => s.bat_speed).filter((v): v is number => isNum(v) && v > 0);

        return {
          avgEV: blend(evs, fs.map((s) => ({ v: s.avg_exit_velocity, n: s.contact_swings }))),
          hardHitPct: hhDen > 0 ? (hhNum / hhDen) * 100 : null,
          avgLA: blend(las, fs.map((s) => ({ v: s.avg_launch_angle, n: s.contact_swings }))),
          sweetSpotPct: las.length > 0 ? (las.filter((a) => a >= SWEET_SPOT[0] && a <= SWEET_SPOT[1]).length / las.length) * 100 : null,
          avgDist: blend(dists, fs.map((s) => ({ v: s.avg_distance, n: s.contact_swings }))),
          avgSpray: avg(ht.map((s) => s.horizontal_angle).filter(isNum)),
          avgBatSpeed: blend(blastBat, fs.map((s) => ({ v: s.avg_bat_speed, n: s.total_swings }))),
          avgAttackAngle: avg(bl.map((s) => s.attack_angle).filter(isNum)),
          avgOnPlane: avg(bl.map((s) => s.on_plane_efficiency).filter(isNum)),
        };
      };

      if (!isMountedRef.current) return;
      setOverviewStats({
        blastSwingsAllTime: blastSwings.length,
        hittraxSwingsAllTime: hittraxSwings.length,
        batSpeedPR,
        exitVeloPR,
        distancePR,
        last30: windowStats(last30),
        prior30: windowStats(prior30),
        playLevel: normalizePlayLevel((athleteRow as any)?.play_level),
        hittraxSessionCount: hittraxSessions.length,
        fullSwingSessionCount: fullSwingSessions.length,
      });
    } catch (error) {
      console.error('Error fetching hitting overview:', error);
    }
  }

  async function fetchSessions(id: string) {
    try {
      interface BlastSwingSession {
        id: string;
        recorded_date: string | null;
        recorded_time: string | null;
        created_at_utc: string | null;
        bat_speed: number | null;
        attack_angle: number | null;
        on_plane_efficiency: number | null;
      }
      interface HittraxSessionData {
        id: string;
        session_date: string | null;
      }
      interface HittraxSwingSession {
        id: string;
        session_id: string;
        swing_timestamp: string | null;
        exit_velocity: number | null;
        distance: number | null;
        launch_angle: number | null;
        horizontal_angle: number | null;
      }

      const [blastSwings, hittraxSessions, fullSwingSessions] = await Promise.all([
        fetchAllPaginated<BlastSwingSession>(
          () => supabase.from('blast_swings'),
          'id, recorded_date, recorded_time, created_at_utc, bat_speed, attack_angle, on_plane_efficiency',
          [{ column: 'athlete_id', value: id }],
          'recorded_date',
          false
        ),
        fetchAllPaginated<HittraxSessionData>(
          () => supabase.from('hittrax_sessions'),
          'id, session_date',
          [{ column: 'athlete_id', value: id }],
          'session_date',
          false
        ),
        fetchAllPaginated<FullSwingSession>(
          () => supabase.from('fullswing_sessions'),
          'id, session_date, total_swings, contact_swings, avg_bat_speed, max_bat_speed, avg_exit_velocity, max_exit_velocity, avg_distance, max_distance, hard_hit_count',
          [{ column: 'athlete_id', value: id }],
          'session_date',
          false
        ),
      ]);

      let hittraxSwings: HittraxSwingSession[] = [];
      if (hittraxSessions.length > 0) {
        hittraxSwings = await fetchAllPaginated<HittraxSwingSession>(
          () => supabase.from('hittrax_swings'),
          'id, session_id, swing_timestamp, exit_velocity, distance, launch_angle, horizontal_angle',
          [{ column: 'session_id', value: hittraxSessions.map((s) => s.id), operator: 'in' }],
          'swing_timestamp',
          false
        );
      }

      // Pair Blast -> HitTrax only when swings actually match within 7s
      const { pairs, unmatchedBlast } = matchSwingsByTime(blastSwings, hittraxSwings, 7);
      const pairedBySession = new Map<string, number>();
      pairs.forEach((p) => pairedBySession.set(p.hittraxSwing.session_id, (pairedBySession.get(p.hittraxSwing.session_id) || 0) + 1));

      const result: Session[] = [];

      // HitTrax: one row per session_id
      const swingsBySession = new Map<string, HittraxSwingSession[]>();
      hittraxSwings.forEach((s) => {
        if (!s?.session_id) return;
        if (!swingsBySession.has(s.session_id)) swingsBySession.set(s.session_id, []);
        swingsBySession.get(s.session_id)!.push(s);
      });

      hittraxSessions.forEach((hs) => {
        const raw = swingsBySession.get(hs.id) || [];
        if (raw.length === 0) return;
        // Chronological order (fallback: reverse of desc query order)
        const swings = raw
          .map((s, i) => ({ s, t: parseHitTraxTimestamp(s.swing_timestamp)?.getTime() ?? -i }))
          .sort((a, b) => a.t - b.t)
          .map((x) => x.s);
        const date =
          dayKey(hs.session_date) ||
          dayKey(swings.find((s) => s.swing_timestamp)?.swing_timestamp) ||
          null;
        if (!date) return;

        const contactSw = swings.filter((s) => isNum(s.exit_velocity) && s.exit_velocity > 0);
        const evs = contactSw.map((s) => s.exit_velocity!);
        const distances = contactSw.map((s) => s.distance).filter((d): d is number => isNum(d) && d > 0);
        const paired = pairedBySession.get(hs.id) || 0;

        result.push({
          id: hs.id,
          session_date: date,
          total_swings: swings.length,
          contact_swings: contactSw.length,
          avg_exit_velocity: avg(evs),
          max_exit_velocity: maxOf(evs),
          max_distance: maxOf(distances),
          hard_hit_count: evs.filter((v) => v >= HARD_HIT_MPH).length,
          source: 'hittrax',
          isPaired: paired > 0,
          blast_swings_count: paired,
          hittrax_swings_count: swings.length,
          paired_swings_count: paired,
          evs,
          balls: contactSw.map((s) => ({
            exit_velocity: s.exit_velocity,
            launch_angle: s.launch_angle,
            horizontal_angle: s.horizontal_angle,
            distance: s.distance,
          })),
        });
      });

      // Blast-only (unpaired swings): grouped by local date
      const blastByDate = new Map<string, BlastSwingSession[]>();
      unmatchedBlast.forEach((b: BlastSwingSession) => {
        const t = parseBlastTimestamp(b);
        const date = t
          ? `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
          : dayKey(b.recorded_date);
        if (!date) return;
        if (!blastByDate.has(date)) blastByDate.set(date, []);
        blastByDate.get(date)!.push(b);
      });
      blastByDate.forEach((bs, date) => {
        result.push({
          id: date,
          session_date: date,
          total_swings: bs.length,
          contact_swings: 0,
          avg_exit_velocity: null,
          max_exit_velocity: null,
          max_distance: null,
          hard_hit_count: 0,
          source: 'blast',
          isPaired: false,
          blast_swings_count: bs.length,
          avg_bat_speed: avg(bs.map((s) => s.bat_speed).filter((v): v is number => isNum(v) && v > 0)),
          avg_attack_angle: avg(bs.map((s) => s.attack_angle).filter(isNum)),
          avg_on_plane_efficiency: avg(bs.map((s) => s.on_plane_efficiency).filter(isNum)),
        });
      });

      // Full Swing sessions
      fullSwingSessions.forEach((fs) => {
        const date = dayKey(fs.session_date);
        if (!date) return;
        result.push({
          id: fs.id,
          session_date: date,
          total_swings: fs.total_swings ?? 0,
          contact_swings: fs.contact_swings ?? 0,
          avg_exit_velocity: fs.avg_exit_velocity,
          max_exit_velocity: fs.max_exit_velocity,
          max_distance: fs.max_distance,
          hard_hit_count: fs.hard_hit_count ?? 0,
          source: 'fullswing',
          avg_bat_speed: fs.avg_bat_speed,
        });
      });

      result.sort((a, b) => (dayDate(b.session_date)?.getTime() ?? 0) - (dayDate(a.session_date)?.getTime() ?? 0));
      if (!isMountedRef.current) return;
      setAllSessions(result);
      setSessions(result.slice(0, 20));
      setDisplayedSessions(20);
    } catch (error) {
      console.error('Error fetching sessions:', error);
      setAllSessions([]);
      setSessions([]);
    }
  }

  function loadMoreSessions() {
    const newCount = displayedSessions + 20;
    setSessions(allSessions.slice(0, newCount));
    setDisplayedSessions(newCount);
  }

  function openSession(session: Session) {
    navigation.navigate('HittingSession', { sessionId: session.id, date: session.session_date, athleteId, source: session.source });
  }

  const onRefresh = async () => {
    setRefreshing(true);
    if (athleteId) {
      await fetchData(athleteId);
    }
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9BDDFF" />
        <Text style={styles.loadingText}>Loading hitting performance...</Text>
      </View>
    );
  }

  const o = overviewStats;
  const L = o?.last30;
  const P = o?.prior30;
  const delta = (a: number | null | undefined, b: number | null | undefined) => (isNum(a) && isNum(b) ? a - b : null);
  const lastHitTrax = allSessions.find((s) => s.source === 'hittrax' && (s.balls?.length || 0) > 0) || null;
  const pairedCount = allSessions.filter((s) => s.isPaired).length;
  const battedBallSessions = (o?.hittraxSessionCount || 0) + (o?.fullSwingSessionCount || 0);
  const spray = L?.avgSpray ?? null;
  const sprayWord = isNum(spray) ? (Math.abs(spray) < 0.05 ? 'CENTER' : spray < 0 ? 'PULL' : 'OPPO') : '';

  return (
    <View style={[steelStyles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9BDDFF" colors={['#9BDDFF']} progressBackgroundColor="#1A1A1A" />}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <ScreenHeader
          title="Hitting"
          subtitle={`Swing metrics and batted-ball analysis · ${(o?.blastSwingsAllTime ?? 0).toLocaleString()} Blast · ${(o?.hittraxSwingsAllTime ?? 0).toLocaleString()} HitTrax swings`}
          onBack={() => navigation.goBack()}
        />

        <View style={steelStyles.body}>
          {o && (
            <>
              <Section first title="ALL-TIME PRS" right={o.playLevel ? `vs ${o.playLevel}` : undefined}>
                <View style={styles.prRow}>
                  <PrColumn label="EXIT VELO" unit="mph" value={o.exitVeloPR} digits={1} accent={STEEL.force} norms={EXIT_VELO_NORMS} level={o.playLevel} missing="No HitTrax swings" />
                  <PrColumn label="BAT SPEED" unit="mph" value={o.batSpeedPR} digits={1} accent={STEEL.hitting} norms={BAT_SPEED_NORMS} level={o.playLevel} missing="No Blast swings" />
                  <PrColumn label="DISTANCE" unit="ft" value={o.distancePR} digits={0} accent={STEEL.good} norms={DISTANCE_NORMS} level={o.playLevel} missing="No HitTrax swings" />
                </View>
              </Section>

              <Section title="LAST 30 DAYS" right="vs prior 30">
                <KpiRow>
                  <Kpi label="AVG EV" value={fmt(L?.avgEV)} unit="MPH" size={20} delta={delta(L?.avgEV, P?.avgEV)} />
                  <Kpi label="HARD-HIT" value={fmt(L?.hardHitPct, 0)} unit="%" size={20} delta={delta(L?.hardHitPct, P?.hardHitPct)} />
                  <Kpi label="LAUNCH" value={isNum(L?.avgLA) ? `${fmt(L!.avgLA)}°` : '—'} size={20} delta={delta(L?.avgLA, P?.avgLA)} />
                  <Kpi label="SWEET SPOT" value={fmt(L?.sweetSpotPct, 0)} unit="%" size={20} delta={delta(L?.sweetSpotPct, P?.sweetSpotPct)} />
                </KpiRow>
                <KpiRow style={{ marginTop: 16 }}>
                  <Kpi label="AVG DIST" value={fmt(L?.avgDist, 0)} unit="FT" size={17} delta={delta(L?.avgDist, P?.avgDist)} />
                  <Kpi label="BAT SPEED" value={fmt(L?.avgBatSpeed)} unit="MPH" size={17} delta={delta(L?.avgBatSpeed, P?.avgBatSpeed)} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.kpiLabel}>SPRAY</Text>
                    <View style={styles.sprayRow}>
                      {isNum(spray) && (
                        <Ionicons name="arrow-up" size={14} color="#FFFFFF" style={{ transform: [{ rotate: `${-spray}deg` }] }} />
                      )}
                      <Text style={[styles.sprayValue, !isNum(spray) && { color: STEEL.past }]}>
                        {isNum(spray) ? `${Math.abs(spray).toFixed(1)}°` : '—'}
                      </Text>
                    </View>
                    {sprayWord ? <Text style={styles.kpiNote}>{sprayWord}</Text> : null}
                  </View>
                  <Kpi label="ATTACK" value={isNum(L?.avgAttackAngle) ? `${fmt(L!.avgAttackAngle)}°` : '—'} size={17} delta={delta(L?.avgAttackAngle, P?.avgAttackAngle)} />
                  <Kpi label="ON-PLANE" value={fmt(L?.avgOnPlane, 0)} unit="%" size={17} delta={delta(L?.avgOnPlane, P?.avgOnPlane)} />
                </KpiRow>
              </Section>
            </>
          )}

          {lastHitTrax && (
            <Section
              title={`LAST SESSION · ${formatDate(lastHitTrax.session_date, { month: 'short', day: 'numeric' }).toUpperCase()}`}
              right="Open →"
              onRight={() => openSession(lastHitTrax)}
            >
              <BallField3D
                balls={lastHitTrax.balls || []}
                height={200}
                caption={`${lastHitTrax.contact_swings} balls in play · max ${fmt(lastHitTrax.max_exit_velocity)} mph`}
              />
            </Section>
          )}

          <Section title="DIG IN">
            <View style={styles.tiles}>
              {[
                {
                  key: 'bb',
                  title: 'Batted Ball',
                  desc: 'EV, launch & spray over time',
                  status: battedBallSessions > 0 ? `${battedBallSessions} sessions →` : 'No HitTrax yet',
                  route: 'BattedBallTrends',
                },
                {
                  key: 'sw',
                  title: 'Swing Trends',
                  desc: 'Bat speed, attack angle, plane',
                  status: (o?.blastSwingsAllTime || 0) > 0 ? `${o!.blastSwingsAllTime} swings →` : 'No Blast yet',
                  route: 'HittingTrends',
                },
                {
                  key: 'pd',
                  title: 'Paired Data',
                  desc: 'Blast swing matched to the ball',
                  status: pairedCount > 0 ? `${pairedCount} sessions →` : 'No paired swings',
                  route: 'PairedDataTrends',
                },
              ].map((t) => (
                <TouchableOpacity key={t.key} style={styles.tile} activeOpacity={0.7} onPress={() => navigation.navigate(t.route, { athleteId })}>
                  <Text style={styles.tileTitle}>{t.title}</Text>
                  <Text style={styles.tileDesc} numberOfLines={2}>{t.desc}</Text>
                  <Text style={[styles.tileStatus, t.status.endsWith('→') ? { color: STEEL.hitting } : null]}>{t.status}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Section>

          <Section title="RECENT SESSIONS">
            {sessions.length > 0 ? (
              sessions.map((session) => {
                const color = session.source === 'fullswing' ? SOURCE_COLOR.fullswing : session.source === 'hittrax' ? (session.isPaired ? SOURCE_COLOR.paired : SOURCE_COLOR.hittrax) : SOURCE_COLOR.blast;
                const label = session.isPaired ? 'HITTRAX + BLAST' : session.source === 'hittrax' ? 'HITTRAX' : session.source === 'fullswing' ? 'FULL SWING' : 'BLAST';
                const count = session.isPaired ? `${session.total_swings} SWINGS · ${session.paired_swings_count} PAIRED` : `${session.total_swings} SWINGS`;
                const stats: { v: string; l: string; accent?: boolean }[] =
                  session.source === 'blast'
                    ? [
                        { v: fmt(session.avg_bat_speed), l: 'BAT SPD', accent: true },
                        { v: isNum(session.avg_attack_angle) ? `${fmt(session.avg_attack_angle)}°` : '—', l: 'ATTACK' },
                        { v: isNum(session.avg_on_plane_efficiency) ? `${fmt(session.avg_on_plane_efficiency, 0)}%` : '—', l: 'ON-PLANE' },
                      ]
                    : session.source === 'fullswing'
                    ? [
                        { v: fmt(session.avg_bat_speed), l: 'BAT SPD', accent: true },
                        { v: fmt(session.max_exit_velocity), l: 'MAX EV', accent: true },
                        { v: fmt(session.max_distance, 0), l: 'MAX FT' },
                      ]
                    : [
                        { v: fmt(session.max_exit_velocity), l: 'MAX EV', accent: true },
                        { v: fmt(session.avg_exit_velocity), l: 'AVG EV' },
                        { v: fmt(session.max_distance, 0), l: 'MAX FT' },
                      ];
                return (
                  <TouchableOpacity key={`${session.source}-${session.id}`} style={styles.sessRow} onPress={() => openSession(session)} activeOpacity={0.7}>
                    <View style={[styles.sessBar, { backgroundColor: color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sessDate}>{formatDate(session.session_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                      <Text style={styles.sessMeta}>{label} · {count}</Text>
                      {session.source === 'hittrax' && session.evs && session.evs.length > 1 && <Sparkline values={session.evs} />}
                    </View>
                    <View style={styles.sessStats}>
                      {stats.map((st) => (
                        <View key={st.l} style={styles.sessStat}>
                          <Text style={[styles.sessStatValue, st.v === '—' ? { color: STEEL.past } : st.accent ? { color: STEEL.force } : null]}>{st.v}</Text>
                          <Text style={styles.sessStatLabel}>{st.l}</Text>
                        </View>
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="baseball-bat" size={40} color="#4B5563" />
                <Text style={styles.emptyStateText}>No sessions found</Text>
                <Text style={styles.emptyStateSubtext}>Complete your first HitTrax session to get started</Text>
              </View>
            )}

            {sessions.length > 0 && displayedSessions < allSessions.length && (
              <TouchableOpacity style={styles.loadMoreButton} onPress={loadMoreSessions}>
                <Text style={styles.loadMoreText}>Load More ({allSessions.length - displayedSessions} remaining)</Text>
              </TouchableOpacity>
            )}
          </Section>
        </View>
      </ScrollView>

      {/* FAB Menu */}
      <FABMenu
        isOpen={fabOpen}
        onToggle={() => setFabOpen(!fabOpen)}
        totalBadgeCount={unreadMessagesCount + newResourcesCount}
        items={[
          { id: 'home', label: 'Home', icon: 'home', onPress: () => navigation.navigate(isParent ? 'ParentDashboard' : 'Dashboard') },
          { id: 'messages', label: 'Messages', icon: 'chatbubble', badge: unreadMessagesCount, onPress: () => navigation.navigate('Messages') },
          { id: 'performance', label: 'Performance', icon: 'stats-chart', onPress: () => navigation.navigate('Performance', { athleteId }) },
          { id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community', isActive: true, onPress: () => {} },
          ...(hasPitchingData || hasArmCareData || isMember ? [{ id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('PitchingHub', { athleteId }) }] : []),
          ...(hasMocapData ? [{ id: 'mocap', label: 'Motion Capture', icon: 'body', onPress: () => navigation.navigate('MocapSessions', { athleteId }) }] : []),
          ...(hasForceData ? [{ id: 'forceprofile', label: 'Force Profile', icon: 'trending-up', onPress: () => navigation.navigate('ForceProfile', { athleteId }) }] : []),
          { id: 'resources', label: 'Notes/Resources', icon: 'document-text', badge: newResourcesCount, onPress: () => navigation.navigate('Resources', { athleteId, userId }) },
          { id: 'book', label: 'Book a Class', icon: 'calendar', isBookButton: true, onPress: () => navigation.navigate('Booking') },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: STEEL.bg, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, color: STEEL.sub, fontSize: 14 },

  prRow: { flexDirection: 'row', gap: 12 },
  prCol: { flex: 1, gap: 4 },
  prLabel: { color: STEEL.mute, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  prValue: { color: STEEL.text, fontSize: 30, lineHeight: 33, fontWeight: '900', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  prUnit: { fontSize: 11, fontWeight: '700', color: STEEL.mute, letterSpacing: 0 },
  prBar: { height: 3, width: 28, borderRadius: 2, marginTop: 2 },
  prNote: { color: STEEL.mute, fontSize: 10.5, fontWeight: '600', marginTop: 2 },

  kpiLabel: { color: STEEL.mute, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  kpiNote: { color: STEEL.mute, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },
  sprayRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sprayValue: { color: STEEL.text, fontSize: 17, lineHeight: 18, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },

  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, backgroundColor: '#0c1016', borderWidth: 1, borderColor: STEEL.rule, borderRadius: 14, padding: 12, gap: 4 },
  tileTitle: { color: STEEL.text, fontSize: 13, fontWeight: '800' },
  tileDesc: { color: STEEL.sub, fontSize: 10.5, lineHeight: 14, fontWeight: '500', minHeight: 28 },
  tileStatus: { color: STEEL.mute, fontSize: 10.5, fontWeight: '700', marginTop: 2 },

  sessRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: STEEL.rule, gap: 12 },
  sessBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  sessDate: { color: STEEL.day, fontSize: 14.5, fontWeight: '700' },
  sessMeta: { color: STEEL.mute, fontSize: 9.5, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
  sessStats: { flexDirection: 'row', gap: 12 },
  sessStat: { alignItems: 'flex-end', minWidth: 40 },
  sessStatValue: { color: STEEL.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sessStatLabel: { color: STEEL.mute, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8, marginTop: 1 },

  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateText: { fontSize: 15, color: STEEL.sub, marginTop: 12, fontWeight: '700' },
  emptyStateSubtext: { fontSize: 13, color: STEEL.mute, marginTop: 6 },
  loadMoreButton: { marginTop: 16, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: STEEL.hair, alignItems: 'center' },
  loadMoreText: { fontSize: 13.5, fontWeight: '700', color: STEEL.force },
});
