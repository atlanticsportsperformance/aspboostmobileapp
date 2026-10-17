/**
 * Rack mode — the rack iPad's live screen. Landscape per the approved mock
 * docs/superpowers/mockups/rack-vbt/rack-live.html, portrait per
 * rack-portrait.html (web repo); the layout follows the window and re-flows
 * when the iPad rotates (lib/rack/orientation unlocks the rack routes on an
 * iPad; every other screen stays portrait).
 *
 * Wiring: useOvrDevice (real BLE, or the fake in the simulator / dev) →
 * useRackSession (sensor.onRep → executor `rep`; realtime rows → `sessionSync`;
 * executor runs persist + RPCs + sensor.writeLoad, derives the load (incl.
 * % targets), auto-picks a rack lift / applies the coach's pick and publishes
 * it via rack_set_ipad_context so the phone follows) → buildRackView → components. Today's athletes
 * refresh every 60 s into executor.setToday. The executor's flush / end-live /
 * unsaved count are registered for the PIN-exit drain.
 *
 * The live screen is NEVER unmounted by auth hiccups: a lost session or a
 * momentarily unresolved staff org shows an overlay on top of it, so the
 * sensor, the live set and its writes keep going. There is no sign-out here;
 * the only way out is the lock → PIN exit.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { useAuth } from '../../contexts/AuthContext';
import {
  endActiveRackSet,
  readRackDevice,
  saveRackDevice,
  setActiveRackEnder,
  setActiveRackFlusher,
  setActiveRackUnsaved,
  subscribeRackDevice,
  type RackDevice,
} from '../../lib/rack/device';
import { useRackStaffGuard } from '../../hooks/useRackStaffGuard';
import { useOvrDevice } from '../../hooks/useOvrDevice';
import { useRackSession } from '../../hooks/useRackSession';
import { createRackApi, type TodayExercise } from '../../lib/rack/api';
import type { RackContext } from '../../lib/rack/engine';
import { FakeOvrDevice } from '../../lib/ovr/fake-ovr';
import { buildRackView, phoneContextOfRow, RACK_COLORS, rackLayout, sensorPillOf } from '../../lib/rack/viewModel';
import RingDial from '../../components/rack/RingDial';
import StatBubble from '../../components/rack/StatBubble';
import RepBars from '../../components/rack/RepBars';
import AthleteTiles from '../../components/rack/AthleteTiles';
import AthleteCard from '../../components/rack/AthleteCard';
import SensorPill, { Pill } from '../../components/rack/SensorPill';
import DevSensorBar from '../../components/rack/DevSensorBar';

export const TODAY_REFRESH_MS = 60_000;
const RACK_LOOKUP_RETRY_MS = 10_000;
const CLOCK_MS = 60_000;
const TOAST_MS = 4_000;

export default function RackModeScreen() {
  const navigation = useNavigation<any>();
  useRackStaffGuard();
  const { session, staffOrgId } = useAuth();
  const [rack, setRack] = useState<RackDevice | null | undefined>(undefined);
  // Last known staff org: a momentary null (roles re-resolving, a failed
  // staff check) must not tear down the executor.
  const [orgId, setOrgId] = useState<string | null>(staffOrgId);
  useEffect(() => {
    if (staffOrgId) setOrgId(staffOrgId);
  }, [staffOrgId]);

  useEffect(() => {
    let alive = true;
    readRackDevice().then(d => alive && setRack(d));
    const off = subscribeRackDevice(d => setRack(d));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Android back never leaves Rack mode.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const signIn = async () => {
    // The Login screen may route away from Rack mode: save the live set first.
    await endActiveRackSet();
    navigation.navigate('Login');
  };

  return (
    <View style={styles.root}>
      {rack && orgId ? (
        <RackLive rack={rack} orgId={orgId} onLock={() => navigation.navigate('RackPinExit')} />
      ) : (
        <SafeAreaView style={styles.gate} edges={['top', 'bottom', 'left', 'right']}>
          <Text style={styles.gateSub}>Loading rack…</Text>
        </SafeAreaView>
      )}

      {/* Session lost (e.g. token refresh failed): overlay, never unmount; rack_device_v1 kept. */}
      {!session && (
        <SafeAreaView style={[StyleSheet.absoluteFill, styles.gate, styles.overlay]} edges={['top', 'bottom', 'left', 'right']}>
          <Ionicons name="lock-closed" size={28} color="rgba(255,255,255,0.5)" />
          <Text style={styles.gateTitle}>Sign in to resume {rack?.rackName ?? 'the rack'}</Text>
          <Text style={styles.gateSub}>A staff member needs to sign in. Reps keep saving on this iPad.</Text>
          <TouchableOpacity style={styles.gateBtn} onPress={signIn}>
            <Text style={styles.gateBtnTxt}>Staff sign in</Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}

      {/* Role gate: staff org not resolved right now — overlay over the running rack. */}
      {!!session && !staffOrgId && !!rack && !!orgId && (
        <View style={[StyleSheet.absoluteFill, styles.gate, styles.overlaySoft]} pointerEvents="auto">
          <Text style={styles.gateSub}>Checking staff access…</Text>
        </View>
      )}
    </View>
  );
}

