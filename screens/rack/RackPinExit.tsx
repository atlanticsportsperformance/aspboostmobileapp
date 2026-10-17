/**
 * Exit Rack mode: staff enter the rack PIN (rack_verify_pin). On success the
 * rack rep + set queues are drained (bounded, DRAIN_TIMEOUT_MS) BEFORE
 * rack_device_v1 is cleared, so nothing queued here is sent later under a
 * different login (data-layer note M-8). Items still queued after the wait are
 * reported; they stay on this iPad and upload the next time Rack mode runs.
 * Wrong PIN: shake + "Wrong PIN", no lockout.
 */

import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { createRackApi, type RackClient } from '../../lib/rack/api';
import { createRackPersist } from '../../lib/rack/persist';
import { clearRackDevice, drainRackQueues, type DrainResult } from '../../lib/rack/device';
import { lockPortrait } from '../../lib/rack/orientation';

type Phase = 'pin' | 'checking' | 'draining' | 'leftover';

export default function RackPinExit() {
  const navigation = useNavigation<any>();
  const { staffOrgId } = useAuth();
  const client = supabase as unknown as RackClient;
  const api = useMemo(() => createRackApi(client), [client]);
  const persist = useMemo(() => createRackPersist({ client, orgId: staffOrgId ?? '' }), [client, staffOrgId]);

  const [pin, setPin] = useState('');
  const [phase, setPhase] = useState<Phase>('pin');
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<DrainResult | null>(null);
  const shake = useRef(new Animated.Value(0)).current;

  const doShake = () => {
    shake.setValue(0);
    Animated.sequence(
      [12, -12, 9, -9, 5, -5, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 45, useNativeDriver: true })),
    ).start();
  };

  const leave = async () => {
    await clearRackDevice();
    await lockPortrait();
    navigation.reset({ index: 0, routes: [{ name: 'CoachDashboard' }] });
  };

  const drainThenLeave = async () => {
    setPhase('draining');
    const res = await drainRackQueues(persist);
    if (!res.drained) {
      setLeft(res);
      setPhase('leftover');
      return;
    }
    await leave();
  };

  const submit = async () => {
    if (!pin || phase !== 'pin') return;
    setPhase('checking');
    setError(null);
    let ok = false;
    try {
      ok = await api.verifyPin(pin);
    } catch (e) {
      console.warn('[rack exit] verify PIN failed', e);
      setError("Couldn't check the PIN. Check the connection.");
      setPhase('pin');
      return;
    }
    if (!ok) {
      setError('Wrong PIN');
      setPin('');
      setPhase('pin');
      doShake();
      return;
    }
    await drainThenLeave();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.card}>
        {phase === 'pin' || phase === 'checking' ? (
          <>
            <Text style={styles.title}>Exit Rack mode</Text>
            <Text style={styles.muted}>Enter the rack PIN.</Text>
            <Animated.View style={{ transform: [{ translateX: shake }] }}>
              <TextInput
                style={styles.input}
                value={pin}
                onChangeText={(t) => setPin(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                secureTextEntry
                autoFocus
                maxLength={12}
                onSubmitEditing={submit}
                editable={phase === 'pin'}
              />
            </Animated.View>
            {error && <Text style={styles.err}>{error}</Text>}
            <View style={styles.row}>
              <TouchableOpacity style={styles.btnGhost} onPress={() => navigation.goBack()} disabled={phase !== 'pin'}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, (!pin || phase !== 'pin') && styles.btnOff]} onPress={submit} disabled={!pin || phase !== 'pin'}>
                <Text style={styles.btnText}>{phase === 'checking' ? 'Checking…' : 'Exit'}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : phase === 'draining' ? (
          <>
            <ActivityIndicator color="#9BDDFF" size="large" />
            <Text style={styles.muted}>Uploading this rack's reps and sets…</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Not everything uploaded</Text>
            <Text style={styles.muted}>
              {left && left.reps >= 0
                ? `${left.reps} rep${left.reps === 1 ? '' : 's'} and ${left.sets} set${left.sets === 1 ? '' : 's'} are still waiting (no connection?).`
                : 'Some reps or sets are still waiting (no connection?).'}{' '}
              They stay on this iPad and upload the next time Rack mode runs here.
            </Text>
            <View style={styles.row}>
              <TouchableOpacity style={styles.btnGhost} onPress={leave}>
                <Text style={styles.btnGhostText}>Exit anyway</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={drainThenLeave}>
                <Text style={styles.btnText}>Try again</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 420, padding: 24, gap: 14, alignItems: 'stretch' },
  title: { fontSize: 20, fontWeight: '700', color: 'rgba(255,255,255,0.9)', textAlign: 'center' },
  muted: { fontSize: 14, color: 'rgba(255,255,255,0.55)', textAlign: 'center' },
  err: { fontSize: 14, fontWeight: '600', color: '#E5534B', textAlign: 'center' },
  input: {
    backgroundColor: '#131317', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12,
    paddingVertical: 14, fontSize: 24, letterSpacing: 8, textAlign: 'center', color: '#fff',
  },
  row: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, backgroundColor: '#9BDDFF', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnOff: { opacity: 0.4 },
  btnText: { fontSize: 15, fontWeight: '700', color: '#0a0a0a' },
  btnGhost: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnGhostText: { fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
});
