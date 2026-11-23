/**
 * TrackMan pitch video — the session's clip set plus the full-screen player.
 * Ported from Ghost Super App (apps/mobile/components-tm-video.tsx and
 * packages/api/src/trackman/player.ts): same open speed (¼×), same frame step,
 * same filmed-pitch wrap, same "set rate after play()" iOS quirk.
 *
 * The clip set is asked for once per session from
 * GET /api/trackman/video-token?session=<trackman_session.id> with the user's
 * Supabase token, and again when it is within 60 s of expiresAt.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../../lib/supabase';
import { STEEL, fmt } from '../hitting/steel';

const API_URL = 'https://aspboostapp.vercel.app';

// ---------- pure helpers (from ghost packages/api/src/trackman/player.ts) ----------

export interface TmClip {
  pitchUid: string;
  videoClipId: string;
  cameraType: string | null;
  url: string;
  thumb: string;
  framerate?: number | null;
}
export interface TmClipSet {
  expiresAt: string | null;
  clips: TmClip[];
}

export const TM_RATES = [1, 0.5, 0.25, 0.125] as const;
export const TM_RATE_LABELS = ['1×', '½×', '¼×', '⅛×'] as const;
export const TM_RATE_OPEN = 0.25;
export const TM_CLIP_EARLY_MS = 60_000;
const FALLBACK_FPS = 30;

export function tmFrameStep(framerate: number | null | undefined): number {
  return 1 / (framerate != null && framerate > 0 ? framerate : FALLBACK_FPS);
}

export function tmStepFilmed(filmed: readonly string[], uid: string | null, step: number): string | null {
  if (filmed.length === 0) return null;
  const i = uid === null ? -1 : filmed.indexOf(uid);
  if (i === -1) return filmed[step < 0 ? filmed.length - 1 : 0]!;
  return filmed[(i + step + filmed.length * Math.abs(step)) % filmed.length]!;
}

export function tmClipsOf(set: TmClipSet | null, uid: string): TmClip[] {
  return set === null ? [] : set.clips.filter((c) => c.pitchUid === uid);
}

export function tmClipSetStale(set: TmClipSet | null, now: number): boolean {
  if (set === null) return true;
  if (set.expiresAt === null) return false;
  return Date.parse(set.expiresAt) - now <= TM_CLIP_EARLY_MS;
}

export function tmClipClock(s: number): string {
  const t = Math.max(0, Number.isFinite(s) ? s : 0);
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
}

export function tmSwipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) <= 50 || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

export const TM_NOT_FILMED = 'TrackMan did not film this session.';
export const TM_CLIP_FAILED = 'This clip did not load. Close it and open it again.';

// ---------- clip set hook ----------

/**
 * The session's clip set. `enabled` false (no pitch has a clip id) never calls
 * the route. `clips(force)` returns the cached set unless stale or forced.
 */
export function useClipSet(sessionId: string | number | null | undefined, enabled: boolean) {
  const cur = useRef<TmClipSet | null>(null);
  const inflight = useRef<Promise<TmClipSet | null> | null>(null);
  const [set, setSet] = useState<TmClipSet | null>(null);
  const [notFilmed, setNotFilmed] = useState(false);

  const ask = useCallback(async (): Promise<TmClipSet | null> => {
    if (sessionId == null) return null;
    const url = `${API_URL}/api/trackman/video-token?session=${encodeURIComponent(String(sessionId))}`;
    for (let tries = 0; tries < 2; tries++) {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (r.status === 404) {
          setNotFilmed(true);
          return { expiresAt: null, clips: [] };
        }
        if (r.ok) {
          const j = await r.json();
          return { expiresAt: j?.expiresAt ?? null, clips: Array.isArray(j?.clips) ? j.clips : [] };
        }
      } catch {
        /* asked again once */
      }
    }
    return null;
  }, [sessionId]);

  const clips = useCallback(
    (force = false): Promise<TmClipSet | null> => {
      if (!enabled) return Promise.resolve(null);
      if (!force && cur.current !== null && !tmClipSetStale(cur.current, Date.now())) return Promise.resolve(cur.current);
      if (inflight.current !== null) return inflight.current;
      const p = ask().then((s) => {
        inflight.current = null;
        if (s !== null) {
          cur.current = s;
          setSet(s);
        }
        return s;
      });
      inflight.current = p;
      return p;
    },
    [ask, enabled],
  );

  useEffect(() => {
    cur.current = null;
    setSet(null);
    setNotFilmed(false);
    if (enabled) void clips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, enabled]);

  return { set, clips, notFilmed };
}

