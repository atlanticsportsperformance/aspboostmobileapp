import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { fmt, Kpi, KpiRow, Section, STEEL, steelStyles } from '../../hitting/steel';
import { cap, curveAt, curveGrid, sportOf, tOfIdx, zoneOf, type CurveGrid, type ReportDetail, type ReportPitch } from './model';
import { useReportModel } from './useMocapScores';

const W = 358, H = 230, PL = 38, PR = 8, PT = 12, PB = 26;
const KW = 358, KH = 110;

interface Series { k: string; n: string; col: string }
const PITCH_SER: Series[] = [
  { k: 'pelvisRotVelo', n: 'Pelvis', col: '#5ce1ff' },
  { k: 'trunkRotVelo', n: 'Trunk', col: '#34d399' },
  { k: 'elbowFlexVelo', n: 'Elbow ext', col: '#fbbf24' },
  { k: 'shoulderRotVelo', n: 'Shoulder IR', col: '#a78bfa' },
];
// Hitting: no bat series (owner). Arm = extractor shoulderRotVelo curve.
const HIT_SER: Series[] = [
  { k: 'pelvisRotVelo', n: 'Pelvis', col: '#5ce1ff' },
  { k: 'trunkRotVelo', n: 'Trunk', col: '#34d399' },
  { k: 'shoulderRotVelo', n: 'Arm', col: '#fbbf24' },
];

interface Peak { n: string; col: string; v: number; t: number }

function samples(p: ReportPitch, g: CurveGrid, key: string, t0: number, t1: number, sign = 1) {
  const a = p.curves?.[key];
  const out: { t: number; v: number }[] = [];
  if (!a) return out;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    const t = tOfIdx(g, i);
    if (v == null || !Number.isFinite(v) || t < t0 || t > t1) continue;
    out.push({ t, v: v * sign });
  }
  return out;
}
function orientSign(p: ReportPitch, g: CurveGrid, key: string, tA: number, tB: number) {
  let m = 0, s = 1;
  for (const x of samples(p, g, key, tA, tB)) if (Math.abs(x.v) > m) { m = Math.abs(x.v); s = x.v < 0 ? -1 : 1; }
  return s;
}

