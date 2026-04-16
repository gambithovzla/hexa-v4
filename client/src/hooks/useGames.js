import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function useGames() {
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
