/**
 * LeagueGameLogScreen — reverse-chron per-game log.
 *
 * Cream day-card rows (3px accent, win/loss color, 4 stat columns). Each row →
 * date · the athlete's SIDE badge (Navy/White) + matchup · result chip · line.
 * Hitter rows show AB/HR/RBI/BB; pitcher outing rows swap in IP/H/ER/K.
 *
 * ACDL has NO fixed teams — the result is the athlete's SIDE result for THAT
 * game (side_result, W/L/T), NOT a team standing. Matchup is "Navy vs White".
 *
 * Styled to match the ACDL website (cream/navy/sky-blue). Tap a row →
 * LeagueGameDetail with { gameId, athleteId, role }.
 *
 * Data: acdl_athlete_game_log.
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
import { useAthleteId } from '../hooks/useAthleteId';
import { useAcdlMembership } from '../hooks/useAcdlMembership';
import { fetchAcdlGameLog, LeagueGameLogRow } from '../lib/acdlLeague';
import {
  num,
  fmtInt,
  ipFromOuts,
  formatShortDate,
  gameSide,
  formatLineScore,
  lineScoreSide,
} from '../lib/leagueFormat';
import {
  ACDL_CREAM,
  ACDL_PAPER,
  ACDL_NAVY,
  ACDL_INK,
  ACDL_INK_2,
  ACDL_MUT,
  ACDL_BLUE,
  ACDL_BRAND_TEXT,
  ACDL_LINE,
  ACDL_BAND_TEXT,
  ACDL_BAND_MUT,
  ACDL_WIN,
  ACDL_LOSS,
} from '../components/league/acdlTheme';
import { AcdlCrest } from '../components/league/AcdlCrest';
import TeamTag from '../components/league/TeamTag';

export default function LeagueGameLogScreen({ navigation, route }: any) {
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

  const [rows, setRows] = useState<LeagueGameLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (id: string, sid: string) => {
    const { data } = await fetchAcdlGameLog(id, sid);
    setRows(data || []);
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
        <Text style={styles.loadingText}>Loading game log...</Text>
      </View>
    );
  }

  const subtitle = [
    season ? `#${season.jersey_number ?? '—'}` : null,
    season?.season_name,
    `${rows.length} ${rows.length === 1 ? 'game' : 'games'}`,
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
        <View style={styles.band}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color={ACDL_BAND_MUT} />
            <Text style={styles.backText}>League Hub</Text>
          </TouchableOpacity>
          <View style={styles.headerRow}>
            <AcdlCrest size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>GAME LOG</Text>
              <Text style={styles.title}>Game Log</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
          </View>
        </View>

        {rows.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="clipboard-text-outline" size={44} color={ACDL_MUT} />
            <Text style={styles.emptyStateText}>No games logged yet</Text>
            <Text style={styles.emptyStateSubtext}>
              Games appear here once they're scored and published.
            </Text>
          </View>
        ) : (
          <View style={styles.sessList}>
            {rows.map((row) => (
              <GameRow
                key={row.game_id}
                row={row}
                onPress={() =>
                  navigation.navigate('LeagueGameDetail', {
                    gameId: row.game_id,
                    athleteId,
                    // If they pitched, open pitcher view; else hitter view.
                    role: row.pitching ? 'pitcher' : 'hitter',
                    matchupLabel: gameSide(row).matchup,
                    dateLabel: formatShortDate(row.event_date),
                    // Thread the outing length so GameDetail's footer can show
                    // the true "X.X IP" instead of deriving it from the stream.
                    ipOuts: num(row.pitching?.ip_outs) ?? undefined,
                  })
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function GameRow({ row, onPress }: { row: LeagueGameLogRow; onPress: () => void }) {
  const isPitcherFirst = !!row.pitching; // pitched in this game → show outing line
  const side = gameSide(row);

  // Result chip from the athlete's SIDE result + the line score.
  const result = computeResult(row);
  const accentColor =
    result.kind === 'W' ? ACDL_WIN : result.kind === 'L' ? ACDL_LOSS : ACDL_BLUE;

  return (
    <TouchableOpacity style={styles.sessCard} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.sessAccent, { backgroundColor: accentColor }]} />
      <View style={styles.sessBody}>
        <View style={styles.sessHead}>
          <View style={{ flex: 1 }}>
            <View style={styles.sessMatchRow}>
              <View style={styles.sessSideWrap}>
                <Text style={styles.sessSideLabel}>SIDE</Text>
                <TeamTag name={row.my_team_name} size="sm" />
              </View>
              <Text style={styles.sessDate} numberOfLines={1}>
                {formatShortDate(row.event_date)} · {side.matchup}
              </Text>
            </View>
            <View style={styles.sessSourceRow}>
              {result.label ? (
                <View
                  style={[
                    styles.chip,
                    result.kind === 'W'
                      ? styles.chipWin
                      : result.kind === 'L'
                      ? styles.chipLoss
                      : styles.chipNeutral,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      result.kind === 'W'
                        ? styles.chipTextWin
                        : result.kind === 'L'
                        ? styles.chipTextLoss
                        : styles.chipTextNeutral,
                    ]}
                  >
                    {result.label}
                  </Text>
                </View>
              ) : null}
              {result.decision ? (
                <Text style={styles.sessDecision}>{result.decision}</Text>
              ) : null}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={ACDL_MUT} />
        </View>

        <View style={styles.sessStats}>
          {isPitcherFirst ? <PitcherStats row={row} /> : <HitterStats row={row} />}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function HitterStats({ row }: { row: LeagueGameLogRow }) {
  const b = row.batting;
  const h = num(b?.h) ?? 0;
  const ab = num(b?.ab) ?? 0;
  // No PA logged (0-for-0) → em-dash rather than a misleading "0-0".
  const hitLine = ab === 0 && h === 0 ? '—' : `${h}-${ab}`;
  return (
    <>
      <Stat value={hitLine} label="AB" accent />
      <Stat value={fmtInt(num(b?.hr))} label="HR" />
      <Stat value={fmtInt(num(b?.rbi))} label="RBI" />
      <Stat value={fmtInt(num(b?.bb))} label="BB" />
    </>
  );
}

function PitcherStats({ row }: { row: LeagueGameLogRow }) {
  const p = row.pitching;
  return (
    <>
      <Stat value={ipFromOuts(num(p?.ip_outs))} label="IP" accent />
      <Stat value={fmtInt(num(p?.h))} label="H" />
      <Stat value={fmtInt(num(p?.earned_runs))} label="ER" />
      <Stat value={fmtInt(num(p?.k))} label="K" />
    </>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <View style={styles.sessStat}>
      <Text style={[styles.sessStatValue, accent && styles.sessStatValueAccent]}>{value}</Text>
      <Text style={styles.sessStatLabel}>{label}</Text>
    </View>
  );
}

/**
 * Resolve a W/L/T chip from the athlete's SIDE result for THIS game
 * (side_result), with the score string from line_score (side-aware: the
 * athlete's side first to match the matchup title), plus the pitcher decision
 * (W/L/SV) shown alongside.
 */
