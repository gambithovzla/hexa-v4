import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function useGames() {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [games, setGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setGamesLoading(true);
    setError(null);

    fetch(`${API_URL}/api/games?date=${date}`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        if (json.success) setGames(json.data);
        else setError(json.error);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setGamesLoading(false);
      });

    return () => { cancelled = true; };
  }, [date]);

  return { games, date, setDate, gamesLoading, error };
}
