import 'react-native-url-polyfill/auto';
import './global.css';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Image, StyleSheet, AppState, AppStateStatus, Text, TextInput } from 'react-native';

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
import { supabase } from './lib/supabase';
import { AthleteProvider } from './contexts/AthleteContext';
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

// Threshold for showing splash screen when returning from background (5 minutes)
const BACKGROUND_SPLASH_THRESHOLD_MS = 5 * 60 * 1000;

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isParentAccount, setIsParentAccount] = useState(false);
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const appState = useRef(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);
  const isRefreshing = useRef(false);

  // Handle notification tap navigation
  const handleNotificationNavigation = (data: { type?: string; id?: string; screen?: string }) => {
    if (!navigationRef.current || !isAuthenticated) return;

    const nav = navigationRef.current as any;

    // Navigate based on notification type
    if (data.screen) {
      // Direct screen navigation if specified
      nav.navigate(data.screen, data.id ? { id: data.id } : undefined);
    } else if (data.type) {
      // Type-based navigation
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
          // Default to dashboard
          nav.navigate(isParentAccount ? 'ParentDashboard' : 'Dashboard');
      }
    }
  };

  // Refresh session - used when app comes back to foreground
  // Returns true if session is valid, false if user needs to re-login
  const refreshSession = async (): Promise<boolean> => {
    if (isRefreshing.current) return isAuthenticated;
    isRefreshing.current = true;

    // Set a hard timeout to prevent hanging
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 10000)
    );

    try {
      const result = await Promise.race([
        (async () => {
          const { data: { session }, error } = await supabase.auth.getSession();

          if (error) {
            // Network errors - keep existing auth state
            if (error.message?.includes('network') || error.message?.includes('fetch')) {
              console.log('[App] Network error during session check, keeping existing state');
              return 'network_error';
            }
          }

          if (session) {
            // Check if token is expiring soon (within 5 minutes)
            const expiresAt = session.expires_at;
            const now = Math.floor(Date.now() / 1000);
            const fiveMinutes = 5 * 60;

            if (expiresAt && expiresAt - now < fiveMinutes) {
              // Token expiring soon, refresh it
              console.log('[App] Token expiring soon, refreshing...');
              const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
              if (!refreshError && refreshData.session) {
                setIsAuthenticated(true);
                await checkAccountType(refreshData.session.user.id);
                return 'authenticated';
              } else if (expiresAt > now) {
                // Refresh failed but token still valid, use it
                console.log('[App] Refresh failed but token still valid');
                setIsAuthenticated(true);
                await checkAccountType(session.user.id);
                return 'authenticated';
              } else {
                // Token actually expired and refresh failed
                console.log('[App] Token expired and refresh failed');
                setIsAuthenticated(false);
                setIsParentAccount(false);
                return 'no_session';
              }
            } else {
              setIsAuthenticated(true);
              await checkAccountType(session.user.id);
              return 'authenticated';
            }
          } else {
            // No session - user needs to log in
            console.log('[App] No session found');
            setIsAuthenticated(false);
            setIsParentAccount(false);
            return 'no_session';
          }
        })(),
        timeoutPromise,
      ]);

      if (result === 'timeout') {
        console.warn('[App] Session refresh timed out after 10s');
        // On timeout, keep existing auth state rather than logging out
        return isAuthenticated;
      }

      return result === 'authenticated' || result === 'network_error';
    } catch (error) {
      console.error('[App] Error refreshing session:', error);
      return isAuthenticated; // Keep existing state on error
    } finally {
      isRefreshing.current = false;
    }
  };

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      // App going to background - record timestamp
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        backgroundedAt.current = Date.now();
      }

      // App coming to foreground from background
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        const wasBackgroundedFor = backgroundedAt.current
          ? Date.now() - backgroundedAt.current
          : 0;

        // If backgrounded for longer than threshold, show splash and re-validate
        if (wasBackgroundedFor > BACKGROUND_SPLASH_THRESHOLD_MS) {
          console.log(`[App] Backgrounded for ${Math.round(wasBackgroundedFor / 1000)}s, showing splash and re-validating session`);
          setIsLoading(true);
          await refreshSession();
          setIsLoading(false);
          // After refresh completes, the Navigator will re-render if auth state changed
          // The individual screens will reload their data via useFocusEffect
        } else {
          // Short background - just refresh session silently
          refreshSession();
        }

        backgroundedAt.current = null;
      }

      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // Check for existing session on app launch with timeout
    const initializeAuth = async () => {
      // Set a timeout to prevent infinite loading
      const timeoutId = setTimeout(() => {
        console.warn('Auth check timed out, proceeding anyway');
        setIsLoading(false);
      }, 5000); // 5 second timeout

      try {
        await checkSession();
      } finally {
        clearTimeout(timeoutId);
      }
    };

    initializeAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setIsAuthenticated(!!session);
      if (session) {
        await checkAccountType(session.user.id);
      } else {
        setIsParentAccount(false);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Set up notification listeners
  useEffect(() => {
    // Handle notifications while app is running
    const cleanup = setupNotificationListeners(
      // Notification received while app is in foreground
      (notification) => {
        console.log('Notification received in foreground:', notification.request.content.title);
      },
      // User tapped on notification
      (response) => {
        const data = parseNotificationData(response.notification);
        handleNotificationNavigation(data);
      }
    );

    // Check if app was opened from a notification (cold start)
    getLastNotificationResponse().then((response) => {
      if (response) {
        const data = parseNotificationData(response.notification);
        // Delay navigation to ensure navigator is ready
        setTimeout(() => handleNotificationNavigation(data), 500);
      }
    });

    return cleanup;
  }, [isAuthenticated, isParentAccount]);

  async function checkSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
      if (session) {
        await checkAccountType(session.user.id);
        // Register push notifications for existing session
        setupPushNotifications().catch((err) => {
          console.log('[App] Push notification setup failed:', err);
        });
      }
    } catch (error) {
      console.error('Error checking session:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function checkAccountType(userId: string) {
    try {
      console.log('[App] Checking account type for user:', userId);
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('[App] Error fetching profile:', error);
        setIsParentAccount(false);
        return;
      }

      const isParent = profile?.account_type === 'parent';
      console.log('[App] Account type:', profile?.account_type, 'isParent:', isParent);
      setIsParentAccount(isParent);
    } catch (error) {
      console.error('[App] Error checking account type:', error);
      setIsParentAccount(false);
    }
  }

  const onLayoutRootView = useCallback(async () => {
    if (!isLoading) {
      // Hide the splash screen once we're ready
      await SplashScreen.hideAsync();
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={styles.splashContainer}>
        <Image
          source={require('./assets/splash-logo.png')}
          style={styles.splashLogo}
          resizeMode="contain"
        />
      </View>
    );
  }

  // Determine initial route based on auth state and account type
  const getInitialRoute = () => {
    if (!isAuthenticated) return 'Login';
    return isParentAccount ? 'ParentDashboard' : 'Dashboard';
  };

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <AthleteProvider>
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
      </AthleteProvider>
    </View>
  );
}

const styles = StyleSheet.create({
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
