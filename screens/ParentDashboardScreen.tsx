import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Animated,
  Modal,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useAthlete } from '../contexts/AthleteContext';
import { useAuth } from '../contexts/AuthContext';
import AthletePickerModal from '../components/AthletePickerModal';
import FABMenu from '../components/FABMenu';
import UpcomingEventsCard from '../components/dashboard/UpcomingEventsCard';
import { cancelBooking } from '../lib/bookingApi';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 16;
const CARD_HEIGHT = SCREEN_HEIGHT * 0.34;
const HEADER_HEIGHT = SCREEN_HEIGHT * 0.12;
const CALENDAR_DAY_SIZE = Math.floor((SCREEN_WIDTH - 32 - 48) / 7);

interface WorkoutInstance {
  id: string;
  athlete_id: string;
  athlete_name: string;
  athlete_color: string;
  scheduled_date: string;
  status: string;
  completed_at: string | null;
  workouts: {
    name: string;
    category: string;
    estimated_duration_minutes: number | null;
    notes: string | null;
    routines: Array<{
      id: string;
      name: string;
      scheme: string;
      order_index: number;
      notes: string | null;
      text_info: string | null;
      routine_exercises: Array<{
        id: string;
        order_index: number;
        sets: number;
        metric_targets: any;
        selected_variation?: string | null;
        exercises: {
          id: string;
          name: string;
          is_placeholder?: boolean;
        };
      }>;
    }>;
  };
}

interface Booking {
  id: string;
  athlete_id: string;
  athlete_name: string;
  athlete_color: string;
  start_time: string;
  end_time?: string;
  event_name: string;
  event_id: string;
  category_name?: string;
  category_color?: string;
}

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

const CATEGORY_COLORS: { [key: string]: { bg: string; text: string; dot: string; button: string; label: string } } = {
  hitting: {
    bg: '#7f1d1d',
    text: '#fca5a5',
    dot: '#ef4444',
    button: '#dc2626',
    label: 'Hitting',
  },
  throwing: {
    bg: '#1e3a8a',
    text: '#93c5fd',
    dot: '#3b82f6',
    button: '#2563eb',
    label: 'Throwing',
  },
  strength_conditioning: {
    bg: '#0a1f0d',
    text: '#FFFFFF',
    dot: '#00ff55',
    button: '#10b981',
    label: 'Strength & Conditioning',
  },
};

