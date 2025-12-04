import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface LinkedAthlete {
  id: string;
  athlete_id: string;
  first_name: string;
  last_name: string;
  email: string;
  color: string;
}

interface AthletePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectAthlete: (athleteId: string) => void;
  linkedAthletes: LinkedAthlete[];
}

const COLORS = {
  primary: '#9BDDFF',
  black: '#0A0A0A',
  white: '#FFFFFF',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
};

export default function AthletePickerModal({
  visible,
  onClose,
  onSelectAthlete,
  linkedAthletes,
}: AthletePickerModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={styles.modal}>
          <Text style={styles.title}>View data for...</Text>
          <Text style={styles.subtitle}>Select an athlete to view their performance data</Text>

          <ScrollView
            style={styles.athleteList}
            showsVerticalScrollIndicator={false}
          >
            {linkedAthletes.map((athlete) => (
              <TouchableOpacity
                key={athlete.id}
                style={styles.athleteItem}
                onPress={() => onSelectAthlete(athlete.athlete_id)}
                activeOpacity={0.7}
              >
                <LinearGradient
                  colors={[athlete.color, `${athlete.color}CC`]}
                  style={styles.athleteAvatar}
                >
                  <Text style={styles.athleteInitials}>
                    {athlete.first_name?.[0]}{athlete.last_name?.[0]}
                  </Text>
                </LinearGradient>
                <View style={styles.athleteInfo}>
                  <Text style={styles.athleteName}>
                    {athlete.first_name} {athlete.last_name}
                  </Text>
                  <Text style={styles.athleteEmail}>{athlete.email}</Text>
                </View>
                <View style={[styles.colorIndicator, { backgroundColor: athlete.color }]} />
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    width: '100%',
    maxWidth: 360,
    maxHeight: '70%',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.white,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.gray400,
    textAlign: 'center',
    marginBottom: 20,
  },
  athleteList: {
    maxHeight: 300,
  },
  athleteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  athleteAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  athleteInitials: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.black,
  },
  athleteInfo: {
    flex: 1,
  },
  athleteName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  athleteEmail: {
    fontSize: 13,
    color: COLORS.gray400,
    marginTop: 2,
  },
  colorIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  cancelButton: {
    marginTop: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.white,
  },
});
