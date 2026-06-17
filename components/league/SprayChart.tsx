/**
 * SprayChart — baseball field with a landing marker + dashed trajectory from
 * home. Geometry is ported from the desktop scorer's FieldDiagram.tsx +
 * ballFlight.ts (200-unit viewBox, home plate P=(100,182), fence arc r=138
 * centered on P, foul lines at ±45°).
 *
 * Two input modes (use whichever the data has):
 *   - { bearingDeg, distanceFt }  → mapped via ballFlightToField (TrackMan).
 *       bearing 0 = dead CF, <0 = pull to LF/3B, >0 = to RF/1B; distanceFt
 *       scaled so REF_DISTANCE_FT (400) maps to the fence.
 *   - { sprayX, sprayY }          → normalized 0–1 spray-tap coords over the
 *       200×200 box (x: 0 left … 1 right, y: 0 deep CF … 1 plate).
 * Optional EV / LA / distance chips render below the field.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Line, Circle, Ellipse, Polygon, Rect, G } from 'react-native-svg';

// ── Field geometry (mirrored from FieldDiagram.tsx) ──
const VB = 200;
const PX = 100; // home plate x
const PY = 182; // home plate y
const FENCE_R = 138;
const C45 = Math.SQRT1_2; // 0.70711
const REF_DISTANCE_FT = 400;

const FOUL_L = { x: PX - FENCE_R * C45, y: PY - FENCE_R * C45 }; // (2.42, 84.42)
const FOUL_R = { x: PX + FENCE_R * C45, y: PY - FENCE_R * C45 }; // (197.58, 84.42)
const FAIR_WEDGE = `M ${PX} ${PY} L ${FOUL_L.x} ${FOUL_L.y} A ${FENCE_R} ${FENCE_R} 0 0 1 ${FOUL_R.x} ${FOUL_R.y} Z`;

const BASE_XY = {
  '1B': { x: 127, y: 155 },
  '2B': { x: 100, y: 128 },
  '3B': { x: 73, y: 155 },
} as const;

export interface SprayBattedBall {
  /** TrackMan bearing (deg): 0 = CF, <0 = LF/3B, >0 = RF/1B. */
  bearingDeg?: number | null;
  /** TrackMan carry distance (ft). */
  distanceFt?: number | null;
  /** Normalized spray-tap x in [0,1] (0=left, 1=right). */
  sprayX?: number | null;
  /** Normalized spray-tap y in [0,1] (0=deep CF, 1=plate). */
  sprayY?: number | null;
  exitVeloMph?: number | null;
  launchAngleDeg?: number | null;
}

interface SprayChartProps {
  battedBall: SprayBattedBall | null;
  width?: number;
  caption?: string;
  /** Show the EV / LA / DIST chip row below the field. Default true. */
  showTags?: boolean;
}

interface Landing {
  x: number | null;
  y: number | null;
  clamped: boolean;
}

/** TrackMan (bearing, distance) → 200-unit viewBox landing point. */
function ballFlightToField(bearingDeg: number, distanceFt: number): Landing {
  const rawR = (Math.max(0, distanceFt) / REF_DISTANCE_FT) * FENCE_R;
  const clamped = rawR > FENCE_R;
  const r = clamped ? FENCE_R : rawR;
  const rad = (bearingDeg * Math.PI) / 180;
  return { x: PX + r * Math.sin(rad), y: PY - r * Math.cos(rad), clamped };
}

