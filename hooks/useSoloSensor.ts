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
import { createRackApi, type RackClient } from '../lib/rack/api';
import type { RpcClient } from '../lib/logger/saveSet';
import type { RackEngineState, RackEvent, SetSummary } from '../lib/rack/engine';
import {
  RACK_CHECK_MS,
  createSoloSession,
  isSensorBusy,
  mustDropSensor,
  onAnyRack,
  rackSensorNames,
  readRackSensors,
  readSoloOvrName,
  saveRackSensors,
  saveSoloOvrName,
  soloPersistKeys,
  soloScanTarget,
  type SoloSession,
} from '../lib/rack/solo';
import { withTimeout } from '../lib/rack/persist';
import { FakeOvrDevice } from '../lib/ovr/fake-ovr';

export type SoloContextInput = Omit<Extract<RackEvent, { type: 'soloContext' }>, 'type'>;

export function useSoloSensor(opts: {
  athleteId: string;
  orgId: string | null;
  /** Athlete is on a rack (active or queued): the phone sensor must be off. */
  onRack: boolean;
  /** A set row was durably queued (fill the logger row in). */
  onSetSaved: (summary: SetSummary) => void;
  /** A set-start check found the athlete on a rack (refresh the rack banner). */
  onRackDetected?: () => void;
}) {
  const { athleteId, orgId, onRack } = opts;
  const ovr = useOvrDevice();
  const [on, setOn] = useState(false);
  /** What the sensor's display shows: the athlete's own LB, else the prescribed
   *  number. Display only — never a set's load (that is the own LB only). */
  const [displayLoadLb, setDisplayLoad] = useState<number | null>(null);
  const [engine, setEngine] = useState<RackEngineState | null>(null);
  const savedRef = useRef(opts.onSetSaved);
  savedRef.current = opts.onSetSaved;
  const rackDetectedRef = useRef(opts.onRackDetected);
  rackDetectedRef.current = opts.onRackDetected;
  const api = useMemo(() => createRackApi(supabase as unknown as RackClient), []);
  const dropRef = useRef<() => void>(() => undefined);

  /** rack_list_for_me → refresh the cached rack sensor names; null on failure. */
  const readRacks = useCallback(async () => {
    try {
      const list = await withTimeout(api.listForMe(), RACK_CHECK_MS, 'rack_list_for_me');
      await saveRackSensors(rackSensorNames(list));
      return list;
    } catch (e) {
      console.warn('[solo] rack list failed', e);
      return null;
    }
  }, [api]);

  const session: SoloSession | null = useMemo(() => {
    if (!athleteId || !orgId) return null;
    const persist = createRackPersist({
      client: supabase as unknown as RackClient & RpcClient,
      orgId,
      keys: soloPersistKeys(athleteId),
    });
    return createSoloSession({
      athleteId,
      persist,
      sensor: { writeLoad: lb => ovr.device.writeLoad(lb) },
      // Each set start: on a rack (e.g. made active from the iPad tile) → no set, drop the sensor.
      checkRack: async () => {
        const list = await readRacks();
        return !!list && onAnyRack(list);
      },
      onRack: () => {
        dropRef.current();
        rackDetectedRef.current?.();
      },
    });
  }, [athleteId, orgId, ovr.device, readRacks]);

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
      // Leaving mid-set (back, finish, navigation): end the set — its row is
      // queued on disk — then flush. The chain outlives the unmount.
      session.dispatch({ type: 'done' });
      void session.idle().then(() => session.flush());
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

  // Connect: never a rack's sensor (rack_list_for_me's ovr_device_name, else
  // the cached list), one scan, no endless retry — Retry is a user tap.
  const connect = useCallback(async (anySensor = false) => {
    setOn(true);
    const [list, cached, remembered] = await Promise.all([readRacks(), readRackSensors(), anySensor ? null : readSoloOvrName()]);
    const rackSensors = list ? rackSensorNames(list) : cached;
    if (list && onAnyRack(list)) {
      setOn(false);
      rackDetectedRef.current?.();
      return;
    }
    const { target, exclude } = soloScanTarget(remembered, rackSensors);
    void ovr.connect(target, { exclude, giveUpOnScanTimeout: true });
  }, [ovr.connect, readRacks]);

  const disconnect = useCallback(() => {
    // A set in progress ends (and is written) before the sensor goes.
    session?.dispatch({ type: 'done' });
    setOn(false);
    ovr.disconnect();
  }, [session, ovr.disconnect]);

  dropRef.current = () => {
    setOn(false);
    ovr.disconnect();
  };

  // The sensor's display: own LB, else the prescribed number (display only).
  useEffect(() => {
    if (!on || ovr.state !== 'connected' || displayLoadLb == null) return;
    ovr.writeLoad(displayLoadLb).catch(e => console.warn('[solo] display load failed', e));
  }, [on, ovr.state, displayLoadLb, ovr.writeLoad]);

  // Joining a rack disconnects the phone sensor.
  useEffect(() => {
    if (mustDropSensor({ onRack, sensorOn: on })) disconnect();
  }, [onRack, on, disconnect]);

  const dispatch = useCallback((e: RackEvent) => session?.dispatch(e), [session]);
  /** Long-press "Remove rep" on a phone-sensor rep: out of the engine's set, rack_remove_rep queued. */
  const removeRep = useCallback((clientRepId: string) => session?.removeRep(clientRepId) ?? Promise.resolve(), [session]);

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
    removeRep,
    setDisplayLoad,
  };
}

export type SoloSensorApi = ReturnType<typeof useSoloSensor>;
