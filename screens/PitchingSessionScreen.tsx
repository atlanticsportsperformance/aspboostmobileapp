/**
 * Pitching Session — Steel rebuild (docs/pitching-redesign-v1.html, "SESSION"
 * and "VIDEO PLAYER"). One TrackMan session: KPIs, location (3D/Zone),
 * arsenal, every chart from the previous screen, every pitch with TrackMan
 * video, and the raw horizontal-scroll table.
 *
 * Data rules: pitches without plate location stay in every view except the
 * location chart; strike % is over pitches WITH location; numbers parse with
 * Number.isFinite (0 is a value, missing is null, never 0).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { STEEL, fmt, Section, Kpi, KpiRow, ScreenHeader, Segmented, steelStyles } from '../components/hitting/steel';
import { normalizePitchType, PITCH_COLORS } from '../components/pitching/pitchColors';
import { PitchPaths3D } from '../components/dashboard/feed/three/PitchPaths3D';
import { EveryPitchTable } from '../components/pitching/EveryPitchTable';
import { TmVideoPlayer, TM_NOT_FILMED, tmClipsOf, useClipSet, type TmPlayerPitch } from '../components/pitching/TmVideoPlayer';

const { width: screenWidth } = Dimensions.get('window');
const ACCENT = STEEL.force;
const CW = screenWidth - 32;

// Strike zone (ft)
const ZB = 1.5;
const ZT = 3.5;
const ZHW = 8.5 / 12;
const BALL_R = 1.45 / 12;
const ZB_O = ZB - BALL_R;
const ZT_O = ZT + BALL_R;
const ZHW_O = ZHW + BALL_R;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface Pitch {
  id: number;
  uid: string;
  no: number;
  type: string;
  color: string;
  velo: number | null;
  spin: number | null;
  side: number | null;
  height: number | null;
  ext: number | null;
  relH: number | null;
  relS: number | null;
  ivb: number | null;
  hb: number | null;
  vaa: number | null;
  eff: number | null;
  tilt: string | null;
  stuff: number | null;
  clipId: string | null;
  fit: boolean;
}

interface SessionInfo {
  id: number;
  game_date_utc: string | null;
  created_at: string | null;
  venue_name: string | null;
}

function sessionDate(s: SessionInfo | null): Date | null {
  for (const raw of [s?.game_date_utc, s?.created_at]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1971) return d;
  }
  return null;
}

function stuffColor(v: number | null): string {
  if (v == null) return STEEL.past;
  if (v >= 110) return STEEL.good;
  if (v < 90) return STEEL.warn;
  return STEEL.text;
}

const avg = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

const isStrike = (p: Pitch) =>
  p.side != null && p.height != null && p.side >= -ZHW_O && p.side <= ZHW_O && p.height >= ZB_O && p.height <= ZT_O;

export default function PitchingSessionScreen({ navigation, route }: any) {
  const { sessionId, athleteId: passedAthleteId } = route.params;

  const [pitches, setPitches] = useState<Pitch[]>([]);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(passedAthleteId || null);
  const [locView, setLocView] = useState<'3d' | 'zone'>('3d');
  const [moveView, setMoveView] = useState<'all' | 'avg'>('all');
  const [detail, setDetail] = useState<Pitch | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const anyClipId = pitches.some((p) => p.clipId);
  const { set: clipSet, clips, notFilmed } = useClipSet(sessionId, anyClipId);

  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }
      let id = athleteId;
      if (!id) {
        const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
        if (athlete) {
          id = athlete.id;
          setAthleteId(athlete.id);
        }
      }
      if (id) await fetchSessionData(id);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, athleteId]);

  useEffect(() => {
    setLoading(true);
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function fetchSessionData(id: string) {
    const { data: session } = await supabase
      .from('trackman_session')
      .select('id, game_date_utc, created_at, venue_name')
      .eq('id', sessionId)
      .single();
    setSessionInfo(session as SessionInfo | null);

    const { data: rows } = await supabase
      .from('trackman_pitch_data')
      .select(`
        id, pitch_uid, rel_speed, spin_rate, plate_loc_height, plate_loc_side, created_at,
        tagged_pitch_type, pitch_no,
        rel_height, rel_side, extension, spin_axis, tilt, measured_tilt, vert_break, induced_vert_break,
        horz_break, vert_appr_angle, spin_axis_3d_spin_efficiency, video_clip_id, video_camera_type, a0_y
      `)
      .eq('session_id', sessionId)
      .eq('athlete_id', id)
      .order('pitch_no', { ascending: true });

    const list = (rows ?? []) as any[];
    const stuffMap: Record<string, number> = {};
    const uids = list.map((p) => p.pitch_uid).filter(Boolean);
    if (uids.length > 0) {
      const { data: sp } = await supabase.from('pitch_stuff_plus').select('pitch_uid, stuff_plus').in('pitch_uid', uids);
      (sp ?? []).forEach((r: any) => {
        const v = num(r.stuff_plus);
        if (v != null) stuffMap[r.pitch_uid] = v;
      });
    }

    setPitches(
      list.map((p, i) => {
        const type = normalizePitchType(p.tagged_pitch_type);
        const effRaw = num(p.spin_axis_3d_spin_efficiency);
        return {
          id: p.id,
          uid: p.pitch_uid ?? String(p.id),
          no: num(p.pitch_no) ?? i + 1,
          type,
          color: PITCH_COLORS[type] ?? PITCH_COLORS.Other,
          velo: num(p.rel_speed),
          spin: num(p.spin_rate),
          side: num(p.plate_loc_side),
          height: num(p.plate_loc_height),
          ext: num(p.extension),
          relH: num(p.rel_height),
          relS: num(p.rel_side),
          ivb: num(p.induced_vert_break),
          hb: num(p.horz_break),
          vaa: num(p.vert_appr_angle),
          eff: effRaw == null ? null : effRaw <= 1 ? effRaw * 100 : effRaw,
          tilt: p.measured_tilt || p.tilt || null,
          stuff: p.pitch_uid && stuffMap[p.pitch_uid] != null ? stuffMap[p.pitch_uid] : null,
          clipId: p.video_clip_id || null,
          fit: num(p.a0_y) != null,
        } as Pitch;
      }),
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    void clips(true);
    setRefreshing(false);
  };

  // ---------- derived ----------
  const located = useMemo(() => pitches.filter((p) => p.side != null && p.height != null), [pitches]);
  const strikePct = located.length ? Math.round((located.filter(isStrike).length / located.length) * 100) : null;
  const fbVelos = pitches.filter((p) => p.type === 'Fastball' || p.type === 'Sinker').map((p) => p.velo).filter((v): v is number => v != null);
  const fbMax = fbVelos.length ? Math.max(...fbVelos) : null;
  const avgStuff = avg(pitches.map((p) => p.stuff));
  const avgExt = avg(pitches.map((p) => p.ext));
  const has3d = pitches.some((p) => p.fit);
  const effectiveLoc = has3d ? locView : 'zone';

  const filmedUids = useMemo(() => {
    if (clipSet) return pitches.filter((p) => tmClipsOf(clipSet, p.uid).length > 0).map((p) => p.uid);
    return [];
  }, [clipSet, pitches]);
  const filmedSet = useMemo(() => new Set(filmedUids), [filmedUids]);

  const arsenal = useMemo(() => {
    const g: Record<string, Pitch[]> = {};
    pitches.forEach((p) => (g[p.type] ??= []).push(p));
    return Object.entries(g)
      .map(([type, ps]) => ({
        type,
        color: PITCH_COLORS[type] ?? PITCH_COLORS.Other,
        n: ps.length,
        pct: Math.round((ps.length / pitches.length) * 100),
        velo: avg(ps.map((p) => p.velo)),
        ivb: avg(ps.map((p) => p.ivb)),
        hb: avg(ps.map((p) => p.hb)),
        stuff: avg(ps.map((p) => p.stuff)),
        stuffN: ps.filter((p) => p.stuff != null).length,
      }))
      .sort((a, b) => b.n - a.n);
  }, [pitches]);

  const withStuff = pitches.filter((p) => p.stuff != null);
  const withVelo = pitches.filter((p) => p.velo != null);
  const withBreak = pitches.filter((p) => p.ivb != null && p.hb != null);
  const withRelease = pitches.filter((p) => p.relS != null && p.relH != null);

  // One Stuff+ scale for both Stuff+ charts.
  const stuffVals = [...withStuff.map((p) => p.stuff!), ...arsenal.map((a) => a.stuff).filter((v): v is number => v != null)];
  const sMin = stuffVals.length ? Math.min(80, Math.floor(Math.min(...stuffVals) / 10) * 10) : 80;
  const sMax = stuffVals.length ? Math.max(120, Math.ceil(Math.max(...stuffVals) / 10) * 10) : 120;

  const tapPitch = (p: Pitch) => {
    if (filmedSet.has(p.uid)) setPlaying(p.uid);
    else setDetail(p);
  };

  const playerPitches: TmPlayerPitch[] = useMemo(
    () => pitches.map((p) => ({ uid: p.uid, no: p.no, type: p.type, color: p.color, velo: p.velo, spin: p.spin, ivb: p.ivb, hb: p.hb, side: p.side, height: p.height })),
    [pitches],
  );

  if (loading) {
    return (
      <View style={[steelStyles.screen, styles.center]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>Loading session…</Text>
      </View>
    );
  }

  const date = sessionDate(sessionInfo);
  const title = date
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
    : 'Session';
  const subtitle = [
    sessionInfo?.venue_name || null,
    `${pitches.length} pitch${pitches.length === 1 ? '' : 'es'}`,
    filmedUids.length > 0 ? `${filmedUids.length} filmed` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={steelStyles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} colors={[ACCENT]} progressBackgroundColor="#11161d" />}
      >
        <View style={{ paddingTop: 44 }}>
          <ScreenHeader title={title} subtitle={subtitle} onBack={() => navigation.goBack()} />
        </View>

        {pitches.length === 0 ? (
          <View style={steelStyles.body}>
            <Section first>
              <Text style={steelStyles.empty}>No pitches recorded for this session.</Text>
            </Section>
          </View>
        ) : (
          <View style={steelStyles.body}>
            <Section first>
              <KpiRow>
                <Kpi label="FB MAX" value={fmt(fbMax)} color={ACCENT} />
                <Kpi label="STRIKE %" value={strikePct == null ? '—' : `${strikePct}%`} />
                <Kpi label="STUFF+" value={fmt(avgStuff, 0)} color={avgStuff == null ? STEEL.text : stuffColor(avgStuff)} />
                <Kpi label="EXT" value={fmt(avgExt)} unit="ft" />
              </KpiRow>
            </Section>

            {/* LOCATION */}
            {(located.length > 0 || has3d) && (
              <Section>
                <View style={styles.ebRow}>
                  <Text style={styles.eyebrow}>LOCATION</Text>
                  {has3d && located.length > 0 ? (
                    <View style={{ width: 120 }}>
                      <Segmented options={[{ key: '3d', label: '3D' }, { key: 'zone', label: 'Zone' }]} value={locView} onChange={setLocView} />
                    </View>
                  ) : null}
                </View>
                {effectiveLoc === '3d' ? (
                  <PitchPaths3D athleteId={athleteId} sessionId={sessionId} maxPitches={60} caption="THIS SESSION · CATCHER VIEW" />
                ) : (
                  <ZoneChart pitches={located} onTap={tapPitch} filmed={filmedSet} />
                )}
                {located.length < pitches.length ? (
                  <Text style={styles.note}>
                    {pitches.length - located.length} pitch{pitches.length - located.length === 1 ? '' : 'es'} without plate location
                    {strikePct != null ? ` · Strike % over ${located.length}` : ''}
                  </Text>
                ) : null}
              </Section>
            )}

            {/* ARSENAL */}
            <Section title="ARSENAL">
              <View style={styles.arsRow}>
                <Text style={[styles.arsH, styles.arsName]}>PITCH</Text>
                <Text style={[styles.arsH, styles.arsNum]}>%</Text>
                <Text style={[styles.arsH, styles.arsNum]}>VELO</Text>
                <Text style={[styles.arsH, styles.arsNum]}>IVB</Text>
                <Text style={[styles.arsH, styles.arsNum]}>STUFF+</Text>
              </View>
              {arsenal.map((a) => (
                <View key={a.type} style={[styles.arsRow, styles.arsLine]}>
                  <View style={[styles.arsName, styles.rowC]}>
                    <View style={[styles.dot, { backgroundColor: a.color }]} />
                    <Text style={styles.arsTd}>{a.type}</Text>
                  </View>
                  <Text style={[styles.arsTd, styles.arsNum]}>{a.pct}</Text>
                  <Text style={[styles.arsTd, styles.arsNum]}>{fmt(a.velo)}</Text>
                  <Text style={[styles.arsTd, styles.arsNum]}>{fmt(a.ivb)}</Text>
                  <Text style={[styles.arsTd, styles.arsNum, { color: stuffColor(a.stuff), fontWeight: '800' }]}>{fmt(a.stuff, 0)}</Text>
                </View>
              ))}
            </Section>

            {withStuff.length > 0 && (
              <Section title="STUFF+ BY PITCH" right="Tap a bar">
                <StuffBars pitches={withStuff} min={sMin} max={sMax} onTap={tapPitch} />
              </Section>
            )}

            {arsenal.some((a) => a.stuff != null) && (
              <Section title="AVG STUFF+ BY TYPE">
                {arsenal
                  .filter((a) => a.stuff != null)
                  .sort((x, y) => y.stuff! - x.stuff!)
                  .map((a) => {
                    const pct = Math.max(0, Math.min(100, ((a.stuff! - sMin) / (sMax - sMin)) * 100));
                    const p100 = ((100 - sMin) / (sMax - sMin)) * 100;
                    return (
                      <View key={a.type} style={{ marginBottom: 12 }}>
                        <View style={[styles.rowC, { justifyContent: 'space-between', marginBottom: 5 }]}>
                          <View style={styles.rowC}>
                            <View style={[styles.dot, { backgroundColor: a.color }]} />
                            <Text style={styles.arsTd}>{a.type}</Text>
                            <Text style={styles.mute}> ({a.stuffN})</Text>
                          </View>
                          <Text style={[styles.arsTd, { color: stuffColor(a.stuff), fontWeight: '800' }]}>{fmt(a.stuff, 0)}</Text>
                        </View>
                        <View style={styles.track}>
                          <View style={[styles.trackFill, { width: `${pct}%`, backgroundColor: a.color }]} />
                          <View style={[styles.track100, { left: `${p100}%` }]} />
                        </View>
                      </View>
                    );
                  })}
                <View style={[styles.rowC, { justifyContent: 'space-between' }]}>
                  <Text style={styles.axis}>{sMin}</Text>
                  <Text style={styles.axis}>100</Text>
                  <Text style={styles.axis}>{sMax}</Text>
                </View>
              </Section>
            )}

            {withVelo.length > 0 && (
              <Section title="VELOCITY BY PITCH" right="Tap a point">
                <VeloChart pitches={withVelo} onTap={tapPitch} />
              </Section>
            )}

            {withBreak.length > 0 && (
              <Section>
                <View style={styles.ebRow}>
                  <Text style={styles.eyebrow}>MOVEMENT</Text>
                  <View style={{ width: 120 }}>
                    <Segmented options={[{ key: 'all', label: 'All' }, { key: 'avg', label: 'Avg' }]} value={moveView} onChange={setMoveView} />
                  </View>
                </View>
                <MovementChart pitches={withBreak} mode={moveView} onTap={tapPitch} />
              </Section>
            )}

            {withRelease.length > 0 && (
              <Section title="RELEASE POINT">
                <ReleaseChart pitches={withRelease} onTap={tapPitch} />
              </Section>
            )}

            <Section>
              <EveryPitchTable
                rows={pitches.map((p) => ({ uid: p.uid, no: p.no, type: p.type, color: p.color, velo: p.velo, ivb: p.ivb, hb: p.hb }))}
                filmed={filmedSet}
                thumbOf={(uid) => tmClipsOf(clipSet, uid)[0]?.thumb ?? null}
                onPlay={(uid) => setPlaying(uid)}
                onOpenRow={() => void clips()}
              />
              {notFilmed && anyClipId ? <Text style={styles.note}>{TM_NOT_FILMED}</Text> : null}
            </Section>

            <Section title="RAW DATA" right="Scroll sideways">
              <RawTable pitches={pitches} filmed={filmedSet} onPlay={(uid) => setPlaying(uid)} />
            </Section>
          </View>
        )}
      </ScrollView>

      <PitchDetail pitch={detail} onClose={() => setDetail(null)} />

      {playing !== null ? (
        <TmVideoPlayer uid={playing} pitches={playerPitches} filmed={filmedUids} clips={clips} onMove={setPlaying} onClose={() => setPlaying(null)} />
      ) : null}
    </View>
  );
}

