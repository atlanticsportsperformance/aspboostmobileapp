import {
  LIFECYCLE_CACHE_TTL_MS,
  getCachedLifecycle,
  setCachedLifecycle,
  invalidateCachedLifecycle,
  invalidateCachedLifecycleByPrefix,
  clearLifecycleCache,
} from '../lib/lifecycleCache';

const T0 = 1_800_000_000_000; // a fixed, arbitrary epoch ms

describe('lifecycleCache', () => {
  beforeEach(() => {
    clearLifecycleCache();
  });

  it('expires after five minutes', () => {
    expect(LIFECYCLE_CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });

  it('misses on an unknown key', () => {
    expect(getCachedLifecycle<string>('nobody', T0)).toEqual({ hit: false, value: undefined });
  });

  it('hits inside the TTL', () => {
    setCachedLifecycle('user-1', 'member', T0);
    expect(getCachedLifecycle<string>('user-1', T0 + 1)).toEqual({ hit: true, value: 'member' });
    expect(getCachedLifecycle<string>('user-1', T0 + LIFECYCLE_CACHE_TTL_MS - 1)).toEqual({
      hit: true,
      value: 'member',
    });
  });

  it('misses once the TTL has elapsed', () => {
    setCachedLifecycle('user-1', 'member', T0);
    expect(getCachedLifecycle<string>('user-1', T0 + LIFECYCLE_CACHE_TTL_MS)).toEqual({
      hit: false,
      value: undefined,
    });
  });

  it('caches null as a real value, not as a miss', () => {
    // An athlete row with client_lifecycle NULL is a legitimate answer; if it
    // read as a miss, every FAB screen would refetch on every mount.
    setCachedLifecycle<string | null>('user-1', null, T0);
    expect(getCachedLifecycle<string | null>('user-1', T0 + 1)).toEqual({ hit: true, value: null });
  });

  it('keeps entries independent, so one expiry does not evict another', () => {
    setCachedLifecycle('user-1', 'member', T0);
    setCachedLifecycle('user-2', 'assessment_scheduled', T0 + LIFECYCLE_CACHE_TTL_MS / 2);

    const later = T0 + LIFECYCLE_CACHE_TTL_MS + 1;
    expect(getCachedLifecycle<string>('user-1', later).hit).toBe(false);
    expect(getCachedLifecycle<string>('user-2', later)).toEqual({
      hit: true,
      value: 'assessment_scheduled',
    });
  });

  it('invalidates a single key without touching the others', () => {
    setCachedLifecycle('user-1', 'member', T0);
    setCachedLifecycle('user-2', 'member', T0);
    invalidateCachedLifecycle('user-1');
    expect(getCachedLifecycle<string>('user-1', T0 + 1).hit).toBe(false);
    expect(getCachedLifecycle<string>('user-2', T0 + 1).hit).toBe(true);
  });

  it('clears everything', () => {
    setCachedLifecycle('user-1', 'member', T0);
    setCachedLifecycle('user-2', 'member', T0);
    clearLifecycleCache();
    expect(getCachedLifecycle<string>('user-1', T0 + 1).hit).toBe(false);
    expect(getCachedLifecycle<string>('user-2', T0 + 1).hit).toBe(false);
  });

  it('invalidates every key under a prefix, leaving other keys untouched', () => {
    // Mirrors invalidateAthleteLifecycle: a user-id key and an athlete:*
    // key must both be dropped by one promotion event, so a promotion
    // reaches screens that look the athlete up by athlete id (e.g. the
    // pitching screens) as well as ones keyed by the signed-in user's id.
    setCachedLifecycle('user-1', 'member', T0);
    setCachedLifecycle('athlete:a1', 'member', T0);
    setCachedLifecycle('athlete:a2', 'assessment_scheduled', T0);
    invalidateCachedLifecycleByPrefix('athlete:');
    invalidateCachedLifecycle('user-1');
    expect(getCachedLifecycle<string>('user-1', T0 + 1).hit).toBe(false);
    expect(getCachedLifecycle<string>('athlete:a1', T0 + 1).hit).toBe(false);
    expect(getCachedLifecycle<string>('athlete:a2', T0 + 1).hit).toBe(false);
  });
});

describe('useAthleteLifecycle wiring', () => {
  // A source-level guard: the hook itself cannot be imported here, because it
  // pulls contexts/AuthContext -> react-native's AppState, which this
  // ts-jest/node runner cannot parse.
  const { readFileSync } = require('fs');
  const { join } = require('path');
  const source: string = readFileSync(
    join(__dirname, '..', 'lib', 'useAthleteLifecycle.ts'),
    'utf8'
  );

  it('uses the TTL cache module rather than a bare Map', () => {
    expect(source).toContain("from './lifecycleCache'");
    expect(source).toContain('getCachedLifecycle');
    expect(source).toContain('setCachedLifecycle');
    expect(source).not.toContain('const cache = new Map');
  });

  it('exports invalidateAthleteLifecycle', () => {
    expect(source).toContain('export function invalidateAthleteLifecycle');
  });

  it('keeps clearAthleteLifecycleCache for the sign-out flow', () => {
    expect(source).toContain('export function clearAthleteLifecycleCache');
  });

  it('invalidateAthleteLifecycle also clears the athlete: key space', () => {
    expect(source).toContain('invalidateCachedLifecycleByPrefix');
    expect(source).toContain("invalidateCachedLifecycleByPrefix('athlete:')");
  });
});
