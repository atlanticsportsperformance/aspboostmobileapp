/**
 * Preparing a form-check video for sending.
 *
 * Caps: 60 seconds, 720p (1280px long edge), 100MB hard ceiling. A 60s clip
 * lands around 10-25MB after compression, which uploads over gym LTE in a
 * reasonable time.
 *
 * Do not reintroduce the old web-side lib/video-compression.ts approach — it
 * drew canvas frames on `timeupdate` (~4fps), dropped audio entirely, and
 * mislabeled the container.
 */

// SDK 54's `expo-file-system` root export replaced createUploadTask/getInfoAsync
// with a new File/Directory API; the classic API (getInfoAsync) only works
// from the `/legacy` subpath. See lib/messagesApi.ts for the full rationale —
// do not "modernize" this import without reading that comment first.
import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Video as VideoCompressor } from 'react-native-compressor';
import {
  signUpload,
  uploadFileToSignedUrl,
  type LocalFile,
  type OutgoingAttachment,
} from './messagesApi';

export const MAX_VIDEO_DURATION_SECONDS = 60;
export const VIDEO_MAX_DIMENSION = 1280; // 720p on the long edge

// Deliberately duplicated from lib/messaging/attachment-rules.ts. The mobile
// app is a separate package with its own tsconfig and cannot import from the
// web root. The server is the enforcing copy; this one only lets the app fail
// fast before spending a minute compressing. If you change one, change both.
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

async function fileSize(uri: string): Promise<number> {
  // This SDK's legacy InfoOptions has no `size` flag to opt into — size
  // comes back whenever the file exists, with no extra option needed (see
  // the identical note in screens/MessagesScreen.tsx's prepareForUpload).
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? info.size ?? 0 : 0;
}

export class VideoTooLongError extends Error {
  constructor() {
    super(`Videos must be ${MAX_VIDEO_DURATION_SECONDS} seconds or shorter.`);
    this.name = 'VideoTooLongError';
  }
}

export class VideoTooLargeError extends Error {
  constructor() {
    super('That video is too large to send even after compressing.');
    this.name = 'VideoTooLargeError';
  }
}

/**
 * Compresses to ~720p. `durationMs` comes from the picker asset; it is checked
 * before compressing so an over-length video fails fast instead of after 30
 * seconds of transcoding.
 */
export async function prepareVideo(
  uri: string,
  durationMs: number | undefined
): Promise<{ uri: string; size: number; durationSeconds: number }> {
  const durationSeconds = durationMs ? Math.round(durationMs / 1000) : 0;

  // The picker's videoMaxDuration should have prevented this; belt and braces
  // because library picks on some OS versions do not enforce it.
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new VideoTooLongError();
  }

  const compressedUri = await VideoCompressor.compress(uri, {
    compressionMethod: 'manual',
    maxSize: VIDEO_MAX_DIMENSION,
    bitrate: 2_000_000,
  });

  const size = await fileSize(compressedUri);
  if (size > MAX_ATTACHMENT_BYTES) throw new VideoTooLargeError();

  return { uri: compressedUri, size, durationSeconds };
}

/** Poster frame, grabbed 1s in so it is not a black first frame. */
export async function generateThumbnail(
  videoUri: string
): Promise<{ uri: string; size: number } | null> {
  try {
    const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, { time: 1000 });
    return { uri, size: await fileSize(uri) };
  } catch (error) {
    // A missing poster degrades the UI; it must never block the send.
    console.warn('Could not generate video thumbnail:', error);
    return null;
  }
}

export async function uploadVideoAttachment(
  conversationId: string,
  file: LocalFile,
  durationMs: number | undefined,
  onProgress?: (pct: number) => void
): Promise<OutgoingAttachment> {
  const prepared = await prepareVideo(file.uri, durationMs);

  // Compression always emits MP4 regardless of the source .mov.
  const mimeType = 'video/mp4';
  const fileName = file.name.replace(/\.(mov|m4v|mp4)$/i, '') + '.mp4';

  const thumb = await generateThumbnail(prepared.uri);
  let thumbnailPath: string | undefined;

  if (thumb && thumb.size > 0) {
    try {
      const signedThumb = await signUpload(
        conversationId, 'image/jpeg', thumb.size, `${fileName}.jpg`, 'thumbnail'
      );
      await uploadFileToSignedUrl(signedThumb.signed_url, thumb.uri, 'image/jpeg');
      thumbnailPath = signedThumb.storage_path;
    } catch (error) {
      console.warn('Could not upload video thumbnail:', error);
    }
  }

  const signed = await signUpload(conversationId, mimeType, prepared.size, fileName);
  await uploadFileToSignedUrl(signed.signed_url, prepared.uri, mimeType, onProgress);

  return {
    storage_path: signed.storage_path,
    file_name: fileName,
    mime_type: mimeType,
    file_size: prepared.size,
    thumbnail_path: thumbnailPath,
    duration_seconds: prepared.durationSeconds,
  };
}
