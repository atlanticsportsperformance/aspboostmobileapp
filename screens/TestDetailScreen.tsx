import React, { useState, useEffect, useRef, useMemo } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Rect, Line, Circle, Text as SvgText, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { supabase } from '../lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Test descriptions for educational purposes
const TEST_DESCRIPTIONS: Record<string, { title: string; description: string; whatItMeasures: string; whyItMatters: string }> = {
  cmj: {
    title: 'Countermovement Jump (CMJ)',
    description: 'A vertical jump test where you start from a standing position, quickly dip down, and explode upward. This is the most commonly used jump test for assessing lower body power.',
    whatItMeasures: 'CMJ measures your ability to use the stretch-shortening cycle (SSC) - the elastic energy stored during the downward phase. Key metrics include jump height, peak power, RSI-modified (reactive strength), and force production.',
    whyItMatters: 'CMJ performance is highly correlated with athletic ability in sports requiring explosive movements like sprinting, changing direction, and jumping. It\'s excellent for tracking neuromuscular fatigue and training adaptations over time.',
  },
  sj: {
    title: 'Squat Jump (SJ)',
    description: 'A vertical jump starting from a static squat position (typically 90° knee angle) without any countermovement. You hold the squat for 2-3 seconds, then explode upward as powerfully as possible.',
    whatItMeasures: 'SJ isolates concentric power production by removing the stretch-shortening cycle. It measures peak power, peak force, and your ability to generate force from a static position. Comparing SJ to CMJ reveals how well you utilize elastic energy.',
    whyItMatters: 'SJ is crucial for sports requiring acceleration from static positions (like linemen in football, track starts). Lower SJ compared to CMJ may indicate poor concentric strength, while similar scores suggest excellent elastic utilization.',
  },
  hj: {
    title: 'Hop Jump (HJ)',
    description: 'A single-leg hopping test where you perform repeated hops on one leg, emphasizing minimal ground contact time and maximal height. This tests fast stretch-shortening cycle capabilities.',
    whatItMeasures: 'HJ primarily measures reactive strength index (RSI) - the ratio of jump height to ground contact time. It assesses your ability to rapidly produce force with minimal ground contact, testing tendon stiffness and neural efficiency.',
    whyItMatters: 'HJ is critical for running speed, agility, and change of direction. High RSI indicates excellent tendon stiffness and reactive strength - key for sprinters, basketball players, and soccer athletes. It\'s also useful for return-to-play assessments after lower limb injuries.',
  },
  ppu: {
    title: 'Plyo Push-Up (PPU)',
    description: 'An explosive plyometric push-up test performed on force plates where you push explosively off the ground. This measures upper body power and explosiveness.',
    whatItMeasures: 'PPU measures peak takeoff force, peak power output, and rate of force development during explosive pushing movements. It assesses your ability to generate force rapidly through the chest, shoulders, and triceps.',
    whyItMatters: 'PPU is critical for sports requiring explosive upper body movements like boxing, MMA, football (blocking/tackling), basketball (posting up), and volleyball (attacking). It complements pressing strength and identifies power deficits.',
  },
  imtp: {
    title: 'Isometric Mid-Thigh Pull (IMTP)',
    description: 'A maximal isometric test where you pull against an immovable barbell set at mid-thigh height. You pull as hard as possible for 3-5 seconds while force is measured.',
    whatItMeasures: 'IMTP measures net peak force (maximum force produced), relative strength (force per kg body weight), RFD (rate of force development), and time to peak force. It assesses your absolute strength and ability to produce force quickly.',
    whyItMatters: 'IMTP is the gold standard for measuring lower body strength without technical skill confounds. High IMTP correlates with 1RM squat/deadlift, sprint speed, and jump performance. It\'s excellent for tracking strength gains.',
  },
};

interface TestMetric {
  metric_name: string;
  display_name: string;
  test_date: string;
  value: number;
  percentile: number;
  sample_size?: number;
}

type TimeRange = '1m' | '3m' | '6m' | '1y' | 'all';

