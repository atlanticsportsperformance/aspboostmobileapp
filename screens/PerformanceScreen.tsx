import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  TextInput,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line, Circle, Text as SvgText, Path, G } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { useAthlete } from '../contexts/AthleteContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Types
type ViewMode = 'personalRecords' | 'exerciseHistory';
type TimeRange = '7d' | '30d' | '90d' | 'all';
type Category = 'all' | 'throwing' | 'hitting' | 'strength_conditioning';

interface AthleteMax {
  id: string;
  athlete_id: string;
  exercise_id: string | null;
  metric_id: string;
  max_value: number;
  reps_at_max: number | null;
  achieved_on: string;
  source: string;
  verified_by_coach: boolean;
  notes: string | null;
  exercises?: { name: string } | null;
}

interface Exercise {
  id: string;
  name: string;
  categories: string[];
  is_active: boolean;
  metric_schema?: {
    measurements: Array<{
      id: string;
      name: string;
      unit: string;
    }>;
  };
}

interface CustomMeasurement {
  id: string;
  name: string;
  category: 'single' | 'paired';
  primary_metric_id: string;
  primary_metric_name: string;
  secondary_metric_id?: string;
  secondary_metric_name?: string;
  secondary_metric_unit?: string;
}

interface ExerciseLog {
  id: string;
  workout_instance_id: string;
  set_number: number;
  actual_reps: number | null;
  actual_weight: number | null;
  metric_data: Record<string, number | null>;
  created_at: string;
  workout_instances?: { completed_at: string };
}

interface DetectedMetric {
  metricId: string;
  label: string;
  color: string;
  unit: string;
}

