/**
 * React hook over an OvrDevice (real BLE or fake). One device per mount;
 * listeners are removed and the sensor disconnected on unmount.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OvrRep } from '../lib/ovr/protocol';
import {
  createOvrDevice,
  type OvrDevice,
  type OvrStatus,
} from '../lib/ovr/ovr-device';

export interface OvrLastRep {
  rep: OvrRep;
  receivedAtMs: number;
  /** Increments per rep so identical consecutive reps still re-render. */
  seq: number;
}

export function useOvrDevice(opts: { fake?: boolean } = {}) {
  // Created once per mount; `fake` is read on first render only.
  const [device] = useState<OvrDevice>(() => createOvrDevice({ fake: opts.fake }));
  const [status, setStatus] = useState<OvrStatus>(() => ({
    state: device.state,
    error: device.error,
    deviceName: device.deviceName,
  }));
  const [lastRep, setLastRep] = useState<OvrLastRep | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const offState = device.onState(setStatus);
    const offRep = device.onRep((rep, receivedAtMs) => {
      seqRef.current += 1;
      setLastRep({ rep, receivedAtMs, seq: seqRef.current });
    });
    return () => {
      offState();
      offRep();
      device.disconnect();
    };
  }, [device]);

  const connect = useCallback((name?: string) => device.connect(name), [device]);
  const disconnect = useCallback(() => device.disconnect(), [device]);
  const writeLoad = useCallback((lb: number) => device.writeLoad(lb), [device]);

  return useMemo(
    () => ({
      device,
      state: status.state,
      error: status.error,
      deviceName: status.deviceName,
      lastRep,
      connect,
      disconnect,
      writeLoad,
    }),
    [device, status, lastRep, connect, disconnect, writeLoad],
  );
}
