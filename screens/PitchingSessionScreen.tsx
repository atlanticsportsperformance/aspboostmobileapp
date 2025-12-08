import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Rect,
  Circle,
  Line,
  Text as SvgText,
  G,
  Defs,
  RadialGradient,
  Stop,
  Path,
} from 'react-native-svg';
import { Video, ResizeMode } from 'expo-av';
import { supabase } from '../lib/supabase';

const { width: screenWidth } = Dimensions.get('window');

// Color theme matching HittingPerformanceScreen / PitchingScreen
const COLORS = {
  primary: '#9BDDFF',
  primaryDark: '#7BC5F0',
  secondary: '#F5F0E6',
  gold: '#D4AF37',
  white: '#FFFFFF',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  black: '#000000',
  cyan400: '#22D3EE',
  red400: '#F87171',
  red500: '#EF4444',
  green400: '#4ADE80',
  green500: '#10B981',
  purple400: '#C084FC',
  purple500: '#A855F7',
  yellow400: '#FACC15',
  yellow500: '#EAB308',
  amber400: '#FBBF24',
  amber500: '#F59E0B',
  lime500: '#84CC16',
  blue500: '#3B82F6',
  brown: '#92400E',
};

interface TrackManPitch {
  id: number;
  pitch_uid: string;
  pitch_no: number | null;
  rel_speed: number;
  spin_rate: number | null;
  plate_loc_height: number | null;
  plate_loc_side: number | null;
  created_at: string;
  tagged_pitch_type: string | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  spin_axis: number | null;
  tilt: string | null;
  measured_tilt: string | null;
  vert_break: number | null;
  induced_vert_break: number | null;
  horz_break: number | null;
  vert_appr_angle: number | null;
  spin_axis_3d_spin_efficiency: number | null;
  video_url: string | null;
  stuff_plus?: {
    stuff_plus: number;
    whiff_probability: number;
    pitch_type_group: string;
  } | null;
}

interface SessionInfo {
  id: number;
  game_date_utc: string;
  venue_name: string | null;
}

