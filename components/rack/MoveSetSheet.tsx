/**
 * Wrong athlete (mock rack-edge.html). Two ways in:
 *   - 'live': the ACTIVE athlete's tile tapped mid-set → "Switch, or move this set?"
 *   - 'after': the summary's "Wrong athlete? Move set" → "Move this set to…"
 * The list is the athletes on the rack (queue order) first, then today's
 * athletes, with a search; it is snapshotted when the sheet opens. Two steps:
 * a tap only SELECTS; "Move set to <Name>" (or, live, "Switch to <Name>")
 * is the one call — at most once per open.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { TodayAthlete } from '../../lib/rack/api';
import type { RackEngineState } from '../../lib/rack/engine';
import { initialsOf, moveCandidates, RACK_COLORS } from '../../lib/rack/viewModel';
import { ALL_MODAL_ORIENTATIONS } from '../../lib/rack/orientation';
import { sheetStyles } from './RemoveRepSheet';

export type MoveSheetMode = 'live' | 'after';

export interface MoveSetSheetProps {
  mode: MoveSheetMode | null;
  /** First name of the athlete the set is on now. */
  fromName: string;
  fromId: string | null;
  /** Counted reps of the set (live mode copy). */
  reps: number;
  rack: Pick<RackEngineState, 'activeAthleteId' | 'queue'>;
  today: TodayAthlete[];
  onCancel: () => void;
  /** rack_move_set → the target (executor.moveSet). */
  onMove: (athleteId: string) => void;
  /** Live only: end the set for the current athlete, then switch (the old tile behaviour). */
  onSwitch: (athleteId: string) => void;
}

const SETTLE_MS = 150;

export default function MoveSetSheet({ mode, fromName, fromId, reps, rack, today, onCancel, onMove, onSwitch }: MoveSetSheetProps) {
  const visible = mode != null;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const sent = useRef(false);
  const scrolling = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snapshot = useMemo(() => (visible ? { rack: { activeAthleteId: rack.activeAthleteId, queue: [...rack.queue] }, today } : null), [visible]);
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelected(null);
      sent.current = false;
    }
  }, [visible]);
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  const list = useMemo(() => (snapshot ? moveCandidates(snapshot.rack, snapshot.today, fromId, query) : []), [snapshot, fromId, query]);
  const chosen = list.find(c => c.athlete.athleteId === selected)?.athlete ?? null;

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
  const tapRow = (id: string) => {
    if (scrolling.current) return;
    setSelected(prev => (prev === id ? null : id));
  };
  const once = (fn: (id: string) => void) => () => {
    if (!chosen || sent.current) return;
    sent.current = true;
    const id = chosen.athleteId;
    onCancel();
    fn(id);
  };

  const after = mode === 'after';
  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={[...ALL_MODAL_ORIENTATIONS]} onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={sheetStyles.scrim} onPress={onCancel}>
          <Pressable style={[sheetStyles.box, styles.box]} onPress={() => {}}>
            <Text style={sheetStyles.t}>{after ? 'WRONG ATHLETE?' : `${fromName.toUpperCase()} IS UP`}</Text>
            <Text style={sheetStyles.h}>{after ? 'Move this set to…' : 'Switch, or move this set?'}</Text>
            <Text style={sheetStyles.p}>
              {after
                ? `Set saved to ${fromName}. Move it — ${fromName}’s row is undone, the right athlete gets it on their phone.`
                : `${reps} rep${reps === 1 ? '' : 's'} so far. Moving keeps them; switching saves them to ${fromName}.`}
            </Text>
            <TextInput
              style={styles.search}
              placeholder="Search by first or last name"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={query}
              onChangeText={setQuery}
              autoFocus={false}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            <ScrollView
              style={{ flexShrink: 1, maxHeight: 300 }}
              contentContainerStyle={{ gap: 8 }}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={startScroll}
              onMomentumScrollBegin={startScroll}
              onScrollEndDrag={endScroll}
              onMomentumScrollEnd={endScroll}
            >
              {list.length === 0 && <Text style={styles.none}>{query ? 'No athlete matches.' : 'No other athlete today.'}</Text>}
              {list.map(({ athlete: a, onRack }) => {
                const on = a.athleteId === selected;
                return (
                  <Pressable key={a.athleteId} style={[styles.opt, on && styles.optOn]} onPress={() => tapRow(a.athleteId)}>
                    <View style={[styles.av, on && styles.avOn]}>
                      <Text style={[styles.avTxt, on && styles.avTxtOn]}>{initialsOf(a.firstName, a.lastName)}</Text>
                    </View>
                    <Text style={styles.name} numberOfLines={1}>
                      {a.firstName} {a.lastName}
                    </Text>
                    {onRack && <Text style={styles.tag}>ON RACK</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={sheetStyles.row2}>
              <TouchableOpacity style={[sheetStyles.btn, sheetStyles.gh]} onPress={onCancel}>
                <Text style={sheetStyles.ghTxt}>Cancel</Text>
              </TouchableOpacity>
              {!after && (
                <TouchableOpacity style={[sheetStyles.btn, sheetStyles.gh, !chosen && styles.off]} disabled={!chosen} onPress={once(onSwitch)}>
                  <Text style={sheetStyles.ghTxt} numberOfLines={1}>{chosen ? `Switch to ${chosen.firstName}` : 'Switch'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[sheetStyles.btn, sheetStyles.pri, styles.move, !chosen && styles.off]} disabled={!chosen} onPress={once(onMove)}>
                <Text style={sheetStyles.priTxt} numberOfLines={1}>{chosen ? `Move set to ${chosen.firstName}` : 'Move set'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  box: { maxWidth: 480 },
  search: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#000',
    color: '#fff',
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 10,
  },
  none: { fontSize: 14, color: RACK_COLORS.mut, paddingVertical: 16, textAlign: 'center' },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  optOn: { borderColor: RACK_COLORS.acc, backgroundColor: 'rgba(155,221,255,0.08)' },
  av: { width: 34, height: 34, borderRadius: 999, backgroundColor: '#202327', alignItems: 'center', justifyContent: 'center' },
  avOn: { backgroundColor: RACK_COLORS.acc },
  avTxt: { fontWeight: '800', fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  avTxtOn: { color: RACK_COLORS.accInk },
  name: { flex: 1, fontSize: 15, fontWeight: '700', color: '#fff' },
  tag: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, color: RACK_COLORS.acc },
  move: { flex: 1.4 },
  off: { opacity: 0.4 },
});
