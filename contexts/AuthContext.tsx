import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  initializing: boolean;
  isParentAccount: boolean;
  appReady: boolean;
  setAppReady: (ready: boolean) => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [isParentAccount, setIsParentAccount] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const appState = useRef(AppState.currentState);
  const isRefreshing = useRef(false);

  // Check account type - fire and forget, never blocks
  const checkAccountType = useCallback(async (userId: string) => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', userId)
        .single();

      if (profile) {
        setIsParentAccount(profile.account_type === 'parent');
      }
    } catch (e) {
      console.log('[Auth] checkAccountType error:', e);
    }
  }, []);

  // Refresh session - used when app comes back to foreground
  const refreshSession = useCallback(async () => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;

    try {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.log('[Auth] refresh getSession error:', error.message);
        return;
      }

      const current = data.session;
      if (!current) return;

      const expiresAt = current.expires_at ?? 0;
      const now = Math.floor(Date.now() / 1000);
      const fiveMinutes = 5 * 60;

      if (expiresAt - now < fiveMinutes) {
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
        if (!refreshErr && refreshed.session) {
          setSession(refreshed.session);
          setUser(refreshed.session.user);
        } else {
          console.log('[Auth] refreshSession failed:', refreshErr?.message);
          // DO NOT block UI or kick user out here
        }
      } else {
        setSession(current);
        setUser(current.user);
      }
    } catch (e) {
      console.log('[Auth] refreshSession exception:', e);
    } finally {
      isRefreshing.current = false;
    }
  }, []);

  // Handle app state changes (foreground/background)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        refreshSession();
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [refreshSession]);

  // Initial session load
  useEffect(() => {
    let mounted = true;

    // FAILSAFE: Never allow infinite splash - force continue after 8 seconds
    const failSafe = setTimeout(() => {
      if (mounted && initializing) {
        console.log('[Auth] FAILSAFE: auth init taking too long, forcing continue');
        setLoading(false);
        setInitializing(false);
      }
    }, 8000);

    const initializeAuth = async () => {
      console.log('[Auth] initializeAuth starting...');
      try {
        // getSession reads from persisted storage (AsyncStorage) internally
        // With noOpLock in supabase.ts, this should NOT hang anymore
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.log('[Auth] getSession error:', error.message);
        }

        const initialSession = data.session ?? null;

        console.log('[Auth] getSession result:', { hasSession: !!initialSession });

        if (!mounted) return;

        setSession(initialSession);
        setUser(initialSession?.user ?? null);

        if (initialSession?.user?.id) {
          // Don't block init on account type check
          checkAccountType(initialSession.user.id).catch(() => {});
        }

        setLoading(false);
        setInitializing(false);
      } catch (e) {
        console.log('[Auth] initializeAuth exception:', e);
        if (!mounted) return;
        setLoading(false);
        setInitializing(false);
      } finally {
        clearTimeout(failSafe);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mounted) return;

        console.log('[Auth] onAuthStateChange:', event, !!newSession);

        // Handle INITIAL_SESSION - important for mobile resume/cold starts
        if (event === 'INITIAL_SESSION') {
          setSession(newSession);
          setUser(newSession?.user ?? null);
          setLoading(false);
          setInitializing(false);
          if (newSession?.user?.id) {
            checkAccountType(newSession.user.id).catch(() => {});
          }
          clearTimeout(failSafe);
          return;
        }

        if (event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
          setIsParentAccount(false);
          setLoading(false);
          setAppReady(false);
          return;
        }

        if (event === 'SIGNED_IN') {
          if (newSession) {
            setSession(newSession);
            setUser(newSession.user);
            checkAccountType(newSession.user.id).catch(() => {});
          }
          setLoading(false);
          return;
        }

        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (newSession) {
            setSession(newSession);
            setUser(newSession.user);
          }
          setLoading(false);
          return;
        }
      }
    );

    return () => {
      mounted = false;
      clearTimeout(failSafe);
      subscription.unsubscribe();
    };
  }, [checkAccountType]);

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      setLoading(false);
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      setAppReady(false);
      await supabase.auth.signOut();
    } catch {
      // Sign out error
    } finally {
      setLoading(false);
    }
  };

  const handleSetAppReady = useCallback((ready: boolean) => {
    setAppReady(ready);
  }, []);

  return (
    <AuthContext.Provider value={{
      session,
      user,
      loading,
      initializing,
      isParentAccount,
      appReady,
      setAppReady: handleSetAppReady,
      signIn,
      signOut,
      refreshSession
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
  return context;
}