export default function ParentDashboardScreen({ navigation }: any) {
  const { setAppReady } = useAuth();
  const {
    parentName,
    linkedAthletes,
    selectedAthleteId,
    setSelectedAthlete,
    loading: contextLoading,
  } = useAthlete();

  const [workoutInstances, setWorkoutInstances] = useState<WorkoutInstance[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'day'>('month');

  // Carousel state
  const [snapshotIndex, setSnapshotIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  // FAB menu state
  const [fabOpen, setFabOpen] = useState(false);

  // Settings dropdown state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Expanded workout card state
  const [expandedWorkoutId, setExpandedWorkoutId] = useState<string | null>(null);

  // Athlete picker state
  const [showAthletePicker, setShowAthletePicker] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  // Data presence flags for FAB visibility
  const [hasHittingData, setHasHittingData] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasArmCareData, setHasArmCareData] = useState(false);
  const [hasForceData, setHasForceData] = useState(false);

  // Cancel booking modal state
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Use JSON stringified athlete IDs as dependency to properly trigger when athletes load/change
  const athleteIdsKey = linkedAthletes.map(a => a.athlete_id).join(',');


  useFocusEffect(
    useCallback(() => {
      console.log('[ParentDashboard] useFocusEffect triggered, linkedAthletes:', linkedAthletes.map(a => `${a.first_name} (${a.athlete_id})`));
      if (linkedAthletes.length > 0) {
        loadDashboard(linkedAthletes);
      } else if (!contextLoading) {
        setLoading(false);
      }
    }, [athleteIdsKey, contextLoading, linkedAthletes])
  );

  async function loadDashboard(athletes = linkedAthletes) {
    // Set a timeout to prevent infinite loading - force stop after 10 seconds
    const timeoutId = setTimeout(() => {
      console.warn('Parent dashboard load timed out after 10 seconds');
      setLoading(false);
      setRefreshing(false);
    }, 10000);

    try {
      const athleteIds = athletes.map(a => a.athlete_id);
      console.log('[ParentDashboard] loadDashboard called with athleteIds:', athleteIds);

      if (athleteIds.length === 0) {
        console.log('[ParentDashboard] No athlete IDs, returning early');
        clearTimeout(timeoutId);
        setLoading(false);
        return;
      }

      // Load workout instances for ALL linked athletes
      const { data: workoutsData, error: workoutsError } = await supabase
        .from('workout_instances')
        .select(`
          id,
          athlete_id,
          scheduled_date,
          status,
          completed_at,
          workouts (
            name,
            category,
            estimated_duration_minutes,
            notes,
            routines (
              id,
              name,
              scheme,
              order_index,
              notes,
              text_info,
              routine_exercises (
                id,
                order_index,
                sets,
                metric_targets,
                selected_variation,
                exercises (
                  id,
                  name,
                  is_placeholder
                )
              )
            )
          )
        `)
        .in('athlete_id', athleteIds)
        .order('scheduled_date');

      // Map workouts with athlete info
      const workoutsWithAthleteInfo = (workoutsData || []).map((w: any) => {
        const athlete = athletes.find(a => a.athlete_id === w.athlete_id);
        return {
          ...w,
          athlete_name: athlete ? `${athlete.first_name} ${athlete.last_name}` : 'Unknown',
          athlete_color: athlete?.color || '#9BDDFF',
        };
      });

      setWorkoutInstances(workoutsWithAthleteInfo);

      // Load bookings for ALL linked athletes - only active ones (booked/confirmed/waitlisted)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('scheduling_bookings')
        .select(`
          id,
          athlete_id,
          event:scheduling_events (
            id,
            start_time,
            end_time,
            title,
            scheduling_templates (
              name,
              scheduling_categories (
                name,
                color
              )
            )
          )
        `)
        .in('athlete_id', athleteIds)
        .in('status', ['booked', 'confirmed', 'waitlisted']);

      // Map bookings with athlete info
      const bookingsWithAthleteInfo = (bookingsData || []).map((b: any) => {
        const athlete = athletes.find(a => a.athlete_id === b.athlete_id);
        const rawEvent = b.event;
        const event = Array.isArray(rawEvent) ? rawEvent[0] : rawEvent;
        const rawTemplate = event?.scheduling_templates;
        const template = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;
        const rawCategory = template?.scheduling_categories;
        const category = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;
        const eventName = event?.title || template?.name || 'Session';
        return {
          id: b.id,
          athlete_id: b.athlete_id,
          athlete_name: athlete ? `${athlete.first_name} ${athlete.last_name}` : 'Unknown',
          athlete_color: athlete?.color || '#9BDDFF',
          start_time: event?.start_time,
          end_time: event?.end_time,
          event_name: eventName,
          event_id: event?.id,
          category_name: category?.name,
          category_color: category?.color,
        };
      }).filter((b: any) => b.event_id && b.start_time);

      setBookings(bookingsWithAthleteInfo);

      // Fetch upcoming events for the UpcomingEventsCard (need full event details)
      console.log('[ParentDashboard] Fetching upcoming events for athleteIds:', athleteIds);
      const { data: upcomingEventsData, error: upcomingEventsError } = await supabase
        .from('scheduling_bookings')
        .select(`
          id,
          status,
          event:scheduling_events (
            id,
            start_time,
            end_time,
            title,
            scheduling_templates (
              name,
              scheduling_categories (
                name,
                color
              )
            )
          )
        `)
        .in('athlete_id', athleteIds)
        .in('status', ['booked', 'confirmed', 'waitlisted']);

      console.log('[ParentDashboard] Upcoming events raw data:', JSON.stringify(upcomingEventsData, null, 2));
      if (upcomingEventsError) {
        console.error('[ParentDashboard] Upcoming events error:', upcomingEventsError);
      }

      // Transform to match UpcomingEvent interface
      // Note: Supabase may return event as array or object depending on relationship
      const formattedEvents: UpcomingEvent[] = [];
      for (const e of upcomingEventsData || []) {
        // Handle event being an array (Supabase FK relationship)
        const rawEvent = Array.isArray(e.event) ? e.event[0] : e.event;
        if (!rawEvent?.start_time) continue;

        // Handle scheduling_templates being an array
        const rawTemplate = rawEvent.scheduling_templates;
        const template = Array.isArray(rawTemplate) ? rawTemplate[0] : rawTemplate;

        // Handle scheduling_categories being an array
        let formattedTemplate: UpcomingEvent['event']['scheduling_templates'] = undefined;
        if (template) {
          const rawCategory = template.scheduling_categories;
          const category = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;
          formattedTemplate = {
            name: template.name,
            scheduling_categories: category,
          };
        }

        formattedEvents.push({
          id: e.id,
          status: e.status,
          event: {
            id: rawEvent.id,
            start_time: rawEvent.start_time,
            end_time: rawEvent.end_time,
            title: rawEvent.title,
            scheduling_templates: formattedTemplate,
          },
        });
      }

      console.log('[ParentDashboard] Formatted events count:', formattedEvents.length);
      console.log('[ParentDashboard] Formatted events:', JSON.stringify(formattedEvents, null, 2));
      setUpcomingEvents(formattedEvents);

      // Fetch data presence for FAB (check what data types exist for linked athletes)
      await fetchDataPresence(athleteIds);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setRefreshing(false);
      setAppReady(true);
    }
  }

  // Fetch what data types exist for the linked athletes (for FAB visibility)
  async function fetchDataPresence(athleteIds: string[]) {
    try {
      // Check for hitting data (Blast or HitTrax)
      const { count: blastCount } = await supabase
        .from('blast_swings')
        .select('id', { count: 'exact', head: true })
        .in('athlete_id', athleteIds);

      const { count: hittraxCount } = await supabase
        .from('hittrax_sessions')
        .select('id', { count: 'exact', head: true })
        .in('athlete_id', athleteIds);

      setHasHittingData((blastCount || 0) > 0 || (hittraxCount || 0) > 0);

      // Check for pitching data
      const { count: pitchingCount } = await supabase
        .from('trackman_pitch_data')
        .select('id', { count: 'exact', head: true })
        .in('athlete_id', athleteIds);

      setHasPitchingData((pitchingCount || 0) > 0);

      // Check for arm care data
      const { count: armCareCount } = await supabase
        .from('armcare_sessions')
        .select('id', { count: 'exact', head: true })
        .in('athlete_id', athleteIds);

      setHasArmCareData((armCareCount || 0) > 0);

      // Check for force profile data
      const { count: forceCount } = await supabase
        .from('force_plate_percentiles')
        .select('id', { count: 'exact', head: true })
        .in('athlete_id', athleteIds);

      setHasForceData((forceCount || 0) > 0);
    } catch (error) {
      console.error('Error fetching data presence:', error);
    }
  }

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard(linkedAthletes);
  };

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour >= 4 && hour < 12) return 'Good morning';
    return 'Welcome back';
  }

  // Get parent's first name
  const firstName = parentName.split(' ')[0] || 'Parent';

  function getDaysInMonth(date: Date): (Date | null)[] {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: (Date | null)[] = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  }

  function getWorkoutsForDate(date: Date): WorkoutInstance[] {
    const dateStr = date.toISOString().split('T')[0];
    return workoutInstances.filter(w => w.scheduled_date === dateStr);
  }

  function getBookingsForDate(date: Date): Booking[] {
    // Compare using local dates, not UTC
    const targetYear = date.getFullYear();
    const targetMonth = date.getMonth();
    const targetDay = date.getDate();

    return bookings
      .filter(b => {
        if (!b.start_time) return false;
        const eventDate = new Date(b.start_time);
        return eventDate.getFullYear() === targetYear &&
               eventDate.getMonth() === targetMonth &&
               eventDate.getDate() === targetDay;
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }

  // Check if a booking has already passed (start time is in the past)
  function isBookingPassed(booking: Booking): boolean {
    const bookingDate = new Date(booking.start_time);
    return bookingDate < new Date();
  }

  function handleDayClick(date: Date) {
    setSelectedDate(date);
    setViewMode('day');
  }

  function handleBackToMonth() {
    setViewMode('month');
    setSelectedDate(null);
    setExpandedWorkoutId(null);
  }

  function getWeekDates(centerDate: Date): Date[] {
    const dates: Date[] = [];
    const dayOfWeek = centerDate.getDay();
    const sunday = new Date(centerDate);
    sunday.setDate(centerDate.getDate() - dayOfWeek);

    for (let i = 0; i < 7; i++) {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + i);
      dates.push(date);
    }

    return dates;
  }

  function handlePrevDay() {
    if (!selectedDate) return;
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() - 7);
    setSelectedDate(newDate);
  }

  function handleNextDay() {
    if (!selectedDate) return;
    const newDate = new Date(selectedDate);
    newDate.setDate(newDate.getDate() + 7);
    setSelectedDate(newDate);
  }

  function toggleWorkoutExpanded(workoutId: string) {
    setExpandedWorkoutId(expandedWorkoutId === workoutId ? null : workoutId);
  }

  function handlePrevMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  }

  function handleNextMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    navigation.replace('Login');
  }

  // FAB navigation with athlete picker logic
  function handleFabNavigate(screen: string) {
    setFabOpen(false);
    if (linkedAthletes.length === 1) {
      const athlete = linkedAthletes[0];
      setSelectedAthlete(athlete.athlete_id);
      // Pass both athleteId (athletes table) and userId (profiles table) for screens that need either
      navigation.navigate(screen, { athleteId: athlete.athlete_id, userId: athlete.id });
    } else if (linkedAthletes.length > 1) {
      setPendingNavigation(screen);
      setShowAthletePicker(true);
    }
  }

  function handleAthleteSelected(athleteId: string) {
    setShowAthletePicker(false);
    setSelectedAthlete(athleteId);
    if (pendingNavigation) {
      // Find the full athlete to get both IDs
      const athlete = linkedAthletes.find(a => a.athlete_id === athleteId);
      if (athlete) {
        navigation.navigate(pendingNavigation, { athleteId: athlete.athlete_id, userId: athlete.id });
      }
      setPendingNavigation(null);
    }
  }

  // Cancel booking handler
  async function handleCancelBooking() {
    if (!bookingToCancel) return;

    setCancelling(true);
    try {
      const result = await cancelBooking(
        bookingToCancel.athlete_id,
        bookingToCancel.event_id,
        'Cancelled by parent via mobile app'
      );

      if (result.success) {
        // Show success message
        let message = 'Your booking has been cancelled.';
        if (result.refunded && result.refundAmount) {
          message += ` A refund of $${(result.refundAmount / 100).toFixed(2)} has been processed.`;
        } else if (result.refunded) {
          message += ' Your session credit has been refunded.';
        }
        Alert.alert('Booking Cancelled', message);

        // Refresh the dashboard to update the bookings list
        await loadDashboard(linkedAthletes);
      } else {
        Alert.alert('Error', result.error || 'Failed to cancel booking. Please try again.');
      }
    } catch (error) {
      console.error('Error cancelling booking:', error);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setCancelling(false);
      setCancelModalVisible(false);
      setBookingToCancel(null);
    }
  }

  function openCancelModal(booking: Booking) {
    setBookingToCancel(booking);
    setCancelModalVisible(true);
  }

  if (loading || contextLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9BDDFF" />
        <Text style={styles.loadingText}>Loading your dashboard...</Text>
      </View>
    );
  }

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const days = getDaysInMonth(currentDate);
  const selectedDateWorkouts = selectedDate ? getWorkoutsForDate(selectedDate) : [];
  const selectedDateBookings = selectedDate ? getBookingsForDate(selectedDate) : [];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{getGreeting()}, {firstName}</Text>
          <Text style={styles.date}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setSettingsOpen(true)} style={styles.settingsButton}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Athlete Legend */}
      {linkedAthletes.length > 0 && (
        <View style={styles.athleteLegend}>
          {linkedAthletes.map(athlete => (
            <View key={athlete.id} style={styles.athleteLegendItem}>
              <View style={[styles.athleteLegendDot, { backgroundColor: athlete.color }]} />
              <Text style={styles.athleteLegendName}>{athlete.first_name}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Settings Dropdown Modal */}
      <Modal
        visible={settingsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <Pressable
          style={styles.settingsOverlay}
          onPress={() => setSettingsOpen(false)}
        >
          <Pressable style={styles.settingsDropdown} onPress={(e) => e.stopPropagation()}>
            {/* Header */}
            <View style={styles.settingsDropdownHeader}>
              <Text style={styles.settingsDropdownTitle}>Settings</Text>
              <Text style={styles.settingsDropdownSubtitle}>Manage your account and preferences</Text>
            </View>

            {/* Profile */}
            <TouchableOpacity
              style={styles.settingsMenuItem}
              onPress={() => {
                setSettingsOpen(false);
                navigation.navigate('Profile');
              }}
            >
              <Ionicons name="person-outline" size={20} color="#9CA3AF" />
              <View style={styles.settingsMenuItemContent}>
                <Text style={styles.settingsMenuLabel}>Profile</Text>
                <Text style={styles.settingsMenuDescription}>View and edit your profile</Text>
              </View>
            </TouchableOpacity>

            {/* Memberships & Packages */}
            <TouchableOpacity
              style={styles.settingsMenuItem}
              onPress={() => {
                setSettingsOpen(false);
                // For parent accounts, navigate without athleteId - they can select an athlete
                navigation.navigate('MembershipsPackages', {});
              }}
            >
              <Ionicons name="card-outline" size={20} color="#9CA3AF" />
              <View style={styles.settingsMenuItemContent}>
                <Text style={styles.settingsMenuLabel}>Memberships & Packages</Text>
                <Text style={styles.settingsMenuDescription}>Manage subscriptions and credits</Text>
              </View>
            </TouchableOpacity>

            {/* Billing & Payments */}
            <TouchableOpacity
              style={styles.settingsMenuItem}
              onPress={() => {
                setSettingsOpen(false);
                navigation.navigate('Billing');
              }}
            >
              <Ionicons name="wallet-outline" size={20} color="#9CA3AF" />
              <View style={styles.settingsMenuItemContent}>
                <Text style={styles.settingsMenuLabel}>Billing & Payments</Text>
                <Text style={styles.settingsMenuDescription}>Payment methods and transactions</Text>
              </View>
            </TouchableOpacity>

            {/* Notifications */}
            <TouchableOpacity
              style={styles.settingsMenuItem}
              onPress={() => {
                setSettingsOpen(false);
                navigation.navigate('NotificationSettings');
              }}
            >
              <Ionicons name="notifications-outline" size={20} color="#9CA3AF" />
              <View style={styles.settingsMenuItemContent}>
                <Text style={styles.settingsMenuLabel}>Notifications</Text>
                <Text style={styles.settingsMenuDescription}>Configure notification preferences</Text>
              </View>
            </TouchableOpacity>

            <View style={styles.settingsDivider} />

            {/* Sign Out */}
            <TouchableOpacity
              style={styles.settingsMenuItem}
              onPress={() => {
                setSettingsOpen(false);
                handleLogout();
              }}
            >
              <Ionicons name="log-out-outline" size={20} color="#EF4444" />
              <View style={styles.settingsMenuItemContent}>
                <Text style={[styles.settingsMenuLabel, { color: '#EF4444' }]}>Sign Out</Text>
                <Text style={styles.settingsMenuDescription}>Log out of your account</Text>
              </View>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {viewMode === 'month' ? (
        <ScrollView
          style={styles.scrollView}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9BDDFF" />
          }
        >
          {/* Upcoming Events Carousel - ABOVE calendar like athlete dashboard */}
          {upcomingEvents.length > 0 && (
            <View style={styles.snapshotContainer}>
              <View style={styles.carouselWrapper}>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onScroll={Animated.event(
                    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                    { useNativeDriver: false }
                  )}
                  onMomentumScrollEnd={(event) => {
                    const offsetX = event.nativeEvent.contentOffset.x;
                    const index = Math.round(offsetX / CARD_WIDTH);
                    setSnapshotIndex(index);
                  }}
                  scrollEventThrottle={16}
                >
                  <View style={[styles.snapshotCard, { width: CARD_WIDTH }]}>
                    <LinearGradient
                      colors={['rgba(255,255,255,0.1)', 'transparent', 'rgba(0,0,0,0.3)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.cardGloss}
                    />
                    <UpcomingEventsCard
                      events={upcomingEvents}
                      isActive={snapshotIndex === 0}
                      onEventPress={() => navigation.navigate('Booking')}
                    />
                  </View>
                </ScrollView>
              </View>
            </View>
          )}

          {/* Calendar */}
          <View style={styles.calendarContainer}>
            <View style={styles.monthHeader}>
              <TouchableOpacity onPress={handlePrevMonth} style={styles.monthButton}>
                <Text style={styles.monthButtonText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.monthTitle}>{monthName}</Text>
              <TouchableOpacity onPress={handleNextMonth} style={styles.monthButton}>
                <Text style={styles.monthButtonText}>›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dayHeaders}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <Text key={day} style={styles.dayHeader}>{day}</Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {days.map((date, index) => {
                if (!date) {
                  return <View key={`empty-${index}`} style={styles.emptyDay} />;
                }

                const dayWorkouts = getWorkoutsForDate(date);
                const dayBookings = getBookingsForDate(date);
                const today = isToday(date);

                // Get unique athlete colors for dots
                const athleteColors = new Set<string>();
                dayWorkouts.forEach(w => athleteColors.add(w.athlete_color));
                dayBookings.forEach(b => athleteColors.add(b.athlete_color));

                return (
                  <TouchableOpacity
                    key={date.toISOString()}
                    onPress={() => handleDayClick(date)}
                    style={[styles.calendarDay, today && styles.calendarDayToday]}
                  >
                    <Text style={[styles.dayNumber, today && styles.dayNumberToday]}>
                      {date.getDate()}
                    </Text>
                    {athleteColors.size > 0 && (
                      <View style={styles.dayDots}>
                        {Array.from(athleteColors).slice(0, 3).map((color, i) => (
                          <View
                            key={`dot-${i}`}
                            style={[styles.dayDot, { backgroundColor: color }]}
                          />
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.dayViewContainer}>
          {selectedDate && (
            <>
              {/* Back Button */}
              <View style={styles.dayViewHeader}>
                <TouchableOpacity onPress={handleBackToMonth} style={styles.backButton}>
                  <Text style={styles.backButtonText}>‹ Back</Text>
                </TouchableOpacity>
              </View>

              {/* Week Navigation Header */}
              <View style={styles.weekNavHeader}>
                <TouchableOpacity onPress={handlePrevDay} style={styles.weekNavButton}>
                  <Text style={styles.weekNavButtonText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.weekNavTitle}>
                  {selectedDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                </Text>
                <TouchableOpacity onPress={handleNextDay} style={styles.weekNavButton}>
                  <Text style={styles.weekNavButtonText}>›</Text>
                </TouchableOpacity>
              </View>

              {/* Week View Grid */}
              <View style={styles.weekViewContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekScroll}>
                  <View style={styles.weekGrid}>
                    {getWeekDates(selectedDate).map((date) => {
                      const isSelected = date.toDateString() === selectedDate.toDateString();
                      const today = isToday(date);
                      const dayWorkouts = getWorkoutsForDate(date);
                      const dayBookings = getBookingsForDate(date);

                      const athleteColors = new Set<string>();
                      dayWorkouts.forEach(w => athleteColors.add(w.athlete_color));
                      dayBookings.forEach(b => athleteColors.add(b.athlete_color));

                      return (
                        <TouchableOpacity
                          key={date.toISOString()}
                          onPress={() => setSelectedDate(date)}
                          style={[
                            styles.weekDay,
                            isSelected && styles.weekDaySelected,
                            today && !isSelected && styles.weekDayToday
                          ]}
                        >
                          <Text style={[
                            styles.weekDayName,
                            isSelected && styles.weekDayNameSelected
                          ]}>
                            {date.toLocaleString('default', { weekday: 'short' })}
                          </Text>
                          <Text style={[
                            styles.weekDayNumber,
                            isSelected && styles.weekDayNumberSelected,
                            today && !isSelected && styles.weekDayNumberToday
                          ]}>
                            {date.getDate()}
                          </Text>
                          {athleteColors.size > 0 && (
                            <View style={styles.weekDayDots}>
                              {Array.from(athleteColors).slice(0, 3).map((color, i) => (
                                <View
                                  key={`dot-${i}`}
                                  style={[styles.weekDayDot, { backgroundColor: color }]}
                                />
                              ))}
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              {/* Workouts for Selected Date */}
              <ScrollView style={styles.workoutsScrollView} contentContainerStyle={styles.workoutsContainer}>
                {selectedDateWorkouts.length === 0 && selectedDateBookings.length === 0 ? (
                  <View style={styles.emptyDayView}>
                    <Text style={styles.emptyDayIcon}>📅</Text>
                    <Text style={styles.emptyDayText}>No activities scheduled</Text>
                  </View>
                ) : (
                  <>
                    {selectedDateWorkouts.map(workout => {
                      const categoryInfo = CATEGORY_COLORS[workout.workouts?.category || 'strength_conditioning'];
                      const isCompleted = workout.status === 'completed';
                      const isExpanded = expandedWorkoutId === workout.id;

                      return (
                        <View key={workout.id} style={styles.workoutCard}>
                          <LinearGradient
                            colors={[categoryInfo.bg, categoryInfo.bg, '#050505', '#000000']}
                            locations={[0, 0.3, 0.7, 1]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.workoutCardGradient}
                          >
                            {/* Athlete Badge + Category Badge + Start Button */}
                            <View style={styles.workoutCardTopRow}>
                              <View style={styles.workoutBadges}>
                                <View style={[styles.athleteBadge, { backgroundColor: workout.athlete_color }]}>
                                  <Text style={styles.athleteBadgeText}>{workout.athlete_name}</Text>
                                </View>
                                <View style={[styles.categoryBadge, { backgroundColor: 'rgba(0, 0, 0, 0.3)' }]}>
                                  <Text style={[styles.categoryBadgeText, { color: categoryInfo.text }]}>
                                    {categoryInfo.label}
                                  </Text>
                                </View>
                              </View>
                              {/* Parents can only view completed workouts - no Start button */}
                              {isCompleted && (
                                <TouchableOpacity
                                  style={[styles.workoutActionButton, styles.workoutActionButtonCompleted]}
                                  onPress={() => {
                                    navigation.navigate('CompletedWorkout', { workoutInstanceId: workout.id });
                                  }}
                                >
                                  <Text style={styles.workoutActionButtonText}>View</Text>
                                </TouchableOpacity>
                              )}
                            </View>

                            {/* Workout Name + Duration + Accordion Toggle */}
                            <TouchableOpacity
                              style={styles.workoutCardHeader}
                              onPress={() => toggleWorkoutExpanded(workout.id)}
                              activeOpacity={0.7}
                            >
                              <View style={styles.workoutCardHeaderLeft}>
                                <Text style={styles.workoutCardName}>{workout.workouts.name}</Text>
                                {workout.workouts.estimated_duration_minutes && (
                                  <Text style={styles.workoutCardDuration}>
                                    {workout.workouts.estimated_duration_minutes} min
                                  </Text>
                                )}
                              </View>
                              <View style={styles.expandButton}>
                                <Text style={[
                                  styles.expandButtonText,
                                  isExpanded && styles.expandButtonTextExpanded
                                ]}>
                                  ›
                                </Text>
                              </View>
                            </TouchableOpacity>

                            {/* Workout Content - Accordion Dropdown */}
                            {isExpanded && (
                              <View style={styles.workoutPreview}>
                                {workout.workouts.notes && (
                                  <View style={styles.workoutPreviewNotes}>
                                    <Text style={styles.workoutPreviewNotesText}>{workout.workouts.notes}</Text>
                                  </View>
                                )}

                                {workout.workouts.routines && workout.workouts.routines.length > 0 && (
                                  <View style={styles.routinesList}>
                                    {workout.workouts.routines
                                      .sort((a, b) => a.order_index - b.order_index)
                                      .map((routine, routineIdx) => (
                                        <View key={routine.id} style={styles.routinePreview}>
                                          <View style={styles.routinePreviewHeader}>
                                            <Text style={styles.routinePreviewName}>{routine.name}</Text>
                                            {routine.scheme && (
                                              <Text style={styles.routinePreviewScheme}>{routine.scheme}</Text>
                                            )}
                                          </View>

                                          {(routine.notes || routine.text_info) && (
                                            <Text style={styles.routinePreviewInfo}>
                                              {routine.notes || routine.text_info}
                                            </Text>
                                          )}

                                          {routine.routine_exercises && routine.routine_exercises.filter(re => !re.exercises?.is_placeholder).length > 0 && (
                                            <View style={styles.exercisesList}>
                                              {routine.routine_exercises
                                                .filter(re => !re.exercises?.is_placeholder)
                                                .sort((a, b) => a.order_index - b.order_index)
                                                .map((routineExercise, exerciseIdx) => (
                                                  <View key={routineExercise.id} style={styles.exercisePreview}>
                                                    <Text style={styles.exercisePreviewCode}>
                                                      {String.fromCharCode(65 + routineIdx)}{exerciseIdx + 1}
                                                    </Text>
                                                    <Text style={styles.exercisePreviewName}>
                                                      {routineExercise.exercises.name}
                                                      {routineExercise.selected_variation && (
                                                        <Text style={styles.exercisePreviewVariation}> ({routineExercise.selected_variation})</Text>
                                                      )}
                                                    </Text>
                                                    <Text style={styles.exercisePreviewSets}>
                                                      {routineExercise.sets} sets
                                                    </Text>
                                                  </View>
                                                ))}
                                            </View>
                                          )}
                                        </View>
                                      ))}
                                  </View>
                                )}
                              </View>
                            )}
                          </LinearGradient>
                        </View>
                      );
                    })}

                    {/* Bookings */}
                    {selectedDateBookings.map((booking, idx) => {
                      const passed = isBookingPassed(booking);
                      const categoryColor = passed ? '#4B5563' : (booking.category_color || '#a855f7');
                      const startTime = new Date(booking.start_time).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      });
                      const endTime = booking.end_time ? new Date(booking.end_time).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                      }) : null;

                      return (
                        <TouchableOpacity
                          key={idx}
                          style={[
                            styles.bookingCard,
                            { borderLeftColor: categoryColor, backgroundColor: `${categoryColor}15` },
                            passed && styles.bookingCardPassed
                          ]}
                          onPress={() => !passed && openCancelModal(booking)}
                          activeOpacity={passed ? 1 : 0.7}
                          disabled={passed}
                        >
                          <View style={[styles.bookingIconContainer, { backgroundColor: categoryColor }]}>
                            <Ionicons name="calendar" size={20} color="#FFFFFF" />
                          </View>
                          <View style={styles.bookingContent}>
                            <Text style={[styles.bookingTitle, passed && styles.bookingTitlePassed]}>{booking.event_name}</Text>
                            {booking.category_name && (
                              <Text style={[styles.bookingCategory, { color: passed ? '#9CA3AF' : categoryColor }]}>{booking.category_name}</Text>
                            )}
                            <Text style={styles.bookingTime}>
                              {startTime}{endTime ? ` - ${endTime}` : ''}
                            </Text>
                          </View>
                          <View style={styles.bookingAthleteBadge}>
                            <Text style={styles.bookingAthleteBadgeText}>{booking.athlete_name.split(' ')[0]}</Text>
                          </View>
                          {passed ? (
                            <View style={styles.passedBadge}>
                              <Text style={styles.passedBadgeText}>Passed</Text>
                            </View>
                          ) : (
                            <Ionicons name="chevron-forward" size={20} color="#6B7280" />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}
              </ScrollView>
            </>
          )}
        </View>
      )}

      {/* Cancel Booking Confirmation Modal */}
      <Modal
        visible={cancelModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!cancelling) {
            setCancelModalVisible(false);
            setBookingToCancel(null);
          }
        }}
      >
        <Pressable
          style={styles.cancelModalBackdrop}
          onPress={() => {
            if (!cancelling) {
              setCancelModalVisible(false);
              setBookingToCancel(null);
            }
          }}
        >
          <Pressable style={styles.cancelModalContainer} onPress={() => {}}>
            <View style={styles.cancelModalIconContainer}>
              <View style={styles.cancelModalIconBadge}>
                <Ionicons name="calendar-outline" size={32} color="#EF4444" />
              </View>
            </View>

            <Text style={styles.cancelModalTitle}>Cancel Booking?</Text>
            {bookingToCancel && (
              <>
                <Text style={styles.cancelModalEventName}>{bookingToCancel.event_name}</Text>
                <Text style={styles.cancelModalDetails}>
                  {bookingToCancel.athlete_name} - {new Date(bookingToCancel.start_time).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric'
                  })} at {new Date(bookingToCancel.start_time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}
                </Text>
              </>
            )}

            <View style={styles.cancelModalInfoBox}>
              <Text style={styles.cancelModalInfoText}>
                If you cancel within the allowed time window, any credits or payments will be refunded.
              </Text>
            </View>

            <View style={styles.cancelModalActions}>
              <TouchableOpacity
                style={styles.cancelModalDestructiveButton}
                onPress={handleCancelBooking}
                activeOpacity={0.8}
                disabled={cancelling}
              >
                {cancelling ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.cancelModalDestructiveButtonText}>Yes, Cancel Booking</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.cancelModalSecondaryButton}
                onPress={() => {
                  setCancelModalVisible(false);
                  setBookingToCancel(null);
                }}
                activeOpacity={0.8}
                disabled={cancelling}
              >
                <Text style={styles.cancelModalSecondaryButtonText}>Keep Booking</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* FAB Menu */}
      <FABMenu
        isOpen={fabOpen}
        onToggle={() => setFabOpen(!fabOpen)}
        items={[
          { id: 'home', label: 'Home', icon: 'home', isActive: true, onPress: () => setFabOpen(false) },
          { id: 'messages', label: 'Messages', icon: 'chatbubbles', onPress: () => navigation.navigate('Messages') },
          { id: 'leaderboard', label: 'Leaderboard', icon: 'trophy', onPress: () => navigation.navigate('Leaderboard') },
          ...(hasHittingData ? [{ id: 'hitting', label: 'Hitting', icon: 'baseball-bat', iconFamily: 'material-community' as const, onPress: () => handleFabNavigate('HittingPerformance') }] : []),
          ...(hasPitchingData ? [{ id: 'pitching', label: 'Pitching', icon: 'baseball', iconFamily: 'material-community' as const, onPress: () => handleFabNavigate('PitchingPerformance') }] : []),
          ...(hasArmCareData ? [{ id: 'armcare', label: 'Arm Care', icon: 'arm-flex', iconFamily: 'material-community' as const, onPress: () => handleFabNavigate('ArmCare') }] : []),
          ...(hasForceData ? [{ id: 'force', label: 'Force Profile', icon: 'trending-up', onPress: () => handleFabNavigate('ForceProfile') }] : []),
          { id: 'resources', label: 'Notes/Resources', icon: 'document-text', onPress: () => handleFabNavigate('Resources') },
          { id: 'book', label: 'Book a Class', icon: 'calendar', isBookButton: true, onPress: () => navigation.navigate('Booking') },
        ]}
      />

      {/* Athlete Picker Modal */}
      <AthletePickerModal
        visible={showAthletePicker}
        onClose={() => {
          setShowAthletePicker(false);
          setPendingNavigation(null);
        }}
        onSelectAthlete={handleAthleteSelected}
        linkedAthletes={linkedAthletes}
      />
    </View>
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
    backgroundColor: '#0A0A0A',
  },
  loadingText: {
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 16,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#0A0A0A',
  },
  greeting: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  date: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  settingsButton: {
    padding: 8,
  },
  settingsIcon: {
    fontSize: 24,
  },
  athleteLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  athleteLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  athleteLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  athleteLegendName: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  snapshotContainer: {
    height: CARD_HEIGHT,
    marginBottom: 0,
    position: 'relative',
  },
  carouselWrapper: {
    flex: 1,
    position: 'relative',
  },
  snapshotCard: {
    backgroundColor: '#000000',
    borderRadius: 24,
    padding: 16,
    marginHorizontal: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.8,
    shadowRadius: 60,
    elevation: 10,
    position: 'relative',
  },
  cardGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 24,
  },
  calendarContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  monthButton: {
    padding: 8,
  },
  monthButtonText: {
    fontSize: 24,
    color: '#FFFFFF',
  },
  monthTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  dayHeaders: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  dayHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    color: '#9CA3AF',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emptyDay: {
    width: CALENDAR_DAY_SIZE,
    height: CALENDAR_DAY_SIZE,
  },
  calendarDay: {
    width: CALENDAR_DAY_SIZE,
    height: CALENDAR_DAY_SIZE,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  calendarDayToday: {
    borderColor: '#9BDDFF',
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
  },
  dayNumber: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  dayNumberToday: {
    color: '#9BDDFF',
  },
  dayDots: {
    flexDirection: 'row',
    gap: 2,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  dayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dayViewContainer: {
    flex: 1,
  },
  dayViewHeader: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  weekNavHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  weekNavButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekNavButtonText: {
    fontSize: 24,
    color: '#FFFFFF',
  },
  weekNavTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  weekViewContainer: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  weekScroll: {
    paddingVertical: 8,
  },
  weekGrid: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    gap: 4,
  },
  weekDay: {
    width: (SCREEN_WIDTH - 32) / 7,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  weekDaySelected: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: '#9BDDFF',
  },
  weekDayToday: {
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
  },
  weekDayName: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  weekDayNameSelected: {
    color: '#9BDDFF',
  },
  weekDayNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  weekDayNumberSelected: {
    color: '#9BDDFF',
  },
  weekDayNumberToday: {
    color: '#9BDDFF',
  },
  weekDayDots: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 4,
  },
  weekDayDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  workoutsScrollView: {
    flex: 1,
  },
  workoutsContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyDayView: {
    alignItems: 'center',
    padding: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  emptyDayIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyDayText: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  workoutCard: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  workoutCardGradient: {
    padding: 16,
  },
  workoutCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  workoutBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    flex: 1,
  },
  athleteBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  athleteBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#000000',
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  workoutActionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  workoutActionButtonCompleted: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  workoutActionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  workoutCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  workoutCardHeaderLeft: {
    flex: 1,
  },
  workoutCardName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  workoutCardDuration: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  expandButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandButtonText: {
    fontSize: 24,
    color: '#9CA3AF',
    transform: [{ rotate: '0deg' }],
  },
  expandButtonTextExpanded: {
    transform: [{ rotate: '90deg' }],
  },
  workoutPreview: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  workoutPreviewNotes: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
  },
  workoutPreviewNotesText: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 18,
  },
  routinesList: {
    gap: 12,
  },
  routinePreview: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  routinePreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  routinePreviewName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  routinePreviewScheme: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '600',
  },
  routinePreviewInfo: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 8,
    lineHeight: 16,
  },
  exercisesList: {
    gap: 6,
  },
  exercisePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exercisePreviewCode: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9BDDFF',
    width: 28,
  },
  exercisePreviewName: {
    fontSize: 13,
    color: '#FFFFFF',
    flex: 1,
  },
  exercisePreviewVariation: {
    color: '#C084FC',
    fontSize: 13,
    fontWeight: 'normal',
  },
  exercisePreviewSets: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  bookingCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
  },
  bookingIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  bookingContent: {
    flex: 1,
  },
  bookingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  bookingCategory: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  bookingTime: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  bookingAthleteBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
  },
  bookingAthleteBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  bookingCardPassed: {
    opacity: 0.6,
  },
  bookingTitlePassed: {
    color: '#9CA3AF',
  },
  passedBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(107, 114, 128, 0.3)',
    borderRadius: 6,
  },
  passedBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: HEADER_HEIGHT - 8,
    paddingRight: 16,
  },
  settingsDropdown: {
    position: 'absolute',
    top: 100,
    right: 16,
    backgroundColor: '#0A0A0A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  settingsDropdownHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  settingsDropdownTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  settingsDropdownSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  settingsMenuItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  settingsMenuItemContent: {
    flex: 1,
  },
  settingsMenuLabel: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  settingsMenuDescription: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  settingsDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 4,
    marginHorizontal: 16,
  },
  resumeModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  resumeModalContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  resumeModalIconContainer: {
    marginBottom: 16,
  },
  resumeModalIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resumeModalIconText: {
    fontSize: 32,
  },
  resumeModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  resumeModalWorkoutName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9BDDFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  resumeModalTime: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 16,
  },
  resumeModalInfoBox: {
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
  },
  resumeModalInfoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  resumeModalInfoText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  resumeModalActions: {
    width: '100%',
    gap: 12,
  },
  resumeModalPrimaryButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  resumeModalPrimaryButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  resumeModalPrimaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  resumeModalSecondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  resumeModalSecondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  resumeModalTertiaryButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  resumeModalTertiaryButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#EF4444',
  },
  // Cancel modal styles
  cancelModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  cancelModalContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cancelModalIconContainer: {
    marginBottom: 16,
  },
  cancelModalIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  cancelModalEventName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9BDDFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  cancelModalDetails: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 16,
    textAlign: 'center',
  },
  cancelModalInfoBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  cancelModalInfoText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  cancelModalActions: {
    width: '100%',
    gap: 12,
  },
  cancelModalDestructiveButton: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelModalDestructiveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  cancelModalSecondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  cancelModalSecondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
