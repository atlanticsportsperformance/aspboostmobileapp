import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { LinkedAthlete, getInitials } from '../../types/booking';

interface ParentAthleteSelectorProps {
  visible: boolean;
  athletes: LinkedAthlete[];
  loading: boolean;
  onSelect: (athlete: LinkedAthlete) => void;
  onClose: () => void;
}

export default function ParentAthleteSelector({
  visible,
  athletes,
  loading,
  onSelect,
  onClose,
}: ParentAthleteSelectorProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeIcon}>×</Text>
            </TouchableOpacity>
          </View>

          {/* Icon */}
          <View style={styles.iconContainer}>
            <LinearGradient
              colors={['#9BDDFF', '#7BC5F0']}
              style={styles.iconCircle}
            >
              <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                  stroke="#0A0A0A"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Circle
                  cx={9}
                  cy={7}
                  r={4}
                  stroke="#0A0A0A"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Path
                  d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                  stroke="#0A0A0A"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </LinearGradient>
          </View>

          {/* Title */}
          <Text style={styles.title}>Who are you booking for?</Text>
          <Text style={styles.subtitle}>Select an athlete to continue</Text>

          {/* Athletes List */}
          <ScrollView
            style={styles.athletesList}
            contentContainerStyle={styles.athletesContent}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Loading athletes...</Text>
              </View>
            ) : athletes.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyTitle}>No Linked Athletes</Text>
                <Text style={styles.emptySubtitle}>
                  You don't have any athletes linked to your account.
                </Text>
              </View>
            ) : (
              athletes.map((athlete) => (
                <TouchableOpacity
                  key={athlete.id}
                  style={styles.athleteRow}
                  onPress={() => onSelect(athlete)}
                  activeOpacity={0.7}
                >
                  {/* Avatar */}
                  <LinearGradient
                    colors={[athlete.color, adjustColor(athlete.color, -20)]}
                    style={styles.avatar}
                  >
                    <Text style={styles.avatarText}>
                      {getInitials(athlete.firstName, athlete.lastName)}
                    </Text>
                  </LinearGradient>

                  {/* Info */}
                  <View style={styles.athleteInfo}>
                    <Text style={styles.athleteName}>
                      {athlete.firstName} {athlete.lastName}
                    </Text>
                    <Text style={styles.athleteEmail}>{athlete.email}</Text>
                  </View>

                  {/* Chevron */}
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// Helper to darken a hex color
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0x0000ff) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 16,
  },
  closeButton: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: '300',
  },
  iconContainer: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: 40,
  },
  athletesList: {
    flex: 1,
  },
  athletesContent: {
    paddingBottom: 24,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  athleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0A0A0A',
  },
  athleteInfo: {
    flex: 1,
    marginLeft: 16,
  },
  athleteName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  athleteEmail: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  chevron: {
    fontSize: 24,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: '300',
  },
});
