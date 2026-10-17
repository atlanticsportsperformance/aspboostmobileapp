/**
 * "+ Add" sheet: today's athletes not on the rack. Built so a tap can't land
 * on the wrong kid (the simulator put real athletes up twice):
 *   - the list is snapshotted when the sheet opens (no reorder / shift while
 *     it is open) and sorted by name;
 *   - a search field filters by first or last name (no autofocus);
 *   - taps are ignored while the list is dragging or still gliding;
 *   - a tap only SELECTS a row; the "Put <name> up" button is the only thing
 *     that calls onAdd (→ selectAthlete → rack_set_active).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { TodayAthlete } from '../../lib/rack/api';
import { filterAddable, initialsOf, RACK_COLORS } from '../../lib/rack/viewModel';
import { ALL_MODAL_ORIENTATIONS } from '../../lib/rack/orientation';

export interface AddAthleteSheetProps {
  visible: boolean;
  addable: TodayAthlete[];
  onClose: () => void;
  onAdd: (athleteId: string) => void;
}

/** After a scroll ends, taps stay ignored this long (momentum can lag). */
const SETTLE_MS = 150;

export default function AddAthleteSheet({ visible, addable, onClose, onAdd }: AddAthleteSheetProps) {
  const [snapshot, setSnapshot] = useState<TodayAthlete[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const scrolling = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Snapshot on open; stable while open.
  useEffect(() => {
    if (visible) {
      setSnapshot(addable);
      setQuery('');
      setSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const list = useMemo(() => filterAddable(snapshot, query), [snapshot, query]);
  const chosen = list.find(a => a.athleteId === selected) ?? null;

  const startScroll = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    scrolling.current = true;
  };
  const endScroll = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      scrolling.current = false;
    }, SETTLE_MS);
  };
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const tapRow = (id: string) => {
    if (scrolling.current) return; // a tap during a drag / glide is ignored
    setSelected(prev => (prev === id ? null : id));
  };

  const confirm = () => {
    if (!chosen) return;
    onClose();
    onAdd(chosen.athleteId);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={[...ALL_MODAL_ORIENTATIONS]} onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.k}>ADD TO THE RACK</Text>
          <Text style={styles.s}>Pick an athlete, then confirm. They go up now.</Text>
          <TextInput
            style={styles.search}
            placeholder="Search by first or last name"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={query}
            onChangeText={t => {
              setQuery(t);
            }}
            autoFocus={false}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          <ScrollView
            style={{ maxHeight: 360 }}
            contentContainerStyle={{ gap: 8 }}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={startScroll}
            onMomentumScrollBegin={startScroll}
            onScrollEndDrag={endScroll}
            onMomentumScrollEnd={endScroll}
          >
            {list.length === 0 && (
              <Text style={styles.none}>
                {snapshot.length === 0 ? 'Everyone with a workout today is already on the rack.' : 'No athlete matches.'}
              </Text>
            )}
            {list.map(a => {
              const on = a.athleteId === selected;
              return (
                <Pressable key={a.athleteId} style={[styles.pick, on && styles.pickOn]} onPress={() => tapRow(a.athleteId)}>
                  <View style={[styles.av, on && styles.avOn]}>
                    <Text style={[styles.avTxt, on && styles.avTxtOn]}>{initialsOf(a.firstName, a.lastName)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name}>
                      {a.firstName} {a.lastName}
                    </Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {a.remaining[0] ? `Next: ${a.remaining[0].name}` : 'No sets left today'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancel} onPress={onClose}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.put, !chosen && styles.putOff]} disabled={!chosen} onPress={confirm}>
              <Text style={styles.putTxt}>{chosen ? `Put ${chosen.firstName} up` : 'Pick an athlete'}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 18,
    backgroundColor: RACK_COLORS.card,
    borderWidth: 1,
    borderColor: RACK_COLORS.line,
    padding: 20,
    gap: 8,
  },
  k: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: 'rgba(255,255,255,0.5)' },
  s: { fontSize: 13, color: RACK_COLORS.mut },
  search: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#000',
    color: '#fff',
    paddingHorizontal: 14,
    fontSize: 15,
    marginVertical: 6,
  },
  none: { fontSize: 14, color: RACK_COLORS.mut, paddingVertical: 20, textAlign: 'center' },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: RACK_COLORS.line,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  pickOn: { borderColor: RACK_COLORS.acc, backgroundColor: 'rgba(155,221,255,0.07)' },
  av: { width: 44, height: 44, borderRadius: 999, backgroundColor: '#202327', alignItems: 'center', justifyContent: 'center' },
  avOn: { backgroundColor: RACK_COLORS.acc },
  avTxt: { fontWeight: '800', fontSize: 15, color: 'rgba(255,255,255,0.85)' },
  avTxtOn: { color: RACK_COLORS.accInk },
  name: { fontSize: 16, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 12, color: RACK_COLORS.mut },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancel: { flex: 1, height: 52, borderRadius: 14, borderWidth: 1, borderColor: RACK_COLORS.line, alignItems: 'center', justifyContent: 'center' },
  cancelTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: '700' },
  put: { flex: 2, height: 52, borderRadius: 14, backgroundColor: RACK_COLORS.acc, alignItems: 'center', justifyContent: 'center' },
  putOff: { opacity: 0.35 },
  putTxt: { color: RACK_COLORS.accInk, fontSize: 16, fontWeight: '900' },
});
