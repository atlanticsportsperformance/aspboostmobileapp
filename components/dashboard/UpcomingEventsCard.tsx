import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface UpcomingEvent {
  id: string;
  status: string;
  event: {
    id: string;
    start_time: string;
    end_time: string;
    title?: string;
    scheduling_templates?: {
      name: string;
      scheduling_categories?: {
        name: string;
        color?: string;
      };
    };
  };
}

interface UpcomingEventsCardProps {
  events: UpcomingEvent[];
  isActive?: boolean;
  onEventPress?: (event: UpcomingEvent) => void;
}

type FilterRange = '7d' | '30d';

export default function UpcomingEventsCard({
  events,
  isActive = true,
  onEventPress,
}: UpcomingEventsCardProps) {
  const [filterRange, setFilterRange] = useState<FilterRange>('7d');

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (isActive && !hasAnimated.current) {
      hasAnimated.current = true;
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isActive]);

  // Reset animation values when card becomes inactive
  // This allows animation to replay when user swipes back to this card
  useEffect(() => {
    if (!isActive) {
      hasAnimated.current = false;
      // Reset animation values to initial state
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
    }
  }, [isActive]);

  // Filter events based on selected range
  const filteredEvents = React.useMemo(() => {
    const now = new Date();
    const daysToAdd = filterRange === '7d' ? 7 : 30;
    const endDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);

    return events
      .filter((event) => {
        const eventDate = new Date(event.event.start_time);
        return eventDate >= now && eventDate <= endDate;
      })
      .sort((a, b) => new Date(a.event.start_time).getTime() - new Date(b.event.start_time).getTime());
  }, [events, filterRange]);

  // Group events by date
  const groupedEvents = React.useMemo(() => {
    const groups: { [key: string]: UpcomingEvent[] } = {};

    filteredEvents.forEach((event) => {
      const dateKey = new Date(event.event.start_time).toDateString();
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(event);
    });

    return Object.entries(groups).map(([dateKey, events]) => ({
      date: new Date(dateKey),
      events,
    }));
  }, [filteredEvents]);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDateBadge = (date: Date) => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === now.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
  };

  const getEventColor = (event: UpcomingEvent) => {
    return event.event.scheduling_templates?.scheduling_categories?.color || '#8B5CF6';
  };

  const getEventTitle = (event: UpcomingEvent) => {
    return (
      event.event.title ||
      event.event.scheduling_templates?.name ||
      'Scheduled Event'
    );
  };

  const getCategoryName = (event: UpcomingEvent) => {
    return event.event.scheduling_templates?.scheduling_categories?.name || '';
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="calendar" size={20} color="#8B5CF6" />
          <Text style={styles.headerTitle}>Upcoming Events</Text>
        </View>
        <View style={styles.filterToggle}>
          <TouchableOpacity
            style={[
              styles.filterButton,
              filterRange === '7d' && styles.filterButtonActive,
            ]}
            onPress={() => setFilterRange('7d')}
          >
            <Text
              style={[
                styles.filterButtonText,
                filterRange === '7d' && styles.filterButtonTextActive,
              ]}
            >
              7d
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.filterButton,
              filterRange === '30d' && styles.filterButtonActive,
            ]}
            onPress={() => setFilterRange('30d')}
          >
            <Text
              style={[
                styles.filterButtonText,
                filterRange === '30d' && styles.filterButtonTextActive,
              ]}
            >
              30d
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Event List */}
      {filteredEvents.length > 0 ? (
        <ScrollView
          style={styles.eventList}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {groupedEvents.map((group, groupIndex) => (
            <View key={group.date.toISOString()} style={styles.dateGroup}>
              {/* Date Badge */}
              <View style={styles.dateBadge}>
                <Text style={styles.dateBadgeText}>
                  {formatDateBadge(group.date)}
                </Text>
              </View>

              {/* Events for this date */}
              {group.events.map((event, eventIndex) => (
                <TouchableOpacity
                  key={event.id}
                  style={styles.eventCard}
                  onPress={() => onEventPress?.(event)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.eventColorBar,
                      { backgroundColor: getEventColor(event) },
                    ]}
                  />
                  <View style={styles.eventContent}>
                    <Text style={styles.eventTitle} numberOfLines={1}>
                      {getEventTitle(event)}
                    </Text>
                    {getCategoryName(event) && (
                      <Text style={styles.eventCategory} numberOfLines={1}>
                        {getCategoryName(event)}
                      </Text>
                    )}
                    <View style={styles.eventTimeRow}>
                      <Ionicons name="time-outline" size={12} color="#9CA3AF" />
                      <Text style={styles.eventTime}>
                        {formatTime(event.event.start_time)}
                        {event.event.end_time &&
                          ` - ${formatTime(event.event.end_time)}`}
                      </Text>
                    </View>
                  </View>
                  {event.status === 'confirmed' && (
                    <View style={styles.confirmedBadge}>
                      <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="calendar-outline" size={40} color="#4B5563" />
          <Text style={styles.emptyStateTitle}>No upcoming events</Text>
          <Text style={styles.emptyStateSubtitle}>
            {filterRange === '7d'
              ? 'No events scheduled in the next 7 days'
              : 'No events scheduled in the next 30 days'}
          </Text>
        </View>
      )}

      {/* Footer */}
      {filteredEvents.length > 0 && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}{' '}
            in next {filterRange === '7d' ? '7 days' : '30 days'}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  filterToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 2,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  filterButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  filterButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
  },
  eventList: {
    flex: 1,
    marginBottom: 8,
  },
  dateGroup: {
    marginBottom: 12,
  },
  dateBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  dateBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#A78BFA',
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
  },
  eventColorBar: {
    width: 4,
    height: '100%',
    minHeight: 56,
  },
  eventContent: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  eventCategory: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  eventTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  eventTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  confirmedBadge: {
    paddingRight: 12,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 12,
  },
  emptyStateSubtitle: {
    fontSize: 13,
    color: '#4B5563',
    marginTop: 4,
    textAlign: 'center',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 8,
  },
  footerText: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
});
