/**
 * TTL cache behind useAthleteLifecycle.
 *
 * Deliberately in its own module with ZERO react-native imports, so it can be
 * unit tested under this repo's plain ts-jest/node runner. `useAthleteLifecycle`
 * itself cannot be imported in a test: it pulls `../contexts/AuthContext`,
 * which imports `AppState` from react-native, which the runner cannot parse.
 *
 * Why a TTL at all. Before Project 1 the server demoted paying members to
 * `assessment_scheduled` whenever they booked a retest, and this cache had no
 * expiry — populated once per app launch and cleared only by
 * `clearAthleteLifecycleCache()` on sign-out, so a demotion or a promotion
 * needed an app restart to show up. Project 1's server guard stops the
 * demotion, which leaves the PROMOTION case: an athlete buys a membership
 * in-app and the Workload HubCard, the dashboard Workload section and the
 * Pitching FAB entry should appear without killing the app. Five minutes is
 * short enough for that and long enough that N FAB screens mounting at once
 * still share one fetch.
 *
 * Every function takes an injectable `now` so the behaviour is testable
 * without waiting five real minutes.
 *
 * Entries are independent, keyed by an arbitrary string. Project 4 adds a
 * second key space to this same cache (lookups by `athletes.id` rather than
 * `athletes.user_id`); it rebases onto this file and changes only the key.
 */

export const LIFECYCLE_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const entries = new Map<string, CacheEntry>();

export function getCachedLifecycle<T>(
  key: string,
  now: number = Date.now()
): { hit: boolean; value: T | undefined } {
  const entry = entries.get(key);
  if (!entry) return { hit: false, value: undefined };
  if (now >= entry.expiresAt) {
    entries.delete(key);
    return { hit: false, value: undefined };
  }
  return { hit: true, value: entry.value as T };
}

export function setCachedLifecycle<T>(
  key: string,
  value: T,
  now: number = Date.now()
): void {
  entries.set(key, { value, expiresAt: now + LIFECYCLE_CACHE_TTL_MS });
}

/** Drop one entry — call after an in-app membership purchase. */
export function invalidateCachedLifecycle(key: string): void {
  entries.delete(key);
}

/**
 * Drop every entry whose key starts with `prefix`. Used to clear the
 * `athlete:<id>` key space alongside a user-id key on the same invalidation,
 * so a promotion reaches screens that look the athlete up by athlete id
 * (e.g. the pitching screens) as well as ones keyed by user id.
 */
export function invalidateCachedLifecycleByPrefix(prefix: string): void {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

/** Drop everything — call on sign-out so the next user starts fresh. */
export function clearLifecycleCache(): void {
  entries.clear();
}
