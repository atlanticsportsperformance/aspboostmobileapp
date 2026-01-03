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
  | { typed_name: string } // For typed_name
  | { image_data: string }; // For drawn (base64 PNG)

export interface WaiverCheckResponse {
  has_pending_waivers: boolean;
  pending_waivers: PendingWaiver[];
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
}

export interface SignWaiverResponse {
  success: boolean;
  signature_id?: string;
  error?: string;
}
