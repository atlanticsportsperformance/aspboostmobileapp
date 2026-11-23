/**
 * MocapSessionsScreen (route MocapSessions) — Steel layout: category chips,
 * latest assessment ring, and the session list.
 *
 * Data: lib/mocap/api fetchMocapSessions returns one row per session with its
 * highlight pitch only — no per-session throw counts, so none are shown.
 */
import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Circle } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { getOrgIdForAthlete } from '../lib/orgSecurity';
import { fetchMocapSessions, type MocapSession } from '../lib/mocap/api';
import FABMenu from '../components/FABMenu';
import { useAthleteLifecycle } from '../lib/useAthleteLifecycle';
import { STEEL, fmt, Section, ScreenHeader, steelStyles } from '../components/hitting/steel';

const ACCENT = STEEL.purple;
const PAGE = 20;

// ─── Category metadata ────────────────────────────────────────────────────
// Known categories map to labels + a sport accent; anything unknown falls
// back to a gray chip so unfamiliar categories are never hidden.
type CategoryMeta = {
  label: string;
  short: string;
  sport: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  accent: string;
  layout: 'pitching' | 'hitting';
};

const CATEGORY_META: Record<string, CategoryMeta> = {
  baseball_pitching: { label: 'Pitching', short: 'Pitching', sport: 'Baseball', icon: 'baseball', accent: '#9BDDFF', layout: 'pitching' },
  baseball_hitting: { label: 'Hitting', short: 'Hitting', sport: 'Baseball', icon: 'baseball-bat', accent: '#FBBF24', layout: 'hitting' },
  softball_pitching: { label: 'Pitching', short: 'Pitching', sport: 'Softball', icon: 'baseball', accent: '#FFD58A', layout: 'pitching' },
  softball_hitting: { label: 'Hitting', short: 'Hitting', sport: 'Softball', icon: 'baseball-bat', accent: '#A7F3D0', layout: 'hitting' },
};

const FALLBACK_META: CategoryMeta = {
  label: 'Other',
  short: 'Session',
  sport: '',
  icon: 'human',
  accent: STEEL.sub,
  layout: 'pitching',
};

function metaFor(category: string | null | undefined): CategoryMeta {
  if (!category) return FALLBACK_META;
  return CATEGORY_META[category] ?? {
    ...FALLBACK_META,
    label: category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    short: category.replace(/_/g, ' '),
  };
}

// `athletes.bats` is 'Right' | 'Left' | 'Both' → RHH / LHH / SH.
function batsTag(bats: string | null | undefined): string | null {
  if (!bats) return null;
  if (bats === 'Right') return 'RHH';
  if (bats === 'Left') return 'LHH';
  if (bats === 'Both') return 'SH';
  return null;
}

/**
 * Session date, never 1969/1970: date-only strings are parsed as local days
 * (new Date('YYYY-MM-DD') is UTC midnight → previous day in US zones); falls
 * back to started_at, else null.
 */
function sessionDate(s: MocapSession): Date | null {
  for (const raw of [s.session_date, s.started_at]) {
    if (!raw) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(raw);
    if (Number.isFinite(d.getTime()) && d.getFullYear() > 1970) return d;
  }
  return null;
}
const dateMs = (s: MocapSession) => sessionDate(s)?.getTime() ?? 0;
const fmtDate = (d: Date | null, withYear = true) =>
  d ? d.toLocaleDateString('en-US', withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }) : 'Undated session';

/** Pitching sessions show release velo; hitting shows bat speed. */
function topSpeed(s: MocapSession): { value: number | null; label: string } {
  const p = s.mocap_pitches;
  if (metaFor(s.category).layout === 'hitting') return { value: p?.bat_speed_mph ?? null, label: 'BAT MPH' };
  return { value: p?.velocity_mph ?? null, label: 'MPH' };
}

function sideTag(s: MocapSession, athleteBats: string | null): string | null {
  if (metaFor(s.category).layout === 'hitting') {
    return batsTag((s as any).athlete_bats ?? athleteBats);
  }
  return s.athlete_throws ? `${s.athlete_throws}HP` : null;
}

