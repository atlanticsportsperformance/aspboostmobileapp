/**
 * PulseWizardModal — bottom-sheet wizard that guides the athlete through the
 * Pulse flow: Connect → Choose (Sync vs Live) → (Syncing | Live running) →
 * Done. One entry point for both the standalone WorkloadScreen and the
 * throwing workout logger so the UX is identical everywhere.
 *
 * State machine:
 *   connect  — Pulse not connected yet (or connecting / errored)
 *   choose   — connected; smart route based on sensor counter
 *   syncing  — bulk pulling cached throws from the sensor
 *   live     — live session streaming each throw in real time
 *   done     — wrap-up with session summary
 *
 * The step is derived from real BLE / sync / live state where possible; the
 * only internal state is "which step was the user last in" and a "next after
 * sync" flag. Closing the modal via X does NOT stop a live session — the
 * monitor's chip keeps showing the live state and tapping reopens here.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import {
  Bluetooth,
  BluetoothOff,
  X,
  Play,
  Download,
  Check,
  Square,
  Zap,
  AlertTriangle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { usePulse } from '../../lib/pulse/PulseProvider';

/**
 * PulseAutoOpener — effect-only component that opens the wizard once when
 * mounted if Pulse isn't already connected. Lives inside the PulseProvider
 * tree so it can read BLE state and call openWizard(). Mount this from any
 * screen that should auto-prompt the athlete to connect.
 */
