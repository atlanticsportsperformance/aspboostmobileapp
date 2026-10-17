/**
 * Chrome velocity dial (port of rack-live.html `drawGauge`). 270° sweep from
 * 135°, ticks, a zone band (only with a zone), and the value arc. Each new
 * rep counts up over ~550 ms; the arc is white while counting and takes the
 * rep's colour when it lands (zone colour; red at/past the speed-drop stop;
 * white without a zone). Partial reps are dimmed and read "—".
 *
 * The bezel + ticks are a memoised static layer; only the arc and the number
 * re-render per frame.
 */

import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import type { Zone } from '../../lib/ovr/protocol';
import { RACK_COLORS, repColor, zoneWord } from '../../lib/rack/viewModel';

export const COUNT_UP_MS = 550;

const CX = 150;
const CY = 150;
const R = 128;
const START = 135;
const SWEEP = 270;

const pt = (a: number, r: number): [number, number] => [
  CX + r * Math.cos((a * Math.PI) / 180),
  CY + r * Math.sin((a * Math.PI) / 180),
];

function arc(a0: number, a1: number, r: number): string {
  const [x0, y0] = pt(a0, r);
  const [x1, y1] = pt(a1, r);
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export interface DialRep {
  key: string;
  v: number;
  partial: boolean;
  zone: Zone | null;
  dropCue: boolean;
}

export interface RingDialProps {
  /** Newest rep (null = no set on screen). */
  rep: DialRep | null;
  zone: [number, number] | null;
  /** Top of the scale (m/s). */
  scaleV: number;
  size?: number;
}

/** Bezel, face, ticks, zone band, track, scale labels — static per zone/scale/size. */
const DialBase = memo(function DialBase({ zone, scaleV, size }: { zone: [number, number] | null; scaleV: number; size: number }) {
  const ticks = [];
  for (let i = 0; i <= 27; i++) {
    const a = START + (SWEEP * i) / 27;
    const major = i % 3 === 0;
    const [x0, y0] = pt(a, 122);
    const [x1, y1] = pt(a, major ? 110 : 115);
    ticks.push(
      <Line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)'} strokeWidth={major ? 2.5 : 1.5} />,
    );
  }
  const za = zone ? START + SWEEP * Math.min(zone[0] / scaleV, 1) : 0;
  const zb = zone ? START + SWEEP * Math.min(zone[1] / scaleV, 1) : 0;
  const [l0x, l0y] = pt(START, 92);
  const [l1x, l1y] = pt(START + SWEEP, 92);
  return (
    <Svg width={size} height={size} viewBox="0 0 300 300" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="ch" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#f4f6f8" />
          <Stop offset="0.35" stopColor="#7d8288" />
          <Stop offset="0.55" stopColor="#e6e9ec" />
          <Stop offset="1" stopColor="#43474c" />
        </LinearGradient>
        <RadialGradient id="fc" cx="0.5" cy="0.42" r="0.6">
          <Stop offset="0" stopColor="#1b1e22" />
          <Stop offset="1" stopColor="#0a0b0d" />
        </RadialGradient>
      </Defs>
      <Circle cx={150} cy={150} r={148} fill="url(#ch)" />
      <Circle cx={150} cy={150} r={139} fill="#090a0b" />
      <Circle cx={150} cy={150} r={133} fill="url(#fc)" />
      {ticks}
      {zone && <Path d={arc(za, Math.max(zb, za + 0.5), R - 30)} stroke="rgba(155,221,255,0.35)" strokeWidth={12} fill="none" />}
      <Path d={arc(START, START + SWEEP, R - 30)} stroke="rgba(255,255,255,0.05)" strokeWidth={12} fill="none" />
      <SvgText x={l0x} y={l0y + 14} fill="rgba(255,255,255,0.4)" fontSize={11} textAnchor="middle">
        0
      </SvgText>
      <SvgText x={l1x} y={l1y + 14} fill="rgba(255,255,255,0.4)" fontSize={11} textAnchor="middle">
        {scaleV.toFixed(1)}
      </SvgText>
    </Svg>
  );
});

function RingDial({ rep, zone, scaleV, size = 300 }: RingDialProps) {
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  const [landed, setLanded] = useState(true);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    const id = anim.addListener(({ value }) => setShown(value));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    if (!rep) {
      lastKey.current = null;
      anim.stopAnimation();
      anim.setValue(0);
      setShown(0);
      setLanded(true);
      return;
    }
    if (rep.key === lastKey.current) return;
    lastKey.current = rep.key;
    if (rep.partial) return; // not counted: the arc keeps the previous full rep
    setLanded(false);
    anim.stopAnimation();
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: rep.v,
      duration: COUNT_UP_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setLanded(true);
    });
  }, [rep, anim]);

  const v = shown;
  const partial = !!rep?.partial;
  const arcColor = landed && rep && !rep.partial ? repColor(rep, !!zone) : '#ffffff';
  const va = START + SWEEP * Math.min(v / scaleV, 1);

  let caption = zone ? `zone ${zone[0].toFixed(2)}–${zone[1].toFixed(2)}` : '';
  let captionColor = 'rgba(155,221,255,0.9)';
  if (partial) {
    caption = 'PARTIAL — not counted';
    captionColor = 'rgba(255,255,255,0.4)';
  } else if (rep && landed && zone && rep.zone) {
    caption = rep.dropCue ? 'SPEED DROPPED' : zoneWord(rep.zone);
    captionColor = repColor(rep, true);
  }

  const k = size / 300;
  return (
    <View style={{ width: size, height: size }}>
      <DialBase zone={zone} scaleV={scaleV} size={size} />
      {v > 0 && (
        <Svg width={size} height={size} viewBox="0 0 300 300" style={StyleSheet.absoluteFill}>
          <Path d={arc(START, Math.max(va, START + 1), R - 30)} stroke={arcColor} strokeWidth={12} strokeLinecap="round" fill="none" />
        </Svg>
      )}
      <View style={styles.num} pointerEvents="none">
        <Text style={[styles.t, { fontSize: 11 * k }]}>MEAN VELOCITY</Text>
        <Text style={[styles.v, { fontSize: 78 * k, letterSpacing: -3 * k, lineHeight: 82 * k }, partial && styles.dim]}>
          {partial ? '—' : v > 0 ? v.toFixed(2) : '—'}
        </Text>
        <Text style={[styles.u, { fontSize: 13 * k }]}>m/s</Text>
        <Text style={[styles.z, { fontSize: 12 * k, color: captionColor }]}>{caption}</Text>
      </View>
    </View>
  );
}

export default memo(RingDial);

const styles = StyleSheet.create({
  num: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  t: { fontWeight: '900', letterSpacing: 2, color: 'rgba(255,255,255,0.45)' },
  v: { fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  dim: { color: 'rgba(255,255,255,0.35)' },
  u: { color: RACK_COLORS.mut },
  z: { fontWeight: '800', marginTop: 6, minHeight: 16 },
});
