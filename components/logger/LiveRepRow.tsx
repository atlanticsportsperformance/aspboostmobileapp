// The live strip under the current set row: "RACK 3 · LIVE" (or
// "SENSOR · LIVE" for the phone-direct sensor, Task 10b) followed by one chip
// per rep — zone blue in zone, red slow, faint white fast / no zone, dashed
// "part" for a partial. Source-agnostic: pass chips from chipViews().

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RACK_COLORS, liveTag, type ChipView, type LiveSource } from '../../lib/rack/phoneView';

export interface LiveRepRowProps {
  source: LiveSource;
  /** Rack name ("Rack 3"); ignored for 'sensor'. */
  rackName?: string | null;
  chips: ChipView[];
}

export default function LiveRepRow({ source, rackName = null, chips }: LiveRepRowProps) {
  return (
    <View style={styles.live}>
      <View style={styles.tag}>
        <Text style={styles.tagText}>{liveTag(source, rackName)}</Text>
      </View>
      {chips.length === 0 ? (
        <Text style={styles.hint}>Lift — reps land here</Text>
      ) : (
        chips.map(c => (
          <View
            key={c.key}
            style={[
              styles.chip,
              { backgroundColor: c.backgroundColor },
              c.dashedBorder ? { borderWidth: 1, borderStyle: 'dashed', borderColor: c.dashedBorder } : null,
            ]}
          >
            <Text style={[styles.chipText, { color: c.color }]}>{c.label}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  live: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 48,
    paddingRight: 16,
    paddingBottom: 12,
  },
  tag: {
    borderWidth: 1,
    borderColor: RACK_COLORS.tagBorder,
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginRight: 2,
  },
  tagText: { color: RACK_COLORS.zone, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  chip: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7 },
  chipText: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hint: { color: RACK_COLORS.hint, fontSize: 11 },
});
