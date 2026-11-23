/**
 * PercentileLadder — ranks a few metrics against a chosen play level.
 *
 * A segmented switch picks the comparison group (defaults to the
 * athlete's own level). Each row shows the value, its percentile and a
 * marker on a 4-tier strip (25/50/75 cutoffs, same tiers as the force
 * profile). Switching levels re-animates the markers. A level with no
 * norms for a metric shows "Not enough data" instead of a guess.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { useInView } from '../../../hooks/useInView';
import { LEVELS, type Level, type Pcts, percentileFor } from '../../../lib/norms';

export type LadderMetric = {
  label: string;
  value: number | null;
  unit: string;
  decimals?: number;
  norms: Partial<Record<Level, Pcts>>;
};

const TIERS = [
  { min: 75, label: 'ELITE', hex: '#34d399' },
  { min: 50, label: 'OPTIMIZE', hex: '#9BDDFF' },
  { min: 25, label: 'SHARPEN', hex: '#fbbf24' },
  { min: 0, label: 'BUILD', hex: '#ef4444' },
];
const tierFor = (p: number) => TIERS.find((t) => p >= t.min)!;
const SHORT: Record<Level, string> = { Youth: 'Youth', 'High School': 'HS', College: 'College', Pro: 'Pro' };

export function PercentileLadder({ metrics, defaultLevel }: { metrics: LadderMetric[]; defaultLevel: Level | null }) {
  const [level, setLevel] = useState<Level>(defaultLevel ?? 'High School');
  const { ref, inView } = useInView(0.3);
  const rows = metrics.filter((m) => m.value != null);
  if (rows.length === 0) return null;

  return (
    <View ref={ref} collapsable={false} style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.head}>PERCENTILE VS</Text>
      </View>
      <View style={styles.seg}>
        {LEVELS.map((l) => (
          <Pressable
            key={l}
            onPress={() => setLevel(l)}
            style={[styles.segBtn, l === level && styles.segBtnOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: l === level }}
          >
            <Text style={[styles.segText, l === level && styles.segTextOn]}>{SHORT[l]}</Text>
          </Pressable>
        ))}
      </View>
      {rows.map((m, i) => (
        <Row key={m.label} metric={m} level={level} delay={i * 90} active={inView} />
      ))}
    </View>
  );
}

function Row({ metric, level, delay, active }: { metric: LadderMetric; level: Level; delay: number; active: boolean }) {
  const norms = metric.norms[level];
  const pct = norms ? percentileFor(metric.value!, norms) : null;
  const tier = pct != null ? tierFor(pct) : null;
  const anim = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!active) {
      anim.setValue(0);
      return;
    }
    Animated.timing(anim, {
      toValue: pct ?? 0,
      duration: 900,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct, delay, anim, active]);

  const left = anim.interpolate({ inputRange: [0, 100], outputRange: [0, Math.max(0, width - 4)] });
  const tierIdx = tier ? 3 - TIERS.indexOf(tier) : -1;

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowLabel}>
          {metric.label}
          <Text style={styles.rowValue}>
            {'  '}
            {metric.value!.toFixed(metric.decimals ?? 1)} {metric.unit}
          </Text>
        </Text>
        {pct != null ? (
          <Text style={[styles.pct, { color: tier!.hex }]}>
            {pct}
            <Text style={styles.pctTh}>{ordinal(pct)}</Text>
          </Text>
        ) : (
          <Text style={styles.noData}>Not enough data</Text>
        )}
      </View>
      <View style={styles.strip} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[styles.seg4, { backgroundColor: tier && i <= tierIdx ? `${tier.hex}55` : 'rgba(255,255,255,0.06)' }]}
          />
        ))}
        {pct != null && <Animated.View style={[styles.marker, { left }]} />}
      </View>
      {tier && <Text style={[styles.tier, { color: tier.hex }]}>{tier.label}</Text>}
    </View>
  );
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

const styles = StyleSheet.create({
  wrap: { marginTop: 20, gap: 14 },
  headRow: { flexDirection: 'row', justifyContent: 'space-between' },
  head: { color: '#9ca3af', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  seg: { flexDirection: 'row', backgroundColor: '#0c1016', borderRadius: 999, padding: 3, marginTop: -4 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center' },
  segBtnOn: { backgroundColor: '#1b2430' },
  segText: { color: '#7f8b99', fontSize: 12, fontWeight: '700' },
  segTextOn: { color: '#fff' },
  row: { gap: 7 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowLabel: { color: '#e5e7eb', fontSize: 14, fontWeight: '700' },
  rowValue: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  pct: { fontSize: 22, fontWeight: '900', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  pctTh: { fontSize: 11, fontWeight: '800' },
  noData: { color: '#6b7280', fontSize: 12, fontWeight: '600' },
  strip: { height: 8, flexDirection: 'row', gap: 2, position: 'relative' },
  seg4: { flex: 1, borderRadius: 2 },
  marker: { position: 'absolute', top: -4, width: 4, height: 16, borderRadius: 2, backgroundColor: '#fff' },
  tier: { fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
});
