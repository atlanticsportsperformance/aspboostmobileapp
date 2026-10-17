/**
 * Rack mode — the rack iPad's live screen (landscape; layout per the approved
 * mock docs/superpowers/mockups/rack-vbt/rack-live.html in the web repo).
 *
 * Wiring: useOvrDevice (real BLE, or the fake in the simulator / dev) →
 * useRackSession (sensor.onRep → executor `rep`; realtime rows → `sessionSync`;
 * executor runs persist + RPCs + sensor.writeLoad) → buildRackView → components.
 * Today's athletes refresh every 60 s into executor.setToday. The executor's
 * flush is registered for the PIN-exit drain.
 *
 * There is no sign-out here: the only way out is the lock → PIN exit. If the
 * auth session ends, a "Sign in to resume" gate shows; rack_device_v1 is kept
 * so boot-to-rack resumes after a staff sign-in.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { readRackDevice, setActiveRackFlusher, subscribeRackDevice, type RackDevice } from '../../lib/rack/device';
import { useRackStaffGuard } from '../../hooks/useRackStaffGuard';
import { useOvrDevice } from '../../hooks/useOvrDevice';
import { useRackSession } from '../../hooks/useRackSession';
import { createRackApi, type TodayExercise } from '../../lib/rack/api';
import { nextContext, type RackContext } from '../../lib/rack/engine';
import { FakeOvrDevice } from '../../lib/ovr/fake-ovr';
import {
  buildRackView,
  localContextFor,
  phoneContextOfRow,
  RACK_COLORS,
  sensorPillOf,
} from '../../lib/rack/viewModel';
import RingDial from '../../components/rack/RingDial';
import StatBubble from '../../components/rack/StatBubble';
import RepBars from '../../components/rack/RepBars';
import AthleteTiles from '../../components/rack/AthleteTiles';
import AthleteCard from '../../components/rack/AthleteCard';
import SensorPill, { Pill } from '../../components/rack/SensorPill';
import DevSensorBar from '../../components/rack/DevSensorBar';

export const TODAY_REFRESH_MS = 60_000;
const RACK_LOOKUP_RETRY_MS = 10_000;

export default function RackModeScreen() {
  const navigation = useNavigation<any>();
  useRackStaffGuard();
  const { session, staffOrgId } = useAuth();
  const [rack, setRack] = useState<RackDevice | null | undefined>(undefined);

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

  // Session lost (e.g. token refresh failed): keep rack_device_v1, ask staff to sign in.
  if (!session) {
    return (
      <SafeAreaView style={styles.gate} edges={['top', 'bottom', 'left', 'right']}>
        <Ionicons name="lock-closed" size={28} color="rgba(255,255,255,0.5)" />
        <Text style={styles.gateTitle}>Sign in to resume {rack?.rackName ?? 'the rack'}</Text>
        <Text style={styles.gateSub}>A staff member needs to sign in. Saved reps are kept on this iPad.</Text>
        <TouchableOpacity style={styles.gateBtn} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.gateBtnTxt}>Staff sign in</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!rack || !staffOrgId) {
    return (
      <SafeAreaView style={styles.gate} edges={['top', 'bottom', 'left', 'right']}>
        <Text style={styles.gateSub}>Loading rack…</Text>
      </SafeAreaView>
    );
  }

  return <RackLive rack={rack} orgId={staffOrgId} onLock={() => navigation.navigate('RackPinExit')} />;
}

function RackLive({ rack, orgId, onLock }: { rack: RackDevice; orgId: string; onLock: () => void }) {
  const ovr = useOvrDevice();
  const { state, syncing, dispatch, executor, today, refreshToday } = useRackSession({
    rackId: rack.rackId,
    orgId,
    sensor: ovr.device,
  });
  const api = useMemo(() => createRackApi(), []);

  // PIN exit drains the executor's in-memory writes too.
  useEffect(() => {
    setActiveRackFlusher(() => executor.flush());
    return () => setActiveRackFlusher(null);
  }, [executor]);

  // Today's athletes (tiles, contextMeta, localContext) every 60 s.
  useEffect(() => {
    const t = setInterval(() => {
      refreshToday();
    }, TODAY_REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshToday]);

  // Sensor: racks.ovr_device_name (exact); none paired → first OVR_Velocity*.
  const [pairedName, setPairedName] = useState<string | null>(null);
  const { connect } = ovr;
  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const lookup = () => {
      api
        .listRacks(orgId)
        .then(racks => {
          if (!alive) return;
          const name = racks.find(r => r.id === rack.rackId)?.ovrDeviceName ?? null;
          setPairedName(name);
          connect(name ?? undefined).catch(e => console.warn('[rack] sensor connect failed', e));
        })
        .catch(e => {
          // Never guess a sensor while the pairing is unknown (another rack's OVR).
          console.warn('[rack] rack lookup failed; retrying', e);
          if (alive) retry = setTimeout(lookup, RACK_LOOKUP_RETRY_MS);
        });
    };
    lookup();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
    };
  }, [api, orgId, rack.rackId, connect]);

  // Clock for the summary auto-hide.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Where each athlete's phone was last seen (for dimmed "On Box Jump" tiles).
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

  // iPad exercise override per athlete; re-applied after the executor's own
  // localContext pick (active change, 60 s today refresh).
  const [overrides, setOverrides] = useState<Record<string, TodayExercise>>({});
  const activeId = state.activeAthleteId;
  useEffect(() => {
    if (!activeId) return;
    const ex = overrides[activeId];
    if (!ex) return;
    const still = today
      .find(a => a.athleteId === activeId)
      ?.remaining.some(r => r.workoutInstanceId === ex.workoutInstanceId && r.routineExerciseId === ex.routineExerciseId);
    if (!still) {
      setOverrides(({ [activeId]: _drop, ...rest }) => rest);
      return;
    }
    dispatch(localContextFor(activeId, ex));
  }, [activeId, today, overrides, dispatch]);

  const view = buildRackView({ state, today, rackName: rack.rackName, nowMs, phoneContexts });
  const ctx: RackContext = state.live?.context ?? nextContext(state);
  const pill = sensorPillOf(ovr.state, ovr.deviceName, pairedName);
  const fake = ovr.device instanceof FakeOvrDevice ? ovr.device : null;

  const { width, height } = useWindowDimensions();
  const k = Math.min(1, height / 820, width / 1180);
  const dial = Math.round(300 * Math.max(0.72, k));
  const bub = Math.round(124 * Math.max(0.72, k));

  const selectAthlete = (athleteId: string) => dispatch({ type: 'selectAthlete', athleteId });
  const pickExercise = (ex: TodayExercise) => {
    if (!activeId) return;
    setOverrides(prev => ({ ...prev, [activeId]: ex }));
    dispatch(localContextFor(activeId, ex));
  };

  const dropColor = view.dropCue || (view.dropPct != null && view.dropStopPct != null && view.zone && view.dropPct >= view.dropStopPct) ? RACK_COLORS.red : '#fff';
  const time = new Date(nowMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.ip}>
        {/* Header */}
        <View style={styles.top}>
          <View style={styles.rk}>
            <Text style={styles.rkTxt}>{rack.rackName.toUpperCase()}</Text>
          </View>
          <View style={styles.wk}>
            <Text style={styles.wkB} numberOfLines={1}>
              {view.athlete ? `${view.athlete.name} · ${view.exerciseName}` : 'Waiting for a lifter'}
            </Text>
            <Text style={styles.wkS} numberOfLines={1}>
              {time} · {today.length} athlete{today.length === 1 ? '' : 's'} training today
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          {syncing && <Pill tone="syncing" label="Syncing…" />}
          <SensorPill pill={pill} />
          <TouchableOpacity style={styles.btn2} onPress={onLock} accessibilityLabel="Lock — exit Rack mode">
            <Ionicons name="lock-closed" size={16} color="rgba(255,255,255,0.75)" />
          </TouchableOpacity>
        </View>

        {/* Row 1: gauge + athlete */}
        <View style={styles.row1}>
          <View style={[styles.card, styles.dialCard]}>
            <View style={styles.cardh}>
              <View style={styles.status}>
                {!view.open && <View style={styles.statusDot} />}
                <Text style={styles.statusTxt} numberOfLines={1}>
                  {view.statusText}
                </Text>
              </View>
              {view.dropCue && <Text style={styles.warn}>Speed dropped — rack it</Text>}
            </View>
            <View style={styles.dialRow}>
              <RingDial rep={view.lastRep} zone={view.zone} scaleV={view.scaleV} size={dial} />
              <View style={[styles.bubs, { width: bub * 2 + 14 }]}>
                <StatBubble size={bub} label="REPS" value={String(view.fullReps)} sub="counted" />
                <StatBubble
                  size={bub}
                  label="SET"
                  value={view.setNumber != null ? String(view.setNumber) : '—'}
                  sub={view.setsPrescribed ? `of ${view.setsPrescribed}` : ''}
                />
                <StatBubble size={bub} label="BAR" value={view.loadLb != null ? String(view.loadLb) : '—'} sub="lb" />
                <StatBubble
                  size={bub}
                  label="SPEED DROP"
                  value={view.dropPct != null ? `${view.dropPct}%` : '—'}
                  valueColor={dropColor}
                  sub={view.zone && view.dropStopPct != null ? `stop at ${view.dropStopPct}%` : ''}
                />
              </View>
            </View>
          </View>
          <AthleteCard
            view={view}
            rackName={rack.rackName}
            context={ctx}
            onDone={() => dispatch({ type: 'ipadDone' })}
            onPickExercise={pickExercise}
          />
        </View>

        {/* Row 2: this set + replay placeholder */}
        <View style={styles.row2}>
          <View style={[styles.card, { flex: 1 }]}>
            <View style={styles.cardh}>
              <Text style={styles.k}>THIS SET</Text>
              <Text style={styles.s}>{view.zone ? 'Shaded band = target speed' : 'No speed target for this exercise'}</Text>
            </View>
            <RepBars bars={view.bars} zone={view.zone} dropLineV={view.dropLineV} dropStopPct={view.dropStopPct} scaleV={view.scaleV} />
          </View>
          <View style={[styles.card, styles.replay]}>
            <View style={styles.cardh}>
              <Text style={styles.k}>REPLAY</Text>
            </View>
            <View style={styles.replayBody}>
              <Text style={styles.replayTxt}>Coming soon</Text>
            </View>
          </View>
        </View>

        {/* Tiles */}
        <AthleteTiles tiles={view.tiles} addable={view.addable} onSelect={selectAthlete} onAdd={selectAthlete} />

        {__DEV__ && fake && <DevSensorBar device={fake} zone={view.zone} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  dialCard: { flex: 1, flexDirection: 'column' },
  cardh: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 },
  k: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: 'rgba(255,255,255,0.5)' },
  s: { fontSize: 12, color: RACK_COLORS.mut },
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
  dialRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  bubs: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  replay: { width: 360 },
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
  gate: { flex: 1, backgroundColor: RACK_COLORS.bg, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  gateTitle: { fontSize: 30, fontWeight: '700', color: '#fff', textAlign: 'center' },
  gateSub: { fontSize: 14, color: RACK_COLORS.mut, textAlign: 'center' },
  gateBtn: { marginTop: 12, backgroundColor: RACK_COLORS.acc, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28 },
  gateBtnTxt: { color: RACK_COLORS.accInk, fontSize: 16, fontWeight: '800' },
});
