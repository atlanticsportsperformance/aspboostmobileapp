import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  RefreshControl,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { unregisterPushToken } from '../lib/pushNotifications';

const COLORS = {
  primary: '#9BDDFF',
  primaryDark: '#7BC5F0',
  secondary: '#F5F0E6',
  black: '#0A0A0A',
  white: '#FFFFFF',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  red500: '#EF4444',
  green500: '#22C55E',
  yellow500: '#EAB308',
  purple500: '#A855F7',
};

interface Athlete {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  primary_position: string | null;
  secondary_position: string | null;
  grad_year: string | null;
  height: string | null;
  weight: string | null;
  play_level: string | null;
}

interface LinkedAthlete {
  id: string;
  athlete_id: string;
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth: string | null;
  color: string;
}

interface LinkedGuardian {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  color: string;
}

const ATHLETE_COLORS = [
  '#9BDDFF',
  '#FFB84D',
  '#A78BFA',
  '#FB923C',
  '#34D399',
  '#F472B6',
];

const PLAY_LEVELS = ['Youth', 'High School', 'College', 'Pro'];

export default function ProfileScreen({ navigation, route }: any) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [isParent, setIsParent] = useState(false);
  const [linkedAthletes, setLinkedAthletes] = useState<LinkedAthlete[]>([]);
  const [linkedGuardians, setLinkedGuardians] = useState<LinkedGuardian[]>([]);

  // Profile form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [primaryPosition, setPrimaryPosition] = useState('');
  const [secondaryPosition, setSecondaryPosition] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [height, setHeight] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  // Password change state
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Play level state
  const [playLevel, setPlayLevel] = useState('');
  const [showPlayLevelPicker, setShowPlayLevelPicker] = useState(false);
  const [hasForceData, setHasForceData] = useState(false);
  const [showPlayLevelWarning, setShowPlayLevelWarning] = useState(false);
  const [pendingPlayLevel, setPendingPlayLevel] = useState('');

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    loadProfileData();
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function loadProfileData() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      // Check if user is a parent
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', user.id)
        .single();

      // Check if still mounted before updating state
      if (!isMountedRef.current) return;

      if (profile?.account_type === 'parent') {
        setIsParent(true);
        await loadLinkedAthletes(user.id);
      } else {
        // For athletes, load linked guardians (parents)
        await loadLinkedGuardians(user.id);
      }

      // Check if still mounted before continuing
      if (!isMountedRef.current) return;

      // Load athlete data
      const { data: athleteData, error } = await supabase
        .from('athletes')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (error || !athleteData) {
        console.error('Error loading athlete:', error);
        if (isMountedRef.current) setLoading(false);
        return;
      }

      // Check if still mounted before updating state
      if (!isMountedRef.current) return;

      setAthlete(athleteData);
      populateFormFields(athleteData);

      // Check for force plate data
      const [cmj, sj, hj, ppu, imtp] = await Promise.all([
        supabase.from('cmj_tests').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteData.id),
        supabase.from('sj_tests').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteData.id),
        supabase.from('hj_tests').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteData.id),
        supabase.from('ppu_tests').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteData.id),
        supabase.from('imtp_tests').select('id', { count: 'exact', head: true }).eq('athlete_id', athleteData.id),
      ]);

      // Check if still mounted before updating state
      if (!isMountedRef.current) return;

      const hasData = (cmj.count || 0) > 0 || (sj.count || 0) > 0 || (hj.count || 0) > 0 || (ppu.count || 0) > 0 || (imtp.count || 0) > 0;
      setHasForceData(hasData);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }

  async function loadLinkedAthletes(parentId: string) {
    try {
      const { data: guardianships } = await supabase
        .from('athlete_guardians')
        .select(`
          athlete:profiles!athlete_guardians_athlete_id_fkey(
            id,
            first_name,
            last_name,
            email
          )
        `)
        .eq('guardian_id', parentId);

      const athletesWithDetails = await Promise.all(
        (guardianships || [])
          .filter((g: any) => g.athlete)
          .map(async (g: any, index: number) => {
            const { data: athleteDetails } = await supabase
              .from('athletes')
              .select('id, date_of_birth')
              .eq('user_id', g.athlete.id)
              .maybeSingle();

            return {
              id: g.athlete.id,
              athlete_id: athleteDetails?.id || g.athlete.id,
              first_name: g.athlete.first_name,
              last_name: g.athlete.last_name,
              email: g.athlete.email,
              date_of_birth: athleteDetails?.date_of_birth || null,
              color: ATHLETE_COLORS[index % ATHLETE_COLORS.length],
            };
          })
      );

      setLinkedAthletes(athletesWithDetails);
    } catch (error) {
      console.error('Error fetching linked athletes:', error);
    }
  }

  async function loadLinkedGuardians(athleteUserId: string) {
    try {
      const { data: guardianships } = await supabase
        .from('athlete_guardians')
        .select(`
          guardian:profiles!athlete_guardians_guardian_id_fkey(
            id,
            first_name,
            last_name,
            email
          )
        `)
        .eq('athlete_id', athleteUserId);

      const guardians = (guardianships || [])
        .filter((g: any) => g.guardian)
        .map((g: any, index: number) => ({
          id: g.guardian.id,
          first_name: g.guardian.first_name,
          last_name: g.guardian.last_name,
          email: g.guardian.email,
          color: ATHLETE_COLORS[index % ATHLETE_COLORS.length],
        }));

      setLinkedGuardians(guardians);
    } catch (error) {
      console.error('Error fetching linked guardians:', error);
    }
  }

  function populateFormFields(data: Athlete) {
    setFirstName(data.first_name || '');
    setLastName(data.last_name || '');
    setPhone(data.phone || '');
    setDateOfBirth(data.date_of_birth || '');
    setPrimaryPosition(data.primary_position || '');
    setSecondaryPosition(data.secondary_position || '');
    setGradYear(data.grad_year || '');
    setHeight(data.height || '');
    setPlayLevel(data.play_level || '');
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadProfileData();
    setRefreshing(false);
  }

  async function handleProfileUpdate() {
    setProfileError('');
    setProfileSuccess('');

    if (!firstName || !lastName) {
      setProfileError('First name and last name are required');
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from('athletes')
        .update({
          first_name: firstName,
          last_name: lastName,
          phone: phone || null,
          date_of_birth: dateOfBirth || null,
          primary_position: primaryPosition || null,
          secondary_position: secondaryPosition || null,
          grad_year: gradYear || null,
          height: height || null,
        })
        .eq('id', athlete?.id);

      if (error) throw error;

      setAthlete({
        ...athlete!,
        first_name: firstName,
        last_name: lastName,
        phone,
        date_of_birth: dateOfBirth,
        primary_position: primaryPosition,
        secondary_position: secondaryPosition,
        grad_year: gradYear,
        height,
      });

      setProfileSuccess('Profile updated successfully!');
      setEditingProfile(false);
    } catch (error: any) {
      setProfileError(error.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange() {
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      setPasswordSuccess('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordSection(false);
    } catch (error: any) {
      setPasswordError(error.message || 'Failed to update password');
    } finally {
      setSaving(false);
    }
  }

  function handlePlayLevelSelect(level: string) {
    setShowPlayLevelPicker(false);
    if (level === athlete?.play_level) return;

    if (hasForceData) {
      setPendingPlayLevel(level);
      setShowPlayLevelWarning(true);
    } else {
      confirmPlayLevelChange(level);
    }
  }

  async function confirmPlayLevelChange(level: string) {
    setSaving(true);
    setShowPlayLevelWarning(false);

    try {
      const { error } = await supabase
        .from('athletes')
        .update({ play_level: level })
        .eq('id', athlete?.id);

      if (error) throw error;

      setPlayLevel(level);
      setAthlete({ ...athlete!, play_level: level });
      Alert.alert('Success', 'Play level updated successfully!');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update play level');
    } finally {
      setSaving(false);
      setPendingPlayLevel('');
    }
  }

  function calculateAge(dateOfBirth: string | null): string {
    if (!dateOfBirth) return 'N/A';
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return `${age} years old`;
  }

  function formatDate(dateString: string | null): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!athlete) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.gray400} />
          <Text style={styles.loadingText}>Failed to load profile</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackButton}>
            <Ionicons name="chevron-back" size={24} color={COLORS.gray400} />
            <Text style={styles.headerBackText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile Settings</Text>
          <Text style={styles.headerSubtitle}>Manage your account and preferences</Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* Profile Info Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.profileHeader}>
                <LinearGradient
                  colors={[COLORS.primary, COLORS.primaryDark]}
                  style={styles.avatar}
                >
                  <Text style={styles.avatarText}>
                    {athlete.first_name?.[0]}{athlete.last_name?.[0]}
                  </Text>
                </LinearGradient>
                <View style={styles.profileInfo}>
                  <Text style={styles.profileName}>
                    {athlete.first_name} {athlete.last_name}
                  </Text>
                  <Text style={styles.profileEmail}>{athlete.email}</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (editingProfile) {
                    populateFormFields(athlete);
                    setProfileError('');
                    setProfileSuccess('');
                  }
                  setEditingProfile(!editingProfile);
                }}
                style={styles.editButton}
              >
                <Ionicons name={editingProfile ? 'close' : 'pencil'} size={18} color={COLORS.gray400} />
              </TouchableOpacity>
            </View>

            {editingProfile ? (
              <View style={styles.form}>
                {/* Name Fields */}
                <View style={styles.formRow}>
                  <View style={styles.formFieldHalf}>
                    <Text style={styles.formLabel}>First Name *</Text>
                    <TextInput
                      style={styles.formInput}
                      value={firstName}
                      onChangeText={setFirstName}
                      placeholder="First name"
                      placeholderTextColor={COLORS.gray500}
                    />
                  </View>
                  <View style={styles.formFieldHalf}>
                    <Text style={styles.formLabel}>Last Name *</Text>
                    <TextInput
                      style={styles.formInput}
                      value={lastName}
                      onChangeText={setLastName}
                      placeholder="Last name"
                      placeholderTextColor={COLORS.gray500}
                    />
                  </View>
                </View>

                {/* Phone */}
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>
                    <Ionicons name="call-outline" size={14} color={COLORS.gray400} /> Phone Number
                  </Text>
                  <TextInput
                    style={styles.formInput}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="(555) 123-4567"
                    placeholderTextColor={COLORS.gray500}
                    keyboardType="phone-pad"
                  />
                </View>

                {/* Date of Birth */}
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>
                    <Ionicons name="calendar-outline" size={14} color={COLORS.gray400} /> Date of Birth
                  </Text>
                  <TextInput
                    style={styles.formInput}
                    value={dateOfBirth}
                    onChangeText={setDateOfBirth}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={COLORS.gray500}
                  />
                </View>

                {/* Positions */}
                <View style={styles.formRow}>
                  <View style={styles.formFieldHalf}>
                    <Text style={styles.formLabel}>Primary Position</Text>
                    <TextInput
                      style={styles.formInput}
                      value={primaryPosition}
                      onChangeText={setPrimaryPosition}
                      placeholder="e.g., Pitcher"
                      placeholderTextColor={COLORS.gray500}
                    />
                  </View>
                  <View style={styles.formFieldHalf}>
                    <Text style={styles.formLabel}>Secondary Position</Text>
                    <TextInput
                      style={styles.formInput}
                      value={secondaryPosition}
                      onChangeText={setSecondaryPosition}
                      placeholder="e.g., Outfield"
                      placeholderTextColor={COLORS.gray500}
                    />
                  </View>
                </View>

                {/* Grad Year */}
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Graduation Year</Text>
                  <TextInput
                    style={styles.formInput}
                    value={gradYear}
                    onChangeText={setGradYear}
                    placeholder="e.g., 2025"
                    placeholderTextColor={COLORS.gray500}
                    keyboardType="number-pad"
                  />
                </View>

                {/* Physical Stats */}
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Height</Text>
                  <TextInput
                    style={styles.formInput}
                    value={height}
                    onChangeText={setHeight}
                    placeholder={'e.g., 6\'2"'}
                    placeholderTextColor={COLORS.gray500}
                  />
                </View>

                {profileError ? (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{profileError}</Text>
                  </View>
                ) : null}

                {profileSuccess ? (
                  <View style={styles.successContainer}>
                    <Text style={styles.successText}>{profileSuccess}</Text>
                  </View>
                ) : null}

                <View style={styles.formButtons}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => {
                      populateFormFields(athlete);
                      setEditingProfile(false);
                      setProfileError('');
                      setProfileSuccess('');
                    }}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                    onPress={handleProfileUpdate}
                    disabled={saving}
                  >
                    <Text style={styles.saveButtonText}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.profileDetails}>
                {athlete.phone && (
                  <View style={styles.detailRow}>
                    <Ionicons name="call-outline" size={16} color={COLORS.gray400} />
                    <Text style={styles.detailText}>{athlete.phone}</Text>
                  </View>
                )}
                {athlete.date_of_birth && (
                  <View style={styles.detailRow}>
                    <Ionicons name="calendar-outline" size={16} color={COLORS.gray400} />
                    <Text style={styles.detailText}>{formatDate(athlete.date_of_birth)}</Text>
                  </View>
                )}
                {(athlete.primary_position || athlete.secondary_position) && (
                  <View style={styles.detailRow}>
                    <Ionicons name="person-outline" size={16} color={COLORS.gray400} />
                    <Text style={styles.detailText}>
                      {[athlete.primary_position, athlete.secondary_position].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                )}
                {athlete.grad_year && (
                  <View style={styles.detailRow}>
                    <Ionicons name="school-outline" size={16} color={COLORS.gray400} />
                    <Text style={styles.detailText}>Class of {athlete.grad_year}</Text>
                  </View>
                )}
                {(athlete.height || athlete.weight) && (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="human-male-height" size={16} color={COLORS.gray400} />
                    <Text style={styles.detailText}>
                      {[athlete.height, athlete.weight].filter(Boolean).join(', ')}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Play Level Section */}
          <View style={styles.card}>
            <View style={styles.cardSectionHeader}>
              <Ionicons name="trending-up" size={20} color={COLORS.primary} />
              <Text style={styles.cardSectionTitle}>Play Level</Text>
            </View>

            <TouchableOpacity
              style={styles.playLevelSelector}
              onPress={() => setShowPlayLevelPicker(true)}
            >
              <Text style={playLevel ? styles.playLevelText : styles.playLevelPlaceholder}>
                {playLevel || 'Select play level'}
              </Text>
              <Ionicons name="chevron-down" size={20} color={COLORS.gray400} />
            </TouchableOpacity>

            {playLevel && (
              <Text style={styles.playLevelHint}>
                Current: <Text style={styles.playLevelHighlight}>{playLevel}</Text>
              </Text>
            )}
          </View>

          {/* Billing & Payments Section */}
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('Billing')}
          >
            <View style={styles.cardSectionHeader}>
              <Ionicons name="card" size={20} color={COLORS.purple500} />
              <Text style={styles.cardSectionTitle}>Billing & Payments</Text>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={COLORS.gray400}
                style={{ marginLeft: 'auto' }}
              />
            </View>
            <Text style={styles.billingDescription}>
              Manage payment methods and view transaction history
            </Text>
          </TouchableOpacity>

          {/* Waivers Section */}
          <TouchableOpacity
            style={styles.card}
            onPress={() => navigation.navigate('Waivers')}
          >
            <View style={styles.cardSectionHeader}>
              <Ionicons name="document-text" size={20} color={COLORS.yellow500} />
              <Text style={styles.cardSectionTitle}>Waivers</Text>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={COLORS.gray400}
                style={{ marginLeft: 'auto' }}
              />
            </View>
            <Text style={styles.billingDescription}>
              View and sign required waivers
            </Text>
          </TouchableOpacity>

          {/* Change Password Section */}
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.cardSectionHeader}
              onPress={() => setShowPasswordSection(!showPasswordSection)}
            >
              <Ionicons name="lock-closed" size={20} color={COLORS.primary} />
              <Text style={styles.cardSectionTitle}>Change Password</Text>
              <Ionicons
                name={showPasswordSection ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={COLORS.gray400}
                style={{ marginLeft: 'auto' }}
              />
            </TouchableOpacity>

            {showPasswordSection && (
              <View style={styles.form}>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Current Password</Text>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={styles.passwordInput}
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      placeholder="Enter current password"
                      placeholderTextColor={COLORS.gray500}
                      secureTextEntry={!showCurrentPassword}
                    />
                    <TouchableOpacity
                      onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                      style={styles.passwordToggle}
                    >
                      <Ionicons
                        name={showCurrentPassword ? 'eye-off' : 'eye'}
                        size={20}
                        color={COLORS.gray400}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>New Password</Text>
                  <View style={styles.passwordInputContainer}>
                    <TextInput
                      style={styles.passwordInput}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      placeholder="Enter new password (min 8 characters)"
                      placeholderTextColor={COLORS.gray500}
                      secureTextEntry={!showNewPassword}
                    />
                    <TouchableOpacity
                      onPress={() => setShowNewPassword(!showNewPassword)}
                      style={styles.passwordToggle}
                    >
                      <Ionicons
                        name={showNewPassword ? 'eye-off' : 'eye'}
                        size={20}
                        color={COLORS.gray400}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Confirm New Password</Text>
                  <TextInput
                    style={styles.formInput}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Confirm new password"
                    placeholderTextColor={COLORS.gray500}
                    secureTextEntry
                  />
                </View>

                {passwordError ? (
                  <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{passwordError}</Text>
                  </View>
                ) : null}

                {passwordSuccess ? (
                  <View style={styles.successContainer}>
                    <Text style={styles.successText}>{passwordSuccess}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.saveButton, { marginTop: 12 }, saving && styles.saveButtonDisabled]}
                  onPress={handlePasswordChange}
                  disabled={saving}
                >
                  <Text style={styles.saveButtonText}>
                    {saving ? 'Updating...' : 'Update Password'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Linked Accounts Section (Parents Only) */}
          {isParent && linkedAthletes.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardSectionHeader}>
                <Ionicons name="people" size={20} color={COLORS.primary} />
                <Text style={styles.cardSectionTitle}>Linked Athletes</Text>
              </View>

              <View style={styles.linkedAthletesList}>
                {linkedAthletes.map((linkedAthlete) => (
                  <View key={linkedAthlete.id} style={styles.linkedAthleteCard}>
                    <View
                      style={[styles.linkedAthleteAvatar, { backgroundColor: linkedAthlete.color }]}
                    >
                      <Text style={styles.linkedAthleteAvatarText}>
                        {linkedAthlete.first_name?.[0]}{linkedAthlete.last_name?.[0]}
                      </Text>
                    </View>
                    <View style={styles.linkedAthleteInfo}>
                      <Text style={styles.linkedAthleteName}>
                        {linkedAthlete.first_name} {linkedAthlete.last_name}
                      </Text>
                      <Text style={styles.linkedAthleteEmail}>{linkedAthlete.email}</Text>
                      {linkedAthlete.date_of_birth && (
                        <Text style={styles.linkedAthleteAge}>
                          {calculateAge(linkedAthlete.date_of_birth)}
                        </Text>
                      )}
                    </View>
                    <View
                      style={[styles.colorIndicator, { backgroundColor: linkedAthlete.color }]}
                    />
                  </View>
                ))}
              </View>

              <View style={styles.linkedAccountsInfo}>
                <Text style={styles.linkedAccountsInfoText}>
                  Color indicators are used on the calendar for easy identification.
                </Text>
              </View>
            </View>
          )}

          {/* Linked Guardians Section (Athletes Only) */}
          {!isParent && linkedGuardians.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardSectionHeader}>
                <Ionicons name="people" size={20} color={COLORS.primary} />
                <Text style={styles.cardSectionTitle}>Linked Accounts</Text>
              </View>

              <View style={styles.linkedAthletesList}>
                {linkedGuardians.map((guardian) => (
                  <View key={guardian.id} style={styles.linkedAthleteCard}>
                    <View
                      style={[styles.linkedAthleteAvatar, { backgroundColor: guardian.color }]}
                    >
                      <Text style={styles.linkedAthleteAvatarText}>
                        {guardian.first_name?.[0]}{guardian.last_name?.[0]}
                      </Text>
                    </View>
                    <View style={styles.linkedAthleteInfo}>
                      <Text style={styles.linkedAthleteName}>
                        {guardian.first_name} {guardian.last_name}
                      </Text>
                      <Text style={styles.linkedAthleteEmail}>{guardian.email}</Text>
                      <Text style={styles.linkedAthleteAge}>Parent/Guardian</Text>
                    </View>
                    <View
                      style={[styles.colorIndicator, { backgroundColor: guardian.color }]}
                    />
                  </View>
                ))}
              </View>

              <View style={styles.linkedAccountsInfo}>
                <Text style={styles.linkedAccountsInfoText}>
                  These accounts have access to view your profile and data.
                </Text>
              </View>
            </View>
          )}

          {/* Logout Button */}
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={() => {
              Alert.alert(
                'Sign Out',
                'Are you sure you want to sign out?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Sign Out',
                    style: 'destructive',
                    onPress: async () => {
                      // Unregister push token before signing out
                      await unregisterPushToken();
                      await supabase.auth.signOut();
                      navigation.replace('Login');
                    },
                  },
                ]
              );
            }}
          >
            <Ionicons name="log-out-outline" size={20} color={COLORS.red500} />
            <Text style={styles.logoutButtonText}>Sign Out</Text>
          </TouchableOpacity>

          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Play Level Picker Modal */}
        <Modal
          visible={showPlayLevelPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPlayLevelPicker(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowPlayLevelPicker(false)}
          >
            <View style={styles.pickerModal}>
              <Text style={styles.pickerTitle}>Select Play Level</Text>
              {PLAY_LEVELS.map((level) => (
                <TouchableOpacity
                  key={level}
                  style={[
                    styles.pickerOption,
                    playLevel === level && styles.pickerOptionSelected,
                  ]}
                  onPress={() => handlePlayLevelSelect(level)}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      playLevel === level && styles.pickerOptionTextSelected,
                    ]}
                  >
                    {level}
                  </Text>
                  {playLevel === level && (
                    <Ionicons name="checkmark" size={20} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Play Level Warning Modal */}
        <Modal
          visible={showPlayLevelWarning}
          transparent
          animationType="fade"
          onRequestClose={() => setShowPlayLevelWarning(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.warningModal}>
              <View style={styles.warningHeader}>
                <Ionicons name="warning" size={24} color={COLORS.yellow500} />
                <Text style={styles.warningTitle}>Force Profile Warning</Text>
              </View>
              <Text style={styles.warningText}>
                Changing your play level will recalculate all your Force Profile percentiles based on the new comparison group. This may significantly change your scores.
              </Text>
              <View style={styles.warningButtons}>
                <TouchableOpacity
                  style={styles.warningCancelButton}
                  onPress={() => {
                    setShowPlayLevelWarning(false);
                    setPendingPlayLevel('');
                  }}
                >
                  <Text style={styles.warningCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.warningConfirmButton}
                  onPress={() => confirmPlayLevelChange(pendingPlayLevel)}
                >
                  <Text style={styles.warningConfirmButtonText}>
                    {saving ? 'Updating...' : 'Update Level'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>

      {/* FAB Back Button */}
      <TouchableOpacity style={styles.fab} onPress={() => navigation.goBack()}>
        <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.fabGradient}>
          <Ionicons name="chevron-back" size={24} color={COLORS.black} />
        </LinearGradient>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.gray400,
    fontSize: 14,
    marginTop: 16,
  },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
  },
  backButtonText: {
    color: COLORS.white,
    fontSize: 14,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  headerBackText: {
    color: COLORS.gray400,
    fontSize: 14,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.gray400,
    marginTop: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.black,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
  },
  profileEmail: {
    fontSize: 14,
    color: COLORS.gray400,
    marginTop: 2,
  },
  editButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  profileDetails: {
    gap: 12,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 14,
    color: COLORS.gray300,
  },
  form: {
    gap: 12,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
  },
  formField: {
    gap: 6,
  },
  formFieldHalf: {
    flex: 1,
    gap: 6,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray400,
  },
  formInput: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.white,
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.white,
  },
  passwordToggle: {
    padding: 12,
  },
  formButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.white,
  },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.black,
  },
  errorContainer: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.red500,
  },
  successContainer: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.2)',
    borderRadius: 12,
    padding: 12,
  },
  successText: {
    fontSize: 14,
    color: COLORS.green500,
  },
  cardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
  },
  billingDescription: {
    fontSize: 13,
    color: COLORS.gray400,
    marginTop: 4,
  },
  playLevelSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  playLevelText: {
    fontSize: 16,
    color: COLORS.white,
  },
  playLevelPlaceholder: {
    fontSize: 16,
    color: COLORS.gray500,
  },
  playLevelHint: {
    fontSize: 12,
    color: COLORS.gray400,
    marginTop: 8,
  },
  playLevelHighlight: {
    color: COLORS.primary,
    fontWeight: '500',
  },
  linkedAthletesList: {
    gap: 12,
  },
  linkedAthleteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 12,
  },
  linkedAthleteAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  linkedAthleteAvatarText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.black,
  },
  linkedAthleteInfo: {
    flex: 1,
  },
  linkedAthleteName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  linkedAthleteEmail: {
    fontSize: 13,
    color: COLORS.gray400,
    marginTop: 2,
  },
  linkedAthleteAge: {
    fontSize: 12,
    color: COLORS.gray500,
    marginTop: 2,
  },
  colorIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  linkedAccountsInfo: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  linkedAccountsInfoText: {
    fontSize: 12,
    color: COLORS.gray500,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.red500,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  pickerModal: {
    backgroundColor: COLORS.black,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    width: '100%',
    maxWidth: 320,
    padding: 16,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
    marginBottom: 16,
    textAlign: 'center',
  },
  pickerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  pickerOptionSelected: {
    backgroundColor: 'rgba(155,221,255,0.1)',
  },
  pickerOptionText: {
    fontSize: 16,
    color: COLORS.white,
  },
  pickerOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  warningModal: {
    backgroundColor: COLORS.black,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    width: '100%',
    maxWidth: 360,
    padding: 20,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  warningTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.yellow500,
  },
  warningText: {
    fontSize: 14,
    color: COLORS.gray400,
    lineHeight: 20,
    marginBottom: 20,
  },
  warningButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  warningCancelButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  warningCancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.white,
  },
  warningConfirmButton: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: COLORS.yellow500,
    borderRadius: 12,
    alignItems: 'center',
  },
  warningConfirmButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.black,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
