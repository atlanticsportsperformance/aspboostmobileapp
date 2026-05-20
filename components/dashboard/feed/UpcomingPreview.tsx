/**
 * UpcomingPreview — scrollable vertical agenda of the next 7 days.
 *
 * Pulls from the dashboard's already-fetched bookings, armcareTestInstances,
 * and reminders arrays — no new queries. Editorial agenda rows (monospace
 * date, hairline dividers, title + "CATEGORY · time"), an accent rail on
 * today, and a green check on completed items. Shows ~3 rows then scrolls
 * inside a fixed-height container with a soft bottom fade.
 *
 * Renders nothing if the next 7 days are empty.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface BookingLike {
  id: string;
  status?: string;
  event: {
    start_time: string;
    title?: string;
    scheduling_templates?: {
      name: string;
      scheduling_categories?: { name: string; color?: string };
    };
  };
}

interface ArmcareLike {
  id: string;
  scheduled_date: string;
  status: 'not_started' | 'completed' | 'skipped';
  source_type: string;
}

interface ReminderLike {
  id: string;
  occurrence_date: string;
  reminder: {
    title: string;
    color: string | null;
    category: string | null;
  };
}

interface Item {
  key: string;
  date: Date;
  title: string;
  category: string | null;
  time: string | null;
  isToday: boolean;
  done: boolean;
}

interface Props {
  bookings: BookingLike[];
  armcareTests: ArmcareLike[];
  reminders: ReminderLike[];
  onSelectDate: (d: Date) => void;
}

const ACCENT = '#9BDDFF';
// Each agenda row is ~63px tall; show exactly 3 then scroll.
const ROW_HEIGHT = 63;
const VISIBLE_ROWS = 3;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function UpcomingPreview({
  bookings,
  armcareTests,
  reminders,
  onSelectDate,
}: Props) {
  const items = useMemo<Item[]>(() => {
    const now = new Date();
    const today = startOfDay(now);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + 7);

    const merged: Item[] = [];

    for (const b of bookings) {
      if (!b.event?.start_time) continue;
      const d = new Date(b.event.start_time);
      if (d < today || d > cutoff) continue;
      const tmpl = b.event.scheduling_templates;
      const cat = tmpl?.scheduling_categories;
      merged.push({
        key: `b-${b.id}`,
        date: d,
        title: b.event.title || tmpl?.name || cat?.name || 'Booking',
        category: cat?.name ?? null,
        time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        isToday: isSameDay(d, now),
        done: b.status === 'attended',
      });
    }

    for (const t of armcareTests) {
      if (t.status === 'skipped') continue;
      const d = new Date(`${t.scheduled_date}T12:00:00`);
      if (d < today || d > cutoff) continue;
      merged.push({
        key: `a-${t.id}`,
        date: d,
        title: 'ArmCare Test',
        category: t.source_type === 'plan' ? 'Assigned' : 'ArmCare',
        time: null,
        isToday: isSameDay(d, now),
        done: t.status === 'completed',
      });
    }

    for (const r of reminders) {
      const d = new Date(`${r.occurrence_date}T12:00:00`);
      if (d < today || d > cutoff) continue;
      merged.push({
        key: `r-${r.id}`,
        date: d,
        title: r.reminder.title || 'Reminder',
        category: r.reminder.category,
        time: null,
        isToday: isSameDay(d, now),
        done: false,
      });
    }

    merged.sort((a, b) => a.date.getTime() - b.date.getTime());
    return merged;
  }, [bookings, armcareTests, reminders]);

  if (items.length === 0) return null;

  const scrolls = items.length > VISIBLE_ROWS;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>UPCOMING</Text>
        <Text style={styles.eyebrowMeta}>
          {items.length} event{items.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <View style={[styles.listFrame, scrolls && { height: ROW_HEIGHT * VISIBLE_ROWS }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          scrollEnabled={scrolls}
        >
          {items.map((item, i) => {
            const catText = item.category ? item.category.toUpperCase() : null;
            const timeText = item.time ?? (item.done ? 'Completed' : 'Scheduled');
            return (
              <Pressable
                key={item.key}
                onPress={() => onSelectDate(item.date)}
                style={({ pressed }) => [
                  styles.row,
                  i === items.length - 1 && styles.rowLast,
                  pressed && { opacity: 0.55 },
                ]}
              >
                {/* Accent rail — only on today */}
                <View style={[styles.rail, item.isToday && styles.railToday]} />

                {/* Date block */}
                <View style={styles.dateBlock}>
                  <Text style={[styles.weekday, item.isToday && styles.accentText]}>
                    {item.isToday
                      ? 'TODAY'
                      : item.date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
                  </Text>
                  <Text style={[styles.dayNum, item.isToday && styles.accentText]}>
                    {item.date.getDate()}
                  </Text>
                </View>

                {/* Title + meta */}
                <View style={styles.body}>
                  <Text style={styles.title} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <View style={styles.metaRow}>
                    {catText ? <Text style={styles.metaCat}>{catText}</Text> : null}
                    <Text style={styles.meta} numberOfLines={1}>
                      {timeText}
                    </Text>
                  </View>
                </View>

                {/* Trailing: green check if done, else chevron */}
                {item.done ? (
                  <View style={styles.checkWrap}>
                    <Ionicons name="checkmark" size={12} color="#00ff55" />
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color="#4b5563" />
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Soft bottom fade hinting more rows below the fold */}
        {scrolls && (
          <LinearGradient
            colors={['rgba(7,7,8,0)', 'rgba(7,7,8,0.95)']}
            style={styles.fade}
            pointerEvents="none"
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 16,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    marginTop: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 18,
    marginBottom: 6,
  },
  eyebrow: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  eyebrowMeta: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '600',
  },
  listFrame: {
    paddingHorizontal: 16,
    position: 'relative',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingLeft: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    position: 'relative',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rail: {
    position: 'absolute',
    left: 0,
    top: 14,
    bottom: 14,
    width: 2.5,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  railToday: {
    backgroundColor: ACCENT,
  },
  dateBlock: {
    width: 42,
    marginRight: 14,
    alignItems: 'center',
  },
  weekday: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#6b7280',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  dayNum: {
    fontSize: 22,
    fontWeight: '700',
    color: '#e5e7eb',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  accentText: {
    color: ACCENT,
  },
  body: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: -0.1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  metaCat: {
    color: '#6b7280',
    fontSize: 10,
    letterSpacing: 0.6,
    marginRight: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  meta: {
    fontSize: 11,
    color: '#9ca3af',
    flexShrink: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  checkWrap: {
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: 'rgba(0,255,85,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 26,
  },
});
