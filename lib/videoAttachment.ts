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

/**
 * Best-effort delete of a temp file this module created (a compressed video
 * or a generated thumbnail). Every successful send otherwise leaves a full
 * second copy of the video (~10-25MB per the module doc comment above) and
 * the thumbnail JPEG permanently on the device — this is a routine-use bug,
 * not an edge case, since athletes send form-check videos repeatedly.
 *
 * Deliberately swallows its own errors: a cleanup failure must never surface
 * as a send failure, on a send that otherwise succeeded or one that already
 * failed for its own reason.
 *
 * Exported so screens/MessagesScreen.tsx's `prepareForUpload` can apply the
 * same cleanup to the throwaway JPEG it creates when converting a HEIC/HEIF
 * pick — that path leaked one such file per HEIC send before it reused this.
 */
export async function safeDeleteFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (error) {
    console.warn('Could not delete temp file:', uri, error);
  }
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
 * Compression produced a file whose size could not be determined (zero or
 * non-finite). `signUpload` requires a positive finite `size_bytes` and
 * rejects anything else; without this check that rejection surfaces as a
 * generic "Could not prepare upload" network error instead of a message
 * that tells the user what actually happened.
 */
export class VideoUnreadableError extends Error {
  constructor() {
    super('Could not prepare that video for sending. Please try again.');
    this.name = 'VideoUnreadableError';
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

  // signUpload requires a positive finite size_bytes and rejects anything
  // else; catch a zero/unreadable compressed file here instead of letting
  // it surface downstream as an opaque "Could not prepare upload".
  if (!size || !Number.isFinite(size)) {
    await safeDeleteFile(compressedUri);
    throw new VideoUnreadableError();
  }

  if (size > MAX_ATTACHMENT_BYTES) {
    await safeDeleteFile(compressedUri);
    throw new VideoTooLargeError();
  }

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

  try {
    // Compression always emits MP4 regardless of the source .mov.
    const mimeType = 'video/mp4';
    const fileName = file.name.replace(/\.(mov|m4v|mp4)$/i, '') + '.mp4';

    const thumb = await generateThumbnail(prepared.uri);
    let thumbnailPath: string | undefined;

    if (thumb) {
      try {
        if (thumb.size > 0) {
          const signedThumb = await signUpload(
            conversationId, 'image/jpeg', thumb.size, `${fileName}.jpg`, 'thumbnail'
          );
          await uploadFileToSignedUrl(signedThumb.signed_url, thumb.uri, 'image/jpeg');
          thumbnailPath = signedThumb.storage_path;
        }
      } catch (error) {
        console.warn('Could not upload video thumbnail:', error);
      } finally {
        // Disposable the moment its own upload attempt (or non-attempt, for
        // a zero-size thumb) is settled — whether or not that succeeded.
        await safeDeleteFile(thumb.uri);
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
  } finally {
    // The compressed video is a full second copy of the file (~10-25MB per
    // the module doc comment). Delete it whether the upload above succeeded
    // or threw, so a failed or retried send never strands it on the device.
    await safeDeleteFile(prepared.uri);
  }
}
