import { useState } from 'react';
import { Box, Typography, Checkbox } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const TEAM_IDS = {
  'Arizona Diamondbacks': 109, 'Atlanta Braves': 144, 'Baltimore Orioles': 110,
  'Boston Red Sox': 111, 'Chicago Cubs': 112, 'Chicago White Sox': 145,
  'Cincinnati Reds': 113, 'Cleveland Guardians': 114, 'Colorado Rockies': 115,
  'Detroit Tigers': 116, 'Houston Astros': 117, 'Kansas City Royals': 118,
  'Los Angeles Angels': 108, 'Los Angeles Dodgers': 119, 'Miami Marlins': 146,
  'Milwaukee Brewers': 158, 'Minnesota Twins': 142, 'New York Mets': 121,
  'New York Yankees': 147, 'Oakland Athletics': 133, 'Philadelphia Phillies': 143,
  'Pittsburgh Pirates': 134, 'San Diego Padres': 135, 'San Francisco Giants': 137,
  'Seattle Mariners': 136, 'St. Louis Cardinals': 138, 'Tampa Bay Rays': 139,
  'Texas Rangers': 140, 'Toronto Blue Jays': 141, 'Washington Nationals': 120,
};

function getTeamId(name) {
  if (!name) return null;
  if (TEAM_IDS[name]) return TEAM_IDS[name];
  for (const [n, id] of Object.entries(TEAM_IDS)) {
    if (name.toLowerCase().includes(n.toLowerCase().split(' ').pop())) return id;
  }
  return null;
}

