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

  // Check account type
  const checkAccountType = async (userId: string) => {
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
  };

  // Refresh session - used when app comes back to foreground
  const refreshSession = async () => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;

    try {
      const { data: { session: currentSession }, error } = await supabase.auth.getSession();

      if (error) {
        if (error.message?.includes('network') || error.message?.includes('fetch')) {
          isRefreshing.current = false;
          return;
        }
      }

      if (currentSession) {
        const expiresAt = currentSession.expires_at;
        const now = Math.floor(Date.now() / 1000);
        const fiveMinutes = 5 * 60;

        if (expiresAt && expiresAt - now < fiveMinutes) {
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshData.session) {
            setSession(refreshData.session);
            setUser(refreshData.session.user);
          }
        } else {
          setSession(currentSession);
          setUser(currentSession.user);
        }
      }
    } catch {
      // Session refresh failed
    } finally {
      isRefreshing.current = false;
    }
  };

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
  }, []);

  // Initial session load
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();

        if (mounted) {
          if (initialSession) {
            setSession(initialSession);
            setUser(initialSession.user);
            checkAccountType(initialSession.user.id);
          }
          setLoading(false);
          setInitializing(false);
        }
      } catch {
        if (mounted) {
          setLoading(false);
          setInitializing(false);
        }
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mounted) return;

        switch (event) {
          case 'SIGNED_OUT':
            setSession(null);
            setUser(null);
            setIsParentAccount(false);
            setLoading(false);
            setAppReady(false);
            break;
          case 'SIGNED_IN':
            if (newSession) {
              setSession(newSession);
              setUser(newSession.user);
              checkAccountType(newSession.user.id);
            }
            setLoading(false);
            break;
          case 'TOKEN_REFRESHED':
            if (newSession) {
              setSession(newSession);
              setUser(newSession.user);
            }
            setLoading(false);
            break;
          case 'USER_UPDATED':
            if (newSession) {
              setSession(newSession);
              setUser(newSession.user);
            }
            break;
          default:
            break;
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

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