export default function PitchingSessionScreen({ navigation, route }: any) {
  const { sessionId, athleteId: passedAthleteId } = route.params;

  const [pitches, setPitches] = useState<TrackManPitch[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(passedAthleteId || null);
  const [totalPitchCount, setTotalPitchCount] = useState(0);
  const [movementView, setMovementView] = useState<'individual' | 'heatmap'>('individual');

  // Tooltip states for each chart
  const [selectedLocationPitch, setSelectedLocationPitch] = useState<TrackManPitch | null>(null);
  const [selectedStuffPitch, setSelectedStuffPitch] = useState<TrackManPitch | null>(null);
  const [selectedVeloPitch, setSelectedVeloPitch] = useState<TrackManPitch | null>(null);
  const [selectedMovementPitch, setSelectedMovementPitch] = useState<TrackManPitch | null>(null);
  const [selectedReleasePitch, setSelectedReleasePitch] = useState<TrackManPitch | null>(null);

  // Video modal state
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<Video>(null);

  // Strike zone dimensions (feet)
  const STRIKE_ZONE_BOTTOM_INSIDE = 1.5;
  const STRIKE_ZONE_TOP_INSIDE = 3.5;
  const STRIKE_ZONE_HALF_WIDTH_INSIDE = 8.5 / 12; // ±8.5 inches = 0.708 ft
  const BASEBALL_RADIUS = 1.45 / 12; // ~1.45 inches = 0.121 ft

  // Outside edges (with ball radius)
  const STRIKE_ZONE_BOTTOM_OUTSIDE = STRIKE_ZONE_BOTTOM_INSIDE - BASEBALL_RADIUS;
  const STRIKE_ZONE_TOP_OUTSIDE = STRIKE_ZONE_TOP_INSIDE + BASEBALL_RADIUS;
  const STRIKE_ZONE_HALF_WIDTH_OUTSIDE = STRIKE_ZONE_HALF_WIDTH_INSIDE + BASEBALL_RADIUS;

  // Display range for SVG
  const X_MIN = -2;
  const X_MAX = 2;
  const Y_MIN = 0;
  const Y_MAX = 4;

  // SVG dimensions
  const chartWidth = screenWidth - 32;
  const chartHeight = chartWidth; // Square

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
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchSessionData(id: string) {
    // Get session info
    const { data: session } = await supabase
      .from('trackman_session')
      .select('*')
      .eq('id', sessionId)
      .single();

    setSessionInfo(session);

    // Get all pitches for this session
    const { data: pitchesData } = await supabase
      .from('trackman_pitch_data')
      .select(`
        id, pitch_uid, rel_speed, spin_rate, plate_loc_height, plate_loc_side, created_at,
        tagged_pitch_type, pitch_no,
        rel_height, rel_side, extension, spin_axis, tilt, measured_tilt, vert_break, induced_vert_break,
        horz_break, vert_appr_angle, spin_axis_3d_spin_efficiency, video_url,
        stuff_plus:pitch_stuff_plus(stuff_plus, whiff_probability, pitch_type_group)
      `)
      .eq('session_id', sessionId)
      .eq('athlete_id', id)
      .order('pitch_no', { ascending: true });

    if (pitchesData && pitchesData.length > 0) {
      setTotalPitchCount(pitchesData.length);

      // Filter for pitches WITH location data for display
      const validPitches = pitchesData
        .filter((p: any) => p.plate_loc_side !== null && p.plate_loc_height !== null)
        .map((p: any) => ({
          id: p.id,
          pitch_uid: p.pitch_uid,
          pitch_no: p.pitch_no ? parseInt(p.pitch_no.toString()) : null,
          rel_speed: parseFloat(p.rel_speed || '0'),
          spin_rate: p.spin_rate ? parseFloat(p.spin_rate.toString()) : null,
          plate_loc_height: parseFloat(p.plate_loc_height.toString()),
          plate_loc_side: parseFloat(p.plate_loc_side.toString()),
          created_at: p.created_at,
          tagged_pitch_type: p.tagged_pitch_type,
          rel_height: p.rel_height ? parseFloat(p.rel_height.toString()) : null,
          rel_side: p.rel_side ? parseFloat(p.rel_side.toString()) : null,
          extension: p.extension ? parseFloat(p.extension.toString()) : null,
          spin_axis: p.spin_axis ? parseFloat(p.spin_axis.toString()) : null,
          tilt: p.tilt || null,
          measured_tilt: p.measured_tilt || null,
          vert_break: p.vert_break ? parseFloat(p.vert_break.toString()) : null,
          induced_vert_break: p.induced_vert_break ? parseFloat(p.induced_vert_break.toString()) : null,
          horz_break: p.horz_break ? parseFloat(p.horz_break.toString()) : null,
          vert_appr_angle: p.vert_appr_angle ? parseFloat(p.vert_appr_angle.toString()) : null,
          spin_axis_3d_spin_efficiency: p.spin_axis_3d_spin_efficiency ? parseFloat(p.spin_axis_3d_spin_efficiency.toString()) : null,
          video_url: p.video_url || null,
          stuff_plus: (Array.isArray(p.stuff_plus) && p.stuff_plus.length > 0
            ? p.stuff_plus[0]
            : (p.stuff_plus || null)) as { stuff_plus: number; whiff_probability: number; pitch_type_group: string; } | null,
        }));

      setPitches(validPitches);
    } else {
      setTotalPitchCount(0);
      setPitches([]);
    }
  }

  // Get pitch type color
  function getPitchTypeColor(pitchType: string | null | undefined): string {
    if (!pitchType || pitchType === 'Undefined' || pitchType === 'undefined') return COLORS.gray500;

    const type = pitchType.toUpperCase();

    if (type.includes('FASTBALL') || type === 'FF' || type === 'FA') return COLORS.red500;
    if (type.includes('SINKER') || type === 'SI' || type === 'FT') return '#DC2626';
    if (type.includes('CUTTER') || type === 'FC') return COLORS.brown;
    if (type.includes('CURVEBALL') || type === 'CU' || type === 'CB') return COLORS.blue500;
    if (type.includes('SLIDER') || type === 'SL') return COLORS.yellow500;
    if (type.includes('SWEEPER')) return COLORS.amber500;
    if (type.includes('SLURVE') || type === 'SV') return COLORS.purple500;
    if (type.includes('CHANGEUP') || type === 'CH') return COLORS.green500;
    if (type.includes('SPLITTER') || type === 'FS') return COLORS.purple500;
    if (type.includes('KNUCKLEBALL') || type === 'KN') return COLORS.amber500;

    return COLORS.gray500;
  }

  // Get Stuff+ grade color
  function getStuffPlusColor(stuffPlus: number): string {
    if (stuffPlus >= 120) return COLORS.green500;
    if (stuffPlus >= 110) return COLORS.lime500;
    if (stuffPlus >= 90) return COLORS.yellow500;
    if (stuffPlus >= 80) return COLORS.amber500;
    return COLORS.red500;
  }

  // Convert feet to pixel coordinates for location chart
  function feetToPixel(x: number, y: number): { x: number; y: number } {
    const pixelX = ((x - X_MIN) / (X_MAX - X_MIN)) * chartWidth;
    const pixelY = ((Y_MAX - y) / (Y_MAX - Y_MIN)) * chartHeight;
    return { x: pixelX, y: pixelY };
  }

  // Strike zone pixel coordinates
  const strikeZonePixelsInside = useMemo(() => ({
    topLeft: feetToPixel(-STRIKE_ZONE_HALF_WIDTH_INSIDE, STRIKE_ZONE_TOP_INSIDE),
    topRight: feetToPixel(STRIKE_ZONE_HALF_WIDTH_INSIDE, STRIKE_ZONE_TOP_INSIDE),
    bottomLeft: feetToPixel(-STRIKE_ZONE_HALF_WIDTH_INSIDE, STRIKE_ZONE_BOTTOM_INSIDE),
    bottomRight: feetToPixel(STRIKE_ZONE_HALF_WIDTH_INSIDE, STRIKE_ZONE_BOTTOM_INSIDE),
  }), [chartWidth]);

  const strikeZonePixelsOutside = useMemo(() => ({
    topLeft: feetToPixel(-STRIKE_ZONE_HALF_WIDTH_OUTSIDE, STRIKE_ZONE_TOP_OUTSIDE),
    topRight: feetToPixel(STRIKE_ZONE_HALF_WIDTH_OUTSIDE, STRIKE_ZONE_TOP_OUTSIDE),
    bottomLeft: feetToPixel(-STRIKE_ZONE_HALF_WIDTH_OUTSIDE, STRIKE_ZONE_BOTTOM_OUTSIDE),
    bottomRight: feetToPixel(STRIKE_ZONE_HALF_WIDTH_OUTSIDE, STRIKE_ZONE_BOTTOM_OUTSIDE),
  }), [chartWidth]);

  // Calculate strike percentage
  const strikePitches = useMemo(() => pitches.filter(p => {
    const x = p.plate_loc_side!;
    const y = p.plate_loc_height!;

    return (
      x >= -STRIKE_ZONE_HALF_WIDTH_OUTSIDE &&
      x <= STRIKE_ZONE_HALF_WIDTH_OUTSIDE &&
      y >= STRIKE_ZONE_BOTTOM_OUTSIDE &&
      y <= STRIKE_ZONE_TOP_OUTSIDE
    );
  }), [pitches]);

  const strikePercentage = totalPitchCount > 0
    ? Math.round((strikePitches.length / totalPitchCount) * 100)
    : 0;

  // Calculate pitch type stats
  const pitchTypeStats = useMemo(() => {
    return pitches.reduce((acc, pitch) => {
      const type = pitch.tagged_pitch_type || 'Unknown';
      if (!acc[type]) {
        acc[type] = {
          count: 0,
          velocities: [],
          spins: [],
          stuffPlus: []
        };
      }
      acc[type].count++;
      acc[type].velocities.push(pitch.rel_speed);
      if (pitch.spin_rate) acc[type].spins.push(pitch.spin_rate);
      if (pitch.stuff_plus?.stuff_plus) acc[type].stuffPlus.push(pitch.stuff_plus.stuff_plus);
      return acc;
    }, {} as Record<string, { count: number; velocities: number[]; spins: number[]; stuffPlus: number[] }>);
  }, [pitches]);

  // Average Stuff+ by pitch type
  const pitchTypeStuffPlus = useMemo(() => {
    const data = pitches.reduce((acc, pitch) => {
      const type = pitch.tagged_pitch_type || 'Unknown';
      if (pitch.stuff_plus?.stuff_plus) {
        if (!acc[type]) acc[type] = [];
        acc[type].push(pitch.stuff_plus.stuff_plus);
      }
      return acc;
    }, {} as Record<string, number[]>);

    return Object.entries(data)
      .map(([type, values]) => ({
        type,
        avg: values.reduce((sum, v) => sum + v, 0) / values.length,
        count: values.length,
        color: getPitchTypeColor(type)
      }))
      .sort((a, b) => b.avg - a.avg);
  }, [pitches]);

  // Overall avg Stuff+
  const avgStuffPlus = useMemo(() => {
    const stuffPlusValues = pitches
      .filter(p => p.stuff_plus?.stuff_plus)
      .map(p => p.stuff_plus!.stuff_plus);
    if (stuffPlusValues.length === 0) return null;
    return stuffPlusValues.reduce((sum, val) => sum + val, 0) / stuffPlusValues.length;
  }, [pitches]);

  // Pitches with break data for movement chart
  const pitchesWithBreak = useMemo(() => {
    return pitches
      .filter(p => p.horz_break !== null && p.induced_vert_break !== null)
      .map(p => ({
        ...p,
        horz_break_inches: p.horz_break!,
        induced_vert_break_inches: p.induced_vert_break!
      }));
  }, [pitches]);

  // Calculate average break BY PITCH TYPE for heatmap
  const avgBreakByPitchType = useMemo(() => {
    const grouped = pitchesWithBreak.reduce((acc, pitch) => {
      const type = pitch.tagged_pitch_type || 'Unknown';
      if (!acc[type]) {
        acc[type] = { horzSum: 0, vertSum: 0, count: 0 };
      }
      acc[type].horzSum += pitch.horz_break_inches;
      acc[type].vertSum += pitch.induced_vert_break_inches;
      acc[type].count++;
      return acc;
    }, {} as Record<string, { horzSum: number; vertSum: number; count: number }>);

    return Object.entries(grouped).map(([type, data]) => ({
      type,
      avgHorz: data.horzSum / data.count,
      avgVert: data.vertSum / data.count,
      count: data.count,
      color: getPitchTypeColor(type)
    }));
  }, [pitchesWithBreak]);

  // Pitches with release data
  const pitchesWithRelease = useMemo(() => {
    return pitches.filter(p => p.rel_side !== null && p.rel_height !== null);
  }, [pitches]);

  // Pitches with Stuff+
  const pitchesWithStuff = useMemo(() => {
    return pitches.filter(p => p.stuff_plus?.stuff_plus);
  }, [pitches]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Tooltip Modal Component
  const TooltipModal = ({ pitch, onClose, showBreak = false, showRelease = false }: {
    pitch: TrackManPitch | null;
    onClose: () => void;
    showBreak?: boolean;
    showRelease?: boolean;
  }) => {
    if (!pitch) return null;

    const pitchColor = getPitchTypeColor(pitch.tagged_pitch_type);
    const pitchIndex = pitches.findIndex(p => p.id === pitch.id);

    return (
      <Modal
        transparent
        visible={!!pitch}
        animationType="fade"
        onRequestClose={onClose}
      >
        <Pressable style={styles.tooltipOverlay} onPress={onClose}>
          <View style={[styles.tooltipCard, { borderColor: pitchColor }]}>
            <View style={styles.tooltipHeader}>
              <Text style={styles.tooltipTitle}>Pitch #{pitch.pitch_no ?? pitchIndex + 1}</Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={20} color={COLORS.gray400} />
              </TouchableOpacity>
            </View>

            <View style={[styles.tooltipPitchType, { backgroundColor: `${pitchColor}20` }]}>
              <View style={[styles.tooltipPitchDot, { backgroundColor: pitchColor }]} />
              <Text style={[styles.tooltipPitchTypeName, { color: pitchColor }]}>
                {pitch.tagged_pitch_type || 'Unknown'}
              </Text>
            </View>

            <View style={styles.tooltipStatsGrid}>
              <View style={styles.tooltipStatItem}>
                <Text style={styles.tooltipStatLabel}>Velocity</Text>
                <Text style={[styles.tooltipStatValue, { color: COLORS.cyan400 }]}>
                  {pitch.rel_speed.toFixed(1)} mph
                </Text>
              </View>

              {pitch.spin_rate && (
                <View style={styles.tooltipStatItem}>
                  <Text style={styles.tooltipStatLabel}>Spin Rate</Text>
                  <Text style={[styles.tooltipStatValue, { color: COLORS.purple400 }]}>
                    {pitch.spin_rate.toFixed(0)} rpm
                  </Text>
                </View>
              )}

              {pitch.extension !== null && (
                <View style={styles.tooltipStatItem}>
                  <Text style={styles.tooltipStatLabel}>Extension</Text>
                  <Text style={styles.tooltipStatValue}>
                    {pitch.extension.toFixed(1)} ft
                  </Text>
                </View>
              )}

              {pitch.stuff_plus && (
                <View style={styles.tooltipStatItem}>
                  <Text style={styles.tooltipStatLabel}>Stuff+</Text>
                  <Text style={[styles.tooltipStatValue, { color: getStuffPlusColor(pitch.stuff_plus.stuff_plus) }]}>
                    {pitch.stuff_plus.stuff_plus.toFixed(0)}
                  </Text>
                </View>
              )}

              {showBreak && pitch.horz_break !== null && (
                <>
                  <View style={styles.tooltipStatItem}>
                    <Text style={styles.tooltipStatLabel}>Horz Break</Text>
                    <Text style={styles.tooltipStatValue}>
                      {pitch.horz_break.toFixed(1)}"
                    </Text>
                  </View>
                  <View style={styles.tooltipStatItem}>
                    <Text style={styles.tooltipStatLabel}>Vert Break</Text>
                    <Text style={styles.tooltipStatValue}>
                      {pitch.induced_vert_break?.toFixed(1)}"
                    </Text>
                  </View>
                </>
              )}

              {showRelease && pitch.rel_side !== null && (
                <>
                  <View style={styles.tooltipStatItem}>
                    <Text style={styles.tooltipStatLabel}>Rel Side</Text>
                    <Text style={styles.tooltipStatValue}>
                      {pitch.rel_side.toFixed(2)}'
                    </Text>
                  </View>
                  <View style={styles.tooltipStatItem}>
                    <Text style={styles.tooltipStatLabel}>Rel Height</Text>
                    <Text style={styles.tooltipStatValue}>
                      {pitch.rel_height?.toFixed(2)}'
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Video Button */}
            {pitch.video_url && (
              <TouchableOpacity
                style={styles.tooltipVideoButton}
                onPress={() => {
                  onClose();
                  setSelectedVideoUrl(pitch.video_url);
                }}
              >
                <Ionicons name="videocam" size={18} color={COLORS.black} />
                <Text style={styles.tooltipVideoButtonText}>Watch Video</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Modal>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading session data...</Text>
      </View>
    );
  }

  const zoneWidthInside = strikeZonePixelsInside.topRight.x - strikeZonePixelsInside.topLeft.x;
  const zoneHeightInside = strikeZonePixelsInside.bottomLeft.y - strikeZonePixelsInside.topLeft.y;
  const zoneWidthOutside = strikeZonePixelsOutside.topRight.x - strikeZonePixelsOutside.topLeft.x;
  const zoneHeightOutside = strikeZonePixelsOutside.bottomLeft.y - strikeZonePixelsOutside.topLeft.y;

  // Break chart dimensions
  const BREAK_MIN = -30;
  const BREAK_MAX = 30;
  const BREAK_RANGE = BREAK_MAX - BREAK_MIN;
  const breakChartSize = screenWidth - 32;
  const breakMargin = 35;

  function breakToPixel(horz: number, vert: number) {
    const pixelX = breakMargin + ((horz - BREAK_MIN) / BREAK_RANGE) * (breakChartSize - breakMargin * 2);
    const pixelY = breakMargin + ((BREAK_MAX - vert) / BREAK_RANGE) * (breakChartSize - breakMargin * 2);
    return { x: pixelX, y: pixelY };
  }

  // Release chart dimensions
  const REL_X_MIN = -4;
  const REL_X_MAX = 4;
  const REL_Y_MIN = 0;
  const REL_Y_MAX = 8;
  const releaseChartSize = screenWidth - 32;

  function relToPixel(x: number, y: number) {
    const pixelX = ((x - REL_X_MIN) / (REL_X_MAX - REL_X_MIN)) * releaseChartSize;
    const pixelY = ((REL_Y_MAX - y) / (REL_Y_MAX - REL_Y_MIN)) * releaseChartSize;
    return { x: pixelX, y: pixelY };
  }

  // Stuff+ chart dimensions
  const stuffChartWidth = screenWidth - 32;
  const stuffChartHeight = 200;
  const stuffMarginLeft = 40;
  const stuffMarginRight = 10;
  const stuffMarginTop = 15;
  const stuffMarginBottom = 35;
  const stuffPlotWidth = stuffChartWidth - stuffMarginLeft - stuffMarginRight;
  const stuffPlotHeight = stuffChartHeight - stuffMarginTop - stuffMarginBottom;

  // Dynamic Stuff+ range
  const stuffValues = pitchesWithStuff.map(p => p.stuff_plus!.stuff_plus);
  const minDataStuff = stuffValues.length > 0 ? Math.min(...stuffValues) : 80;
  const maxDataStuff = stuffValues.length > 0 ? Math.max(...stuffValues) : 120;
  const minStuff = Math.max(80, Math.floor(minDataStuff / 5) * 5 - 5);
  const maxStuff = Math.min(130, Math.ceil(maxDataStuff / 5) * 5 + 5);
  const stuffRange = maxStuff - minStuff;

  // Velocity chart dimensions
  const veloChartWidth = screenWidth - 32;
  const veloChartHeight = 200;
  const veloMarginLeft = 40;
  const veloMarginRight = 10;
  const veloMarginTop = 15;
  const veloMarginBottom = 35;
  const veloPlotWidth = veloChartWidth - veloMarginLeft - veloMarginRight;
  const veloPlotHeight = veloChartHeight - veloMarginTop - veloMarginBottom;

  const allVelocities = pitches.map(p => p.rel_speed);
  const minVelo = allVelocities.length > 0 ? Math.floor(Math.min(...allVelocities) - 2) : 60;
  const maxVelo = allVelocities.length > 0 ? Math.ceil(Math.max(...allVelocities) + 2) : 100;
  const veloRange = maxVelo - minVelo;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Tooltip Modals */}
      <TooltipModal pitch={selectedLocationPitch} onClose={() => setSelectedLocationPitch(null)} />
      <TooltipModal pitch={selectedStuffPitch} onClose={() => setSelectedStuffPitch(null)} />
      <TooltipModal pitch={selectedVeloPitch} onClose={() => setSelectedVeloPitch(null)} />
      <TooltipModal pitch={selectedMovementPitch} onClose={() => setSelectedMovementPitch(null)} showBreak />
      <TooltipModal pitch={selectedReleasePitch} onClose={() => setSelectedReleasePitch(null)} showRelease />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={20} color={COLORS.gray400} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Session Details</Text>
          <Text style={styles.subtitle}>
            {sessionInfo ? new Date(sessionInfo.game_date_utc).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            }) : ''}
            {sessionInfo?.venue_name ? ` • ${sessionInfo.venue_name}` : ''}
          </Text>
        </View>

        {/* Location Chart */}
        <View style={styles.section}>
          <View style={styles.chartHeader}>
            <View>
              <Text style={styles.chartTitle}>Location Chart ({totalPitchCount} pitches)</Text>
              <Text style={styles.chartDescription}>
                Tap any pitch for details • Catcher's view
              </Text>
            </View>
            <View style={styles.strikePercentBox}>
              <Text style={styles.strikePercentLabel}>Strike %</Text>
              <Text style={styles.strikePercentValue}>{strikePercentage}%</Text>
            </View>
          </View>

          <View style={styles.chartContainer}>
            <Svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
              {/* Strike zone outer border (dashed) */}
              <Rect
                x={strikeZonePixelsOutside.topLeft.x}
                y={strikeZonePixelsOutside.topLeft.y}
                width={zoneWidthOutside}
                height={zoneHeightOutside}
                fill="none"
                stroke={COLORS.white}
                strokeWidth="1"
                strokeDasharray="6 3"
                opacity={0.4}
              />

              {/* Strike zone inner border (solid) */}
              <Rect
                x={strikeZonePixelsInside.topLeft.x}
                y={strikeZonePixelsInside.topLeft.y}
                width={zoneWidthInside}
                height={zoneHeightInside}
                fill="none"
                stroke={COLORS.white}
                strokeWidth="2"
              />

              {/* 9-zone grid lines */}
              {[1, 2].map((i) => (
                <React.Fragment key={`grid-${i}`}>
                  <Line
                    x1={strikeZonePixelsInside.topLeft.x}
                    x2={strikeZonePixelsInside.topRight.x}
                    y1={strikeZonePixelsInside.topLeft.y + (zoneHeightInside / 3) * i}
                    y2={strikeZonePixelsInside.topLeft.y + (zoneHeightInside / 3) * i}
                    stroke={COLORS.white}
                    strokeWidth="1"
                    opacity={0.25}
                  />
                  <Line
                    x1={strikeZonePixelsInside.topLeft.x + (zoneWidthInside / 3) * i}
                    x2={strikeZonePixelsInside.topLeft.x + (zoneWidthInside / 3) * i}
                    y1={strikeZonePixelsInside.topLeft.y}
                    y2={strikeZonePixelsInside.bottomLeft.y}
                    stroke={COLORS.white}
                    strokeWidth="1"
                    opacity={0.25}
                  />
                </React.Fragment>
              ))}

              {/* Plot pitches */}
              {pitches.map((pitch, index) => {
                const pitchPixel = feetToPixel(pitch.plate_loc_side!, pitch.plate_loc_height!);
                const pitchColor = getPitchTypeColor(pitch.tagged_pitch_type);
                const baseballRadiusPixels = (BASEBALL_RADIUS * (chartWidth / (X_MAX - X_MIN))) * 0.7;

                return (
                  <Circle
                    key={pitch.id}
                    cx={pitchPixel.x}
                    cy={pitchPixel.y}
                    r={baseballRadiusPixels}
                    fill={pitchColor}
                    stroke={COLORS.white}
                    strokeWidth="1.5"
                    opacity={0.85}
                    onPress={() => setSelectedLocationPitch(pitch)}
                  />
                );
              })}
            </Svg>
          </View>

          {/* Pitch Type Legend */}
          <View style={styles.legendContainer}>
            {Object.entries(pitchTypeStats).slice(0, 6).map(([type, stats]) => (
              <View key={type} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: getPitchTypeColor(type) }]} />
                <Text style={styles.legendText}>{type}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Session Summary */}
        <View style={styles.section}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>SESSION SUMMARY</Text>

            <View style={styles.summaryStatsRow}>
              <View style={styles.summaryStat}>
                <Text style={styles.summaryStatValue}>{totalPitchCount}</Text>
                <Text style={styles.summaryStatLabel}>Total Pitches</Text>
              </View>
              <View style={styles.summaryStat}>
                <Text style={[styles.summaryStatValue, { color: COLORS.primary }]}>{strikePercentage}%</Text>
                <Text style={styles.summaryStatLabel}>Strike %</Text>
              </View>
              <View style={styles.summaryStat}>
                {avgStuffPlus !== null ? (
                  <Text style={[styles.summaryStatValue, { color: getStuffPlusColor(avgStuffPlus) }]}>
                    {avgStuffPlus.toFixed(0)}
                  </Text>
                ) : (
                  <Text style={[styles.summaryStatValue, { color: COLORS.gray600 }]}>--</Text>
                )}
                <Text style={styles.summaryStatLabel}>Avg Stuff+</Text>
              </View>
            </View>

            {/* Pitch Type Breakdown Cards */}
            <View style={styles.pitchTypeCardsContainer}>
              {Object.entries(pitchTypeStats)
                .sort((a, b) => b[1].count - a[1].count)
                .map(([type, stats]) => {
                  const color = getPitchTypeColor(type);
                  const avgVelo = stats.velocities.reduce((sum, v) => sum + v, 0) / stats.velocities.length;
                  const maxVeloVal = Math.max(...stats.velocities);
                  const avgSpin = stats.spins.length > 0
                    ? stats.spins.reduce((sum, s) => sum + s, 0) / stats.spins.length
                    : null;
                  const avgStuff = stats.stuffPlus.length > 0
                    ? stats.stuffPlus.reduce((sum, s) => sum + s, 0) / stats.stuffPlus.length
                    : null;
                  const percentage = ((stats.count / pitches.length) * 100).toFixed(0);

                  return (
                    <View key={type} style={styles.pitchTypeCard}>
                      <View style={styles.pitchTypeCardHeader}>
                        <View style={styles.pitchTypeCardHeaderLeft}>
                          <View style={[styles.pitchTypeDot, { backgroundColor: color }]} />
                          <Text style={styles.pitchTypeName}>{type}</Text>
                        </View>
                        <View style={styles.pitchTypeCardHeaderRight}>
                          <Text style={styles.pitchTypeCount}>{stats.count} pitches</Text>
                          <Text style={styles.pitchTypePercentage}>{percentage}%</Text>
                        </View>
                      </View>

                      <View style={styles.pitchTypeStatsRow}>
                        <View style={styles.pitchTypeStat}>
                          <Text style={styles.pitchTypeStatLabel}>Velocity</Text>
                          <Text style={[styles.pitchTypeStatValue, { color: COLORS.cyan400 }]}>{avgVelo.toFixed(1)}</Text>
                          <Text style={styles.pitchTypeStatSubtext}>max: {maxVeloVal.toFixed(1)}</Text>
                        </View>
                        <View style={styles.pitchTypeStat}>
                          <Text style={styles.pitchTypeStatLabel}>Spin</Text>
                          {avgSpin ? (
                            <>
                              <Text style={[styles.pitchTypeStatValue, { color: COLORS.purple400 }]}>{avgSpin.toFixed(0)}</Text>
                              <Text style={styles.pitchTypeStatSubtext}>rpm</Text>
                            </>
                          ) : (
                            <Text style={[styles.pitchTypeStatValue, { color: COLORS.gray600 }]}>--</Text>
                          )}
                        </View>
                        <View style={styles.pitchTypeStat}>
                          <Text style={styles.pitchTypeStatLabel}>Stuff+</Text>
                          {avgStuff ? (
                            <>
                              <Text style={[styles.pitchTypeStatValue, { color: getStuffPlusColor(avgStuff) }]}>{avgStuff.toFixed(0)}</Text>
                              <Text style={styles.pitchTypeStatSubtext}>grade</Text>
                            </>
                          ) : (
                            <Text style={[styles.pitchTypeStatValue, { color: COLORS.gray600 }]}>--</Text>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
            </View>
          </View>
        </View>

        {/* Stuff+ by Pitch Chart */}
        {pitchesWithStuff.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.chartTitle}>Stuff+ by Pitch</Text>
            <Text style={styles.chartDescription}>Tap any bar for pitch details</Text>

            <View style={styles.chartContainer}>
              <Svg width={stuffChartWidth} height={stuffChartHeight} viewBox={`0 0 ${stuffChartWidth} ${stuffChartHeight}`}>
                {/* Grid lines */}
                {[minStuff, minStuff + stuffRange * 0.25, minStuff + stuffRange * 0.5, minStuff + stuffRange * 0.75, maxStuff].map((value) => {
                  const y = stuffMarginTop + ((maxStuff - value) / stuffRange) * stuffPlotHeight;
                  const is100 = Math.abs(value - 100) < 3;
                  return (
                    <G key={`grid-${value}`}>
                      <Line
                        x1={stuffMarginLeft}
                        x2={stuffChartWidth - stuffMarginRight}
                        y1={y}
                        y2={y}
                        stroke={is100 ? COLORS.white : COLORS.gray700}
                        strokeWidth={is100 ? 1.5 : 0.5}
                        opacity={is100 ? 0.4 : 0.3}
                        strokeDasharray={is100 ? "4 4" : "0"}
                      />
                      <SvgText
                        x={stuffMarginLeft - 6}
                        y={y + 4}
                        fill={is100 ? COLORS.white : COLORS.gray400}
                        fontSize="9"
                        fontWeight={is100 ? "bold" : "normal"}
                        textAnchor="end"
                      >
                        {Math.round(value)}
                      </SvgText>
                    </G>
                  );
                })}

                {/* Axis labels */}
                <SvgText
                  x={stuffChartWidth / 2}
                  y={stuffChartHeight - 5}
                  fill={COLORS.primary}
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  Pitch Number
                </SvgText>

                {/* Bars */}
                {pitchesWithStuff.map((pitch, index) => {
                  const stuffValue = pitch.stuff_plus!.stuff_plus;
                  const barSpacing = stuffPlotWidth / pitchesWithStuff.length;
                  const barWidth = Math.max(4, Math.min(16, barSpacing * 0.8));
                  const barHeight = Math.max(0, ((stuffValue - minStuff) / stuffRange) * stuffPlotHeight);
                  const x = stuffMarginLeft + (index * barSpacing) + ((barSpacing - barWidth) / 2);
                  const y = stuffMarginTop + stuffPlotHeight - barHeight;
                  const color = getPitchTypeColor(pitch.tagged_pitch_type);

                  return (
                    <Rect
                      key={pitch.id}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill={color}
                      opacity={0.85}
                      onPress={() => setSelectedStuffPitch(pitch)}
                    />
                  );
                })}
              </Svg>
            </View>
          </View>
        )}

        {/* Avg Stuff+ by Pitch Type */}
        {pitchTypeStuffPlus.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.chartTitle}>Average Stuff+ by Pitch Type</Text>
            <Text style={styles.chartDescription}>Average Stuff+ grade for each pitch type</Text>

            <View style={styles.stuffPlusBarsContainer}>
              {pitchTypeStuffPlus.map(({ type, avg, count, color }) => {
                const barWidth = Math.max(0, Math.min(100, ((avg - 80) / 40) * 100));

                return (
                  <View key={type} style={styles.stuffPlusBarRow}>
                    <View style={styles.stuffPlusBarHeader}>
                      <View style={styles.stuffPlusBarHeaderLeft}>
                        <View style={[styles.stuffPlusBarDot, { backgroundColor: color }]} />
                        <Text style={styles.stuffPlusBarLabel}>{type}</Text>
                        <Text style={styles.stuffPlusBarCount}>({count})</Text>
                      </View>
                      <Text style={[styles.stuffPlusBarValue, { color: getStuffPlusColor(avg) }]}>
                        {avg.toFixed(0)}
                      </Text>
                    </View>

                    <View style={styles.stuffPlusBarTrack}>
                      {/* Grid marks */}
                      <View style={[styles.stuffPlusGridMark, { left: '0%' }]} />
                      <View style={[styles.stuffPlusGridMark, { left: '25%' }]} />
                      <View style={[styles.stuffPlusGridMark100, { left: '50%' }]} />
                      <View style={[styles.stuffPlusGridMark, { left: '75%' }]} />
                      <View style={[styles.stuffPlusGridMark, { left: '100%' }]} />

                      {/* Bar fill */}
                      <View
                        style={[
                          styles.stuffPlusBarFill,
                          {
                            width: `${barWidth}%`,
                            backgroundColor: avg >= 100 ? color : `${color}80`,
                          }
                        ]}
                      />

                      {/* Grid labels */}
                      <View style={styles.stuffPlusGridLabels}>
                        <Text style={styles.stuffPlusGridLabel}>80</Text>
                        <Text style={styles.stuffPlusGridLabel}>90</Text>
                        <Text style={[styles.stuffPlusGridLabel, { color: COLORS.white }]}>100</Text>
                        <Text style={styles.stuffPlusGridLabel}>110</Text>
                        <Text style={styles.stuffPlusGridLabel}>120</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Velocity by Pitch Chart */}
        {pitches.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.chartTitle}>Velocity by Pitch</Text>
            <Text style={styles.chartDescription}>Tap any point for pitch details</Text>

            <View style={styles.chartContainer}>
              <Svg width={veloChartWidth} height={veloChartHeight} viewBox={`0 0 ${veloChartWidth} ${veloChartHeight}`}>
                {/* Grid lines */}
                {Array.from({ length: 5 }, (_, i) => {
                  const velocity = minVelo + (veloRange / 4) * i;
                  const y = veloMarginTop + ((maxVelo - velocity) / veloRange) * veloPlotHeight;
                  return (
                    <G key={`h-grid-${i}`}>
                      <Line
                        x1={veloMarginLeft}
                        x2={veloChartWidth - veloMarginRight}
                        y1={y}
                        y2={y}
                        stroke={COLORS.gray700}
                        strokeWidth="0.5"
                        opacity="0.3"
                      />
                      <SvgText
                        x={veloMarginLeft - 6}
                        y={y + 4}
                        fill={COLORS.gray400}
                        fontSize="9"
                        textAnchor="end"
                      >
                        {velocity.toFixed(0)}
                      </SvgText>
                    </G>
                  );
                })}

                {/* Axis labels */}
                <SvgText
                  x={veloChartWidth / 2}
                  y={veloChartHeight - 5}
                  fill={COLORS.primary}
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  Pitch Number
                </SvgText>

                {/* Group pitches by type and draw lines */}
                {Object.entries(
                  pitches.reduce((acc, pitch, index) => {
                    const type = pitch.tagged_pitch_type || 'Unknown';
                    if (!acc[type]) acc[type] = [];
                    acc[type].push({ ...pitch, originalIndex: index });
                    return acc;
                  }, {} as Record<string, (TrackManPitch & { originalIndex: number })[]>)
                ).map(([type, typePitches]) => {
                  const color = getPitchTypeColor(type);
                  const pathData = typePitches
                    .map((pitch, idx) => {
                      const x = veloMarginLeft + (pitch.originalIndex / (pitches.length - 1 || 1)) * veloPlotWidth;
                      const y = veloMarginTop + ((maxVelo - pitch.rel_speed) / veloRange) * veloPlotHeight;
                      return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                    })
                    .join(' ');

                  return (
                    <Path
                      key={`line-${type}`}
                      d={pathData}
                      stroke={color}
                      strokeWidth="2"
                      fill="none"
                      opacity="0.7"
                    />
                  );
                })}

                {/* Draw points */}
                {pitches.map((pitch, index) => {
                  const x = veloMarginLeft + (index / (pitches.length - 1 || 1)) * veloPlotWidth;
                  const y = veloMarginTop + ((maxVelo - pitch.rel_speed) / veloRange) * veloPlotHeight;
                  const color = getPitchTypeColor(pitch.tagged_pitch_type);

                  return (
                    <Circle
                      key={`point-${pitch.id}`}
                      cx={x}
                      cy={y}
                      r={5}
                      fill={color}
                      stroke={COLORS.white}
                      strokeWidth="1"
                      opacity={0.9}
                      onPress={() => setSelectedVeloPitch(pitch)}
                    />
                  );
                })}
              </Svg>
            </View>
          </View>
        )}

        {/* Pitch Movement Profile */}
        {pitchesWithBreak.length > 0 && (
          <View style={styles.section}>
            <View style={styles.chartHeaderWithToggle}>
              <View>
                <Text style={styles.chartTitle}>Pitch Movement Profile</Text>
                <Text style={styles.chartDescription}>Tap any pitch for break details</Text>
              </View>
              <View style={styles.viewToggle}>
                <TouchableOpacity
                  style={[styles.viewToggleButton, movementView === 'individual' && styles.viewToggleButtonActive]}
                  onPress={() => setMovementView('individual')}
                >
                  <Text style={[styles.viewToggleText, movementView === 'individual' && styles.viewToggleTextActive]}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewToggleButton, movementView === 'heatmap' && styles.viewToggleButtonActive]}
                  onPress={() => setMovementView('heatmap')}
                >
                  <Text style={[styles.viewToggleText, movementView === 'heatmap' && styles.viewToggleTextActive]}>Avg</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.chartContainer}>
              <Svg width={breakChartSize} height={breakChartSize} viewBox={`0 0 ${breakChartSize} ${breakChartSize}`}>
                {/* Grid lines */}
                {[-20, -10, 0, 10, 20].map(x => {
                  const pixel = breakToPixel(x, 0);
                  return (
                    <Line
                      key={`v-${x}`}
                      x1={pixel.x}
                      x2={pixel.x}
                      y1={breakMargin}
                      y2={breakChartSize - breakMargin}
                      stroke={x === 0 ? COLORS.gray500 : COLORS.gray700}
                      strokeWidth={x === 0 ? 1.5 : 0.5}
                      opacity={x === 0 ? 0.5 : 0.3}
                    />
                  );
                })}
                {[-20, -10, 0, 10, 20].map(y => {
                  const pixel = breakToPixel(0, y);
                  return (
                    <Line
                      key={`h-${y}`}
                      x1={breakMargin}
                      x2={breakChartSize - breakMargin}
                      y1={pixel.y}
                      y2={pixel.y}
                      stroke={y === 0 ? COLORS.gray500 : COLORS.gray700}
                      strokeWidth={y === 0 ? 1.5 : 0.5}
                      opacity={y === 0 ? 0.5 : 0.3}
                    />
                  );
                })}

                {/* Axis labels */}
                {[-30, -20, -10, 0, 10, 20, 30].map(x => {
                  const pixel = breakToPixel(x, BREAK_MIN);
                  return (
                    <SvgText
                      key={`x-label-${x}`}
                      x={pixel.x}
                      y={breakChartSize - 10}
                      fill={COLORS.gray400}
                      fontSize="8"
                      textAnchor="middle"
                      fontWeight={x === 0 ? "bold" : "normal"}
                    >
                      {x}"
                    </SvgText>
                  );
                })}
                {[-30, -20, -10, 0, 10, 20, 30].map(y => {
                  const pixel = breakToPixel(BREAK_MIN, y);
                  return (
                    <SvgText
                      key={`y-label-${y}`}
                      x={10}
                      y={pixel.y + 3}
                      fill={COLORS.gray400}
                      fontSize="8"
                      textAnchor="start"
                      fontWeight={y === 0 ? "bold" : "normal"}
                    >
                      {y}"
                    </SvgText>
                  );
                })}

                {/* Axis titles */}
                <SvgText
                  x={breakChartSize / 2}
                  y={breakChartSize - 2}
                  fill={COLORS.primary}
                  fontSize="10"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  Horizontal Break (in)
                </SvgText>

                {movementView === 'individual' ? (
                  // Individual pitches view
                  pitchesWithBreak.map((pitch) => {
                    const pitchPixel = breakToPixel(pitch.horz_break_inches, pitch.induced_vert_break_inches);
                    const color = getPitchTypeColor(pitch.tagged_pitch_type);

                    return (
                      <Circle
                        key={pitch.id}
                        cx={pitchPixel.x}
                        cy={pitchPixel.y}
                        r={6}
                        fill={color}
                        stroke={COLORS.white}
                        strokeWidth="1"
                        opacity={0.85}
                        onPress={() => setSelectedMovementPitch(pitch)}
                      />
                    );
                  })
                ) : (
                  // Average by pitch type view - soft heatmap glows
                  <>
                    <Defs>
                      {avgBreakByPitchType.map(({ type, color }) => (
                        <RadialGradient key={`grad-${type}`} id={`heatmap-${type}`} cx="50%" cy="50%">
                          <Stop offset="0%" stopColor={color} stopOpacity="0.7" />
                          <Stop offset="40%" stopColor={color} stopOpacity="0.4" />
                          <Stop offset="70%" stopColor={color} stopOpacity="0.15" />
                          <Stop offset="100%" stopColor={color} stopOpacity="0" />
                        </RadialGradient>
                      ))}
                    </Defs>
                    {avgBreakByPitchType.map(({ type, avgHorz, avgVert, count, color }) => {
                      const pitchPixel = breakToPixel(avgHorz, avgVert);
                      // Scale radius based on count (min 35, max 60)
                      const radius = Math.min(60, Math.max(35, 30 + count * 1.5));

                      return (
                        <Circle
                          key={`avg-${type}`}
                          cx={pitchPixel.x}
                          cy={pitchPixel.y}
                          r={radius}
                          fill={`url(#heatmap-${type})`}
                        />
                      );
                    })}
                  </>
                )}
              </Svg>
            </View>
            <Text style={styles.viewLabel}>
              {movementView === 'individual' ? 'All Pitches' : 'Average by Pitch Type'}
            </Text>
          </View>
        )}

        {/* Release Point Chart */}
        {pitchesWithRelease.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.chartTitle}>Release Point Chart</Text>
            <Text style={styles.chartDescription}>Tap any pitch for release details</Text>

            <View style={styles.chartContainer}>
              <Svg width={releaseChartSize} height={releaseChartSize} viewBox={`0 0 ${releaseChartSize} ${releaseChartSize}`}>
                {/* Grid lines - vertical */}
                {[-3, -2, -1, 0, 1, 2, 3].map(x => {
                  const pixel = relToPixel(x, REL_Y_MIN);
                  return (
                    <Line
                      key={`v-${x}`}
                      x1={pixel.x}
                      x2={pixel.x}
                      y1={0}
                      y2={releaseChartSize}
                      stroke={COLORS.gray700}
                      strokeWidth="0.5"
                      opacity="0.3"
                    />
                  );
                })}
                {/* Grid lines - horizontal */}
                {[1, 2, 3, 4, 5, 6, 7].map(y => {
                  const pixel = relToPixel(REL_X_MIN, y);
                  return (
                    <Line
                      key={`h-${y}`}
                      x1={0}
                      x2={releaseChartSize}
                      y1={pixel.y}
                      y2={pixel.y}
                      stroke={COLORS.gray700}
                      strokeWidth="0.5"
                      opacity="0.3"
                    />
                  );
                })}

                {/* Center line emphasized */}
                <Line
                  x1={relToPixel(0, REL_Y_MIN).x}
                  x2={relToPixel(0, REL_Y_MAX).x}
                  y1={0}
                  y2={releaseChartSize}
                  stroke={COLORS.gray500}
                  strokeWidth="1.5"
                  opacity="0.5"
                />

                {/* Axis labels */}
                {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map(x => {
                  const pixel = relToPixel(x, REL_Y_MIN);
                  return (
                    <SvgText
                      key={`x-label-${x}`}
                      x={pixel.x}
                      y={releaseChartSize - 5}
                      fill={COLORS.gray400}
                      fontSize="8"
                      textAnchor="middle"
                    >
                      {x}'
                    </SvgText>
                  );
                })}
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(y => {
                  const pixel = relToPixel(REL_X_MIN, y);
                  return (
                    <SvgText
                      key={`y-label-${y}`}
                      x={5}
                      y={pixel.y + 4}
                      fill={COLORS.gray400}
                      fontSize="8"
                    >
                      {y}'
                    </SvgText>
                  );
                })}

                {/* Plot release points */}
                {pitchesWithRelease.map((pitch) => {
                  const pitchPixel = relToPixel(pitch.rel_side!, pitch.rel_height!);
                  const color = getPitchTypeColor(pitch.tagged_pitch_type);

                  return (
                    <Circle
                      key={pitch.id}
                      cx={pitchPixel.x}
                      cy={pitchPixel.y}
                      r={6}
                      fill={color}
                      stroke={COLORS.white}
                      strokeWidth="1"
                      opacity={0.85}
                      onPress={() => setSelectedReleasePitch(pitch)}
                    />
                  );
                })}
              </Svg>
            </View>
          </View>
        )}

        {/* Raw Pitch Data Table */}
        {pitches.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.chartTitle}>Raw Pitch Data</Text>
            <Text style={styles.chartDescription}>Complete pitch-by-pitch data • Scroll horizontally for all metrics</Text>

            <View style={styles.rawDataTableContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.rawDataScrollView}>
                <View>
                  {/* Header Row */}
                  <View style={styles.rawDataHeaderRow}>
                    <View style={[styles.rawDataCell, styles.rawDataCellSticky, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>#</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellVid, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Vid</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellType, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Type</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Velo</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Spin</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Tilt</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Ext</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>IVB</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>HB</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>VAA</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Spin Eff</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Stuff+</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Rel Ht</Text>
                    </View>
                    <View style={[styles.rawDataCell, styles.rawDataCellNum, styles.rawDataHeaderCell]}>
                      <Text style={styles.rawDataHeaderText}>Rel Side</Text>
                    </View>
                  </View>

                  {/* Data Rows */}
                  {pitches.map((pitch, index) => (
                    <View key={pitch.id} style={[styles.rawDataRow, index % 2 === 1 && styles.rawDataRowAlt]}>
                      <View style={[styles.rawDataCell, styles.rawDataCellSticky]}>
                        <Text style={styles.rawDataCellText}>{pitch.pitch_no ?? index + 1}</Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellVid]}>
                        {pitch.video_url ? (
                          <TouchableOpacity onPress={() => setSelectedVideoUrl(pitch.video_url)}>
                            <Ionicons name="videocam" size={18} color={COLORS.green500} />
                          </TouchableOpacity>
                        ) : (
                          <Text style={[styles.rawDataCellText, { color: 'rgba(156,163,175,0.5)' }]}>--</Text>
                        )}
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellType]}>
                        <View style={styles.rawDataTypeCell}>
                          <View style={[styles.rawDataTypeDot, { backgroundColor: getPitchTypeColor(pitch.tagged_pitch_type) }]} />
                          <Text style={styles.rawDataCellText} numberOfLines={1}>
                            {pitch.tagged_pitch_type || '--'}
                          </Text>
                        </View>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.cyan400 }]}>
                          {pitch.rel_speed ? pitch.rel_speed.toFixed(1) : '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.purple500 }]}>
                          {pitch.spin_rate ? Math.round(pitch.spin_rate) : '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.gray400 }]}>
                          {pitch.measured_tilt || pitch.tilt || '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.gray400 }]}>
                          {pitch.extension ? pitch.extension.toFixed(1) : '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.green500 }]}>
                          {pitch.induced_vert_break ? pitch.induced_vert_break.toFixed(1) : '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.amber500 }]}>
                          {pitch.horz_break ? pitch.horz_break.toFixed(1) : '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.gray400 }]}>
                          {pitch.vert_appr_angle ? pitch.vert_appr_angle.toFixed(1) : '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.gray400 }]}>
                          {pitch.spin_axis_3d_spin_efficiency != null
                            ? `${Math.round(pitch.spin_axis_3d_spin_efficiency <= 1 ? pitch.spin_axis_3d_spin_efficiency * 100 : pitch.spin_axis_3d_spin_efficiency)}%`
                            : '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: pitch.stuff_plus?.stuff_plus ? getStuffPlusColor(pitch.stuff_plus.stuff_plus) : COLORS.gray400 }]}>
                          {pitch.stuff_plus?.stuff_plus ? Math.round(pitch.stuff_plus.stuff_plus) : '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.gray400 }]}>
                          {pitch.rel_height ? pitch.rel_height.toFixed(2) : '--'}
                        </Text>
                      </View>
                      <View style={[styles.rawDataCell, styles.rawDataCellNum]}>
                        <Text style={[styles.rawDataCellText, { color: COLORS.gray400 }]}>
                          {pitch.rel_side ? pitch.rel_side.toFixed(2) : '--'}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>

            {/* Legend */}
            <View style={styles.rawDataLegend}>
              <Text style={styles.rawDataLegendText}>
                Velo = Velocity (mph) • Ext = Extension (ft) • IVB = Induced Vertical Break (in) • HB = Horizontal Break (in)
              </Text>
              <Text style={styles.rawDataLegendText}>
                VAA = Vertical Approach Angle (°) • Rel Ht/Side = Release Height/Side (ft)
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB Back Button */}
      <TouchableOpacity style={styles.fab} onPress={() => navigation.goBack()}>
        <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.fabGradient}>
          <Ionicons name="chevron-back" size={24} color={COLORS.black} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Video Player Modal */}
      <Modal
        visible={selectedVideoUrl !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setSelectedVideoUrl(null)}
      >
        <Pressable style={styles.videoModalOverlay} onPress={() => setSelectedVideoUrl(null)}>
          <Pressable style={styles.videoModalContainer} onPress={(e) => e.stopPropagation()}>
            {/* Header */}
            <View style={styles.videoModalHeader}>
              <View style={styles.videoModalHeaderLeft}>
                <Ionicons name="videocam" size={20} color={COLORS.green500} />
                <Text style={styles.videoModalTitle}>Pitch Video</Text>
              </View>
              <TouchableOpacity
                style={styles.videoModalCloseButton}
                onPress={() => setSelectedVideoUrl(null)}
              >
                <Ionicons name="close" size={20} color={COLORS.gray400} />
              </TouchableOpacity>
            </View>

            {/* Video Player */}
            <View style={styles.videoPlayerContainer}>
              {selectedVideoUrl && (
                <Video
                  ref={videoRef}
                  source={{ uri: selectedVideoUrl }}
                  style={styles.videoPlayer}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={true}
                  isLooping={false}
                />
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  section: { marginBottom: 24 },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  chartHeaderWithToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  chartTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.white, marginBottom: 2 },
  chartDescription: { fontSize: 10, color: COLORS.gray500, fontStyle: 'italic' },
  strikePercentBox: { alignItems: 'flex-end' },
  strikePercentLabel: { fontSize: 10, color: COLORS.gray400 },
  strikePercentValue: { fontSize: 22, fontWeight: 'bold', color: COLORS.primary },
  chartContainer: { alignItems: 'center', backgroundColor: COLORS.black, borderRadius: 12, padding: 8 },
  legendContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: COLORS.gray400 },
  summaryCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  summaryTitle: { fontSize: 10, fontWeight: '600', color: COLORS.gray400, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, textAlign: 'center' },
  summaryStatsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  summaryStat: { alignItems: 'center' },
  summaryStatValue: { fontSize: 18, fontWeight: 'bold', color: COLORS.white },
  summaryStatLabel: { fontSize: 8, color: COLORS.gray500, textTransform: 'uppercase', marginTop: 2 },
  pitchTypeCardsContainer: { gap: 8 },
  pitchTypeCard: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  pitchTypeCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  pitchTypeCardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pitchTypeDot: { width: 12, height: 12, borderRadius: 6 },
  pitchTypeName: { fontSize: 13, fontWeight: '600', color: COLORS.white },
  pitchTypeCardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pitchTypeCount: { fontSize: 11, color: COLORS.gray400 },
  pitchTypePercentage: { fontSize: 12, fontWeight: 'bold', color: COLORS.primary },
  pitchTypeStatsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  pitchTypeStat: { alignItems: 'center' },
  pitchTypeStatLabel: { fontSize: 9, color: COLORS.gray500, marginBottom: 2 },
  pitchTypeStatValue: { fontSize: 15, fontWeight: 'bold' },
  pitchTypeStatSubtext: { fontSize: 8, color: COLORS.gray600 },
  stuffPlusBarsContainer: { gap: 12 },
  stuffPlusBarRow: { gap: 6 },
  stuffPlusBarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stuffPlusBarHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stuffPlusBarDot: { width: 10, height: 10, borderRadius: 5 },
  stuffPlusBarLabel: { fontSize: 12, fontWeight: '600', color: COLORS.white },
  stuffPlusBarCount: { fontSize: 10, color: COLORS.gray500 },
  stuffPlusBarValue: { fontSize: 14, fontWeight: 'bold' },
  stuffPlusBarTrack: { height: 32, backgroundColor: COLORS.black, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', position: 'relative' },
  stuffPlusGridMark: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  stuffPlusGridMark100: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  stuffPlusBarFill: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  stuffPlusGridLabels: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  stuffPlusGridLabel: { fontSize: 8, fontWeight: 'bold', color: COLORS.gray500 },
  viewToggle: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2 },
  viewToggleButton: { paddingVertical: 4, paddingHorizontal: 12, borderRadius: 6 },
  viewToggleButtonActive: { backgroundColor: COLORS.primary },
  viewToggleText: { fontSize: 11, color: COLORS.gray400 },
  viewToggleTextActive: { color: COLORS.black, fontWeight: '600' },
  viewLabel: { textAlign: 'center', fontSize: 10, color: COLORS.gray400, marginTop: 8 },
  // Tooltip Modal Styles
  tooltipOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  tooltipCard: { backgroundColor: COLORS.gray800, borderRadius: 16, padding: 20, width: '100%', maxWidth: 320, borderWidth: 2 },
  tooltipHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  tooltipTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.white },
  tooltipPitchType: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginBottom: 16 },
  tooltipPitchDot: { width: 12, height: 12, borderRadius: 6 },
  tooltipPitchTypeName: { fontSize: 14, fontWeight: '600' },
  tooltipStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tooltipStatItem: { width: '45%', marginBottom: 8 },
  tooltipStatLabel: { fontSize: 10, color: COLORS.gray400, textTransform: 'uppercase', marginBottom: 2 },
  tooltipStatValue: { fontSize: 16, fontWeight: 'bold', color: COLORS.white },
  tooltipVideoButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.green500, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, marginTop: 16 },
  tooltipVideoButtonText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
  // FAB Styles
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  fabGradient: { width: '100%', height: '100%', borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  // Raw Pitch Data Table Styles
  rawDataTableContainer: { marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gray800, overflow: 'hidden', backgroundColor: COLORS.black },
  rawDataScrollView: { flexGrow: 0 },
  rawDataHeaderRow: { flexDirection: 'row', backgroundColor: '#1a1a1a' },
  rawDataRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: COLORS.gray800 },
  rawDataRowAlt: { backgroundColor: 'rgba(255,255,255,0.02)' },
  rawDataCell: { paddingVertical: 10, paddingHorizontal: 8, justifyContent: 'center' },
  rawDataHeaderCell: { paddingVertical: 12 },
  rawDataCellSticky: { width: 40, backgroundColor: '#1a1a1a' },
  rawDataCellVid: { width: 40, alignItems: 'center' },
  rawDataCellType: { width: 90 },
  rawDataCellNum: { width: 60, alignItems: 'flex-end' },
  rawDataHeaderText: { fontSize: 11, fontWeight: '600', color: COLORS.gray400, textTransform: 'uppercase' },
  rawDataCellText: { fontSize: 12, color: COLORS.white },
  rawDataTypeCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rawDataTypeDot: { width: 8, height: 8, borderRadius: 4 },
  rawDataLegend: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  rawDataLegendText: { fontSize: 10, color: COLORS.gray500, textAlign: 'center', lineHeight: 16 },
  // Video Modal Styles
  videoModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  videoModalContainer: { width: '100%', maxWidth: 500, backgroundColor: '#111827', borderRadius: 12, overflow: 'hidden' },
  videoModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.gray800 },
  videoModalHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  videoModalTitle: { fontSize: 16, fontWeight: '600', color: COLORS.white },
  videoModalCloseButton: { padding: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20 },
  videoPlayerContainer: { width: '100%', aspectRatio: 16 / 9, backgroundColor: COLORS.black },
  videoPlayer: { width: '100%', height: '100%' },
});
