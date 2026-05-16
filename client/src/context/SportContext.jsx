import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { normalizeSport } from '../config/sports';

const STORAGE_KEY = 'hexa_sport';
const SportContext = createContext(null);

export function SportProvider({ children }) {
  const [sport, setSportState] = useState(() => {
    if (typeof window === 'undefined') return 'mlb';
    return normalizeSport(localStorage.getItem(STORAGE_KEY) ?? 'mlb', 'mlb');
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, sport);
    // Mirror on <body data-sport="…"> so the League × Kinetic CSS layer
    // can swap --sport-accent (lava ↔ volt) without React re-renders.
    if (typeof document !== 'undefined' && document.body) {
      document.body.setAttribute('data-sport', sport);
    }
  }, [sport]);

  const setSport = (nextSport) => {
    setSportState(normalizeSport(nextSport, 'mlb'));
  };

  const value = useMemo(() => ({ sport, setSport }), [sport]);
  return <SportContext.Provider value={value}>{children}</SportContext.Provider>;
}

export function useSport() {
  const ctx = useContext(SportContext);
  if (!ctx) {
    throw new Error('useSport must be used within SportProvider');
  }
  return ctx;
}
