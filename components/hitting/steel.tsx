/**
 * Steel kit — the home screen's visual language for the hitting screens.
 * Black ground, hairline section dividers, wide-tracked caps labels, heavy
 * tabular numbers, meaning colors. No card containers for stats.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, type StyleProp, type ViewStyle } from 'react-native';

export const STEEL = {
  bg: '#000000',
  card: '#0c1016',
  rule: 'rgba(255,255,255,0.07)',
  hair: 'rgba(255,255,255,0.12)',
  text: '#ffffff',
  day: '#d7e0ea',
  sub: '#9ca3af',
  mute: '#6b7280',
  past: '#4b5563',
  hitting: '#fb923c',
  hitting2: '#fdba74',
  force: '#9BDDFF',
  ice: '#5ce1ff',
  good: '#34d399',
  bad: '#ef4444',
  warn: '#fbbf24',
  purple: '#a78bfa',
  cyan: '#22D3EE',
} as const;

/** Exit-velo color, same buckets as the home ball-flight field. */
export function evColor(ev: number) {
  if (ev >= 95) return STEEL.hitting;
  if (ev >= 90) return STEEL.hitting2;
  return '#8d939c';
}

/** Sweet spot: launch angles that produce line drives and fly balls. */
export const SWEET_SPOT: [number, number] = [8, 32];
export const HARD_HIT_MPH = 95;

/** Format a stat; null/NaN/±Infinity render as an em dash, never 0.0. */
export function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function Section({
  title,
  right,
  onRight,
  rightColor = STEEL.hitting,
  children,
  first,
  style,
}: {
  title?: string;
  right?: string;
  onRight?: () => void;
  rightColor?: string;
  children?: React.ReactNode;
  first?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.section, style]}>
      {!first && <View style={s.hairline} />}
      {(title || right) && (
        <View style={s.eyebrowRow}>
          {title ? <Text style={s.eyebrow}>{title}</Text> : <View />}
          {right ? (
            onRight ? (
              <Pressable onPress={onRight} hitSlop={8}>
                <Text style={[s.eyebrowAction, { color: rightColor }]}>{right}</Text>
              </Pressable>
            ) : (
              <Text style={s.eyebrowNote}>{right}</Text>
            )
          ) : null}
        </View>
      )}
      {children}
    </View>
  );
}

export function Kpi({
  label,
  value,
  unit,
  color = STEEL.text,
  delta,
  deltaGoodWhenUp = true,
  size = 24,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  delta?: number | null;
  deltaGoodWhenUp?: boolean;
  size?: number;
  note?: string;
}) {
  const empty = value === '—';
  const showDelta = delta != null && Number.isFinite(delta) && Math.abs(delta) >= 0.05;
  const good = showDelta && (delta! > 0) === deltaGoodWhenUp;
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={[s.kpiValue, { fontSize: size, lineHeight: size * 1.05, color: empty ? STEEL.past : color }]}>
        {value}
        {unit && !empty ? <Text style={s.kpiUnit}> {unit}</Text> : null}
      </Text>
      {showDelta && (
        <Text style={[s.delta, { color: good ? STEEL.good : STEEL.bad }]}>
          {delta! > 0 ? '▲' : '▼'} {Math.abs(delta!).toFixed(1)}
        </Text>
      )}
      {note ? <Text style={s.kpiNote}>{note}</Text> : null}
    </View>
  );
}

export function KpiRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.kpiRow, style]}>{children}</View>;
}

export type TimeRange = '1m' | '3m' | '6m' | 'all';
const RANGES: { key: TimeRange; label: string }[] = [
  { key: '1m', label: '1 Month' },
  { key: '3m', label: '3 Months' },
  { key: '6m', label: '6 Months' },
  { key: 'all', label: 'All Time' },
];

export function TimeChips({ value, onChange }: { value: TimeRange; onChange: (v: TimeRange) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
      {RANGES.map((r) => (
        <Pressable
          key={r.key}
          onPress={() => onChange(r.key)}
          style={[s.chip, value === r.key && s.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === r.key }}
        >
          <Text style={[s.chipText, value === r.key && s.chipTextOn]}>{r.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.seg}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} style={[s.segBtn, value === o.key && s.segBtnOn]}>
          <Text style={[s.segText, value === o.key && s.segTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ScreenHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={10} style={s.back}>
        <Text style={s.backText}>‹ Back</Text>
      </Pressable>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export const steelStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: STEEL.bg },
  body: { paddingHorizontal: 16 },
  empty: { color: STEEL.mute, fontSize: 13, textAlign: 'center', paddingVertical: 24 },
});

const s = StyleSheet.create({
  section: { paddingTop: 18, paddingBottom: 18 },
  hairline: { height: 1, backgroundColor: STEEL.hair, marginBottom: 18 },
  eyebrowRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 },
  eyebrow: { color: '#e5e7eb', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  eyebrowAction: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  eyebrowNote: { color: STEEL.mute, fontSize: 11, fontWeight: '600' },
  kpiRow: { flexDirection: 'row', gap: 12 },
  kpi: { flex: 1, gap: 3 },
  kpiLabel: { color: STEEL.mute, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  kpiValue: { fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  kpiUnit: { fontSize: 11, fontWeight: '700', color: STEEL.mute, letterSpacing: 0 },
  kpiNote: { color: STEEL.mute, fontSize: 10.5, fontWeight: '600' },
  delta: { fontSize: 11, fontWeight: '700' },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: STEEL.card, borderWidth: 1, borderColor: STEEL.rule },
  chipOn: { backgroundColor: '#1b2430', borderColor: '#2a3442' },
  chipText: { color: STEEL.sub, fontSize: 12.5, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  seg: { flexDirection: 'row', backgroundColor: STEEL.card, borderRadius: 999, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center' },
  segBtnOn: { backgroundColor: '#1b2430' },
  segText: { color: STEEL.sub, fontSize: 12, fontWeight: '700' },
  segTextOn: { color: '#fff' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, gap: 4 },
  back: { paddingVertical: 6, alignSelf: 'flex-start' },
  backText: { color: STEEL.sub, fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: STEEL.sub, fontSize: 13.5, fontWeight: '500' },
});