// ---------------- charts ----------------

function ZoneChart({ pitches, onTap, filmed }: { pitches: Pitch[]; onTap: (p: Pitch) => void; filmed: Set<string> }) {
  const W = CW;
  const H = CW * 0.9;
  const X0 = -2, X1 = 2, Y0 = 0.3, Y1 = 4.3;
  const px = (x: number) => ((x - X0) / (X1 - X0)) * W;
  const py = (y: number) => ((Y1 - y) / (Y1 - Y0)) * H;
  const zx = px(-ZHW), zw = px(ZHW) - zx, zy = py(ZT), zh = py(ZB) - zy;
  const ox = px(-ZHW_O), ow = px(ZHW_O) - ox, oy = py(ZT_O), oh = py(ZB_O) - oy;
  const r = Math.max(6, BALL_R * (W / (X1 - X0)) * 0.75);
  return (
    <View>
      <Svg width={W} height={H}>
        <Rect x={ox} y={oy} width={ow} height={oh} fill="none" stroke="#fff" strokeOpacity={0.3} strokeDasharray="6 3" />
        <Rect x={zx} y={zy} width={zw} height={zh} fill="none" stroke="#fff" strokeOpacity={0.75} strokeWidth={1.5} />
        {[1, 2].map((i) => (
          <G key={i}>
            <Line x1={zx + (zw / 3) * i} x2={zx + (zw / 3) * i} y1={zy} y2={zy + zh} stroke="#fff" strokeOpacity={0.15} />
            <Line x1={zx} x2={zx + zw} y1={zy + (zh / 3) * i} y2={zy + (zh / 3) * i} stroke="#fff" strokeOpacity={0.15} />
          </G>
        ))}
        {pitches.map((p) => (
          <Circle
            key={p.id}
            cx={Math.max(r, Math.min(W - r, px(p.side!)))}
            cy={Math.max(r, Math.min(H - r, py(p.height!)))}
            r={r}
            fill={p.color}
            stroke={filmed.has(p.uid) ? ACCENT : '#000'}
            strokeWidth={filmed.has(p.uid) ? 2 : 1}
            opacity={0.9}
            onPress={() => onTap(p)}
          />
        ))}
      </Svg>
      <Text style={styles.caption}>{filmed.size > 0 ? 'TAP A PITCH TO WATCH · CATCHER VIEW' : 'TAP A PITCH FOR DETAILS · CATCHER VIEW'}</Text>
    </View>
  );
}

