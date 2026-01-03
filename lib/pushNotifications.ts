import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const API_URL = 'https://aspboostapp.vercel.app';
const PUSH_TOKEN_KEY = '@push_token';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface PushNotificationState {
  expoPushToken: string | null;
  notification: Notifications.Notification | null;
}

/**
 * Request notification permissions from the user
 * Returns true if permissions were granted
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return false;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission not granted');
    return false;
  }

  return true;
}

/**
 * Get the device's push token
 * Returns null if unable to get token
 */
export async function getDevicePushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  try {
    // Get project ID from app config
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;

    if (!projectId) {
      console.error('EAS project ID not found in app config');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    return tokenData.data;
  } catch (error) {
    console.error('Error getting push token:', error);
    return null;
  }
}

/**
 * Register the push token with our backend
 */
export async function registerPushToken(token: string): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      console.error('No auth session for push token registration');
      return false;
    }

    const response = await fetch(`${API_URL}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        deviceToken: token,
        platform: Platform.OS,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to register push token:', error);
      return false;
    }

    // Store token locally to track registration
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    console.log('Push token registered successfully');
    return true;
  } catch (error) {
    console.error('Error registering push token:', error);
    return false;
  }
}

/**
 * Unregister the push token from our backend (call on logout)
 */
export async function unregisterPushToken(): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);

    if (!token) {
      console.log('No push token to unregister');
      return true;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.access_token) {
      // If no session, just clear local token
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
      return true;
    }

    const response = await fetch(`${API_URL}/api/push/unregister`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ token }),
    });

    // Clear local token regardless of response
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to unregister push token:', error);
      return false;
    }

    console.log('Push token unregistered successfully');
    return true;
  } catch (error) {
    console.error('Error unregistering push token:', error);
    // Still clear local token on error
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    return false;
  }
}

/**
 * Full registration flow - request permissions, get token, register with backend
 * Call this after successful login
 */
export async function setupPushNotifications(): Promise<string | null> {
  const hasPermission = await requestNotificationPermissions();

  if (!hasPermission) {
    return null;
  }

  const token = await getDevicePushToken();

  if (!token) {
    return null;
  }

  const registered = await registerPushToken(token);

  if (!registered) {
    return null;
  }

  return token;
}

/**
 * Check if push notifications are enabled
 */
export async function isPushNotificationsEnabled(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/**
 * Get the stored push token (if any)
 */
export async function getStoredPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

/**
 * Handle notification response (when user taps a notification)
 * Returns deep link data if present
 */
export function parseNotificationData(notification: Notifications.Notification): {
  type?: string;
  id?: string;
  screen?: string;
  data?: Record<string, any>;
} {
  const data = notification.request.content.data || {};
  return {
    type: data.type as string | undefined,
    id: data.id as string | undefined,
    screen: data.screen as string | undefined,
    data: data as Record<string, any>,
  };
}

/**
 * Set up notification listeners
 * Returns cleanup function to remove listeners
 */
export function setupNotificationListeners(
  onNotificationReceived?: (notification: Notifications.Notification) => void,
  onNotificationResponse?: (response: Notifications.NotificationResponse) => void
): () => void {
  const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
    console.log('Notification received:', notification);
    onNotificationReceived?.(notification);
  });

  const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log('Notification response:', response);
    onNotificationResponse?.(response);
  });

  // Return cleanup function
  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}

/**
 * Get the last notification response (for handling cold start from notification)
 */
export async function getLastNotificationResponse(): Promise<Notifications.NotificationResponse | null> {
  return Notifications.getLastNotificationResponseAsync();
}
