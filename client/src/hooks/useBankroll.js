/**
 * useBankroll.js — Custom hook for the H.E.X.A. Bankroll Tracker
 *
 * Exposes:
 *   bankrollData    — { initialBankroll, currentBankroll, bets }
 *   loading         — boolean
 *   setupBankroll(initialBankroll)
 *   addBet(betObj)
 *   updateBetResult(betId, result)
 *   deleteBet(betId)
 *   refreshBankroll()
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../store/authStore';

export default function useBankroll() {
  const { token, isAuthenticated } = useAuth();
  const [bankrollData, setBankrollData] = useState(null);
  const [loading,      setLoading]      = useState(false);

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  const refreshBankroll = useCallback(async () => {
    if (!isAuthenticated || !token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/bankroll', { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setBankrollData(json.data);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [token, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refreshBankroll(); }, [refreshBankroll]);

  async function setupBankroll(initialBankroll) {
    const res  = await fetch('/api/bankroll/setup', {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify({ initialBankroll }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Setup failed');
    setBankrollData(json.data);
    return json.data;
  }

  async function addBet(bet) {
    const res  = await fetch('/api/bankroll/bet', {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify(bet),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Failed to add bet');
    setBankrollData(json.data);
    return json.data;
  }

  async function updateBetResult(betId, result) {
    const res  = await fetch(`/api/bankroll/bet/${betId}`, {
      method:  'PATCH',
      headers: authHeaders(),
      body:    JSON.stringify({ result }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Failed to update bet');
    setBankrollData(json.data);
    return json.data;
  }

  async function deleteBet(betId) {
    const res  = await fetch(`/api/bankroll/bet/${betId}`, {
      method:  'DELETE',
      headers: authHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Failed to delete bet');
    setBankrollData(json.data);
    return json.data;
  }

  return {
    bankrollData,
    loading,
    setupBankroll,
    addBet,
    updateBetResult,
    deleteBet,
    refreshBankroll,
  };
}