const PAD = { l: 34, r: 8, t: 10, b: 28 };

function StuffBars({ pitches, min, max, onTap }: { pitches: Pitch[]; min: number; max: number; onTap: (p: Pitch) => void }) {
  const W = CW, H = 190;
  const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + ((max - v) / (max - min)) * ph;
  const ticks: number[] = [];
  for (let v = min; v <= max; v += 10) ticks.push(v);
  const sp = pw / pitches.length;
  const bw = Math.max(3, Math.min(14, sp * 0.75));
  return (
    <Svg width={W} height={H}>
      {ticks.map((v) => (
        <G key={v}>
          <Line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#fff" strokeOpacity={v === 100 ? 0.3 : 0.07} strokeDasharray={v === 100 ? '4 4' : undefined} />
          <SvgText x={PAD.l - 6} y={y(v) + 3} fill={v === 100 ? STEEL.sub : STEEL.mute} fontSize={9} textAnchor="end">{v}</SvgText>
        </G>
      ))}
      {pitches.map((p, i) => {
        const top = y(Math.max(min, Math.min(max, p.stuff!)));
        return <Rect key={p.id} x={PAD.l + i * sp + (sp - bw) / 2} y={top} width={bw} height={Math.max(0, PAD.t + ph - top)} fill={p.color} opacity={0.9} onPress={() => onTap(p)} />;
      })}
      <SvgText x={PAD.l + pw / 2} y={H - 6} fill={STEEL.mute} fontSize={9} textAnchor="middle">Pitch number</SvgText>
    </Svg>
  );
}

