import 'react-native-url-polyfill/auto';
import './global.css';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Image, StyleSheet, Animated, Text, TextInput, AppState, AppStateStatus } from 'react-native';

// Disable font scaling completely to prevent iOS accessibility large fonts from breaking layouts.
// This ensures consistent UI across all devices regardless of accessibility settings.
// @ts-ignore - defaultProps is deprecated but still works and is the cleanest solution
Text.defaultProps = Text.defaultProps || {};
// @ts-ignore
Text.defaultProps.maxFontSizeMultiplier = 1;
// @ts-ignore
Text.defaultProps.allowFontScaling = false;

// @ts-ignore
TextInput.defaultProps = TextInput.defaultProps || {};
// @ts-ignore
TextInput.defaultProps.maxFontSizeMultiplier = 1;
// @ts-ignore
TextInput.defaultProps.allowFontScaling = false;
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// Note: We don't use StripeProvider here - instead we call initStripe()
// before each payment flow with the publishable key from the API response.
// This ensures we always use the correct key for the connected account.
import * as SplashScreen from 'expo-splash-screen';
import { AthleteProvider } from './contexts/AthleteContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import {
  setupNotificationListeners,
  getLastNotificationResponse,
  parseNotificationData,
  setupPushNotifications,
} from './lib/pushNotifications';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();
import LoginScreen from './screens/LoginScreen';
import JoinGroupScreen from './screens/JoinGroupScreen';
import UpdatePasswordScreen from './screens/UpdatePasswordScreen';
import DashboardScreen from './screens/DashboardScreen';
import ParentDashboardScreen from './screens/ParentDashboardScreen';
import WorkoutExecutionScreen from './screens/WorkoutExecutionScreen';
import WorkoutLoggerScreen from './screens/WorkoutLoggerScreen';
import CompletedWorkoutScreen from './screens/CompletedWorkoutScreen';
import MessagesScreen from './screens/MessagesScreen';
import LeaderboardScreen from './screens/LeaderboardScreen';
import HittingPerformanceScreen from './screens/HittingPerformanceScreen';
import HittingSessionScreen from './screens/HittingSessionScreen';
import HittingTrendsScreen from './screens/HittingTrendsScreen';
import BattedBallTrendsScreen from './screens/BattedBallTrendsScreen';
import PairedDataTrendsScreen from './screens/PairedDataTrendsScreen';
import PitchingScreen from './screens/PitchingScreen';
import PitchingSessionScreen from './screens/PitchingSessionScreen';
import PitchingTrendsScreen from './screens/PitchingTrendsScreen';
import ArmCareScreen from './screens/ArmCareScreen';
import ForceProfileScreen from './screens/ForceProfileScreen';
import TestDetailScreen from './screens/TestDetailScreen';
import ResourcesScreen from './screens/ResourcesScreen';
import PerformanceScreen from './screens/PerformanceScreen';
import ProfileScreen from './screens/ProfileScreen';
import NotificationSettingsScreen from './screens/NotificationSettingsScreen';
import BookingScreen from './screens/BookingScreen';
import MembershipsPackagesScreen from './screens/MembershipsPackagesScreen';
import BillingScreen from './screens/BillingScreen';
import PublicBookingScreen from './screens/PublicBookingScreen';
import WaiversScreen from './screens/WaiversScreen';
import { StatusBar } from 'expo-status-bar';

const Stack = createNativeStackNavigator();

