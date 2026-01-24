import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Create the initial Supabase client
let supabaseInstance: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Use a Proxy so all imports automatically use the current instance
// When we recreate the client, all existing code gets the fresh one
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get: (_, prop: string) => {
    return (supabaseInstance as any)[prop];
  },
});

// Recreate the Supabase client with a fresh connection
// Call this when the client is detected as stale (queries hanging)
export function recreateSupabaseClient(): SupabaseClient {
  console.log('[Supabase] Recreating client with fresh connection...');

  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  console.log('[Supabase] Fresh client created');
  return supabaseInstance;
}