function VeloChart({ pitches, onTap }: { pitches: Pitch[]; onTap: (p: Pitch) => void }) {
  const W = CW, H = 190;
  const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
  const vs = pitches.map((p) => p.velo!);
  const min = Math.floor(Math.min(...vs) - 2), max = Math.ceil(Math.max(...vs) + 2);
  const x = (i: number) => PAD.l + (i / Math.max(1, pitches.length - 1)) * pw;
  const y = (v: number) => PAD.t + ((max - v) / (max - min || 1)) * ph;
  const byType: Record<string, { i: number; p: Pitch }[]> = {};
  pitches.forEach((p, i) => (byType[p.type] ??= []).push({ i, p }));
  return (
    <Svg width={W} height={H}>
      {Array.from({ length: 5 }, (_, k) => min + ((max - min) / 4) * k).map((v) => (
        <G key={v}>
          <Line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#fff" strokeOpacity={0.07} />
          <SvgText x={PAD.l - 6} y={y(v) + 3} fill={STEEL.mute} fontSize={9} textAnchor="end">{v.toFixed(0)}</SvgText>
        </G>
      ))}
      {Object.entries(byType).map(([t, pts]) => (
        <Path key={t} d={pts.map((q, k) => `${k ? 'L' : 'M'}${x(q.i)},${y(q.p.velo!)}`).join(' ')} stroke={pts[0].p.color} strokeWidth={2} fill="none" opacity={0.6} />
      ))}
      {pitches.map((p, i) => (
        <Circle key={p.id} cx={x(i)} cy={y(p.velo!)} r={4.5} fill={p.color} stroke="#000" strokeWidth={1} onPress={() => onTap(p)} />
      ))}
      <SvgText x={PAD.l + pw / 2} y={H - 6} fill={STEEL.mute} fontSize={9} textAnchor="middle">Pitch number · mph</SvgText>
    </Svg>
  );
}

