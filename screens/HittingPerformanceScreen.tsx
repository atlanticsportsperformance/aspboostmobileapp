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
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { getOrgIdForAthlete } from '../lib/orgSecurity';
import { useAthlete } from '../contexts/AthleteContext';
import FABMenu from '../components/FABMenu';

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

    // Apply filters
    for (const filter of filters) {
      if (filter.operator === 'in') {
        q = q.in(filter.column, filter.value);
      } else {
        q = q.eq(filter.column, filter.value);
      }
    }

    // Apply additional filters if provided
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

interface OverviewStats {
  totalSwingsAllTime: number;
  totalSwingsLast30Days: number;
  hittraxTotalSwingsAllTime: number;
  highestBatSpeedPR: number;
  avgBatSpeedLast30Days: number;
  hittraxMaxExitVelocity: number | null;
  hittraxAvgExitVelocityLast30Days: number | null;
  hittraxMaxDistance: number | null;
  hittraxAvgDistanceLast30Days: number | null;
  avgAttackAngleLast30Days: number | null;  // Blast-only - null when no Blast data
  hittraxAvgLaunchAngleLast30Days: number | null;
  hittraxAvgHorizontalAngleLast30Days: number | null;
  avgOnPlaneEfficiencyLast30Days: number | null;  // Blast-only - null when no Blast data
}

interface Session {
  id: string;
  session_date: string;
  total_swings: number;
  contact_swings: number;
  avg_exit_velocity: number;
  max_exit_velocity: number;
  max_distance: number;
  hard_hit_count: number;
  source: 'hittrax' | 'blast' | 'fullswing';
  isPaired?: boolean;
  blast_swings_count?: number;
  hittrax_swings_count?: number;
  paired_swings_count?: number;
  avg_bat_speed?: number;
  avg_attack_angle?: number;
  avg_on_plane_efficiency?: number;
}

interface FullSwingSession {
  id: string;
  athlete_id: string;
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

export default function HittingPerformanceScreen({ navigation, route }: any) {
  const { isParent, linkedAthletes } = useAthlete();
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);