function computeResult(
  row: LeagueGameLogRow
): { kind: 'W' | 'L' | 'T' | 'NA'; label: string; decision: string } {
  // Side-aware score order matches the matchup title (athlete's side first).
  const scoreStr = formatLineScore(row.line_score, { side: lineScoreSide(row) }) ?? '';

  let kind: 'W' | 'L' | 'T' | 'NA' = 'NA';
  if (row.side_result === 'W') kind = 'W';
  else if (row.side_result === 'L') kind = 'L';
  else if (row.side_result === 'T') kind = 'T';

  const prefix =
    kind === 'W' ? 'W' : kind === 'L' ? 'L' : kind === 'T' ? 'T' : '';
  const label =
    prefix && scoreStr
      ? `${prefix} ${scoreStr}`
      : prefix || scoreStr || (row.publish_status === 'final' ? 'FINAL' : '');

  const decision =
    row.decision === 'W'
      ? 'WIN (P)'
      : row.decision === 'L'
      ? 'LOSS (P)'
      : row.decision === 'SV'
      ? 'SAVE'
      : '';

  return { kind, label, decision };
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

  sessList: { paddingHorizontal: 16, gap: 10, paddingTop: 14 },
  sessCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: ACDL_PAPER,
  },
  sessAccent: { width: 4 },
  sessBody: { flex: 1, padding: 14 },
  sessHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sessMatchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  sessSideWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sessSideLabel: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: ACDL_MUT,
    textTransform: 'uppercase',
  },
  sessDate: { flex: 1, fontSize: 15, fontWeight: '800', color: ACDL_INK },
  sessSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessDecision: { fontSize: 9, color: ACDL_MUT, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '700' },

  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipWin: { backgroundColor: 'rgba(46,125,82,0.16)' },
  chipLoss: { backgroundColor: 'rgba(180,69,58,0.16)' },
  chipNeutral: { backgroundColor: 'rgba(155,221,255,0.28)' },
  chipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, fontVariant: ['tabular-nums'] },
  chipTextWin: { color: ACDL_WIN },
  chipTextLoss: { color: ACDL_LOSS },
  chipTextNeutral: { color: ACDL_BRAND_TEXT },

  sessStats: { flexDirection: 'row' },
  sessStat: { flex: 1, alignItems: 'center' },
  sessStatValue: { fontSize: 17, fontWeight: '900', color: ACDL_INK, fontVariant: ['tabular-nums'] },
  sessStatValueAccent: { color: ACDL_BRAND_TEXT },
  sessStatLabel: {
    fontSize: 8,
    color: ACDL_MUT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
    fontWeight: '700',
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    marginHorizontal: 16,
    marginTop: 24,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderRadius: 16,
  },
  emptyStateText: { fontSize: 16, color: ACDL_INK, marginTop: 16, fontWeight: '700' },
  emptyStateSubtext: { fontSize: 14, color: ACDL_INK_2, marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
