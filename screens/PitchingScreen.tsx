import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAthlete } from '../contexts/AthleteContext';
import FABMenu from '../components/FABMenu';

// Color theme matching HittingPerformanceScreen
const COLORS = {
  primary: '#9BDDFF',
  primaryDark: '#7BC5F0',
  secondary: '#F5F0E6',  // Cream color for PR values
  gold: '#D4AF37',       // Gold for star icons
  white: '#FFFFFF',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  black: '#000000',
  cyan400: '#22D3EE',
  red400: '#F87171',
  green400: '#4ADE80',
  purple400: '#C084FC',
  yellow400: '#FACC15',
  amber400: '#FBBF24',
};

interface OverviewStats {
  totalPitchesAllTime: number;
  maxVelocityPR: number;
  avgVelocityLast30Days: number;
  maxSpinRatePR: number | null;
  avgSpinRateLast30Days: number | null;
  totalTrackManSessions: number;
  totalCommandSessions: number;
}

interface TrackManSession {
  id: number;
  game_date_utc: string;
  venue_name: string;
  pitch_count: number;
  max_velo: number | null;
  avg_velo: number | null;
  avg_spin: number | null;
  source: 'trackman';
}

interface CommandSession {
  id: string;
  session_date: string;
  total_pitches: number;
  command_percentage: number | null;
  avg_miss_distance_inches: number | null;
  source: 'command';
}

type Session = TrackManSession | CommandSession;

