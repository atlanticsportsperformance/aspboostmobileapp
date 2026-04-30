/**
 * PitchingSection — feed section for pitching data.
 *
 * Editorial layout:
 *   - Hero: max-velo PR, with 30-day / latest avg + max stats below.
 *   - ARSENAL: one row per tagged pitch type, ordered by usage. Each row
 *     shows: pitch label, usage chip, max velo, avg velo, and a Stuff+
 *     value with a tier-colored bar (Elite / Above avg / Average / Below).
 *
 * Data comes from PitchingData.arsenal (aggregated in fetchPitchingData)
 * — Stuff+ scores are looked up by pitchType against
 * PitchingData.stuffPlus.allTimeBest.
 *
 * No card container.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

interface StuffPlusEntry {
  pitchType: string;
  stuffPlus: number;
  date: string;
}

interface ArsenalEntry {
  pitchType: string;
  maxVelo: number;
  avgVelo: number;
  count: number;
  usagePct: number;
  stuffPlus: number | null;
}

interface PitchingShape {
  prs: { max_velo: { value: number; date: string } | null };
  latest: {
    max_velo: number | null;
    avg_velo_30d: number | null;
    avg_velo_recent: number | null;
    timestamp: string | null;
  };
  stuffPlus: {
    allTimeBest: StuffPlusEntry[];
    recentSession: StuffPlusEntry[];
    overallBest: number | null;
    overallRecent: number | null;
  } | null;
  arsenal: ArsenalEntry[];
}

interface Props {
  data: PitchingShape;
  onOpen: () => void;
}

const ACCENT = '#A78BFA';

// Pitch-type display abbrev + accent. Falls back to first 3 chars of the
// raw type label when an unfamiliar pitch slips through.
const PITCH_TYPE_DISPLAY: Record<string, { short: string; full: string; hex: string }> = {
  Fastball: { short: 'FB', full: 'Fastball', hex: '#9BDDFF' },
  Sinker: { short: 'SI', full: 'Sinker', hex: '#7DD3FC' },
  Cutter: { short: 'CT', full: 'Cutter', hex: '#A5B4FC' },
  Slider: { short: 'SL', full: 'Slider', hex: '#FFB84D' },
  Sweeper: { short: 'SW', full: 'Sweeper', hex: '#FB923C' },
  Curveball: { short: 'CB', full: 'Curveball', hex: '#A78BFA' },
  Changeup: { short: 'CH', full: 'Changeup', hex: '#34D399' },
  Splitter: { short: 'SP', full: 'Splitter', hex: '#10B981' },
  Knuckleball: { short: 'KN', full: 'Knuckleball', hex: '#F472B6' },
  'Two-seam': { short: '2S', full: 'Two-seam', hex: '#7DD3FC' },
  'Four-seam': { short: '4S', full: 'Four-seam', hex: '#9BDDFF' },
};

function pitchDisplay(pitchType: string) {
  if (PITCH_TYPE_DISPLAY[pitchType]) return PITCH_TYPE_DISPLAY[pitchType];
  // Case-insensitive lookup
  const ci = Object.keys(PITCH_TYPE_DISPLAY).find(
    (k) => k.toLowerCase() === pitchType.toLowerCase(),
  );
  if (ci) return PITCH_TYPE_DISPLAY[ci];
  return {
    short: pitchType.slice(0, 3).toUpperCase(),
    full: pitchType,
    hex: '#9BDDFF',
  };
}

function tierForStuff(v: number): { label: string; hex: string } {
  if (v >= 110) return { label: 'Elite', hex: '#34d399' };
  if (v >= 100) return { label: 'Above avg', hex: '#9BDDFF' };
  if (v >= 90) return { label: 'Average', hex: '#fbbf24' };
  return { label: 'Below avg', hex: '#ef4444' };
}

export function PitchingSection({ data, onOpen }: Props) {
  const prVelo = data.prs.max_velo?.value ?? null;
  const avg30 = data.latest.avg_velo_30d;
  const recentAvg = data.latest.avg_velo_recent;
  const recentMax = data.latest.max_velo;

  const arsenal = (data.arsenal ?? []).slice(0, 6);

  return (
    <View style={styles.section}>
      <View style={styles.hairline} />

      <Pressable onPress={onOpen} hitSlop={6} style={styles.eyebrowRow}>
        <Text style={styles.eyebrow}>PITCHING</Text>
        <Text style={[styles.eyebrowAction, { color: ACCENT }]}>View pitching →</Text>
      </Pressable>

      {/* Hero — max velo PR */}
      <View style={styles.heroRow}>
        <Text style={styles.heroLabel}>MAX VELOCITY</Text>
        <View style={styles.heroNumberRow}>
          <Text style={styles.heroNumber}>
            {prVelo != null ? prVelo.toFixed(1) : '—'}
          </Text>
          <Text style={styles.heroUnit}>MPH</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat label="30d avg" value={fmt(avg30)} unit="MPH" />
        <Stat label="Latest avg" value={fmt(recentAvg)} unit="MPH" />
        <Stat label="Latest max" value={fmt(recentMax)} unit="MPH" />
      </View>

      {arsenal.length > 0 && (
        <View style={styles.arsenalBlock}>
          <View style={styles.arsenalHeaderRow}>
            <Text style={styles.subHead}>ARSENAL · LAST 30 DAYS</Text>
            <Text style={styles.arsenalLegend}>VELO · STUFF+</Text>
          </View>
          {arsenal.map((entry) => (
            <ArsenalRow key={entry.pitchType} entry={entry} />
          ))}
        </View>
      )}
    </View>
  );
}

