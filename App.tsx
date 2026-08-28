import 'react-native-url-polyfill/auto';
import './global.css';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Image, StyleSheet, Animated, Text, TextInput } from 'react-native';

// Disable font scaling completely to prevent iOS accessibility large fonts from breaking layouts.
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

// Entry screens stay eagerly imported (shown immediately on launch / after auth).
import LoginScreen from './screens/LoginScreen';
import JoinGroupScreen from './screens/JoinGroupScreen';
import UpdatePasswordScreen from './screens/UpdatePasswordScreen';
import DashboardScreen from './screens/DashboardScreen';
import ParentDashboardScreen from './screens/ParentDashboardScreen';
import CoachDashboardScreen from './screens/CoachDashboardScreen';
import LoadingScreen from './screens/LoadingScreen';
// All other (deep) screens are lazy-loaded via `getComponent` on their
// Stack.Screen below — react-navigation requires the module on first navigation,
// so ~37 large screen modules no longer evaluate during app startup.
import { StatusBar } from 'expo-status-bar';

const Stack = createNativeStackNavigator();

function AppContent() {
  const { session, initializing, isParentAccount, isStaff } = useAuth();
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const [showSplash, setShowSplash] = useState(true);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const splashHiddenOnce = useRef(false);

  // Hide native splash screen on mount
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Handle notification tap navigation
  const handleNotificationNavigation = useCallback((data: { type?: string; id?: string; screen?: string; conversationId?: string }) => {
    if (!navigationRef.current || !session) return;

    const nav = navigationRef.current as any;

    if (data.screen) {
      nav.navigate(data.screen, data.id ? { id: data.id } : undefined);
    } else if (data.type) {
      switch (data.type) {
        case 'workout':
          // Notification payload only carries `data.id`; WorkoutLogger requires
          // both workoutInstanceId and athleteId. Fall through to Dashboard so
          // the user can tap their workout card with the auth context intact.
          nav.navigate('Dashboard');
          break;
        case 'message':
        case 'new_message': {
          // The server sends type 'new_message'; only 'message' was matched
          // before, so every message notification fell through to the
          // dashboard. Both are accepted so older queued pushes still route.
          // conversationId already carries the id/conversation_id fallback
          // chain from parseNotificationData.
          const conversationId = data.conversationId;
          nav.navigate('Messages', conversationId ? { conversationId } : undefined);
          break;
        }
        case 'booking':
          nav.navigate('Booking');
          break;
        case 'leaderboard':
          nav.navigate('Leaderboard');
          break;
        default:
          nav.navigate(isStaff ? 'CoachOverview' : isParentAccount ? 'ParentDashboard' : 'Dashboard');
      }
    }
  }, [session, isParentAccount, isStaff]);

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

  // Hide splash ONCE when auth first finishes. Never show it again.
  useEffect(() => {
    if (!initializing && !splashHiddenOnce.current && showSplash) {
      splashHiddenOnce.current = true;
      console.log('[App] Auth done, hiding splash (first time only)');
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setShowSplash(false);
      });
    }
  }, [initializing, showSplash]);

  return (
    <View style={styles.container}>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef}>
          <StatusBar style="light" />
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#0A0A0A' },
            }}
            initialRouteName="Loading"
          >
            {/* Eager entry screens */}
            <Stack.Screen name="Loading" component={LoadingScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="JoinGroup" component={JoinGroupScreen} />
            <Stack.Screen name="UpdatePassword" component={UpdatePasswordScreen} />
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="ParentDashboard" component={ParentDashboardScreen} />
            <Stack.Screen name="CoachDashboard" component={CoachDashboardScreen} />
            {/* Lazy screens — module is required on first navigation, not at startup */}
            <Stack.Screen name="WorkoutLogger" getComponent={() => require('./screens/WorkoutLoggerScreen').default} />
            <Stack.Screen name="CompletedWorkout" getComponent={() => require('./screens/CompletedWorkoutScreen').default} />
            <Stack.Screen name="Workload" getComponent={() => require('./screens/WorkloadScreen').default} />
            <Stack.Screen name="Messages" getComponent={() => require('./screens/MessagesScreen').default} />
            <Stack.Screen name="Leaderboard" getComponent={() => require('./screens/LeaderboardScreen').default} />
            <Stack.Screen name="HittingPerformance" getComponent={() => require('./screens/HittingPerformanceScreen').default} />
            <Stack.Screen name="HittingSession" getComponent={() => require('./screens/HittingSessionScreen').default} />
            <Stack.Screen name="HittingTrends" getComponent={() => require('./screens/HittingTrendsScreen').default} />
            <Stack.Screen name="BattedBallTrends" getComponent={() => require('./screens/BattedBallTrendsScreen').default} />
            <Stack.Screen name="PairedDataTrends" getComponent={() => require('./screens/PairedDataTrendsScreen').default} />
            <Stack.Screen name="PitchingHub" getComponent={() => require('./screens/PitchingHubScreen').default} />
            <Stack.Screen name="PitchingPerformance" getComponent={() => require('./screens/PitchingScreen').default} />
            <Stack.Screen name="PitchingSession" getComponent={() => require('./screens/PitchingSessionScreen').default} />
            <Stack.Screen name="PitchingTrends" getComponent={() => require('./screens/PitchingTrendsScreen').default} />
            <Stack.Screen name="MocapSessions" getComponent={() => require('./screens/MocapSessionsScreen').default} />
            <Stack.Screen name="MocapPitchDetail" getComponent={() => require('./screens/MocapPitchDetailScreen').default} />
            <Stack.Screen name="ArmCare" getComponent={() => require('./screens/ArmCareScreen').default} />
            <Stack.Screen name="ArmCareHub" getComponent={() => require('./screens/ArmCareHubScreen').default} />
            <Stack.Screen name="ArmCareWizard" getComponent={() => require('./screens/ArmCareWizardScreen').default} />
            <Stack.Screen name="ForceProfile" getComponent={() => require('./screens/ForceProfileScreen').default} />
            <Stack.Screen name="TestDetail" getComponent={() => require('./screens/TestDetailScreen').default} />
            <Stack.Screen name="Resources" getComponent={() => require('./screens/ResourcesScreen').default} />
            <Stack.Screen name="Performance" getComponent={() => require('./screens/PerformanceScreen').default} />
            <Stack.Screen name="Profile" getComponent={() => require('./screens/ProfileScreen').default} />
            <Stack.Screen name="NotificationSettings" getComponent={() => require('./screens/NotificationSettingsScreen').default} />
            <Stack.Screen name="Booking" getComponent={() => require('./screens/BookingScreen').default} />
            <Stack.Screen name="MembershipsPackages" getComponent={() => require('./screens/MembershipsPackagesScreen').default} />
            <Stack.Screen name="Billing" getComponent={() => require('./screens/BillingScreen').default} />
            <Stack.Screen name="PublicBooking" getComponent={() => require('./screens/PublicBookingScreen').default} />
            <Stack.Screen name="Waivers" getComponent={() => require('./screens/WaiversScreen').default} />
            <Stack.Screen name="CoachTools" getComponent={() => require('./screens/CoachToolsScreen').default} />
            <Stack.Screen name="CoachArmCareSearch" getComponent={() => require('./screens/CoachArmCareSearchScreen').default} />
            <Stack.Screen name="CoachOverview" getComponent={() => require('./screens/CoachOverviewScreen').default} />
            <Stack.Screen name="CoachRoster" getComponent={() => require('./screens/CoachRosterScreen').default} />
            <Stack.Screen name="AthleteProgram" getComponent={() => require('./screens/AthleteProgramScreen').default} />
            <Stack.Screen name="CoachCoverage" getComponent={() => require('./screens/CoachCoverageScreen').default} />
            <Stack.Screen name="LeagueHub" getComponent={() => require('./screens/LeagueHubScreen').default} />
            <Stack.Screen name="LeagueSchedule" getComponent={() => require('./screens/LeagueScheduleScreen').default} />
            <Stack.Screen name="LeagueStats" getComponent={() => require('./screens/LeagueStatsScreen').default} />
            <Stack.Screen name="LeagueGameLog" getComponent={() => require('./screens/LeagueGameLogScreen').default} />
            <Stack.Screen name="LeagueGameDetail" getComponent={() => require('./screens/LeagueGameDetailScreen').default} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>

      {/* Custom splash screen overlay - only shown on initial app open */}
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
