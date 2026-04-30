/**
 * ArmCareWizardScreen — full session capture flow on iOS.
 *
 * Phases (mirror the web wizard):
 *   intro → connecting → setup → calibrate-prompt → calibrate-running
 *      → rep-instructions → rep-countdown → rep-push → rep-result
 *      → (loop) rep-instructions ... → review → saving → saved
 *
 * BLE via lib/armcare/ble/activ5-rn.ts (react-native-ble-plx).
 * Cues via expo-haptics. Save via /api/armcare/sessions on the web app.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  TextInput,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import {
  Activ5DeviceRN,
  type Activ5Sample,
  type Activ5Info,
} from '../lib/armcare/ble/activ5-rn';
import { computeSession, toArmcareSessionRow } from '../lib/armcare/scoring';
import { CUES, unlockCues } from '../lib/armcare/cues';
import {
  clearDraft,
  draftAgeLabel,
  readDraft,
  saveDraft,
  type ArmCareDraft,
} from '../lib/armcare/draft';
import {
  POSITION_CUES,
  POSITION_IMAGES,
  REP_LABELS,
  REP_SCHEDULE,
  TEST_LABELS,
  WIZARD_TIMING,
  type RepResult,
  type RepSample,
  type SessionResult,
} from '../lib/armcare/types';

const ACCENT = '#F87171';
const ACCENT_DEEP = '#EF4444';

type Phase =
  | 'intro'
  | 'connecting'
  | 'setup'
  | 'calibrate-prompt'
  | 'calibrate-running'
  | 'rep-instructions'
  | 'rep-countdown'
  | 'rep-push'
  | 'rep-result'
  | 'review'
  | 'saving'
  | 'saved'
  | 'error';

type RouteParams = {
  athleteId: string;
  // Optional. When present, the wizard stamps this row's
  // completed_session_id on save so the day card flips to "Done".
  testInstanceId?: string;
};

export default function ArmCareWizardScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { athleteId, testInstanceId } = (route.params ?? {}) as RouteParams;

  const sensorRef = useRef<Activ5DeviceRN | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Tracks WHICH step errored so the error phase can offer the right recovery
  // CTA: 'rep' → "Retry rep" (returns to rep-instructions for the same index),
  // 'save' → "Retry save" (re-runs handleSave from the AsyncStorage draft),
  // null → just a Close button.
  const [errorContext, setErrorContext] = useState<'rep' | 'save' | 'connect' | null>(null);
  const [sensorInfo, setSensorInfo] = useState<Activ5Info | null>(null);

  // Athlete profile defaults
  const [bodyweight, setBodyweight] = useState<string>('');
  const [throws, setThrows] = useState<string | null>(null);
  const [armFeels, setArmFeels] = useState<number>(7);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('athletes')
        .select('throws, weight_lbs')
        .eq('id', athleteId)
        .maybeSingle();
      if (data?.weight_lbs != null) setBodyweight(String(Math.round(Number(data.weight_lbs))));
      if (data?.throws) setThrows(data.throws);
    })();
  }, [athleteId]);

  // Live state during a rep
  const [liveLbf, setLiveLbf] = useState(0);
  const [peakLbf, setPeakLbf] = useState(0);
  const [history, setHistory] = useState<{ t: number; lbf: number }[]>([]);
  const repSamplesRef = useRef<RepSample[]>([]);

  // Rep cursor + accumulated results
  const [repIndex, setRepIndex] = useState(0);
  const [results, setResults] = useState<RepResult[]>([]);
  const [countdown, setCountdown] = useState(3);
  const cancelRepRef = useRef<(() => void) | null>(null);

  // Final scored session
  const [session, setSession] = useState<SessionResult | null>(null);

  const currentRep = REP_SCHEDULE[repIndex];

  // Cleanup on unmount — disconnect sensor + cancel any in-flight timers.
  useEffect(() => {
    return () => {
      cancelRepRef.current?.();
      sensorRef.current?.disconnect().catch(() => {});
    };
  }, []);

  // ───── Connect ─────
  const handleConnect = useCallback(async () => {
    setErrorMsg(null);
    setErrorContext(null);
    unlockCues();
    setPhase('connecting');
    try {
      const sensor = await Activ5DeviceRN.request();
      const info = await sensor.connect();
      await sensor.startStreaming();
      sensorRef.current = sensor;
      setSensorInfo(info);
      setPhase('setup');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to connect.';
      setErrorMsg(msg);
      setErrorContext('connect');
      setPhase('error');
    }
  }, []);

  // ───── Setup → Calibrate prompt ─────
  const handleStartSession = useCallback(() => {
    const bw = Number(bodyweight);
    if (!bw || bw <= 0) {
      setErrorMsg('Enter a valid bodyweight to continue.');
      return;
    }
    setErrorMsg(null);
    setRepIndex(0);
    setResults([]);
    setPhase('calibrate-prompt');
  }, [bodyweight]);

  // ───── Calibrate ─────
  const handleCalibrate = useCallback(async () => {
    setErrorMsg(null);
    setPhase('calibrate-running');
    try {
      await sensorRef.current!.tare(WIZARD_TIMING.TARE_MS);
      setPhase('rep-instructions');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Calibration failed.';
      setErrorMsg(msg);
      setPhase('error');
    }
  }, []);

  const handleStartRep = useCallback(() => {
    setPhase('rep-countdown');
  }, []);

  // ───── Countdown effect ─────
  useEffect(() => {
    if (phase !== 'rep-countdown') return;
    setCountdown(3);
    CUES.tick(); // 3
    let n = 3;
    const id = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n > 0) {
        CUES.tick();
      } else {
        CUES.go();
        clearInterval(id);
        setPhase('rep-push');
      }
    }, 1000);
    cancelRepRef.current = () => clearInterval(id);
    return () => clearInterval(id);
  }, [phase, repIndex]);

  // ───── Push effect — collect samples for 3 sec ─────
  // CRITICAL: subscribe to onDisconnect for the duration of this phase so a
  // silent mid-rep BLE drop doesn't save a peak of 0 (the original bug:
  // sensor disconnects, no more samples arrive, the 3-second timeout still
  // fires, peak comes out as 0, wizard advances anyway).
  useEffect(() => {
    if (phase !== 'rep-push') return;
    const sensor = sensorRef.current;
    if (!sensor || !currentRep) return;

    const startedAt = Date.now();
    repSamplesRef.current = [];
    setLiveLbf(0);
    setPeakLbf(0);
    setHistory([]);

    let localPeak = 0;
    let cancelled = false;
    const histLocal: { t: number; lbf: number }[] = [];

    const unsub = sensor.onSample((e: Activ5Sample) => {
      const lbf = Math.max(0, e.lbf);
      const t = Date.now() - startedAt;
      if (t < 0 || t > WIZARD_TIMING.PUSH_MS + 500) return;
      repSamplesRef.current.push({ t, lbf });
      histLocal.push({ t, lbf });
      if (histLocal.length > 60) histLocal.shift();
      setHistory([...histLocal]);
      setLiveLbf(lbf);
      if (lbf > localPeak) {
        localPeak = lbf;
        setPeakLbf(lbf);
      }
    });

    const unsubDisconnect = sensor.onDisconnect(() => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timeout);
      unsub();
      // Drop any partial samples from this rep — we don't trust them.
      repSamplesRef.current = [];
      setErrorMsg(
        'Sensor disconnected mid-rep. Make sure it’s on and try the rep again.',
      );
      setErrorContext('rep');
      setPhase('error');
    });

    // App backgrounding mid-rep → iOS suspends BLE notifications without
    // necessarily firing onDisconnected. Treat any leave-foreground event
    // during the push window as a forced retry so we never save a partial
    // rep just because the user got pulled to another app.
    const appStateSub = AppState.addEventListener('change', (next) => {
      if (cancelled) return;
      if (next === 'background' || next === 'inactive') {
        cancelled = true;
        clearTimeout(timeout);
        unsub();
        repSamplesRef.current = [];
        setErrorMsg(
          'Exam paused — switching apps interrupts the sensor stream. Try the rep again.',
        );
        setErrorContext('rep');
        setPhase('error');
      }
    });

    const timeout = setTimeout(() => {
      if (cancelled) return;
      CUES.stop();
      const samples = repSamplesRef.current;
      const peak = samples.reduce((m, s) => (s.lbf > m ? s.lbf : m), 0);
      const mean =
        samples.length > 0
          ? samples.reduce((a, s) => a + s.lbf, 0) / samples.length
          : 0;
      // Defensive: if we somehow finished the rep with zero samples (sensor
      // never started streaming, hot disconnect with no warning), surface as
      // an error rather than persisting a peak of 0.
      if (samples.length === 0) {
        setErrorMsg(
          'No force samples received. Sensor may be asleep — wake it and retry this rep.',
        );
        setErrorContext('rep');
        setPhase('error');
        unsub();
        unsubDisconnect();
        appStateSub.remove();
        return;
      }
      // Sanity check — a peak under 5 lbf almost always means the athlete
      // didn't actually engage the sensor (resting on it / not in position).
      // Don't silently save it; surface as a retryable error.
      if (peak < 5) {
        setErrorMsg(
          'Sensor barely registered any force — make sure you are in position and pushing into the sensor.',
        );
        setErrorContext('rep');
        setPhase('error');
        unsub();
        unsubDisconnect();
        appStateSub.remove();
        return;
      }
      const result: RepResult = {
        testType: currentRep.testType,
        repNum: currentRep.repNum,
        startedAt,
        durationMs: WIZARD_TIMING.PUSH_MS,
        peakLbf: peak,
        meanLbf: mean,
        samples,
      };
      setResults((prev) => [...prev, result]);
      setPhase('rep-result');
      unsub();
      unsubDisconnect();
      appStateSub.remove();
    }, WIZARD_TIMING.PUSH_MS);

    cancelRepRef.current = () => {
      cancelled = true;
      clearTimeout(timeout);
      unsub();
      unsubDisconnect();
      appStateSub.remove();
    };
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      unsub();
      unsubDisconnect();
      appStateSub.remove();
    };
  }, [phase, currentRep, repIndex]);

  // ───── Result flash → next instructions or review ─────
  useEffect(() => {
    if (phase !== 'rep-result') return;
    const id = setTimeout(() => {
      const isLast = repIndex >= REP_SCHEDULE.length - 1;
      if (isLast) {
        setPhase('review');
      } else {
        setRepIndex((i) => i + 1);
        setPhase('rep-instructions');
      }
    }, WIZARD_TIMING.RESULT_MS);
    cancelRepRef.current = () => clearTimeout(id);
    return () => clearTimeout(id);
  }, [phase, repIndex]);

  // ───── Compute scored session on review entry ─────
  useEffect(() => {
    if (phase !== 'review') return;
    const bw = Number(bodyweight);
    const s = computeSession({
      athleteId,
      examDate: new Date().toISOString().slice(0, 10),
      bodyweightLbs: bw,
      reps: results,
      armFeels,
    });
    setSession(s);
  }, [phase, athleteId, bodyweight, armFeels, results]);

  // ───── Save (direct to Supabase — no web API) ─────
  // RLS on armcare_sessions must allow the athlete (or their guardian / a
  // coach) to insert a row for this athlete_id. The Supabase client carries
  // the user's JWT, so the insert is authenticated as the signed-in user.
  //
  // Draft persistence: we stash the row in AsyncStorage BEFORE the insert.
  // If the insert fails, the draft remains so the user can retry without
  // losing 3 minutes of work. On success we clear the draft.
  const [savingInFlight, setSavingInFlight] = useState(false);
  const handleSave = useCallback(async () => {
    if (!session) return;
    if (savingInFlight) return; // dedupe accidental double-tap
    setSavingInFlight(true);
    setPhase('saving');
    try {
      // 1) Pull the athlete's max release-speed from TrackMan to populate Velo
      //    + compute SVR. Best-effort; if no data, both stay null.
      const { data: veloRow } = await supabase
        .from('trackman_pitch_data')
        .select('rel_speed')
        .eq('athlete_id', session.athleteId)
        .not('rel_speed', 'is', null)
        .order('rel_speed', { ascending: false })
        .limit(1)
        .maybeSingle();
      const maxVelo = veloRow?.rel_speed ? Number(veloRow.rel_speed) : null;

      // 2) Stash the draft locally BEFORE the insert. If the insert throws,
      //    the user can recover from this draft on next mount.
      await saveDraft(session.athleteId, session, maxVelo);

      // 3) Build the column-shaped row + insert directly. No web-API hop.
      const row = toArmcareSessionRow(session, maxVelo);
      const { data: insertedSession, error } = await supabase
        .from('armcare_sessions')
        .insert(row)
        .select('id')
        .single();
      if (error) throw new Error(error.message);

      // 4) If the wizard was launched from a coach-prescribed test instance,
      //    stamp completed_session_id back onto that row. The DB trigger
      //    flips status → 'completed' automatically. Failures here are
      //    non-fatal — the session itself saved.
      if (testInstanceId && insertedSession?.id) {
        await supabase
          .from('armcare_test_instances')
          .update({ completed_session_id: insertedSession.id })
          .eq('id', testInstanceId)
          .then((res) => {
            if (res.error) console.warn('Failed to stamp test instance:', res.error.message);
          });
      }

      // 5) Successful save → clear the draft so we don't keep prompting recovery.
      await clearDraft(session.athleteId);
      setPhase('saved');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setErrorMsg(msg);
      setErrorContext('save');
      setPhase('error');
    } finally {
      setSavingInFlight(false);
    }
  }, [session, savingInFlight, testInstanceId]);

  // ───── Retry handlers for the error phase ─────
  const handleRetryRep = useCallback(() => {
    setErrorMsg(null);
    setErrorContext(null);
    setPhase('rep-instructions');
  }, []);

  const handleRetrySave = useCallback(() => {
    setErrorMsg(null);
    setErrorContext(null);
    handleSave();
  }, [handleSave]);

  // ───── Recover an unsaved draft on mount ─────
  // If a previous attempt's insert failed, the draft sits in AsyncStorage.
  // Show the user a single "Recover unsaved exam" CTA on the intro screen.
  const [pendingDraft, setPendingDraft] = useState<ArmCareDraft | null>(null);
  useEffect(() => {
    let active = true;
    if (!athleteId) return;
    (async () => {
      const d = await readDraft(athleteId);
      if (!active) return;
      setPendingDraft(d);
    })();
    return () => {
      active = false;
    };
  }, [athleteId]);

  const handleRecoverDraft = useCallback(async () => {
    if (!pendingDraft) return;
    setPhase('saving');
    try {
      const { error } = await supabase
        .from('armcare_sessions')
        .insert(pendingDraft.row)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      await clearDraft(pendingDraft.athleteId);
      setPendingDraft(null);
      setPhase('saved');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed.';
      setErrorMsg(msg);
      setErrorContext('save');
      setSession(pendingDraft.session); // ensure review is consistent if user goes back
      setPhase('error');
    }
  }, [pendingDraft]);

  const handleDiscardDraft = useCallback(async () => {
    if (!pendingDraft) return;
    await clearDraft(pendingDraft.athleteId);
    setPendingDraft(null);
  }, [pendingDraft]);

  const handleClose = useCallback(() => {
    cancelRepRef.current?.();
    sensorRef.current?.disconnect().catch(() => {});
    navigation.goBack();
  }, [navigation]);

  // ───── Render ─────
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <Pressable onPress={handleClose} hitSlop={12} style={styles.stopBtn}>
          <View style={styles.stopDot} />
          <Text style={styles.stopText}>Stop exam</Text>
        </Pressable>
        <View style={styles.eyebrowBadge}>
          <Ionicons name="medical" size={11} color={ACCENT} />
          <Text style={styles.eyebrowText}>ARM CARE</Text>
        </View>
        <Text style={styles.repCount}>
          {phase.startsWith('rep-') && currentRep
            ? `${repIndex + 1}/${REP_SCHEDULE.length}`
            : ''}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {phase === 'intro' && (
          <Intro
            onConnect={handleConnect}
            draft={pendingDraft}
            onRecover={handleRecoverDraft}
            onDiscardDraft={handleDiscardDraft}
          />
        )}

        {phase === 'connecting' && (
          <CenteredSpinner label="Pairing with sensor…" />
        )}

        {phase === 'setup' && (
          <Setup
            sensorInfo={sensorInfo}
            athleteThrows={throws}
            bodyweight={bodyweight}
            setBodyweight={setBodyweight}
            armFeels={armFeels}
            setArmFeels={setArmFeels}
            onStart={handleStartSession}
            error={errorMsg}
          />
        )}

        {phase === 'calibrate-prompt' && (
          <CalibratePrompt onCalibrate={handleCalibrate} />
        )}

        {phase === 'calibrate-running' && (
          <CenteredSpinner label="Don't touch the sensor…" />
        )}

        {phase === 'rep-instructions' && currentRep && (
          <Instructions
            test={TEST_LABELS[currentRep.testType]}
            side={REP_LABELS[currentRep.repNum]}
            cue={POSITION_CUES[currentRep.testType]}
            imageSource={POSITION_IMAGES[currentRep.testType]}
            repNumber={repIndex + 1}
            totalReps={REP_SCHEDULE.length}
            onStart={handleStartRep}
          />
        )}

        {phase === 'rep-countdown' && currentRep && (
          <Countdown
            test={TEST_LABELS[currentRep.testType]}
            side={REP_LABELS[currentRep.repNum]}
            seconds={countdown}
          />
        )}

        {phase === 'rep-push' && currentRep && (
          <PushView
            test={TEST_LABELS[currentRep.testType]}
            side={REP_LABELS[currentRep.repNum]}
            lbf={liveLbf}
            peakLbf={peakLbf}
            history={history}
          />
        )}

        {phase === 'rep-result' && (
          <RepResultView
            test={
              currentRep ? TEST_LABELS[currentRep.testType] : ''
            }
            side={currentRep ? REP_LABELS[currentRep.repNum] : ''}
            peak={results[results.length - 1]?.peakLbf ?? 0}
          />
        )}

        {phase === 'review' && session && (
          <Review session={session} onSave={handleSave} onCancel={handleClose} />
        )}

        {phase === 'saving' && <CenteredSpinner label="Saving session…" />}

        {phase === 'saved' && (
          <View style={styles.center}>
            <Ionicons name="checkmark-circle" size={72} color="#34D399" />
            <Text style={styles.h2}>Session saved</Text>
            <PrimaryButton label="Done" onPress={handleClose} />
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.center}>
            <Ionicons name="warning" size={64} color={ACCENT} />
            <Text style={styles.h2}>Something went wrong</Text>
            <Text style={styles.bodyText}>{errorMsg}</Text>
            {errorContext === 'rep' && (
              <PrimaryButton label="Retry rep" onPress={handleRetryRep} />
            )}
            {errorContext === 'save' && (
              <PrimaryButton label="Retry save" onPress={handleRetrySave} />
            )}
            {errorContext === 'connect' && (
              <PrimaryButton label="Retry connect" onPress={handleConnect} />
            )}
            <Pressable onPress={handleClose} hitSlop={8} style={styles.linkBtn}>
              <Text style={styles.linkBtnText}>
                {errorContext === 'save' ? 'Save later (keeps draft)' : 'Close'}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-views
// ─────────────────────────────────────────────────────────────

function Intro({
  onConnect,
  draft,
  onRecover,
  onDiscardDraft,
}: {
  onConnect: () => void;
  draft: ArmCareDraft | null;
  onRecover: () => void;
  onDiscardDraft: () => void;
}) {
  return (
    <View style={styles.center}>
      <Ionicons name="fitness" size={64} color={ACCENT} />
      <Text style={styles.h1}>ArmCare Strength Session</Text>

      {/* If a previous exam's save failed, surface a one-tap retry path
          before we let the user start a fresh session. The draft is keyed
          by athleteId in AsyncStorage. */}
      {draft && (
        <View style={styles.draftCard}>
          <View style={styles.draftRow}>
            <Ionicons name="cloud-offline" size={16} color="#FBBF24" />
            <Text style={styles.draftTitle}>Unsaved exam</Text>
          </View>
          <Text style={styles.draftBody}>
            Last attempt didn&apos;t reach the server ({draftAgeLabel(draft)}).
            ArmScore {Math.round(draft.session.armScore)} ·{' '}
            {Math.round(draft.session.totalStrengthLbf)} lbs total.
          </Text>
          <View style={styles.draftActions}>
            <PrimaryButton label="Retry save" onPress={onRecover} />
            <Pressable onPress={onDiscardDraft} hitSlop={8} style={styles.linkBtn}>
              <Text style={styles.linkBtnText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Text style={styles.bodyText}>
        You&apos;ll perform 8 short isometric tests with the Activ5 sensor:
        Internal Rotation, External Rotation, Scaption, and Grip — both arms.
        Each test is 3 seconds.
      </Text>
      <PrimaryButton label="Connect Sensor" onPress={onConnect} />
      <Text style={styles.smallNote}>
        Wake the sensor (squeeze it once) and close the official ArmCare app
        before connecting.
      </Text>
    </View>
  );
}

function Setup({
  sensorInfo,
  athleteThrows,
  bodyweight,
  setBodyweight,
  armFeels,
  setArmFeels,
  onStart,
  error,
}: {
  sensorInfo: Activ5Info | null;
  athleteThrows: string | null;
  bodyweight: string;
  setBodyweight: (v: string) => void;
  armFeels: number;
  setArmFeels: (n: number) => void;
  onStart: () => void;
  error: string | null;
}) {
  const throwsNorm = athleteThrows?.toString().trim().toUpperCase() ?? '';
  const throwingHand = throwsNorm.startsWith('L')
    ? 'Left'
    : throwsNorm.startsWith('R')
      ? 'Right'
      : 'Not set on profile';

  return (
    <View style={{ gap: 18 }}>
      <View style={styles.connectedCard}>
        <Ionicons name="checkmark-circle" size={18} color="#34D399" />
        <View style={{ flex: 1 }}>
          <Text style={styles.connectedTitle}>Sensor connected</Text>
          <Text style={styles.connectedSubtitle}>
            {sensorInfo?.name ?? 'Activ5'}
            {sensorInfo?.batteryPercent !== undefined &&
              ` · battery ${sensorInfo.batteryPercent}%`}
          </Text>
        </View>
      </View>

      <View>
        <Text style={styles.label}>Current bodyweight (lbs)</Text>
        <TextInput
          value={bodyweight}
          onChangeText={setBodyweight}
          keyboardType="decimal-pad"
          placeholder="180"
          placeholderTextColor="#6b7280"
          style={styles.input}
        />
        <Text style={styles.helper}>
          Used to compute your ArmScore (total ÷ bodyweight × 100).
        </Text>
      </View>

      <View style={styles.profileBox}>
        <Text style={styles.profileLabel}>THROWING ARM</Text>
        <Text style={styles.profileValue}>{throwingHand}</Text>
        <Text style={styles.helper}>Tests run throwing-arm first.</Text>
      </View>

      <View>
        <View style={styles.armFeelsRow}>
          <Text style={styles.label}>How does your arm feel?</Text>
          <Text style={styles.armFeelsValue}>
            {armFeels}
            <Text style={styles.armFeelsMax}> / 10</Text>
          </Text>
        </View>
        <View style={styles.armFeelsButtons}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <Pressable
              key={n}
              onPress={() => setArmFeels(n)}
              style={[
                styles.armFeelsTick,
                armFeels >= n && { backgroundColor: ACCENT },
              ]}
            />
          ))}
        </View>
        <View style={styles.armFeelsLabels}>
          <Text style={styles.armFeelsEdge}>Sore / dead</Text>
          <Text style={styles.armFeelsEdge}>Great</Text>
        </View>
      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

      <PrimaryButton label="Start Session" onPress={onStart} />
    </View>
  );
}

