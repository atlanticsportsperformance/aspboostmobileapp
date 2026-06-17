/**
 * BreakPlot — pitch movement scatter: HB (horizontal break, x) × IVB (induced
 * vertical break, y), colored by pitch type. Matches the mockup's "Movement —
 * HB × IVB" chart: center axes through (0,0), faint concentric quadrant rings,
 * axis labels, and a small per-pitch-type legend.
 *
 * Axis convention (TrackMan, catcher-neutral display):
 *   +HB to the right, +IVB up. Range auto-fits the data, clamped to a sane
 *   minimum span so a single tight cluster doesn't fill the whole frame.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Circle, Text as SvgText, G } from 'react-native-svg';
import { getPitchColor, getPitchAbbrev } from './pitchColors';

export interface BreakPitch {
  /** Horizontal break (in). */
  hb: number | null;
  /** Induced vertical break (in). */
  ivb: number | null;
  pitchType?: string | null;
}

interface BreakPlotProps {
  pitches: BreakPitch[];
  width?: number;
  caption?: string;
  /** Minimum half-range (in) on each axis so clusters aren't over-zoomed. */
  minHalfRange?: number;
}

export default function BreakPlot({
  pitches,
  width = 150,
  caption,
  minHalfRange = 12,
}: BreakPlotProps) {
  const w = width;
  const h = w; // square plot area
  const pad = w * 0.12;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const cx = pad + innerW / 2;
  const cy = pad + innerH / 2;

  const valid = pitches.filter((p) => p.hb != null && p.ivb != null);

  // Auto-fit symmetric range around 0, clamped to a minimum.
  let half = minHalfRange;
  if (valid.length > 0) {
    const maxAbs = Math.max(
      ...valid.map((p) => Math.max(Math.abs(p.hb as number), Math.abs(p.ivb as number)))
    );
    half = Math.max(minHalfRange, Math.ceil((maxAbs * 1.15) / 6) * 6);
  }

  const sx = (hb: number) => cx + (hb / half) * (innerW / 2);
  const sy = (ivb: number) => cy - (ivb / half) * (innerH / 2);

  // Unique pitch types present, for the legend.
  const seen: string[] = [];
  for (const p of valid) {
    const key = p.pitchType ?? 'Unknown';
    if (!seen.includes(key)) seen.push(key);
  }

  const dotR = w * 0.034;

  return (
    <View style={styles.wrap}>
      {caption ? <Text style={styles.cap}>{caption}</Text> : null}
      {valid.length === 0 ? (
        <View style={[styles.empty, { width: w, height: h }]}>
          <Text style={styles.emptyText}>No TrackMan data</Text>
        </View>
      ) : (
        <>
          <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
            {/* Concentric quadrant rings */}
            <Circle cx={cx} cy={cy} r={innerW / 4} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
            <Circle cx={cx} cy={cy} r={innerW / 2} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
            {/* Center axes */}
            <Line x1={cx} y1={pad} x2={cx} y2={h - pad} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            <Line x1={pad} y1={cy} x2={w - pad} y2={cy} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
            {/* Axis labels */}
            <SvgText x={w - pad + 2} y={cy + 3} fontSize={8} fill="#6B7280">
              HB
            </SvgText>
            <SvgText x={cx + 4} y={pad} fontSize={8} fill="#6B7280">
              IVB
            </SvgText>
            {/* Dots */}
            {valid.map((p, i) => (
              <Circle
                key={`b-${i}`}
                cx={sx(p.hb as number)}
                cy={sy(p.ivb as number)}
                r={dotR}
                fill={getPitchColor(p.pitchType)}
                opacity={0.9}
              />
            ))}
          </Svg>
          {seen.length > 0 && (
            <View style={styles.legend}>
              {seen.map((key) => (
                <View key={key} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: getPitchColor(key) }]} />
                  <Text style={[styles.legendText, { color: getPitchColor(key) }]}>
                    {getPitchAbbrev(key)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  cap: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  empty: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
  },
  emptyText: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  legend: { flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 3.5 },
  legendText: { fontSize: 10, fontWeight: '700' },
});
