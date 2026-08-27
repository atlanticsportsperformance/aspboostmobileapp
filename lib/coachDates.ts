/**
 * Date helpers shared by the coach screens. Lifted from CoachDashboardScreen
 * so the roster and the program calendar use the same clock.
 *
 * toLocalDateKey builds YYYY-MM-DD from LOCAL parts. workout_instances.
 * scheduled_date is a bare date, so the only safe comparison is string
 * equality against a key built this way — never toISOString() (UTC) and
 * never new Date('YYYY-MM-DD') (also UTC).
 */
export function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function isSameDay(a: Date, b: Date): boolean { return startOfDay(a).getTime() === startOfDay(b).getTime(); }
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function dayLabel(d: Date): string {
  const today = new Date();
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, addDays(today, 1))) return 'Tomorrow';
  if (isSameDay(d, addDays(today, -1))) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The seven days of the week containing `d`, Monday first. */
export function weekStartingMonday(d: Date): Date[] {
  const start = startOfDay(d);
  const dow = start.getDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  const monday = addDays(start, -back);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
