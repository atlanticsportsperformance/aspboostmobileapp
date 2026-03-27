import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const COLORS = {
  accent: '#9BDDFF',
  accentDeep: '#7BC5F0',
  bg: '#0A0A0A',
};

// ── Particle data (generated once at module scope) ──────────────────────────
const PARTICLES = Array.from({ length: 15 }, () => ({
  x: Math.random() * SCREEN_WIDTH,
  y: Math.random() * SCREEN_HEIGHT,
  size: 1.5 + Math.random() * 2.5,
  opacity: 0.05 + Math.random() * 0.07,
  driftX: (Math.random() - 0.5) * 70,
  driftY: (Math.random() - 0.5) * 70,
  duration: 7000 + Math.random() * 6000,
}));

const HERO_PARTICLES = Array.from({ length: 4 }, () => ({
  x: SCREEN_WIDTH * 0.15 + Math.random() * SCREEN_WIDTH * 0.7,
  y: SCREEN_HEIGHT * 0.2 + Math.random() * SCREEN_HEIGHT * 0.6,
  size: 5 + Math.random() * 4,
  opacity: 0.08 + Math.random() * 0.06,
  driftX: (Math.random() - 0.5) * 40,
  driftY: (Math.random() - 0.5) * 40,
  duration: 10000 + Math.random() * 5000,
}));

const ALL_PARTICLES = [...PARTICLES, ...HERO_PARTICLES];

// ── Particle Field ──────────────────────────────────────────────────────────
function ParticleField() {
  const anims = useRef(
    ALL_PARTICLES.map(() => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    const loops: Animated.CompositeAnimation[] = [];
    ALL_PARTICLES.forEach((p, i) => {
      const loopX = Animated.loop(
        Animated.sequence([
          Animated.timing(anims[i].x, { toValue: p.driftX, duration: p.duration, useNativeDriver: true }),
          Animated.timing(anims[i].x, { toValue: 0, duration: p.duration, useNativeDriver: true }),
        ])
      );
      const loopY = Animated.loop(
        Animated.sequence([
          Animated.timing(anims[i].y, { toValue: p.driftY, duration: p.duration * 1.1, useNativeDriver: true }),
          Animated.timing(anims[i].y, { toValue: 0, duration: p.duration * 1.1, useNativeDriver: true }),
        ])
      );
      loopX.start();
      loopY.start();
      loops.push(loopX, loopY);
    });
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {ALL_PARTICLES.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            borderRadius: p.size / 2,
            backgroundColor: COLORS.accent,
            opacity: p.opacity,
            transform: [{ translateX: anims[i].x }, { translateY: anims[i].y }],
          }}
        />
      ))}
    </View>
  );
}

// ── Animated Loading Screen ─────────────────────────────────────────────────
interface AnimatedLoadingProps {
  title?: string;
  subtitle?: string;
}

