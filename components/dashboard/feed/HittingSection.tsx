/**
 * HittingSection — feed section for hitting (Blast / HitTrax / FullSwing).
 *
 * No card container. Three-column PR display: Exit Velo · Bat Speed ·
 * Distance — each with a big number, unit, and a tiny "PR" label. Below,
 * latest-session row showing today's best vs. PR.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

interface HittingShape {
  latest: {
    bat_speed?: number;
    exit_velocity?: number;
    distance?: number;
    timestamp?: string;
  };
  prs: {
    bat_speed?: { value: number; date: string };
    exit_velocity?: { value: number; date: string };
    distance?: { value: number; date: string };
  };
}

interface Props {
  data: HittingShape;
  onOpen: () => void;
}

const ACCENT_EV = '#9BDDFF';
const ACCENT_BS = '#FFB84D';
const ACCENT_DIST = '#34D399';
const SECTION_ACCENT = '#FFB84D';

export function HittingSection({ data, onOpen }: Props) {
  const evPr = data.prs.exit_velocity?.value ?? null;
  const bsPr = data.prs.bat_speed?.value ?? null;
  const distPr = data.prs.distance?.value ?? null;

  const evLatest = data.latest.exit_velocity ?? null;
  const bsLatest = data.latest.bat_speed ?? null;
  const distLatest = data.latest.distance ?? null;

  const latestLabel = data.latest.timestamp
    ? new Date(data.latest.timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <View style={styles.section}>
      <View style={styles.hairline} />

      <Pressable onPress={onOpen} hitSlop={6} style={styles.eyebrowRow}>
        <Text style={styles.eyebrow}>HITTING</Text>
        <Text style={[styles.eyebrowAction, { color: SECTION_ACCENT }]}>
          View hitting →
        </Text>
      </Pressable>

      <View style={styles.prRow}>
        <PRCol label="Exit velo" value={evPr} unit="MPH" hex={ACCENT_EV} />
        <PRCol label="Bat speed" value={bsPr} unit="MPH" hex={ACCENT_BS} />
        <PRCol label="Distance" value={distPr} unit="FT" hex={ACCENT_DIST} />
      </View>

      {(evLatest != null || bsLatest != null || distLatest != null) && (
        <View style={styles.latestRow}>
          <Text style={styles.latestLabel}>
            LATEST{latestLabel ? ` · ${latestLabel.toUpperCase()}` : ''}
          </Text>
          <Text style={styles.latestText}>
            <LatestPart value={evLatest} pr={evPr} unit="EV" />
            {' · '}
            <LatestPart value={bsLatest} pr={bsPr} unit="BS" />
            {' · '}
            <LatestPart value={distLatest} pr={distPr} unit="FT" />
          </Text>
        </View>
      )}
    </View>
  );
}

function PRCol({
  label,
  value,
  unit,
  hex,
}: {
  label: string;
  value: number | null;
  unit: string;
  hex: string;
}) {
  return (
    <View style={styles.prCol}>
      <Text style={styles.prLabel}>{label.toUpperCase()}</Text>
      <View style={styles.prValueRow}>
        <Text style={[styles.prValue, { color: value != null ? '#fff' : '#4b5563' }]}>
          {value != null ? Math.round(value * 10) / 10 : '—'}
        </Text>
        <Text style={[styles.prUnit, { color: hex }]}>{unit}</Text>
      </View>
      <View style={[styles.prAccent, { backgroundColor: hex }]} />
      <Text style={styles.prCaption}>Personal best</Text>
    </View>
  );
}

function LatestPart({
  value,
  pr,
  unit,
}: {
  value: number | null;
  pr: number | null;
  unit: string;
}) {
  if (value == null) return <Text style={{ color: '#4b5563' }}>{unit} —</Text>;
  const isPR = pr != null && value >= pr;
  return (
    <Text style={{ color: isPR ? '#34d399' : '#9ca3af' }}>
      {unit} {Math.round(value * 10) / 10}
      {isPR ? ' ★' : ''}
    </Text>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 24, paddingBottom: 28, paddingHorizontal: 16 },
  hairline: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginBottom: 18,
  },
  eyebrowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 14,
  },
  eyebrow: { color: '#e5e7eb', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  eyebrowAction: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  prRow: { flexDirection: 'row', gap: 14 },
  prCol: { flex: 1, gap: 4 },
  prLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  prValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  prValue: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 36,
  },
  prUnit: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  prAccent: { height: 2, marginTop: 4, borderRadius: 1, opacity: 0.7 },
  prCaption: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 2,
  },

  latestRow: { marginTop: 18 },
  latestLabel: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  latestText: { fontSize: 13, fontWeight: '700' },
});
