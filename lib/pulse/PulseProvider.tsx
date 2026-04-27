/**
 * PulseProvider — shared BLE stack + wizard control for the pulse feature.
 *
 * Wraps any screen that needs to talk to the Motus Pulse sensor. The provider
 * owns a single set of BLE hooks (`usePulseDevice`, `useLiveSession`,
 * `usePulseSync`) so that the Monitor, the wizard modal, and any other
 * consumer all share ONE device connection. It also owns the wizard's
 * open/closed state so the Monitor trigger button can open the modal from
 * anywhere in the tree.
 *
 * The provider also fetches the athlete's anthro (height + weight) once on
 * mount, since every downstream hook needs `{heightM, weightKg}` for the
 * throw-decoder workload math. Parent screens can still pre-fetch anthro
 * themselves if they need it — the provider doesn't duplicate the Monitor's
 * gauge data, it just scopes the BLE + wizard lifecycle.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '../supabase';
import {
  useBluetoothSupport,
  usePulseDevice,
  useLiveSession,
  usePulseSync,
} from './ble/hooks';

export interface PulseAnthro {
  heightInches: number | null;
  weightLbs: number | null;
}

export interface PulseContextValue {
  athleteId: string;
  orgId: string;
  anthro: PulseAnthro;
  anthroLoaded: boolean;
  profileComplete: boolean;
  ble: ReturnType<typeof useBluetoothSupport>;
  dev: ReturnType<typeof usePulseDevice>;
  live: ReturnType<typeof useLiveSession>;
  sync: ReturnType<typeof usePulseSync>;
  // Wizard control
  wizardOpen: boolean;
  openWizard(): void;
  closeWizard(): void;
  /**
   * Persist the athlete's height/weight to Supabase AND update local state so
   * `profileComplete` flips immediately without a screen remount. Called from
   * the in-wizard anthro entry step so the user can go straight from "Set
   * height & weight" → Start Live without leaving the modal.
   */
  saveAnthro(next: PulseAnthro): Promise<void>;
}

const PulseContext = createContext<PulseContextValue | null>(null);

export function usePulse(): PulseContextValue {
  const ctx = useContext(PulseContext);
  if (!ctx) {
    throw new Error('usePulse() must be used inside a <PulseProvider>');
  }
  return ctx;
}

/** Optional variant: returns null outside a provider. Used by the Monitor so
 *  it can fall back to self-owned hooks when mounted outside a provider. */
export function usePulseOptional(): PulseContextValue | null {
  return useContext(PulseContext);
}

interface ProviderProps {
  athleteId: string;
  orgId: string;
  /** Parent can pre-populate anthro (e.g. WorkloadScreen already has it).
   *  If provided, skips the internal fetch. */
  initialAnthro?: PulseAnthro;
  children: React.ReactNode;
}

