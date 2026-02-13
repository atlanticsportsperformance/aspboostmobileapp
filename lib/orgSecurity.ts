import { supabase } from './supabase';

/**
 * Centralized org security helpers
 *
 * These functions provide standardized ways to fetch and validate org_id
 * for different account types. Use these helpers to ensure all queries
 * properly filter by organization.
 *
 * SECURITY NOTE: Resources queries currently DON'T filter by org_id.
 * When fixing those queries, use these helpers to get the org_id first.
 */

/**
 * Get the org_id for a user from their profile
 * Used primarily for parent accounts
 *
 * @param userId - The user's ID from Supabase auth
 * @returns The org_id or null if not found
 *
 * @example
 * const orgId = await getOrgIdForUser(session.user.id);
 * if (!orgId) {
 *   console.error('User has no org');
 *   return;
 * }
 */
export async function getOrgIdForUser(userId: string): Promise<string | null> {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('[orgSecurity] Error fetching user org_id:', error);
      return null;
    }

    return profile?.org_id || null;
  } catch (error) {
    console.error('[orgSecurity] Exception getting user org_id:', error);
    return null;
  }
}

/**
 * Get the org_id for an athlete
 * Used for athlete accounts and when parents need athlete's org
 *
 * @param athleteId - The athlete's ID
 * @returns The org_id or null if not found
 *
 * @example
 * const orgId = await getOrgIdForAthlete(athleteId);
 * if (!orgId) {
 *   console.error('Athlete has no org');
 *   return [];
 * }
 *
 * // Then use in query:
 * const { data } = await supabase
 *   .from('resources')
 *   .select('*')
 *   .eq('org_id', orgId)
 *   .eq('athlete_id', athleteId);
 */
export async function getOrgIdForAthlete(athleteId: string): Promise<string | null> {
  try {
    const { data: athlete, error } = await supabase
      .from('athletes')
      .select('org_id')
      .eq('id', athleteId)
      .single();

    if (error) {
      console.error('[orgSecurity] Error fetching athlete org_id:', error);
      return null;
    }

    return athlete?.org_id || null;
  } catch (error) {
    console.error('[orgSecurity] Exception getting athlete org_id:', error);
    return null;
  }
}

/**
 * Verify that a resource belongs to the specified org
 * Useful for double-checking before displaying sensitive data
 *
 * @param resourceId - The resource ID to verify
 * @param expectedOrgId - The org_id the resource should belong to
 * @returns True if resource belongs to org, false otherwise
 *
 * @example
 * const isValid = await verifyResourceBelongsToOrg(resourceId, userOrgId);
 * if (!isValid) {
 *   console.error('Unauthorized access attempt');
 *   return;
 * }
 */
export async function verifyResourceBelongsToOrg(
  resourceId: string,
  expectedOrgId: string
): Promise<boolean> {
  try {
    const { data: resource, error } = await supabase
      .from('resources')
      .select('org_id')
      .eq('id', resourceId)
      .single();

    if (error || !resource) {
      console.error('[orgSecurity] Error verifying resource org:', error);
      return false;
    }

    return resource.org_id === expectedOrgId;
  } catch (error) {
    console.error('[orgSecurity] Exception verifying resource org:', error);
    return false;
  }
}

/**
 * Get current user's org_id based on their account type
 * Checks if they're an athlete first, falls back to profile
 *
 * This is a smart helper that works for any account type:
 * - Athlete accounts: Gets org_id from athletes table
 * - Parent accounts: Gets org_id from profiles table
 * - Staff accounts: Gets org_id from profiles table
 *
 * @param userId - The user's ID from Supabase auth
 * @returns The org_id or null if not found
 *
 * @example
 * const { session } = await supabase.auth.getSession();
 * const orgId = await getCurrentUserOrgId(session.user.id);
 *
 * // Then use in queries:
 * const { data } = await supabase
 *   .from('conversations')
 *   .select('*')
 *   .eq('org_id', orgId);
 */
export async function getCurrentUserOrgId(userId: string): Promise<string | null> {
  // First try to get from athletes table (if they're an athlete)
  const { data: athlete } = await supabase
    .from('athletes')
    .select('org_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (athlete?.org_id) {
    return athlete.org_id;
  }

  // Fall back to profile (for parents and other account types)
  return getOrgIdForUser(userId);
}

/**
 * Verify that an athlete belongs to the specified org
 * Useful when a parent or staff member is trying to access athlete data
 *
 * @param athleteId - The athlete ID to verify
 * @param expectedOrgId - The org_id the athlete should belong to
 * @returns True if athlete belongs to org, false otherwise
 *
 * @example
 * const userOrgId = await getCurrentUserOrgId(session.user.id);
 * const canAccess = await verifyAthleteBelongsToOrg(athleteId, userOrgId);
 * if (!canAccess) {
 *   console.error('Cannot access athlete from different org');
 *   return;
 * }
 */
export async function verifyAthleteBelongsToOrg(
  athleteId: string,
  expectedOrgId: string
): Promise<boolean> {
  const athleteOrgId = await getOrgIdForAthlete(athleteId);
  return athleteOrgId === expectedOrgId;
}
