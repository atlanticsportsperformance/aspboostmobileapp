import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import type { StrictRowData } from '../../../lib/mocap/percentiles';
import { Section, STEEL } from '../../hitting/steel';
import { MetricSheet } from './MetricSheet';
import { RadarHero, RadarKey } from './RadarHero';
import { cap, fmtN, LEGEND, SHORT, velocityOpportunities, zN, zoneOf, type ReportDetail } from './model';
import { useReportModel } from './useMocapScores';

export function ReportTab({
  detail, accent, onSelectEvent,
}: {
  detail: ReportDetail;
  accent: string;
  onSelectEvent?: (eventKey: string) => void;
}) {
  const { model, cohort } = useReportModel(detail);
  const [gsel, setGsel] = useState(-1);
  const [open, setOpen] = useState<{ r: StrictRowData; gi: number } | null>(null);
  const hitting = model.sport === 'hitting';
  const opps = useMemo(() => (hitting ? [] : velocityOpportunities(model.values)), [model.values, hitting]);
  const oppTotal = opps.reduce((s, o) => s + o.mph, 0);
  const CZ = model.tier;

  return (
    <View>
      {/* ── Four groups: hero radar + ring gauges ── */}
      <Section first title="FOUR GROUPS" right="avg metric score · rings = tiers">
        {cohort.loading ? (
          <View style={s.loading}><ActivityIndicator color={STEEL.mute} /></View>
        ) : (
          <RadarHero
            scores={model.groupScores}
            p50={model.p50Group}
            short={SHORT[model.sport]}
            accent={accent}
            noCohortN={cohort.sampleSize}
            onSelect={setGsel}
          />
        )}
        {model.groupScores.some((v) => v != null) && <RadarKey accent={accent} noun={hitting ? 'swing' : 'pitch'} />}
        <Text style={[s.note, { textAlign: 'center', marginTop: 6 }]}>Tap a vertex to open that group's metrics</Text>
        <View style={s.gtiles}>
          {model.groups.map((g, i) => (
            <RingTile key={g.title} title={g.title} value={model.groupScores[i]} onPress={() => setGsel(i)} />
          ))}
        </View>
      </Section>

      {/* ── Composite ── */}
      <Section title={hitting ? 'SWING SCORE' : 'DELIVERY SCORE'} right={cohort.label}>
        <View style={s.hero}>
          <CompositeRing value={model.composite} color={CZ ? CZ.color : '#333'} />
          <View style={{ minWidth: 0, flex: 1 }}>
            <View style={[s.tierpill, { backgroundColor: CZ ? CZ.bg : '#141b24' }]}>
              <Text style={[s.tierpillText, { color: CZ ? CZ.color : STEEL.sub }]}>{CZ ? CZ.label : cohort.loading ? '…' : 'NO COHORT'}</Text>
            </View>
            <Text style={s.tierNote}>
              {CZ
                ? `${CZ.note}. Average of ${model.scoredCount} metric scores vs the research cohort.`
                : cohort.loading
                  ? ''
                  : cohort.skipped
                    ? 'Softball pitching has no percentile cohort yet, so no percentiles or tiers. Values below are this pitch\'s own numbers.'
                    : hitting
                      ? `The hitting cohort query (category baseball_hitting, velocity_min 0${detail.pitch.sex ? `, sex ${detail.pitch.sex}` : ''}) returns ${cohort.sampleSize ?? 0} swings: no hitting swing has stored scalar_metrics yet, so no percentiles or tiers. Values below are this swing's own numbers.`
                      : `No cohort percentiles available (${cohort.label}). Values below are this pitch's own numbers.`}
            </Text>
            <View style={s.legend}>
              {LEGEND.map(([z, b]) => (
                <View key={z.key} style={s.li}><View style={[s.ldot, { backgroundColor: z.color }]} /><Text style={s.lt}>{`${cap(z.label)} ${b}`}</Text></View>
              ))}
            </View>
          </View>
        </View>
      </Section>

      {/* ── Velocity opportunity (pitching only) ── */}
      {!hitting && (
        <Section title="VELOCITY OPPORTUNITY" right="drivers below elite median">
          {opps.length ? (
            <>
              {opps.map((o, i) => (
                <View key={o.key} style={[s.opp, i === 0 && { borderTopWidth: 0 }]}>
                  <View style={s.oppT}>
                    <Text style={s.oppNm}>{o.label}</Text>
                    <Text style={[s.oppMph, { color: accent }]}>+{o.mph.toFixed(1)} mph</Text>
                  </View>
                  <Text style={s.oppD}>{`${fmtN(o.value)} → ${fmtN(o.target)} ${o.unit} elite median`}</Text>
                  <View style={s.oppBar}><View style={{ width: `${(o.mph / 3) * 100}%`, height: '100%', backgroundColor: accent, borderRadius: 2 }} /></View>
                </View>
              ))}
              <View style={[s.opp, s.oppT, { alignItems: 'center' }]}>
                <Text style={s.klabel}>TOP THREE COMBINED</Text>
                <Text style={[s.oppMph, { color: accent, fontSize: 18 }]}>+{oppTotal.toFixed(1)} mph</Text>
              </View>
            </>
          ) : (
            <Text style={s.note}>Every driver metric is at or above the elite median.</Text>
          )}
          <Text style={[s.note, { marginTop: 10 }]}>mph available = gap to the elite median ÷ the metric's change per +1 mph, capped at 3 mph each.</Text>
        </Section>
      )}

      {/* ── Metrics ── */}
      <Section title="METRICS" right="tap for detail">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {['All', ...model.groups.map((g) => g.title)].map((t, i) => {
            const on = i - 1 === gsel;
            return (
              <Pressable key={t} onPress={() => setGsel(i - 1)} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[s.chipText, on && { color: '#fff' }]}>{t}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ marginTop: 12 }}>
          {model.rows.map((d, gi) => {
            if (gsel >= 0 && gi !== gsel) return null;
            return (
              <View key={model.groups[gi].title}>
                {gsel < 0 && <Text style={[s.klabel, { marginTop: gi ? 18 : 4, marginBottom: 4 }]}>{model.groups[gi].title.toUpperCase()}</Text>}
                {d.map((r) => (
                  <MetricRow key={`${gsel}-${r.key}`} r={r} hitting={hitting} onPress={() => setOpen({ r, gi })} />
                ))}
              </View>
            );
          })}
        </View>
      </Section>

      <MetricSheet
        row={open?.r ?? null}
        groupTitle={open ? model.groups[open.gi].title : ''}
        cohortText={cohort.label}
        accent={accent}
        onClose={() => setOpen(null)}
        onSelectEvent={onSelectEvent}
      />
    </View>
  );
}

function CompositeRing({ value, color }: { value: number | null; color: string }) {
  const C = 2 * Math.PI * 50;
  const sc = value || 0;
  return (
    <View style={s.ring}>
      <Svg width={118} height={118} viewBox="0 0 118 118">
        <Circle cx={59} cy={59} r={50} fill="none" stroke="#141b24" strokeWidth={10} />
        <Circle cx={59} cy={59} r={50} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${(C * sc) / 100} ${C}`} transform="rotate(-90 59 59)" />
      </Svg>
      <View style={s.ringN} pointerEvents="none">
        <Text style={[s.ringB, value != null && { color }]}>{value == null ? '—' : Math.round(value)}</Text>
        <Text style={s.ringS}>OF 100</Text>
      </View>
    </View>
  );
}

function RingTile({ title, value, onPress }: { title: string; value: number | null; onPress: () => void }) {
  const z = zN(value);
  const R = 27, C = 2 * Math.PI * R;
  const f = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const short = title.split(/ & | /)[0];
  return (
    <Pressable style={s.gt} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title} ${value == null ? 'no score' : Math.round(value)}`}>
      <Svg width={70} height={70} viewBox="0 0 70 70">
        <Circle cx={35} cy={35} r={R} fill="none" stroke="#141b24" strokeWidth={5} />
        {value != null && (
          <Circle cx={35} cy={35} r={R} fill="none" stroke={z.color} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${(C * f).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 35 35)" />
        )}
        <SvgText x={35} y={41} textAnchor="middle" fill="#fff" fontSize={19} fontWeight="800">{value == null ? '—' : String(Math.round(value))}</SvgText>
      </Svg>
      <Text style={s.gl}>{short.toUpperCase()}</Text>
      <Text style={s.gz}>{cap(z.label)}</Text>
    </Pressable>
  );
}

