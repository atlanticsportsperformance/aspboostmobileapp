/**
 * acdlLeague.ts — typed wrappers around the ACDL athlete-scoped SECURITY
 * DEFINER RPCs (migration 20260614180000_acdl_athlete_rpcs.sql).
 *
 * The league_ tables are staff-only RLS, so an athlete (or their guardian)
 * can only read league data through these gated RPCs. Each wrapper here is a
 * thin `supabase.rpc(...)` call that returns `{ data, error }`, mirroring the
 * shape supabase-js already returns — the screens consume them with the same
 * plain-async + useState pattern the rest of the app uses (see
 * HittingPerformanceScreen.tsx).
 *
 * Types are taken VERBATIM from the RPC return shapes / jsonb keys. The
 * jsonb-returning RPCs (season_stats, game_detail) come back as a single
 * object/value, not a row set, so those wrappers normalize accordingly.
 */
import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────────────────
// Row / object types — column names match the migration exactly.
// ─────────────────────────────────────────────────────────────────────────

/**
 * One row of acdl_athlete_seasons — the athlete's membership in a season.
 *
 * ACDL has NO fixed teams (Navy vs White, reshuffled weekly), so there is NO
 * season-level team. The "record" is the athlete's PERSONAL record: games the
 * athlete's SIDE won/lost across published finals (personal_wins/losses), plus
 * their pitcher decisions (pitcher_wins/losses/saves).
 */
export interface LeagueSeasonMembership {
  season_id: string;
  season_name: string;
  year: number;
  is_current: boolean;
  jersey_number: number | null;
  positions: string[] | null;
  status: string | null;
  /** Games the athlete appeared in this season. */
  games_played: number;
  /** Games the athlete's SIDE won / lost (personal record, not a team standing). */
  personal_wins: number;
  personal_losses: number;
  /** Pitcher decisions for the athlete this season. */
  pitcher_wins: number;
  pitcher_losses: number;
  saves: number;
}

/** One row of acdl_athlete_events — calendar / schedule entry. */
export interface LeagueEvent {
  event_id: string;
  season_id: string;
  type: string; // 'game' | 'practice' | ... (free text in the schema)
  title: string | null;
  event_date: string; // 'YYYY-MM-DD'
  start_time: string | null; // 'HH:MM:SS'
  end_time: string | null;
  location: string | null;
  game_id: string | null;
  status: string | null; // league_games.status
  publish_status: string | null; // 'draft' | 'live' | 'final'
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  /** The athlete's SIDE (Navy/White) for THIS game — changes each game; null
   * when not yet assigned a side. */
  my_team_id: string | null;
  my_team_name: string | null;
  /** Only populated when publish_status in ('live','final'). */
  line_score: LineScore | null;
}

/**
 * line_score cache shape maintained by the scorer. Loosely typed because the
 * scorer owns the canonical shape; we read the common fields defensively.
 */
export interface LineScore {
  home?: { runs?: number; hits?: number; errors?: number; by_inning?: number[] } | null;
  away?: { runs?: number; hits?: number; errors?: number; by_inning?: number[] } | null;
  [key: string]: unknown;
}

/**
 * acdl_athlete_season_stats — one JSON for an athlete + season. Each sub-view
 * is null when the athlete didn't bat / pitch / have a record that season.
 * The view rows are typed loosely (Record) — they are wide stat views and the
 * exact column set is owned by the SQL views; screens pick the fields they
 * need. Helper accessors below cover the most-used numbers.
 */
export interface LeagueSeasonStats {
  batting: {
    season: LeagueStatRow | null;
    advanced: LeagueStatRow | null;
    metrics: LeagueStatRow | null;
  };
  pitching: {
    season: LeagueStatRow | null;
    advanced: LeagueStatRow | null;
    metrics: LeagueStatRow | null;
  };
  record: LeagueStatRow | null;
}

/** A row from one of the league_* stat views (wide, schema-owned). */
export type LeagueStatRow = Record<string, number | string | boolean | null>;

/** One row of acdl_athlete_game_log. */
export interface LeagueGameLogRow {
  game_id: string;
  event_date: string; // 'YYYY-MM-DD'
  home_team_name: string | null;
  away_team_name: string | null;
  /** The athlete's SIDE (Navy/White) for THIS game; null when unassigned. */
  my_team_name: string | null;
  /** W/L/T for the athlete's SIDE in this game (null when not final/unknown). */
  side_result: 'W' | 'L' | 'T' | null;
  status: string | null;
  publish_status: string | null;
  /** 'W' | 'L' | 'SV' | null (pitching decision for this athlete). */
  decision: 'W' | 'L' | 'SV' | null;
  /** league_batting_lines row as JSON, or null if the athlete didn't bat. */
  batting: LeagueStatRow | null;
  /** league_pitching_lines row as JSON, or null if the athlete didn't pitch. */
  pitching: LeagueStatRow | null;
  /** Present on live/final games for a score chip. */
  line_score?: LineScore | null;
}

/**
 * One pitch from acdl_athlete_game_detail. The hitting array carries a SUBSET
 * (no spin axis / release / extension); the pitching array carries the full
 * set. Both share this interface with the extra fields optional.
 */
