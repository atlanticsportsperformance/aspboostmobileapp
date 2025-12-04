import React, { useState, useRef, useCallback } from 'react';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useAthlete } from '../contexts/AthleteContext';
import AthletePickerModal from '../components/AthletePickerModal';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
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
        exercises: {
          id: string;
          name: string;
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
  const {
    parentName,
    linkedAthletes,
    selectedAthleteId,
    setSelectedAthlete,
    loading: contextLoading,
  } = useAthlete();

  const [workoutInstances, setWorkoutInstances] = useState<WorkoutInstance[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'day'>('month');

  // FAB menu state
  const [fabOpen, setFabOpen] = useState(false);

  // Settings dropdown state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Expanded workout card state
  const [expandedWorkoutId, setExpandedWorkoutId] = useState<string | null>(null);

  // Athlete picker state
  const [showAthletePicker, setShowAthletePicker] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  // Resume workout modal state
  const [resumeWorkoutData, setResumeWorkoutData] = useState<{
    instanceId: string;
    workoutName: string;
    elapsedTime: number;
    athleteId: string;
  } | null>(null);
  const [showResumeModal, setShowResumeModal] = useState(false);

  // Data presence flags for FAB visibility
  const [hasHittingData, setHasHittingData] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasArmCareData, setHasArmCareData] = useState(false);
  const [hasForceData, setHasForceData] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (linkedAthletes.length > 0) {
        loadDashboard();
      } else if (!contextLoading) {
        setLoading(false);
      }
    }, [linkedAthletes, contextLoading])
  );

  async function checkAndShowResumeModal(workout: WorkoutInstance) {
    try {
      if (workout.status === 'in_progress') {
        const savedData = await AsyncStorage.getItem(`workout_${workout.id}`);
        const elapsedTime = savedData ? JSON.parse(savedData).elapsedTime || 0 : 0;

        setResumeWorkoutData({
          instanceId: workout.id,
          workoutName: workout.workouts.name,
          elapsedTime,
          athleteId: workout.athlete_id,
        });
        setShowResumeModal(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error checking workout status:', error);
      return false;
    }
  }

  async function handleResumeWorkout() {
    if (resumeWorkoutData) {
      setShowResumeModal(false);
      navigation.navigate('WorkoutLogger', {
        workoutInstanceId: resumeWorkoutData.instanceId,
        athleteId: resumeWorkoutData.athleteId
      });
    }
  }

  async function handleRestartWorkout() {
    if (resumeWorkoutData) {
      await AsyncStorage.removeItem(`workout_${resumeWorkoutData.instanceId}`);
      setShowResumeModal(false);
      navigation.navigate('WorkoutLogger', {
        workoutInstanceId: resumeWorkoutData.instanceId,
        athleteId: resumeWorkoutData.athleteId
      });
    }
  }

  async function handleDiscardWorkout() {
    if (resumeWorkoutData) {
      const instanceId = resumeWorkoutData.instanceId;
      setShowResumeModal(false);
      setResumeWorkoutData(null);
      await AsyncStorage.removeItem(`workout_${instanceId}`);
      await supabase.from('exercise_logs').delete().eq('workout_instance_id', instanceId);
      await supabase.from('workout_instances').update({ status: 'not_started' }).eq('id', instanceId);
      await loadDashboard();
    }
  }

  function formatElapsedTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    if (mins < 60) {
      return `${mins} min${mins !== 1 ? 's' : ''} ago`;
    } else {
      const hours = Math.floor(mins / 60);
      return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }
  }

  async function loadDashboard() {
    try {
      const athleteIds = linkedAthletes.map(a => a.athlete_id);

      if (athleteIds.length === 0) {
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
                exercises (
                  id,
                  name
                )
              )
            )
          )
        `)
        .in('athlete_id', athleteIds)
        .order('scheduled_date');

      // Map workouts with athlete info
      const workoutsWithAthleteInfo = (workoutsData || []).map((w: any) => {
        const athlete = linkedAthletes.find(a => a.athlete_id === w.athlete_id);
        return {
          ...w,
          athlete_name: athlete ? `${athlete.first_name} ${athlete.last_name}` : 'Unknown',
          athlete_color: athlete?.color || '#9BDDFF',
        };
      });

      setWorkoutInstances(workoutsWithAthleteInfo);

      // Load bookings for ALL linked athletes
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('scheduling_bookings')
        .select(`
          id,
          athlete_id,
          event:scheduling_events (
            start_time,
            scheduling_templates (
              scheduling_categories (
                color
              )
            )
          )
        `)
        .in('athlete_id', athleteIds);

      // Map bookings with athlete info
      const bookingsWithAthleteInfo = (bookingsData || []).map((b: any) => {
        const athlete = linkedAthletes.find(a => a.athlete_id === b.athlete_id);
        return {
          id: b.id,
          athlete_id: b.athlete_id,
          athlete_name: athlete ? `${athlete.first_name} ${athlete.last_name}` : 'Unknown',
          athlete_color: athlete?.color || '#9BDDFF',
          start_time: b.event?.start_time,
        };
      });

      setBookings(bookingsWithAthleteInfo);

      // Fetch data presence for FAB (check what data types exist for linked athletes)
      await fetchDataPresence(athleteIds);
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
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
    loadDashboard();
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
    const dateStr = date.toISOString().split('T')[0];
    return bookings.filter(b => b.start_time?.startsWith(dateStr));
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
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
        <TouchableOpacity
          style={styles.settingsOverlay}
          activeOpacity={1}
          onPress={() => setSettingsOpen(false)}
        >
          <View style={styles.settingsDropdown}>
            <TouchableOpacity
              style={styles.settingsMenuItem}
              onPress={() => {
                setSettingsOpen(false);
                navigation.navigate('Profile');
              }}
            >
              <Ionicons name="person-outline" size={20} color="#FFFFFF" />
              <Text style={styles.settingsMenuLabel}>Profile Settings</Text>
            </TouchableOpacity>

            <View style={styles.settingsDivider} />

            <TouchableOpacity
              style={styles.settingsMenuItem}
              onPress={() => {
                setSettingsOpen(false);
                handleLogout();
              }}
            >
              <Ionicons name="log-out-outline" size={20} color="#EF4444" />
              <Text style={[styles.settingsMenuLabel, { color: '#EF4444' }]}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {viewMode === 'month' ? (
        <ScrollView
          style={styles.scrollView}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9BDDFF" />
          }
        >
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
                              <TouchableOpacity
                                style={[
                                  styles.workoutActionButton,
                                  !isCompleted && { backgroundColor: categoryInfo.button },
                                  isCompleted && styles.workoutActionButtonCompleted
                                ]}
                                onPress={async () => {
                                  if (!isCompleted) {
                                    const showedModal = await checkAndShowResumeModal(workout);
                                    if (!showedModal) {
                                      navigation.navigate('WorkoutLogger', {
                                        workoutInstanceId: workout.id,
                                        athleteId: workout.athlete_id
                                      });
                                    }
                                  }
                                }}
                              >
                                <Text style={[styles.workoutActionButtonText, !isCompleted && { color: '#FFFFFF' }]}>
                                  {isCompleted ? 'View' : 'Start'}
                                </Text>
                              </TouchableOpacity>
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

                                          {routine.routine_exercises && routine.routine_exercises.length > 0 && (
                                            <View style={styles.exercisesList}>
                                              {routine.routine_exercises
                                                .sort((a, b) => a.order_index - b.order_index)
                                                .map((routineExercise, exerciseIdx) => (
                                                  <View key={routineExercise.id} style={styles.exercisePreview}>
                                                    <Text style={styles.exercisePreviewCode}>
                                                      {String.fromCharCode(65 + routineIdx)}{exerciseIdx + 1}
                                                    </Text>
                                                    <Text style={styles.exercisePreviewName}>
                                                      {routineExercise.exercises.name}
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
                    {selectedDateBookings.map((booking, idx) => (
                      <View key={idx} style={styles.bookingCard}>
                        <View style={[styles.bookingAthleteIndicator, { backgroundColor: booking.athlete_color }]} />
                        <Ionicons name="calendar" size={24} color="#3B82F6" style={{ marginRight: 12 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.bookingAthleteName}>{booking.athlete_name}</Text>
                          <Text style={styles.bookingInfo}>
                            Class Booking - {new Date(booking.start_time).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </>
                )}
              </ScrollView>
            </>
          )}
        </View>
      )}

      {/* Resume Workout Modal */}
      {showResumeModal && resumeWorkoutData && (
        <Modal
          visible={showResumeModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowResumeModal(false)}
        >
          <Pressable
            style={styles.resumeModalBackdrop}
            onPress={() => setShowResumeModal(false)}
          >
            <Pressable style={styles.resumeModalContainer} onPress={() => {}}>
              <View style={styles.resumeModalIconContainer}>
                <View style={styles.resumeModalIconBadge}>
                  <Text style={styles.resumeModalIconText}>⚡</Text>
                </View>
              </View>

              <Text style={styles.resumeModalTitle}>Workout In Progress</Text>
              <Text style={styles.resumeModalWorkoutName}>{resumeWorkoutData.workoutName}</Text>
              <Text style={styles.resumeModalTime}>
                Started {formatElapsedTime(resumeWorkoutData.elapsedTime)}
              </Text>

              <View style={styles.resumeModalInfoBox}>
                <Text style={styles.resumeModalInfoTitle}>Your progress is saved</Text>
                <Text style={styles.resumeModalInfoText}>
                  Resume right where you left off or start fresh
                </Text>
              </View>

              <View style={styles.resumeModalActions}>
                <TouchableOpacity
                  style={styles.resumeModalPrimaryButton}
                  onPress={handleResumeWorkout}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={['#9BDDFF', '#7BC5F0']}
                    style={styles.resumeModalPrimaryButtonGradient}
                  >
                    <Text style={styles.resumeModalPrimaryButtonText}>Resume Workout</Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.resumeModalSecondaryButton}
                  onPress={handleRestartWorkout}
                  activeOpacity={0.8}
                >
                  <Text style={styles.resumeModalSecondaryButtonText}>Restart from Beginning</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.resumeModalTertiaryButton}
                  onPress={handleDiscardWorkout}
                  activeOpacity={0.8}
                >
                  <Text style={styles.resumeModalTertiaryButtonText}>Discard Progress</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* FAB Button */}
      <View style={styles.fabContainer}>
        <TouchableOpacity
          onPress={() => setFabOpen(!fabOpen)}
          style={styles.fab}
        >
          <LinearGradient
            colors={['#9BDDFF', '#B0E5FF', '#7BC5F0']}
            style={styles.fabGradient}
          >
            <Text style={styles.fabIcon}>{fabOpen ? '✕' : '☰'}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* FAB Menu */}
        <Modal
          visible={fabOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setFabOpen(false)}
        >
          <TouchableOpacity
            style={styles.fabOverlay}
            activeOpacity={1}
            onPress={() => setFabOpen(false)}
          >
            <View style={styles.fabMenu} onStartShouldSetResponder={() => true}>
              {/* Home - Active */}
              <TouchableOpacity
                style={[styles.fabMenuItem, styles.fabMenuItemActive]}
                onPress={() => setFabOpen(false)}
              >
                <Ionicons name="home" size={20} color="#9BDDFF" />
                <Text style={[styles.fabMenuLabel, styles.fabMenuLabelActive]}>Home</Text>
              </TouchableOpacity>

              {/* Leaderboard */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Leaderboard');
                }}
              >
                <Ionicons name="trophy" size={20} color="#FFFFFF" />
                <Text style={styles.fabMenuLabel}>Leaderboard</Text>
              </TouchableOpacity>

              {/* Hitting - with athlete picker (only show if data exists) */}
              {hasHittingData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => handleFabNavigate('HittingPerformance')}
                >
                  <MaterialCommunityIcons name="baseball-bat" size={20} color="#EF4444" />
                  <Text style={styles.fabMenuLabel}>Hitting</Text>
                </TouchableOpacity>
              )}

              {/* Pitching - with athlete picker (only show if data exists) */}
              {hasPitchingData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => handleFabNavigate('PitchingPerformance')}
                >
                  <MaterialCommunityIcons name="baseball" size={20} color="#3B82F6" />
                  <Text style={styles.fabMenuLabel}>Pitching</Text>
                </TouchableOpacity>
              )}

              {/* Arm Care - with athlete picker (only show if data exists) */}
              {hasArmCareData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => handleFabNavigate('ArmCare')}
                >
                  <MaterialCommunityIcons name="arm-flex" size={20} color="#10B981" />
                  <Text style={styles.fabMenuLabel}>Arm Care</Text>
                </TouchableOpacity>
              )}

              {/* Force Profile - with athlete picker (only show if data exists) */}
              {hasForceData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => handleFabNavigate('ForceProfile')}
                >
                  <Ionicons name="trending-up" size={20} color="#A855F7" />
                  <Text style={styles.fabMenuLabel}>Force Profile</Text>
                </TouchableOpacity>
              )}

              {/* Resources - always show, with athlete picker */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => handleFabNavigate('Resources')}
              >
                <Ionicons name="document-text" size={20} color="#F59E0B" />
                <Text style={styles.fabMenuLabel}>Notes/Resources</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>

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
  calendarContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
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
  exercisePreviewSets: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  bookingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  bookingAthleteIndicator: {
    width: 4,
    height: '100%',
    borderRadius: 2,
    marginRight: 12,
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  bookingAthleteName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9BDDFF',
    marginBottom: 2,
  },
  bookingInfo: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
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
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 200,
    padding: 8,
  },
  settingsMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  settingsMenuLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  settingsDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 4,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 24,
    right: 24,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: '#9BDDFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fabIcon: {
    fontSize: 24,
    color: '#000000',
    fontWeight: 'bold',
  },
  fabOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 24,
    paddingBottom: 100,
  },
  fabMenu: {
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    minWidth: 220,
    padding: 8,
  },
  fabMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  fabMenuItemActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
  },
  fabMenuLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  fabMenuLabelActive: {
    color: '#9BDDFF',
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
});
