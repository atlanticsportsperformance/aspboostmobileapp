import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import {
  fetchPitchDetail,
  fetchPercentileCohort,
  fetchC3DBinary,
  type MocapPitchDetail,
} from '../lib/mocap/api';
import { buildPercentileTable, type PercentileTable } from '../lib/mocap/percentiles';
import { parseC3D, type C3DData } from '../lib/mocap/c3dParser';
import PercentileBreakdown from '../components/mocap/PercentileBreakdown';
import SkeletonViewer3D from '../components/mocap/SkeletonViewer3D';

const ACCENT = '#9BDDFF';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PLAY_SPEEDS = [0.1, 0.25, 0.5, 1.0];

export default function MocapPitchDetailScreen({ navigation, route }: any) {
  const { athleteId, pitchId } = route.params;

  const [loading, setLoading] = useState(true);
  const [pitchData, setPitchData] = useState<MocapPitchDetail | null>(null);
  const [percentileData, setPercentileData] = useState<PercentileTable | null>(null);
  const [c3dData, setC3dData] = useState<C3DData | null>(null);

  // Playback state — driven by WebView, displayed in RN controls
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(1);
  const [playSpeed, setPlaySpeed] = useState(0.25);

  const skeletonViewerRef = useRef<any>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState<'report' | 'motion'>('report');
  const [motionReady, setMotionReady] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => { loadAllData(); }, []);

  async function loadAllData() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigation.replace('Login'); return; }
      const token = session.access_token;

      const [pitchResult, cohortResult] = await Promise.all([
        fetchPitchDetail(athleteId, pitchId, token),
        fetchPercentileCohort(85, token),
      ]);

      if (!isMountedRef.current) return;
      setPitchData(pitchResult);

      if (cohortResult.metrics?.length > 0) {
        setPercentileData(buildPercentileTable(cohortResult.metrics));
      }

      if (pitchResult.c3dUrl) {
        fetchC3DBinary(pitchResult.c3dUrl)
          .then(buffer => {
            if (!isMountedRef.current) return;
            setC3dData(parseC3D(buffer));
          })
          .catch(err => console.error('Error loading C3D:', err));
      }
    } catch (error) {
      console.error('Error loading pitch detail:', error);
      Alert.alert('Error', 'Failed to load pitch data');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }

  const frameRate = c3dData?.frameRate || 360;
  const totalFrames = c3dData?.frameCount || 0;
  const durationSeconds = totalFrames / frameRate;
  const scrubberPosition = totalFrames > 0 ? currentFrame / totalFrames : 0;

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (currentFrame >= totalFrames - 1) setCurrentFrame(0);
      setIsPlaying(true);
    }
  }, [isPlaying, currentFrame, totalFrames]);

  const seekToFrame = useCallback((frame: number) => {
    const clamped = Math.max(0, Math.min(frame, totalFrames - 1));
    setCurrentFrame(clamped);
  }, [totalFrames]);

  const stepFrame = useCallback((dir: 1 | -1) => {
    seekToFrame(Math.round(currentFrame) + dir);
  }, [currentFrame, seekToFrame]);

  const changeSpeed = useCallback(() => {
    const idx = PLAY_SPEEDS.indexOf(playSpeed);
    setPlaySpeed(PLAY_SPEEDS[(idx + 1) % PLAY_SPEEDS.length]);
  }, [playSpeed]);

  // WebView reports frames back during playback
  const onFrameUpdate = useCallback((frame: number) => {
    setCurrentFrame(frame);
  }, []);

  const onPlaybackEnd = useCallback(() => {
    setIsPlaying(false);
    setCurrentFrame(totalFrames > 0 ? totalFrames - 1 : 0);
  }, [totalFrames]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ACCENT} />
          <Text style={styles.loadingText}>Loading biomechanics data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pitch = pitchData?.pitch;

  return (
    <SafeAreaView style={styles.container}>
      {/* Fixed header + tabs */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={20} color="#9CA3AF" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>
            {pitch?.pitchType || 'Pitch'} #{pitch?.pitchNumber || ''}
          </Text>
          {pitch?.velocity != null && (
            <View style={styles.velocityBadge}>
              <Text style={styles.velocityText}>{pitch.velocity} mph</Text>
            </View>
          )}
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'report' && styles.tabItemActive]}
          onPress={() => setActiveTab('report')}
          activeOpacity={0.7}
        >
          <Ionicons name="analytics" size={16} color={activeTab === 'report' ? ACCENT : 'rgba(255,255,255,0.3)'} />
          <Text style={[styles.tabText, activeTab === 'report' && styles.tabTextActive]}>Report</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'motion' && styles.tabItemActive]}
          onPress={() => setActiveTab('motion')}
          activeOpacity={0.7}
        >
          <Ionicons name="videocam" size={16} color={activeTab === 'motion' ? ACCENT : 'rgba(255,255,255,0.3)'} />
          <Text style={[styles.tabText, activeTab === 'motion' && styles.tabTextActive]}>Motion</Text>
        </TouchableOpacity>
      </View>

      {/* Tab content */}
      {activeTab === 'report' ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {pitch?.scalarMetrics && (
            <PercentileBreakdown
              scalarMetrics={pitch.scalarMetrics}
              percentileData={percentileData}
              velocity={pitch.velocity}
              pitchType={pitch.pitchType}
            />
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      ) : (
        <View style={styles.scrollView}>
          {/* Loading overlay until video + skeleton are ready */}
          {!motionReady && (
            <View style={styles.motionLoading}>
              <ActivityIndicator size="large" color={ACCENT} />
              <Text style={styles.motionLoadingText}>Loading motion data...</Text>
            </View>
          )}

          {/* Video + 3D Skeleton */}
          <SkeletonViewer3D
            ref={skeletonViewerRef}
            c3dData={c3dData ? {
              positions: Array.from(c3dData.positions),
              rotations: Array.from(c3dData.rotations),
              frameCount: c3dData.frameCount,
              segmentCount: c3dData.segmentCount,
              frameRate: c3dData.frameRate,
            } : null}
            videoUrl={pitchData?.videoUrl || null}
            currentFrame={Math.round(currentFrame)}
            isPlaying={isPlaying}
            playSpeed={playSpeed}
            height={600}
            onReady={() => setMotionReady(true)}
            onFrameUpdate={onFrameUpdate}
            onPlaybackEnd={onPlaybackEnd}
          />

          {/* Playback Controls */}
          {totalFrames > 0 && (
            <View style={styles.controls}>
              <View style={styles.transportRow}>
                <TouchableOpacity onPress={() => stepFrame(-1)} style={styles.controlButton}>
                  <Ionicons name="play-back" size={18} color="#FFFFFF" />
                </TouchableOpacity>
                <TouchableOpacity onPress={togglePlay} style={styles.playButton}>
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="#000000" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => stepFrame(1)} style={styles.controlButton}>
                  <Ionicons name="play-forward" size={18} color="#FFFFFF" />
                </TouchableOpacity>
                <TouchableOpacity onPress={changeSpeed} style={styles.speedButton}>
                  <Text style={styles.speedText}>{playSpeed}x</Text>
                </TouchableOpacity>
              </View>

              {/* Scrubber */}
              <View
                style={styles.scrubberContainer}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={(e) => {
                  setScrollEnabled(false);
                  if (isPlaying) setIsPlaying(false);
                  const fraction = Math.max(0, Math.min(1, e.nativeEvent.locationX / (SCREEN_WIDTH - 64)));
                  seekToFrame(Math.round(fraction * totalFrames));
                }}
                onResponderMove={(e) => {
                  const fraction = Math.max(0, Math.min(1, e.nativeEvent.locationX / (SCREEN_WIDTH - 64)));
                  seekToFrame(Math.round(fraction * totalFrames));
                }}
                onResponderRelease={() => setScrollEnabled(true)}
                onResponderTerminate={() => setScrollEnabled(true)}
              >
                <View style={styles.scrubberTrack}>
                  <View style={[styles.scrubberFill, { width: `${scrubberPosition * 100}%` }]} />
                </View>
                <View style={styles.scrubberThumb} pointerEvents="none">
                  <View style={[styles.scrubberDot, { left: `${scrubberPosition * 100}%` }]} />
                </View>
              </View>

              <View style={styles.frameInfo}>
                <Text style={styles.frameText}>
                  Frame {Math.round(currentFrame)} / {totalFrames}
                </Text>
                <Text style={styles.frameText}>
                  {((currentFrame / frameRate) || 0).toFixed(2)}s / {durationSeconds.toFixed(2)}s
                </Text>
              </View>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollView: { flex: 1 },
  content: { paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#6B7280', fontSize: 14 },
  motionLoading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#0A0A0A', zIndex: 10, gap: 12,
  },
  motionLoadingText: { color: '#6B7280', fontSize: 13 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  backButton: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF' },
  velocityBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6,
    backgroundColor: `${ACCENT}15`, borderWidth: 1, borderColor: `${ACCENT}30`,
  },
  velocityText: { fontSize: 14, fontWeight: '700', color: ACCENT },

  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  tabItemActive: {
    backgroundColor: 'rgba(155,221,255,0.08)',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.3)',
  },
  tabTextActive: {
    color: ACCENT,
  },

  controls: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  transportRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 16, marginBottom: 12,
  },
  controlButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  playButton: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: ACCENT,
    justifyContent: 'center', alignItems: 'center',
  },
  speedButton: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  speedText: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },

  scrubberContainer: { position: 'relative', marginBottom: 8, paddingVertical: 14 },
  scrubberTrack: {
    height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden',
  },
  scrubberFill: {
    height: '100%', backgroundColor: ACCENT, borderRadius: 2,
  },
  scrubberThumb: {
    position: 'absolute', top: 6, left: 0, right: 0, height: 20,
  },
  scrubberDot: {
    position: 'absolute', top: 0, width: 16, height: 16, borderRadius: 8,
    backgroundColor: ACCENT, marginLeft: -8, borderWidth: 2, borderColor: '#FFFFFF',
  },

  frameInfo: { flexDirection: 'row', justifyContent: 'space-between' },
  frameText: { fontSize: 10, color: '#6B7280', fontFamily: 'Courier' },
});
