import React, { useState } from 'react';
import { Modal, Pressable, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LOGGER_COLORS } from '../../lib/logger/theme';

const OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type Props = {
  visible: boolean;
  onSelect: (value: number) => void;
  onSkip: () => void;
};

// "How hard was today overall?" — shown at finish only when the workout asks
// for session RPE. Skip finishes without touching session_rpe.
export default function SessionRpeSheet({ visible, onSelect, onSkip }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <Pressable style={styles.backdrop} onPress={() => {}}>
        <View style={styles.panel}>
          <Text style={styles.label}>SESSION RPE</Text>
          <Text style={styles.title}>How hard was today overall?</Text>
          <View style={styles.grid}>
            {OPTIONS.map(n => (
              <TouchableOpacity
                key={n}
                style={[styles.btn, picked === n && styles.btnSelected]}
                onPress={() => {
                  if (picked != null) return;
                  setPicked(n);
                  onSelect(n);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Session RPE ${n}`}
              >
                <Text style={[styles.btnText, picked === n && styles.btnTextSelected]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={onSkip} style={styles.skip} hitSlop={8} accessibilityRole="button">
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  panel: {
    backgroundColor: '#111111',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: LOGGER_COLORS.hairline,
    padding: 20,
    paddingBottom: 32,
  },
  label: { color: LOGGER_COLORS.rpe, fontSize: 10, fontWeight: '700', letterSpacing: 1.8 },
  title: { color: LOGGER_COLORS.text, fontSize: 18, fontWeight: '600', marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  btn: {
    width: '18.4%',
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LOGGER_COLORS.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSelected: { backgroundColor: LOGGER_COLORS.rpe, borderColor: LOGGER_COLORS.rpe },
  btnTextSelected: { color: '#0A0A0A', fontWeight: '800' },
  btnText: { color: 'rgba(255,255,255,0.8)', fontSize: 16, fontVariant: ['tabular-nums'] },
  skip: { alignSelf: 'center', marginTop: 18, padding: 6 },
  skipText: { color: LOGGER_COLORS.muted, fontSize: 14 },
});
