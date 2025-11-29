import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Svg, Path, Circle } from 'react-native-svg';
import { supabase } from '../lib/supabase';

export default function LoginScreen({ navigation }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  // Animation values
  const pulse1 = useRef(new Animated.Value(0.3)).current;
  const pulse2 = useRef(new Animated.Value(0.2)).current;
  const shakeAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Animated gradient pulses
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse1, {
          toValue: 0.5,
          duration: 4000,
          useNativeDriver: true,
        }),
        Animated.timing(pulse1, {
          toValue: 0.3,
          duration: 4000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse2, {
          toValue: 0.4,
          duration: 5000,
          useNativeDriver: true,
        }),
        Animated.timing(pulse2, {
          toValue: 0.2,
          duration: 5000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (error) {
      // Shake animation on error
      Animated.sequence([
        Animated.timing(shakeAnimation, { toValue: -4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: -4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    }
  }, [error]);

  async function handleLogin() {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) throw authError;

      navigation.replace('Dashboard');
    } catch (error: any) {
      setError(error.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  }

  // SVG Icons
  const MailIcon = () => (
    <Svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
      <Path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
    </Svg>
  );

  const LockIcon = () => (
    <Svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
      <Path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </Svg>
  );

  const ArrowRightIcon = () => (
    <Svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <Path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </Svg>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.contentContainer}>
          {/* Logo */}
          <View style={styles.logoContainer}>
            <LinearGradient
              colors={['#9BDDFF', '#B0E5FF', '#7BC5F0']}
              style={styles.logo}
            >
              <Text style={styles.logoText}>A</Text>
            </LinearGradient>
          </View>

          {/* Title */}
          <View style={styles.titleContainer}>
            <Text style={styles.title}>
              ASP <Text style={styles.titleGradient}>Boost+</Text>
            </Text>
            <Text style={styles.subtitle}>Professional Athlete Performance Platform</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {/* Welcome */}
            <View style={styles.welcomeContainer}>
              <Text style={styles.welcomeTitle}>Welcome Back</Text>
              <Text style={styles.welcomeSubtitle}>Sign in to access your training dashboard</Text>
            </View>

            {/* Error */}
            {error ? (
              <Animated.View style={[styles.errorContainer, { transform: [{ translateX: shakeAnimation }] }]}>
                <View style={styles.errorIcon}>
                  <Svg width="12" height="12" viewBox="0 0 12 12" fill="#EF4444">
                    <Path d="M6 0a6 6 0 100 12A6 6 0 006 0zm0 10a1 1 0 110-2 1 1 0 010 2zm0-3a1 1 0 01-1-1V3a1 1 0 112 0v3a1 1 0 01-1 1z" />
                  </Svg>
                </View>
                <Text style={styles.errorText}>{error}</Text>
              </Animated.View>
            ) : null}

            {/* Email */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={styles.inputWrapper}>
                <View style={styles.inputIconContainer}>
                  <MailIcon />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="your.email@example.com"
                  placeholderTextColor="rgba(255, 255, 255, 0.4)"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!loading}
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Password</Text>
                <TouchableOpacity disabled={loading}>
                  <Text style={styles.forgotPassword}>Forgot password?</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.inputWrapper}>
                <View style={styles.inputIconContainer}>
                  <LockIcon />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••••••"
                  placeholderTextColor="rgba(255, 255, 255, 0.4)"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="password"
                  editable={!loading}
                />
              </View>
            </View>

            {/* Remember Me */}
            <TouchableOpacity
              onPress={() => setRememberMe(!rememberMe)}
              style={styles.rememberMeContainer}
              activeOpacity={0.7}
              disabled={loading}
            >
              <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                {rememberMe && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
              <Text style={styles.rememberMeText}>Remember me for 30 days</Text>
            </TouchableOpacity>

            {/* Sign In Button */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              style={[styles.button, loading && styles.buttonDisabled]}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={['#9BDDFF', '#7BC5F0']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.buttonGradient}
              >
                <View style={styles.buttonContent}>
                  {loading ? (
                    <>
                      <Text style={styles.spinner}>⟳</Text>
                      <Text style={styles.buttonText}>Signing in...</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.buttonText}>Sign In</Text>
                      <ArrowRightIcon />
                    </>
                  )}
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* Security */}
            <View style={styles.security}>
              <LockIcon />
              <Text style={styles.securityText}>Secured with industry-standard encryption</Text>
            </View>
          </View>

          {/* Footer */}
          <Text style={styles.footer}>© 2025 Atlantic Sports Performance. All rights reserved.</Text>
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
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 40,
  },
  gradientBlob1: {
    position: 'absolute',
    top: -200,
    right: -200,
    width: 600,
    height: 600,
    borderRadius: 300,
    backgroundColor: '#9BDDFF',
  },
  gradientBlob2: {
    position: 'absolute',
    bottom: -200,
    left: -200,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: '#7BC5F0',
  },
  contentContainer: {
    paddingHorizontal: 16,
    maxWidth: 448,
    width: '100%',
    alignSelf: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#9BDDFF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  logoText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000000',
  },
  titleContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  titleGradient: {
    color: '#9BDDFF',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
  },
  card: {
    position: 'relative',
    backgroundColor: 'rgba(15, 20, 25, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 24,
    padding: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 20,
  },
  welcomeContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  errorIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  errorText: {
    flex: 1,
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  forgotPassword: {
    fontSize: 12,
    color: '#9BDDFF',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  inputIconContainer: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    paddingVertical: 12,
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#9BDDFF',
    borderColor: '#9BDDFF',
  },
  checkmark: {
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  rememberMeText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  button: {
    borderRadius: 12,
    overflow: 'hidden',
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
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  spinner: {
    fontSize: 20,
    color: '#000',
  },
  security: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    gap: 8,
  },
  securityText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    marginLeft: 8,
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.3)',
    marginTop: 24,
  },
});
