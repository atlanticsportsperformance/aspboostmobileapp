import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  Alert,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Svg, Path } from 'react-native-svg';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { setupPushNotifications } from '../lib/pushNotifications';
import { useAuth } from '../contexts/AuthContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const COLORS = {
  accent: '#9BDDFF',
  accentDeep: '#7BC5F0',
  bg: '#0A0A0A',
  inputBg: 'rgba(255,255,255,0.03)',
  inputBorder: 'rgba(255,255,255,0.08)',
};

// Particle data generated once
const PARTICLE_COUNT = 25;
const PARTICLES = Array.from({ length: PARTICLE_COUNT }, () => ({
  x: Math.random() * SCREEN_WIDTH,
  y: Math.random() * SCREEN_HEIGHT,
  size: 1 + Math.random() * 2,
  opacity: 0.04 + Math.random() * 0.04,
  driftX: (Math.random() - 0.5) * 60,
  driftY: (Math.random() - 0.5) * 60,
  duration: 8000 + Math.random() * 7000,
}));

function ParticleField() {
  const anims = useRef(
    PARTICLES.map(() => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    PARTICLES.forEach((p, i) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(anims[i].x, { toValue: p.driftX, duration: p.duration, useNativeDriver: true }),
          Animated.timing(anims[i].x, { toValue: 0, duration: p.duration, useNativeDriver: true }),
        ])
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(anims[i].y, { toValue: p.driftY, duration: p.duration * 1.1, useNativeDriver: true }),
          Animated.timing(anims[i].y, { toValue: 0, duration: p.duration * 1.1, useNativeDriver: true }),
        ])
      ).start();
    });
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {PARTICLES.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            borderRadius: p.size / 2,
            backgroundColor: COLORS.accent,
            opacity: p.opacity,
            transform: [{ translateX: anims[i].x }, { translateY: anims[i].y }],
          }}
        />
      ))}
    </View>
  );
}

