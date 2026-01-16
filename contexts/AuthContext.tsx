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

  // Check if user is a parent account
  const checkAccountType = async (userId: string) => {
    try {
      console.log('[AuthContext] Checking account type for user:', userId);
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', userId)
        .single();

      if (!error && profile) {
        const isParent = profile.account_type === 'parent';
        console.log('[AuthContext] Account type:', profile.account_type, 'isParent:', isParent);
        setIsParentAccount(isParent);
      } else {
        console.log('[AuthContext] No profile found or error:', error?.message);
        setIsParentAccount(false);
      }
    } catch (e) {
      console.log('[AuthContext] checkAccountType error:', e);
      setIsParentAccount(false);
    }
  };

  // Refresh session - used when app comes back to foreground
  const refreshSession = useCallback(async () => {
    if (isRefreshing.current) return;
    isRefreshing.current = true;

    try {
      const { data: { session: currentSession }, error } = await supabase.auth.getSession();

      if (error) {
        // Network errors - keep existing state but ensure app is ready
        if (error.message?.includes('network') || error.message?.includes('fetch')) {
          console.log('[AuthContext] Network error, keeping existing state');
          // CRITICAL: If we have an existing session, make sure appReady is true
          // so the splash screen hides even on network errors
          if (session) {
            setAppReady(true);
          }
          isRefreshing.current = false;
          return;
        }
      }

      if (currentSession) {
        const expiresAt = currentSession.expires_at;
        const now = Math.floor(Date.now() / 1000);
        const fiveMinutes = 5 * 60;

        if (expiresAt && expiresAt - now < fiveMinutes) {
          // Token expiring soon, refresh it
          console.log('[AuthContext] Token expiring soon, refreshing...');
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshData.session) {
            setSession(refreshData.session);
            setUser(refreshData.session.user);
            await checkAccountType(refreshData.session.user.id);
          } else if (expiresAt > now) {
            // Refresh failed but token still valid, use existing
            setSession(currentSession);
            setUser(currentSession.user);
          }
        } else {
          // Token is still valid
          setSession(currentSession);
          setUser(currentSession.user);
        }
        // CRITICAL: When resuming from background with valid session,
        // ensure appReady is true so splash screen hides
        console.log('[AuthContext] Session valid on resume, setting appReady=true');
        setAppReady(true);
      } else {
        // No session
        setSession(null);
        setUser(null);
        setIsParentAccount(false);
        // No session means we'll show login, which doesn't need appReady
      }
    } catch (e) {
      console.log('[AuthContext] Refresh error:', e);
      // Keep existing state on error, but ensure app can continue
      if (session) {
        setAppReady(true);
      }
    } finally {
      isRefreshing.current = false;
    }
  }, [session]);

  // Handle app state changes (foreground/background) - SINGLE LISTENER
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('[AuthContext] App foregrounded, refreshing session');
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

    const initializeAuth = async () => {
      try {
        console.log('[AuthContext] Initializing auth...');

        // Add timeout to getSession - don't wait forever
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Session fetch timeout')), 5000)
        );

        const { data: { session: initialSession } } = await Promise.race([
          sessionPromise,
          timeoutPromise
        ]) as { data: { session: any } };

        if (mounted) {
          if (initialSession) {
            console.log('[AuthContext] Found existing session for user:', initialSession.user.id);
            setSession(initialSession);
            setUser(initialSession.user);
            // Don't await checkAccountType - do it in background
            // This prevents hanging if the network is slow
            checkAccountType(initialSession.user.id).catch(e => {
              console.log('[AuthContext] checkAccountType error (non-blocking):', e);
            });
            console.log('[AuthContext] Init complete with session');
          } else {
            console.log('[AuthContext] No existing session');
          }
          setLoading(false);
          setInitializing(false);
          console.log('[AuthContext] Initialization complete, initializing=false');
        }
      } catch (e) {
        console.log('[AuthContext] Init error:', e);
        if (mounted) {
          setLoading(false);
          setInitializing(false);
        }
      }
    };

    // SAFETY: Force initialization to complete after 6 seconds no matter what
    const safetyTimeout = setTimeout(() => {
      if (mounted) {
        console.warn('[AuthContext] Safety timeout - forcing initializing=false');
        setLoading(false);
        setInitializing(false);
      }
    }, 6000);

    // Listen for auth state changes AFTER initial auth is done
    // We use a flag to track if init is done to avoid race conditions
    let initDone = false;

    initializeAuth().then(() => {
      initDone = true;
      clearTimeout(safetyTimeout); // Clear safety timeout since we completed normally
      console.log('[AuthContext] initDone = true');
    }).catch(() => {
      clearTimeout(safetyTimeout);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;
        console.log('[AuthContext] Auth state change:', event, 'initDone:', initDone);

        // Skip events during initialization - initializeAuth handles the initial session
        if (!initDone && (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
          console.log('[AuthContext] Skipping', event, 'during init');
          return;
        }

        switch (event) {
          case 'SIGNED_OUT':
            setSession(null);
            setUser(null);
            setIsParentAccount(false);
            setLoading(false);
            setInitializing(false);
            setAppReady(false);
            break;
          case 'SIGNED_IN':
            if (newSession) {
              setSession(newSession);
              setUser(newSession.user);
              await checkAccountType(newSession.user.id);
            }
            setLoading(false);
            setInitializing(false);
            break;
          case 'TOKEN_REFRESHED':
            // Only update session, don't re-check account type
            if (newSession) {
              setSession(newSession);
              setUser(newSession.user);
            }
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
      clearTimeout(safetyTimeout);
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
    } catch (e) {
      console.log('[AuthContext] Sign out error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSetAppReady = useCallback((ready: boolean) => {
    console.log('[AuthContext] App ready:', ready);
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
