/**
 * useParlayArchitectHistory
 *
 * Persists Parlay Architect runs. When a token is provided it fetches the
 * user's history from the server on mount (cross-device sync) and falls back
 * to localStorage for unauthenticated sessions.
 *
 * Entry shape:
 *   {
 *     id:                  string|number  ('db_N' for server rows, Date.now() for local)
 *     created_at:          string  (ISO)
 *     date:                string  (YYYY-MM-DD game date)
 *     mode:                string
 *     requested_legs:      number
 *     actual_legs:         number
 *     game_ids:            number[]
 *     synergy_type:        string | null
 *     synergy_thesis:      string | null
 *     combined_probability: number | null
 *     combined_decimal_odds: number | null
 *     combined_edge_score: number | null
 *     legs:                object[]
 *     warnings:            string[]
 *     result:              'pending' | 'win' | 'loss' | 'push'
 *     legs_hit:            number | null
 *     _fallback:           boolean
 *     _source:             'server' | 'local'
 *   }
 */

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'hexa_synergy_history';
const MAX_ENTRIES = 150;
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota exceeded — ignore
  }
}

export default function useParlayArchitectHistory(token) {
  const [history, setHistory] = useState(() => load());

  // On mount (or when token changes): fetch server history and merge
  useEffect(() => {
    if (!token) return;

    fetch(`${API_URL}/api/parlay-architect/history`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (!json.success) return;
        const serverEntries = json.data ?? [];
        // Merge: server entries take priority (by db_id dedup), keep local-only entries
        const serverIds = new Set(serverEntries.map(e => e.db_id));
        const localOnly = load().filter(e => !e.db_id || !serverIds.has(e.db_id));
        const merged = [...serverEntries, ...localOnly]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, MAX_ENTRIES);
        persist(merged);
        setHistory(merged);
      })
      .catch(() => {
        // server unreachable — keep localStorage as-is
      });
  }, [token]);

  const addRun = useCallback(({ date, mode, requestedLegs, gameIds, result, architect_meta }) => {
    const chosen = result?.chosen_parlay ?? {};
    const actualLegs = Number(chosen.actual_legs)
      || (Array.isArray(chosen.legs) ? chosen.legs.length : 0)
      || Number(result?.composer_meta?.built_legs)
      || requestedLegs;
    const entry = {
      id:                    Date.now(),
      created_at:            new Date().toISOString(),
      date:                  date ?? new Date().toISOString().slice(0, 10),
      mode,
      requested_legs:        requestedLegs,
      actual_legs:           actualLegs,
      game_ids:              gameIds ?? [],
      synergy_type:          chosen.synergy_type ?? null,
      synergy_thesis:        chosen.synergy_thesis ?? null,
      combined_probability:  chosen.combined_probability ?? null,
      combined_decimal_odds: chosen.combined_decimal_odds ?? null,
      combined_edge_score:   chosen.combined_edge_score ?? null,
      legs:                  chosen.legs ?? [],
      warnings:              chosen.warnings ?? [],
      result:                'pending',
      legs_hit:              null,
      _fallback:             architect_meta?._fallback ?? false,
      _source:               'local',
    };
    setHistory(prev => {
      const next = [entry, ...prev].slice(0, MAX_ENTRIES);
      persist(next);
      return next;
    });
    return entry.id;
  }, []);

  const markResult = useCallback((id, outcome, legsHit = null) => {
    setHistory(prev => {
      const next = prev.map(e =>
        e.id === id ? { ...e, result: outcome, legs_hit: legsHit ?? e.legs_hit } : e
      );
      persist(next);
      return next;
    });
  }, []);

  // Server-side auto-resolution. Only works for entries persisted on the
  // server (id like "db_N"); local-only runs are ignored. Returns the
  // server's verdict so the caller can show a toast/inline message.
  const autoResolve = useCallback(async (id) => {
    if (!token) return { ok: false, reason: 'not authenticated' };
    const dbId = typeof id === 'string' && id.startsWith('db_') ? Number(id.slice(3)) : null;
    if (!dbId) return { ok: false, reason: 'local-only run — cannot auto-resolve' };

    try {
      const res = await fetch(`${API_URL}/api/parlay-architect/${dbId}/auto-resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { ok: false, reason: json.error || `HTTP ${res.status}` };
      }
      const out = json.data;
      setHistory(prev => {
        const next = prev.map(e => {
          if (e.id !== id) return e;
          const resolved = out.status !== 'pending';
          return {
            ...e,
            leg_results: out.legResults,
            actual_legs: out.totalLegs || e.actual_legs,
            legs_hit:    out.legsHit,
            result:      resolved ? out.status : e.result,
          };
        });
        persist(next);
        return next;
      });
      return { ok: true, data: out };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }, [token]);

  const deleteRun = useCallback((id) => {
    setHistory(prev => {
      const next = prev.filter(e => e.id !== id);
      persist(next);
      return next;
    });
  }, []);

  // Group by date descending
  const grouped = history.reduce((acc, entry) => {
    const d = entry.date ?? 'unknown';
    if (!acc[d]) acc[d] = [];
    acc[d].push(entry);
    return acc;
  }, {});

  const groupedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const stats = {
    total:    history.length,
    resolved: history.filter(e => e.result !== 'pending').length,
    wins:     history.filter(e => e.result === 'win').length,
    losses:   history.filter(e => e.result === 'loss').length,
  };
  const winRate = stats.wins + stats.losses > 0
    ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
    : null;

  return { history, grouped, groupedDates, stats, winRate, addRun, markResult, autoResolve, deleteRun };
}
