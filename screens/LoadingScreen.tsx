import React, { useEffect } from 'react';
import { View, Image, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';

export default function LoadingScreen({ navigation }: any) {
  const { session, initializing, isParentAccount, isStaff, rolesResolved } = useAuth();

  // Navigation logic - redirect once auth is ready
  useEffect(() => {
    if (initializing) return;
    if (!session) {
      navigation.replace('Login');
      return;
    }
    // Session present — wait until staff/account roles resolve so staff route
    // to CoachDashboard rather than flashing the athlete dashboard.
    if (!rolesResolved) return;
    const target = isStaff ? 'CoachDashboard' : isParentAccount ? 'ParentDashboard' : 'Dashboard';
    navigation.replace(target);
  }, [initializing, session, rolesResolved, isParentAccount, isStaff, navigation]);

  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/splash-logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <ActivityIndicator size="large" color="#38BDF8" style={styles.spinner} />
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 30,
  },
  spinner: {
    marginBottom: 15,
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
  },
});
