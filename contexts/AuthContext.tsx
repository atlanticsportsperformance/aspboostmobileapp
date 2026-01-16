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
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [isParentAccount, setIsParentAccount] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const appState = useRef(AppState.currentState);
  const isRefreshing = useRef(false);
  const lastBackgroundTime = useRef<number | null>(null);

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
    if (isRefreshing.current) {
      console.log('[AuthContext] Already refreshing, skipping');
      return;
    }
    isRefreshing.current = true;
    console.log('[AuthContext] Starting session refresh...');

    try {
      // ALWAYS try to refresh the token first when coming back from background
      // This is the key fix - don't just getSession, actively refresh it
      console.log('[AuthContext] Attempting token refresh...');
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError) {
        console.log('[AuthContext] Refresh error:', refreshError.message);

        // Only clear session if it's truly an auth error, not a network error
        if (refreshError.message?.includes('network') ||
            refreshError.message?.includes('fetch') ||
            refreshError.message?.includes('timeout')) {
          console.log('[AuthContext] Network error during refresh, keeping existing session');
          // Keep existing session on network errors
          if (session) {
            setAppReady(true);
          }
          return;
        }

        // Check if we still have a valid session despite refresh error
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession) {
          const expiresAt = currentSession.expires_at || 0;
          const now = Math.floor(Date.now() / 1000);
          if (expiresAt > now) {
            console.log('[AuthContext] Session still valid despite refresh error, keeping it');
            setSession(currentSession);
            setUser(currentSession.user);
            setAppReady(true);
            return;
          }
        }

        // Session truly expired and can't refresh
        console.log('[AuthContext] Session expired and refresh failed');
        // DON'T clear session here - let the user stay on their current screen
        // They'll get auth errors when they try to do things, which is better than being kicked out
        setAppReady(true);
        return;
      }

      if (refreshData.session) {
        console.log('[AuthContext] Token refreshed successfully');
        setSession(refreshData.session);
        setUser(refreshData.session.user);
        // Check account type in background, don't block
        checkAccountType(refreshData.session.user.id).catch(() => {});
        setAppReady(true);
      } else {
        console.log('[AuthContext] No session after refresh');
        // No session - user needs to log in
        setSession(null);
        setUser(null);
        setIsParentAccount(false);
      }
    } catch (e: any) {
      console.log('[AuthContext] Refresh exception:', e?.message || e);
      // On any error, keep existing state and ensure app is ready
      if (session) {
        setAppReady(true);
      }
    } finally {
      isRefreshing.current = false;
    }
  }, [session]);

  // Handle app state changes (foreground/background)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // Track when app goes to background
      if (nextAppState.match(/inactive|background/)) {
        lastBackgroundTime.current = Date.now();
        console.log('[AuthContext] App going to background');
      }

      // When app comes to foreground
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        const backgroundDuration = lastBackgroundTime.current
          ? Date.now() - lastBackgroundTime.current
          : 0;
        console.log('[AuthContext] App foregrounded after', Math.round(backgroundDuration / 1000), 'seconds');

        // Always refresh session when coming back to foreground
        // This ensures we have a fresh token
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

        // Try to get existing session
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();

        if (error) {
          console.log('[AuthContext] getSession error:', error.message);
        }

        if (mounted) {
          if (initialSession) {
            console.log('[AuthContext] Found existing session for user:', initialSession.user.id);
            setSession(initialSession);
            setUser(initialSession.user);

            // Check account type - don't await, do in background
            checkAccountType(initialSession.user.id).catch(e => {
              console.log('[AuthContext] checkAccountType error (non-blocking):', e);
            });

            console.log('[AuthContext] Init complete with session');
          } else {
            console.log('[AuthContext] No existing session');
          }
          setLoading(false);
          setInitializing(false);
          console.log('[AuthContext] Initialization complete');
        }
      } catch (e) {
        console.log('[AuthContext] Init error:', e);
        if (mounted) {
          setLoading(false);
          setInitializing(false);
        }
      }
    };

    // Safety timeout - force initialization complete after 5 seconds
    const safetyTimeout = setTimeout(() => {
      if (mounted && initializing) {
        console.warn('[AuthContext] Safety timeout - forcing initializing=false');
        setLoading(false);
        setInitializing(false);
      }
    }, 5000);

    initializeAuth().then(() => {
      clearTimeout(safetyTimeout);
    }).catch(() => {
      clearTimeout(safetyTimeout);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;
        console.log('[AuthContext] Auth state change:', event);

        // Handle different events
        switch (event) {
          case 'SIGNED_OUT':
            console.log('[AuthContext] User signed out');
            setSession(null);
            setUser(null);
            setIsParentAccount(false);
            setLoading(false);
            setAppReady(false);
            break;

          case 'SIGNED_IN':
            console.log('[AuthContext] User signed in');
            if (newSession) {
              setSession(newSession);
              setUser(newSession.user);
              await checkAccountType(newSession.user.id);
            }
            setLoading(false);
            setInitializing(false);
            break;

          case 'TOKEN_REFRESHED':
            console.log('[AuthContext] Token refreshed');
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

          case 'INITIAL_SESSION':
            // Already handled in initializeAuth
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
      console.log('[AuthContext] Signing in...');

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.log('[AuthContext] Sign in error:', error.message);
        setLoading(false);
        return { error: error as Error };
      }

      if (data.session) {
        console.log('[AuthContext] Sign in successful');
        setSession(data.session);
        setUser(data.session.user);
        await checkAccountType(data.session.user.id);
      }

      setLoading(false);
      return { error: null };
    } catch (error) {
      console.log('[AuthContext] Sign in exception:', error);
      setLoading(false);
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      setAppReady(false);
      console.log('[AuthContext] Signing out...');
      await supabase.auth.signOut();
    } catch (e) {
      console.log('[AuthContext] Sign out error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSetAppReady = useCallback((ready: boolean) => {
    console.log('[AuthContext] setAppReady:', ready);
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
