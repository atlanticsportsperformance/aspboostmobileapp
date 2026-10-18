/**
 * Long-press on the athlete card's BAR · LB value: type the bar weight.
 * Set → executor.setBarLoad (published as load_lb; the phone's LB cell
 * follows). Mid-set it applies to the next set.
 */

import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ALL_MODAL_ORIENTATIONS } from '../../lib/rack/orientation';
import { sheetStyles } from './RemoveRepSheet';

export interface BarWeightSheetProps {
  visible: boolean;
  current: number | null;
  /** Typed mid-set: "applies to the next set". */
  nextSet: boolean;
  onCancel: () => void;
  onSet: (lb: number) => void;
}

/** "215" / "215.5" → 215; anything else → null. */
export function parseBarInput(t: string): number | null {
  const n = Number(t.replace(',', '.').trim());
  return t.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 2000 ? n : null;
}

export default function BarWeightSheet({ visible, current, nextSet, onCancel, onSet }: BarWeightSheetProps) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (visible) setText(current != null ? String(current) : '');
  }, [visible, current]);
  const lb = parseBarInput(text);
  const set = () => {
    if (lb == null) return;
    onCancel();
    onSet(lb);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={[...ALL_MODAL_ORIENTATIONS]} onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={sheetStyles.scrim} onPress={onCancel}>
          <Pressable style={[sheetStyles.box, { maxWidth: 360 }]} onPress={() => {}}>
            <Text style={sheetStyles.t}>BAR · LB</Text>
            <Text style={sheetStyles.p}>{nextSet ? 'Applies to the next set.' : 'Goes to the sensor and the athlete’s phone.'}</Text>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              onSubmitEditing={set}
              accessibilityLabel="Bar weight in pounds"
            />
            <View style={sheetStyles.row2}>
              <TouchableOpacity style={[sheetStyles.btn, sheetStyles.gh]} onPress={onCancel}>
                <Text style={sheetStyles.ghTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[sheetStyles.btn, sheetStyles.pri, lb == null && { opacity: 0.4 }]} disabled={lb == null} onPress={set}>
                <Text style={sheetStyles.priTxt}>{lb != null ? `Set ${lb} lb` : 'Set'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#000',
    color: '#fff',
    paddingHorizontal: 14,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
