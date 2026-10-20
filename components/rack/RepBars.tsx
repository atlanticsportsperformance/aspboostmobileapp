/**
 * THIS SET rep bars: one bar per rep (zone colour; red at/past the speed-drop
 * stop), with the target band and the −N% drop line — both only when the set
 * has a zone. Partial reps are dimmed and labelled "—". Fills its card: the
 * bar height comes from the measured height, clamped to it (never drawn
 * outside the card; `minHeight` is only the layout's planning number).
 *
 * Power (rack-power.html), only when the load is known (`showWatts`):
 *   - 'speed': the bars as above + a small "### W" under each bar;
 *   - 'power': bars scaled by watts (faint white), the watts on top; no band.
 * A tap on a bar → `onPressBar` (the remove-rep sheet).
 */

import React, { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { RACK_COLORS, repColor, type RepBarView } from '../../lib/rack/viewModel';

export type BarsMetric = 'speed' | 'power';

export interface RepBarsProps {
  bars: RepBarView[];
  zone: [number, number] | null;
  dropLineV: number | null;
  dropStopPct: number | null;
  scaleV: number;
  /** Layout planning minimum (kept for callers; the bars never force it). */
  minHeight?: number;
  /** The load is known: watts under the bars / the power view. */
  showWatts?: boolean;
  metric?: BarsMetric;
  onPressBar?: (bar: RepBarView) => void;
}

/** iOS draws non-uniform dashed borders solid — dash the band edges with SVG. */
function Dashed({ bottom }: { bottom: number }) {
  return (
    <Svg height={1} width="100%" style={[styles.dash, { bottom }]}>
      <Line x1="0" y1="0.5" x2="100%" y2="0.5" stroke="rgba(155,221,255,0.35)" strokeWidth={1} strokeDasharray="3,3" />
    </Svg>
  );
}

const W_LABEL_H = 15;

function RepBars({ bars, zone, dropLineV, dropStopPct, scaleV, showWatts = false, metric = 'speed', onPressBar }: RepBarsProps) {
  // The bars area's MEASURED size (re-measured on every layout change, e.g. a
  // rotation — the screen also remounts this on an orientation change). 0 =
  // not measured yet: draw no bars rather than size them from a stale value.
  const [measured, setMeasured] = useState(0);
  const power = showWatts && metric === 'power';
  const wattsUnder = showWatts && !power;
  const H = Math.max(0, measured - 20 - (wattsUnder ? W_LABEL_H : 0)); // room for the value label (+ the W line)
  const base = wattsUnder ? W_LABEL_H : 0;
  const pMax = Math.max(1, ...bars.map(b => b.watts ?? 0)) * 1.15;
  const y = (v: number) => (Math.min(Math.max(v, 0), scaleV) / scaleV) * H;
  const yp = (w: number) => (Math.min(Math.max(w, 0), pMax) / pMax) * H;
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== measured) setMeasured(h);
  };
  return (
    // No minHeight here: a minimum taller than the card would push the bars out
    // of it. The card clips (overflow hidden); every bar is ≤ the measured height.
    <View style={styles.bars} onLayout={onLayout}>
      {!power && zone && (
        <>
          <View style={[styles.band, { bottom: base + y(zone[0]), height: Math.max(y(zone[1]) - y(zone[0]), 1) }]} />
          <Dashed bottom={base + y(zone[0])} />
          <Dashed bottom={base + y(zone[1])} />
        </>
      )}
      {!power && zone && dropLineV != null && dropStopPct != null && (
        <View style={[styles.dropln, { bottom: base + y(dropLineV) }]}>
          <Text style={styles.dropTxt}>−{dropStopPct}%</Text>
        </View>
      )}
      {bars.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTxt}>{power ? 'Lift — watts show here' : 'Lift — reps show here'}</Text>
        </View>
      )}
      {measured > 0 && bars.map(b => {
        const c = power ? (b.partial ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.85)') : repColor(b, !!zone);
        const h = Math.min(H, power ? Math.max(yp(b.watts ?? 0), 8) : Math.max(y(b.v), 8));
        const top = power ? (b.partial || b.watts == null ? '—' : String(b.watts)) : b.label;
        const topColor = b.partial ? 'rgba(255,255,255,0.35)' : power ? 'rgba(255,255,255,0.9)' : c;
        return (
          <Pressable
            key={b.key}
            style={styles.slot}
            onPress={onPressBar ? () => onPressBar(b) : undefined}
            disabled={!onPressBar}
            accessibilityLabel={`Rep ${b.repNo}`}
          >
            <Text style={[styles.lbl, { color: topColor }]}>{top}</Text>
            <View style={[styles.bar, { height: h, backgroundColor: c, opacity: b.partial ? 0.5 : 1 }]} />
            {wattsUnder && <Text style={styles.pw}>{b.watts != null ? `${b.watts} W` : ''}</Text>}
          </Pressable>
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
  pw: { height: W_LABEL_H, textAlign: 'center', fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.45)', paddingTop: 2, fontVariant: ['tabular-nums'] },
});
