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
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [isParentAccount, setIsParentAccount] = useState(false);
  const appState = useRef(AppState.currentState);
  const initCompleted = useRef(false);

  // Check if user is a parent account - fire and forget, don't block anything
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

  // Background token refresh - NEVER blocks UI, just updates state if successful
  const refreshInBackground = useCallback(() => {
    // Don't await this - fire and forget
    supabase.auth.refreshSession().then(({ data, error }) => {
      if (!error && data.session) {
        console.log('[Auth] Background refresh successful');
        setSession(data.session);
        setUser(data.session.user);
      } else if (error) {
        console.log('[Auth] Background refresh failed:', error.message);
        // Don't clear session on error - let user continue with stale session
        // They'll get kicked out when they try to do something that needs auth
      }
    }).catch(e => {
      console.log('[Auth] Background refresh exception:', e);
    });
  }, []);

  // Handle app state changes - refresh token in background when resuming
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('[Auth] App resumed from background');
        // Only refresh if we have a session
        if (session) {
          refreshInBackground();
        }
      }
      appState.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [session, refreshInBackground]);

  // ONE-TIME initial session load
  useEffect(() => {
    // Prevent running twice
    if (initCompleted.current) return;
    initCompleted.current = true;

    const initializeAuth = async () => {
      console.log('[Auth] Initializing...');
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();

        if (initialSession) {
          console.log('[Auth] Found session for:', initialSession.user.email);
          setSession(initialSession);
          setUser(initialSession.user);
          // Check account type in background
          checkAccountType(initialSession.user.id);
        } else {
          console.log('[Auth] No session');
        }
      } catch (e) {
        console.log('[Auth] Init error:', e);
      } finally {
        // ALWAYS set initializing to false
        console.log('[Auth] Init complete, setting initializing=false');
        setInitializing(false);
      }
    };

    // Safety timeout - ALWAYS complete init within 3 seconds
    const safetyTimeout = setTimeout(() => {
      console.warn('[Auth] Safety timeout triggered');
      setInitializing(false);
    }, 3000);

    initializeAuth().finally(() => {
      clearTimeout(safetyTimeout);
    });

    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        console.log('[Auth] State change:', event);

        if (event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
          setIsParentAccount(false);
        } else if (event === 'SIGNED_IN' && newSession) {
          setSession(newSession);
          setUser(newSession.user);
          checkAccountType(newSession.user.id);
        } else if (event === 'TOKEN_REFRESHED' && newSession) {
          setSession(newSession);
          setUser(newSession.user);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [checkAccountType]);

  const signIn = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setLoading(false);
        return { error: error as Error };
      }

      if (data.session) {
        setSession(data.session);
        setUser(data.session.user);
        await checkAccountType(data.session.user.id);
      }

      setLoading(false);
      return { error: null };
    } catch (error) {
      setLoading(false);
      return { error: error as Error };
    }
  }, [checkAccountType]);

  const signOut = useCallback(async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.log('[Auth] Sign out error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      session,
      user,
      loading,
      initializing,
      isParentAccount,
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
  return context;
}
