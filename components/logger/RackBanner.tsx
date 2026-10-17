// Rack banner (overview + exercise screen). Three states:
//   active  — "Rack 3 · you’re up / Nobody waiting"      [Leave]
//   queued  — "Rack 3 · Tyler is lifting / You’re #2 in line" [I’m up] [Leave]
//   browse  — "RACKS  Rack 1 · open  Rack 3 · Tyler lifting" (tap a rack = join)
// Rendered only when the org has an active rack (the parent passes null otherwise).

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { LOGGER_COLORS } from '../../lib/logger/theme';
import { RACK_COLORS, type BannerState } from '../../lib/rack/phoneView';

/** What a logger screen gets from useRackPhone (banner only when hasRacks). */
export interface RackScreenProps {
  hasRacks: boolean;
  banner: BannerState | null;
  error: string | null;
  busy: boolean;
  onJoin: (rackId: string) => void;
  onImUp: (rackId: string) => void;
  onLeave: (rackId: string) => void;
}

export interface RackBannerProps {
  banner: BannerState;
  error: string | null;
  busy: boolean;
  onJoin: (rackId: string) => void;
  onImUp: (rackId: string) => void;
  onLeave: (rackId: string) => void;
  /** The parent already pads 16 pt sideways (overview). */
  flush?: boolean;
}

export default function RackBanner({ banner, error, busy, onJoin, onImUp, onLeave, flush = false }: RackBannerProps) {
  const wrap = [styles.wrap, flush && styles.wrapFlush];
  const err = error ? <Text style={styles.err}>{error}</Text> : null;

  if (banner.mode === 'browse') {
    return (
      <View style={wrap}>
        <View style={[styles.banner, styles.browse]}>
          <Text style={styles.racksLabel}>RACKS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rackList}>
            {banner.racks.map(r => (
              <TouchableOpacity
                key={r.rackId}
                style={styles.rackPill}
                onPress={() => onJoin(r.rackId)}
                disabled={busy}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Join ${r.name}, ${r.status}`}
              >
                <Text style={styles.rackPillText} numberOfLines={1}>
                  {r.name}
                  <Text style={styles.rackPillState}>{` · ${r.status}`}</Text>
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        {err}
      </View>
    );
  }

  const rackId = banner.rackId as string;
  const active = banner.mode === 'active';
  return (
    <View style={wrap}>
      <View style={styles.banner}>
        <View style={[styles.dot, !active && styles.dotQueued]} />
        <View style={styles.tx}>
          <Text style={styles.title} numberOfLines={1}>{banner.title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{banner.subtitle}</Text>
        </View>
        {!active && (
          <TouchableOpacity
            style={[styles.btn, styles.btnPri]}
            onPress={() => onImUp(rackId)}
            disabled={busy}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="I’m up"
          >
            <Text style={styles.btnPriText}>I’m up</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost]}
          onPress={() => onLeave(rackId)}
          disabled={busy}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Leave rack"
        >
          <Text style={styles.btnGhostText}>Leave</Text>
        </TouchableOpacity>
      </View>
      {err}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginBottom: 10 },
  wrapFlush: { marginHorizontal: 0 },
  banner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RACK_COLORS.bannerBorder,
    backgroundColor: RACK_COLORS.bannerBg,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  browse: { paddingVertical: 8 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: LOGGER_COLORS.accent,
    shadowColor: LOGGER_COLORS.accent,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  dotQueued: { backgroundColor: 'rgba(255,255,255,0.4)', shadowOpacity: 0 },
  tx: { flex: 1, minWidth: 0 },
  title: { color: LOGGER_COLORS.text, fontSize: 13, fontWeight: '700' },
  sub: { color: RACK_COLORS.muted, fontSize: 11, fontWeight: '500', marginTop: 1 },
  btn: { borderRadius: 9, paddingVertical: 7, paddingHorizontal: 11 },
  btnPri: { backgroundColor: LOGGER_COLORS.accent },
  btnPriText: { color: '#04131C', fontSize: 12, fontWeight: '800' },
  btnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  btnGhostText: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '800' },
  racksLabel: { color: LOGGER_COLORS.accent, fontSize: 9.5, fontWeight: '900', letterSpacing: 1.5 },
  rackList: { gap: 6, alignItems: 'center' },
  rackPill: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  rackPillText: { color: LOGGER_COLORS.text, fontSize: 12, fontWeight: '700' },
  rackPillState: { color: RACK_COLORS.muted, fontWeight: '500' },
  err: { color: RACK_COLORS.slow, fontSize: 11, marginTop: 4, marginLeft: 4 },
});
