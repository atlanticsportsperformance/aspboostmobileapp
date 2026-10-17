/**
 * Live exercise + set picker on the athlete card: the "Back Squat · Set 1 of
 * 3 ▾" line opens every exercise of the active athlete today, each with its
 * live progress ("2/3", finished "3/3 ✓" dimmed) from the SAME logs the
 * resolver reads (executor.pickerRows — no extra queries). Tapping an
 * exercise expands its set chips 1..N (+ extra); done sets are marked and the
 * resolver's current set is preselected. Choosing exercise + set is a coach
 * override published with that set (rack_set_ipad_context) — honoured even
 * for a done set (a re-do) — and the phone follows.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TodayExercise } from '../../lib/rack/api';
import { preselectedSet, type PickerRow } from '../../lib/rack/resolveRackSet';
import { RACK_COLORS, pillParts } from '../../lib/rack/viewModel';
import { ALL_MODAL_ORIENTATIONS } from '../../lib/rack/orientation';

export interface ExercisePickerProps {
  label: string;
  /** All of the athlete's exercises today (workout order). */
  exercises: TodayExercise[];
  /** Live progress per exercise (executor.pickerRows). */
  rows: PickerRow[];
  currentRoutineExerciseId: string | null;
  /** The resolver's current set (preselected). */
  currentSetNumber: number | null;
  /** True when the phone set the exercise (a pick here moves the phone). */
  phoneOwnsContext: boolean;
  onPick: (ex: TodayExercise, setNumber: number) => void;
  /** No exercise yet (no rack lift left): show a "Pick an exercise" button. */
  prompt?: boolean;
}

const keyOf = (e: { workoutInstanceId: string; routineExerciseId: string }) => `${e.workoutInstanceId}:${e.routineExerciseId}`;


