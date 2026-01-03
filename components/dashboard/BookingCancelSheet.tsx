import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';

// Booking type matching DashboardScreen's Booking interface
interface DashboardBooking {
  id: string;
  status: string;
  event: {
    id: string;
    start_time: string;
    end_time: string;
    title?: string;
    scheduling_templates?: {
      name: string;
      scheduling_categories?: {
        name: string;
        color?: string;
      };
    };
  };
}

interface BookingCancelSheetProps {
  visible: boolean;
  booking: DashboardBooking | null;
  cancelling: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function BookingCancelSheet({
  visible,
  booking,
  cancelling,
  onConfirm,
  onClose,
}: BookingCancelSheetProps) {
  if (!booking) return null;

  const title =
    booking.event.title ||
    booking.event.scheduling_templates?.name ||
    'Scheduled Class';
  const categoryName =
    booking.event.scheduling_templates?.scheduling_categories?.name || '';
  const timeRange = `${formatTime(booking.event.start_time)} - ${formatTime(booking.event.end_time)}`;
  const dateStr = formatDate(booking.event.start_time);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          {/* Warning Icon */}
          <View style={styles.iconContainer}>
            <View style={styles.warningCircle}>
              <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 9v4M12 17h.01"
                  stroke="#DC2626"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <Path
                  d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                  stroke="#DC2626"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
          </View>

          {/* Title */}
          <Text style={styles.title}>Cancel This Class?</Text>
          <Text style={styles.subtitle}>This cannot be undone</Text>

          {/* Event Preview */}
          <View style={styles.eventCard}>
            <View style={styles.eventHeader}>
              <Text style={styles.eventTime}>{timeRange}</Text>
              <View style={styles.coachAvatar}>
                <LinearGradient
                  colors={['#9BDDFF', '#7BC5F0']}
                  style={styles.avatarPlaceholder}
                >
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
                      stroke="#0A0A0A"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                    <Circle cx={12} cy={7} r={4} stroke="#0A0A0A" strokeWidth={2} />
                  </Svg>
                </LinearGradient>
              </View>
            </View>
            <Text style={styles.eventTitle}>{title}</Text>
            {categoryName ? (
              <Text style={styles.eventCategory}>{categoryName}</Text>
            ) : null}
            <Text style={styles.eventDate}>{dateStr}</Text>
          </View>

          {/* Buttons */}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onConfirm}
              disabled={cancelling}
              activeOpacity={0.8}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.cancelButtonText}>Yes, Cancel My Reservation</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.keepButton}
              onPress={onClose}
              disabled={cancelling}
              activeOpacity={0.8}
            >
              <Text style={styles.keepButtonText}>Keep My Reservation</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  warningCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  eventCard: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  eventTime: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
  },
  coachAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
  },
  avatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  eventCategory: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 2,
  },
  eventDate: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  buttons: {
    gap: 12,
  },
  cancelButton: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  keepButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  keepButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
});
