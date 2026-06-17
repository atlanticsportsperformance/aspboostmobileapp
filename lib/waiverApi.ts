// Waiver API functions
import { supabase } from './supabase';
import {
  PendingWaiver,
  SignedWaiver,
  WaiverCheckResponse,
  AthleteWaiversResponse,
  SignWaiverRequest,
  SignWaiverResponse,
  SignatureData,
} from '../types/waiver';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

/**
 * Get auth headers for API requests
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  };
}

/**
 * Check if athlete has pending waivers.
 *
 * check_type widens the server-side filter:
 *   - 'booking' / 'signup' → facility waivers required at that gate
 *   - 'league'             → active league-category waivers still unsigned
 *                            (or signed on an older version) for a
 *                            league-rostered athlete. Used by the ACDL
 *                            catch-up gate.
 *   - 'all'                → every pending required waiver (facility + league)
 *
 * The server returns the same shape for all check types; league waivers are
 * surfaced with a non-null `category` so the app can distinguish them.
 */
export async function checkPendingWaivers(
  athleteId: string,
  checkType: 'booking' | 'signup' | 'league' | 'all' = 'booking'
): Promise<WaiverCheckResponse> {
  try {
    const headers = await getAuthHeaders();
    const url = `${API_URL}/api/waivers/check?athlete_id=${athleteId}&check_type=${checkType}`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to check waivers');
    }

    const data = await response.json();

    // Transform snake_case to camelCase
    return {
      has_pending_waivers: data.has_pending_waivers,
      pending_waivers: (data.pending_waivers || []).map(transformPendingWaiver),
      athlete_is_minor: !!data.athlete_is_minor,
    };
  } catch (error) {
    console.error('Error checking pending waivers:', error);
    throw error;
  }
}

/**
 * League catch-up gate helper — returns only the ACDL league-category
 * waivers a rostered athlete still needs to sign (unsigned or stale version).
 *
 * Defensive on two fronts:
 *   1. Asks the server for league pending items via check_type='league'.
 *   2. Filters the result to league_* categories so that even if the backend
 *      widening also returns facility items we only gate the league entry on
 *      league waivers (facility waivers keep their own booking/signup gates).
 *
 * Never throws — a transient failure returns an empty list so the ACDL hub
 * still opens (the server-side /api/waivers/sign + facility gates remain the
 * authoritative backstops).
 */
export async function checkPendingLeagueWaivers(
  athleteId: string
): Promise<{ pending: PendingWaiver[]; athleteIsMinor: boolean }> {
  try {
    const res = await checkPendingWaivers(athleteId, 'league');
    const pending = (res.pending_waivers || []).filter(
      (w) => w.category != null && w.category.startsWith('league_')
    );
    return { pending, athleteIsMinor: res.athlete_is_minor };
  } catch (error) {
    console.error('Error checking pending league waivers:', error);
    return { pending: [], athleteIsMinor: false };
  }
}

/**
 * Get all waivers for an athlete (signed and pending)
 */
export async function getAthleteWaivers(
  athleteId: string
): Promise<AthleteWaiversResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(
      `${API_URL}/api/athletes/${athleteId}/waivers`,
      { headers }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get waivers');
    }

    const data = await response.json();

    return {
      signed_waivers: (data.signed_waivers || []).map(transformSignedWaiver),
      pending_waivers: (data.pending_waivers || []).map(transformPendingWaiver),
    };
  } catch (error) {
    console.error('Error getting athlete waivers:', error);
    throw error;
  }
}

/**
 * Sign a waiver
 */
export async function signWaiver(
  request: SignWaiverRequest
): Promise<SignWaiverResponse> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_URL}/api/waivers/sign`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        waiver_id: request.waiver_id,
        athlete_id: request.athlete_id,
        signature_type: request.signature_type,
        signature_data: request.signature_data,
        ...(request.guardian_info ? { guardian_info: request.guardian_info } : {}),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to sign waiver',
      };
    }

    return {
      success: true,
      signature_id: data.signature_id,
    };
  } catch (error) {
    console.error('Error signing waiver:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to sign waiver',
    };
  }
}

/**
 * Transform API pending waiver to our type
 */
function transformPendingWaiver(waiver: any): PendingWaiver {
  return {
    id: waiver.id,
    name: waiver.name,
    description: waiver.description || null,
    content: waiver.content || '',
    version: waiver.version || 1,
    signatureType: waiver.signature_type || 'checkbox',
    requiresGuardianSignature: waiver.requires_guardian_signature || false,
    minorAgeThreshold: waiver.minor_age_threshold || null,
    // NULL for facility waivers; backend stamps category for league waivers.
    category: waiver.category ?? null,
  };
}

/**
 * Transform API signed waiver to our type
 */
function transformSignedWaiver(waiver: any): SignedWaiver {
  return {
    id: waiver.id,
    waiverId: waiver.waiver_id,
    waiverVersion: waiver.waiver_version || waiver.version_signed || 1,
    signatureType: waiver.signature_type,
    signatureData: waiver.signature_data || {},
    signedAt: new Date(waiver.signed_at || waiver.created_at),
    signedByRelationship: waiver.signed_by_relationship || null,
    waiver: {
      id: waiver.waiver?.id || waiver.waiver_id,
      name: waiver.waiver?.name || waiver.name || 'Waiver',
      description: waiver.waiver?.description || null,
      content: waiver.waiver?.content || '',
      version: waiver.waiver?.version || 1,
      signatureType: waiver.waiver?.signature_type || 'checkbox',
    },
    needsResigning: waiver.needs_resigning ||
      (waiver.waiver?.version && waiver.waiver_version < waiver.waiver.version),
  };
}

/**
 * Format signature type for display
 */
export function formatSignatureType(type: string): string {
  switch (type) {
    case 'checkbox':
      return 'Checkbox Agreement';
    case 'typed_name':
      return 'Typed Signature';
    case 'drawn':
      return 'Hand-drawn Signature';
    default:
      return 'Signature';
  }
}

/**
 * Format date for display
 */
export function formatWaiverDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
