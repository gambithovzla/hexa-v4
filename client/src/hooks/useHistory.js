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
 *     date:       string   (game date when available, otherwise created_at)
 *     matchup:    string   ("Away @ Home" | "N-Leg Parlay" | "Full Day — YYYY-MM-DD")
 *     mode:       string   ("single" | "parlay" | "fullday")
 *     pick:       string   (master pick text)
 *     confidence: number   (0-100)
 *     result:     string   ("pending" | "win" | "loss")
 *   }
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../store/authStore';

const STORAGE_KEY = 'hexa_history';
const MAX_ENTRIES = 200;

function normalizePickResult(result) {
  const value = String(result ?? 'pending').toLowerCase();
  if (value === 'won') return 'win';
  if (value === 'lost') return 'loss';
  return value;
}

function normalizeEntry(entry) {
  return { ...entry, result: normalizePickResult(entry?.result) };
}

function extractDateOnly(value) {
  const match = String(value ?? '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function getEntryDisplayDate(gameDate, createdAt) {
  const normalizedGameDate = extractDateOnly(gameDate);
  const createdDateEt = createdAt
    ? new Date(createdAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    : null;

  if (normalizedGameDate && createdDateEt) {
    return normalizedGameDate > createdDateEt ? normalizedGameDate : createdDateEt;
  }
  return normalizedGameDate ?? createdDateEt ?? extractDateOnly(createdAt) ?? null;
}

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
  // Direct override from safe_multi or batch scan
  if (payload._matchupOverride) return payload._matchupOverride;

  const mode  = payload.type ?? 'single';
  const games = payload.games ?? [];

  if ((mode === 'single' || mode === 'safe') && games.length > 0) {
    const g    = games[0];
    const away = g?.teams?.away?.abbreviation ?? g?.teams?.away?.name ?? 'Away';
    const home = g?.teams?.home?.abbreviation ?? g?.teams?.home?.name ?? 'Home';
    return `${away} @ ${home}`;
  }

  if (mode === 'parlay') {
    const gameNames = games.map(g => {
      const away = g?.teams?.away?.abbreviation ?? g?.teams?.away?.name ?? '';
      const home = g?.teams?.home?.abbreviation ?? g?.teams?.home?.name ?? '';
      return away && home ? `${away}@${home}` : '';
    }).filter(Boolean);
    return gameNames.length > 0
      ? `Parlay: ${gameNames.join(', ')}`
      : `${games.length}-Leg Parlay`;
  }

  const date = (payload.date ?? new Date().toISOString()).split('T')[0];
  return `Full Day — ${date}`;
}

function extractPickAndConfidence(hexaData) {
  if (!hexaData) return { pick: '', confidence: 0 };

  if (hexaData.safe_pick) {
    const sp   = hexaData.safe_pick;
    const conf = Math.min(100, Math.max(0, Number(sp.hit_probability) || 0));
    return { pick: sp.pick ?? '', confidence: conf };
  }

  if (hexaData.master_prediction) {
    const mp   = hexaData.master_prediction;
    const conf = Math.min(100, Math.max(0, Number(mp.oracle_confidence) || 0));
    return { pick: mp.pick ?? '', confidence: conf };
  }

  if (hexaData.parlay) {
    const p    = hexaData.parlay;
    const legs = p.legs ?? [];
    const pick = legs.map(l => {
      const game = l.game ?? l.matchup ?? '';
      const pickText = l.pick ?? '';
      // Include game name with pick so history shows which game each pick belongs to
      return game ? `${game}: ${pickText}` : pickText;
    }).filter(Boolean).join(' ＋ ');
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
  const gameDate = row.game_date ?? null;
  const createdAt = row.created_at ?? null;
  return {
    id:                   row.id,
    date:                 getEntryDisplayDate(gameDate, createdAt),
    createdAt,
    matchup:              row.matchup,
    mode:                 row.type,
    pick:                 row.pick,
    confidence:           row.oracle_confidence ?? 0,
    result:               normalizePickResult(row.result),
    kelly_recommendation: row.kelly_recommendation ?? null,
    oracle_report:        row.oracle_report ?? null,
    postmortem:           row.postmortem ?? null,
    postmortem_summary:   row.postmortem_summary ?? null,
    postmortem_generated_at: row.postmortem_generated_at ?? null,
    gamePk:               row.game_pk ?? null,
    gameDate,
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export default function useHistory() {
  const { token, isAuthenticated } = useAuth();
  const [history, setHistory] = useState([]);

  // Load history on mount / when auth state changes
  const loadHistory = useCallback(() => {
    if (!isAuthenticated || !token) {
      setHistory(load().map(normalizeEntry));
      return;
    }

    fetch(`${import.meta.env.VITE_API_URL}/api/picks`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (json.success) setHistory(json.data.map(dbRowToEntry));
      })
      .catch(() => {});
  }, [token, isAuthenticated]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ── addPick ────────────────────────────────────────────────────────────────

  async function addPick(payload) {
    const hexaData             = payload?.result ?? null;
    const { pick, confidence } = extractPickAndConfidence(hexaData);
    const matchup              = extractMatchup(payload);

    const isSafe = !!hexaData?.safe_pick;

    if (!isAuthenticated || !token) {
      const createdAt = payload.date ?? new Date().toISOString();
      const gameDate = payload.gameDate ?? payload.selectedDate ?? null;
      // Anonymous: persist to localStorage
      const entry = {
        id:         Date.now(),
        date:       getEntryDisplayDate(gameDate, createdAt),
        createdAt,
        gameDate,
        matchup,
        mode:       isSafe ? 'safe' : (payload.type ?? 'single'),
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
    const sp = hexaData?.safe_pick ?? null;

    // Extract odds for the pick
    let oddsAtPick = null;
    let oddsDetails = null;
    const oddsData = payload.odds;
    if (oddsData) {
      const pickLower = (pick ?? '').toLowerCase();
      const odds = oddsData.odds ?? oddsData;
      const ml = odds.moneyline;
      const rl = odds.runLine;
      const ou = odds.overUnder;

      if (pickLower.includes('over') && ou?.overPrice) {
        oddsAtPick = ou.overPrice;
      } else if (pickLower.includes('under') && ou?.underPrice) {
        oddsAtPick = ou.underPrice;
      } else if (pickLower.includes('run line') || pickLower.includes('línea')) {
        oddsAtPick = rl?.home?.price ?? rl?.away?.price ?? null;
      } else if (ml) {
        // Moneyline: determine home vs away from matchup
        const awayName = (payload.games?.[0]?.teams?.away?.name ?? '').toLowerCase();
        if (pickLower.includes(awayName.split(' ').pop())) {
          oddsAtPick = ml.away;
        } else {
          oddsAtPick = ml.home;
        }
      }
      oddsDetails = oddsData;
    }

    const featureGame = payload.games?.length === 1 ? payload.games[0] : null;

    const body = {
      type:              isSafe ? 'safe' : (payload.type ?? 'single'),
      matchup,
      pick,
      oracle_confidence: confidence,
      bet_value:         mp.bet_value ?? null,
      model_risk:        mp.model_risk ?? mp.risk ?? (sp ? hexaData.model_risk : null) ?? null,
      oracle_report:     mp.oracle_report ?? (sp ? sp.reasoning : null) ?? null,
      hexa_hunch:        mp.hexa_hunch ?? null,
      alert_flags:       mp.alert_flags ?? hexaData?.alert_flags ?? [],
      probability_model: mp.probability_model ?? hexaData?.probability_model ?? {},
      best_pick:         mp.best_pick ?? (sp ? { type: sp.type, detail: sp.pick, confidence: sp.hit_probability / 100 } : {}) ?? {},
      model:             payload.model ?? null,
      language:          payload.language ?? 'en',
      kelly_recommendation: hexaData?.kelly_recommendation ?? null,
      odds_at_pick:      oddsAtPick ?? null,
      odds_details:      oddsDetails ? JSON.stringify(oddsDetails) : null,
      game_pk:           payload.gamePk ?? featureGame?.gamePk ?? null,
      game_date:         payload.gameDate ?? payload.selectedDate ?? null,
    };

    try {
      const res  = await fetch(`${import.meta.env.VITE_API_URL}/api/picks`, {
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
    const normalizedOutcome = normalizePickResult(outcome);
    if (!isAuthenticated || !token) {
      setHistory(prev => {
        const next = prev.map(e => e.id === id ? { ...e, result: normalizedOutcome } : e);
        save(next);
        return next;
      });
      return;
    }

    try {
      const res  = await fetch(`${import.meta.env.VITE_API_URL}/api/picks/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ result: normalizedOutcome }),
      });
      const json = await res.json();
      if (json.success) {
        setHistory(prev => prev.map(e => e.id === id ? {
          ...e,
          result: normalizePickResult(json.data?.result ?? normalizedOutcome),
          postmortem: null,
          postmortem_summary: null,
          postmortem_generated_at: null,
        } : e));
      }
    } catch {
      // ignore
    }
  }

  // ── deletePick ─────────────────────────────────────────────────────────────

  async function deletePick(id) {
    if (!isAuthenticated || !token) {
      setHistory(prev => {
        const next = prev.filter(e => e.id !== id);
        save(next);
        return next;
      });
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/picks/${id}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setHistory(prev => prev.filter(e => e.id !== id));
      }
    } catch {
      // ignore network errors
    }
  }

  // ── clearHistory ───────────────────────────────────────────────────────────

  async function clearHistory() {
    if (!isAuthenticated || !token) {
      setHistory([]);
      save([]);
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/picks`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setHistory([]);
      }
    } catch {
      // ignore network errors
    }
  }

  async function requestPostmortem(id, { force = false, lang } = {}) {
    if (!isAuthenticated || !token) return null;

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/picks/${id}/postmortem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ force, lang }),
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Failed to generate postmortem');
      }

      const nextFields = {
        postmortem: json.data?.postmortem ?? null,
        postmortem_summary: json.data?.postmortem_summary ?? null,
        postmortem_generated_at: json.data?.postmortem_generated_at ?? null,
      };
      setHistory((prev) => prev.map((entry) => (
        entry.id === id ? { ...entry, ...nextFields } : entry
      )));
      return nextFields;
    } catch (err) {
      console.error('[useHistory] requestPostmortem error:', err);
      throw err;
    }
  }

  // ── getStats ───────────────────────────────────────────────────────────────

  function getStats() {
    const normalized = history.map(e => normalizePickResult(e.result));
    const total    = history.length;
    const wins     = normalized.filter(result => result === 'win').length;
    const losses   = normalized.filter(result => result === 'loss').length;
    const pushes   = normalized.filter(result => result === 'push').length;
    const pending  = normalized.filter(result => result === 'pending').length;
    const resolved = wins + losses; // pushes excluded from win rate
    const winRate  = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;
    return { total, wins, losses, pushes, pending, winRate };
  }

  return { history, addPick, markResult, deletePick, clearHistory, getStats, loadHistory, requestPostmortem };
}
