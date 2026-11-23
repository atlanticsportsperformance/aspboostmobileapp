/**
 * PitchingScreen (route PitchingPerformance, also rendered by PitchingHub) —
 * Steel layout: PBs, last 30 days, latest pitch shapes, FB velo percentile,
 * tools, and the TrackMan session list.
 *
 * Data: pitches for the athlete are fetched once (paginated) and sessions
 * once; everything is aggregated client-side (no per-session queries).
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { getOrgIdForAthlete } from '../lib/orgSecurity';
import { getUnreadMessagesCount } from '../lib/unreadMessages';
import { useAthlete } from '../contexts/AthleteContext';
import FABMenu from '../components/FABMenu';
import { useAthleteLifecycle } from '../lib/useAthleteLifecycle';
import { STEEL, fmt, Section, Kpi, KpiRow, ScreenHeader, Segmented, steelStyles } from '../components/hitting/steel';
import { PitchPaths3D } from '../components/dashboard/feed/three/PitchPaths3D';
import { PercentileLadder } from '../components/dashboard/feed/PercentileLadder';
import { FB_VELO_NORMS, normalizePlayLevel } from '../lib/norms';
import { normalizePitchType } from '../components/pitching/pitchColors';

const ACCENT = STEEL.force;
const BATCH_SIZE = 1000;
const PAGE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
// Strike zone: 1.5–3.5 ft tall; half plate (0.83 ft) + ball radius (~0.12 ft).
const ZONE_LO = 1.5;
const ZONE_HI = 3.5;
const ZONE_HALF = 0.83 + 0.12;

type PitchRow = {
  session_id: number;
  rel_speed: number | string | null;
  spin_rate: number | string | null;
  tagged_pitch_type: string | null;
  plate_loc_height: number | string | null;
  plate_loc_side: number | string | null;
  pitch_uid: string | null;
  video_clip_id: string | null;
};

type SessionRow = { id: number; game_date_utc: string | null; created_at: string | null; venue_name: string | null; session_type?: string | null };

type SessionSummary = {
  id: number;
  date: string | null;
  venue: string;
  pitchCount: number;
  maxVelo: number | null;
  clips: number;
};

type Overview = {
  sessions: number;
  pitches: number;
  maxVelo: number | null;
  maxSpin: number | null;
  fbAvg30: number | null;
  strikePct30: number | null;
  stuff30: number | null;
  fbVeloPR: number | null;
};

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

async function fetchAllPitches(athleteId: string): Promise<PitchRow[]> {
  const all: PitchRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('trackman_pitch_data')
      .select('session_id, rel_speed, spin_rate, tagged_pitch_type, plate_loc_height, plate_loc_side, pitch_uid, video_clip_id')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) {
      console.error('[PitchingScreen] pitch fetch error:', error);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...(data as PitchRow[]));
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
  return all;
}

function sessionTime(s: { game_date_utc: string | null; created_at: string | null }): number | null {
  for (const v of [s.game_date_utc, s.created_at]) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isFinite(t) && t > 0) return t;
  }
  return null;
}

function localDateIso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatRelativeDate(isoDate: string): string {
  // exam_date is a plain date; parse as local to avoid a UTC off-by-one.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(isoDate);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / DAY_MS);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PitchingScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { isParent, linkedAthletes } = useAthlete();
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);

  // Guard: If parent arrives without athleteId, go back (they should use FAB which passes athleteId)
  useEffect(() => {
    if (isParent && !route?.params?.athleteId && linkedAthletes.length > 0) {
      navigation.goBack();
    }
  }, [isParent, route?.params?.athleteId, linkedAthletes]);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([]);
  const [playLevel, setPlayLevel] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'video'>('all');
  const [displayed, setDisplayed] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const { isMember } = useAthleteLifecycle(athleteId);

  // Tools stats
  const [todayW, setTodayW] = useState<number | null>(null);
  const [todayThrows, setTodayThrows] = useState(0);
  const [armScore, setArmScore] = useState<number | null>(null);
  const [armDate, setArmDate] = useState<string | null>(null);

  // Dynamic FAB menu data availability flags (matching DashboardScreen)
  const [hittingData, setHittingData] = useState<boolean>(false);
  const [armCareData, setArmCareData] = useState<boolean>(false);
  const [forceProfileData, setForceProfileData] = useState<boolean>(false);
  const [hasMocapData, setHasMocapData] = useState(false);
  const [hasResourcesData, setHasResourcesData] = useState<boolean>(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState<number>(0);
  const [newResourcesCount, setNewResourcesCount] = useState<number>(0);
  const [userId, setUserId] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const isLoadingRef = useRef(false);
  const lastLoadTimeRef = useRef<number>(0);

  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;
      const timeSinceLastLoad = Date.now() - lastLoadTimeRef.current;
      if (!isLoadingRef.current && timeSinceLastLoad > 30000) {
        loadAthleteAndData();
      }
      return () => {
        isMountedRef.current = false;
      };
    }, [])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadAthleteAndData();
    } finally {
      if (isMountedRef.current) setRefreshing(false);
    }
  }, []);

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
        const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).maybeSingle();
        if (!athlete) {
          isLoadingRef.current = false;
          if (isMountedRef.current) setLoading(false);
          return;
        }
        currentAthleteId = athlete.id as string;
        if (isMountedRef.current) setAthleteId(currentAthleteId);
      }

      if (!isMountedRef.current) {
        isLoadingRef.current = false;
        return;
      }

      await Promise.all([
        fetchPitchingData(currentAthleteId),
        fetchToolStats(currentAthleteId),
        fetchFabDataAvailability(currentAthleteId, user.id),
      ]);

      isLoadingRef.current = false;
      if (isMountedRef.current) setLoading(false);
    } catch (error) {
      console.error('Error loading athlete:', error);
      isLoadingRef.current = false;
      if (isMountedRef.current) setLoading(false);
    }
  }

  async function fetchFabDataAvailability(athleteIdParam: string, userIdParam: string) {
    try {
      const orgId = await getOrgIdForAthlete(athleteIdParam);
      if (!orgId) {
        console.error('[PitchingScreen] No org_id found for athlete');
        return;
      }

      const [blastSwings, hittraxSessions, fullSwingSessions] = await Promise.all([
        supabase.from('blast_swings').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('hittrax_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('fullswing_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
      ]);
      setHittingData((blastSwings.count || 0) > 0 || (hittraxSessions.count || 0) > 0 || (fullSwingSessions.count || 0) > 0);

      const { count: armCareCount } = await supabase
        .from('armcare_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteIdParam);
      setArmCareData((armCareCount || 0) > 0);

      const { count: forceCount } = await supabase
        .from('force_plate_percentiles')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteIdParam);
      setForceProfileData((forceCount || 0) > 0);

      const { count: mocapCount } = await supabase
        .from('mocap_pitches')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteIdParam)
        .not('r2_uploaded_at', 'is', null);
      setHasMocapData((mocapCount || 0) > 0);

      const { count: resourcesCount } = await supabase
        .from('resources')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('athlete_id', userIdParam);
      setHasResourcesData((resourcesCount || 0) > 0);

      const { data: athleteWithLastViewed } = await supabase
        .from('athletes')
        .select('last_viewed_resources_at')
        .eq('id', athleteIdParam)
        .single();

      if (athleteWithLastViewed?.last_viewed_resources_at) {
        const { count: newCount } = await supabase
          .from('resources')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('athlete_id', userIdParam)
          .gt('created_at', athleteWithLastViewed.last_viewed_resources_at);
        setNewResourcesCount(newCount || 0);
      } else {
        setNewResourcesCount(resourcesCount || 0);
      }

      setUnreadMessagesCount(await getUnreadMessagesCount(userIdParam));
    } catch (error) {
      console.error('Error fetching FAB data availability:', error);
    }
  }

  async function fetchToolStats(id: string) {
    try {
      const [today, lastArm] = await Promise.all([
        supabase
          .from('pulse_daily_workload')
          .select('w_day, throw_count')
          .eq('athlete_id', id)
          .eq('training_date', localDateIso())
          .maybeSingle(),
        supabase
          .from('armcare_sessions')
          .select('arm_score, exam_date')
          .eq('athlete_id', id)
          .not('arm_score', 'is', null)
          .order('exam_date', { ascending: false })
          .order('exam_time', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!isMountedRef.current) return;
      setTodayW(today.data?.w_day != null ? Number(today.data.w_day) : null);
      setTodayThrows(today.data?.throw_count ?? 0);
      setArmScore(lastArm.data?.arm_score != null ? Number(lastArm.data.arm_score) : null);
      setArmDate(lastArm.data?.exam_date ?? null);
    } catch (e) {
      console.error('[PitchingScreen] tool stats error:', e);
    }
  }

  async function fetchPitchingData(id: string) {
    const [pitches, athleteRes] = await Promise.all([
      fetchAllPitches(id),
      supabase.from('athletes').select('play_level').eq('id', id).maybeSingle(),
    ]);
    if (isMountedRef.current) setPlayLevel((athleteRes.data as any)?.play_level ?? null);

    const sessionIds = [...new Set(pitches.map((p) => p.session_id).filter((s) => s != null))];
    const sessionRows: SessionRow[] = [];
    for (let i = 0; i < sessionIds.length; i += 300) {
      const { data } = await supabase
        .from('trackman_session')
        .select('id, game_date_utc, created_at, venue_name')
        .in('id', sessionIds.slice(i, i + 300));
      if (data) sessionRows.push(...(data as SessionRow[]));
    }
    const sessionById = new Map(sessionRows.map((s) => [s.id, s]));

    // Per-session aggregation
    const agg = new Map<number, { count: number; max: number | null; clips: number }>();
    let maxVelo: number | null = null;
    let maxSpin: number | null = null;
    let fbVeloPR: number | null = null;
    const cutoff = Date.now() - 30 * DAY_MS;
    const fb30: number[] = [];
    let located30 = 0;
    let strikes30 = 0;
    const uids30: string[] = [];

    for (const p of pitches) {
      const a = agg.get(p.session_id) ?? { count: 0, max: null, clips: 0 };
      a.count += 1;
      const v = num(p.rel_speed);
      const spin = num(p.spin_rate);
      if (v != null && v > 0) {
        if (a.max == null || v > a.max) a.max = v;
        if (maxVelo == null || v > maxVelo) maxVelo = v;
      }
      if (spin != null && spin > 0 && (maxSpin == null || spin > maxSpin)) maxSpin = spin;
      if (p.video_clip_id != null) a.clips += 1;
      agg.set(p.session_id, a);

      const isFB = normalizePitchType(p.tagged_pitch_type) === 'Fastball';
      if (isFB && v != null && v > 0 && (fbVeloPR == null || v > fbVeloPR)) fbVeloPR = v;

      const s = sessionById.get(p.session_id);
      const t = s ? sessionTime(s) : null;
      if (t != null && t >= cutoff) {
        if (isFB && v != null && v > 0) fb30.push(v);
        const h = num(p.plate_loc_height);
        const side = num(p.plate_loc_side);
        if (h != null && side != null) {
          located30 += 1;
          if (h >= ZONE_LO && h <= ZONE_HI && Math.abs(side) <= ZONE_HALF) strikes30 += 1;
        }
        if (p.pitch_uid) uids30.push(p.pitch_uid);
      }
    }

    // Stuff+ for last-30 pitches
    const stuff: number[] = [];
    for (let i = 0; i < uids30.length; i += 300) {
      const { data } = await supabase
        .from('pitch_stuff_plus')
        .select('pitch_uid, stuff_plus')
        .in('pitch_uid', uids30.slice(i, i + 300));
      (data || []).forEach((r: any) => {
        const n = num(r.stuff_plus);
        if (n != null) stuff.push(n);
      });
    }

    const summaries: SessionSummary[] = sessionIds
      .map((sid) => {
        const s = sessionById.get(sid);
        const a = agg.get(sid)!;
        const t = s ? sessionTime(s) : null;
        return {
          id: sid,
          date: t != null ? new Date(t).toISOString() : null,
          venue: s?.venue_name || 'Bullpen',
          pitchCount: a.count,
          maxVelo: a.max,
          clips: a.clips,
        };
      })
      .sort((x, y) => (y.date ? Date.parse(y.date) : 0) - (x.date ? Date.parse(x.date) : 0));

    if (!isMountedRef.current) return;
    setOverview({
      sessions: sessionIds.length,
      pitches: pitches.length,
      maxVelo,
      maxSpin,
      fbAvg30: avg(fb30),
      strikePct30: located30 > 0 ? (strikes30 / located30) * 100 : null,
      stuff30: avg(stuff),
      fbVeloPR,
    });
    setAllSessions(summaries);
    setDisplayed(PAGE);
  }

  const filtered = useMemo(
    () => (filter === 'video' ? allSessions.filter((s) => s.clips > 0) : allSessions),
    [allSessions, filter]
  );
  const visible = filtered.slice(0, displayed);
  const latest = allSessions[0] ?? null;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>Loading pitching data...</Text>
      </View>
    );
  }

  const o = overview;
  const tools: { key: string; icon: React.ReactNode; title: string; stat: string; onPress: () => void }[] = [
    {
      key: 'trends',
      icon: <Ionicons name="analytics" size={18} color={ACCENT} />,
      title: 'Velocity trends',
      stat: o && o.sessions > 0 ? `${o.sessions} sessions` : 'No sessions yet',
      onPress: () => navigation.navigate('PitchingTrends', { athleteId }),
    },
    ...(isMember
      ? [
          {
            key: 'workload',
            icon: <MaterialCommunityIcons name="chart-bell-curve-cumulative" size={18} color={ACCENT} />,
            title: 'Workload',
            stat: todayW != null ? `${todayW.toFixed(0)} W today · ${todayThrows} throws` : 'No throws today',
            onPress: () => navigation.navigate('Workload'),
          },
        ]
      : []),
    {
      key: 'armcare',
      icon: <MaterialCommunityIcons name="arm-flex" size={18} color={ACCENT} />,
      title: 'Arm Care',
      stat: armScore != null ? `ArmScore ${armScore.toFixed(0)}${armDate ? ' · ' + formatRelativeDate(armDate) : ''}` : 'No exams yet',
      onPress: () => athleteId && navigation.navigate('ArmCareHub', { athleteId }),
    },
  ];

  return (
    <View style={[steelStyles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} colors={[ACCENT]} progressBackgroundColor="#1A1A1A" />}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <ScreenHeader
          title="Pitching"
          subtitle={`TrackMan · ${(o?.sessions ?? 0).toLocaleString()} sessions · ${(o?.pitches ?? 0).toLocaleString()} pitches`}
          onBack={() => navigation.goBack()}
        />

        <View style={steelStyles.body}>
          <Section first title="PERSONAL BESTS">
            <KpiRow>
              <Kpi label="MAX VELO" value={fmt(o?.maxVelo)} unit="MPH" color={ACCENT} size={28} />
              <Kpi label="MAX SPIN" value={fmt(o?.maxSpin, 0)} unit="RPM" size={28} />
              <Kpi label="PITCHES" value={o && o.pitches > 0 ? o.pitches.toLocaleString() : '—'} size={28} />
            </KpiRow>
          </Section>

          <Section title="LAST 30 DAYS">
            <KpiRow>
              <Kpi label="FB AVG VELO" value={fmt(o?.fbAvg30)} unit="MPH" size={20} />
              <Kpi label="STRIKE %" value={fmt(o?.strikePct30, 0)} unit="%" size={20} />
              <Kpi label="AVG STUFF+" value={fmt(o?.stuff30, 0)} size={20} />
            </KpiRow>
          </Section>

          {latest && (
            <Section
              title="LATEST PITCH SHAPES"
              right="Session ›"
              rightColor={ACCENT}
              onRight={() => navigation.navigate('PitchingSession', { sessionId: latest.id, athleteId })}
            >
              <PitchPaths3D athleteId={athleteId} />
            </Section>
          )}

          {o?.fbVeloPR != null && (
            <Section title="FB VELO VS LEVEL">
              <PercentileLadder
                defaultLevel={normalizePlayLevel(playLevel)}
                metrics={[{ label: 'Fastball velo', value: o.fbVeloPR, unit: 'mph', norms: FB_VELO_NORMS }]}
              />
            </Section>
          )}

          <Section title="TOOLS">
            {tools.map((t) => (
              <TouchableOpacity key={t.key} style={styles.toolRow} onPress={t.onPress} activeOpacity={0.7}>
                <View style={styles.toolIcon}>{t.icon}</View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toolTitle}>{t.title}</Text>
                  <Text style={styles.toolStat}>{t.stat}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={STEEL.past} />
              </TouchableOpacity>
            ))}
          </Section>

          <Section title="SESSIONS">
            <View style={{ marginBottom: 8 }}>
              <Segmented
                options={[
                  { key: 'all', label: 'All' },
                  { key: 'video', label: 'Video' },
                ]}
                value={filter}
                onChange={(v) => {
                  setFilter(v);
                  setDisplayed(PAGE);
                }}
              />
            </View>
            {visible.length > 0 ? (
              visible.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.sessRow}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('PitchingSession', { sessionId: s.id, athleteId })}
                >
                  <View style={[styles.sessBar, { backgroundColor: ACCENT }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessDate}>
                      {s.date
                        ? new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                        : 'Undated session'}
                    </Text>
                    <Text style={styles.sessMeta}>
                      {s.venue.toUpperCase()} · {s.pitchCount} PITCHES
                    </Text>
                  </View>
                  {s.clips > 0 && (
                    <View style={styles.clipPill}>
                      <Text style={styles.clipText}>▶ {s.clips} CLIPS</Text>
                    </View>
                  )}
                  <View style={styles.sessStat}>
                    <Text style={[styles.sessStatValue, { color: s.maxVelo == null ? STEEL.past : ACCENT }]}>{fmt(s.maxVelo)}</Text>
                    <Text style={styles.sessStatLabel}>MAX MPH</Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="baseball" size={40} color={STEEL.past} />
                <Text style={styles.emptyStateText}>{filter === 'video' ? 'No sessions with video' : 'No pitching sessions found'}</Text>
                {filter === 'all' && <Text style={styles.emptyStateSubtext}>Throw a TrackMan bullpen to get started</Text>}
              </View>
            )}

            {displayed < filtered.length && (
              <TouchableOpacity style={styles.loadMoreButton} onPress={() => setDisplayed(displayed + PAGE)}>
                <Text style={styles.loadMoreText}>Load More ({filtered.length - displayed} remaining)</Text>
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
          ...(hittingData ? [{ id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('HittingPerformance', { athleteId }) }] : []),
          { id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, isActive: true, onPress: () => navigation.navigate('PitchingHub' as never, { athleteId } as never) },
          ...(hasMocapData ? [{ id: 'mocap', label: 'Motion Capture', icon: 'body', onPress: () => navigation.navigate('MocapSessions', { athleteId }) }] : []),
          ...(forceProfileData ? [{ id: 'force', label: 'Force Profile', icon: 'lightning-bolt', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('ForceProfile', { athleteId }) }] : []),
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

  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: STEEL.rule },
  toolIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: STEEL.card, alignItems: 'center', justifyContent: 'center' },
  toolTitle: { color: STEEL.text, fontSize: 14.5, fontWeight: '700' },
  toolStat: { color: STEEL.mute, fontSize: 11.5, fontWeight: '600', marginTop: 2 },

  sessRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: STEEL.rule, gap: 12 },
  sessBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  sessDate: { color: STEEL.day, fontSize: 14.5, fontWeight: '700' },
  sessMeta: { color: STEEL.mute, fontSize: 9.5, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
  sessStat: { alignItems: 'flex-end', minWidth: 48 },
  sessStatValue: { color: STEEL.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sessStatLabel: { color: STEEL.mute, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8, marginTop: 1 },
  clipPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(155,221,255,0.35)', backgroundColor: 'rgba(155,221,255,0.08)' },
  clipText: { color: ACCENT, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6 },

  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateText: { fontSize: 15, color: STEEL.sub, marginTop: 12, fontWeight: '700' },
  emptyStateSubtext: { fontSize: 13, color: STEEL.mute, marginTop: 6 },
  loadMoreButton: { marginTop: 16, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: STEEL.hair, alignItems: 'center' },
  loadMoreText: { fontSize: 13.5, fontWeight: '700', color: ACCENT },
});