function MovementChart({ pitches, mode, onTap }: { pitches: Pitch[]; mode: 'all' | 'avg'; onTap: (p: Pitch) => void }) {
  const S = CW, M = 30, R = 30;
  const p = (h: number, v: number) => ({ x: M + ((h + R) / (2 * R)) * (S - 2 * M), y: M + ((R - v) / (2 * R)) * (S - 2 * M) });
  const groups = useMemo(() => {
    const g: Record<string, { h: number; v: number; n: number; color: string }> = {};
    pitches.forEach((q) => {
      const e = (g[q.type] ??= { h: 0, v: 0, n: 0, color: q.color });
      e.h += q.hb!;
      e.v += q.ivb!;
      e.n++;
    });
    return Object.entries(g).map(([type, e]) => ({ type, h: e.h / e.n, v: e.v / e.n, n: e.n, color: e.color }));
  }, [pitches]);
  return (
    <Svg width={S} height={S}>
      {[-20, -10, 0, 10, 20].map((t) => (
        <G key={t}>
          <Line x1={p(t, 0).x} x2={p(t, 0).x} y1={M} y2={S - M} stroke="#fff" strokeOpacity={t === 0 ? 0.25 : 0.07} />
          <Line x1={M} x2={S - M} y1={p(0, t).y} y2={p(0, t).y} stroke="#fff" strokeOpacity={t === 0 ? 0.25 : 0.07} />
          <SvgText x={p(t, 0).x} y={S - M + 12} fill={STEEL.mute} fontSize={8} textAnchor="middle">{t}</SvgText>
          <SvgText x={M - 4} y={p(0, t).y + 3} fill={STEEL.mute} fontSize={8} textAnchor="end">{t}</SvgText>
        </G>
      ))}
      <SvgText x={S / 2} y={S - 4} fill={STEEL.sub} fontSize={9} fontWeight="700" textAnchor="middle">Horizontal break (in)</SvgText>
      <SvgText x={10} y={S / 2} fill={STEEL.sub} fontSize={9} fontWeight="700" textAnchor="middle" transform={`rotate(-90 10 ${S / 2})`}>Induced vertical break (in)</SvgText>
      {mode === 'all' ? (
        pitches.map((q) => {
          const c = p(Math.max(-R, Math.min(R, q.hb!)), Math.max(-R, Math.min(R, q.ivb!)));
          return <Circle key={q.id} cx={c.x} cy={c.y} r={5} fill={q.color} stroke="#000" strokeWidth={1} opacity={0.9} onPress={() => onTap(q)} />;
        })
      ) : (
        <>
          <Defs>
            {groups.map((g) => (
              <RadialGradient key={g.type} id={`mv-${g.type}`} cx="50%" cy="50%">
                <Stop offset="0%" stopColor={g.color} stopOpacity={0.7} />
                <Stop offset="60%" stopColor={g.color} stopOpacity={0.2} />
                <Stop offset="100%" stopColor={g.color} stopOpacity={0} />
              </RadialGradient>
            ))}
          </Defs>
          {groups.map((g) => {
            const c = p(g.h, g.v);
            return (
              <G key={g.type}>
                <Circle cx={c.x} cy={c.y} r={Math.min(50, 26 + g.n)} fill={`url(#mv-${g.type})`} />
                <Circle cx={c.x} cy={c.y} r={4} fill={g.color} />
                <SvgText x={c.x} y={c.y - 8} fill="#fff" fontSize={9} fontWeight="700" textAnchor="middle">{g.type}</SvgText>
              </G>
            );
          })}
        </>
      )}
    </Svg>
  );
}

