/**
 * THIS SET rep bars: one bar per rep coloured by zone, with the target band
 * and the −N% drop line — both only when the set has a zone. Partial reps are
 * dimmed and labelled "—".
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RACK_COLORS, zoneColor, type RepBarView } from '../../lib/rack/viewModel';

export interface RepBarsProps {
  bars: RepBarView[];
  zone: [number, number] | null;
  dropLineV: number | null;
  dropStopPct: number | null;
  scaleV: number;
  height?: number;
}

export default function RepBars({ bars, zone, dropLineV, dropStopPct, scaleV, height = 150 }: RepBarsProps) {
  const H = height - 10;
  const y = (v: number) => (Math.min(v, scaleV) / scaleV) * H;
  return (
    <View style={[styles.bars, { height }]}>
      {zone && (
        <View style={[styles.band, { bottom: y(zone[0]), height: Math.max(y(zone[1]) - y(zone[0]), 1) }]} />
      )}
      {zone && dropLineV != null && dropStopPct != null && (
        <View style={[styles.dropln, { bottom: y(dropLineV) }]}>
          <Text style={styles.dropTxt}>−{dropStopPct}%</Text>
        </View>
      )}
      {bars.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>Lift — reps show here</Text>
        </View>
      )}
      {bars.map(b => {
        const c = b.partial ? 'rgba(255,255,255,0.12)' : zone ? zoneColor(b.zone) : '#ffffff';
        return (
          <View key={b.key} style={styles.slot}>
            <Text style={[styles.lbl, { color: b.partial ? 'rgba(255,255,255,0.35)' : zone ? zoneColor(b.zone) : '#ffffff' }]}>
              {b.label}
            </Text>
            <View style={[styles.bar, { height: Math.max(y(b.v), 8), backgroundColor: c, opacity: b.partial ? 0.5 : 1 }]} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: RACK_COLORS.line,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(155,221,255,0.07)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(155,221,255,0.35)',
  },
  dropln: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderTopColor: 'rgba(229,83,75,0.6)' },
  dropTxt: { position: 'absolute', right: 0, top: -16, fontSize: 10, fontWeight: '800', color: RACK_COLORS.red },
  empty: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { color: 'rgba(255,255,255,0.35)', fontSize: 13 },
  slot: { flex: 1, maxWidth: 54, alignItems: 'stretch', justifyContent: 'flex-end' },
  lbl: { textAlign: 'center', fontSize: 12, fontWeight: '800', marginBottom: 3, fontVariant: ['tabular-nums'] },
  bar: { borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
});
