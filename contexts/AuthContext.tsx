import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isParentAccount: boolean;
  isReady: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Check if token is expired or about to expire (within 5 minutes)
function isTokenExpiredOrExpiring(session: Session | null): boolean {
  if (!session?.expires_at) return true;
  const now = Math.floor(Date.now() / 1000);
  const fiveMinutes = 5 * 60;
  return session.expires_at - now < fiveMinutes;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isParentAccount, setIsParentAccount] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const isRefreshing = useRef(false);

  // Check account type - non-blocking
  const checkAccountType = useCallback(async (userId: string) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', userId)
        .single();
      if (data) {
        setIsParentAccount(data.account_type === 'parent');
      }
    } catch (e) {
      console.log('[Auth] checkAccountType error:', e);
    }
  }, []);

  // Force refresh the token - call this when token is expired/expiring
  const forceRefreshToken = useCallback(async (): Promise<Session | null> => {
    if (isRefreshing.current) return session;
    isRefreshing.current = true;

    try {
      console.log('[Auth] Force refreshing token...');
      const { data, error } = await supabase.auth.refreshSession();

      if (error) {
        console.log('[Auth] Token refresh failed:', error.message);
        // Token refresh failed - user needs to re-login
        setSession(null);
        setUser(null);
        setIsParentAccount(false);
        return null;
      }

      if (data.session) {
        console.log('[Auth] Token refreshed successfully');
        setSession(data.session);
        setUser(data.session.user);
        return data.session;
      }

      return null;
    } catch (e) {
      console.log('[Auth] Token refresh exception:', e);
      return null;
    } finally {
      isRefreshing.current = false;
    }
  }, [session]);

  useEffect(() => {
    let mounted = true;

    // FAILSAFE: No matter what, we're ready in 5 seconds
    const failsafe = setTimeout(() => {
      if (mounted && !isReady) {
        console.log('[Auth] FAILSAFE triggered - forcing ready state');
        setIsReady(true);
      }
    }, 5000);

    const init = async () => {
      try {
        console.log('[Auth] Initializing...');
        const { data: { session: storedSession } } = await supabase.auth.getSession();

        if (!mounted) return;

        if (storedSession) {
          // CRITICAL: Check if token is expired or expiring
          if (isTokenExpiredOrExpiring(storedSession)) {
            console.log('[Auth] Stored session is expired/expiring, refreshing...');
            const refreshedSession = await forceRefreshToken();

            if (!refreshedSession) {
              console.log('[Auth] Could not refresh, user must re-login');
              setIsReady(true);
              clearTimeout(failsafe);
              return;
            }

            // Use refreshed session
            checkAccountType(refreshedSession.user.id);
          } else {
            // Token is still valid
            console.log('[Auth] Stored session is valid');
            setSession(storedSession);
            setUser(storedSession.user);
            checkAccountType(storedSession.user.id);
          }
        }

        setIsReady(true);
        clearTimeout(failsafe);
      } catch (e) {
        console.log('[Auth] Init error:', e);
        if (mounted) setIsReady(true);
        clearTimeout(failsafe);
      }
    };

    init();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      console.log('[Auth] State change:', event);

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setIsParentAccount(false);
      } else if (event === 'TOKEN_REFRESHED' && newSession) {
        console.log('[Auth] Token was refreshed by Supabase');
        setSession(newSession);
        setUser(newSession.user);
      } else if (newSession) {
        setSession(newSession);
        setUser(newSession.user);

        if (event === 'SIGNED_IN') {
          checkAccountType(newSession.user.id);
        }
      }

      if (!isReady) setIsReady(true);
    });

    // CRITICAL: Handle app coming to foreground - must refresh token
    const appStateSub = AppState.addEventListener('change', async (state) => {
      if (state === 'active' && mounted) {
        console.log('[Auth] App became active, checking token...');

        // Get current session
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (currentSession) {
          // Check if token needs refresh
          if (isTokenExpiredOrExpiring(currentSession)) {
            console.log('[Auth] Token expired/expiring on resume, forcing refresh...');
            await forceRefreshToken();
          } else {
            // Update state with current session (might have been refreshed by Supabase)
            setSession(currentSession);
            setUser(currentSession.user);
          }
        }
      }
    });

    return () => {
      mounted = false;
      clearTimeout(failsafe);
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, [checkAccountType, forceRefreshToken, isReady]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{
      session,
      user,
      isParentAccount,
      isReady,
      signIn,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  // Backwards compatibility
  return {
    ...context,
    loading: !context.isReady,
    initializing: !context.isReady,
    appReady: context.isReady,
    setAppReady: (_ready: boolean) => {},  // No-op, app ready is managed internally
    refreshSession: async () => {},
  };
}
