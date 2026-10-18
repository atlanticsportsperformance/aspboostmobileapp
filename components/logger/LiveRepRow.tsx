// The live strip under the current set row: "RACK 3 · LIVE" (or
// "SENSOR · LIVE" for the phone-direct sensor, Task 10b) followed by one chip
// per rep — zone blue in zone, red slow, faint white fast / no zone, dashed
// "part" for a partial — and "avg ### W" when the load is known. Also the
// chips of a SAVED rack row (no tag). Long-press a chip → remove that rep.
// Source-agnostic: pass chips from chipViews().

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { RACK_COLORS, liveTag, type ChipView, type LiveSource } from '../../lib/rack/phoneView';

export interface LiveRepRowProps {
  source: LiveSource;
  /** Rack name ("Rack 3"); ignored for 'sensor'. */
  rackName?: string | null;
  chips: ChipView[];
  /** "avg 612 W" (only with a known load). */
  powerText?: string | null;
  /** false = a saved row's chips (no LIVE tag, no "Lift" hint). */
  live?: boolean;
  /** Long-press a chip → the remove-rep sheet. */
  onLongPressChip?: (chip: ChipView) => void;
}

export default function LiveRepRow({ source, rackName = null, chips, powerText = null, live = true, onLongPressChip }: LiveRepRowProps) {
  return (
    <View style={[styles.live, !live && styles.saved]}>
      {live && (
        <View style={styles.tag}>
          <Text style={styles.tagText}>{liveTag(source, rackName)}</Text>
        </View>
      )}
      {chips.length === 0 && live ? (
        <Text style={styles.hint}>Lift — reps land here</Text>
      ) : (
        chips.map(c => (
          <Pressable
            key={c.key}
            onLongPress={onLongPressChip ? () => onLongPressChip(c) : undefined}
            delayLongPress={350}
            disabled={!onLongPressChip}
            accessibilityLabel={`Rep ${c.repNo} ${c.label} — long-press to remove`}
            style={[
              styles.chip,
              { backgroundColor: c.backgroundColor },
              c.dashedBorder ? { borderWidth: 1, borderStyle: 'dashed', borderColor: c.dashedBorder } : null,
            ]}
          >
            <Text style={[styles.chipText, { color: c.color }]}>{c.label}</Text>
          </Pressable>
        ))
      )}
      {!!powerText && chips.length > 0 && <Text style={styles.power}>{`· ${powerText}`}</Text>}
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
  saved: { paddingBottom: 8 },
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
  power: { color: RACK_COLORS.muted, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