function MetricRow({ r, hitting, onPress }: { r: StrictRowData; hitting: boolean; onPress: () => void }) {
  const z = r.score == null ? null : zoneOf(r.score);
  return (
    <Pressable onPress={onPress} style={s.mrow} accessibilityRole="button">
      <View style={s.mrowT}>
        <View style={{ minWidth: 0, flex: 1 }}>
          <Text style={s.mNm}>{r.axisLabel}</Text>
          <Text style={s.mTm}>{`${r.timing || ''} · ${hitting || r.scoring === 'higher' ? 'higher is better' : 'optimal near P50'}`}</Text>
        </View>
        <Text style={s.mV}>
          {r.raw == null ? '—' : fmtN(r.raw)}
          {r.raw != null ? <Text style={s.mVs}> {r.unit}</Text> : null}
        </Text>
      </View>
      <View style={s.mB}>
        <PTrack pct={r.pct} color={z?.color ?? null} />
        <View style={s.pc}>
          {r.pct == null ? (
            <Text style={[s.pcT, { color: '#4b5563' }]}>—</Text>
          ) : (
            <>
              <Text style={[s.pcT, { color: z!.color }]}>P{Math.round(r.pct)}</Text>
              <Text style={[s.pcT, { color: '#6b7280', fontSize: 10 }]}>score {Math.round(r.score!)}</Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
}

/** Percentile track: 4 muted tier segments, P50 tick, athlete dot in tier colour with glow. */
function PTrack({ pct, color }: { pct: number | null; color: string | null }) {
  const [w, setW] = useState(0);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    a.setValue(0);
    Animated.timing(a, { toValue: 1, duration: 600, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, [pct, w]);
  if (pct == null || !color) return <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: '#141b24' }} />;
  const p = Math.max(1, Math.min(99, pct)) / 100;
  return (
    <View style={s.ptrack} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[s.seg, { left: `${i * 25}%` }]} />
      ))}
      <View style={s.p50} />
      {w > 0 && (
        <Animated.View
          style={[
            s.dot,
            { backgroundColor: color, shadowColor: color, opacity: a, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [-6, w * p - 6] }) }] },
          ]}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  loading: { height: 220, alignItems: 'center', justifyContent: 'center' },
  note: { color: STEEL.mute, fontSize: 11, lineHeight: 16 },
  klabel: { color: STEEL.mute, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  gtiles: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10, marginBottom: 2 },
  gt: { flex: 1, alignItems: 'center', gap: 6 },
  gl: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3, color: '#9ca3af' },
  gz: { fontSize: 10, fontWeight: '700', color: '#6b7280', marginTop: -3 },
  hero: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  ring: { width: 118, height: 118 },
  ringN: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ringB: { color: '#fff', fontSize: 40, lineHeight: 42, fontWeight: '800', letterSpacing: -1.6, fontVariant: ['tabular-nums'] },
  ringS: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.4, color: STEEL.mute, marginTop: 4 },
  tierpill: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  tierpillText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4 },
  tierNote: { fontSize: 13, color: STEEL.day, lineHeight: 19.5, marginTop: 10 },
  legend: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 12 },
  li: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ldot: { width: 8, height: 8, borderRadius: 4 },
  lt: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: STEEL.mute },
  opp: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: STEEL.rule },
  oppT: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  oppNm: { color: '#fff', fontSize: 14, fontWeight: '700', flexShrink: 1 },
  oppMph: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  oppD: { color: STEEL.sub, fontSize: 12, marginTop: 3, fontVariant: ['tabular-nums'] },
  oppBar: { height: 4, borderRadius: 2, backgroundColor: '#1b2430', marginTop: 8, overflow: 'hidden' },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: STEEL.card, borderWidth: 1, borderColor: STEEL.rule },
  chipOn: { backgroundColor: '#1b2430', borderColor: '#2a3442' },
  chipText: { color: STEEL.sub, fontSize: 12.5, fontWeight: '700' },
  mrow: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: STEEL.rule },
  mrowT: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  mNm: { fontSize: 14, fontWeight: '700', color: '#fff' },
  mTm: { fontSize: 10.5, color: STEEL.mute, fontWeight: '600', marginTop: 2 },
  mV: { color: '#fff', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  mVs: { fontSize: 11, color: STEEL.mute, fontWeight: '700' },
  mB: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 9 },
  pc: { width: 64, alignItems: 'flex-end' },
  pcT: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3, lineHeight: 13, fontVariant: ['tabular-nums'] },
  ptrack: { flex: 1, height: 8 },
  seg: { position: 'absolute', top: 2, height: 4, width: '25%', backgroundColor: '#1b2430', borderRadius: 2, borderRightWidth: 3, borderRightColor: '#000' },
  p50: { position: 'absolute', left: '50%', top: -3, width: 1.5, height: 14, backgroundColor: 'rgba(255,255,255,0.45)' },
  dot: {
    position: 'absolute', left: 0, top: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#000',
    shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
});
