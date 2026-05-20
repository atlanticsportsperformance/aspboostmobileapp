// aspboost-mobile/lib/coachAthletes.ts
import { supabase } from './supabase';

export interface LinkedAthlete { id: string; firstName: string; lastName: string; }

interface CoachAthleteRow {
  athlete_id: string;
  athlete: { id: string; first_name: string; last_name: string } | null;
}

export function normalizeLinkedAthletes(rows: CoachAthleteRow[]): LinkedAthlete[] {
  return rows
    .filter((r) => r.athlete != null)
    .map((r) => ({ id: r.athlete!.id, firstName: r.athlete!.first_name, lastName: r.athlete!.last_name }));
}

export function filterAthletes(list: LinkedAthlete[], query: string): LinkedAthlete[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (a) => a.firstName.toLowerCase().includes(q) || a.lastName.toLowerCase().includes(q)
  );
}

export function normalizeOrgAthletes(
  rows: { id: string; first_name: string; last_name: string }[]
): LinkedAthlete[] {
  return rows.map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name }));
}

export async function getOrgAthletes(orgId: string): Promise<LinkedAthlete[]> {
  const { data, error } = await supabase
    .from('athletes')
    .select('id, first_name, last_name')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('last_name', { ascending: true });
  if (error || !data) return [];
  return normalizeOrgAthletes(data as any);
}

export async function getLinkedAthletes(coachUserId: string): Promise<LinkedAthlete[]> {
  const { data, error } = await supabase
    .from('coach_athletes')
    .select('athlete_id, athlete:athlete_id ( id, first_name, last_name )')
    .eq('coach_id', coachUserId);
  if (error || !data) return [];
  return normalizeLinkedAthletes(data as unknown as CoachAthleteRow[]);
}
