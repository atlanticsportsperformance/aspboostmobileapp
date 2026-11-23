import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { buildDistributionPath, type StrictRowData } from '../../../lib/mocap/percentiles';
import { STEEL } from '../../hitting/steel';
import { cap, fmtN, withAlpha, zoneOf } from './model';

const W = 322, H = 74;

/** Event a metric's timing refers to, for the optional "view in Motion" jump. */
function eventOf(timing: string | undefined): string | null {
  if (!timing) return null;
  if (/\(FP\)|At foot plant|at foot plant/i.test(timing)) return 'fp';
  if (/\(MER\)/i.test(timing)) return 'mer';
  if (/\(BR\)/i.test(timing)) return 'br';
  if (/first move/i.test(timing)) return 'fm';
  if (/At peak rotation/i.test(timing)) return 'peakRot';
  return null;
}

export function MetricSheet({
  row, groupTitle, cohortText, accent, onClose, onSelectEvent,
}: {
  row: StrictRowData | null;
  groupTitle: string;
  cohortText: string;
  accent: string;
  onClose: () => void;
  onSelectEvent?: (eventKey: string) => void;
}) {
  const [shown, setShown] = useState<StrictRowData | null>(row);
  const y = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (row) {
      setShown(row);
      y.setValue(1);
      Animated.timing(y, { toValue: 0, duration: 280, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
    }
  }, [row]);
  const close = () => {
    Animated.timing(y, { toValue: 1, duration: 220, easing: Easing.in(Easing.ease), useNativeDriver: true }).start(() => {
      setShown(null);
      onClose();
    });
  };
  const r = shown;
  if (!r) return null;
  const z = r.score == null ? null : zoneOf(r.score);
  const zc = z ? z.color : '#fff';
  const pc = r.percentiles;
  const diff = r.raw != null && pc ? r.raw - pc['50'] : null;
  const ev = onSelectEvent ? eventOf(r.timing) : null;

  let chart: React.ReactNode = null;
  if (pc && pc['1'] != null && pc['99'] != null) {
    const p1 = pc['1'], p99 = pc['99'], rg = p99 - p1 || 1;
    const xv = (v: number) => Math.max(0, Math.min(W, ((v - p1) / rg) * W));
    chart = (
      <Svg width="100%" height={undefined} viewBox={`0 0 ${W} ${H + 18}`} style={{ aspectRatio: W / (H + 18) }}>
        <Path d={buildDistributionPath(pc, W, H)} fill={withAlpha(accent, 0.14)} stroke={withAlpha(accent, 0.6)} strokeWidth={1.5} />
        <Rect x={xv(pc['25'])} y={H - 2} width={xv(pc['75']) - xv(pc['25'])} height={2} fill="rgba(255,255,255,0.25)" />
        <Line x1={xv(pc['50'])} x2={xv(pc['50'])} y1={0} y2={H} stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} strokeDasharray="3 2" />
        {r.raw != null && (
          <>
            <Line x1={xv(r.raw)} x2={xv(r.raw)} y1={0} y2={H} stroke={zc} strokeWidth={2.5} />
            <Circle cx={xv(r.raw)} cy={6} r={4.5} fill={zc} />
          </>
        )}
        <SvgText x={0} y={H + 14} fontSize={9.5} fill="#6b7280" fontWeight="700">{`P1 ${fmtN(p1)}`}</SvgText>
        <SvgText x={W} y={H + 14} fontSize={9.5} fill="#6b7280" fontWeight="700" textAnchor="end">{`P99 ${fmtN(p99)}`}</SvgText>
        <SvgText x={xv(pc['50'])} y={H + 14} fontSize={9.5} fill="#d7e0ea" fontWeight="800" textAnchor="middle">P50</SvgText>
      </Svg>
    );
  }

  return (
    <Modal transparent visible animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[s.scrim, { opacity: y.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[s.sheet, { transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [0, 900] }) }] }]}>
        <ScrollView contentContainerStyle={s.inner} showsVerticalScrollIndicator={false}>
          <View style={s.grab} />
          <Text style={s.klabel}>{groupTitle.toUpperCase()}</Text>
          <Text style={s.h3}>{r.axisLabel}</Text>
          <Text style={s.sub}>{r.timing || ''}</Text>
          <View style={s.vcells}>
            <View style={s.kpi}>
              <Text style={s.klabel}>YOUR VALUE</Text>
              <Text style={[s.kval, { color: zc }]}>
                {r.raw == null ? '—' : fmtN(r.raw)}
                {r.raw != null ? <Text style={s.kunit}> {r.unit}</Text> : null}
              </Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.klabel}>COHORT P50</Text>
              <Text style={s.kval}>
                {pc ? fmtN(pc['50']) : '—'}
                {pc ? <Text style={s.kunit}> {r.unit}</Text> : null}
              </Text>
              <Text style={s.knote}>{diff == null ? '' : `${diff >= 0 ? '+' : '−'}${fmtN(Math.abs(diff))} vs P50`}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.klabel}>PERCENTILE</Text>
              <Text style={[s.kval, { color: zc }]}>{r.pct == null ? '—' : `P${Math.round(r.pct)}`}</Text>
              <Text style={s.knote}>{r.score == null || !z ? '' : `score ${Math.round(r.score)} · ${cap(z.label)}`}</Text>
            </View>
          </View>
          <View style={s.blk}>
            <Text style={s.h4}>DISTRIBUTION</Text>
            {chart || <Text style={s.note}>No cohort data for this metric.</Text>}
            <Text style={[s.note, { marginTop: 6 }]}>{cohortText + (r.invert ? ' · lower (more negative) ranks higher' : '')}</Text>
          </View>
          <View style={s.blk}>
            <Text style={s.h4}>WHAT IS THIS?</Text>
            <Text style={s.p}>{r.detail}</Text>
          </View>
          <View style={s.blk}>
            <Text style={s.h4}>HOW IS THIS SCORED?</Text>
            <Text style={s.p}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{r.scoring === 'higher' ? 'Higher is better' : 'Optimal near elite median'}.</Text>{' '}
              {r.scoring === 'higher'
                ? 'This is a power/velocity metric where higher values directly contribute to performance. Your percentile rank is your score — the higher the better.'
                : 'This is a positional metric where the elite median (p50) represents the optimal value. Being too far above or below the elite average can indicate inefficiency or injury risk. Your score is based on how close you are to the optimal range.'}
            </Text>
          </View>
          {ev && (
            <Pressable
              onPress={() => { onSelectEvent!(ev); close(); }}
              style={s.jump}
              accessibilityRole="button"
            >
              <Text style={[s.jumpText, { color: accent }]}>View this moment in Motion ›</Text>
            </Pressable>
          )}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', backgroundColor: STEEL.card,
    borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: STEEL.hair,
  },
  inner: { paddingTop: 10, paddingHorizontal: 18, paddingBottom: 34 },
  grab: { width: 38, height: 5, borderRadius: 3, backgroundColor: '#2a3442', alignSelf: 'center', marginBottom: 14 },
  klabel: { color: STEEL.mute, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  h3: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 4 },
  sub: { color: STEEL.sub, fontSize: 12.5, marginTop: 3 },
  vcells: { flexDirection: 'row', gap: 12, marginTop: 16 },
  kpi: { flex: 1, gap: 3, minWidth: 0 },
  kval: { color: '#fff', fontSize: 24, lineHeight: 25, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  kunit: { fontSize: 11, fontWeight: '700', color: STEEL.mute, letterSpacing: 0 },
  knote: { color: STEEL.mute, fontSize: 10.5, fontWeight: '600' },
  blk: { marginTop: 18 },
  h4: { fontSize: 11, fontWeight: '800', letterSpacing: 2, color: '#e5e7eb', marginBottom: 8 },
  p: { color: STEEL.day, fontSize: 13.5, lineHeight: 21 },
  note: { color: STEEL.mute, fontSize: 11, lineHeight: 16 },
  jump: { marginTop: 18, paddingVertical: 8 },
  jumpText: { fontSize: 12.5, fontWeight: '700' },
});