export default function ExercisePicker({ label, exercises, rows, currentRoutineExerciseId, currentSetNumber, phoneOwnsContext, onPick, prompt = false }: ExercisePickerProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const can = exercises.length > 0;
  const rowOf = (e: TodayExercise) => rows.find(r => keyOf(r) === keyOf(e));
  // Opening the sheet expands the current exercise.
  useEffect(() => {
    if (!open) return;
    const cur = exercises.find(e => e.routineExerciseId === currentRoutineExerciseId);
    setExpanded(cur ? keyOf(cur) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const choose = (e: TodayExercise, setNumber: number) => {
    setOpen(false);
    onPick(e, setNumber);
  };
  return (
    <>
      {prompt && can ? (
        <TouchableOpacity onPress={() => setOpen(true)} style={styles.promptBtn} activeOpacity={0.8}>
          <Text style={styles.promptTxt}>Pick an exercise ▾</Text>
        </TouchableOpacity>
      ) : (
        // A clear button: one bordered box — text column (name, 1 line,
        // ellipsized / "Set n of N" bold) + a 20 px chevron, vertically centred.
        // The style is static on an inner View (no style function).
        <Pressable
          disabled={!can}
          onPress={() => setOpen(true)}
          style={styles.pillHit}
          accessibilityRole="button"
          accessibilityLabel={`${label}. Change exercise or set`}
        >
          {({ pressed }) => (
            <View style={[styles.pill, pressed && styles.pillPressed]}>
              <View style={styles.pillText}>
                <Text style={styles.pillName} numberOfLines={1} ellipsizeMode="tail">
                  {pillParts(label).name}
                </Text>
                {pillParts(label).set ? (
                  <Text style={styles.pillSet} numberOfLines={1}>
                    {pillParts(label).set}
                  </Text>
                ) : null}
              </View>
              {can && <Ionicons name="chevron-down" size={20} color={RACK_COLORS.acc} style={styles.pillChev} />}
            </View>
          )}
        </Pressable>
      )}
      <Modal visible={open} transparent animationType="fade" supportedOrientations={[...ALL_MODAL_ORIENTATIONS]} onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.k}>EXERCISE + SET ON THIS RACK</Text>
            {phoneOwnsContext && <Text style={styles.note}>The phone picked this exercise. A pick here moves the phone to it.</Text>}
            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 8 }}>
              {exercises.map(e => {
                const k = keyOf(e);
                const row = rowOf(e);
                const on = e.routineExerciseId === currentRoutineExerciseId;
                const isOpen = expanded === k;
                const pre = preselectedSet(row, on, currentSetNumber);
                return (
                  <View key={k} style={[styles.row, on && styles.rowOn, row?.finished && !on && styles.rowDone]}>
                    <TouchableOpacity style={styles.rowHead} onPress={() => setExpanded(isOpen ? null : k)} activeOpacity={0.7}>
                      <Text style={styles.name} numberOfLines={1}>
                        {e.code ? `${e.code} · ` : ''}
                        {e.name}
                      </Text>
                      <Text style={[styles.prog, row?.finished && styles.progDone]}>{row?.progress ?? ''}</Text>
                      {on && <Text style={styles.cur}>CURRENT</Text>}
                    </TouchableOpacity>
                    {isOpen && (
                      <View style={styles.chips}>
                        {(row?.chips ?? []).map(c => (
                          <TouchableOpacity
                            key={c.setNumber}
                            style={[styles.chip, c.done && styles.chipDone, c.setNumber === pre && styles.chipPre]}
                            onPress={() => choose(e, c.setNumber)}
                            accessibilityLabel={`Set ${c.setNumber}${c.done ? ', done — redo' : ''}`}
                          >
                            <Text style={[styles.chipTxt, c.setNumber === pre && styles.chipTxtPre]}>
                              {c.done ? `✓ ${c.setNumber}` : c.setNumber}
                            </Text>
                          </TouchableOpacity>
                        ))}
                        {row && (
                          <TouchableOpacity
                            style={[styles.chip, row.extraSet === pre && styles.chipPre]}
                            onPress={() => choose(e, row.extraSet)}
                            accessibilityLabel={`Extra set ${row.extraSet}`}
                          >
                            <Text style={[styles.chipTxt, row.extraSet === pre && styles.chipTxtPre]}>+ extra</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
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
  promptBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: RACK_COLORS.acc,
    backgroundColor: 'rgba(155,221,255,0.08)',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  promptTxt: { fontSize: 13, fontWeight: '800', color: RACK_COLORS.acc },
  pillHit: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 44, marginTop: 4 },
  pill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(155,221,255,0.45)',
    backgroundColor: 'rgba(155,221,255,0.08)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  pillPressed: { backgroundColor: 'rgba(155,221,255,0.16)' },
  pillText: { flexShrink: 1, minWidth: 0 },
  pillName: { fontSize: 15, fontWeight: '600', color: '#9BDDFF' },
  pillSet: { fontSize: 14, fontWeight: '800', color: '#9BDDFF', marginTop: 1 },
  pillChev: { marginLeft: 10 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  sheet: { width: 520, borderRadius: 18, backgroundColor: RACK_COLORS.card, borderWidth: 1, borderColor: RACK_COLORS.line, padding: 20, gap: 8 },
  k: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: 'rgba(255,255,255,0.5)' },
  note: { fontSize: 12, color: RACK_COLORS.mut },
  row: { borderRadius: 14, borderWidth: 1, borderColor: RACK_COLORS.line, paddingVertical: 12, paddingHorizontal: 14, gap: 10 },
  rowOn: { borderColor: RACK_COLORS.acc, backgroundColor: 'rgba(155,221,255,0.05)' },
  rowDone: { opacity: 0.5 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: '#fff' },
  prog: { fontSize: 13, fontWeight: '700', color: RACK_COLORS.mut },
  progDone: { color: RACK_COLORS.acc },
  cur: { fontSize: 10, fontWeight: '900', letterSpacing: 1.3, color: RACK_COLORS.acc },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 48, borderRadius: 10, borderWidth: 1, borderColor: RACK_COLORS.line, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  chipDone: { backgroundColor: 'rgba(255,255,255,0.05)' },
  chipPre: { borderColor: RACK_COLORS.acc, backgroundColor: 'rgba(155,221,255,0.12)' },
  chipTxt: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  chipTxtPre: { color: RACK_COLORS.acc },
});
