/**
 * useParlayLearnings — fetches per-dimension performance aggregates for the
 * authenticated user. Refetches when `refreshKey` changes so the UI can ask
 * for a fresh snapshot after marking results.
 */

import { useEffect, useState, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function useParlayLearnings(token, refreshKey = 0) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const fetchLearnings = useCallback(async () => {
    if (!token) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/parlay-architect/learnings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchLearnings();
  }, [fetchLearnings, refreshKey]);

  return { data, loading, error, refetch: fetchLearnings };
}
