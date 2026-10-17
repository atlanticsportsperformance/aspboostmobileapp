/**
 * One-time Rack mode setup on an iPad (staff only, reached from Tools):
 *   1. pick a rack or create one by name (staff insert through RLS; the
 *      rack_sessions row is created by a DB trigger)
 *   2. pair the OVR sensor → racks.ovr_device_name (or skip, pair later)
 *   3. the rack PIN (exits Rack mode): skipped when the org has one,
 *      otherwise set + confirm — see PinStep
 *   4. save { rackId, rackName } to rack_device_v1, enter Rack mode.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { createRackApi, type Rack, type RackClient } from '../../lib/rack/api';
import { isTabletDevice, saveRackDevice } from '../../lib/rack/device';
import { scanOvrSensors } from '../../lib/ovr/scan';

type Step = 'rack' | 'pair' | 'pin';
const PIN_RE = /^[0-9]{4,12}$/;

export default function RackSetupScreen() {
  const navigation = useNavigation<any>();
  const { isStaff, staffOrgId, user } = useAuth();
  const api = useRef(createRackApi(supabase as unknown as RackClient)).current;

  const [step, setStep] = useState<Step>('rack');
  const [rack, setRack] = useState<Rack | null>(null);

  const allowed = isStaff && !!staffOrgId && isTabletDevice();

  const finish = useCallback(
    async (r: Rack) => {
      await saveRackDevice({ rackId: r.id, rackName: r.name, ovrDeviceName: r.ovrDeviceName });
      navigation.reset({ index: 0, routes: [{ name: 'RackMode' }] });
    },
    [navigation],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (step === 'rack' ? navigation.goBack() : setStep(step === 'pin' ? 'pair' : 'rack'))}>
          <Ionicons name="chevron-back" size={24} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
        <Text style={styles.title}>Set up this iPad as a rack</Text>
        <Text style={styles.stepLabel}>{step === 'rack' ? '1' : step === 'pair' ? '2' : '3'} / 3</Text>
      </View>

      {!allowed ? (
        <View style={styles.body}>
          <Text style={styles.muted}>Rack mode is for staff on an iPad.</Text>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {step === 'rack' && (
              <RackStep
                api={api}
                orgId={staffOrgId!}
                userId={user?.id ?? null}
                onPicked={(r) => {
                  setRack(r);
                  setStep('pair');
                }}
              />
            )}
            {step === 'pair' && rack && (
              <PairStep
                rack={rack}
                onDone={(r) => {
                  setRack(r);
                  setStep('pin');
                }}
              />
            )}
            {step === 'pin' && rack && <PinStep api={api} onDone={() => finish(rack)} />}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- 1. rack

function RackStep({
  api,
  orgId,
  userId,
  onPicked,
}: {
  api: ReturnType<typeof createRackApi>;
  orgId: string;
  userId: string | null;
  onPicked: (r: Rack) => void;
}) {
  const [racks, setRacks] = useState<Rack[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listRacks(orgId)
      .then(setRacks)
      .catch((e) => {
        console.warn('[rack setup] listRacks failed', e);
        setRacks([]);
        setError("Couldn't load racks. Check the connection.");
      });
  }, [api, orgId]);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('racks')
      .insert({ org_id: orgId, name: n, created_by: userId })
      .select('id, org_id, name, ovr_device_name, active')
      .single();
    setBusy(false);
    if (err || !data) {
      setError(err?.code === '23505' ? `A rack named "${n}" already exists — pick it above.` : "Couldn't create the rack.");
      return;
    }
    onPicked({ id: data.id, orgId: data.org_id, name: data.name, ovrDeviceName: data.ovr_device_name ?? null, active: true });
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.h}>Which rack is this iPad on?</Text>
      {racks === null ? (
        <ActivityIndicator color="#9BDDFF" />
      ) : (
        racks.map((r) => (
          <TouchableOpacity key={r.id} style={styles.row} onPress={() => onPicked(r)}>
            <Text style={styles.rowTitle}>{r.name}</Text>
            <Text style={styles.rowSub}>{r.ovrDeviceName ?? 'No sensor paired'}</Text>
            <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
        ))
      )}
      <Text style={[styles.h, { marginTop: 12 }]}>Or add a new rack</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={name}
          onChangeText={setName}
          placeholder="Rack 3"
          placeholderTextColor="rgba(255,255,255,0.3)"
          returnKeyType="done"
          onSubmitEditing={create}
        />
        <TouchableOpacity style={[styles.btn, (!name.trim() || busy) && styles.btnOff]} disabled={!name.trim() || busy} onPress={create}>
          <Text style={styles.btnText}>{busy ? 'Adding…' : 'Add'}</Text>
        </TouchableOpacity>
      </View>
      {error && <Text style={styles.err}>{error}</Text>}
    </View>
  );
}

// ---------------------------------------------------------------- 2. pair

function PairStep({ rack, onDone }: { rack: Rack; onDone: (r: Rack) => void }) {
  const [found, setFound] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const scan = useCallback(() => {
    stopRef.current?.();
    setFound([]);
    setError(null);
    setScanning(true);
    const s = scanOvrSensors((n) => setFound((f) => (f.includes(n) ? f : [...f, n])));
    stopRef.current = s.stop;
    s.done
      .then((names) => {
        if (names.length === 0) setError('No OVR sensor found. Make sure it is on and not connected to another iPad.');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setScanning(false));
  }, []);

  useEffect(() => {
    if (!rack.ovrDeviceName) scan();
    return () => stopRef.current?.();
  }, [rack.ovrDeviceName, scan]);

  const pick = async (deviceName: string) => {
    stopRef.current?.();
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.from('racks').update({ ovr_device_name: deviceName }).eq('id', rack.id);
    setSaving(false);
    if (err) {
      setError("Couldn't save the sensor. Try again.");
      return;
    }
    onDone({ ...rack, ovrDeviceName: deviceName });
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.h}>Pair the OVR sensor for {rack.name}</Text>
      {rack.ovrDeviceName && (
        <TouchableOpacity style={[styles.row, styles.rowOn]} onPress={() => onDone(rack)}>
          <Text style={styles.rowTitle}>Keep {rack.ovrDeviceName}</Text>
          <Ionicons name="checkmark" size={18} color="#9BDDFF" />
        </TouchableOpacity>
      )}
      {found.map((n) => (
        <TouchableOpacity key={n} style={styles.row} disabled={saving} onPress={() => pick(n)}>
          <Ionicons name="bluetooth" size={18} color="#9BDDFF" />
          <Text style={styles.rowTitle}>{n}</Text>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>
      ))}
      {scanning ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <ActivityIndicator color="#9BDDFF" />
          <Text style={styles.muted}>Looking for sensors…</Text>
        </View>
      ) : (
        <TouchableOpacity style={styles.btnGhost} onPress={scan}>
          <Text style={styles.btnGhostText}>{found.length || rack.ovrDeviceName ? 'Scan again' : 'Scan'}</Text>
        </TouchableOpacity>
      )}
      {error && <Text style={styles.err}>{error}</Text>}
      <TouchableOpacity
        style={styles.btnGhost}
        onPress={() => {
          stopRef.current?.();
          onDone(rack);
        }}
      >
        <Text style={styles.btnGhostText}>Skip — pair later</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------- 3. PIN

/**
 * rack_pin_is_set() decides the step:
 *   true  → skip (nothing to do; Exit verifies the PIN later)
 *   false → enter + confirm, then rack_set_pin
 *   error → block with Retry; never fall through to setting a PIN.
 * Changing an existing PIN is out of scope.
 */
