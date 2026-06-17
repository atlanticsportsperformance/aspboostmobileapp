/**
 * LeagueGameDetailScreen — one game, deep (Phase 12.3). Combines the mockup's
 * At-Bat Detail (screen 8, hitter) AND Pitcher Detail (screen 9, pitcher) into
 * ONE screen with a role mode. Chosen over two files because:
 *   - acdl_athlete_game_detail returns BOTH arrays (hitting[] + pitching[]) in
 *     a single call, so one fetch serves both views;
 *   - a two-way athlete (DH who also pitched) can flip between them with a
 *     toggle instead of a second navigation hop.
 * The route's `role` param sets the initial mode; a toggle appears only when
 * the athlete has data on BOTH sides.
 *
 * HITTER mode (mockup 8): per-PA cards; tap to expand → pitch-by-pitch table
 * (type chip · velo · spin · call) + StrikeZonePlot (colored by call, numbered)
 * + PA result; in-play PAs add a SprayChart with EV/LA/DIST chips.
 *
 * PITCHER mode (mockup 9): outing summary cards (pitches/top-velo/whiff),
 * StrikeZonePlot of all pitches colored by type (+legend), BreakPlot (HB×IVB),
 * and a scrollable every-pitch table (#, batter, type, velo, spin, IVB/HB,
 * call).
 *
 * Data: acdl_athlete_game_detail (12.1). Plots: StrikeZonePlot / SprayChart /
 * BreakPlot (12.1). Pitch colors: pitchColors (12.1).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAthleteId } from '../hooks/useAthleteId';
import {
  fetchAcdlGameDetail,
  LeagueGameDetail,
  PlateAppearance,
  Pitch,
} from '../lib/acdlLeague';
import StrikeZonePlot, { ZonePitch } from '../components/league/StrikeZonePlot';
import SprayChart from '../components/league/SprayChart';
import BreakPlot, { BreakPitch } from '../components/league/BreakPlot';
import { getPitchColor, getPitchAbbrev, getCallColor } from '../components/league/pitchColors';
import {
  num,
  fmt,
  fmtInt,
  fmtSigned,
  ipFromOuts,
  callLabel,
  paResultLabel,
  isHitResult,
} from '../lib/leagueFormat';
import {
  ACDL_CREAM,
  ACDL_CREAM_2,
  ACDL_PAPER,
  ACDL_NAVY,
  ACDL_INK,
  ACDL_INK_2,
  ACDL_MUT,
  ACDL_BLUE,
  ACDL_BRAND_TEXT,
  ACDL_ON_ACCENT,
  ACDL_LINE,
  ACDL_BAND_TEXT,
  ACDL_BAND_MUT,
  ACDL_WIN,
  ACDL_LIVE_DOT,
} from '../components/league/acdlTheme';

type Role = 'hitter' | 'pitcher';
type GameStatus = 'scheduled' | 'live' | 'completed' | 'cancelled' | undefined;

export default function LeagueGameDetailScreen({ navigation, route }: any) {
  const overrideAthleteId: string | null = route?.params?.athleteId ?? null;
  const gameId: string | null = route?.params?.gameId ?? null;
  const initialRole: Role = route?.params?.role === 'pitcher' ? 'pitcher' : 'hitter';
  const matchupLabel: string = route?.params?.matchupLabel ?? 'Game Detail';
  const dateLabel: string = route?.params?.dateLabel ?? '';
  const gameStatus: GameStatus = route?.params?.status ?? undefined;
  // True outing length (ip_outs) threaded from the Game Log row; the pitch
  // stream alone has no out count, so this drives the "X.X IP" footer.
  const ipOutsParam: number | null =
    typeof route?.params?.ipOuts === 'number' ? route.params.ipOuts : null;

  const { athleteId } = useAthleteId(overrideAthleteId);
  const [detail, setDetail] = useState<LeagueGameDetail | null>(null);
  const [role, setRole] = useState<Role>(initialRole);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (id: string, gid: string) => {
    const { data } = await fetchAcdlGameDetail(id, gid);
    setDetail(data);
  }, []);

  useEffect(() => {
    if (!athleteId || !gameId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load(athleteId, gameId);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, gameId, load]);

  const hasHitting = (detail?.hitting?.length ?? 0) > 0;
  const hasPitching = (detail?.pitching?.length ?? 0) > 0;
  const bothSides = hasHitting && hasPitching;

  // Determine game state from status param + data presence.
  const played = hasHitting || hasPitching;
  const isUpcoming =
    gameStatus === 'scheduled' ||
    (gameStatus !== 'completed' && gameStatus !== 'live' && !played);
  const isLiveNoData = gameStatus === 'live' && !played;
  const isCancelled = gameStatus === 'cancelled';

  // If the requested role has no data but the other does, swap once loaded.
  useEffect(() => {
    if (!detail) return;
    if (role === 'hitter' && !hasHitting && hasPitching) setRole('pitcher');
    if (role === 'pitcher' && !hasPitching && hasHitting) setRole('hitter');
  }, [detail, hasHitting, hasPitching]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={ACDL_BRAND_TEXT} />
        <Text style={styles.loadingText}>Loading game detail...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={styles.band}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color={ACDL_BAND_MUT} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.eyebrow}>ACDL GAME</Text>
          <Text style={styles.title}>{matchupLabel}</Text>
          {dateLabel ? <Text style={styles.subtitle}>{dateLabel}</Text> : null}
        </View>

        {/* ── Game state gates ── */}
        {isCancelled ? (
          <UpcomingCard
            icon="close-circle-outline"
            iconColor={ACDL_MUT}
            heading="Game cancelled"
            dateLabel={dateLabel}
            body="This game was cancelled."
            dotColor={undefined}
          />
        ) : isLiveNoData ? (
          <UpcomingCard
            icon="radio-button-on"
            iconColor={ACDL_LIVE_DOT}
            heading="Game in progress"
            dateLabel={dateLabel}
            body="Game in progress — check back soon."
            dotColor={ACDL_LIVE_DOT}
          />
        ) : isUpcoming ? (
          <UpcomingCard
            icon="calendar-outline"
            iconColor={ACDL_BRAND_TEXT}
            heading="Upcoming game"
            dateLabel={dateLabel}
            body="Your at-bats and pitch-by-pitch will appear here once the game is played."
            dotColor={undefined}
          />
        ) : (
          <>
            {bothSides && (
              <View style={styles.toggleContainer}>
                <TouchableOpacity
                  style={[styles.toggleButton, role === 'hitter' && styles.toggleButtonActive]}
                  onPress={() => setRole('hitter')}
                >
                  <Text style={[styles.toggleText, role === 'hitter' && styles.toggleTextActive]}>
                    At Bats
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, role === 'pitcher' && styles.toggleButtonActive]}
                  onPress={() => setRole('pitcher')}
                >
                  <Text style={[styles.toggleText, role === 'pitcher' && styles.toggleTextActive]}>
                    Outing
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {role === 'hitter' ? (
              hasHitting ? (
                <HitterDetail pas={detail!.hitting} />
              ) : (
                <Empty label="No plate appearances in this game" />
              )
            ) : hasPitching ? (
              <PitcherDetail pitches={detail!.pitching} ipOuts={ipOutsParam} />
            ) : (
              <Empty label="No outing in this game" />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HITTER
// ─────────────────────────────────────────────────────────────────────────
function HitterDetail({ pas }: { pas: PlateAppearance[] }) {
  return (
    <View style={{ paddingTop: 4 }}>
      {pas.map((pa, i) => (
        <PaCard key={pa.pa_id} pa={pa} index={i} defaultOpen={isHitResult(pa.result) || i === 0} />
      ))}
    </View>
  );
}

function PaCard({
  pa,
  index,
  defaultOpen,
}: {
  pa: PlateAppearance;
  index: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hit = isHitResult(pa.result);
  const bb = pa.batted_ball;
  const inPlay = !!bb && (bb.tm_exit_velo_mph != null || bb.spray_x != null || bb.tm_distance_ft != null);

  const halfLabel = pa.half === 'top' ? 'Top' : pa.half === 'bottom' ? 'Bot' : pa.half;
  const resultRight =
    pa.result === 'home_run' && bb?.tm_distance_ft != null
      ? `HR · ${fmtInt(num(bb.tm_distance_ft))} ft`
      : paResultLabel(pa.result);

  const zonePitches: ZonePitch[] = pa.pitches.map((p, idx) => ({
    plateSide: p.tm_plate_side_ft,
    plateHeight: p.tm_plate_height_ft,
    call: p.official_call,
    label: p.seq_in_pa ?? idx + 1,
  }));

  return (
    <View style={styles.abCard}>
      <TouchableOpacity style={styles.abHead} onPress={() => setOpen((o) => !o)} activeOpacity={0.7}>
        <Text style={styles.abPa}>
          PA {index + 1} · {halfLabel} {pa.inning}
        </Text>
        <View style={styles.abHeadRight}>
          <Text style={[styles.abRes, hit ? styles.abResHit : styles.abResOut]}>{resultRight}</Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={ACDL_MUT}
            style={{ marginLeft: 6 }}
          />
        </View>
      </TouchableOpacity>

      {open && (
        <>
          {/* Pitch-by-pitch */}
          <View style={styles.pitchTable}>
            <View style={styles.ptHeaderRow}>
              <Text style={[styles.ptTh, styles.ptColNum]}>#</Text>
              <Text style={[styles.ptTh, styles.ptColType]}>Pitch</Text>
              <Text style={[styles.ptTh, styles.ptColNum2]}>MPH</Text>
              <Text style={[styles.ptTh, styles.ptColNum2]}>Spin</Text>
              <Text style={[styles.ptTh, styles.ptColResult]}>Result</Text>
            </View>
            {pa.pitches.map((p, idx) => (
              <PitchRow key={p.pitch_id} p={p} idx={idx} />
            ))}
          </View>

          {/* Visualizations — navy band so the (white-on-dark) plots read */}
          <View style={styles.vizWrap}>
            <View style={styles.vizCol}>
              <StrikeZonePlot
                pitches={zonePitches}
                colorBy="call"
                width={140}
                caption="Strike Zone (C view)"
              />
            </View>
            {inPlay && (
              <View style={styles.vizCol}>
                <SprayChart
                  battedBall={{
                    bearingDeg: bb?.tm_bearing_deg ?? null,
                    distanceFt: bb?.tm_distance_ft ?? null,
                    sprayX: bb?.spray_x ?? null,
                    sprayY: bb?.spray_y ?? null,
                    exitVeloMph: bb?.tm_exit_velo_mph ?? null,
                    launchAngleDeg: bb?.tm_launch_angle_deg ?? null,
                  }}
                  width={150}
                  caption={`Spray — ${paResultLabel(pa.result)}`}
                />
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function PitchRow({ p, idx }: { p: Pitch; idx: number }) {
  return (
    <View style={styles.ptRow}>
      <Text style={[styles.ptTd, styles.ptColNum]}>{p.seq_in_pa ?? idx + 1}</Text>
      <View style={styles.ptColType}>
        <PitchChip type={p.tm_pitch_type} />
      </View>
      <Text style={[styles.ptTd, styles.ptColNum2]}>{fmt(num(p.tm_rel_speed_mph), 1)}</Text>
      <Text style={[styles.ptTd, styles.ptColNum2]}>{fmtInt(num(p.tm_spin_rate_rpm))}</Text>
      <Text style={[styles.ptTd, styles.ptColResult, { color: getCallColor(p.official_call) }]}>
        {callLabel(p.official_call)}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PITCHER
// ─────────────────────────────────────────────────────────────────────────
function PitcherDetail({ pitches, ipOuts }: { pitches: Pitch[]; ipOuts: number | null }) {
  const summary = useMemo(() => computeOuting(pitches, ipOuts), [pitches, ipOuts]);

  const zonePitches: ZonePitch[] = pitches.map((p) => ({
    plateSide: p.tm_plate_side_ft,
    plateHeight: p.tm_plate_height_ft,
    pitchType: p.tm_pitch_type,
  }));
  const breakPitches: BreakPitch[] = pitches.map((p) => ({
    hb: p.tm_hb_in,
    ivb: p.tm_ivb_in,
    pitchType: p.tm_pitch_type,
  }));

  return (
    <View style={{ paddingTop: 4 }}>
      {/* Outing summary cards */}
      <View style={styles.gridCards}>
        <SummaryCard
          value={String(summary.pitchCount)}
          label="PITCHES"
          sub={summary.strikes != null ? `${summary.strikes} strikes` : undefined}
        />
        <SummaryCard
          value={fmt(summary.topVelo, 1)}
          label="TOP VELO"
          sub="mph"
        />
        <SummaryCard
          value={summary.whiffPct != null ? `${Math.round(summary.whiffPct * 100)}%` : '—'}
          label="WHIFF"
          sub="on swings"
        />
      </View>

      {/* Zone (by type) + break plot */}
      <Text style={styles.subEyebrow}>
        <Text style={styles.subEyebrowAccent}>SHAPE</Text> · LOCATION & MOVEMENT
      </Text>
      <View style={styles.vizWrap}>
        <View style={styles.vizCol}>
          <StrikeZonePlot
            pitches={zonePitches}
            colorBy="pitchType"
            width={140}
            caption="Locations (all pitches)"
          />
        </View>
        <View style={styles.vizCol}>
          <BreakPlot pitches={breakPitches} width={150} caption="Movement — HB × IVB" />
        </View>
      </View>

      {/* Every pitch */}
      <Text style={styles.subEyebrow}>EVERY PITCH</Text>
      <View style={[styles.abCard, { marginTop: 0 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={styles.ptHeaderRow}>
              <Text style={[styles.ptTh, styles.wNum]}>#</Text>
              <Text style={[styles.ptTh, styles.wBtr]}>Btr</Text>
              <Text style={[styles.ptTh, styles.wType]}>Pitch</Text>
              <Text style={[styles.ptTh, styles.wVal]}>MPH</Text>
              <Text style={[styles.ptTh, styles.wVal]}>Spin</Text>
              <Text style={[styles.ptTh, styles.wVal]}>IVB</Text>
              <Text style={[styles.ptTh, styles.wVal]}>HB</Text>
              <Text style={[styles.ptTh, styles.wCall]}>Call</Text>
            </View>
            {pitches.map((p, idx) => (
              <View key={p.pitch_id} style={styles.ptRow}>
                <Text style={[styles.ptTd, styles.wNum]}>{idx + 1}</Text>
                <Text style={[styles.ptTd, styles.wBtr]} numberOfLines={1}>
                  {shortName(p.batter_name)}
                </Text>
                <View style={styles.wType}>
                  <PitchChip type={p.tm_pitch_type} />
                </View>
                <Text style={[styles.ptTd, styles.wVal]}>{fmt(num(p.tm_rel_speed_mph), 1)}</Text>
                <Text style={[styles.ptTd, styles.wVal]}>{fmtInt(num(p.tm_spin_rate_rpm))}</Text>
                <Text style={[styles.ptTd, styles.wVal]}>{fmtSigned(num(p.tm_ivb_in), 0)}</Text>
                <Text style={[styles.ptTd, styles.wVal]}>{fmtSigned(num(p.tm_hb_in), 0)}</Text>
                <Text
                  style={[styles.ptTd, styles.wCall, { color: getCallColor(p.official_call) }]}
                  numberOfLines={1}
                >
                  {callLabel(p.official_call)}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <Text style={styles.note}>
        Outing line: {ipFromOuts(summary.ipOuts)} IP · zone colored by pitch type · HB×IVB break.
      </Text>
    </View>
  );
}

function SummaryCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <View style={[styles.mcard, styles.mcardAccent]}>
      <Text style={styles.mv}>{value}</Text>
      <Text style={styles.ml}>{label}</Text>
      {sub ? <Text style={styles.ms}>{sub}</Text> : null}
    </View>
  );
}

function PitchChip({ type }: { type: string | null }) {
  const color = getPitchColor(type);
  return (
    <View style={[styles.pt, { backgroundColor: hexToRgba(color, 0.2) }]}>
      <Text style={[styles.ptText, { color }]}>{getPitchAbbrev(type)}</Text>
    </View>
  );
}

function UpcomingCard({
  icon,
  iconColor,
  heading,
  dateLabel,
  body,
  dotColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  heading: string;
  dateLabel: string;
  body: string;
  dotColor: string | undefined;
}) {
  return (
    <View style={styles.upcomingCard}>
      <View style={styles.upcomingAccent} />
      <View style={styles.upcomingBody}>
        <View style={styles.upcomingHeadRow}>
          {dotColor ? (
            <View style={[styles.upcomingDot, { backgroundColor: dotColor }]} />
          ) : (
            <Ionicons name={icon} size={20} color={iconColor} />
          )}
          <Text style={styles.upcomingHeading}>{heading}</Text>
        </View>
        {dateLabel ? <Text style={styles.upcomingDate}>{dateLabel}</Text> : null}
        <Text style={styles.upcomingBody2}>{body}</Text>
      </View>
    </View>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="baseball-outline" size={44} color={ACDL_MUT} />
      <Text style={styles.emptyStateText}>{label}</Text>
    </View>
  );
}

// ── helpers ──
function shortName(name: string | null | undefined): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return `rgba(155,221,255,${alpha})`;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// PA results that record an out (each = 1 out; DP = 2). Used to derive the
// outing length from the pitch stream when ip_outs isn't threaded in.
const OUT_RESULTS = new Set([
  'strikeout_swinging',
  'strikeout_looking',
  'ground_out',
  'fly_out',
  'line_out',
  'pop_out',
  'sac_fly',
  'sac_bunt',
  'fielders_choice',
]);

function computeOuting(
  pitches: Pitch[],
  ipOutsOverride: number | null
): {
  pitchCount: number;
  strikes: number | null;
  topVelo: number | null;
  whiffPct: number | null;
  ipOuts: number | null;
} {
  let strikes = 0;
  let topVelo: number | null = null;
  let swings = 0;
  let whiffs = 0;
  let hasCall = false;
  const STRIKE_CALLS = new Set([
    'called_strike',
    'swinging_strike',
    'foul',
    'foul_tip',
    'in_play',
  ]);
  const SWING_CALLS = new Set(['swinging_strike', 'foul', 'foul_tip', 'in_play']);
  // Derive outs from terminal PA results (one per pa_id) as a fallback.
  const seenPa = new Set<string>();
  let derivedOuts = 0;
  for (const p of pitches) {
    const v = num(p.tm_rel_speed_mph);
    if (v != null && (topVelo == null || v > topVelo)) topVelo = v;
    if (p.official_call) {
      hasCall = true;
      if (STRIKE_CALLS.has(p.official_call)) strikes++;
      if (SWING_CALLS.has(p.official_call)) swings++;
      if (p.official_call === 'swinging_strike') whiffs++;
    }
    if (p.pa_id && p.pa_result && !seenPa.has(p.pa_id)) {
      seenPa.add(p.pa_id);
      if (p.pa_result === 'double_play') derivedOuts += 2;
      else if (OUT_RESULTS.has(p.pa_result)) derivedOuts += 1;
    }
  }
  // Prefer the threaded true ip_outs; else the derived count; else null (em-dash).
  const ipOuts =
    ipOutsOverride != null ? ipOutsOverride : derivedOuts > 0 ? derivedOuts : null;
  return {
    pitchCount: pitches.length,
    strikes: hasCall ? strikes : null,
    topVelo,
    whiffPct: swings > 0 ? whiffs / swings : null,
    ipOuts,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ACDL_CREAM },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 80 },
  loadingContainer: {
    flex: 1,
    backgroundColor: ACDL_CREAM,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { marginTop: 16, color: ACDL_INK_2, fontSize: 14 },
  band: {
    backgroundColor: ACDL_NAVY,
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 18,
    borderBottomWidth: 3,
    borderBottomColor: ACDL_BLUE,
  },
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { color: ACDL_BAND_MUT, fontSize: 14, marginLeft: 8 },
  eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.8, color: ACDL_BLUE, marginBottom: 2 },
  title: { fontSize: 24, fontWeight: '900', color: ACDL_BAND_TEXT, marginBottom: 4 },
  subtitle: { fontSize: 14, color: ACDL_BAND_MUT },

  toggleContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 12,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 10,
    padding: 4,
  },
  toggleButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  toggleButtonActive: { backgroundColor: ACDL_BLUE },
  toggleText: { fontSize: 14, fontWeight: '700', color: ACDL_INK_2 },
  toggleTextActive: { color: ACDL_ON_ACCENT },

  // at-bat / detail card
  abCard: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 14,
    backgroundColor: ACDL_PAPER,
    overflow: 'hidden',
  },
  abHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: ACDL_LINE,
  },
  abPa: { fontSize: 13, fontWeight: '900', color: ACDL_INK },
  abHeadRight: { flexDirection: 'row', alignItems: 'center' },
  abRes: { fontSize: 11, fontWeight: '800' },
  abResHit: { color: ACDL_WIN },
  abResOut: { color: ACDL_INK_2 },

  // pitch table
  pitchTable: { paddingHorizontal: 0 },
  ptHeaderRow: {
    flexDirection: 'row',
    backgroundColor: ACDL_CREAM_2,
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  ptRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: ACDL_LINE,
    paddingVertical: 9,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  ptTh: { fontSize: 8, color: ACDL_MUT, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '800' },
  ptTd: { fontSize: 11, color: ACDL_INK, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // hitter table columns
  ptColNum: { width: 24, textAlign: 'center' },
  ptColType: { width: 52, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  ptColNum2: { flex: 1, textAlign: 'center' },
  ptColResult: { flex: 1.4, textAlign: 'right' },
  // pitcher (horizontal) table columns
  wNum: { width: 28, textAlign: 'center' },
  wBtr: { width: 64, textAlign: 'left', paddingLeft: 4 },
  wType: { width: 52, alignItems: 'center', justifyContent: 'center' },
  wVal: { width: 52, textAlign: 'center' },
  wCall: { width: 80, textAlign: 'left' },

  // visualizations — navy band (the SVG plots draw white-on-dark)
  vizWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    padding: 14,
    margin: 14,
    marginTop: 0,
    borderRadius: 12,
    backgroundColor: ACDL_NAVY,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  vizCol: { alignItems: 'center' },

  // pitch type chip
  pt: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  ptText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },

  // metric / summary cards
  gridCards: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8, marginTop: 14 },
  mcard: {
    width: '31.5%',
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 3,
  },
  mcardAccent: { borderLeftWidth: 3, borderLeftColor: ACDL_BLUE },
  mv: { fontSize: 20, fontWeight: '900', color: ACDL_INK, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  ml: { fontSize: 9, color: ACDL_MUT, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  ms: { fontSize: 9, color: ACDL_INK_2, marginTop: 1 },

  subEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: ACDL_BRAND_TEXT,
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 10,
  },
  // Distinct from the brand-blue eyebrow: heavier navy ink so "SHAPE" reads
  // as the emphasized lead word, not the same color as the rest of the label.
  subEyebrowAccent: { color: ACDL_INK, fontWeight: '900' },

  note: {
    fontSize: 10,
    color: ACDL_MUT,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    lineHeight: 15,
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 16,
  },
  emptyStateText: { fontSize: 16, color: ACDL_INK, marginTop: 16, fontWeight: '700', textAlign: 'center' },

  // Upcoming / live / cancelled card
  upcomingCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 20,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 16,
    backgroundColor: ACDL_PAPER,
    overflow: 'hidden',
  },
  upcomingAccent: {
    width: 4,
    backgroundColor: ACDL_BLUE,
  },
  upcomingBody: { flex: 1, padding: 18 },
  upcomingHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  upcomingDot: { width: 10, height: 10, borderRadius: 5 },
  upcomingHeading: { fontSize: 17, fontWeight: '900', color: ACDL_INK },
  upcomingDate: { fontSize: 13, color: ACDL_INK_2, marginBottom: 10 },
  upcomingBody2: { fontSize: 13, color: ACDL_MUT, lineHeight: 19 },
});
