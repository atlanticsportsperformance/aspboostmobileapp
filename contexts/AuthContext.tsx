import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase, recreateSupabaseClient } from '../lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isParentAccount: boolean;
  isReady: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isParentAccount, setIsParentAccount] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Use refs to avoid dependency issues
  const mountedRef = useRef(true);
  const isRefreshingRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimestampRef = useRef<number | null>(null);

  // ONE-TIME initialization effect - no dependencies that change
  useEffect(() => {
    mountedRef.current = true;
    let initDone = false;

    const markReady = () => {
      if (!initDone && mountedRef.current) {
        initDone = true;
        setIsReady(true);
      }
    };

    // FAILSAFE: Always ready after 5 seconds
    const failsafe = setTimeout(markReady, 5000);

    const checkAccountType = async (userId: string) => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('account_type')
          .eq('id', userId)
          .single();
        if (data && mountedRef.current) {
          setIsParentAccount(data.account_type === 'parent');
        }
      } catch (e) {
        console.log('[Auth] checkAccountType error:', e);
      }
    };

    const refreshToken = async (): Promise<Session | null> => {
      if (isRefreshingRef.current) return null;
      isRefreshingRef.current = true;

      try {
        console.log('[Auth] Refreshing token...');
        const { data, error } = await supabase.auth.refreshSession();

        if (error || !data.session) {
          console.log('[Auth] Refresh failed:', error?.message);
          if (mountedRef.current) {
            setSession(null);
            setUser(null);
            setIsParentAccount(false);
          }
          return null;
        }

        console.log('[Auth] Token refreshed OK');
        if (mountedRef.current) {
          setSession(data.session);
          setUser(data.session.user);
        }
        return data.session;
      } catch (e) {
        console.log('[Auth] Refresh exception:', e);
        return null;
      } finally {
        isRefreshingRef.current = false;
      }
    };

    const isExpiredOrExpiring = (sess: Session | null): boolean => {
      if (!sess?.expires_at) return true;
      const now = Math.floor(Date.now() / 1000);
      return sess.expires_at - now < 300; // 5 minutes
    };

    // Initialize
    const init = async () => {
      try {
        console.log('[Auth] Init starting...');
        const { data: { session: stored } } = await supabase.auth.getSession();

        if (!mountedRef.current) return;

        if (stored) {
          console.log('[Auth] Found stored session, expires_at:', stored.expires_at, 'now:', Math.floor(Date.now() / 1000));

          if (isExpiredOrExpiring(stored)) {
            console.log('[Auth] Session expired/expiring, refreshing...');
            const refreshed = await refreshToken();
            if (refreshed) {
              checkAccountType(refreshed.user.id);
            }
          } else {
            console.log('[Auth] Session valid');
            setSession(stored);
            setUser(stored.user);
            checkAccountType(stored.user.id);
          }
        } else {
          console.log('[Auth] No stored session');
        }

        clearTimeout(failsafe);
        markReady();
      } catch (e) {
        console.log('[Auth] Init error:', e);
        clearTimeout(failsafe);
        markReady();
      }
    };

    init();

    // Auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mountedRef.current) return;
      console.log('[Auth] onAuthStateChange:', event);

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setIsParentAccount(false);
      } else if (newSession) {
        setSession(newSession);
        setUser(newSession.user);
        if (event === 'SIGNED_IN') {
          checkAccountType(newSession.user.id);
        }
      }

      markReady();
    });

    // App state listener - handle resume from background
    const handleAppState = async (nextState: AppStateStatus) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      const isGoingToBackground = nextState.match(/inactive|background/);

      // Track when app goes to background
      if (!wasBackground && isGoingToBackground) {
        backgroundTimestampRef.current = Date.now();
        console.log('[Auth] App going to background, timestamp saved');
      }

      appStateRef.current = nextState;

      if (wasBackground && nextState === 'active' && mountedRef.current) {
        console.log('[Auth] App resumed from background');

        // Check how long we were in background
        const backgroundTime = backgroundTimestampRef.current;
        const now = Date.now();
        const thirtyMinutes = 30 * 60 * 1000;

        if (backgroundTime && (now - backgroundTime) > thirtyMinutes) {
          // App was in background for > 30 minutes - recreate Supabase client
          console.log('[Auth] Was in background for', Math.round((now - backgroundTime) / 60000), 'minutes - recreating Supabase client');
          recreateSupabaseClient();
          // Pre-warm: force a network roundtrip so Dashboard queries don't pay TCP connection cost
          supabase.auth.refreshSession().catch(() => {});
        }

        backgroundTimestampRef.current = null;

        try {
          const { data: { session: current } } = await supabase.auth.getSession();

          if (current && isExpiredOrExpiring(current)) {
            console.log('[Auth] Token needs refresh on resume');
            // Timeout prevents indefinite hang if Supabase auth is slow
            await Promise.race([
              refreshToken(),
              new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Token refresh timeout')), 5000))
            ]).catch(() => {
              console.log('[Auth] Token refresh timed out, using existing session');
            });
          } else if (current && mountedRef.current) {
            // Update state even if not expired - ensures fresh reference
            setSession(current);
            setUser(current.user);
          }
        } catch (e) {
          console.log('[Auth] Resume check error:', e);
        }
      }
    };

    const appStateSub = AppState.addEventListener('change', handleAppState);

    return () => {
      mountedRef.current = false;
      clearTimeout(failsafe);
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []); // Empty deps - runs once

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
    <AuthContext.Provider value={{ session, user, isParentAccount, isReady, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return {
    ...context,
    loading: !context.isReady,
    initializing: !context.isReady,
    appReady: context.isReady,
    setAppReady: (_ready: boolean) => {},
    refreshSession: async () => {},
  };
}
