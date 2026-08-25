import React from 'react';
import { View, StyleSheet } from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { WebView } from 'react-native-webview';

const YOUTUBE_RE = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
const VIMEO_RE = /vimeo\.com\/(?:.*\/)?(\d+)/;

export function LinkEmbed({ url }: { url: string }) {
  const yt = url.match(YOUTUBE_RE);
  if (yt?.[1]) {
    return (
      <View style={styles.container}>
        <YoutubePlayer height={124} width={220} videoId={yt[1]} play={false} />
      </View>
    );
  }

  const vimeo = url.match(VIMEO_RE);
  if (vimeo?.[1]) {
    return (
      <View style={styles.container}>
        <WebView
          source={{ uri: `https://player.vimeo.com/video/${vimeo[1]}` }}
          style={styles.web}
          allowsFullscreenVideo
        />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { width: 220, height: 124, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  web: { flex: 1 },
});