export default function MocapSessionsScreen({ navigation, route }: any) {
  const passedAthleteId = route?.params?.athleteId;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(passedAthleteId || null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<MocapSession[]>([]);
  const [displayedCount, setDisplayedCount] = useState(PAGE);
  // 'all' or one of the keys in CATEGORY_META. Filter pills only show for
  // categories that have at least one session, so this rarely outpaces what
  // the athlete actually has.
  const [activeCategory, setActiveCategory] = useState<string>('all');

  // FAB
  const [fabOpen, setFabOpen] = useState(false);
  const { isMember } = useAthleteLifecycle();
  const [hittingData, setHittingData] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [armCareData, setArmCareData] = useState(false);
  const [forceProfileData, setForceProfileData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [newResourcesCount, setNewResourcesCount] = useState(0);
  // Athlete's batting side from `athletes.bats` ('Right' | 'Left' | 'Both').
  // The mocap API doesn't include a per-session bats field the way it does
  // for throws, so we surface the athlete's general stance on hitting cards.
  const [athleteBats, setAthleteBats] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const isLoadingRef = useRef(false);
  const lastLoadTimeRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;
      const now = Date.now();
      if (!isLoadingRef.current && now - lastLoadTimeRef.current > 30000) {
        loadData();
      }
      return () => { isMountedRef.current = false; };
    }, [])
  );

  async function loadData() {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    lastLoadTimeRef.current = Date.now();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigation.replace('Login'); return; }
      if (isMountedRef.current) setUserId(user.id);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigation.replace('Login'); return; }

      let currentAthleteId = athleteId;
      if (!currentAthleteId) {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id')
          .eq('user_id', user.id)
          .single();
        if (!athlete) {
          isLoadingRef.current = false;
          if (isMountedRef.current) setLoading(false);
          return;
        }
        currentAthleteId = athlete.id;
        if (isMountedRef.current) setAthleteId(athlete.id);
      }

      if (!currentAthleteId) {
        if (isMountedRef.current) setLoading(false);
        return;
      }

      // Pull the athlete's batting side once per load so hitting cards
      // can render RHH / LHH / SH next to the activity tag. Cheap single-
      // row read, runs in parallel with the mocap fetch.
      const batsPromise = supabase
        .from('athletes')
        .select('bats')
        .eq('id', currentAthleteId)
        .maybeSingle();

      const [data, batsResult] = await Promise.all([
        fetchMocapSessions(currentAthleteId, session.access_token),
        batsPromise,
      ]);
      if (isMountedRef.current) {
        setAthleteBats(batsResult.data?.bats ?? null);
      }

      if (isMountedRef.current) {
        data.sort((a, b) => dateMs(b) - dateMs(a));
        setSessions(data);
      }

      // Fetch FAB data availability
      fetchFabData(currentAthleteId, user.id);
    } catch (error) {
      console.error('Error loading mocap sessions:', error);
    } finally {
      isLoadingRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  async function fetchFabData(athleteIdParam: string, userIdParam: string) {
    try {
      const [blastSwings, hittraxSessions, fullSwingSessions, trackmanResult, commandResult, armCareResult, forceResult] = await Promise.all([
        supabase.from('blast_swings').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('hittrax_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('fullswing_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('trackman_pitch_data').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('command_training_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('armcare_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('force_plate_percentiles').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
      ]);
      if (!isMountedRef.current) return;
      setHittingData((blastSwings.count || 0) > 0 || (hittraxSessions.count || 0) > 0 || (fullSwingSessions.count || 0) > 0);
      setHasPitchingData((trackmanResult.count || 0) > 0 || (commandResult.count || 0) > 0);
      setArmCareData((armCareResult.count || 0) > 0);
      setForceProfileData((forceResult.count || 0) > 0);

      const orgId = await getOrgIdForAthlete(athleteIdParam);
      if (orgId && isMountedRef.current) {
        const { count: resourcesCount } = await supabase.from('resources').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('athlete_id', userIdParam);
        const { data: athleteViewed } = await supabase.from('athletes').select('last_viewed_resources_at').eq('id', athleteIdParam).single();
        if (athleteViewed?.last_viewed_resources_at) {
          const { count: newCount } = await supabase.from('resources').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('athlete_id', userIdParam).gt('created_at', athleteViewed.last_viewed_resources_at);
          setNewResourcesCount(newCount || 0);
        } else {
          setNewResourcesCount(resourcesCount || 0);
        }
      }

      const { data: participants } = await supabase.from('conversation_participants').select('conversation_id, last_read_at').eq('user_id', userIdParam).eq('is_archived', false);
      if (participants && participants.length > 0 && isMountedRef.current) {
        // One query for every conversation (was one count query per
        // conversation). Same rule as before: messages newer than that
        // participant's last_read_at; filtered per conversation client-side.
        const lastRead = new Map<string, string>();
        for (const p of participants) lastRead.set(p.conversation_id, p.last_read_at || '1970-01-01');
        // Head counts in parallel (no message rows downloaded).
        const counts = await Promise.all(
          Array.from(lastRead.entries()).map(([cid, lr]) =>
            supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', cid).gt('created_at', lr),
          ),
        );
        const unread = counts.reduce((n, r) => n + (r.count || 0), 0);
        if (isMountedRef.current) setUnreadMessagesCount(unread);
      }
    } catch (err) {
      console.error('Error fetching FAB data:', err);
    }
  }

  const onRefresh = () => {
    setRefreshing(true);
    lastLoadTimeRef.current = 0;
    loadData();
  };

  // Chip list: categories the athlete actually has, most-used first.
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      const key = s.category || 'other';
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [sessions]);

  const visibleCategories = useMemo(
    () => Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]).map(([key]) => key),
    [categoryCounts]
  );

  const filteredSessions = useMemo(() => {
    if (activeCategory === 'all') return sessions;
    return sessions.filter((s) => (s.category || 'other') === activeCategory);
  }, [sessions, activeCategory]);

  const displayedSessions = filteredSessions.slice(0, displayedCount);

  // Latest assessment = newest session (in the active filter) with a highlight.
  const latest = useMemo(() => filteredSessions.find((s) => s.mocap_pitches) ?? null, [filteredSessions]);

  const openSession = (session: MocapSession) => {
    const pitch = session.mocap_pitches;
    if (pitch) {
      navigation.navigate('MocapPitchDetail', {
        athleteId,
        pitchId: pitch.id,
        sessionId: session.id,
        sessionDate: session.session_date,
        category: session.category,
      });
    }
  };

  const insets = useSafeAreaInsets();

  if (loading) {
    return (
      <View style={[steelStyles.screen, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>Loading mocap sessions...</Text>
      </View>
    );
  }

  const latestMeta = latest ? metaFor(latest.category) : null;
  const latestSpeed = latest ? topSpeed(latest) : null;

  return (
    <View style={[steelStyles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} colors={[ACCENT]} progressBackgroundColor="#1A1A1A" />
        }
      >
        <ScreenHeader
          title="Motion Capture"
          // Throw/swing counts aren't in the sessions API (highlight pitch
          // only), so the subtitle shows session count alone.
          subtitle={`${sessions.length.toLocaleString()} session${sessions.length !== 1 ? 's' : ''}`}
          onBack={() => navigation.goBack()}
        />

        <View style={steelStyles.body}>
          {visibleCategories.length > 1 && (
            <Section first>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Chip
                  label="All"
                  count={sessions.length}
                  active={activeCategory === 'all'}
                  onPress={() => { setActiveCategory('all'); setDisplayedCount(PAGE); }}
                />
                {visibleCategories.map((cat) => {
                  const meta = metaFor(cat);
                  return (
                    <Chip
                      key={cat}
                      label={meta.sport && visibleSports(visibleCategories) > 1 ? `${meta.sport} ${meta.label}` : meta.label}
                      count={categoryCounts.get(cat) ?? 0}
                      active={activeCategory === cat}
                      accent={meta.accent}
                      onPress={() => { setActiveCategory(cat); setDisplayedCount(PAGE); }}
                    />
                  );
                })}
              </ScrollView>
            </Section>
          )}

          {latest && latestMeta && latestSpeed && (
            <Section first={visibleCategories.length <= 1} title="LATEST ASSESSMENT" right="Open ›" rightColor={ACCENT} onRight={() => openSession(latest)}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => openSession(latest)} style={styles.latestRow}>
                {/* TODO(mocap-report): ring should show the composite score +
                    tier from components/mocap/report useMocapScores(detail)
                    once that module lands; until then it shows the highlight's
                    velo / bat speed only — no fabricated score. */}
                <Ring color={latestMeta.accent}>
                  <Text style={styles.ringValue}>{fmt(latestSpeed.value)}</Text>
                  <Text style={styles.ringUnit}>{latestSpeed.label}</Text>
                </Ring>
                <View style={{ flex: 1 }}>
                  <Text style={styles.latestTitle}>{latestMeta.layout === 'hitting' ? 'Highlight swing' : 'Highlight throw'}</Text>
                  <Text style={styles.latestMeta}>
                    {[
                      fmtDate(sessionDate(latest), false),
                      latest.mocap_pitches?.pitch_type || null,
                      latestSpeed.value != null ? `${fmt(latestSpeed.value)} ${latestMeta.layout === 'hitting' ? 'mph bat' : 'mph'}` : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={[styles.latestTag, { color: latestMeta.accent }]}>
                    {[latestMeta.short.toUpperCase(), sideTag(latest, athleteBats)].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </TouchableOpacity>
            </Section>
          )}

          <Section
            first={visibleCategories.length <= 1 && !latest}
            title={activeCategory === 'all' ? 'SESSIONS' : metaFor(activeCategory).label.toUpperCase()}
            right={`${filteredSessions.length} session${filteredSessions.length !== 1 ? 's' : ''}`}
          >
            {displayedSessions.length > 0 ? (
              displayedSessions.map((session, idx) => {
                const pitch = session.mocap_pitches;
                const meta = metaFor(session.category);
                const speed = topSpeed(session);
                const side = sideTag(session, athleteBats);
                return (
                  <TouchableOpacity
                    key={`${session.id}-${pitch?.id || idx}`}
                    style={styles.sessRow}
                    activeOpacity={0.7}
                    onPress={() => openSession(session)}
                  >
                    <View style={[styles.sessBar, { backgroundColor: meta.accent }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sessDate}>
                        {fmtDate(sessionDate(session))}
                        <Text style={styles.sessInline}>
                          {'  '}· {meta.short}{side ? ` · ${side}` : ''}
                        </Text>
                      </Text>
                      <Text style={styles.sessMeta}>
                        {[
                          pitch?.pitch_type ? pitch.pitch_type.toUpperCase() : null,
                          pitch ? `${meta.layout === 'hitting' ? 'SWING' : 'THROW'} #${pitch.pitch_number}` : null,
                        ].filter(Boolean).join(' · ') || meta.sport.toUpperCase()}
                      </Text>
                    </View>
                    {pitch?.r2_video_key ? (
                      <View style={[styles.clipPill, { borderColor: meta.accent + '59', backgroundColor: meta.accent + '14' }]}>
                        <Text style={[styles.clipText, { color: meta.accent }]}>▶ VIDEO</Text>
                      </View>
                    ) : null}
                    <View style={styles.sessStat}>
                      <Text style={[styles.sessStatValue, { color: speed.value == null ? STEEL.past : meta.accent }]}>{fmt(speed.value)}</Text>
                      <Text style={styles.sessStatLabel}>{speed.label}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : (
              <View style={styles.emptyState}>
                <Ionicons name="body-outline" size={40} color={STEEL.past} />
                <Text style={styles.emptyStateText}>
                  {activeCategory === 'all'
                    ? 'No mocap sessions available'
                    : `No ${metaFor(activeCategory).label.toLowerCase()} sessions yet`}
                </Text>
                <Text style={styles.emptyStateSubtext}>Motion capture data will appear here after your sessions.</Text>
              </View>
            )}

            {displayedCount < filteredSessions.length && (
              <TouchableOpacity style={styles.loadMoreButton} onPress={() => setDisplayedCount((c) => c + PAGE)}>
                <Text style={styles.loadMoreText}>Load More ({filteredSessions.length - displayedCount} remaining)</Text>
              </TouchableOpacity>
            )}
          </Section>
        </View>
      </ScrollView>

      <FABMenu
        isOpen={fabOpen}
        onToggle={() => setFabOpen(!fabOpen)}
        totalBadgeCount={unreadMessagesCount + newResourcesCount}
        items={[
          { id: 'home', label: 'Home', icon: 'home', onPress: () => navigation.navigate('Dashboard') },
          { id: 'messages', label: 'Messages', icon: 'chatbubble', badge: unreadMessagesCount, onPress: () => navigation.navigate('Messages') },
          { id: 'performance', label: 'Performance', icon: 'stats-chart', onPress: () => navigation.navigate('Performance', { athleteId }) },
          ...(hittingData ? [{ id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('HittingPerformance', { athleteId }) }] : []),
          ...(hasPitchingData || armCareData || isMember ? [{ id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('PitchingHub', { athleteId }) }] : []),
          { id: 'mocap', label: 'Motion Capture', icon: 'body', isActive: true, onPress: () => setFabOpen(false) },
          ...(forceProfileData ? [{ id: 'force', label: 'Force Profile', icon: 'trending-up', onPress: () => navigation.navigate('ForceProfile', { athleteId }) }] : []),
          { id: 'resources', label: 'Notes/Resources', icon: 'document-text', badge: newResourcesCount, onPress: () => navigation.navigate('Resources', { athleteId, userId }) },
          { id: 'book', label: 'Book a Class', icon: 'calendar', isBookButton: true, onPress: () => navigation.navigate('Booking') },
        ]}
      />
    </View>
  );
}

// ─── Local components ─────────────────────────────────────────────────────

/** Distinct sports among the visible categories (prefix chip labels when >1). */
function visibleSports(cats: string[]): number {
  return new Set(cats.map((c) => metaFor(c).sport).filter(Boolean)).size;
}

function Chip({ label, count, active, accent, onPress }: { label: string; count: number; active: boolean; accent?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipOn, active && accent ? { borderColor: accent + '66' } : null]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {accent ? <View style={[styles.chipDot, { backgroundColor: accent }]} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
      <Text style={[styles.chipCount, active && { color: accent ?? '#fff' }]}>{count}</Text>
    </Pressable>
  );
}

const RING = 96;
const RING_R = 40;
const RING_C = 2 * Math.PI * RING_R;

/** Full ring (no fill fraction until a composite score is available). */
function Ring({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <View style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke="#1b2430" strokeWidth={7} fill="none" />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={RING_R}
          stroke={color}
          strokeOpacity={0.35}
          strokeWidth={7}
          fill="none"
          strokeDasharray={`${RING_C} ${RING_C}`}
        />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, color: STEEL.sub, fontSize: 14 },

  chips: { gap: 8, paddingVertical: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: STEEL.card, borderWidth: 1, borderColor: STEEL.rule },
  chipOn: { backgroundColor: '#1b2430', borderColor: '#2a3442' },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { color: STEEL.sub, fontSize: 12.5, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  chipCount: { color: STEEL.mute, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },

  latestRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ringValue: { color: '#fff', fontSize: 24, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  ringUnit: { color: STEEL.mute, fontSize: 8.5, fontWeight: '800', letterSpacing: 1 },
  latestTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  latestMeta: { color: STEEL.sub, fontSize: 12.5, fontWeight: '600', marginTop: 4 },
  latestTag: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 6 },

  sessRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: STEEL.rule, gap: 12 },
  sessBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  sessDate: { color: STEEL.day, fontSize: 14.5, fontWeight: '700' },
  sessInline: { color: STEEL.mute, fontSize: 12, fontWeight: '600' },
  sessMeta: { color: STEEL.mute, fontSize: 9.5, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
  sessStat: { alignItems: 'flex-end', minWidth: 52 },
  sessStatValue: { color: STEEL.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sessStatLabel: { color: STEEL.mute, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8, marginTop: 1 },
  clipPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  clipText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6 },

  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateText: { fontSize: 15, color: STEEL.sub, marginTop: 12, fontWeight: '700' },
  emptyStateSubtext: { fontSize: 13, color: STEEL.mute, marginTop: 6, textAlign: 'center' },
  loadMoreButton: { marginTop: 16, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: STEEL.hair, alignItems: 'center' },
  loadMoreText: { fontSize: 13.5, fontWeight: '700', color: ACCENT },
});
