import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { request } from './api.js';

const AuthContext = createContext(null);

// The account token lives only in React memory: reloading the page signs the
// person out, and nothing is written to localStorage or sessionStorage.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { token, user, expiresAt }
  const [notice, setNotice] = useState('');
  const tokenRef = useRef(null);

  const endSession = useCallback((message = '') => {
    tokenRef.current = null;
    setSession(null);
    setNotice(message);
  }, []);

  const startSession = useCallback(data => {
    tokenRef.current = data.token;
    setNotice('');
    setSession({ token: data.token, user: data.user, expiresAt: data.expires_at });
  }, []);

  const token = session?.token ?? null;

  // Authenticated request helper. Its identity only changes with the token,
  // so polling effects can depend on it safely.
  const api = useCallback(async (path, options = {}) => {
    try {
      return await request(path, { ...options, token });
    } catch (error) {
      // Ignore a late 401 that belongs to an earlier session.
      if (error?.status === 401 && token && tokenRef.current === token) {
        endSession('Your session has ended. Please sign in again.');
      }
      throw error;
    }
  }, [token, endSession]);

  const login = useCallback(async (email, password) => {
    startSession(await request('/api/auth/login', { method: 'POST', body: { email, password } }));
  }, [startSession]);

  const register = useCallback(async (name, email, password) => {
    startSession(await request('/api/auth/register', { method: 'POST', body: { name, email, password } }));
  }, [startSession]);

  const logout = useCallback(async () => {
    const current = tokenRef.current;
    try {
      if (current) await request('/api/auth/logout', { method: 'POST', token: current });
    } catch {
      // The local session is cleared regardless; the server token expires on its own.
    }
    if (tokenRef.current === current) endSession('You have signed out.');
  }, [endSession]);

  // Sessions last 24 hours and cannot be refreshed.
  useEffect(() => {
    if (!session) return undefined;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (!Number.isFinite(remaining)) return undefined;
    const timer = setTimeout(
      () => endSession('Your session has ended. Please sign in again.'),
      Math.max(0, Math.min(remaining, 2_000_000_000)),
    );
    return () => clearTimeout(timer);
  }, [session, endSession]);

  const value = useMemo(
    () => ({ user: session?.user ?? null, api, login, register, logout, notice }),
    [session, api, login, register, logout, notice],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
