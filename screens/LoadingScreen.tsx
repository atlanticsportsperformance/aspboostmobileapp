import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function LoadingScreen({ navigation }: any) {
  const { session, initializing, isParentAccount } = useAuth();

  console.log('[LoadingScreen] State:', { initializing, hasSession: !!session, isParentAccount });

  useEffect(() => {
    console.log('[LoadingScreen] useEffect - initializing:', initializing, 'session:', !!session);
    // Wait for auth to fully initialize (including account type check)
    if (!initializing) {
      if (session) {
        // User is logged in - go to appropriate dashboard
        const target = isParentAccount ? 'ParentDashboard' : 'Dashboard';
        console.log('[LoadingScreen] Navigating to:', target);
        navigation.replace(target);
      } else {
        // Not logged in - go to login
        console.log('[LoadingScreen] No session, navigating to Login');
        navigation.replace('Login');
      }
    }
  }, [initializing, session, isParentAccount, navigation]);

  // Return empty view - splash screen overlay handles the UI
  return <View style={styles.container} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
});
