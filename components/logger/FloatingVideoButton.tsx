import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { LOGGER_COLORS } from '../../lib/logger/theme';
import { hasVideo, videoThumb } from '../../lib/video';

// Floating ▶ that opens the exercise demo window. Sits bottom-right, just
// above the bottom bar. Shows the YouTube frame as a small rounded tile with
// ▶ over it when one exists; plain ▶ otherwise; nothing when there's no video.
export default function FloatingVideoButton({
  url,
  bottom,
  onPress,
}: {
  url: string | null | undefined;
  bottom: number;
  onPress: () => void;
}) {
  if (!hasVideo(url)) return null;
  const thumb = videoThumb(url);

  return (
    <TouchableOpacity
      style={[styles.button, thumb ? styles.tile : styles.round, { bottom }]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Play exercise demo video"
    >
      {thumb ? (
        <>
          <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
          <View style={styles.thumbShade}>
            <Text style={styles.playIcon}>▶</Text>
          </View>
        </>
      ) : (
        <Text style={styles.playIcon}>▶</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 16,
    width: 52,
    height: 52,
    backgroundColor: '#16181B',
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 45,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
  round: {
    borderRadius: 26,
  },
  tile: {
    borderRadius: 14,
  },
  thumb: {
    ...StyleSheet.absoluteFillObject,
  },
  thumbShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    color: LOGGER_COLORS.accent,
    fontSize: 16,
    marginLeft: 2,
  },
});
