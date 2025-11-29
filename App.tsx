import 'react-native-url-polyfill/auto';
import './global.css';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from './lib/supabase';
import LoginScreen from './screens/LoginScreen';
import JoinGroupScreen from './screens/JoinGroupScreen';
import UpdatePasswordScreen from './screens/UpdatePasswordScreen';
import DashboardScreen from './screens/DashboardScreen';
import WorkoutExecutionScreen from './screens/WorkoutExecutionScreen';
import WorkoutLoggerScreen from './screens/WorkoutLoggerScreen';
import MessagesScreen from './screens/MessagesScreen';
import LeaderboardScreen from './screens/LeaderboardScreen';
import HittingPerformanceScreen from './screens/HittingPerformanceScreen';
import HittingSessionScreen from './screens/HittingSessionScreen';
import HittingTrendsScreen from './screens/HittingTrendsScreen';
import BattedBallTrendsScreen from './screens/BattedBallTrendsScreen';
import PairedDataTrendsScreen from './screens/PairedDataTrendsScreen';
import PitchingScreen from './screens/PitchingScreen';
import PitchingSessionScreen from './screens/PitchingSessionScreen';
import ArmCareScreen from './screens/ArmCareScreen';
import ForceProfileScreen from './screens/ForceProfileScreen';
import TestDetailScreen from './screens/TestDetailScreen';
import ResourcesScreen from './screens/ResourcesScreen';
import PerformanceScreen from './screens/PerformanceScreen';
import ProfileScreen from './screens/ProfileScreen';
import { StatusBar } from 'expo-status-bar';

const Stack = createNativeStackNavigator();

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check for existing session on app launch
    checkSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function checkSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
    } catch (error) {
      console.error('Error checking session:', error);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' }}>
        <ActivityIndicator size="large" color="#9BDDFF" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: {
              backgroundColor: '#0A0A0A',
            },
          }}
          initialRouteName={isAuthenticated ? 'Dashboard' : 'Login'}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="JoinGroup" component={JoinGroupScreen} />
          <Stack.Screen name="UpdatePassword" component={UpdatePasswordScreen} />
          <Stack.Screen name="Dashboard" component={DashboardScreen} />
          <Stack.Screen name="WorkoutExecution" component={WorkoutExecutionScreen} />
          <Stack.Screen name="WorkoutLogger" component={WorkoutLoggerScreen} />
          <Stack.Screen name="Messages" component={MessagesScreen} />
          <Stack.Screen name="Leaderboard" component={LeaderboardScreen} />
          <Stack.Screen name="HittingPerformance" component={HittingPerformanceScreen} />
          <Stack.Screen name="HittingSession" component={HittingSessionScreen} />
          <Stack.Screen name="HittingTrends" component={HittingTrendsScreen} />
          <Stack.Screen name="BattedBallTrends" component={BattedBallTrendsScreen} />
          <Stack.Screen name="PairedDataTrends" component={PairedDataTrendsScreen} />
          <Stack.Screen name="PitchingPerformance" component={PitchingScreen} />
          <Stack.Screen name="PitchingSession" component={PitchingSessionScreen} />
          <Stack.Screen name="ArmCare" component={ArmCareScreen} />
          <Stack.Screen name="ForceProfile" component={ForceProfileScreen} />
          <Stack.Screen name="TestDetail" component={TestDetailScreen} />
          <Stack.Screen name="Resources" component={ResourcesScreen} />
          <Stack.Screen name="Performance" component={PerformanceScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
