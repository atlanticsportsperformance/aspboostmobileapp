/**
 * Unread message counting.
 *
 * The `messages` table has no `receiver_id`/`recipient_id`/`read` columns —
 * read state lives on `conversation_participants.last_read_at`. Several
 * screens used to query those non-existent columns and always rendered a
 * count of 0. This helper is the single correct implementation: fetch the
 * user's non-archived conversations, then run one count-only query per
 * conversation for messages newer than that participant's `last_read_at`
 * that the user did not send.
 */
import { supabase as defaultClient } from './supabase';

export async function getUnreadMessagesCount(
  userId: string,
  client: any = defaultClient
): Promise<number> {
  if (!userId) return 0;

  try {
    const { data: participants, error } = await client
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', userId)
      .eq('is_archived', false);

    if (error || !participants || participants.length === 0) return 0;

    const counts = await Promise.all(
      participants.map((p: any) =>
        client
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id)
          .eq('is_deleted', false)
          .neq('sender_id', userId)
          .gt('created_at', p.last_read_at || '1970-01-01')
      )
    );

    return counts.reduce((sum: number, r: any) => sum + (r?.count || 0), 0);
  } catch (err) {
    console.error('Error calculating unread messages:', err);
    return 0;
  }
}
