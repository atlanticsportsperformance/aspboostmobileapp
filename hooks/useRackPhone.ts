/**
 * Athlete phone ↔ rack. Reads the org's racks (rack_list_for_me) and the
 * rack_sessions rows RLS lets this athlete read (active or queued), refreshed
 * on realtime rack_sessions changes with a 10 s poll fallback. Exposes the
 * banner state + join / I'm up / leave, the live chips (realtime vbt_reps via
 * subscribeMyRack, only while active), the debounced phone context and the
 * Done-while-live request. An org with no active rack gets nothing: no
 * banner, no poll, no realtime.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { createRackApi, type RackClient, type RackListItem } from '../lib/rack/api';
import type { RackSessionRow } from '../lib/rack/engine';
import { subscribeMyRack, uniqueTopic, type RepChip } from '../lib/rack/phone';
import {
  RACK_POLL_MS,
  bannerState,
  createContextSender,
  endedSets,
  rackErrorText,
  type BannerState,
  type EndedSet,
  type PhoneContext,
} from '../lib/rack/phoneView';

export interface RackPhone {
  /** The org has at least one active rack (everything else is guarded by this). */
  hasRacks: boolean;
  banner: BannerState | null;
  error: string | null;
  busy: boolean;
  join: (rackId: string) => void;
  imUp: (rackId: string) => void;
  leave: (rackId: string) => void;
  /** The session this athlete is the active lifter on, else null. */
  activeSession: RackSessionRow | null;
  activeRackName: string | null;
  /** Chips of one set (empty when none / not active). */
  chipsFor: (workoutInstanceId: string, routineExerciseId: string, setNumber: number) => RepChip[];
  /** Report the open exercise / set / load (debounced; ignored unless active). */
  setContext: (ctx: PhoneContext | null) => void;
  requestEndSet: (rackId: string) => Promise<unknown>;
  /** The phone's last context write (echo guard for following the rack). */
  lastSent: () => { reId: string | null; at: number };
}

export function useRackPhone(opts: {
  athleteId: string;
  /** A set this athlete was lifting stopped being lifted (the rack is writing it). */
  onSetEnded?: (ended: EndedSet) => void;
}): RackPhone {
  const { athleteId } = opts;
  const api = useMemo(() => createRackApi(supabase as unknown as RackClient), []);

  const [list, setList] = useState<RackListItem[]>([]);
  const [sessions, setSessions] = useState<RackSessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chipTick, setChipTick] = useState(0);
  const sessionsRef = useRef<RackSessionRow[]>([]);
  const onSetEndedRef = useRef(opts.onSetEnded);
  onSetEndedRef.current = opts.onSetEnded;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const applySessions = useCallback((rows: RackSessionRow[]) => {
    const mine = rows.filter(r => r.active_athlete_id === athleteId || (r.queue ?? []).includes(athleteId));
    const ended = endedSets(sessionsRef.current, mine, athleteId);
    sessionsRef.current = mine;
    if (!mounted.current) return;
    setSessions(mine);
    ended.forEach(e => onSetEndedRef.current?.(e));
  }, [athleteId]);

  const refresh = useCallback(async () => {
    try {
      const racks = await api.listForMe();
      if (!mounted.current) return;
      setList(racks);
      if (racks.length === 0) {
        applySessions([]);
        return;
      }
      const { data, error: e } = await supabase.from('rack_sessions').select('*');
      if (e) throw e;
      applySessions((data as RackSessionRow[]) ?? []);
    } catch (e) {
      console.warn('[rack phone] refresh failed', e);
    }
  }, [api, applySessions]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasRacks = list.length > 0;

  // Realtime + 10 s poll — only when the org has racks.
  useEffect(() => {
    if (!hasRacks) return;
    const channel = supabase
      .channel(uniqueTopic(`rack_sessions:me:${athleteId}`))
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'rack_sessions' }, () => {
        void refresh();
      })
      .subscribe();
    const poll = setInterval(() => void refresh(), RACK_POLL_MS);
    return () => {
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [hasRacks, athleteId, refresh]);

  const activeSession = useMemo(
    () => sessions.find(s => s.active_athlete_id === athleteId) ?? null,
    [sessions, athleteId],
  );
  const activeRackName = activeSession ? list.find(r => r.rackId === activeSession.rack_id)?.name ?? null : null;

  // Live chips: subscribe only while active.
  const subRef = useRef<ReturnType<typeof subscribeMyRack> | null>(null);
  const isActive = !!activeSession;
  useEffect(() => {
    if (!isActive) return;
    const sub = subscribeMyRack(athleteId, () => {
      if (mounted.current) setChipTick(t => t + 1);
    });
    subRef.current = sub;
    return () => {
      sub.unsubscribe();
      if (subRef.current === sub) subRef.current = null;
    };
  }, [isActive, athleteId]);

  const chipsFor = useCallback(
    (wi: string, re: string, n: number) => subRef.current?.chipsFor(wi, re, n) ?? [],
    // chipTick: new chips → new function identity → consumers re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chipTick, isActive],
  );

  // Phone context: debounced 300 ms, active only. lastSentRef stamps the send
  // and its reply, so the echo of the phone's own write is never "followed".
  const lastSentRef = useRef<{ reId: string | null; at: number }>({ reId: null, at: 0 });
  const sender = useMemo(
    () =>
      createContextSender((rackId, ctx) => {
        lastSentRef.current = { reId: ctx.routineExerciseId, at: Date.now() };
        return api
          .setPhoneContext(rackId, ctx)
          .then(row => {
            lastSentRef.current = { ...lastSentRef.current, at: Date.now() };
            applyReturned(row);
          })
          .catch(e => console.warn('[rack phone] context failed', e));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );
  useEffect(() => () => sender.cancel(), [sender]);
  const activeRackId = activeSession?.rack_id ?? null;
  const setContext = useCallback(
    (ctx: PhoneContext | null) => sender.update(activeRackId, activeRackId ? ctx : null),
    [sender, activeRackId],
  );

  // An RPC's returned row is the newest state of that rack.
  function applyReturned(row: unknown) {
    const r = row as RackSessionRow | null;
    if (!r || !r.rack_id) return;
    const others = sessionsRef.current.filter(s => s.rack_id !== r.rack_id);
    applySessions([...others, r]);
  }

  const run = useCallback(
    (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      fn()
        .then(row => {
          applyReturned(row);
          return refresh();
        })
        .catch(e => {
          if (mounted.current) setError(rackErrorText(e));
        })
        .finally(() => {
          if (mounted.current) setBusy(false);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh],
  );

  const join = useCallback((rackId: string) => run(() => api.join(rackId)), [api, run]);
  const imUp = useCallback((rackId: string) => run(() => api.imUp(rackId)), [api, run]);
  const leave = useCallback((rackId: string) => run(() => api.leave(rackId)), [api, run]);
  const requestEndSet = useCallback(
    (rackId: string) => api.requestEndSet(rackId).then(row => { applyReturned(row); return row; }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );

  const banner = useMemo(() => bannerState(list, sessions, athleteId), [list, sessions, athleteId]);

  return {
    hasRacks,
    banner,
    error,
    busy,
    join,
    imUp,
    leave,
    activeSession,
    activeRackName,
    chipsFor,
    setContext,
    requestEndSet,
    lastSent: () => lastSentRef.current,
  };
}
