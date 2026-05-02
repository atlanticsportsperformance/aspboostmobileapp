import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { getOrgIdForAthlete } from '../lib/orgSecurity';
import { fetchMocapSessions, type MocapSession } from '../lib/mocap/api';
import FABMenu from '../components/FABMenu';
import { useAthleteLifecycle } from '../lib/useAthleteLifecycle';

const COLORS = {
  primary: '#9BDDFF',
  white: '#FFFFFF',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  cyan400: '#22D3EE',
};

// ─── Category metadata ────────────────────────────────────────────────────
// Each mocap session carries a `category` string from the upstream API
// (e.g. 'baseball_pitching'). We map known categories to display labels,
// short titles, and a sport-specific accent so the list reads cleanly when
// an athlete has a mix of pitching + hitting sessions across two sports.
// Anything not in the map falls back to a generic gray pill so we don't
// hide unfamiliar categories from the user.
type CategoryMeta = {
  label: string;       // pill copy: "Baseball Pitching"
  short: string;       // session-card secondary line: "Pitching"
  sport: string;       // session-card primary tag: "Baseball"
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  accent: string;
  /** Layout to use for the per-pitch stats row in each session card. */
  layout: 'pitching' | 'hitting';
};

const CATEGORY_META: Record<string, CategoryMeta> = {
  baseball_pitching: {
    label: 'Pitching',
    short: 'Pitching',
    sport: 'Baseball',
    icon: 'baseball',
    accent: '#9BDDFF',
    layout: 'pitching',
  },
  baseball_hitting: {
    label: 'Hitting',
    short: 'Hitting',
    sport: 'Baseball',
    icon: 'baseball-bat',
    accent: '#FBBF24',
    layout: 'hitting',
  },
  softball_pitching: {
    label: 'Pitching',
    short: 'Pitching',
    sport: 'Softball',
    icon: 'baseball',
    accent: '#FFD58A',
    layout: 'pitching',
  },
  softball_hitting: {
    label: 'Hitting',
    short: 'Hitting',
    sport: 'Softball',
    icon: 'baseball-bat',
    accent: '#A7F3D0',
    layout: 'hitting',
  },
};

function metaFor(category: string | null | undefined): CategoryMeta {
  if (!category) return FALLBACK_META;
  return CATEGORY_META[category] ?? {
    ...FALLBACK_META,
    label: category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    short: category.replace(/_/g, ' '),
  };
}

// `athletes.bats` is constrained to 'Right' | 'Left' | 'Both' in the DB.
// We render it as the standard short tag a baseball reader recognizes:
// RHH, LHH, or SH (switch hitter).
function batsTag(bats: string | null | undefined): string | null {
  if (!bats) return null;
  if (bats === 'Right') return 'RHH';
  if (bats === 'Left') return 'LHH';
  if (bats === 'Both') return 'SH';
  return null;
}

const FALLBACK_META: CategoryMeta = {
  label: 'Other',
  short: 'Session',
  sport: '',
  icon: 'human',
  accent: COLORS.gray400,
  layout: 'pitching',
};

