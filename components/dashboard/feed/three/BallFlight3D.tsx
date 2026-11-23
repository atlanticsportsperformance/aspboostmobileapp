/**
 * BallFlight3D — the athlete's recent HitTrax batted balls drawn as
 * flight arcs over a field (foul lines, fence, infield diamond).
 *
 * Each arc uses the swing's real exit velo, launch angle, spray
 * (horizontal_angle) and distance. Apex height is approximated from
 * launch angle and distance (HitTrax doesn't store apex), so the shape
 * is representative while the landing spot is exact.
 *
 * Harder contact (95+ mph) is bright orange, 90–95 lighter, below 90 grey.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import { supabase } from '../../../../lib/supabase';

type Swing = { exit_velocity: number; launch_angle: number; horizontal_angle: number | null; distance: number };
type Arc = { points: THREE.Vector3[]; color: string };

const S = 0.01; // 1 unit = 100 ft
const MAX_SWINGS = 8;
const SECONDS_PER_BALL = 1.6;
const HOLD_SECONDS = 1.6;
const FLIGHT_SHARE = 0.75;
const FENCE = (deg: number) => (400 - (Math.abs(deg) / 45) * 70) * S;

function evColor(ev: number) {
  if (ev >= 95) return '#fb923c';
  if (ev >= 90) return '#fdba74';
  return '#8d939c';
}

function buildArc(s: Swing): Arc {
  const spray = s.horizontal_angle ?? 0;
  const rad = ((90 - spray) * Math.PI) / 180;
  const d = s.distance * S;
  const la = Math.max(0, s.launch_angle);
  const apex = Math.tan((la * Math.PI) / 180) * d * 0.28 + 0.05;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) {
    const u = i / 60;
    points.push(new THREE.Vector3(d * u * Math.cos(rad), 0.03 + 4 * apex * u * (1 - u) * (1 - 0.12 * u), -d * u * Math.sin(rad)));
  }
  return { points, color: evColor(s.exit_velocity) };
}

function useArcs(athleteId: string | null | undefined) {
  const [arcs, setArcs] = useState<Arc[] | null>(null);
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      const { data: sessions } = await supabase
        .from('hittrax_sessions')
        .select('id')
        .eq('athlete_id', athleteId)
        .order('session_date', { ascending: false })
        .limit(5);
      const ids = (sessions ?? []).map((s: { id: string }) => s.id);
      if (!ids.length) {
        if (!cancelled) setArcs([]);
        return;
      }
      const { data } = await supabase
        .from('hittrax_swings')
        .select('exit_velocity, launch_angle, horizontal_angle, distance')
        .in('session_id', ids)
        .gt('distance', 0)
        .not('launch_angle', 'is', null)
        .order('swing_timestamp', { ascending: false })
        .limit(MAX_SWINGS);
      if (cancelled) return;
      setArcs(((data ?? []) as Swing[]).map(buildArc).reverse());
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);
  return arcs;
}

function lineObject(points: THREE.Vector3[], color: string, opacity = 1) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

function Field() {
  return useMemo(() => {
    const F = new THREE.Group();
    const fair = new THREE.Shape();
    fair.moveTo(0, 0);
    const fence: THREE.Vector3[] = [];
    for (let a = -45; a <= 45; a += 3) {
      const r = FENCE(a);
      const rad = ((90 - a) * Math.PI) / 180;
      fair.lineTo(r * Math.cos(rad), r * Math.sin(rad));
      fence.push(new THREE.Vector3(r * Math.cos(rad), 0, -r * Math.sin(rad)));
    }
    fair.lineTo(0, 0);
    const grass = new THREE.Mesh(new THREE.ShapeGeometry(fair), new THREE.MeshBasicMaterial({ color: '#16202c', transparent: true, opacity: 0.6 }));
    grass.rotation.x = -Math.PI / 2;
    F.add(grass);
    F.add(lineObject(fence, '#ffffff', 0.7));
    [-45, 45].forEach((a) => {
      const rad = ((90 - a) * Math.PI) / 180;
      const r = FENCE(a);
      F.add(lineObject([new THREE.Vector3(0, 0, 0), new THREE.Vector3(r * Math.cos(rad), 0, -r * Math.sin(rad))], '#ffffff', 0.55));
    });
    const b = 0.636;
    F.add(lineObject([[0, 0], [b, b], [0, 2 * b], [-b, b], [0, 0]].map(([x, z]) => new THREE.Vector3(x, 0.005, -z)), '#ffffff', 0.5));
    return <primitive object={F} />;
  }, []);
}

function Scene({ arcs }: { arcs: Arc[] }) {
  const t0 = useRef<number | null>(null);
  const ball = useRef<THREE.Mesh>(null);
  const items = useMemo(
    () =>
      arcs.map((a) => {
        const line = lineObject(a.points, a.color, 0.95);
        line.geometry.setDrawRange(0, 0);
        const land = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.09, 24), new THREE.MeshBasicMaterial({ color: a.color, side: THREE.DoubleSide }));
        land.rotation.x = -Math.PI / 2;
        land.position.copy(a.points[a.points.length - 1]).setY(0.01);
        land.visible = false;
        return { line, land, n: a.points.length };
      }),
    [arcs],
  );

  useFrame((state) => {
    if (t0.current == null) t0.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - t0.current;
    const n = arcs.length;
    // Throw every one in turn, hold the full picture, then clear and replay.
    const loopLen = n * SECONDS_PER_BALL + HOLD_SECONDS;
    const lt = t % loopLen;
    const holding = lt >= n * SECONDS_PER_BALL;
    const cyc = holding ? n - 0.0001 : lt / SECONDS_PER_BALL;
    const idx = Math.min(n - 1, Math.floor(cyc));
    const k = holding ? 0.9999 : cyc % 1;
    const kk = Math.min(1, k / FLIGHT_SHARE);
    items.forEach((it, i) => {
      // Each cycle clears and redraws, so the session keeps replaying.
      const full = i < idx;
      it.line.geometry.setDrawRange(0, full ? it.n : i === idx ? Math.floor(kk * it.n) : 0);
      it.land.visible = full || (i === idx && kk >= 1);
    });
    if (ball.current) {
      const pts = arcs[idx].points;
      ball.current.visible = kk < 1;
      ball.current.position.copy(pts[Math.min(pts.length - 1, Math.floor(kk * (pts.length - 1)))]);
    }
    // slow camera drift
    const a = Math.sin(state.clock.elapsedTime / 5) * 0.18;
    state.camera.position.set(Math.sin(a) * 2.2, 1.6, Math.cos(a) * 1.9);
    state.camera.lookAt(0, 0, -2.2);
  });

  return (
    <>
      <Field />
      {items.map((it, i) => (
        <React.Fragment key={i}>
          <primitive object={it.line} />
          <primitive object={it.land} />
        </React.Fragment>
      ))}
      <mesh ref={ball}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </>
  );
}

export function BallFlight3D({ athleteId }: { athleteId?: string | null }) {
  const arcs = useArcs(athleteId);
  if (!arcs || arcs.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Canvas style={styles.canvas} camera={{ position: [0, 1.6, 1.9], fov: 46, near: 0.05, far: 100 }}>
        <Scene arcs={arcs} />
      </Canvas>
      <View style={styles.legend} pointerEvents="none">
        {[['95+ mph', '#fb923c'], ['90–95', '#fdba74'], ['<90', '#8d939c']].map(([l, c]) => (
          <View key={l} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: c }]} />
            <Text style={styles.legendText}>{l}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption} pointerEvents="none">LAST {arcs.length} BALLS IN PLAY</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 220, marginTop: 14, marginHorizontal: -16, backgroundColor: '#05070a', position: 'relative' },
  canvas: { flex: 1 },
  legend: { position: 'absolute', left: 16, top: 10, flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: '#9ca3af', fontSize: 10, fontWeight: '700' },
  caption: { position: 'absolute', right: 16, bottom: 8, color: '#46505c', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
});