function RackLive({ rack, orgId, onLock }: { rack: RackDevice; orgId: string; onLock: () => void }) {
  // A wall-mounted display: never auto-lock (BLE, realtime and the idle timer stop when suspended).
  useKeepAwake();
  const ovr = useOvrDevice();
  const { state, syncing, dispatch, executor, today, refreshToday } = useRackSession({
    rackId: rack.rackId,
    orgId,
    sensor: ovr.device,
  });
  const api = useMemo(() => createRackApi(), []);
  const fake = ovr.device instanceof FakeOvrDevice ? ovr.device : null;

  // PIN exit: end the live set, flush memory + disk, count memory-held writes.
  useEffect(() => {
    setActiveRackFlusher(() => executor.flush());
    setActiveRackEnder(() => executor.endLive());
    setActiveRackUnsaved(() => executor.unsavedCount());
    return () => {
      setActiveRackFlusher(null);
      setActiveRackEnder(null);
      setActiveRackUnsaved(null);
    };
  }, [executor]);

  // Today's athletes (tiles, contextMeta, localContext, derived load) every 60 s.
  useEffect(() => {
    const t = setInterval(() => {
      refreshToday();
    }, TODAY_REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshToday]);

  // Sensor: racks.ovr_device_name, exact. The cached name (rack_device_v1)
  // connects at once, even offline; the server lookup refreshes the cache.
  // No paired sensor → never connect (it could be another rack's OVR) —
  // except the dev / simulator fake.
  const [paired, setPaired] = useState<{ known: boolean; name: string | null }>(() =>
    rack.ovrDeviceName !== undefined ? { known: true, name: rack.ovrDeviceName ?? null } : { known: false, name: null },
  );
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const lookup = () => {
      api
        .listRacks(orgId)
        .then(racks => {
          if (!alive) return;
          const name = racks.find(r => r.id === rack.rackId)?.ovrDeviceName ?? null;
          setPaired({ known: true, name });
          if (rack.ovrDeviceName !== name) {
            saveRackDevice({ rackId: rack.rackId, rackName: rack.rackName, ovrDeviceName: name }).catch(e =>
              console.warn('[rack] caching the sensor name failed', e),
            );
          }
        })
        .catch(e => {
          console.warn('[rack] rack lookup failed; retrying', e);
          if (alive) retry = setTimeout(lookup, RACK_LOOKUP_RETRY_MS);
        });
    };
    lookup();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, orgId, rack.rackId]);

  const { connect, disconnect } = ovr;
  useEffect(() => {
    if (!paired.known) return;
    if (paired.name) connect(paired.name).catch(e => console.warn('[rack] sensor connect failed', e));
    else if (fake) connect().catch(e => console.warn('[rack] fake sensor connect failed', e));
    else disconnect();
  }, [paired.known, paired.name, fake, connect, disconnect]);

  // Clock: header minute + summary expiry (no 1 Hz re-render).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), CLOCK_MS);
    return () => clearInterval(t);
  }, []);

  // Where each athlete's phone was last seen (dimmed "On A2 · Box Jump" tiles).
  const [phoneContexts, setPhoneContexts] = useState<Record<string, RackContext>>({});
  useEffect(() => {
    const pc = phoneContextOfRow(state);
    if (!pc) return;
    setPhoneContexts(prev => {
      const old = prev[pc.athleteId];
      if (old && old.workoutInstanceId === pc.ctx.workoutInstanceId && old.routineExerciseId === pc.ctx.routineExerciseId) return prev;
      return { ...prev, [pc.athleteId]: pc.ctx };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session]);

  // Whose exercise the row holds (the iPad's published pick vs the phone's).
  const ipadOwned = executor.ipadOwnsContext();
  const view = useMemo(
    () => buildRackView({ state, today, rackName: rack.rackName, nowMs, phoneContexts, ipadOwned }),
    [state, today, rack.rackName, nowMs, phoneContexts, ipadOwned],
  );
  const expiresAt = view.summary?.expiresAtMs ?? null;
  useEffect(() => {
    if (expiresAt == null) return;
    const t = setTimeout(() => setNowMs(Date.now()), Math.max(0, expiresAt - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [expiresAt]);

  // A refused tile / "+" switch (e.g. the athlete is up on another rack).
  const [toast, setToast] = useState<string | null>(null);
  const prevSwitch = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSwitch.current;
    prevSwitch.current = state.switchingTo;
    if (prev && !state.switchingTo && state.activeAthleteId !== prev) {
      const name = today.find(a => a.athleteId === prev)?.firstName ?? 'That athlete';
      setToast(`${name} couldn't go up — on another rack?`);
      const t = setTimeout(() => setToast(null), TOAST_MS);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.switchingTo, state.activeAthleteId]);

  const pill = sensorPillOf(ovr.state, ovr.deviceName, paired.name, !!fake);

  // Layout: from the window (re-flows on rotation) and the SAFE-AREA height.
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const layout = rackLayout(width, height, insets);
  const portrait = layout.mode === 'portrait';

  const selectAthlete = useCallback((athleteId: string) => dispatch({ type: 'selectAthlete', athleteId }), [dispatch]);
  const activeId = state.activeAthleteId;
  // Coach pick (exercise + set) → published override; the phone follows.
  const pickExercise = (ex: TodayExercise, setNumber: number) => {
    if (activeId) executor.setOverride(activeId, ex, setNumber);
  };
  // Live picker rows from the resolver's own cached logs (no extra query); state
  // changes (log reads notify) re-render this.
  const pickerRows = activeId ? executor.pickerRows(activeId) : [];

  const dropColor = view.zone && view.dropPct != null && view.dropStopPct != null && view.dropPct >= view.dropStopPct ? RACK_COLORS.red : '#fff';
  const time = new Date(nowMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const header = (
    <View style={styles.top}>
      <View style={styles.rk}>
        <Text style={styles.rkTxt}>{rack.rackName.toUpperCase()}</Text>
      </View>
      <View style={styles.wk}>
        <Text style={styles.wkB} numberOfLines={1}>
          {view.workoutName ?? (view.athlete ? view.athlete.name : 'Waiting for a lifter')}
        </Text>
        <Text style={styles.wkS} numberOfLines={1}>
          {time} · {today.length} athlete{today.length === 1 ? '' : 's'} today
        </Text>
      </View>
      <View style={{ flex: 1 }} />
      {__DEV__ && fake && <DevSensorBar device={fake} zone={view.zone} />}
      {syncing && <Pill tone="syncing" label="Syncing…" />}
      <SensorPill pill={pill} />
      <TouchableOpacity style={styles.btn2} onPress={onLock} accessibilityLabel="Lock — exit Rack mode">
        <Ionicons name="lock-closed" size={16} color="rgba(255,255,255,0.75)" />
      </TouchableOpacity>
    </View>
  );

  const gauge = (
    <View style={[styles.card, styles.dialCard, portrait ? { minHeight: layout.dial + 72 } : { flex: 1 }]}>
      <View style={styles.cardh}>
        <View style={styles.status}>
          {!view.open && <View style={styles.statusDot} />}
          <Text style={styles.statusTxt} numberOfLines={1}>
            {view.statusText}
          </Text>
        </View>
        {view.dropCue && <Text style={styles.warn}>Speed dropped — rack it</Text>}
      </View>
      <View style={[styles.dialRow, { gap: portrait ? 36 : 28 }]}>
        <RingDial rep={view.lastRep} zone={view.zone} scaleV={view.scaleV} size={layout.dial} />
        <View style={[styles.bubs, { width: layout.bubble * 2 + 14 }]}>
          <StatBubble size={layout.bubble} label="REPS" value={String(view.fullReps)} sub={view.repsTarget != null ? `of ${view.repsTarget}` : 'counted'} />
          <StatBubble
            size={layout.bubble}
            label="SET"
            value={view.setNumber != null ? String(view.setNumber) : '—'}
            sub={view.setsPrescribed ? `of ${view.setsPrescribed}` : ''}
          />
          <StatBubble size={layout.bubble} label="BAR" value={view.loadLb != null ? String(view.loadLb) : '—'} sub="lb" />
          <StatBubble
            size={layout.bubble}
            label="SPEED DROP"
            value={view.dropPct != null ? `${view.dropPct}%` : '—'}
            valueColor={dropColor}
            sub={view.zone && view.dropStopPct != null ? `stop at ${view.dropStopPct}%` : ''}
          />
        </View>
      </View>
    </View>
  );

  const athleteCard = (
    <AthleteCard
      view={view}
      rackName={rack.rackName}
      layout={portrait ? 'row' : 'column'}
      compact={layout.compactCard}
      onDone={() => dispatch({ type: 'ipadDone' })}
      onPickExercise={pickExercise}
      pickerRows={pickerRows}
    />
  );

  const setAndReplay = (
    <View style={styles.row2}>
      <View style={[styles.card, styles.barsCard]}>
        <View style={styles.cardh}>
          <Text style={styles.k}>THIS SET</Text>
          <Text style={styles.s} numberOfLines={1}>
            {view.zone ? 'Shaded band = target speed' : 'No speed target for this exercise'}
          </Text>
        </View>
        <RepBars
          bars={view.bars}
          zone={view.zone}
          dropLineV={view.dropLineV}
          dropStopPct={view.dropStopPct}
          scaleV={view.scaleV}
          minHeight={layout.barsMin}
        />
      </View>
      <View style={[styles.card, { width: layout.sideW }]}>
        <View style={styles.cardh}>
          <Text style={styles.k}>REPLAY</Text>
        </View>
        <View style={styles.replayBody}>
          <Text style={styles.replayTxt}>Coming soon</Text>
        </View>
      </View>
    </View>
  );

  const tiles = (
    <AthleteTiles
      tiles={view.tiles}
      addable={view.addable}
      onSelect={selectAthlete} onAdd={selectAthlete}
      height={layout.tilesH}
      compact={portrait}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      {/* One tree for both orientations (rotation never remounts the dial,
          the card or an open sheet): only row 1's direction flips. */}
      <View style={styles.ip}>
        {header}
        <View style={portrait ? styles.row1Portrait : styles.row1}>
          {gauge}
          {athleteCard}
        </View>
        {setAndReplay}
        {tiles}
      </View>
      {!!toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastTxt}>{toast}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: RACK_COLORS.bg },
  safe: { flex: 1, backgroundColor: RACK_COLORS.bg },
  ip: { flex: 1, backgroundColor: RACK_COLORS.bg, padding: 16, gap: 16, position: 'relative' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 44, paddingHorizontal: 4 },
  rk: { backgroundColor: RACK_COLORS.acc, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  rkTxt: { color: RACK_COLORS.accInk, fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  wk: { flexShrink: 1, minWidth: 0 },
  wkB: { fontSize: 15, fontWeight: '700', color: '#fff' },
  wkS: { fontSize: 12, color: RACK_COLORS.mut },
  btn2: { borderWidth: 1, borderColor: RACK_COLORS.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  row1: { flexDirection: 'row', gap: 16 },
  row1Portrait: { flexDirection: 'column', gap: 16 },
  row2: { flex: 1, flexDirection: 'row', gap: 16, minHeight: 0 },
  card: {
    backgroundColor: RACK_COLORS.card,
    borderWidth: 1,
    borderColor: RACK_COLORS.line,
    borderRadius: 18,
    padding: 20,
    position: 'relative',
    minHeight: 0,
  },
  dialCard: { flexDirection: 'column' },
  barsCard: { flex: 1, flexDirection: 'column' },
  cardh: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, minHeight: 16 },
  k: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: 'rgba(255,255,255,0.5)' },
  s: { fontSize: 12, color: RACK_COLORS.mut, flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: RACK_COLORS.acc,
    shadowColor: RACK_COLORS.acc,
    shadowOpacity: 1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  statusTxt: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
  warn: { fontSize: 13, fontWeight: '800', color: RACK_COLORS.red },
  dialRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  bubs: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  replayBody: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#0b0c0e',
    borderWidth: 1,
    borderColor: RACK_COLORS.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replayTxt: { fontSize: 13, color: 'rgba(255,255,255,0.35)' },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    top: 72,
    backgroundColor: 'rgba(20,21,24,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  toastTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  gate: { flex: 1, backgroundColor: RACK_COLORS.bg, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  overlay: { backgroundColor: 'rgba(8,9,10,0.97)' },
  overlaySoft: { backgroundColor: 'rgba(8,9,10,0.85)' },
  gateTitle: { fontSize: 30, fontWeight: '700', color: '#fff', textAlign: 'center' },
  gateSub: { fontSize: 14, color: RACK_COLORS.mut, textAlign: 'center' },
  gateBtn: { marginTop: 12, backgroundColor: RACK_COLORS.acc, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28 },
  gateBtnTxt: { color: RACK_COLORS.accInk, fontSize: 16, fontWeight: '800' },
});
