import 'react-native-url-polyfill/auto';
import './global.css';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Image, StyleSheet, AppState, AppStateStatus } from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import * as SplashScreen from 'expo-splash-screen';
import { supabase } from './lib/supabase';
import { AthleteProvider } from './contexts/AthleteContext';
import {
  setupNotificationListeners,
  getLastNotificationResponse,
  parseNotificationData,
} from './lib/pushNotifications';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({
  duration: 500,
  fade: true,
});
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

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isParentAccount, setIsParentAccount] = useState(false);
  const [appIsReady, setAppIsReady] = useState(false);
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const appState = useRef(AppState.currentState);

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

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      // App is coming back to foreground
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log('App came to foreground, refreshing session...');
        // Re-check session when app comes back - don't set loading to true to avoid spinner
        try {
          const { data: { session } } = await supabase.auth.getSession();
          setIsAuthenticated(!!session);
          if (session) {
            await checkAccountType(session.user.id);
          }
        } catch (error) {
          console.error('Error refreshing session:', error);
        }
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
        setAppIsReady(true);
      }, 5000); // 5 second timeout

      try {
        await checkSession();
      } finally {
        clearTimeout(timeoutId);
        setAppIsReady(true);
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
      }
    } catch (error) {
      console.error('Error checking session:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function checkAccountType(userId: string) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', userId)
        .single();

      setIsParentAccount(profile?.account_type === 'parent');
    } catch (error) {
      console.error('Error checking account type:', error);
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
      <StripeProvider
        publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''}
        merchantIdentifier="merchant.com.aspboost"
      >
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
    </StripeProvider>
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
