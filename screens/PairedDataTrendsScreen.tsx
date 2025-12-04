import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Rect,
  Line,
  Path,
  Circle,
  Text as SvgText,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  G,
} from 'react-native-svg';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Professional color palette
const COLORS = {
  primary: '#9BDDFF',
  primaryDark: '#7BC5F0',
  secondary: '#F5F0E6',
  gold: '#D4AF37',
  white: '#FFFFFF',
  gray100: '#F5F5F5',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#111827',
  black: '#000000',
  cyan400: '#22D3EE',
  cyan500: '#06B6D4',
};

// Physics constants
const GRAVITY = 32.174; // ft/s²
const SQUARED_UP_THRESHOLD = 80; // percent of max potential EV

interface AthleteData {
  avgBatSpeed: number | null;
  avgLaunchAngle: number | null;
  avgExitVelo: number | null;
  maxBatSpeed: number | null;
  maxExitVelo: number | null;
  level: 'youth' | 'highschool' | 'college' | 'pro';
}

interface SquaredUpDataPoint {
  date: string;
  squaredUpRate: number;
  totalPairedSwings: number;
  squaredUpCount: number;
}

interface TrajectoryData {
  pitchSpeed: number;
  exitVelo: number;
  maxDistance: number;
  trajectory: { x: number; y: number }[];
}

type TimeFilter = '1month' | '3months' | '6months' | 'all';
type LevelFilter = 'youth' | 'highschool' | 'college' | 'pro';

// Calculate exit velocity using tiered pitch coefficients
function calculateExitVelocity(batSpeed: number, pitchSpeed: number): number {
  let pitchCoefficient: number;
  if (pitchSpeed < 40) {
    pitchCoefficient = 0.50;
  } else if (pitchSpeed < 55) {
    pitchCoefficient = 0.10;
  } else if (pitchSpeed < 70) {
    pitchCoefficient = 0.17;
  } else {
    pitchCoefficient = 0.23;
  }
  return (1.23 * batSpeed) + (pitchCoefficient * pitchSpeed);
}

// Calculate max distance using projectile motion with drag
function calculateMaxDistance(exitVeloMph: number, launchAngleDeg: number): number {
  const exitVeloFps = exitVeloMph * 1.467;
  const launchAngleRad = launchAngleDeg * (Math.PI / 180);

  const vx0 = exitVeloFps * Math.cos(launchAngleRad);
  const vy0 = exitVeloFps * Math.sin(launchAngleRad);

  const dragCoeff = 0.0004;
  const dt = 0.01;
  let x = 0;
  let y = 3;
  let vx = vx0;
  let vy = vy0;

  while (y > 0 && x < 600) {
    const v = Math.sqrt(vx * vx + vy * vy);
    const dragAccel = dragCoeff * v * v;
    const dragX = (vx / v) * dragAccel;
    const dragY = (vy / v) * dragAccel;

    vx = vx - dragX * dt;
    vy = vy - GRAVITY * dt - dragY * dt;
    x = x + vx * dt;
    y = y + vy * dt;
  }

  return Math.max(0, x);
}

// Generate trajectory points for visualization
function generateTrajectoryPoints(exitVeloMph: number, launchAngleDeg: number, maxX: number): { x: number; y: number }[] {
  const exitVeloFps = exitVeloMph * 1.467;
  const launchAngleRad = launchAngleDeg * (Math.PI / 180);

  const vx0 = exitVeloFps * Math.cos(launchAngleRad);
  const vy0 = exitVeloFps * Math.sin(launchAngleRad);

  const dragCoeff = 0.0004;
  const points: { x: number; y: number }[] = [];
  const dt = 0.02;
  let x = 0;
  let y = 3;
  let vx = vx0;
  let vy = vy0;

  while (y > 0 && x < maxX + 50) {
    points.push({ x, y });

    const v = Math.sqrt(vx * vx + vy * vy);
    const dragAccel = dragCoeff * v * v;
    const dragX = (vx / v) * dragAccel;
    const dragY = (vy / v) * dragAccel;

    vx = vx - dragX * dt;
    vy = vy - GRAVITY * dt - dragY * dt;
    x = x + vx * dt;
    y = y + vy * dt;
  }

  if (y <= 0 && points.length > 0) {
    points.push({ x, y: 0 });
  }

  return points;
}