function PinStep({ api, onDone }: { api: ReturnType<typeof createRackApi>; onDone: () => Promise<void> }) {
  const [status, setStatus] = useState<'checking' | 'unset' | 'error'>('checking');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('checking');
    setError(null);
    let isSet: boolean;
    try {
      isSet = await api.pinIsSet();
    } catch (e) {
      console.warn('[rack setup] rack_pin_is_set failed', e);
      setStatus('error');
      return;
    }
    if (isSet) {
      await onDone();
      return;
    }
    setStatus('unset');
  }, [api, onDone]);

  useEffect(() => {
    load();
    // Run once per mount of this step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setNew = async () => {
    if (!PIN_RE.test(pin)) {
      setError('The PIN is 4–12 digits.');
      return;
    }
    if (confirm !== pin) {
      setError("The PINs don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setPin(pin);
      await onDone();
    } catch (e) {
      console.warn('[rack setup] set PIN failed', e);
      setError("Couldn't save the PIN. Check the connection.");
    } finally {
      setBusy(false);
    }
  };

  if (status === 'checking') {
    return (
      <View style={{ gap: 12, alignItems: 'center' }}>
        <ActivityIndicator color="#9BDDFF" />
        <Text style={styles.muted}>Checking the rack PIN…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={{ gap: 12 }}>
        <Text style={styles.h}>Rack PIN</Text>
        <Text style={styles.err}>Couldn't check the rack PIN. Check the connection.</Text>
        <TouchableOpacity style={styles.btn} onPress={load}>
          <Text style={styles.btnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.h}>Set the rack PIN</Text>
      <Text style={styles.muted}>Staff enter it to exit Rack mode. Every rack iPad uses the same PIN.</Text>
      <TextInput
        style={styles.input}
        value={pin}
        onChangeText={(t) => setPin(t.replace(/[^0-9]/g, ''))}
        placeholder="PIN (4–12 digits)"
        placeholderTextColor="rgba(255,255,255,0.3)"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={12}
      />
      <TextInput
        style={styles.input}
        value={confirm}
        onChangeText={(t) => setConfirm(t.replace(/[^0-9]/g, ''))}
        placeholder="Confirm PIN"
        placeholderTextColor="rgba(255,255,255,0.3)"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={12}
      />
      <TouchableOpacity style={[styles.btn, busy && styles.btnOff]} disabled={busy} onPress={setNew}>
        <Text style={styles.btnText}>{busy ? 'Saving…' : 'Set rack PIN'}</Text>
      </TouchableOpacity>
      {error && <Text style={styles.err}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  stepLabel: { fontSize: 13, color: 'rgba(255,255,255,0.4)' },
  body: { padding: 24, gap: 12, maxWidth: 560, width: '100%', alignSelf: 'center' },
  h: { fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  muted: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  err: { fontSize: 13, color: '#E5534B' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#131317',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 16,
  },
  rowOn: { borderColor: 'rgba(155,221,255,0.4)' },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  rowSub: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  input: {
    backgroundColor: '#131317', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#fff',
  },
  btn: { backgroundColor: '#9BDDFF', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center' },
  btnOff: { opacity: 0.4 },
  btnText: { fontSize: 15, fontWeight: '700', color: '#0a0a0a' },
  btnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnGhostText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
});
