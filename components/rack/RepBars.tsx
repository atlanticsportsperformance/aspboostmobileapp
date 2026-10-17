/**
 * THIS SET rep bars: one bar per rep (zone colour; red at/past the speed-drop
 * stop), with the target band and the −N% drop line — both only when the set
 * has a zone. Partial reps are dimmed and labelled "—". Fills its card: the
 * bar height comes from the measured height (at least `minHeight`).
 */

import React, { memo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { RACK_COLORS, repColor, type RepBarView } from '../../lib/rack/viewModel';

export interface RepBarsProps {
  bars: RepBarView[];
  zone: [number, number] | null;
  dropLineV: number | null;
  dropStopPct: number | null;
  scaleV: number;
  minHeight?: number;
}

/** iOS draws non-uniform dashed borders solid — dash the band edges with SVG. */
function Dashed({ bottom }: { bottom: number }) {
  return (
    <Svg height={1} width="100%" style={[styles.dash, { bottom }]}>
      <Line x1="0" y1="0.5" x2="100%" y2="0.5" stroke="rgba(155,221,255,0.35)" strokeWidth={1} strokeDasharray="3,3" />
    </Svg>
  );
}

function RepBars({ bars, zone, dropLineV, dropStopPct, scaleV, minHeight = 90 }: RepBarsProps) {
  const [measured, setMeasured] = useState(150);
  const height = Math.max(minHeight, measured);
  const H = height - 20; // room for the value label above the tallest bar
  const y = (v: number) => (Math.min(v, scaleV) / scaleV) * H;
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== measured) setMeasured(h);
  };
  return (
    <View style={[styles.bars, { minHeight }]} onLayout={onLayout}>
      {zone && (
        <>
          <View style={[styles.band, { bottom: y(zone[0]), height: Math.max(y(zone[1]) - y(zone[0]), 1) }]} />
          <Dashed bottom={y(zone[0])} />
          <Dashed bottom={y(zone[1])} />
        </>
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
        const c = repColor(b, !!zone);
        return (
          <View key={b.key} style={styles.slot}>
            <Text style={[styles.lbl, { color: b.partial ? 'rgba(255,255,255,0.35)' : c }]}>{b.label}</Text>
            <View style={[styles.bar, { height: Math.max(y(b.v), 8), backgroundColor: c, opacity: b.partial ? 0.5 : 1 }]} />
          </View>
        );
      })}
    </View>
  );
}

export default memo(RepBars);

const styles = StyleSheet.create({
  bars: {
    flex: 1,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: RACK_COLORS.line,
    overflow: 'hidden',
  },
  band: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(155,221,255,0.07)' },
  dash: { position: 'absolute', left: 0, right: 0 },
  dropln: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderTopColor: 'rgba(229,83,75,0.6)' },
  dropTxt: { position: 'absolute', right: 0, top: -16, fontSize: 10, fontWeight: '800', color: RACK_COLORS.red },
  empty: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  emptyTxt: { color: 'rgba(255,255,255,0.35)', fontSize: 13 },
  slot: { flex: 1, maxWidth: 54, alignItems: 'stretch', justifyContent: 'flex-end' },
  lbl: { textAlign: 'center', fontSize: 12, fontWeight: '800', marginBottom: 3, fontVariant: ['tabular-nums'] },
  bar: { borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
});
