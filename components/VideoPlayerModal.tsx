import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

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

export function VideoPlayerModal({ uri, visible, onClose }: Props) {
  const player = useVideoPlayer(uri ?? '', (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <Modal visible={visible && !!uri} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="Close video">
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>

        {uri && (
          <VideoView
            player={player}
            style={styles.video}
            nativeControls
            allowsFullscreen
            contentFit="contain"
          />
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
});