// ---------- player ----------

/** What the player shows for a pitch. */
export interface TmPlayerPitch {
  uid: string;
  no: number;
  type: string;
  color: string;
  velo: number | null;
  spin: number | null;
  ivb: number | null;
  hb: number | null;
  side: number | null;
  height: number | null;
}

export function TmVideoPlayer({
  uid,
  pitches,
  filmed,
  clips,
  onMove,
  onClose,
}: {
  uid: string;
  pitches: TmPlayerPitch[];
  filmed: string[];
  clips: (force?: boolean) => Promise<TmClipSet | null>;
  onMove: (uid: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const row = pitches.find((p) => p.uid === uid) ?? null;
  const [clip, setClip] = useState<TmClip | null>(null);
  const [failed, setFailed] = useState(false);
  const [rate, setRate] = useState<number>(TM_RATE_OPEN);
  const [playing, setPlaying] = useState(false);
  const [locked, setLocked] = useState(false);
  const showAt = useRef<((cur: number) => void) | null>(null);
  const retried = useRef(false);
  const wantPlay = useRef(true);
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const player = useVideoPlayer(null, (p) => {
    p.muted = true;
    p.loop = false;
    p.timeUpdateEventInterval = 0.05;
  });

  useEffect(() => {
    let gone = false;
    retried.current = false;
    setFailed(false);
    setClip(null);
    void (async () => {
      const set = await clips();
      if (gone) return;
      const mine = tmClipsOf(set, uid);
      if (mine.length === 0) setFailed(true);
      else setClip(mine[0]!);
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (clip === null) return;
    let gone = false;
    void player
      .replaceAsync({ uri: clip.url })
      .then(() => {
        if (gone || !wantPlay.current) return;
        player.play();
        // Set after play: on iOS a rate set while paused starts the clip.
        player.playbackRate = rateRef.current;
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [clip, player]);

  useEffect(() => {
    const subs = [
      player.addListener('playingChange', (e) => setPlaying(e.isPlaying)),
      player.addListener('statusChange', (e) => {
        if (e.status !== 'error' || clip === null) return;
        if (retried.current) {
          setFailed(true);
          return;
        }
        retried.current = true;
        void clips(true).then((set) => {
          const again = tmClipsOf(set, uid).find((x) => x.videoClipId === clip.videoClipId);
          if (again === undefined) setFailed(true);
          else setClip(again);
        });
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player, clip, clips, uid]);

  const play = () => {
    wantPlay.current = true;
    const dur = player.duration || 0;
    if (dur > 0 && player.currentTime >= dur - 0.05) player.currentTime = 0;
    player.play();
    player.playbackRate = rateRef.current;
  };
  const toggle = () => {
    if (player.playing) {
      wantPlay.current = false;
      player.pause();
    } else play();
  };
  const step = (d: number) => {
    wantPlay.current = false;
    player.pause();
    const dur = player.duration || 0;
    const next = Math.max(0, Math.min(dur, player.currentTime + d * tmFrameStep(clip?.framerate)));
    player.currentTime = next;
    showAt.current?.(next);
  };
  const speed = (r: number) => {
    setRate(r);
    rateRef.current = r;
    if (player.playing) player.playbackRate = r;
  };
  const move = (d: number) => {
    const next = tmStepFilmed(filmed, uid, d);
    if (next !== null && next !== uid) {
      wantPlay.current = true;
      onMove(next);
    }
  };
  const moveRef = useRef(move);
  moveRef.current = move;
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => setLocked(true),
        onPanResponderRelease: (_e, g) => {
          setLocked(false);
          const s = tmSwipeStep(g.dx, g.dy);
          if (s !== 0) moveRef.current(s);
        },
        onPanResponderTerminate: () => setLocked(false),
      }),
    [],
  );

  const pos = filmed.indexOf(uid);
  const rateLabel = TM_RATE_LABELS[TM_RATES.indexOf(rate as (typeof TM_RATES)[number])] ?? '';
  const fps = clip?.framerate != null && clip.framerate > 0 ? Math.round(clip.framerate * rate) : null;
  const color = row?.color ?? STEEL.force;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} supportedOrientations={['portrait']}>
      <ScrollView style={fs.screen} contentContainerStyle={{ paddingBottom: 30 + insets.bottom }} scrollEnabled={!locked}>
        <View style={[fs.bar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={10} style={fs.ibtn} accessibilityRole="button" accessibilityLabel="Close video">
            <Text style={fs.ibtnText}>✕</Text>
          </Pressable>
          <Text style={fs.pos}>
            {pos + 1} of {filmed.length} with video
          </Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={fs.vwrap} {...swipe.panHandlers}>
          <VideoView player={player} style={{ flex: 1 }} contentFit="cover" nativeControls={false} />
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)']} style={fs.grad} />
          <Pressable onPress={toggle} style={fs.tap} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'}>
            {playing ? null : (
              <View style={fs.bigplay}>
                <Text style={fs.bigplayText}>▶</Text>
              </View>
            )}
          </Pressable>
          {filmed.length > 1 ? (
            <>
              <Pressable onPress={() => move(-1)} style={[fs.edge, { left: 0 }]} accessibilityLabel="Previous filmed pitch">
                <Text style={fs.edgeText}>‹</Text>
              </Pressable>
              <Pressable onPress={() => move(1)} style={[fs.edge, { right: 0 }]} accessibilityLabel="Next filmed pitch">
                <Text style={fs.edgeText}>›</Text>
              </Pressable>
            </>
          ) : null}
          <View pointerEvents="none" style={fs.rate}>
            <Text style={fs.rateText}>
              {rateLabel}
              {fps != null ? ` · ${fps} FPS` : ''}
            </Text>
          </View>
          {row ? (
            <View pointerEvents="none" style={fs.ov}>
              <View style={fs.tp}>
                <View style={[fs.tpDot, { backgroundColor: color }]} />
                <Text style={fs.tpText}>
                  #{row.no} · {row.type.toUpperCase()}
                </Text>
              </View>
              <Text style={fs.big}>
                {fmt(row.velo)}
                <Text style={fs.bigUnit}> mph</Text>
              </Text>
              <Text style={fs.ovSub}>
                {row.spin != null ? `${Math.round(row.spin).toLocaleString()} rpm · ` : ''}IVB {fmt(row.ivb)} · HB {fmt(row.hb)}
              </Text>
            </View>
          ) : null}
          {failed ? (
            <View pointerEvents="none" style={fs.failWrap}>
              <Text style={fs.fail}>{TM_CLIP_FAILED}</Text>
            </View>
          ) : null}
        </View>

        <TmScrub key={uid} player={player} setLocked={setLocked} showAt={showAt} resume={play} />

        <View style={fs.ctrls}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pressable onPress={() => step(-1)} style={fs.ibtn} accessibilityLabel="Back one frame">
              <Text style={fs.ibtnText}>◂</Text>
            </Pressable>
            <Pressable onPress={toggle} style={fs.ibtn} accessibilityLabel={playing ? 'Pause' : 'Play'}>
              <Text style={fs.ibtnText}>{playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable onPress={() => step(1)} style={fs.ibtn} accessibilityLabel="Forward one frame">
              <Text style={fs.ibtnText}>▸</Text>
            </Pressable>
          </View>
          <View style={fs.speed}>
            {TM_RATES.map((r, i) => (
              <Pressable key={r} onPress={() => speed(r)} style={[fs.spd, i === 0 ? null : fs.spdLine, r === rate ? fs.spdOn : null]} accessibilityState={{ selected: r === rate }}>
                <Text style={[fs.spdText, r === rate ? { color: '#000' } : null]}>{TM_RATE_LABELS[i]}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {row && row.side != null && row.height != null ? (
          <View style={fs.zoneSec}>
            <Text style={fs.eyebrow}>THIS PITCH</Text>
            <MiniZone side={row.side} height={row.height} color={color} />
          </View>
        ) : null}
        <Text style={fs.hint}>Swipe or ‹ › for prev/next filmed pitch · tap to pause</Text>
      </ScrollView>
    </Modal>
  );
}

/** A small catcher-view zone with one pitch. */
function MiniZone({ side, height, color }: { side: number; height: number; color: string }) {
  const W = 200;
  const H = 150;
  const X0 = -2, X1 = 2, Y0 = 0.5, Y1 = 4.5;
  const px = (x: number) => ((x - X0) / (X1 - X0)) * W;
  const py = (y: number) => ((Y1 - y) / (Y1 - Y0)) * H;
  const hw = 8.5 / 12;
  const zx = px(-hw), zw = px(hw) - px(-hw), zy = py(3.5), zh = py(1.5) - py(3.5);
  const cx = Math.max(6, Math.min(W - 6, px(side)));
  const cy = Math.max(6, Math.min(H - 6, py(height)));
  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={W} height={H}>
        <Rect x={zx} y={zy} width={zw} height={zh} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.5} />
        {[1, 2].map((i) => (
          <React.Fragment key={i}>
            <Line x1={zx + (zw / 3) * i} x2={zx + (zw / 3) * i} y1={zy} y2={zy + zh} stroke="#fff" strokeOpacity={0.15} />
            <Line x1={zx} x2={zx + zw} y1={zy + (zh / 3) * i} y2={zy + (zh / 3) * i} stroke="#fff" strokeOpacity={0.15} />
          </React.Fragment>
        ))}
        <Circle cx={cx} cy={cy} r={7} fill={color} stroke="#fff" strokeWidth={1.5} />
      </Svg>
      <Text style={fs.zoneCap}>
        {height.toFixed(1)} ft high · {Math.abs(side).toFixed(1)} ft {side < 0 ? 'left' : 'right'}
      </Text>
    </View>
  );
}

/** Scrubber + clock; owns the clip time so the 20 Hz tick redraws only this. */
function TmScrub({
  player,
  setLocked,
  showAt,
  resume,
}: {
  player: ReturnType<typeof useVideoPlayer>;
  setLocked: (on: boolean) => void;
  showAt: { current: ((cur: number) => void) | null };
  resume: () => void;
}) {
  const [t, setT] = useState({ cur: 0, dur: 0 });
  const dragging = useRef(false);
  const wasPlaying = useRef(false);
  const w = useRef(1);
  useEffect(() => {
    showAt.current = (cur) => setT({ cur, dur: player.duration || 0 });
    const subs = [
      player.addListener('timeUpdate', (e) => {
        if (!dragging.current) setT({ cur: e.currentTime, dur: player.duration || 0 });
      }),
      player.addListener('statusChange', (e) => {
        if (e.status === 'readyToPlay') setT({ cur: player.currentTime, dur: player.duration || 0 });
      }),
    ];
    return () => {
      showAt.current = null;
      subs.forEach((s) => s.remove());
      if (dragging.current) {
        setLocked(false);
      }
    };
  }, [player, showAt, setLocked]);
  const seek = (x: number) => {
    const dur = player.duration || 0;
    if (dur <= 0) return;
    const cur = Math.max(0, Math.min(1, x / w.current)) * dur;
    player.currentTime = cur;
    setT({ cur, dur });
  };
  const end = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setLocked(false);
    if (wasPlaying.current) resume();
  };
  const pc = t.dur > 0 ? Math.min(100, (t.cur / t.dur) * 100) : 0;
  return (
    <>
      <View
        style={fs.scrub}
        onLayout={(e) => {
          w.current = Math.max(1, e.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          dragging.current = true;
          wasPlaying.current = player.playing;
          if (wasPlaying.current) player.pause();
          setLocked(true);
          seek(e.nativeEvent.locationX);
        }}
        onResponderMove={(e) => seek(e.nativeEvent.locationX)}
        onResponderRelease={end}
        onResponderTerminate={end}
      >
        <View pointerEvents="none" style={fs.trk} />
        <View pointerEvents="none" style={[fs.fill, { width: `${pc}%` }]} />
        <View pointerEvents="none" style={[fs.knob, { left: `${pc}%` }]} />
      </View>
      <View style={fs.times}>
        <Text style={fs.time}>{tmClipClock(t.cur)}</Text>
        <Text style={fs.time}>{tmClipClock(t.dur)}</Text>
      </View>
    </>
  );
}

const fs = StyleSheet.create({
  screen: { flex: 1, backgroundColor: STEEL.bg },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10 },
  ibtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: STEEL.hair, backgroundColor: STEEL.card, alignItems: 'center', justifyContent: 'center' },
  ibtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  pos: { color: STEEL.sub, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  vwrap: { width: '100%', aspectRatio: 1, backgroundColor: '#000', overflow: 'hidden' },
  grad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  tap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bigplay: { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  bigplayText: { color: '#fff', fontSize: 24 },
  edge: { position: 'absolute', top: '50%', marginTop: -30, width: 40, height: 60, alignItems: 'center', justifyContent: 'center' },
  edgeText: { color: '#fff', opacity: 0.7, fontSize: 34, fontWeight: '300' },
  rate: { position: 'absolute', left: 12, top: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.5)' },
  rateText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  ov: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  tp: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tpDot: { width: 8, height: 8, borderRadius: 4 },
  tpText: { color: STEEL.sub, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  big: { color: '#fff', fontSize: 38, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  bigUnit: { color: STEEL.sub, fontSize: 12, fontWeight: '700' },
  ovSub: { color: STEEL.sub, fontSize: 11.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  failWrap: { position: 'absolute', top: 44, left: 14, right: 14 },
  fail: { color: STEEL.day, fontSize: 13, fontWeight: '600' },
  scrub: { height: 28, marginHorizontal: 14, marginTop: 6 },
  trk: { position: 'absolute', left: 0, right: 0, top: 12, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)' },
  fill: { position: 'absolute', left: 0, top: 12, height: 4, borderRadius: 2, backgroundColor: STEEL.force },
  knob: { position: 'absolute', top: 7, width: 14, height: 14, marginLeft: -7, borderRadius: 7, backgroundColor: '#fff' },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 14 },
  time: { color: STEEL.mute, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  ctrls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  speed: { flexDirection: 'row', borderRadius: 999, overflow: 'hidden', backgroundColor: STEEL.card, padding: 3 },
  spd: { width: 42, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  spdLine: {},
  spdOn: { backgroundColor: STEEL.force },
  spdText: { color: STEEL.sub, fontSize: 13, fontWeight: '800' },
  zoneSec: { marginHorizontal: 16, paddingTop: 18, borderTopWidth: 1, borderTopColor: STEEL.hair, marginTop: 6 },
  eyebrow: { color: '#e5e7eb', fontSize: 11, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },
  zoneCap: { color: STEEL.mute, fontSize: 11, fontWeight: '600', marginTop: 6 },
  hint: { color: STEEL.mute, fontSize: 11, marginHorizontal: 16, marginTop: 14 },
});
