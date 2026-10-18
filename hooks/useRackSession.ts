/**
 * Rack iPad session: one engine + executor per rack. Feeds the server's
 * `rack_sessions` row (initial read, realtime, and every RPC's returned row)
 * into the engine as `sessionSync`, sensor reps as `rep`, and today's
 * athletes as contextMeta/localContext; a rep removed on the phone (vbt_reps
 * UPDATE with removed_at) as a remote removeRep. Exposes the engine state for the UI.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createRackApi, type RackClient, type TodayAthlete } from '../lib/rack/api';
import { createRackPersist } from '../lib/rack/persist';
import { createRackExecutor, type RackExecutor } from '../lib/rack/executor';
import { uniqueTopic } from '../lib/rack/phone';
import { createRackEngine, type RackEngineState, type RackEvent, type RackSessionRow } from '../lib/rack/engine';
import type { OvrDevice } from '../lib/ovr/ovr-device';

export interface UseRackSession {
  state: RackEngineState;
  /** Reps held until today's written sets load (show "Syncing…"). */
  syncing: boolean;
  dispatch: (event: RackEvent) => void;
  executor: RackExecutor;
  today: TodayAthlete[];
  /** Re-read today's athletes (e.g. after the "+" tile adds someone). */
  refreshToday: () => Promise<void>;
}

export function useRackSession(opts: { rackId: string; orgId: string; sensor: OvrDevice }): UseRackSession {
  const { rackId, orgId, sensor } = opts;
  const client = supabase as unknown as RackClient & { rpc: RackClient['rpc'] };

  const staleTodayRef = useRef<() => void>(() => undefined);
  const { executor, api } = useMemo(() => {
    const api = createRackApi(client);
    const persist = createRackPersist({ client, orgId });
    const executor = createRackExecutor({
      engine: createRackEngine(rackId),
      api,
      persist,
      sensor,
      // The phone has an exercise open that today's list lacks → re-read today now.
      onStaleToday: () => staleTodayRef.current(),
    });
    return { executor, api };
    // One engine per rack/org/sensor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackId, orgId, sensor]);

  const [state, setState] = useState<RackEngineState>(() => executor.getState());
  const [syncing, setSyncing] = useState(false);
  const [today, setToday] = useState<TodayAthlete[]>([]);

  const refreshToday = useMemo(
    () => async () => {
      try {
        const athletes = await api.todaysAthletesForRack(orgId);
        setToday(athletes);
        executor.setToday(athletes);
      } catch (e) {
        console.warn('[rack] today load failed', e);
      }
    },
    [api, executor, orgId],
  );

  staleTodayRef.current = () => void refreshToday();

  useEffect(() => {
    setState(executor.getState());
    setSyncing(executor.isSyncing());
    const off = executor.subscribe((s, sy) => {
      setState(s);
      setSyncing(sy);
    });
    executor.start();

    const sync = (row: RackSessionRow | null) => {
      if (row) executor.dispatch({ type: 'sessionSync', row });
    };
    const readRow = () => api.getSession(rackId).then(sync).catch(e => console.warn('[rack] session read failed', e));

    const channel = supabase
      .channel(uniqueTopic(`rack_session:${rackId}`))
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'rack_sessions', filter: `rack_id=eq.${rackId}` },
        (payload: { new?: RackSessionRow }) => {
          if (payload.new && (payload.new as RackSessionRow).rack_id) sync(payload.new as RackSessionRow);
        },
      )
      // A rep removed from the athlete's phone (rack_remove_rep): drop it from
      // the live / just-ended set here too, so the set end never writes it back.
      .on(
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'vbt_reps', filter: `rack_id=eq.${rackId}` },
        (payload: { new?: { client_rep_id?: string; removed_at?: string | null } }) => {
          const r = payload.new;
          if (r?.client_rep_id && r.removed_at) void executor.removeRep(r.client_rep_id, { remote: true });
        },
      )
      .subscribe((status: string) => {
        // (Re)subscribed: rows may have been missed while disconnected, and
        // the network is back — flush both queues now.
        if (status === 'SUBSCRIBED') {
          readRow();
          executor.flush();
        }
      });

    const offRep = sensor.onRep((rep, receivedAtMs) => executor.dispatch({ type: 'rep', rep }, receivedAtMs));

    readRow();
    refreshToday();

    return () => {
      offRep();
      off();
      executor.stop();
      supabase.removeChannel(channel);
    };
  }, [executor, api, rackId, sensor, refreshToday]);

  return { state, syncing, dispatch: executor.dispatch, executor, today, refreshToday };
}
