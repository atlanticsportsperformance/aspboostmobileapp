import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Rect, Circle, Line, Path, Text as SvgText, G } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { useAthlete } from '../contexts/AthleteContext';
import ContactPoint3D from '../components/ContactPoint3D';


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
  squared_up_rate: number | null;
  hard_hit_count: number;
  hard_hit_rate: number | null;
}

type SessionType = 'hittrax' | 'blast' | 'paired' | 'fullswing';

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
              spray_chart_x: parseFloat(swing.spray_chart_x || '0'),
              spray_chart_z: parseFloat(swing.spray_chart_z || '0'),
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
          setSessionType('paired');

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
        } else {
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

  // Calculate Blast metrics
  const blastStats = {
    totalSwings: blastSwings.length,
    maxBatSpeed: blastSwings.length > 0
      ? Math.max(...blastSwings.map(s => s.bat_speed || 0))
      : 0,
    avgBatSpeed: blastSwings.length > 0
      ? blastSwings.filter(s => s.bat_speed).reduce((sum, s) => sum + (s.bat_speed || 0), 0) / blastSwings.filter(s => s.bat_speed).length
      : 0,
    avgAttackAngle: blastSwings.length > 0
      ? blastSwings.filter(s => s.attack_angle).reduce((sum, s) => sum + (s.attack_angle || 0), 0) / blastSwings.filter(s => s.attack_angle).length
      : 0,
  };

  // Calculate HitTrax metrics
  const hittraxStats = {
    totalSwings: hittraxSwings.length,
    maxExitVelocity: hittraxSwings.length > 0
      ? Math.max(...hittraxSwings.map(s => s.exit_velocity))
      : 0,
    avgExitVelocity: hittraxSwings.length > 0
      ? hittraxSwings.reduce((sum, s) => sum + s.exit_velocity, 0) / hittraxSwings.length
      : 0,
    maxDistance: hittraxSwings.length > 0
      ? Math.max(...hittraxSwings.filter(s => s.distance).map(s => s.distance || 0))
      : 0,
    avgHorizontalAngle: hittraxSwings.filter(s => s.horizontal_angle !== null).length > 0
      ? hittraxSwings.filter(s => s.horizontal_angle !== null).reduce((sum, s) => sum + (s.horizontal_angle || 0), 0) / hittraxSwings.filter(s => s.horizontal_angle !== null).length
      : null,
  };

  // Calculate Full Swing metrics
  const fullSwingStats = {
    totalSwings: fullSwingSwings.length,
    contactSwings: fullSwingSwings.filter(s => s.exit_velocity && s.exit_velocity > 0).length,
    maxBatSpeed: fullSwingSwings.length > 0
      ? Math.max(...fullSwingSwings.filter(s => s.bat_speed).map(s => s.bat_speed || 0))
      : fullSwingSession?.max_bat_speed || 0,
    avgBatSpeed: fullSwingSwings.filter(s => s.bat_speed).length > 0
      ? fullSwingSwings.filter(s => s.bat_speed).reduce((sum, s) => sum + (s.bat_speed || 0), 0) / fullSwingSwings.filter(s => s.bat_speed).length
      : fullSwingSession?.avg_bat_speed || 0,
    maxExitVelocity: fullSwingSwings.length > 0
      ? Math.max(...fullSwingSwings.filter(s => s.exit_velocity).map(s => s.exit_velocity || 0))
      : fullSwingSession?.max_exit_velocity || 0,
    avgExitVelocity: fullSwingSwings.filter(s => s.exit_velocity).length > 0
      ? fullSwingSwings.filter(s => s.exit_velocity).reduce((sum, s) => sum + (s.exit_velocity || 0), 0) / fullSwingSwings.filter(s => s.exit_velocity).length
      : fullSwingSession?.avg_exit_velocity || 0,
    maxDistance: fullSwingSwings.length > 0
      ? Math.max(...fullSwingSwings.filter(s => s.distance).map(s => s.distance || 0))
      : fullSwingSession?.max_distance || 0,
    avgSmashFactor: fullSwingSwings.filter(s => s.smash_factor).length > 0
      ? fullSwingSwings.filter(s => s.smash_factor).reduce((sum, s) => sum + (s.smash_factor || 0), 0) / fullSwingSwings.filter(s => s.smash_factor).length
      : fullSwingSession?.avg_smash_factor || 0,
    squaredUpRate: fullSwingSession?.squared_up_rate || null,
    hardHitCount: fullSwingSession?.hard_hit_count || 0,
    hardHitRate: fullSwingSession?.hard_hit_rate || null,
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

  function getColorByEV(ev: number): string {
    if (ev >= 100) return '#9BDDFF';
    if (ev >= 90) return '#6BB8DB';
    if (ev >= 80) return '#4A8FAD';
    return '#3d4f5f';
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9BDDFF" />
        <Text style={styles.loadingText}>Loading session data...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9BDDFF" />}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#9CA3AF" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Session Details</Text>
            {sessionType === 'paired' && (
              <View style={styles.pairedBadge}>
                <Ionicons name="link" size={10} color="#4ADE80" />
                <Text style={styles.pairedBadgeText}>Paired</Text>
              </View>
            )}
          </View>
          <Text style={styles.subtitle}>{formatDate(sessionDate)}</Text>
        </View>

        {/* Spray Chart (HitTrax & Paired) */}
        {(sessionType === 'hittrax' || sessionType === 'paired') && hittraxSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Text style={styles.chartTitle}>Spray Chart</Text>
            <View style={styles.sprayChartContainer}>
              <Svg viewBox="20 100 360 280" style={styles.sprayChart}>
                <Rect width="400" height="400" fill="#000000" />

                {/* Foul lines */}
                <Line x1="200" y1="370" x2="60" y2="230" stroke="#9ca3af" strokeWidth="1.5" opacity={0.8} />
                <Line x1="200" y1="370" x2="340" y2="230" stroke="#9ca3af" strokeWidth="1.5" opacity={0.8} />

                {/* Outfield fence */}
                <Path
                  d="M 60 230 Q 100 140 200 136 Q 300 140 340 230"
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  opacity={0.8}
                />

                {/* Infield arc */}
                <Path
                  d="M 162 316 Q 200 292 238 316"
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  opacity={0.8}
                />

                {/* Plot swings */}
                {hittraxSwings.map((swing) => {
                  const scale = 0.6;
                  const x = 200 + (swing.spray_chart_x * scale);
                  const y = 370 - (swing.spray_chart_z * scale);

                  return (
                    <Circle
                      key={swing.id}
                      cx={Math.max(20, Math.min(380, x))}
                      cy={Math.max(100, Math.min(380, y))}
                      r="6"
                      fill={getColorByEV(swing.exit_velocity)}
                      opacity={0.9}
                      onPress={() => setSelectedSwing(swing)}
                    />
                  );
                })}
              </Svg>
            </View>

            {/* Legend */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#3d4f5f' }]} />
                <Text style={styles.legendText}>&lt;80</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#4A8FAD' }]} />
                <Text style={styles.legendText}>80-89</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#6BB8DB' }]} />
                <Text style={styles.legendText}>90-99</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#9BDDFF' }]} />
                <Text style={styles.legendText}>100+</Text>
              </View>
            </View>
          </View>
        )}

        {/* No spray chart message for Blast-only */}
        {sessionType === 'blast' && (
          <View style={styles.chartSection}>
            <View style={styles.noChartContainer}>
              <Text style={styles.noChartText}>Blast Motion session - No spray chart available</Text>
            </View>
          </View>
        )}

        {/* Spray Chart for Full Swing */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Text style={styles.chartTitle}>Spray Chart</Text>
            <View style={styles.sprayChartContainer}>
              <Svg viewBox="20 100 360 280" style={styles.sprayChart}>
                <Rect width="400" height="400" fill="#000000" />

                {/* Foul lines */}
                <Line x1="200" y1="370" x2="60" y2="230" stroke="#9ca3af" strokeWidth="1.5" opacity={0.8} />
                <Line x1="200" y1="370" x2="340" y2="230" stroke="#9ca3af" strokeWidth="1.5" opacity={0.8} />

                {/* Outfield arc */}
                <Path
                  d="M 60 230 Q 100 140 200 136 Q 300 140 340 230"
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  opacity={0.8}
                />

                {/* Infield arc */}
                <Path
                  d="M 162 316 Q 200 292 238 316"
                  fill="none"
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  opacity={0.8}
                />

                {/* Plot Full Swing swings (convert spray_angle + distance to x/z) */}
                {fullSwingSwings.filter(s => s.spray_angle !== null && s.distance !== null && s.exit_velocity !== null).map((swing) => {
                  const scale = 0.6;
                  const radians = (swing.spray_angle! * Math.PI) / 180;
                  const sprayX = swing.distance! * Math.sin(radians);
                  const sprayZ = swing.distance! * Math.cos(radians);
                  const x = 200 + (sprayX * scale);
                  const y = 370 - (sprayZ * scale);

                  return (
                    <Circle
                      key={swing.id}
                      cx={Math.max(20, Math.min(380, x))}
                      cy={Math.max(100, Math.min(380, y))}
                      r="6"
                      fill={getColorByEV(swing.exit_velocity!)}
                      opacity={0.9}
                    />
                  );
                })}
              </Svg>
            </View>

            {/* Legend */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#3d4f5f' }]} />
                <Text style={styles.legendText}>&lt;80</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#4A8FAD' }]} />
                <Text style={styles.legendText}>80-89</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#6BB8DB' }]} />
                <Text style={styles.legendText}>90-99</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#9BDDFF' }]} />
                <Text style={styles.legendText}>100+</Text>
              </View>
            </View>
          </View>
        )}

        {/* Contact Point 3D (HitTrax & Paired) */}
        {(sessionType === 'hittrax' || sessionType === 'paired') && hittraxSwings.length > 0 && (
          <View style={styles.chartSection}>
            <ContactPoint3D hittraxSwings={hittraxSwings} />
          </View>
        )}

        {/* Session Summary Stats */}
        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>SESSION SUMMARY</Text>

          {/* Blast Only */}
          {sessionType === 'blast' && (
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{blastStats.totalSwings}</Text>
                <Text style={styles.statLabel}>Swings</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#22D3EE' }]}>{blastStats.maxBatSpeed.toFixed(1)}</Text>
                <Text style={styles.statLabel}>Max Bat Speed</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#22D3EE' }]}>{blastStats.avgBatSpeed.toFixed(1)}</Text>
                <Text style={styles.statLabel}>Avg Bat Speed</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#A855F7' }]}>{blastStats.avgAttackAngle.toFixed(1)}°</Text>
                <Text style={styles.statLabel}>Avg Attack Angle</Text>
              </View>
            </View>
          )}

          {/* HitTrax Only */}
          {sessionType === 'hittrax' && (
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{hittraxStats.totalSwings}</Text>
                <Text style={styles.statLabel}>Swings</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#9BDDFF' }]}>{hittraxStats.maxExitVelocity.toFixed(1)}</Text>
                <Text style={styles.statLabel}>Max EV</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#6BB8DB' }]}>{hittraxStats.avgExitVelocity.toFixed(1)}</Text>
                <Text style={styles.statLabel}>Avg EV</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#4A8FAD' }]}>{Math.round(hittraxStats.maxDistance)}</Text>
                <Text style={styles.statLabel}>Max Distance</Text>
              </View>
            </View>
          )}

          {/* Paired */}
          {sessionType === 'paired' && (
            <View>
              {/* HitTrax Row */}
              <Text style={styles.sourceLabel}>HITTRAX</Text>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: '#9BDDFF' }]}>{hittraxStats.maxExitVelocity.toFixed(1)}</Text>
                  <Text style={styles.statLabel}>Max EV</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: '#6BB8DB' }]}>{hittraxStats.avgExitVelocity.toFixed(1)}</Text>
                  <Text style={styles.statLabel}>Avg EV</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: '#4A8FAD' }]}>{Math.round(hittraxStats.maxDistance)}</Text>
                  <Text style={styles.statLabel}>Max Dist</Text>
                </View>
                <View style={styles.statItem}>
                  {hittraxStats.avgHorizontalAngle !== null && !isNaN(hittraxStats.avgHorizontalAngle) ? (
                    <View style={styles.sprayDirectionRow}>
                      <Ionicons
                        name="arrow-up"
                        size={14}
                        color="#FFFFFF"
                        style={{ transform: [{ rotate: `${-hittraxStats.avgHorizontalAngle}deg` }] }}
                      />
                      <Text style={styles.statValue}>{Math.abs(hittraxStats.avgHorizontalAngle).toFixed(1)}°</Text>
                    </View>
                  ) : (
                    <Text style={styles.statValue}>--</Text>
                  )}
                  <Text style={styles.statLabel}>Spray Dir</Text>
                </View>
              </View>

              {/* Blast Row */}
              <View style={styles.sourceDivider} />
              <Text style={[styles.sourceLabel, { color: '#22D3EE' }]}>BLAST</Text>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: '#22D3EE' }]}>{blastStats.maxBatSpeed.toFixed(1)}</Text>
                  <Text style={styles.statLabel}>Max Bat Speed</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: '#22D3EE' }]}>{blastStats.avgBatSpeed.toFixed(1)}</Text>
                  <Text style={styles.statLabel}>Avg Bat Speed</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: '#A855F7' }]}>{blastStats.avgAttackAngle.toFixed(1)}°</Text>
                  <Text style={styles.statLabel}>Avg Attack Angle</Text>
                </View>
              </View>

              {/* Total */}
              <View style={styles.sourceDivider} />
              <Text style={styles.totalSwingsText}>
                {hittraxStats.totalSwings} HitTrax | {blastStats.totalSwings} Blast | {pairedSwingData.length} Paired
              </Text>
            </View>
          )}

          {/* Full Swing - Compact Card Grid */}
          {sessionType === 'fullswing' && (
            <View style={styles.summaryGrid}>
              {/* Row 1: Core metrics */}
              <View style={styles.summaryCardRow}>
                <View style={[styles.summaryCard, { borderColor: 'rgba(255,255,255,0.1)' }]}>
                  <Text style={styles.summaryCardValue}>{fullSwingStats.totalSwings}</Text>
                  <Text style={styles.summaryCardLabel}>Swings</Text>
                </View>
                <View style={[styles.summaryCard, { borderColor: 'rgba(34,211,238,0.3)' }]}>
                  <Text style={[styles.summaryCardValue, { color: '#22D3EE' }]}>{fullSwingStats.maxBatSpeed.toFixed(1)}</Text>
                  <Text style={styles.summaryCardLabel}>Max Bat Speed</Text>
                  <Text style={styles.summaryCardSub}>Avg: {fullSwingStats.avgBatSpeed.toFixed(1)}</Text>
                </View>
                <View style={[styles.summaryCard, { borderColor: 'rgba(155,221,255,0.3)' }]}>
                  <Text style={[styles.summaryCardValue, { color: '#9BDDFF' }]}>{fullSwingStats.maxExitVelocity.toFixed(1)}</Text>
                  <Text style={styles.summaryCardLabel}>Max Exit Velo</Text>
                  <Text style={styles.summaryCardSub}>Avg: {fullSwingStats.avgExitVelocity.toFixed(1)}</Text>
                </View>
              </View>

              {/* Row 2: Distance and quality metrics */}
              <View style={styles.summaryCardRow}>
                <View style={[styles.summaryCard, { borderColor: 'rgba(74,143,173,0.3)' }]}>
                  <Text style={[styles.summaryCardValue, { color: '#4A8FAD' }]}>{Math.round(fullSwingStats.maxDistance)} ft</Text>
                  <Text style={styles.summaryCardLabel}>Max Distance</Text>
                </View>
                <View style={[styles.summaryCard, { borderColor: 'rgba(168,85,247,0.3)' }]}>
                  <Text style={[styles.summaryCardValue, { color: '#A855F7' }]}>{fullSwingStats.avgSmashFactor.toFixed(2)}</Text>
                  <Text style={styles.summaryCardLabel}>Smash Factor</Text>
                </View>
                {fullSwingStats.squaredUpRate !== null && (
                  <View style={[styles.summaryCard, { borderColor: 'rgba(16,185,129,0.3)' }]}>
                    <Text style={[styles.summaryCardValue, { color: '#10B981' }]}>
                      {fullSwingStats.squaredUpRate > 1
                        ? fullSwingStats.squaredUpRate.toFixed(0)
                        : (fullSwingStats.squaredUpRate * 100).toFixed(0)}%
                    </Text>
                    <Text style={styles.summaryCardLabel}>Squared Up</Text>
                  </View>
                )}
                {fullSwingStats.hardHitRate !== null && (
                  <View style={[styles.summaryCard, { borderColor: 'rgba(239,68,68,0.3)' }]}>
                    <Text style={[styles.summaryCardValue, { color: '#EF4444' }]}>
                      {fullSwingStats.hardHitRate! > 1
                        ? fullSwingStats.hardHitRate!.toFixed(0)
                        : (fullSwingStats.hardHitRate! * 100).toFixed(0)}%
                    </Text>
                    <Text style={styles.summaryCardLabel}>Hard Hit Rate</Text>
                    <Text style={styles.summaryCardSub}>{fullSwingStats.hardHitCount} hits</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        </View>

        {/* Full Swing: Bat Speed vs Exit Velocity Chart */}
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Text style={styles.chartTitle}>Bat Speed vs Exit Velocity</Text>
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
                      if (smash >= 1.3) color = '#9BDDFF';
                      else if (smash >= 1.2) color = '#6BB8DB';
                      else if (smash >= 1.1) color = '#4A8FAD';
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
                      stroke="#9BDDFF"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      opacity={0.8}
                    />

                    {/* Stats box */}
                    <Rect x="235" y="15" width="110" height="60" fill="#000000" opacity={0.85} rx="4" />
                    <SvgText x="290" y="32" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
                    <SvgText x="240" y="47" fill="#22D3EE" fontSize="9">Bat Speed:</SvgText>
                    <SvgText x="340" y="47" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgBS.toFixed(1)} mph</SvgText>
                    <SvgText x="240" y="62" fill="#9BDDFF" fontSize="9">Exit Velo:</SvgText>
                    <SvgText x="340" y="62" fill="#ffffff" fontSize="9" textAnchor="end" fontWeight="600">{avgEV.toFixed(1)} mph</SvgText>

                    {/* Axis labels */}
                    <SvgText x="190" y="355" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Bat Speed (mph)</SvgText>
                  </Svg>
                </View>
              );
            })()}

            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#9BDDFF' }]} />
                <Text style={styles.legendText}>Smash 1.3+</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#6BB8DB' }]} />
                <Text style={styles.legendText}>1.2-1.29</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#4A8FAD' }]} />
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
            <Text style={styles.chartTitle}>Exit Velocity Distribution</Text>
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
                            fill="#9BDDFF"
                            opacity={0.4}
                            rx={2}
                          />
                        );
                      })}

                      {/* Smooth curve area fill */}
                      <Path d={areaPath} fill="#9BDDFF" opacity={0.2} />

                      {/* Smooth curve line */}
                      <Path d={pathD} stroke="#9BDDFF" strokeWidth="3" fill="none" />

                      {/* Data points */}
                      {points.map((point, idx) => (
                        <Circle key={idx} cx={point.x} cy={point.y} r="4" fill="#9BDDFF" />
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
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Avg: <Text style={{ color: '#9BDDFF', fontWeight: '600' }}>{avgEV.toFixed(1)} mph</Text></Text>
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
            <Text style={styles.chartTitle}>Bat Speed Distribution</Text>
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
            <Text style={styles.chartTitle}>Exit Velocity vs Launch Angle</Text>
            <Text style={styles.chartDescription}>
              Relationship between exit velocity and launch angle. Optimal launch angle for line drives: 10-25°.
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

                      {/* Ideal launch angle zone (10-30°) */}
                      {(() => {
                        const yMin = 330 - ((30 + 20) / 100) * 320;
                        const yMax = 330 - ((10 + 20) / 100) * 320;
                        return <Rect x={30} y={yMin} width={320} height={yMax - yMin} fill="#6b7280" opacity={0.15} />;
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
                        const inIdealRange = swing.launch_angle! >= 10 && swing.launch_angle! <= 30;

                        return (
                          <Circle
                            key={idx}
                            cx={Math.max(30, Math.min(350, x))}
                            cy={Math.max(10, Math.min(330, y))}
                            r="4"
                            fill={inIdealRange ? '#9BDDFF' : '#6b7280'}
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
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={scaleY(avgLaunchAngle)}
                        x2="350"
                        y2={scaleY(avgLaunchAngle)}
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="235" y="15" width="110" height="60" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="290" y="32" fill="#9BDDFF" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
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
                <View style={[styles.legendDot, { backgroundColor: '#9BDDFF' }]} />
                <Text style={styles.legendText}>95+ mph</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#6BB8DB' }]} />
                <Text style={styles.legendText}>85-94</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#4A8FAD' }]} />
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
            <Text style={styles.chartTitle}>Launch Angle vs Distance</Text>
            <Text style={styles.chartDescription}>
              How launch angle affects ball distance. Optimal launch angle for power: 10-30°.
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

                      {/* Ideal launch angle zone (10-30°) */}
                      {(() => {
                        const xMin = scaleX(10);
                        const xMax = scaleX(30);
                        return <Rect x={xMin} y={10} width={xMax - xMin} height={320} fill="#10b981" opacity={0.1} />;
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
                        if (swing.distance! >= 300) color = '#9BDDFF';
                        else if (swing.distance! >= 250) color = '#6BB8DB';
                        else if (swing.distance! >= 200) color = '#4A8FAD';
                        const inIdealRange = swing.launch_angle! >= 10 && swing.launch_angle! <= 30;

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
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={scaleY(avgDist)}
                        x2="350"
                        y2={scaleY(avgDist)}
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="235" y="15" width="110" height="60" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="290" y="32" fill="#9BDDFF" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
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
                <View style={[styles.legendDot, { backgroundColor: '#9BDDFF' }]} />
                <Text style={styles.legendText}>300+ ft</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#6BB8DB' }]} />
                <Text style={styles.legendText}>250-299</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#4A8FAD' }]} />
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
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Text style={styles.chartTitle}>Smash Factor Distribution</Text>
            <Text style={styles.chartDescription}>
              Energy transfer efficiency (Exit Velo ÷ Bat Speed). Elite hitters achieve 1.3+ consistently.
            </Text>

            {(() => {
              const validSwings = fullSwingSwings.filter(s => s.bat_speed && s.exit_velocity);
              if (validSwings.length === 0) return <Text style={styles.noDataText}>No data available</Text>;

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
                { label: 'Elite (1.3+)', count: elite, pct: pctElite, color: '#9BDDFF' },
                { label: 'Excellent (1.2-1.29)', count: excellent, pct: pctExcellent, color: '#6BB8DB' },
                { label: 'Good (1.1-1.19)', count: good, pct: pctGood, color: '#4A8FAD' },
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
                      <SvgText x="345" y="42" fill="#9BDDFF" fontSize="10" textAnchor="end" fontWeight="600">{avgSmash.toFixed(2)}</SvgText>
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
        {sessionType === 'fullswing' && fullSwingSwings.length > 0 && (
          <View style={styles.chartSection}>
            <Text style={styles.chartTitle}>Squared Up Analysis</Text>
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
                const totalSwings = fullSwingStats.totalSwings;
                const squaredCount = Math.round((sessionSquaredRate / 100) * totalSwings);
                const notSquaredCount = totalSwings - squaredCount;

                // Calculate avg EV for squared vs not (from swings with squared_up >= 80)
                const validSwings = fullSwingSwings.filter(s => s.squared_up !== null);
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
                    <View style={styles.scatterChartContainer}>
                      <Svg viewBox="0 0 360 360" style={styles.scatterChart}>
                        <Rect width="360" height="360" fill="#000000" />
                        <Circle cx="180" cy="160" r="100" fill="none" stroke="#3d4f5f" strokeWidth="30" />
                        <Circle
                          cx="180"
                          cy="160"
                          r="100"
                          fill="none"
                          stroke="#10B981"
                          strokeWidth="30"
                          strokeDasharray={`${(sessionSquaredRate / 100) * 628} ${628}`}
                          strokeLinecap="round"
                          transform="rotate(-90 180 160)"
                        />
                        <SvgText x="180" y="150" fill="#10B981" fontSize="36" fontWeight="bold" textAnchor="middle">{sessionSquaredRate.toFixed(0)}%</SvgText>
                        <SvgText x="180" y="175" fill="#9ca3af" fontSize="12" textAnchor="middle">Squared Up</SvgText>
                        <Circle cx="100" cy="300" r="8" fill="#10B981" />
                        <SvgText x="115" y="304" fill="#ffffff" fontSize="11">Squared: {squaredCount}</SvgText>
                        <Circle cx="230" cy="300" r="8" fill="#3d4f5f" />
                        <SvgText x="245" y="304" fill="#ffffff" fontSize="11">Not Squared: {notSquaredCount}</SvgText>
                      </Svg>
                    </View>
                    {avgEVSquared > 0 && avgEVNotSquared > 0 && (
                      <View style={styles.levelGrid}>
                        <View style={[styles.levelCard, { borderColor: 'rgba(16,185,129,0.3)', backgroundColor: 'rgba(16,185,129,0.1)' }]}>
                          <View style={styles.levelCardHeader}>
                            <Text style={[styles.levelCardLabel, { color: '#10B981' }]}>Squared Up</Text>
                            <Text style={[styles.levelCardPct, { color: '#10B981' }]}>{avgEVSquared.toFixed(1)}</Text>
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
                        stroke="#10B981"
                        strokeWidth="30"
                        strokeDasharray={`${(squaredPct / 100) * 628} ${628}`}
                        strokeLinecap="round"
                        transform="rotate(-90 180 160)"
                      />

                      {/* Center text */}
                      <SvgText x="180" y="150" fill="#10B981" fontSize="36" fontWeight="bold" textAnchor="middle">{squaredPct.toFixed(0)}%</SvgText>
                      <SvgText x="180" y="175" fill="#9ca3af" fontSize="12" textAnchor="middle">Squared Up</SvgText>

                      {/* Legend at bottom */}
                      <Circle cx="100" cy="300" r="8" fill="#10B981" />
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
                          <Text style={[styles.levelCardLabel, { color: '#10B981' }]}>Squared Up</Text>
                          <Text style={[styles.levelCardPct, { color: '#10B981' }]}>{avgEVSquared.toFixed(1)}</Text>
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
            <Text style={styles.chartTitle}>Whiff Rate by Pitch Speed</Text>
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
                        let barColor = '#10B981';
                        if (bucket.whiffPct >= 40) barColor = '#EF4444';
                        else if (bucket.whiffPct >= 25) barColor = '#F59E0B';
                        else if (bucket.whiffPct >= 15) barColor = '#6BB8DB';

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
                      <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                      <Text style={styles.legendText}>&lt;15%</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#6BB8DB' }]} />
                      <Text style={styles.legendText}>15-24%</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                      <Text style={styles.legendText}>25-39%</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
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
            <Text style={styles.chartTitle}>Ideal Range</Text>
            <Text style={styles.chartDescription}>
              Optimal swing path alignment. Green zone shows ideal launch angle (7-22°) and attack angle (5-20°) for maximum power and consistency.
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
                s.launchAngle >= 7 && s.launchAngle <= 22
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
                        const x1 = 30 + ((7 + 10) / 60) * 320;
                        const x2 = 30 + ((22 + 10) / 60) * 320;
                        const y1 = 330 - ((20 + 10) / 40) * 320;
                        const y2 = 330 - ((5 + 10) / 40) * 320;
                        return (
                          <Rect
                            x={x1}
                            y={y1}
                            width={x2 - x1}
                            height={y2 - y1}
                            fill="#6b7280"
                            opacity={0.2}
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
                                      swing.launchAngle >= 7 && swing.launchAngle <= 22;

                        return (
                          <Circle
                            key={idx}
                            cx={Math.max(30, Math.min(350, x))}
                            cy={Math.max(10, Math.min(330, y))}
                            r="5"
                            fill={inZone ? '#9BDDFF' : '#6b7280'}
                            opacity={0.8}
                          />
                        );
                      })}

                      {/* Axis labels */}
                      <SvgText x="190" y="355" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600">Launch Angle (°)</SvgText>
                      <SvgText x="8" y="180" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="600" transform="rotate(-90, 8, 180)">Attack Angle (°)</SvgText>

                      {/* Stats box */}
                      <Rect x="240" y="15" width="105" height="45" fill="#000000" opacity={0.8} rx="4" />
                      <SvgText x="292" y="35" fill="#9BDDFF" fontSize="18" textAnchor="middle" fontWeight="700">
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
                      <View style={[styles.legendDot, { backgroundColor: '#9BDDFF' }]} />
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
            <Text style={styles.chartTitle}>Squared Up Rate</Text>
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
                        if (data.squaredUpRate >= 80) color = '#9BDDFF';
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
                      <SvgText x="295" y="28" fill="#9BDDFF" fontSize="20" textAnchor="middle" fontWeight="700">
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
                      <View style={[styles.legendDot, { backgroundColor: '#9BDDFF', borderRadius: 2 }]} />
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
            <Text style={styles.chartTitle}>Attack Angle vs Bat Speed</Text>
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
                        return <Rect x={30} y={yMin} width={320} height={yMax - yMin} fill="#6b7280" opacity={0.15} />;
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
                            fill={inIdealRange ? '#9BDDFF' : '#6b7280'}
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
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={330 - ((avgAttackAngle + 20) / 60) * 320}
                        x2="350"
                        y2={330 - ((avgAttackAngle + 20) / 60) * 320}
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="240" y="15" width="105" height="60" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="292" y="32" fill="#9BDDFF" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
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
                      <View style={[styles.legendDot, { backgroundColor: '#9BDDFF' }]} />
                      <Text style={styles.legendText}>Ideal Range (5-20°)</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#6b7280' }]} />
                      <Text style={styles.legendText}>Other</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDash, { backgroundColor: '#9BDDFF' }]} />
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
            <Text style={styles.chartTitle}>Exit Velocity vs Launch Angle</Text>
            <Text style={styles.chartDescription}>
              Relationship between exit velocity and launch angle. Ideal launch angle for power: 10-30°.
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

                      {/* Ideal launch angle zone (10-30°) */}
                      {(() => {
                        const yMin = 330 - ((30 + 20) / 100) * 320;
                        const yMax = 330 - ((10 + 20) / 100) * 320;
                        return <Rect x={30} y={yMin} width={320} height={yMax - yMin} fill="#6b7280" opacity={0.15} />;
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
                        const inIdealRange = swing.launch_angle! >= 10 && swing.launch_angle! <= 30;

                        return (
                          <Circle
                            key={idx}
                            cx={Math.max(30, Math.min(350, x))}
                            cy={Math.max(10, Math.min(330, y))}
                            r="4"
                            fill={inIdealRange ? '#9BDDFF' : '#6b7280'}
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
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={330 - ((avgLaunchAngle + 20) / 100) * 320}
                        x2="350"
                        y2={330 - ((avgLaunchAngle + 20) / 100) * 320}
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="235" y="15" width="110" height="60" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="290" y="32" fill="#9BDDFF" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
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
                      <View style={[styles.legendDot, { backgroundColor: '#9BDDFF' }]} />
                      <Text style={styles.legendText}>Ideal Range (10-30°)</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#6b7280' }]} />
                      <Text style={styles.legendText}>Other</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDash, { backgroundColor: '#9BDDFF' }]} />
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
            <Text style={styles.chartTitle}>Exit Velocity Distribution</Text>
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
                            fill="#9BDDFF"
                            opacity={0.4}
                            rx={2}
                          />
                        );
                      })}

                      {/* Smooth curve area fill */}
                      <Path d={areaPath} fill="#9BDDFF" opacity={0.2} />

                      {/* Smooth curve line */}
                      <Path d={pathD} stroke="#9BDDFF" strokeWidth="3" fill="none" />

                      {/* Data points */}
                      {points.map((point, idx) => (
                        <Circle key={idx} cx={point.x} cy={point.y} r="4" fill="#9BDDFF" />
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
                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>Avg: <Text style={{ color: '#9BDDFF', fontWeight: '600' }}>{avgEV.toFixed(1)} mph</Text></Text>
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
            <Text style={styles.chartTitle}>Bat Speed Distribution</Text>
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
            <Text style={styles.chartTitle}>Launch Angle vs Distance</Text>
            <Text style={styles.chartDescription}>
              How launch angle affects ball distance. Ideal launch angle for power: 10-30°.
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

                      {/* Ideal launch angle zone (10-30°) */}
                      {(() => {
                        const xMin = 30 + ((10 + 20) / 100) * 320;
                        const xMax = 30 + ((30 + 20) / 100) * 320;
                        return <Rect x={xMin} y={10} width={xMax - xMin} height={320} fill="#6b7280" opacity={0.15} />;
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
                        if (point.distance >= 350) color = '#9BDDFF';
                        else if (point.distance >= 300) color = '#6BB8DB';
                        else if (point.distance >= 250) color = '#4A8FAD';

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
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />
                      <Line
                        x1="30"
                        y1={330 - (avgDistance / 400) * 320}
                        x2="350"
                        y2={330 - (avgDistance / 400) * 320}
                        stroke="#9BDDFF"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        opacity={0.8}
                      />

                      {/* Stats box */}
                      <Rect x="230" y="15" width="115" height="75" fill="#000000" opacity={0.85} rx="4" />
                      <SvgText x="287" y="32" fill="#9BDDFF" fontSize="10" textAnchor="middle" fontWeight="600">Averages</SvgText>
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
                      <View style={[styles.legendDot, { backgroundColor: '#9BDDFF' }]} />
                      <Text style={styles.legendText}>350+ ft</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#6BB8DB' }]} />
                      <Text style={styles.legendText}>300-349 ft</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#4A8FAD' }]} />
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
            <Text style={styles.chartTitle}>Individual Swings</Text>
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
                  <View style={{ flex: 1 }}><Text style={[styles.swingsTableCell, { color: '#9BDDFF' }]}>
                    {swing.exit_velocity ? swing.exit_velocity.toFixed(1) : '-'}
                  </Text></View>
                  <View style={{ flex: 0.8 }}><Text style={[styles.swingsTableCell, { color: '#A855F7' }]}>
                    {swing.smash_factor ? swing.smash_factor.toFixed(2) : '-'}
                  </Text></View>
                  <View style={{ flex: 1 }}><Text style={[styles.swingsTableCell, { color: '#4A8FAD' }]}>
                    {swing.distance ? Math.round(swing.distance) : '-'}
                  </Text></View>
                  <View style={{ flex: 0.7 }}><Text style={[styles.swingsTableCell, { color: swing.squared_up === 1 ? '#10B981' : '#6b7280' }]}>
                    {swing.squared_up === 1 ? 'Yes' : swing.squared_up === 0 ? 'No' : '-'}
                  </Text></View>
                </View>
              ))}
            </View>
          </View>
        )}
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
                <Text style={styles.modalValue}>{selectedSwing.exit_velocity.toFixed(1)} mph</Text>
              </View>

              {selectedSwing.distance && (
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
                <Text style={styles.modalValue}>{selectedSwing.pitch_velocity.toFixed(1)} mph</Text>
              </View>

              {selectedSwing.result && (
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

      {/* FAB Button */}
      <View style={styles.fabContainer}>
        {(unreadMessagesCount + newResourcesCount) > 0 && !fabOpen && (
          <View style={styles.fabNotificationBadge}>
            <Text style={styles.fabNotificationBadgeText}>
              {(unreadMessagesCount + newResourcesCount) > 99 ? '99+' : unreadMessagesCount + newResourcesCount}
            </Text>
          </View>
        )}
        <TouchableOpacity onPress={() => setFabOpen(!fabOpen)} style={styles.fab}>
          <LinearGradient colors={['#9BDDFF', '#B0E5FF', '#7BC5F0']} style={styles.fabGradient}>
            <Text style={styles.fabIcon}>{fabOpen ? '✕' : '☰'}</Text>
          </LinearGradient>
        </TouchableOpacity>

        <Modal
          visible={fabOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setFabOpen(false)}
        >
          <TouchableOpacity style={styles.fabOverlay} activeOpacity={1} onPress={() => setFabOpen(false)}>
            <View style={styles.fabMenu}>
              <TouchableOpacity style={styles.fabMenuItem} onPress={() => { setFabOpen(false); navigation.navigate(isParent ? 'ParentDashboard' : 'Dashboard'); }}>
                <Ionicons name="home" size={20} color="#FFFFFF" />
                <Text style={styles.fabMenuLabel}>Home</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.fabMenuItem} onPress={() => { setFabOpen(false); navigation.navigate('Messages'); }}>
                <View style={styles.fabMenuIconContainer}>
                  <Ionicons name="chatbubble" size={20} color="#FFFFFF" />
                  {unreadMessagesCount > 0 && (
                    <View style={styles.fabMenuItemBadge}>
                      <Text style={styles.fabMenuItemBadgeText}>{unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.fabMenuLabel}>Messages</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.fabMenuItem} onPress={() => { setFabOpen(false); navigation.navigate('Leaderboard'); }}>
                <Ionicons name="trophy" size={20} color="#FFFFFF" />
                <Text style={styles.fabMenuLabel}>Leaderboard</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.fabMenuItem, styles.fabMenuItemActive]} onPress={() => { setFabOpen(false); navigation.navigate('HittingPerformance'); }}>
                <MaterialCommunityIcons name="baseball-bat" size={20} color="#9BDDFF" />
                <Text style={[styles.fabMenuLabel, styles.fabMenuLabelActive]}>Hitting</Text>
              </TouchableOpacity>

              {hasPitchingData && (
                <TouchableOpacity style={styles.fabMenuItem} onPress={() => { setFabOpen(false); navigation.navigate('PitchingPerformance', { athleteId }); }}>
                  <MaterialCommunityIcons name="baseball" size={20} color="#3B82F6" />
                  <Text style={styles.fabMenuLabel}>Pitching</Text>
                </TouchableOpacity>
              )}

              {hasArmCareData && (
                <TouchableOpacity style={styles.fabMenuItem} onPress={() => { setFabOpen(false); navigation.navigate('ArmCare', { athleteId }); }}>
                  <MaterialCommunityIcons name="arm-flex" size={20} color="#10B981" />
                  <Text style={styles.fabMenuLabel}>Arm Care</Text>
                </TouchableOpacity>
              )}

              {hasForceData && (
                <TouchableOpacity style={styles.fabMenuItem} onPress={() => { setFabOpen(false); navigation.navigate('ForceProfile', { athleteId }); }}>
                  <Ionicons name="trending-up" size={20} color="#A855F7" />
                  <Text style={styles.fabMenuLabel}>Force Profile</Text>
                </TouchableOpacity>
              )}

              {/* Notes/Resources - always visible, with badge for new items */}
              <TouchableOpacity style={styles.fabMenuItem} onPress={() => { setFabOpen(false); navigation.navigate('Resources', { athleteId }); }}>
                <View style={styles.fabMenuIconContainer}>
                  <Ionicons name="document-text" size={20} color="#F59E0B" />
                  {newResourcesCount > 0 && (
                    <View style={styles.fabMenuItemBadge}>
                      <Text style={styles.fabMenuItemBadgeText}>{newResourcesCount > 9 ? '9+' : newResourcesCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.fabMenuLabel}>Notes/Resources</Text>
              </TouchableOpacity>

              {/* Book a Class - always visible */}
              <TouchableOpacity style={styles.fabMenuItemBook} onPress={() => { setFabOpen(false); navigation.navigate('Booking'); }}>
                <Ionicons name="calendar" size={20} color="#000000" />
                <Text style={styles.fabMenuLabelBook}>Book a Class</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
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
    marginBottom: 16,
  },
  backText: {
    color: '#9CA3AF',
    fontSize: 14,
    marginLeft: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  pairedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(34,197,94,0.2)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
    gap: 4,
  },
  pairedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4ADE80',
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  chartSection: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  chartDescription: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 12,
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
    fontSize: 10,
    fontWeight: '600',
    color: '#9CA3AF',
    letterSpacing: 1,
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 8,
    color: '#6B7280',
    marginTop: 2,
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
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  summaryCardValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  summaryCardLabel: {
    fontSize: 9,
    color: '#9CA3AF',
    marginTop: 2,
    textAlign: 'center',
  },
  summaryCardSub: {
    fontSize: 8,
    color: '#6B7280',
    marginTop: 1,
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#000000',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  modalHandle: {
    width: 48,
    height: 4,
    backgroundColor: '#4B5563',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  modalLabel: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  modalValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  modalCloseButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 24,
    alignItems: 'center',
  },
  modalCloseButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // FAB Styles
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: '#9BDDFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabIcon: {
    fontSize: 24,
    color: '#000000',
    fontWeight: 'bold',
  },
  fabOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 24,
    paddingBottom: 100,
  },
  fabMenu: {
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 220,
    padding: 8,
  },
  fabMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  fabMenuLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  fabNotificationBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    minWidth: 24,
    height: 24,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 20,
  },
  fabNotificationBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 4,
  },
  fabMenuItemActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
  },
  fabMenuLabelActive: {
    color: '#9BDDFF',
  },
  fabMenuIconContainer: {
    position: 'relative',
  },
  fabMenuItemBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    backgroundColor: '#EF4444',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  fabMenuItemBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 3,
  },
  fabMenuItemBook: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#9BDDFF',
    marginTop: 8,
  },
  fabMenuLabelBook: {
    fontSize: 16,
    color: '#000000',
    fontWeight: '600',
  },
  swingsTable: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginTop: 12,
  },
  swingsTableHeader: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  swingsTableHeaderCell: {
    fontSize: 9,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  swingsTableRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  swingsTableRowAlt: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  swingsTableCell: {
    fontSize: 12,
    color: '#ffffff',
    textAlign: 'center',
  },
});
