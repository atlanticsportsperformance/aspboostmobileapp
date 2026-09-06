import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
// Lazy require: on an app binary built before expo-video shipped, a top-level
// import crashes every screen that renders this modal. A stale binary gets a
// plain "update the app" sheet instead.
let ExpoVideo: typeof import('expo-video') | null = null;
try {
  ExpoVideo = require('expo-video');
} catch {
  ExpoVideo = null;
}

interface Props {
  // Callers must pass an already-resolved, directly-playable URL (e.g. from
  // `resolveAttachmentDirectUrl`), never the `/api/messages/attachments/...`
  // endpoint URL. See the carry-forward ruling for Task 14: expo-video's
  // player is not trusted to carry an Authorization header through that
  // endpoint's 302 redirect, so handing it the endpoint URL directly 401s.
  uri: string | null;
  visible: boolean;
  onClose: () => void;
}

function NativePlayer({ uri }: { uri: string }) {
  const { useVideoPlayer, VideoView } = ExpoVideo!;
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      allowsFullscreen
      contentFit="contain"
    />
  );
}

export function VideoPlayerModal({ uri, visible, onClose }: Props) {
  return (
    <Modal visible={visible && !!uri} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="Close video">
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>

        {uri && ExpoVideo && <NativePlayer uri={uri} />}
        {uri && !ExpoVideo && (
          <Text style={styles.fallback}>Video playback needs an app update — install the latest build to watch this here.</Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  video: { width: '100%', aspectRatio: 16 / 9 },
  closeButton: {
    position: 'absolute', top: 56, right: 20, zIndex: 10,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeIcon: { color: '#fff', fontSize: 16 },
  fallback: { color: '#9CA3AF', fontSize: 15, textAlign: 'center', paddingHorizontal: 32, lineHeight: 22 },
});
