/**
 * Wizard timing cues — audible beeps + haptic taps.
 *
 * Sounds are generated at /Users/maxsmac/Desktop/aspboost-mobile/assets/armcare/sounds/:
 *   - tick.wav  880Hz · 120ms (countdown 3,2,1)
 *   - go.wav   1320Hz · 500ms (start of push)
 *   - stop.wav  660Hz · 240ms (end of push)
 *
 * Sounds are loaded once on first use and reused. Haptics fire alongside so
 * the athlete still gets feedback if their phone is muted.
 */

import { Audio, InterruptionModeIOS } from 'expo-av';
import * as Haptics from 'expo-haptics';

let _tick: Audio.Sound | null = null;
let _go: Audio.Sound | null = null;
let _stop: Audio.Sound | null = null;
let _initPromise: Promise<void> | null = null;

async function init(): Promise<void> {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      shouldDuckAndroid: true,
    }).catch(() => {});
    const [{ sound: tick }, { sound: go }, { sound: stop }] = await Promise.all([
      Audio.Sound.createAsync(require('../../assets/armcare/sounds/tick.wav')),
      Audio.Sound.createAsync(require('../../assets/armcare/sounds/go.wav')),
      Audio.Sound.createAsync(require('../../assets/armcare/sounds/stop.wav')),
    ]);
    _tick = tick;
    _go = go;
    _stop = stop;
  })();
  return _initPromise;
}

async function play(s: Audio.Sound | null) {
  if (!s) return;
  try {
    await s.setPositionAsync(0);
    await s.playAsync();
  } catch {
    // ignore — bad audio session state shouldn't take the wizard down
  }
}

/** Call once on a user gesture (e.g. Connect tap) so iOS allows playback. */
export function unlockCues(): void {
  init().catch(() => {});
}

export const CUES = {
  // Countdown tick — short beep + light haptic
  tick: () => {
    init().then(() => play(_tick));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  // Start of push — long beep + success haptic
  go: () => {
    init().then(() => play(_go));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
  },
  // End of push — soft beep + medium haptic
  stop: () => {
    init().then(() => play(_stop));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
} as const;