function ReleaseChart({ pitches, onTap }: { pitches: Pitch[]; onTap: (p: Pitch) => void }) {
  const W = CW, H = CW * 0.8, M = 28;
  const X0 = -4, X1 = 4, Y0 = 0, Y1 = 8;
  const px = (x: number) => M + ((x - X0) / (X1 - X0)) * (W - M - 8);
  const py = (y: number) => 8 + ((Y1 - y) / (Y1 - Y0)) * (H - M - 8);
  return (
    <Svg width={W} height={H}>
      {[-4, -2, 0, 2, 4].map((x) => (
        <G key={`x${x}`}>
          <Line x1={px(x)} x2={px(x)} y1={py(Y1)} y2={py(Y0)} stroke="#fff" strokeOpacity={x === 0 ? 0.25 : 0.07} />
          <SvgText x={px(x)} y={H - M + 14} fill={STEEL.mute} fontSize={8} textAnchor="middle">{x}</SvgText>
        </G>
      ))}
      {[0, 2, 4, 6, 8].map((y) => (
        <G key={`y${y}`}>
          <Line x1={px(X0)} x2={px(X1)} y1={py(y)} y2={py(y)} stroke="#fff" strokeOpacity={0.07} />
          <SvgText x={M - 4} y={py(y) + 3} fill={STEEL.mute} fontSize={8} textAnchor="end">{y}</SvgText>
        </G>
      ))}
      <SvgText x={W / 2} y={H - 3} fill={STEEL.sub} fontSize={9} fontWeight="700" textAnchor="middle">Release side (ft)</SvgText>
      <SvgText x={9} y={H / 2} fill={STEEL.sub} fontSize={9} fontWeight="700" textAnchor="middle" transform={`rotate(-90 9 ${H / 2})`}>Release height (ft)</SvgText>
      {pitches.map((p) => (
        <Circle
          key={p.id}
          cx={px(Math.max(X0, Math.min(X1, p.relS!)))}
          cy={py(Math.max(Y0, Math.min(Y1, p.relH!)))}
          r={5}
          fill={p.color}
          stroke="#000"
          strokeWidth={1}
          opacity={0.9}
          onPress={() => onTap(p)}
        />
      ))}
    </Svg>
  );
}