export default function SprayChart({
  battedBall,
  width = 150,
  caption,
  showTags = true,
}: SprayChartProps) {
  const w = width;

  // Resolve a landing point from whichever input is present.
  let landing: Landing | null = null;
  if (battedBall) {
    if (battedBall.bearingDeg != null && battedBall.distanceFt != null) {
      landing = ballFlightToField(battedBall.bearingDeg, battedBall.distanceFt);
    } else if (battedBall.sprayX != null && battedBall.sprayY != null) {
      landing = { x: battedBall.sprayX * VB, y: battedBall.sprayY * VB, clamped: false };
    }
  }

  const hasField = !!battedBall;
  const tags =
    showTags && battedBall
      ? [
          battedBall.exitVeloMph != null ? { label: `EV ${battedBall.exitVeloMph.toFixed(1)}`, color: '#9BDDFF', bg: 'rgba(155,221,255,0.12)' } : null,
          battedBall.launchAngleDeg != null ? { label: `LA ${Math.round(battedBall.launchAngleDeg)}°`, color: '#FFB84D', bg: 'rgba(255,184,77,0.14)' } : null,
          battedBall.distanceFt != null ? { label: `DIST ${Math.round(battedBall.distanceFt)}'`, color: '#34D399', bg: 'rgba(52,211,153,0.14)' } : null,
        ].filter(Boolean) as { label: string; color: string; bg: string }[]
      : [];

  return (
    <View style={styles.wrap}>
      {caption ? <Text style={styles.cap}>{caption}</Text> : null}
      {!hasField ? (
        <View style={[styles.empty, { width: w, height: w }]}>
          <Text style={styles.emptyText}>No TrackMan data</Text>
        </View>
      ) : (
        <Svg width={w} height={w} viewBox={`0 0 ${VB} ${VB}`}>
          {/* Foul territory backdrop */}
          <Rect x={0} y={0} width={VB} height={VB} fill="rgba(255,255,255,0.015)" />
          {/* Fair-territory wedge */}
          <Path d={FAIR_WEDGE} fill="rgba(155,221,255,0.05)" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          {/* Outfield fence arc */}
          <Path
            d={`M ${FOUL_L.x} ${FOUL_L.y} A ${FENCE_R} ${FENCE_R} 0 0 1 ${FOUL_R.x} ${FOUL_R.y}`}
            fill="none"
            stroke="rgba(155,221,255,0.4)"
            strokeWidth={1.5}
          />
          {/* Foul lines */}
          <Line x1={PX} y1={PY} x2={FOUL_L.x} y2={FOUL_L.y} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          <Line x1={PX} y1={PY} x2={FOUL_R.x} y2={FOUL_R.y} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          {/* Infield diamond */}
          <Path
            d="M 100 190 L 135 155 L 100 120 L 65 155 Z"
            fill="rgba(168,120,80,0.12)"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          {/* Basepath polyline */}
          <Path
            d={`M ${PX} ${PY} L ${BASE_XY['1B'].x} ${BASE_XY['1B'].y} L ${BASE_XY['2B'].x} ${BASE_XY['2B'].y} L ${BASE_XY['3B'].x} ${BASE_XY['3B'].y} Z`}
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1}
          />
          {/* Mound */}
          <Circle cx={PX} cy={150} r={5} fill="rgba(168,120,80,0.25)" stroke="rgba(0,0,0,0.3)" strokeWidth={0.5} />
          {/* Bases */}
          {(['1B', '2B', '3B'] as const).map((b) => {
            const { x, y } = BASE_XY[b];
            return (
              <Rect
                key={b}
                x={x - 3}
                y={y - 3}
                width={6}
                height={6}
                fill="rgba(255,255,255,0.8)"
                transform={`rotate(45, ${x}, ${y})`}
              />
            );
          })}
          {/* Home plate pentagon */}
          <Polygon
            points={`${PX - 2.4},${PY - 2.4} ${PX + 2.4},${PY - 2.4} ${PX + 2.4},${PY - 0.2} ${PX},${PY + 2} ${PX - 2.4},${PY - 0.2}`}
            fill="rgba(255,255,255,0.9)"
          />

          {/* Trajectory + landing marker */}
          {landing && landing.x !== null && landing.y !== null && (
            <G>
              <Line
                x1={PX}
                y1={PY}
                x2={landing.x}
                y2={landing.y}
                stroke="#34D399"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                opacity={0.85}
              />
              {landing.clamped ? (
                <Ellipse cx={landing.x} cy={landing.y} rx={5} ry={2.4} fill="#34D399" opacity={0.95} />
              ) : (
                <>
                  <Circle cx={landing.x} cy={landing.y} r={6.5} fill="#34D399" opacity={0.25} />
                  <Circle cx={landing.x} cy={landing.y} r={3} fill="#34D399" />
                </>
              )}
            </G>
          )}
        </Svg>
      )}

      {tags.length > 0 && (
        <View style={styles.tagRow}>
          {tags.map((t) => (
            <View key={t.label} style={[styles.tag, { backgroundColor: t.bg }]}>
              <Text style={[styles.tagText, { color: t.color }]}>{t.label}</Text>
            </View>
          ))}
        </View>
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
  tagRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 10, fontWeight: '700' },
});