// Color helpers
const METRIC_COLORS = [
  '#3B82F6', // blue
  '#EF4444', // red
  '#F59E0B', // amber
  '#10B981', // emerald
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

function getColorForMetric(metricId: string): string {
  const id = metricId.toLowerCase();

  // Color keywords
  if (id.includes('red')) return '#EF4444';
  if (id.includes('blue')) return '#3B82F6';
  if (id.includes('yellow') || id.includes('gold')) return '#EAB308';
  if (id.includes('green')) return '#22C55E';
  if (id.includes('purple') || id.includes('violet')) return '#8B5CF6';
  if (id.includes('orange')) return '#F97316';
  if (id.includes('pink')) return '#EC4899';
  if (id.includes('gray') || id.includes('grey')) return '#6B7280';

  // Special types
  if (id.includes('distance')) return '#10B981';
  if (id.includes('time')) return '#8B5CF6';
  if (id.includes('weight')) return '#F59E0B';

  // Hash-based fallback
  let hash = 0;
  for (let i = 0; i < metricId.length; i++) {
    hash = metricId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return METRIC_COLORS[Math.abs(hash) % METRIC_COLORS.length];
}

function formatMetricLabel(metricId: string): string {
  return metricId
    .replace(/_primary$/, ' (Reps)')
    .replace(/_secondary$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

// Global metric IDs
const GLOBAL_METRICS = [
  { id: '5oz_mound_velo', name: '5oz Mound Velocity', unit: 'mph' },
];

export default function PerformanceScreen({ route, navigation }: any) {
  const { isParent } = useAthlete();
  const { athleteId } = route.params;

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>('personalRecords');
  const [loading, setLoading] = useState(true);

  // Personal Records state
  const [maxes, setMaxes] = useState<AthleteMax[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [customMeasurements, setCustomMeasurements] = useState<CustomMeasurement[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingMax, setEditingMax] = useState<AthleteMax | null>(null);

  // Add Max form state
  const [selectedMetricType, setSelectedMetricType] = useState<string>('');
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  const [maxValue, setMaxValue] = useState('');
  const [repsAtMax, setRepsAtMax] = useState('');
  const [achievedDate, setAchievedDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [metricDropdownOpen, setMetricDropdownOpen] = useState(false);

  // Exercise History state
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [category, setCategory] = useState<Category>('all');
  const [loggedExercises, setLoggedExercises] = useState<Exercise[]>([]);
  const [selectedExercises, setSelectedExercises] = useState<string[]>([]);
  const [exerciseDropdownOpen, setExerciseDropdownOpen] = useState(false);
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState('');

  // FAB state
  const [fabOpen, setFabOpen] = useState(false);
  const [hasHittingData, setHasHittingData] = useState(false);
  const [hasPitchingData, setHasPitchingData] = useState(false);
  const [hasArmCareData, setHasArmCareData] = useState(false);
  const [hasForceProfileData, setHasForceProfileData] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [newResourcesCount, setNewResourcesCount] = useState(0);

  useEffect(() => {
    fetchData();
    fetchFabData();
  }, [athleteId]);

  async function fetchData() {
    setLoading(true);
    try {
      await Promise.all([
        fetchMaxes(),
        fetchExercises(),
        fetchCustomMeasurements(),
        fetchLoggedExercises(),
      ]);
    } catch (err) {
      console.error('Error fetching performance data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMaxes() {
    const { data, error } = await supabase
      .from('athlete_maxes')
      .select('*, exercises(name)')
      .eq('athlete_id', athleteId)
      .order('achieved_on', { ascending: false });

    if (error) {
      console.error('Error fetching maxes:', error);
      return;
    }
    setMaxes(data || []);
  }

  async function fetchExercises() {
    const { data, error } = await supabase
      .from('exercises')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Error fetching exercises:', error);
      return;
    }
    setExercises(data || []);
  }

  async function fetchCustomMeasurements() {
    const { data, error } = await supabase
      .from('custom_measurements')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error fetching custom measurements:', error);
      return;
    }
    setCustomMeasurements(data || []);
  }

  async function fetchLoggedExercises() {
    const { data, error } = await supabase
      .from('exercise_logs')
      .select('exercise_id, exercises(id, name, categories)')
      .eq('athlete_id', athleteId);

    if (error) {
      console.error('Error fetching logged exercises:', error);
      return;
    }

    // Get unique exercises
    const uniqueExercises = new Map<string, Exercise>();
    (data || []).forEach((log: any) => {
      if (log.exercises && !uniqueExercises.has(log.exercises.id)) {
        uniqueExercises.set(log.exercises.id, log.exercises);
      }
    });
    setLoggedExercises(Array.from(uniqueExercises.values()));
  }

  async function fetchFabData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [blastSwings, hittraxSessions, trackmanPitches, commandSessions, armCareSessions, forceData, unreadMessages, resources, athleteLastViewed] = await Promise.all([
        supabase.from('blast_swings').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
        supabase.from('hittrax_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
        supabase.from('trackman_pitch_data').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
        supabase.from('command_training_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
        supabase.from('armcare_sessions').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
        supabase.from('force_plate_percentiles').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('receiver_id', user.id).eq('read', false),
        supabase.from('athlete_notes').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteId),
        supabase.from('athletes').select('last_viewed_resources_at').eq('id', athleteId).single(),
      ]);

      setHasHittingData((blastSwings.count || 0) > 0 || (hittraxSessions.count || 0) > 0);
      setHasPitchingData((trackmanPitches.count || 0) > 0 || (commandSessions.count || 0) > 0);
      setHasArmCareData((armCareSessions.count || 0) > 0);
      setHasForceProfileData((forceData.count || 0) > 0);
      setUnreadMessagesCount(unreadMessages.count || 0);

      // Count new resources since last viewed
      if (athleteLastViewed?.data?.last_viewed_resources_at) {
        const { count: newCount } = await supabase
          .from('athlete_notes')
          .select('id', { count: 'exact', head: true })
          .eq('athlete_id', athleteId)
          .gt('created_at', athleteLastViewed.data.last_viewed_resources_at);
        setNewResourcesCount(newCount || 0);
      } else {
        setNewResourcesCount(resources.count || 0);
      }
    } catch (err) {
      console.error('Error fetching FAB data:', err);
    }
  }

  // Filter maxes based on search
  const filteredMaxes = useMemo(() => {
    if (!searchQuery.trim()) return maxes;
    const query = searchQuery.toLowerCase();
    return maxes.filter(max => {
      const exerciseName = max.exercises?.name?.toLowerCase() || '';
      const metricId = max.metric_id.toLowerCase();
      return exerciseName.includes(query) || metricId.includes(query);
    });
  }, [maxes, searchQuery]);

  // Separate global and exercise maxes
  const globalMaxes = filteredMaxes.filter(m => m.exercise_id === null);
  const exerciseMaxes = filteredMaxes.filter(m => m.exercise_id !== null);

  // Filter exercises by category for Exercise History
  const filteredLoggedExercises = useMemo(() => {
    let filtered = loggedExercises;

    if (category !== 'all') {
      filtered = filtered.filter(ex => ex.categories?.includes(category));
    }

    if (exerciseSearchQuery.trim()) {
      const query = exerciseSearchQuery.toLowerCase();
      filtered = filtered.filter(ex => ex.name.toLowerCase().includes(query));
    }

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [loggedExercises, category, exerciseSearchQuery]);

  // Get metric type display name
  function getMetricDisplayName(metricId: string): string {
    // Check global metrics
    const globalMetric = GLOBAL_METRICS.find(m => m.id === metricId);
    if (globalMetric) return globalMetric.name;

    // Check custom measurements
    for (const cm of customMeasurements) {
      if (cm.primary_metric_id === metricId) {
        return `${cm.name} (${cm.primary_metric_name})`;
      }
      if (cm.secondary_metric_id === metricId) {
        return `${cm.name} (${cm.secondary_metric_name})`;
      }
    }

    // Fallback to formatted metric ID
    return formatMetricLabel(metricId);
  }

  // Get metric unit
  function getMetricUnit(metricId: string): string {
    const globalMetric = GLOBAL_METRICS.find(m => m.id === metricId);
    if (globalMetric) return globalMetric.unit;

    for (const cm of customMeasurements) {
      if (cm.secondary_metric_id === metricId && cm.secondary_metric_unit) {
        return cm.secondary_metric_unit;
      }
    }

    if (metricId.toLowerCase().includes('weight')) return 'lbs';
    if (metricId.toLowerCase().includes('velo') || metricId.toLowerCase().includes('mph')) return 'mph';
    if (metricId.toLowerCase().includes('time')) return 'sec';
    if (metricId.toLowerCase().includes('distance')) return 'ft';

    return '';
  }

  // Check if metric is global
  function isGlobalMetric(metricId: string): boolean {
    return GLOBAL_METRICS.some(m => m.id === metricId);
  }

  // Handle add max
  async function handleAddMax() {
    if (!selectedMetricType || !maxValue) {
      Alert.alert('Error', 'Please fill in required fields');
      return;
    }

    const isGlobal = isGlobalMetric(selectedMetricType);
    if (!isGlobal && !selectedExercise) {
      Alert.alert('Error', 'Please select an exercise');
      return;
    }

    try {
      const newMax = {
        athlete_id: athleteId,
        exercise_id: isGlobal ? null : selectedExercise,
        metric_id: selectedMetricType,
        max_value: parseFloat(maxValue),
        reps_at_max: repsAtMax ? parseInt(repsAtMax) : null,
        achieved_on: achievedDate,
        source: 'manual',
        verified_by_coach: false,
        notes: notes || null,
      };

      const { error } = await supabase
        .from('athlete_maxes')
        .upsert(newMax, {
          onConflict: 'athlete_id,exercise_id,metric_id,reps_at_max',
        });

      if (error) throw error;

      await fetchMaxes();
      resetAddForm();
      setAddModalVisible(false);
    } catch (err) {
      console.error('Error adding max:', err);
      Alert.alert('Error', 'Failed to add personal record');
    }
  }

  // Handle edit max
  async function handleEditMax() {
    if (!editingMax || !maxValue) {
      Alert.alert('Error', 'Please fill in required fields');
      return;
    }

    try {
      const { error } = await supabase
        .from('athlete_maxes')
        .update({
          max_value: parseFloat(maxValue),
          reps_at_max: repsAtMax ? parseInt(repsAtMax) : null,
          achieved_on: achievedDate,
          notes: notes || null,
        })
        .eq('id', editingMax.id);

      if (error) throw error;

      await fetchMaxes();
      resetEditForm();
      setEditModalVisible(false);
    } catch (err) {
      console.error('Error editing max:', err);
      Alert.alert('Error', 'Failed to update personal record');
    }
  }

  // Handle delete max
  async function handleDeleteMax(maxId: string) {
    Alert.alert(
      'Delete Personal Record',
      'Are you sure you want to delete this record?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('athlete_maxes')
                .delete()
                .eq('id', maxId);

              if (error) throw error;
              await fetchMaxes();
            } catch (err) {
              console.error('Error deleting max:', err);
              Alert.alert('Error', 'Failed to delete personal record');
            }
          },
        },
      ]
    );
  }

  // Handle verify max
  async function handleVerifyMax(maxId: string) {
    try {
      const { error } = await supabase
        .from('athlete_maxes')
        .update({ verified_by_coach: true })
        .eq('id', maxId);

      if (error) throw error;
      await fetchMaxes();
    } catch (err) {
      console.error('Error verifying max:', err);
      Alert.alert('Error', 'Failed to verify personal record');
    }
  }

  function resetAddForm() {
    setSelectedMetricType('');
    setSelectedExercise(null);
    setMaxValue('');
    setRepsAtMax('');
    setAchievedDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setMetricDropdownOpen(false);
    setExerciseSearchQuery('');
  }

  function resetEditForm() {
    setEditingMax(null);
    setMaxValue('');
    setRepsAtMax('');
    setAchievedDate(new Date().toISOString().split('T')[0]);
    setNotes('');
  }

  function openEditModal(max: AthleteMax) {
    setEditingMax(max);
    setMaxValue(max.max_value.toString());
    setRepsAtMax(max.reps_at_max?.toString() || '');
    setAchievedDate(max.achieved_on);
    setNotes(max.notes || '');
    setEditModalVisible(true);
  }

  // Toggle exercise selection
  function toggleExerciseSelection(exerciseId: string) {
    if (selectedExercises.includes(exerciseId)) {
      setSelectedExercises(selectedExercises.filter(id => id !== exerciseId));
    } else if (selectedExercises.length < 10) {
      setSelectedExercises([...selectedExercises, exerciseId]);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
          <Text style={styles.loadingText}>Loading performance data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Performance</Text>
          <Text style={styles.headerSubtitle}>Track your maxes and progress</Text>
        </View>
      </View>

      {/* View Toggle */}
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[styles.toggleButton, viewMode === 'personalRecords' && styles.toggleButtonActive]}
          onPress={() => setViewMode('personalRecords')}
        >
          <Text style={[styles.toggleText, viewMode === 'personalRecords' && styles.toggleTextActive]}>
            Personal Records
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, viewMode === 'exerciseHistory' && styles.toggleButtonActive]}
          onPress={() => setViewMode('exerciseHistory')}
        >
          <Text style={[styles.toggleText, viewMode === 'exerciseHistory' && styles.toggleTextActive]}>
            Exercise History
          </Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'personalRecords' ? (
        <PersonalRecordsView
          maxes={maxes}
          globalMaxes={globalMaxes}
          exerciseMaxes={exerciseMaxes}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onAdd={() => setAddModalVisible(true)}
          onEdit={openEditModal}
          onDelete={handleDeleteMax}
          onVerify={handleVerifyMax}
          getMetricDisplayName={getMetricDisplayName}
          getMetricUnit={getMetricUnit}
          isGlobalMetric={isGlobalMetric}
        />
      ) : (
        <ExerciseHistoryView
          athleteId={athleteId}
          timeRange={timeRange}
          setTimeRange={setTimeRange}
          category={category}
          setCategory={setCategory}
          loggedExercises={loggedExercises}
          filteredLoggedExercises={filteredLoggedExercises}
          selectedExercises={selectedExercises}
          toggleExerciseSelection={toggleExerciseSelection}
          exerciseDropdownOpen={exerciseDropdownOpen}
          setExerciseDropdownOpen={setExerciseDropdownOpen}
          exerciseSearchQuery={exerciseSearchQuery}
          setExerciseSearchQuery={setExerciseSearchQuery}
          customMeasurements={customMeasurements}
        />
      )}

      {/* Add Max Modal */}
      <Modal
        visible={addModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setAddModalVisible(false);
          resetAddForm();
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              setAddModalVisible(false);
              resetAddForm();
            }}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Personal Record</Text>
              <TouchableOpacity
                onPress={() => {
                  setAddModalVisible(false);
                  resetAddForm();
                }}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={{ paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* 1. Measurement */}
              <Text style={styles.inputLabel}>Measurement *</Text>
              <TouchableOpacity
                style={styles.simpleDropdown}
                onPress={() => setMetricDropdownOpen(!metricDropdownOpen)}
              >
                <Text style={selectedMetricType ? styles.simpleDropdownText : styles.simpleDropdownPlaceholder}>
                  {selectedMetricType ? getMetricDisplayName(selectedMetricType) : 'Select measurement...'}
                </Text>
                <Ionicons name={metricDropdownOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#9CA3AF" />
              </TouchableOpacity>
              {metricDropdownOpen && (
                <ScrollView style={styles.simpleDropdownList} nestedScrollEnabled showsVerticalScrollIndicator={true}>
                  {/* Global Metrics */}
                  <Text style={styles.simpleDropdownSection}>Global Metrics</Text>
                  {GLOBAL_METRICS.map(metric => (
                    <TouchableOpacity
                      key={metric.id}
                      style={[styles.simpleDropdownItem, selectedMetricType === metric.id && styles.simpleDropdownItemActive]}
                      onPress={() => { setSelectedMetricType(metric.id); setSelectedExercise(null); setMetricDropdownOpen(false); }}
                    >
                      <Text style={styles.simpleDropdownItemText}>{metric.name} ({metric.unit})</Text>
                      {selectedMetricType === metric.id && <Ionicons name="checkmark" size={16} color="#9BDDFF" />}
                    </TouchableOpacity>
                  ))}

                  {/* Weight - Standard lifting metric */}
                  <Text style={styles.simpleDropdownSection}>Lifting</Text>
                  <TouchableOpacity
                    style={[styles.simpleDropdownItem, selectedMetricType === 'weight' && styles.simpleDropdownItemActive]}
                    onPress={() => { setSelectedMetricType('weight'); setMetricDropdownOpen(false); }}
                  >
                    <Text style={styles.simpleDropdownItemText}>Weight (lbs)</Text>
                    {selectedMetricType === 'weight' && <Ionicons name="checkmark" size={16} color="#9BDDFF" />}
                  </TouchableOpacity>

                  {/* All Custom Measurements from Database */}
                  {customMeasurements.length > 0 && (
                    <>
                      <Text style={styles.simpleDropdownSection}>Custom Measurements</Text>
                      {customMeasurements.map(cm => (
                        <React.Fragment key={cm.id}>
                          {/* Primary metric (e.g., reps) */}
                          <TouchableOpacity
                            style={[styles.simpleDropdownItem, selectedMetricType === cm.primary_metric_id && styles.simpleDropdownItemActive]}
                            onPress={() => { setSelectedMetricType(cm.primary_metric_id); setMetricDropdownOpen(false); }}
                          >
                            <Text style={styles.simpleDropdownItemText}>{cm.name} - {cm.primary_metric_name}</Text>
                            {selectedMetricType === cm.primary_metric_id && <Ionicons name="checkmark" size={16} color="#9BDDFF" />}
                          </TouchableOpacity>
                          {/* Secondary metric if exists (e.g., velocity) */}
                          {cm.secondary_metric_id && cm.secondary_metric_name && (
                            <TouchableOpacity
                              style={[styles.simpleDropdownItem, selectedMetricType === cm.secondary_metric_id && styles.simpleDropdownItemActive]}
                              onPress={() => { setSelectedMetricType(cm.secondary_metric_id!); setMetricDropdownOpen(false); }}
                            >
                              <Text style={styles.simpleDropdownItemText}>{cm.name} - {cm.secondary_metric_name} {cm.secondary_metric_unit ? `(${cm.secondary_metric_unit})` : ''}</Text>
                              {selectedMetricType === cm.secondary_metric_id && <Ionicons name="checkmark" size={16} color="#9BDDFF" />}
                            </TouchableOpacity>
                          )}
                        </React.Fragment>
                      ))}
                    </>
                  )}
                </ScrollView>
              )}

              {/* 2. Exercise (only for weight) */}
              {selectedMetricType && !isGlobalMetric(selectedMetricType) && (
                <>
                  <Text style={[styles.inputLabel, { marginTop: 16 }]}>Exercise *</Text>
                  <View style={styles.simpleSearchBox}>
                    <Ionicons name="search" size={16} color="#6B7280" />
                    <TextInput
                      style={styles.simpleSearchInput}
                      placeholder="Search..."
                      placeholderTextColor="#6B7280"
                      value={exerciseSearchQuery}
                      onChangeText={setExerciseSearchQuery}
                    />
                  </View>
                  <ScrollView style={styles.simpleExerciseList} nestedScrollEnabled>
                    {exercises
                      .filter(e => !exerciseSearchQuery || e.name.toLowerCase().includes(exerciseSearchQuery.toLowerCase()))
                      .slice(0, 10)
                      .map(exercise => (
                        <TouchableOpacity
                          key={exercise.id}
                          style={[styles.simpleExerciseItem, selectedExercise === exercise.id && styles.simpleExerciseItemActive]}
                          onPress={() => setSelectedExercise(exercise.id)}
                        >
                          <Text style={[styles.simpleExerciseItemText, selectedExercise === exercise.id && styles.simpleExerciseItemTextActive]}>
                            {exercise.name}
                          </Text>
                          {selectedExercise === exercise.id && <Ionicons name="checkmark" size={16} color="#9BDDFF" />}
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </>
              )}

              {/* 3. Value + Reps */}
              <View style={[styles.inputRow, { marginTop: 16 }]}>
                <View style={styles.inputHalf}>
                  <Text style={styles.inputLabel}>Value *</Text>
                  <TextInput
                    style={styles.textInput}
                    value={maxValue}
                    onChangeText={setMaxValue}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor="#6B7280"
                  />
                </View>
                {selectedMetricType && !isGlobalMetric(selectedMetricType) && (
                  <View style={styles.inputHalf}>
                    <Text style={styles.inputLabel}>Reps</Text>
                    <TextInput
                      style={styles.textInput}
                      value={repsAtMax}
                      onChangeText={setRepsAtMax}
                      keyboardType="number-pad"
                      placeholder="1"
                      placeholderTextColor="#6B7280"
                    />
                  </View>
                )}
              </View>

              {/* 4. Date */}
              <Text style={[styles.inputLabel, { marginTop: 16 }]}>Date *</Text>
              <TextInput
                style={styles.textInput}
                value={achievedDate}
                onChangeText={setAchievedDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#6B7280"
              />
            </ScrollView>

            {/* Save */}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonCancel} onPress={() => { setAddModalVisible(false); resetAddForm(); }}>
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalButtonSubmit} onPress={handleAddMax}>
                <Text style={styles.modalButtonSubmitText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Max Modal */}
      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setEditModalVisible(false);
          resetEditForm();
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={styles.modalDismissArea}
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              setEditModalVisible(false);
              resetEditForm();
            }}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Personal Record</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditModalVisible(false);
                  resetEditForm();
                }}
                style={styles.modalClose}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Read-only exercise info */}
              {editingMax && editingMax.exercises && (
                <>
                  <Text style={styles.inputLabel}>Exercise</Text>
                  <View style={styles.readOnlyField}>
                    <Text style={styles.readOnlyText}>{editingMax.exercises.name}</Text>
                  </View>
                </>
              )}

              {/* Read-only metric info */}
              {editingMax && (
                <>
                  <Text style={styles.inputLabel}>Metric Type</Text>
                  <View style={styles.readOnlyField}>
                    <Text style={styles.readOnlyText}>
                      {getMetricDisplayName(editingMax.metric_id)}
                    </Text>
                  </View>
                </>
              )}

              {/* Global Metric Banner */}
              {editingMax && isGlobalMetric(editingMax.metric_id) && (
                <View style={styles.globalBanner}>
                  <Ionicons name="information-circle" size={20} color="#8B5CF6" />
                  <View style={styles.globalBannerText}>
                    <Text style={styles.globalBannerTitle}>GLOBAL METRIC</Text>
                    <Text style={styles.globalBannerSubtitle}>
                      This metric is tracked globally across all exercises
                    </Text>
                  </View>
                </View>
              )}

              {/* Max Value */}
              <View style={styles.inputRow}>
                <View style={styles.inputHalf}>
                  <Text style={styles.inputLabel}>Max Value *</Text>
                  <TextInput
                    style={styles.textInput}
                    value={maxValue}
                    onChangeText={setMaxValue}
                    keyboardType="decimal-pad"
                    placeholder="0.0"
                    placeholderTextColor="#6B7280"
                  />
                </View>
                {editingMax?.metric_id.toLowerCase().includes('weight') && (
                  <View style={styles.inputHalf}>
                    <Text style={styles.inputLabel}>Reps</Text>
                    <TextInput
                      style={styles.textInput}
                      value={repsAtMax}
                      onChangeText={setRepsAtMax}
                      keyboardType="number-pad"
                      placeholder="1"
                      placeholderTextColor="#6B7280"
                    />
                  </View>
                )}
              </View>

              {/* Date */}
              <Text style={styles.inputLabel}>Date Achieved *</Text>
              <TextInput
                style={styles.textInput}
                value={achievedDate}
                onChangeText={setAchievedDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#6B7280"
              />

              {/* Notes */}
              <Text style={styles.inputLabel}>Notes (optional)</Text>
              <TextInput
                style={[styles.textInput, styles.textInputMultiline]}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                placeholder="e.g., Max test day, felt strong"
                placeholderTextColor="#6B7280"
              />
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => {
                  setEditModalVisible(false);
                  resetEditForm();
                }}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalButtonSubmit}
                onPress={handleEditMax}
              >
                <Text style={styles.modalButtonSubmitText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* FAB Button - Dynamic based on athlete data (matching DashboardScreen exactly) */}
      <View style={styles.fabContainer}>
        {/* Notification Badge on FAB */}
        {(unreadMessagesCount + newResourcesCount) > 0 && !fabOpen && (
          <View style={styles.fabNotificationBadge}>
            <Text style={styles.fabNotificationBadgeText}>
              {(unreadMessagesCount + newResourcesCount) > 99 ? '99+' : unreadMessagesCount + newResourcesCount}
            </Text>
          </View>
        )}
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

        {/* FAB Menu - Dynamic items based on athlete data */}
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
              {/* ALWAYS SHOWN: Home */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate(isParent ? 'ParentDashboard' : 'Dashboard');
                }}
              >
                <Ionicons name="home" size={20} color="#FFFFFF" />
                <Text style={styles.fabMenuLabel}>Home</Text>
              </TouchableOpacity>

              {/* ALWAYS SHOWN: Messages with badge */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Messages');
                }}
              >
                <View style={styles.fabMenuIconContainer}>
                  <Ionicons name="chatbubble" size={20} color="#FFFFFF" />
                  {unreadMessagesCount > 0 && (
                    <View style={styles.fabMenuItemBadge}>
                      <Text style={styles.fabMenuItemBadgeText}>
                        {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.fabMenuLabel}>Messages</Text>
              </TouchableOpacity>

              {/* ALWAYS SHOWN: Performance - ACTIVE */}
              <TouchableOpacity
                style={[styles.fabMenuItem, styles.fabMenuItemActive]}
                onPress={() => setFabOpen(false)}
              >
                <Ionicons name="stats-chart" size={20} color="#9BDDFF" />
                <Text style={[styles.fabMenuLabel, styles.fabMenuLabelActive]}>Performance</Text>
              </TouchableOpacity>

              {/* ALWAYS SHOWN: Leaderboard */}
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

              {/* CONDITIONAL: Hitting - only if hasHittingData */}
              {hasHittingData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('HittingPerformance', { athleteId });
                  }}
                >
                  <MaterialCommunityIcons name="baseball-bat" size={20} color="#EF4444" />
                  <Text style={styles.fabMenuLabel}>Hitting</Text>
                </TouchableOpacity>
              )}

              {/* CONDITIONAL: Pitching - only if hasPitchingData */}
              {hasPitchingData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('PitchingPerformance', { athleteId });
                  }}
                >
                  <MaterialCommunityIcons name="baseball" size={20} color="#3B82F6" />
                  <Text style={styles.fabMenuLabel}>Pitching</Text>
                </TouchableOpacity>
              )}

              {/* CONDITIONAL: Arm Care - only if hasArmCareData */}
              {hasArmCareData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('ArmCare', { athleteId });
                  }}
                >
                  <MaterialCommunityIcons name="arm-flex" size={20} color="#10B981" />
                  <Text style={styles.fabMenuLabel}>Arm Care</Text>
                </TouchableOpacity>
              )}

              {/* CONDITIONAL: Force Profile - only if hasForceProfileData */}
              {hasForceProfileData && (
                <TouchableOpacity
                  style={styles.fabMenuItem}
                  onPress={() => {
                    setFabOpen(false);
                    navigation.navigate('ForceProfile', { athleteId });
                  }}
                >
                  <Ionicons name="trending-up" size={20} color="#A855F7" />
                  <Text style={styles.fabMenuLabel}>Force Profile</Text>
                </TouchableOpacity>
              )}

              {/* Notes/Resources - always visible, with badge for new items */}
              <TouchableOpacity
                style={styles.fabMenuItem}
                onPress={() => {
                  setFabOpen(false);
                  navigation.navigate('Resources', { athleteId });
                }}
              >
                <View style={styles.fabMenuIconContainer}>
                  <Ionicons name="document-text" size={20} color="#F59E0B" />
                  {newResourcesCount > 0 && (
                    <View style={styles.fabMenuItemBadge}>
                      <Text style={styles.fabMenuItemBadgeText}>
                        {newResourcesCount > 9 ? '9+' : newResourcesCount}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.fabMenuLabel}>Notes/Resources</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

// Personal Records View Component
function PersonalRecordsView({
  maxes,
  globalMaxes,
  exerciseMaxes,
  searchQuery,
  setSearchQuery,
  onAdd,
  onEdit,
  onDelete,
  onVerify,
  getMetricDisplayName,
  getMetricUnit,
  isGlobalMetric,
}: {
  maxes: AthleteMax[];
  globalMaxes: AthleteMax[];
  exerciseMaxes: AthleteMax[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onAdd: () => void;
  onEdit: (max: AthleteMax) => void;
  onDelete: (id: string) => void;
  onVerify: (id: string) => void;
  getMetricDisplayName: (id: string) => string;
  getMetricUnit: (id: string) => string;
  isGlobalMetric: (id: string) => boolean;
}) {
  return (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      {/* Search + Add */}
      <View style={styles.searchAddRow}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color="#6B7280" />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search exercises..."
            placeholderTextColor="#6B7280"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.addButton} onPress={onAdd}>
          <Ionicons name="add" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      {maxes.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateIcon}>🏆</Text>
          <Text style={styles.emptyStateTitle}>No Personal Records Yet</Text>
          <Text style={styles.emptyStateText}>
            Add your first max or complete workouts to start tracking your progress!
          </Text>
        </View>
      ) : (
        <>
          {/* Global Metrics Section */}
          {globalMaxes.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>● GLOBAL METRICS</Text>
              {globalMaxes.map(max => (
                <MaxCard
                  key={max.id}
                  max={max}
                  getMetricDisplayName={getMetricDisplayName}
                  getMetricUnit={getMetricUnit}
                  isGlobalMetric={isGlobalMetric}
                  onEdit={() => onEdit(max)}
                  onDelete={() => onDelete(max.id)}
                  onVerify={() => onVerify(max.id)}
                />
              ))}
            </>
          )}

          {/* Exercise PRs Section */}
          {exerciseMaxes.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>● EXERCISE PRs</Text>
              {exerciseMaxes.map(max => (
                <MaxCard
                  key={max.id}
                  max={max}
                  getMetricDisplayName={getMetricDisplayName}
                  getMetricUnit={getMetricUnit}
                  isGlobalMetric={isGlobalMetric}
                  onEdit={() => onEdit(max)}
                  onDelete={() => onDelete(max.id)}
                  onVerify={() => onVerify(max.id)}
                />
              ))}
            </>
          )}
        </>
      )}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