function CalibratePrompt({ onCalibrate }: { onCalibrate: () => void }) {
  return (
    <View style={styles.center}>
      <Ionicons name="speedometer" size={64} color={ACCENT} />
      <Text style={styles.h1}>Strap sensor to wrist</Text>
      <Text style={styles.bodyText}>
        Place the Activ5 sensor on your wrist or forearm — the same arm
        you&apos;ll be testing.{' '}
        <Text style={{ fontWeight: '800' }}>Hold still and don&apos;t press on it.</Text>
      </Text>
      <Text style={styles.smallNote}>
        We&apos;ll zero the sensor against its idle drift. Takes 2 seconds.
      </Text>
      <PrimaryButton label="Calibrate" onPress={onCalibrate} />
    </View>
  );
}

function Instructions({
  test,
  side,
  cue,
  imageSource,
  repNumber,
  totalReps,
  onStart,
}: {
  test: string;
  side: string;
  cue: string;
  imageSource: number;
  repNumber: number;
  totalReps: number;
  onStart: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <Text style={styles.eyebrowMuted}>
        Test {repNumber} of {totalReps} · {side}
      </Text>
      <Text style={styles.h1}>{test}</Text>
      <Text style={styles.bodyText}>{cue}</Text>

      <View style={styles.positionImageWrap}>
        <Image source={imageSource} style={styles.positionImage} resizeMode="cover" />
      </View>

      <Text style={styles.smallNote}>
        Get into position, then press Start. You'll get a 3·2·1 countdown
        before the 3-second hold.
      </Text>

      <PrimaryButton label="Start" onPress={onStart} />
    </View>
  );
}

