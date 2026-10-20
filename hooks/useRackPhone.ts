/**
 * Athlete phone ↔ rack. Self-only: everything runs only when the signed-in
 * user IS this athlete (athletes.user_id = auth.uid()); a coach or guardian
 * viewing the workout gets an inert hook (hasRacks false).
 *
 * - The banner list (rack_list_for_me) refreshes on mount, screen focus, app
 *   foreground, pull-to-refresh and after every RPC — never polled in browse.
 * - While the athlete is ON a rack (active or queued): a realtime channel per
 *   rack (filter rack_id=eq.<id>) plus a 10 s poll; each tick also re-reads the
 *   reps (backfill) and calls onTick (pending set rows).
 * - Rep chips (subscribeMyRack) only while the exercise screen shows rack /
 *   sensor rows (a saved rack row, or this exercise being lifted on the rack)
 *   and the app is in the foreground — the live row's and the saved rows'
 *   (long-press → remove a rep, rack_remove_rep); removals and moves arrive as
 *   vbt_reps UPDATEs, and every (re)subscribe / refresh rebuilds them.
 * - While active: the debounced phone context with an exact echo guard, and
 *   rack_request_end_set.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { createRackApi, type RackClient, type RackListItem } from '../lib/rack/api';
import type { RackSessionRow } from '../lib/rack/engine';
import { subscribeMyRack, uniqueTopic, type RepChip } from '../lib/rack/phone';
import {
  RACK_POLL_MS,
  bannerState,
  createContextSender,
  endedSets,
  newerRow,
  rackErrorText,
  type BannerState,
  type EndedSet,
  type PhoneContext,
  type RackCtx,
} from '../lib/rack/phoneView';

/** rack_sessions bursts (a move bumps several rows) → one re-read. */
export const RACK_CHANGE_DEBOUNCE_MS = 400;

export interface RackPhone {
  /** Self + the org has at least one active rack (everything else is guarded by this). */
  hasRacks: boolean;
  /** The signed-in user IS this athlete (the phone-direct sensor needs it too). */
  isSelf: boolean;
  /** On a rack: active or queued (the phone sensor stays off then). */
  onRack: boolean;
  banner: BannerState | null;
  error: string | null;
  busy: boolean;
  join: (rackId: string) => void;
  imUp: (rackId: string) => void;
  leave: (rackId: string) => void;
  /** Re-read the list + my sessions (pull-to-refresh, focus). */
  refresh: () => Promise<void>;
  /** The session this athlete is the active lifter on, else null. */
  activeSession: RackSessionRow | null;
  activeRackName: string | null;
  /** Bumps on every inactive→active transition (follow baseline). */
  activation: number;
  /** Chips of one set (empty when none yet). */
  chipsFor: (workoutInstanceId: string, routineExerciseId: string, setNumber: number) => RepChip[];
  /** Remove a bad rep (the athlete themself): rack_remove_rep; its set row is recomputed. */
  removeRep: (clientRepId: string) => Promise<void>;
  /** Report the open exercise / set / load (debounced unless immediate; ignored unless active). */
  setContext: (ctx: PhoneContext | null, opts?: { immediate?: boolean }) => void;
  /** Exact echo test against the phone's own sent context. */
  isEcho: (ctx: RackCtx) => boolean;
  sentThisActivation: () => boolean;
  requestEndSet: (rackId: string) => Promise<unknown>;
}

