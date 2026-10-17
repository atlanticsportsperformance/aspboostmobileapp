import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LOGGER_COLORS } from '../../lib/logger/theme';
import { rpeOptions } from '../../lib/logger/rpe';

type Props = {
  target: number | null;
  value: number | null;
  onChange: (value: number) => void;
  /** Thin strip for the exercise table: label inline, short buttons. */
  compact?: boolean;
};

export default function RpeRow({ target, value, onChange, compact }: Props) {
  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      <Text style={[styles.label, compact && styles.labelCompact]}>{target != null ? `RPE · TARGET ${target}` : 'RPE'}</Text>
      <View style={[styles.row, compact && styles.rowCompact]}>
        {rpeOptions(target).map(option => {
          const selected = value === option;
          const isTarget = target === option;
          return (
            <TouchableOpacity
              key={option}
              style={[
                styles.btn,
                compact && styles.btnCompact,
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
  wrapCompact: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: {
    color: LOGGER_COLORS.rpe,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  labelCompact: { fontSize: 9, letterSpacing: 1.2 },
  row: { flexDirection: 'row', gap: 5, marginTop: 6 },
  rowCompact: { flex: 1, gap: 4, marginTop: 0 },
  btn: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: LOGGER_COLORS.rpeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCompact: { height: 24, borderRadius: 6 },
  btnTarget: { borderColor: LOGGER_COLORS.rpeTarget },
  btnSelected: { backgroundColor: LOGGER_COLORS.rpeSelected, borderColor: LOGGER_COLORS.rpeSelected },
  btnText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontVariant: ['tabular-nums'] },
  btnTextTarget: { color: LOGGER_COLORS.text },
  btnTextSelected: { color: LOGGER_COLORS.text, fontWeight: '800' },
});
