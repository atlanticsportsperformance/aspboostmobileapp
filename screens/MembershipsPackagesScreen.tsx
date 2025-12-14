import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useStripe } from '@stripe/stripe-react-native';
import { supabase } from '../lib/supabase';
import { useAthlete } from '../contexts/AthleteContext';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aspboostapp.vercel.app';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ServiceCategory {
  id: string;
  name: string;
}

interface EventTemplate {
  id: string;
  name: string;
}

interface EntitlementRule {
  id: string;
  scope: 'any' | 'category' | 'template';
  category_id: string | null;
  template_id: string | null;
  package_type_id?: string;
  membership_type_id?: string;
  visits_allocated?: number;
  scheduling_categories?: ServiceCategory | null;
  scheduling_templates?: EventTemplate | null;
}

interface MembershipType {
  id: string;
  name: string;
  description: string | null;
  price_amount: number | null;
  price_currency: string;
  billing_period: string;
  billing_interval_count: number | null;
  is_active: boolean;
  is_purchasable: boolean;
  is_unlimited?: boolean;
  metadata?: any;
  entitlement_rules?: EntitlementRule[];
}

interface UsageCounter {
  id: string;
  scope_type: 'category' | 'template';
  scope_id: string;
  scope_name: string | null;
  visits_allocated: number; // -1 = unlimited
  visits_used: number;
  period_start: string;
  period_end: string;
}

interface Membership {
  id: string;
  membership_type_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end?: boolean;
  membership_type: MembershipType;
  membership_usage_counters?: UsageCounter[];
}

interface PackageType {
  id: string;
  name: string;
  description: string | null;
  price_amount: number | null; // In cents
  price_currency: string;
  uses: number | null; // null = unlimited (is_unlimited is generated)
  is_unlimited: boolean; // Generated column: true when uses is null
  sessions_included: number | null; // Deprecated, use 'uses' instead
  is_active: boolean;
  is_purchasable: boolean;
  expiry_days?: number;
  metadata?: any;
  entitlement_rules?: EntitlementRule[];
}

interface Package {
  id: string;
  package_type_id: string;
  status: string;
  expiry_date: string;
  uses_remaining: number;
  uses_total?: number;
  package_type: PackageType;
}

type TabType = 'memberships' | 'packages';

// Per-athlete data structure for parent view
interface AthleteData {
  athleteId: string;
  athleteName: string;
  color: string;
  memberships: Membership[];
  packages: Package[];
}

