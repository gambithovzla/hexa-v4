/**
 * authStore.js — React Context for JWT auth in H.E.X.A. V4
 *
 * Provides:
 *   AuthProvider  — wraps the app; restores session on mount via checkAuth()
 *   useAuth()     — hook returning { user, token, isAuthenticated, isLoading,
 *                                    login, register, logout, updateCredits }
 *
 * Token is persisted in localStorage under 'hexa_token'.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY = 'hexa_token';
const API_URL   = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function AuthProvider({ children }) {
  const [user,            setUser]            = useState(null);
  const [token,           setToken]           = useState(() => localStorage.getItem(TOKEN_KEY));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading,       setIsLoading]       = useState(true);

  // ── Verify stored token on mount ──────────────────────────────────────────
  const checkAuth = useCallback(async (currentToken) => {
    const t = currentToken ?? localStorage.getItem(TOKEN_KEY);
    if (!t) {
      setIsLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const json = await res.json();
        setUser(json.user);
        setToken(t);
        setIsAuthenticated(true);
      } else {
        // Token invalid/expired — clear it
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch {
      // Network error — keep token, don't force logout
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  // ── login ─────────────────────────────────────────────────────────────────
  async function login(email, password) {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Login failed');

    localStorage.setItem(TOKEN_KEY, json.token);
    setToken(json.token);
    setUser(json.user);
    setIsAuthenticated(true);
    return json.user;
  }

  // ── register ──────────────────────────────────────────────────────────────
  async function register(email, password) {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Registration failed');

    localStorage.setItem(TOKEN_KEY, json.token);
    setToken(json.token);
    setUser(json.user);
    setIsAuthenticated(true);
    return json.user;
  }

  // ── logout ────────────────────────────────────────────────────────────────
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  }

  // ── updateCredits — called after a successful analysis ───────────────────
  function updateCredits(credits) {
    setUser(prev => prev ? { ...prev, credits } : prev);
  }

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated, isLoading, login, register, logout, checkAuth, updateCredits }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
