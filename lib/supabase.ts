import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Track app state for foreground detection
const appState = { current: AppState.currentState };
let backgroundedAt: number | null = null;

// AppState listener - handle auto refresh and immediate refresh on foreground
AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
  if (nextAppState === 'active') {
    console.log('[Supabase] App active, starting auto refresh');
    supabase.auth.startAutoRefresh();

    // If app was backgrounded, trigger an immediate session check
    // This ensures the token is fresh before any API calls
    if (appState.current.match(/inactive|background/) && backgroundedAt) {
      const backgroundDuration = Date.now() - backgroundedAt;
      console.log(`[Supabase] Was backgrounded for ${Math.round(backgroundDuration / 1000)}s`);

      // If backgrounded for more than 1 minute, proactively refresh the session
      if (backgroundDuration > 60 * 1000) {
        console.log('[Supabase] Triggering proactive session refresh...');
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            // Force a refresh to ensure we have a fresh token
            await supabase.auth.refreshSession();
            console.log('[Supabase] Proactive refresh completed');
          }
        } catch (e) {
          console.log('[Supabase] Proactive refresh failed:', e);
        }
      }
      backgroundedAt = null;
    }
  } else if (nextAppState.match(/inactive|background/)) {
    console.log('[Supabase] App inactive, stopping auto refresh');
    supabase.auth.stopAutoRefresh();
    backgroundedAt = Date.now();
  }
  appState.current = nextAppState;
});

// Helper to add timeout to async operations
function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMsg)), ms)
    ),
  ]);
}

// Simple helper to get a valid session
// This just gets the session and refreshes ONLY if truly expired
// Includes timeout to prevent hanging on slow network
export async function getValidSession() {
  try {
    // 5 second timeout for getting session from storage
    const { data: { session } } = await withTimeout(
      supabase.auth.getSession(),
      5000,
      'Session check timed out'
    );

    if (!session) {
      console.log('[Supabase] No session in storage');
      return null;
    }

    // Check if token is expired or about to expire (within 60 seconds)
    const expiresAt = session.expires_at;
    const now = Math.floor(Date.now() / 1000);
    const REFRESH_BUFFER = 60; // Refresh if expiring within 60 seconds

    if (expiresAt && expiresAt - now < REFRESH_BUFFER) {
      // Token is expired or about to expire - need to refresh
      console.log('[Supabase] Token expiring soon, refreshing...');
      try {
        // 8 second timeout for refresh (network operation)
        const { data, error } = await withTimeout(
          supabase.auth.refreshSession(),
          8000,
          'Session refresh timed out'
        );
        if (error) {
          console.log('[Supabase] Refresh failed:', error.message);
          // If refresh fails but token hasn't actually expired yet, return existing session
          if (expiresAt > now) {
            console.log('[Supabase] Using existing session (still valid)');
            return session;
          }
          return null;
        }
        console.log('[Supabase] Token refreshed successfully');
        return data.session;
      } catch (refreshError) {
        console.log('[Supabase] Refresh error:', refreshError);
        // If refresh times out but token is still valid, use existing
        if (expiresAt > now) {
          console.log('[Supabase] Refresh failed but token still valid, using existing');
          return session;
        }
        return null;
      }
    }

    // Token is still valid
    return session;
  } catch (e) {
    console.log('[Supabase] getValidSession error:', e);
    return null;
  }
}
