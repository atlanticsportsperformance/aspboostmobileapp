/**
 * BluetoothPermissionSheet — modal that explains why ASP Boost needs
 * Bluetooth and walks the user through enabling / granting access.
 *
 * Used in three places:
 *   1. ArmCare wizard intro (Activ5 sensor)
 *   2. Pulse wizard intro (Motus Pulse sensor)
 *   3. Settings dropdown ("Bluetooth" row) — pure status check
 *
 * iOS reality:
 *   - The system permission prompt only appears the FIRST time we
 *     instantiate a BleManager. We surface a "We need Bluetooth" page
 *     before we touch ble-plx so the user sees our rationale FIRST,
 *     then taps Continue → iOS prompt fires.
 *   - If the user already denied, the prompt never re-appears. The only
 *     way back is iOS Settings → ASP Boost → Bluetooth. We deep-link.
 *   - If the radio is off, we can't toggle it. We deep-link to Settings
 *     (or instruct Control Center).
 *   - Live state listener so when the user flips the switch and comes
 *     back, the sheet self-updates and auto-advances.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  AppState,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BluetoothPermissionState,
  getBluetoothState,
  onBluetoothStateChange,
  openBluetoothSettings,
} from '../lib/ble/permissions';

export type BluetoothPermissionContext = 'armcare' | 'pulse' | 'settings';

interface Props {
  visible: boolean;
  context: BluetoothPermissionContext;
  /** Fires when state becomes 'on'. The wizards use this to advance to
   *  the connect step. Settings sheet ignores it. */
  onReady?: () => void;
  /** Auto-dismiss on 'on' state for wizards (default true). Settings
   *  passes false so the user can stay and read. */
  autoDismissWhenReady?: boolean;
  onClose: () => void;
}

const COPY: Record<
  BluetoothPermissionContext,
  { title: string; rationale: string }
> = {
  armcare: {
    title: 'Connect your Activ5',
    rationale:
      'ASP Boost uses Bluetooth to talk to your Activ5 strength sensor — that’s how we record force, calculate ArmScore, and time each rep.',
  },
  pulse: {
    title: 'Connect your Pulse',
    rationale:
      'ASP Boost uses Bluetooth to sync your Motus Pulse sensor and track every throw’s torque, arm speed, and workload in real time.',
  },
  settings: {
    title: 'Bluetooth status',
    rationale:
      'Bluetooth is required to use the Activ5 strength sensor and the Motus Pulse throwing sensor.',
  },
};

