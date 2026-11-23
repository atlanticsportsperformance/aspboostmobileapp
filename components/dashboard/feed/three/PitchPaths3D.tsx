/**
 * PitchPaths3D — catcher's-eye 3D view of the athlete's most recent
 * TrackMan session: each pitch's real flight path from release to the
 * plate, colored by pitch type, flying into a strike-zone frame.
 *
 * Paths come from TrackMan's 9-parameter fit (x0/v0/a0, stored in METERS,
 * m/s and m/s², referenced at y = 15.24 m = 50 ft; converted to feet here), so the curve is the measured trajectory,
 * not an illustration. Pitches missing the fit are skipped.
 *
 * Rendered as SVG through a three.js perspective camera (projection math
 * only). Two live expo-gl views on one screen stop presenting frames for
 * the older one, which froze this view next to the hitting field.
 *
 * Axes: the fit's x is the mirror of plate_loc_side (verified against a
 * real pitch), so with the camera looking toward +Z we use X = x, which
 * puts plate_loc_side > 0 on screen right. Y = z (up), Z = y (toward mound).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path as SvgPath, Circle, Rect, Line as SvgLine, Polygon, Ellipse, Defs, LinearGradient, Stop } from 'react-native-svg';
// three is used only for its camera/projection math; rendering is SVG.
import * as THREE from 'three';
import { supabase } from '../../../../lib/supabase';
import { useInView } from '../../../../hooks/useInView';
import { pitchDisplay } from '../pitchTypeDisplay';

type PitchRow = {
  pitch_uid: string;
  tagged_pitch_type: string | null;
  rel_speed: number | null;
  extension: number | null;
  x0_x: number; x0_y: number; x0_z: number;
  v0_x: number; v0_y: number; v0_z: number;
  a0_x: number; a0_y: number; a0_z: number;
};

type Path = { points: THREE.Vector3[]; color: string; type: string; mph: number | null };

const M2FT = 3.28084;
const PLATE_FRONT_FT = 17 / 12;
const ZONE_W = 17 / 12;
const ZONE_BOTTOM = 1.6;
const ZONE_TOP = 3.5;
const MAX_PITCHES = 12;
const SECONDS_PER_PITCH = 1.5;
const HOLD_SECONDS = 1.6;
const FLIGHT_SHARE = 0.75;

/** Time (s) at which the fitted trajectory reaches depth y (ft). */
function timeAtY(r: PitchRow, y: number): number | null {
  const a = 0.5 * r.a0_y;
  const b = r.v0_y;
  const c = r.x0_y - y;
  if (Math.abs(a) < 1e-6) return b !== 0 ? -c / b : null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  // v0_y is negative (ball travels toward the plate); pick the root on that branch.
  const t1 = (-b - s) / (2 * a);
  const t2 = (-b + s) / (2 * a);
  return Math.abs(t1) < Math.abs(t2) ? t1 : t2;
}

function buildPath(raw: PitchRow): Path | null {
  const r: PitchRow = {
    ...raw,
    x0_x: raw.x0_x * M2FT, x0_y: raw.x0_y * M2FT, x0_z: raw.x0_z * M2FT,
    v0_x: raw.v0_x * M2FT, v0_y: raw.v0_y * M2FT, v0_z: raw.v0_z * M2FT,
    a0_x: raw.a0_x * M2FT, a0_y: raw.a0_y * M2FT, a0_z: raw.a0_z * M2FT,
  };
  const releaseY = 60.5 - (r.extension ?? 6);
  const tRel = timeAtY(r, releaseY);
  const tPlate = timeAtY(r, PLATE_FRONT_FT);
  if (tRel == null || tPlate == null || !(tPlate > tRel)) return null;
  const points: THREE.Vector3[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = tRel + ((tPlate - tRel) * i) / N;
    const x = r.x0_x + r.v0_x * t + 0.5 * r.a0_x * t * t;
    const y = r.x0_y + r.v0_y * t + 0.5 * r.a0_y * t * t;
    const z = r.x0_z + r.v0_z * t + 0.5 * r.a0_z * t * t;
    points.push(new THREE.Vector3(x, z, y));
  }
  const d = pitchDisplay(r.tagged_pitch_type ?? 'Fastball');
  return { points, color: d.hex, type: d.full, mph: raw.rel_speed };
}

function usePitchPaths(athleteId: string | null | undefined, fixedSessionId?: string | number | null, maxPitches = MAX_PITCHES) {
  const [paths, setPaths] = useState<Path[] | null>(null);
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      const { data: latest } = fixedSessionId != null
        ? { data: [{ session_id: fixedSessionId }] }
        : await supabase
        .from('trackman_pitch_data')
        .select('session_id')
        .eq('athlete_id', athleteId)
        .not('a0_y', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      const sessionId = latest?.[0]?.session_id;
      if (!sessionId) {
        if (!cancelled) setPaths([]);
        return;
      }
      const { data } = await supabase
        .from('trackman_pitch_data')
        .select('pitch_uid, tagged_pitch_type, rel_speed, extension, x0_x, x0_y, x0_z, v0_x, v0_y, v0_z, a0_x, a0_y, a0_z')
        .eq('athlete_id', athleteId)
        .eq('session_id', sessionId)
        .not('a0_y', 'is', null)
        .order('created_at', { ascending: false })
        .limit(maxPitches);
      if (cancelled) return;
      const built = ((data ?? []) as PitchRow[]).map(buildPath).filter(Boolean) as Path[];
      setPaths(built.reverse());
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, fixedSessionId, maxPitches]);
  return paths;
}

