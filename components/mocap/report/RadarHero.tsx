import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, Path, Polygon, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { lighten, zN, ZONES, type Tier } from './model';

const VW = 358, VH = 340, CX = 179, CY = 170, RR = 112, PW = 62;
const ANG = [-90, 0, 90, 180];
const CAGE = [-90, -45, 0, 45, 90, 135, 180, 225];

function pt(a: number, r: number) {
  const t = (a * Math.PI) / 180;
  return { x: CX + Math.cos(t) * RR * r / 100, y: CY + Math.sin(t) * RR * r / 100 };
}
function oct(p: number) {
  return CAGE.map((a) => { const q = pt(a, p); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ');
}
function smoothPath(ps: { x: number; y: number }[]) {
  const n = ps.length;
  let d = `M${ps[0].x.toFixed(1)},${ps[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = ps[(i - 1 + n) % n], p1 = ps[i], p2 = ps[(i + 1) % n], p3 = ps[(i + 2) % n];
    d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)},${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)},${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d + ' Z';
}
function pillPos(i: number) {
  const a = ANG[i], q = pt(a, 100);
  if (a === -90) return { x: CX - PW / 2, y: q.y - 50 };
  if (a === 90) return { x: CX - PW / 2, y: q.y + 8 };
  if (a === 0) return { x: q.x + 4, y: q.y - 23 };
  return { x: q.x - PW - 4, y: q.y - 23 };
}

export function RadarHero({
  scores, p50, short, accent, noCohortN, onSelect,
}: {
  scores: (number | null)[];
  p50: (number | null)[];
  short: string[];
  accent: string;
  /** When no group has a score, show the honest "No cohort" centre text with this n. */
  noCohortN: number | null;
  onSelect: (g: number) => void;
}) {
  const [w, setW] = useState(0);
  const k = w / VW;
  const cage = useRef(new Animated.Value(0)).current;
  const med = useRef(new Animated.Value(0)).current;
  const grow = useRef(new Animated.Value(0)).current;
  const pills = useRef(new Animated.Value(0)).current;
  const hasA = scores.some((v) => v != null);
  const hasP = p50.some((v) => v != null);
  const key = scores.map((s) => (s == null ? 'x' : Math.round(s))).join(',');

  useEffect(() => {
    [cage, med, grow, pills].forEach((v) => v.setValue(0));
    Animated.parallel([
      Animated.timing(cage, { toValue: 1, duration: 500, delay: 50, easing: Easing.ease, useNativeDriver: true }),
      Animated.timing(med, { toValue: 1, duration: 500, delay: 450, easing: Easing.ease, useNativeDriver: true }),
      Animated.timing(grow, { toValue: 1, duration: 900, delay: 250, easing: Easing.bezier(0.2, 1.25, 0.35, 1), useNativeDriver: true }),
      Animated.timing(pills, { toValue: 1, duration: 450, delay: 750, easing: Easing.ease, useNativeDriver: true }),
    ]).start();
  }, [key]);

  const bands: [number, number, Tier][] = [[100, 75, ZONES.elite], [75, 50, ZONES.proficient], [50, 25, ZONES.developing], [25, 0, ZONES.foundation]];
  const ap = scores.map((g, i) => pt(ANG[i], Math.max(g || 0, 3)));
  const cp = p50.map((g, i) => pt(ANG[i], g || 0));
  const stroke = lighten(accent);
  const vb = `0 0 ${VW} ${VH}`;
  const H = w * VH / VW;
  const layer = { position: 'absolute' as const, left: 0, top: 0, width: w, height: H };

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ width: '100%', height: H || 1 }}>
      {w > 0 && (
        <>
          <Animated.View style={[layer, { opacity: cage }]} pointerEvents="none">
            <Svg width={w} height={H} viewBox={vb}>
              {bands.map(([o, i, z]) => (
                <G key={`b${o}`}>
                  <Polygon points={oct(o)} fill={z.color} fillOpacity={0.045} />
                  <Polygon points={oct(i || 0.01)} fill="#000" />
                </G>
              ))}
              {bands.map(([o, , z]) => (
                <Polygon key={`r${o}`} points={oct(o)} fill="none" stroke={z.color} strokeOpacity={o === 100 ? 0.35 : 0.22} strokeWidth={1} />
              ))}
              {CAGE.map((a, i) => { const q = pt(a, 100); return <Line key={a} x1={CX} y1={CY} x2={q.x} y2={q.y} stroke={i % 2 ? '#16161b' : '#2a2f38'} />; })}
              {([[25, ZONES.developing], [50, ZONES.proficient], [75, ZONES.elite]] as [number, Tier][]).map(([r, z]) => {
                const q = pt(-67.5, r);
                return <SvgText key={r} x={q.x + 3} y={q.y + 3} fontSize={8} fontWeight="800" fill={z.color} fillOpacity={0.7}>{String(r)}</SvgText>;
              })}
            </Svg>
          </Animated.View>
          {hasP && (
            <Animated.View style={[layer, { opacity: med }]} pointerEvents="none">
              <Svg width={w} height={H} viewBox={vb}>
                <Path d={smoothPath(cp)} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.3} strokeDasharray="4 4" />
              </Svg>
            </Animated.View>
          )}
          <Animated.View
            pointerEvents="none"
            style={[layer, hasA ? { opacity: grow.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 1, 1] }), transform: [{ scale: grow }] } : { opacity: grow }]}
          >
            <Svg width={w} height={H} viewBox={vb}>
              {hasA ? (
                <>
                  <Defs>
                    <RadialGradient id="rg" cx={CX} cy={CY} r={RR} fx={CX} fy={CY} gradientUnits="userSpaceOnUse">
                      <Stop offset="0" stopColor={accent} stopOpacity={0.05} />
                      <Stop offset="1" stopColor={accent} stopOpacity={0.42} />
                    </RadialGradient>
                  </Defs>
                  {/* glow: blurred halo approximated with wide low-opacity strokes */}
                  <Path d={smoothPath(ap)} fill={accent} fillOpacity={0.12} stroke={accent} strokeOpacity={0.12} strokeWidth={10} strokeLinejoin="round" />
                  <Path d={smoothPath(ap)} fill="none" stroke={accent} strokeOpacity={0.22} strokeWidth={5} strokeLinejoin="round" />
                  <Path d={smoothPath(ap)} fill="url(#rg)" stroke={stroke} strokeWidth={2.2} strokeLinejoin="round" />
                  {ap.map((q, i) => <Circle key={i} cx={q.x} cy={q.y} r={5} fill={zN(scores[i]).color} stroke="#000" strokeWidth={2} />)}
                </>
              ) : (
                <>
                  <SvgText x={CX} y={CY - 6} textAnchor="middle" fontSize={12} fontWeight="800" letterSpacing={1.4} fill="#d7e0ea">NO COHORT</SvgText>
                  <SvgText x={CX} y={CY + 12} textAnchor="middle" fontSize={10.5} fill="#9ca3af">
                    {noCohortN != null ? `n=${noCohortN} with scalar metrics` : 'no percentile cohort'}
                  </SvgText>
                </>
              )}
            </Svg>
          </Animated.View>
          <Animated.View style={[layer, { opacity: pills }]} pointerEvents="none">
            <Svg width={w} height={H} viewBox={vb}>
              {ANG.map((_, i) => {
                const z = zN(scores[i]);
                const { x, y } = pillPos(i);
                const dark = z.key === 'none' ? '#d7e0ea' : z.key === 'developing' ? '#0b0d10' : '#04060a';
                return (
                  <G key={i}>
                    <Rect x={x + PW / 2 - 22} y={y} width={44} height={22} rx={11} fill={z.color} />
                    <SvgText x={x + PW / 2} y={y + 15.5} textAnchor="middle" fontSize={13} fontWeight="800" fill={dark}>
                      {scores[i] == null ? '—' : String(Math.round(scores[i]!))}
                    </SvgText>
                    <SvgText x={x + PW / 2} y={y + 35} textAnchor="middle" fontSize={9} fontWeight="800" letterSpacing={1.3} fill="#9ca3af">{short[i]}</SvgText>
                    <SvgText x={x + PW / 2} y={y + 46} textAnchor="middle" fontSize={8.5} fontWeight="700" fill="#6b7280">
                      {`P50 ${p50[i] == null ? '—' : Math.round(p50[i]!)}`}
                    </SvgText>
                  </G>
                );
              })}
            </Svg>
          </Animated.View>
          {ANG.map((_, i) => {
            const { x, y } = pillPos(i);
            return (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`${short[i]} group`}
                onPress={() => onSelect(i)}
                style={{ position: 'absolute', left: (x - 6) * k, top: (y - 4) * k, width: (PW + 12) * k, height: 54 * k }}
              />
            );
          })}
        </>
      )}
    </View>
  );
}

export function RadarKey({ accent, noun }: { accent: string; noun: string }) {
  return (
    <View style={st.legend}>
      <View style={st.li}><View style={[st.dot, { backgroundColor: lighten(accent) }]} /><Animated.Text style={st.lt}>{`This ${noun}`}</Animated.Text></View>
      <View style={st.li}><View style={st.dash} /><Animated.Text style={st.lt}>Cohort median</Animated.Text></View>
    </View>
  );
}

const st = StyleSheet.create({
  legend: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 },
  li: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dash: { width: 12, height: 0, borderTopWidth: 1.3, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.6)' },
  lt: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#6b7280' },
});