export function BluetoothPermissionSheet({
  visible,
  context,
  onReady,
  autoDismissWhenReady = true,
  onClose,
}: Props) {
  const [state, setState] = useState<BluetoothPermissionState>('unknown');
  // Track whether the user has clicked through the "We need Bluetooth"
  // rationale and we've actually touched ble-plx (which is what triggers
  // the iOS prompt). For Settings context we skip the rationale because
  // the user explicitly came to check status.
  const [probed, setProbed] = useState(context === 'settings');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Subscribe once we've decided to probe.
  useEffect(() => {
    if (!visible || !probed) return;
    let cancelled = false;
    const unsub = onBluetoothStateChange((s) => {
      if (cancelled) return;
      setState(s);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [visible, probed]);

  // When the app comes back from Settings the state should re-emit
  // automatically via ble-plx; no extra polling needed. But in some
  // edge cases (Resetting → PoweredOn transitions), an explicit
  // re-check on resume helps the UI feel snappy.
  useEffect(() => {
    if (!visible || !probed) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        getBluetoothState().then(setState).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [visible, probed]);

  // Auto-advance / fire onReady when state flips on.
  useEffect(() => {
    if (state !== 'on') return;
    if (autoDismissWhenReady && context !== 'settings') {
      // Brief delay so the user sees the green confirmation before we
      // dismiss — feels intentional rather than abrupt.
      const t = setTimeout(() => {
        onReady?.();
        onClose();
      }, 700);
      return () => clearTimeout(t);
    }
  }, [state, autoDismissWhenReady, context, onReady, onClose]);

  // Fade the modal content in.
  useEffect(() => {
    if (!visible) {
      fadeAnim.setValue(0);
      return;
    }
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, fadeAnim]);

  const copy = COPY[context];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View style={[styles.cardWrap, { opacity: fadeAnim }]}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={styles.card}
          >
            <LinearGradient
              colors={[stateColor(state) + '24', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />

            {/* Big icon mark */}
            <View
              style={[
                styles.iconWrap,
                {
                  backgroundColor: stateColor(state) + '14',
                  borderColor: stateColor(state) + '55',
                },
              ]}
            >
              <Ionicons
                name={iconForState(state)}
                size={32}
                color={stateColor(state)}
              />
            </View>

            <Text style={styles.title}>
              {!probed ? copy.title : titleForState(state, copy.title)}
            </Text>
            <Text style={styles.body}>
              {!probed ? copy.rationale : bodyForState(state, copy.rationale)}
            </Text>

            <View style={styles.actions}>
              {!probed ? (
                <PrimaryBtn
                  label="Continue"
                  hex="#9BDDFF"
                  onPress={() => {
                    setProbed(true);
                    // First call to getBluetoothState() instantiates the
                    // BleManager which triggers the iOS prompt the very
                    // first time. After that the listener handles updates.
                    getBluetoothState().then(setState).catch(() => {});
                  }}
                />
              ) : (
                <ActionsForState
                  state={state}
                  context={context}
                  onClose={onClose}
                  onReady={() => {
                    onReady?.();
                    onClose();
                  }}
                  onRetry={() => {
                    getBluetoothState().then(setState).catch(() => {});
                  }}
                />
              )}

              {context !== 'settings' && (
                <Pressable
                  onPress={onClose}
                  hitSlop={6}
                  style={styles.cancelLink}
                >
                  <Text style={styles.cancelText}>Not now</Text>
                </Pressable>
              )}
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// State-driven sub-components
// ─────────────────────────────────────────────────────────────

function ActionsForState({
  state,
  context,
  onReady,
  onClose,
  onRetry,
}: {
  state: BluetoothPermissionState;
  context: BluetoothPermissionContext;
  onReady: () => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  if (state === 'unknown' || state === 'resetting') {
    return (
      <View style={styles.spinnerRow}>
        <ActivityIndicator color="#9BDDFF" />
        <Text style={styles.spinnerText}>
          {state === 'resetting' ? 'Bluetooth resetting…' : 'Checking permission…'}
        </Text>
      </View>
    );
  }

  if (state === 'on') {
    if (context === 'settings') {
      return null; // Status sheet — no CTA needed once it's already on.
    }
    return <PrimaryBtn label="Bluetooth ready" hex="#34d399" onPress={onReady} />;
  }

  if (state === 'native-missing') {
    return (
      <PrimaryBtn
        label="Close"
        hex="#9BDDFF"
        onPress={onClose}
      />
    );
  }

  if (state === 'unsupported') {
    return <PrimaryBtn label="Close" hex="#9BDDFF" onPress={onClose} />;
  }

  // 'off' or 'unauthorized' — both end in the same place: open Settings.
  return (
    <View style={{ alignSelf: 'stretch', gap: 8 }}>
      <PrimaryBtn
        label="Open Settings"
        hex="#9BDDFF"
        leadingIcon="settings-outline"
        onPress={() => {
          openBluetoothSettings();
        }}
      />
      <Pressable onPress={onRetry} hitSlop={6} style={styles.retryLink}>
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function PrimaryBtn({
  label,
  hex,
  leadingIcon,
  onPress,
}: {
  label: string;
  hex: string;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryBtn,
        { backgroundColor: hex },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      {leadingIcon ? <Ionicons name={leadingIcon} size={16} color="#000" /> : null}
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// State → copy / icon / color
// ─────────────────────────────────────────────────────────────

function iconForState(state: BluetoothPermissionState): keyof typeof Ionicons.glyphMap {
  switch (state) {
    case 'on':
      return 'checkmark-circle';
    case 'off':
      return 'bluetooth';
    case 'unauthorized':
      return 'lock-closed';
    case 'unsupported':
    case 'native-missing':
      return 'alert-circle';
    case 'resetting':
    case 'unknown':
    default:
      return 'bluetooth';
  }
}

function stateColor(state: BluetoothPermissionState): string {
  switch (state) {
    case 'on':
      return '#34d399';
    case 'off':
    case 'unauthorized':
      return '#f97316';
    case 'unsupported':
    case 'native-missing':
      return '#ef4444';
    default:
      return '#9BDDFF';
  }
}

function titleForState(state: BluetoothPermissionState, defaultTitle: string): string {
  switch (state) {
    case 'on':
      return 'Bluetooth ready';
    case 'off':
      return 'Bluetooth is off';
    case 'unauthorized':
      return 'Permission needed';
    case 'unsupported':
      return 'Bluetooth unavailable';
    case 'native-missing':
      return 'Open the installed app';
    case 'resetting':
      return 'Bluetooth resetting';
    default:
      return defaultTitle;
  }
}

function bodyForState(state: BluetoothPermissionState, defaultBody: string): string {
  switch (state) {
    case 'on':
      return 'You’re all set. We can talk to your sensor.';
    case 'off':
      return 'Bluetooth is turned off. Open Settings or Control Center, flip Bluetooth on, then come back.';
    case 'unauthorized':
      return 'ASP Boost doesn’t have Bluetooth permission. Open Settings → ASP Boost → Bluetooth and toggle it on.';
    case 'unsupported':
      return 'This device doesn’t support Bluetooth Low Energy. Sensor features won’t be available.';
    case 'native-missing':
      return 'You’re running a web preview or Expo Go. Bluetooth requires the installed dev or TestFlight build.';
    case 'resetting':
      return 'iOS is restarting Bluetooth. Hold tight—this only takes a second.';
    default:
      return defaultBody;
  }
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  cardWrap: { alignSelf: 'stretch' },
  card: {
    borderRadius: 24,
    backgroundColor: '#0d0d0d',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 22,
    alignItems: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 18,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 22,
  },
  actions: { alignSelf: 'stretch', alignItems: 'center', gap: 4 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
  },
  spinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  spinnerText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
  },
  retryLink: { paddingVertical: 8, alignItems: 'center' },
  retryText: {
    color: '#9BDDFF',
    fontSize: 13,
    fontWeight: '700',
  },
  cancelLink: { marginTop: 8, paddingVertical: 4 },
  cancelText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
});
