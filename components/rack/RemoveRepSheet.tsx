/**
 * "Remove a bad rep" sheet (mock rack-edge.html): REP n · its speed, "Bumped
 * the bar or a re-rack?", Keep / Remove rep. Shared by the rack iPad (tap a
 * THIS SET bar) and the athlete's phone (long-press a rep chip). Remove is
 * the only call; the parent runs it (engine + rack_remove_rep, or the
 * phone's rack_remove_rep) and the rep drops out of chips and bars.
 */

import React, { useEffect, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RACK_COLORS } from '../../lib/rack/viewModel';
import { ALL_MODAL_ORIENTATIONS } from '../../lib/rack/orientation';

export interface RemoveRepTarget {
  clientRepId: string;
  repNo: number;
  v: number;
  partial: boolean;
}

export interface RemoveRepSheetProps {
  rep: RemoveRepTarget | null;
  onKeep: () => void;
  onRemove: (clientRepId: string) => void;
}

export const REMOVE_REP_COPY = 'Bumped the bar or a re-rack? Remove it — reps, avg, drop and power recalc on the iPad and the phone. It’s kept for coaches, just not counted.';

export default function RemoveRepSheet({ rep, onKeep, onRemove }: RemoveRepSheetProps) {
  // One call per open sheet (a double tap never removes twice).
  const sent = useRef(false);
  useEffect(() => {
    sent.current = false;
  }, [rep?.clientRepId]);
  const remove = () => {
    if (!rep || sent.current) return;
    sent.current = true;
    onRemove(rep.clientRepId);
  };
  return (
    <Modal visible={!!rep} transparent animationType="fade" supportedOrientations={[...ALL_MODAL_ORIENTATIONS]} onRequestClose={onKeep}>
      <Pressable style={styles.scrim} onPress={onKeep}>
        <Pressable style={styles.box} onPress={() => {}}>
          {rep && (
            <>
              <Text style={styles.t}>REP {rep.repNo}</Text>
              <Text style={styles.h}>{rep.partial ? 'Partial' : `${rep.v.toFixed(2)} m/s`}</Text>
              <Text style={styles.p}>{REMOVE_REP_COPY}</Text>
              <View style={styles.row2}>
                <TouchableOpacity style={[styles.btn, styles.gh]} onPress={onKeep}>
                  <Text style={styles.ghTxt}>Keep</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.red]} onPress={remove} accessibilityLabel={`Remove rep ${rep.repNo}`}>
                  <Text style={styles.redTxt}>Remove rep</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const sheetStyles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '100%',
    backgroundColor: '#141518',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    padding: 20,
  },
  t: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: 'rgba(255,255,255,0.5)' },
  h: { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 6, marginBottom: 4 },
  p: { fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 14, lineHeight: 18 },
  row2: { flexDirection: 'row', gap: 10, marginTop: 12 },
  btn: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  gh: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  ghTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '800' },
  red: { backgroundColor: 'rgba(229,83,75,0.15)', borderWidth: 1, borderColor: 'rgba(229,83,75,0.5)' },
  redTxt: { color: RACK_COLORS.red, fontSize: 14, fontWeight: '800' },
  pri: { backgroundColor: RACK_COLORS.acc },
  priTxt: { color: '#06202E', fontSize: 14, fontWeight: '800' },
});
const styles = sheetStyles;