export default function MocapSessionsScreen({ navigation, route }: any) {
  const passedAthleteId = route?.params?.athleteId;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(passedAthleteId || null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<MocapSession[]>([]);
  const [displayedCount, setDisplayedCount] = useState(20);
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
        data.sort((a, b) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime());
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
        const convIds = participants.map(p => p.conversation_id);
        let unread = 0;
        for (const p of participants) {
          const { count } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', p.conversation_id).gt('created_at', p.last_read_at || '1970-01-01');
          unread += (count || 0);
        }
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

  // Build the filter-pill list from the categories the athlete actually
  // has, sorted by frequency (most-used category first after "All"). Keeps
  // the pill row short and relevant — an athlete with only baseball
  // pitching sessions sees "All" + "Baseball Pitching", nothing else.
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      const key = s.category || 'other';
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [sessions]);

  const visibleCategories = useMemo(() => {
    return Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);
  }, [categoryCounts]);

  const filteredSessions = useMemo(() => {
    if (activeCategory === 'all') return sessions;
    return sessions.filter((s) => (s.category || 'other') === activeCategory);
  }, [sessions, activeCategory]);

  const displayedSessions = filteredSessions.slice(0, displayedCount);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading mocap sessions...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
        }
      >
        {/* Header */}
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={20} color={COLORS.gray400} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Motion Capture</Text>
        <Text style={styles.subtitle}>Biomechanics analysis sessions</Text>

        {/* Category filter pills — only show if the athlete has more than
            one category of session. Single-category libraries don't need
            an "All" + "Baseball Pitching" toggle taking up space. */}
        {visibleCategories.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            <FilterPill
              label="All"
              count={sessions.length}
              active={activeCategory === 'all'}
              accent={COLORS.primary}
              onPress={() => {
                setActiveCategory('all');
                setDisplayedCount(20);
              }}
            />
            {visibleCategories.map((cat) => {
              const meta = metaFor(cat);
              return (
                <FilterPill
                  key={cat}
                  label={meta.label}
                  count={categoryCounts.get(cat) ?? 0}
                  active={activeCategory === cat}
                  accent={meta.accent}
                  icon={meta.icon}
                  onPress={() => {
                    setActiveCategory(cat);
                    setDisplayedCount(20);
                  }}
                />
              );
            })}
          </ScrollView>
        )}

        {/* Session Count */}
        <View style={styles.statsHeader}>
          <Text style={styles.sectionTitle}>
            {activeCategory === 'all' ? 'Sessions' : metaFor(activeCategory).label}
          </Text>
          <Text style={styles.sessionCountText}>
            {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Session List */}
        {displayedSessions.length > 0 ? (
          <View style={styles.sessionsList}>
            {displayedSessions.map((session, idx) => {
              const pitch = session.mocap_pitches;
              const meta = metaFor(session.category);
              return (
                <TouchableOpacity
                  key={`${session.id}-${pitch?.id || idx}`}
                  style={styles.sessionCard}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (pitch) {
                      navigation.navigate('MocapPitchDetail', {
                        athleteId,
                        pitchId: pitch.id,
                        sessionId: session.id,
                      });
                    }
                  }}
                >
                  {/* Left accent bar — color reflects the session's category
                      so a mixed list reads as visually grouped. */}
                  <View style={[styles.sessionAccent, { backgroundColor: meta.accent }]} />

                  <View style={styles.sessionBody}>
                    {/* Header: date + sport/activity tag + chevron */}
                    <View style={styles.sessionCardHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.sessionDateRow}>
                          <Text style={styles.sessionCardDate}>
                            {new Date(session.session_date).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                            })}
                          </Text>
                          {pitch?.is_session_highlight && (
                            <Ionicons name="star" size={13} color="#FBBF24" style={{ marginLeft: 6 }} />
                          )}
                        </View>
                        <View style={styles.sessionSourceRow}>
                          {/* Tiny sport icon + activity short label */}
                          <MaterialCommunityIcons name={meta.icon} size={11} color={meta.accent} />
                          <Text style={[styles.sessionCategoryTag, { color: meta.accent }]}>
                            {meta.short}
                          </Text>
                          {session.athlete_throws && meta.layout === 'pitching' && (
                            <Text style={styles.sessionThrows}>· {session.athlete_throws}HP</Text>
                          )}
                          {meta.layout === 'hitting' && batsTag(athleteBats) && (
                            <Text style={styles.sessionThrows}>· {batsTag(athleteBats)}</Text>
                          )}
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.2)" />
                    </View>

                    {/* Per-category stats row */}
                    {pitch && (
                      meta.layout === 'hitting' ? (
                        <View style={styles.sessionStatsRow}>
                          <Stat
                            value={`#${pitch.pitch_number}`}
                            label="Swing"
                          />
                          <Stat
                            value={pitch.pitch_type || '--'}
                            label="Type"
                          />
                          <Stat
                            value={pitch.exit_velo_mph != null ? `${pitch.exit_velo_mph}` : '--'}
                            label="Exit (mph)"
                            accent={meta.accent}
                          />
                          <Stat
                            value={pitch.bat_speed_mph != null ? `${pitch.bat_speed_mph}` : '--'}
                            label="Bat (mph)"
                          />
                          <Stat
                            value={pitch.r2_video_key ? '●' : '—'}
                            valueColor={pitch.r2_video_key ? meta.accent : COLORS.gray600}
                            label="Video"
                            iconName={pitch.r2_video_key ? 'videocam' : undefined}
                            iconColor={meta.accent}
                          />
                        </View>
                      ) : (
                        <View style={styles.sessionStatsRow}>
                          <Stat value={`#${pitch.pitch_number}`} label="Pitch" />
                          <Stat value={pitch.pitch_type || '--'} label="Type" />
                          <Stat
                            value={pitch.velocity_mph != null ? `${pitch.velocity_mph}` : '--'}
                            label="Velo (mph)"
                            accent={meta.accent}
                          />
                          <Stat
                            value={pitch.r2_video_key ? '●' : '—'}
                            valueColor={pitch.r2_video_key ? meta.accent : COLORS.gray600}
                            label="Video"
                            iconName={pitch.r2_video_key ? 'videocam' : undefined}
                            iconColor={meta.accent}
                          />
                        </View>
                      )
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="body-outline" size={40} color={COLORS.gray500} />
            <Text style={styles.emptyText}>
              {activeCategory === 'all'
                ? 'No mocap sessions available'
                : `No ${metaFor(activeCategory).label.toLowerCase()} sessions yet`}
            </Text>
            <Text style={styles.emptySubtext}>
              Motion capture data will appear here after your sessions.
            </Text>
          </View>
        )}

        {/* Load More */}
        {displayedCount < filteredSessions.length && (
          <TouchableOpacity
            style={styles.loadMoreButton}
            onPress={() => setDisplayedCount(c => c + 20)}
          >
            <Text style={styles.loadMoreText}>
              Load More ({filteredSessions.length - displayedCount} remaining)
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 100 }} />
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
    </SafeAreaView>
  );
}

