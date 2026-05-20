import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

export interface CoachBookingAthlete { id: string; first_name: string; last_name: string; email: string; }
export interface CoachBooking {
  id: string; status: string; source_type: string;
  athletes: CoachBookingAthlete;
}
export interface CoachSession {
  id: string; startTime: string; endTime: string; status: string;
  capacity: number; currentBookings: number; notes: string | null;
  template: { id: string; name: string; scheduling_categories: { id: string; name: string; color: string } | null } | null;
  location: { id: string; name: string } | null;
  bookings: CoachBooking[];
  allBookings: CoachBooking[];
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildSessionsUrl(base: string, date: Date, tzOffset: number, categoryId?: string): string {
  let url = `${base}/api/schedule/sessions?date=${isoDate(date)}&tz_offset=${tzOffset}&my_sessions=true`;
  if (categoryId) url += `&category_id=${categoryId}`;
  return url;
}

export async function getCoachTodaysSessions(date: Date, categoryId?: string): Promise<CoachSession[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const tzOffset = new Date().getTimezoneOffset();
  const url = buildSessionsUrl(API_URL, date, tzOffset, categoryId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (!res.ok) throw new Error(`Failed to fetch sessions (${res.status})`);
  return (await res.json()) as CoachSession[];
}