export default function MembershipsPackagesScreen({ navigation, route }: any) {
  const { isParent, linkedAthletes } = useAthlete();
  const [athleteId, setAthleteId] = useState<string | null>(route?.params?.athleteId || null);
  const [activeTab, setActiveTab] = useState<TabType>('memberships');
  const [loading, setLoading] = useState(true);

  // Active items (for regular athletes)
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);

  // Per-athlete data (for parent view)
  const [athleteDataList, setAthleteDataList] = useState<AthleteData[]>([]);

  // Available for purchase
  const [availableMembershipTypes, setAvailableMembershipTypes] = useState<MembershipType[]>([]);
  const [availablePackageTypes, setAvailablePackageTypes] = useState<PackageType[]>([]);

  // Manage menu state
  const [showManageMenu, setShowManageMenu] = useState<string | null>(null);

  // Purchase modal state
  const [selectedItem, setSelectedItem] = useState<MembershipType | PackageType | null>(null);
  const [selectedItemType, setSelectedItemType] = useState<'membership' | 'package'>('membership');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseForAthleteId, setPurchaseForAthleteId] = useState<string | null>(null);
  const [paymentInProgress, setPaymentInProgress] = useState(false);

  // Stripe hook
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  useEffect(() => {
    loadAthleteAndData();
  }, [isParent, linkedAthletes]);

  async function loadAthleteAndData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      // Handle parent accounts - load data for all linked athletes
      if (isParent && linkedAthletes.length > 0) {
        await fetchDataForAllAthletes();
        return;
      }

      // Regular athlete flow
      let currentAthleteId = athleteId;
      if (!currentAthleteId) {
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (!athlete) {
          navigation.goBack();
          return;
        }
        currentAthleteId = athlete.id;
        setAthleteId(athlete.id);
      }

      if (currentAthleteId) {
        await fetchData(currentAthleteId);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDataForAllAthletes() {
    try {
      const athleteDataPromises = linkedAthletes.map(async (athlete) => {
        // Fetch memberships for this athlete
        const { data: membershipsData } = await supabase
          .from('memberships')
          .select(`
            *,
            membership_type:membership_types!membership_type_id(*),
            membership_usage_counters(
              id,
              scope_type,
              scope_id,
              scope_name,
              visits_allocated,
              visits_used,
              period_start,
              period_end
            )
          `)
          .eq('athlete_id', athlete.athlete_id)
          .eq('status', 'active');

        // Fetch packages for this athlete
        const { data: packagesData } = await supabase
          .from('packages')
          .select(`
            *,
            package_type:package_types!package_type_id(
              *,
              entitlement_rules(
                id,
                scope,
                category_id,
                template_id,
                visits_allocated,
                category:scheduling_categories(id, name),
                template:scheduling_templates(id, name)
              )
            )
          `)
          .eq('athlete_id', athlete.athlete_id)
          .eq('status', 'active');

        return {
          athleteId: athlete.athlete_id,
          athleteName: `${athlete.first_name} ${athlete.last_name}`,
          color: athlete.color,
          memberships: membershipsData || [],
          packages: packagesData || [],
        };
      });

      const allAthleteData = await Promise.all(athleteDataPromises);
      setAthleteDataList(allAthleteData);

      // Also fetch available types (same for all athletes)
      const { data: membershipTypesData } = await supabase
        .from('membership_types')
        .select('*')
        .eq('is_active', true)
        .eq('is_purchasable', true)
        .order('price_amount', { ascending: true });

      setAvailableMembershipTypes(membershipTypesData || []);

      const { data: packageTypesData } = await supabase
        .from('package_types')
        .select(`
          *,
          entitlement_rules(
            id,
            package_type_id,
            scope,
            category_id,
            template_id,
            visits_allocated,
            category:scheduling_categories(id, name),
            template:scheduling_templates(id, name)
          )
        `)
        .eq('is_active', true)
        .eq('is_purchasable', true)
        .order('price_amount', { ascending: true });

      setAvailablePackageTypes(packageTypesData || []);
    } catch (error) {
      console.error('Error fetching data for all athletes:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchData(id: string) {
    try {
      // Fetch active memberships with usage counters
      const { data: membershipsData } = await supabase
        .from('memberships')
        .select(`
          *,
          membership_type:membership_types!membership_type_id(*),
          membership_usage_counters(
            id,
            scope_type,
            scope_id,
            scope_name,
            visits_allocated,
            visits_used,
            period_start,
            period_end
          )
        `)
        .eq('athlete_id', id)
        .eq('status', 'active');

      setMemberships(membershipsData || []);

      // Fetch active packages with package type and entitlement rules
      const { data: packagesData } = await supabase
        .from('packages')
        .select(`
          *,
          package_type:package_types!package_type_id(
            *,
            entitlement_rules(
              id,
              scope,
              category_id,
              template_id,
              visits_allocated,
              category:scheduling_categories(id, name),
              template:scheduling_templates(id, name)
            )
          )
        `)
        .eq('athlete_id', id)
        .eq('status', 'active');

      setPackages(packagesData || []);

      // Fetch available membership types (uses metadata.service_groupings)
      const { data: membershipTypesData } = await supabase
        .from('membership_types')
        .select('*')
        .eq('is_active', true)
        .eq('is_purchasable', true)
        .order('price_amount', { ascending: true });

      setAvailableMembershipTypes(membershipTypesData || []);

      // Fetch available package types with entitlement rules (requires RLS policy on entitlement_rules)
      const { data: packageTypesData, error: packageTypesError } = await supabase
        .from('package_types')
        .select(`
          *,
          entitlement_rules(
            id,
            package_type_id,
            scope,
            category_id,
            template_id,
            visits_allocated,
            category:scheduling_categories(id, name),
            template:scheduling_templates(id, name)
          )
        `)
        .eq('is_active', true)
        .eq('is_purchasable', true)
        .order('price_amount', { ascending: true });

      if (packageTypesError) {
        console.error('Error fetching package types:', packageTypesError);
      }

      setAvailablePackageTypes(packageTypesData || []);
    } catch (error) {
      console.error('Error fetching commerce data:', error);
    }
  }

  function formatPrice(amount: number | null, currency: string = 'usd'): string {
    if (amount === null || amount === 0) return 'Free';
    const dollars = amount / 100;
    // Show cents for amounts less than $1, otherwise show whole dollars
    if (dollars < 1) {
      return `$${dollars.toFixed(2)}`;
    }
    return `$${dollars.toFixed(0)}`;
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function getBillingPeriodText(period: string): string {
    const normalized = period?.toLowerCase().replace(/[\s-]/g, '_');
    switch (normalized) {
      case 'monthly': return 'Billed monthly';
      case 'quarterly': return 'Billed quarterly';
      case 'annual':
      case 'yearly': return 'Billed annually';
      case 'one_time':
      case 'onetime': return 'One-time payment';
      default: return period;
    }
  }

  function getBillingPeriodShort(period: string): string {
    if (!period) return '';
    const normalized = period.toLowerCase().replace(/[\s-]/g, '_');
    // Match web app logic: monthly -> /month, quarterly -> /3 months, annual -> /year
    // one_time returns empty (no suffix)
    const periodMap: Record<string, string> = {
      'monthly': '/month',
      'quarterly': '/3 months',
      'annual': '/year',
      'yearly': '/year',
    };
    return periodMap[normalized] || '';
  }

  function getBillingPeriodLabel(period: string): string {
    if (!period) return '';
    const normalized = period.toLowerCase().replace(/[\s-]/g, '_');
    if (normalized === 'monthly') return 'Monthly';
    if (normalized === 'quarterly') return 'Quarterly';
    if (normalized === 'annual' || normalized === 'yearly') return 'Annual';
    if (normalized.includes('one') && normalized.includes('time')) return 'One-time';
    // Capitalize first letter as fallback
    return period.charAt(0).toUpperCase() + period.slice(1).replace(/_/g, '-');
  }

  async function handlePurchase() {
    // Determine which athlete ID to use for the purchase
    const targetAthleteId = purchaseForAthleteId || athleteId;

    if (!targetAthleteId || !selectedItem) {
      Alert.alert('Error', 'Unable to process purchase. Please try again.');
      return;
    }

    // Check if free - no Stripe needed
    if (!selectedItem.price_amount || selectedItem.price_amount === 0) {
      Alert.alert(
        'Free Item',
        'This item is free. Please contact the facility to activate it.',
        [{ text: 'OK' }]
      );
      setShowPurchaseModal(false);
      return;
    }

    setPaymentInProgress(true);

    try {
      // Get the current session for auth token
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log('=== STRIPE CHECKOUT DEBUG ===');
      console.log('Session error:', sessionError);
      console.log('Session exists:', !!session);
      console.log('Access token exists:', !!session?.access_token);
      console.log('Access token (first 20 chars):', session?.access_token?.substring(0, 20));

      if (!session?.access_token) {
        throw new Error('Please log in to make a purchase');
      }

      // Determine which endpoint to call based on item type
      const endpoint = selectedItemType === 'membership'
        ? `${API_URL}/api/stripe/create-membership-checkout`
        : `${API_URL}/api/stripe/create-package-checkout`;

      const bodyParams = selectedItemType === 'membership'
        ? {
            athlete_id: targetAthleteId,
            membership_type_id: selectedItem.id,
            embedded: true,
            return_url: 'aspboost://purchase/complete',
          }
        : {
            athlete_id: targetAthleteId,
            package_type_id: selectedItem.id,
            embedded: true,
            return_url: 'aspboost://purchase/complete',
          };

      console.log('Endpoint:', endpoint);
      console.log('Body params:', JSON.stringify(bodyParams, null, 2));
      console.log('Target athlete ID:', targetAthleteId);
      console.log('Selected item ID:', selectedItem.id);
      console.log('Selected item type:', selectedItemType);

      // 1. Create checkout session on server (embedded mode for Payment Sheet)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(bodyParams),
      });

      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);

      const data = await response.json();
      console.log('Response data:', JSON.stringify(data, null, 2));

      if (!response.ok) {
        throw new Error(data.error || data.message || `HTTP ${response.status}: Failed to create payment session`);
      }

      const { client_secret } = data;

      if (!client_secret) {
        throw new Error('No client secret returned from server');
      }

      // 2. Initialize Payment Sheet
      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: client_secret,
        merchantDisplayName: 'ASP Boost',
        style: 'alwaysDark',
      });

      if (initError) {
        throw new Error(initError.message);
      }

      // 3. Present Payment Sheet
      const { error: paymentError } = await presentPaymentSheet();

      if (paymentError) {
        if (paymentError.code === 'Canceled') {
          // User cancelled - not an error
          setPaymentInProgress(false);
          return;
        }
        throw new Error(paymentError.message);
      }

      // 4. Payment successful!
      // The webhook will create the membership/package automatically
      const itemName = selectedItemType === 'membership' ? 'Membership' : 'Package';
      Alert.alert(
        'Payment Successful',
        `Your ${itemName.toLowerCase()} has been activated! Check your email for confirmation.`,
        [{ text: 'OK' }]
      );

      setShowPurchaseModal(false);

      // Refresh data to show the new membership/package
      if (isParent && linkedAthletes.length > 0) {
        await fetchDataForAllAthletes();
      } else if (athleteId) {
        await fetchData(athleteId);
      }

    } catch (error: any) {
      console.error('Payment error:', error);
      Alert.alert(
        'Payment Failed',
        error.message || 'Something went wrong. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setPaymentInProgress(false);
    }
  }

  function handleManageAction(action: 'pause' | 'cancel') {
    setShowManageMenu(null);
    Alert.alert(
      'Coming Soon',
      `${action === 'pause' ? 'Pausing' : 'Canceling'} memberships will be available soon. Please contact the facility for assistance.`,
      [{ text: 'OK' }]
    );
  }

  // Get service allocations for memberships (from metadata.service_groupings)
  interface ServiceAllocation {
    name: string;
    visits: string;
    isUnlimited: boolean;
  }

  function getMembershipServiceAllocations(membershipType: MembershipType): ServiceAllocation[] {
    const allocations: ServiceAllocation[] = [];

    // Check metadata.service_groupings first (this is how web app stores it)
    if (membershipType.metadata?.service_groupings && Array.isArray(membershipType.metadata.service_groupings)) {
      for (const grouping of membershipType.metadata.service_groupings) {
        allocations.push({
          name: grouping.name || 'All Classes',
          visits: grouping.is_unlimited ? '∞' : (grouping.visits_allocated || '∞'),
          isUnlimited: grouping.is_unlimited === true || grouping.visits_allocated === '-1' || grouping.visits_allocated === -1,
        });
      }
    }

    // Fallback to entitlement_rules if no service_groupings
    if (allocations.length === 0 && membershipType.entitlement_rules && membershipType.entitlement_rules.length > 0) {
      for (const rule of membershipType.entitlement_rules as any[]) {
        let name = 'All Classes';
        // Use 'category' and 'template' aliases from the join
        if (rule.scope === 'category' && rule.category?.name) {
          name = rule.category.name;
        } else if (rule.scope === 'template' && rule.template?.name) {
          name = rule.template.name;
        } else if (rule.scope === 'any') {
          name = 'All Classes';
        }
        // null = unlimited for memberships
        const isUnlimited = rule.visits_allocated === null || rule.visits_allocated === undefined;
        allocations.push({
          name,
          visits: isUnlimited ? '∞' : String(rule.visits_allocated),
          isUnlimited,
        });
      }
    }

    // Default if nothing found
    if (allocations.length === 0) {
      allocations.push({ name: 'All Classes', visits: '∞', isUnlimited: true });
    }

    return allocations;
  }

  // Get service allocations for packages (from entitlement_rules)
  function getPackageServiceAllocations(packageType: PackageType): ServiceAllocation[] {
    const allocations: ServiceAllocation[] = [];

    if (packageType.entitlement_rules && packageType.entitlement_rules.length > 0) {
      for (const rule of packageType.entitlement_rules as any[]) {
        let name = 'All Classes';

        // Check for category name (using 'category' alias from the join)
        if (rule.scope === 'category' && rule.category?.name) {
          name = rule.category.name;
        }
        // Check for template name (using 'template' alias from the join)
        else if (rule.scope === 'template' && rule.template?.name) {
          name = rule.template.name;
        }
        // Scope 'any' means all classes
        else if (rule.scope === 'any') {
          name = 'All Classes';
        }

        // -1 or null visits_allocated = unlimited
        const isUnlimited = rule.visits_allocated === null || rule.visits_allocated === undefined || rule.visits_allocated === -1;
        allocations.push({
          name,
          visits: isUnlimited ? '∞' : String(rule.visits_allocated),
          isUnlimited,
        });
      }
    }

    // Fallback if no rules - use 'uses' column from package_types (sessions_included is deprecated)
    if (allocations.length === 0) {
      const uses = packageType.uses ?? packageType.sessions_included;

      if (packageType.is_unlimited || uses === null || uses === undefined) {
        allocations.push({
          name: 'All Classes',
          visits: '∞',
          isUnlimited: true,
        });
      } else if (uses > 0) {
        allocations.push({
          name: 'All Classes',
          visits: String(uses),
          isUnlimited: false,
        });
      } else {
        allocations.push({
          name: 'All Classes',
          visits: '0',
          isUnlimited: false,
        });
      }
    }

    return allocations;
  }

  function getEntitlementNames(item: PackageType | MembershipType): string[] {
    const names: string[] = [];

    // First try entitlement_rules (preferred source)
    if (item.entitlement_rules && item.entitlement_rules.length > 0) {
      for (const rule of item.entitlement_rules) {
        if (rule.scope === 'any') {
          names.push('All Classes');
        } else if (rule.scope === 'category' && rule.scheduling_categories?.name) {
          names.push(rule.scheduling_categories.name);
        } else if (rule.scope === 'template' && rule.scheduling_templates?.name) {
          names.push(rule.scheduling_templates.name);
        }
      }
    }

    // Fallback to metadata.service_groupings if no entitlement rules
    if (names.length === 0 && item.metadata?.service_groupings) {
      try {
        for (const g of item.metadata.service_groupings) {
          if (g.category_name) names.push(g.category_name);
          else if (g.template_name) names.push(g.template_name);
          else if (g.category?.name) names.push(g.category.name);
        }
      } catch {
        // Ignore parsing errors
      }
    }

    return names.length > 0 ? [...new Set(names)] : ['General'];
  }

  // For grouping packages by category (uses first category)
  function getPackageCategories(packageType: PackageType): string[] {
    return getEntitlementNames(packageType);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9BDDFF" />
        <Text style={styles.loadingText}>Loading memberships & packages...</Text>
      </View>
    );
  }

  // Group packages by category
  const packagesByCategory = availablePackageTypes.reduce((acc, pkg) => {
    const categories = getPackageCategories(pkg);
    const category = categories[0] || 'General';
    if (!acc[category]) acc[category] = [];
    acc[category].push(pkg);
    return acc;
  }, {} as Record<string, PackageType[]>);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={20} color="#9CA3AF" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Memberships & Packages</Text>

        {/* Tab Switcher */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'memberships' && styles.tabActive]}
            onPress={() => setActiveTab('memberships')}
          >
            {activeTab === 'memberships' ? (
              <LinearGradient
                colors={['#9BDDFF', '#B0E5FF', '#7BC5F0']}
                style={styles.tabGradient}
              >
                <Text style={styles.tabTextActive}>Memberships</Text>
              </LinearGradient>
            ) : (
              <Text style={styles.tabText}>Memberships</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'packages' && styles.tabActive]}
            onPress={() => setActiveTab('packages')}
          >
            {activeTab === 'packages' ? (
              <LinearGradient
                colors={['#9BDDFF', '#B0E5FF', '#7BC5F0']}
                style={styles.tabGradient}
              >
                <Text style={styles.tabTextActive}>Packages</Text>
              </LinearGradient>
            ) : (
              <Text style={styles.tabText}>Packages</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {activeTab === 'memberships' ? (
          <>
            {/* PARENT VIEW: Per-athlete memberships */}
            {isParent && athleteDataList.length > 0 ? (
              <>
                {athleteDataList.map((athleteData) => (
                  <View key={athleteData.athleteId} style={styles.section}>
                    {/* Athlete Header */}
                    <View style={styles.athleteSectionHeader}>
                      <View style={[styles.athleteColorDot, { backgroundColor: athleteData.color }]} />
                      <Text style={styles.athleteSectionTitle}>
                        {athleteData.athleteName.toUpperCase()}'S MEMBERSHIPS
                      </Text>
                    </View>

                    {athleteData.memberships.length > 0 ? (
                      athleteData.memberships.map((membership) => {
                        const usageCounters = membership.membership_usage_counters || [];
                        return (
                          <View key={membership.id} style={[styles.activeMembershipCard, { borderLeftColor: athleteData.color, borderLeftWidth: 3 }]}>
                            {/* Header Row */}
                            <View style={styles.activeMembershipHeader}>
                              <View style={styles.activeMembershipIcon}>
                                <LinearGradient
                                  colors={['#9BDDFF', '#7BC5F0']}
                                  style={styles.iconGradient}
                                >
                                  <Ionicons name="checkmark-circle" size={16} color="#000" />
                                </LinearGradient>
                              </View>
                              <View style={styles.activeMembershipInfo}>
                                <Text style={styles.activeMembershipName} numberOfLines={1}>
                                  {membership.membership_type.name}
                                </Text>
                                <Text style={styles.activeMembershipRenewal}>
                                  Renews {formatDate(membership.current_period_end)}
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={styles.manageButton}
                                onPress={() => setShowManageMenu(showManageMenu === membership.id ? null : membership.id)}
                              >
                                <Text style={styles.manageButtonText}>Manage</Text>
                              </TouchableOpacity>
                            </View>

                            {/* Usage Counters */}
                            {usageCounters.length > 0 && (
                              <View style={styles.usageCountersContainer}>
                                {usageCounters.map((counter) => {
                                  const isUnlimited = counter.visits_allocated === -1;
                                  const remaining = isUnlimited ? '∞' : (counter.visits_allocated - counter.visits_used);
                                  const progressPercent = isUnlimited ? 0 : Math.min(100, (counter.visits_used / counter.visits_allocated) * 100);
                                  return (
                                    <View key={counter.id} style={styles.usageCounterRow}>
                                      <View style={styles.usageCounterInfo}>
                                        <Text style={styles.usageCounterName} numberOfLines={1}>
                                          {counter.scope_name || 'All Classes'}
                                        </Text>
                                        <Text style={styles.usageCounterStats}>
                                          {isUnlimited ? (
                                            <Text><Text style={styles.usageUsed}>{counter.visits_used}</Text> used</Text>
                                          ) : (
                                            <Text><Text style={styles.usageUsed}>{counter.visits_used}</Text> / {counter.visits_allocated} used</Text>
                                          )}
                                        </Text>
                                      </View>
                                      <View style={styles.usageCounterRight}>
                                        {isUnlimited ? (
                                          <Text style={styles.usageUnlimited}>∞</Text>
                                        ) : (
                                          <>
                                            <Text style={styles.usageRemaining}>{remaining}</Text>
                                            <Text style={styles.usageRemainingLabel}>left</Text>
                                          </>
                                        )}
                                      </View>
                                      {/* Progress bar for limited */}
                                      {!isUnlimited && (
                                        <View style={styles.usageProgressBar}>
                                          <View style={[styles.usageProgressFill, { width: `${progressPercent}%` }]} />
                                        </View>
                                      )}
                                    </View>
                                  );
                                })}
                              </View>
                            )}

                            {/* Manage Menu */}
                            {showManageMenu === membership.id && (
                              <View style={styles.manageMenu}>
                                <TouchableOpacity
                                  style={styles.manageMenuItem}
                                  onPress={() => handleManageAction('pause')}
                                >
                                  <Text style={styles.manageMenuText}>Pause Membership</Text>
                                </TouchableOpacity>
                                <View style={styles.manageMenuDivider} />
                                <TouchableOpacity
                                  style={styles.manageMenuItem}
                                  onPress={() => handleManageAction('cancel')}
                                >
                                  <Text style={[styles.manageMenuText, { color: '#F87171' }]}>
                                    Cancel Membership
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        );
                      })
                    ) : (
                      <Text style={styles.noItemsText}>No active memberships</Text>
                    )}
                  </View>
                ))}

                {/* Available Memberships for Purchase (parent view) */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>AVAILABLE MEMBERSHIPS</Text>
                  {availableMembershipTypes.length === 0 ? (
                    <Text style={styles.emptyText}>No memberships available at this time.</Text>
                  ) : (
                    availableMembershipTypes.map((type) => {
                      // Check if ANY linked athlete has this membership active
                      const athleteWithActive = athleteDataList.find(ad =>
                        ad.memberships.some(m => m.membership_type_id === type.id)
                      );
                      const allocations = getMembershipServiceAllocations(type);
                      return (
                        <TouchableOpacity
                          key={type.id}
                          style={styles.membershipTypeCard}
                          onPress={() => {
                            setSelectedItem(type);
                            setSelectedItemType('membership');
                            setShowPurchaseModal(true);
                          }}
                        >
                          <View style={styles.membershipCardContent}>
                            {/* Price at top */}
                            <View style={styles.membershipPriceTop}>
                              <Text style={styles.membershipPriceValue}>
                                {formatPrice(type.price_amount)}
                              </Text>
                              <Text style={styles.membershipPricePeriod}>
                                {getBillingPeriodShort(type.billing_period)}
                              </Text>
                            </View>

                            {/* Name */}
                            <Text style={styles.membershipCardName} numberOfLines={2}>
                              {type.name}
                            </Text>

                            {/* Billing period label */}
                            <Text style={styles.membershipBillingLabel}>
                              {getBillingPeriodLabel(type.billing_period)}
                            </Text>

                            {/* Service allocations */}
                            <View style={styles.membershipAllocations}>
                              {allocations.map((alloc, index) => (
                                <View key={index} style={styles.membershipAllocationRow}>
                                  <Text style={styles.membershipAllocationName} numberOfLines={1}>
                                    {alloc.name}
                                  </Text>
                                  <Text style={[
                                    styles.membershipAllocationVisits,
                                    alloc.isUnlimited && styles.membershipAllocationUnlimited
                                  ]}>
                                    {alloc.visits}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>
                          {athleteWithActive && (
                            <View style={styles.activeBadgeOverlay}>
                              <Text style={styles.activeBadgeText}>
                                Active: {athleteWithActive.athleteName.split(' ')[0]}
                              </Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              </>
            ) : (
              <>
                {/* REGULAR ATHLETE VIEW: Original memberships display */}
                {/* Active Memberships */}
                {memberships.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>YOUR MEMBERSHIP</Text>
                    {memberships.map((membership) => {
                      const usageCounters = membership.membership_usage_counters || [];
                      return (
                        <View key={membership.id} style={styles.activeMembershipCard}>
                          {/* Header Row */}
                          <View style={styles.activeMembershipHeader}>
                            <View style={styles.activeMembershipIcon}>
                              <LinearGradient
                                colors={['#9BDDFF', '#7BC5F0']}
                                style={styles.iconGradient}
                              >
                                <Ionicons name="checkmark-circle" size={16} color="#000" />
                              </LinearGradient>
                            </View>
                            <View style={styles.activeMembershipInfo}>
                              <Text style={styles.activeMembershipName} numberOfLines={1}>
                                {membership.membership_type.name}
                              </Text>
                              <Text style={styles.activeMembershipRenewal}>
                                Renews {formatDate(membership.current_period_end)}
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={styles.manageButton}
                              onPress={() => setShowManageMenu(showManageMenu === membership.id ? null : membership.id)}
                            >
                              <Text style={styles.manageButtonText}>Manage</Text>
                            </TouchableOpacity>
                          </View>

                          {/* Usage Counters */}
                          {usageCounters.length > 0 && (
                            <View style={styles.usageCountersContainer}>
                              {usageCounters.map((counter) => {
                                const isUnlimited = counter.visits_allocated === -1;
                                const remaining = isUnlimited ? '∞' : (counter.visits_allocated - counter.visits_used);
                                const progressPercent = isUnlimited ? 0 : Math.min(100, (counter.visits_used / counter.visits_allocated) * 100);
                                return (
                                  <View key={counter.id} style={styles.usageCounterRow}>
                                    <View style={styles.usageCounterInfo}>
                                      <Text style={styles.usageCounterName} numberOfLines={1}>
                                        {counter.scope_name || 'All Classes'}
                                      </Text>
                                      <Text style={styles.usageCounterStats}>
                                        {isUnlimited ? (
                                          <Text><Text style={styles.usageUsed}>{counter.visits_used}</Text> used</Text>
                                        ) : (
                                          <Text><Text style={styles.usageUsed}>{counter.visits_used}</Text> / {counter.visits_allocated} used</Text>
                                        )}
                                      </Text>
                                    </View>
                                    <View style={styles.usageCounterRight}>
                                      {isUnlimited ? (
                                        <Text style={styles.usageUnlimited}>∞</Text>
                                      ) : (
                                        <>
                                          <Text style={styles.usageRemaining}>{remaining}</Text>
                                          <Text style={styles.usageRemainingLabel}>left</Text>
                                        </>
                                      )}
                                    </View>
                                    {/* Progress bar for limited */}
                                    {!isUnlimited && (
                                      <View style={styles.usageProgressBar}>
                                        <View style={[styles.usageProgressFill, { width: `${progressPercent}%` }]} />
                                      </View>
                                    )}
                                  </View>
                                );
                              })}
                            </View>
                          )}

                          {/* Manage Menu */}
                          {showManageMenu === membership.id && (
                            <View style={styles.manageMenu}>
                              <TouchableOpacity
                                style={styles.manageMenuItem}
                                onPress={() => handleManageAction('pause')}
                              >
                                <Text style={styles.manageMenuText}>Pause Membership</Text>
                              </TouchableOpacity>
                              <View style={styles.manageMenuDivider} />
                              <TouchableOpacity
                                style={styles.manageMenuItem}
                                onPress={() => handleManageAction('cancel')}
                              >
                                <Text style={[styles.manageMenuText, { color: '#F87171' }]}>
                                  Cancel Membership
                                </Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Available Memberships */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>MEMBERSHIPS</Text>
                  {availableMembershipTypes.length === 0 ? (
                    <Text style={styles.emptyText}>No memberships available at this time.</Text>
                  ) : (
                    availableMembershipTypes.map((type) => {
                      const hasActive = memberships.some(m => m.membership_type_id === type.id);
                  const allocations = getMembershipServiceAllocations(type);
                  return (
                    <TouchableOpacity
                      key={type.id}
                      style={[styles.membershipTypeCard, hasActive && styles.cardDisabled]}
                      onPress={() => {
                        if (!hasActive) {
                          setSelectedItem(type);
                          setSelectedItemType('membership');
                          setShowPurchaseModal(true);
                        }
                      }}
                      disabled={hasActive}
                    >
                      <View style={styles.membershipCardContent}>
                        {/* Price at top */}
                        <View style={styles.membershipPriceTop}>
                          <Text style={styles.membershipPriceValue}>
                            {formatPrice(type.price_amount)}
                          </Text>
                          <Text style={styles.membershipPricePeriod}>
                            {getBillingPeriodShort(type.billing_period)}
                          </Text>
                        </View>

                        {/* Name */}
                        <Text style={styles.membershipCardName} numberOfLines={2}>
                          {type.name}
                        </Text>

                        {/* Billing period label */}
                        <Text style={styles.membershipBillingLabel}>
                          {getBillingPeriodLabel(type.billing_period)}
                        </Text>

                        {/* Service allocations */}
                        <View style={styles.membershipAllocations}>
                          {allocations.map((alloc, index) => (
                            <View key={index} style={styles.membershipAllocationRow}>
                              <Text style={styles.membershipAllocationName} numberOfLines={1}>
                                {alloc.name}
                              </Text>
                              <Text style={[
                                styles.membershipAllocationVisits,
                                alloc.isUnlimited && styles.membershipAllocationUnlimited
                              ]}>
                                {alloc.visits}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                      {hasActive && (
                        <View style={styles.activeBadgeOverlay}>
                          <Text style={styles.activeBadgeText}>Active</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
              </>
            )}
          </>
        ) : (
          <>
            {/* PACKAGES TAB */}
            {isParent && athleteDataList.length > 0 ? (
              <>
                {athleteDataList.map((athleteData) => (
                  <View key={athleteData.athleteId} style={styles.section}>
                    {/* Athlete Header */}
                    <View style={styles.athleteSectionHeader}>
                      <View style={[styles.athleteColorDot, { backgroundColor: athleteData.color }]} />
                      <Text style={styles.athleteSectionTitle}>
                        {athleteData.athleteName.toUpperCase()}'S PACKAGES
                      </Text>
                    </View>

                    {athleteData.packages.length > 0 ? (
                      athleteData.packages.map((pkg) => {
                        const totalUses = pkg.package_type.uses ?? pkg.package_type.sessions_included;
                        const isUnlimited = pkg.package_type.is_unlimited || totalUses === null;
                        const allocations = getPackageServiceAllocations(pkg.package_type);
                        const progressPercent = isUnlimited ? 0 : Math.min(100, ((totalUses - pkg.uses_remaining) / totalUses) * 100);

                        return (
                          <View key={pkg.id} style={[styles.activePackageCard, { borderLeftColor: athleteData.color, borderLeftWidth: 3 }]}>
                            {/* Header Row */}
                            <View style={styles.activePackageHeader}>
                              <View style={styles.activePackageIcon}>
                                <LinearGradient
                                  colors={['#9BDDFF', '#7BC5F0']}
                                  style={styles.iconGradient}
                                >
                                  <Ionicons name="card" size={14} color="#000" />
                                </LinearGradient>
                              </View>
                              <View style={styles.activePackageInfo}>
                                <Text style={styles.activePackageName} numberOfLines={1}>
                                  {pkg.package_type.name}
                                </Text>
                                <Text style={styles.activePackageExpiry}>
                                  Expires {formatDate(pkg.expiry_date)}
                                </Text>
                              </View>
                              <View style={styles.activePackageUsageRight}>
                                {isUnlimited ? (
                                  <Text style={styles.usageUnlimited}>∞</Text>
                                ) : (
                                  <>
                                    <Text style={styles.activePackageUsesRemaining}>{pkg.uses_remaining}</Text>
                                    <Text style={styles.activePackageUsesLabel}>left</Text>
                                  </>
                                )}
                              </View>
                            </View>

                            {/* Progress bar for limited packages */}
                            {!isUnlimited && totalUses && (
                              <View style={styles.activePackageProgress}>
                                <View style={styles.usageProgressBar}>
                                  <View style={[styles.usageProgressFill, { width: `${progressPercent}%` }]} />
                                </View>
                                <Text style={styles.activePackageProgressText}>
                                  {totalUses - pkg.uses_remaining} / {totalUses} used
                                </Text>
                              </View>
                            )}

                            {/* What this package is valid for */}
                            {allocations.length > 0 && (
                              <View style={styles.activePackageValidFor}>
                                <Text style={styles.activePackageValidForLabel}>Valid for:</Text>
                                <View style={styles.activePackageValidForList}>
                                  {allocations.map((alloc, index) => (
                                    <View key={index} style={styles.activePackageValidForItem}>
                                      <Text style={styles.activePackageValidForName}>{alloc.name}</Text>
                                      {!alloc.isUnlimited && alloc.visits !== '∞' && (
                                        <Text style={styles.activePackageValidForVisits}>({alloc.visits} visits)</Text>
                                      )}
                                    </View>
                                  ))}
                                </View>
                              </View>
                            )}
                          </View>
                        );
                      })
                    ) : (
                      <Text style={styles.noItemsText}>No active packages</Text>
                    )}
                  </View>
                ))}

                {/* Available Packages for Purchase (parent view) */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>AVAILABLE PACKAGES</Text>
                  {availablePackageTypes.length === 0 ? (
                    <Text style={styles.emptyText}>No packages available at this time.</Text>
                  ) : (
                    availablePackageTypes.map((type) => {
                      const classCount = type.uses ?? type.sessions_included;
                      const isUnlimitedPackage = type.is_unlimited || classCount === null;
                      const pricePerClass = type.price_amount && classCount && classCount > 0
                        ? (type.price_amount / 100) / classCount
                        : null;
                      const allocations = getPackageServiceAllocations(type);
                      return (
                        <TouchableOpacity
                          key={type.id}
                          style={styles.packageTypeCard}
                          onPress={() => {
                            setSelectedItem(type);
                            setSelectedItemType('package');
                            setShowPurchaseModal(true);
                          }}
                        >
                          <View style={styles.packageCardContent}>
                            {/* Top row: Price and class count */}
                            <View style={styles.packageTopRow}>
                              <View style={styles.packagePriceLeft}>
                                <Text style={styles.packagePriceValue}>
                                  {formatPrice(type.price_amount)}
                                </Text>
                                {!isUnlimitedPackage && pricePerClass && pricePerClass > 0 && (
                                  <Text style={styles.packagePricePerClass}>
                                    ${pricePerClass.toFixed(0)}/class
                                  </Text>
                                )}
                              </View>
                              <View style={styles.packageClassBadge}>
                                <Text style={styles.packageClassBadgeText}>
                                  {isUnlimitedPackage ? '∞ classes' : `${classCount} ${classCount === 1 ? 'class' : 'classes'}`}
                                </Text>
                              </View>
                            </View>

                            {/* Package name */}
                            <Text style={styles.packageCardName} numberOfLines={2}>
                              {type.name}
                            </Text>

                            {/* Description */}
                            {type.description ? (
                              <Text style={styles.packageCardDescription} numberOfLines={2}>
                                {type.description}
                              </Text>
                            ) : (
                              <View style={{ marginBottom: 8 }} />
                            )}

                            {/* Service allocations */}
                            <View style={styles.packageAllocations}>
                              {allocations.map((alloc, index) => (
                                <View key={index} style={styles.packageAllocationRow}>
                                  <Text style={styles.packageAllocationName} numberOfLines={1}>
                                    {alloc.name}
                                  </Text>
                                  <Text style={[
                                    styles.packageAllocationVisits,
                                    alloc.isUnlimited && styles.packageAllocationUnlimited
                                  ]}>
                                    {alloc.visits}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              </>
            ) : (
              <>
                {/* REGULAR ATHLETE VIEW: Original packages display */}
                {/* Active Packages */}
                {packages.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>YOUR PACKAGES</Text>
                    {packages.map((pkg) => {
                      const totalUses = pkg.package_type.uses ?? pkg.package_type.sessions_included;
                      const isUnlimited = pkg.package_type.is_unlimited || totalUses === null;
                      const allocations = getPackageServiceAllocations(pkg.package_type);
                      const progressPercent = isUnlimited ? 0 : Math.min(100, ((totalUses - pkg.uses_remaining) / totalUses) * 100);

                      return (
                        <View key={pkg.id} style={styles.activePackageCard}>
                          {/* Header Row */}
                          <View style={styles.activePackageHeader}>
                            <View style={styles.activePackageIcon}>
                              <LinearGradient
                                colors={['#9BDDFF', '#7BC5F0']}
                                style={styles.iconGradient}
                              >
                                <Ionicons name="card" size={14} color="#000" />
                              </LinearGradient>
                            </View>
                            <View style={styles.activePackageInfo}>
                              <Text style={styles.activePackageName} numberOfLines={1}>
                                {pkg.package_type.name}
                              </Text>
                              <Text style={styles.activePackageExpiry}>
                                Expires {formatDate(pkg.expiry_date)}
                              </Text>
                            </View>
                            <View style={styles.activePackageUsageRight}>
                              {isUnlimited ? (
                                <Text style={styles.usageUnlimited}>∞</Text>
                              ) : (
                                <>
                                  <Text style={styles.activePackageUsesRemaining}>{pkg.uses_remaining}</Text>
                                  <Text style={styles.activePackageUsesLabel}>left</Text>
                                </>
                              )}
                            </View>
                          </View>

                          {/* Progress bar for limited packages */}
                          {!isUnlimited && totalUses && (
                            <View style={styles.activePackageProgress}>
                              <View style={styles.usageProgressBar}>
                                <View style={[styles.usageProgressFill, { width: `${progressPercent}%` }]} />
                              </View>
                              <Text style={styles.activePackageProgressText}>
                                {totalUses - pkg.uses_remaining} / {totalUses} used
                              </Text>
                            </View>
                          )}

                          {/* What this package is valid for */}
                          {allocations.length > 0 && (
                            <View style={styles.activePackageValidFor}>
                              <Text style={styles.activePackageValidForLabel}>Valid for:</Text>
                              <View style={styles.activePackageValidForList}>
                                {allocations.map((alloc, index) => (
                                  <View key={index} style={styles.activePackageValidForItem}>
                                    <Text style={styles.activePackageValidForName}>{alloc.name}</Text>
                                    {!alloc.isUnlimited && alloc.visits !== '∞' && (
                                      <Text style={styles.activePackageValidForVisits}>({alloc.visits} visits)</Text>
                                    )}
                                  </View>
                                ))}
                              </View>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Available Packages */}
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>PACKAGES</Text>
                  {availablePackageTypes.length === 0 ? (
                    <Text style={styles.emptyText}>No packages available at this time.</Text>
                  ) : (
                    availablePackageTypes.map((type) => {
                      // Use 'uses' column (null = unlimited), fallback to sessions_included
                      const classCount = type.uses ?? type.sessions_included;
                      const isUnlimitedPackage = type.is_unlimited || classCount === null;
                      const pricePerClass = type.price_amount && classCount && classCount > 0
                        ? (type.price_amount / 100) / classCount
                        : null;
                      const allocations = getPackageServiceAllocations(type);
                      return (
                        <TouchableOpacity
                          key={type.id}
                          style={styles.packageTypeCard}
                          onPress={() => {
                            setSelectedItem(type);
                            setSelectedItemType('package');
                            setShowPurchaseModal(true);
                          }}
                        >
                          <View style={styles.packageCardContent}>
                            {/* Top row: Price and class count */}
                            <View style={styles.packageTopRow}>
                              <View style={styles.packagePriceLeft}>
                                <Text style={styles.packagePriceValue}>
                                  {formatPrice(type.price_amount)}
                                </Text>
                                {!isUnlimitedPackage && pricePerClass && pricePerClass > 0 && (
                                  <Text style={styles.packagePricePerClass}>
                                    ${pricePerClass.toFixed(0)}/class
                                  </Text>
                                )}
                              </View>
                              <View style={styles.packageClassBadge}>
                                <Text style={styles.packageClassBadgeText}>
                                  {isUnlimitedPackage ? '∞ classes' : `${classCount} ${classCount === 1 ? 'class' : 'classes'}`}
                                </Text>
                              </View>
                            </View>

                            {/* Package name */}
                            <Text style={styles.packageCardName} numberOfLines={2}>
                              {type.name}
                            </Text>

                            {/* Description */}
                            {type.description ? (
                              <Text style={styles.packageCardDescription} numberOfLines={2}>
                                {type.description}
                              </Text>
                            ) : (
                              <View style={{ marginBottom: 8 }} />
                            )}

                            {/* Service allocations */}
                            <View style={styles.packageAllocations}>
                              {allocations.map((alloc, index) => (
                                <View key={index} style={styles.packageAllocationRow}>
                                  <Text style={styles.packageAllocationName} numberOfLines={1}>
                                    {alloc.name}
                                  </Text>
                                  <Text style={[
                                    styles.packageAllocationVisits,
                                    alloc.isUnlimited && styles.packageAllocationUnlimited
                                  ]}>
                                    {alloc.visits}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Purchase Modal */}
      <Modal
        visible={showPurchaseModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPurchaseModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.purchaseModal}>
            {/* Modal Header */}
            <View style={styles.purchaseModalHeader}>
              <View style={[
                styles.purchaseModalBadge,
                selectedItemType === 'membership' && styles.purchaseModalBadgeMembership
              ]}>
                <Text style={[
                  styles.purchaseModalBadgeText,
                  selectedItemType === 'membership' && { color: '#000' }
                ]}>
                  {selectedItemType === 'membership' ? 'Membership' : 'Credit'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.purchaseModalClose}
                onPress={() => setShowPurchaseModal(false)}
              >
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            {/* Modal Content */}
            <ScrollView style={styles.purchaseModalContent}>
              {selectedItem && (
                <>
                  {/* Name and Price - at top for packages */}
                  <View style={styles.purchaseModalNamePrice}>
                    <Text style={styles.purchaseModalName}>{selectedItem.name}</Text>
                    <View style={styles.purchaseModalPriceRow}>
                      <Text style={styles.purchaseModalPrice}>
                        {formatPrice(selectedItem.price_amount)}
                      </Text>
                      {selectedItemType === 'membership' && (
                        <Text style={styles.purchaseModalPricePeriod}>
                          {getBillingPeriodShort((selectedItem as MembershipType).billing_period)}
                        </Text>
                      )}
                    </View>
                    {selectedItemType === 'membership' && (selectedItem as MembershipType).billing_period && (
                      <Text style={styles.purchaseModalBillingNote}>
                        {getBillingPeriodText((selectedItem as MembershipType).billing_period)}
                      </Text>
                    )}
                    {selectedItemType === 'package' && (() => {
                      const pkg = selectedItem as PackageType;
                      const allocations = getPackageServiceAllocations(pkg);
                      // Summarize: count total visits or show "Multiple categories" if mixed
                      const allUnlimited = allocations.every(a => a.isUnlimited);
                      const noneUnlimited = allocations.every(a => !a.isUnlimited);
                      let summary = '';
                      if (allUnlimited) {
                        summary = 'Unlimited classes';
                      } else if (noneUnlimited) {
                        const totalVisits = allocations.reduce((sum, a) => sum + parseInt(a.visits || '0'), 0);
                        summary = `${totalVisits} ${totalVisits === 1 ? 'class' : 'classes'} total`;
                      } else {
                        // Mixed - some unlimited, some not
                        summary = `${allocations.length} service ${allocations.length === 1 ? 'category' : 'categories'}`;
                      }
                      return (
                        <Text style={styles.purchaseModalBillingNote}>
                          {summary}
                          {pkg.expiry_days ? ` • Valid for ${pkg.expiry_days} days` : ''}
                        </Text>
                      );
                    })()}
                  </View>

                  <View style={styles.purchaseModalDivider} />

                  {/* Description */}
                  {selectedItem.description && (
                    <>
                      <View style={styles.purchaseModalDivider} />
                      <Text style={styles.purchaseModalDescription}>
                        {selectedItem.description}
                      </Text>
                    </>
                  )}

                  {/* What's Included */}
                  {(() => {
                    const allocations = selectedItemType === 'membership'
                      ? getMembershipServiceAllocations(selectedItem as MembershipType)
                      : getPackageServiceAllocations(selectedItem as PackageType);
                    return (
                      <View style={styles.purchaseModalValidFor}>
                        <View style={styles.purchaseModalValidForHeader}>
                          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                          <Text style={styles.purchaseModalValidForTitle}>What's Included</Text>
                        </View>
                        <View style={styles.purchaseModalValidForList}>
                          {allocations.map((alloc, index) => (
                            <View key={index} style={styles.purchaseModalAllocationItem}>
                              <Text style={styles.purchaseModalAllocationName}>{alloc.name}</Text>
                              <Text style={[
                                styles.purchaseModalAllocationVisits,
                                alloc.isUnlimited && styles.purchaseModalAllocationUnlimited
                              ]}>
                                {alloc.isUnlimited ? '∞' : `${alloc.visits} visits`}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    );
                  })()}

                  {/* Value info for packages */}
                  {selectedItemType === 'package' && (() => {
                    const pkg = selectedItem as PackageType;
                    const classCount = pkg.uses ?? pkg.sessions_included ?? 0;
                    if (pkg.price_amount && pkg.price_amount > 0 && classCount > 0) {
                      return (
                        <View style={styles.purchaseModalValue}>
                          <View style={styles.purchaseModalValueHeader}>
                            <Ionicons name="information-circle" size={16} color="#9BDDFF" />
                            <Text style={styles.purchaseModalValueTitle}>Value</Text>
                          </View>
                          <Text style={styles.purchaseModalValueText}>
                            ${((pkg.price_amount / 100) / classCount).toFixed(2)} per class
                          </Text>
                        </View>
                      );
                    }
                    return null;
                  })()}
                </>
              )}
            </ScrollView>

            {/* Modal Footer */}
            <View style={styles.purchaseModalFooter}>
              <TouchableOpacity
                style={[styles.purchaseButton, paymentInProgress && styles.purchaseButtonDisabled]}
                onPress={handlePurchase}
                disabled={paymentInProgress}
              >
                <LinearGradient
                  colors={paymentInProgress ? ['#6B7280', '#4B5563'] : ['#9BDDFF', '#B0E5FF', '#7BC5F0']}
                  style={styles.purchaseButtonGradient}
                >
                  {paymentInProgress ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.purchaseButtonText}>
                      {selectedItem?.price_amount && selectedItem.price_amount > 0
                        ? `Pay ${formatPrice(selectedItem.price_amount)}`
                        : 'Get Now'}
                    </Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 16,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backText: {
    color: '#9CA3AF',
    fontSize: 14,
    marginLeft: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tabActive: {},
  tabGradient: {
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    paddingVertical: 10,
  },
  tabTextActive: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000000',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  // Parent View - Athlete Section Styles
  athleteSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  athleteColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  athleteSectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    letterSpacing: 0.5,
  },
  noItemsText: {
    fontSize: 14,
    color: '#6B7280',
    fontStyle: 'italic',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 48,
  },
  // Active Membership Card
  activeMembershipCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    position: 'relative',
    marginBottom: 8,
  },
  activeMembershipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeMembershipIcon: {
    marginRight: 12,
  },
  iconGradient: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeMembershipInfo: {
    flex: 1,
  },
  activeMembershipName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  activeMembershipRenewal: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  manageButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  manageButtonText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  manageMenu: {
    position: 'absolute',
    top: 48,
    right: 8,
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    width: 160,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  manageMenuItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  manageMenuText: {
    fontSize: 14,
    color: '#FFFFFF',
  },
  manageMenuDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  // Usage Counters
  usageCountersContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  usageCounterRow: {
    marginBottom: 12,
  },
  usageCounterInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  usageCounterName: {
    fontSize: 13,
    color: '#E5E7EB',
    flex: 1,
  },
  usageCounterStats: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  usageUsed: {
    color: '#9BDDFF',
    fontWeight: '600',
  },
  usageCounterRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    alignItems: 'flex-end',
  },
  usageRemaining: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#9BDDFF',
  },
  usageRemainingLabel: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  usageUnlimited: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#10B981',
  },
  usageProgressBar: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 4,
  },
  usageProgressFill: {
    height: '100%',
    backgroundColor: '#9BDDFF',
    borderRadius: 2,
  },
  // Membership Type Card
  membershipTypeCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    position: 'relative',
  },
  cardDisabled: {
    opacity: 0.5,
  },
  membershipCardContent: {
    width: '100%',
  },
  membershipPriceTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  membershipPriceValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#9BDDFF',
  },
  membershipPricePeriod: {
    fontSize: 14,
    color: '#9CA3AF',
    marginLeft: 2,
  },
  membershipCardName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  membershipBillingLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 12,
  },
  membershipAllocations: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 12,
    gap: 8,
  },
  membershipAllocationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  membershipAllocationName: {
    fontSize: 14,
    color: '#E5E7EB',
    flex: 1,
  },
  membershipAllocationVisits: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  membershipAllocationUnlimited: {
    color: '#9BDDFF',
    fontSize: 18,
  },
  activeBadgeOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(155,221,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  activeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9BDDFF',
  },
  // Active Package Card
  activePackageCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 8,
  },
  activePackageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activePackageIcon: {
    marginRight: 12,
  },
  activePackageInfo: {
    flex: 1,
  },
  activePackageName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  activePackageExpiry: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  activePackageUsageRight: {
    alignItems: 'flex-end',
  },
  activePackageUsesRemaining: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#9BDDFF',
  },
  activePackageUsesLabel: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  activePackageProgress: {
    marginTop: 12,
  },
  activePackageProgressText: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'right',
  },
  activePackageValidFor: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  activePackageValidForLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  activePackageValidForList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  activePackageValidForItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(155,221,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activePackageValidForName: {
    fontSize: 12,
    color: '#9BDDFF',
    fontWeight: '500',
  },
  activePackageValidForVisits: {
    fontSize: 11,
    color: '#9CA3AF',
    marginLeft: 4,
  },
  // Package Type Cards
  packageTypeCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  packageCardContent: {
    width: '100%',
  },
  packageTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  packagePriceLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  packagePriceValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#9BDDFF',
  },
  packageClassBadge: {
    backgroundColor: 'rgba(155, 221, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  packageClassBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9BDDFF',
  },
  packageCardName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  packageCardDescription: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 12,
    lineHeight: 18,
  },
  packageAllocations: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingTop: 12,
    gap: 8,
  },
  packageAllocationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  packageAllocationName: {
    fontSize: 14,
    color: '#E5E7EB',
    flex: 1,
  },
  packageAllocationVisits: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9BDDFF',
  },
  packageAllocationUnlimited: {
    fontSize: 18,
  },
  packagePricePerClass: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  // Purchase Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  purchaseModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  purchaseModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  purchaseModalBadge: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  purchaseModalBadgeMembership: {
    backgroundColor: '#FCD34D',
  },
  purchaseModalBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#374151',
  },
  purchaseModalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  purchaseModalContent: {
    backgroundColor: '#FFFFFF',
  },
  purchaseModalMain: {
    padding: 24,
  },
  purchaseModalClassCount: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  purchaseModalClassNumber: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#000000',
  },
  purchaseModalClassLabel: {
    fontSize: 20,
    fontWeight: '600',
    color: '#9CA3AF',
    marginLeft: 8,
  },
  purchaseModalBillingNote: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
  },
  purchaseModalDivider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  purchaseModalNamePrice: {
    padding: 24,
  },
  purchaseModalName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000000',
    marginBottom: 8,
  },
  purchaseModalPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  purchaseModalPrice: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#9BDDFF',
  },
  purchaseModalPricePeriod: {
    fontSize: 16,
    color: '#9CA3AF',
    marginLeft: 4,
  },
  purchaseModalDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    padding: 24,
  },
  purchaseModalValidFor: {
    margin: 24,
    marginTop: 0,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  purchaseModalValidForHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  purchaseModalValidForTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
    marginLeft: 8,
  },
  purchaseModalValidForList: {
    gap: 8,
  },
  purchaseModalValidForItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  purchaseModalValidForDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 10,
  },
  purchaseModalValidForText: {
    fontSize: 14,
    color: '#374151',
  },
  purchaseModalAllocationItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  purchaseModalAllocationName: {
    fontSize: 14,
    color: '#374151',
    flex: 1,
  },
  purchaseModalAllocationVisits: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  purchaseModalAllocationUnlimited: {
    color: '#10B981',
    fontSize: 18,
  },
  purchaseModalValue: {
    margin: 24,
    marginTop: 0,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(155,221,255,0.3)',
    backgroundColor: 'rgba(155,221,255,0.1)',
  },
  purchaseModalValueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  purchaseModalValueTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#000000',
    marginLeft: 8,
  },
  purchaseModalValueText: {
    fontSize: 14,
    color: '#6B7280',
  },
  purchaseModalFooter: {
    padding: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
    backgroundColor: '#FFFFFF',
  },
  purchaseButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  purchaseButtonDisabled: {
    opacity: 0.7,
  },
  purchaseButtonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  purchaseButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
});
