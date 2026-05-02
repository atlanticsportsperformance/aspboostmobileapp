/**
 * HittingSection — feed section for hitting (Blast / HitTrax / FullSwing).
 *
 * No card container. Three-column PR display: Exit Velo · Bat Speed ·
 * Distance — each with a big number, unit, and a tiny "PR" label. Below,
 * a percentile ring for bat speed vs. play-level assessment norms (only
 * surfaces when we have both a play_level and a bat_speed PR — distance
 * and EV norms are not yet wired). Then the latest-session row.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

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
  /** Athlete's play level — drives the bat-speed percentile ring. */
  playLevel?: string | null;
  onOpen: () => void;
}

const ACCENT_EV = '#9BDDFF';
const ACCENT_BS = '#FFB84D';
const ACCENT_DIST = '#34D399';
const SECTION_ACCENT = '#FFB84D';

// ─────────────────────────────────────────────────────────────────────
// Bat-speed assessment percentile bands by play level (mph).
// Anchored at 10/25/50/75/90 percentiles. Numbers are amateur-baseball
// reference values (Blast/Driveline-style) and can be calibrated against
// our own org dataset later. EV and distance bands intentionally absent
// — we don't have validated norms for those yet.
// ─────────────────────────────────────────────────────────────────────
type Pcts = { p10: number; p25: number; p50: number; p75: number; p90: number };

const BAT_SPEED_NORMS: Record<string, Pcts> = {
  Youth:        { p10: 42, p25: 47, p50: 52, p75: 58, p90: 64 },
  'High School':{ p10: 56, p25: 62, p50: 67, p75: 72, p90: 77 },
  College:      { p10: 64, p25: 69, p50: 73, p75: 76, p90: 79 },
  Pro:          { p10: 70, p25: 73, p50: 76, p75: 79, p90: 83 },
};

// Exit velocity (HitTrax) by play level — same anchoring as bat speed.
// Sourced from amateur HitTrax assessment cohorts; calibrate against
// org dataset later.
const EXIT_VELO_NORMS: Record<string, Pcts> = {
  Youth:        { p10: 50, p25: 58, p50: 65, p75: 72, p90: 78 },
  'High School':{ p10: 70, p25: 78, p50: 85, p75: 92, p90: 98 },
  College:      { p10: 85, p25: 92, p50: 97, p75: 102, p90: 107 },
  Pro:          { p10: 95, p25: 100, p50: 104, p75: 108, p90: 112 },
};

// Loose normalization for free-form play_level strings ("D1", "JUCO",
// "12U", etc.) — falls back to High School when nothing matches.
function normalizePlayLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const l = raw.trim().toLowerCase();
  if (!l) return null;
  if (l.includes('youth') || /\b1[0-4]u\b/.test(l) || l.includes('middle')) return 'Youth';
  if (l.includes('high') || /\bhs\b/.test(l) || /\b1[5-8]u\b/.test(l)) return 'High School';
  if (l.includes('college') || l.includes('ncaa') || l.includes('juco') || /\bd[123]\b/.test(l)) return 'College';
  if (l.includes('pro') || l.includes('milb') || l.includes('mlb') || l.includes('indy')) return 'Pro';
  return null;
}

// Standard-normal cumulative distribution (Abramowitz & Stegun 7.1.26).
// Returns Φ(z) — the area under a unit-variance normal curve to the
// left of z. Used to convert a z-score into a percentile.
function normalCDF(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

// Convert a value to a percentile (1-99) by fitting a normal distribution
// to the 5 anchors:
//   - μ = P50
//   - σ = (P90 - P10) / 2.5631  (since z(.9) - z(.1) ≈ 2.5631 in N(0,1))
// This produces a continuous, smooth function — every integer 1-99 is
// reachable depending on the input — instead of the previous piecewise
// interpolator that visually clustered around the 5 anchor values.
function percentileFor(value: number, pcts: Pcts): number {
  const mu = pcts.p50;
  const sigma = (pcts.p90 - pcts.p10) / 2.5631;
  if (sigma <= 0 || !Number.isFinite(sigma)) return 50;
  const z = (value - mu) / sigma;
  const p = normalCDF(z) * 100;
  return Math.max(1, Math.min(99, Math.round(p)));
}

function tierForPercentile(p: number): { label: string; hex: string } {
  if (p >= 90) return { label: 'ELITE', hex: '#34D399' };
  if (p >= 75) return { label: 'ABOVE AVG', hex: '#9BDDFF' };
  if (p >= 50) return { label: 'AVERAGE', hex: '#FFB84D' };
  if (p >= 25) return { label: 'DEVELOPING', hex: '#F59E0B' };
  return { label: 'BUILD', hex: '#F87171' };
}

export function HittingSection({ data, playLevel, onOpen }: Props) {
  const evPr = data.prs.exit_velocity?.value ?? null;
  const bsPr = data.prs.bat_speed?.value ?? null;
  const distPr = data.prs.distance?.value ?? null;

  // Percentile vs assessment norms — bat speed and exit velo. Distance
  // norms still pending; that column stays empty.
  const normalizedLevel = normalizePlayLevel(playLevel);
  const bsNorms = normalizedLevel ? BAT_SPEED_NORMS[normalizedLevel] ?? null : null;
  const evNorms = normalizedLevel ? EXIT_VELO_NORMS[normalizedLevel] ?? null : null;
  const bsPercentile =
    bsPr != null && bsNorms ? percentileFor(bsPr, bsNorms) : null;
  const evPercentile =
    evPr != null && evNorms ? percentileFor(evPr, evNorms) : null;

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
        <PRCol
          label="Exit velo"
          value={evPr}
          unit="MPH"
          hex={ACCENT_EV}
          percentile={evPercentile}
        />
        <PRCol
          label="Bat speed"
          value={bsPr}
          unit="MPH"
          hex={ACCENT_BS}
          percentile={bsPercentile}
        />
        <PRCol label="Distance" value={distPr} unit="FT" hex={ACCENT_DIST} />
      </View>

    </View>
  );
}

