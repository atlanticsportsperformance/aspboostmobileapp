/**
 * LeagueScheduleScreen — the full ACDL season schedule (Phase 12.4).
 *
 * Lists EVERY league_events row for the athlete's rostered seasons (games,
 * practices, training days, assessments, other), grouped by date and split
 * into "Upcoming" vs "Past" relative to today. A segmented type filter
 * (ALL · GAMES · PRACTICES · TRAINING · OTHER) narrows the list. Each event is
 * a day-card in the app idiom: a color-coded type chip, title, date + time
 * range, location; games also show the matchup and a LIVE badge / final score
 * when published. Tapping a game opens LeagueGameDetail (hitter view); other
 * event types are inert.
 *
 * Data: useAthleteId + fetchAcdlEvents(athleteId, null, null) — fail-silent,
 * additive. ACDL brand throughout (navy panels, sky-blue accent, real crest).
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
import { useAthleteId } from '../hooks/useAthleteId';
import { fetchAcdlEvents, LeagueEvent } from '../lib/acdlLeague';
import { formatGameDate, formatEventTime } from '../lib/leagueFormat';
import {
  ACDL_BLUE,
  ACDL_NAVY,
  ACDL_ON_ACCENT,
  acdlBlueAlpha,
} from '../components/league/acdlTheme';

// Segmented filter → which league_events.type values it admits.
type FilterKey = 'all' | 'games' | 'practices' | 'training' | 'other';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'games', label: 'GAMES' },
  { key: 'practices', label: 'PRACTICES' },
  { key: 'training', label: 'TRAINING' },
  { key: 'other', label: 'OTHER' },
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

// Per-type chip color + label. game=ACDL blue, practice=green, training=amber,
// assessment/other=muted.
function typeMeta(type: string): { color: string; label: string } {
  switch (type) {
    case 'game':
      return { color: ACDL_BLUE, label: 'GAME' };
    case 'practice':
      return { color: '#34D399', label: 'PRACTICE' };
    case 'training_day':
      return { color: '#F59E0B', label: 'TRAINING' };
    case 'assessment':
      return { color: '#9CA3AF', label: 'ASSESSMENT' };
    case 'other':
      return { color: '#9CA3AF', label: 'OTHER' };
    default:
      return { color: '#9CA3AF', label: (type || 'EVENT').toUpperCase() };
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
        <ActivityIndicator size="large" color={ACDL_BLUE} />
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACDL_BLUE} />
        }
      >
        {/* Header — back + crest + title */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={20} color="#9CA3AF" />
            <Text style={styles.backText}>League Hub</Text>
          </TouchableOpacity>
          <View style={styles.headerRow}>
            <Image
              source={require('../assets/acdl-crest.png')}
              style={styles.crest}
              resizeMode="contain"
            />
            <View style={{ flex: 1 }}>
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
            <MaterialCommunityIcons name="calendar-blank-outline" size={44} color="#4B5563" />
            <Text style={styles.emptyStateText}>
              {filter === 'all' ? 'No events scheduled yet' : 'No matching events'}
            </Text>
            <Text style={styles.emptyStateSubtext}>
              {filter === 'all'
                ? "Your team's games, practices, and training days will appear here."
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
                            role: 'hitter',
                            matchupLabel: `${ev.home_team_name || 'Home'} vs ${
                              ev.away_team_name || 'Away'
                            }`,
                            dateLabel: formatGameDate(ev.event_date),
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
  const meta = typeMeta(ev.type);
  const accent = meta.color;
  const isGame = ev.type === 'game';
  const home = ev.home_team_name || 'Home';
  const away = ev.away_team_name || 'Away';
  const title = isGame ? `${away} @ ${home}` : ev.title || meta.label;

  const start = formatEventTime(ev.start_time);
  const end = formatEventTime(ev.end_time);
  const timeStr = start ? `${start}${end ? ` – ${end}` : ''}` : 'Time TBD';

  const isLive = isGame && ev.publish_status === 'live';
  const isFinal = isGame && ev.publish_status === 'final';
  const homeRuns = ev.line_score?.home?.runs;
  const awayRuns = ev.line_score?.away?.runs;
  const hasScore =
    (isLive || isFinal) && typeof homeRuns === 'number' && typeof awayRuns === 'number';

  const tappable = isGame && !!ev.game_id;

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: accent }]}
      onPress={tappable ? onPress : undefined}
      activeOpacity={tappable ? 0.7 : 1}
      disabled={!tappable}
    >
      <View style={styles.cardTopRow}>
        <View style={[styles.typeChip, { backgroundColor: `${accent}26` }]}>
          <Text style={[styles.typeChipText, { color: accent }]}>{meta.label}</Text>
        </View>
        {isLive ? (
          <View style={styles.liveBadge}>
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : hasScore ? (
          <View style={[styles.scoreBadge, { backgroundColor: acdlBlueAlpha(0.18) }]}>
            <Text style={styles.scoreText}>{`${awayRuns}–${homeRuns}`}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.cardMeta}>{timeStr}</Text>
      {ev.location ? (
        <View style={styles.cardLocRow}>
          <Ionicons name="location-outline" size={12} color="#6B7280" />
          <Text style={styles.cardLoc} numberOfLines={1}>
            {ev.location}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
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

  header: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 },
  backButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  backText: { color: '#9CA3AF', fontSize: 14, marginLeft: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  crest: { width: 48, height: 48 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 2 },
  subtitle: { fontSize: 12, color: '#9CA3AF' },

  filterRow: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 2,
  },
  filterChipActive: {
    backgroundColor: ACDL_BLUE,
    borderColor: ACDL_BLUE,
  },
  filterChipText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: '#9CA3AF' },
  filterChipTextActive: { color: ACDL_ON_ACCENT },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: ACDL_BLUE,
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 4,
  },
  dateGroup: { paddingHorizontal: 16, marginTop: 10 },
  dateLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E5E7EB',
    marginBottom: 8,
  },

  card: {
    backgroundColor: ACDL_NAVY,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderLeftWidth: 4,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  typeChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeChipText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  cardMeta: { fontSize: 12, color: '#9CA3AF' },
  cardLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  cardLoc: { fontSize: 12, color: '#6B7280', flex: 1 },

  liveBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderRadius: 6,
  },
  liveText: { fontSize: 10, fontWeight: '800', color: '#f87171', letterSpacing: 0.5 },
  scoreBadge: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  scoreText: { fontSize: 12, fontWeight: '800', color: ACDL_BLUE },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
    marginHorizontal: 16,
    marginTop: 24,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 24,
  },
  emptyStateText: { fontSize: 16, color: '#9CA3AF', marginTop: 16, fontWeight: '600' },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
});