// Max Card Component
function MaxCard({
  max,
  getMetricDisplayName,
  getMetricUnit,
  isGlobalMetric,
  onEdit,
  onDelete,
  onVerify,
}: {
  max: AthleteMax;
  getMetricDisplayName: (id: string) => string;
  getMetricUnit: (id: string) => string;
  isGlobalMetric: (id: string) => boolean;
  onEdit: () => void;
  onDelete: () => void;
  onVerify: () => void;
}) {
  const isGlobal = isGlobalMetric(max.metric_id);
  const unit = getMetricUnit(max.metric_id);
  const metricName = getMetricDisplayName(max.metric_id);

  return (
    <View style={styles.maxCard}>
      <View style={styles.maxCardHeader}>
        <View style={styles.maxCardInfo}>
          <Text style={styles.maxCardExercise}>
            {max.exercises?.name || metricName}
          </Text>
          <View style={styles.maxCardBadges}>
            {!isGlobal && (
              <View style={styles.badgeBlue}>
                <Text style={styles.badgeBlueText}>{metricName}</Text>
              </View>
            )}
            {isGlobal && (
              <View style={styles.badgePurple}>
                <Text style={styles.badgePurpleText}>Global</Text>
              </View>
            )}
            {max.source === 'logged' && (
              <View style={styles.badgeGreen}>
                <Text style={styles.badgeGreenText}>Auto</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <View style={styles.maxCardBody}>
        <Text style={styles.maxCardValue}>
          {max.max_value.toFixed(1)} {unit}
          {max.reps_at_max && <Text style={styles.maxCardReps}> ({max.reps_at_max} reps)</Text>}
        </Text>
        <Text style={styles.maxCardDate}>
          {formatDate(max.achieved_on)}
          {max.verified_by_coach && (
            <Text style={styles.maxCardVerified}> ✓ Verified</Text>
          )}
        </Text>
        {max.notes && (
          <Text style={styles.maxCardNotes} numberOfLines={1}>{max.notes}</Text>
        )}
      </View>

      <View style={styles.maxCardActions}>
        {!max.verified_by_coach && (
          <TouchableOpacity style={styles.actionButtonVerify} onPress={onVerify}>
            <Text style={styles.actionButtonVerifyText}>Verify</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionButtonEdit} onPress={onEdit}>
          <Text style={styles.actionButtonEditText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButtonDelete} onPress={onDelete}>
          <Text style={styles.actionButtonDeleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Exercise History View Component
function ExerciseHistoryView({
  athleteId,
  timeRange,
  setTimeRange,
  category,
  setCategory,
  loggedExercises,
  filteredLoggedExercises,
  selectedExercises,
  toggleExerciseSelection,
  exerciseDropdownOpen,
  setExerciseDropdownOpen,
  exerciseSearchQuery,
  setExerciseSearchQuery,
  customMeasurements,
}: {
  athleteId: string;
  timeRange: TimeRange;
  setTimeRange: (t: TimeRange) => void;
  category: Category;
  setCategory: (c: Category) => void;
  loggedExercises: Exercise[];
  filteredLoggedExercises: Exercise[];
  selectedExercises: string[];
  toggleExerciseSelection: (id: string) => void;
  exerciseDropdownOpen: boolean;
  setExerciseDropdownOpen: (open: boolean) => void;
  exerciseSearchQuery: string;
  setExerciseSearchQuery: (q: string) => void;
  customMeasurements: CustomMeasurement[];
}) {
  const categories: { key: Category; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'throwing', label: 'Throwing' },
    { key: 'hitting', label: 'Hitting' },
    { key: 'strength_conditioning', label: 'S&C' },
  ];

  return (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      {/* Timeframe Selector */}
      <View style={styles.timeRangeContainer}>
        {(['7d', '30d', '90d', 'all'] as TimeRange[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.timeRangeButton, timeRange === t && styles.timeRangeButtonActive]}
            onPress={() => setTimeRange(t)}
          >
            <Text style={[styles.timeRangeText, timeRange === t && styles.timeRangeTextActive]}>
              {t === 'all' ? 'All' : t.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Category Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryContainer}>
        {categories.map(cat => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.categoryButton, category === cat.key && styles.categoryButtonActive]}
            onPress={() => {
              setCategory(cat.key);
              // Clear selections when changing category
            }}
          >
            <Text style={[styles.categoryText, category === cat.key && styles.categoryTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Exercise Dropdown */}
      <TouchableOpacity
        style={styles.exerciseDropdown}
        onPress={() => setExerciseDropdownOpen(!exerciseDropdownOpen)}
      >
        <View style={styles.exerciseDropdownLeft}>
          <Ionicons name="search" size={18} color="#6B7280" />
          <Text style={styles.exerciseDropdownText}>
            {selectedExercises.length > 0
              ? `${selectedExercises.length} exercise${selectedExercises.length > 1 ? 's' : ''} selected`
              : 'Search and select exercises...'}
          </Text>
        </View>
        <View style={styles.exerciseDropdownRight}>
          <View style={styles.exerciseCountBadge}>
            <Text style={styles.exerciseCountText}>{selectedExercises.length}/10</Text>
          </View>
          <Ionicons name={exerciseDropdownOpen ? 'chevron-up' : 'chevron-down'} size={18} color="#9CA3AF" />
        </View>
      </TouchableOpacity>

      {/* Dropdown Content */}
      {exerciseDropdownOpen && (
        <View style={styles.dropdownContent}>
          <View style={styles.dropdownSearchContainer}>
            <Ionicons name="search" size={16} color="#6B7280" />
            <TextInput
              style={styles.dropdownSearchInput}
              value={exerciseSearchQuery}
              onChangeText={setExerciseSearchQuery}
              placeholder="Filter exercises..."
              placeholderTextColor="#6B7280"
            />
          </View>
          <Text style={styles.dropdownCount}>
            Found {filteredLoggedExercises.length} exercises in {category === 'all' ? 'All Categories' : category}
          </Text>
          <ScrollView style={styles.dropdownList} nestedScrollEnabled>
            {filteredLoggedExercises.map(ex => {
              const isSelected = selectedExercises.includes(ex.id);
              return (
                <TouchableOpacity
                  key={ex.id}
                  style={[styles.dropdownItem, isSelected && styles.dropdownItemSelected]}
                  onPress={() => toggleExerciseSelection(ex.id)}
                >
                  <View style={[styles.dropdownCheckbox, isSelected && styles.dropdownCheckboxSelected]}>
                    {isSelected && <Ionicons name="checkmark" size={14} color="#000" />}
                  </View>
                  <Text style={[styles.dropdownItemText, isSelected && styles.dropdownItemTextSelected]}>
                    {ex.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Selected Pills */}
      {selectedExercises.length > 0 && (
        <View style={styles.selectedPillsContainer}>
          {selectedExercises.map(exId => {
            const exercise = loggedExercises.find(e => e.id === exId);
            return (
              <View key={exId} style={styles.selectedPill}>
                <Text style={styles.selectedPillText}>{exercise?.name || exId}</Text>
                <TouchableOpacity onPress={() => toggleExerciseSelection(exId)}>
                  <Ionicons name="close" size={16} color="#9BDDFF" />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {/* Exercise Performance Cards */}
      {selectedExercises.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="fitness" size={48} color="#6B7280" />
          <Text style={styles.emptyStateTitle}>No Exercises Selected</Text>
          <Text style={styles.emptyStateText}>
            Select up to 10 exercises above to view their performance history
          </Text>
        </View>
      ) : (
        selectedExercises.map(exId => {
          const exercise = loggedExercises.find(e => e.id === exId);
          if (!exercise) return null;
          return (
            <ExercisePerformanceCard
              key={exId}
              athleteId={athleteId}
              exercise={exercise}
              timeRange={timeRange}
              customMeasurements={customMeasurements}
            />
          );
        })
      )}

      <View style={{ height: 100 }} />
    </ScrollView>
  );
}

// Exercise Performance Card Component
function ExercisePerformanceCard({
  athleteId,
  exercise,
  timeRange,
  customMeasurements,
}: {
  athleteId: string;
  exercise: Exercise;
  timeRange: TimeRange;
  customMeasurements: CustomMeasurement[];
}) {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<ExerciseLog[]>([]);
  const [prs, setPrs] = useState<{ metric_id: string; max_value: number; achieved_on: string }[]>([]);
  const [activeTab, setActiveTab] = useState<'volume' | 'metrics' | null>(null); // Will be set based on available data

  useEffect(() => {
    fetchExerciseData();
  }, [exercise.id, timeRange]);

  async function fetchExerciseData() {
    setLoading(true);
    try {
      // Calculate date filter
      let dateFilter: string | null = null;
      const now = new Date();
      if (timeRange === '7d') {
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      } else if (timeRange === '30d') {
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      } else if (timeRange === '90d') {
        dateFilter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      }

      // Fetch exercise logs
      let query = supabase
        .from('exercise_logs')
        .select('id, workout_instance_id, set_number, actual_reps, actual_weight, metric_data, created_at, workout_instances(completed_at)')
        .eq('athlete_id', athleteId)
        .eq('exercise_id', exercise.id)
        .order('created_at', { ascending: true });

      if (dateFilter) {
        query = query.gte('created_at', dateFilter);
      }

      const { data: logsData, error: logsError } = await query;
      if (logsError) throw logsError;
      setLogs(logsData || []);

      // Fetch PRs for this exercise
      const { data: prsData, error: prsError } = await supabase
        .from('athlete_maxes')
        .select('metric_id, max_value, achieved_on')
        .eq('athlete_id', athleteId)
        .eq('exercise_id', exercise.id);

      if (prsError) throw prsError;
      setPrs(prsData || []);
    } catch (err) {
      console.error('Error fetching exercise data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Detect metrics from logs
  const detectedMetrics = useMemo(() => {
    const metricSet = new Set<string>();
    logs.forEach(log => {
      if (log.metric_data) {
        Object.keys(log.metric_data).forEach(key => {
          if (log.metric_data[key] !== null) {
            metricSet.add(key);
          }
        });
      }
    });

    // Build primary metric IDs to skip
    const primaryIds = new Set<string>();
    customMeasurements.forEach(cm => {
      if (cm.category === 'paired') {
        primaryIds.add(cm.primary_metric_id);
      }
    });

    // Build detected metrics (skip primaries)
    const detected: DetectedMetric[] = [];
    metricSet.forEach(metricId => {
      if (primaryIds.has(metricId)) return; // Skip primary metrics (reps)

      // Find label from custom measurements
      let label = formatMetricLabel(metricId);
      let unit = '';
      for (const cm of customMeasurements) {
        if (cm.secondary_metric_id === metricId) {
          label = `${cm.name} ${cm.secondary_metric_name}`;
          unit = cm.secondary_metric_unit || '';
          break;
        }
      }

      detected.push({
        metricId,
        label,
        color: getColorForMetric(metricId),
        unit,
      });
    });

    return detected;
  }, [logs, customMeasurements]);

  // Check if we have volume data (weight + reps)
  const hasVolumeData = logs.some(log => log.actual_weight && log.actual_reps);
  const hasMetricData = detectedMetrics.length > 0;

  // Set default tab based on available data
  useEffect(() => {
    if (!loading && activeTab === null) {
      // Prefer metrics if available, otherwise show volume
      if (hasMetricData) {
        setActiveTab('metrics');
      } else if (hasVolumeData) {
        setActiveTab('volume');
      }
    }
  }, [loading, hasMetricData, hasVolumeData, activeTab]);

  // Build chart data
  const chartData = useMemo(() => {
    // Group logs by workout instance
    const sessions = new Map<string, ExerciseLog[]>();
    logs.forEach(log => {
      const key = log.workout_instance_id || log.created_at;
      if (!sessions.has(key)) {
        sessions.set(key, []);
      }
      sessions.get(key)!.push(log);
    });

    // Build data points
    const points: any[] = [];
    sessions.forEach((sessionLogs, sessionId) => {
      const firstLog = sessionLogs[0];
      const date = (firstLog.workout_instances as any)?.completed_at || firstLog.created_at;

      const point: any = { date: formatDateShort(date) };

      // Calculate volume
      if (hasVolumeData) {
        let totalVolume = 0;
        sessionLogs.forEach(log => {
          if (log.actual_weight && log.actual_reps) {
            totalVolume += log.actual_weight * log.actual_reps;
          }
        });
        point.volume = totalVolume;
      }

      // Get peak metric values
      detectedMetrics.forEach(metric => {
        let maxVal = 0;
        sessionLogs.forEach(log => {
          const val = log.metric_data?.[metric.metricId];
          if (typeof val === 'number' && val > maxVal) {
            maxVal = val;
          }
        });
        if (maxVal > 0) {
          point[metric.metricId] = maxVal;
        }
      });

      points.push(point);
    });

    return points;
  }, [logs, detectedMetrics, hasVolumeData]);

  // Get category badge
  const categoryBadge = exercise.categories?.[0] || 'other';
  const categoryColors: Record<string, string> = {
    throwing: '#3B82F6',
    hitting: '#EF4444',
    strength_conditioning: '#F59E0B',
    other: '#6B7280',
  };

  if (loading) {
    return (
      <View style={styles.exerciseCard}>
        <View style={styles.exerciseCardHeader}>
          <Text style={styles.exerciseCardTitle}>{exercise.name}</Text>
        </View>
        <ActivityIndicator color="#9BDDFF" style={{ marginVertical: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.exerciseCard}>
      {/* Header */}
      <View style={styles.exerciseCardHeader}>
        <Text style={styles.exerciseCardTitle}>{exercise.name}</Text>
        <View style={[styles.categoryBadge, { backgroundColor: categoryColors[categoryBadge] + '30' }]}>
          <Text style={[styles.categoryBadgeText, { color: categoryColors[categoryBadge] }]}>
            {categoryBadge === 'strength_conditioning' ? 'S&C' : categoryBadge.charAt(0).toUpperCase() + categoryBadge.slice(1)}
          </Text>
        </View>
      </View>

      {/* PRs Section */}
      {prs.length > 0 && (
        <View style={styles.prSection}>
          <View style={styles.prHeader}>
            <Ionicons name="star" size={14} color="#F59E0B" />
            <Text style={styles.prHeaderText}>Personal Records</Text>
          </View>
          {prs.slice(0, 3).map((pr, idx) => {
            const metricLabel = formatMetricLabel(pr.metric_id);
            return (
              <View key={idx} style={styles.prItem}>
                <Text style={styles.prMetric}>{metricLabel}: {pr.max_value.toFixed(1)}</Text>
                <Text style={styles.prDate}>{timeAgo(pr.achieved_on)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Tab Toggle (if both volume and metrics available) */}
      {hasVolumeData && hasMetricData && (
        <View style={styles.chartTabs}>
          <TouchableOpacity
            style={[styles.chartTab, activeTab === 'volume' && styles.chartTabActiveVolume]}
            onPress={() => setActiveTab('volume')}
          >
            <Text style={[styles.chartTabText, activeTab === 'volume' && styles.chartTabTextActive]}>Volume</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chartTab, activeTab === 'metrics' && styles.chartTabActiveMetrics]}
            onPress={() => setActiveTab('metrics')}
          >
            <Text style={[styles.chartTabText, activeTab === 'metrics' && styles.chartTabTextActive]}>Metrics</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Chart */}
      {chartData.length > 0 ? (
        <View style={styles.chartContainer}>
          {activeTab === 'volume' && hasVolumeData ? (
            <LineChart
              data={chartData}
              dataKey="volume"
              color="#F59E0B"
              label="Volume (lbs)"
            />
          ) : activeTab === 'metrics' && hasMetricData ? (
            <MultiLineChart
              data={chartData}
              metrics={detectedMetrics}
            />
          ) : hasVolumeData ? (
            // Fallback: show volume chart if no metrics but volume exists
            <LineChart
              data={chartData}
              dataKey="volume"
              color="#F59E0B"
              label="Volume (lbs)"
            />
          ) : (
            <View style={styles.noChartData}>
              <Text style={styles.noChartDataText}>No chart data available</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.noChartData}>
          <Text style={styles.noChartDataText}>No data for selected timeframe</Text>
        </View>
      )}

      {/* Legend (for metrics chart) */}
      {activeTab === 'metrics' && detectedMetrics.length > 1 && (
        <View style={styles.chartLegend}>
          {detectedMetrics.map(metric => (
            <View key={metric.metricId} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: metric.color }]} />
              <Text style={styles.legendText}>{metric.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// Simple Line Chart Component (SVG)
function LineChart({
  data,
  dataKey,
  color,
  label,
}: {
  data: any[];
  dataKey: string;
  color: string;
  label: string;
}) {
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; y: number; date: string; value: number } | null>(null);

  const width = SCREEN_WIDTH - 80;
  const height = 150;
  const padding = { top: 20, right: 10, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Get values
  const values = data.map(d => d[dataKey] || 0).filter(v => v > 0);
  if (values.length === 0) return null;

  const minVal = Math.min(...values) * 0.9;
  const maxVal = Math.max(...values) * 1.1;
  const range = maxVal - minVal || 1;

  // Build path
  const points = data
    .filter(d => d[dataKey] > 0)
    .map((d, i, arr) => {
      const x = padding.left + (i / Math.max(arr.length - 1, 1)) * chartWidth;
      const y = padding.top + chartHeight - ((d[dataKey] - minVal) / range) * chartHeight;
      return { x, y, date: d.date, value: d[dataKey] };
    });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Handle touch to find nearest point
  const handleTouch = (evt: any) => {
    const touchX = evt.nativeEvent.locationX;
    const touchY = evt.nativeEvent.locationY;

    // Find nearest point within 30px
    let nearestPoint = null;
    let minDistance = 30;

    for (const point of points) {
      const distance = Math.sqrt(Math.pow(point.x - touchX, 2) + Math.pow(point.y - touchY, 2));
      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = point;
      }
    }

    setSelectedPoint(nearestPoint);
  };

  return (
    <View>
      <TouchableOpacity activeOpacity={1} onPress={handleTouch}>
        <Svg width={width} height={height}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = padding.top + chartHeight * (1 - ratio);
            const val = minVal + range * ratio;
            return (
              <G key={i}>
                <Line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={1}
                />
                <SvgText
                  x={padding.left - 8}
                  y={y + 4}
                  fill="#6B7280"
                  fontSize={10}
                  textAnchor="end"
                >
                  {val.toFixed(0)}
                </SvgText>
              </G>
            );
          })}

          {/* Line path */}
          <Path d={pathD} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {/* Data points */}
          {points.map((p, i) => (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={selectedPoint === p ? 7 : 4}
              fill={color}
              stroke={selectedPoint === p ? '#fff' : 'none'}
              strokeWidth={2}
            />
          ))}

          {/* X-axis labels */}
          {points.length <= 7 && points.map((p, i) => (
            <SvgText
              key={i}
              x={p.x}
              y={height - 5}
              fill="#6B7280"
              fontSize={9}
              textAnchor="middle"
            >
              {p.date}
            </SvgText>
          ))}
        </Svg>
      </TouchableOpacity>

      {/* Tooltip */}
      {selectedPoint && (
        <View style={[
          styles.chartTooltip,
          {
            left: Math.min(Math.max(selectedPoint.x - 60, 10), width - 130),
            top: selectedPoint.y > 80 ? selectedPoint.y - 55 : selectedPoint.y + 15,
          }
        ]}>
          <View style={styles.chartTooltipHeader}>
            <Text style={styles.chartTooltipDate}>{selectedPoint.date}</Text>
            <TouchableOpacity onPress={() => setSelectedPoint(null)} style={styles.chartTooltipClose}>
              <Ionicons name="close" size={14} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
          <View style={styles.chartTooltipBody}>
            <View style={[styles.chartTooltipDot, { backgroundColor: color }]} />
            <Text style={styles.chartTooltipValue}>
              {selectedPoint.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} lbs
            </Text>
          </View>
        </View>
      )}

      {/* Tap hint */}
      {!selectedPoint && (
        <Text style={styles.chartTapHint}>Tap a point to see details</Text>
      )}
    </View>
  );
}

// Multi-Line Chart Component (SVG) - for colored ball velocities
function MultiLineChart({
  data,
  metrics,
}: {
  data: any[];
  metrics: DetectedMetric[];
}) {
  const [selectedPoint, setSelectedPoint] = useState<{
    x: number;
    y: number;
    date: string;
    metric: DetectedMetric;
    value: number;
  } | null>(null);

  const width = SCREEN_WIDTH - 80;
  const height = 150;
  const padding = { top: 20, right: 10, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Get global min/max across all metrics
  let globalMin = Infinity;
  let globalMax = -Infinity;
  metrics.forEach(metric => {
    data.forEach(d => {
      const val = d[metric.metricId];
      if (typeof val === 'number') {
        globalMin = Math.min(globalMin, val);
        globalMax = Math.max(globalMax, val);
      }
    });
  });

  if (globalMin === Infinity || globalMax === -Infinity) return null;

  globalMin *= 0.9;
  globalMax *= 1.1;
  const range = globalMax - globalMin || 1;

  // Build all points with metadata for touch detection
  const allPoints: { x: number; y: number; date: string; metric: DetectedMetric; value: number }[] = [];
  metrics.forEach(metric => {
    data.forEach((d, idx) => {
      const val = d[metric.metricId];
      if (typeof val === 'number') {
        const x = padding.left + (idx / Math.max(data.length - 1, 1)) * chartWidth;
        const y = padding.top + chartHeight - ((val - globalMin) / range) * chartHeight;
        allPoints.push({ x, y, date: d.date, metric, value: val });
      }
    });
  });

  // Handle touch to find nearest point
  const handleTouch = (evt: any) => {
    const touchX = evt.nativeEvent.locationX;
    const touchY = evt.nativeEvent.locationY;

    // Find nearest point within 30px
    let nearestPoint = null;
    let minDistance = 30;

    for (const point of allPoints) {
      const distance = Math.sqrt(Math.pow(point.x - touchX, 2) + Math.pow(point.y - touchY, 2));
      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = point;
      }
    }

    setSelectedPoint(nearestPoint);
  };

  return (
    <View>
      <TouchableOpacity activeOpacity={1} onPress={handleTouch}>
        <Svg width={width} height={height}>
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = padding.top + chartHeight * (1 - ratio);
            const val = globalMin + range * ratio;
            return (
              <G key={i}>
                <Line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={1}
                />
                <SvgText
                  x={padding.left - 8}
                  y={y + 4}
                  fill="#6B7280"
                  fontSize={10}
                  textAnchor="end"
                >
                  {val.toFixed(0)}
                </SvgText>
              </G>
            );
          })}

          {/* Lines for each metric */}
          {metrics.map(metric => {
            const points = data
              .filter(d => typeof d[metric.metricId] === 'number')
              .map((d, i, arr) => {
                const x = padding.left + (data.indexOf(d) / Math.max(data.length - 1, 1)) * chartWidth;
                const y = padding.top + chartHeight - ((d[metric.metricId] - globalMin) / range) * chartHeight;
                return { x, y, value: d[metric.metricId] };
              });

            if (points.length === 0) return null;

            const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

            return (
              <G key={metric.metricId}>
                <Path d={pathD} fill="none" stroke={metric.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                {points.map((p, i) => {
                  const isSelected = selectedPoint &&
                    selectedPoint.metric.metricId === metric.metricId &&
                    Math.abs(selectedPoint.x - p.x) < 1;
                  return (
                    <Circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={isSelected ? 7 : 4}
                      fill={metric.color}
                      stroke={isSelected ? '#fff' : 'none'}
                      strokeWidth={2}
                    />
                  );
                })}
              </G>
            );
          })}

          {/* X-axis labels */}
          {data.length <= 7 && data.map((d, i) => {
            const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth;
            return (
              <SvgText
                key={i}
                x={x}
                y={height - 5}
                fill="#6B7280"
                fontSize={9}
                textAnchor="middle"
              >
                {d.date}
              </SvgText>
            );
          })}
        </Svg>
      </TouchableOpacity>

      {/* Tooltip */}
      {selectedPoint && (
        <View style={[
          styles.chartTooltip,
          {
            left: Math.min(Math.max(selectedPoint.x - 70, 10), width - 150),
            top: selectedPoint.y > 80 ? selectedPoint.y - 65 : selectedPoint.y + 15,
          }
        ]}>
          <View style={styles.chartTooltipHeader}>
            <Text style={styles.chartTooltipDate}>{selectedPoint.date}</Text>
            <TouchableOpacity onPress={() => setSelectedPoint(null)} style={styles.chartTooltipClose}>
              <Ionicons name="close" size={14} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
          <View style={styles.chartTooltipBody}>
            <View style={[styles.chartTooltipDot, { backgroundColor: selectedPoint.metric.color }]} />
            <View>
              <Text style={styles.chartTooltipLabel}>{selectedPoint.metric.label}</Text>
              <Text style={styles.chartTooltipValue}>
                {selectedPoint.value.toFixed(1)} {selectedPoint.metric.unit || 'mph'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Tap hint */}
      {!selectedPoint && (
        <Text style={styles.chartTapHint}>Tap a point to see details</Text>
      )}
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
  },
  loadingText: {
    color: '#9CA3AF',
    marginTop: 12,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 2,
  },
  toggleContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 4,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#9BDDFF',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  toggleTextActive: {
    color: '#000',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  searchAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    marginLeft: 8,
  },
  addButton: {
    backgroundColor: '#9BDDFF',
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    marginBottom: 12,
    marginTop: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  maxCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  maxCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  maxCardInfo: {
    flex: 1,
  },
  maxCardExercise: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 6,
  },
  maxCardBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badgeBlue: {
    backgroundColor: 'rgba(59,130,246,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeBlueText: {
    fontSize: 10,
    color: '#93C5FD',
    fontWeight: '600',
  },
  badgePurple: {
    backgroundColor: 'rgba(139,92,246,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgePurpleText: {
    fontSize: 10,
    color: '#C4B5FD',
    fontWeight: '600',
  },
  badgeGreen: {
    backgroundColor: 'rgba(34,197,94,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeGreenText: {
    fontSize: 10,
    color: '#86EFAC',
    fontWeight: '600',
  },
  maxCardBody: {
    marginBottom: 8,
  },
  maxCardValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  maxCardReps: {
    fontSize: 14,
    fontWeight: '400',
    color: '#9CA3AF',
  },
  maxCardDate: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  maxCardVerified: {
    color: '#4ADE80',
    fontWeight: '600',
  },
  maxCardNotes: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    fontStyle: 'italic',
  },
  maxCardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  actionButtonVerify: {
    backgroundColor: 'rgba(34,197,94,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionButtonVerifyText: {
    fontSize: 12,
    color: '#4ADE80',
    fontWeight: '600',
  },
  actionButtonEdit: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionButtonEditText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  actionButtonDelete: {
    backgroundColor: 'rgba(239,68,68,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionButtonDeleteText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '600',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: '50%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  modalClose: {
    padding: 4,
  },
  modalBody: {
    padding: 16,
    paddingBottom: 24,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    marginBottom: 8,
    marginTop: 12,
  },
  selectContainer: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    maxHeight: 150,
  },
  selectScroll: {
    padding: 8,
  },
  selectGroupTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 8,
    textTransform: 'uppercase',
  },
  selectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  selectOptionActive: {
    backgroundColor: 'rgba(155,221,255,0.1)',
  },
  selectOptionText: {
    fontSize: 14,
    color: '#D1D5DB',
  },
  selectOptionTextActive: {
    color: '#9BDDFF',
    fontWeight: '600',
  },
  globalBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(139,92,246,0.1)',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    gap: 10,
  },
  globalBannerText: {
    flex: 1,
  },
  globalBannerTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8B5CF6',
    letterSpacing: 0.5,
  },
  globalBannerSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  inputHalf: {
    flex: 1,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#fff',
  },
  textInputMultiline: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  // Add Max Modal - PR Type Buttons
  prTypeButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  prTypeButton: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  prTypeButtonActive: {
    backgroundColor: '#9BDDFF',
    borderColor: '#9BDDFF',
  },
  prTypeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginTop: 8,
  },
  prTypeButtonTextActive: {
    color: '#000',
  },
  prTypeButtonSubtext: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  // Quick Select Grid (for velocity types)
  quickSelectGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  quickSelectButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  quickSelectButtonActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  quickSelectText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#D1D5DB',
  },
  quickSelectTextActive: {
    color: '#fff',
  },
  // Exercise Selection Container
  // Simple Add Max Modal styles
  simpleDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  simpleDropdownText: {
    fontSize: 15,
    color: '#fff',
  },
  simpleDropdownPlaceholder: {
    fontSize: 15,
    color: '#6B7280',
  },
  simpleDropdownList: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    maxHeight: 300,
  },
  simpleDropdownSection: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  simpleDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  simpleDropdownItemActive: {
    backgroundColor: 'rgba(155,221,255,0.1)',
  },
  simpleDropdownItemText: {
    fontSize: 14,
    color: '#D1D5DB',
  },
  simpleSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  simpleSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
  },
  simpleExerciseList: {
    maxHeight: 150,
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  simpleExerciseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  simpleExerciseItemActive: {
    backgroundColor: 'rgba(155,221,255,0.1)',
  },
  simpleExerciseItemText: {
    fontSize: 14,
    color: '#D1D5DB',
  },
  simpleExerciseItemTextActive: {
    color: '#9BDDFF',
    fontWeight: '600',
  },
  // Legacy styles (can be removed later)
  exerciseSelectContainer: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 16,
    overflow: 'hidden',
  },
  exerciseSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    gap: 8,
  },
  exerciseSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
    padding: 0,
  },
  exerciseList: {
    maxHeight: 180,
  },
  exerciseListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  exerciseListItemActive: {
    backgroundColor: 'rgba(155,221,255,0.1)',
  },
  exerciseListItemText: {
    fontSize: 14,
    color: '#D1D5DB',
    flex: 1,
  },
  exerciseListItemTextActive: {
    color: '#9BDDFF',
    fontWeight: '600',
  },
  modalButtonDisabled: {
    backgroundColor: 'rgba(59,130,246,0.3)',
  },
  readOnlyField: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readOnlyText: {
    fontSize: 15,
    color: '#6B7280',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  modalButtonCancel: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  modalButtonCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  modalButtonSubmit: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#3B82F6',
  },
  modalButtonSubmitText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  // Exercise History styles
  timeRangeContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  timeRangeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  timeRangeButtonActive: {
    backgroundColor: '#3B82F6',
  },
  timeRangeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  timeRangeTextActive: {
    color: '#fff',
  },
  categoryContainer: {
    marginBottom: 12,
  },
  categoryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  categoryButtonActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  categoryTextActive: {
    color: '#fff',
  },
  exerciseDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 8,
  },
  exerciseDropdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  exerciseDropdownText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  exerciseDropdownRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exerciseCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  exerciseCountText: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  dropdownContent: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  dropdownSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  dropdownSearchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    marginLeft: 8,
  },
  dropdownCount: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 8,
  },
  dropdownList: {
    maxHeight: 200,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 10,
  },
  dropdownItemSelected: {
    backgroundColor: 'rgba(155,221,255,0.1)',
  },
  dropdownCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownCheckboxSelected: {
    backgroundColor: '#9BDDFF',
    borderColor: '#9BDDFF',
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#D1D5DB',
  },
  dropdownItemTextSelected: {
    color: '#9BDDFF',
    fontWeight: '600',
  },
  selectedPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  selectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(155,221,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.3)',
  },
  selectedPillText: {
    fontSize: 12,
    color: '#9BDDFF',
    fontWeight: '500',
  },
  // Exercise Card styles
  exerciseCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  exerciseCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  exerciseCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  prSection: {
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
  },
  prHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  prHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F59E0B',
  },
  prItem: {
    marginBottom: 4,
  },
  prMetric: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '500',
  },
  prDate: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  chartTabs: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  chartTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  chartTabActiveVolume: {
    backgroundColor: '#F59E0B',
  },
  chartTabActiveMetrics: {
    backgroundColor: '#3B82F6',
  },
  chartTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  chartTabTextActive: {
    color: '#fff',
  },
  chartContainer: {
    marginTop: 8,
  },
  noChartData: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  noChartDataText: {
    fontSize: 13,
    color: '#6B7280',
  },
  chartLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  // FAB styles
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
  fabMenuLabel: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  fabNotificationBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    minWidth: 24,
    height: 24,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#000000',
    zIndex: 20,
  },
  fabNotificationBadgeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 4,
  },
  fabMenuItemActive: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(155, 221, 255, 0.3)',
  },
  fabMenuLabelActive: {
    color: '#9BDDFF',
  },
  fabMenuIconContainer: {
    position: 'relative',
  },
  fabMenuItemBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    backgroundColor: '#EF4444',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },
  fabMenuItemBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFFFFF',
    paddingHorizontal: 3,
  },
  // Chart tooltip styles
  chartTooltip: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.95)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    minWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 100,
  },
  chartTooltipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  chartTooltipDate: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  chartTooltipClose: {
    padding: 2,
  },
  chartTooltipBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chartTooltipDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  chartTooltipLabel: {
    fontSize: 10,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  chartTooltipValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  chartTapHint: {
    textAlign: 'center',
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 8,
  },
});