// ---------------- raw table ----------------

const RAW_COLS: { k: string; w: number; v: (p: Pitch) => string; c?: (p: Pitch) => string }[] = [
  { k: 'Velo', w: 56, v: (p) => fmt(p.velo), c: () => STEEL.text },
  { k: 'Spin', w: 56, v: (p) => fmt(p.spin, 0) },
  { k: 'Tilt', w: 56, v: (p) => p.tilt ?? '—' },
  { k: 'Ext', w: 50, v: (p) => fmt(p.ext) },
  { k: 'IVB', w: 50, v: (p) => fmt(p.ivb) },
  { k: 'HB', w: 50, v: (p) => fmt(p.hb) },
  { k: 'VAA', w: 50, v: (p) => fmt(p.vaa) },
  { k: 'Spin Eff', w: 62, v: (p) => (p.eff == null ? '—' : `${Math.round(p.eff)}%`) },
  { k: 'Stuff+', w: 56, v: (p) => fmt(p.stuff, 0), c: (p) => stuffColor(p.stuff) },
  { k: 'Rel Ht', w: 56, v: (p) => fmt(p.relH, 2) },
  { k: 'Rel Side', w: 62, v: (p) => fmt(p.relS, 2) },
  { k: 'Loc X', w: 54, v: (p) => fmt(p.side, 2) },
  { k: 'Loc Y', w: 54, v: (p) => fmt(p.height, 2) },
];