export interface Pitch {
  pitch_id: string;
  /** Present on pitching-side pitches (which PA the pitch belongs to). */
  pa_id?: string;
  /** Present on pitching-side pitches. */
  inning?: number;
  half?: string;
  seq_in_pa: number;
  balls_before: number | null;
  strikes_before: number | null;
  official_call: string | null;
  /** Present on pitching-side pitches: the PA's eventual result. */
  pa_result?: string | null;
  batter_id?: string | null;
  batter_name?: string | null;
  tm_pitch_type: string | null;
  tm_rel_speed_mph: number | null;
  tm_spin_rate_rpm: number | null;
  tm_spin_axis_deg?: number | null;
  tm_ivb_in: number | null;
  tm_hb_in: number | null;
  tm_rel_height_ft?: number | null;
  tm_rel_side_ft?: number | null;
  tm_extension_ft?: number | null;
  tm_plate_height_ft: number | null;
  tm_plate_side_ft: number | null;
}

/** The in-play batted ball attached to a plate appearance. */
export interface BattedBall {
  spray_x: number | null;
  spray_y: number | null;
  hit_type: string | null;
  tm_exit_velo_mph: number | null;
  tm_launch_angle_deg: number | null;
  tm_bearing_deg: number | null;
  tm_distance_ft: number | null;
}

/** One of the athlete's plate appearances in a game (hitting side). */
export interface PlateAppearance {
  pa_id: string;
  seq: number;
  inning: number;
  half: string;
  result: string | null;
  rbi: number | null;
  pitches: Pitch[];
  batted_ball: BattedBall | null;
}

/** acdl_athlete_game_detail — one JSON for an athlete + one game. */
export interface LeagueGameDetail {
  hitting: PlateAppearance[];
  pitching: Pitch[];
}

// ─────────────────────────────────────────────────────────────────────────
// RPC wrappers — each returns supabase-js's { data, error } shape.
// ─────────────────────────────────────────────────────────────────────────

type RpcResult<T> = { data: T; error: { message: string } | null };

/**
 * The athlete's display name ("First Last"). Used by the league Hub header —
 * ACDL has no season team, so the header shows the ATHLETE, not "Your Team".
 * Returns null on any error / missing row (callers fall back gracefully).
 */
export async function fetchAthleteName(
  athleteId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('athletes')
    .select('first_name, last_name')
    .eq('id', athleteId)
    .maybeSingle();
  if (error || !data) return null;
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
  return name || null;
}

/** Every season the athlete is / was rostered in, newest first. */
export async function fetchAcdlSeasons(
  athleteId: string
): Promise<RpcResult<LeagueSeasonMembership[]>> {
  const { data, error } = await supabase.rpc('acdl_athlete_seasons', {
    p_athlete_id: athleteId,
  });
  return { data: (data ?? []) as LeagueSeasonMembership[], error };
}

/**
 * League events for the athlete's rostered seasons (calendar + schedule).
 * Optionally date-bounded (inclusive) with ISO 'YYYY-MM-DD' strings.
 */
export async function fetchAcdlEvents(
  athleteId: string,
  from?: string | null,
  to?: string | null
): Promise<RpcResult<LeagueEvent[]>> {
  const { data, error } = await supabase.rpc('acdl_athlete_events', {
    p_athlete_id: athleteId,
    p_from: from ?? null,
    p_to: to ?? null,
  });
  return { data: (data ?? []) as LeagueEvent[], error };
}

/**
 * One JSON of batting / pitching / record for an athlete + season. Returns
 * null data when the athlete has nothing (or isn't authorized) for the season.
 */
export async function fetchAcdlSeasonStats(
  athleteId: string,
  seasonId: string
): Promise<RpcResult<LeagueSeasonStats | null>> {
  const { data, error } = await supabase.rpc('acdl_athlete_season_stats', {
    p_athlete_id: athleteId,
    p_season_id: seasonId,
  });
  return { data: (data ?? null) as LeagueSeasonStats | null, error };
}

/** Per-game log rows for an athlete + season, newest first. */
export async function fetchAcdlGameLog(
  athleteId: string,
  seasonId: string
): Promise<RpcResult<LeagueGameLogRow[]>> {
  const { data, error } = await supabase.rpc('acdl_athlete_game_log', {
    p_athlete_id: athleteId,
    p_season_id: seasonId,
  });
  return { data: (data ?? []) as LeagueGameLogRow[], error };
}

/**
 * One JSON for an athlete + one game: the athlete's PAs (pitch-by-pitch +
 * batted ball) and every pitch they threw. Returns an empty detail when the
 * RPC yields null (unauthorized / no data) so callers never deref null.
 */
export async function fetchAcdlGameDetail(
  athleteId: string,
  gameId: string
): Promise<RpcResult<LeagueGameDetail>> {
  const { data, error } = await supabase.rpc('acdl_athlete_game_detail', {
    p_athlete_id: athleteId,
    p_game_id: gameId,
  });
  const detail = (data ?? { hitting: [], pitching: [] }) as LeagueGameDetail;
  return {
    data: {
      hitting: detail.hitting ?? [],
      pitching: detail.pitching ?? [],
    },
    error,
  };
}
