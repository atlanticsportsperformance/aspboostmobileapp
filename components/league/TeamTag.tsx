/**
 * TeamTag — per-game team-side pill for ACDL surfaces.
 *
 * ACDL has no fixed teams; Navy vs White reshuffles every game. This pill
 * shows which side the athlete is on FOR THAT GAME (my_team_name).
 *
 *   Navy  → navy bg, cream text
 *   White → cream bg, navy text, navy hairline border
 *   Other → ACDL sky-blue bg, dark text
 *   null  → muted "TBA" pill with dashed border (sides not yet assigned)
 *
 * Sizes:
 *   "sm" — tight inline badge (schedule rows, game-log rows, day-cards)
 *   "md" — prominent pill (Next Game card, Hub snapshot)
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { teamPillStyle } from '../../lib/leagueFormat';

interface TeamTagProps {
  name: string | null | undefined;
  size?: 'sm' | 'md';
}

export default function TeamTag({ name, size = 'sm' }: TeamTagProps) {
  const { bg, text, border } = teamPillStyle(name);
  const label = name ? name.toUpperCase() : 'TBA';
  const isMd = size === 'md';
  const isTba = !name;

  return (
    <View
      style={[
        styles.pill,
        isMd ? styles.pillMd : styles.pillSm,
        { backgroundColor: bg },
        border
          ? {
              borderWidth: isTba ? 1 : 1,
              borderColor: border,
              // Dashed borders aren't natively supported in RN — use a solid
              // thin hairline for TBA; it reads clearly as "not yet set".
              borderStyle: isTba ? 'dashed' : 'solid',
            }
          : null,
      ]}
    >
      <Text
        style={[
          styles.label,
          isMd ? styles.labelMd : styles.labelSm,
          { color: text },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  pillSm: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillMd: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  label: {
    fontWeight: '900',
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
  },
  labelSm: {
    fontSize: 10,
  },
  labelMd: {
    fontSize: 14,
  },
});
