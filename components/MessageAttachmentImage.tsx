import React, { useEffect, useState } from 'react';
import { View, Text, Image, ActivityIndicator, StyleSheet, Dimensions } from 'react-native';
import { resolveAttachmentDirectUrl } from '../lib/messagesApi';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Props {
  /** Stored attachment: fetched through the authorizing endpoint. */
  storagePath?: string;
  /** Legacy pre-migration attachment: a plain public URL. */
  fileUrl?: string;
  /** The endpoint URL for `storagePath`, built by the caller. */
  endpointUrl: string;
  authHeaders: Record<string, string>;
  authHeadersReady: boolean;
}

/**
 * One image attachment in a message thread, with a single silent retry.
 *
 * An attachment image can fail to load for reasons that are gone a moment
 * later: the Supabase access token in `authHeaders` went stale between
 * render and request, a signed URL behind the endpoint's 302 aged out of its
 * 3600s window mid-scroll, or the request simply dropped. Previously any of
 * those left a permanently blank tile with no way to recover short of
 * leaving the screen and coming back.
 *
 * On the first error this re-resolves the attachment straight to a fresh
 * signed URL (`resolveAttachmentDirectUrl`, which mints one with the
 * caller's current token) and retries with that. Only if THAT fails too does
 * the tile show a failure state — at which point the problem is real.
 */
export function MessageAttachmentImage({
  storagePath,
  fileUrl,
  endpointUrl,
  authHeaders,
  authHeadersReady,
}: Props) {
  // A resolved signed URL from the retry. It carries its own auth in the
  // query string, so it is requested WITHOUT headers.
  const [retryUrl, setRetryUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // A different attachment rendered into this same slot (list reuse, an
  // older page prepended) must start from a clean state.
  useEffect(() => {
    setRetryUrl(null);
    setFailed(false);
  }, [storagePath, fileUrl]);

  // Auth headers haven't loaded yet — this request needs them (the endpoint
  // URL authorizes the caller), so hold off rather than firing it
  // unauthenticated and burning the one retry on a guaranteed 401.
  if (storagePath && !authHeadersReady && !retryUrl) {
    return (
      <View style={[styles.image, styles.pending]}>
        <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
      </View>
    );
  }

  if (failed) {
    return (
      <View style={[styles.image, styles.pending]}>
        <Text style={styles.failedText}>Image unavailable</Text>
      </View>
    );
  }

  const uri = retryUrl ?? (storagePath ? endpointUrl : fileUrl ?? '');

  return (
    <Image
      source={retryUrl ? { uri: retryUrl } : { uri, headers: authHeaders }}
      style={styles.image}
      resizeMode="cover"
      onError={() => {
        // Second failure (or a legacy public URL, which has nothing to
        // re-resolve) — give up and say so.
        if (retryUrl || !storagePath) {
          setFailed(true);
          return;
        }
        resolveAttachmentDirectUrl(storagePath)
          .then((fresh) => setRetryUrl(fresh))
          .catch((error) => {
            console.warn('Could not re-resolve an attachment image:', error);
            setFailed(true);
          });
      }}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    width: SCREEN_WIDTH * 0.55,
    height: 150,
    borderRadius: 8,
    marginBottom: 4,
  },
  pending: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  failedText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
  },
});