export default function LoginScreen({ navigation, route }: any) {
  const { session, isParentAccount, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enableFaceId, setEnableFaceId] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [hasSavedCredentials, setHasSavedCredentials] = useState(false);

  // Animation values
  const logoScale = useRef(new Animated.Value(0)).current;
  const glowRingOpacity = useRef(new Animated.Value(0)).current;
  // radialGlow removed — looked bad on device
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(20)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(20)).current;
  const separatorOpacity = useRef(new Animated.Value(0)).current;
  const welcomeOpacity = useRef(new Animated.Value(0)).current;
  const welcomeTranslateY = useRef(new Animated.Value(15)).current;
  const emailOpacity = useRef(new Animated.Value(0)).current;
  const emailTranslateY = useRef(new Animated.Value(15)).current;
  const passwordOpacity = useRef(new Animated.Value(0)).current;
  const passwordTranslateY = useRef(new Animated.Value(15)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;
  const buttonTranslateY = useRef(new Animated.Value(15)).current;
  const footerOpacity = useRef(new Animated.Value(0)).current;
  const scanLineY = useRef(new Animated.Value(-2)).current;
  const scanLineOpacity = useRef(new Animated.Value(0)).current;
  const buttonGlow = useRef(new Animated.Value(0.15)).current;
  const shakeAnimation = useRef(new Animated.Value(0)).current;

  // Navigate when session becomes available
  useEffect(() => {
    if (session) {
      console.log('[Login] Session detected, navigating. isParent:', isParentAccount);
      navigation.replace(isParentAccount ? 'ParentDashboard' : 'Dashboard');
    }
  }, [session, isParentAccount, navigation]);

  useEffect(() => {
    checkBiometricSupport();
    checkSavedCredentials();
    startAnimations();
  }, []);

  function startAnimations() {
    // Logo springs in
    Animated.spring(logoScale, { toValue: 1, damping: 10, stiffness: 100, useNativeDriver: true }).start();

    // Glow ring fades in then pulses
    Animated.timing(glowRingOpacity, { toValue: 0.5, duration: 400, delay: 100, useNativeDriver: true }).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowRingOpacity, { toValue: 0.7, duration: 2500, useNativeDriver: true }),
          Animated.timing(glowRingOpacity, { toValue: 0.3, duration: 2500, useNativeDriver: true }),
        ])
      ).start();
    });

    // Title
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 500, delay: 300, useNativeDriver: true }),
      Animated.timing(titleTranslateY, { toValue: 0, duration: 500, delay: 300, useNativeDriver: true }),
    ]).start();

    // Tagline
    Animated.parallel([
      Animated.timing(taglineOpacity, { toValue: 1, duration: 500, delay: 500, useNativeDriver: true }),
      Animated.timing(taglineTranslateY, { toValue: 0, duration: 500, delay: 500, useNativeDriver: true }),
    ]).start();

    // Staggered form elements
    Animated.timing(separatorOpacity, { toValue: 1, duration: 400, delay: 650, useNativeDriver: true }).start();

    Animated.parallel([
      Animated.timing(welcomeOpacity, { toValue: 1, duration: 450, delay: 750, useNativeDriver: true }),
      Animated.timing(welcomeTranslateY, { toValue: 0, duration: 450, delay: 750, useNativeDriver: true }),
    ]).start();

    Animated.parallel([
      Animated.timing(emailOpacity, { toValue: 1, duration: 450, delay: 850, useNativeDriver: true }),
      Animated.timing(emailTranslateY, { toValue: 0, duration: 450, delay: 850, useNativeDriver: true }),
    ]).start();

    Animated.parallel([
      Animated.timing(passwordOpacity, { toValue: 1, duration: 450, delay: 950, useNativeDriver: true }),
      Animated.timing(passwordTranslateY, { toValue: 0, duration: 450, delay: 950, useNativeDriver: true }),
    ]).start();

    Animated.parallel([
      Animated.timing(buttonOpacity, { toValue: 1, duration: 450, delay: 1050, useNativeDriver: true }),
      Animated.timing(buttonTranslateY, { toValue: 0, duration: 450, delay: 1050, useNativeDriver: true }),
    ]).start();

    Animated.timing(footerOpacity, { toValue: 1, duration: 500, delay: 1200, useNativeDriver: true }).start();

    // Scan line sweeps once
    Animated.sequence([
      Animated.timing(scanLineOpacity, { toValue: 1, duration: 80, delay: 800, useNativeDriver: true }),
      Animated.timing(scanLineY, { toValue: SCREEN_HEIGHT, duration: 1600, useNativeDriver: true }),
      Animated.timing(scanLineOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();

    // Button glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(buttonGlow, { toValue: 0.35, duration: 2000, delay: 1200, useNativeDriver: false }),
        Animated.timing(buttonGlow, { toValue: 0.15, duration: 2000, useNativeDriver: false }),
      ])
    ).start();
  }

  async function checkBiometricSupport() {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setBiometricAvailable(compatible && enrolled);
  }

  async function checkSavedCredentials() {
    try {
      const savedEmail = await SecureStore.getItemAsync('userEmail');
      const savedPassword = await SecureStore.getItemAsync('userPassword');
      const faceIdEnabled = await SecureStore.getItemAsync('faceIdEnabled');

      if (savedEmail && savedPassword && faceIdEnabled === 'true') {
        setHasSavedCredentials(true);
        setEmail(savedEmail);
        setEnableFaceId(true);

        if (route?.params?.skipAutoLogin) return;

        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (compatible && enrolled) {
          setTimeout(() => triggerBiometricLogin(savedEmail, savedPassword), 500);
        }
      }
    } catch (err) {
      console.error('Error checking saved credentials:', err);
    }
  }

  async function triggerBiometricLogin(savedEmail: string, savedPassword: string) {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Sign in to ASP Boost',
        fallbackLabel: 'Use password',
        disableDeviceFallback: false,
      });

      if (result.success) {
        setLoading(true);
        setError('');
        const { error: authError } = await signIn(savedEmail, savedPassword);
        if (authError) {
          setError('Biometric login failed. Please use your password.');
        } else {
          setupPushNotifications().catch(console.error);
        }
        setLoading(false);
      }
    } catch (err) {
      console.error('Auto biometric auth error:', err);
      setLoading(false);
    }
  }

  async function handleBiometricLogin() {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Sign in with Face ID',
        fallbackLabel: 'Use password',
        disableDeviceFallback: false,
      });

      if (result.success) {
        const savedEmail = await SecureStore.getItemAsync('userEmail');
        const savedPassword = await SecureStore.getItemAsync('userPassword');

        if (savedEmail && savedPassword) {
          setLoading(true);
          setError('');
          const { error: authError } = await signIn(savedEmail, savedPassword);
          if (authError) {
            setError('Biometric login failed. Please use your password.');
          } else {
            setupPushNotifications().catch(console.error);
          }
          setLoading(false);
        }
      }
    } catch (err) {
      console.error('Biometric auth error:', err);
      setError('Biometric authentication failed');
    }
  }

  useEffect(() => {
    if (error) {
      Animated.sequence([
        Animated.timing(shakeAnimation, { toValue: -4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: -4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnimation, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    }
  }, [error]);

  async function handleForgotPassword() {
    if (!email) {
      Alert.alert('Email Required', 'Please enter your email address first, then tap "Forgot password?"', [{ text: 'OK' }]);
      return;
    }

    Alert.alert('Reset Password', `Send a password reset link to ${email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          setLoading(true);
          setError('');
          try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
              redirectTo: 'https://aspboostapp.vercel.app/auth/reset-password',
            });
            if (resetError) throw resetError;
            Alert.alert(
              'Check Your Email',
              'We\'ve sent a password reset link to your email. Open the link to reset your password, then return here to sign in with your new password.',
              [{ text: 'OK' }]
            );
          } catch (err: any) {
            setError(err.message || 'Failed to send reset email');
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  }

  async function handleLogin() {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { error: authError } = await signIn(email.trim(), password);

      if (authError) {
        setError(authError.message || 'Failed to sign in');
        setLoading(false);
        return;
      }

      if (enableFaceId) {
        await SecureStore.setItemAsync('userEmail', email.trim());
        await SecureStore.setItemAsync('userPassword', password);
        await SecureStore.setItemAsync('faceIdEnabled', 'true');
      }

      setupPushNotifications().catch(console.error);
      setLoading(false);
    } catch (error: any) {
      setError(error.message || 'Failed to sign in');
      setLoading(false);
    }
  }

  const MailIcon = () => (
    <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5">
      <Path strokeLinecap="round" strokeLinejoin="round" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
    </Svg>
  );

  const LockIcon = () => (
    <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5">
      <Path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </Svg>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      {/* Particles */}
      <ParticleField />

      {/* Scan line */}
      <Animated.View style={[styles.scanLine, { opacity: scanLineOpacity, transform: [{ translateY: scanLineY }] }]} pointerEvents="none">
        <LinearGradient
          colors={['transparent', COLORS.accent, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.scanLineGradient}
        />
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.contentContainer}>
          {/* Logo */}
          <Animated.View style={[styles.logoContainer, { transform: [{ scale: logoScale }] }]}>
            <Animated.View style={[styles.logoGlowRing, { opacity: glowRingOpacity }]} />
            <LinearGradient colors={[COLORS.accent, COLORS.accentDeep]} style={styles.logo}>
              <Text style={styles.logoText}>A</Text>
            </LinearGradient>
          </Animated.View>

          {/* Title */}
          <Animated.View style={[styles.titleContainer, { opacity: titleOpacity, transform: [{ translateY: titleTranslateY }] }]}>
            <Text style={styles.title}>ASP <Text style={styles.titleAccent}>Boost+</Text></Text>
          </Animated.View>

          {/* Tagline */}
          <Animated.View style={[styles.taglineContainer, { opacity: taglineOpacity, transform: [{ translateY: taglineTranslateY }] }]}>
            <Text style={styles.taglineMain}>Your Performance Lab.</Text>
            <Text style={styles.taglineAccent}>Anywhere.</Text>
          </Animated.View>

          {/* Separator */}
          <Animated.View style={[styles.separator, { opacity: separatorOpacity }]} />

          {/* Welcome */}
          <Animated.View style={[styles.welcomeContainer, { opacity: welcomeOpacity, transform: [{ translateY: welcomeTranslateY }] }]}>
            <Text style={styles.welcomeTitle}>Welcome Back</Text>
            <Text style={styles.welcomeSubtitle}>Sign in to access your training dashboard</Text>
          </Animated.View>

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
          <Animated.View style={[styles.inputGroup, { opacity: emailOpacity, transform: [{ translateY: emailTranslateY }] }]}>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputWrapper}>
              <View style={styles.inputIconContainer}><MailIcon /></View>
              <TextInput
                style={styles.input}
                placeholder="your.email@example.com"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
                editable={!loading}
              />
            </View>
          </Animated.View>

          {/* Password */}
          <Animated.View style={[styles.inputGroup, { opacity: passwordOpacity, transform: [{ translateY: passwordTranslateY }] }]}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Password</Text>
              <TouchableOpacity onPress={handleForgotPassword} disabled={loading}>
                <Text style={styles.forgotPassword}>Forgot password?</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.inputWrapper}>
              <View style={styles.inputIconContainer}><LockIcon /></View>
              <TextInput
                style={styles.input}
                placeholder="••••••••••••"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                editable={!loading}
              />
              {biometricAvailable && hasSavedCredentials && (
                <TouchableOpacity onPress={handleBiometricLogin} disabled={loading} style={styles.faceIdInlineButton} activeOpacity={0.7}>
                  <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="1.5">
                    <Path strokeLinecap="round" strokeLinejoin="round" d="M9 12h.01M15 12h.01M9 16c.5 1 1.5 2 3 2s2.5-1 3-2M5 8V6a2 2 0 012-2h2M5 16v2a2 2 0 002 2h2M17 8V6a2 2 0 00-2-2h-2M17 16v2a2 2 0 01-2 2h-2" />
                  </Svg>
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>

          {/* Enable biometric */}
          {biometricAvailable && !hasSavedCredentials && (
            <Animated.View style={{ opacity: buttonOpacity, transform: [{ translateY: buttonTranslateY }] }}>
              <TouchableOpacity onPress={() => setEnableFaceId(!enableFaceId)} style={styles.checkboxRow} activeOpacity={0.7} disabled={loading}>
                <View style={[styles.checkbox, enableFaceId && styles.checkboxChecked]}>
                  {enableFaceId && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>Enable {Platform.OS === 'ios' ? 'Face ID' : 'Biometric'} sign in</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Sign In */}
          <Animated.View style={[{ opacity: buttonOpacity, transform: [{ translateY: buttonTranslateY }] }]}>
            <Animated.View style={{ shadowColor: COLORS.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: buttonGlow, shadowRadius: 14, elevation: 10 }}>
              <TouchableOpacity onPress={handleLogin} disabled={loading} style={[styles.button, loading && styles.buttonDisabled]} activeOpacity={0.85}>
                <LinearGradient colors={[COLORS.accent, COLORS.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.buttonGradient}>
                  <View style={styles.buttonContent}>
                    {loading ? (
                      <Text style={styles.buttonText}>Signing in...</Text>
                    ) : (
                      <>
                        <Text style={styles.buttonText}>Sign In</Text>
                        <Svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5">
                          <Path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </Svg>
                      </>
                    )}
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          {/* Security + Footer */}
          <Animated.View style={{ opacity: footerOpacity }}>
            <View style={styles.security}>
              <LockIcon />
              <Text style={styles.securityText}>Secured with industry-standard encryption</Text>
            </View>
            <Text style={styles.footer}>© 2026 Atlantic Sports Performance. All rights reserved.</Text>
          </Animated.View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 50 },
  contentContainer: { paddingHorizontal: 28, maxWidth: 420, width: '100%', alignSelf: 'center' },

  logoContainer: { alignItems: 'center', marginBottom: 20, justifyContent: 'center' },
  logoGlowRing: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 21,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 12,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  logoText: { fontSize: 26, fontWeight: 'bold', color: '#000000' },

  titleContainer: { alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 38, fontWeight: 'bold', color: '#FFFFFF', letterSpacing: -0.5 },
  titleAccent: { color: COLORS.accent },

  taglineContainer: { alignItems: 'center', marginBottom: 28 },
  taglineMain: { fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5 },
  taglineAccent: { fontSize: 15, fontWeight: '700', color: COLORS.accent, letterSpacing: 1.5, marginTop: 2 },

  separator: { width: '60%', height: 1, backgroundColor: 'rgba(255,255,255,0.06)', alignSelf: 'center', marginBottom: 28 },

  welcomeContainer: { alignItems: 'center', marginBottom: 28 },
  welcomeTitle: { fontSize: 22, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  welcomeSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },

  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.15)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  errorIcon: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  errorText: { flex: 1, color: '#EF4444', fontSize: 13, fontWeight: '500' },

  inputGroup: { marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.7)', marginBottom: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  forgotPassword: { fontSize: 12, color: COLORS.accent, fontWeight: '500' },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  inputIconContainer: { marginRight: 10 },
  input: { flex: 1, color: '#FFFFFF', fontSize: 15, paddingVertical: 13 },
  faceIdInlineButton: { padding: 6, marginLeft: 6 },

  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  checkmark: { color: '#000', fontSize: 11, fontWeight: 'bold' },
  checkboxLabel: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },

  button: { borderRadius: 12, overflow: 'hidden' },
  buttonDisabled: { opacity: 0.5 },
  buttonGradient: { paddingVertical: 14 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontSize: 15, fontWeight: '700', color: '#000000' },

  security: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 28, gap: 6 },
  securityText: { fontSize: 11, color: 'rgba(255,255,255,0.25)', marginLeft: 4 },

  scanLine: { position: 'absolute', left: 0, right: 0, height: 2, zIndex: 10 },
  scanLineGradient: { flex: 1, height: 2 },

  footer: { textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.15)', marginTop: 32 },
});
