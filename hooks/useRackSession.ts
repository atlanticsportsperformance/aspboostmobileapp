/**
 * Rack iPad session: one engine + executor per rack. Feeds the server's
 * `rack_sessions` row (initial read, realtime, and every RPC's returned row)
 * into the engine as `sessionSync`, sensor reps as `rep`, and today's
 * athletes as contextMeta/localContext. Exposes the engine state for the UI.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createRackApi, type RackClient, type TodayAthlete } from '../lib/rack/api';
import { createRackPersist } from '../lib/rack/persist';
import { createRackExecutor, type RackExecutor } from '../lib/rack/executor';
import { createRackEngine, type RackEngineState, type RackEvent, type RackSessionRow } from '../lib/rack/engine';
import type { OvrDevice } from '../lib/ovr/ovr-device';

export interface UseRackSession {
  state: RackEngineState;
  dispatch: (event: RackEvent) => void;
  executor: RackExecutor;
  today: TodayAthlete[];
  /** Re-read today's athletes (e.g. after the "+" tile adds someone). */
  refreshToday: () => Promise<void>;
}

export function useRackSession(opts: { rackId: string; orgId: string; sensor: OvrDevice }): UseRackSession {
  const { rackId, orgId, sensor } = opts;
  const client = supabase as unknown as RackClient & { rpc: RackClient['rpc'] };

  const { executor, api } = useMemo(() => {
    const api = createRackApi(client);
    const persist = createRackPersist({ client, orgId });
    const executor = createRackExecutor({ engine: createRackEngine(rackId), api, persist, sensor });
    return { executor, api };
    // One engine per rack/org/sensor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackId, orgId, sensor]);

  const [state, setState] = useState<RackEngineState>(() => executor.getState());
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

  useEffect(() => {
    setState(executor.getState());
    const off = executor.subscribe(setState);
    executor.start();

    const sync = (row: RackSessionRow | null) => {
      if (row) executor.dispatch({ type: 'sessionSync', row });
    };
    const readRow = () => api.getSession(rackId).then(sync).catch(e => console.warn('[rack] session read failed', e));

    const channel = supabase
      .channel(`rack_session:${rackId}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'rack_sessions', filter: `rack_id=eq.${rackId}` },
        (payload: { new?: RackSessionRow }) => {
          if (payload.new && (payload.new as RackSessionRow).rack_id) sync(payload.new as RackSessionRow);
        },
      )
      .subscribe((status: string) => {
        // (Re)subscribed: rows may have been missed while disconnected.
        if (status === 'SUBSCRIBED') readRow();
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

  return { state, dispatch: executor.dispatch, executor, today, refreshToday };
}
