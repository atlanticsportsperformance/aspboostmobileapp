/**
 * LeagueStatsScreen — ACDL season stats with a Hitting/Pitching segmented
 * toggle (Phase 12.2). Matches mockup screens 5 + 6:
 *   HITTING: cream/gold hero (AVG·HR·RBI), STANDARD LINE table-card
 *            (G AB H 2B 3B HR RBI BB SO SB), ADVANCED metric grid
 *            (wOBA·wRC+·OPS·ISO·K%·BB%), TRACKMAN BATTED BALL cards
 *            (avg/max EV, LA, hard-hit%, max dist).
 *   PITCHING: cream/gold hero (ERA·K·W-L), STANDARD LINE table-card
 *            (G IP H R ER BB K HR ERA WHIP), TRACKMAN pitch-metric cards
 *            (velo/spin/IVB/HB/extension/zone%).
 *
 * Real chrome reused verbatim from HittingPerformanceScreen + PerformanceScreen
 * (back-button header, cream PR row, segmented toggle). League accent = purple.
 * Em-dash where a metric isn't in the data.
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
  LeagueStatRow,
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
import { ACDL_BLUE, ACDL_ON_ACCENT } from '../components/league/acdlTheme';

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
        <ActivityIndicator size="large" color={ACDL_BLUE} />
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACDL_BLUE} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#9CA3AF" />
            <Text style={styles.backText}>League Hub</Text>
          </TouchableOpacity>
          <Text style={styles.title}>League Stats</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
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
          <PitchingView stats={stats} games={season?.games_pitched ?? 0} />
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
      <View style={styles.prBlock}>
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
      <Text style={styles.subEyebrow}>
        <Text style={styles.subEyebrowAccent}>ADVANCED</Text>
      </Text>
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
        <MetricCard value="—" label="BARREL%" sub="optimal" />
        <MetricCard value={fmtInt(num(met?.max_distance_ft))} label="MAX DIST" sub="ft" />
      </View>

      <Text style={styles.note}>Hard-Hit = 95+ mph exit velo.</Text>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PITCHING
// ─────────────────────────────────────────────────────────────────────────
function PitchingView({ stats, games }: { stats: LeagueSeasonStats | null; games: number }) {
  const s = stats?.pitching?.season ?? null;
  const adv = stats?.pitching?.advanced ?? null;
  const met = stats?.pitching?.metrics ?? null;
  const rec = stats?.record ?? null;

  if (!s) {
    return (
      <EmptyStat
        icon="baseball"
        label="No pitching stats yet"
        sub="Pitching numbers appear once you throw in a published game."
      />
    );
  }

  const wl = rec
    ? `${fmtInt(num(rec.wins))}-${fmtInt(num(rec.losses))}`
    : `${fmtInt(num(adv?.w))}-${fmtInt(num(adv?.l))}`;
  const k9 =
    num(s.ip_outs) && num(s.ip_outs)! > 0
      ? ((num(s.k) ?? 0) * 27) / (num(s.ip_outs) as number)
      : null;

  return (
    <>
      {/* Hero: ERA · K · W-L */}
      <View style={styles.prBlock}>
        <View style={styles.swingCountRow}>
          <Text style={styles.sectionTitle}>Season Line</Text>
          <Text style={styles.scount}>
            {games} GP <Text style={styles.scountDiv}>·</Text> {ipFromOuts(num(s.ip_outs))} IP
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
          <HeroItem value={wl} label="W-L" unit={`${fmt(num(adv?.fip_ra9), 2)} FIP`} />
        </View>
      </View>

      {/* Standard line */}
      <Text style={styles.subEyebrow}>STANDARD LINE</Text>
      <LineTable
        headers={['G', 'IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'ERA', 'WHIP']}
        values={[
          String(games),
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
      <Text style={styles.subEyebrow}>
        <Text style={styles.subEyebrowAccent}>TRACKMAN</Text> · PITCH METRICS
      </Text>
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

      <Text style={styles.note}>TrackMan metrics shown across all pitch types.</Text>
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
      <View style={styles.statPrVrow}>
        <Ionicons name="star" size={12} color="#D4AF37" />
        <Text style={styles.statPrValue}>{value}</Text>
      </View>
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
      <Ionicons name={icon} size={44} color="#4B5563" />
      <Text style={styles.emptyStateText}>{label}</Text>
      <Text style={styles.emptyStateSubtext}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 80 },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { marginTop: 16, color: '#9CA3AF', fontSize: 14 },
  header: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10 },
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backText: { color: '#9CA3AF', fontSize: 14, marginLeft: 8 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#9CA3AF' },

  // toggle (PerformanceScreen idiom; purple active for league)
  toggleContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 4,
  },
  toggleButton: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  toggleButtonActive: { backgroundColor: ACDL_BLUE },
  toggleText: { fontSize: 14, fontWeight: '600', color: '#9CA3AF' },
  toggleTextActive: { color: ACDL_ON_ACCENT },

  prBlock: { paddingHorizontal: 16 },
  swingCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#FFFFFF' },
  scount: { fontSize: 12, color: '#9CA3AF' },
  scountDiv: { color: '#4B5563' },

  statPrRow: { flexDirection: 'row', marginBottom: 16 },
  statPrItem: { flex: 1, alignItems: 'center' },
  statPrItemBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  statPrVrow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  statPrValue: { fontSize: 24, fontWeight: 'bold', color: '#F5F0E6', letterSpacing: -0.5 },
  statPrLabel: { fontSize: 9, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1 },
  statPrUnit: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },

  subEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: '#E5E7EB',
    paddingHorizontal: 16,
    marginTop: 22,
    marginBottom: 12,
  },
  subEyebrowAccent: { color: ACDL_BLUE },

  // line table
  tableCard: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.03)' },
  tableBodyRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  th: {
    flex: 1,
    fontSize: 9,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '700',
    paddingVertical: 9,
    textAlign: 'center',
  },
  td: {
    flex: 1,
    fontSize: 12,
    color: '#E5E7EB',
    fontWeight: '600',
    paddingVertical: 9,
    textAlign: 'center',
  },
  tdHi: { color: ACDL_BLUE, fontWeight: '800' },

  // metric cards
  gridCards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
  },
  mcard: {
    width: '31.5%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 3,
  },
  mcardAccent: { borderLeftWidth: 3, borderLeftColor: ACDL_BLUE },
  mv: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  ml: { fontSize: 9, color: '#6B7280', fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  ms: { fontSize: 9, color: '#9CA3AF', marginTop: 1 },

  note: {
    fontSize: 10,
    color: '#6B7280',
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
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 24,
  },
  emptyStateText: { fontSize: 16, color: '#9CA3AF', marginTop: 16, fontWeight: '600' },
  emptyStateSubtext: { fontSize: 14, color: '#6B7280', marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
