import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isParentAccount, setIsParentAccount] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    // FAILSAFE: No matter what, we're ready in 5 seconds
    const failsafe = setTimeout(() => {
      if (mounted && !isReady) {
        console.log('[Auth] FAILSAFE triggered - forcing ready state');
        setIsReady(true);
      }
    }, 5000);

    // Single initialization - let Supabase do everything
    const init = async () => {
      try {
        // This is the ONLY way to get session - let Supabase handle storage
        const { data: { session: currentSession } } = await supabase.auth.getSession();

        if (!mounted) return;

        if (currentSession) {
          setSession(currentSession);
          setUser(currentSession.user);

          // Check account type (non-blocking)
          supabase
            .from('profiles')
            .select('account_type')
            .eq('id', currentSession.user.id)
            .single()
            .then(({ data }) => {
              if (mounted && data) {
                setIsParentAccount(data.account_type === 'parent');
              }
            });
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

    // Listen for auth changes - this is the source of truth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      console.log('[Auth] State change:', event);

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setIsParentAccount(false);
      } else if (newSession) {
        setSession(newSession);
        setUser(newSession.user);

        if (event === 'SIGNED_IN') {
          supabase
            .from('profiles')
            .select('account_type')
            .eq('id', newSession.user.id)
            .single()
            .then(({ data }) => {
              if (mounted && data) {
                setIsParentAccount(data.account_type === 'parent');
              }
            });
        }
      }

      // Always mark ready on any auth event
      if (!isReady) setIsReady(true);
    });

    // Refresh on foreground
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.getSession().catch(() => {});
      }
    });

    return () => {
      mounted = false;
      clearTimeout(failsafe);
      subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

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

  // Backwards compatibility - map new names to old names
  return {
    ...context,
    loading: !context.isReady,
    initializing: !context.isReady,
    appReady: context.isReady,
    setAppReady: () => {},
    refreshSession: async () => {},
  };
}
