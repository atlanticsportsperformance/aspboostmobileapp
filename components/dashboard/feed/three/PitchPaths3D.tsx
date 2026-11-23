/**
 * PitchPaths3D — catcher's-eye 3D view of the athlete's most recent
 * TrackMan session: each pitch's real flight path from release to the
 * plate, colored by pitch type, flying into a strike-zone frame.
 *
 * Paths come from TrackMan's 9-parameter fit (x0/v0/a0, stored in METERS,
 * m/s and m/s², referenced at y = 15.24 m = 50 ft; converted to feet here), so the curve is the measured trajectory,
 * not an illustration. Pitches missing the fit are skipped.
 *
 * Axes: the fit's x is the mirror of plate_loc_side (verified against a
 * real pitch), so with the camera looking toward +Z we use X = x, which
 * puts plate_loc_side > 0 on screen right. Y = z (up), Z = y (toward mound).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import { supabase } from '../../../../lib/supabase';
import { useInView } from '../../../../hooks/useInView';
import { pitchDisplay } from '../pitchTypeDisplay';

type PitchRow = {
  pitch_uid: string;
  tagged_pitch_type: string | null;
  extension: number | null;
  x0_x: number; x0_y: number; x0_z: number;
  v0_x: number; v0_y: number; v0_z: number;
  a0_x: number; a0_y: number; a0_z: number;
};

type Path = { points: THREE.Vector3[]; color: string; type: string };

const M2FT = 3.28084;
const PLATE_FRONT_FT = 17 / 12;
const ZONE_W = 17 / 12;
const ZONE_BOTTOM = 1.6;
const ZONE_TOP = 3.5;
const MAX_PITCHES = 12;
const SECONDS_PER_PITCH = 1.1;
const HOLD_SECONDS = 1.6;
const FLIGHT_SHARE = 0.7;

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
  return { points, color: d.hex, type: d.full };
}

function usePitchPaths(athleteId: string | null | undefined) {
  const [paths, setPaths] = useState<Path[] | null>(null);
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      const { data: latest } = await supabase
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
        .select('pitch_uid, tagged_pitch_type, extension, x0_x, x0_y, x0_z, v0_x, v0_y, v0_z, a0_x, a0_y, a0_z')
        .eq('athlete_id', athleteId)
        .eq('session_id', sessionId)
        .not('a0_y', 'is', null)
        .order('created_at', { ascending: false })
        .limit(MAX_PITCHES);
      if (cancelled) return;
      const built = ((data ?? []) as PitchRow[]).map(buildPath).filter(Boolean) as Path[];
      setPaths(built.reverse());
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);
  return paths;
}

function lineObject(points: THREE.Vector3[], color: string, opacity = 1) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

function Scene({ paths, active }: { paths: Path[]; active: boolean }) {
  // Own wall clock (not R3F's) so the loop starts when the section scrolls
  // into view and restarts each time it comes back.
  const t0 = useRef<number | null>(null);
  const ball = useRef<THREE.Mesh>(null);

  // Zone frame sits on the plate's front edge (where every path ends), as
  // solid bars (iOS GL ignores line width) over a dark backing so the
  // ground grid never shows through. Plate lies flat, point toward catcher.
  const zone = useMemo(() => {
    const g = new THREE.Group();
    const Z = PLATE_FRONT_FT;
    const L = -ZONE_W / 2, R = ZONE_W / 2, B = ZONE_BOTTOM, T = ZONE_TOP;
    const W = ZONE_W, H = T - B;

    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ color: '#05070a', transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
    );
    backing.position.set(0, B + H / 2, Z + 0.02);
    g.add(backing);
    const tint = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ color: '#5ce1ff', transparent: true, opacity: 0.05, side: THREE.DoubleSide }),
    );
    tint.position.set(0, B + H / 2, Z + 0.01);
    g.add(tint);

    const bar = (w: number, h: number, x: number, y: number, color: string, opacity: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide }),
      );
      m.position.set(x, y, Z);
      g.add(m);
    };
    const t = 0.045; // frame thickness, ft
    bar(W + t, t, 0, T, '#ffffff', 0.9);
    bar(W + t, t, 0, B, '#ffffff', 0.9);
    bar(t, H + t, L, B + H / 2, '#ffffff', 0.9);
    bar(t, H + t, R, B + H / 2, '#ffffff', 0.9);
    const ti = 0.018;
    for (let i = 1; i < 3; i++) {
      bar(ti, H, L + (W * i) / 3, B + H / 2, '#ffffff', 0.22);
      bar(W, ti, 0, B + (H * i) / 3, '#ffffff', 0.22);
    }

    // Home plate flat on the ground: 17" front edge under the zone, point toward the catcher.
    const plate = new THREE.Shape([
      new THREE.Vector2(-ZONE_W / 2, 0), new THREE.Vector2(ZONE_W / 2, 0), new THREE.Vector2(ZONE_W / 2, 8.5 / 12),
      new THREE.Vector2(0, 17 / 12), new THREE.Vector2(-ZONE_W / 2, 8.5 / 12),
    ]);
    const pm = new THREE.Mesh(
      new THREE.ShapeGeometry(plate),
      new THREE.MeshBasicMaterial({ color: '#e5ecf3', transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    pm.rotation.x = -Math.PI / 2; // shape +y → world −z (toward catcher)
    pm.position.set(0, 0.01, Z);
    g.add(pm);

    // Ground grid starts past the plate and stays faint.
    const grid = new THREE.GridHelper(70, 28, '#121a24', '#121a24');
    grid.position.z = 38;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.7;
    g.add(grid);
    const mound = new THREE.Mesh(new THREE.CircleGeometry(4.5, 40), new THREE.MeshBasicMaterial({ color: '#141c27' }));
    mound.rotation.x = -Math.PI / 2;
    mound.position.set(0, 0.02, 60.5);
    g.add(mound);
    return g;
  }, []);

  const trails = useMemo(
    () =>
      paths.map((p) => {
        const line = lineObject(p.points, p.color, 0.9);
        line.geometry.setDrawRange(0, 0);
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshBasicMaterial({ color: p.color, side: THREE.DoubleSide }));
        dot.position.copy(p.points[p.points.length - 1]).setZ(PLATE_FRONT_FT - 0.03);
        dot.visible = false;
        return { line, dot, n: p.points.length };
      }),
    [paths],
  );

  useFrame((state) => {
    // Pin the framing every frame (R3F can reset a lookAt set once in onCreated).
    state.camera.position.set(0, 3.6, -9);
    state.camera.lookAt(0, 3.0, 30);
    if (!active) {
      t0.current = null;
      trails.forEach((it) => {
        it.line.geometry.setDrawRange(0, 0);
        it.dot.visible = false;
      });
      if (ball.current) ball.current.visible = false;
      return;
    }
    if (t0.current == null) t0.current = Date.now();
    const t = (Date.now() - t0.current) / 1000;
    const n = paths.length;
    if (!n) return;
    // Throw every one in turn, hold the full picture, then clear and replay.
    const loopLen = n * SECONDS_PER_PITCH + HOLD_SECONDS;
    const lt = t % loopLen;
    const holding = lt >= n * SECONDS_PER_PITCH;
    const cyc = holding ? n - 0.0001 : lt / SECONDS_PER_PITCH;
    const idx = Math.min(n - 1, Math.floor(cyc));
    const k = holding ? 0.9999 : cyc % 1;
    const kk = Math.min(1, k / FLIGHT_SHARE);
    trails.forEach((tr, i) => {
      // Each cycle clears and redraws, so the session keeps replaying.
      const full = i < idx;
      tr.line.geometry.setDrawRange(0, full ? tr.n : i === idx ? Math.floor(kk * tr.n) : 0);
      tr.dot.visible = full || (i === idx && kk >= 1);
    });
    if (ball.current) {
      const pts = paths[idx].points;
      ball.current.visible = kk < 1;
      ball.current.position.copy(pts[Math.min(pts.length - 1, Math.floor(kk * (pts.length - 1)))]);
    }
  });

  return (
    <>
      <primitive object={zone} />
      {trails.map((tr, i) => (
        <React.Fragment key={i}>
          <primitive object={tr.line} />
          <primitive object={tr.dot} />
        </React.Fragment>
      ))}
      <mesh ref={ball}>
        <sphereGeometry args={[0.16, 20, 20]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </>
  );
}

export function PitchPaths3D({ athleteId }: { athleteId?: string | null }) {
  const paths = usePitchPaths(athleteId);
  const { ref, inView } = useInView();
  const legend = useMemo(() => {
    const seen = new Map<string, string>();
    (paths ?? []).forEach((p) => seen.set(p.type, p.color));
    return [...seen.entries()];
  }, [paths]);

  if (!paths || paths.length === 0) return null;

  return (
    <View ref={ref} style={styles.wrap} collapsable={false}>
      <Canvas
        style={styles.canvas}
        camera={{ position: [0, 3.6, -9], fov: 26, near: 0.05, far: 200 }}
      >
        <Scene paths={paths} active={inView} />
      </Canvas>
      <View style={styles.legend} pointerEvents="none">
        {legend.map(([type, color]) => (
          <View key={type} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: color }]} />
            <Text style={styles.legendText}>{type}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption} pointerEvents="none">LAST SESSION · CATCHER VIEW</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 260, marginTop: 14, marginHorizontal: -16, backgroundColor: '#05070a', position: 'relative' },
  canvas: { flex: 1 },
  legend: { position: 'absolute', left: 16, top: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: '#9ca3af', fontSize: 10, fontWeight: '700' },
  caption: { position: 'absolute', right: 16, bottom: 8, color: '#46505c', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
});
