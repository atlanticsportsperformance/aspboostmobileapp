/**
 * LeagueHubScreen — the ACDL athlete membership hub.
 *
 * Styled to match the actual ACDL WEBSITE (aspwebsite app/acdl/acdl.css): a
 * LIGHT cream/navy/sky-blue look, NOT the dark performance app. Real ACDL crest
 * PNG throughout.
 *
 * ACDL has NO fixed teams — Navy vs White, reshuffled weekly; records live on
 * the PLAYER. So the header shows the ATHLETE'S NAME (not "Your Team"), and the
 * RECORD is the athlete's PERSONAL record (personal_wins-personal_losses).
 * "Next game" shows the athlete's SIDE for that game (my_team_name) vs the
 * opponent, or "Navy vs White" when no side is assigned yet.
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ACDL_CREAM,
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
  acdlBlueAlpha,
} from '../components/league/acdlTheme';
import { useAthleteId } from '../hooks/useAthleteId';
import { useAcdlMembership } from '../hooks/useAcdlMembership';
import {
  fetchAcdlEvents,
  fetchAcdlSeasonStats,
  fetchAthleteName,
  LeagueEvent,
  LeagueSeasonMembership,
  LeagueSeasonStats,
} from '../lib/acdlLeague';
import {
  num,
  fmt3,
  fmt,
  gameSide,
  formatGameDate,
  formatEventTime,
} from '../lib/leagueFormat';
import { AcdlCrest } from '../components/league/AcdlCrest';
import TeamTag from '../components/league/TeamTag';

export default function LeagueHubScreen({ navigation, route }: any) {
  const overrideAthleteId: string | null = route?.params?.athleteId ?? null;
  const { athleteId } = useAthleteId(overrideAthleteId);
  const { inLeague, seasons, currentSeason, loading: membershipLoading } =
    useAcdlMembership(overrideAthleteId);

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [nextGame, setNextGame] = useState<LeagueEvent | null>(null);
  const [stats, setStats] = useState<LeagueSeasonStats | null>(null);
  const [athleteName, setAthleteName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Resolve the active season: explicit selection, else current/newest.
  const season: LeagueSeasonMembership | null = useMemo(() => {
    if (selectedSeasonId) {
      return seasons.find((s) => s.season_id === selectedSeasonId) ?? currentSeason;
    }
    return currentSeason;
  }, [selectedSeasonId, seasons, currentSeason]);

  // Athlete name for the header (ACDL has no season team).
  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    (async () => {
      const name = await fetchAthleteName(athleteId);
      if (!cancelled) setAthleteName(name);
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const loadSeasonData = useCallback(
    async (id: string, seasonId: string) => {
      const today = new Date().toISOString().split('T')[0];
      const [eventsRes, statsRes] = await Promise.all([
        fetchAcdlEvents(id, today, null),
        fetchAcdlSeasonStats(id, seasonId),
      ]);

      // Next upcoming GAME for this season (events come back date-sorted asc).
      const upcomingGame =
        (eventsRes.data || []).find(
          (e) => e.type === 'game' && e.season_id === seasonId
        ) ?? null;
      setNextGame(upcomingGame);
      setStats(statsRes.data ?? null);
    },
    []
  );

  useEffect(() => {
    if (membershipLoading) return;
    if (!athleteId || !season) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadSeasonData(athleteId, season.season_id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, season?.season_id, membershipLoading, loadSeasonData]);

  const onRefresh = async () => {
    if (!athleteId || !season) return;
    setRefreshing(true);
    await loadSeasonData(athleteId, season.season_id);
    setRefreshing(false);
  };

  // ── Loading ──
  if (membershipLoading || (loading && inLeague)) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={ACDL_BRAND_TEXT} />
        <Text style={styles.loadingText}>Loading league hub...</Text>
      </View>
    );
  }

  // ── Not in the league: friendly empty state ──
  if (!inLeague || !season) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color={ACDL_INK_2} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>ACDL</Text>
        </View>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="trophy-outline" size={48} color={ACDL_MUT} />
          <Text style={styles.emptyStateText}>Not on a league roster</Text>
          <Text style={styles.emptyStateSubtext}>
            The ACDL hub appears here once you're added to a season.
          </Text>
        </View>
      </View>
    );
  }

  const positions = (season.positions || []).join('/');
  const roleLine = [
    season.jersey_number != null ? `#${season.jersey_number}` : null,
    positions || null,
    season.season_name,
  ]
    .filter(Boolean)
    .join(' · ');

  const bat = stats?.batting?.season ?? null;
  const batAdv = stats?.batting?.advanced ?? null;
  const pit = stats?.pitching?.season ?? null;
  const pitAdv = stats?.pitching?.advanced ?? null;

  // A pitcher hub strip when they've pitched; else hitter strip.
  const isPitcherView = pit != null;

  const nextSide = nextGame ? gameSide(nextGame) : null;

  // Role-aware headline stat for the Season Summary right column:
  // pitcher → ERA (X.XX), hitter → AVG (.XXX). Em-dash until the stat is
  // actually accumulated (0 IP / 0 AB / 0 GP), consistent with the glance strip.
  const gp = season.games_played ?? 0;
  let rightLabel: string;
  let rightValue: string;
  let rightCaption: string;
  if (isPitcherView) {
    const ipOuts = num(pit?.ip_outs);
    const era = num(pit?.era);
    rightLabel = 'ERA';
    rightValue = ipOuts && ipOuts > 0 && gp > 0 ? era?.toFixed(2) ?? '—' : '—';
    rightCaption = 'Earned run avg';
  } else {
    const ab = num(bat?.ab);
    const avg = num(bat?.avg);
    rightLabel = 'AVG';
    rightValue = ab && ab > 0 && gp > 0 ? fmt3(avg) : '—';
    rightCaption = 'Batting avg';
  }

  // "Season at a glance" chips — built up-front so we can hide the strip when
  // every value is an em-dash (stats only post once games are scored).
  const sv = season.saves ?? 0;
  const pitcherWL = `${season.pitcher_wins}-${season.pitcher_losses}${
    sv > 0 ? ` · ${sv} SV` : ''
  }`;
  const glanceChips: { label: string; value: string }[] = isPitcherView
    ? [
        { label: 'ERA / WHIP', value: `${fmt(num(pit?.era))} / ${fmt(num(pitAdv?.whip))}` },
        { label: 'K', value: fmt(num(pit?.k), 0) },
        { label: 'W-L', value: pitcherWL },
      ]
    : [
        { label: 'AVG / OPS', value: `${fmt3(num(bat?.avg))} / ${fmt3(num(batAdv?.ops))}` },
        { label: 'HR / RBI', value: `${fmt(num(bat?.hr), 0)} / ${fmt(num(bat?.rbi), 0)}` },
        { label: 'wRC+', value: fmt(num(batAdv?.wrc_plus_simple), 0) },
      ];
  // True when every chip is purely em-dashes (no scored games yet).
  const glanceEmpty = glanceChips.every((c) => /^[—\s/]*$/.test(c.value));

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACDL_BRAND_TEXT} />
        }
      >
        {/* Navy band hero — crest + ATHLETE NAME (no season team in ACDL) */}
        <View style={styles.band}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color={ACDL_BAND_MUT} />
            <Text style={styles.backTextBand}>Back</Text>
          </TouchableOpacity>
          <View style={styles.hubHeader}>
            <AcdlCrest size={52} />
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrowBand}>ATLANTIC COLLEGIATE DEVELOPMENT LEAGUE</Text>
              <Text style={styles.hhName}>{athleteName || 'Player'}</Text>
              <Text style={styles.hhRole}>{roleLine}</Text>
            </View>
          </View>
        </View>

        {/* Season selector when >1 season */}
        {seasons.length > 1 && (
          <View style={styles.seasonSelector}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {seasons.map((s) => {
                const active = s.season_id === season.season_id;
                return (
                  <TouchableOpacity
                    key={s.season_id}
                    style={[styles.seasonChip, active && styles.seasonChipActive]}
                    onPress={() => setSelectedSeasonId(s.season_id)}
                  >
                    <Text style={[styles.seasonChipText, active && styles.seasonChipTextActive]}>
                      {s.season_name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Personal record snapshot card (cream w/ navy hairline) */}
        <View style={styles.snapCardWrap}>
          <View style={styles.snapCard}>
            <Text style={styles.snapEyebrow}>SEASON SUMMARY</Text>
            <Text style={styles.snapTitle}>Player Record</Text>
            <View style={styles.prRow}>
              {/* RECORD — headline weight (the season's primary number) */}
              <View style={styles.prCol}>
                <Text style={styles.prLabel}>RECORD</Text>
                <Text style={styles.prValue}>
                  {season.personal_wins}-{season.personal_losses}
                </Text>
                <View style={[styles.prAccent, { backgroundColor: ACDL_BLUE }]} />
                <Text style={styles.prCaption}>Your W-L</Text>
              </View>
              <View style={styles.prDivider} />
              {/* Role headline — pitcher ERA / hitter AVG */}
              <View style={styles.prCol}>
                <Text style={styles.prLabel}>{rightLabel}</Text>
                <Text style={styles.prValueSm}>{rightValue}</Text>
                <View style={[styles.prAccent, { backgroundColor: ACDL_BLUE }]} />
                <Text style={styles.prCaption}>{rightCaption}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* QUICK ACCESS tiles */}
        <Text style={styles.subEyebrow}>QUICK ACCESS</Text>
        <View style={styles.tiles}>
          <TouchableOpacity
            style={styles.tile}
            onPress={() =>
              navigation.navigate('LeagueStats', { athleteId, seasonId: season.season_id })
            }
          >
            <Ionicons name="stats-chart" size={22} color={ACDL_BRAND_TEXT} />
            <Text style={styles.tileText}>Stats</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tile}
            onPress={() => navigation.navigate('LeagueSchedule', { athleteId })}
          >
            <Ionicons name="calendar" size={22} color={ACDL_BRAND_TEXT} />
            <Text style={styles.tileText}>Schedule</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tile}
            onPress={() =>
              navigation.navigate('LeagueGameLog', { athleteId, seasonId: season.season_id })
            }
          >
            <Ionicons name="list" size={22} color={ACDL_BRAND_TEXT} />
            <Text style={styles.tileText}>Game Log</Text>
          </TouchableOpacity>
        </View>

        {/* Season at a glance — hidden (single note chip) until games are scored */}
        {glanceEmpty ? (
          <View style={styles.seasonStrip}>
            <View style={styles.ssChipFull}>
              <Text style={styles.ssNote}>Stats post once games are scored</Text>
            </View>
          </View>
        ) : (
          <View style={styles.seasonStrip}>
            {glanceChips.map((c) => (
              <SeasonChip key={c.label} label={c.label} value={c.value} />
            ))}
          </View>
        )}

        {/* Next game card — or a cream "no upcoming games" empty card */}
        <Text style={styles.subEyebrow}>NEXT GAME</Text>
        {nextGame ? (
          <View style={styles.gameCardWrap}>
            <View style={styles.gameCard}>
              {/* YOUR SIDE — prominent team-color pill */}
              <View style={styles.gcSideRow}>
                <Text style={styles.gcSideLabel}>YOUR SIDE</Text>
                <TeamTag name={nextGame.my_team_name} size="md" />
              </View>
              <Text style={styles.gcName} numberOfLines={1}>
                {nextSide?.matchup ?? 'Navy vs White'}
              </Text>
              <View style={styles.gcMeta}>
                <View style={styles.chipLeague}>
                  <Text style={styles.chipLeagueText}>ACDL GAME</Text>
                </View>
                <Text style={styles.gcTime}>
                  {formatGameDate(nextGame.event_date)}
                  {nextGame.start_time ? ` · ${formatEventTime(nextGame.start_time)}` : ''}
                </Text>
              </View>
              {nextGame.location ? (
                <View style={[styles.gcMeta, { marginTop: 8 }]}>
                  <Ionicons name="location-outline" size={12} color={ACDL_MUT} />
                  <Text style={styles.gcTime}>{nextGame.location}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.gameCardWrap}>
            <View style={styles.noGameCard}>
              <Ionicons name="calendar-outline" size={18} color={ACDL_MUT} />
              <Text style={styles.noGameText}>No upcoming games</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SeasonChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.ssChip}>
      <Text style={styles.ssLab}>{label}</Text>
      <Text style={styles.ssVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: ACDL_CREAM },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 60 },
  loadingContainer: {
    flex: 1,
    backgroundColor: ACDL_CREAM,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { marginTop: 16, color: ACDL_INK_2, fontSize: 14 },
  header: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 16 },
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backText: { color: ACDL_INK_2, fontSize: 14, marginLeft: 8 },
  backTextBand: { color: ACDL_BAND_MUT, fontSize: 14, marginLeft: 8 },
  title: { fontSize: 30, fontWeight: '900', color: ACDL_INK, marginBottom: 4, letterSpacing: 0.5 },

  // Navy band hero
  band: {
    backgroundColor: ACDL_NAVY,
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomWidth: 3,
    borderBottomColor: ACDL_BLUE,
  },
  hubHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 6 },
  eyebrowBand: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: ACDL_BLUE,
    marginBottom: 4,
  },
  hhName: { fontSize: 24, fontWeight: '900', color: ACDL_BAND_TEXT, letterSpacing: -0.3 },
  hhRole: { fontSize: 12, color: ACDL_BAND_MUT, marginTop: 3 },

  seasonSelector: { paddingHorizontal: 12, paddingVertical: 10 },
  seasonChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    marginHorizontal: 4,
  },
  seasonChipActive: {
    backgroundColor: ACDL_BLUE,
    borderColor: ACDL_BLUE,
  },
  seasonChipText: { fontSize: 13, fontWeight: '700', color: ACDL_INK_2 },
  seasonChipTextActive: { color: ACDL_ON_ACCENT },

  snapCardWrap: { paddingHorizontal: 16, marginTop: 14, marginBottom: 4 },
  snapCard: {
    backgroundColor: ACDL_PAPER,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: ACDL_LINE,
  },
  snapEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: ACDL_BRAND_TEXT,
    marginBottom: 4,
  },
  snapTitle: { fontSize: 22, fontWeight: '900', color: ACDL_INK, marginBottom: 14 },

  prRow: { flexDirection: 'row', alignItems: 'stretch' },
  prCol: { flex: 1, alignItems: 'center', gap: 4 },
  prDivider: { width: 1, backgroundColor: ACDL_LINE, marginVertical: 2 },
  prLabel: { color: ACDL_MUT, fontSize: 9, fontWeight: '800', letterSpacing: 1.4, textAlign: 'center' },
  prValue: { fontSize: 32, fontWeight: '900', letterSpacing: -1, color: ACDL_INK, fontVariant: ['tabular-nums'] },
  prValueSm: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5, color: ACDL_INK, fontVariant: ['tabular-nums'] },
  prAccent: { height: 2, marginTop: 4, borderRadius: 1, width: 28 },
  prCaption: { color: ACDL_MUT, fontSize: 10, fontWeight: '600', textAlign: 'center' },

  subEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: ACDL_BRAND_TEXT,
    paddingHorizontal: 16,
    marginTop: 22,
    marginBottom: 12,
  },

  tiles: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  tile: {
    flex: 1,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 8,
  },
  tileText: { fontSize: 11, fontWeight: '800', color: ACDL_INK },

  seasonStrip: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  ssChip: {
    flex: 1,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderLeftWidth: 3,
    borderLeftColor: ACDL_BLUE,
    borderRadius: 10,
    padding: 10,
  },
  ssLab: { fontSize: 9, color: ACDL_MUT, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  ssVal: { fontSize: 16, color: ACDL_INK, fontWeight: '900', letterSpacing: -0.3, marginTop: 3, fontVariant: ['tabular-nums'] },
  ssChipFull: {
    flex: 1,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderLeftWidth: 3,
    borderLeftColor: ACDL_BLUE,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  ssNote: { fontSize: 12, color: ACDL_INK_2, fontWeight: '600' },

  gameCardWrap: { paddingHorizontal: 16 },
  gameCard: {
    backgroundColor: ACDL_PAPER,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderLeftWidth: 4,
    borderLeftColor: ACDL_BLUE,
  },
  gcSideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  gcSideLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: ACDL_MUT,
    textTransform: 'uppercase',
  },
  gcName: { fontSize: 17, fontWeight: '800', color: ACDL_INK, marginBottom: 10 },
  gcMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  gcTime: { fontSize: 12, color: ACDL_INK_2 },
  chipLeague: {
    backgroundColor: acdlBlueAlpha(0.25),
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipLeagueText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, color: ACDL_BRAND_TEXT },

  noGameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: ACDL_PAPER,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: ACDL_LINE,
  },
  noGameText: { fontSize: 14, color: ACDL_INK_2, fontWeight: '700' },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    marginHorizontal: 16,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 16,
  },
  emptyStateText: { fontSize: 16, color: ACDL_INK, marginTop: 16, fontWeight: '700' },
  emptyStateSubtext: { fontSize: 14, color: ACDL_INK_2, marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
