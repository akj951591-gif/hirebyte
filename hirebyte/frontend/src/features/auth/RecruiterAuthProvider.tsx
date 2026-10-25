import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, type SafeUser } from '@/api/client';
import { toApiError } from '@/api/client/useAsync';

export type RecruiterAuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: SafeUser }
  | { status: 'anonymous' }
  | { status: 'error'; error: ApiError };

interface RecruiterAuthContextValue {
  state: RecruiterAuthState;
  login: (email: string, password: string) => Promise<SafeUser>;
  /** Creates the account and signs it in. */
  register: (name: string, email: string, password: string) => Promise<SafeUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const RecruiterAuthContext = createContext<RecruiterAuthContextValue | null>(null);

/**
 * Recruiter identity comes from GET /auth/me; the session itself is an HttpOnly cookie the
 * frontend never reads. Route guards built on this are UX only — the API enforces access.
 */
export function RecruiterAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RecruiterAuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const { user } = await api.auth.me();
      setState({ status: 'authenticated', user });
    } catch (err) {
      const error = toApiError(err);
      if (error.status === 401 || error.code === 'UNAUTHENTICATED') setState({ status: 'anonymous' });
      else setState({ status: 'error', error });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.auth.recruiterLogin({ email, password });
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const { user } = await api.auth.recruiterRegister({ name, email, password });
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.recruiterLogout();
    } finally {
      setState({ status: 'anonymous' });
    }
  }, []);

  const value = useMemo(() => ({ state, login, register, logout, refresh }), [state, login, register, logout, refresh]);
  return <RecruiterAuthContext.Provider value={value}>{children}</RecruiterAuthContext.Provider>;
}

export function useRecruiterAuth(): RecruiterAuthContextValue {
  const ctx = useContext(RecruiterAuthContext);
  if (!ctx) throw new Error('useRecruiterAuth must be used inside <RecruiterAuthProvider>');
  return ctx;
}
