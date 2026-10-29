import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSupabase } from '../lib/supabase';
import { isMockMode } from '../lib/config';
import type { Session, User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  loading: boolean;
  isMock: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const MOCK_SESSION_KEY = 'vr_mock_session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const isMock = isMockMode();

  useEffect(() => {
    if (isMock) {
      setUser(localStorage.getItem(MOCK_SESSION_KEY) ? ({ id: 'mock-admin-user', email: 'mock@admin' } as unknown as User) : null);
      setLoading(false);
      return;
    }
    const sb = getSupabase();
    void sb.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [isMock]);

  async function signIn(email: string, password: string) {
    if (isMock) {
      // Mock: будь-які значення дають вхід (демо). Це НЕ реальна автентификація.
      localStorage.setItem(MOCK_SESSION_KEY, '1');
      setUser({ id: 'mock-admin-user', email } as unknown as User);
      return;
    }
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    if (isMock) {
      localStorage.removeItem(MOCK_SESSION_KEY);
      setUser(null);
      return;
    }
    await getSupabase().auth.signOut();
  }

  return <AuthContext.Provider value={{ user, loading, isMock, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth має використовуватися всередині <AuthProvider>.');
  return ctx;
}

export type { Session };
