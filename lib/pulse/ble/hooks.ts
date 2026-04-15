/**
 * React hooks for the Pulse BLE stack (React Native / Expo).
 *
 * - useBluetoothSupport(): native-only; returns supported=true on device,
 *   false in Expo Go (where ble-plx is not linked)
 * - usePulseDevice():      connect / disconnect state, battery, counter
 * - usePulseSync():        4-state sync state machine (idle → syncing → preview → done)
 * - useLiveSession():      streaming per-throw live mode
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import Constants from 'expo-constants';
import { PulseDeviceRN as PulseDevice } from './pulse-device-rn';

const KEEP_AWAKE_TAG = 'pulse-live-session';
import {
  syncAllThrows,
  startLiveSession,
  type SyncProgress,
  type LiveSessionHandle,
} from './pulse-sync';
import { commitThrows } from './pulse-persist';
import { pulseEvents } from './pulse-events';
import type { DecodedThrow, AthleteAnthro } from './pulse-codec';
import type { SupabaseClient } from '@supabase/supabase-js';

// ────────────────────────────────────────────────────────────────────
// useBluetoothSupport
// ────────────────────────────────────────────────────────────────────

export type BluetoothSupport = {
  supported: boolean;
  /** Human-readable reason when unsupported (iOS, Firefox, etc.) */
  reason: string | null;
};

export function useBluetoothSupport(): BluetoothSupport {
  return useMemo(() => {
    // Expo Go cannot load `react-native-ble-plx` because it needs native
    // linking. Detect it explicitly so the UI shows a friendly message
    // instead of hitting a runtime crash when the user taps Connect.
    if (Constants.appOwnership === 'expo') {
      return {
        supported: false,
        reason:
          'Bluetooth requires a dev build. Run `npx expo run:ios` or install the TestFlight build — Expo Go does not include Bluetooth.',
      };
    }
    return { supported: PulseDevice.isSupported(), reason: null };
  }, []);
}

// ────────────────────────────────────────────────────────────────────
// usePulseDevice
// ────────────────────────────────────────────────────────────────────

export type DeviceState =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export function usePulseDevice() {
  const [device, setDevice] = useState<PulseDevice | null>(null);
  const [state, setState] = useState<DeviceState>('idle');
  const [battery, setBattery] = useState<number | null>(null);
  const [counter, setCounter] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Store the live-listener refs and the connected device on refs so we can
  // remove the listeners + disconnect on unmount without the closure trap that
  // `useEffect(() => { return () => device?.disconnect(); }, [])` falls into
  // (empty deps → stale initial null closure, cleanup never actually runs).
  const deviceRef = useRef<PulseDevice | null>(null);
  const listenersRef = useRef<{
    onCounter: (n: number) => void;
    onBattery: (n: number) => void;
    onDisconnect: () => void;
  } | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    try {
      setState('requesting');
      const d = await PulseDevice.request();
      setState('connecting');
      await d.connect();
      setDevice(d);
      deviceRef.current = d;
      setState('connected');

      // Initial reads
      try {
        const [c, b] = await Promise.all([d.readCounter(), d.readBattery()]);
        setCounter(c);
        setBattery(b);
      } catch {
        // Some firmware versions don't expose battery — not fatal
      }

      // Live listeners — stored as named refs so unmount cleanup can remove
      // them. Without removeEventListener, the listener set grows forever and
      // closures capture stale setters after the hook unmounts.
      const onCounter = (n: number) => setCounter(n);
      const onBattery = (n: number) => setBattery(n);
      const onDisconnect = () => setState('disconnected');
      d.addEventListener('counter', onCounter);
      d.addEventListener('battery', onBattery);
      d.addEventListener('disconnect', onDisconnect);
      listenersRef.current = { onCounter, onBattery, onDisconnect };
    } catch (err: any) {
      console.error('[pulse] connect failed', err);
      setError(err?.message ?? 'Connection failed');
      setState('error');
    }
  }, []);

  const disconnect = useCallback(() => {
    const d = deviceRef.current;
    const listeners = listenersRef.current;
    if (d && listeners) {
      d.removeEventListener('counter', listeners.onCounter);
      d.removeEventListener('battery', listeners.onBattery);
      d.removeEventListener('disconnect', listeners.onDisconnect);
    }
    d?.disconnect();
    listenersRef.current = null;
    deviceRef.current = null;
    setDevice(null);
    setState('idle');
    setBattery(null);
    setCounter(null);
  }, []);

  // Unmount cleanup: tear down listeners + disconnect via the ref (closure over
  // state would be stale).
  useEffect(() => {
    return () => {
      const d = deviceRef.current;
      const listeners = listenersRef.current;
      if (d && listeners) {
        d.removeEventListener('counter', listeners.onCounter);
        d.removeEventListener('battery', listeners.onBattery);
        d.removeEventListener('disconnect', listeners.onDisconnect);
      }
      d?.disconnect();
      listenersRef.current = null;
      deviceRef.current = null;
    };
  }, []);

  return { device, state, battery, counter, error, connect, disconnect };
}

// ────────────────────────────────────────────────────────────────────
// usePulseSync
// ────────────────────────────────────────────────────────────────────

export type SyncStatus =
  | 'idle'
  | 'syncing'
  | 'preview'
  | 'committing'
  | 'done'
  | 'error';

export interface UsePulseSyncArgs {
  device: PulseDevice | null;
  athlete: AthleteAnthro;
  supabase: SupabaseClient;
  orgId: string;
  athleteId: string;
}

