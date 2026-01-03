import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { BookableEvent, formatEventTime } from '../../types/booking';

interface EventRowProps {
  event: BookableEvent;
  onPress: () => void;
  onCancelPress?: () => void;
  bookingInProgress: boolean;
}

export default function EventRow({
  event,
  onPress,
  onCancelPress,
  bookingInProgress,
}: EventRowProps) {
  const spotsRemaining = event.capacity - event.bookedCount;
  const isFull = spotsRemaining <= 0;

  // Check if event has already passed
  const isPast = event.startTime < new Date();

  const renderButton = () => {
    // 1. Already booked - show Reserved button (even for past events)
    if (event.isBooked) {
      return (
        <TouchableOpacity
          style={styles.reservedButton}
          onPress={isPast ? undefined : onCancelPress}
          activeOpacity={isPast ? 1 : 0.8}
          disabled={isPast}
        >
          <LinearGradient
            colors={isPast ? ['#6B7280', '#4B5563'] : ['#9BDDFF', '#7BC5F0']}
            style={styles.reservedGradient}
          >
            <Text style={[styles.reservedText, isPast && styles.pastReservedText]}>
              {isPast ? 'Attended' : 'Reserved'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      );
    }

    // 2. Past event - show Event Passed
    if (isPast) {
      return (
        <View style={[styles.reserveButton, styles.pastButton]}>
          <Text style={styles.pastText}>Event Passed</Text>
        </View>
      );
    }

    // 3. Booking window blocked - show reason in amber/warning color
    if (event.bookingWindowBlocked && event.bookingWindowReason) {
      return (
        <View style={[styles.reserveButton, styles.windowBlockedButton]}>
          <Text style={styles.windowBlockedText} numberOfLines={2}>
            {event.bookingWindowReason}
          </Text>
        </View>
      );
    }

    // 4. Full capacity - show disabled button
    if (isFull) {
      return (
        <View style={[styles.reserveButton, styles.fullButton]}>
          <Text style={styles.fullText}>Full</Text>
        </View>
      );
    }

    // 5. Available - show Reserve button
    return (
      <TouchableOpacity
        style={styles.reserveButton}
        onPress={onPress}
        activeOpacity={0.7}
        disabled={bookingInProgress}
      >
        <Text style={styles.reserveText}>
          {bookingInProgress ? 'Loading...' : 'Reserve'}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Left side - Time and Coach */}
      <View style={styles.leftSection}>
        <Text style={styles.time}>{formatEventTime(event.startTime)}</Text>
        <View style={styles.coachAvatar}>
          {event.coachAvatar ? (
            <Image
              source={{ uri: event.coachAvatar }}
              style={styles.avatarImage}
            />
          ) : (
            <LinearGradient
              colors={['#9BDDFF', '#7BC5F0']}
              style={styles.avatarPlaceholder}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
                  stroke="#0A0A0A"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Circle
                  cx={12}
                  cy={7}
                  r={4}
                  stroke="#0A0A0A"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </LinearGradient>
          )}
        </View>
      </View>

      {/* Center - Event details */}
      <View style={styles.centerSection}>
        <Text style={styles.title} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={styles.coachName}>{event.coachName}</Text>
        <Text style={styles.location}>{event.location}</Text>
        <Text style={styles.duration}>{event.durationMinutes} min.</Text>
      </View>

      {/* Right side - Button */}
      <View style={styles.rightSection}>{renderButton()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  leftSection: {
    alignItems: 'center',
    marginRight: 12,
  },
  time: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  coachAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerSection: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  coachName: {
    fontSize: 12,
    color: '#D1D5DB',
    marginBottom: 2,
  },
  location: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  duration: {
    fontSize: 12,
    color: '#6B7280',
  },
  rightSection: {
    justifyContent: 'center',
  },
  reserveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#9BDDFF',
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  reserveText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9BDDFF',
  },
  reservedButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  reservedGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  reservedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0A0A0A',
  },
  fullButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    opacity: 0.5,
  },
  fullText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  pastButton: {
    backgroundColor: 'rgba(107, 114, 128, 0.2)',
    borderColor: 'rgba(107, 114, 128, 0.4)',
    opacity: 0.7,
  },
  pastText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  pastReservedText: {
    color: '#FFFFFF',
  },
  // Booking window blocked - amber/warning style
  windowBlockedButton: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',  // amber-500 with 15% opacity
    borderColor: 'rgba(245, 158, 11, 0.4)',       // amber-500 with 40% opacity
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 100,
  },
  windowBlockedText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FBBF24',  // amber-400
    textAlign: 'center',
  },
});
