/**
 * useParlayArchitectHistory
 *
 * Persists Parlay Architect runs to localStorage under 'hexa_synergy_history'.
 * Each entry shape:
 *   {
 *     id:                  number  (Date.now())
 *     created_at:          string  (ISO)
 *     date:                string  (YYYY-MM-DD game date)
 *     mode:                string
 *     requested_legs:      number
 *     game_ids:            number[]
 *     synergy_type:        string | null
 *     synergy_thesis:      string | null
 *     combined_probability: number | null
 *     combined_decimal_odds: number | null
 *     combined_edge_score: number | null
 *     legs:                object[]  (full leg objects with reasoning)
 *     warnings:            string[]
 *     result:              'pending' | 'win' | 'loss' | 'push'
 *     legs_hit:            number | null
 *     _fallback:           boolean
 *   }
 */

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'hexa_synergy_history';
const MAX_ENTRIES = 150;

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

export default function useParlayArchitectHistory() {
  const [history, setHistory] = useState(() => load());

  const addRun = useCallback(({ date, mode, requestedLegs, gameIds, result, architect_meta }) => {
    const chosen = result?.chosen_parlay ?? {};
    const entry = {
      id:                    Date.now(),
      created_at:            new Date().toISOString(),
      date:                  date ?? new Date().toISOString().slice(0, 10),
      mode,
      requested_legs:        requestedLegs,
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

  return { history, grouped, groupedDates, stats, winRate, addRun, markResult, deleteRun };
}