export function useRackPhone(opts: {
  athleteId: string;
  /** A set this athlete was lifting stopped being lifted (the rack is writing it). */
  onSetEnded?: (ended: EndedSet) => void;
  /** Every 10 s while on a rack (re-read pending set rows). */
  onTick?: () => void;
  /** The exercise screen's routine exercise (null = overview / closed). */
  exerciseOpen?: string | null;
  /** That exercise shows saved rack / sensor rows. */
  savedRackRows?: boolean;
  /**
   * A rack row changed (realtime — rack_move_set / rack_move_reps touch every
   * rack the from/to athletes are on), the screen refreshed (focus,
   * foreground, pull), or one of my reps was updated (removed / moved): re-read
   * the open exercise's set rows. Debounced.
   */
  onRackChange?: () => void;
}): RackPhone {
  const { athleteId } = opts;
  const api = useMemo(() => createRackApi(supabase as unknown as RackClient), []);

  const [isSelf, setIsSelf] = useState(false);
  const [list, setList] = useState<RackListItem[]>([]);
  const [sessions, setSessions] = useState<RackSessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chipTick, setChipTick] = useState(0);
  const [activation, setActivation] = useState(0);
  const sessionsRef = useRef<RackSessionRow[]>([]);
  const cbRef = useRef(opts);
  cbRef.current = opts;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rackChanged = useCallback(() => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => {
      changeTimer.current = null;
      if (mounted.current) cbRef.current.onRackChange?.();
    }, RACK_CHANGE_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
  }, []);

  // I5: self only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The local session (no GoTrue round trip per logger mount — M4).
        const { data: auth } = await supabase.auth.getSession();
        const uid = auth?.session?.user?.id;
        if (!uid) return;
        const { data } = await supabase.from('athletes').select('id').eq('user_id', uid);
        if (!cancelled) setIsSelf(((data as { id: string }[]) ?? []).some(a => a.id === athleteId));
      } catch (e) {
        console.warn('[rack phone] self check failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [athleteId]);

  const applySessions = useCallback((rows: RackSessionRow[]) => {
    const prevById = new Map(sessionsRef.current.map(r => [r.rack_id, r]));
    // A late row never rolls a rack back (updated_at).
    const mine = rows
      .filter(r => r.active_athlete_id === athleteId || (r.queue ?? []).includes(athleteId))
      .map(r => (newerRow(prevById.get(r.rack_id), r) ? r : prevById.get(r.rack_id)!));
    const wasActive = sessionsRef.current.some(r => r.active_athlete_id === athleteId);
    const ended = endedSets(sessionsRef.current, mine, athleteId);
    sessionsRef.current = mine;
    if (!mounted.current) return;
    setSessions(mine);
    if (!wasActive && mine.some(r => r.active_athlete_id === athleteId)) setActivation(a => a + 1);
    ended.forEach(e => cbRef.current.onSetEnded?.(e));
  }, [athleteId]);
  const applySessionsRef = useRef(applySessions);
  applySessionsRef.current = applySessions;

  const readSessions = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('rack_sessions')
      .select('*')
      .or(`active_athlete_id.eq.${athleteId},queue.cs.{${athleteId}}`);
    if (e) throw e;
    applySessionsRef.current((data as RackSessionRow[]) ?? []);
  }, [athleteId]);

  const refresh = useCallback(async () => {
    if (!isSelf) return;
    try {
      const racks = await api.listForMe();
      if (!mounted.current) return;
      setList(racks);
      if (racks.length === 0) {
        applySessionsRef.current([]);
        return;
      }
      await readSessions();
      // Removals / moves made elsewhere (the iPad) — rebuild the chips, re-read the open rows.
      void subRef.current?.backfill();
      rackChanged();
    } catch (e) {
      console.warn('[rack phone] refresh failed', e);
    }
  }, [api, isSelf, readSessions, rackChanged]);

  // Mount + screen focus + app foreground (browse mode is never polled).
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  useEffect(() => {
    if (!isSelf) return;
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [isSelf, refresh]);

  const hasRacks = isSelf && list.length > 0;
  const onRackIds = useMemo(() => sessions.map(s => s.rack_id).sort().join(','), [sessions]);
  const activeSession = useMemo(
    () => (hasRacks ? sessions.find(s => s.active_athlete_id === athleteId) ?? null : null),
    [sessions, athleteId, hasRacks],
  );

  // Rep chips: only while the exercise screen shows rack / sensor rows, app in the foreground.
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => setForeground(st === 'active'));
    return () => sub.remove();
  }, []);
  const liveHere = !!opts.exerciseOpen && !!activeSession && activeSession.state === 'lifting' && activeSession.routine_exercise_id === opts.exerciseOpen;
  const chipsWanted = hasRacks && foreground && !!opts.exerciseOpen && (!!opts.savedRackRows || liveHere);
  const subRef = useRef<ReturnType<typeof subscribeMyRack> | null>(null);
  useEffect(() => {
    if (!chipsWanted) return;
    const sub = subscribeMyRack(
      athleteId,
      () => {
        if (mounted.current) setChipTick(t => t + 1);
      },
      undefined,
      // A rep of mine was removed / moved (iPad): the saved row's REPS / avg changed too.
      () => rackChanged(),
    );
    subRef.current = sub;
    return () => {
      sub.unsubscribe();
      if (subRef.current === sub) subRef.current = null;
    };
  }, [chipsWanted, athleteId]);

  // I2: realtime per rack I'm on + 10 s poll — only while on a rack.
  useEffect(() => {
    if (!hasRacks || !onRackIds) return;
    const channels = onRackIds.split(',').map(rackId =>
      supabase
        .channel(uniqueTopic(`rack_session:${rackId}:me`))
        .on(
          'postgres_changes' as any,
          { event: '*', schema: 'public', table: 'rack_sessions', filter: `rack_id=eq.${rackId}` },
          () => {
            readSessions().catch(e => console.warn('[rack phone] session read failed', e));
            // A move touches both athletes' rack rows: chips + the open exercise's rows re-read.
            void subRef.current?.backfill();
            rackChanged();
          },
        )
        .subscribe(),
    );
    const poll = setInterval(() => {
      void refresh();
      if (subRef.current && sessionsRef.current.some(s => s.active_athlete_id === athleteId && s.state === 'lifting')) {
        void subRef.current.backfill();
      }
      cbRef.current.onTick?.();
    }, RACK_POLL_MS);
    return () => {
      clearInterval(poll);
      channels.forEach(c => supabase.removeChannel(c));
    };
  }, [hasRacks, onRackIds, athleteId, readSessions, refresh, rackChanged]);

  const activeRackName = activeSession ? list.find(r => r.rackId === activeSession.rack_id)?.name ?? null : null;

  const chipsFor = useCallback(
    (wi: string, re: string, n: number) => subRef.current?.chipsFor(wi, re, n) ?? [],
    // chipTick: new chips → new function identity → consumers re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chipTick, chipsWanted],
  );

  const removeRep = useCallback(async (clientRepId: string) => {
    await api.removeRep(clientRepId);
    void subRef.current?.backfill();
  }, [api]);

  // An RPC's returned row is the newest state of that rack (routed through a ref: M8).
  const applyReturned = useCallback((row: unknown) => {
    const r = row as RackSessionRow | null;
    if (!r || !r.rack_id) return;
    const others = sessionsRef.current.filter(s => s.rack_id !== r.rack_id);
    applySessionsRef.current([...others, r]);
  }, []);

  // Phone context: debounced 300 ms (immediate on activation), active only.
  const sender = useMemo(
    () =>
      createContextSender((rackId, ctx) =>
        api
          .setPhoneContext(rackId, ctx)
          .then(row => applyReturned(row))
          .catch(e => console.warn('[rack phone] context failed', e)),
      ),
    [api, applyReturned],
  );
  useEffect(() => () => sender.cancel(), [sender]);
  const activeRackId = activeSession?.rack_id ?? null;
  const setContext = useCallback(
    (ctx: PhoneContext | null, o?: { immediate?: boolean }) =>
      sender.update(activeRackId, activeRackId ? ctx : null, o),
    [sender, activeRackId],
  );

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
    [applyReturned, refresh],
  );

  const join = useCallback((rackId: string) => run(() => api.join(rackId)), [api, run]);
  const imUp = useCallback((rackId: string) => run(() => api.imUp(rackId)), [api, run]);
  const leave = useCallback((rackId: string) => run(() => api.leave(rackId)), [api, run]);
  const requestEndSet = useCallback(
    (rackId: string) => api.requestEndSet(rackId).then(row => { applyReturned(row); return row; }),
    [api, applyReturned],
  );

  const banner = useMemo(
    () => (hasRacks ? bannerState(list, sessions, athleteId) : null),
    [hasRacks, list, sessions, athleteId],
  );

  const onRack = banner?.mode === 'active' || banner?.mode === 'queued';

  return {
    hasRacks,
    isSelf,
    onRack,
    banner,
    error,
    busy,
    join,
    imUp,
    leave,
    refresh,
    activeSession,
    activeRackName,
    activation,
    chipsFor,
    removeRep,
    setContext,
    isEcho: sender.isEcho,
    sentThisActivation: sender.sentThisActivation,
    requestEndSet,
  };
}
