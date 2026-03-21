/**
 * useHistory.js
 * Custom hook for tracking H.E.X.A. picks and results.
 *
 * When the user is authenticated: persists via PostgreSQL (/api/picks).
 * When not authenticated: falls back to localStorage for anonymous sessions.
 *
 * Entry shape (both sources normalised to the same object):
 *   {
 *     id:         number   (DB serial id, or Date.now() for localStorage)
 *     date:       string   (ISO — created_at from DB, or local timestamp)
 *     matchup:    string   ("Away @ Home" | "N-Leg Parlay" | "Full Day — YYYY-MM-DD")
 *     mode:       string   ("single" | "parlay" | "fullday")
 *     pick:       string   (master pick text)
 *     confidence: number   (0-100)
 *     result:     string   ("pending" | "win" | "loss")
 *   }
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../store/authStore';

const STORAGE_KEY = 'hexa_history';
const MAX_ENTRIES = 200;

// ── localStorage helpers (anonymous fallback) ─────────────────────────────────

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(entries) {
  if (!Array.isArray(entries)) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or unavailable — ignore
  }
}

// ── Payload extraction helpers ────────────────────────────────────────────────

function extractMatchup(payload) {
  const mode  = payload.type ?? 'single';
  const games = payload.games ?? [];

  if (mode === 'single' && games.length > 0) {
    const g    = games[0];
    const away = g?.teams?.away?.name ?? 'Away';
    const home = g?.teams?.home?.name ?? 'Home';
    return `${away} @ ${home}`;
  }

  if (mode === 'parlay') {
    return `${games.length}-Leg Parlay`;
  }

  const date = (payload.date ?? new Date().toISOString()).split('T')[0];
  return `Full Day — ${date}`;
}

function extractPickAndConfidence(hexaData) {
  if (!hexaData) return { pick: '', confidence: 0 };

  if (hexaData.master_prediction) {
    const mp   = hexaData.master_prediction;
    const conf = Math.min(100, Math.max(0, Number(mp.oracle_confidence) || 0));
    return { pick: mp.pick ?? '', confidence: conf };
  }

  if (hexaData.parlay) {
    const p    = hexaData.parlay;
    const legs = p.legs ?? [];
    const pick = legs.map(l => l.pick).filter(Boolean).join(' ＋ ');
    const raw  = Number(p.combined_confidence) || 0;
    const conf = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
    return { pick: pick || `${legs.length} legs`, confidence: conf };
  }

  if (hexaData.games) {
    return { pick: `${hexaData.games.length} games`, confidence: 0 };
  }

  return { pick: '', confidence: 0 };
}

// ── DB row → frontend entry ───────────────────────────────────────────────────

function dbRowToEntry(row) {
  return {
    id:         row.id,
    date:       row.created_at,
    matchup:    row.matchup,
    mode:       row.type,
    pick:       row.pick,
    confidence: row.oracle_confidence ?? 0,
    result:     row.result ?? 'pending',
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useHistory() {
  const { token, isAuthenticated } = useAuth();
  const [history, setHistory] = useState([]);

  // Load history on mount / when auth state changes
  useEffect(() => {
    if (!isAuthenticated || !token) {
      setHistory(load());
      return;
    }

    fetch('/api/picks', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (json.success) setHistory(json.data.map(dbRowToEntry));
      })
      .catch(() => {});
  }, [token, isAuthenticated]);

  // ── addPick ────────────────────────────────────────────────────────────────

  async function addPick(payload) {
    const hexaData             = payload?.result ?? null;
    const { pick, confidence } = extractPickAndConfidence(hexaData);
    const matchup              = extractMatchup(payload);

    if (!isAuthenticated || !token) {
      // Anonymous: persist to localStorage
      const entry = {
        id:         Date.now(),
        date:       payload.date ?? new Date().toISOString(),
        matchup,
        mode:       payload.type ?? 'single',
        pick,
        confidence,
        result:     'pending',
      };
      setHistory(prev => {
        const next = [entry, ...prev].slice(0, MAX_ENTRIES);
        save(next);
        return next;
      });
      return;
    }

    // Authenticated: POST to API
    const mp = hexaData?.master_prediction ?? {};
    const body = {
      type:              payload.type ?? 'single',
      matchup,
      pick,
      oracle_confidence: confidence,
      bet_value:         mp.bet_value ?? null,
      model_risk:        mp.model_risk ?? mp.risk ?? null,
      oracle_report:     mp.oracle_report ?? null,
      hexa_hunch:        mp.hexa_hunch ?? null,
      alert_flags:       mp.alert_flags ?? [],
      probability_model: mp.probability_model ?? hexaData?.probability_model ?? {},
      best_pick:         mp.best_pick ?? {},
      model:             payload.model ?? null,
      language:          payload.language ?? 'en',
    };

    try {
      const res  = await fetch('/api/picks', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        setHistory(prev => [dbRowToEntry(json.data), ...prev]);
      } else {
        console.error('[useHistory] POST /api/picks failed:', json);
      }
    } catch (err) {
      console.error('[useHistory] addPick network error:', err);
    }
  }

  // ── markResult ─────────────────────────────────────────────────────────────

  async function markResult(id, outcome) {
    if (!isAuthenticated || !token) {
      setHistory(prev => {
        const next = prev.map(e => e.id === id ? { ...e, result: outcome } : e);
        save(next);
        return next;
      });
      return;
    }

    try {
      const res  = await fetch(`/api/picks/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ result: outcome }),
      });
      const json = await res.json();
      if (json.success) {
        setHistory(prev => prev.map(e => e.id === id ? { ...e, result: outcome } : e));
      }
    } catch {
      // ignore
    }
  }

  // ── clearHistory ───────────────────────────────────────────────────────────

  function clearHistory() {
    setHistory([]);
    if (!isAuthenticated) save([]);
  }

  // ── getStats ───────────────────────────────────────────────────────────────

  function getStats() {
    const total    = history.length;
    const wins     = history.filter(e => e.result === 'win').length;
    const losses   = history.filter(e => e.result === 'loss').length;
    const pending  = history.filter(e => e.result === 'pending').length;
    const resolved = wins + losses;
    const winRate  = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;
    return { total, wins, losses, pending, winRate };
  }

  return { history, addPick, markResult, clearHistory, getStats };
}
