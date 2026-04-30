/**
 * ArmCareSection — feed section for ArmCare results.
 *
 * Editorial layout (no card container):
 *   - Hero: arm score + zone label, PR meta on the right.
 *   - Per-test % of bodyweight strip — IR, ER, Scaption, Grip — each with
 *     a colored bar showing where the athlete sits relative to that test's
 *     normal-range threshold (per ArmCare report glossary).
 *   - 3-stat footer: total strength · 90d avg · S/V ratio (or test count).
 *
 * Reuses the threshold logic from `lib/armcare/zones.ts` so the colors
 * stay in sync with the rest of the ArmCare surface (wizard, hub).
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { peakZone, ZONE_COLORS, type Zone } from '../../../lib/armcare/zones';

interface ArmCareShape {
  pr: { arm_score: number; date: string };
  latest: {
    arm_score: number;
    total_strength: number;
    avg_strength_30d: number;
    tests_30d: number;
  };
  perTestLatest?: {
    examDate: string | null;
    bodyweightLbs: number | null;
    irLbs: number | null;
    erLbs: number | null;
    scaptionLbs: number | null;
    gripLbs: number | null;
    erIrRatio: number | null;
  } | null;
}

interface Props {
  data: ArmCareShape;
  /** Athlete max velocity (mph) — for the optional S/V ratio. */
  maxVelocity?: number | null;
  onOpen: () => void;
}

function getZone(score: number): { label: string; hex: string; bright: string } {
  if (score < 70) return { label: 'BUILD', hex: '#ef4444', bright: '#f87171' };
  if (score < 77) return { label: 'CAUTION', hex: '#f97316', bright: '#fb923c' };
  if (score < 85) return { label: 'IMPROVING', hex: '#eab308', bright: '#facc15' };
  return { label: 'OPTIMAL', hex: '#22c55e', bright: '#4ade80' };
}

// Per-test display normalization. The fill bar uses a max% reference so the
// bar reads "how far past normal-threshold are you." We pick a max-bw
// percent that comfortably contains an elite reading for each test type.
const TEST_DISPLAY = {
  ir: { label: 'IR (Internal)', short: 'IR', barMaxPct: 30, normalThreshold: 20 },
  er: { label: 'ER (External)', short: 'ER', barMaxPct: 30, normalThreshold: 20 },
  scap: { label: 'Scaption', short: 'SCAP', barMaxPct: 30, normalThreshold: 15 },
  grip: { label: 'Grip', short: 'GRIP', barMaxPct: 90, normalThreshold: 15 },
} as const;