  // Guard: If parent arrives without athleteId, go back (they should use FAB which passes athleteId)
  useEffect(() => {
    if (isParent && !route?.params?.athleteId && linkedAthletes.length > 0) {
      // Parent without athleteId - go back to dashboard where they can select athlete via FAB
      navigation.goBack();
    }
  }, [isParent, route?.params?.athleteId, linkedAthletes]);
  const [overviewStats, setOverviewStats] = useState<OverviewStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // FAB state
  const [fabOpen, setFabOpen] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasArmCareData, setHasArmCareData] = useState(false);
  const [hasForceData, setHasForceData] = useState(false);
  const [hasResourcesData, setHasResourcesData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [newResourcesCount, setNewResourcesCount] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  // Pagination
  const [displayedSessions, setDisplayedSessions] = useState(20);
  const [allSessions, setAllSessions] = useState<Session[]>([]);

  // Track mounted state and loading to prevent issues
  const isMountedRef = useRef(true);
  const isLoadingRef = useRef(false);
  const lastLoadTimeRef = useRef<number>(0);

  // Use useFocusEffect instead of useEffect to handle app backgrounding properly
  useFocusEffect(
    useCallback(() => {
      isMountedRef.current = true;
      const now = Date.now();
      const timeSinceLastLoad = now - lastLoadTimeRef.current;

      // Only reload if not currently loading and at least 30 seconds since last load
      // This prevents rapid reloads when switching tabs but allows refresh after backgrounding
      if (!isLoadingRef.current && timeSinceLastLoad > 30000) {
        loadAthleteAndData();
      }

      return () => {
        isMountedRef.current = false;
      };
    }, [])
  );

  async function loadAthleteAndData() {
    // Prevent concurrent loads
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

      // Use passed athleteId or fallback to looking up by user_id
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
      // Get org_id for security filtering
      const orgId = await getOrgIdForAthlete(athleteId);
      if (!orgId) {
        console.error('[HittingPerformanceScreen] No org_id found for athlete');
        return;
      }

      // Check for pitching data
      const { count: pitchingCount } = await supabase
        .from('trackman_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasPitchingData((pitchingCount || 0) > 0);

      // Check for arm care data (using armcare_sessions like Dashboard)
      const { count: armCareCount } = await supabase
        .from('armcare_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasArmCareData((armCareCount || 0) > 0);

      // Check for force profile data (check if they have any CMJ tests)
      const { count: forceCount } = await supabase
        .from('cmj_tests')
        .select('*', { count: 'exact', head: true })
        .eq('athlete_id', athleteId);
      setHasForceData((forceCount || 0) > 0);

      // Check for resources (using resources table like Dashboard)
      const { count: resourcesCount } = await supabase
        .from('resources')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('athlete_id', currentUserId);
      setHasResourcesData((resourcesCount || 0) > 0);

      // Get unread messages count
      const { count: unreadCount } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_id', currentUserId)
        .eq('read', false);
      setUnreadMessagesCount(unreadCount || 0);

      // Get new resources count (using last_viewed_resources_at like Dashboard)
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
    await Promise.all([
      fetchOverviewStats(id),
      fetchSessions(id),
    ]);
  }

  async function fetchOverviewStats(id: string) {
    const now = new Date();
    const last30DaysStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const last30DaysStr = last30DaysStart.toISOString().split('T')[0];

    // Type definitions for paginated queries
    interface BlastSwing {
      bat_speed: number | null;
      recorded_date: string;
      attack_angle: number | null;
      on_plane_efficiency: number | null;
    }

    interface HittraxSession {
      id: string;
      session_date: string;
    }

    interface HittraxSwing {
      exit_velocity: number | null;
      distance: number | null;
      launch_angle: number | null;
      horizontal_angle: number | null;
    }

    // Get ALL Blast swings with pagination (bypasses 1000 row limit)
    const blastSwings = await fetchAllPaginated<BlastSwing>(
      () => supabase.from('blast_swings'),
      'bat_speed, recorded_date, attack_angle, on_plane_efficiency',
      [{ column: 'athlete_id', value: id }],
      'recorded_date',
      false
    );

    // Total count is just the length of all fetched swings
    const totalBlastSwings = blastSwings.length;

    // Get ALL HitTrax sessions with pagination
    const hittraxSessions = await fetchAllPaginated<HittraxSession>(
      () => supabase.from('hittrax_sessions'),
      'id, session_date',
      [{ column: 'athlete_id', value: id }],
      'session_date',
      false
    );

    const sessionIds = hittraxSessions?.map(s => s.id) || [];

    // Get ALL Full Swing sessions with pagination
    const fullSwingSessions = await fetchAllPaginated<FullSwingSession>(
      () => supabase.from('fullswing_sessions'),
      'id, session_date, total_swings, contact_swings, avg_bat_speed, max_bat_speed, avg_exit_velocity, max_exit_velocity, avg_launch_angle, avg_distance, max_distance, hard_hit_count',
      [{ column: 'athlete_id', value: id }],
      'session_date',
      false
    );

    let hittraxTotalSwingsAllTime = 0;
    let hittraxMaxExitVelocity: number | null = null;
    let hittraxAvgExitVelocityLast30Days: number | null = null;
    let hittraxMaxDistance: number | null = null;
    let hittraxAvgDistanceLast30Days: number | null = null;
    let hittraxAvgLaunchAngleLast30Days: number | null = null;
    let hittraxAvgHorizontalAngleLast30Days: number | null = null;

    if (sessionIds.length > 0) {
      // Get ALL HitTrax swings with pagination for total count AND all-time PRs
      const allHittraxSwings = await fetchAllPaginated<HittraxSwing>(
        () => supabase.from('hittrax_swings'),
        'exit_velocity, distance, launch_angle, horizontal_angle',
        [{ column: 'session_id', value: sessionIds, operator: 'in' }],
        'created_at',
        false
      );

      hittraxTotalSwingsAllTime = allHittraxSwings.length;

      // Calculate ALL-TIME PRs from ALL swings (not just last 30 days)
      if (allHittraxSwings.length > 0) {
        const allContactSwings = allHittraxSwings.filter(s => s.exit_velocity && s.exit_velocity > 0);

        if (allContactSwings.length > 0) {
          // Combine HitTrax + Full Swing exit velocities for PR
          const hittraxExitVelos = allContactSwings.map(s => s.exit_velocity!).filter(v => v !== null);
          const fullSwingExitVelos = fullSwingSessions?.filter(s => s.max_exit_velocity !== null).map(s => s.max_exit_velocity!) || [];
          const allExitVelocities = [...hittraxExitVelos, ...fullSwingExitVelos];
          if (allExitVelocities.length > 0) {
            hittraxMaxExitVelocity = Math.max(...allExitVelocities);
          }

          // Combine HitTrax + Full Swing distances for PR
          const hittraxDistances = allContactSwings.map(s => s.distance).filter((d): d is number => d !== null && d > 0);
          const fullSwingDistances = fullSwingSessions?.filter(s => s.max_distance !== null).map(s => s.max_distance!) || [];
          const allDistances = [...hittraxDistances, ...fullSwingDistances];
          if (allDistances.length > 0) {
            hittraxMaxDistance = Math.max(...allDistances);
          }
        }
      }

      // Get swings from last 30 days for AVERAGES only
      const sessionIdsLast30 = hittraxSessions
        ?.filter(s => new Date(s.session_date) >= last30DaysStart)
        .map(s => s.id) || [];

      if (sessionIdsLast30.length > 0) {
        // Get ALL swings from last 30 days with pagination
        const hittraxLast30Swings = await fetchAllPaginated<HittraxSwing>(
          () => supabase.from('hittrax_swings'),
          'exit_velocity, distance, launch_angle, horizontal_angle',
          [{ column: 'session_id', value: sessionIdsLast30, operator: 'in' }],
          'created_at',
          false
        );

        if (hittraxLast30Swings && hittraxLast30Swings.length > 0) {
          const contactSwings = hittraxLast30Swings.filter(s => s.exit_velocity && s.exit_velocity > 0);

          if (contactSwings.length > 0) {
            const exitVelocities = contactSwings.map(s => s.exit_velocity!).filter(v => v !== null);
            hittraxAvgExitVelocityLast30Days = exitVelocities.reduce((sum, v) => sum + v, 0) / exitVelocities.length;

            const distances = contactSwings.map(s => s.distance).filter((d): d is number => d !== null && d > 0);
            if (distances.length > 0) {
              hittraxAvgDistanceLast30Days = distances.reduce((sum, d) => sum + d, 0) / distances.length;
            }

            const launchAngles = contactSwings.map(s => s.launch_angle).filter((a): a is number => a !== null);
            if (launchAngles.length > 0) {
              hittraxAvgLaunchAngleLast30Days = launchAngles.reduce((sum, a) => sum + a, 0) / launchAngles.length;
            }

            const horizontalAngles = contactSwings.map(s => s.horizontal_angle).filter((a): a is number => a !== null);
            if (horizontalAngles.length > 0) {
              hittraxAvgHorizontalAngleLast30Days = horizontalAngles.reduce((sum, a) => sum + a, 0) / horizontalAngles.length;
            }
          }
        }
      }
    }

    // Include Full Swing in PRs and last 30 days calculations
    if (fullSwingSessions && fullSwingSessions.length > 0) {
      // Full Swing PRs (combine with HitTrax)
      const fullSwingExitVelos = fullSwingSessions.filter(s => s.max_exit_velocity !== null).map(s => s.max_exit_velocity!);
      if (fullSwingExitVelos.length > 0) {
        const fsMaxEV = Math.max(...fullSwingExitVelos);
        hittraxMaxExitVelocity = hittraxMaxExitVelocity !== null ? Math.max(hittraxMaxExitVelocity, fsMaxEV) : fsMaxEV;
      }
      const fullSwingDistances = fullSwingSessions.filter(s => s.max_distance !== null).map(s => s.max_distance!);
      if (fullSwingDistances.length > 0) {
        const fsMaxDist = Math.max(...fullSwingDistances);
        hittraxMaxDistance = hittraxMaxDistance !== null ? Math.max(hittraxMaxDistance, fsMaxDist) : fsMaxDist;
      }

      // Full Swing last 30 days averages
      const fullSwingLast30 = fullSwingSessions.filter(s => new Date(s.session_date) >= last30DaysStart);
      if (fullSwingLast30.length > 0) {
        // Exit velocity - weighted by contact swings
        const fsEVData = fullSwingLast30.filter(s => s.avg_exit_velocity !== null && s.contact_swings > 0);
        if (fsEVData.length > 0) {
          const totalContactSwings = fsEVData.reduce((sum, s) => sum + s.contact_swings, 0);
          const weightedEV = fsEVData.reduce((sum, s) => sum + (s.avg_exit_velocity! * s.contact_swings), 0) / totalContactSwings;
          if (hittraxAvgExitVelocityLast30Days !== null) {
            // Combine with HitTrax (simple average of both averages for now)
            hittraxAvgExitVelocityLast30Days = (hittraxAvgExitVelocityLast30Days + weightedEV) / 2;
          } else {
            hittraxAvgExitVelocityLast30Days = weightedEV;
          }
        }

        // Distance
        const fsDistData = fullSwingLast30.filter(s => s.avg_distance !== null && s.contact_swings > 0);
        if (fsDistData.length > 0) {
          const totalContactSwings = fsDistData.reduce((sum, s) => sum + s.contact_swings, 0);
          const weightedDist = fsDistData.reduce((sum, s) => sum + (s.avg_distance! * s.contact_swings), 0) / totalContactSwings;
          if (hittraxAvgDistanceLast30Days !== null) {
            hittraxAvgDistanceLast30Days = (hittraxAvgDistanceLast30Days + weightedDist) / 2;
          } else {
            hittraxAvgDistanceLast30Days = weightedDist;
          }
        }

        // Launch angle
        const fsLAData = fullSwingLast30.filter(s => s.avg_launch_angle !== null && s.contact_swings > 0);
        if (fsLAData.length > 0) {
          const totalContactSwings = fsLAData.reduce((sum, s) => sum + s.contact_swings, 0);
          const weightedLA = fsLAData.reduce((sum, s) => sum + (s.avg_launch_angle! * s.contact_swings), 0) / totalContactSwings;
          if (hittraxAvgLaunchAngleLast30Days !== null) {
            hittraxAvgLaunchAngleLast30Days = (hittraxAvgLaunchAngleLast30Days + weightedLA) / 2;
          } else {
            hittraxAvgLaunchAngleLast30Days = weightedLA;
          }
        }
      }
    }

    // Calculate Blast stats
    const last30Swings = blastSwings?.filter(s => {
      const swingDate = new Date(s.recorded_date);
      return swingDate >= last30DaysStart;
    }) || [];

    // Full Swing last 30 days for bat speed
    const fullSwingLast30ForBatSpeed = fullSwingSessions?.filter(s =>
      new Date(s.session_date) >= last30DaysStart && s.avg_bat_speed !== null
    ) || [];

    const totalSwingsLast30Days = last30Swings.length + fullSwingLast30ForBatSpeed.reduce((sum, s) => sum + s.total_swings, 0);

    // Get highest bat speed PR (all time) - combine Blast + Full Swing
    const blastBatSpeeds = blastSwings?.filter(s => s.bat_speed !== null).map(s => s.bat_speed!) || [];
    const fullSwingBatSpeeds = fullSwingSessions?.filter(s => s.max_bat_speed !== null).map(s => s.max_bat_speed!) || [];
    const allBatSpeeds = [...blastBatSpeeds, ...fullSwingBatSpeeds];
    const highestBatSpeedPR = allBatSpeeds.length > 0 ? Math.max(...allBatSpeeds) : 0;

    // Average bat speed last 30 days - combine Blast + Full Swing
    const blastBatSpeedsLast30 = last30Swings.filter(s => s.bat_speed !== null).map(s => s.bat_speed!);
    const fullSwingAvgBatSpeedsLast30 = fullSwingLast30ForBatSpeed.map(s => ({ avg: s.avg_bat_speed!, count: s.total_swings }));

    let avgBatSpeedLast30Days = 0;
    const totalBlastBatSpeedSwings = blastBatSpeedsLast30.length;
    const totalFSBatSpeedSwings = fullSwingAvgBatSpeedsLast30.reduce((sum, s) => sum + s.count, 0);
    const totalBatSpeedSwings = totalBlastBatSpeedSwings + totalFSBatSpeedSwings;

    if (totalBatSpeedSwings > 0) {
      const blastSum = blastBatSpeedsLast30.reduce((sum, speed) => sum + speed, 0);
      const fsSum = fullSwingAvgBatSpeedsLast30.reduce((sum, s) => sum + (s.avg * s.count), 0);
      avgBatSpeedLast30Days = (blastSum + fsSum) / totalBatSpeedSwings;
    }

    // Average attack angle last 30 days (Blast-only metric)
    const attackAnglesLast30 = last30Swings.filter(s => s.attack_angle !== null).map(s => s.attack_angle!);
    const avgAttackAngleLast30Days = attackAnglesLast30.length > 0
      ? attackAnglesLast30.reduce((sum, angle) => sum + angle, 0) / attackAnglesLast30.length
      : null;  // Return null when no Blast data

    // Average on-plane efficiency last 30 days (Blast-only metric)
    const onPlaneEfficiencyLast30 = last30Swings.filter(s => s.on_plane_efficiency !== null).map(s => s.on_plane_efficiency!);
    const avgOnPlaneEfficiencyLast30Days = onPlaneEfficiencyLast30.length > 0
      ? onPlaneEfficiencyLast30.reduce((sum, eff) => sum + eff, 0) / onPlaneEfficiencyLast30.length
      : null;  // Return null when no Blast data

    setOverviewStats({
      totalSwingsAllTime: totalBlastSwings || 0,
      totalSwingsLast30Days,
      hittraxTotalSwingsAllTime,
      highestBatSpeedPR,
      avgBatSpeedLast30Days,
      hittraxMaxExitVelocity,
      hittraxAvgExitVelocityLast30Days,
      hittraxMaxDistance,
      hittraxAvgDistanceLast30Days,
      avgAttackAngleLast30Days,
      hittraxAvgLaunchAngleLast30Days,
      hittraxAvgHorizontalAngleLast30Days,
      avgOnPlaneEfficiencyLast30Days,
    });
  }

  // Parse Blast timestamp (same logic as web app)
  function parseBlastTimestamp(swing: any): Date | null {
    if (swing.created_at_utc) {
      return new Date(swing.created_at_utc);
    }
    if (swing.recorded_date && swing.recorded_time) {
      return new Date(`${swing.recorded_date}T${swing.recorded_time}`);
    }
    return null;
  }

  // Parse HitTrax timestamp: "10/30/2025 19:18:31.573" format
  function parseHitTraxTimestamp(timestamp: string | null): Date | null {
    if (!timestamp) return null;
    try {
      const [datePart, timePart] = timestamp.split(' ');
      const [month, day, year] = datePart.split('/');
      const [hours, minutes, secondsWithMs] = timePart.split(':');
      const seconds = parseFloat(secondsWithMs);
      return new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
        seconds
      );
    } catch {
      return null;
    }
  }

  // Match swings by timestamp (7-second window) - exactly like web app
  function matchSwingsByTime(
    blastSwings: any[],
    hittraxSwings: any[],
    maxTimeDifferenceSeconds: number = 7
  ) {
    const swingPairs: any[] = [];
    const matchedBlastIds = new Set<string>();
    const matchedHittraxIds = new Set<string>();

    // Parse all timestamps
    const blastWithTime = blastSwings
      .map(swing => ({ swing, timestamp: parseBlastTimestamp(swing) }))
      .filter((item): item is { swing: any; timestamp: Date } => item.timestamp !== null)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const hittraxWithTime = hittraxSwings
      .map(swing => ({ swing, timestamp: parseHitTraxTimestamp(swing.swing_timestamp) }))
      .filter((item): item is { swing: any; timestamp: Date } => item.timestamp !== null)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // For each Blast swing, find closest HitTrax swing
    blastWithTime.forEach(({ swing: blastSwing, timestamp: blastTime }) => {
      let closestMatch: { hittraxSwing: any; timeDiff: number } | null = null;

      hittraxWithTime.forEach(({ swing: hittraxSwing, timestamp: hittraxTime }) => {
        if (matchedHittraxIds.has(hittraxSwing.id)) return;

        const timeDiffSeconds = Math.abs(blastTime.getTime() - hittraxTime.getTime()) / 1000;

        if (timeDiffSeconds <= maxTimeDifferenceSeconds) {
          if (!closestMatch || timeDiffSeconds < closestMatch.timeDiff) {
            closestMatch = { hittraxSwing, timeDiff: timeDiffSeconds };
          }
        }
      });

      if (closestMatch !== null) {
        const match = closestMatch as { hittraxSwing: any; timeDiff: number };
        matchedBlastIds.add(blastSwing.id);
        matchedHittraxIds.add(match.hittraxSwing.id);
        swingPairs.push({ blastSwing, hittraxSwing: match.hittraxSwing, paired: true });
      } else {
        swingPairs.push({ blastSwing, hittraxSwing: null, paired: false });
      }
    });

    // Add unmatched HitTrax swings
    hittraxWithTime.forEach(({ swing: hittraxSwing }) => {
      if (!matchedHittraxIds.has(hittraxSwing.id)) {
        swingPairs.push({ blastSwing: null, hittraxSwing, paired: false });
      }
    });

    return swingPairs;
  }

  async function fetchSessions(id: string) {
    try {
      // Type definitions for session fetching
      interface BlastSwingSession {
        id: string;
        recorded_date: string;
        recorded_time: string | null;
        created_at_utc: string | null;
        bat_speed: number | null;
        attack_angle: number | null;
        on_plane_efficiency: number | null;
      }

      interface HittraxSessionData {
        id: string;
        session_date: string;
      }

      interface HittraxSwingSession {
        id: string;
        session_id: string;
        swing_timestamp: string | null;
        exit_velocity: number | null;
        distance: number | null;
        launch_angle: number | null;
      }

      // Get ALL Blast swings with pagination (bypasses 1000 row limit)
      const blastSwings = await fetchAllPaginated<BlastSwingSession>(
        () => supabase.from('blast_swings'),
        'id, recorded_date, recorded_time, created_at_utc, bat_speed, attack_angle, on_plane_efficiency',
        [{ column: 'athlete_id', value: id }],
        'recorded_date',
        false
      );

      // Get ALL HitTrax sessions with pagination
      const hittraxSessions = await fetchAllPaginated<HittraxSessionData>(
        () => supabase.from('hittrax_sessions'),
        'id, session_date',
        [{ column: 'athlete_id', value: id }],
        'session_date',
        false
      );

      // Get ALL HitTrax swings with pagination
      let hittraxSwings: HittraxSwingSession[] = [];
      if (hittraxSessions && hittraxSessions.length > 0) {
        const sessionIds = hittraxSessions.map(s => s.id);
        hittraxSwings = await fetchAllPaginated<HittraxSwingSession>(
          () => supabase.from('hittrax_swings'),
          'id, session_id, swing_timestamp, exit_velocity, distance, launch_angle',
          [{ column: 'session_id', value: sessionIds, operator: 'in' }],
          'swing_timestamp',
          false
        );
      }

      // Get ALL Full Swing sessions with pagination
      const fullSwingSessions = await fetchAllPaginated<FullSwingSession>(
        () => supabase.from('fullswing_sessions'),
        'id, session_date, total_swings, contact_swings, avg_bat_speed, max_bat_speed, avg_exit_velocity, max_exit_velocity, avg_distance, max_distance, hard_hit_count',
        [{ column: 'athlete_id', value: id }],
        'session_date',
        false
      );

      // Match swings by timestamp (7-second window)
      const swingPairs = matchSwingsByTime(blastSwings || [], hittraxSwings, 7);

      // Group swing pairs by date into sessions
      const sessionMap = new Map<string, any[]>();

      swingPairs.forEach(pair => {
        let date: string;
        if (pair.blastSwing) {
          const timestamp = parseBlastTimestamp(pair.blastSwing);
          if (timestamp) {
            const year = timestamp.getFullYear();
            const month = String(timestamp.getMonth() + 1).padStart(2, '0');
            const day = String(timestamp.getDate()).padStart(2, '0');
            date = `${year}-${month}-${day}`;
          } else {
            date = pair.blastSwing.recorded_date || 'unknown';
          }
        } else if (pair.hittraxSwing?.swing_timestamp) {
          const [datePart] = pair.hittraxSwing.swing_timestamp.split(' ');
          const [month, day, year] = datePart.split('/');
          date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        } else {
          date = 'unknown';
        }

        if (!sessionMap.has(date)) {
          sessionMap.set(date, []);
        }
        sessionMap.get(date)!.push(pair);
      });

      // Convert to Session objects
      const allSessions: Session[] = [];

      sessionMap.forEach((pairs, date) => {
        if (date === 'unknown') return;

        const blastSwingsInSession = pairs.filter(p => p.blastSwing).map(p => p.blastSwing);
        const hittraxSwingsInSession = pairs.filter(p => p.hittraxSwing).map(p => p.hittraxSwing);
        const actualPairedCount = pairs.filter(p => p.blastSwing && p.hittraxSwing).length;

        const hasBlast = blastSwingsInSession.length > 0;
        const hasHitTrax = hittraxSwingsInSession.length > 0;
        const isPaired = hasBlast && hasHitTrax;

        if (hasHitTrax) {
          // HitTrax session (may also be paired)
          const contactSwings = hittraxSwingsInSession.filter((s: any) => s.exit_velocity && s.exit_velocity > 0);
          const exitVelocities = contactSwings.map((s: any) => s.exit_velocity);
          const distances = contactSwings.map((s: any) => s.distance).filter((d: any): d is number => d !== null && d > 0);

          allSessions.push({
            id: hittraxSwingsInSession[0]?.session_id || date,
            session_date: date,
            total_swings: hittraxSwingsInSession.length,
            contact_swings: contactSwings.length,
            avg_exit_velocity: exitVelocities.length > 0 ? exitVelocities.reduce((a: number, b: number) => a + b, 0) / exitVelocities.length : 0,
            max_exit_velocity: exitVelocities.length > 0 ? Math.max(...exitVelocities) : 0,
            max_distance: distances.length > 0 ? Math.max(...distances) : 0,
            hard_hit_count: contactSwings.filter((s: any) => s.exit_velocity && s.exit_velocity >= 95).length,
            source: 'hittrax',
            isPaired,
            blast_swings_count: blastSwingsInSession.length,
            hittrax_swings_count: hittraxSwingsInSession.length,
            paired_swings_count: actualPairedCount,
          });
        } else if (hasBlast) {
          // Blast-only session
          const batSpeeds = blastSwingsInSession.map((s: any) => s.bat_speed).filter((v: any): v is number => v !== null);
          const attackAngles = blastSwingsInSession.map((s: any) => s.attack_angle).filter((v: any): v is number => v !== null);
          const onPlaneEffs = blastSwingsInSession.map((s: any) => s.on_plane_efficiency).filter((v: any): v is number => v !== null);

          allSessions.push({
            id: date,
            session_date: date,
            total_swings: blastSwingsInSession.length,
            contact_swings: 0,
            avg_exit_velocity: 0,
            max_exit_velocity: 0,
            max_distance: 0,
            hard_hit_count: 0,
            source: 'blast',
            isPaired: false,
            blast_swings_count: blastSwingsInSession.length,
            avg_bat_speed: batSpeeds.length > 0 ? batSpeeds.reduce((a, b) => a + b, 0) / batSpeeds.length : 0,
            avg_attack_angle: attackAngles.length > 0 ? attackAngles.reduce((a, b) => a + b, 0) / attackAngles.length : 0,
            avg_on_plane_efficiency: onPlaneEffs.length > 0 ? onPlaneEffs.reduce((a, b) => a + b, 0) / onPlaneEffs.length : 0,
          });
        }
      });

      // Add Full Swing sessions
      if (fullSwingSessions && fullSwingSessions.length > 0) {
        fullSwingSessions.forEach(fs => {
          allSessions.push({
            id: fs.id,
            session_date: fs.session_date,
            total_swings: fs.total_swings,
            contact_swings: fs.contact_swings,
            avg_exit_velocity: fs.avg_exit_velocity || 0,
            max_exit_velocity: fs.max_exit_velocity || 0,
            max_distance: fs.max_distance || 0,
            hard_hit_count: fs.hard_hit_count,
            source: 'fullswing',
            avg_bat_speed: fs.avg_bat_speed || undefined,
          });
        });
      }

      // Sort by date
      allSessions.sort((a, b) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime());
      setAllSessions(allSessions);
      setSessions(allSessions.slice(0, 20));
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

  function formatMetric(value: number | null, decimals: number = 1): string {
    if (value === null || isNaN(value)) return '--';
    return value.toFixed(decimals);
  }

  function formatDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
          <Text style={styles.title}>Hitting Performance</Text>
          <Text style={styles.subtitle}>Swing metrics and batted ball analysis</Text>
        </View>

        {/* Overview Stats */}
        {overviewStats && (
          <View style={styles.statsContainer}>
            {/* Total Swings */}
            <View style={styles.swingCountRow}>
              <Text style={styles.sectionTitle}>All-Time PRs</Text>
              <View style={styles.swingCounts}>
                <Text style={styles.swingCountText}>{overviewStats.totalSwingsAllTime.toLocaleString()} <Text style={styles.blastLabel}>Blast</Text></Text>
                <Text style={styles.swingCountDivider}>|</Text>
                <Text style={styles.swingCountText}>{overviewStats.hittraxTotalSwingsAllTime.toLocaleString()} <Text style={styles.hittraxLabel}>HitTrax</Text></Text>
              </View>
            </View>

            {/* PR Stats Row */}
            <View style={styles.prRow}>
              {/* Bat Speed PR */}
              <View style={styles.prItem}>
                <View style={styles.prValueRow}>
                  <Ionicons name="star" size={12} color="#D4AF37" />
                  <Text style={styles.prValue}>{formatMetric(overviewStats.highestBatSpeedPR)}</Text>
                </View>
                <Text style={styles.prLabel}>Bat Speed</Text>
                <Text style={styles.prUnit}>mph</Text>
              </View>

              {/* Exit Velocity PR */}
              <View style={[styles.prItem, styles.prItemBorder]}>
                <View style={styles.prValueRow}>
                  <Ionicons name="star" size={12} color="#D4AF37" />
                  <Text style={styles.prValue}>{formatMetric(overviewStats.hittraxMaxExitVelocity)}</Text>
                </View>
                <Text style={styles.prLabel}>Exit Velocity</Text>
                <Text style={styles.prUnit}>mph</Text>
              </View>

              {/* Distance PR */}
              <View style={styles.prItem}>
                <View style={styles.prValueRow}>
                  <Ionicons name="star" size={12} color="#D4AF37" />
                  <Text style={styles.prValue}>{formatMetric(overviewStats.hittraxMaxDistance)}</Text>
                </View>
                <Text style={styles.prLabel}>Distance</Text>
                <Text style={styles.prUnit}>feet</Text>
              </View>
            </View>

            {/* 30 Day Averages */}
            <View style={styles.avgSection}>
              <Text style={styles.avgSectionTitle}>Last 30 Days</Text>

              {/* Row 1 */}
              <View style={styles.avgRow}>
                <View style={styles.avgItem}>
                  <Text style={styles.avgValue}>{formatMetric(overviewStats.avgBatSpeedLast30Days)}</Text>
                  <Text style={styles.avgLabel}>Bat Speed</Text>
                </View>
                <View style={styles.avgItem}>
                  <Text style={styles.avgValue}>{formatMetric(overviewStats.hittraxAvgExitVelocityLast30Days)}</Text>
                  <Text style={styles.avgLabel}>Exit Velo</Text>
                </View>
                <View style={styles.avgItem}>
                  <Text style={styles.avgValue}>{formatMetric(overviewStats.hittraxAvgDistanceLast30Days)}</Text>
                  <Text style={styles.avgLabel}>Distance</Text>
                </View>
              </View>

              {/* Row 2 */}
              <View style={styles.avgRow}>
                <View style={styles.avgItemSmall}>
                  <Text style={styles.avgValue}>
                    {overviewStats.avgAttackAngleLast30Days !== null
                      ? `${formatMetric(overviewStats.avgAttackAngleLast30Days)}°`
                      : '--'}
                  </Text>
                  <Text style={styles.avgLabel}>Attack Angle</Text>
                </View>
                <View style={styles.avgItemSmall}>
                  <Text style={styles.avgValue}>
                    {overviewStats.hittraxAvgLaunchAngleLast30Days !== null
                      ? `${formatMetric(overviewStats.hittraxAvgLaunchAngleLast30Days)}°`
                      : '--'}
                  </Text>
                  <Text style={styles.avgLabel}>Launch Angle</Text>
                </View>
                <View style={styles.avgItemSmall}>
                  <View style={styles.directionRow}>
                    {overviewStats.hittraxAvgHorizontalAngleLast30Days !== null && (
                      <Ionicons
                        name="arrow-up"
                        size={16}
                        color="#FFFFFF"
                        style={{ transform: [{ rotate: `${-overviewStats.hittraxAvgHorizontalAngleLast30Days}deg` }] }}
                      />
                    )}
                    <Text style={styles.avgValue}>
                      {overviewStats.hittraxAvgHorizontalAngleLast30Days !== null
                        ? `${Math.abs(overviewStats.hittraxAvgHorizontalAngleLast30Days).toFixed(1)}°`
                        : '--'}
                    </Text>
                  </View>
                  <Text style={styles.avgLabel}>Spray Direction</Text>
                </View>
                <View style={styles.avgItemSmall}>
                  <Text style={styles.avgValue}>
                    {overviewStats.avgOnPlaneEfficiencyLast30Days !== null
                      ? `${formatMetric(overviewStats.avgOnPlaneEfficiencyLast30Days)}%`
                      : '--'}
                  </Text>
                  <Text style={styles.avgLabel}>On-Plane %</Text>
                </View>
              </View>
            </View>

            {/* Analysis Buttons */}
            <View style={styles.analysisButtons}>
              <TouchableOpacity
                style={styles.analysisButton}
                onPress={() => navigation.navigate('HittingTrends', { athleteId })}
              >
                <View style={styles.analysisButtonInner}>
                  <Ionicons name="trending-up" size={16} color="#9BDDFF" />
                  <Text style={styles.analysisButtonText}>Swing Trends</Text>
                  <Ionicons name="chevron-forward" size={14} color="#4B5563" />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.analysisButton}
                onPress={() => navigation.navigate('BattedBallTrends', { athleteId })}
              >
                <View style={styles.analysisButtonInner}>
                  <MaterialCommunityIcons name="baseball" size={16} color="#9BDDFF" />
                  <Text style={styles.analysisButtonText}>Batted Ball</Text>
                  <Ionicons name="chevron-forward" size={14} color="#4B5563" />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.analysisButton}
                onPress={() => navigation.navigate('PairedDataTrends', { athleteId })}
              >
                <View style={styles.analysisButtonInner}>
                  <Ionicons name="link" size={16} color="#9BDDFF" />
                  <Text style={styles.analysisButtonText}>Paired Data</Text>
                  <Ionicons name="chevron-forward" size={14} color="#4B5563" />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Sessions List */}
        <View style={styles.sessionsContainer}>
          <Text style={styles.sessionsTitle}>Recent Sessions</Text>
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <TouchableOpacity
                key={session.id}
                style={styles.sessionCard}
                onPress={() => navigation.navigate('HittingSession', { sessionId: session.id, date: session.session_date, athleteId, source: session.source })}
              >
                <View style={styles.sessionHeader}>
                  <View style={styles.sessionHeaderLeft}>
                    <Text style={styles.sessionDate}>{formatDate(session.session_date)}</Text>
                    {session.isPaired && session.paired_swings_count && session.paired_swings_count > 0 && (
                      <View style={styles.pairedBadge}>
                        <Ionicons name="link" size={10} color="#9BDDFF" style={{ marginRight: 3 }} />
                        <Text style={styles.pairedBadgeText}>{session.paired_swings_count} Paired</Text>
                      </View>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                </View>

                <Text style={styles.sessionSource}>
                  {session.isPaired ? (
                    <>
                      <Text style={styles.hittraxLabel}>HitTrax</Text> + <Text style={styles.blastLabel}>Blast</Text> Session
                      <Text style={styles.sessionSourceMuted}>
                        {` (${session.paired_swings_count} paired)`}
                      </Text>
                    </>
                  ) : session.source === 'hittrax' ? (
                    <><Text style={styles.hittraxLabel}>HitTrax</Text> Only <Text style={styles.sessionSourceMuted}>({session.total_swings} swings)</Text></>
                  ) : session.source === 'fullswing' ? (
                    <><Text style={styles.fullswingLabel}>Full Swing</Text> <Text style={styles.sessionSourceMuted}>({session.total_swings} swings)</Text></>
                  ) : (
                    <><Text style={styles.blastLabel}>Blast</Text> Only <Text style={styles.sessionSourceMuted}>({session.blast_swings_count} swings)</Text></>
                  )}
                </Text>

                <View style={styles.sessionStats}>
                  <View style={styles.sessionStat}>
                    <Text style={styles.sessionStatValue}>{session.total_swings}</Text>
                    <Text style={styles.sessionStatLabel}>Swings</Text>
                  </View>

                  {session.source === 'blast' ? (
                    <>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValueSpeed}>
                          {session.avg_bat_speed ? session.avg_bat_speed.toFixed(1) : '--'}
                        </Text>
                        <Text style={styles.sessionStatLabel}>Bat Speed</Text>
                      </View>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValue}>
                          {session.avg_attack_angle ? session.avg_attack_angle.toFixed(1) : '--'}°
                        </Text>
                        <Text style={styles.sessionStatLabel}>Attack Angle</Text>
                      </View>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValueEfficiency}>
                          {session.avg_on_plane_efficiency ? session.avg_on_plane_efficiency.toFixed(1) : '--'}%
                        </Text>
                        <Text style={styles.sessionStatLabel}>On-Plane %</Text>
                      </View>
                    </>
                  ) : session.source === 'fullswing' ? (
                    <>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValueSpeed}>
                          {session.avg_bat_speed ? session.avg_bat_speed.toFixed(1) : '--'}
                        </Text>
                        <Text style={styles.sessionStatLabel}>Bat Speed</Text>
                      </View>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValueSpeed}>
                          {session.max_exit_velocity?.toFixed(1) || '--'}
                        </Text>
                        <Text style={styles.sessionStatLabel}>Max EV</Text>
                      </View>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValueDistance}>
                          {Math.round(session.max_distance) || '--'}
                        </Text>
                        <Text style={styles.sessionStatLabel}>Max Dist</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValueSpeed}>
                          {session.max_exit_velocity?.toFixed(1) || '--'}
                        </Text>
                        <Text style={styles.sessionStatLabel}>Max EV</Text>
                      </View>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValueDistance}>
                          {Math.round(session.max_distance) || '--'}
                        </Text>
                        <Text style={styles.sessionStatLabel}>Max Dist</Text>
                      </View>
                      <View style={styles.sessionStat}>
                        <Text style={styles.sessionStatValueSpeed}>
                          {session.avg_exit_velocity?.toFixed(1) || '--'}
                        </Text>
                        <Text style={styles.sessionStatLabel}>Avg EV</Text>
                      </View>
                    </>
                  )}
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="baseball-bat" size={48} color="#4B5563" />
              <Text style={styles.emptyStateText}>No sessions found</Text>
              <Text style={styles.emptyStateSubtext}>Complete your first HitTrax session to get started</Text>
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
          { id: 'leaderboard', label: 'Leaderboard', icon: 'trophy', onPress: () => navigation.navigate('Leaderboard') },
          { id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community', isActive: true, onPress: () => {} },
          ...(hasPitchingData ? [{ id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('PitchingPerformance', { athleteId }) }] : []),
          ...(hasArmCareData ? [{ id: 'armcare', label: 'Arm Care', icon: 'arm-flex', iconFamily: 'material-community' as const, onPress: () => navigation.navigate('ArmCare', { athleteId }) }] : []),
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
    marginBottom: 16,
  },
  backText: {
    color: '#9CA3AF',
    fontSize: 14,
    marginLeft: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  statsContainer: {
    paddingHorizontal: 16,
  },
  swingCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  swingCounts: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  swingCountText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  swingCountDivider: {
    fontSize: 12,
    color: '#4B5563',
    marginHorizontal: 8,
  },
  blastLabel: {
    color: '#9CA3AF',
    fontWeight: '600',
  },
  hittraxLabel: {
    color: '#9CA3AF',
    fontWeight: '600',
  },
  fullswingLabel: {
    color: '#9CA3AF',
    fontWeight: '600',
  },
  prRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  prItem: {
    flex: 1,
    alignItems: 'center',
  },
  prItemBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  prValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  prValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F5F0E6',
  },
  prLabel: {
    fontSize: 9,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  prUnit: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  avgSection: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  avgSectionTitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
  },
  avgRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  avgItem: {
    flex: 1,
    alignItems: 'center',
  },
  avgItemSmall: {
    flex: 1,
    alignItems: 'center',
  },
  avgValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  avgLabel: {
    fontSize: 8,
    color: '#6B7280',
    marginTop: 2,
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  analysisButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  analysisButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  analysisButtonInner: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(155,221,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.15)',
    borderRadius: 10,
  },
  analysisButtonText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    color: '#E5E7EB',
    marginLeft: 6,
  },
  sessionsContainer: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  sessionsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  sessionCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sessionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  pairedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(155,221,255,0.1)',
    borderRadius: 4,
  },
  pairedBadgeText: {
    fontSize: 9,
    fontWeight: '500',
    color: '#9BDDFF',
  },
  sessionSource: {
    fontSize: 9,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sessionSourceHighlight: {
    color: '#9CA3AF',
  },
  sessionSourceMuted: {
    color: '#9CA3AF',
  },
  sessionStats: {
    flexDirection: 'row',
  },
  sessionStat: {
    flex: 1,
    alignItems: 'center',
  },
  sessionStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  sessionStatValueSpeed: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#9BDDFF',
  },
  sessionStatValueDistance: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  sessionStatValueEfficiency: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  sessionStatLabel: {
    fontSize: 7,
    color: '#6B7280',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 24,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#9CA3AF',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
  },
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
