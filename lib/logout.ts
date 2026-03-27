import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';
import { unregisterPushToken } from './pushNotifications';

export async function performLogout(): Promise<void> {
  // Unregister push token first — needs active session for auth header
  try {
    await unregisterPushToken();
  } catch (e) {
    console.error('[Logout] Failed to unregister push token:', e);
  }

  // Clear all biometric and credential state
  try {
    await Promise.all([
      SecureStore.deleteItemAsync('faceIdEnabled'),
      SecureStore.deleteItemAsync('userEmail'),
      SecureStore.deleteItemAsync('userPassword'),
    ]);
  } catch (e) {
    console.error('[Logout] Failed to clear SecureStore:', e);
  }

  // Sign out from Supabase
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.error('[Logout] Supabase signOut failed:', e);
  }
}
