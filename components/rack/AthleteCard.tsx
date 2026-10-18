/**
 * Athlete card: who is up, the exercise (override dropdown), where the
 * context came from, BAR · LB (−/+ 5 lb, long-press to type — published to
 * the phone), REPS (prescribed) / TARGET SPEED, and the big Done.
 * The set summary (AVG / BEST / DROP, + AVG W / PEAK W with a load, and
 * "Wrong athlete? Move set" for 2 min) and "Rack n is open" overlay the card.
 *
 * `layout='column'` (landscape, 360 wide, Done at the bottom) or `'row'`
 * (portrait, full width: 220 name block | kv grid | 150-wide Done).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { TodayExercise } from '../../lib/rack/api';
import type { PickerRow } from '../../lib/rack/resolveRackSet';
import { RACK_COLORS, summaryBoxes, type RackView } from '../../lib/rack/viewModel';
import ExercisePicker from './ExercisePicker';

export interface AthleteCardProps {
  view: RackView;
  rackName: string;
  layout?: 'column' | 'row';
  /** Short iPads (mini landscape): tighter padding, smaller values, 56-pt Done. */
  compact?: boolean;
  /** Big Done → engine `ipadDone`. */
  onDone: () => void;
  /** Coach pick of exercise + set → executor.setOverride (published; the phone follows). */
  onPickExercise: (ex: TodayExercise, setNumber: number) => void;
  /** The picker's live rows (executor.pickerRows — the resolver's own logs). */
  pickerRows?: PickerRow[];
  /** BAR · LB value shown (the iPad's bar weight, else the set's load). */
  barLb?: number | null;
  /** The shown bar weight was set mid-set: it applies on the next set. */
  barNext?: boolean;
  /** −/+ 5 lb. */
  onBarStep?: (deltaLb: number) => void;
  /** Long-press the value: type it. */
  onBarType?: () => void;
  /** Summary "Wrong athlete? Move set" and the card's "Move last set" chip (the just-ended set). */
  onMoveSet?: () => void;
}

export const BAR_STEP_LB = 5;