export default function PitchingScreen({ navigation, route }: any) {
  const { isParent } = useAthlete();
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);
  const [overviewStats, setOverviewStats] = useState<OverviewStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [fabOpen, setFabOpen] = useState(false);

  // Dynamic FAB menu data availability flags (matching DashboardScreen)
  const [hittingData, setHittingData] = useState<boolean>(false);
  const [armCareData, setArmCareData] = useState<boolean>(false);
  const [forceProfileData, setForceProfileData] = useState<boolean>(false);
  const [hasResourcesData, setHasResourcesData] = useState<boolean>(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState<number>(0);
  const [newResourcesCount, setNewResourcesCount] = useState<number>(0);
  const [userId, setUserId] = useState<string | null>(null);

  // Pagination
  const [displayedSessions, setDisplayedSessions] = useState(20);
  const [allSessions, setAllSessions] = useState<Session[]>([]);

  useEffect(() => {
    loadAthleteAndData();
  }, []);

  async function loadAthleteAndData() {
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

        if (!athlete) {
          setLoading(false);
          return;
        }
        currentAthleteId = athlete.id;
        setAthleteId(athlete.id);
      }

      // Fetch pitching data
      await fetchOverviewStats(currentAthleteId);
      await fetchSessions(currentAthleteId);

      // Fetch data availability for dynamic FAB menu (matching DashboardScreen)
      await fetchFabDataAvailability(currentAthleteId, user.id);

      setLoading(false);
    } catch (error) {
      console.error('Error loading athlete:', error);
      setLoading(false);
    }
  }

  async function fetchFabDataAvailability(athleteIdParam: string, userIdParam: string) {
    try {
      // Check for hitting data (Blast + HitTrax)
      const [blastSwings, hittraxSessions] = await Promise.all([
        supabase.from('blast_swings').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
        supabase.from('hittrax_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteIdParam),
      ]);
      setHittingData((blastSwings.count || 0) > 0 || (hittraxSessions.count || 0) > 0);

      // Check for arm care data
      const { count: armCareCount } = await supabase
        .from('armcare_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteIdParam);
      setArmCareData((armCareCount || 0) > 0);

      // Check for force profile data
      const { count: forceCount } = await supabase
        .from('force_plate_percentiles')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', athleteIdParam);
      setForceProfileData((forceCount || 0) > 0);

      // Check for resources data
      const { count: resourcesCount } = await supabase
        .from('resources')
        .select('id', { count: 'exact', head: true })
        .eq('athlete_id', userIdParam);
      setHasResourcesData((resourcesCount || 0) > 0);

      // Count NEW resources (created after last viewed)
      const { data: athleteWithLastViewed } = await supabase
        .from('athletes')
        .select('last_viewed_resources_at')
        .eq('id', athleteIdParam)
        .single();

      if (athleteWithLastViewed?.last_viewed_resources_at) {
        const { count: newCount } = await supabase
          .from('resources')
          .select('id', { count: 'exact', head: true })
          .eq('athlete_id', userIdParam)
          .gt('created_at', athleteWithLastViewed.last_viewed_resources_at);
        setNewResourcesCount(newCount || 0);
      } else {
        setNewResourcesCount(resourcesCount || 0);
      }

      // Count unread messages
      const { count: unreadCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', userIdParam)
        .eq('read', false);
      setUnreadMessagesCount(unreadCount || 0);
    } catch (error) {
      console.error('Error fetching FAB data availability:', error);
    }
  }

  async function fetchOverviewStats(id: string) {
    const now = new Date();
    const last30DaysStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { data: trackmanPitches } = await supabase
      .from('trackman_pitch_data')
      .select('rel_speed, spin_rate, created_at')
      .eq('athlete_id', id)
      .order('created_at', { ascending: false });

    const { data: pitchSessions } = await supabase
      .from('trackman_pitch_data')
      .select('session_id')
      .eq('athlete_id', id);

    const trackmanSessionsCount = pitchSessions
      ? new Set(pitchSessions.map(p => p.session_id)).size
      : 0;

    const { data: commandSessions } = await supabase
      .from('command_training_sessions')
      .select('id, session_date, total_pitches')
      .eq('athlete_id', id)
      .order('session_date', { ascending: false });

    const { count: commandSessionsCount } = await supabase
      .from('command_training_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('athlete_id', id);

    let totalPitchesAllTime = 0;
    let maxVelocityPR = 0;
    let avgVelocityLast30Days = 0;
    let maxSpinRatePR: number | null = null;
    let avgSpinRateLast30Days: number | null = null;

    if (trackmanPitches && trackmanPitches.length > 0) {
      totalPitchesAllTime = trackmanPitches.length;
      const velocities30d: number[] = [];
      const spinRates30d: number[] = [];

      trackmanPitches.forEach(pitch => {
        const velo = parseFloat(pitch.rel_speed || '0');
        const spin = pitch.spin_rate ? parseFloat(pitch.spin_rate.toString()) : null;
        const pitchDate = new Date(pitch.created_at);

        if (velo > maxVelocityPR) maxVelocityPR = velo;
        if (spin !== null && (maxSpinRatePR === null || spin > maxSpinRatePR)) maxSpinRatePR = spin;

        if (pitchDate >= last30DaysStart) {
          if (velo > 0) velocities30d.push(velo);
          if (spin !== null) spinRates30d.push(spin);
        }
      });

      avgVelocityLast30Days = velocities30d.length > 0
        ? velocities30d.reduce((a, b) => a + b, 0) / velocities30d.length
        : 0;
      avgSpinRateLast30Days = spinRates30d.length > 0
        ? spinRates30d.reduce((a, b) => a + b, 0) / spinRates30d.length
        : null;
    }

    if (commandSessions) {
      commandSessions.forEach(session => {
        totalPitchesAllTime += session.total_pitches;
      });
    }

    setOverviewStats({
      totalPitchesAllTime,
      maxVelocityPR,
      avgVelocityLast30Days,
      maxSpinRatePR,
      avgSpinRateLast30Days,
      totalTrackManSessions: trackmanSessionsCount || 0,
      totalCommandSessions: commandSessionsCount || 0,
    });
  }

  async function fetchSessions(id: string) {
    const fetchedSessions: Session[] = [];

    const { data: pitchSessionIds } = await supabase
      .from('trackman_pitch_data')
      .select('session_id')
      .eq('athlete_id', id);

    if (pitchSessionIds && pitchSessionIds.length > 0) {
      const uniqueSessionIds = [...new Set(pitchSessionIds.map(p => p.session_id))];

      const { data: trackmanSessions } = await supabase
        .from('trackman_session')
        .select('*')
        .in('id', uniqueSessionIds)
        .order('game_date_utc', { ascending: false });

      if (trackmanSessions) {
        for (const session of trackmanSessions) {
          const { data: pitches, count } = await supabase
            .from('trackman_pitch_data')
            .select('rel_speed, spin_rate', { count: 'exact' })
            .eq('session_id', session.id)
            .eq('athlete_id', id);

          const velocities = pitches?.map(p => parseFloat(p.rel_speed || '0')).filter(v => v > 0) || [];
          const spinRates = pitches?.map(p => p.spin_rate ? parseFloat(p.spin_rate.toString()) : null).filter((s): s is number => s !== null) || [];

          fetchedSessions.push({
            ...session,
            pitch_count: count || 0,
            max_velo: velocities.length > 0 ? Math.max(...velocities) : null,
            avg_velo: velocities.length > 0 ? velocities.reduce((a, b) => a + b, 0) / velocities.length : null,
            avg_spin: spinRates.length > 0 ? spinRates.reduce((a, b) => a + b, 0) / spinRates.length : null,
            source: 'trackman' as const,
          });
        }
      }
    }

    const { data: commandSessions } = await supabase
      .from('command_training_sessions')
      .select('*')
      .eq('athlete_id', id)
      .order('session_date', { ascending: false });

    if (commandSessions) {
      commandSessions.forEach(session => {
        fetchedSessions.push({ ...session, source: 'command' as const });
      });
    }

    fetchedSessions.sort((a, b) => {
      const dateA = 'game_date_utc' in a ? new Date(a.game_date_utc) : new Date(a.session_date);
      const dateB = 'game_date_utc' in b ? new Date(b.game_date_utc) : new Date(b.session_date);
      return dateB.getTime() - dateA.getTime();
    });

    setAllSessions(fetchedSessions);
    setSessions(fetchedSessions.slice(0, 20));
    setDisplayedSessions(20);
  }

  function loadMoreSessions() {
    const newCount = displayedSessions + 20;
    setSessions(allSessions.slice(0, newCount));
    setDisplayedSessions(newCount);
  }

  function formatMetric(value: number | null, decimals: number = 1): string {
    if (value === null || isNaN(value)) return '--';
    return value.toFixed(decimals);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading pitching data...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={20} color={COLORS.gray400} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Pitching Performance</Text>
          <Text style={styles.subtitle}>Velocity metrics and command training</Text>
        </View>

        {overviewStats && (
          <View style={styles.statsSection}>
            <View style={styles.statsHeader}>
              <Text style={styles.sectionTitle}>Personal Records</Text>
              <View style={styles.sessionCounts}>
                <Text style={styles.sessionCountText}>{overviewStats.totalTrackManSessions} TrackMan</Text>
                <Text style={styles.sessionCountDivider}>|</Text>
                <Text style={styles.sessionCountText}>{overviewStats.totalCommandSessions} Command</Text>
              </View>
            </View>

            <View style={styles.prRow}>
              <View style={styles.prItem}>
                <View style={styles.prValueRow}>
                  <Ionicons name="star" size={12} color={COLORS.gold} />
                  <Text style={styles.prValue}>{formatMetric(overviewStats.maxVelocityPR)}</Text>
                </View>
                <Text style={styles.prLabel}>Max Velocity</Text>
                <Text style={styles.prUnit}>mph</Text>
              </View>

              {overviewStats.maxSpinRatePR !== null && (
                <View style={[styles.prItem, styles.prItemBorder]}>
                  <View style={styles.prValueRow}>
                    <Ionicons name="star" size={12} color={COLORS.gold} />
                    <Text style={styles.prValue}>{Math.round(overviewStats.maxSpinRatePR)}</Text>
                  </View>
                  <Text style={styles.prLabel}>Max Spin</Text>
                  <Text style={styles.prUnit}>rpm</Text>
                </View>
              )}

              <View style={overviewStats.maxSpinRatePR !== null ? styles.prItem : [styles.prItem, styles.prItemBorder]}>
                <View style={styles.prValueRow}>
                  <Ionicons name="star" size={12} color={COLORS.gold} />
                  <Text style={styles.prValue}>{overviewStats.totalPitchesAllTime}</Text>
                </View>
                <Text style={styles.prLabel}>Total Pitches</Text>
                <Text style={styles.prUnit}>all-time</Text>
              </View>
            </View>

            <View style={styles.averagesSection}>
              <Text style={styles.averagesTitle}>Last 30 Days</Text>
              <View style={styles.averagesRow}>
                <View style={styles.averageItem}>
                  <Text style={styles.averageValue}>{formatMetric(overviewStats.avgVelocityLast30Days)}</Text>
                  <Text style={styles.averageLabel}>Avg Velocity</Text>
                </View>
                {overviewStats.avgSpinRateLast30Days !== null && (
                  <View style={styles.averageItem}>
                    <Text style={styles.averageValue}>{Math.round(overviewStats.avgSpinRateLast30Days)}</Text>
                    <Text style={styles.averageLabel}>Avg Spin (rpm)</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.analysisButtons}>
              <TouchableOpacity style={styles.analysisButton} onPress={() => navigation.navigate('PitchingTrends', { athleteId })}>
                <View style={styles.analysisButtonInner}>
                  <Ionicons name="analytics" size={16} color="#9BDDFF" />
                  <Text style={styles.analysisButtonText}>Pitch Trends</Text>
                  <Ionicons name="chevron-forward" size={14} color="#4B5563" />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={styles.analysisButton} onPress={() => navigation.navigate('PitchingCommand', { athleteId })}>
                <View style={styles.analysisButtonInner}>
                  <Ionicons name="locate" size={16} color="#9BDDFF" />
                  <Text style={styles.analysisButtonText}>Command Data</Text>
                  <Ionicons name="chevron-forward" size={14} color="#4B5563" />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.sessionsSection}>
          <Text style={styles.sectionTitle}>Recent Sessions</Text>
          {sessions.length > 0 ? (
            <View style={styles.sessionsList}>
              {sessions.map((session, idx) => {
                const isTrackMan = session.source === 'trackman';
                const sessionDate = isTrackMan ? (session as TrackManSession).game_date_utc : (session as CommandSession).session_date;

                return (
                  <TouchableOpacity
                    key={`${session.source}-${session.id}-${idx}`}
                    style={styles.sessionCard}
                    onPress={() => {
                      if (isTrackMan) {
                        navigation.navigate('PitchingSession', { sessionId: session.id, athleteId });
                      } else {
                        navigation.navigate('PitchingCommandSession', { sessionId: session.id, athleteId });
                      }
                    }}
                  >
                    <View style={styles.sessionCardHeader}>
                      <View style={styles.sessionCardHeaderLeft}>
                        <View style={styles.sessionCardDateRow}>
                          <Text style={styles.sessionCardDate}>
                            {new Date(sessionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </Text>
                          <View style={[styles.sessionTypeBadge, isTrackMan ? styles.sessionTypeBadgeTrackman : styles.sessionTypeBadgeCommand]}>
                            <Text style={[styles.sessionTypeBadgeText, isTrackMan ? styles.sessionTypeBadgeTextTrackman : styles.sessionTypeBadgeTextCommand]}>
                              {isTrackMan ? 'TrackMan' : 'Command'}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.sessionCardVenue}>
                          {isTrackMan ? (session as TrackManSession).venue_name || 'Pitching Session' : 'Command Training Session'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={COLORS.gray400} />
                    </View>

                    {isTrackMan ? (
                      <View style={styles.sessionStatsRow}>
                        <View style={styles.sessionStat}>
                          <Text style={styles.sessionStatValue}>{(session as TrackManSession).pitch_count}</Text>
                          <Text style={styles.sessionStatLabel}>Pitches</Text>
                        </View>
                        <View style={styles.sessionStat}>
                          <Text style={[styles.sessionStatValue, styles.sessionStatValueHighlight]}>{formatMetric((session as TrackManSession).max_velo)}</Text>
                          <Text style={styles.sessionStatLabel}>Max Velo</Text>
                        </View>
                        <View style={styles.sessionStat}>
                          <Text style={[styles.sessionStatValue, styles.sessionStatValueHighlight]}>{formatMetric((session as TrackManSession).avg_velo)}</Text>
                          <Text style={styles.sessionStatLabel}>Avg Velo</Text>
                        </View>
                        <View style={styles.sessionStat}>
                          <Text style={styles.sessionStatValue}>{(session as TrackManSession).avg_spin ? Math.round((session as TrackManSession).avg_spin!) : '--'}</Text>
                          <Text style={styles.sessionStatLabel}>Avg Spin</Text>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.sessionStatsRow}>
                        <View style={styles.sessionStat}>
                          <Text style={styles.sessionStatValue}>{(session as CommandSession).total_pitches}</Text>
                          <Text style={styles.sessionStatLabel}>Pitches</Text>
                        </View>
                        <View style={styles.sessionStat}>
                          <Text style={[styles.sessionStatValue, styles.sessionStatValueHighlight]}>
                            {(session as CommandSession).command_percentage !== null ? `${(session as CommandSession).command_percentage}%` : '--'}
                          </Text>
                          <Text style={styles.sessionStatLabel}>Command %</Text>
                        </View>
                        <View style={styles.sessionStat}>
                          <Text style={styles.sessionStatValue}>{formatMetric((session as CommandSession).avg_miss_distance_inches)}″</Text>
                          <Text style={styles.sessionStatLabel}>Avg Miss</Text>
                        </View>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No pitching sessions found</Text>
            </View>
          )}

          {/* Load More Button */}
          {sessions.length > 0 && displayedSessions < allSessions.length && (
            <TouchableOpacity style={styles.loadMoreButton} onPress={loadMoreSessions}>
              <Text style={styles.loadMoreText}>
                Load More ({allSessions.length - displayedSessions} remaining)
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB Menu */}
      <FABMenu
        isOpen={fabOpen}
        onToggle={() => setFabOpen(!fabOpen)}
        totalBadgeCount={unreadMessagesCount + newResourcesCount}
        items={[
          { id: 'home', label: 'Home', icon: 'home', onPress: () => navigation.navigate(isParent ? 'ParentDashboard' : 'Dashboard') },
          { id: 'messages', label: 'Messages', icon: 'chatbubble', badge: unreadMessagesCount, onPress: () => navigation.navigate('Messages') },
          { id: 'leaderboard', label: 'Leaderboard', icon: 'trophy', onPress: () => navigation.navigate('Leaderboard') },
          ...(hittingData ? [{ id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('HittingPerformance', { athleteId }) }] : []),
          { id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, isActive: true, onPress: () => setFabOpen(false) },
          ...(armCareData ? [{ id: 'armcare', label: 'Arm Care', icon: 'arm-flex', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('ArmCare', { athleteId }) }] : []),
          ...(forceProfileData ? [{ id: 'force', label: 'Force Profile', icon: 'lightning-bolt', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('ForceProfile', { athleteId }) }] : []),
          { id: 'resources', label: 'Notes/Resources', icon: 'document-text', badge: newResourcesCount, onPress: () => navigation.navigate('Resources', { athleteId, userId }) },
          { id: 'book', label: 'Book a Class', icon: 'calendar', isBookButton: true, onPress: () => navigation.navigate('Booking') },
        ]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  loadingContainer: { flex: 1, backgroundColor: COLORS.black, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: COLORS.gray400, fontSize: 14, marginTop: 16 },
  scrollView: { flex: 1, paddingHorizontal: 16 },
  header: { paddingTop: 8, marginBottom: 16 },
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { color: COLORS.gray400, fontSize: 14, marginLeft: 8 },
  title: { fontSize: 28, fontWeight: 'bold', color: COLORS.white, marginBottom: 4 },
  subtitle: { fontSize: 14, color: COLORS.gray400 },
  statsSection: { marginBottom: 24 },
  statsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.white },
  sessionCounts: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionCountText: { fontSize: 12, color: COLORS.gray400 },
  sessionCountDivider: { color: COLORS.gray600 },
  prRow: { flexDirection: 'row', marginBottom: 16 },
  prItem: { flex: 1, alignItems: 'center' },
  prItemBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  prValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  prValue: { fontSize: 24, fontWeight: 'bold', color: '#F5F0E6' },
  prLabel: { fontSize: 9, color: COLORS.gray500, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 },
  prUnit: { fontSize: 12, color: COLORS.gray400 },
  averagesSection: { paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', marginBottom: 16 },
  averagesTitle: { fontSize: 10, fontWeight: '600', color: COLORS.gray400, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, textAlign: 'center' },
  averagesRow: { flexDirection: 'row', justifyContent: 'center', gap: 32, marginBottom: 16 },
  averageItem: { alignItems: 'center' },
  averageValue: { fontSize: 16, fontWeight: 'bold', color: COLORS.white },
  averageLabel: { fontSize: 8, color: COLORS.gray500, marginTop: 2 },
  analysisButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  analysisButton: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  analysisButtonInner: { flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(155,221,255,0.06)', borderWidth: 1, borderColor: 'rgba(155,221,255,0.15)', borderRadius: 10 },
  analysisButtonText: { flex: 1, fontSize: 10, fontWeight: '600', color: '#E5E7EB', marginLeft: 6 },
  sessionsSection: { marginBottom: 24 },
  sessionsList: { gap: 8, marginTop: 12 },
  sessionCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  sessionCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sessionCardHeaderLeft: { flex: 1 },
  sessionCardDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  sessionCardDate: { fontSize: 14, fontWeight: '600', color: COLORS.white },
  sessionTypeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  sessionTypeBadgeTrackman: { backgroundColor: 'rgba(6,182,212,0.15)', borderColor: 'rgba(6,182,212,0.3)' },
  sessionTypeBadgeCommand: { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.3)' },
  sessionTypeBadgeText: { fontSize: 9, fontWeight: '600' },
  sessionTypeBadgeTextTrackman: { color: COLORS.cyan400 },
  sessionTypeBadgeTextCommand: { color: COLORS.green400 },
  sessionCardVenue: { fontSize: 9, color: COLORS.gray500, textTransform: 'uppercase', letterSpacing: 0.5 },
  sessionStatsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  sessionStat: { alignItems: 'center' },
  sessionStatValue: { fontSize: 16, fontWeight: 'bold', color: COLORS.white },
  sessionStatValueHighlight: { color: '#9BDDFF' },
  sessionStatLabel: { fontSize: 7, color: COLORS.gray500, textTransform: 'uppercase', marginTop: 2 },
  emptyState: { padding: 32, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 12, marginTop: 12 },
  emptyText: { color: COLORS.gray400, fontSize: 14 },
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
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9BDDFF',
  },
});