function ArsenalRow({ entry }: { entry: ArsenalEntry }) {
  const display = pitchDisplay(entry.pitchType);
  const stuff = entry.stuffPlus;
  const tier = stuff != null ? tierForStuff(stuff) : null;
  // Stuff+ visualization scale: 60 → 0%, 140 → 100%
  const stuffRatio = stuff != null ? Math.min(1, Math.max(0, (stuff - 60) / 80)) : 0;

  return (
    <View style={rowStyles.row}>
      {/* Pitch tag — colored chip with abbrev */}
      <View
        style={[
          rowStyles.pitchTag,
          { backgroundColor: `${display.hex}1F`, borderColor: `${display.hex}55` },
        ]}
      >
        <Text style={[rowStyles.pitchShort, { color: display.hex }]}>
          {display.short}
        </Text>
      </View>

      {/* Pitch full name + usage % */}
      <View style={rowStyles.nameCol}>
        <Text style={rowStyles.pitchName} numberOfLines={1}>
          {display.full}
        </Text>
        <Text style={rowStyles.usageText}>
          {entry.count} pitches · {Math.round(entry.usagePct)}%
        </Text>
      </View>

      {/* Velo column — max big, avg small */}
      <View style={rowStyles.veloCol}>
        <Text style={rowStyles.veloMax}>
          {entry.maxVelo.toFixed(1)}
          <Text style={rowStyles.veloUnit}> mph</Text>
        </Text>
        <Text style={rowStyles.veloAvg}>{entry.avgVelo.toFixed(1)} avg</Text>
      </View>

      {/* Stuff+ column — value + tier-colored bar */}
      <View style={rowStyles.stuffCol}>
        {stuff != null ? (
          <>
            <Text style={[rowStyles.stuffValue, { color: tier!.hex }]}>
              {Math.round(stuff)}
            </Text>
            <View style={rowStyles.stuffBarTrack}>
              <View
                style={[
                  rowStyles.stuffBarFill,
                  { width: `${stuffRatio * 100}%`, backgroundColor: tier!.hex },
                ]}
              />
            </View>
            <Text style={[rowStyles.stuffTier, { color: tier!.hex }]}>
              {tier!.label}
            </Text>
          </>
        ) : (
          <>
            <Text style={[rowStyles.stuffValue, { color: '#4b5563' }]}>—</Text>
            <View style={rowStyles.stuffBarTrack} />
            <Text style={[rowStyles.stuffTier, { color: '#4b5563' }]}>No grade</Text>
          </>
        )}
      </View>
    </View>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statUnit}>{unit}</Text>
      </View>
    </View>
  );
}

function fmt(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toFixed(1);
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
    marginBottom: 12,
  },
  eyebrow: { color: '#e5e7eb', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  eyebrowAction: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },

  heroRow: { marginBottom: 18 },
  heroLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  heroNumberRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  heroNumber: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '800',
    letterSpacing: -2,
    lineHeight: 60,
  },
  heroUnit: { color: ACCENT, fontSize: 14, fontWeight: '700', letterSpacing: 1.2 },

  statsRow: { flexDirection: 'row', gap: 18, marginBottom: 22 },
  stat: { flex: 1, gap: 4 },
  statLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  statUnit: { color: '#6b7280', fontSize: 10, fontWeight: '700' },

  arsenalBlock: { gap: 12 },
  arsenalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  subHead: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  arsenalLegend: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  pitchTag: {
    width: 38,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pitchShort: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  nameCol: { flex: 1.2, gap: 2 },
  pitchName: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  usageText: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
  },

  veloCol: { width: 78, alignItems: 'flex-end' },
  veloMax: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  veloUnit: { color: '#6b7280', fontSize: 9, fontWeight: '700' },
  veloAvg: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '700',
  },

  stuffCol: { width: 78, alignItems: 'flex-end', gap: 3 },
  stuffValue: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  stuffBarTrack: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  stuffBarFill: { height: '100%', borderRadius: 2 },
  stuffTier: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