const VIEW_H = 260;
const FPS_MS = 1000 / 60;

type Pt = { x: number; y: number };

/** Camera backed up until every path point and the zone fit in view. */
function makeCamera(paths: Path[], w: number, h: number) {
  const cam = new THREE.PerspectiveCamera(26, w / h, 0.05, 200);
  const probe: THREE.Vector3[] = [
    new THREE.Vector3(-ZONE_W / 2, ZONE_BOTTOM, PLATE_FRONT_FT),
    new THREE.Vector3(ZONE_W / 2, ZONE_TOP, PLATE_FRONT_FT),
  ];
  paths.forEach((p) => p.points.forEach((v, i) => i % 4 === 0 && probe.push(v)));
  const look = new THREE.Vector3(0, 3.0, 30);
  for (let back = 9; back <= 60; back += 1) {
    cam.position.set(0, 3.2 + back * 0.08, -back);
    cam.lookAt(look);
    cam.updateMatrixWorld();
    const ok = probe.every((v) => {
      const q = v.clone().project(cam);
      return Math.abs(q.x) < 0.92 && q.y < 0.82 && q.y > -0.9;
    });
    if (ok) break;
  }
  cam.updateMatrixWorld();
  return cam;
}

function projector(cam: THREE.PerspectiveCamera, w: number, h: number) {
  // Screen x is mirrored: the camera looks toward +Z, so +X is screen-left.
  return (v: THREE.Vector3): Pt => {
    const q = v.clone().project(cam);
    return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h };
  };
}

const d = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');

type StaticLayerData = { grid: string[]; horizon: number; zone: Pt[]; inner: string[]; plate: Pt[]; mound: Pt; moundRx: number };

/** Grid, mound, plate and zone: drawn once, never re-rendered by the 60fps loop. */
const StaticLayer = React.memo(function StaticLayer({ layer, w, h }: { layer: StaticLayerData; w: number; h: number }) {
  const { grid, horizon, zone, inner, plate, mound, moundRx } = layer;
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#05070a" />
            <Stop offset="1" stopColor="#0a1018" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill="url(#sky)" />
        <Rect x={0} y={horizon} width={w} height={h - horizon} fill="#070b11" />
        {grid.map((g, i) => (
          <SvgPath key={i} d={g} stroke="#16202c" strokeWidth={1} fill="none" />
        ))}
        <Ellipse cx={mound.x} cy={mound.y} rx={moundRx} ry={Math.max(1.5, moundRx * 0.12)} fill="#141c27" />
        <Polygon points={plate.map((p) => `${p.x},${p.y}`).join(' ')} fill="#e5ecf3" fillOpacity={0.5} />
        <Polygon points={zone.map((p) => `${p.x},${p.y}`).join(' ')} fill="#05070a" fillOpacity={0.82} />
        <Polygon points={zone.map((p) => `${p.x},${p.y}`).join(' ')} fill="#5ce1ff" fillOpacity={0.05} />
        {inner.map((g, i) => (
          <SvgPath key={i} d={g} stroke="#ffffff" strokeOpacity={0.22} strokeWidth={1} fill="none" />
        ))}
        <Polygon points={zone.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ffffff" strokeOpacity={0.9} strokeWidth={2.2} />
    </Svg>
  );
});

