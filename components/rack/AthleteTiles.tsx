/**
 * Bottom row: one tile per athlete on the rack (UP NOW / NEXT / #n IN LINE,
 * or dimmed "On Box Jump" when their phone is on a non-rack exercise), plus
 * "+ Add", which opens a sheet of today's athletes not yet on the rack.
 */

import React, { memo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { TodayAthlete } from '../../lib/rack/api';
import { initialsOf, RACK_COLORS, type TileView } from '../../lib/rack/viewModel';

export interface AthleteTilesProps {
  tiles: TileView[];
  addable: TodayAthlete[];
  /** Tile tap → engine `selectAthlete`. */
  onSelect: (athleteId: string) => void;
  /** "+" sheet pick → `selectAthlete` (rack_set_active). */
  onAdd: (athleteId: string) => void;
  /** Row height (layout scales it). */
  height?: number;
  /** Portrait: 38 px avatar, tighter padding, 72 px Add. */
  compact?: boolean;
}

function AthleteTiles({ tiles, addable, onSelect, onAdd, height = 96, compact = false }: AthleteTilesProps) {
  const [sheet, setSheet] = useState(false);
  return (
    <View style={[styles.row, { height }]}>
      {tiles.map(t => (
        <TouchableOpacity
          key={t.athleteId}
          activeOpacity={0.8}
          style={[styles.tile, compact && styles.tileC, t.active && styles.on, t.away && styles.away, t.switching && styles.switching]}
          onPress={() => onSelect(t.athleteId)}
        >
          <View style={[styles.av, compact && styles.avC, t.active && styles.avOn]}>
            <Text style={[styles.avTxt, compact && styles.avTxtC, t.active && styles.avTxtOn]}>{t.initials}</Text>
          </View>
          <View style={styles.txt}>
            <Text style={[styles.name, compact && styles.nameC]} numberOfLines={1}>
              {t.name}
            </Text>
            <Text style={[styles.sub, compact && styles.subC]} numberOfLines={1} ellipsizeMode="tail">
              {t.subtitle}
            </Text>
            {!!t.status && <Text style={[styles.em, t.active && styles.emOn]}>{t.status}</Text>}
          </View>
        </TouchableOpacity>
      ))}
      <TouchableOpacity activeOpacity={0.8} style={[styles.tile, styles.add, compact && styles.addC]} onPress={() => setSheet(true)}>
        <Text style={styles.plus}>+</Text>
        <Text style={styles.addTxt}>Add</Text>
      </TouchableOpacity>

      <Modal visible={sheet} transparent animationType="fade" supportedOrientations={['landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => setSheet(false)}>
        <Pressable style={styles.scrim} onPress={() => setSheet(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetK}>ADD TO THE RACK</Text>
            <Text style={styles.sheetS}>Today's athletes not on the rack. They go up now.</Text>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8 }}>
              {addable.length === 0 && <Text style={styles.none}>Everyone with a workout today is already on the rack.</Text>}
              {addable.map(a => (
                <TouchableOpacity
                  key={a.athleteId}
                  style={styles.pick}
                  onPress={() => {
                    setSheet(false);
                    onAdd(a.athleteId);
                  }}
                >
                  <View style={styles.av}>
                    <Text style={styles.avTxt}>{initialsOf(a.firstName, a.lastName)}</Text>
                  </View>
                  <View style={styles.txt}>
                    <Text style={styles.name}>
                      {a.firstName} {a.lastName}
                    </Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {a.remaining[0] ? `Next: ${a.remaining[0].name}` : 'No sets left today'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export default memo(AthleteTiles);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 16 },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: RACK_COLORS.line,
    backgroundColor: RACK_COLORS.card,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  tileC: { paddingHorizontal: 12, gap: 10 },
  avC: { width: 38, height: 38 },
  avTxtC: { fontSize: 13 },
  nameC: { fontSize: 15 },
  subC: { fontSize: 11 },
  addC: { width: 72 },
  on: { borderColor: RACK_COLORS.acc, backgroundColor: 'rgba(155,221,255,0.07)' },
  away: { opacity: 0.5 },
  switching: { borderColor: 'rgba(155,221,255,0.45)', borderStyle: 'dashed' },
  av: { width: 44, height: 44, borderRadius: 999, backgroundColor: '#202327', alignItems: 'center', justifyContent: 'center' },
  avOn: { backgroundColor: RACK_COLORS.acc },
  avTxt: { fontWeight: '800', fontSize: 15, color: 'rgba(255,255,255,0.85)' },
  avTxtOn: { color: RACK_COLORS.accInk },
  txt: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '700', color: '#fff' },
  sub: { fontSize: 12, color: RACK_COLORS.mut },
  em: { fontSize: 10, fontWeight: '900', letterSpacing: 1.3, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  emOn: { color: RACK_COLORS.acc },
  add: { flex: 0, width: 96, flexDirection: 'column', justifyContent: 'center', gap: 4, paddingHorizontal: 0 },
  plus: { fontSize: 20, color: RACK_COLORS.mut },
  addTxt: { fontSize: 12, color: RACK_COLORS.mut },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  sheet: {
    width: 520,
    borderRadius: 18,
    backgroundColor: RACK_COLORS.card,
    borderWidth: 1,
    borderColor: RACK_COLORS.line,
    padding: 20,
    gap: 6,
  },
  sheetK: { fontSize: 11, fontWeight: '900', letterSpacing: 1.6, color: 'rgba(255,255,255,0.5)' },
  sheetS: { fontSize: 13, color: RACK_COLORS.mut, marginBottom: 10 },
  none: { fontSize: 14, color: RACK_COLORS.mut, paddingVertical: 20, textAlign: 'center' },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: RACK_COLORS.line,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
});