export default function AnimatedLoading({
  title = 'A Sports Performance Team',
  subtitle = 'In Your Pocket.',
}: AnimatedLoadingProps) {
  // Animation values
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoPulseScale = useRef(new Animated.Value(1)).current;
  const glowRingOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(20)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleTranslateY = useRef(new Animated.Value(15)).current;
  const shimmerTranslateX = useRef(new Animated.Value(-SCREEN_WIDTH)).current;
  const scanLineY = useRef(new Animated.Value(-2)).current;
  const scanLineOpacity = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(new Animated.Value(0)).current;
  const progressBarOpacity = useRef(new Animated.Value(0)).current;
  const footerOpacity = useRef(new Animated.Value(0)).current;
  const dotOpacity1 = useRef(new Animated.Value(0.3)).current;
  const dotOpacity2 = useRef(new Animated.Value(0.3)).current;
  const dotOpacity3 = useRef(new Animated.Value(0.3)).current;

  const combinedLogoScale = Animated.multiply(logoScale, logoPulseScale);

  useEffect(() => {
    startAnimations();
  }, []);

  function startAnimations() {
    // === Phase 1: Background + Logo (0ms) ===
    Animated.timing(bgOpacity, {
      toValue: 1, duration: 600, useNativeDriver: true,
    }).start();

    Animated.spring(logoScale, {
      toValue: 1, damping: 12, stiffness: 100, useNativeDriver: true,
    }).start();

    Animated.timing(logoOpacity, {
      toValue: 1, duration: 400, useNativeDriver: true,
    }).start();

    // === Phase 2: Glow ring (200ms) ===
    Animated.timing(glowRingOpacity, {
      toValue: 0.5, duration: 400, delay: 200, useNativeDriver: true,
    }).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowRingOpacity, { toValue: 0.7, duration: 2500, useNativeDriver: true }),
          Animated.timing(glowRingOpacity, { toValue: 0.3, duration: 2500, useNativeDriver: true }),
        ])
      ).start();
    });

    // === Phase 3: Logo breathing (400ms) ===
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(logoPulseScale, { toValue: 1.04, duration: 2000, useNativeDriver: true }),
          Animated.timing(logoPulseScale, { toValue: 1, duration: 2000, useNativeDriver: true }),
        ])
      ).start();
    }, 400);

    // === Phase 4: Title + Subtitle (500–750ms) ===
    Animated.parallel([
      Animated.timing(titleOpacity, { toValue: 1, duration: 500, delay: 500, useNativeDriver: true }),
      Animated.timing(titleTranslateY, { toValue: 0, duration: 500, delay: 500, useNativeDriver: true }),
    ]).start();

    Animated.parallel([
      Animated.timing(subtitleOpacity, { toValue: 1, duration: 500, delay: 750, useNativeDriver: true }),
      Animated.timing(subtitleTranslateY, { toValue: 0, duration: 500, delay: 750, useNativeDriver: true }),
    ]).start();

    // === Phase 5: Scan line sweep (800ms) ===
    Animated.sequence([
      Animated.timing(scanLineOpacity, { toValue: 1, duration: 80, delay: 800, useNativeDriver: true }),
      Animated.timing(scanLineY, { toValue: SCREEN_HEIGHT, duration: 1400, useNativeDriver: true }),
      Animated.timing(scanLineOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start();

    // === Phase 6: Progress bar + Shimmer (900–1000ms) ===
    Animated.timing(progressBarOpacity, {
      toValue: 1, duration: 300, delay: 900, useNativeDriver: true,
    }).start();

    Animated.timing(progressValue, {
      toValue: 0.85, duration: 2500, delay: 1000, useNativeDriver: false,
    }).start();

    // Shimmer loop
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerTranslateX, {
            toValue: SCREEN_WIDTH, duration: 1500, useNativeDriver: true,
          }),
          Animated.delay(800),
          Animated.timing(shimmerTranslateX, {
            toValue: -SCREEN_WIDTH, duration: 0, useNativeDriver: true,
          }),
        ])
      ).start();
    }, 1000);

    // === Phase 7: Loading dots animation (1000ms) ===
    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotOpacity1, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dotOpacity2, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dotOpacity3, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.delay(400),
          Animated.parallel([
            Animated.timing(dotOpacity1, { toValue: 0.3, duration: 200, useNativeDriver: true }),
            Animated.timing(dotOpacity2, { toValue: 0.3, duration: 200, useNativeDriver: true }),
            Animated.timing(dotOpacity3, { toValue: 0.3, duration: 200, useNativeDriver: true }),
          ]),
          Animated.delay(200),
        ])
      ).start();
    }, 1000);

    // === Phase 8: Footer (1200ms) ===
    Animated.timing(footerOpacity, {
      toValue: 1, duration: 400, delay: 1200, useNativeDriver: true,
    }).start();
  }

  const progressWidth = progressValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      {/* Background fade in */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.bg, opacity: bgOpacity }]} />

      {/* Floating particles */}
      <ParticleField />

      {/* Scan line */}
      <Animated.View
        style={[
          styles.scanLine,
          { opacity: scanLineOpacity, transform: [{ translateY: scanLineY }] },
        ]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={['transparent', COLORS.accent, 'transparent'] as const}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: '100%', height: '100%' }}
        />
      </Animated.View>

      {/* Center content */}
      <View style={styles.centerContent}>
        {/* Logo with glow ring */}
        <Animated.View
          style={[
            styles.logoContainer,
            { opacity: logoOpacity, transform: [{ scale: combinedLogoScale }] },
          ]}
        >
          <Animated.View style={[styles.glowRing, { opacity: glowRingOpacity }]} />
          <Animated.View style={[styles.innerGlow, { opacity: glowRingOpacity }]} />
          <Image
            source={require('../assets/splash-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Title text */}
        <View style={styles.textContainer}>
          <Animated.View
            style={{
              opacity: titleOpacity,
              transform: [{ translateY: titleTranslateY }],
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Text style={styles.titleText}>{title}</Text>
          </Animated.View>

          <Animated.View
            style={{
              opacity: subtitleOpacity,
              transform: [{ translateY: subtitleTranslateY }],
            }}
          >
            <Text style={styles.subtitleText}>{subtitle}</Text>
          </Animated.View>

          {/* Shimmer overlay */}
          <Animated.View
            style={[styles.shimmer, { transform: [{ translateX: shimmerTranslateX }] }]}
            pointerEvents="none"
          >
            <LinearGradient
              colors={['transparent', 'rgba(155,221,255,0.10)', 'transparent'] as const}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ width: '100%', height: '100%' }}
            />
          </Animated.View>
        </View>

        {/* Animated loading dots */}
        <Animated.View style={[styles.dotsRow, { opacity: titleOpacity }]}>
          <Animated.View style={[styles.dot, { opacity: dotOpacity1 }]} />
          <Animated.View style={[styles.dot, { opacity: dotOpacity2 }]} />
          <Animated.View style={[styles.dot, { opacity: dotOpacity3 }]} />
        </Animated.View>

        {/* Progress bar */}
        <Animated.View style={[styles.progressContainer, { opacity: progressBarOpacity }]}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: progressWidth }]}>
              <LinearGradient
                colors={[COLORS.accentDeep, COLORS.accent] as const}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.progressGradient}
              />
            </Animated.View>
          </View>
        </Animated.View>
      </View>

      {/* Footer */}
      <Animated.View style={[styles.footer, { opacity: footerOpacity }]}>
        <Text style={styles.footerText}>
          ASP <Text style={styles.footerAccent}>Boost+</Text>
        </Text>
      </Animated.View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Logo
  logoContainer: {
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  glowRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 1.5,
    borderColor: COLORS.accent,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 25,
    elevation: 10,
  },
  innerGlow: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'transparent',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 5,
  },
  logo: {
    width: 120,
    height: 120,
  },

  // Text
  textContainer: {
    alignItems: 'center',
    overflow: 'hidden',
    paddingVertical: 4,
    paddingHorizontal: 40,
  },
  titleText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitleText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.accent,
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 100,
    height: '100%',
  },

  // Loading dots
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.accent,
  },

  // Progress bar
  progressContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  progressTrack: {
    width: 200,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(155,221,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 5,
  },
  progressGradient: {
    flex: 1,
  },

  // Scan line
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    zIndex: 10,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 1.5,
  },
  footerAccent: {
    color: COLORS.accent,
  },
});
