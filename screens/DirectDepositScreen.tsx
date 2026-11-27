import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { bankLink, getDirectDeposit, refreshDirectDeposit, saveW9, type DirectDepositStatus, type W9Form } from '../lib/directDepositApi';

const EMPTY: W9Form = { legal_name: '', business_name: '', tin_type: 'ssn', tin: '', address_line1: '', city: '', state: '', zip: '', certify: false };

export default function DirectDepositScreen() {
  const navigation = useNavigation<any>();
  const [s, setS] = useState<DirectDepositStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<W9Form>(EMPTY);

  const load = useCallback(async (refresh: boolean) => {
    try {
      const next = refresh ? await refreshDirectDeposit() : await getDirectDeposit();
      setS((prev) => ({ ...(prev ?? {}), ...next }));
      setErr(null);
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(false).then(() => load(true)); }, [load]);

  async function submitW9() {
    setBusy(true); setErr(null);
    try { await saveW9(f); setF((x) => ({ ...x, tin: '' })); await load(false); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function connectBank() {
    setBusy(true); setErr(null);
    try {
      const { url } = await bankLink();
      await WebBrowser.openBrowserAsync(url);
      await load(true); // they closed Stripe's page — ask Stripe if it's ready
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const set = <K extends keyof W9Form>(k: K) => (v: W9Form[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
        <Text style={st.title}>Direct deposit</Text>
        <View style={{ width: 24 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={st.pad} keyboardShouldPersistTaps="handled">
          {!s ? <ActivityIndicator color="#9BDDFF" style={{ marginTop: 40 }} /> : <>
            {err && <View style={st.err}><Text style={st.errText}>{err}</Text></View>}

            {s.ready ? (
              <View style={[st.card, st.cardDone]}>
                <View style={st.row}><Text style={st.cardTitle}>You&apos;re all set</Text><Text style={st.pill}>Ready</Text></View>
                <Text style={st.big}>{s.payout_label}</Text>
                <Text style={st.sub}>Pay arrives the next business day after the office sends it.</Text>
              </View>
            ) : (
              <Text style={st.lead}>Get paid straight to your bank, next business day. Two steps, about 3 minutes.</Text>
            )}

            <View style={st.card}>
              <View style={st.row}>
                <Text style={st.cardTitle}>1 · Tax info (W-9)</Text>
                {s.w9_done && <Text style={st.done}>Done · ••{s.w9_tin_last4}</Text>}
              </View>
              {!s.w9_done && <>
                <Text style={st.sub}>Your full tax ID goes straight to our QuickBooks for your 1099. We only keep the last 4.</Text>
                <TextInput style={st.input} placeholder="Legal name" placeholderTextColor="rgba(255,255,255,0.3)" value={f.legal_name} onChangeText={set('legal_name')} autoComplete="name" />
                <TextInput style={st.input} placeholder="Business name (optional)" placeholderTextColor="rgba(255,255,255,0.3)" value={f.business_name} onChangeText={set('business_name')} />
                <View style={st.two}>
                  <View style={st.seg}>
                    {(['ssn', 'ein'] as const).map((t) => (
                      <TouchableOpacity key={t} onPress={() => set('tin_type')(t)} style={[st.segBtn, f.tin_type === t && st.segOn]}>
                        <Text style={[st.segText, f.tin_type === t && st.segTextOn]}>{t.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput style={[st.input, { flex: 1 }]} placeholder={f.tin_type === 'ein' ? 'EIN' : 'Social Security number'} placeholderTextColor="rgba(255,255,255,0.3)"
                    value={f.tin} onChangeText={set('tin')} keyboardType="number-pad" secureTextEntry autoComplete="off" />
                </View>
                <TextInput style={st.input} placeholder="Street address" placeholderTextColor="rgba(255,255,255,0.3)" value={f.address_line1} onChangeText={set('address_line1')} autoComplete="street-address" />
                <View style={st.two}>
                  <TextInput style={[st.input, { flex: 1 }]} placeholder="City" placeholderTextColor="rgba(255,255,255,0.3)" value={f.city} onChangeText={set('city')} />
                  <TextInput style={[st.input, { width: 60 }]} placeholder="ST" placeholderTextColor="rgba(255,255,255,0.3)" value={f.state} onChangeText={(v) => set('state')(v.toUpperCase())} maxLength={2} autoCapitalize="characters" />
                  <TextInput style={[st.input, { width: 90 }]} placeholder="ZIP" placeholderTextColor="rgba(255,255,255,0.3)" value={f.zip} onChangeText={set('zip')} keyboardType="number-pad" maxLength={10} />
                </View>
                <TouchableOpacity style={st.chk} onPress={() => set('certify')(!f.certify)}>
                  <Ionicons name={f.certify ? 'checkbox' : 'square-outline'} size={20} color={f.certify ? '#9BDDFF' : 'rgba(255,255,255,0.5)'} />
                  <Text style={st.chkText}>Under penalties of perjury, I certify this information is correct and I am a U.S. person.</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.btn, busy && st.dis]} disabled={busy} onPress={submitW9}>
                  <Text style={st.btnText}>{busy ? 'Saving…' : 'Save tax info'}</Text>
                </TouchableOpacity>
              </>}
            </View>

            <View style={[st.card, !s.w9_done && { opacity: 0.5 }]}>
              <View style={st.row}>
                <Text style={st.cardTitle}>2 · Bank account</Text>
                {s.ready && <Text style={st.done}>Ready</Text>}
              </View>
              {!s.ready && <Text style={st.sub}>{s.bank_started ? 'Stripe is checking your bank. This updates when it’s ready.' : 'Stripe (our payment company) asks for your bank once. We never see your account number.'}</Text>}
              {s.configured === false
                ? <Text style={[st.sub, { color: '#fcd34d' }]}>Direct deposit isn&apos;t turned on yet — check back soon.</Text>
                : <TouchableOpacity style={[st.btnGhost, (busy || !s.w9_done) && st.dis]} disabled={busy || !s.w9_done} onPress={connectBank}>
                    <Text style={st.btnGhostText}>{busy ? 'Opening…' : s.ready ? 'Change bank' : s.bank_started ? 'Finish bank setup' : 'Connect bank'}</Text>
                  </TouchableOpacity>}
            </View>
          </>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  pad: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  lead: { fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 18 },
  err: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.1)', padding: 12 },
  errText: { color: '#fca5a5', fontSize: 13 },
  card: { backgroundColor: '#131317', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 16 },
  cardDone: { borderColor: 'rgba(74,222,128,0.3)', backgroundColor: 'rgba(74,222,128,0.06)' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  pill: { fontSize: 11, fontWeight: '700', color: '#4ade80', backgroundColor: 'rgba(74,222,128,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, overflow: 'hidden' },
  big: { fontSize: 26, fontWeight: '800', color: 'rgba(255,255,255,0.95)', marginTop: 6 },
  sub: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4, lineHeight: 17 },
  done: { fontSize: 12, fontWeight: '700', color: '#4ade80' },
  input: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: '#1c1c21', color: 'rgba(255,255,255,0.9)', paddingHorizontal: 12, fontSize: 15, marginTop: 8 },
  two: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  seg: { flexDirection: 'row', height: 44, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 8 },
  segBtn: { paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#1c1c21' },
  segOn: { backgroundColor: 'rgba(155,221,255,0.15)' },
  segText: { color: 'rgba(255,255,255,0.5)', fontWeight: '700', fontSize: 13 },
  segTextOn: { color: '#9BDDFF' },
  chk: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'flex-start' },
  chkText: { flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 17 },
  btn: { height: 48, borderRadius: 12, backgroundColor: '#9BDDFF', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  btnText: { color: '#001119', fontSize: 15, fontWeight: '800' },
  btnGhost: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(155,221,255,0.4)', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  btnGhostText: { color: '#9BDDFF', fontSize: 15, fontWeight: '700' },
  dis: { opacity: 0.5 },
});
