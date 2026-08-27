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
 *
 * The cache now carries a 5-minute TTL (see ./lifecycleCache). Project 1's
 * server-side guard stops the app demoting a paying member, which leaves the
 * promotion case: an athlete buys a membership in-app and the Workload card
 * should appear without an app restart. Call `invalidateAthleteLifecycle(userId)`
 * after a successful in-app membership purchase to make that immediate.
 */

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  getCachedLifecycle,
  setCachedLifecycle,
  invalidateCachedLifecycle,
  invalidateCachedLifecycleByPrefix,
  clearLifecycleCache,
} from './lifecycleCache';

export type ClientLifecycle =
  | 'assessment_scheduled'
  | 'assessment_completed'
  | 'member'
  | 'cancelled_membership'
  | null;

// A single in-flight promise per cache key prevents concurrent FAB mounts
// from firing N parallel fetches. Values land in the TTL cache in
// ./lifecycleCache.
const inflight = new Map<string, Promise<ClientLifecycle>>();

function fetchLifecycle(cacheKey: string, userId: string, athleteId: string | null): Promise<ClientLifecycle> {
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const p = (async (): Promise<ClientLifecycle> => {
    try {
      const query = athleteId
        ? supabase.from('athletes').select('client_lifecycle').eq('id', athleteId).maybeSingle()
        : supabase.from('athletes').select('client_lifecycle').eq('user_id', userId).maybeSingle();
      const { data, error } = await query;
      if (error || !data) return null;
      const lc = (data.client_lifecycle ?? null) as ClientLifecycle;
      setCachedLifecycle<ClientLifecycle>(cacheKey, lc);
      return lc;
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, p);
  return p;
}

export function useAthleteLifecycle(athleteId?: string | null): {
  lifecycle: ClientLifecycle;
  isMember: boolean;
  loading: boolean;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const resolvedAthleteId = athleteId ?? null;
  const cacheKey = athleteId ? `athlete:${athleteId}` : userId;

  const [lifecycle, setLifecycle] = useState<ClientLifecycle>(() =>
    cacheKey ? getCachedLifecycle<ClientLifecycle>(cacheKey).value ?? null : null,
  );
  const [loading, setLoading] = useState<boolean>(() =>
    cacheKey ? !getCachedLifecycle<ClientLifecycle>(cacheKey).hit : false,
  );

  useEffect(() => {
    if (!cacheKey || (!resolvedAthleteId && !userId)) {
      setLifecycle(null);
      setLoading(false);
      return;
    }
    const cached = getCachedLifecycle<ClientLifecycle>(cacheKey);
    if (cached.hit) {
      setLifecycle(cached.value ?? null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchLifecycle(cacheKey, userId as string, resolvedAthleteId)
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
  }, [cacheKey, userId, resolvedAthleteId]);

  return {
    lifecycle,
    isMember: lifecycle === 'member',
    loading,
  };
}

/**
 * Drops the cached lifecycle so the next mount refetches immediately.
 * Call with the signed-in user's id after a successful in-app membership
 * purchase; call with no argument to drop every entry.
 *
 * Also clears every `athlete:*` entry: a promotion must reach screens that
 * look the athlete up by athlete id (e.g. the pitching screens), not just
 * the one keyed by the signed-in user's own id.
 */
export function invalidateAthleteLifecycle(userId?: string) {
  invalidateCachedLifecycleByPrefix('athlete:');
  for (const key of inflight.keys()) {
    if (key.startsWith('athlete:')) inflight.delete(key);
  }
  if (userId) {
    invalidateCachedLifecycle(userId);
    inflight.delete(userId);
    return;
  }
  clearLifecycleCache();
  inflight.clear();
}

/** Clears the cache — call from sign-out flow so the next user starts fresh. */
export function clearAthleteLifecycleCache() {
  clearLifecycleCache();
  inflight.clear();
}
