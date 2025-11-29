import React, { useState, useRef } from 'react';
import { View, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import ForceProfileCard from './ForceProfileCard';
import ArmCareCard from './ArmCareCard';
import HittingCard from './HittingCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PerformanceCarouselProps {
  forceProfileData?: any;
  armCareData?: any;
  hittingData?: any;
  onForceProfilePress: () => void;
  onArmCarePress: () => void;
  onHittingPress: () => void;
}

export default function PerformanceCarousel({
  forceProfileData,
  armCareData,
  hittingData,
  onForceProfilePress,
  onArmCarePress,
  onHittingPress,
}: PerformanceCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;

  // Build slides array
  const slides = [];
  if (forceProfileData) slides.push('force');
  if (armCareData) slides.push('armcare');
  if (hittingData) slides.push('hitting');

  // If no data, don't render carousel
  if (slides.length === 0) return null;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to horizontal swipes
        return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 10;
      },
      onPanResponderGrant: () => {
        translateX.setOffset((translateX as any)._value);
      },
      onPanResponderMove: (_, gestureState) => {
        translateX.setValue(gestureState.dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        translateX.flattenOffset();

        const threshold = SCREEN_WIDTH * 0.3;
        let newIndex = currentIndex;

        if (gestureState.dx > threshold && currentIndex > 0) {
          // Swipe right - go to previous
          newIndex = currentIndex - 1;
        } else if (gestureState.dx < -threshold && currentIndex < slides.length - 1) {
          // Swipe left - go to next
          newIndex = currentIndex + 1;
        }

        setCurrentIndex(newIndex);
        Animated.spring(translateX, {
          toValue: -newIndex * SCREEN_WIDTH,
          useNativeDriver: true,
          friction: 8,
          tension: 40,
        }).start();
      },
    })
  ).current;

  // Update translateX when index changes programmatically
  React.useEffect(() => {
    Animated.spring(translateX, {
      toValue: -currentIndex * SCREEN_WIDTH,
      useNativeDriver: true,
      friction: 8,
      tension: 40,
    }).start();
  }, [currentIndex]);

  return (
    <View style={styles.container}>
      <View style={styles.carouselContainer} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            styles.slidesWrapper,
            {
              transform: [{ translateX }],
            },
          ]}
        >
          {slides.map((slide, index) => (
            <View key={slide} style={styles.slide}>
              {slide === 'force' && forceProfileData && (
                <ForceProfileCard data={forceProfileData} onPress={onForceProfilePress} />
              )}
              {slide === 'armcare' && armCareData && (
                <ArmCareCard data={armCareData} onPress={onArmCarePress} />
              )}
              {slide === 'hitting' && hittingData && (
                <HittingCard data={hittingData} onPress={onHittingPress} />
              )}
            </View>
          ))}
        </Animated.View>
      </View>

      {/* Dot Navigation - only show if more than 1 slide */}
      {slides.length > 1 && (
        <View style={styles.dotContainer}>
          {slides.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                index === currentIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 72, // Clear header
    paddingBottom: 8,
  },
  carouselContainer: {
    overflow: 'hidden',
    paddingHorizontal: 8,
  },
  slidesWrapper: {
    flexDirection: 'row',
  },
  slide: {
    width: SCREEN_WIDTH,
    paddingHorizontal: 8,
  },
  dotContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  dot: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  dotActive: {
    width: 16,
    backgroundColor: '#9BDDFF',
  },
  dotInactive: {
    width: 4,
  },
});
