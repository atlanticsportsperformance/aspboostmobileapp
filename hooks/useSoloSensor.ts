/**
 * Phone-direct OVR (Task 10b). Inert until the athlete taps "Connect sensor":
 * the device object exists but nothing scans, and no engine runs. While on,
 * reps feed the solo engine (lib/rack/solo.ts), which queues reps + the set
 * row under the solo keys. Joining a rack (active or queued) disconnects it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOvrDevice } from './useOvrDevice';
import { createRackPersist } from '../lib/rack/persist';
import type { RackClient } from '../lib/rack/api';
import type { RpcClient } from '../lib/logger/saveSet';
import type { RackEngineState, RackEvent, SetSummary } from '../lib/rack/engine';
import {
  SOLO_PERSIST_KEYS,
  createSoloSession,
  isSensorBusy,
  mustDropSensor,
  readSoloOvrName,
  saveSoloOvrName,
  type SoloSession,
} from '../lib/rack/solo';
import { OVR } from '../lib/ovr/ovr-device';
import { FakeOvrDevice } from '../lib/ovr/fake-ovr';

export type SoloContextInput = Omit<Extract<RackEvent, { type: 'soloContext' }>, 'type'>;

export function useSoloSensor(opts: {
  athleteId: string;
  orgId: string | null;
  /** Athlete is on a rack (active or queued): the phone sensor must be off. */
  onRack: boolean;
  /** A set row was durably queued (fill the logger row in). */
  onSetSaved: (summary: SetSummary) => void;
}) {
  const { athleteId, orgId, onRack } = opts;
  const ovr = useOvrDevice();
  const [on, setOn] = useState(false);
  const [engine, setEngine] = useState<RackEngineState | null>(null);
  const savedRef = useRef(opts.onSetSaved);
  savedRef.current = opts.onSetSaved;

  const session: SoloSession | null = useMemo(() => {
    if (!athleteId || !orgId) return null;
    const persist = createRackPersist({
      client: supabase as unknown as RackClient & RpcClient,
      orgId,
      keys: SOLO_PERSIST_KEYS,
    });
    return createSoloSession({ athleteId, persist, sensor: { writeLoad: lb => ovr.device.writeLoad(lb) } });
  }, [athleteId, orgId, ovr.device]);

  // Engine state → React; saved sets → the logger. Queued items flush on mount
  // (a previous run's leftovers) even if the sensor is never connected.
  useEffect(() => {
    if (!session) return;
    setEngine(session.getState());
    const offState = session.subscribe(setEngine);
    const offSaved = session.onSetSaved(s => savedRef.current(s));
    void session.flush();
    return () => {
      offState();
      offSaved();
      session.stop();
    };
  }, [session]);

  // Reps → engine, only while on.
  useEffect(() => {
    if (!session || !on) return;
    session.start();
    const off = ovr.device.onRep((rep, at) => session.dispatch({ type: 'rep', rep }, at));
    return () => {
      off();
      session.stop();
    };
  }, [session, on, ovr.device]);

  // Remember the sensor this phone paired with.
  useEffect(() => {
    if (on && ovr.state === 'connected' && ovr.deviceName && !(ovr.device instanceof FakeOvrDevice)) {
      void saveSoloOvrName(ovr.deviceName);
    }
  }, [on, ovr.state, ovr.deviceName, ovr.device]);

  const connect = useCallback(async (anySensor = false) => {
    const name = anySensor ? null : await readSoloOvrName();
    setOn(true);
    void ovr.connect(name ?? OVR.NAME_PREFIX);
  }, [ovr.connect]);

  const disconnect = useCallback(() => {
    // A set in progress ends (and is written) before the sensor goes.
    session?.dispatch({ type: 'done' });
    setOn(false);
    ovr.disconnect();
  }, [session, ovr.disconnect]);

  // Joining a rack disconnects the phone sensor.
  useEffect(() => {
    if (mustDropSensor({ onRack, sensorOn: on })) disconnect();
  }, [onRack, on, disconnect]);

  const dispatch = useCallback((e: RackEvent) => session?.dispatch(e), [session]);

  return {
    /** The athlete wants the sensor (connected, scanning or reconnecting). */
    on,
    state: ovr.state,
    deviceName: ovr.deviceName ?? null,
    busy: on && isSensorBusy(ovr.state, ovr.error),
    error: ovr.error ?? null,
    engine: on ? engine : null,
    fake: ovr.device instanceof FakeOvrDevice ? ovr.device : null,
    connect,
    disconnect,
    dispatch,
  };
}

export type SoloSensorApi = ReturnType<typeof useSoloSensor>;
