/**
 * useHistory.js
 * Custom hook for tracking H.E.X.A. picks and results via localStorage.
 *
 * Entry shape:
 *   {
 *     id:         number   (Date.now())
 *     date:       string   (ISO)
 *     matchup:    string   ("Away @ Home" or "N-Leg Parlay" or "Full Day — YYYY-MM-DD")
 *     mode:       string   ("single" | "parlay" | "fullday")
 *     pick:       string   (master pick text extracted from HEXA JSON)
 *     confidence: number   (0-100)
 *     result:     string   ("pending" | "win" | "loss")
 *     fullData:   object   (the raw onSave payload from AnalysisPanel)
 *   }
 */

import { useState } from 'react';

const STORAGE_KEY  = 'hexa_history';
const MAX_ENTRIES  = 200;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(entries) {
  if (!Array.isArray(entries)) return; // guard against accidental function call
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or unavailable — ignore
  }
}

/**
 * Extracts a human-readable matchup string from the raw AnalysisPanel onSave payload.
 * payload = { type, games, result: { data: hexaJSON, ... }, date }
 */
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

  // fullday
  const date = (payload.date ?? new Date().toISOString()).split('T')[0];
  return `Full Day — ${date}`;
}

/**
 * Extracts the master pick text and confidence (0-100) from HEXA JSON.
 * hexaData = the `data.data` field from the oracle response.
 */
function extractPickAndConfidence(hexaData) {
  if (!hexaData) return { pick: '', confidence: 0 };

  // Single game
  if (hexaData.master_prediction) {
    const mp   = hexaData.master_prediction;
    const conf = Math.min(100, Math.max(0, Number(mp.oracle_confidence) || 0));
    return { pick: mp.pick ?? '', confidence: conf };
  }

  // Parlay
  if (hexaData.parlay) {
    const p    = hexaData.parlay;
    const legs = p.legs ?? [];
    const pick = legs.map(l => l.pick).filter(Boolean).join(' ＋ ');
    const raw  = Number(p.combined_confidence) || 0;
    const conf = raw <= 1 ? Math.round(raw * 100) : Math.round(raw);
    return { pick: pick || `${legs.length} legs`, confidence: conf };
  }

  // Full day
  if (hexaData.games) {
    return { pick: `${hexaData.games.length} games`, confidence: 0 };
  }

  return { pick: '', confidence: 0 };
}

export default function useHistory() {
  const [history, setHistory] = useState(load);

  /**
   * Atomically update state and persist to localStorage in one step.
   * Accepts a plain array OR an updater function (prev => next), matching
   * React's setState signature. The computed next array is saved to storage.
   */
  function _commit(updater) {
    setHistory(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      save(next); // persist inside the updater so we always have the final value
      return next;
    });
  }

  /**
   * Add a new pick from an AnalysisPanel onSave payload.
   * Normalises raw payload into a structured entry.
   */
  function addPick(payload) {
    const hexaData                = payload?.result ?? null;
    const { pick, confidence }    = extractPickAndConfidence(hexaData);
    const matchup                 = extractMatchup(payload);

    const entry = {
      id:         Date.now(),
      date:       payload.date ?? new Date().toISOString(),
      matchup,
      mode:       payload.type ?? 'single',
      pick,
      confidence,
      result:     'pending',
      fullData:   payload,
    };

    _commit(prev => [entry, ...prev].slice(0, MAX_ENTRIES));
  }

  /**
   * Update the outcome of a pick by id.
   * outcome: "win" | "loss"
   */
  function markResult(id, outcome) {
    _commit(prev =>
      prev.map(e => e.id === id ? { ...e, result: outcome } : e)
    );
  }

  /** Delete all history entries. */
  function clearHistory() {
    _commit([]);
  }

  /**
   * Returns aggregate stats over the current history.
   * winRate is based only on resolved picks (wins + losses).
   */
  function getStats() {
    const total   = history.length;
    const wins    = history.filter(e => e.result === 'win').length;
    const losses  = history.filter(e => e.result === 'loss').length;
    const pending = history.filter(e => e.result === 'pending').length;
    const resolved = wins + losses;
    const winRate  = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;
    return { total, wins, losses, pending, winRate };
  }

  return { history, addPick, markResult, clearHistory, getStats };
}
