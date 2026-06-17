/**
 * LeagueScheduleScreen — the full ACDL season schedule.
 *
 * Lists EVERY league_events row for the athlete's rostered seasons (games,
 * practices, training days, assessments, other), grouped by date and split
 * into "Upcoming" vs "Past" relative to today. A segmented type filter
 * (ALL · GAMES · PRACTICES · TRAINING · OTHER) narrows the list. Each event is
 * a cream day-card; games show the athlete's SIDE for that game (Navy/White) +
 * the matchup ("Navy vs White"), a LIVE badge / final score when published.
 *
 * Styled to match the ACDL website (aspwebsite app/acdl/acdl.css): cream/navy/
 * sky-blue, real crest PNG. ACDL has NO fixed teams — never "Away @ Home".
 *
 * Data: useAthleteId + fetchAcdlEvents(athleteId, null, null) — fail-silent.
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
import { fetchAcdlEvents, LeagueEvent } from '../lib/acdlLeague';
import {
  formatGameDate,
  formatEventTime,
  gameSide,
  formatLineScore,
  lineScoreSide,
  eventTypeMeta,
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
  ACDL_ON_ACCENT,
  ACDL_LINE,
  ACDL_BAND_TEXT,
  ACDL_BAND_MUT,
  ACDL_LIVE_BG,
  ACDL_LIVE_TEXT,
  ACDL_LIVE_DOT,
  acdlBlueAlpha,
} from '../components/league/acdlTheme';
import { AcdlCrest } from '../components/league/AcdlCrest';
import TeamTag from '../components/league/TeamTag';

// Segmented filter → which league_events.type values it admits.
type FilterKey = 'all' | 'games' | 'practices' | 'training' | 'other';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'games', label: 'GAMES' },
  { key: 'practices', label: 'PRACTICES' },
  { key: 'training', label: 'TRAINING' },
  // Real "other" rows are assessments → surface that, not a generic "OTHER".
  { key: 'other', label: 'ASSESS' },
];

function matchesFilter(type: string, filter: FilterKey): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'games':
      return type === 'game';
    case 'practices':
      return type === 'practice';
    case 'training':
      return type === 'training_day';
    case 'other':
      return type === 'assessment' || type === 'other';
    default:
      return true;
  }
}

/** Today's local date as 'YYYY-MM-DD' (matches the RPC's date-only strings). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

interface DateGroup {
  date: string;
  events: LeagueEvent[];
}

interface Section {
  key: 'upcoming' | 'past';
  title: string;
  groups: DateGroup[];
}

export default function LeagueScheduleScreen({ navigation, route }: any) {
  const overrideAthleteId: string | null = route?.params?.athleteId ?? null;
  const { athleteId } = useAthleteId(overrideAthleteId);

  const [events, setEvents] = useState<LeagueEvent[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (id: string) => {
    // Full season: no date bounds.
    const { data, error } = await fetchAcdlEvents(id, null, null);
    if (error) return;
    setEvents(data ?? []);
  }, []);

  useEffect(() => {
    if (!athleteId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load(athleteId);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, load]);

  const onRefresh = async () => {
    if (!athleteId) return;
    setRefreshing(true);
    await load(athleteId);
    setRefreshing(false);
  };

  // Filter → sort chronologically → split upcoming/past → group by date.
  const sections: Section[] = useMemo(() => {
    const today = todayIso();
    const filtered = events
      .filter((e) => matchesFilter(e.type, filter))
      .filter((e) => !!e.event_date);

    const upcoming = filtered
      .filter((e) => e.event_date >= today)
      .sort((a, b) => a.event_date.localeCompare(b.event_date));
    const past = filtered
      .filter((e) => e.event_date < today)
      .sort((a, b) => b.event_date.localeCompare(a.event_date)); // most-recent first

    const groupBy = (list: LeagueEvent[]): DateGroup[] => {
      const map = new Map<string, LeagueEvent[]>();
      for (const e of list) {
        const g = map.get(e.event_date);
        if (g) g.push(e);
        else map.set(e.event_date, [e]);
      }
      return Array.from(map.entries()).map(([date, evs]) => ({ date, events: evs }));
    };

    const out: Section[] = [];
    if (upcoming.length > 0)
      out.push({ key: 'upcoming', title: 'UPCOMING', groups: groupBy(upcoming) });
    if (past.length > 0) out.push({ key: 'past', title: 'PAST', groups: groupBy(past) });
    return out;
  }, [events, filter]);

  const isEmpty = sections.length === 0;

  // ── Loading ──
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={ACDL_BRAND_TEXT} />
        <Text style={styles.loadingText}>Loading schedule...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACDL_BRAND_TEXT} />
        }
      >
        {/* Navy band header — back + crest + title */}
        <View style={styles.band}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color={ACDL_BAND_MUT} />
            <Text style={styles.backText}>League Hub</Text>
          </TouchableOpacity>
          <View style={styles.headerRow}>
            <AcdlCrest size={44} />
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>SCHEDULE</Text>
              <Text style={styles.title}>Schedule</Text>
              <Text style={styles.subtitle}>Atlantic Collegiate Development League</Text>
            </View>
          </View>
        </View>

        {/* Segmented type filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Empty state (per filter) */}
        {isEmpty ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="calendar-blank-outline" size={44} color={ACDL_MUT} />
            <Text style={styles.emptyStateText}>
              {filter === 'all' ? 'No events scheduled yet' : 'No matching events'}
            </Text>
            <Text style={styles.emptyStateSubtext}>
              {filter === 'all'
                ? 'Games, practices, and training days will appear here.'
                : 'Try a different filter to see other event types.'}
            </Text>
          </View>
        ) : (
          sections.map((section) => (
            <View key={section.key}>
              <Text style={styles.sectionHeader}>{section.title}</Text>
              {section.groups.map((group) => (
                <View key={group.date} style={styles.dateGroup}>
                  <Text style={styles.dateLabel}>{formatGameDate(group.date)}</Text>
                  {group.events.map((ev, idx) => (
                    <EventCard
                      key={ev.event_id || `${group.date}-${idx}`}
                      ev={ev}
                      onPress={() => {
                        if (ev.type === 'game' && ev.game_id) {
                          navigation.navigate('LeagueGameDetail', {
                            gameId: ev.game_id,
                            athleteId,
                            // Omit role → GameDetail defaults to whichever of
                            // hitting/pitching has data.
                            matchupLabel: gameSide(ev).matchup,
                            dateLabel: formatGameDate(ev.event_date),
                            status: ev.status ?? undefined,
                          });
                        }
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function EventCard({ ev, onPress }: { ev: LeagueEvent; onPress: () => void }) {
  const meta = eventTypeMeta(ev.type);
  const accent = meta.color;
  const isGame = ev.type === 'game';
  const side = gameSide(ev);
  const title = isGame ? side.matchup : ev.title || meta.label;

  const start = formatEventTime(ev.start_time);
  const end = formatEventTime(ev.end_time);
  const timeStr = start ? `${start}${end ? ` – ${end}` : ''}` : 'Time TBD';

  // LIVE keys off the GAME status (not publish_status, which gates the website).
  const isLive = isGame && ev.status === 'live';
  // Show the score whenever a line score exists (side-aware order to match title).
  const scoreStr = isGame
    ? formatLineScore(ev.line_score, { side: lineScoreSide(ev) })
    : null;
  const hasScore = !isLive && !!scoreStr;

  const tappable = isGame && !!ev.game_id;

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: accent }]}
      onPress={tappable ? onPress : undefined}
      activeOpacity={tappable ? 0.7 : 1}
      disabled={!tappable}
    >
      <View style={styles.cardTopRow}>
        <View style={styles.chipRow}>
          <View style={[styles.typeChip, { backgroundColor: `${accent}1f` }]}>
            <Text style={[styles.typeChipText, { color: accent }]}>{meta.label}</Text>
          </View>
          {isGame && (
            <View style={styles.sideTagWrap}>
              <Text style={styles.sideTagLabel}>SIDE</Text>
              <TeamTag name={ev.my_team_name} size="sm" />
            </View>
          )}
        </View>
        {isLive ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : hasScore ? (
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreText}>{scoreStr}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.cardMeta}>{timeStr}</Text>
      {ev.location ? (
        <View style={styles.cardLocRow}>
          <Ionicons name="location-outline" size={12} color={ACDL_MUT} />
          <Text style={styles.cardLoc} numberOfLines={1}>
            {ev.location}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
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
  subtitle: { fontSize: 12, color: ACDL_BAND_MUT },

  filterRow: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: ACDL_PAPER,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    marginHorizontal: 2,
  },
  filterChipActive: {
    backgroundColor: ACDL_BLUE,
    borderColor: ACDL_BLUE,
  },
  filterChipText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: ACDL_INK_2 },
  filterChipTextActive: { color: ACDL_ON_ACCENT },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: ACDL_BRAND_TEXT,
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 4,
  },
  dateGroup: { paddingHorizontal: 16, marginTop: 10 },
  dateLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: ACDL_INK,
    marginBottom: 8,
  },

  card: {
    backgroundColor: ACDL_PAPER,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: ACDL_LINE,
    borderLeftWidth: 4,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  sideTagWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sideTagLabel: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: ACDL_MUT,
    textTransform: 'uppercase',
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: ACDL_INK, marginBottom: 4 },
  cardMeta: { fontSize: 12, color: ACDL_INK_2 },
  cardLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardLoc: { fontSize: 12, color: ACDL_MUT, flex: 1 },

  // Website LIVE idiom: navy pill, cream text, small green pulse dot (not red).
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: ACDL_LIVE_BG,
    borderRadius: 6,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ACDL_LIVE_DOT },
  liveText: { fontSize: 10, fontWeight: '900', color: ACDL_LIVE_TEXT, letterSpacing: 0.5 },
  scoreBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: acdlBlueAlpha(0.25),
  },
  scoreText: { fontSize: 12, fontWeight: '900', color: ACDL_BRAND_TEXT, fontVariant: ['tabular-nums'] },

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
  emptyStateSubtext: {
    fontSize: 14,
    color: ACDL_INK_2,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
});