// ─── Local components ─────────────────────────────────────────────────────

function FilterPill({
  label,
  count,
  active,
  accent,
  icon,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  accent: string;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        pillStyles.pill,
        active && {
          backgroundColor: accent + '1A',
          borderColor: accent + '66',
        },
      ]}
    >
      {icon && (
        <MaterialCommunityIcons
          name={icon}
          size={12}
          color={active ? accent : COLORS.gray500}
          style={{ marginRight: 5 }}
        />
      )}
      <Text style={[pillStyles.label, active && { color: accent }]}>{label}</Text>
      <Text style={[pillStyles.count, active && { color: accent }]}>{count}</Text>
    </TouchableOpacity>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.gray400,
    letterSpacing: 0.2,
  },
  count: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.gray500,
    marginLeft: 6,
  },
});

function Stat({
  value,
  label,
  accent,
  valueColor,
  iconName,
  iconColor,
}: {
  value: string;
  label: string;
  accent?: string;
  valueColor?: string;
  iconName?: React.ComponentProps<typeof Ionicons>['name'];
  iconColor?: string;
}) {
  return (
    <View style={styles.sessionStat}>
      {iconName ? (
        <Ionicons name={iconName} size={16} color={iconColor ?? COLORS.primary} />
      ) : (
        <Text
          style={[
            styles.sessionStatValue,
            accent ? { color: accent } : null,
            valueColor ? { color: valueColor } : null,
          ]}
        >
          {value}
        </Text>
      )}
      <Text style={styles.sessionStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollView: { flex: 1 },
  content: { padding: 16 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: COLORS.gray400, fontSize: 14 },

  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { color: COLORS.gray400, fontSize: 14, marginLeft: 8 },
  title: { fontSize: 28, fontWeight: 'bold', color: COLORS.white, marginBottom: 4 },
  subtitle: { fontSize: 14, color: COLORS.gray400, marginBottom: 24 },

  statsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.white },
  sessionCountText: { fontSize: 12, color: COLORS.gray400 },

  sessionsList: { gap: 0 },
  sessionCard: {
    flexDirection: 'row',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  sessionAccent: {
    width: 3,
    // Background color is set inline based on the session's category meta.
  },
  sessionBody: {
    flex: 1,
    padding: 14,
  },
  sessionCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sessionDateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  sessionCardDate: { fontSize: 15, fontWeight: '700', color: COLORS.white },
  sessionSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  sessionCategoryTag: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  sessionThrows: { fontSize: 10, color: COLORS.gray500 },

  filterRow: {
    flexDirection: 'row',
    paddingBottom: 16,
  },
  sessionStatsRow: { flexDirection: 'row' },
  sessionStat: { flex: 1, alignItems: 'center' },
  sessionStatValue: { fontSize: 17, fontWeight: '800', color: COLORS.white },
  sessionStatAccent: { color: COLORS.primary },
  sessionStatLabel: { fontSize: 8, color: COLORS.gray500, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  emptyState: { padding: 32, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 12, marginTop: 12, gap: 8 },
  emptyText: { color: COLORS.gray400, fontSize: 14 },
  emptySubtext: { color: COLORS.gray500, fontSize: 12, textAlign: 'center' },

  loadMoreButton: {
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.2)',
    alignItems: 'center',
  },
  loadMoreText: { fontSize: 14, fontWeight: '600', color: '#9BDDFF' },
});