function RawTable({ pitches, filmed, onPlay }: { pitches: Pitch[]; filmed: Set<string>; onPlay: (uid: string) => void }) {
  const vid = filmed.size > 0;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        <View style={[styles.rawRow, styles.rawHead]}>
          <Text style={[styles.rawH, { width: 32 }]}>#</Text>
          {vid ? <Text style={[styles.rawH, { width: 36 }]}>Vid</Text> : null}
          <Text style={[styles.rawH, { width: 90 }]}>Type</Text>
          {RAW_COLS.map((c) => (
            <Text key={c.k} style={[styles.rawH, { width: c.w, textAlign: 'right' }]}>{c.k}</Text>
          ))}
        </View>
        {pitches.map((p) => (
          <View key={p.id} style={styles.rawRow}>
            <Text style={[styles.rawTd, { width: 32, color: STEEL.sub }]}>{p.no}</Text>
            {vid ? (
              <View style={{ width: 36 }}>
                {filmed.has(p.uid) ? (
                  <Pressable onPress={() => onPlay(p.uid)} hitSlop={6}>
                    <Text style={{ color: ACCENT, fontSize: 12, fontWeight: '800' }}>▶</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <View style={[styles.rowC, { width: 90 }]}>
              <View style={[styles.dot, { backgroundColor: p.color }]} />
              <Text style={styles.rawTd} numberOfLines={1}>{p.type}</Text>
            </View>
            {RAW_COLS.map((c) => (
              <Text key={c.k} style={[styles.rawTd, { width: c.w, textAlign: 'right', color: c.c ? c.c(p) : STEEL.day }]}>{c.v(p)}</Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ---------------- detail ----------------

function PitchDetail({ pitch, onClose }: { pitch: Pitch | null; onClose: () => void }) {
  if (!pitch) return null;
  const stats: [string, string][] = [
    ['VELO', `${fmt(pitch.velo)} mph`],
    ['SPIN', pitch.spin == null ? '—' : `${Math.round(pitch.spin)} rpm`],
    ['IVB', `${fmt(pitch.ivb)}"`],
    ['HB', `${fmt(pitch.hb)}"`],
    ['EXT', `${fmt(pitch.ext)} ft`],
    ['STUFF+', fmt(pitch.stuff, 0)],
  ];
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.detail}>
          <View style={styles.rowC}>
            <View style={[styles.dot, { backgroundColor: pitch.color }]} />
            <Text style={styles.detailTitle}>
              #{pitch.no} · {pitch.type.toUpperCase()}
            </Text>
          </View>
          <View style={styles.detailGrid}>
            {stats.map(([k, v]) => (
              <View key={k} style={styles.detailCell}>
                <Text style={styles.kLabel}>{k}</Text>
                <Text style={styles.detailVal}>{v}</Text>
              </View>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: STEEL.sub, marginTop: 12, fontSize: 13 },
  ebRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  eyebrow: { color: '#e5e7eb', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  note: { color: STEEL.mute, fontSize: 11, marginTop: 10 },
  caption: { color: '#46505c', fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 6 },
  rowC: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  mute: { color: STEEL.mute, fontSize: 11 },
  arsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  arsLine: { borderTopWidth: 1, borderTopColor: STEEL.rule },
  arsH: { color: STEEL.mute, fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },
  arsName: { flex: 1.4 },
  arsNum: { flex: 0.7, textAlign: 'right' },
  arsTd: { color: STEEL.text, fontSize: 12.5, fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: STEEL.card, overflow: 'hidden' },
  trackFill: { height: 8, borderRadius: 4, opacity: 0.9 },
  track100: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.5)' },
  axis: { color: STEEL.mute, fontSize: 9 },
  rawRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: STEEL.rule },
  rawHead: { borderTopWidth: 0 },
  rawH: { color: STEEL.mute, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8, paddingHorizontal: 4 },
  rawTd: { color: STEEL.day, fontSize: 12, fontVariant: ['tabular-nums'], paddingHorizontal: 4 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
  detail: { backgroundColor: STEEL.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: STEEL.hair },
  detailTitle: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, rowGap: 12 },
  detailCell: { width: '33.33%' },
  kLabel: { color: STEEL.mute, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  detailVal: { color: '#fff', fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
