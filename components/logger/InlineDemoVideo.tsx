import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Linking, useWindowDimensions } from 'react-native';
import YoutubePlayer, { type YoutubeIframeRef } from 'react-native-youtube-iframe';
import { LOGGER_COLORS } from '../../lib/logger/theme';

const SIDE = 16;
// Origin for the local player HTML (YouTube rejects embeds with no referrer).
const PLAYER_BASE_URL = 'https://aspboostapp.vercel.app';

// Collapsed/expanded is remembered for the app session (module state), so a
// collapsed demo stays collapsed on the next exercise.
let collapsedThisSession = false;

// Inline demo at the top of the exercise screen: a "▶ DEMO" strip over a
// muted, looping 16:9 player (full width minus 16 px margins). Tapping the
// strip collapses the player to the strip. While the keypad is open the
// player is hidden and paused (kept mounted so it doesn't reload).
// A non-YouTube link shows only the strip, which opens the link.
export default function InlineDemoVideo({
  videoId,
  url,
  keypadOpen,
}: {
  videoId: string | null;
  url: string;
  keypadOpen: boolean;
}) {
  const win = useWindowDimensions();
  const W = Math.max(0, win.width - SIDE * 2 - 2); // inside the 1 px border
  const H = Math.round(W * (9 / 16));
  const [collapsed, setCollapsed] = useState(collapsedThisSession);
  const toggle = () => {
    if (!videoId) {
      Linking.openURL(url.trim()).catch(() => {});
      return;
    }
    collapsedThisSession = !collapsed;
    setCollapsed(!collapsed);
  };
  const hidden = collapsed || keypadOpen;

  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  // Flipped on a beat after the player is ready, so the library posts mute
  // first and then a fresh playVideo — autoplay (muted) on iOS.
  const [playing, setPlaying] = useState(false);
  // Delay mounting the WebView a beat (same mount workaround as before).
  const [shouldRenderPlayer, setShouldRenderPlayer] = useState(false);
  const playerRef = useRef<YoutubeIframeRef | null>(null);
  useEffect(() => {
    setVideoError(false);
    setVideoReady(false);
    setPlaying(false);
    setShouldRenderPlayer(false);
    const t = setTimeout(() => setShouldRenderPlayer(true), 100);
    return () => clearTimeout(t);
  }, [videoId]);
  useEffect(() => {
    if (!videoReady) return;
    const t = setTimeout(() => setPlaying(true), 150);
    return () => clearTimeout(t);
  }, [videoReady]);

  const onChangeState = useCallback((state: string) => {
    // loop + playlist handles the loop; restart by hand if it still ends.
    if (state === 'ended') playerRef.current?.seekTo(0, true);
  }, []);
  const playList = useMemo(() => (videoId ? [videoId] : []), [videoId]);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.strip}
        onPress={toggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={!videoId ? 'Open demo video' : collapsed ? 'Show demo video' : 'Hide demo video'}
      >
        <Text style={styles.stripText}>▶ DEMO</Text>
        {!!videoId && <Text style={styles.stripChev}>{collapsed ? 'show' : 'hide'}</Text>}
      </TouchableOpacity>
      {!!videoId && (
        <View
          style={[styles.video, hidden ? styles.videoHidden : { width: W, height: H }]}
          pointerEvents={hidden ? 'none' : 'auto'}
        >
          {videoError ? (
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`).catch(() => {})}
              accessibilityLabel="Watch on YouTube"
            >
              <Image
                source={{ uri: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
              <View style={styles.center}>
                <Text style={styles.watchText}>▶ Watch on YouTube</Text>
              </View>
            </TouchableOpacity>
          ) : shouldRenderPlayer ? (
            <YoutubePlayer
              ref={playerRef}
              height={H}
              width={W}
              play={playing && !hidden}
              mute
              videoId={videoId}
              playList={playList}
              // Library-typed params only. Looping a single video needs loop +
              // a one-item playlist.
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
              // Local HTML parses the library's JSON play/mute messages; the
              // https base URL gives YouTube the referrer embeds require.
              useLocalHTML
              baseUrlOverride={PLAYER_BASE_URL}
              webViewProps={{
                allowsInlineMediaPlayback: true,
                mediaPlaybackRequiresUserAction: false,
              }}
            />
          ) : null}
          {!videoReady && !videoError && (
            <View style={[styles.center, styles.loading]} pointerEvents="none">
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          )}
          {/* Taps land here, never on the iframe, so YouTube's overlay stays asleep. */}
          {!videoError && <View style={StyleSheet.absoluteFill} />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: SIDE,
    marginTop: 6,
    marginBottom: 10,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.25)',
    backgroundColor: '#111214',
  },
  strip: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  stripText: {
    color: LOGGER_COLORS.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  stripChev: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
  },
  video: {
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  videoHidden: {
    height: 0,
    opacity: 0,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    backgroundColor: '#1A1A1A',
  },
  loadingText: {
    color: '#737373',
    fontSize: 14,
  },
  watchText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