// Zone helpers
const getZoneColor = (percentile: number) => {
  if (percentile >= 75) return '#4ADE80';
  if (percentile >= 50) return '#9BDDFF';
  if (percentile >= 25) return '#FCD34D';
  return '#EF4444';
};

const getZoneLabel = (percentile: number) => {
  if (percentile >= 75) return 'ELITE';
  if (percentile >= 50) return 'OPTIMIZE';
  if (percentile >= 25) return 'SHARPEN';
  return 'BUILD';
};

// Composite score metrics per test type (these get priority/anchored left)
const COMPOSITE_METRICS: Record<string, string[]> = {
  imtp: ['net_peak_vertical_force_trial_value', 'relative_strength_trial_value'],
  sj: ['peak_takeoff_power_trial_value'],
  cmj: ['bodymass_relative_takeoff_power_trial_value'],
  ppu: ['peak_takeoff_force_trial_value'],
  hj: ['hop_mean_rsi_trial_value'],
};

export default function TestDetailScreen({ route, navigation }: any) {
  const { athleteId, testType } = route.params;
  const testTypeLower = testType?.toLowerCase() || '';

  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<TestMetric[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [athleteName, setAthleteName] = useState('');
  const [playLevel, setPlayLevel] = useState('');
  const [compositeMetrics, setCompositeMetrics] = useState<string[]>([]);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchTestHistory();
  }, [athleteId, testType]);

  async function fetchTestHistory() {
    try {
      setLoading(true);

      // Get athlete info
      const { data: athlete } = await supabase
        .from('athletes')
        .select('first_name, last_name, play_level, org_id')
        .eq('id', athleteId)
        .single();

      if (athlete) {
        setAthleteName(`${athlete.first_name} ${athlete.last_name}`);
        setPlayLevel(athlete.play_level || '');
      }

      // Get composite config to know which metrics are "primary"
      let primaryMetrics = COMPOSITE_METRICS[testTypeLower] || [];

      if (athlete?.org_id) {
        const { data: config } = await supabase
          .from('composite_score_configs')
          .select('metrics')
          .eq('org_id', athlete.org_id)
          .eq('is_default', true)
          .maybeSingle();

        if (config?.metrics) {
          // Extract metrics for this test type from the config
          const configMetrics = config.metrics
            .filter((m: any) => m.test_type === testTypeLower)
            .map((m: any) => m.metric);
          if (configMetrics.length > 0) {
            primaryMetrics = configMetrics;
          }
        }
      }

      setCompositeMetrics(primaryMetrics);

      // Get all percentile snapshots for this test type
      const { data: snapshots, error: snapshotsError } = await supabase
        .from('force_plate_percentiles')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('test_type', testTypeLower)
        .order('test_date', { ascending: true });

      if (snapshotsError || !snapshots || snapshots.length === 0) {
        setMetrics([]);
        setLoading(false);
        return;
      }

      // Get all unique metric keys
      const allMetricKeys = new Set<string>();
      snapshots.forEach(snapshot => {
        Object.keys(snapshot.percentiles || {}).forEach(key => allMetricKeys.add(key));
      });

      // Fetch raw values from original test table
      const testTableName = `${testTypeLower}_tests`;
      const testIds = snapshots.map(s => s.test_id);

      const { data: testData } = await supabase
        .from(testTableName)
        .select('*')
        .in('test_id', testIds);

      // Create lookup map
      const testDataMap = new Map();
      (testData || []).forEach(test => {
        testDataMap.set(test.test_id, test);
      });

      // Build metrics array
      const transformedMetrics: TestMetric[] = [];

      for (const metricKey of Array.from(allMetricKeys)) {
        for (const snapshot of snapshots) {
          const percentile = snapshot.percentiles[metricKey];
          const sampleSize = snapshot.sample_sizes?.[metricKey];
          const test = testDataMap.get(snapshot.test_id);
          const rawValue = test?.[metricKey];

          if (typeof percentile === 'number') {
            transformedMetrics.push({
              metric_name: metricKey,
              display_name: formatMetricName(metricKey),
              test_date: snapshot.test_date,
              value: rawValue || 0,
              percentile,
              sample_size: sampleSize,
            });
          }
        }
      }

      setMetrics(transformedMetrics);

      // Set first primary metric as selected, or first metric if no primary
      const firstPrimary = primaryMetrics.find(pm =>
        transformedMetrics.some(m => m.metric_name === pm)
      );
      if (firstPrimary) {
        setSelectedMetric(firstPrimary);
      } else if (transformedMetrics.length > 0) {
        setSelectedMetric(transformedMetrics[0].metric_name);
      }
    } catch (err) {
      console.error('Error fetching test history:', err);
    } finally {
      setLoading(false);
    }
  }

  function formatMetricName(metricKey: string): string {
    return metricKey
      .replace(/_trial_value/g, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  // Get unique metric names
  const uniqueMetrics = Array.from(new Set(metrics.map(m => m.metric_name)));

  // Pre-compute sorted metrics list (primary first, then alphabetical)
  const sortedMetricsList = useMemo(() => {
    return uniqueMetrics.sort((a, b) => {
      const aIsPrimary = compositeMetrics.includes(a);
      const bIsPrimary = compositeMetrics.includes(b);
      if (aIsPrimary && !bIsPrimary) return -1;
      if (!aIsPrimary && bIsPrimary) return 1;
      const aName = metrics.find(m => m.metric_name === a)?.display_name || a;
      const bName = metrics.find(m => m.metric_name === b)?.display_name || b;
      return aName.localeCompare(bName);
    });
  }, [uniqueMetrics, compositeMetrics, metrics]);

  // Filter metrics based on search query
  const filteredMetricsList = useMemo(() => {
    if (!searchQuery.trim()) return sortedMetricsList;
    const query = searchQuery.toLowerCase();
    return sortedMetricsList.filter(m => {
      const displayName = metrics.find(mt => mt.metric_name === m)?.display_name || m;
      return displayName.toLowerCase().includes(query);
    });
  }, [sortedMetricsList, searchQuery, metrics]);

  // Get tests for selected metric
  let selectedMetricData = metrics
    .filter(m => m.metric_name === selectedMetric)
    .sort((a, b) => new Date(a.test_date).getTime() - new Date(b.test_date).getTime());

  // Apply time range filter
  if (timeRange !== 'all') {
    const now = new Date();
    let cutoffDate = new Date();

    switch (timeRange) {
      case '1m':
        cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '3m':
        cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '6m':
        cutoffDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
    }

    selectedMetricData = selectedMetricData.filter(m => new Date(m.test_date) >= cutoffDate);
  }

  const testInfo = TEST_DESCRIPTIONS[testTypeLower] || {
    title: testType?.toUpperCase() || 'Test',
    description: '',
    whatItMeasures: '',
    whyItMatters: '',
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
          <Text style={styles.loadingText}>Loading {testType?.toUpperCase()} data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Calculate stats
  const latestTest = selectedMetricData[selectedMetricData.length - 1];
  const previousTest = selectedMetricData.length > 1 ? selectedMetricData[selectedMetricData.length - 2] : null;
  const percentileChange = previousTest ? latestTest?.percentile - previousTest.percentile : 0;
  const valueChange = (previousTest && latestTest?.value != null && previousTest.value != null && previousTest.value !== 0)
    ? ((latestTest.value - previousTest.value) / previousTest.value) * 100
    : 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{testInfo.title}</Text>
          <Text style={styles.headerSubtitle}>{athleteName}</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {metrics.length === 0 ? (
          <View style={styles.noDataContainer}>
            <Ionicons name="analytics-outline" size={48} color="#6B7280" />
            <Text style={styles.noDataTitle}>No {testType?.toUpperCase()} Data</Text>
            <Text style={styles.noDataText}>Complete a {testInfo.title} test to see your results here.</Text>
          </View>
        ) : (
          <>
            {/* Metric Dropdown Selector */}
            {(() => {
              const currentMetricData = metrics.find(m => m.metric_name === selectedMetric);
              const isPrimaryMetric = compositeMetrics.includes(selectedMetric || '');
              const latestMetricSample = metrics
                .filter(m => m.metric_name === selectedMetric)
                .sort((a, b) => new Date(b.test_date).getTime() - new Date(a.test_date).getTime())[0];

              return (
                <TouchableOpacity
                  style={styles.metricDropdown}
                  onPress={() => setSearchModalVisible(true)}
                >
                  <View style={styles.metricDropdownLeft}>
                    {isPrimaryMetric && (
                      <View style={styles.primaryBadge}>
                        <Ionicons name="star" size={10} color="#000" />
                      </View>
                    )}
                    <View style={styles.metricDropdownTextContainer}>
                      <Text style={styles.metricDropdownLabel}>Metric</Text>
                      <Text style={styles.metricDropdownValue} numberOfLines={1}>
                        {currentMetricData?.display_name || 'Select Metric'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.metricDropdownRight}>
                    {latestMetricSample?.sample_size !== undefined && (
                      <View style={styles.sampleSizeBadge}>
                        <Text style={styles.sampleSizeBadgeText}>
                          n={latestMetricSample.sample_size.toLocaleString()}
                        </Text>
                      </View>
                    )}
                    <View style={styles.metricCountBadge}>
                      <Text style={styles.metricCountText}>{uniqueMetrics.length}</Text>
                    </View>
                    <Ionicons name="chevron-down" size={18} color="#9CA3AF" />
                  </View>
                </TouchableOpacity>
              );
            })()}

            {/* Metric Selection Modal */}
            <Modal
              visible={searchModalVisible}
              animationType="slide"
              transparent={true}
              onRequestClose={() => {
                Keyboard.dismiss();
                setSearchModalVisible(false);
                setSearchQuery('');
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
                    setSearchModalVisible(false);
                    setSearchQuery('');
                  }}
                />
                <View style={styles.modalContent}>
                  {/* Modal Header */}
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Select Metric</Text>
                    <Text style={styles.modalSubtitle}>{filteredMetricsList.length} of {sortedMetricsList.length} metrics</Text>
                    <TouchableOpacity
                      onPress={() => {
                        Keyboard.dismiss();
                        setSearchModalVisible(false);
                        setSearchQuery('');
                      }}
                      style={styles.modalClose}
                    >
                      <Ionicons name="close" size={24} color="#fff" />
                    </TouchableOpacity>
                  </View>

                  {/* Search Input */}
                  <View style={styles.searchInputContainer}>
                    <Ionicons name="search" size={18} color="#6B7280" />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Filter metrics..."
                      placeholderTextColor="#6B7280"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      autoCorrect={false}
                      autoCapitalize="none"
                      returnKeyType="done"
                      clearButtonMode="while-editing"
                    />
                    {searchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <Ionicons name="close-circle" size={18} color="#6B7280" />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Primary Metrics Section Header */}
                  {searchQuery.length === 0 && compositeMetrics.filter(cm => uniqueMetrics.includes(cm)).length > 0 && (
                    <View style={styles.sectionHeader}>
                      <Ionicons name="star" size={12} color="#9BDDFF" />
                      <Text style={styles.sectionHeaderText}>Composite Score Metrics</Text>
                    </View>
                  )}

                  {/* Metrics List - All pre-loaded */}
                  <FlatList
                    data={filteredMetricsList}
                    extraData={searchQuery}
                    keyExtractor={(item) => item}
                    keyboardShouldPersistTaps="always"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={true}
                    initialNumToRender={20}
                    maxToRenderPerBatch={30}
                    windowSize={10}
                    renderItem={({ item: metricName, index }) => {
                      const isSelected = metricName === selectedMetric;
                      const isPrimary = compositeMetrics.includes(metricName);
                      const metricData = metrics.find(m => m.metric_name === metricName);
                      const latestMetricData = metrics
                        .filter(m => m.metric_name === metricName)
                        .sort((a, b) => new Date(b.test_date).getTime() - new Date(a.test_date).getTime())[0];
                      const sampleSize = latestMetricData?.sample_size;

                      // Show section divider between primary and other metrics
                      const prevMetric = index > 0 ? filteredMetricsList[index - 1] : null;
                      const showDivider = prevMetric && compositeMetrics.includes(prevMetric) && !isPrimary && searchQuery.length === 0;

                      return (
                        <>
                          {showDivider && (
                            <View style={styles.sectionHeader}>
                              <Ionicons name="apps-outline" size={12} color="#6B7280" />
                              <Text style={styles.sectionHeaderTextOther}>All Metrics</Text>
                            </View>
                          )}
                          <TouchableOpacity
                            style={[
                              styles.metricListItem,
                              isSelected && styles.metricListItemSelected,
                            ]}
                            onPress={() => {
                              Keyboard.dismiss();
                              setSelectedMetric(metricName);
                              setSearchModalVisible(false);
                              setSearchQuery('');
                            }}
                          >
                            <View style={styles.metricListItemContent}>
                              {isPrimary && (
                                <View style={styles.listItemStarBadge}>
                                  <Ionicons name="star" size={10} color="#9BDDFF" />
                                </View>
                              )}
                              <View style={styles.metricListItemTextContainer}>
                                <Text style={[
                                  styles.metricListItemText,
                                  isSelected && styles.metricListItemTextSelected,
                                ]}>
                                  {metricData?.display_name || metricName}
                                </Text>
                                {sampleSize !== undefined && (
                                  <Text style={styles.sampleSizeText}>
                                    n={sampleSize.toLocaleString()} athletes
                                  </Text>
                                )}
                              </View>
                            </View>
                            {isSelected && (
                              <Ionicons name="checkmark-circle" size={20} color="#9BDDFF" />
                            )}
                          </TouchableOpacity>
                        </>
                      );
                    }}
                    style={styles.metricsList}
                    ListEmptyComponent={
                      <View style={styles.noResultsContainer}>
                        <Ionicons name="search-outline" size={32} color="#6B7280" />
                        <Text style={styles.noResultsText}>No metrics match "{searchQuery}"</Text>
                      </View>
                    }
                  />
                </View>
              </KeyboardAvoidingView>
            </Modal>

            {/* Time Range Filters */}
            <View style={styles.timeRangeContainer}>
              {(['1m', '3m', '6m', '1y', 'all'] as TimeRange[]).map((range) => (
                <TouchableOpacity
                  key={range}
                  onPress={() => setTimeRange(range)}
                  style={[
                    styles.timeButton,
                    timeRange === range && styles.timeButtonSelected,
                  ]}
                >
                  <Text style={[
                    styles.timeButtonText,
                    timeRange === range && styles.timeButtonTextSelected,
                  ]}>
                    {range === 'all' ? 'All Time' : range.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {selectedMetricData.length === 0 ? (
              <View style={styles.noRangeData}>
                <Text style={styles.noRangeDataText}>No data available for this time range</Text>
              </View>
            ) : (
              <>
                {/* Stats Cards */}
                <View style={styles.statsGrid}>
                  {/* Latest Result */}
                  <LinearGradient
                    colors={['#000', 'rgba(20,20,20,0.9)']}
                    style={styles.statCard}
                  >
                    <Text style={styles.statLabel}>Latest Result</Text>
                    <Text style={styles.statValue}>
                      {latestTest?.value != null ? latestTest.value.toFixed(1) : 'N/A'}
                    </Text>
                    <Text style={styles.statSubtext}>
                      {latestTest ? new Date(latestTest.test_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : ''}
                    </Text>
                  </LinearGradient>

                  {/* Percentile Rank */}
                  <LinearGradient
                    colors={['#000', 'rgba(20,20,20,0.9)']}
                    style={styles.statCard}
                  >
                    <Text style={styles.statLabel}>Percentile Rank</Text>
                    <Text style={[styles.statValue, { color: latestTest ? getZoneColor(latestTest.percentile) : '#fff' }]}>
                      {latestTest ? `${Math.round(latestTest.percentile)}th` : 'N/A'}
                    </Text>
                    <Text style={styles.statSubtext}>vs {playLevel} athletes</Text>
                  </LinearGradient>

                  {/* Change */}
                  {previousTest && (
                    <LinearGradient
                      colors={['#000', 'rgba(20,20,20,0.9)']}
                      style={styles.statCard}
                    >
                      <Text style={styles.statLabel}>Change</Text>
                      <View style={styles.changeRow}>
                        <Ionicons
                          name={percentileChange > 0 ? 'arrow-up' : percentileChange < 0 ? 'arrow-down' : 'remove'}
                          size={20}
                          color={percentileChange > 0 ? '#4ADE80' : percentileChange < 0 ? '#EF4444' : '#9CA3AF'}
                        />
                        <Text style={[styles.statValue, { color: percentileChange > 0 ? '#4ADE80' : percentileChange < 0 ? '#EF4444' : '#9CA3AF' }]}>
                          {Math.abs(percentileChange).toFixed(0)}
                        </Text>
                      </View>
                      <Text style={[styles.statSubtext, { color: valueChange > 0 ? '#4ADE80' : valueChange < 0 ? '#EF4444' : '#6B7280' }]}>
                        {valueChange > 0 ? '+' : ''}{valueChange.toFixed(1)}% value
                      </Text>
                    </LinearGradient>
                  )}
                </View>

                {/* Test History Chart */}
                <View style={styles.chartCard}>
                  <Text style={styles.chartTitle}>Test History — {latestTest?.display_name || ''}</Text>
                  <TestHistoryChart data={selectedMetricData} />
                </View>
              </>
            )}

            {/* Educational Section */}
            <View style={styles.educationSection}>
              <Text style={styles.educationTitle}>About This Test</Text>

              {/* What Is It */}
              {testInfo.description && (
                <View style={styles.educationCard}>
                  <Text style={styles.educationCardTitle}>What Is It?</Text>
                  <Text style={styles.educationCardText}>{testInfo.description}</Text>
                </View>
              )}

              {/* What It Measures */}
              {testInfo.whatItMeasures && (
                <View style={styles.educationCard}>
                  <Text style={styles.educationCardTitle}>What It Measures</Text>
                  <Text style={styles.educationCardText}>{testInfo.whatItMeasures}</Text>
                </View>
              )}

              {/* Why It Matters */}
              {testInfo.whyItMatters && (
                <View style={styles.educationCard}>
                  <Text style={styles.educationCardTitle}>Why It Matters</Text>
                  <Text style={styles.educationCardText}>{testInfo.whyItMatters}</Text>
                </View>
              )}

              {/* Percentile Context */}
              <View style={styles.percentileGuide}>
                <Text style={styles.percentileGuideTitle}>Understanding Your Percentile</Text>

                <View style={styles.zoneRow}>
                  <View style={[styles.zoneBadge, { backgroundColor: 'rgba(74, 222, 128, 0.2)', borderColor: 'rgba(74, 222, 128, 0.3)' }]}>
                    <Text style={[styles.zoneBadgeValue, { color: '#4ADE80' }]}>75+</Text>
                  </View>
                  <View style={styles.zoneInfo}>
                    <Text style={[styles.zoneLabel, { color: '#4ADE80' }]}>ELITE</Text>
                    <Text style={styles.zoneDescription}>Top 25% of {playLevel || 'peer'} athletes</Text>
                  </View>
                </View>

                <View style={styles.zoneRow}>
                  <View style={[styles.zoneBadge, { backgroundColor: 'rgba(155, 221, 255, 0.2)', borderColor: 'rgba(155, 221, 255, 0.3)' }]}>
                    <Text style={[styles.zoneBadgeValue, { color: '#9BDDFF' }]}>50+</Text>
                  </View>
                  <View style={styles.zoneInfo}>
                    <Text style={[styles.zoneLabel, { color: '#9BDDFF' }]}>OPTIMIZE</Text>
                    <Text style={styles.zoneDescription}>Above average - continue training to reach elite</Text>
                  </View>
                </View>

                <View style={styles.zoneRow}>
                  <View style={[styles.zoneBadge, { backgroundColor: 'rgba(252, 211, 77, 0.2)', borderColor: 'rgba(252, 211, 77, 0.3)' }]}>
                    <Text style={[styles.zoneBadgeValue, { color: '#FCD34D' }]}>25+</Text>
                  </View>
                  <View style={styles.zoneInfo}>
                    <Text style={[styles.zoneLabel, { color: '#FCD34D' }]}>SHARPEN</Text>
                    <Text style={styles.zoneDescription}>Below average - focus area for improvement</Text>
                  </View>
                </View>

                <View style={styles.zoneRow}>
                  <View style={[styles.zoneBadge, { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: 'rgba(239, 68, 68, 0.3)' }]}>
                    <Text style={[styles.zoneBadgeValue, { color: '#EF4444' }]}>&lt;25</Text>
                  </View>
                  <View style={styles.zoneInfo}>
                    <Text style={[styles.zoneLabel, { color: '#EF4444' }]}>BUILD</Text>
                    <Text style={styles.zoneDescription}>Priority area - requires dedicated training</Text>
                  </View>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Test History Chart Component using SVG
function TestHistoryChart({ data }: { data: TestMetric[] }) {
  if (data.length === 0) return null;

  const chartWidth = SCREEN_WIDTH - 64;
  const chartHeight = 280;
  const padding = { top: 30, right: 30, bottom: 50, left: 50 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Calculate min/max values
  const values = data.map(d => d.value);
  let maxValue = Math.max(...values);
  let minValue = Math.min(...values, 0);

  // Add padding
  const valueRange = maxValue - minValue;
  const paddingVal = valueRange * 0.1;
  maxValue = maxValue + paddingVal;
  minValue = Math.max(0, minValue - paddingVal);
  const finalRange = maxValue - minValue;

  // Calculate bar dimensions
  const barCount = data.length;
  const totalBarWidth = innerWidth / barCount;
  const barWidth = Math.min(totalBarWidth * 0.6, 30);

  // Helper functions
  const getY = (value: number) => {
    const normalized = (value - minValue) / (finalRange || 1);
    return padding.top + innerHeight - normalized * innerHeight;
  };

  const getX = (index: number) => {
    return padding.left + index * totalBarWidth + totalBarWidth / 2;
  };

  // Generate grid lines
  const gridLines = 5;
  const gridLinesData = Array.from({ length: gridLines + 1 }, (_, i) => {
    const y = padding.top + (innerHeight / gridLines) * i;
    const value = maxValue - (finalRange / gridLines) * i;
    return { y, value };
  });

  return (
    <View style={styles.chartContainer}>
      <Svg width={chartWidth} height={chartHeight}>
        {/* Grid lines */}
        {gridLinesData.map((line, i) => (
          <React.Fragment key={`grid-${i}`}>
            <Line
              x1={padding.left}
              y1={line.y}
              x2={chartWidth - padding.right}
              y2={line.y}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={1}
            />
            <SvgText
              x={padding.left - 8}
              y={line.y + 4}
              fill="rgba(255,255,255,0.4)"
              fontSize={10}
              textAnchor="end"
            >
              {line.value.toFixed(0)}
            </SvgText>
          </React.Fragment>
        ))}

        {/* Bars */}
        {data.map((point, index) => {
          const x = getX(index);
          const y = getY(point.value);
          const barHeight = Math.max(1, padding.top + innerHeight - y);
          const color = getZoneColor(point.percentile);

          return (
            <React.Fragment key={`bar-${index}`}>
              {/* Bar */}
              <Rect
                x={x - barWidth / 2}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={color}
                opacity={0.8}
                rx={3}
              />
              {/* Bar border */}
              <Rect
                x={x - barWidth / 2}
                y={y}
                width={barWidth}
                height={barHeight}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                rx={3}
              />
            </React.Fragment>
          );
        })}

        {/* Connecting line */}
        {data.length > 1 && (
          <Line
            x1={getX(0)}
            y1={getY(data[0].value)}
            x2={getX(data.length - 1)}
            y2={getY(data[data.length - 1].value)}
            stroke="rgba(229,231,235,0.3)"
            strokeWidth={1}
            strokeDasharray="4,4"
          />
        )}

        {/* Data points */}
        {data.map((point, index) => {
          const x = getX(index);
          const y = getY(point.value);
          const color = getZoneColor(point.percentile);

          return (
            <Circle
              key={`point-${index}`}
              cx={x}
              cy={y}
              r={5}
              fill={color}
              stroke="#000"
              strokeWidth={2}
            />
          );
        })}

        {/* X-axis labels (dates) */}
        {data.map((point, index) => {
          const x = getX(index);
          const date = new Date(point.test_date);
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          return (
            <SvgText
              key={`label-${index}`}
              x={x}
              y={chartHeight - 10}
              fill="rgba(255,255,255,0.5)"
              fontSize={9}
              textAnchor="middle"
            >
              {dateStr}
            </SvgText>
          );
        })}
      </Svg>
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
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  noDataContainer: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  noDataTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  noDataText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 8,
  },
  metricDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: 12,
    marginBottom: 12,
  },
  metricDropdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  primaryBadge: {
    backgroundColor: '#9BDDFF',
    borderRadius: 6,
    padding: 4,
    marginRight: 10,
  },
  metricDropdownTextContainer: {
    flex: 1,
  },
  metricDropdownLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
    marginBottom: 2,
  },
  metricDropdownValue: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '600',
  },
  metricDropdownRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sampleSizeBadge: {
    backgroundColor: 'rgba(155, 221, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sampleSizeBadgeText: {
    fontSize: 10,
    color: '#9BDDFF',
    fontWeight: '600',
  },
  metricCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  metricCountText: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    gap: 8,
  },
  sectionHeaderText: {
    fontSize: 11,
    color: '#9BDDFF',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderTextOther: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listItemStarBadge: {
    backgroundColor: 'rgba(155, 221, 255, 0.15)',
    borderRadius: 4,
    padding: 3,
    marginRight: 10,
  },
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
    maxHeight: '70%',
    minHeight: '50%',
    paddingBottom: 40,
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
  modalSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    flex: 1,
    marginLeft: 8,
  },
  modalClose: {
    padding: 4,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    margin: 16,
    marginTop: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#fff',
  },
  metricsList: {
    flex: 1,
  },
  metricListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  metricListItemSelected: {
    backgroundColor: 'rgba(155, 221, 255, 0.1)',
  },
  metricListItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  metricListItemTextContainer: {
    flex: 1,
  },
  metricListItemText: {
    fontSize: 14,
    color: '#D1D5DB',
  },
  metricListItemTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  sampleSizeText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  noResultsContainer: {
    padding: 40,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
    color: '#6B7280',
  },
  timeRangeContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  timeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  timeButtonSelected: {
    backgroundColor: '#9BDDFF',
  },
  timeButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  timeButtonTextSelected: {
    color: '#000',
  },
  noRangeData: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  noRangeDataText: {
    fontSize: 14,
    color: '#6B7280',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  statLabel: {
    fontSize: 10,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },
  statSubtext: {
    fontSize: 9,
    color: '#6B7280',
    marginTop: 2,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chartCard: {
    backgroundColor: '#000',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 24,
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  chartContainer: {
    alignItems: 'center',
  },
  educationSection: {
    marginBottom: 40,
  },
  educationTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
  },
  educationCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 12,
  },
  educationCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#9BDDFF',
    marginBottom: 8,
  },
  educationCardText: {
    fontSize: 14,
    color: '#D1D5DB',
    lineHeight: 22,
  },
  percentileGuide: {
    backgroundColor: '#000',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  percentileGuideTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  zoneBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoneBadgeValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  zoneInfo: {
    flex: 1,
  },
  zoneLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  zoneDescription: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
});