export function ArmCareSection({ data, maxVelocity, onOpen }: Props) {
  const score = data.latest.arm_score;
  const zone = getZone(score);

  const svRatio =
    maxVelocity && maxVelocity > 0 && data.latest.total_strength > 0
      ? data.latest.total_strength / maxVelocity
      : null;

  const perTest = data.perTestLatest ?? null;
  const bw = perTest?.bodyweightLbs ?? null;
  const examDateLabel = perTest?.examDate
    ? new Date(`${perTest.examDate}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <View style={styles.section}>
      <View style={styles.hairline} />

      <Pressable onPress={onOpen} hitSlop={6} style={styles.eyebrowRow}>
        <Text style={styles.eyebrow}>ARM CARE</Text>
        <Text style={[styles.eyebrowAction, { color: zone.hex }]}>
          Open ArmCare →
        </Text>
      </Pressable>

      <View style={styles.heroRow}>
        <Text style={[styles.heroNumber, { color: zone.hex }]}>
          {score.toFixed(1)}
        </Text>
        <View style={styles.heroSide}>
          <Text style={styles.heroSideLabel}>ARMSCORE (90D)</Text>
          <View
            style={[
              styles.zonePill,
              { borderColor: `${zone.hex}55`, backgroundColor: `${zone.hex}1A` },
            ]}
          >
            <Text style={[styles.zoneText, { color: zone.hex }]}>{zone.label}</Text>
          </View>
          <Text style={styles.heroSideMeta}>
            PR {data.pr.arm_score.toFixed(1)}
          </Text>
        </View>
      </View>

      {/* Per-test % of bodyweight rows — shows the athlete whether each
          shoulder direction is in the normal range from the ArmCare
          report. Hidden if the latest session didn't capture peaks. */}
      {perTest && bw != null && bw > 0 && (
        <View style={styles.perTestBlock}>
          <View style={styles.perTestHeaderRow}>
            <Text style={styles.perTestLabel}>STRENGTH BY DIRECTION · % OF BW</Text>
            {examDateLabel ? (
              <Text style={styles.perTestMeta}>Last test · {examDateLabel}</Text>
            ) : null}
          </View>
          <PerTestRow
            label={TEST_DISPLAY.ir.label}
            short={TEST_DISPLAY.ir.short}
            lbs={perTest.irLbs}
            bwLbs={bw}
            barMaxPct={TEST_DISPLAY.ir.barMaxPct}
            normalThreshold={TEST_DISPLAY.ir.normalThreshold}
            zoneTest="ir"
          />
          <PerTestRow
            label={TEST_DISPLAY.er.label}
            short={TEST_DISPLAY.er.short}
            lbs={perTest.erLbs}
            bwLbs={bw}
            barMaxPct={TEST_DISPLAY.er.barMaxPct}
            normalThreshold={TEST_DISPLAY.er.normalThreshold}
            zoneTest="er"
          />
          <PerTestRow
            label={TEST_DISPLAY.scap.label}
            short={TEST_DISPLAY.scap.short}
            lbs={perTest.scaptionLbs}
            bwLbs={bw}
            barMaxPct={TEST_DISPLAY.scap.barMaxPct}
            normalThreshold={TEST_DISPLAY.scap.normalThreshold}
            zoneTest="scap"
          />
          <PerTestRow
            label={TEST_DISPLAY.grip.label}
            short={TEST_DISPLAY.grip.short}
            lbs={perTest.gripLbs}
            bwLbs={bw}
            barMaxPct={TEST_DISPLAY.grip.barMaxPct}
            normalThreshold={TEST_DISPLAY.grip.normalThreshold}
            zoneTest="grip"
          />
          {perTest.erIrRatio != null && (
            <Text style={styles.balanceNote}>
              ER:IR balance{' '}
              <Text style={styles.balanceNum}>
                {perTest.erIrRatio.toFixed(2)}
              </Text>{' '}
              <Text style={styles.balanceCaption}>(target 0.85–1.05)</Text>
            </Text>
          )}
        </View>
      )}

      {/* 3-stat footer */}
      <View style={styles.statsRow}>
        <Stat
          label="Total strength"
          value={data.latest.total_strength.toFixed(0)}
          unit="LBS"
        />
        <Stat
          label="90d avg"
          value={data.latest.avg_strength_30d.toFixed(0)}
          unit="LBS"
        />
        {svRatio != null ? (
          <Stat label="S/V ratio" value={svRatio.toFixed(2)} unit="LBS/MPH" />
        ) : (
          <Stat label="Tests (30d)" value={`${data.latest.tests_30d}`} unit="" />
        )}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Per-test % of bodyweight bar
// ─────────────────────────────────────────────────────────────

function PerTestRow({
  label,
  short,
  lbs,
  bwLbs,
  barMaxPct,
  normalThreshold,
  zoneTest,
}: {
  label: string;
  short: string;
  lbs: number | null;
  bwLbs: number;
  /** Visual max for the bar (e.g. 30 means the bar fills at 30% BW). */
  barMaxPct: number;
  /** Where the dashed "normal" line sits, in % of BW. */
  normalThreshold: number;
  zoneTest: 'ir' | 'er' | 'scap' | 'grip';
}) {
  const empty = lbs == null;
  const pct = empty ? 0 : (lbs! / bwLbs) * 100;
  const fillRatio = Math.max(0, Math.min(1, pct / barMaxPct));
  const thresholdRatio = Math.max(0, Math.min(1, normalThreshold / barMaxPct));

  const zone: Zone = empty ? 'unknown' : peakZone(zoneTest, lbs!, bwLbs);
  const hex = ZONE_COLORS[zone];

  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.labelCol}>
        <Text style={rowStyles.label}>{short}</Text>
        <Text style={rowStyles.sublabel}>{label.replace(`${short} (`, '(')}</Text>
      </View>

      <View style={rowStyles.barCol}>
        <View style={rowStyles.barTrack}>
          {/* normal-range threshold marker */}
          <View
            style={[
              rowStyles.thresholdMark,
              { left: `${thresholdRatio * 100}%` },
            ]}
          />
          <View
            style={[
              rowStyles.barFill,
              {
                width: `${fillRatio * 100}%`,
                backgroundColor: empty ? '#374151' : hex,
              },
            ]}
          />
        </View>
        <View style={rowStyles.captionRow}>
          <Text style={rowStyles.captionMin}>0%</Text>
          <Text style={[rowStyles.captionThreshold]}>
            normal ≥{normalThreshold}%
          </Text>
          <Text style={rowStyles.captionMax}>{barMaxPct}%</Text>
        </View>
      </View>

      <View style={rowStyles.valueCol}>
        <Text style={[rowStyles.pctValue, { color: empty ? '#4b5563' : hex }]}>
          {empty ? '—' : `${Math.round(pct)}%`}
        </Text>
        <Text style={rowStyles.lbsValue}>
          {empty ? '' : `${Math.round(lbs!)} lb`}
        </Text>
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
      <Text style={styles.statLabel}>{label.toUpperCase()}</Text>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
    </View>
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

  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 18,
  },
  heroNumber: {
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: -2.5,
    lineHeight: 68,
  },
  heroSide: { flex: 1, gap: 6 },
  heroSideLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  zonePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  zoneText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  heroSideMeta: { color: '#9ca3af', fontSize: 12, fontWeight: '700' },

  perTestBlock: { gap: 10, marginBottom: 18 },
  perTestHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  perTestLabel: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  perTestMeta: { color: '#6b7280', fontSize: 10, fontWeight: '700' },

  balanceNote: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },
  balanceNum: { color: '#fff', fontWeight: '800' },
  balanceCaption: { color: '#6b7280' },

  statsRow: { flexDirection: 'row', gap: 16 },
  stat: { flex: 1, gap: 4 },
  statLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  statUnit: { color: '#6b7280', fontSize: 9, fontWeight: '700' },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  labelCol: { width: 56 },
  label: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sublabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '600',
    marginTop: 1,
  },

  barCol: { flex: 1, gap: 4 },
  barTrack: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: { height: '100%', borderRadius: 4 },
  thresholdMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: 'rgba(255,255,255,0.45)',
    zIndex: 1,
  },
  captionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  captionMin: { color: '#4b5563', fontSize: 8, fontWeight: '700' },
  captionThreshold: {
    color: '#9ca3af',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  captionMax: { color: '#4b5563', fontSize: 8, fontWeight: '700' },

  valueCol: { width: 56, alignItems: 'flex-end' },
  pctValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  lbsValue: { color: '#6b7280', fontSize: 9, fontWeight: '700' },
});
