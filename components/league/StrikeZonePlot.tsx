/**
 * StrikeZonePlot — catcher's-view 9-cell strike zone with a home-plate
 * pentagon and pitch dots (colored by pitch type OR call, optionally
 * numbered). Out-of-viewport dots are clamped to the edge so we never fake a
 * plausible in-frame location (honesty rule, same as the desktop scorer's
 * tmPlot.ts).
 *
 * Plate space (TrackMan, FEET, catcher's view): plate_side negative = catcher's
 * left; plate_height = ft above the plate. Zone = 17in plate wide
 * (±0.70833 ft) × 1.5–3.5 ft band. Viewport ranges (ft) match tmPlot.PLOT:
 *   x −1.25..1.25, y 0.75..4.25  (aspect 2.5 × 3.5).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Line, Polygon, Circle, G, Text as SvgText } from 'react-native-svg';
import { getPitchColor, getCallColor } from './pitchColors';

// ── Plate / zone / viewport geometry (ft) — ported from scorer tmPlot.ts ──
const ZONE = {
  halfWidthFt: 17 / 12 / 2, // 0.70833
  bottomFt: 1.5,
  topFt: 3.5,
};
const PLOT = {
  xMinFt: -1.25,
  xMaxFt: 1.25,
  yMinFt: 0.75,
  yMaxFt: 4.25,
};
const X_SPAN = PLOT.xMaxFt - PLOT.xMinFt; // 2.5
const Y_SPAN = PLOT.yMaxFt - PLOT.yMinFt; // 3.5
const ASPECT = X_SPAN / Y_SPAN; // 5:7

export interface ZonePitch {
  /** TrackMan plate_side in ft (negative = catcher's left). */
  plateSide: number | null;
  /** TrackMan plate_height in ft. */
  plateHeight: number | null;
  /** Pitch type (db name or abbrev) — used when colorBy='pitchType'. */
  pitchType?: string | null;
  /** Official call — used when colorBy='call'. */
  call?: string | null;
  /** Optional number drawn inside the dot (pitch order in the PA). */
  label?: string | number;
}

interface StrikeZonePlotProps {
  pitches: ZonePitch[];
  /** Color dots by pitch type or by pitch call. Default 'pitchType'. */
  colorBy?: 'pitchType' | 'call';
  /** Rendered width in px; height keeps the 5:7 aspect. Default 150. */
  width?: number;
  /** Optional caption above the plot. */
  caption?: string;
}

interface PlotPoint {
  x: number;
  y: number;
  clamped: boolean;
}

/** Plate-space (ft) → svg coords inside [pad, w-pad] × [pad, h-pad]. */
function project(
  sideFt: number,
  heightFt: number,
  innerW: number,
  innerH: number,
  pad: number
): PlotPoint {
  const cx = Math.min(PLOT.xMaxFt, Math.max(PLOT.xMinFt, sideFt));
  const cy = Math.min(PLOT.yMaxFt, Math.max(PLOT.yMinFt, heightFt));
  const x = pad + ((cx - PLOT.xMinFt) / X_SPAN) * innerW;
  const y = pad + ((PLOT.yMaxFt - cy) / Y_SPAN) * innerH; // y flipped (high = up)
  return { x, y, clamped: cx !== sideFt || cy !== heightFt };
}

export default function StrikeZonePlot({
  pitches,
  colorBy = 'pitchType',
  width = 150,
  caption,
}: StrikeZonePlotProps) {
  const w = width;
  const pad = w * 0.1;
  const innerW = w - pad * 2;
  const innerH = innerW / ASPECT;
  const h = innerH + pad * 2 + innerH * 0.16; // extra room below for the plate

  const valid = pitches.filter((p) => p.plateSide != null && p.plateHeight != null);

  // Zone rect (ft → svg).
  const zoneLeft = pad + ((-ZONE.halfWidthFt - PLOT.xMinFt) / X_SPAN) * innerW;
  const zoneRight = pad + ((ZONE.halfWidthFt - PLOT.xMinFt) / X_SPAN) * innerW;
  const zoneTop = pad + ((PLOT.yMaxFt - ZONE.topFt) / Y_SPAN) * innerH;
  const zoneBottom = pad + ((PLOT.yMaxFt - ZONE.bottomFt) / Y_SPAN) * innerH;
  const zoneW = zoneRight - zoneLeft;
  const zoneH = zoneBottom - zoneTop;

  // 3×3 grid thirds.
  const v1 = zoneLeft + zoneW / 3;
  const v2 = zoneLeft + (2 * zoneW) / 3;
  const hz1 = zoneTop + zoneH / 3;
  const hz2 = zoneTop + (2 * zoneH) / 3;

  // Home-plate pentagon centered under the zone.
  const plateCx = zoneLeft + zoneW / 2;
  const plateHalf = zoneW / 2;
  const plateTop = zoneBottom + innerH * 0.06;
  const platePts = [
    `${plateCx - plateHalf},${plateTop}`,
    `${plateCx + plateHalf},${plateTop}`,
    `${plateCx + plateHalf},${plateTop + zoneH * 0.08}`,
    `${plateCx},${plateTop + zoneH * 0.16}`,
    `${plateCx - plateHalf},${plateTop + zoneH * 0.08}`,
  ].join(' ');

  const dotR = w * 0.06;

  return (
    <View style={styles.wrap}>
      {caption ? <Text style={styles.cap}>{caption}</Text> : null}
      {valid.length === 0 ? (
        <View style={[styles.empty, { width: w, height: h }]}>
          <Text style={styles.emptyText}>No TrackMan data</Text>
        </View>
      ) : (
        <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          {/* Zone box */}
          <Rect
            x={zoneLeft}
            y={zoneTop}
            width={zoneW}
            height={zoneH}
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={1.5}
          />
          {/* 3×3 grid */}
          <Line x1={v1} y1={zoneTop} x2={v1} y2={zoneBottom} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          <Line x1={v2} y1={zoneTop} x2={v2} y2={zoneBottom} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          <Line x1={zoneLeft} y1={hz1} x2={zoneRight} y2={hz1} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          <Line x1={zoneLeft} y1={hz2} x2={zoneRight} y2={hz2} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          {/* Home plate */}
          <Polygon points={platePts} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1.2} />

          {/* Pitch dots */}
          {valid.map((p, i) => {
            const pt = project(p.plateSide as number, p.plateHeight as number, innerW, innerH, pad);
            const color = colorBy === 'call' ? getCallColor(p.call) : getPitchColor(p.pitchType);
            return (
              <G key={p.label != null ? `z-${p.label}-${i}` : `z-${i}`}>
                <Circle
                  cx={pt.x}
                  cy={pt.y}
                  r={dotR}
                  fill={color}
                  opacity={pt.clamped ? 0.55 : 0.95}
                  stroke={pt.clamped ? '#FFFFFF' : 'none'}
                  strokeWidth={pt.clamped ? 0.8 : 0}
                />
                {p.label != null && (
                  <SvgText
                    x={pt.x}
                    y={pt.y + dotR * 0.45}
                    fontSize={dotR * 1.25}
                    fontWeight="800"
                    fill="#000"
                    textAnchor="middle"
                  >
                    {String(p.label)}
                  </SvgText>
                )}
              </G>
            );
          })}
        </Svg>
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
});
