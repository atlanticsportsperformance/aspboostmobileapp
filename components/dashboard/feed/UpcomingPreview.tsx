/**
 * UpcomingPreview — thin horizontal strip of next-7-days items.
 *
 * Pulls from the dashboard's already-fetched bookings, armcareTestInstances,
 * and reminders arrays — no new queries. Each tile is borderless (no
 * containers): just a thin vertical accent bar, a date stamp, a title, and
 * a meta line. Tap a tile → opens the existing day-detail view for that
 * date.
 *
 * Renders nothing if the next 7 days are empty.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';

interface BookingLike {
  id: string;
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
  label: string;
  meta: string | null;
  color: string;
}

interface Props {
  bookings: BookingLike[];
  armcareTests: ArmcareLike[];
  reminders: ReminderLike[];
  onSelectDate: (d: Date) => void;
}

const ARMCARE_RED = '#ef4444';
const REMINDER_AMBER = '#f59e0b';
const BOOKING_PURPLE = '#a855f7';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function UpcomingPreview({
  bookings,
  armcareTests,
  reminders,
  onSelectDate,
}: Props) {
  const items = useMemo<Item[]>(() => {
    const today = startOfDay(new Date());
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
        label: b.event.title || tmpl?.name || cat?.name || 'Booking',
        meta: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        color: cat?.color || BOOKING_PURPLE,
      });
    }

    for (const t of armcareTests) {
      if (t.status === 'completed' || t.status === 'skipped') continue;
      const d = new Date(`${t.scheduled_date}T12:00:00`);
      if (d < today || d > cutoff) continue;
      merged.push({
        key: `a-${t.id}`,
        date: d,
        label: 'ArmCare test',
        meta: t.source_type === 'plan' ? 'Coach assigned' : null,
        color: ARMCARE_RED,
      });
    }

    for (const r of reminders) {
      const d = new Date(`${r.occurrence_date}T12:00:00`);
      if (d < today || d > cutoff) continue;
      merged.push({
        key: `r-${r.id}`,
        date: d,
        label: r.reminder.title || 'Reminder',
        meta: r.reminder.category,
        color: r.reminder.color || REMINDER_AMBER,
      });
    }

    merged.sort((a, b) => a.date.getTime() - b.date.getTime());
    return merged;
  }, [bookings, armcareTests, reminders]);

  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>UPCOMING</Text>
        <Text style={styles.eyebrowMeta}>Next 7 days</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => onSelectDate(item.date)}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.55 }]}
          >
            <View style={[styles.accent, { backgroundColor: item.color }]} />
            <View style={styles.tileBody}>
              <Text style={styles.dateStamp}>
                {item.date
                  .toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
                  .toUpperCase()}
              </Text>
              <Text style={styles.title} numberOfLines={1}>
                {item.label}
              </Text>
              {item.meta ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {item.meta}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  eyebrow: {
    color: '#e5e7eb',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
  },
  eyebrowMeta: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  row: {
    paddingHorizontal: 16,
    gap: 10,
  },
  tile: {
    flexDirection: 'row',
    minWidth: 168,
    paddingVertical: 4,
  },
  accent: {
    width: 3,
    borderRadius: 2,
    marginRight: 10,
  },
  tileBody: {
    flex: 1,
    gap: 2,
  },
  dateStamp: {
    color: '#9BDDFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  meta: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
  },
});
