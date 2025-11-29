import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Svg, Path } from 'react-native-svg';
import { supabase } from '../lib/supabase';

interface GroupInfo {
  id: string;
  name: string;
  description: string | null;
  color: string;
  memberCount: number;
}

interface OrgInfo {
  id: string;
  name: string;
}

export default function JoinGroupScreen({ route, navigation }: any) {
  const token = route?.params?.token || '';

  const [validating, setValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [error, setError] = useState('');
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [org, setOrg] = useState<OrgInfo | null>(null);

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [playLevel, setPlayLevel] = useState('');
  const [phone, setPhone] = useState('');
  const [primaryPosition, setPrimaryPosition] = useState('');
  const [gradYear, setGradYear] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    validateToken();
  }, [token]);

  async function validateToken() {
    setValidating(true);
    setError('');

    try {
      // In production, this would call your API
      // For now, simulate validation
      // Replace with: const response = await fetch(`/api/join/${token}`);

      // Simulated response - replace with real API call
      const mockData = {
        valid: false, // Set to true when you have a real token
        message: 'This is a demo. Replace with real token validation.',
        group: {
          id: '1',
          name: 'Baseball Training',
          description: 'Elite baseball training program',
          color: '#9BDDFF',
          memberCount: 15,
        },
        org: {
          id: '1',
          name: 'Atlantic Sports Performance',
        },
      };

      if (mockData.valid) {
        setIsValid(true);
        setGroup(mockData.group);
        setOrg(mockData.org);
      } else {
        setIsValid(false);
        setError(mockData.message || 'Invalid invite link');
      }
    } catch (err) {
      setIsValid(false);
      setError('Failed to validate invite link');
    } finally {
      setValidating(false);
    }
  }

  async function handleSubmit() {
    setFormError('');
    setSubmitting(true);

    try {
      // Validate required fields
      if (!firstName || !lastName || !email || !password || !dateOfBirth || !playLevel) {
        setFormError('Please fill in all required fields');
        return;
      }

      if (password.length < 8) {
        setFormError('Password must be at least 8 characters');
        return;
      }

      // In production, call your API endpoint
      // const response = await fetch(`/api/join/${token}`, { method: 'POST', ... });

      // For now, create account with Supabase directly
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) throw authError;

      // Navigate to dashboard
      navigation.replace('Dashboard');

    } catch (err: any) {
      setFormError(err.message || 'Failed to create account');
    } finally {
      setSubmitting(false);
    }
  }

  // Icons
  const UsersIcon = () => (
    <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <Path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <Path strokeLinecap="round" strokeLinejoin="round" d="M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" />
    </Svg>
  );

  const AlertIcon = () => (
    <Svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
      <Path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </Svg>
  );

  // Loading state
  if (validating) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#9BDDFF" />
          <Text style={styles.loadingText}>Validating invite link...</Text>
        </View>
      </View>
    );
  }

  // Invalid link state
  if (!isValid || !group || !org) {
    return (
      <View style={styles.container}>
        <View style={styles.centerContent}>
          <View style={styles.errorCard}>
            <AlertIcon />
            <Text style={styles.errorTitle}>Invalid Invite Link</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <Text style={styles.errorHint}>
              Please contact your coach or administrator for a valid invite link.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Valid link - show signup form
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Join {group.name}</Text>
          <Text style={styles.headerSubtitle}>at {org.name}</Text>
        </View>

        {/* Group Info Card */}
        <View style={styles.groupCard}>
          <View style={styles.groupCardContent}>
            <View style={[styles.groupIcon, { backgroundColor: group.color + '20' }]}>
              <UsersIcon />
            </View>
            <View style={styles.groupInfo}>
              {group.description && (
                <Text style={styles.groupDescription}>{group.description}</Text>
              )}
              <Text style={styles.memberCount}>
                Currently {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
              </Text>
            </View>
          </View>
        </View>

        {/* Signup Form */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Create Your Account</Text>

          {/* Required Fields */}
          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>First Name *</Text>
              <TextInput
                style={styles.input}
                value={firstName}
                onChangeText={setFirstName}
                placeholderTextColor="rgba(255, 255, 255, 0.5)"
                editable={!submitting}
              />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>Last Name *</Text>
              <TextInput
                style={styles.input}
                value={lastName}
                onChangeText={setLastName}
                placeholderTextColor="rgba(255, 255, 255, 0.5)"
                editable={!submitting}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email *</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholderTextColor="rgba(255, 255, 255, 0.5)"
              editable={!submitting}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password *</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholderTextColor="rgba(255, 255, 255, 0.5)"
              editable={!submitting}
            />
            <Text style={styles.hint}>Minimum 8 characters</Text>
          </View>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>Date of Birth *</Text>
              <TextInput
                style={styles.input}
                value={dateOfBirth}
                onChangeText={setDateOfBirth}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="rgba(255, 255, 255, 0.5)"
                editable={!submitting}
              />
              <Text style={styles.hint}>Required for VALD profiles</Text>
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>Play Level *</Text>
              <View style={styles.pickerWrapper}>
                <TextInput
                  style={styles.input}
                  value={playLevel}
                  onChangeText={setPlayLevel}
                  placeholder="Youth, HS, College, Pro"
                  placeholderTextColor="rgba(255, 255, 255, 0.5)"
                  editable={!submitting}
                />
              </View>
            </View>
          </View>

          {/* Optional Fields */}
          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>Optional Information</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="555-123-4567"
              keyboardType="phone-pad"
              placeholderTextColor="rgba(255, 255, 255, 0.5)"
              editable={!submitting}
            />
          </View>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>Primary Position</Text>
              <TextInput
                style={styles.input}
                value={primaryPosition}
                onChangeText={setPrimaryPosition}
                placeholder="P, OF, etc."
                placeholderTextColor="rgba(255, 255, 255, 0.5)"
                editable={!submitting}
              />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>Graduation Year</Text>
              <TextInput
                style={styles.input}
                value={gradYear}
                onChangeText={setGradYear}
                placeholder="2025"
                keyboardType="number-pad"
                placeholderTextColor="rgba(255, 255, 255, 0.5)"
                editable={!submitting}
              />
            </View>
          </View>

          {/* Error */}
          {formError ? (
            <View style={styles.formErrorContainer}>
              <Text style={styles.formErrorText}>{formError}</Text>
            </View>
          ) : null}

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting}
            style={[styles.button, submitting && styles.buttonDisabled]}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={['#9BDDFF', '#7BC5F0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.buttonGradient}
            >
              {submitting ? (
                <View style={styles.buttonContent}>
                  <ActivityIndicator size="small" color="#000" />
                  <Text style={styles.buttonText}>Creating Account...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Create Account & Join Group</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.signInText}>
              Already have an account? <Text style={styles.signInLink}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  errorCard: {
    maxWidth: 400,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 16,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: 24,
  },
  errorHint: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  headerTitle: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 20,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  groupCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 24,
    marginBottom: 24,
  },
  groupCardContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  groupIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupInfo: {
    flex: 1,
  },
  groupDescription: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 8,
  },
  memberCount: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
  },
  formCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 32,
  },
  formTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  field: {
    marginBottom: 16,
  },
  halfField: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: '#FFFFFF',
  },
  pickerWrapper: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 16,
  },
  formErrorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  formErrorText: {
    fontSize: 14,
    color: '#EF4444',
  },
  button: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    shadowColor: '#9BDDFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonGradient: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
  },
  signInText: {
    textAlign: 'center',
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 24,
  },
  signInLink: {
    color: '#9BDDFF',
  },
});
