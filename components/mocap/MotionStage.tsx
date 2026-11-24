/**
 * MotionStage — the Motion tab of the mocap detail screen, rendered in one
 * WebView (see lib/mocap/motionStageHtml.ts). Video, 3D, scrubber, transport
 * and the live "At this frame" readouts all run inside the page off the same
 * rAF loop with the <video> as master clock, so nothing per-frame crosses
 * the bridge. The C3D is fetched inside the WebView; if that fails (CORS),
 * RN fetches it once and injects it as base64.
 */

import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState, useEffect } from 'react';
import { Alert, Share, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { fetchC3DBinary, isHittingDetail, type MocapPitchDetail } from '../../lib/mocap/api';
import { buildMotionStageHtml, MESH_BASE_URL } from '../../lib/mocap/motionStageHtml';

export interface MotionStageHandle {
  jumpTo: (eventKey: string) => void;
}

interface Props {
  detail: MocapPitchDetail;
  accent: string;
  active: boolean;
  onScrollLock?: (locked: boolean) => void;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bufferToBase64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  const out: string[] = [];
  let chunk = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    chunk += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
      (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') +
      (i + 2 < b.length ? B64[n & 63] : '=');
    if (chunk.length > 65536) { out.push(chunk); chunk = ''; }
  }
  out.push(chunk);
  return out.join('');
}

const MotionStage = forwardRef<MotionStageHandle, Props>(function MotionStage(
  { detail, accent, active, onScrollLock },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const [height, setHeight] = useState(1050);
  const fallbackDone = useRef(false);
  const exportParts = useRef<string[]>([]);
  const p = detail.pitch;
  const hitting = isHittingDetail(detail);

  const html = useMemo(
    () =>
      buildMotionStageHtml({
        mode: hitting ? 'hitting' : 'pitching',
        accent,
        c3dUrl: detail.c3dUrl,
        videoUrl: detail.videoUrl,
        eventTimes: (p.eventTimes as Record<string, number> | null | undefined) ?? null,
        curves: p.curves ?? null,
        handedness: p.handedness ?? null,
        scalarMetrics: p.scalarMetrics ?? null,
        batSpeed: p.batSpeed ?? null,
      }),
    // Signed URLs rotate on refresh; rebuild only when the capture changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.id, detail.c3dUrl, detail.videoUrl, accent, hitting],
  );

  useEffect(() => { fallbackDone.current = false; }, [html]);

  useEffect(() => {
    webRef.current?.injectJavaScript(`window.__setActive && window.__setActive(${active ? 'true' : 'false'});true;`);
  }, [active]);

  useImperativeHandle(ref, () => ({
    jumpTo: (k: string) => {
      webRef.current?.injectJavaScript(`window.__jumpTo && window.__jumpTo(${JSON.stringify(k)});true;`);
    },
  }), []);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    switch (msg.type) {
      case 'height':
        if (typeof msg.h === 'number' && msg.h > 0) setHeight(msg.h);
        break;
      case 'lock': onScrollLock?.(true); break;
      case 'unlock': onScrollLock?.(false); break;
      case 'needC3D':
        if (fallbackDone.current || !detail.c3dUrl) break;
        fallbackDone.current = true;
        console.warn('[MotionStage] WebView C3D fetch failed, falling back to RN fetch:', msg.message);
        fetchC3DBinary(detail.c3dUrl)
          .then((buf) => {
            const b64 = bufferToBase64(buf);
            webRef.current?.injectJavaScript(`window.__loadC3D64(${JSON.stringify(b64)});true;`);
          })
          .catch((err) => console.error('[MotionStage] C3D fetch failed:', err));
        break;
      case 'exportChunk':
        if (msg.i === 0) exportParts.current = [];
        exportParts.current[msg.i] = msg.data;
        break;
      case 'exportDone': {
        // Recorded on-device inside the WebView; save locally, then the iOS share sheet.
        const b64 = exportParts.current.join('');
        exportParts.current = [];
        const ext = String(msg.mime || '').includes('webm') ? 'webm' : 'mp4';
        const path = `${FileSystem.cacheDirectory}ASP-mocap-${p.id}.${ext}`;
        FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 })
          .then(() => Share.share({ url: path }))
          .catch((err) => {
            console.error('[MotionStage] export save failed:', err);
            Alert.alert('Export failed', 'The video couldn’t be saved. Please try again.');
          });
        break;
      }
      case 'exportError':
        exportParts.current = [];
        Alert.alert('Export failed', msg.message || 'Please try again.');
        break;
      case 'error':
        console.error('[MotionStage]', msg.message);
        break;
    }
  };

  return (
    <View style={{ height, backgroundColor: '#000' }}>
      <WebView
        ref={webRef}
        source={{ html, baseUrl: MESH_BASE_URL }}
        originWhitelist={['*']}
        style={{ flex: 1, backgroundColor: '#000' }}
        scrollEnabled={false}
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="always"
        onMessage={onMessage}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        setSupportMultipleWindows={false}
      />
    </View>
  );
});

export default MotionStage;
