/**
 * Mocap API client — fetches sessions, pitch details, percentile cohort data, and C3D binaries.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MocapPitch {
  id: string
  pitch_number: number
  pitch_type: string
  velocity_mph: number | null
  bat_speed_mph: number | null
  exit_velo_mph: number | null
  r2_video_key: string | null
  r2_c3d_key: string | null
  r2_uploaded_at: string | null
  is_session_highlight: boolean
}

export interface MocapSession {
  id: string
  session_date: string
  started_at: string
  ended_at: string | null
  category: string
  athlete_throws: string
  mocap_pitches: MocapPitch
}

export interface MocapPitchDetail {
  pitch: {
    id: string
    pitchType: string
    velocity: number | null
    pitchNumber: number
    scalarMetrics: Record<string, number>
  }
  videoUrl: string | null
  c3dUrl: string | null
}

export interface PercentileCohortResponse {
  cohort: { category: string; velocityMin: number }
  sampleSize: number
  metrics: Record<string, number>[]
}

// ─── API Functions ───────────────────────────────────────────────────────────

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }
}

/**
 * Fetch all mocap sessions for an athlete.
 */
export async function fetchMocapSessions(
  athleteId: string,
  token: string
): Promise<MocapSession[]> {
  const res = await fetch(`${API_URL}/api/athletes/${athleteId}/mocap`, {
    headers: authHeaders(token),
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch mocap sessions: ${res.status}`)
  }
  const json = await res.json()
  return json.sessions || []
}

/**
 * Fetch pitch detail with signed URLs for video and C3D.
 */
export async function fetchPitchDetail(
  athleteId: string,
  pitchId: string,
  token: string
): Promise<MocapPitchDetail> {
  const res = await fetch(`${API_URL}/api/athletes/${athleteId}/mocap/${pitchId}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch pitch detail: ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch percentile cohort data for computing athlete rankings.
 */
export async function fetchPercentileCohort(
  velocityMin: number,
  token: string
): Promise<PercentileCohortResponse> {
  const res = await fetch(`${API_URL}/api/mocap/percentiles?velocity_min=${velocityMin}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch percentile cohort: ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch C3D binary file from a signed URL and return as ArrayBuffer.
 */
export async function fetchC3DBinary(signedUrl: string): Promise<ArrayBuffer> {
  const res = await fetch(signedUrl)
  if (!res.ok) {
    throw new Error(`Failed to fetch C3D file: ${res.status}`)
  }
  return res.arrayBuffer()
}
