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
 * Check if athlete has pending waivers for booking
 */
export async function checkPendingWaivers(
  athleteId: string,
  checkType: 'booking' | 'signup' = 'booking'
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
    };
  } catch (error) {
    console.error('Error checking pending waivers:', error);
    throw error;
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
