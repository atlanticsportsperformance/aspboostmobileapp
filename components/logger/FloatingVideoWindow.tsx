import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Animated,
  PanResponder,
  Linking,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import YoutubePlayer, { type YoutubeIframeRef } from 'react-native-youtube-iframe';
import { LOGGER_COLORS } from '../../lib/logger/theme';

const WIN_W = 230;
const VIDEO_H = Math.round(WIN_W * (9 / 16));
const HANDLE_H = 14;
const WIN_H = VIDEO_H + HANDLE_H;
const MARGIN = 8;
// Origin for the local player HTML (YouTube rejects embeds with no referrer).
const PLAYER_BASE_URL = 'https://aspboostapp.vercel.app';

export const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max));

// Floating, draggable, looping demo window. The wrapper fills the screen but
// passes every touch outside the window through (box-none), so logging keeps
// working underneath it.
export default function FloatingVideoWindow({
  videoId,
  title,
  bottom,
  keypadOpen,
  onClose,
  onExpand,
}: {
  videoId: string;
  title: string;
  /** Initial distance from the bottom of the screen (sits above the bar). */
  bottom: number;
  /** While the numeric keypad is open the window collapses (hidden, paused,
   *  muted) so it never covers Log Set or the set rows; it comes back where
   *  it was when the keypad closes. */
  keypadOpen: boolean;
  onClose: () => void;
  onExpand: () => void;
}) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Real bounds of the overlay once laid out; window dimensions until then.
  const [bounds, setBounds] = useState({ w: win.width, h: win.height });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBounds({ w: width, h: height });
  };

  // Keep clear of the status bar when the overlay reaches the top edge
  // (zero when the overlay already starts below the top inset).
  const topInset = Math.max(0, insets.top - (win.height - bounds.h));
  const limits = useMemo(() => ({
    minX: MARGIN,
    maxX: bounds.w - WIN_W - MARGIN,
    minY: MARGIN + topInset,
    maxY: bounds.h - WIN_H - MARGIN - insets.bottom,
  }), [bounds.w, bounds.h, insets.bottom, topInset]);
  const hidden = keypadOpen;
  const limitsRef = useRef(limits);
  limitsRef.current = limits;

  const pos = useRef({ x: bounds.w - WIN_W - 12, y: bounds.h - bottom - WIN_H });
  const pan = useRef(new Animated.ValueXY(pos.current)).current;
  const start = useRef(pos.current);
  const moved = useRef(false);
  // Until the athlete drags it, the window stays docked above the bar.
  const dragged = useRef(false);

  // pos = the athlete's (or docked) home spot, clamped to the screen.
  const place = useCallback((x: number, y: number) => {
    const l = limitsRef.current;
    pos.current = { x: clamp(x, l.minX, l.maxX), y: clamp(y, l.minY, l.maxY) };
    pan.setValue(pos.current);
  }, [pan]);

  // Keep the window on screen when the bounds change (layout, rotation).
  useEffect(() => {
    if (!dragged.current) {
      const x = bounds.w - WIN_W - 12;
      const y = bounds.h - bottom - WIN_H;
      const l = limits;
      pos.current = { x: clamp(x, l.minX, l.maxX), y: clamp(y, l.minY, l.maxY) };
    } else {
      const l = limits;
      pos.current = { x: clamp(pos.current.x, l.minX, l.maxX), y: clamp(pos.current.y, l.minY, l.maxY) };
    }
    pan.setValue(pos.current);
  }, [limits, pan, bounds.w, bounds.h, bottom]);

  const [videoError, setVideoError] = useState(false);
  // Gym audio: demos start muted; the header toggle unmutes.
  const [muted, setMuted] = useState(true); // muted
  const openOnYouTube = () => {
    Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`).catch(() => {});
  };
  const errorRef = useRef(false);
  errorRef.current = videoError;
  const tapRef = useRef(openOnYouTube);
  tapRef.current = openOnYouTube;

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      start.current = { x: pos.current.x, y: pos.current.y };
      moved.current = false;
    },
    onPanResponderMove: (_e, g) => {
      if (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3) moved.current = dragged.current = true;
      place(start.current.x + g.dx, start.current.y + g.dy);
    },
    onPanResponderRelease: () => {
      // A tap (no drag) on the failed-player poster opens YouTube.
      if (!moved.current && errorRef.current) tapRef.current();
    },
  }), [place]);

  // Delay mounting the WebView a beat (same mount workaround as before).
  const [shouldRenderPlayer, setShouldRenderPlayer] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [progress, setProgress] = useState(0);
  // Flipped on a beat after the player is ready, so the library posts
  // mute first and then a fresh playVideo — autoplay (muted) on iOS.
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<YoutubeIframeRef | null>(null);
  useEffect(() => {
    setVideoError(false);
    setVideoReady(false);
    setPlaying(false);
    setProgress(0);
    setShouldRenderPlayer(false);
    const t = setTimeout(() => setShouldRenderPlayer(true), 100);
    return () => clearTimeout(t);
  }, [videoId]);

  useEffect(() => {
    if (!videoReady) return;
    const t = setTimeout(() => setPlaying(true), 150);
    return () => clearTimeout(t);
  }, [videoReady]);

  // Progress line — poll the player while it's up.
  useEffect(() => {
    if (!videoReady || videoError || hidden) return;
    const t = setInterval(async () => {
      try {
        const p = playerRef.current;
        if (!p) return;
        const [cur, dur] = await Promise.all([p.getCurrentTime(), p.getDuration()]);
        if (dur > 0) setProgress(Math.min(1, Math.max(0, cur / dur)));
      } catch {
        // player went away mid-poll — ignore
      }
    }, 500);
    return () => clearInterval(t);
  }, [videoReady, videoError, hidden]);

  const onChangeState = useCallback((state: string) => {
    // loop + playlist handles the loop; restart by hand if it still ends.
    if (state === 'ended') playerRef.current?.seekTo(0, true);
  }, []);
  const playList = useMemo(() => [videoId], [videoId]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onLayout}>
      <Animated.View
        style={[styles.window, { opacity: hidden ? 0 : 1, transform: pan.getTranslateTransform() }]}
        pointerEvents={hidden ? 'none' : 'auto'}
      >
        <View style={styles.video}>
          {videoError ? (
            <Image
              source={{ uri: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : shouldRenderPlayer ? (
            <YoutubePlayer
              ref={playerRef}
              height={VIDEO_H}
              width={WIN_W}
              play={playing && !hidden}
              mute={muted || hidden}
              videoId={videoId}
              playList={playList}
              // Library-typed params only (the branding flag is deprecated by
              // YouTube and not in InitialPlayerParams). Looping a single
              // video needs loop + a one-item playlist.
              initialPlayerParams={{
                loop: true,
                controls: false,
                rel: false,
                iv_load_policy: 3,
                preventFullScreen: true,
              }}
              onReady={() => setVideoReady(true)}
              onError={() => setVideoError(true)}
              onChangeState={onChangeState}
              // The library's default hosted page (iframe_v2.html) matches
              // the raw message string, but v2.4.1 posts JSON — so play/mute
              // never reached the player (no autoplay, poster + YouTube title
              // stayed up). Its local HTML parses the JSON; the https base
              // URL gives YouTube the referrer embeds require.
              useLocalHTML
              baseUrlOverride={PLAYER_BASE_URL}
              webViewProps={{
                allowsInlineMediaPlayback: true,
                mediaPlaybackRequiresUserAction: false,
              }}
            />
          ) : null}
          {!videoReady && !videoError && (
            <View style={styles.loading} pointerEvents="none">
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          )}

          {/* Top shade dims YouTube's own title/channel strip under ours. */}
          <LinearGradient
            colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0)']}
            style={styles.topShade}
            pointerEvents="none"
          />
          {/* Shade + drag surface over the (control-less) player. Taps land
              here, never on the iframe, so YouTube's overlay doesn't wake. */}
          <View style={styles.surface} {...responder.panHandlers}>
            {videoError && <Text style={styles.watchText}>▶ Watch on YouTube</Text>}
          </View>

          <Text style={styles.title} numberOfLines={1} pointerEvents="none">
            {(title ?? '').toUpperCase()} · DEMO
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setMuted((m) => !m)}
              hitSlop={6}
              accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
            >
              <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={12} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={onExpand}
              hitSlop={6}
              accessibilityLabel="Full screen video"
            >
              <Text style={styles.actionText}>⤢</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={onClose}
              hitSlop={6}
              accessibilityLabel="Close video"
            >
              <Text style={styles.actionText}>✕</Text>
            </TouchableOpacity>
          </View>
          {!videoError && (
            <View style={styles.track} pointerEvents="none">
              <View style={[styles.fill, { width: `${progress * 100}%` }]} />
            </View>
          )}
        </View>
        <View style={styles.handleRow} {...responder.panHandlers}>
          <View style={styles.handle} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: WIN_W,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.75,
    shadowRadius: 20,
    elevation: 12,
  },
  video: {
    width: WIN_W,
    height: VIDEO_H,
    backgroundColor: '#000000',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1A1A',
  },
  loadingText: {
    color: '#737373',
    fontSize: 11,
  },
  topShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 44,
  },
  surface: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  title: {
    position: 'absolute',
    top: 7,
    left: 8,
    right: 88,
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  actions: {
    position: 'absolute',
    top: 4,
    right: 6,
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 11,
  },
  track: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    borderRadius: 999,
    backgroundColor: LOGGER_COLORS.accent,
  },
  handleRow: {
    height: HANDLE_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 28,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
});
