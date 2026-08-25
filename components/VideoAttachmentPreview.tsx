import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { attachmentUrl } from '../lib/messagesApi';

interface Props {
  attachment: {
    storage_path?: string;
    thumbnail_path?: string;
    file_name: string;
    duration_seconds?: number;
  };
  authHeaders: Record<string, string>;
  onPress: () => void;
}

function formatDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function VideoAttachmentPreview({ attachment, authHeaders, onPress }: Props) {
  const poster = attachment.thumbnail_path
    ? attachmentUrl(attachment.thumbnail_path)
    : null;
  const duration = formatDuration(attachment.duration_seconds);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.container}>
      {poster ? (
        <Image
          source={{ uri: poster, headers: authHeaders }}
          style={styles.poster}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.poster, styles.posterFallback]} />
      )}

      <View style={styles.playBadge}>
        <Text style={styles.playIcon}>▶</Text>
      </View>

      {duration && (
        <View style={styles.durationPill}>
          <Text style={styles.durationText}>{duration}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { width: 220, height: 124, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  poster: { width: '100%', height: '100%' },
  posterFallback: { backgroundColor: '#1a1a1a' },
  playBadge: {
    position: 'absolute', top: '50%', left: '50%',
    marginTop: -22, marginLeft: -22,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  playIcon: { color: '#fff', fontSize: 18, marginLeft: 3 },
  durationPill: {
    position: 'absolute', right: 8, bottom: 8,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.7)',
  },
  durationText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});