// Get pitch speed cohorts based on level
function getPitchSpeedCohorts(level: LevelFilter): number[] {
  switch (level) {
    case 'youth':
      return [50, 60, 70];
    case 'highschool':
      return [70, 80, 90];
    case 'college':
    case 'pro':
      return [80, 90, 95];
    default:
      return [70, 80, 90];
  }
}

export default function PairedDataTrendsScreen({ navigation, route }: any) {
  const [athleteData, setAthleteData] = useState<AthleteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('highschool');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('3months');
  const [selectedPitchSpeed, setSelectedPitchSpeed] = useState<number | null>(null);
  const [squaredUpData, setSquaredUpData] = useState<SquaredUpDataPoint[]>([]);
  const [squaredUpLoading, setSquaredUpLoading] = useState(true);
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);

  useEffect(() => {
    loadAthleteAndData();
  }, []);

  useEffect(() => {
    if (athleteId) {
      fetchAthleteData(athleteId);
      fetchSquaredUpData(athleteId);
    }
  }, [athleteId, timeFilter]);

  async function loadAthleteAndData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      // Use passed athleteId or fallback to looking up by user_id
      let currentAthleteId = athleteId;
      let playLevel: string | null = null;

      if (!currentAthleteId) {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id, play_level')
          .eq('user_id', user.id)
          .single();

        if (!athlete) {
          setLoading(false);
          return;
        }
        currentAthleteId = athlete.id;
        setAthleteId(athlete.id);
        playLevel = athlete.play_level;
      } else {
        // If athleteId passed, fetch play_level
        const { data: athlete } = await supabase
          .from('athletes')
          .select('play_level')
          .eq('id', currentAthleteId)
          .single();
        playLevel = athlete?.play_level || null;
      }

      // Set level filter based on athlete's play level
      if (playLevel) {
        const l = playLevel.toLowerCase();
        if (l === 'youth' || l.includes('12u') || l.includes('14u') || l.includes('middle')) {
          setLevelFilter('youth');
        } else if (l === 'high school' || l.includes('high') || l.includes('varsity')) {
          setLevelFilter('highschool');
        } else if (l === 'college' || l.includes('ncaa') || l.includes('juco')) {
          setLevelFilter('college');
        } else if (l === 'pro' || l.includes('mlb') || l.includes('milb')) {
          setLevelFilter('pro');
        }
      }
    } catch (error) {
      console.error('Error loading athlete:', error);
      setLoading(false);
    }
  }

  function getDateRange(): Date | null {
    if (timeFilter === 'all') return null;
    const now = new Date();
    switch (timeFilter) {
      case '1month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '3months':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      case '6months':
        return new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  }

  async function fetchAthleteData(id: string) {
    setLoading(true);
    const startDateObj = getDateRange();
    const startDate = startDateObj ? startDateObj.toISOString() : null;

    // Fetch Blast Motion data for bat speed
    let blastQuery = supabase
      .from('blast_swings')
      .select('bat_speed, recorded_date')
      .eq('athlete_id', id)
      .not('bat_speed', 'is', null)
      .gt('bat_speed', 0);

    if (startDate) {
      blastQuery = blastQuery.gte('recorded_date', startDate);
    }

    const { data: blastSwings } = await blastQuery;

    // Fetch HitTrax sessions
    let hittraxQuery = supabase
      .from('hittrax_sessions')
      .select('id, created_at')
      .eq('athlete_id', id);

    if (startDate) {
      hittraxQuery = hittraxQuery.gte('created_at', startDate);
    }

    const { data: hittraxSessions } = await hittraxQuery;

    let avgBatSpeed: number | null = null;
    let maxBatSpeed: number | null = null;
    let avgExitVelo: number | null = null;
    let maxExitVelo: number | null = null;
    let avgLaunchAngle: number | null = null;

    if (blastSwings && blastSwings.length > 0) {
      const batSpeeds = blastSwings.map(s => s.bat_speed).filter((v): v is number => v !== null && v > 0);
      if (batSpeeds.length > 0) {
        avgBatSpeed = batSpeeds.reduce((sum, v) => sum + v, 0) / batSpeeds.length;
        maxBatSpeed = Math.max(...batSpeeds);
      }
    }

    if (hittraxSessions && hittraxSessions.length > 0) {
      const sessionIds = hittraxSessions.map(s => s.id);

      const { data: hittraxSwings } = await supabase
        .from('hittrax_swings')
        .select('exit_velocity, launch_angle')
        .in('session_id', sessionIds)
        .not('exit_velocity', 'is', null)
        .gt('exit_velocity', 0);

      if (hittraxSwings && hittraxSwings.length > 0) {
        const exitVelos = hittraxSwings.map(s => s.exit_velocity).filter((v): v is number => v !== null && v > 0);
        const launchAngles = hittraxSwings
          .map(s => typeof s.launch_angle === 'string' ? parseFloat(s.launch_angle) : s.launch_angle)
          .filter((v): v is number => v !== null && !isNaN(v));

        if (exitVelos.length > 0) {
          avgExitVelo = exitVelos.reduce((sum, v) => sum + v, 0) / exitVelos.length;
          maxExitVelo = Math.max(...exitVelos);
        }
        if (launchAngles.length > 0) {
          avgLaunchAngle = launchAngles.reduce((sum, v) => sum + v, 0) / launchAngles.length;
        }
      }
    }

    setAthleteData({
      avgBatSpeed,
      avgLaunchAngle,
      avgExitVelo,
      maxBatSpeed,
      maxExitVelo,
      level: levelFilter,
    });
    setLoading(false);
  }

  // Parse HitTrax timestamp (handles multiple formats)
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
  function parseBlastTimestamp(blast: { created_at_utc?: string; recorded_date: string; recorded_time?: string }): number {
    if (blast.created_at_utc) {
      return new Date(blast.created_at_utc).getTime();
    }
    const [year, month, day] = blast.recorded_date.split('-').map(Number);
    const [hours, minutes, seconds] = (blast.recorded_time || '00:00:00').split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes, seconds).getTime();
  }

  async function fetchSquaredUpData(id: string) {
    setSquaredUpLoading(true);
    try {
      const startDateObj = getDateRange();
      const startDate = startDateObj ? startDateObj.toISOString().split('T')[0] : null;

      // Fetch blast swings with ALL timestamp fields needed for proper parsing
      const { data: blastSwings } = await supabase
        .from('blast_swings')
        .select('id, bat_speed, recorded_date, recorded_time, created_at_utc')
        .eq('athlete_id', id)
        .not('bat_speed', 'is', null)
        .gt('bat_speed', 0)
        .order('recorded_date', { ascending: true });

      // Fetch hittrax sessions with session_date for proper date matching
      const { data: hittraxSessions } = await supabase
        .from('hittrax_sessions')
        .select('id, session_date')
        .eq('athlete_id', id);

      if (!blastSwings || blastSwings.length === 0 || !hittraxSessions || hittraxSessions.length === 0) {
        setSquaredUpData([]);
        setSquaredUpLoading(false);
        return;
      }

      const sessionIds = hittraxSessions.map(s => s.id);

      // Fetch hittrax swings with all needed fields
      const { data: hittraxSwings } = await supabase
        .from('hittrax_swings')
        .select('id, exit_velocity, pitch_velocity, session_id, swing_timestamp')
        .in('session_id', sessionIds)
        .not('exit_velocity', 'is', null)
        .gt('exit_velocity', 0);

      if (!hittraxSwings || hittraxSwings.length === 0) {
        setSquaredUpData([]);
        setSquaredUpLoading(false);
        return;
      }

      // Create session date map using LOCAL date from session_date
      const sessionDateMap: { [key: string]: string } = {};
      for (const session of hittraxSessions) {
        const sessionTimestamp = new Date(session.session_date);
        const localYear = sessionTimestamp.getFullYear();
        const localMonth = String(sessionTimestamp.getMonth() + 1).padStart(2, '0');
        const localDay = String(sessionTimestamp.getDate()).padStart(2, '0');
        sessionDateMap[session.id] = `${localYear}-${localMonth}-${localDay}`;
      }

      // Group blast swings by recorded_date
      const blastByDate: { [key: string]: typeof blastSwings } = {};
      for (const swing of blastSwings) {
        const date = swing.recorded_date;
        if (!blastByDate[date]) blastByDate[date] = [];
        blastByDate[date].push(swing);
      }

      // Group hittrax swings by session date
      const hittraxByDate: { [key: string]: typeof hittraxSwings } = {};
      for (const swing of hittraxSwings) {
        const date = sessionDateMap[swing.session_id];
        if (!date) continue;
        if (!hittraxByDate[date]) hittraxByDate[date] = [];
        hittraxByDate[date].push(swing);
      }

      // Calculate squared up rate for each date with paired data
      const dataPoints: SquaredUpDataPoint[] = [];
      const allDates = new Set([...Object.keys(blastByDate), ...Object.keys(hittraxByDate)]);

      for (const date of allDates) {
        if (startDate && date < startDate) continue;

        const blastOnDate = blastByDate[date] || [];
        const hittraxOnDate = hittraxByDate[date] || [];

        if (blastOnDate.length === 0 || hittraxOnDate.length === 0) continue;

        // Match swings using 7-second window (same as HittingSessionScreen)
        const maxTimeDiff = 7; // seconds
        let totalPairedSwings = 0;
        let squaredUpCount = 0;
        const matchedHittraxIds = new Set<string>();

        for (const blast of blastOnDate) {
          const blastTime = parseBlastTimestamp(blast);
          let closestHittrax: typeof hittraxOnDate[0] | null = null;
          let minDiff = Infinity;

          for (const hittrax of hittraxOnDate) {
            if (matchedHittraxIds.has(hittrax.id)) continue;
            const hittraxTime = parseHitTraxTimestamp(hittrax.swing_timestamp);
            const diff = Math.abs(blastTime - hittraxTime) / 1000; // convert to seconds

            if (diff <= maxTimeDiff && diff < minDiff) {
              minDiff = diff;
              closestHittrax = hittrax;
            }
          }

          if (closestHittrax) {
            matchedHittraxIds.add(closestHittrax.id);

            const batSpeed = blast.bat_speed;
            const actualExitVelo = closestHittrax.exit_velocity;
            const pitchSpeed = closestHittrax.pitch_velocity && closestHittrax.pitch_velocity > 0
              ? closestHittrax.pitch_velocity
              : 75;

            const maxPotentialEV = calculateExitVelocity(batSpeed, pitchSpeed);
            const efficiency = (actualExitVelo / maxPotentialEV) * 100;

            totalPairedSwings++;
            if (efficiency >= SQUARED_UP_THRESHOLD) {
              squaredUpCount++;
            }
          }
        }

        if (totalPairedSwings > 0) {
          dataPoints.push({
            date,
            squaredUpRate: (squaredUpCount / totalPairedSwings) * 100,
            totalPairedSwings,
            squaredUpCount,
          });
        }
      }

      dataPoints.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setSquaredUpData(dataPoints);
    } catch (error) {
      console.error('Error fetching squared up data:', error);
    } finally {
      setSquaredUpLoading(false);
    }
  }

  const pitchSpeedCohorts = useMemo(() => getPitchSpeedCohorts(levelFilter), [levelFilter]);

  const trajectoryData = useMemo(() => {
    if (!athleteData?.avgBatSpeed || !athleteData?.avgLaunchAngle) return null;

    const batSpeed = athleteData.avgBatSpeed;
    const launchAngle = athleteData.avgLaunchAngle;

    return pitchSpeedCohorts.map(pitchSpeed => {
      const exitVelo = calculateExitVelocity(batSpeed, pitchSpeed);
      const maxDistance = calculateMaxDistance(exitVelo, launchAngle);
      const trajectory = generateTrajectoryPoints(exitVelo, launchAngle, maxDistance + 50);

      return {
        pitchSpeed,
        exitVelo,
        maxDistance,
        trajectory,
      };
    });
  }, [athleteData, pitchSpeedCohorts]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={20} color={COLORS.gray400} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Paired Data Trends</Text>
          <Text style={styles.subtitle}>
            Analyze relationships between Blast Motion and HitTrax data
          </Text>
        </View>

        {/* Time Filter Buttons */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterContainer}
          contentContainerStyle={styles.filterContent}
        >
          {(['1month', '3months', '6months', 'all'] as TimeFilter[]).map((filter) => (
            <TouchableOpacity
              key={filter}
              onPress={() => setTimeFilter(filter)}
              style={[
                styles.filterButton,
                timeFilter === filter && styles.filterButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.filterButtonText,
                  timeFilter === filter && styles.filterButtonTextActive,
                ]}
              >
                {filter === '1month' ? '1 Month' :
                 filter === '3months' ? '3 Months' :
                 filter === '6months' ? '6 Months' : 'All Time'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Max Distance Potential Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Max Distance Potential</Text>
          <Text style={styles.sectionSubtitle}>
            Projected max distance based on bat speed ({athleteData?.avgBatSpeed?.toFixed(0) || '--'} mph) + pitch speed at {athleteData?.avgLaunchAngle?.toFixed(0) || '--'}° launch angle
          </Text>

          {trajectoryData ? (
            <>
              {/* Distance Cards */}
              <View style={styles.distanceCards}>
                {trajectoryData.map((data, index) => {
                  const isSelected = selectedPitchSpeed === data.pitchSpeed;
                  const colors = [COLORS.primary, COLORS.primaryDark, '#67E8F9'];
                  const color = isSelected ? COLORS.cyan400 : colors[index % colors.length];

                  return (
                    <TouchableOpacity
                      key={data.pitchSpeed}
                      onPress={() => setSelectedPitchSpeed(isSelected ? null : data.pitchSpeed)}
                      style={[
                        styles.distanceCard,
                        isSelected && styles.distanceCardSelected,
                      ]}
                    >
                      <Text style={styles.distanceCardPitch}>{data.pitchSpeed} mph pitch</Text>
                      <Text style={[styles.distanceCardValue, { color }]}>
                        {Math.round(data.maxDistance)} ft
                      </Text>
                      <Text style={styles.distanceCardEV}>
                        EV: {data.exitVelo.toFixed(0)} mph
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Trajectory Chart */}
              <MaxDistanceChart
                trajectoryData={trajectoryData}
                selectedPitchSpeed={selectedPitchSpeed}
                onSelectPitchSpeed={setSelectedPitchSpeed}
              />
            </>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Need bat speed and launch angle data</Text>
            </View>
          )}
        </View>

        {/* Squared Up Rate Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Squared Up Rate</Text>
          <Text style={styles.sectionSubtitle}>
            Contact quality over time — % of swings achieving ≥{SQUARED_UP_THRESHOLD}% of max potential exit velo
          </Text>

          {squaredUpLoading ? (
            <View style={styles.chartLoading}>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          ) : squaredUpData.length > 0 ? (
            <SquaredUpChart data={squaredUpData} />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No paired session data available</Text>
              <Text style={styles.emptySubtext}>Complete sessions with both Blast Motion and HitTrax</Text>
            </View>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating Back Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.goBack()}
      >
        <LinearGradient
          colors={[COLORS.primary, COLORS.primaryDark]}
          style={styles.fabGradient}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.black} />
        </LinearGradient>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// Max Distance Chart Component
function MaxDistanceChart({
  trajectoryData,
  selectedPitchSpeed,
  onSelectPitchSpeed,
}: {
  trajectoryData: TrajectoryData[];
  selectedPitchSpeed: number | null;
  onSelectPitchSpeed: (speed: number | null) => void;
}) {
  const chartWidth = SCREEN_WIDTH - 32;
  const chartHeight = 220;
  const padding = { top: 20, right: 30, bottom: 50, left: 50 };

  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const maxDistance = Math.max(...trajectoryData.map(d => d.maxDistance)) * 1.08;
  const maxHeight = Math.max(...trajectoryData.flatMap(d => d.trajectory.map(p => p.y))) * 1.05;

  const xScale = (x: number) => padding.left + (x / maxDistance) * innerWidth;
  const yScale = (y: number) => chartHeight - padding.bottom - (y / maxHeight) * innerHeight;

  const generatePath = (trajectory: { x: number; y: number }[]): string => {
    if (trajectory.length === 0) return '';
    const points = trajectory.map(p => `${xScale(p.x)},${yScale(p.y)}`);
    return `M ${points.join(' L ')}`;
  };

  const getColor = (index: number, isSelected: boolean): string => {
    if (isSelected) return COLORS.cyan400;
    const colors = [COLORS.primary, COLORS.primaryDark, '#67E8F9'];
    return colors[index % colors.length];
  };

  return (
    <View style={styles.chartContainer}>
      <Svg width={chartWidth} height={chartHeight}>
        {/* Grid lines */}
        {[0, 0.5, 1].map(pct => (
          <G key={`grid-${pct}`}>
            <Line
              x1={padding.left}
              y1={yScale(maxHeight * pct)}
              x2={chartWidth - padding.right}
              y2={yScale(maxHeight * pct)}
              stroke="rgba(255,255,255,0.1)"
              strokeDasharray="4,4"
            />
            <SvgText
              x={padding.left - 8}
              y={yScale(maxHeight * pct) + 4}
              textAnchor="end"
              fontSize={10}
              fill={COLORS.gray500}
            >
              {Math.round(maxHeight * pct)}ft
            </SvgText>
          </G>
        ))}

        {/* X-axis markers */}
        {[0, 0.5, 1].map(pct => (
          <G key={`x-${pct}`}>
            <Line
              x1={xScale(maxDistance * pct)}
              y1={yScale(0)}
              x2={xScale(maxDistance * pct)}
              y2={yScale(0) + 5}
              stroke="rgba(255,255,255,0.3)"
            />
            <SvgText
              x={xScale(maxDistance * pct)}
              y={chartHeight - padding.bottom + 20}
              textAnchor="middle"
              fontSize={10}
              fill={COLORS.gray500}
            >
              {Math.round(maxDistance * pct)}ft
            </SvgText>
          </G>
        ))}

        {/* Ground line */}
        <Line
          x1={padding.left}
          y1={yScale(0)}
          x2={chartWidth - padding.right}
          y2={yScale(0)}
          stroke="rgba(255,255,255,0.4)"
          strokeWidth={2}
        />

        {/* Trajectory paths */}
        {trajectoryData.map((data, index) => {
          const isSelected = selectedPitchSpeed === data.pitchSpeed;
          const isHighlighted = selectedPitchSpeed === null || isSelected;
          const color = getColor(index, isSelected);

          return (
            <G key={data.pitchSpeed}>
              {/* Glow effect for selected */}
              {isSelected && (
                <Path
                  d={generatePath(data.trajectory)}
                  fill="none"
                  stroke={color}
                  strokeWidth={8}
                  opacity={0.2}
                  strokeLinecap="round"
                />
              )}

              {/* Main trajectory path */}
              <Path
                d={generatePath(data.trajectory)}
                fill="none"
                stroke={color}
                strokeWidth={isSelected ? 3 : 2}
                strokeDasharray={isSelected ? '' : '6,4'}
                opacity={isHighlighted ? 1 : 0.25}
                strokeLinecap="round"
              />

              {/* Landing point */}
              {isHighlighted && (
                <G>
                  <Circle
                    cx={xScale(data.maxDistance)}
                    cy={yScale(0)}
                    r={isSelected ? 8 : 6}
                    fill={color}
                  />
                  <SvgText
                    x={xScale(data.maxDistance)}
                    y={yScale(0) - 12}
                    textAnchor="middle"
                    fontSize={10}
                    fill={color}
                    fontWeight="bold"
                  >
                    {Math.round(data.maxDistance)} ft
                  </SvgText>
                </G>
              )}
            </G>
          );
        })}

        {/* Axis labels */}
        <SvgText
          x={chartWidth / 2}
          y={chartHeight - 8}
          textAnchor="middle"
          fontSize={11}
          fill={COLORS.gray500}
        >
          Distance
        </SvgText>
      </Svg>

      {/* Touch targets for trajectory selection */}
      {trajectoryData.map((data, index) => {
        const isHighlighted = selectedPitchSpeed === null || selectedPitchSpeed === data.pitchSpeed;
        if (!isHighlighted) return null;
        return (
          <TouchableOpacity
            key={`touch-${data.pitchSpeed}`}
            style={[
              styles.touchTarget,
              {
                left: xScale(data.maxDistance) - 20,
                top: yScale(0) - 20,
              },
            ]}
            onPress={() => onSelectPitchSpeed(selectedPitchSpeed === data.pitchSpeed ? null : data.pitchSpeed)}
          />
        );
      })}

      {/* Legend */}
      <View style={styles.legend}>
        {trajectoryData.map((data, index) => {
          const isSelected = selectedPitchSpeed === data.pitchSpeed;
          const color = getColor(index, isSelected);
          return (
            <TouchableOpacity
              key={data.pitchSpeed}
              onPress={() => onSelectPitchSpeed(isSelected ? null : data.pitchSpeed)}
              style={[
                styles.legendButton,
                isSelected && styles.legendButtonActive,
              ]}
            >
              <View style={[styles.legendLine, { backgroundColor: isSelected ? COLORS.white : color }]} />
              <Text style={[styles.legendText, isSelected && styles.legendTextActive]}>
                {data.pitchSpeed} mph
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// Squared Up Rate Chart Component
function SquaredUpChart({ data }: { data: SquaredUpDataPoint[] }) {
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);

  const chartWidth = SCREEN_WIDTH - 32;
  const chartHeight = 200;
  const padding = { top: 20, right: 20, bottom: 40, left: 45 };

  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Summary stats
  const avgSquaredUpRate = data.length > 0
    ? data.reduce((sum, d) => sum + d.squaredUpRate, 0) / data.length
    : 0;
  const totalSwings = data.reduce((sum, d) => sum + d.totalPairedSwings, 0);
  const totalSquaredUp = data.reduce((sum, d) => sum + d.squaredUpCount, 0);

  const maxRate = Math.max(100, ...data.map(d => d.squaredUpRate));
  const minRate = 0;

  const xScale = (index: number) => padding.left + (index / Math.max(data.length - 1, 1)) * innerWidth;
  const yScale = (rate: number) => chartHeight - padding.bottom - ((rate - minRate) / (maxRate - minRate)) * innerHeight;

  const generateLinePath = (): string => {
    if (data.length === 0) return '';
    if (data.length === 1) {
      return `M ${xScale(0)},${yScale(data[0].squaredUpRate)}`;
    }
    const points = data.map((d, i) => `${xScale(i)},${yScale(d.squaredUpRate)}`);
    return `M ${points.join(' L ')}`;
  };

  const generateAreaPath = (): string => {
    if (data.length === 0) return '';
    const linePoints = data.map((d, i) => `${xScale(i)},${yScale(d.squaredUpRate)}`);
    const bottomY = chartHeight - padding.bottom;
    return `M ${padding.left},${bottomY} L ${linePoints.join(' L ')} L ${xScale(data.length - 1)},${bottomY} Z`;
  };

  const formatDate = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getXAxisLabels = (): { index: number; label: string }[] => {
    if (data.length <= 5) {
      return data.map((d, i) => ({ index: i, label: formatDate(d.date) }));
    }
    const labels: { index: number; label: string }[] = [];
    const step = Math.floor(data.length / 4);
    for (let i = 0; i < data.length; i += step) {
      labels.push({ index: i, label: formatDate(data[i].date) });
    }
    if (labels[labels.length - 1].index !== data.length - 1) {
      labels.push({ index: data.length - 1, label: formatDate(data[data.length - 1].date) });
    }
    return labels;
  };

  return (
    <View>
      {/* Summary Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Average Rate</Text>
          <Text style={styles.statValue}>{avgSquaredUpRate.toFixed(1)}%</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total Squared Up</Text>
          <Text style={styles.statValueWhite}>{totalSquaredUp}/{totalSwings}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Sessions</Text>
          <Text style={styles.statValueWhite}>{data.length}</Text>
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartContainer}>
        <Svg width={chartWidth} height={chartHeight}>
          <Defs>
            <SvgLinearGradient id="squaredUpGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={COLORS.cyan400} stopOpacity="0.3" />
              <Stop offset="100%" stopColor={COLORS.cyan400} stopOpacity="0" />
            </SvgLinearGradient>
          </Defs>

          {/* Horizontal grid lines */}
          {[0, 25, 50, 75, 100].map(rate => (
            <G key={rate}>
              <Line
                x1={padding.left}
                y1={yScale(rate)}
                x2={chartWidth - padding.right}
                y2={yScale(rate)}
                stroke="rgba(255,255,255,0.1)"
                strokeDasharray="4,4"
              />
              <SvgText
                x={padding.left - 8}
                y={yScale(rate) + 4}
                textAnchor="end"
                fontSize={10}
                fill={COLORS.gray500}
              >
                {rate}%
              </SvgText>
            </G>
          ))}

          {/* X-axis labels */}
          {getXAxisLabels().map(({ index, label }) => (
            <SvgText
              key={index}
              x={xScale(index)}
              y={chartHeight - padding.bottom + 20}
              textAnchor="middle"
              fontSize={10}
              fill={COLORS.gray500}
            >
              {label}
            </SvgText>
          ))}

          {/* Area fill */}
          <Path d={generateAreaPath()} fill="url(#squaredUpGradient)" />

          {/* Line */}
          <Path
            d={generateLinePath()}
            fill="none"
            stroke={COLORS.cyan400}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data points */}
          {data.map((d, i) => (
            <Circle
              key={i}
              cx={xScale(i)}
              cy={yScale(d.squaredUpRate)}
              r={selectedPoint === i ? 6 : 4}
              fill={selectedPoint === i ? COLORS.cyan400 : '#1E3A5F'}
              stroke={COLORS.cyan400}
              strokeWidth={2}
            />
          ))}

          {/* Tooltip */}
          {selectedPoint !== null && data[selectedPoint] && (
            <G>
              <Line
                x1={xScale(selectedPoint)}
                y1={padding.top}
                x2={xScale(selectedPoint)}
                y2={chartHeight - padding.bottom}
                stroke="rgba(34, 211, 238, 0.3)"
                strokeDasharray="4,4"
              />
              <Rect
                x={Math.min(xScale(selectedPoint), chartWidth - 90) - 40}
                y={Math.max(yScale(data[selectedPoint].squaredUpRate) - 55, padding.top)}
                width={80}
                height={50}
                fill="rgba(0,0,0,0.9)"
                stroke="rgba(34, 211, 238, 0.5)"
                strokeWidth={1}
                rx={4}
              />
              <SvgText
                x={Math.min(xScale(selectedPoint), chartWidth - 90)}
                y={Math.max(yScale(data[selectedPoint].squaredUpRate) - 55, padding.top) + 15}
                textAnchor="middle"
                fontSize={12}
                fill={COLORS.cyan400}
                fontWeight="bold"
              >
                {data[selectedPoint].squaredUpRate.toFixed(1)}%
              </SvgText>
              <SvgText
                x={Math.min(xScale(selectedPoint), chartWidth - 90)}
                y={Math.max(yScale(data[selectedPoint].squaredUpRate) - 55, padding.top) + 30}
                textAnchor="middle"
                fontSize={10}
                fill="rgba(255,255,255,0.7)"
              >
                {data[selectedPoint].squaredUpCount}/{data[selectedPoint].totalPairedSwings} swings
              </SvgText>
              <SvgText
                x={Math.min(xScale(selectedPoint), chartWidth - 90)}
                y={Math.max(yScale(data[selectedPoint].squaredUpRate) - 55, padding.top) + 43}
                textAnchor="middle"
                fontSize={9}
                fill="rgba(255,255,255,0.5)"
              >
                {formatDate(data[selectedPoint].date)}
              </SvgText>
            </G>
          )}
        </Svg>

        {/* Touch targets */}
        {data.map((_, i) => (
          <TouchableOpacity
            key={i}
            style={[
              styles.touchTarget,
              {
                left: xScale(i) - 15,
                top: yScale(data[i].squaredUpRate) - 15,
              },
            ]}
            onPress={() => setSelectedPoint(selectedPoint === i ? null : i)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.black,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    paddingTop: 8,
    marginBottom: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backText: {
    color: COLORS.gray400,
    fontSize: 14,
    marginLeft: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.gray400,
  },
  filterContainer: {
    marginBottom: 20,
  },
  filterContent: {
    gap: 8,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  filterButtonActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.15)',
    borderColor: 'rgba(155, 221, 255, 0.3)',
  },
  filterButtonText: {
    color: COLORS.gray400,
    fontSize: 14,
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: COLORS.primary,
  },
  section: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.gray500,
    marginBottom: 16,
  },
  distanceCards: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  distanceCard: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  distanceCardSelected: {
    borderColor: COLORS.cyan400,
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
  },
  distanceCardPitch: {
    fontSize: 11,
    color: COLORS.gray400,
    marginBottom: 4,
  },
  distanceCardValue: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  distanceCardEV: {
    fontSize: 10,
    color: COLORS.gray500,
  },
  chartContainer: {
    position: 'relative',
  },
  chartLoading: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  legendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  legendButtonActive: {
    backgroundColor: COLORS.cyan500,
  },
  legendLine: {
    width: 12,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 12,
    color: COLORS.gray400,
    fontWeight: '500',
  },
  legendTextActive: {
    color: COLORS.white,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.gray700,
    borderRadius: 12,
  },
  emptyText: {
    color: COLORS.gray400,
    fontSize: 14,
  },
  emptySubtext: {
    color: COLORS.gray500,
    fontSize: 12,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  statLabel: {
    fontSize: 10,
    color: COLORS.gray400,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.cyan400,
  },
  statValueWhite: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  touchTarget: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
