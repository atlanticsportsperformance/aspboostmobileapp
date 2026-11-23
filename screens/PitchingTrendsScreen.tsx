import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, Dimensions, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Path, Circle, Rect, Text as SvgText, G } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import {
  STEEL,
  fmt,
  Section,
  TimeChips,
  Segmented,
  ScreenHeader,
  steelStyles,
  type TimeRange,
} from '../components/hitting/steel';
import { PITCH_COLORS, normalizePitchType, pitchColor } from '../components/pitching/pitchColors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ACCENT = STEEL.ice;
const PITCH_ORDER = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'Changeup', 'Splitter', 'Other'];

// Supabase caps responses at 1000 rows — page through everything.
const BATCH_SIZE = 1000;
async function fetchAllPaginated<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build().range(offset, offset + BATCH_SIZE - 1);
    if (error) {
      console.error('Pagination fetch error:', error);
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }
  return out;
}

function chunk<T>(arr: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface TypeStat {
  maxVelo: number;
  avgVelo: number;
  count: number;
}
interface SessionData {
  date: string;
  t: number;
  sessionId: number;
  pitchTypes: Record<string, TypeStat>;
  stuffPlus: number | null;
}

const RANGE_DAYS: Record<TimeRange, number | null> = { '1m': 30, '3m': 90, '6m': 180, all: null };

function shortDate(t: number) {
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PitchingTrendsScreen({ navigation, route }: any) {
  const [allSessionData, setAllSessionData] = useState<SessionData[]>([]);
  const [timeFilter, setTimeFilter] = useState<TimeRange>('3m');
  const [metric, setMetric] = useState<'maxVelo' | 'avgVelo'>('maxVelo');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);

  useEffect(() => {
    loadAthleteAndData();
  }, []);

  async function loadAthleteAndData() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }
      let id = athleteId;
      if (!id) {
        const { data: athlete } = await supabase.from('athletes').select('id').eq('user_id', user.id).single();
        if (!athlete) {
          setLoading(false);
          return;
        }
        id = athlete.id;
        setAthleteId(athlete.id);
      }
      await fetchTrendsData(id!);
    } catch (error) {
      console.error('Error loading athlete:', error);
      setLoading(false);
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (athleteId) await fetchTrendsData(athleteId, { silent: true });
      else await loadAthleteAndData();
    } finally {
      setRefreshing(false);
    }
  }, [athleteId]);

  async function fetchTrendsData(id: string, opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    try {
      interface PitchRow {
        session_id: number;
        rel_speed: string | number | null;
        tagged_pitch_type: string | null;
        pitch_uid: string | null;
      }
      const pitches = await fetchAllPaginated<PitchRow>(() =>
        supabase
          .from('trackman_pitch_data')
          .select('session_id, rel_speed, tagged_pitch_type, pitch_uid')
          .eq('athlete_id', id)
          .not('rel_speed', 'is', null)
          .order('session_id', { ascending: true })
      );
      if (pitches.length === 0) {
        setAllSessionData([]);
        return;
      }

      const sessionIds = [...new Set(pitches.map((p) => p.session_id).filter((v) => v != null))];
      const sessionDate = new Map<number, string>();
      for (const ids of chunk(sessionIds)) {
        const { data } = await supabase.from('trackman_session').select('id, game_date_utc, created_at').in('id', ids);
        (data || []).forEach((s: any) => {
          const d = s.game_date_utc || s.created_at;
          if (d) sessionDate.set(s.id, d);
        });
      }

      const uids = [...new Set(pitches.map((p) => p.pitch_uid).filter((u): u is string => !!u))];
      const stuffByUid = new Map<string, number>();
      for (const ids of chunk(uids)) {
        const { data } = await supabase.from('pitch_stuff_plus').select('pitch_uid, stuff_plus').in('pitch_uid', ids);
        (data || []).forEach((r: any) => {
          const v = Number(r.stuff_plus);
          if (r.pitch_uid && Number.isFinite(v)) stuffByUid.set(r.pitch_uid, v);
        });
      }

      const bySession = new Map<number, { velos: Record<string, number[]>; stuff: number[] }>();
      pitches.forEach((p) => {
        const v = Number(p.rel_speed);
        if (p.session_id == null || !Number.isFinite(v) || v <= 0) return;
        const type = normalizePitchType(p.tagged_pitch_type);
        let s = bySession.get(p.session_id);
        if (!s) {
          s = { velos: {}, stuff: [] };
          bySession.set(p.session_id, s);
        }
        (s.velos[type] ||= []).push(v);
        const sp = p.pitch_uid ? stuffByUid.get(p.pitch_uid) : undefined;
        if (sp != null) s.stuff.push(sp);
      });

      const result: SessionData[] = [];
      bySession.forEach((s, sessionId) => {
        const date = sessionDate.get(sessionId);
        if (!date) return;
        const t = new Date(date).getTime();
        if (!Number.isFinite(t)) return;
        const pitchTypes: Record<string, TypeStat> = {};
        Object.entries(s.velos).forEach(([type, vs]) => {
          if (!vs.length) return;
          pitchTypes[type] = {
            maxVelo: Math.max(...vs),
            avgVelo: vs.reduce((a, b) => a + b, 0) / vs.length,
            count: vs.length,
          };
        });
        if (Object.keys(pitchTypes).length === 0) return;
        result.push({
          date,
          t,
          sessionId,
          pitchTypes,
          stuffPlus: s.stuff.length ? s.stuff.reduce((a, b) => a + b, 0) / s.stuff.length : null,
        });
      });
      result.sort((a, b) => a.t - b.t);
      setAllSessionData(result);
    } catch (error) {
      console.error('Error in fetchTrendsData:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredData = useMemo(() => {
    const days = RANGE_DAYS[timeFilter];
    if (days == null) return allSessionData;
    const cutoff = Date.now() - days * 86400000;
    return allSessionData.filter((s) => s.t >= cutoff);
  }, [allSessionData, timeFilter]);

  const activePitchTypes = useMemo(() => {
    const set = new Set<string>();
    filteredData.forEach((s) => Object.keys(s.pitchTypes).forEach((k) => set.add(k)));
    return PITCH_ORDER.filter((k) => set.has(k));
  }, [filteredData]);

  const summary = useMemo(
    () =>
      activePitchTypes.map((type) => {
        let max = -Infinity;
        let sum = 0;
        let count = 0;
        filteredData.forEach((s) => {
          const d = s.pitchTypes[type];
          if (!d) return;
          if (d.maxVelo > max) max = d.maxVelo;
          sum += d.avgVelo * d.count;
          count += d.count;
        });
        return { type, max: count ? max : null, avg: count ? sum / count : null, count };
      }),
    [activePitchTypes, filteredData]
  );

  const stuffSeries = useMemo(
    () =>
      filteredData
        .filter((s) => s.stuffPlus != null)
        .map((s) => ({ t: s.t, value: s.stuffPlus as number, type: 'Stuff+' })),
    [filteredData]
  );

  if (loading) {
    return (
      <SafeAreaView style={steelStyles.screen} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={ACCENT} />
        </View>
      </SafeAreaView>
    );
  }

  const veloSeries = activePitchTypes.map((type) => ({
    key: type,
    color: PITCH_COLORS[type] ?? pitchColor(type),
    points: filteredData
      .filter((s) => s.pitchTypes[type])
      .map((s) => ({ t: s.t, value: s.pitchTypes[type][metric], type })),
  }));

  return (
    <SafeAreaView style={steelStyles.screen} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} colors={[ACCENT]} progressBackgroundColor="#1A1A1A" />
        }
      >
        <ScreenHeader title="Velocity Trends" subtitle="Max & avg by pitch type" onBack={() => navigation.goBack()} />

        <View style={steelStyles.body}>
          <View style={{ paddingTop: 8, paddingBottom: 4 }}>
            <TimeChips value={timeFilter} onChange={setTimeFilter} />
          </View>

          {allSessionData.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No pitching data</Text>
              <Text style={styles.emptySub}>TrackMan data will appear here once available</Text>
            </View>
          ) : filteredData.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No pitches in this range</Text>
              <Text style={styles.emptySub}>Try selecting a different time range</Text>
            </View>
          ) : (
            <>
              <Section title={metric === 'maxVelo' ? 'MAX VELO' : 'AVG VELO'} right={`${filteredData.length} sessions`}>
                <View style={{ marginBottom: 12 }}>
                  <Segmented
                    options={[
                      { key: 'maxVelo', label: 'Max' },
                      { key: 'avgVelo', label: 'Avg' },
                    ]}
                    value={metric}
                    onChange={setMetric}
                  />
                </View>
                <TrendChart series={veloSeries} unit="mph" />
                <View style={styles.legend}>
                  {veloSeries.map((s) => (
                    <View key={s.key} style={styles.legendItem}>
                      <View style={[styles.dot, { backgroundColor: s.color }]} />
                      <Text style={styles.legendText}>{s.key}</Text>
                    </View>
                  ))}
                </View>
              </Section>

              <Section title="BY PITCH TYPE">
                <View style={styles.row}>
                  <Text style={[styles.th, { flex: 1.4 }]}>PITCH</Text>
                  <Text style={[styles.th, styles.num]}>MAX</Text>
                  <Text style={[styles.th, styles.num]}>AVG</Text>
                  <Text style={[styles.th, styles.num]}>COUNT</Text>
                </View>
                {summary.map((r) => (
                  <View key={r.type} style={[styles.row, styles.rowRule]}>
                    <View style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[styles.dot, { backgroundColor: PITCH_COLORS[r.type] ?? PITCH_COLORS.Other }]} />
                      <Text style={styles.td}>{r.type}</Text>
                    </View>
                    <Text style={[styles.td, styles.num, styles.tdStrong]}>{fmt(r.max)}</Text>
                    <Text style={[styles.td, styles.num]}>{fmt(r.avg)}</Text>
                    <Text style={[styles.td, styles.num]}>{r.count}</Text>
                  </View>
                ))}
              </Section>

              {stuffSeries.length > 0 && (
                <Section title="STUFF+ TREND" right="Avg per session">
                  <TrendChart series={[{ key: 'Stuff+', color: ACCENT, points: stuffSeries }]} refLine={100} height={150} />
                </Section>
              )}
            </>
          )}
        </View>
        <View style={{ height: 60 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

interface Pt {
  t: number;
  value: number;
  type: string;
}

function niceStep(range: number) {
  const raw = range / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function TrendChart({
  series,
  unit,
  refLine,
  height = 200,
}: {
  series: { key: string; color: string; points: Pt[] }[];
  unit?: string;
  refLine?: number;
  height?: number;
}) {
  const [sel, setSel] = useState<(Pt & { x: number; y: number; color: string }) | null>(null);

  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const width = SCREEN_WIDTH - 32;
  const pad = { top: 14, right: 12, bottom: 22, left: 30 };
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;

  const tMin = Math.min(...all.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  let vMin = Math.min(...all.map((p) => p.value));
  let vMax = Math.max(...all.map((p) => p.value));
  if (refLine != null) {
    vMin = Math.min(vMin, refLine);
    vMax = Math.max(vMax, refLine);
  }
  if (vMax - vMin < 2) {
    vMin -= 1;
    vMax += 1;
  }
  const step = niceStep(vMax - vMin);
  const yLo = Math.floor(vMin / step) * step;
  const yHi = Math.ceil(vMax / step) * step;
  const ticks: number[] = [];
  for (let v = yLo; v <= yHi + step / 2; v += step) ticks.push(v);

  const xOf = (t: number) => (tMax === tMin ? pad.left + iw / 2 : pad.left + ((t - tMin) / (tMax - tMin)) * iw);
  const yOf = (v: number) => pad.top + ih - ((v - yLo) / (yHi - yLo || 1)) * ih;
  const digits = step < 1 ? 1 : 0;

  return (
    <View>
      <Svg width={width} height={height}>
        {ticks.map((v) => (
          <G key={v}>
            <Line x1={pad.left} y1={yOf(v)} x2={width - pad.right} y2={yOf(v)} stroke="#fff" strokeOpacity={0.07} />
            <SvgText x={0} y={yOf(v) + 3} fill={STEEL.mute} fontSize={9}>
              {v.toFixed(digits)}
            </SvgText>
          </G>
        ))}
        {refLine != null && (
          <G>
            <Line
              x1={pad.left}
              y1={yOf(refLine)}
              x2={width - pad.right}
              y2={yOf(refLine)}
              stroke="#fff"
              strokeOpacity={0.3}
              strokeDasharray="4 4"
            />
          </G>
        )}
        <SvgText x={pad.left} y={height - 6} fill={STEEL.mute} fontSize={9}>
          {shortDate(tMin)}
        </SvgText>
        {tMax !== tMin && (
          <SvgText x={width - pad.right} y={height - 6} fill={STEEL.mute} fontSize={9} textAnchor="end">
            {shortDate(tMax)}
          </SvgText>
        )}

        {series.map((s) => {
          if (!s.points.length) return null;
          const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.t).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
          const last = s.points[s.points.length - 1];
          return (
            <G key={s.key}>
              <Path d={d} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((p, i) => (
                <Circle key={i} cx={xOf(p.t)} cy={yOf(p.value)} r={2} fill={s.color} />
              ))}
              <Circle cx={xOf(last.t)} cy={yOf(last.value)} r={4.5} fill={s.color} stroke={STEEL.bg} strokeWidth={1.5} />
              {s.points.map((p, i) => (
                <Circle
                  key={`hit${i}`}
                  cx={xOf(p.t)}
                  cy={yOf(p.value)}
                  r={12}
                  fill="transparent"
                  onPress={() => {
                    const x = xOf(p.t);
                    const y = yOf(p.value);
                    setSel((cur) => (cur && cur.x === x && cur.y === y && cur.type === p.type ? null : { ...p, x, y, color: s.color }));
                  }}
                />
              ))}
            </G>
          );
        })}

        {sel &&
          (() => {
            const w = 118;
            const h = 40;
            const tx = Math.min(Math.max(sel.x - w / 2, 0), width - w);
            const ty = sel.y - h - 10 < 0 ? sel.y + 10 : sel.y - h - 10;
            return (
              <G>
                <Circle cx={sel.x} cy={sel.y} r={6} fill="none" stroke="#fff" strokeWidth={1.5} />
                <Rect x={tx} y={ty} width={w} height={h} rx={6} fill="#1b2430" stroke={STEEL.hair} />
                <SvgText x={tx + 8} y={ty + 16} fill="#fff" fontSize={12} fontWeight="800">
                  {`${sel.value.toFixed(1)}${unit ? ` ${unit}` : ''}`}
                </SvgText>
                <SvgText x={tx + 8} y={ty + 31} fill={STEEL.sub} fontSize={10}>
                  {`${sel.type} · ${shortDate(sel.t)}`}
                </SvgText>
              </G>
            );
          })()}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 6 },
  emptyText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptySub: { color: STEEL.mute, fontSize: 13 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: STEEL.sub, fontSize: 12, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  rowRule: { borderTopWidth: 1, borderTopColor: STEEL.rule },
  th: { color: STEEL.mute, fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  td: { color: STEEL.day, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  tdStrong: { color: '#fff', fontWeight: '800' },
  num: { flex: 0.8, textAlign: 'right' },
});
