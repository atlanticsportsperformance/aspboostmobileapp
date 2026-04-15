/**
 * useAthleteLifecycle — fetches the current athlete's client_lifecycle value
 * from the DB, cached module-wide so every FAB screen shares a single fetch.
 *
 * client_lifecycle enum values (from `DATABASEFULLSCHEME.MD`):
 *   - assessment_scheduled
 *   - assessment_completed
 *   - member                 ← the one that gates membership-only UI
 *   - cancelled_membership
 *
 * `isMember` is true only when the value is exactly 'member'. Returned as
 * `false` while loading so membership-gated UI doesn't flash in during the
 * first render. The cache is keyed on the supabase user id so a sign-out →
 * sign-in-as-different-user invalidates cleanly.
 */

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../contexts/AuthContext';

export type ClientLifecycle =
  | 'assessment_scheduled'
  | 'assessment_completed'
  | 'member'
  | 'cancelled_membership'
  | null;

// Module-level cache keyed by auth user id. A single in-flight promise per
// user prevents concurrent FAB mounts from firing N parallel fetches.
const cache = new Map<string, ClientLifecycle>();
const inflight = new Map<string, Promise<ClientLifecycle>>();

function fetchLifecycle(userId: string): Promise<ClientLifecycle> {
  const existing = inflight.get(userId);
  if (existing) return existing;

  const p = (async (): Promise<ClientLifecycle> => {
    try {
      const { data, error } = await supabase
        .from('athletes')
        .select('client_lifecycle')
        .eq('user_id', userId)
        .maybeSingle();
      if (error || !data) return null;
      const lc = (data.client_lifecycle ?? null) as ClientLifecycle;
      cache.set(userId, lc);
      return lc;
    } catch {
      return null;
    } finally {
      inflight.delete(userId);
    }
  })();

  inflight.set(userId, p);
  return p;
}

export function useAthleteLifecycle(): {
  lifecycle: ClientLifecycle;
  isMember: boolean;
  loading: boolean;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [lifecycle, setLifecycle] = useState<ClientLifecycle>(() =>
    userId ? cache.get(userId) ?? null : null,
  );
  const [loading, setLoading] = useState<boolean>(() =>
    userId ? !cache.has(userId) : false,
  );

  useEffect(() => {
    if (!userId) {
      setLifecycle(null);
      setLoading(false);
      return;
    }
    if (cache.has(userId)) {
      setLifecycle(cache.get(userId) ?? null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchLifecycle(userId)
      .then((lc) => {
        if (cancelled) return;
        setLifecycle(lc);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return {
    lifecycle,
    isMember: lifecycle === 'member',
    loading,
  };
}

/** Clears the cache — call from sign-out flow so the next user starts fresh. */
export function clearAthleteLifecycleCache() {
  cache.clear();
  inflight.clear();
}
