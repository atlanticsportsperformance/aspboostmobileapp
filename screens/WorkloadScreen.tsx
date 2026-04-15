/**
 * WorkloadScreen — standalone workload hub for athletes. Mount the same
 * ThrowingWorkloadMonitor + ThrowingThrowsFeed used inside the throwing
 * execution screen, but here they live on their own page accessed from
 * the FAB menu. Gives athletes a way to connect Pulse, sync, run live, and
 * review today's throws without being tied to a specific workout.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../lib/supabase';
import { ThrowingWorkloadMonitor } from '../components/pulse/ThrowingWorkloadMonitor';
import { ThrowingThrowsFeed } from '../components/pulse/ThrowingThrowsFeed';

type NavProp = StackNavigationProp<any>;

export default function WorkloadScreen() {
  const navigation = useNavigation<NavProp>();
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          navigation.goBack();
          return;
        }
        const { data: athlete } = await supabase
          .from('athletes')
          .select('id, org_id')
          .eq('user_id', user.id)
          .single();
        if (athlete) {
          setAthleteId(athlete.id);
          setOrgId(athlete.org_id);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Workload</Text>
        <View style={styles.rightSpacer} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9BDDFF" />
        </View>
      ) : athleteId && orgId ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <ThrowingWorkloadMonitor athleteId={athleteId} orgId={orgId} />
          <ThrowingThrowsFeed athleteId={athleteId} />
        </ScrollView>
      ) : (
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>
            Could not load your athlete profile.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 12,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 4,
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rightSpacer: {
    width: 32,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#9ca3af',
    fontSize: 14,
  },
});
