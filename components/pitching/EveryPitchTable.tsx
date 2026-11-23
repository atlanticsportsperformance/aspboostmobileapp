/**
 * EVERY PITCH — Steel list for the pitching Session screen. All / ▶ Video
 * filter (hidden when nothing was filmed), filmed rows carry an accent edge and
 * a VIDEO pill, tapping one opens an inline preview card whose Play opens the
 * full-screen TmVideoPlayer.
 */

import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { STEEL, fmt } from '../hitting/steel';

export interface EveryPitchRow {
  uid: string;
  no: number;
  type: string;
  color: string;
  velo: number | null;
  ivb: number | null;
  hb: number | null;
}

export function EveryPitchTable({
  rows,
  filmed,
  thumbOf,
  onPlay,
  onOpenRow,
}: {
  rows: EveryPitchRow[];
  /** uids with a clip */
  filmed: Set<string>;
  thumbOf: (uid: string) => string | null;
  onPlay: (uid: string) => void;
  /** Called when a filmed row opens (lets the screen refresh a stale set). */
  onOpenRow?: (uid: string) => void;
}) {
  const [only, setOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const filmedN = rows.filter((r) => filmed.has(r.uid)).length;
  const hasVideo = filmedN > 0;
  const showOnly = only && hasVideo;

  return (
    <View>
      <View style={s.head}>
        <Text style={s.eyebrow}>EVERY PITCH</Text>
        {hasVideo ? (
          <View style={s.chips}>
            <Pressable onPress={() => setOnly(false)} style={[s.chip, !showOnly && s.chipOn]}>
              <Text style={[s.chipText, !showOnly && s.chipTextOn]}>All {rows.length}</Text>
            </Pressable>
            <Pressable onPress={() => setOnly(true)} style={[s.chip, showOnly && s.chipOn]}>
              <Text style={[s.chipText, showOnly && s.chipTextOn]}>▶ Video {filmedN}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={[s.tr, s.hdr]}>
        <Text style={[s.h, s.cNo]}>#</Text>
        <Text style={[s.h, s.cName]}>PITCH</Text>
        <Text style={[s.h, s.cNum]}>VELO</Text>
        <Text style={[s.h, s.cNum]}>IVB</Text>
        <Text style={[s.h, s.cNum]}>HB</Text>
        {hasVideo ? <View style={s.cVid} /> : null}
      </View>

      {rows.map((r) => {
        const isFilmed = filmed.has(r.uid);
        const off = showOnly && !isFilmed;
        const isOpen = open === r.uid && isFilmed;
        const thumb = isOpen ? thumbOf(r.uid) : null;
        return (
          <View key={r.uid}>
            <Pressable
              disabled={!isFilmed}
              onPress={() => {
                const next = open === r.uid ? null : r.uid;
                setOpen(next);
                if (next) onOpenRow?.(next);
              }}
              style={[s.tr, s.row, isFilmed && s.rowVid, isOpen && { backgroundColor: STEEL.card }]}
              accessibilityRole={isFilmed ? 'button' : undefined}
            >
              <Text style={[s.td, s.cNo, s.no, off && s.off]}>{r.no}</Text>
              <View style={[s.cName, s.nameWrap]}>
                <View style={[s.dot, { backgroundColor: r.color, opacity: off ? 0.35 : 1 }]} />
                <Text style={[s.td, off && s.off]} numberOfLines={1}>
                  {r.type}
                </Text>
              </View>
              <Text style={[s.td, s.cNum, s.strong, off && s.off]}>{fmt(r.velo)}</Text>
              <Text style={[s.td, s.cNum, off && s.off]}>{fmt(r.ivb)}</Text>
              <Text style={[s.td, s.cNum, off && s.off]}>{fmt(r.hb)}</Text>
              {hasVideo ? (
                <View style={s.cVid}>{isFilmed ? <Text style={s.pill}>VIDEO</Text> : null}</View>
              ) : null}
            </Pressable>
            {isOpen ? (
              <Pressable onPress={() => onPlay(r.uid)} style={s.prev} accessibilityRole="button" accessibilityLabel="Play video">
                {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFillObject} resizeMode="cover" /> : null}
                <LinearGradient
                  pointerEvents="none"
                  colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={s.prevIn}>
                  <Text style={s.prevHead}>
                    #{r.no} · {r.type.toUpperCase()}
                  </Text>
                  <Text style={s.prevBig}>
                    {fmt(r.velo)}
                    <Text style={s.prevUnit}> mph</Text>
                  </Text>
                  <Text style={s.prevSub}>
                    IVB {fmt(r.ivb)} · HB {fmt(r.hb)}
                  </Text>
                </View>
                <View style={s.play}>
                  <Text style={s.playText}>▶ Play ¼×</Text>
                </View>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  eyebrow: { color: '#e5e7eb', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: STEEL.card, borderWidth: 1, borderColor: STEEL.rule },
  chipOn: { backgroundColor: '#1b2430', borderColor: '#2a3442' },
  chipText: { color: STEEL.sub, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  tr: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8 },
  hdr: { paddingVertical: 6 },
  row: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: STEEL.rule, borderLeftWidth: 2, borderLeftColor: 'transparent' },
  rowVid: { borderLeftColor: STEEL.force },
  h: { color: STEEL.mute, fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },
  td: { color: STEEL.text, fontSize: 12.5, fontVariant: ['tabular-nums'] },
  strong: { fontWeight: '800' },
  no: { color: STEEL.sub },
  off: { color: STEEL.past },
  cNo: { width: 26 },
  cName: { flex: 1, minWidth: 0 },
  nameWrap: { flexDirection: 'row', alignItems: 'center' },
  cNum: { width: 44, textAlign: 'right' },
  cVid: { width: 56, alignItems: 'flex-end' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  pill: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, overflow: 'hidden', backgroundColor: '#0f1a24', color: STEEL.force },
  prev: { height: 130, borderRadius: 12, overflow: 'hidden', backgroundColor: STEEL.card, marginVertical: 8 },
  prevIn: { position: 'absolute', left: 12, top: 10, bottom: 10, justifyContent: 'space-between' },
  prevHead: { color: STEEL.sub, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  prevBig: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  prevUnit: { color: STEEL.sub, fontSize: 12, fontWeight: '700' },
  prevSub: { color: STEEL.sub, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  play: { position: 'absolute', right: 12, bottom: 10, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: STEEL.force },
  playText: { color: '#000', fontSize: 12, fontWeight: '800' },
});