function PRCol({
  label,
  value,
  unit,
  hex,
  percentile,
  pendingNorms,
}: {
  label: string;
  value: number | null;
  unit: string;
  hex: string;
  /** Optional percentile vs play-level norms — shown as a small ring */
  percentile?: number | null;
  /** Render a dimmed placeholder ring when norms aren't wired yet but
   *  we still want the column to read as "data coming soon" rather
   *  than an empty void. */
  pendingNorms?: boolean;
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

      {/* Reserved slot — keeps all three PR columns the same height so
          adding a percentile ring under one doesn't push that column
          taller than its neighbors. EV/Distance render an empty slot
          today and will fill in once their norms are wired. */}
      <View style={styles.prRingSlot}>
        {percentile != null ? (
          <MiniPercentileRing percentile={percentile} />
        ) : pendingNorms ? (
          <PlaceholderRing />
        ) : null}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MiniPercentileRing — circular gauge sized to fit its parent column
// width via viewBox + 100% width. The slot below each PR column gives
// it a square (aspectRatio 1) so it always renders as a true circle
// regardless of phone width.
// ─────────────────────────────────────────────────────────────────────
const RING_VB = 100;       // viewBox units — actual size scales with container
const RING_STROKE = 4;     // thin hairline; matches progress and background

function MiniPercentileRing({ percentile }: { percentile: number }) {
  const R = (RING_VB - RING_STROKE) / 2;
  const C = 2 * Math.PI * R;
  const safe = Math.max(0, Math.min(100, percentile));
  const dash = (safe / 100) * C;
  const tier = tierForPercentile(percentile);

  return (
    <View style={miniStyles.wrap}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${RING_VB} ${RING_VB}`}
      >
        <Circle
          cx={RING_VB / 2}
          cy={RING_VB / 2}
          r={R}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <Circle
          cx={RING_VB / 2}
          cy={RING_VB / 2}
          r={R}
          stroke={tier.hex}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${C}`}
          transform={`rotate(-90 ${RING_VB / 2} ${RING_VB / 2})`}
        />
      </Svg>
      <View style={miniStyles.center} pointerEvents="none">
        <View style={miniStyles.pctRow}>
          <Text style={[miniStyles.pct, { color: tier.hex }]}>{percentile}</Text>
          <Text style={[miniStyles.pctSuffix, { color: tier.hex }]}>%ile</Text>
        </View>
      </View>
    </View>
  );
}

// PlaceholderRing — dim full-circle outline used while norms for a
// metric are still pending. Same footprint as the real ring so the
// column stays balanced; just signals "data coming soon".
function PlaceholderRing() {
  const R = (RING_VB - RING_STROKE) / 2;
  return (
    <View style={miniStyles.wrap}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${RING_VB} ${RING_VB}`}
      >
        <Circle
          cx={RING_VB / 2}
          cy={RING_VB / 2}
          r={R}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={RING_STROKE}
          fill="none"
        />
      </Svg>
      <View style={miniStyles.center} pointerEvents="none">
        <Text style={miniStyles.placeholder}>SOON</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 24, paddingBottom: 12, paddingHorizontal: 16 },
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

  prRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  prCol: { flex: 1, gap: 4, alignItems: 'center' },
  prRingSlot: {
    width: '100%',
    aspectRatio: 1, // square slot the full column width — circle scales to fit
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
  },
  prLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  prValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 4,
  },
  prValue: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 36,
    textAlign: 'center',
  },
  prUnit: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  prAccent: { height: 2, marginTop: 4, borderRadius: 1, opacity: 0.7, alignSelf: 'stretch' },
  prCaption: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginTop: 2,
    textAlign: 'center',
  },
});

const miniStyles = StyleSheet.create({
  wrap: {
    width: '78%',
    aspectRatio: 1,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pctRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  pct: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  pctSuffix: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
    opacity: 0.85,
  },
  placeholder: {
    color: '#4b5563',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
});
