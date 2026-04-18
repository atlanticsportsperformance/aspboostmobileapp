// Waiver System Types

export interface PendingWaiver {
  id: string;
  name: string;
  description: string | null;
  content: string; // HTML content
  version: number;
  signatureType: 'checkbox' | 'typed_name' | 'drawn' | 'any';
  requiresGuardianSignature: boolean;
  minorAgeThreshold: number | null;
}

export interface WaiverDetails {
  id: string;
  name: string;
  description: string | null;
  content: string;
  version: number;
  signatureType: 'checkbox' | 'typed_name' | 'drawn' | 'any';
}

export interface SignedWaiver {
  id: string;
  waiverId: string;
  waiverVersion: number;
  signatureType: 'checkbox' | 'typed_name' | 'drawn';
  signatureData: SignatureData;
  signedAt: Date;
  signedByRelationship: string | null;
  waiver: WaiverDetails;
  needsResigning?: boolean; // true if signed version < current version
}

export type SignatureData =
  | { agreed: boolean } // For checkbox
  | { typed_name: string; legal_name_confirmed: true } // For typed_name (API requires the confirmation flag)
  | { image_data: string }; // For drawn (base64 PNG)

export interface WaiverCheckResponse {
  has_pending_waivers: boolean;
  pending_waivers: PendingWaiver[];
  athlete_is_minor: boolean;
}

export interface GuardianInfo {
  first_name: string;
  last_name: string;
  email: string;
  relationship: 'parent' | 'guardian';
}

export interface AthleteWaiversResponse {
  signed_waivers: SignedWaiver[];
  pending_waivers: PendingWaiver[];
}

export interface SignWaiverRequest {
  waiver_id: string;
  athlete_id: string;
  signature_type: 'checkbox' | 'typed_name' | 'drawn';
  signature_data: SignatureData;
  /** Set when a parent/guardian is signing on-site on behalf of a minor
   * athlete. Server-side the route promotes relationship from self →
   * parent/guardian when this is present. */
  guardian_info?: GuardianInfo;
}

export interface SignWaiverResponse {
  success: boolean;
  signature_id?: string;
  error?: string;
}
