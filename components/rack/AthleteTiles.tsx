/**
 * Bottom row: one tile per athlete on the rack (UP NOW / NEXT / #n IN LINE,
 * or dimmed "On Box Jump" when their phone is on a non-rack exercise), plus
 * "+ Add", which opens AddAthleteSheet (search, scroll-safe taps, confirm).
 */

import React, { memo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { TodayAthlete } from '../../lib/rack/api';
import { RACK_COLORS, type TileView } from '../../lib/rack/viewModel';
import AddAthleteSheet from './AddAthleteSheet';

export interface AthleteTilesProps {
  tiles: TileView[];
  addable: TodayAthlete[];
  /** Tile tap → engine `selectAthlete`. */
  onSelect: (athleteId: string) => void;
  /** "+" sheet "Put <name> up" → `selectAthlete` (rack_set_active). */
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

      <AddAthleteSheet visible={sheet} addable={addable} onClose={() => setSheet(false)} onAdd={onAdd} />
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
});