export function PulseAutoOpener() {
  const { dev, openWizard } = usePulse();
  React.useEffect(() => {
    // Fire once on mount if not already connected / connecting.
    if (dev.state === 'idle' || dev.state === 'disconnected') {
      openWizard();
    }
    // Intentionally no deps — fire ONCE on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

type Step = 'connect' | 'choose' | 'syncing' | 'live' | 'done';

interface Props {
  /** ISO date the athlete is currently viewing. Drives past/future gating. */
  scheduledDate?: string;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function PulseWizardModal({ scheduledDate }: Props) {
  const {
    ble,
    dev,
    live,
    sync,
    profileComplete,
    wizardOpen,
    closeWizard,
  } = usePulse();

  // Date gating — past/future days can't do live, only sync
  const dateMode = useMemo<'today' | 'past' | 'future'>(() => {
    if (!scheduledDate) return 'today';
    const today = toISO(new Date());
    if (scheduledDate < today) return 'past';
    if (scheduledDate > today) return 'future';
    return 'today';
  }, [scheduledDate]);

  // Internal step state. Derived from BLE/sync/live where possible, plus
  // a "what did the user pick" memory for the sync→live auto-advance flow.
  const [step, setStep] = useState<Step>('connect');
  const [postSyncDest, setPostSyncDest] = useState<'done' | 'live'>('done');

  // Route the step whenever the modal opens or underlying state changes
  useEffect(() => {
    if (!wizardOpen) return;

    // Live session is running — regardless of previous step, show live
    if (live.status === 'running') {
      setStep('live');
      return;
    }

    // Sync in progress
    if (sync.status === 'syncing' || sync.status === 'committing') {
      setStep('syncing');
      return;
    }

    // Sync just finished — advance based on user's earlier pick
    if (sync.status === 'done') {
      if (postSyncDest === 'live') {
        // Kick off live session, then let the next render flip to 'live'
        live.start().catch(() => {});
        setPostSyncDest('done'); // reset
        return;
      }
      setStep('done');
      return;
    }

    // Otherwise: route on connection state
    if (dev.state === 'connected') {
      setStep((cur) => (cur === 'done' ? 'done' : 'choose'));
    } else if (dev.state === 'error' || dev.state === 'disconnected' || dev.state === 'idle') {
      setStep('connect');
    }
    // 'requesting' / 'connecting' — stay on connect step with spinner
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOpen, dev.state, live.status, sync.status]);

  // Reset postSyncDest when closing
  useEffect(() => {
    if (!wizardOpen) {
      setPostSyncDest('done');
    }
  }, [wizardOpen]);

  // Auto-trigger the BLE scan when the wizard opens if Pulse is idle. This
  // collapses "Open Pulse → tap Connect" into a single tap. The athlete sees
  // the spinner immediately instead of a static "Connect Pulse" screen.
  useEffect(() => {
    if (!wizardOpen) return;
    if (!ble.supported) return;
    if (dev.state === 'idle' || dev.state === 'disconnected') {
      console.log('[PulseWizard] auto-connect on open, state=', dev.state);
      dev.connect().catch((err) => {
        console.warn('[PulseWizard] auto-connect failed', err?.message);
      });
    }
    // Intentionally only deps on wizardOpen flip + ble.supported — we don't
    // want this effect firing every time dev.state changes (would recurse).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOpen, ble.supported]);

  // ─────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    await dev.connect();
  }, [dev]);

  const handleSyncOnly = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPostSyncDest('done');
    setStep('syncing');
    await sync.run();
    await sync.commit();
  }, [sync]);

  const handleSyncThenLive = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPostSyncDest('live');
    setStep('syncing');
    await sync.run();
    await sync.commit();
  }, [sync]);

  const handleStartLive = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setStep('live');
    await live.start();
  }, [live]);

  const handleStopLive = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    await live.stop();
    setStep('done');
  }, [live]);

  const handleClose = useCallback(() => {
    // Live session continues in background — the monitor's chip keeps
    // showing it and the wizard can be reopened to stop it.
    closeWizard();
  }, [closeWizard]);

  // ─────────────────────────────────────────────────────────────
  // Live red dot pulse
  // ─────────────────────────────────────────────────────────────
  const pulseVal = useSharedValue(1);
  useEffect(() => {
    if (wizardOpen && step === 'live') {
      pulseVal.value = withRepeat(
        withSequence(
          withTiming(1.4, { duration: 600, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulseVal);
      pulseVal.value = 1;
    }
    return () => {
      cancelAnimation(pulseVal);
    };
  }, [wizardOpen, step, pulseVal]);

  const pulseDotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseVal.value }],
  }));

  // Step number for the progress dots (1-4)
  const stepIndex =
    step === 'connect'
      ? 1
      : step === 'choose'
      ? 2
      : step === 'syncing' || step === 'live'
      ? 3
      : 4;

  return (
    <Modal
      visible={wizardOpen}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        {/* Dedicated tap-to-close area above the sheet — a plain Pressable
            that doesn't wrap any interactive content, so there's no nested
            responder conflict with the Connect button inside the sheet. */}
        <Pressable
          style={styles.backdropTapArea}
          onPress={handleClose}
          accessible={false}
        />
        <View style={styles.sheet}>
          {/* Grab handle */}
          <View style={styles.handle} />

          {/* Top bar: step dots + close */}
          <View style={styles.topBar}>
            <View style={styles.dots}>
              {[1, 2, 3, 4].map((i) => {
                const done = i < stepIndex;
                const active = i === stepIndex;
                return (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      done && styles.dotDone,
                      active && styles.dotActive,
                    ]}
                  >
                    {done && <Check size={9} color="#000" strokeWidth={3.5} />}
                  </View>
                );
              })}
            </View>
            <Pressable onPress={handleClose} hitSlop={12} style={styles.closeBtn}>
              <X size={18} color="#9ca3af" />
            </Pressable>
          </View>

          {/* Step body */}
          {step === 'connect' && (
            <ConnectStep
              ble={ble}
              devState={dev.state}
              battery={dev.battery}
              error={dev.error}
              onConnect={handleConnect}
              onCancel={handleClose}
            />
          )}

          {step === 'choose' && (
            <ChooseStep
              deviceName={dev.device?.name ?? 'Pulse'}
              battery={dev.battery}
              counter={dev.counter ?? 0}
              dateMode={dateMode}
              profileComplete={profileComplete}
              onSyncOnly={handleSyncOnly}
              onSyncThenLive={handleSyncThenLive}
              onStartLive={handleStartLive}
              onDone={handleClose}
            />
          )}

          {step === 'syncing' && (
            <SyncingStep
              packets={sync.progress?.packetsReceived ?? 0}
              decoded={sync.progress?.throwsDecoded ?? 0}
              status={sync.status}
              error={sync.error}
            />
          )}

          {step === 'live' && (
            <LiveStep
              throws={live.throws.length}
              lastThrow={live.throws[live.throws.length - 1]}
              pulseDotStyle={pulseDotStyle}
              onStop={handleStopLive}
            />
          )}

          {step === 'done' && (
            <DoneStep
              syncCommitted={sync.committedCount}
              liveThrows={live.throws.length}
              onClose={handleClose}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════
// Step: Connect
// ═════════════════════════════════════════════════════════════

function ConnectStep({
  ble,
  devState,
  battery,
  error,
  onConnect,
  onCancel,
}: {
  ble: ReturnType<typeof usePulse>['ble'];
  devState: ReturnType<typeof usePulse>['dev']['state'];
  battery: number | null;
  error: string | null;
  onConnect: () => void;
  onCancel: () => void;
}) {
  // Classify the error so we can show the right recovery CTA. Plain scan
  // timeouts ("No Pulse found…") retry cleanly, but BLE-off and permission-
  // denied cases need the athlete to go to iOS Settings — a retry button
  // alone won't do anything.
  const errKind = ((): 'none' | 'not-found' | 'bt-off' | 'unauthorized' | 'other' => {
    if (!error) return 'none';
    const msg = error.toLowerCase();
    if (msg.includes('poweredoff') || msg.includes('powered off')) return 'bt-off';
    if (msg.includes('unauthorized')) return 'unauthorized';
    if (msg.includes('no pulse') || msg.includes('not found') || msg.includes('timeout'))
      return 'not-found';
    return 'other';
  })();
  if (!ble.supported) {
    return (
      <View style={styles.body}>
        <View style={[styles.iconCircle, { backgroundColor: 'rgba(248,113,113,0.1)' }]}>
          <BluetoothOff size={32} color="#f87171" />
        </View>
        <Text style={styles.title}>Bluetooth not available</Text>
        <Text style={styles.subtitle}>{ble.reason ?? 'This build does not support BLE.'}</Text>
        <Pressable style={styles.ghostBtn} onPress={onCancel}>
          <Text style={styles.ghostBtnText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  const isWorking = devState === 'requesting' || devState === 'connecting';
  const isError = devState === 'error';
  const isConnected = devState === 'connected';

  // Build human-friendly title + subtitle based on state + error kind
  const title = isWorking
    ? 'Connecting…'
    : isConnected
    ? 'Connected'
    : errKind === 'not-found'
    ? "Can't find your Pulse"
    : errKind === 'bt-off'
    ? 'Bluetooth is off'
    : errKind === 'unauthorized'
    ? 'Bluetooth permission denied'
    : isError
    ? 'Connection failed'
    : 'Connect your Pulse';

  const subtitle = isWorking
    ? 'Scanning for your sensor — keep your phone close.'
    : isConnected
    ? battery != null
      ? `Battery ${battery}%`
      : 'Ready to go.'
    : errKind === 'not-found'
    ? 'Make sure the sensor is awake (tap it) and within a few feet of your phone. Some sensors sleep after inactivity — a quick press wakes them up.'
    : errKind === 'bt-off'
    ? 'Turn on Bluetooth in iOS Settings, then try again.'
    : errKind === 'unauthorized'
    ? 'ASP Boost needs Bluetooth permission to talk to your Pulse. Open Settings → ASP Boost → Bluetooth to allow.'
    : isError
    ? error ?? 'Something went wrong. Try again.'
    : 'Make sure your sensor is on and within range.';

  // Primary CTA: "Retry" for recoverable errors, "Open Settings" for the
  // cases the athlete can't fix inside the app.
  const needsSettings = errKind === 'bt-off' || errKind === 'unauthorized';
  const primaryLabel = isError
    ? needsSettings
      ? 'Open Settings'
      : 'Try again'
    : 'Connect Pulse';
  const onPrimary = needsSettings
    ? () => Linking.openURL('app-settings:').catch(() => {})
    : onConnect;

  return (
    <View style={styles.body}>
      <View
        style={[
          styles.iconCircle,
          {
            backgroundColor: isConnected
              ? 'rgba(52,211,153,0.1)'
              : isError
              ? 'rgba(248,113,113,0.1)'
              : 'rgba(155,221,255,0.08)',
          },
        ]}
      >
        {isWorking ? (
          <ActivityIndicator size="large" color="#9BDDFF" />
        ) : isError ? (
          <BluetoothOff size={32} color="#f87171" />
        ) : isConnected ? (
          <Check size={32} color="#34d399" strokeWidth={3} />
        ) : (
          <Bluetooth size={32} color="#9BDDFF" />
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {/* Primary button only when there's something to tap. While the scan is
          in flight or the handshake just completed, we auto-advance. */}
      {!isWorking && !isConnected && (
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
          onPress={onPrimary}
        >
          <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
        </Pressable>
      )}
      {!isConnected && (
        <Pressable onPress={onCancel} hitSlop={8}>
          <Text style={styles.ghostBtnText}>{isError ? 'Close' : 'Cancel'}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ═════════════════════════════════════════════════════════════
// Step: Choose
// ═════════════════════════════════════════════════════════════

function ChooseStep({
  deviceName,
  battery,
  counter,
  dateMode,
  profileComplete,
  onSyncOnly,
  onSyncThenLive,
  onStartLive,
  onDone,
}: {
  deviceName: string;
  battery: number | null;
  counter: number;
  dateMode: 'today' | 'past' | 'future';
  profileComplete: boolean;
  onSyncOnly: () => void;
  onSyncThenLive: () => void;
  onStartLive: () => void;
  onDone: () => void;
}) {
  const hasCached = counter > 0;
  const canLive = dateMode === 'today';

  return (
    <View style={styles.body}>
      {/* Sensor card */}
      <View style={styles.sensorCard}>
        <View style={styles.sensorCardLeft}>
          <View style={styles.sensorDot} />
          <Text style={styles.sensorName} numberOfLines={1}>
            {deviceName}
          </Text>
        </View>
        <View style={styles.sensorCardRight}>
          {battery != null && (
            <Text style={styles.sensorMeta}>{battery}%</Text>
          )}
          <View style={styles.sensorCounter}>
            <Zap size={12} color="#9BDDFF" />
            <Text style={styles.sensorCounterText}>
              {hasCached ? `${counter} cached` : 'Ready'}
            </Text>
          </View>
        </View>
      </View>

      {!profileComplete && (
        <View style={styles.warnRow}>
          <AlertTriangle size={14} color="#facc15" />
          <Text style={styles.warnText}>
            Height/weight missing — workload math will be approximate.
          </Text>
        </View>
      )}

      {dateMode === 'future' ? (
        <>
          <Text style={styles.title}>Future day</Text>
          <Text style={styles.subtitle}>
            No throws can be logged on a future date.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={onDone}>
            <Text style={styles.primaryBtnText}>Got it</Text>
          </Pressable>
        </>
      ) : hasCached ? (
        <>
          <Text style={styles.title}>Sync your throws</Text>
          <Text style={styles.subtitle}>
            {counter} {counter === 1 ? 'throw is' : 'throws are'} ready to commit
            from your sensor.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={onSyncOnly}
          >
            <Download size={16} color="#000" />
            <Text style={styles.primaryBtnText}>Sync {counter}</Text>
          </Pressable>
          {canLive && (
            <Pressable onPress={onSyncThenLive} hitSlop={8}>
              <Text style={styles.ghostBtnText}>Sync, then start live</Text>
            </Pressable>
          )}
        </>
      ) : canLive ? (
        <>
          <Text style={styles.title}>Ready to throw</Text>
          <Text style={styles.subtitle}>
            Start a live session to stream each throw to your gauge in real time.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              !profileComplete && { opacity: 0.5 },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
            disabled={!profileComplete}
            onPress={onStartLive}
          >
            <Play size={16} color="#000" fill="#000" />
            <Text style={styles.primaryBtnText}>Start live session</Text>
          </Pressable>
          <Pressable onPress={onDone} hitSlop={8}>
            <Text style={styles.ghostBtnText}>Done for now</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.title}>Past day</Text>
          <Text style={styles.subtitle}>
            Live mode only works in real time. Sync any cached throws if the
            sensor recorded some earlier.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={onDone}>
            <Text style={styles.primaryBtnText}>Got it</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

// ═════════════════════════════════════════════════════════════
// Step: Syncing
// ═════════════════════════════════════════════════════════════

function SyncingStep({
  packets,
  decoded,
  status,
  error,
}: {
  packets: number;
  decoded: number;
  status: string;
  error: string | null;
}) {
  return (
    <View style={styles.body}>
      <View style={[styles.iconCircle, { backgroundColor: 'rgba(155,221,255,0.08)' }]}>
        <ActivityIndicator size="large" color="#9BDDFF" />
      </View>
      <Text style={styles.title}>
        {status === 'committing' ? 'Saving throws…' : 'Syncing throws…'}
      </Text>
      <Text style={styles.subtitle}>
        {decoded > 0
          ? `${decoded} decoded · ${packets} packets`
          : `${packets} packets received`}
      </Text>
      {error && <Text style={styles.errText}>{error}</Text>}
      <View style={[styles.primaryBtn, { opacity: 0.35 }]}>
        <Text style={styles.primaryBtnText}>Working…</Text>
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════
// Step: Live
// ═════════════════════════════════════════════════════════════

function LiveStep({
  throws,
  lastThrow,
  pulseDotStyle,
  onStop,
}: {
  throws: number;
  lastThrow: any;
  pulseDotStyle: any;
  onStop: () => void;
}) {
  return (
    <View style={styles.body}>
      <View style={styles.liveHeader}>
        <Animated.View style={[styles.liveDot, pulseDotStyle]} />
        <Text style={styles.liveHeaderText}>LIVE</Text>
      </View>

      <Text style={styles.liveBigNum}>{throws}</Text>
      <Text style={styles.subtitle}>{throws === 1 ? 'throw' : 'throws'}</Text>

      {lastThrow && (
        <Text style={styles.liveLast}>
          Last:  {lastThrow.torqueNm != null ? `${Math.round(lastThrow.torqueNm)} Nm` : '—'}
          {lastThrow.armSpeedDps != null ? `  ·  ${Math.round(lastThrow.armSpeedDps)} °/s` : ''}
        </Text>
      )}

      <Pressable
        style={({ pressed }) => [
          styles.stopBtn,
          pressed && { transform: [{ scale: 0.97 }] },
        ]}
        onPress={onStop}
      >
        <Square size={14} color="#fca5a5" fill="#fca5a5" />
        <Text style={styles.stopBtnText}>Stop session</Text>
      </Pressable>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════
// Step: Done
// ═════════════════════════════════════════════════════════════

function DoneStep({
  syncCommitted,
  liveThrows,
  onClose,
}: {
  syncCommitted: number;
  liveThrows: number;
  onClose: () => void;
}) {
  const totalThrows = syncCommitted + liveThrows;
  return (
    <View style={styles.body}>
      <View style={[styles.iconCircle, { backgroundColor: 'rgba(52,211,153,0.1)' }]}>
        <Check size={36} color="#34d399" strokeWidth={3} />
      </View>
      <Text style={styles.title}>Session complete</Text>
      <Text style={styles.subtitle}>
        {totalThrows > 0
          ? `${totalThrows} ${totalThrows === 1 ? 'throw' : 'throws'} committed.`
          : 'Nothing new to save.'}
      </Text>

      <Pressable
        style={({ pressed }) => [
          styles.primaryBtn,
          pressed && { transform: [{ scale: 0.97 }] },
        ]}
        onPress={onClose}
      >
        <Text style={styles.primaryBtnText}>Done</Text>
      </Pressable>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  backdropTapArea: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: '#0a0a0a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingBottom: 34,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    minHeight: 440,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotActive: {
    backgroundColor: '#9BDDFF',
    borderColor: '#9BDDFF',
  },
  dotDone: {
    backgroundColor: '#9BDDFF',
    borderColor: '#9BDDFF',
  },
  closeBtn: {
    padding: 4,
  },
  body: {
    alignItems: 'center',
    paddingTop: 24,
    paddingHorizontal: 8,
    gap: 14,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
    maxWidth: 320,
  },
  sensorCard: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    marginBottom: 8,
  },
  sensorCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  sensorCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sensorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34d399',
    shadowColor: '#34d399',
    shadowOpacity: 0.7,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  sensorName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  sensorMeta: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  sensorCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(155,221,255,0.08)',
  },
  sensorCounterText: {
    color: '#9BDDFF',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(250,204,21,0.08)',
    alignSelf: 'stretch',
  },
  warnText: {
    color: '#facc15',
    fontSize: 11,
    flex: 1,
    lineHeight: 15,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#9BDDFF',
    marginTop: 8,
    shadowColor: '#9BDDFF',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  primaryBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 16,
  },
  ghostBtn: {
    paddingVertical: 10,
  },
  ghostBtnText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  errText: {
    color: '#f87171',
    fontSize: 12,
    textAlign: 'center',
  },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#f87171',
    shadowColor: '#f87171',
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  liveHeaderText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  liveBigNum: {
    color: '#9BDDFF',
    fontSize: 96,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    lineHeight: 100,
    letterSpacing: -2,
    marginTop: 12,
  },
  liveLast: {
    color: '#6b7280',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    paddingVertical: 16,
    borderRadius: 14,
    borderColor: 'rgba(248,113,113,0.3)',
    borderWidth: 1,
    marginTop: 20,
  },
  stopBtnText: {
    color: '#fca5a5',
    fontWeight: '700',
    fontSize: 15,
  },
});
