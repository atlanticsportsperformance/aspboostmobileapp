/**
 * LeagueStatsScreen — ACDL season stats with a Hitting/Pitching segmented
 * toggle.
 *   HITTING: hero (AVG·HR·RBI), STANDARD LINE table-card
 *            (G AB H 2B 3B HR RBI BB SO SB), ADVANCED metric grid
 *            (wOBA·wRC+·OPS·ISO·K%·BB%), TRACKMAN BATTED BALL cards.
 *   PITCHING: hero (ERA·K·W-L), STANDARD LINE table-card
 *            (G IP H R ER BB K HR ERA WHIP), TRACKMAN pitch-metric cards.
 *            W-L = the athlete's PITCHER decisions (pitcher_wins/losses); a
 *            saves chip when applicable.
 *
 * Styled to match the ACDL website (aspwebsite app/acdl/acdl.css): cream/navy/
 * sky-blue, real crest PNG. Em-dash where a metric isn't in the data.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAthleteId } from '../hooks/useAthleteId';
import { useAcdlMembership } from '../hooks/useAcdlMembership';
import {
  fetchAcdlSeasonStats,
  LeagueSeasonStats,
  LeagueSeasonMembership,
} from '../lib/acdlLeague';
import {
  num,
  fmt,
  fmtInt,
  fmt3,
  fmtPct,
  fmtSigned,
  ipFromOuts,
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
} from '../components/league/acdlTheme';
import { AcdlCrest } from '../components/league/AcdlCrest';

type Mode = 'hitting' | 'pitching';

export default function LeagueStatsScreen({ navigation, route }: any) {
  const overrideAthleteId: string | null = route?.params?.athleteId ?? null;
  const routeSeasonId: string | null = route?.params?.seasonId ?? null;
  const { athleteId } = useAthleteId(overrideAthleteId);
  const { seasons, currentSeason, loading: membershipLoading } =
    useAcdlMembership(overrideAthleteId);

  const seasonId = routeSeasonId ?? currentSeason?.season_id ?? null;
  const season = useMemo(
    () => seasons.find((s) => s.season_id === seasonId) ?? currentSeason,
    [seasons, seasonId, currentSeason]
  );

  const [mode, setMode] = useState<Mode>('hitting');
  const [stats, setStats] = useState<LeagueSeasonStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (id: string, sid: string) => {
    const { data } = await fetchAcdlSeasonStats(id, sid);
    setStats(data ?? null);
  }, []);

  useEffect(() => {
    if (membershipLoading) return;
    if (!athleteId || !seasonId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load(athleteId, seasonId);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, seasonId, membershipLoading, load]);

  // Default the toggle to whichever side the athlete actually has data for.
  useEffect(() => {
    if (!stats) return;
    const hasBatting = !!stats.batting?.season;
    const hasPitching = !!stats.pitching?.season;
    if (!hasBatting && hasPitching) setMode('pitching');
  }, [stats]);

  const onRefresh = async () => {
    if (!athleteId || !seasonId) return;
    setRefreshing(true);
    await load(athleteId, seasonId);
    setRefreshing(false);
  };

  if (membershipLoading || loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={ACDL_BRAND_TEXT} />
        <Text style={styles.loadingText}>Loading league stats...</Text>
      </View>
    );
  }

  const positions = (season?.positions || []).join('/');
  const subtitle = [
    season ? `#${season.jersey_number ?? '—'}` : null,
    positions || null,
    season?.season_name,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACDL_BRAND_TEXT} />
        }
      >
        {/* Navy band header */}
        <View style={styles.band}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color={ACDL_BAND_MUT} />
            <Text style={styles.backText}>League Hub</Text>
          </TouchableOpacity>
          <View style={styles.headerRow}>
            <AcdlCrest size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>STATS</Text>
              <Text style={styles.title}>League Stats</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
          </View>
        </View>

        {/* Hitting / Pitching toggle */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleButton, mode === 'hitting' && styles.toggleButtonActive]}
            onPress={() => setMode('hitting')}
          >
            <Text style={[styles.toggleText, mode === 'hitting' && styles.toggleTextActive]}>
              Hitting
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, mode === 'pitching' && styles.toggleButtonActive]}
            onPress={() => setMode('pitching')}
          >
            <Text style={[styles.toggleText, mode === 'pitching' && styles.toggleTextActive]}>
              Pitching
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'hitting' ? (
          <HittingView stats={stats} games={season?.games_played ?? 0} />
        ) : (
          <PitchingView stats={stats} season={season ?? null} />
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HITTING
// ─────────────────────────────────────────────────────────────────────────
function HittingView({ stats, games }: { stats: LeagueSeasonStats | null; games: number }) {
  const s = stats?.batting?.season ?? null;
  const adv = stats?.batting?.advanced ?? null;
  const met = stats?.batting?.metrics ?? null;

  if (!s) {
    return (
      <EmptyStat
        icon="baseball"
        label="No batting stats yet"
        sub="Hitting numbers appear once you log a plate appearance in a published game."
      />
    );
  }

  return (
    <>
      {/* Hero: AVG · HR · RBI */}
      <View style={styles.heroCard}>
        <View style={styles.swingCountRow}>
          <Text style={styles.sectionTitle}>Season Line</Text>
          <Text style={styles.scount}>
            {games} GP <Text style={styles.scountDiv}>·</Text> {fmtInt(num(s.pa))} PA
          </Text>
        </View>
        <View style={styles.statPrRow}>
          <HeroItem value={fmt3(num(s.avg))} label="AVG" unit={`${fmt3(num(s.obp))} OBP`} />
          <HeroItem value={fmtInt(num(s.hr))} label="Home Runs" unit={`${fmt3(num(s.slg))} SLG`} bordered />
          <HeroItem value={fmtInt(num(s.rbi))} label="RBI" unit={`${fmtInt(num(s.sb))} SB`} />
        </View>
      </View>

      {/* Standard line */}
      <Text style={styles.subEyebrow}>STANDARD LINE</Text>
      <LineTable
        headers={['G', 'AB', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'SO', 'SB']}
        values={[
          String(games),
          fmtInt(num(s.ab)),
          fmtInt(num(s.h)),
          fmtInt(num(s.b2)),
          fmtInt(num(s.b3)),
          fmtInt(num(s.hr)),
          fmtInt(num(s.rbi)),
          fmtInt(num(s.bb)),
          fmtInt(num(s.k)),
          fmtInt(num(s.sb)),
        ]}
      />

      {/* Advanced */}
      <Text style={styles.subEyebrow}>ADVANCED</Text>
      <View style={styles.gridCards}>
        <MetricCard value={fmt3(num(adv?.woba))} label="wOBA" accent />
        <MetricCard value={fmtInt(num(adv?.wrc_plus_simple))} label="wRC+" accent />
        <MetricCard value={fmt3(num(adv?.ops))} label="OPS" accent />
        <MetricCard value={fmt3(num(adv?.iso))} label="ISO" accent />
        <MetricCard value={fmtPct(num(adv?.k_pct))} label="K%" accent />
        <MetricCard value={fmtPct(num(adv?.bb_pct))} label="BB%" accent />
      </View>

      {/* TrackMan batted ball */}
      <Text style={styles.subEyebrow}>TRACKMAN BATTED BALL</Text>
      <View style={styles.gridCards}>
        <MetricCard value={fmt(num(met?.avg_ev_mph), 1)} label="AVG EV" sub="mph" />
        <MetricCard value={fmt(num(met?.max_ev_mph), 1)} label="MAX EV" sub="mph" />
        <MetricCard
          value={met?.avg_la_deg != null ? `${fmt(num(met?.avg_la_deg), 1)}°` : '—'}
          label="AVG LA"
          sub="launch"
        />
        <MetricCard value={fmtPct(num(met?.hard_hit_pct))} label="HARD-HIT" sub="95+ mph" />
        <MetricCard value={fmtInt(num(met?.max_distance_ft))} label="MAX DIST" sub="ft" />
      </View>

      <Text style={styles.note}>Hard-Hit = 95+ mph exit velo.</Text>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PITCHING
// ─────────────────────────────────────────────────────────────────────────
function PitchingView({
  stats,
  season,
}: {
  stats: LeagueSeasonStats | null;
  season: LeagueSeasonMembership | null;
}) {
  const s = stats?.pitching?.season ?? null;
  const adv = stats?.pitching?.advanced ?? null;
  const met = stats?.pitching?.metrics ?? null;

  if (!s) {
    return (
      <EmptyStat
        icon="baseball"
        label="No pitching stats yet"
        sub="Pitching numbers appear once you throw in a published game."
      />
    );
  }

  // ACDL records live on the player → W-L is the athlete's pitcher decisions.
  const pw = season?.pitcher_wins ?? 0;
  const pl = season?.pitcher_losses ?? 0;
  const sv = season?.saves ?? 0;
  const wl = `${pw}-${pl}`;
  // Games PITCHED comes from the record view (games_pitched), not the wide
  // pitching-stat row's `g` (which isn't the appearance count) nor season GP.
  const gp = num(stats?.record?.games_pitched) ?? season?.games_played ?? 0;
  const k9 =
    num(s.ip_outs) && num(s.ip_outs)! > 0
      ? ((num(s.k) ?? 0) * 27) / (num(s.ip_outs) as number)
      : null;

  return (
    <>
      {/* Hero: ERA · K · W-L */}
      <View style={styles.heroCard}>
        <View style={styles.swingCountRow}>
          <Text style={styles.sectionTitle}>Season Line</Text>
          <Text style={styles.scount}>
            {gp} GP <Text style={styles.scountDiv}>·</Text> {ipFromOuts(num(s.ip_outs))} IP
          </Text>
        </View>
        <View style={styles.statPrRow}>
          <HeroItem value={fmt(num(s.era), 2)} label="ERA" unit={`${fmt(num(adv?.whip), 2)} WHIP`} />
          <HeroItem
            value={fmtInt(num(s.k))}
            label="Strikeouts"
            unit={k9 != null ? `${fmt(k9, 1)} K/9` : '—'}
            bordered
          />
          <HeroItem value={wl} label="W-L" unit={sv > 0 ? `${sv} SV` : `${fmt(num(adv?.fip_ra9), 2)} FIP`} />
        </View>
      </View>

      {/* Standard line */}
      <Text style={styles.subEyebrow}>STANDARD LINE</Text>
      <LineTable
        headers={['G', 'IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'ERA', 'WHIP']}
        values={[
          String(gp),
          ipFromOuts(num(s.ip_outs)),
          fmtInt(num(s.h)),
          fmtInt(num(s.r)),
          fmtInt(num(s.er)),
          fmtInt(num(s.bb)),
          fmtInt(num(s.k)),
          fmtInt(num(adv?.hr_allowed)),
          fmt(num(s.era), 2),
          fmt(num(adv?.whip), 2),
        ]}
        highlightIndex={8}
      />

      {/* TrackMan pitch metrics */}
      <Text style={styles.subEyebrow}>TRACKMAN · PITCH METRICS</Text>
      <View style={styles.gridCards}>
        <MetricCard value={fmt(num(met?.avg_velo_mph), 1)} label="AVG VELO" sub="mph" accent />
        <MetricCard value={fmt(num(met?.max_velo_mph), 1)} label="MAX VELO" sub="mph" accent />
        <MetricCard value={fmtInt(num(met?.avg_spin_rpm))} label="SPIN" sub="rpm" accent />
        <MetricCard value={fmtSigned(num(met?.avg_ivb_in), 1)} label="IVB" sub="in" accent />
        <MetricCard value={fmtSigned(num(met?.avg_hb_in), 1)} label="HB" sub="in" accent />
        <MetricCard value={fmt(num(met?.avg_extension_ft), 1)} label="EXTENSION" sub="ft" accent />
        <MetricCard value={fmtPct(num(met?.zone_pct))} label="ZONE%" sub="strikes" accent />
        <MetricCard value={fmtPct(num(adv?.k_pct))} label="K%" accent />
        <MetricCard value={fmtPct(num(adv?.bb_pct))} label="BB%" accent />
      </View>

      <Text style={styles.note}>
        W-L = your pitcher decisions{sv > 0 ? ` · ${sv} save${sv === 1 ? '' : 's'}` : ''}. TrackMan
        metrics shown across all pitch types.
      </Text>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────
function HeroItem({
  value,
  label,
  unit,
  bordered,
}: {
  value: string;
  label: string;
  unit: string;
  bordered?: boolean;
}) {
  return (
    <View style={[styles.statPrItem, bordered && styles.statPrItemBorder]}>
      <Text style={styles.statPrValue}>{value}</Text>
      <Text style={styles.statPrLabel}>{label}</Text>
      <Text style={styles.statPrUnit}>{unit}</Text>
    </View>
  );
}

function LineTable({
  headers,
  values,
  highlightIndex,
}: {
  headers: string[];
  values: string[];
  highlightIndex?: number;
}) {
  return (
    <View style={styles.tableCard}>
      <View style={styles.tableHeaderRow}>
        {headers.map((h, i) => (
          <Text key={`h-${i}`} style={styles.th}>
            {h}
          </Text>
        ))}
      </View>
      <View style={styles.tableBodyRow}>
        {values.map((v, i) => (
          <Text
            key={`v-${i}`}
            style={[styles.td, highlightIndex === i && styles.tdHi]}
          >
            {v}
          </Text>
        ))}
      </View>
    </View>
  );
}

function MetricCard({
  value,
  label,
  sub,
  accent,
}: {
  value: string;
  label: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <View style={[styles.mcard, accent && styles.mcardAccent]}>
      <Text style={styles.mv}>{value}</Text>
      <Text style={styles.ml}>{label}</Text>
      {sub ? <Text style={styles.ms}>{sub}</Text> : null}
    </View>
  );
}

function EmptyStat({ icon, label, sub }: { icon: any; label: string; sub: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon} size={44} color={ACDL_MUT} />
      <Text style={styles.emptyStateText}>{label}</Text>
      <Text style={styles.emptyStateSubtext}>{sub}</Text>
    </View>
  );
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
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backText: { color: ACDL_BAND_MUT, fontSize: 14, marginLeft: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.8, color: ACDL_BLUE, marginBottom: 2 },
  title: { fontSize: 28, fontWeight: '900', color: ACDL_BAND_TEXT, marginBottom: 2 },
  subtitle: { fontSize: 13, color: ACDL_BAND_MUT },

  // toggle
  toggleContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 14,
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

  heroCard: {
    marginHorizontal: 16,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 16,
    padding: 16,
  },
  swingCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '900', color: ACDL_INK },
  scount: { fontSize: 12, color: ACDL_INK_2 },
  scountDiv: { color: ACDL_MUT },

  statPrRow: { flexDirection: 'row' },
  statPrItem: { flex: 1, alignItems: 'center' },
  statPrItemBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: ACDL_LINE,
  },
  statPrValue: { fontSize: 26, fontWeight: '900', color: ACDL_INK, letterSpacing: -0.5, fontVariant: ['tabular-nums'], marginBottom: 4 },
  statPrLabel: { fontSize: 9, color: ACDL_MUT, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700' },
  statPrUnit: { fontSize: 12, color: ACDL_BRAND_TEXT, marginTop: 2, fontWeight: '600' },

  subEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: ACDL_BRAND_TEXT,
    paddingHorizontal: 16,
    marginTop: 22,
    marginBottom: 12,
  },

  // line table
  tableCard: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: ACDL_PAPER,
  },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: ACDL_CREAM_2 },
  tableBodyRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: ACDL_LINE },
  th: {
    flex: 1,
    fontSize: 9,
    color: ACDL_MUT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '800',
    paddingVertical: 9,
    textAlign: 'center',
  },
  td: {
    flex: 1,
    fontSize: 12,
    color: ACDL_INK,
    fontWeight: '700',
    paddingVertical: 9,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  tdHi: { color: ACDL_BRAND_TEXT, fontWeight: '900' },

  // metric cards
  gridCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
  },
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

  note: {
    fontSize: 10,
    color: ACDL_MUT,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    lineHeight: 15,
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 16,
  },
  emptyStateText: { fontSize: 16, color: ACDL_INK, marginTop: 16, fontWeight: '700' },
  emptyStateSubtext: { fontSize: 14, color: ACDL_INK_2, marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
