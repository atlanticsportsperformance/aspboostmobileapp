/**
 * useAthleteId — resolves the athletes.id for the current context.
 *
 * Mirrors the inline resolution screens already do (see
 * HittingPerformanceScreen.loadAthleteAndData + the AthleteContext parent
 * flow):
 *   - A PARENT account views a child → use AthleteContext.selectedAthleteId
 *     (already an athletes.id).
 *   - An athlete account → look up the athletes row by athletes.user_id =
 *     session.user.id.
 *   - If a screen was navigated with an explicit athleteId param, that wins
 *     (pass it as `overrideId`), matching the route?.params?.athleteId pattern.
 *
 * Returns the id plus a loading flag so callers can gate fetches.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useAthlete } from '../contexts/AthleteContext';

interface UseAthleteIdResult {
  athleteId: string | null;
  loading: boolean;
}

export function useAthleteId(overrideId?: string | null): UseAthleteIdResult {
  const { user } = useAuth();
  const { isParent, selectedAthleteId, loading: athleteLoading } = useAthlete();
  const [athleteId, setAthleteId] = useState<string | null>(overrideId ?? null);
  const [loading, setLoading] = useState(!overrideId);

  useEffect(() => {
    let cancelled = false;

    // Explicit param always wins (route?.params?.athleteId convention).
    if (overrideId) {
      setAthleteId(overrideId);
      setLoading(false);
      return;
    }

    // Parent → the selected child's athletes.id (resolved by AthleteContext).
    if (isParent) {
      // Wait for the parent context to finish loading its linked athletes
      // before deciding there's no selection.
      setAthleteId(selectedAthleteId ?? null);
      setLoading(athleteLoading);
      return;
    }

    // Athlete account → look up athletes row by session user_id.
    if (!user) {
      setAthleteId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('athletes')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        setAthleteId(data?.id ?? null);
      } catch (e) {
        console.error('[useAthleteId] lookup failed:', e);
        if (!cancelled) setAthleteId(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [overrideId, isParent, selectedAthleteId, athleteLoading, user?.id]);

  return { athleteId, loading };
}
