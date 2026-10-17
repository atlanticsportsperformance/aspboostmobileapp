/**
 * Exercise override on the athlete card: the "Back Squat · Set 1 of 3 ▾" line
 * opens a list of the active athlete's remaining exercises (across today's
 * workouts). A pick becomes the engine's `localContext` — used only while the
 * phone hasn't opened a set (the phone's pick always wins).
 */

import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { TodayExercise } from '../../lib/rack/api';
import { RACK_COLORS } from '../../lib/rack/viewModel';
import { ALL_MODAL_ORIENTATIONS } from '../../lib/rack/orientation';

export interface ExercisePickerProps {
  label: string;
  remaining: TodayExercise[];
  currentRoutineExerciseId: string | null;
  /** True when the phone set the exercise (an iPad pick then waits). */
  phoneOwnsContext: boolean;
  onPick: (ex: TodayExercise) => void;
}

const zoneText = (e: TodayExercise) =>
  e.zoneMin != null && e.zoneMax != null ? `${e.zoneMin.toFixed(2)}–${e.zoneMax.toFixed(2)} m/s` : 'No speed target';

export default function ExercisePicker({ label, remaining, currentRoutineExerciseId, phoneOwnsContext, onPick }: ExercisePickerProps) {
  const [open, setOpen] = useState(false);
  const can = remaining.length > 0;
  return (
    <>
      <TouchableOpacity disabled={!can} onPress={() => setOpen(true)} style={styles.trigger} activeOpacity={0.7}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {can && <Text style={styles.chev}>▾</Text>}
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" supportedOrientations={[...ALL_MODAL_ORIENTATIONS]} onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.k}>EXERCISE ON THIS RACK</Text>
            {phoneOwnsContext && <Text style={styles.note}>The phone picked the exercise; it wins over a pick here.</Text>}
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8 }}>
              {remaining.map(e => {
                const on = e.routineExerciseId === currentRoutineExerciseId;
                return (
                  <TouchableOpacity
                    key={`${e.workoutInstanceId}:${e.routineExerciseId}`}
                    style={[styles.row, on && styles.rowOn]}
                    onPress={() => {
                      setOpen(false);
                      onPick(e);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{e.name}</Text>
                      <Text style={styles.sub}>
                        Set {e.completedSets + 1}
                        {e.sets ? ` of ${e.sets}` : ''} · {zoneText(e)}
                      </Text>
                    </View>
                    {on && <Text style={styles.cur}>CURRENT</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 13, color: 'rgba(255,255,255,0.65)', flexShrink: 1 },
  chev: { fontSize: 12, color: RACK_COLORS.acc },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  sheet: { width: 520, borderRadius: 18, backgroundColor: RACK_COLORS.card, borderWidth: 1, borderColor: RACK_COLORS.line, padding: 20, gap: 8 },
  k: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: 'rgba(255,255,255,0.5)' },
  note: { fontSize: 12, color: RACK_COLORS.mut },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: RACK_COLORS.line, paddingVertical: 12, paddingHorizontal: 14 },
  rowOn: { borderColor: RACK_COLORS.acc, backgroundColor: 'rgba(155,221,255,0.05)' },
  name: { fontSize: 16, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 12, color: RACK_COLORS.mut, marginTop: 2 },
  cur: { fontSize: 10, fontWeight: '900', letterSpacing: 1.3, color: RACK_COLORS.acc },
});