function PitchSvg({ paths, active }: { paths: Path[]; active: boolean }) {
  const w = Dimensions.get('window').width;
  const h = VIEW_H;
  const { proj, staticLayer, screenPaths } = useMemo(() => {
    const cam = makeCamera(paths, w, h);
    const P = projector(cam, w, h);
    const V = (x: number, y: number, z: number) => P(new THREE.Vector3(x, y, z));
    const Z = PLATE_FRONT_FT;
    const L = -ZONE_W / 2, R = ZONE_W / 2;
    // ground grid lines, faint, from just past the plate to the mound
    const grid: string[] = [];
    for (let z = 4; z <= 70; z += 3) grid.push(d([V(-35, 0, z), V(35, 0, z)]));
    for (let x = -36; x <= 36; x += 3) grid.push(d([V(x, 0, 4), V(x, 0, 70)]));
    const horizon = V(0, 0, 70).y;
    const zone = [V(L, ZONE_BOTTOM, Z), V(R, ZONE_BOTTOM, Z), V(R, ZONE_TOP, Z), V(L, ZONE_TOP, Z)];
    const inner: string[] = [];
    for (let i = 1; i < 3; i++) {
      const x = L + (ZONE_W * i) / 3;
      const y = ZONE_BOTTOM + ((ZONE_TOP - ZONE_BOTTOM) * i) / 3;
      inner.push(d([V(x, ZONE_BOTTOM, Z), V(x, ZONE_TOP, Z)]));
      inner.push(d([V(L, y, Z), V(R, y, Z)]));
    }
    const plate = [V(L, 0, Z), V(R, 0, Z), V(R, 0, Z - 8.5 / 12), V(0, 0, Z - 17 / 12), V(L, 0, Z - 8.5 / 12)];
    const mound = V(0, 0, 60.5);
    const moundEdge = V(4.5, 0, 60.5);
    return {
      proj: P,
      staticLayer: { grid, horizon, zone, inner, plate, mound, moundRx: Math.abs(moundEdge.x - mound.x) },
      screenPaths: paths.map((p) => p.points.map(P)),
    };
  }, [paths, w, h]);

  // Own 60fps clock; restarts each time the section comes into view.
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) {
      setT(0);
      return;
    }
    const t0 = Date.now();
    let raf = 0;
    let last = 0;
    const tick = () => {
      const now = Date.now();
      if (now - last >= FPS_MS - 2) {
        last = now;
        setT((now - t0) / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const n = paths.length;
  const loopLen = n * SECONDS_PER_PITCH + HOLD_SECONDS;
  const lt = active ? t % loopLen : 0;
  const holding = active && lt >= n * SECONDS_PER_PITCH;
  const cyc = holding ? n - 0.0001 : lt / SECONDS_PER_PITCH;
  const idx = Math.min(n - 1, Math.floor(cyc));
  const kk = holding ? 1 : Math.min(1, (cyc % 1) / FLIGHT_SHARE);
  const ballR = 5;

  return (
    <>
      <StaticLayer layer={staticLayer} w={w} h={h} />
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        {active &&
          screenPaths.map((pts, i) => {
            if (i > idx) return null;
            const current = i === idx;
            const upto = current ? Math.max(1, Math.floor(kk * (pts.length - 1))) : pts.length - 1;
            const bright = holding || current;
            const color = paths[i].color;
            const end = pts[pts.length - 1];
            return (
              <React.Fragment key={i}>
                <SvgPath d={d(pts.slice(0, upto + 1))} stroke={color} strokeOpacity={bright ? 1 : 0.22} strokeWidth={bright ? 2.2 : 1.4} fill="none" strokeLinecap="round" />
                {(!current || kk >= 1) && (
                  <Circle cx={end.x} cy={end.y} r={4.5} fill={color} fillOpacity={bright ? 1 : 0.3} />
                )}
              </React.Fragment>
            );
          })}
        {active && !holding && kk < 1 && screenPaths[idx] && (() => {
          const pts = screenPaths[idx];
          const p = pts[Math.min(pts.length - 1, Math.floor(kk * (pts.length - 1)))];
          return <Circle cx={p.x} cy={p.y} r={ballR} fill="#ffffff" />;
        })()}
      </Svg>
      {active && paths[idx] && (
        <View style={styles.now} pointerEvents="none">
          <Text style={styles.nowCount}>
            PITCH {idx + 1}/{n}
          </Text>
          {paths[idx].mph != null && (
            <Text style={[styles.nowMph, { color: paths[idx].color }]}>
              {paths[idx].mph!.toFixed(1)}
              <Text style={styles.nowUnit}> MPH</Text>
            </Text>
          )}
        </View>
      )}
    </>
  );
}

/**
 * `sessionId` pins the view to one session (the pitching Session screen);
 * without it the athlete's latest fitted session is shown (home feed).
 */
export function PitchPaths3D({
  athleteId,
  sessionId,
  maxPitches,
  caption = 'LAST SESSION · CATCHER VIEW',
}: {
  athleteId?: string | null;
  sessionId?: string | number | null;
  maxPitches?: number;
  caption?: string;
}) {
  const paths = usePitchPaths(athleteId, sessionId, maxPitches ?? MAX_PITCHES);
  const { ref, inView } = useInView();
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    (paths ?? []).forEach((p) => seen.set(p.type, p.color));
    return [...seen.entries()];
  }, [paths]);

  if (!paths || paths.length === 0) return null;

  return (
    <View ref={ref} style={styles.wrap} collapsable={false}>
      <PitchSvg paths={paths} active={inView} />
      <View style={styles.legend} pointerEvents="none">
        {legend.map(([type, color]) => (
          <View key={type} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={styles.legendText}>{type}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption} pointerEvents="none">{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: VIEW_H, marginTop: 14, marginHorizontal: -16, backgroundColor: '#05070a', position: 'relative', overflow: 'hidden' },
  legend: { position: 'absolute', left: 16, top: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: '#9ca3af', fontSize: 10, fontWeight: '700' },
  now: { position: 'absolute', right: 16, top: 10, alignItems: 'flex-end' },
  nowCount: { color: '#7f8b99', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  nowMph: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  nowUnit: { fontSize: 10, color: '#7f8b99', fontWeight: '700' },
  caption: { position: 'absolute', right: 16, bottom: 8, color: '#46505c', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
});