export function usePulseSync({
  device,
  athlete,
  supabase,
  orgId,
  athleteId,
}: UsePulseSyncArgs) {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [progress, setProgress] = useState<SyncProgress>({
    packetsReceived: 0,
    throwsDecoded: 0,
    done: false,
  });
  const [decoded, setDecoded] = useState<DecodedThrow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [committedCount, setCommittedCount] = useState(0);

  const athleteRef = useRef(athlete);
  athleteRef.current = athlete;

  const run = useCallback(async () => {
    if (!device) {
      setError('No device connected');
      return;
    }
    setError(null);
    setStatus('syncing');
    setDecoded([]);
    setSkipped(0);
    setCommittedCount(0);
    setProgress({ packetsReceived: 0, throwsDecoded: 0, done: false });

    try {
      const result = await syncAllThrows(device, athleteRef.current, (p) => {
        setProgress(p);
      });
      setDecoded(result.throws);
      setSkipped(result.skipped);
      setStatus('preview');
    } catch (err: any) {
      console.error('[pulse] sync failed', err);
      setError(err?.message ?? 'Sync failed');
      setStatus('error');
    }
  }, [device]);

  const commit = useCallback(async () => {
    if (status !== 'preview') return;
    if (decoded.length === 0) {
      setStatus('done');
      return;
    }
    setError(null);
    setStatus('committing');
    try {
      const res = await commitThrows({
        supabase,
        orgId,
        athleteId,
        throws: decoded,
      });
      if (res.error) throw new Error(res.error);
      setCommittedCount(res.inserted);

      // Notify subscribers (e.g. ThrowingThrowsFeed) that new throws were
      // committed. Realtime can be flaky if Supabase REPLICA IDENTITY isn't
      // FULL, so this gives consumers a reliable refetch trigger.
      if (res.inserted > 0) {
        pulseEvents.emitThrowsCommitted();
      }

      // Only wipe flash AFTER commit succeeds — if anything goes wrong, the
      // athlete can retry from scratch with data still on the sensor.
      try {
        await device?.wipeFlashAfterSync();
      } catch (wipeErr) {
        // Commit succeeded; flash wipe failure is non-fatal but worth logging
        console.warn('[pulse] flash wipe failed after commit', wipeErr);
      }
      setStatus('done');
    } catch (err: any) {
      console.error('[pulse] commit failed', err);
      setError(err?.message ?? 'Commit failed');
      setStatus('error');
    }
  }, [status, decoded, supabase, orgId, athleteId, device]);

  const discard = useCallback(() => {
    setDecoded([]);
    setSkipped(0);
    setProgress({ packetsReceived: 0, throwsDecoded: 0, done: false });
    setStatus('idle');
    setError(null);
  }, []);

  const reset = useCallback(() => {
    discard();
    setCommittedCount(0);
  }, [discard]);

  return useMemo(
    () => ({
      status,
      progress,
      decoded,
      skipped,
      error,
      committedCount,
      run,
      commit,
      discard,
      reset,
    }),
    [status, progress, decoded, skipped, error, committedCount, run, commit, discard, reset],
  );
}

// ────────────────────────────────────────────────────────────────────
// useLiveSession — streaming throws as the athlete throws
// ────────────────────────────────────────────────────────────────────

export type LiveStatus = 'idle' | 'running' | 'committing' | 'error';

export interface UseLiveSessionArgs {
  device: PulseDevice | null;
  athlete: AthleteAnthro;
  supabase: SupabaseClient;
  orgId: string;
  athleteId: string;
}

export function useLiveSession({
  device,
  athlete,
  supabase,
  orgId,
  athleteId,
}: UseLiveSessionArgs) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [throws, setThrows] = useState<DecodedThrow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState(0);
  const handleRef = useRef<LiveSessionHandle | null>(null);
  const athleteRef = useRef(athlete);
  athleteRef.current = athlete;

  const start = useCallback(async () => {
    if (!device || status === 'running') return;
    setError(null);
    setThrows([]);
    setCommittedCount(0);
    setStatus('running');

    // Keep the phone awake while a live session is running so the BLE
    // connection doesn't get killed by the OS locking the screen.
    try {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    } catch {
      // non-fatal
    }

    try {
      handleRef.current = startLiveSession(device, athleteRef.current, {
        onThrow: (t) => {
          setThrows((prev) => [...prev, t]);

          // Stream each decoded throw straight to Supabase so nothing is lost
          // if the browser tab closes mid-session. We deliberately don't hold
          // a preview buffer — live mode == trust the sensor, trust the decode.
          commitThrows({
            supabase,
            orgId,
            athleteId,
            throws: [t],
            sessionTimestamp: new Date(),
            source: 'L',
          })
            .then((res) => {
              if (res.error) {
                console.warn('[pulse live] insert failed', res.error);
                return;
              }
              setCommittedCount((c) => c + (res.inserted ?? 0));
              if ((res.inserted ?? 0) > 0) {
                pulseEvents.emitThrowsCommitted();
              }
            })
            .catch((err) => console.warn('[pulse live] insert threw', err));
        },
        onDecodeError: (msg) => {
          console.warn('[pulse live] decode error', msg);
        },
      });
    } catch (err: any) {
      setError(err?.message ?? 'Live session failed to start');
      setStatus('error');
    }
  }, [device, status, supabase, orgId, athleteId]);

  const stop = useCallback(async () => {
    try {
      await handleRef.current?.stop();
    } catch {
      // swallow
    }
    handleRef.current = null;
    setStatus('idle');
    try {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
      try {
        deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch {
        // non-fatal
      }
    };
  }, []);

  return useMemo(
    () => ({ status, throws, committedCount, error, start, stop }),
    [status, throws, committedCount, error, start, stop],
  );
}
