import { supabase } from './supabase';
import type { CoachSession, CoachBooking } from './coachScheduleApi';

/**
 * The pure shaping behind the coach Overview screen, plus the one query it
 * needs that no existing fetch already makes (unread messages).
 *
 * Everything here is read-only. Overview never writes.
 */

/** How many initials the "who's booked" stack shows before it collapses. */
export const BOOKED_PREVIEW_LIMIT = 4;

/**
 * Split the day into the session a coach is about to walk into and everything
 * after it. "Current" is the first session that has not finished — a session
 * already under way is still what the coach needs on screen, not the one after.
 */
export function splitToday(
  sessions: CoachSession[],
  now: Date
): { current: CoachSession | null; later: CoachSession[] } {
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const t = now.getTime();
  const idx = sorted.findIndex((s) => new Date(s.endTime).getTime() > t);
  if (idx === -1) return { current: null, later: [] };
  return { current: sorted[idx], later: sorted.slice(idx + 1) };
}

/** "Starts in 48 min" / "Starts in 2h 15m" / "In progress". */
export function startsInLabel(session: CoachSession, now: Date): string {
  const diffMs = new Date(session.startTime).getTime() - now.getTime();
  if (diffMs <= 0) return 'In progress';
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `Starts in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `Starts in ${h}h` : `Starts in ${h}h ${m}m`;
}

/**
 * The avatar stack under the next session. `allBookings` is the full roster
 * when the caller may see it; `bookings` is the narrowed one — same fallback
 * the session card on the day list uses.
 */
export function bookedPreview(
  session: CoachSession,
  limit: number = BOOKED_PREVIEW_LIMIT
): { initials: string[]; overflow: number; booked: number; capacity: number } {
  const roster: CoachBooking[] =
    (session.allBookings && session.allBookings.length ? session.allBookings : session.bookings) || [];
  const initials = roster.slice(0, limit).map((b) => {
    const a = b.athletes;
    if (!a) return '?';
    return `${a.first_name?.[0] ?? ''}${a.last_name?.[0] ?? ''}` || '?';
  });
  return {
    initials,
    overflow: Math.max(0, roster.length - limit),
    booked: session.currentBookings,
    capacity: session.capacity,
  };
}

export interface UnreadSummary { messages: number; conversations: number }

interface ParticipationRow { conversation_id: string; last_read_at: string | null }
interface MessageMetaRow { conversation_id: string; sender_id: string | null; created_at: string }

/**
 * Unread = messages from other people newer than this user's `last_read_at`
 * in that conversation (all of them when it has never been read). Identical
 * semantics to the Messages list, kept as a pure function so it is testable
 * without a database.
 */
export function countUnread(
  participations: ParticipationRow[],
  messages: MessageMetaRow[],
  userId: string
): UnreadSummary {
  const lastReadByConv = new Map(participations.map((p) => [p.conversation_id, p.last_read_at]));
  const perConv = new Map<string, number>();
  for (const m of messages) {
    if (!lastReadByConv.has(m.conversation_id)) continue;
    if (m.sender_id === userId) continue;
    const lastRead = lastReadByConv.get(m.conversation_id);
    if (lastRead && new Date(m.created_at) <= new Date(lastRead)) continue;
    perConv.set(m.conversation_id, (perConv.get(m.conversation_id) || 0) + 1);
  }
  let messagesCount = 0;
  for (const n of perConv.values()) messagesCount += n;
  return { messages: messagesCount, conversations: perConv.size };
}

/**
 * Two queries, no joins: which conversations this user is in, then the
 * metadata of their messages. Deliberately lighter than the Messages screen's
 * load — Overview needs a number, not conversations, participants or content.
 */
export async function getUnreadSummary(): Promise<UnreadSummary> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { messages: 0, conversations: 0 };

  const { data: participations, error: partError } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id)
    // The Messages list hides archived conversations, so counting them here
    // would show a badge the coach has no way to clear.
    .eq('is_archived', false);
  if (partError || !participations || participations.length === 0) return { messages: 0, conversations: 0 };

  const conversationIds = participations.map((p: ParticipationRow) => p.conversation_id);
  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('conversation_id, sender_id, created_at')
    .in('conversation_id', conversationIds)
    .eq('is_deleted', false);
  if (msgError) return { messages: 0, conversations: 0 };

  return countUnread(participations as ParticipationRow[], (messages || []) as MessageMetaRow[], user.id);
}

/**
 * The video link for a remote session a coach can still walk into — null for
 * anything in-person, unlinked, or already over. A session under way still
 * returns its link: that is exactly when a coach reaches for it.
 *
 * Only http(s) is handed back. The URL is opened with Linking.openURL, which
 * will happily dispatch any scheme it is given, and this value arrives from
 * the server.
 */
export function joinUrlFor(session: CoachSession, now: Date): string | null {
  if (!session.is_remote) return null;
  const url = (session.meeting_url || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (new Date(session.endTime).getTime() <= now.getTime()) return null;
  return url;
}

/** Wall-clock time for a session, in the device's timezone. */
export function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
