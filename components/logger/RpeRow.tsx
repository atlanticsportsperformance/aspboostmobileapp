import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LOGGER_COLORS } from '../../lib/logger/theme';
import { rpeOptions } from '../../lib/logger/rpe';

type Props = {
  target: number | null;
  value: number | null;
  onChange: (value: number) => void;
};

export default function RpeRow({ target, value, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{target != null ? `RPE · TARGET ${target}` : 'RPE'}</Text>
      <View style={styles.row}>
        {rpeOptions(target).map(option => {
          const selected = value === option;
          const isTarget = target === option;
          return (
            <TouchableOpacity
              key={option}
              style={[
                styles.btn,
                isTarget && styles.btnTarget,
                selected && styles.btnSelected,
              ]}
              onPress={() => onChange(option)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`RPE ${option}`}
            >
              <Text style={[styles.btnText, selected && styles.btnTextSelected, isTarget && !selected && styles.btnTextTarget]}>
                {option}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  label: {
    color: LOGGER_COLORS.rpe,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  row: { flexDirection: 'row', gap: 5, marginTop: 6 },
  btn: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LOGGER_COLORS.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTarget: { borderColor: LOGGER_COLORS.rpe },
  btnSelected: { backgroundColor: LOGGER_COLORS.rpe, borderColor: LOGGER_COLORS.rpe },
  btnText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontVariant: ['tabular-nums'] },
  btnTextTarget: { color: LOGGER_COLORS.rpe },
  btnTextSelected: { color: '#0A0A0A', fontWeight: '800' },
});
