/**
 * LeagueHubScreen — the ACDL athlete membership hub (Phase 12.2).
 *
 * Built in the app's real card/section idiom (snapshot-card, FAB-menu tile,
 * day-view game card) with the existing PURPLE league accent. Matches mockup
 * screen 4 (docs/mockups/acdl-mobile-athlete.html):
 *   - back-button stats header
 *   - team badge + name + role line
 *   - membership snapshot card (record / next / GP, cream/gold PR style)
 *   - LEAGUE · QUICK ACCESS tiles → Stats · Schedule · Game Log
 *   - season-at-a-glance chip strip (AVG/OPS · HR/RBI · wRC+ for hitters,
 *     ERA/WHIP · K · W-L for pitchers)
 *   - NEXT GAME card (next upcoming acdl_athlete_events game)
 *   - friendly empty state when the athlete isn't in the league
 *
 * Data: useAthleteId + useAcdlMembership (12.1) + fetchAcdlEvents/
 * fetchAcdlSeasonStats (12.1). Season selector when >1 rostered season.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ACDL_BLUE,
  ACDL_NAVY,
  acdlBlueAlpha,
} from '../components/league/acdlTheme';
import { useAthleteId } from '../hooks/useAthleteId';
import { useAcdlMembership } from '../hooks/useAcdlMembership';
import {
  fetchAcdlEvents,
  fetchAcdlSeasonStats,
  LeagueEvent,
  LeagueSeasonMembership,
  LeagueSeasonStats,
} from '../lib/acdlLeague';
import {
  num,
  fmt3,
  fmt,
  teamAbbrev,
  formatGameDate,
  formatEventTime,
} from '../lib/leagueFormat';

export default function LeagueHubScreen({ navigation, route }: any) {
  const overrideAthleteId: string | null = route?.params?.athleteId ?? null;
  const { athleteId } = useAthleteId(overrideAthleteId);
  const { inLeague, seasons, currentSeason, loading: membershipLoading } =
    useAcdlMembership(overrideAthleteId);

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [nextGame, setNextGame] = useState<LeagueEvent | null>(null);
  const [stats, setStats] = useState<LeagueSeasonStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Resolve the active season: explicit selection, else current/newest.
  const season: LeagueSeasonMembership | null = useMemo(() => {
    if (selectedSeasonId) {
      return seasons.find((s) => s.season_id === selectedSeasonId) ?? currentSeason;
    }
    return currentSeason;
  }, [selectedSeasonId, seasons, currentSeason]);

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
        <ActivityIndicator size="large" color={ACDL_BLUE} />
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
            <Ionicons name="arrow-back" size={20} color="#9CA3AF" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>ACDL League</Text>
        </View>
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="trophy-outline" size={48} color="#4B5563" />
          <Text style={styles.emptyStateText}>Not on a league roster</Text>
          <Text style={styles.emptyStateSubtext}>
            The ACDL hub appears here once you're assigned to a team for a season.
          </Text>
        </View>
      </View>
    );
  }

  const teamColor = season.team_color || ACDL_BLUE;
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

  // A pitcher hub strip when they've thrown; else hitter strip.
  const isPitcherView = season.games_pitched > 0 && pit != null;

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
        <View style={styles.headerCompact}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#9CA3AF" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        </View>

        {/* Team badge + name + role — real ACDL crest (white circle reads on dark) */}
        <View style={styles.hubHeader}>
          <Image
            source={require('../assets/acdl-crest.png')}
            style={styles.crest}
            resizeMode="contain"
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.hhName}>{season.team_name || 'Your Team'}</Text>
            <Text style={styles.hhRole}>{roleLine}</Text>
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

        {/* Membership snapshot card */}
        <View style={styles.snapCardWrap}>
          <View style={styles.snapCard}>
            <Text style={styles.snapEyebrow}>ATLANTIC COLLEGIATE DEVELOPMENT LEAGUE</Text>
            <Text style={styles.snapTitle}>Season Standing</Text>
            <View style={styles.prRow}>
              <View style={styles.prCol}>
                <Text style={styles.prLabel}>RECORD</Text>
                <Text style={styles.prValueSm}>
                  {season.wins}-{season.losses}
                </Text>
                <View style={[styles.prAccent, { backgroundColor: ACDL_BLUE }]} />
                <Text style={styles.prCaption}>{season.saves > 0 ? `${season.saves} SV` : 'W-L'}</Text>
              </View>
              <View style={styles.prCol}>
                <Text style={styles.prLabel}>NEXT</Text>
                <Text style={styles.prValueSm}>
                  {nextGame ? nextGameOpponent(nextGame, season.team_id) : '—'}
                </Text>
                <View style={[styles.prAccent, { backgroundColor: ACDL_BLUE }]} />
                <Text style={styles.prCaption}>
                  {nextGame ? formatGameDate(nextGame.event_date) : 'No games'}
                </Text>
              </View>
              <View style={styles.prCol}>
                <Text style={styles.prLabel}>GP</Text>
                <Text style={styles.prValue}>{season.games_played}</Text>
                <View style={[styles.prAccent, { backgroundColor: '#34D399' }]} />
                <Text style={styles.prCaption}>Season</Text>
              </View>
            </View>
          </View>
        </View>

        {/* LEAGUE · QUICK ACCESS tiles */}
        <Text style={styles.subEyebrow}>
          <Text style={styles.subEyebrowAccent}>LEAGUE</Text> · QUICK ACCESS
        </Text>
        <View style={styles.tiles}>
          <TouchableOpacity
            style={styles.tile}
            onPress={() =>
              navigation.navigate('LeagueStats', { athleteId, seasonId: season.season_id })
            }
          >
            <Ionicons name="stats-chart" size={22} color={ACDL_BLUE} />
            <Text style={styles.tileText}>Stats</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tile}
            onPress={() => navigation.navigate('LeagueSchedule', { athleteId })}
          >
            <Ionicons name="calendar" size={22} color={ACDL_BLUE} />
            <Text style={styles.tileText}>Schedule</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tile}
            onPress={() =>
              navigation.navigate('LeagueGameLog', { athleteId, seasonId: season.season_id })
            }
          >
            <Ionicons name="list" size={22} color={ACDL_BLUE} />
            <Text style={styles.tileText}>Game Log</Text>
          </TouchableOpacity>
        </View>

        {/* Season at a glance */}
        <View style={styles.seasonStrip}>
          {isPitcherView ? (
            <>
              <SeasonChip label="ERA / WHIP" value={`${fmt(num(pit?.era))} / ${fmt(num(pitAdv?.whip))}`} />
              <SeasonChip label="K" value={fmt(num(pit?.k), 0)} />
              <SeasonChip label="W-L" value={`${season.wins}-${season.losses}`} />
            </>
          ) : (
            <>
              <SeasonChip
                label="AVG / OPS"
                value={`${fmt3(num(bat?.avg))} / ${fmt3(num(batAdv?.ops))}`}
              />
              <SeasonChip label="HR / RBI" value={`${fmt(num(bat?.hr), 0)} / ${fmt(num(bat?.rbi), 0)}`} />
              <SeasonChip label="wRC+" value={fmt(num(batAdv?.wrc_plus_simple), 0)} />
            </>
          )}
        </View>

        {/* Next game card */}
        {nextGame && (
          <>
            <Text style={styles.subEyebrow}>NEXT GAME</Text>
            <View style={styles.gameCardWrap}>
              <View style={styles.gameCard}>
                <Text style={styles.gcName}>
                  {nextGame.home_team_name || 'Home'} vs {nextGame.away_team_name || 'Away'}
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
                {(nextGame.location || season.team_id) && (
                  <View style={[styles.gcMeta, { marginTop: 8 }]}>
                    {season.team_id && nextGame.home_team_id ? (
                      <Text style={styles.gcCat}>
                        {nextGame.home_team_id === season.team_id ? 'HOME' : 'AWAY'}
                      </Text>
                    ) : null}
                    {nextGame.location ? <Text style={styles.gcTime}>{nextGame.location}</Text> : null}
                  </View>
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function nextGameOpponent(ev: LeagueEvent, teamId: string | null): string {
  if (!teamId) return teamAbbrev(ev.away_team_name);
  if (ev.home_team_id === teamId) return `vs ${teamAbbrev(ev.away_team_name)}`;
  if (ev.away_team_id === teamId) return `@ ${teamAbbrev(ev.home_team_name)}`;
  return teamAbbrev(ev.away_team_name);
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
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 60 },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { marginTop: 16, color: '#9CA3AF', fontSize: 14 },
  header: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 16 },
  headerCompact: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 4 },
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backText: { color: '#9CA3AF', fontSize: 14, marginLeft: 8 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 4 },

  hubHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 8 },
  crest: {
    width: 54,
    height: 54,
    shadowColor: ACDL_BLUE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  hhName: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  hhRole: { fontSize: 12, color: '#9CA3AF', marginTop: 3 },

  seasonSelector: { paddingHorizontal: 12, paddingVertical: 8 },
  seasonChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 4,
  },
  seasonChipActive: {
    backgroundColor: acdlBlueAlpha(0.18),
    borderColor: acdlBlueAlpha(0.4),
  },
  seasonChipText: { fontSize: 13, fontWeight: '600', color: '#9CA3AF' },
  seasonChipTextActive: { color: ACDL_BLUE },

  snapCardWrap: { paddingHorizontal: 16, marginTop: 4, marginBottom: 4 },
  snapCard: {
    backgroundColor: ACDL_NAVY,
    borderRadius: 24,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.8,
    shadowRadius: 60,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: acdlBlueAlpha(0.18),
  },
  snapEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    color: ACDL_BLUE,
    marginBottom: 4,
  },
  snapTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 14 },

  prRow: { flexDirection: 'row', gap: 14 },
  prCol: { flex: 1, alignItems: 'center', gap: 4 },
  prLabel: { color: '#6B7280', fontSize: 9, fontWeight: '800', letterSpacing: 1.4, textAlign: 'center' },
  prValue: { fontSize: 32, fontWeight: '800', letterSpacing: -1, color: '#FFFFFF' },
  prValueSm: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: '#FFFFFF' },
  prAccent: { height: 2, marginTop: 4, borderRadius: 1, opacity: 0.7, alignSelf: 'stretch' },
  prCaption: { color: '#6B7280', fontSize: 10, fontWeight: '600', textAlign: 'center' },

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

  tiles: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  tile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 8,
  },
  tileText: { fontSize: 11, fontWeight: '700', color: '#E5E7EB' },

  seasonStrip: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  ssChip: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderLeftWidth: 3,
    borderLeftColor: ACDL_BLUE,
    borderRadius: 12,
    padding: 10,
  },
  ssLab: { fontSize: 9, color: '#6B7280', fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  ssVal: { fontSize: 16, color: '#FFFFFF', fontWeight: '800', letterSpacing: -0.3, marginTop: 3 },

  gameCardWrap: { paddingHorizontal: 16 },
  gameCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: ACDL_BLUE,
  },
  gcName: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  gcMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  gcCat: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  gcTime: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  chipLeague: {
    backgroundColor: acdlBlueAlpha(0.18),
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipLeagueText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, color: ACDL_BLUE },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    marginHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 24,
  },
  emptyStateText: { fontSize: 16, color: '#9CA3AF', marginTop: 16, fontWeight: '600' },
  emptyStateSubtext: { fontSize: 14, color: '#6B7280', marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
