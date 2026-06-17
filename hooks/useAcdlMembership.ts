/**
 * useAcdlMembership — the "is this athlete in the league?" gate.
 *
 * Calls acdl_athlete_seasons for the resolved athlete and exposes:
 *   - inLeague: true when the athlete has at least one rostered season
 *   - seasons: every season membership, newest first
 *   - currentSeason: the is_current season (falls back to the newest)
 *   - loading / error
 *
 * Used to conditionally surface the ACDL athlete experience (League hub tile,
 * stats, game log) everywhere — if inLeague is false, hide the league UI.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  fetchAcdlSeasons,
  LeagueSeasonMembership,
} from '../lib/acdlLeague';
import { useAthleteId } from './useAthleteId';

interface UseAcdlMembershipResult {
  inLeague: boolean;
  seasons: LeagueSeasonMembership[];
  currentSeason: LeagueSeasonMembership | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAcdlMembership(overrideAthleteId?: string | null): UseAcdlMembershipResult {
  const { athleteId, loading: idLoading } = useAthleteId(overrideAthleteId);
  const [seasons, setSeasons] = useState<LeagueSeasonMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await fetchAcdlSeasons(id);
      if (rpcError) {
        setError(rpcError.message);
        setSeasons([]);
      } else {
        setSeasons(data);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load league membership');
      setSeasons([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wait for the athlete id to resolve before deciding anything.
    if (idLoading) {
      setLoading(true);
      return;
    }
    if (!athleteId) {
      setSeasons([]);
      setLoading(false);
      return;
    }
    void load(athleteId);
  }, [athleteId, idLoading, load]);

  const refresh = useCallback(async () => {
    if (athleteId) await load(athleteId);
  }, [athleteId, load]);

  const currentSeason =
    seasons.find((s) => s.is_current) ?? (seasons.length > 0 ? seasons[0] : null);

  return {
    inLeague: seasons.length > 0,
    seasons,
    currentSeason,
    loading: loading || idLoading,
    error,
    refresh,
  };
}
