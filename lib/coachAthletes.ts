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

export async function getLinkedAthletes(coachUserId: string): Promise<LinkedAthlete[]> {
  const { data, error } = await supabase
    .from('coach_athletes')
    .select('athlete_id, athlete:athlete_id ( id, first_name, last_name )')
    .eq('coach_id', coachUserId);
  if (error || !data) return [];
  return normalizeLinkedAthletes(data as unknown as CoachAthleteRow[]);
}