function Countdown({
  test,
  side,
  seconds,
}: {
  test: string;
  side: string;
  seconds: number;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 14 }}>
      <Text style={styles.eyebrowMuted}>{side}</Text>
      <Text style={styles.h1}>{test}</Text>
      <View style={styles.countdownNumberWrap}>
        <Text style={styles.countdownNumber}>
          {seconds > 0 ? seconds : 'GO'}
        </Text>
      </View>
      <Text style={styles.smallNote}>Get into position</Text>
    </View>
  );
}

function PushView({
  test,
  side,
  lbf,
  peakLbf,
  history,
}: {
  test: string;
  side: string;
  lbf: number;
  peakLbf: number;
  history: { t: number; lbf: number }[];
}) {
  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <Text style={styles.eyebrowMuted}>{side}</Text>
      <Text style={styles.h2}>{test}</Text>
      <LiveGauge
        lbf={lbf}
        peakLbf={peakLbf}
        history={history}
        maxLbf={Math.max(50, peakLbf * 1.5)}
      />
      <Text style={styles.smallNote}>Push as hard as you can</Text>
    </View>
  );
}

function LiveGauge({
  lbf,
  peakLbf,
  history,
  maxLbf,
}: {
  lbf: number;
  peakLbf: number;
  history: { t: number; lbf: number }[];
  maxLbf: number;
}) {
  const SIZE = 240;
  const CENTER = SIZE / 2;
  const R = SIZE / 2 - 16;
  const ratio = Math.min(1, Math.max(0, lbf / maxLbf));
  const TICKS = 40;
  const filled = Math.round(ratio * TICKS);

  const chart = useMemo(() => {
    if (history.length < 2) return '';
    const w = 100;
    const h = 30;
    const tMin = history[0].t;
    const tMax = history[history.length - 1].t;
    const tSpan = Math.max(1, tMax - tMin);
    const peak = Math.max(1, ...history.map((p) => p.lbf));
    return history
      .map((p) => {
        const x = ((p.t - tMin) / tSpan) * w;
        const y = h - (p.lbf / peak) * h;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [history]);

  return (
    <View style={{ width: SIZE, alignItems: 'center', gap: 12 }}>
      <View style={{ width: SIZE, height: SIZE / 2 + 30, position: 'relative' }}>
        <Svg width={SIZE} height={SIZE}>
          {Array.from({ length: TICKS }).map((_, i) => {
            // -90° to +90° sweep across the top half
            const angle = -Math.PI + (i / (TICKS - 1)) * Math.PI;
            const inner = R - 12;
            const outer = R;
            const x1 = CENTER + Math.cos(angle) * inner;
            const y1 = CENTER + Math.sin(angle) * inner;
            const x2 = CENTER + Math.cos(angle) * outer;
            const y2 = CENTER + Math.sin(angle) * outer;
            const t = i / (TICKS - 1);
            const filledColor =
              t < 0.5 ? '#FFB800' : t < 0.85 ? '#FF7A1A' : ACCENT;
            return (
              <Polyline
                key={i}
                points={`${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`}
                stroke={i < filled ? filledColor : '#27272a'}
                strokeWidth={3}
                strokeLinecap="round"
              />
            );
          })}
        </Svg>
        <View style={styles.gaugeNumberWrap} pointerEvents="none">
          <Text style={styles.gaugeNumber}>{lbf.toFixed(1)}</Text>
          <Text style={styles.gaugeUnit}>lbs</Text>
        </View>
      </View>

      <View style={styles.peakCard}>
        <Text style={styles.peakCardLabel}>HIGH</Text>
        <Text style={styles.peakCardValue}>{peakLbf.toFixed(1)}</Text>
        <Text style={styles.peakCardUnit}>lbs</Text>
        {chart.length > 0 && (
          <Svg viewBox="0 0 100 30" preserveAspectRatio="none" width="100%" height={48} style={{ marginTop: 8 }}>
            <Polyline
              points={chart}
              fill="none"
              stroke={ACCENT}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </Svg>
        )}
      </View>
    </View>
  );
}

function RepResultView({
  test,
  side,
  peak,
}: {
  test: string;
  side: string;
  peak: number;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
      <Text style={styles.eyebrowMuted}>{side}</Text>
      <Text style={styles.h2}>{test}</Text>
      <Text style={styles.repPeak}>{peak.toFixed(1)}</Text>
      <Text style={styles.smallNote}>lbs peak</Text>
    </View>
  );
}

function Review({
  session,
  onSave,
  onCancel,
}: {
  session: SessionResult;
  onSave: () => void;
  onCancel: () => void;
}) {
  // Single-arm protocol — show rep1 / rep2 / top per test.
  const rows: { test: string; rep1: number; rep2: number; top: number }[] = [
    { test: 'IR', rep1: session.peaks.ir_1, rep2: session.peaks.ir_2, top: session.topPerTest.ir },
    { test: 'ER', rep1: session.peaks.er_1, rep2: session.peaks.er_2, top: session.topPerTest.er },
    { test: 'Scap', rep1: session.peaks.scaption_1, rep2: session.peaks.scaption_2, top: session.topPerTest.scaption },
    { test: 'Grip', rep1: session.peaks.grip_1, rep2: session.peaks.grip_2, top: session.topPerTest.grip },
  ];

  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.h1}>Session complete</Text>
      <Text style={styles.bodyText}>
        Total {session.totalStrengthLbf.toFixed(1)} lbs ·
        Bodyweight {session.bodyweightLbs} lbs
      </Text>

      <View style={styles.armScoreCard}>
        <Text style={styles.armScoreLabel}>ARMSCORE</Text>
        <Text style={styles.armScoreValue}>{session.armScore.toFixed(0)}</Text>
        <Text style={styles.armScoreCaption}>strength ÷ bodyweight × 100</Text>
      </View>

      <View style={styles.reviewTable}>
        <View style={[styles.reviewRow, styles.reviewHeader]}>
          <Text style={styles.reviewCellLabel}>Test</Text>
          <Text style={styles.reviewCellNum}>Rep 1</Text>
          <Text style={styles.reviewCellNum}>Rep 2</Text>
          <Text style={styles.reviewCellNum}>Top</Text>
        </View>
        {rows.map((r) => (
          <View key={r.test} style={styles.reviewRow}>
            <Text style={styles.reviewCellLabel}>{r.test}</Text>
            <Text style={styles.reviewCellValue}>{r.rep1.toFixed(1)}</Text>
            <Text style={styles.reviewCellValue}>{r.rep2.toFixed(1)}</Text>
            <Text style={[styles.reviewCellValue, { color: '#fff', fontWeight: '800' }]}>
              {r.top.toFixed(1)}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [
            styles.secondaryBtn,
            pressed && { opacity: 0.6 },
          ]}
        >
          <Text style={styles.secondaryBtnText}>Discard</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <PrimaryButton label="Save Session" onPress={onSave} />
        </View>
      </View>
    </View>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={ACCENT} />
      <Text style={styles.bodyText}>{label}</Text>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.primaryShadow}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.primaryClip,
          pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] },
        ]}
      >
        <LinearGradient
          colors={[ACCENT, ACCENT_DEEP]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.primaryGradient}
        >
          <Text style={styles.primaryText}>{label}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  stopBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stopDot: { width: 10, height: 10, backgroundColor: ACCENT, borderRadius: 2 },
  stopText: { color: ACCENT, fontWeight: '700', fontSize: 14 },
  eyebrowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: `${ACCENT}1F`,
    borderWidth: 1,
    borderColor: `${ACCENT}55`,
  },
  eyebrowText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  repCount: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
    width: 50,
    textAlign: 'right',
  },
  body: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 14,
  },
  center: {
    alignItems: 'center',
    gap: 14,
    paddingVertical: 28,
  },
  h1: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  h2: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  bodyText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  smallNote: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
  },
  // Tertiary text-link style — used for "Close" / "Discard" / "Save later"
  // alongside the primary CTAs in the error and intro phases.
  linkBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 6,
  },
  linkBtnText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Draft-recovery card on the intro screen.
  draftCard: {
    width: '100%',
    backgroundColor: 'rgba(251,191,36,0.08)',
    borderColor: 'rgba(251,191,36,0.35)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    marginBottom: 6,
    gap: 8,
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  draftTitle: {
    color: '#FBBF24',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  draftBody: {
    color: '#e5e7eb',
    fontSize: 13,
    lineHeight: 18,
  },
  draftActions: {
    flexDirection: 'column',
    gap: 4,
  },
  eyebrowMuted: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  errorText: { color: ACCENT, fontSize: 13, fontWeight: '600' },

  connectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(52,211,153,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.25)',
  },
  connectedTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  connectedSubtitle: { color: '#9ca3af', fontSize: 12, marginTop: 2 },

  label: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  helper: { color: '#6b7280', fontSize: 12, marginTop: 6 },

  profileBox: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  profileLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  profileValue: { color: '#fff', fontSize: 16, fontWeight: '700' },

  armFeelsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  armFeelsValue: { color: '#fff', fontSize: 24, fontWeight: '800' },
  armFeelsMax: { color: '#6b7280', fontSize: 14, fontWeight: '500' },
  armFeelsButtons: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 4,
  },
  armFeelsTick: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  armFeelsLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  armFeelsEdge: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  positionImageWrap: {
    width: 220,
    aspectRatio: 3 / 4,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  positionImage: { width: '100%', height: '100%' },

  countdownNumberWrap: { paddingVertical: 16 },
  countdownNumber: {
    color: '#fff',
    fontSize: 120,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 124,
  },

  gaugeNumberWrap: {
    position: 'absolute',
    top: 30,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  gaugeNumber: {
    color: ACCENT,
    fontSize: 62,
    fontWeight: '900',
    letterSpacing: -2,
  },
  gaugeUnit: { color: '#6b7280', fontSize: 12, marginTop: 4 },

  peakCard: {
    width: 220,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  peakCardLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  peakCardValue: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 2 },
  peakCardUnit: { color: '#6b7280', fontSize: 10, marginTop: -2 },

  repPeak: {
    color: ACCENT,
    fontSize: 88,
    fontWeight: '900',
    letterSpacing: -2,
    lineHeight: 92,
  },

  armScoreCard: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  armScoreLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  armScoreValue: {
    color: '#fff',
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: -2,
    marginTop: 4,
  },
  armScoreCaption: { color: '#6b7280', fontSize: 11, marginTop: 4 },

  reviewTable: {
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  reviewRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  reviewHeader: { borderTopWidth: 0, backgroundColor: 'rgba(255,255,255,0.04)' },
  reviewCellLabel: {
    flex: 1.2,
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  reviewCellNum: {
    flex: 1,
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'right',
    textTransform: 'uppercase',
  },
  reviewCellValue: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },

  secondaryBtn: {
    flex: 1,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  primaryShadow: {
    alignSelf: 'stretch',
    borderRadius: 18,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  primaryClip: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  primaryGradient: {
    height: 56,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
});
