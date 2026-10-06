// ACDL league events in an athlete's normal calendar. Mirrors
// lib/league/athlete-calendar.ts on web. Reads via the SECURITY DEFINER RPC
// get_athlete_league_events (scoped to self / guardian with view rights /
// org staff; active roster in the active season). Read-only.
import type { SupabaseClient } from '@supabase/supabase-js';

/** Event types surfaced on athlete calendars. Add 'training' here to extend. */
export const LEAGUE_CALENDAR_EVENT_TYPES = ['game'];
export const LEAGUE_EVENT_COLOR = '#f59e0b';

export interface LeagueCalendarEventRow {
  id: string;
  season_name: string | null;
  event_type: string;
  title: string | null;
  start_at: string;
  end_at: string;
  location: string | null;
  status: string | null;
}

export function leagueEventLabel(e: Pick<LeagueCalendarEventRow, 'event_type' | 'title' | 'status'>): string {
  const base = e.event_type === 'game' ? 'ACDL Game' : `ACDL ${e.event_type.charAt(0).toUpperCase()}${e.event_type.slice(1)}`;
  const withTitle = e.title ? `${base}: ${e.title}` : base;
  const status = e.status && e.status !== 'scheduled' ? e.status : null;
  return status ? `${withTitle} (${status.charAt(0).toUpperCase()}${status.slice(1)})` : withTitle;
}

export async function fetchLeagueCalendarEvents(
  client: SupabaseClient,
  athleteId: string,
  from: Date,
  to: Date,
): Promise<LeagueCalendarEventRow[]> {
  const { data, error } = await client.rpc('get_athlete_league_events', {
    p_athlete_id: athleteId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_types: LEAGUE_CALENDAR_EVENT_TYPES,
  });
  if (error) {
    console.warn('league calendar events:', error.message);
    return [];
  }
  return (data as LeagueCalendarEventRow[]) || [];
}

/** Booking-shaped object for the athlete DashboardScreen calendar. */
export function leagueEventToBooking(e: LeagueCalendarEventRow) {
  return {
    id: `league-${e.id}`,
    status: 'booked',
    is_league: true,
    event: {
      id: e.id,
      start_time: e.start_at,
      end_time: e.end_at,
      title: leagueEventLabel(e),
      scheduling_templates: {
        name: leagueEventLabel(e),
        scheduling_categories: { name: 'ACDL', color: LEAGUE_EVENT_COLOR },
      },
    },
  };
}

export function leagueWindow(): { from: Date; to: Date } {
  const from = new Date();
  from.setDate(from.getDate() - 60);
  const to = new Date();
  to.setDate(to.getDate() + 240);
  return { from, to };
}