export function PulseProvider({
  athleteId,
  orgId,
  initialAnthro,
  children,
}: ProviderProps) {
  // PERF instrumentation — see if the provider is re-rendering on day switch
  // and whether its context value ref is staying stable.
  const _perfT0 = useRef(performance.now());
  _perfT0.current = performance.now();
  const _renderCountRef = useRef(0);
  _renderCountRef.current += 1;

  const [anthro, setAnthro] = useState<PulseAnthro>(
    initialAnthro ?? { heightInches: null, weightLbs: null },
  );
  const [anthroLoaded, setAnthroLoaded] = useState(!!initialAnthro);

  // Self-fetch anthro only if the parent didn't pre-populate it. Athletes row
  // is the common case; falls back to cmj/mocap if h/w are missing there.
  useEffect(() => {
    if (initialAnthro) return;
    let active = true;
    (async () => {
      try {
        const { data: ath } = await supabase
          .from('athletes')
          .select('height_inches, weight_lbs')
          .eq('id', athleteId)
          .maybeSingle();
        if (!active) return;
        let h: number | null = ath?.height_inches ?? null;
        let w: number | null = ath?.weight_lbs ?? null;
        if (w == null) {
          const { data: cmj } = await supabase
            .from('cmj_tests')
            .select('body_weight_lbs_trial_value')
            .eq('athlete_id', athleteId)
            .order('recorded_utc', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (cmj?.body_weight_lbs_trial_value != null) {
            w = cmj.body_weight_lbs_trial_value;
          }
        }
        if (h == null || w == null) {
          const { data: mocap } = await supabase
            .from('mocap_sessions')
            .select('athlete_height_inches, athlete_weight_lbs')
            .eq('athlete_id', athleteId)
            .order('session_date', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (h == null && mocap?.athlete_height_inches != null) {
            h = mocap.athlete_height_inches;
          }
          if (w == null && mocap?.athlete_weight_lbs != null) {
            w = mocap.athlete_weight_lbs;
          }
        }
        if (!active) return;
        setAnthro({
          heightInches: h != null ? Number(h) : null,
          weightLbs: w != null ? Math.round(Number(w) * 10) / 10 : null,
        });
      } finally {
        if (active) setAnthroLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [athleteId, initialAnthro]);

  // Keep internal anthro in sync with prop updates (parent may lazy-load it).
  // Shallow-compare the values so a parent that passes a fresh object reference
  // on every render doesn't thrash this effect — only commit when the actual
  // height/weight numbers change.
  useEffect(() => {
    if (!initialAnthro) return;
    setAnthro((prev) => {
      if (
        prev.heightInches === initialAnthro.heightInches &&
        prev.weightLbs === initialAnthro.weightLbs
      ) {
        return prev;
      }
      return initialAnthro;
    });
    setAnthroLoaded(true);
  }, [initialAnthro]);

  // Conversion factors per PORT_TO_MOBILE.md — matched to the binary's
  // float-precision math so byte-exact decoder output isn't broken by an
  // imprecise lb→kg conversion.
  const heightM = (anthro.heightInches ?? 0) * 0.0254;
  const weightKg = (anthro.weightLbs ?? 0) * 0.45359237;
  const profileComplete = heightM > 0 && weightKg > 0;

  const ble = useBluetoothSupport();
  const dev = usePulseDevice();

  const live = useLiveSession({
    device: dev.device,
    athlete: { heightM, weightKg },
    supabase: supabase as any,
    orgId,
    athleteId,
  });

  const sync = usePulseSync({
    device: dev.device,
    athlete: { heightM, weightKg },
    supabase: supabase as any,
    orgId,
    athleteId,
  });

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const openWizard = useCallback(() => setWizardOpen(true), []);
  const closeWizard = useCallback(() => setWizardOpen(false), []);

  // Inline save path used by the wizard's anthro entry step. Writes the
  // canonical numeric columns (height_inches integer, weight_lbs numeric)
  // and updates local state so `profileComplete` flips immediately.
  const saveAnthro = useCallback(
    async (next: PulseAnthro): Promise<void> => {
      const { error } = await supabase
        .from('athletes')
        .update({
          height_inches: next.heightInches,
          weight_lbs: next.weightLbs,
        })
        .eq('id', athleteId);
      if (error) throw new Error(error.message);
      setAnthro(next);
      setAnthroLoaded(true);
    },
    [athleteId],
  );

  const value = useMemo<PulseContextValue>(
    () => ({
      athleteId,
      orgId,
      anthro,
      anthroLoaded,
      profileComplete,
      ble,
      dev,
      live,
      sync,
      wizardOpen,
      openWizard,
      closeWizard,
      saveAnthro,
    }),
    [
      athleteId,
      orgId,
      anthro,
      anthroLoaded,
      profileComplete,
      ble,
      dev,
      live,
      sync,
      wizardOpen,
      openWizard,
      closeWizard,
      saveAnthro,
    ],
  );

  // PERF: flag when the context value ref actually changed vs the prior render.
  const _prevValueRef = useRef<PulseContextValue | null>(null);
  const _prevValue = _prevValueRef.current;
  _prevValueRef.current = value;
  useEffect(() => {
    const dt = performance.now() - _perfT0.current;
    const changed = _prevValue !== value;
    if (dt > 2 || changed) {
      console.log(
        `[WorkloadPerf] PulseProvider render #${_renderCountRef.current}: ${dt.toFixed(1)}ms, ` +
        `value ${changed ? 'CHANGED' : 'stable'}`,
      );
      if (changed && _prevValue) {
        const diffs: string[] = [];
        (Object.keys(value) as (keyof PulseContextValue)[]).forEach((k) => {
          if (_prevValue[k] !== value[k]) diffs.push(k);
        });
        if (diffs.length) console.log(`[WorkloadPerf]   diff keys: ${diffs.join(', ')}`);
      }
    }
  });

  return <PulseContext.Provider value={value}>{children}</PulseContext.Provider>;
}
