import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { fetchPitchDetail, isHittingDetail, type MocapPitchDetail } from '../lib/mocap/api';
import { STEEL, Segmented, fmt, steelStyles } from '../components/hitting/steel';
import MotionStage, { type MotionStageHandle } from '../components/mocap/MotionStage';
import { ReportTab, EnergyTab, useMocapScores } from '../components/mocap/report';

type Tab = 'motion' | 'report' | 'energy';
const TABS: { key: Tab; label: string }[] = [
  { key: 'motion', label: 'Motion' },
  { key: 'report', label: 'Report' },
  { key: 'energy', label: 'Energy' },
];
const PITCH_ACCENT = STEEL.purple; // #a78bfa
const HIT_ACCENT = STEEL.hitting; // #fb923c

function capTier(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function backLabel(sessionDate?: string): string {
  if (!sessionDate) return 'Sessions';
  const d = new Date(sessionDate.length <= 10 ? `${sessionDate}T12:00:00` : sessionDate);
  if (isNaN(d.getTime())) return 'Sessions';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MocapPitchDetailScreen({ navigation, route }: any) {
  // sessionDate / category are optional nav params; the API doesn't return the date.
  const { athleteId, pitchId, sessionDate } = route.params;
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<MocapPitchDetail | null>(null);
  const [tab, setTab] = useState<Tab>('motion');
  const [scrollLocked, setScrollLocked] = useState(false);
  const stageRef = useRef<MotionStageHandle>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigation.replace('Login'); return; }
      const res = await fetchPitchDetail(athleteId, pitchId, session.access_token);
      if (mounted.current) setDetail(res);
    } catch (error) {
      console.error('Error loading pitch detail:', error);
      Alert.alert('Error', 'Failed to load pitch data');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [athleteId, pitchId, navigation]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { if (mounted.current) setRefreshing(false); }
  }, [load]);

  const hitting = isHittingDetail(detail) || /hitting/.test(route.params?.category ?? '');
  const accent = hitting ? HIT_ACCENT : PITCH_ACCENT;

  const onSelectEvent = useCallback((e: string) => {
    setTab('motion');
    stageRef.current?.jumpTo(e);
  }, []);

  if (loading || !detail) {
    return (
      <View style={[steelStyles.screen, styles.center, { paddingTop: insets.top }]}>
        {loading ? (
          <>
            <ActivityIndicator size="large" color={accent} />
            <Text style={styles.loadingText}>Loading biomechanics data...</Text>
          </>
        ) : (
          <Pressable onPress={() => navigation.goBack()}>
            <Text style={styles.loadingText}>Couldn't load this capture. ‹ Back</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <DetailBody
      detail={detail}
      hitting={hitting}
      accent={accent}
      tab={tab}
      setTab={setTab}
      back={backLabel(sessionDate)}
      onBack={() => navigation.goBack()}
      topInset={insets.top}
      refreshing={refreshing}
      onRefresh={onRefresh}
      scrollLocked={scrollLocked}
      setScrollLocked={setScrollLocked}
      stageRef={stageRef}
      onSelectEvent={onSelectEvent}
    />
  );
}

/** Split out so useMocapScores always runs with a loaded detail. */
function DetailBody(props: {
  detail: MocapPitchDetail;
  hitting: boolean;
  accent: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  back: string;
  onBack: () => void;
  topInset: number;
  refreshing: boolean;
  onRefresh: () => void;
  scrollLocked: boolean;
  setScrollLocked: (b: boolean) => void;
  stageRef: React.RefObject<MotionStageHandle | null>;
  onSelectEvent: (e: string) => void;
}) {
  const { detail, hitting, accent, tab } = props;
  const p = detail.pitch;
  const scores = useMocapScores(detail);

  const title = hitting ? `Swing #${p.pitchNumber ?? ''}` : `${p.pitchType || 'Pitch'} #${p.pitchNumber ?? ''}`;
  const tierNode = scores?.tier && scores.composite != null ? (
    <Text style={{ fontWeight: '700', color: scores.tier.color }}>
      {capTier(scores.tier.label)} {Math.round(scores.composite)}
    </Text>
  ) : hitting ? (
    <Text style={{ fontWeight: '700', color: STEEL.mute }}>no cohort</Text>
  ) : (
    <Text>—</Text>
  );

  return (
    <View style={[steelStyles.screen, { paddingTop: props.topInset }]}>
      <ScrollView
        scrollEnabled={!props.scrollLocked}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={props.refreshing} onRefresh={props.onRefresh} tintColor={accent} colors={[accent]} />
        }
      >
        <View style={styles.hdr}>
          <Pressable onPress={props.onBack} hitSlop={10} style={styles.back}>
            <Text style={styles.backText}>‹ {props.back}</Text>
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {hitting ? (
              <>
                {fmt(p.batSpeed, 1)} mph bat · {fmt(p.exitVelo, 1)} mph EV · {tierNode}
              </>
            ) : (
              <>
                {fmt(p.velocity, 1)} mph · {tierNode}
                {p.cameraCount != null ? ` · ${p.cameraCount} cams` : ''}
              </>
            )}
          </Text>
        </View>

        <View style={styles.seg}>
          <Segmented options={TABS} value={tab} onChange={props.setTab} />
        </View>

        {/* Motion stays mounted so switching tabs doesn't reload the stage. */}
        <View style={tab === 'motion' ? null : styles.gone}>
          <MotionStage
            ref={props.stageRef}
            detail={detail}
            accent={accent}
            active={tab === 'motion'}
            onScrollLock={props.setScrollLocked}
          />
        </View>
        {tab === 'report' && (
          <View style={styles.tabBody}><ReportTab detail={detail} accent={accent} /></View>
        )}
        {tab === 'energy' && <View style={styles.tabBody}><EnergyTab detail={detail} accent={accent} /></View>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBody: { paddingHorizontal: 16 },
  center: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: STEEL.mute, fontSize: 14 },
  hdr: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, gap: 4 },
  back: { paddingVertical: 6, alignSelf: 'flex-start' },
  backText: { color: STEEL.sub, fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -0.6, lineHeight: 35 },
  subtitle: { color: STEEL.sub, fontSize: 13.5, fontWeight: '500' },
  seg: { marginTop: 12, marginHorizontal: 16 },
  gone: { height: 0, overflow: 'hidden' },
});