export function EnergyTab({ detail, accent }: { detail: ReportDetail; accent: string }) {
  const p = detail.pitch;
  const sport = sportOf(p);
  const hitting = sport === 'hitting';
  const { model } = useReportModel(detail);
  const g = useMemo(() => curveGrid(p, sport), [p, sport]);
  const ET = p.eventTimes || {};

  const kin = useMemo(() => {
    if (!g) return null;
    const ser = hitting ? HIT_SER : PITCH_SER;
    let t0: number, t1: number, ref: number, step: number;
    let events: [string, number | undefined, 'start' | 'middle' | 'end'][];
    let ticks: number[];
    if (hitting) {
      t0 = ET.load - 0.05; t1 = ET.peakRot + 0.15; ref = ET.peakRot; step = 500;
      events = [['LOAD', ET.load, 'middle'], ['FP', ET.fp, 'end'], ['FM', ET.fm, 'start'], ['PEAK', ET.peakRot, 'middle']];
      ticks = [-200, -100, 0, 100];
    } else {
      t0 = ET.fp - 0.22 * (ET.fp - ET.pkh); t1 = ET.br + 0.25 * (ET.br - ET.fp); ref = ET.br; step = 1000;
      events = [['FP', ET.fp, 'middle'], ['MER', ET.mer, 'end'], ['BR', ET.br, 'start']];
      ticks = [-200, -150, -100, -50, 0, 50];
    }
    const data = ser.map((se) => {
      const sign = hitting ? orientSign(p, g, se.k, ET.load, ET.peakRot + 0.167) : 1;
      return { se, pts: samples(p, g, se.k, t0, t1, sign) };
    }).filter((d) => d.pts.length > 1);
    if (!data.length) return null;
    let ymax = 0;
    data.forEach((d) => d.pts.forEach((x) => { ymax = Math.max(ymax, x.v); }));
    ymax = Math.max(step, Math.ceil(ymax / step) * step);
    const ymin = -step;
    const X = (t: number) => PL + ((t - t0) / (t1 - t0)) * (W - PL - PR);
    const Y = (v: number) => PT + ((ymax - v) / (ymax - ymin)) * (H - PT - PB);
    const peaks: Peak[] = [];
    const paths = data.map(({ se, pts }) => {
      let best = pts[0];
      const d = pts.map((x, i) => { if (x.v > best.v) best = x; return `${i ? 'L' : 'M'}${X(x.t).toFixed(1)},${Y(x.v).toFixed(1)}`; }).join('');
      peaks.push({ n: se.n, col: se.col, v: best.v, t: best.t });
      return { se, d, best };
    });
    const grid: number[] = [];
    for (let v = ymin; v <= ymax; v += step) grid.push(v);
    return { t0, t1, ref, X, Y, grid, events, ticks, paths, peaks };
  }, [p, g, hitting]);

  const knee = useMemo(() => {
    if (!g || !p.curves?.leadKneeFlex) return null;
    const kfp = curveAt(p, g, 'leadKneeFlex', ET.fp);
    const kend = curveAt(p, g, 'leadKneeFlex', hitting ? ET.peakRot : ET.br);
    const f0 = hitting ? ET.load - 30 / 360 : ET.fp - 60 / 360;
    const f1 = hitting ? ET.peakRot + 60 / 360 : ET.br + 30 / 360;
    const pts = samples(p, g, 'leadKneeFlex', f0, f1);
    if (pts.length < 2) return { kfp, kend, chart: null };
    let kmin = Infinity, kmax = -Infinity;
    pts.forEach((x) => { kmin = Math.min(kmin, x.v); kmax = Math.max(kmax, x.v); });
    kmin = Math.floor(kmin / 10) * 10; kmax = Math.ceil(kmax / 10) * 10; if (kmax === kmin) kmax += 10;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const kx = (t: number) => 30 + ((t - t0) / (t1 - t0 || 1)) * (KW - 38);
    const ky = (v: number) => 8 + ((kmax - v) / (kmax - kmin)) * (KH - 28);
    const d = pts.map((x, i) => `${i ? 'L' : 'M'}${kx(x.t).toFixed(1)},${ky(x.v).toFixed(1)}`).join('');
    const ev: [string, number | undefined, 'start' | 'middle' | 'end'][] = hitting
      ? [['FP', ET.fp, 'end'], ['FM', ET.fm, 'start'], ['PEAK', ET.peakRot, 'middle']]
      : [['FP', ET.fp, 'middle'], ['BR', ET.br, 'middle']];
    return { kfp, kend, chart: { d, kx, ky, kmin, kmax, ev: ev.filter((e) => e[1] != null && e[1]! >= t0 && e[1]! <= t1) } };
  }, [p, g, hitting]);

  if (!g) {
    return (
      <Section first>
        <Text style={steelStyles.empty}>No extractor curves or event times for this {hitting ? 'swing' : 'pitch'}.</Text>
      </Section>
    );
  }

  const ordered = kin ? kin.peaks.slice().sort((a, b) => a.t - b.t) : [];
  const inOrder = kin ? ordered.every((x, i) => x === kin.peaks[i]) : false;
  const smExt = p.scalarMetrics?.leadKneeExt;
  const ext = hitting
    ? (knee?.kfp != null && knee?.kend != null ? knee.kfp - knee.kend : null)
    : (smExt != null ? smExt : knee?.kfp != null && knee?.kend != null ? knee.kfp - knee.kend : null);
  const lr = model.rows.flat().find((r) => r.key === 'leadKneeExt');
  const lz = !hitting && lr && lr.score != null ? zoneOf(lr.score) : null;
  const extNote = hitting
    ? ext == null ? undefined : ext >= 0 ? 'straightened into rotation' : 'flexed into rotation'
    : lr && lr.pct != null && lz ? `P${Math.round(lr.pct)} · ${cap(lz.label)}` : undefined;

  return (
    <View>
      <Section first title="KINEMATIC SEQUENCE" right={hitting ? '°/s · ms from peak rot' : '°/s · ms from release'}>
        {kin ? (
          <>
            <Svg width="100%" height={undefined} viewBox={`0 0 ${W} ${H}`} style={{ aspectRatio: W / H }}>
              {kin.grid.map((v) => (
                <React.Fragment key={v}>
                  <Line x1={PL} x2={W - PR} y1={kin.Y(v)} y2={kin.Y(v)} stroke={v === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)'} />
                  <SvgText x={PL - 5} y={kin.Y(v) + 3} textAnchor="end" fontSize={9} fill="#6b7280">{`${v / 1000}k`}</SvgText>
                </React.Fragment>
              ))}
              {kin.events.filter((e) => e[1] != null && e[1]! >= kin.t0 && e[1]! <= kin.t1).map(([n, t, anc]) => (
                <React.Fragment key={n}>
                  <Line x1={kin.X(t!)} x2={kin.X(t!)} y1={PT} y2={H - PB} stroke="rgba(255,255,255,0.28)" strokeDasharray="3 3" />
                  <SvgText x={kin.X(t!) + (anc === 'start' ? 3 : anc === 'end' ? -3 : 0)} y={PT + 6} textAnchor={anc} fontSize={9} fontWeight="800" letterSpacing={0.8} fill="#9ca3af">{n}</SvgText>
                </React.Fragment>
              ))}
              {kin.ticks.map((ms) => {
                const t = kin.ref + ms / 1000;
                if (t < kin.t0 || t > kin.t1) return null;
                return <SvgText key={ms} x={kin.X(t)} y={H - 8} textAnchor="middle" fontSize={9} fill="#6b7280">{`${ms > 0 ? '+' : ''}${ms}`}</SvgText>;
              })}
              {kin.paths.map(({ se, d, best }) => (
                <React.Fragment key={se.k}>
                  <Path d={d} fill="none" stroke={se.col} strokeWidth={2} strokeLinejoin="round" />
                  <Circle cx={kin.X(best.t)} cy={kin.Y(best.v)} r={3.5} fill={se.col} stroke="#000" strokeWidth={1.5} />
                </React.Fragment>
              ))}
            </Svg>
            <View style={s.pk}>
              {kin.peaks.map((pk) => {
                const ms = Math.round((pk.t - kin.ref) * 1000);
                return (
                  <View key={pk.n} style={s.pkc}>
                    <View style={s.pkl}><View style={[s.pki, { backgroundColor: pk.col }]} /><Text style={s.pklt}>{pk.n.toUpperCase()}</Text></View>
                    <Text style={s.pkb}>{Math.round(pk.v).toLocaleString('en-US')} <Text style={s.pks}>°/s</Text></Text>
                    <Text style={s.pkw}>{`peak ${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms)} ms vs ${hitting ? 'peak rot' : 'BR'}`}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : (
          <Text style={steelStyles.empty}>No angular-velocity curves for this {hitting ? 'swing' : 'pitch'}.</Text>
        )}
      </Section>

      {kin && (
        <Section>
          <View style={s.ebrow}>
            <Text style={s.eyebrow}>SEQUENCE ORDER</Text>
            <Text style={[s.enote, { color: inOrder ? STEEL.good : STEEL.warn }]}>{inOrder ? '✓ proximal → distal' : 'out of order'}</Text>
          </View>
          <View style={s.seq}>
            {ordered.map((pk, i) => (
              <React.Fragment key={pk.n}>
                {i > 0 && <Text style={s.seqG}>{`${pk.t >= ordered[i - 1].t ? '+' : ''}${Math.round((pk.t - ordered[i - 1].t) * 1000)} ms →`}</Text>}
                <View style={s.seqN}><Text style={[s.seqNT, { color: pk.col }]}>{pk.n}</Text></View>
              </React.Fragment>
            ))}
          </View>
          <Text style={[s.note, { marginTop: 10 }]}>
            {hitting
              ? 'Proximal to distal: pelvis, trunk, then arm. Rotation rates are segment velocities from the extractor. Gaps are the time between successive peaks.'
              : 'Proximal to distal: pelvis, trunk, elbow extension, then shoulder internal rotation. Gaps are the time between successive peaks.'}
          </Text>
        </Section>
      )}

      {knee && (
        <Section title="LEAD-LEG BLOCK" right="lead knee flexion">
          <KpiRow>
            <Kpi label="AT FOOT PLANT" value={fmt(knee.kfp, 1)} unit="°" />
            <Kpi label={hitting ? 'AT PEAK ROT' : 'AT RELEASE'} value={fmt(knee.kend, 1)} unit="°" />
            <Kpi label="EXTENSION" value={fmt(ext, 1)} unit="°" color={lz ? lz.color : STEEL.text} note={extNote} />
          </KpiRow>
          {knee.chart && (
            <Svg width="100%" height={undefined} viewBox={`0 0 ${KW} ${KH}`} style={{ aspectRatio: KW / KH, marginTop: 14 }}>
              {[knee.chart.kmin, (knee.chart.kmin + knee.chart.kmax) / 2, knee.chart.kmax].map((v) => (
                <React.Fragment key={v}>
                  <Line x1={30} x2={KW - 8} y1={knee.chart!.ky(v)} y2={knee.chart!.ky(v)} stroke="rgba(255,255,255,0.06)" />
                  <SvgText x={25} y={knee.chart!.ky(v) + 3} fontSize={9} fill="#6b7280" textAnchor="end">{`${Math.round(v)}°`}</SvgText>
                </React.Fragment>
              ))}
              {knee.chart.ev.map(([n, t, anc]) => (
                <React.Fragment key={n}>
                  <Line x1={knee.chart!.kx(t!)} x2={knee.chart!.kx(t!)} y1={8} y2={KH - 20} stroke="rgba(255,255,255,0.28)" strokeDasharray="3 3" />
                  <SvgText x={knee.chart!.kx(t!) + (anc === 'end' ? -2 : anc === 'start' ? 2 : 0)} y={KH - 6} fontSize={9} fontWeight="800" fill="#9ca3af" textAnchor={anc}>{n}</SvgText>
                </React.Fragment>
              ))}
              <Path d={knee.chart.d} fill="none" stroke={accent} strokeWidth={2} />
              <SvgText x={KW - 8} y={18} fontSize={9} fill="#6b7280" textAnchor="end">extractor leadKneeFlex curve</SvgText>
            </Svg>
          )}
        </Section>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  ebrow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 },
  eyebrow: { color: '#e5e7eb', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  enote: { fontSize: 11, fontWeight: '600' },
  note: { color: STEEL.mute, fontSize: 11, lineHeight: 16 },
  pk: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pkc: { flexBasis: '48%', flexGrow: 1, backgroundColor: STEEL.card, borderWidth: 1, borderColor: STEEL.rule, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 11 },
  pkl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pki: { width: 8, height: 8, borderRadius: 4 },
  pklt: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, color: STEEL.mute },
  pkb: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.4, marginTop: 4, fontVariant: ['tabular-nums'] },
  pks: { fontSize: 10.5, color: STEEL.mute, fontWeight: '700', letterSpacing: 0 },
  pkw: { fontSize: 10.5, color: STEEL.sub, fontWeight: '600', marginTop: 1, fontVariant: ['tabular-nums'] },
  seq: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  seqN: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: '#141b24' },
  seqNT: { fontSize: 12, fontWeight: '800' },
  seqG: { fontSize: 10.5, color: STEEL.mute, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
