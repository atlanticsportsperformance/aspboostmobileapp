import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// WORKAROUND: Supabase's lock mechanism causes deadlocks on React Native
// when the app resumes from background. This bypasses the broken locking.
// See: https://github.com/supabase/supabase-js/issues/1594
const noOpLock = async <R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>
): Promise<R> => {
  return await fn();
};

const createSupabaseClient = () => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: noOpLock,
    },
  });
};

// Main client instance - mutable so we can recreate it
let _supabase: SupabaseClient = createSupabaseClient();

// Export a getter that always returns the current client
// This allows recreateSupabaseClient() to affect all code using supabase
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (_supabase as any)[prop];
  },
});

// CRITICAL: Recreate Supabase client to fix stale connections after app resume
// Call this when queries are hanging after returning from background
// Returns the new client AND updates the global supabase export
export const recreateSupabaseClient = (): SupabaseClient => {
  console.log('[Supabase] Recreating client to fix stale connection');
  _supabase = createSupabaseClient();
  return _supabase;
};

// Get the current client directly (not proxied)
export const getSupabaseClient = (): SupabaseClient => {
  return _supabase;
};