// Inner component that uses AuthContext
function AppContent() {
  const { session, initializing, isParentAccount, appReady, setAppReady } = useAuth();
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const [showSplash, setShowSplash] = useState(true);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const appStateRef = useRef(AppState.currentState);
  const lastBackgroundTime = useRef<number | null>(null);

  // Hide native splash screen on mount
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Handle app resume from long background
  // This ensures the app doesn't get stuck on splash after being backgrounded for a while
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const previousState = appStateRef.current;

      // Track when app goes to background
      if (nextAppState.match(/inactive|background/)) {
        lastBackgroundTime.current = Date.now();
        console.log('[App] Going to background');
      }

      // When app comes back to foreground
      if (previousState.match(/inactive|background/) && nextAppState === 'active') {
        const backgroundDuration = lastBackgroundTime.current
          ? Date.now() - lastBackgroundTime.current
          : 0;
        console.log('[App] Resuming from background, duration:', Math.round(backgroundDuration / 1000), 'seconds');

        // If we have a session and were backgrounded for more than 5 seconds,
        // ensure appReady is true so the app doesn't get stuck
        if (session && !initializing && backgroundDuration > 5000) {
          console.log('[App] Long background detected, ensuring appReady=true');
          setAppReady(true);
        }

        // Also ensure splash is hidden if we already have a session
        // and auth is not initializing
        if (session && !initializing && showSplash) {
          console.log('[App] Forcing splash hide after background resume');
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }).start(() => {
            setShowSplash(false);
          });
        }
      }

      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [session, initializing, showSplash, fadeAnim, setAppReady]);

  // Handle notification tap navigation
  const handleNotificationNavigation = useCallback((data: { type?: string; id?: string; screen?: string }) => {
    if (!navigationRef.current || !session) return;

    const nav = navigationRef.current as any;

    // Navigate based on notification type
    if (data.screen) {
      nav.navigate(data.screen, data.id ? { id: data.id } : undefined);
    } else if (data.type) {
      switch (data.type) {
        case 'workout':
          nav.navigate('WorkoutExecution', { workoutId: data.id });
          break;
        case 'message':
          nav.navigate('Messages');
          break;
        case 'booking':
          nav.navigate('Booking');
          break;
        case 'leaderboard':
          nav.navigate('Leaderboard');
          break;
        default:
          nav.navigate(isParentAccount ? 'ParentDashboard' : 'Dashboard');
      }
    }
  }, [session, isParentAccount]);

  // Set up notification listeners
  useEffect(() => {
    const cleanup = setupNotificationListeners(
      (notification) => {
        console.log('Notification received in foreground:', notification.request.content.title);
      },
      (response) => {
        const data = parseNotificationData(response.notification);
        handleNotificationNavigation(data);
      }
    );

    // Check if app was opened from a notification (cold start)
    getLastNotificationResponse().then((response) => {
      if (response) {
        const data = parseNotificationData(response.notification);
        setTimeout(() => handleNotificationNavigation(data), 500);
      }
    });

    return cleanup;
  }, [handleNotificationNavigation]);

  // Set up push notifications when authenticated
  useEffect(() => {
    if (session) {
      setupPushNotifications().catch((err) => {
        console.log('[App] Push notification setup failed:', err);
      });
    }
  }, [session]);

  // Fade out splash when ready
  // SIMPLIFIED: Hide splash as soon as auth is done initializing
  // Don't wait for appReady - the dashboard will load in the background
  useEffect(() => {
    // Hide splash when auth initialization is complete
    // If no session -> show login (no need to wait)
    // If session exists -> show dashboard (it will load its own data)
    const shouldHideSplash = !initializing;

    if (shouldHideSplash && showSplash) {
      console.log('[App] Auth initialized, hiding splash. Session:', !!session);
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setShowSplash(false);
      });
    }
  }, [initializing, session, showSplash, fadeAnim]);

  // Safety timeout: force hide splash after 5 seconds no matter what
  useEffect(() => {
    if (!showSplash) return;

    const safetyTimeout = setTimeout(() => {
      if (showSplash) {
        console.warn('[App] Safety timeout - forcing splash hide after 5s');
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setShowSplash(false);
        });
      }
    }, 5000); // Reduced from 8s to 5s

    return () => clearTimeout(safetyTimeout);
  }, [showSplash, fadeAnim]);

  // Determine initial route - only valid once initializing is complete
  const getInitialRoute = () => {
    const route = !session ? 'Login' : (isParentAccount ? 'ParentDashboard' : 'Dashboard');
    console.log('[App] getInitialRoute:', route, '(session:', !!session, 'isParentAccount:', isParentAccount, ')');
    return route;
  };

  // Don't render navigator until auth is fully initialized (including account type check)
  // This prevents the wrong initial route being set
  if (initializing) {
    return (
      <View style={styles.container}>
        <View style={styles.splashContainer}>
          <Image
            source={require('./assets/splash-logo.png')}
            style={styles.splashLogo}
            resizeMode="contain"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef}>
          <StatusBar style="light" />
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: {
                backgroundColor: '#0A0A0A',
              },
            }}
            initialRouteName={getInitialRoute()}
          >
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="JoinGroup" component={JoinGroupScreen} />
            <Stack.Screen name="UpdatePassword" component={UpdatePasswordScreen} />
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="ParentDashboard" component={ParentDashboardScreen} />
            <Stack.Screen name="WorkoutExecution" component={WorkoutExecutionScreen} />
            <Stack.Screen name="WorkoutLogger" component={WorkoutLoggerScreen} />
            <Stack.Screen name="CompletedWorkout" component={CompletedWorkoutScreen} />
            <Stack.Screen name="Messages" component={MessagesScreen} />
            <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
            <Stack.Screen name="HittingPerformance" component={HittingPerformanceScreen} />
            <Stack.Screen name="HittingSession" component={HittingSessionScreen} />
            <Stack.Screen name="HittingTrends" component={HittingTrendsScreen} />
            <Stack.Screen name="BattedBallTrends" component={BattedBallTrendsScreen} />
            <Stack.Screen name="PairedDataTrends" component={PairedDataTrendsScreen} />
            <Stack.Screen name="PitchingPerformance" component={PitchingScreen} />
            <Stack.Screen name="PitchingSession" component={PitchingSessionScreen} />
            <Stack.Screen name="PitchingTrends" component={PitchingTrendsScreen} />
            <Stack.Screen name="ArmCare" component={ArmCareScreen} />
            <Stack.Screen name="ForceProfile" component={ForceProfileScreen} />
            <Stack.Screen name="TestDetail" component={TestDetailScreen} />
            <Stack.Screen name="Resources" component={ResourcesScreen} />
            <Stack.Screen name="Performance" component={PerformanceScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
            <Stack.Screen name="Booking" component={BookingScreen} />
            <Stack.Screen name="MembershipsPackages" component={MembershipsPackagesScreen} />
            <Stack.Screen name="Billing" component={BillingScreen} />
            <Stack.Screen name="PublicBooking" component={PublicBookingScreen} />
            <Stack.Screen name="Waivers" component={WaiversScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>

      {/* Custom splash screen overlay */}
      {showSplash && (
        <Animated.View style={[styles.splashOverlay, { opacity: fadeAnim }]}>
          <View style={styles.splashContainer}>
            <Image
              source={require('./assets/splash-logo.png')}
              style={styles.splashLogo}
              resizeMode="contain"
            />
          </View>
        </Animated.View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AthleteProvider>
        <AppContent />
      </AthleteProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  splashOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
  splashContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
  },
  splashLogo: {
    width: 200,
    height: 200,
  },
});
