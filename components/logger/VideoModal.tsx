import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Modal,
  Pressable,
  useWindowDimensions,
  Linking,
} from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';

// Full-screen exercise demo modal. Extracted unchanged from block-overview so
// the exercise screen's floating window can open the same one via ⤢.
export default function VideoModal({
  videoId,
  onClose,
}: {
  videoId: string | null;
  onClose: () => void;
}) {
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const { width: screenWidth } = useWindowDimensions();
  const videoWidth = Math.min(screenWidth - 48, 400);
  const videoHeight = videoWidth * (9 / 16);

  // Fresh player state for every open / video change.
  useEffect(() => {
    setVideoPlaying(false);
    setVideoReady(false);
    setVideoError(false);
  }, [videoId]);

  const onVideoStateChange = useCallback((state: string) => {
    if (state === 'ended') {
      setVideoPlaying(false);
    }
  }, []);

  const onVideoReady = useCallback(() => {
    setVideoReady(true);
  }, []);

  const onVideoError = useCallback(() => {
    setVideoError(true);
  }, []);

  return (
    <Modal
      visible={!!videoId}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.videoModalBackdrop}
        onPress={onClose}
      >
        <Pressable style={styles.videoModalContainer} onPress={() => {}}>
          {/* Close Button */}
          <TouchableOpacity
            style={styles.videoModalClose}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.videoModalCloseText}>✕</Text>
          </TouchableOpacity>

          {/* Video Player */}
          {videoId && (
            videoError ? (
              // Fallback: Thumbnail that opens YouTube app
              <TouchableOpacity
                style={[styles.videoModalPlayer, { width: videoWidth, height: videoHeight }]}
                onPress={() => {
                  Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`);
                  onClose();
                }}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` }}
                  style={styles.videoModalThumbnail}
                  resizeMode="cover"
                />
                <View style={styles.videoModalPlayOverlay}>
                  <View style={styles.videoModalPlayButton}>
                    <Text style={styles.videoModalPlayIcon}>▶</Text>
                  </View>
                  <Text style={styles.videoModalWatchText}>Watch on YouTube</Text>
                </View>
              </TouchableOpacity>
            ) : (
              // YouTube Player
              <View style={[styles.videoModalPlayer, { width: videoWidth, height: videoHeight }]}>
                {!videoReady && (
                  <View style={styles.videoModalLoading}>
                    <Text style={styles.videoModalLoadingText}>Loading video...</Text>
                  </View>
                )}
                <YoutubePlayer
                  height={videoHeight}
                  width={videoWidth}
                  play={videoPlaying}
                  videoId={videoId}
                  onChangeState={onVideoStateChange}
                  onReady={onVideoReady}
                  onError={onVideoError}
                  webViewProps={{
                    allowsInlineMediaPlayback: true,
                    mediaPlaybackRequiresUserAction: false,
                  }}
                />
              </View>
            )
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  videoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoModalContainer: {
    alignItems: 'center',
    padding: 16,
  },
  videoModalClose: {
    position: 'absolute',
    top: -40,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  videoModalCloseText: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  videoModalPlayer: {
    backgroundColor: '#000000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  videoModalLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    zIndex: 1,
  },
  videoModalLoadingText: {
    color: '#737373',
    fontSize: 14,
  },
  videoModalThumbnail: {
    width: '100%',
    height: '100%',
  },
  videoModalPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoModalPlayButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoModalPlayIcon: {
    fontSize: 24,
    color: '#FFFFFF',
    marginLeft: 4,
  },
  videoModalWatchText: {
    marginTop: 8,
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
