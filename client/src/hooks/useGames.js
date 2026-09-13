import { useState, useEffect } from 'react';
import normalizeNflGame from '../utils/normalizeNflGame.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function useGames(sport = 'mlb') {
  // Local date — avoids UTC drift that pushes late-evening users a day ahead
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [date, setDate] = useState(today);
  const [games, setGames] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setGamesLoading(true);
    setError(null);

    // NFL games come from the NFL slate endpoint and in ESPN's shape, so they
    // are normalised to the MLB-compatible shape every picker already renders.
    const url = sport === 'nfl'
      ? `${API_URL}/api/nfl/games?date=${date}`
      : `${API_URL}/api/games?date=${date}`;

    fetch(url)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        if (json.success) {
          setGames(sport === 'nfl' ? (json.data ?? []).map(normalizeNflGame) : json.data);
        } else setError(json.error);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setGamesLoading(false);
      });

    return () => { cancelled = true; };
  }, [date, sport]);

  return { games, date, setDate, gamesLoading, error };
}
