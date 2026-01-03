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

// Simple AppState handling - just start/stop auto refresh
// The Supabase client handles token refresh automatically when needed
let listenerRegistered = false;

if (!listenerRegistered) {
  listenerRegistered = true;

  AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') {
      // Resume auto refresh when app is active
      supabase.auth.startAutoRefresh();
    } else {
      // Pause auto refresh when app is in background
      supabase.auth.stopAutoRefresh();
    }
  });
}
