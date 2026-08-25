/**
 * Messaging API client.
 *
 * The app used to insert into `messages` directly with the Supabase client.
 * That skipped the API route, and with it the email/push/in-app fanout — a
 * coach messaging from their phone notified nobody. All sends go through the
 * API now, exactly like waiverApi.ts does.
 */

import { supabase } from './supabase';
// SDK 54's `expo-file-system` root export replaced createUploadTask/getInfoAsync
// with a new File/Directory API; the old functions still type-check from the
// root package (re-exported for back-compat) but throw at runtime. The classic
// API we need here only works from the `/legacy` subpath.
//
// Do NOT "modernize" this import later without checking both of these first:
//   - The new File/Directory API has no upload-with-progress equivalent at
//     all. createUploadTask (via /legacy) is the only way to get progress
//     callbacks, which is the entire point of this module.
//   - The obvious replacement for reading bytes, `File.arrayBuffer()`, IS the
//     whole-file-in-JS-heap pattern this module exists to remove — the one
//     that crashed the app on video-sized attachments. Swapping to it would
//     silently reintroduce that crash.
import * as FileSystem from 'expo-file-system/legacy';

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

export interface LocalFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Asks the server for a signed upload URL. Nothing about the destination
 * comes from the client: the org, conversation folder, and file extension
 * are all derived server-side from the validated mime type. This replaces
 * the old client-built `{org}/{athleteId}/{file}` path, which produced
 * `{org}//{file}` for staff senders (athleteId was never set for them).
 */
export async function signUpload(
  conversationId: string,
  mimeType: string,
  sizeBytes: number,
  fileName: string,
  kind: 'attachment' | 'thumbnail' = 'attachment'
): Promise<{ signed_url: string; storage_path: string }> {
  const headers = await getAuthHeaders();

  const response = await fetch(`${API_URL}/api/messages/attachments/sign-upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      conversation_id: conversationId,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      file_name: fileName,
      kind,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Could not prepare upload (${response.status})`);
  }

  return response.json();
}

/**
 * Streams the file from disk straight to the signed URL. The previous
 * implementation read the whole file into the JS heap twice (fetch(uri) then
 * blob() then arrayBuffer()), which crashed on anything video-sized.
 *
 * The signed URL is an absolute URL that already carries `?token=` — no
 * Authorization header is involved in the upload itself, only PUT + a
 * content-type header.
 */
export async function uploadFileToSignedUrl(
  signedUrl: string,
  fileUri: string,
  mimeType: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  const task = FileSystem.createUploadTask(
    signedUrl,
    fileUri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {
        'content-type': mimeType,
        'x-upsert': 'false',
      },
    },
    (progress) => {
      if (!onProgress || !progress.totalBytesExpectedToSend) return;
      onProgress(
        Math.round((progress.totalBytesSent / progress.totalBytesExpectedToSend) * 100)
      );
    }
  );

  const result = await task.uploadAsync();
  if (!result) throw new Error('Upload was cancelled');
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (${result.status})`);
  }
}

/**
 * Absolute URL for a stored attachment. The endpoint authorizes the caller and
 * 302s to a short-lived signed URL, so this is safe to hand to <Image> and
 * <VideoView> directly (as long as the caller supplies the `Authorization`
 * header themselves — see `resolveAttachmentDirectUrl` for the case where it
 * can't).
 */
export function attachmentUrl(storagePath: string): string {
  const encoded = storagePath.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `${API_URL}/api/messages/attachments/${encoded}`;
}

/**
 * Resolves a stored attachment straight to its short-lived signed URL rather
 * than the authorizing endpoint.
 *
 * `expo-video`'s player has no cookie session and, per the carry-forward
 * ruling for Task 14, is not trusted to carry an `Authorization` header
 * through the endpoint's 302 to Supabase Storage — so a direct
 * `attachmentUrl()` request there would 401. Fetch it once here instead,
 * with the header attached to THIS request, and read the `Location` the
 * server redirects to. That signed URL carries its own token in the query
 * string and needs no auth header, so the player can use it as-is.
 */
export async function resolveAttachmentDirectUrl(storagePath: string): Promise<string> {
  const headers = await getAuthHeaders();
  const res = await fetch(attachmentUrl(storagePath), { headers, redirect: 'manual' });
  const location = res.headers.get('location');
  if (!location) throw new Error('Could not resolve attachment');
  return location;
}

export async function uploadAttachment(
  conversationId: string,
  file: LocalFile,
  onProgress?: (pct: number) => void
): Promise<OutgoingAttachment> {
  const { signed_url, storage_path } = await signUpload(
    conversationId,
    file.mimeType,
    file.size,
    file.name
  );

  await uploadFileToSignedUrl(signed_url, file.uri, file.mimeType, onProgress);

  return {
    storage_path,
    file_name: file.name,
    mime_type: file.mimeType,
    file_size: file.size,
  };
}