export default function BacktestRunner({ lang = 'en', onBack }) {
  const { token } = useAuth();
  const [date, setDate] = useState('');
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [currentGame, setCurrentGame] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [betType, setBetType] = useState('all');

  const runId = `bt-${date}-${Date.now().toString(36)}`;

  async function fetchGames() {
    if (!date) return;
    setLoading(true);
    setGames([]);
    setSelected(new Set());
    setResults([]);
    try {
      const res = await fetch(`${API_URL}/api/admin/historical-games?date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setGames(json.data.games.filter(g => g.isFinal));
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  function toggleGame(gamePk) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(gamePk)) next.delete(gamePk);
      else next.add(gamePk);
      return next;
    });
  }

  function selectAll() {
    const finalGames = games.filter(g => !g.alreadyTested);
    if (selected.size === finalGames.length) setSelected(new Set());
    else setSelected(new Set(finalGames.map(g => g.gamePk)));
  }

  async function runBacktest() {
    const toRun = games.filter(g => selected.has(g.gamePk));
    if (toRun.length === 0) return;
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: toRun.length });

    for (let i = 0; i < toRun.length; i++) {
      const game = toRun[i];
      const matchup = `${game.away.abbreviation} vs ${game.home.abbreviation}`;
      setCurrentGame(matchup);
      setProgress({ done: i, total: toRun.length });

      try {
        const res = await fetch(`${API_URL}/api/admin/run-backtest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            gamePk: game.gamePk, date,
            runId, homeTeam: game.home.name, awayTeam: game.away.name,
            homeScore: game.home.score, awayScore: game.away.score,
            totalRuns: game.totalRuns,
            betType,
          }),
        });
        const json = await res.json();
        setResults(prev => [...prev, { matchup, success: json.success, ...json.data, error: json.error }]);
      } catch (err) {
        setResults(prev => [...prev, { matchup, success: false, error: err.message }]);
      }

      // Delay between games
      if (i < toRun.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    setCurrentGame(null);
    setRunning(false);
    setProgress({ done: toRun.length, total: toRun.length });
    // Refresh games to update alreadyTested
    fetchGames();
  }

  const stats = results.reduce((acc, r) => {
    if (r.actualResult === 'win') acc.wins++;
    else if (r.actualResult === 'loss') acc.losses++;
    else acc.other++;
    return acc;
  }, { wins: 0, losses: 0, other: 0 });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#000', p: { xs: 2, sm: 3 }, maxWidth: '100vw', overflowX: 'hidden' }}>
      <Box component="button" onClick={onBack} sx={{
        background: 'transparent', border: `1px solid ${C.cyanLine}`, color: C.textMuted,
        fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '2px', padding: '6px 14px',
        cursor: 'pointer', mb: 3, '&:hover': { color: C.cyan, borderColor: C.cyan },
      }}>← BACK</Box>

      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', color: C.accent, letterSpacing: '0.2em', mb: 0.5 }}>
        ADMIN · SHADOW MODE
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.2rem', fontWeight: 700, color: C.textPrimary, letterSpacing: '0.08em', mb: 3 }}>
        BACKTEST RUNNER
      </Typography>

      {/* Date selector */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 3, flexWrap: 'wrap' }}>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          max={new Date().toISOString().split('T')[0]}
          style={{
            background: C.surface, border: `1px solid ${C.border}`, color: C.textPrimary,
            fontFamily: "'Share Tech Mono', monospace", fontSize: '0.8rem', padding: '8px 12px',
            colorScheme: 'dark',
          }}
        />
        <Box component="button" onClick={fetchGames} disabled={!date || loading} sx={{
          background: C.accentDim, border: `1px solid ${C.accentLine}`, color: C.accent,
          fontFamily: MONO, fontSize: '0.7rem', letterSpacing: '1.5px', padding: '8px 20px',
          cursor: loading ? 'wait' : 'pointer', opacity: !date ? 0.4 : 1,
          '&:hover': { background: 'rgba(255,102,0,0.15)' },
        }}>
          {loading ? 'LOADING...' : 'FETCH GAMES'}
        </Box>
      </Box>

      {/* Bet type selector */}
      {games.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, mb: 0.5, letterSpacing: '0.1em' }}>
            ANALYSIS TYPE
          </Typography>
          <Box sx={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {[
              { value: 'all', label: 'BEST PICK (ALL)' },
              { value: 'props', label: 'PLAYER PROPS' },
              { value: 'moneyline', label: 'MONEYLINE' },
              { value: 'totals', label: 'OVER/UNDER' },
            ].map(opt => (
              <Box key={opt.value} component="button" onClick={() => setBetType(opt.value)} sx={{
                px: '12px', py: '5px',
                border: `1px solid ${betType === opt.value ? C.accentLine : C.border}`,
                background: betType === opt.value ? C.accentDim : 'transparent',
                color: betType === opt.value ? C.accent : C.textMuted,
                fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '1px', cursor: 'pointer',
              }}>
                {opt.label}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Games list */}
      {games.length > 0 && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textSecondary }}>
              {games.length} completed games — {selected.size} selected
            </Typography>
            <Box component="button" onClick={selectAll} sx={{
              background: 'transparent', border: `1px solid ${C.cyanLine}`, color: C.cyan,
              fontFamily: MONO, fontSize: '0.6rem', padding: '4px 12px', cursor: 'pointer',
            }}>
              {selected.size === games.filter(g => !g.alreadyTested).length ? 'DESELECT ALL' : 'SELECT ALL'}
            </Box>
          </Box>

          {games.map(game => {
            const homeId = getTeamId(game.home.name);
            const awayId = getTeamId(game.away.name);
            const isSelected = selected.has(game.gamePk);
            const result = results.find(r => r.matchup === `${game.away.abbreviation} vs ${game.home.abbreviation}`);

            return (
              <Box key={game.gamePk} sx={{
                display: 'flex', alignItems: 'center', gap: 1.5, p: '10px 12px', mb: '4px',
                border: `1px solid ${game.alreadyTested ? 'rgba(0,255,136,0.2)' : isSelected ? C.accentLine : C.border}`,
                background: game.alreadyTested ? 'rgba(0,255,136,0.03)' : isSelected ? C.accentDim : 'transparent',
                opacity: game.alreadyTested ? 0.6 : 1,
                flexWrap: 'wrap',
              }}>
                <Checkbox
                  checked={isSelected}
                  disabled={running || game.alreadyTested}
                  onChange={() => toggleGame(game.gamePk)}
                  size="small"
                  sx={{ p: '2px', color: C.border, '&.Mui-checked': { color: C.accent } }}
                />
                {awayId && <img src={`https://www.mlbstatic.com/team-logos/${awayId}.svg`} width={20} height={20} alt="" onError={e => { e.target.style.display = 'none'; }} />}
                <Typography sx={{ fontFamily: MONO, fontSize: '0.8rem', color: C.textPrimary, minWidth: '45px', textAlign: 'center' }}>
                  {game.away.abbreviation}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textMuted }}>
                  {game.away.score} - {game.home.score}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.8rem', color: C.textPrimary, minWidth: '45px', textAlign: 'center' }}>
                  {game.home.abbreviation}
                </Typography>
                {homeId && <img src={`https://www.mlbstatic.com/team-logos/${homeId}.svg`} width={20} height={20} alt="" onError={e => { e.target.style.display = 'none'; }} />}
                <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, ml: 'auto' }}>
                  {game.awayPitcher} vs {game.homePitcher}
                </Typography>
                {game.alreadyTested && (
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.green, letterSpacing: '0.1em' }}>TESTED</Typography>
                )}
                {result && (
                  <Box sx={{ width: '100%', mt: '6px', pl: '36px' }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: result.success ? C.cyan : C.red }}>
                      {result.success
                        ? `→ ${result.pick} (${result.confidence}%) — ${result.actualResult?.toUpperCase() ?? 'UNRESOLVED'}`
                        : `✗ ${result.error}`}
                    </Typography>
                  </Box>
                )}
              </Box>
            );
          })}

          {/* Run button */}
          <Box sx={{ mt: 3, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Box component="button" onClick={runBacktest} disabled={running || selected.size === 0} sx={{
              background: running ? C.surface : 'rgba(255,102,0,0.15)',
              border: `2px solid ${running ? C.border : C.accent}`,
              color: running ? C.textMuted : C.accent,
              fontFamily: MONO, fontSize: '0.8rem', fontWeight: 700, letterSpacing: '2px',
              padding: '12px 32px', cursor: running ? 'wait' : 'pointer',
              boxShadow: running ? 'none' : C.accentGlow,
              '&:hover': running ? {} : { background: 'rgba(255,102,0,0.25)' },
            }}>
              {running ? `RUNNING ${progress.done}/${progress.total}...` : `RUN BACKTEST (${selected.size} GAMES)`}
            </Box>
            {currentGame && (
              <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.amber, animation: 'pulse 1.5s infinite' }}>
                Analyzing: {currentGame}
              </Typography>
            )}
          </Box>

          {/* Live results summary */}
          {results.length > 0 && (
            <Box sx={{ mt: 3, border: `1px solid ${C.border}`, p: 2 }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1 }}>
                RESULTS — {results.length} analyzed
              </Typography>
              <Box sx={{ display: 'flex', gap: 3 }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '1rem', color: C.green }}>{stats.wins}W</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '1rem', color: C.red }}>{stats.losses}L</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '1rem', color: C.amber }}>{stats.other} other</Typography>
                {(stats.wins + stats.losses) > 0 && (
                  <Typography sx={{ fontFamily: MONO, fontSize: '1rem', color: C.textPrimary }}>
                    {((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)}%
                  </Typography>
                )}
              </Box>
            </Box>
          )}
        </>
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </Box>
  );
}
