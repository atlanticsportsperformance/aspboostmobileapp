/**
 * Athlete card: who is up, the exercise (override dropdown), where the
 * context came from, BAR / REPS (prescribed) / TARGET SPEED, and the big Done.
 * The set summary and the "Rack n is open" state overlay the card.
 *
 * `layout='column'` (landscape, 360 wide, Done at the bottom) or `'row'`
 * (portrait, full width: 220 name block | kv grid | 150-wide Done).
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { TodayExercise } from '../../lib/rack/api';
import { RACK_COLORS, type RackView } from '../../lib/rack/viewModel';
import ExercisePicker from './ExercisePicker';

export interface AthleteCardProps {
  view: RackView;
  rackName: string;
  layout?: 'column' | 'row';
  /** Big Done → engine `ipadDone`. */
  onDone: () => void;
  onPickExercise: (ex: TodayExercise) => void;
}

export default function AthleteCard({ view, rackName, layout = 'column', onDone, onPickExercise }: AthleteCardProps) {
  const a = view.athlete;
  const row = layout === 'row';
  return (
    <View style={[styles.card, row ? styles.cardRow : styles.cardCol]}>
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
            remaining={view.remaining}
            currentRoutineExerciseId={view.routineExerciseId}
            phoneOwnsContext={view.contextSource === 'phone'}
            onPick={onPickExercise}
          />
          <Text style={styles.src}>{view.sourceLine}</Text>
        </View>
      </View>

      <View style={[styles.kv, row && styles.kvRow]}>
        <View style={styles.kvb}>
          <Text style={styles.k}>{view.contextSource === 'phone' ? 'BAR · SET ON PHONE' : 'BAR'}</Text>
          <Text style={styles.x}>{view.loadLb != null ? `${view.loadLb} lb` : '—'}</Text>
        </View>
        <View style={styles.kvb}>
          <Text style={styles.k}>REPS</Text>
          <Text style={styles.x}>{view.repsTarget != null ? view.repsTarget : '—'}</Text>
        </View>
        <View style={[styles.kvb, styles.wide]}>
          <Text style={styles.k}>TARGET SPEED</Text>
          <Text style={[styles.x, styles.wideX]}>
            {view.zone ? `${view.zone[0].toFixed(2)}–${view.zone[1].toFixed(2)} m/s` : 'No target'}
          </Text>
        </View>
      </View>

      <TouchableOpacity style={[styles.doneWrap, row && styles.doneWrapRow]} activeOpacity={0.85} onPress={onDone}>
        <LinearGradient colors={['#A6E3FF', '#6BBCE8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.done, row && styles.doneRow]}>
          <Text style={styles.doneTxt}>✓ Done</Text>
        </LinearGradient>
      </TouchableOpacity>

      {view.summary && (
        <View style={styles.summary}>
          <Text style={styles.sumT}>{view.summary.title}</Text>
          <Text style={styles.sumBig}>{view.summary.big}</Text>
          <View style={styles.sumRow}>
            {(
              [
                ['AVG', view.summary.avg],
                ['BEST', view.summary.best],
                ['DROP', view.summary.drop],
              ] as const
            ).map(([k, x]) => (
              <View key={k} style={styles.bx}>
                <Text style={styles.k}>{k}</Text>
                <Text style={styles.bxX}>{x}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.sumFoot}>{view.summary.footer}</Text>
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
  summary: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,9,10,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    borderRadius: 18,
  },
  sumT: { fontSize: 12, fontWeight: '900', letterSpacing: 2, color: RACK_COLORS.acc, textAlign: 'center', paddingHorizontal: 12 },
  sumBig: { fontSize: 44, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  sumRow: { flexDirection: 'row', gap: 12 },
  bx: { borderWidth: 1, borderColor: RACK_COLORS.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  bxX: { fontSize: 24, fontWeight: '800', color: '#fff', fontVariant: ['tabular-nums'] },
  sumFoot: { fontSize: 12, color: 'rgba(255,255,255,0.5)' },
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
