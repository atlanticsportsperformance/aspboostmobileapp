import React, { useState, useRef, useCallback } from 'react';
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

export default function MocapSessionsScreen({ navigation, route }: any) {
  const passedAthleteId = route?.params?.athleteId;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(passedAthleteId || null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<MocapSession[]>([]);
  const [displayedCount, setDisplayedCount] = useState(20);

  // FAB
  const [fabOpen, setFabOpen] = useState(false);
  const { isMember } = useAthleteLifecycle();
  const [hittingData, setHittingData] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [armCareData, setArmCareData] = useState(false);
  const [forceProfileData, setForceProfileData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [newResourcesCount, setNewResourcesCount] = useState(0);

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

      const data = await fetchMocapSessions(currentAthleteId, session.access_token);

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

  const displayedSessions = sessions.slice(0, displayedCount);

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

        {/* Session Count */}
        <View style={styles.statsHeader}>
          <Text style={styles.sectionTitle}>Sessions</Text>
          <Text style={styles.sessionCountText}>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</Text>
        </View>

        {/* Session List */}
        {displayedSessions.length > 0 ? (
          <View style={styles.sessionsList}>
            {displayedSessions.map((session, idx) => {
              const pitch = session.mocap_pitches;
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
                  {/* Left accent bar */}
                  <View style={styles.sessionAccent} />

                  <View style={styles.sessionBody}>
                    {/* Header: date + badges + chevron */}
                    <View style={styles.sessionCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sessionCardDate}>
                          {new Date(session.session_date).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}
                          {pitch?.is_session_highlight ? '  ★' : ''}
                        </Text>
                        <View style={styles.sessionSourceRow}>
                          <Text style={styles.sessionCardVenue}>
                            {session.category === 'baseball_pitching' ? 'PITCHING ANALYSIS' : session.category?.toUpperCase()}
                          </Text>
                          {session.athlete_throws && (
                            <Text style={styles.sessionThrows}>{session.athlete_throws}HP</Text>
                          )}
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.2)" />
                    </View>

                    {/* Stats */}
                    {pitch && (
                      <View style={styles.sessionStatsRow}>
                        <View style={styles.sessionStat}>
                          <Text style={styles.sessionStatValue}>#{pitch.pitch_number}</Text>
                          <Text style={styles.sessionStatLabel}>Pitch</Text>
                        </View>
                        <View style={styles.sessionStat}>
                          <Text style={styles.sessionStatValue}>{pitch.pitch_type || '--'}</Text>
                          <Text style={styles.sessionStatLabel}>Type</Text>
                        </View>
                        <View style={styles.sessionStat}>
                          <Text style={[styles.sessionStatValue, styles.sessionStatAccent]}>
                            {pitch.velocity_mph != null ? `${pitch.velocity_mph}` : '--'}
                          </Text>
                          <Text style={styles.sessionStatLabel}>Velo (mph)</Text>
                        </View>
                        <View style={styles.sessionStat}>
                          {pitch.r2_video_key ? (
                            <Ionicons name="videocam" size={16} color={COLORS.primary} />
                          ) : (
                            <Text style={[styles.sessionStatValue, { color: COLORS.gray600 }]}>—</Text>
                          )}
                          <Text style={styles.sessionStatLabel}>Video</Text>
                        </View>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="body-outline" size={40} color={COLORS.gray500} />
            <Text style={styles.emptyText}>No mocap sessions available</Text>
            <Text style={styles.emptySubtext}>Motion capture data will appear here after your sessions.</Text>
          </View>
        )}

        {/* Load More */}
        {displayedCount < sessions.length && (
          <TouchableOpacity
            style={styles.loadMoreButton}
            onPress={() => setDisplayedCount(c => c + 20)}
          >
            <Text style={styles.loadMoreText}>
              Load More ({sessions.length - displayedCount} remaining)
            </Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <FABMenu
        isOpen={fabOpen}
        onToggle={() => setFabOpen(!fabOpen)}
        totalBadgeCount={unreadMessagesCount + newResourcesCount}
        showWorkload={isMember}
        onWorkloadPress={() => navigation.navigate('Workload' as never)}
        items={[
          { id: 'home', label: 'Home', icon: 'home', onPress: () => navigation.navigate('Dashboard') },
          { id: 'messages', label: 'Messages', icon: 'chatbubble', badge: unreadMessagesCount, onPress: () => navigation.navigate('Messages') },
          { id: 'performance', label: 'Performance', icon: 'stats-chart', onPress: () => navigation.navigate('Performance', { athleteId }) },
          ...(hittingData ? [{ id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('HittingPerformance', { athleteId }) }] : []),
          ...(hasPitchingData ? [{ id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('PitchingPerformance', { athleteId }) }] : []),
          { id: 'mocap', label: 'Motion Capture', icon: 'body', isActive: true, onPress: () => setFabOpen(false) },
          ...(armCareData ? [{ id: 'armcare', label: 'Arm Care', icon: 'arm-flex', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('ArmCare', { athleteId }) }] : []),
          ...(forceProfileData ? [{ id: 'force', label: 'Force Profile', icon: 'trending-up', onPress: () => navigation.navigate('ForceProfile', { athleteId }) }] : []),
          { id: 'resources', label: 'Notes/Resources', icon: 'document-text', badge: newResourcesCount, onPress: () => navigation.navigate('Resources', { athleteId, userId }) },
          { id: 'book', label: 'Book a Class', icon: 'calendar', isBookButton: true, onPress: () => navigation.navigate('Booking') },
        ]}
      />
    </SafeAreaView>
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
    backgroundColor: COLORS.primary,
  },
  sessionBody: {
    flex: 1,
    padding: 14,
  },
  sessionCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sessionCardDate: { fontSize: 15, fontWeight: '700', color: COLORS.white, marginBottom: 3 },
  sessionSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sessionCardVenue: { fontSize: 10, color: COLORS.gray500, letterSpacing: 0.5 },
  sessionThrows: { fontSize: 10, color: COLORS.gray500 },
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
