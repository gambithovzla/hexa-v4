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

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const AuthContext = createContext(null);

const TOKEN_KEY          = 'hexa_token';
const API_URL            = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const INACTIVITY_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const WARN_BEFORE        = 2 * 60 * 1000;       // warn 2 min before logout
const ACTIVITY_EVENTS    = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

export function AuthProvider({ children }) {
  const [user,            setUser]            = useState(null);
  const [token,           setToken]           = useState(() => localStorage.getItem(TOKEN_KEY));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading,       setIsLoading]       = useState(true);
  const [sessionWarning,  setSessionWarning]  = useState(false);
  const inactivityTimer = useRef(null);
  const warningTimer    = useRef(null);

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
  const logout = useCallback(function logout() {
    clearTimeout(inactivityTimer.current);
    clearTimeout(warningTimer.current);
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    setSessionWarning(false);
  }, []);

  // ── inactivity timer — resets on any user interaction ────────────────────
  const resetInactivityTimer = useCallback(() => {
    clearTimeout(inactivityTimer.current);
    clearTimeout(warningTimer.current);
    setSessionWarning(false);
    warningTimer.current = setTimeout(() => setSessionWarning(true), INACTIVITY_TIMEOUT - WARN_BEFORE);
    inactivityTimer.current = setTimeout(() => logout(), INACTIVITY_TIMEOUT);
  }, [logout]);

  useEffect(() => {
    if (!isAuthenticated) {
      clearTimeout(inactivityTimer.current);
      clearTimeout(warningTimer.current);
      setSessionWarning(false);
      return;
    }
    resetInactivityTimer();
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, resetInactivityTimer, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, resetInactivityTimer));
      clearTimeout(inactivityTimer.current);
      clearTimeout(warningTimer.current);
    };
  }, [isAuthenticated, resetInactivityTimer]);

  // ── updateCredits — called after a successful analysis ───────────────────
  function updateCredits(credits) {
    setUser(prev => prev ? { ...prev, credits } : prev);
  }

  // ── verifyEmail — submit 6-digit code ─────────────────────────────────────
  async function verifyEmail(code) {
    const t = token ?? localStorage.getItem(TOKEN_KEY);
    const res = await fetch(`${API_URL}/api/auth/verify-email`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body:    JSON.stringify({ code }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? 'Verification failed');
    setUser(prev => prev ? { ...prev, email_verified: true } : prev);
    return true;
  }

  // ── resendCode — request a new verification code ──────────────────────────
  async function resendCode() {
    const t = token ?? localStorage.getItem(TOKEN_KEY);
    const res = await fetch(`${API_URL}/api/auth/resend-code`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${t}` },
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to resend code');
    return true;
  }

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated, isLoading, sessionWarning, login, register, logout, checkAuth, updateCredits, verifyEmail, resendCode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
