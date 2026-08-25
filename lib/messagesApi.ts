/**
 * Messaging API client.
 *
 * The app used to insert into `messages` directly with the Supabase client.
 * That skipped the API route, and with it the email/push/in-app fanout — a
 * coach messaging from their phone notified nobody. All sends go through the
 * API now, exactly like waiverApi.ts does.
 */

import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

export interface OutgoingAttachment {
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  thumbnail_path?: string;
  duration_seconds?: number;
}

export interface SentMessage {
  id: string;
  content: string;
  sender_id: string;
  created_at: string;
  attachments: unknown[] | null;
  sender?: Record<string, unknown>;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function sendMessage(
  conversationId: string,
  content: string,
  attachments: OutgoingAttachment[] = []
): Promise<SentMessage> {
  const headers = await getAuthHeaders();

  const response = await fetch(
    `${API_URL}/api/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to send message (${response.status})`);
  }

  return response.json();
}
