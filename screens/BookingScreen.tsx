import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import {
  getLinkedAthletes,
  getAthleteId,
  getBookableEvents,
  getCategories,
  checkEligibility,
  getPaymentMethods,
  createBooking,
  cancelBooking,
} from '../lib/bookingApi';
import {
  BookableEvent,
  LinkedAthlete,
  PaymentMethod,
  EligibilityData,
  SchedulingCategory,
} from '../types/booking';
import ParentAthleteSelector from '../components/booking/ParentAthleteSelector';
import EventRow from '../components/booking/EventRow';
import ClassDetailsSheet from '../components/booking/ClassDetailsSheet';
import CancelConfirmationSheet from '../components/booking/CancelConfirmationSheet';

type RootStackParamList = {
  Booking: { athleteId?: string };
  Dashboard: undefined;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function BookingScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Booking'>>();

  // Auth & account type
  const [userId, setUserId] = useState<string | null>(null);
  const [isParentAccount, setIsParentAccount] = useState(false);
  const [linkedAthletes, setLinkedAthletes] = useState<LinkedAthlete[]>([]);
  const [loadingAthletes, setLoadingAthletes] = useState(true);

  // Selected athlete
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(
    route.params?.athleteId || null
  );
  const [showAthleteSelector, setShowAthleteSelector] = useState(false);

  // Calendar state
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [weekDates, setWeekDates] = useState<Date[]>([]);

  // Events
  const [events, setEvents] = useState<BookableEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [categories, setCategories] = useState<SchedulingCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // View mode: 'day' or 'list'
  const [viewMode, setViewMode] = useState<'day' | 'list'>('day');
  const [listEvents, setListEvents] = useState<BookableEvent[]>([]);
  const [loadingListEvents, setLoadingListEvents] = useState(false);

  // Booking flow
  const [selectedEvent, setSelectedEvent] = useState<BookableEvent | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityData | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadingEligibility, setLoadingEligibility] = useState(false);
  const [bookingInProgress, setBookingInProgress] = useState(false);

  // Cancel flow
  const [cancelEvent, setCancelEvent] = useState<BookableEvent | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Track app state for refreshing after Stripe checkout
  const appState = useRef(AppState.currentState);

  // Initialize
  useEffect(() => {
    initializeBooking();
  }, []);

  // Refresh events when app comes back to foreground (after Stripe Checkout)
  // This will be used when paid drop-in payments are implemented
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App came back to foreground - refresh events in case user completed payment
        if (selectedAthleteId) {
          if (viewMode === 'day') {
            fetchEvents();
          } else {
            fetchListEvents();
          }
        }
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [selectedAthleteId, viewMode]);

  // Generate week dates when selected date changes
  useEffect(() => {
    generateWeekDates(selectedDate);
  }, [selectedDate]);

  // Fetch events when athlete or date changes
  useEffect(() => {
    if (selectedAthleteId) {
      if (viewMode === 'day') {
        fetchEvents();
      }
    }
  }, [selectedAthleteId, selectedDate, viewMode]);

  // Fetch list events when in list mode or week changes
  useEffect(() => {
    if (selectedAthleteId && viewMode === 'list') {
      fetchListEvents();
    }
  }, [selectedAthleteId, weekDates, viewMode]);

  const initializeBooking = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Dashboard');
        return;
      }

      setUserId(user.id);

      // Check account type
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', user.id)
        .single();

      const isParent = profile?.account_type === 'parent';
      setIsParentAccount(isParent);

      if (isParent) {
        // Load linked athletes
        const athletes = await getLinkedAthletes(user.id);
        setLinkedAthletes(athletes);
        setLoadingAthletes(false);

        if (athletes.length === 1) {
          // Auto-select if only one athlete
          setSelectedAthleteId(athletes[0].athleteId);
        } else if (athletes.length > 1 && !route.params?.athleteId) {
          // Show selector if multiple athletes
          setShowAthleteSelector(true);
        }
      } else {
        // Get athlete ID for regular user
        const athleteId = await getAthleteId(user.id);
        if (athleteId) {
          setSelectedAthleteId(athleteId);

          // Load categories
          const { data: athlete } = await supabase
            .from('athletes')
            .select('org_id')
            .eq('id', athleteId)
            .single();

          if (athlete?.org_id) {
            const cats = await getCategories(athlete.org_id);
            setCategories(cats);
          }
        }
        setLoadingAthletes(false);
      }
    } catch (error) {
      console.error('Error initializing booking:', error);
      setLoadingAthletes(false);
    }
  };

  const generateWeekDates = (centerDate: Date) => {
    const dates: Date[] = [];
    const startOfWeek = new Date(centerDate);
    startOfWeek.setDate(centerDate.getDate() - centerDate.getDay());

    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      dates.push(date);
    }

    setWeekDates(dates);
  };

  const fetchEvents = async () => {
    if (!selectedAthleteId) return;

    setLoadingEvents(true);
    try {
      const eventsData = await getBookableEvents(selectedAthleteId, selectedDate);
      setEvents(eventsData);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoadingEvents(false);
    }
  };

  const fetchListEvents = async () => {
    if (!selectedAthleteId || weekDates.length === 0) return;

    setLoadingListEvents(true);
    try {
      // Fetch events for all days in the week
      const allEvents: BookableEvent[] = [];

      for (const date of weekDates) {
        const dayEvents = await getBookableEvents(selectedAthleteId, date);
        allEvents.push(...dayEvents);
      }

      // Sort by date/time
      allEvents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      setListEvents(allEvents);
    } catch (error) {
      console.error('Error fetching list events:', error);
    } finally {
      setLoadingListEvents(false);
    }
  };

  const handleAthleteSelect = async (athlete: LinkedAthlete) => {
    setSelectedAthleteId(athlete.athleteId);
    setShowAthleteSelector(false);

    // Load categories for this athlete's org
    const { data: athleteData } = await supabase
      .from('athletes')
      .select('org_id')
      .eq('id', athlete.athleteId)
      .single();

    if (athleteData?.org_id) {
      const cats = await getCategories(athleteData.org_id);
      setCategories(cats);
    }
  };

  const handleEventPress = async (event: BookableEvent) => {
    if (!selectedAthleteId) return;

    setSelectedEvent(event);
    setLoadingEligibility(true);
    setEligibility(null);
    setPaymentMethods([]);

    try {
      const [eligibilityData, methods] = await Promise.all([
        checkEligibility(selectedAthleteId, event.id),
        getPaymentMethods(selectedAthleteId, event.id),
      ]);

      setEligibility(eligibilityData);
      setPaymentMethods(methods);
    } catch (error) {
      console.error('Error checking eligibility:', error);
    } finally {
      setLoadingEligibility(false);
    }
  };

  const handleReserve = async (paymentMethod: PaymentMethod) => {
    if (!selectedAthleteId || !selectedEvent) return;

    setBookingInProgress(true);

    try {
      const result = await createBooking(
        selectedAthleteId,
        selectedEvent.id,
        paymentMethod.type,
        paymentMethod.id
      );

      if (result.success) {
        Alert.alert('Success', 'Class reserved successfully!');
        setSelectedEvent(null);
        fetchEvents(); // Refresh events
      } else {
        Alert.alert('Error', result.error || 'Failed to reserve class');
      }
    } catch (error) {
      console.error('Error booking:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setBookingInProgress(false);
    }
  };

  const handleCancelPress = (event: BookableEvent) => {
    setCancelEvent(event);
  };

  const handleConfirmCancel = async () => {
    if (!selectedAthleteId || !cancelEvent) return;

    setCancelling(true);

    try {
      const result = await cancelBooking(selectedAthleteId, cancelEvent.id);

      if (result.success) {
        Alert.alert('Success', 'Reservation cancelled');
        setCancelEvent(null);
        fetchEvents(); // Refresh events
      } else {
        Alert.alert('Error', result.error || 'Failed to cancel reservation');
      }
    } catch (error) {
      console.error('Error cancelling:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setCancelling(false);
    }
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate);
    newDate.setDate(selectedDate.getDate() + (direction === 'next' ? 7 : -7));
    setSelectedDate(newDate);
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isSameDay = (date1: Date, date2: Date) => {
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    );
  };

  const getMonthYearDisplay = () => {
    return selectedDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  };

  // Get current events based on view mode
  const currentEvents = viewMode === 'day' ? events : listEvents;

  // Dynamic categories - only show categories that have events
  const availableCategories = categories.filter((cat) =>
    currentEvents.some((e) => e.category === cat.name)
  );

  // Filter events by selected category
  const filteredEvents =
    selectedCategory === 'all'
      ? currentEvents
      : currentEvents.filter((e) => e.category === selectedCategory);

  // Group events by date for list view
  const groupedEvents: Record<string, BookableEvent[]> = {};
  if (viewMode === 'list') {
    filteredEvents.forEach((event) => {
      const dateKey = event.startTime.toDateString();
      if (!groupedEvents[dateKey]) {
        groupedEvents[dateKey] = [];
      }
      groupedEvents[dateKey].push(event);
    });
  }

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    }
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  };

  // Loading state
  if (loadingAthletes) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Book a Class</Text>
        {/* View Mode Toggle */}
        <TouchableOpacity
          style={styles.viewModeToggle}
          onPress={() => {
            setSelectedCategory('all'); // Reset filter when switching modes
            setViewMode(viewMode === 'day' ? 'list' : 'day');
          }}
        >
          <LinearGradient
            colors={['#9BDDFF', '#7BC5F0']}
            style={styles.viewModeToggleInner}
          >
            <Text style={styles.viewModeToggleText}>
              {viewMode === 'day' ? 'List' : 'Day'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Month Navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity
          style={styles.navArrow}
          onPress={() => navigateWeek('prev')}
        >
          <Text style={styles.navArrowText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthText}>{getMonthYearDisplay()}</Text>
        <TouchableOpacity
          style={styles.navArrow}
          onPress={() => navigateWeek('next')}
        >
          <Text style={styles.navArrowText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Week Date Picker - Only show in day mode */}
      {viewMode === 'day' ? (
        <View style={styles.weekPicker}>
          {weekDates.map((date, index) => {
            const isSelected = isSameDay(date, selectedDate);
            const isTodayDate = isToday(date);

            return (
              <TouchableOpacity
                key={index}
                style={styles.dateButton}
                onPress={() => setSelectedDate(date)}
                activeOpacity={0.7}
              >
                {isSelected ? (
                  <LinearGradient
                    colors={['#9BDDFF', '#7BC5F0']}
                    style={styles.dateButtonSelected}
                  >
                    <Text style={styles.dayNameSelected}>{DAY_NAMES[index]}</Text>
                    <Text style={styles.dayNumberSelected}>{date.getDate()}</Text>
                  </LinearGradient>
                ) : (
                  <View style={styles.dateButtonInner}>
                    <Text style={styles.dayName}>{DAY_NAMES[index]}</Text>
                    <Text style={styles.dayNumber}>{date.getDate()}</Text>
                    {isTodayDate && <View style={styles.todayDot} />}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <View style={styles.listModeIndicator}>
          <Text style={styles.listModeText}>
            Showing all classes from {weekDates[0]?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} -{' '}
            {weekDates[6]?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      )}

      {/* Category Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryScroll}
        contentContainerStyle={styles.categoryContent}
      >
        <TouchableOpacity
          style={[
            styles.categoryPill,
            selectedCategory === 'all' && styles.categoryPillSelected,
          ]}
          onPress={() => setSelectedCategory('all')}
        >
          {selectedCategory === 'all' ? (
            <LinearGradient
              colors={['#9BDDFF', '#7BC5F0']}
              style={styles.categoryPillGradient}
            >
              <Text style={styles.categoryTextSelected}>All Classes</Text>
            </LinearGradient>
          ) : (
            <Text style={styles.categoryText}>All Classes</Text>
          )}
        </TouchableOpacity>

        {availableCategories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[
              styles.categoryPill,
              selectedCategory === cat.name && styles.categoryPillSelected,
            ]}
            onPress={() => setSelectedCategory(cat.name)}
          >
            {selectedCategory === cat.name ? (
              <LinearGradient
                colors={['#9BDDFF', '#7BC5F0']}
                style={styles.categoryPillGradient}
              >
                <Text style={styles.categoryTextSelected}>{cat.name}</Text>
              </LinearGradient>
            ) : (
              <Text style={styles.categoryText}>{cat.name}</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Events List */}
      <ScrollView
        style={styles.eventsList}
        contentContainerStyle={styles.eventsContent}
        showsVerticalScrollIndicator={false}
      >
        {(viewMode === 'day' ? loadingEvents : loadingListEvents) ? (
          <View style={styles.eventsLoading}>
            <ActivityIndicator size="small" color="#9BDDFF" />
          </View>
        ) : filteredEvents.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>
              {viewMode === 'day'
                ? 'No classes available for this date'
                : 'No classes available this week'}
            </Text>
          </View>
        ) : viewMode === 'day' ? (
          // Day View - Simple list
          filteredEvents.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              onPress={() => handleEventPress(event)}
              onCancelPress={() => handleCancelPress(event)}
              bookingInProgress={bookingInProgress}
            />
          ))
        ) : (
          // List View - Grouped by date
          Object.keys(groupedEvents).map((dateKey) => (
            <View key={dateKey}>
              <View style={styles.dateHeader}>
                <Text style={styles.dateHeaderText}>{formatDateHeader(dateKey)}</Text>
                <Text style={styles.dateHeaderCount}>
                  {groupedEvents[dateKey].length} class{groupedEvents[dateKey].length !== 1 ? 'es' : ''}
                </Text>
              </View>
              {groupedEvents[dateKey].map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  onPress={() => handleEventPress(event)}
                  onCancelPress={() => handleCancelPress(event)}
                  bookingInProgress={bookingInProgress}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {/* Parent Athlete Selector */}
      <ParentAthleteSelector
        visible={showAthleteSelector}
        athletes={linkedAthletes}
        loading={loadingAthletes}
        onSelect={handleAthleteSelect}
        onClose={() => {
          if (linkedAthletes.length > 0) {
            setShowAthleteSelector(false);
          } else {
            navigation.goBack();
          }
        }}
      />

      {/* Class Details Sheet */}
      <ClassDetailsSheet
        visible={!!selectedEvent && !selectedEvent.isBooked}
        event={selectedEvent}
        eligibility={eligibility}
        paymentMethods={paymentMethods}
        loading={loadingEligibility}
        bookingInProgress={bookingInProgress}
        onClose={() => setSelectedEvent(null)}
        onReserve={handleReserve}
        onViewMemberships={() => {
          setSelectedEvent(null);
          // Could navigate to a memberships screen
          Alert.alert('Info', 'Memberships & Packages coming soon');
        }}
      />

      {/* Cancel Confirmation Sheet */}
      <CancelConfirmationSheet
        visible={!!cancelEvent}
        event={cancelEvent}
        cancelling={cancelling}
        onConfirm={handleConfirmCancel}
        onClose={() => setCancelEvent(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 28,
    color: '#9BDDFF',
    fontWeight: '300',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerPlaceholder: {
    width: 40,
  },
  viewModeToggle: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  viewModeToggleInner: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  viewModeToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 24,
  },
  navArrow: {
    width: 32,
    height: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navArrowText: {
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: '300',
  },
  monthText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  weekPicker: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginBottom: 16,
  },
  dateButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  dateButtonInner: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    minWidth: 44,
  },
  dateButtonSelected: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    minWidth: 44,
    shadowColor: '#9BDDFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  dayName: {
    fontSize: 10,
    fontWeight: '500',
    color: '#9CA3AF',
    marginBottom: 4,
  },
  dayNameSelected: {
    fontSize: 10,
    fontWeight: '500',
    color: '#0A0A0A',
    marginBottom: 4,
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dayNumberSelected: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#9BDDFF',
    marginTop: 4,
  },
  categoryScroll: {
    flexGrow: 0,
    marginBottom: 16,
  },
  categoryContent: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 8,
    alignItems: 'center',
  },
  categoryPill: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryPillSelected: {
    borderWidth: 0,
  },
  categoryPillGradient: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryText: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
    textAlign: 'center',
  },
  categoryTextSelected: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0A0A0A',
    textAlign: 'center',
  },
  eventsList: {
    flex: 1,
  },
  eventsContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  eventsLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyState: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  dateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(155, 221, 255, 0.2)',
  },
  dateHeaderText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9BDDFF',
  },
  dateHeaderCount: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  listModeIndicator: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  listModeText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(155, 221, 255, 0.8)',
  },
});
