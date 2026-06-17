import React from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { acdlInkAlpha } from './acdlTheme';

interface AcdlCrestProps {
  size: number;
}

/**
 * AcdlCrest — circular-clipped ACDL crest image.
 *
 * The source PNG has a white background (no transparency). We clip it to a
 * circle with borderRadius = size/2 to match the website's CSS:
 *   .crest { border-radius: 50%; object-fit: cover; }
 *
 * A 1px faint navy ring gives it definition on both light (cream) and dark
 * (FAB) backgrounds.
 */
export function AcdlCrest({ size }: AcdlCrestProps) {
  const radius = size / 2;
  return (
    <View
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: radius,
        },
      ]}
    >
      <Image
        source={require('../../assets/acdl-crest.png')}
        style={{ width: size, height: size, borderRadius: radius }}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    borderWidth: 1,
    borderColor: acdlInkAlpha(0.18), // faint navy, reads on both cream & dark
    overflow: 'hidden',
  },
});