export default function AthleteCard({
  view,
  rackName,
  layout = 'column',
  compact = false,
  onDone,
  onPickExercise,
  pickerRows = [],
  barLb,
  barNext = false,
  onBarStep,
  onBarType,
  onMoveSet,
}: AthleteCardProps) {
  const a = view.athlete;
  const lb = barLb !== undefined ? barLb : view.loadLb;
  const row = layout === 'row';
  const c = compact && !row;
  return (
    <View style={[styles.card, row ? styles.cardRow : styles.cardCol, c && styles.cardC]}>
      <View style={[styles.ah, row && styles.ahRow]}>
        <View style={styles.av}>
          <Text style={styles.avTxt}>{a?.initials ?? ''}</Text>
        </View>
        <View style={row ? { alignSelf: 'stretch' } : { flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>
            {a?.name ?? ''}
          </Text>
          <ExercisePicker
            label={view.exerciseLine}
            exercises={view.exercises}
            rows={pickerRows}
            currentRoutineExerciseId={view.routineExerciseId}
            currentSetNumber={view.setNumber}
            phoneOwnsContext={view.contextSource === 'phone'}
            onPick={onPickExercise}
            prompt={view.needsPick}
          />
          <Text style={styles.src}>{view.sourceLine}</Text>
          {view.lastSetMove && onMoveSet && (
            <TouchableOpacity style={styles.lastChip} onPress={onMoveSet} accessibilityLabel="Wrong athlete? Move last set">
              <Text style={styles.lastChipTxt} numberOfLines={1}>Wrong athlete? Move last set</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={[styles.kv, row && styles.kvRow]}>
        <View style={[styles.kvb, c && styles.kvbC]}>
          <Text style={styles.k}>{barNext ? 'BAR · LB · NEXT SET' : 'BAR · LB'}</Text>
          <View style={styles.stp}>
            <TouchableOpacity
              style={[styles.stpBtn, (lb == null || lb <= 0) && styles.stpOff]}
              disabled={!onBarStep || lb == null || lb <= 0}
              onPress={() => onBarStep?.(-BAR_STEP_LB)}
              accessibilityLabel="Bar weight minus 5 pounds"
            >
              <Text style={styles.stpTxt}>−</Text>
            </TouchableOpacity>
            <Pressable style={styles.stpVal} onLongPress={onBarType} delayLongPress={350} accessibilityLabel="Bar weight — long-press to type">
              {lb == null && view.loadNote ? (
                <Text style={[styles.x, styles.note, c && styles.xC]} numberOfLines={1}>{view.loadNote}</Text>
              ) : (
                <Text style={[styles.x, styles.stpX, c && styles.xC]} numberOfLines={1}>{lb != null ? String(lb) : '—'}</Text>
              )}
            </Pressable>
            <TouchableOpacity style={styles.stpBtn} disabled={!onBarStep} onPress={() => onBarStep?.(BAR_STEP_LB)} accessibilityLabel="Bar weight plus 5 pounds">
              <Text style={styles.stpTxt}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.kvb, c && styles.kvbC]}>
          <Text style={styles.k}>REPS</Text>
          <Text style={[styles.x, c && styles.xC]}>{view.repsTarget != null ? view.repsTarget : '—'}</Text>
        </View>
        <View style={[styles.kvb, styles.wide, c && styles.kvbC]}>
          <Text style={styles.k}>TARGET SPEED</Text>
          <Text style={[styles.x, styles.wideX, c && styles.wideXC]}>
            {view.zone ? `${view.zone[0].toFixed(2)}–${view.zone[1].toFixed(2)} m/s` : 'No target'}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={[styles.doneWrap, row && styles.doneWrapRow]} activeOpacity={0.85} onPress={onDone}>
        <LinearGradient colors={['#A6E3FF', '#6BBCE8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.done, row && styles.doneRow, c && styles.doneC]}>
          <Text style={styles.doneTxt}>✓ Done</Text>
        </LinearGradient>
      </TouchableOpacity>

      {view.summary && (
        // Column (landscape card): title / big / boxes / footer. Row (portrait,
        // ~190 tall): text block beside the boxes so it fits the card's inset.
        <View style={[styles.summary, row && styles.summaryRow]}>
          <View style={[styles.sumText, row && styles.sumTextRow]}>
            <Text style={styles.sumT}>{view.summary.title}</Text>
            <Text style={styles.sumBig}>{view.summary.big}</Text>
            {row && <Text style={styles.sumFoot}>{view.summary.footer}</Text>}
          </View>
          <View style={[styles.sumCol, row && styles.sumColRow]}>
            <View style={[styles.sumRow, row && styles.sumRowWrap]}>
              {summaryBoxes(view.summary).map(([k, x]) => (
                <View key={k} style={[styles.bx, view.summary!.avgW != null && styles.bxTight]}>
                  <Text style={styles.k}>{k}</Text>
                  <Text style={[styles.bxX, view.summary!.avgW != null && styles.bxXTight]}>{x}</Text>
                </View>
              ))}
            </View>
            {view.summary.canMove && onMoveSet && (
              <TouchableOpacity style={styles.wrong} onPress={onMoveSet} accessibilityLabel="Wrong athlete? Move set">
                <Text style={styles.wrongTxt}>Wrong athlete? Move set</Text>
              </TouchableOpacity>
            )}
          </View>
          {!row && <Text style={styles.sumFoot}>{view.summary.footer}</Text>}
        </View>
      )}

      {view.open && (
        <View style={styles.open}>
          <Text style={styles.openB}>{rackName} is open</Text>
          <Text style={styles.openS}>Tap a tile or “I’m up” on your phone</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: RACK_COLORS.card,
    borderWidth: 1,
    borderColor: RACK_COLORS.line,
    borderRadius: 18,
    padding: 20,
    position: 'relative',
    overflow: 'hidden',
  },
  cardCol: { width: 360, gap: 14 },
  cardC: { padding: 16, gap: 10 },
  kvbC: { paddingVertical: 7 },
  xC: { fontSize: 20 },
  wideXC: { fontSize: 18 },
  doneC: { height: 56 },
  cardRow: { flexDirection: 'row', alignItems: 'stretch', gap: 16 },
  ah: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ahRow: { width: 220, flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' },
  av: { width: 46, height: 46, borderRadius: 999, backgroundColor: RACK_COLORS.acc, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: RACK_COLORS.accInk, fontWeight: '900', fontSize: 16 },
  name: { fontSize: 19, fontWeight: '700', color: '#fff' },
  src: { fontSize: 11, color: RACK_COLORS.acc, fontWeight: '700', marginTop: 2 },
  kv: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kvRow: { flex: 1, alignContent: 'center' },
  kvb: { flexBasis: '45%', flexGrow: 1, borderWidth: 1, borderColor: RACK_COLORS.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  wide: { flexBasis: '100%', backgroundColor: 'rgba(155,221,255,0.05)', borderColor: 'rgba(155,221,255,0.25)' },
  k: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4, color: 'rgba(255,255,255,0.45)' },
  x: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 2, fontVariant: ['tabular-nums'] },
  wideX: { color: RACK_COLORS.acc, fontSize: 22 },
  doneWrap: { marginTop: 'auto', borderRadius: 16, overflow: 'hidden' },
  doneWrapRow: { marginTop: 0, width: 150, alignSelf: 'stretch' },
  done: { height: 72, alignItems: 'center', justifyContent: 'center' },
  doneRow: { height: undefined, flex: 1 },
  doneTxt: { color: '#06202E', fontSize: 22, fontWeight: '900' },
  // Same 20 px inset as the card; the content block is centred inside it.
  summary: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,9,10,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderRadius: 18,
    padding: 20,
  },
  summaryRow: { flexDirection: 'row', gap: 28 },
  sumText: { alignItems: 'center', gap: 12 },
  sumTextRow: { alignItems: 'flex-start', gap: 8 },
  sumT: { fontSize: 12, fontWeight: '900', letterSpacing: 2, color: RACK_COLORS.acc, textAlign: 'center', paddingHorizontal: 12 },
  note: { fontSize: 18, color: 'rgba(255,255,255,0.55)', marginTop: 6 },
  sumBig: { fontSize: 44, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  sumCol: { alignItems: 'center', gap: 10 },
  sumColRow: { alignItems: 'flex-start' },
  sumRow: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  sumRowWrap: { flexWrap: 'wrap', maxWidth: 420, gap: 8 },
  bx: { borderWidth: 1, borderColor: RACK_COLORS.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  bxTight: { paddingHorizontal: 9, paddingVertical: 8 },
  bxX: { fontSize: 24, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  bxXTight: { fontSize: 18 },
  lastChip: { alignSelf: 'flex-start', marginTop: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 9 },
  lastChipTxt: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.7)' },
  wrong: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 9, paddingVertical: 7, paddingHorizontal: 12 },
  wrongTxt: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.7)' },
  stp: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  stpBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stpOff: { opacity: 0.35 },
  stpTxt: { color: RACK_COLORS.acc, fontSize: 20, fontWeight: '800', lineHeight: 22 },
  stpVal: { flex: 1, minWidth: 0, alignItems: 'center' },
  stpX: { textAlign: 'center' },
  sumFoot: { fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
  open: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: RACK_COLORS.bg,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  openB: { fontSize: 34, fontWeight: '700', color: '#fff' },
  openS: { fontSize: 14, color: RACK_COLORS.mut },
});
