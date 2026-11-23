/**
 * BallField3D — batted balls drawn as flight arcs over a field (foul
 * lines, fence, infield diamond). Shared by the home feed and the hitting
 * screens; callers pass the balls.
 *
 * Each arc uses the swing's exit velo, launch angle, spray
 * (horizontal_angle) and distance. Apex height is approximated from
 * launch angle and distance (HitTrax doesn't store apex), so the shape
 * is representative while the landing spot is exact.
 *
 * Balls fly one at a time, the full picture holds, then it clears and
 * replays. Only mounted while on screen: expo-gl only keeps presenting
 * frames for the newest GL view, so one live GL view at a time.
 */

import React, { useMemo, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';
import { useInView } from '../../hooks/useInView';
import { evColor } from './steel';

export type BattedBall = {
  exit_velocity: number | null;
  launch_angle: number | null;
  horizontal_angle: number | null;
  distance: number | null;
};

type Arc = { points: THREE.Vector3[]; color: string };

const S = 0.01; // 1 unit = 100 ft
const HOLD_SECONDS = 1.6;
const FLIGHT_SHARE = 0.75;
const FENCE = (deg: number) => (400 - (Math.abs(deg) / 45) * 70) * S;

function buildArc(b: BattedBall): Arc | null {
  if (!b.distance || b.distance <= 0 || b.launch_angle == null) return null;
  const spray = b.horizontal_angle ?? 0;
  const rad = ((90 - spray) * Math.PI) / 180;
  const d = b.distance * S;
  const la = Math.max(0, b.launch_angle);
  const apex = Math.tan((la * Math.PI) / 180) * d * 0.28 + 0.05;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 60; i++) {
    const u = i / 60;
    points.push(new THREE.Vector3(d * u * Math.cos(rad), 0.03 + 4 * apex * u * (1 - u) * (1 - 0.12 * u), -d * u * Math.sin(rad)));
  }
  return { points, color: evColor(b.exit_velocity ?? 0) };
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

function Scene({ arcs, secondsPerBall }: { arcs: Arc[]; secondsPerBall: number }) {
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
    if (t0.current == null) t0.current = Date.now();
    const t = (Date.now() - t0.current) / 1000;
    const n = arcs.length;
    const loopLen = n * secondsPerBall + HOLD_SECONDS;
    const lt = t % loopLen;
    const holding = lt >= n * secondsPerBall;
    const cyc = holding ? n - 0.0001 : lt / secondsPerBall;
    const idx = Math.min(n - 1, Math.floor(cyc));
    const kk = holding ? 1 : Math.min(1, (cyc % 1) / FLIGHT_SHARE);
    items.forEach((it, i) => {
      const full = holding || i < idx;
      it.line.geometry.setDrawRange(0, full ? it.n : i === idx ? Math.floor(kk * it.n) : 0);
      it.land.visible = full || (i === idx && kk >= 1);
    });
    if (ball.current) {
      const pts = arcs[idx].points;
      ball.current.visible = !holding && kk < 1;
      ball.current.position.copy(pts[Math.min(pts.length - 1, Math.floor(kk * (pts.length - 1)))]);
    }
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

export function BallField3D({
  balls,
  height = 220,
  caption,
  secondsPerBall = 1.2,
  bleed = 16,
}: {
  balls: BattedBall[];
  height?: number;
  caption?: string;
  secondsPerBall?: number;
  /** Horizontal page padding to bleed past, so the field runs edge to edge. */
  bleed?: number;
}) {
  const arcs = useMemo(() => balls.map(buildArc).filter(Boolean) as Arc[], [balls]);
  const { ref, inView } = useInView();
  if (arcs.length === 0) return null;
  return (
    <View ref={ref} style={[styles.wrap, { height, marginHorizontal: -bleed }]} collapsable={false}>
      {inView && (
        <Canvas style={styles.canvas} camera={{ position: [0, 1.6, 1.9], fov: 46, near: 0.05, far: 100 }}>
          <Scene arcs={arcs} secondsPerBall={secondsPerBall} />
        </Canvas>
      )}
      <View style={[styles.legend, { left: bleed }]} pointerEvents="none">
        {[['95+ mph', evColor(95)], ['90–95', evColor(90)], ['<90', evColor(0)]].map(([l, c]) => (
          <View key={l} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: c }]} />
            <Text style={styles.legendText}>{l}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.caption, { right: bleed }]} pointerEvents="none">
        {caption ?? `${arcs.length} BALLS IN PLAY`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, backgroundColor: '#05070a', position: 'relative' },
  canvas: { flex: 1 },
  legend: { position: 'absolute', top: 10, flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: '#9ca3af', fontSize: 10, fontWeight: '700' },
  caption: { position: 'absolute', bottom: 8, color: '#46505c', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
});
