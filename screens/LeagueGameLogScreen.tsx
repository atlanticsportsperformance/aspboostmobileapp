/**
 * LeagueGameLogScreen — reverse-chron per-game log (Phase 12.3). Matches
 * mockup screen 7: session-card rows (3px accent, win/loss color, 4 stat
 * columns). Each row → date · matchup · result chip + side · the line.
 * Hitter rows show AB/HR/RBI/Max-EV; pitcher outing rows swap in IP/H/ER/K.
 *
 * Tap a row → LeagueGameDetail with { gameId, athleteId, role } (role chooses
 * hitter vs pitcher view on the detail screen).
 *
 * Data: acdl_athlete_game_log (12.1). Reuses HittingPerformanceScreen's
 * session-card styles; league accent = green/red win-loss + cyan stat.
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
import { num, fmtInt, ipFromOuts, formatShortDate } from '../lib/leagueFormat';
import { ACDL_BLUE } from '../components/league/acdlTheme';

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
        <ActivityIndicator size="large" color={ACDL_BLUE} />
        <Text style={styles.loadingText}>Loading game log...</Text>
      </View>
    );
  }

  const positions = (season?.positions || []).join('/');
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACDL_BLUE} />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#9CA3AF" />
            <Text style={styles.backText}>League Hub</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Game Log</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {rows.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="clipboard-text-outline" size={44} color="#4B5563" />
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
                teamId={season?.team_id ?? null}
                onPress={() =>
                  navigation.navigate('LeagueGameDetail', {
                    gameId: row.game_id,
                    athleteId,
                    // If they pitched, open pitcher view; else hitter view.
                    role: row.pitching ? 'pitcher' : 'hitter',
                    matchupLabel: matchupLabel(row, season?.team_id ?? null),
                    dateLabel: formatShortDate(row.event_date),
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

function matchupLabel(row: LeagueGameLogRow, teamId: string | null): string {
  const home = row.home_team_name || 'Home';
  const away = row.away_team_name || 'Away';
  return `${home} vs ${away}`;
}

function GameRow({
  row,
  teamId,
  onPress,
}: {
  row: LeagueGameLogRow;
  teamId: string | null;
  onPress: () => void;
}) {
  const isPitcherFirst = !!row.pitching; // pitched in this game → show outing line

  // Result chip from line_score (home/away runs) + the athlete's decision.
  const result = computeResult(row, teamId);
  const accentColor = result.kind === 'W' ? '#22C55E' : result.kind === 'L' ? '#EF4444' : '#22D3EE';

  return (
    <TouchableOpacity style={styles.sessCard} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.sessAccent, { backgroundColor: accentColor }]} />
      <View style={styles.sessBody}>
        <View style={styles.sessHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sessDate}>
              {formatShortDate(row.event_date)} · {matchupLabel(row, teamId)}
            </Text>
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
              <Text style={styles.sessSource}>{result.side}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.2)" />
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
  return (
    <>
      <Stat value={`${h}-${ab}`} label="AB" accent />
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
 * Resolve a W/L/T chip from the published line_score for the athlete's team,
 * plus the home/away side. Falls back to the decision when no team context.
 */
function computeResult(
  row: LeagueGameLogRow,
  teamId: string | null
): { kind: 'W' | 'L' | 'T' | 'NA'; label: string; side: string } {
  // home_team_id / away_team_id are not on the log row; we only know names.
  // Use the line_score where available for the score string; side stays blank
  // unless the detail provides it. Keep it honest: show the decision if any.
  const ls = (row as any).line_score as
    | { home?: { runs?: number }; away?: { runs?: number } }
    | null
    | undefined;
  let kind: 'W' | 'L' | 'T' | 'NA' = 'NA';
  let label = '';

  const homeR = ls?.home?.runs;
  const awayR = ls?.away?.runs;
  if (typeof homeR === 'number' && typeof awayR === 'number') {
    label = `${homeR}–${awayR}`;
  }

  // Decision (W/L/SV for the pitcher of record) takes priority for the chip kind.
  if (row.decision === 'W') kind = 'W';
  else if (row.decision === 'L') kind = 'L';

  const labelOut =
    row.decision === 'SV'
      ? `SV ${label}`.trim()
      : kind === 'W'
      ? `W ${label}`.trim()
      : kind === 'L'
      ? `L ${label}`.trim()
      : label || (row.publish_status === 'final' ? 'FINAL' : '');

  return { kind, label: labelOut, side: '' };
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

  sessList: { paddingHorizontal: 16, gap: 10 },
  sessCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  sessAccent: { width: 3 },
  sessBody: { flex: 1, padding: 14 },
  sessHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sessDate: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginBottom: 5 },
  sessSourceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessSource: { fontSize: 9, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5 },

  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipWin: { backgroundColor: 'rgba(34,197,94,0.2)' },
  chipLoss: { backgroundColor: 'rgba(239,68,68,0.2)' },
  chipNeutral: { backgroundColor: 'rgba(155,221,255,0.12)' },
  chipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  chipTextWin: { color: '#86EFAC' },
  chipTextLoss: { color: '#fca5a5' },
  chipTextNeutral: { color: '#9BDDFF' },

  sessStats: { flexDirection: 'row' },
  sessStat: { flex: 1, alignItems: 'center' },
  sessStatValue: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  sessStatValueAccent: { color: '#9BDDFF' },
  sessStatLabel: {
    fontSize: 8,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },

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
