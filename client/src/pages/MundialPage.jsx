/**
 * MundialPage — FIFA World Cup 2026 prediction game.
 * Predict exact scores for all 104 matches. Earn Hexa credits.
 * Exact score = +5 credits · Correct result (1X2) = leaderboard points only
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, CircularProgress, Tabs, Tab } from '@mui/material';

const API  = import.meta.env.VITE_API_URL ?? '';
const MONO = "'JetBrains Mono','Fira Mono',monospace";
const C = {
  bg:      '#080e14',
  card:    '#0d1822',
  card2:   '#111e2a',
  line:    '#1a2d3e',
  gold:    '#f59e0b',
  goldDim: '#f59e0b33',
  green:   '#22c55e',
  red:     '#ef4444',
  cyan:    '#00e5ff',
  ink0:    '#e8f0f5',
  ink1:    '#8faabf',
  ink2:    '#4a6070',
};

// ── ISO flag map (2-letter country codes) ────────────────────────────────────
const ISO = {
  'Mexico': 'mx', 'United States': 'us', 'USA': 'us', 'USMNT': 'us', 'United States of America': 'us',
  'Canada': 'ca', 'Brazil': 'br', 'Brasil': 'br', 'Argentina': 'ar',
  'Colombia': 'co', 'Uruguay': 'uy', 'Chile': 'cl', 'Peru': 'pe',
  'Ecuador': 'ec', 'Bolivia': 'bo', 'Paraguay': 'py', 'Venezuela': 've',
  'Honduras': 'hn', 'Costa Rica': 'cr', 'Panama': 'pa', 'Jamaica': 'jm',
  'Haiti': 'ht', 'Trinidad and Tobago': 'tt', 'Trinidad & Tobago': 'tt', 'Cuba': 'cu',
  'El Salvador': 'sv', 'Guatemala': 'gt', 'Nicaragua': 'ni', 'Belize': 'bz',
  'France': 'fr', 'Germany': 'de', 'Deutschland': 'de',
  'Spain': 'es', 'Portugal': 'pt', 'Netherlands': 'nl', 'Holland': 'nl',
  'Belgium': 'be', 'Italy': 'it', 'England': 'gb-eng', 'Scotland': 'gb-sct',
  'Wales': 'gb-wls', 'Northern Ireland': 'gb-nir',
  'Croatia': 'hr', 'Hrvatska': 'hr', 'Switzerland': 'ch', 'Denmark': 'dk',
  'Sweden': 'se', 'Norway': 'no', 'Poland': 'pl', 'Ukraine': 'ua',
  'Turkey': 'tr', 'Türkiye': 'tr', 'Turkiye': 'tr',
  'Czech Republic': 'cz', 'Czechia': 'cz', 'Slovakia': 'sk',
  'Serbia': 'rs', 'Romania': 'ro', 'Hungary': 'hu',
  'Austria': 'at', 'Greece': 'gr', 'Bulgaria': 'bg', 'Albania': 'al',
  'Slovenia': 'si', 'Bosnia-Herzegovina': 'ba', 'Bosnia and Herzegovina': 'ba',
  'Bosnia & Herzegovina': 'ba', 'Bosnia-Hercegovina': 'ba', 'Bosnia': 'ba',
  'North Macedonia': 'mk', 'Iceland': 'is', 'Finland': 'fi', 'Ireland': 'ie',
  'Republic of Ireland': 'ie', 'Russia': 'ru', 'Kosovo': 'xk',
  'Georgia': 'ge', 'Armenia': 'am', 'Azerbaijan': 'az', 'Moldova': 'md',
  'Belarus': 'by', 'Luxembourg': 'lu', 'Montenegro': 'me', 'Cyprus': 'cy',
  'South Africa': 'za', 'Morocco': 'ma', 'Maroc': 'ma',
  'Senegal': 'sn', 'Nigeria': 'ng', 'Ghana': 'gh', 'Cameroon': 'cm',
  'Ivory Coast': 'ci', "Côte d'Ivoire": 'ci', "Cote d'Ivoire": 'ci',
  'Tunisia': 'tn', 'Egypt': 'eg', 'Algeria': 'dz', 'Mali': 'ml',
  'Cape Verde': 'cv', 'Guinea': 'gn', 'Mauritania': 'mr', 'Tanzania': 'tz',
  'Uganda': 'ug', 'Rwanda': 'rw', 'Kenya': 'ke', 'Ethiopia': 'et',
  'Zimbabwe': 'zw', 'Zambia': 'zm', 'Mozambique': 'mz', 'Namibia': 'na',
  'DR Congo': 'cd', 'Congo': 'cg', 'Angola': 'ao', 'Libya': 'ly',
  'Sudan': 'sd', 'Comoros': 'km', 'Gabon': 'ga', 'Equatorial Guinea': 'gq',
  'Japan': 'jp', 'South Korea': 'kr', 'Korea Republic': 'kr', 'Korea Rep': 'kr',
  'Republic of Korea': 'kr', 'Korea': 'kr',
  'China': 'cn', 'China PR': 'cn', 'PR China': 'cn',
  'Australia': 'au', 'Saudi Arabia': 'sa', 'Iran': 'ir', 'IR Iran': 'ir',
  'Iraq': 'iq', 'Qatar': 'qa', 'Uzbekistan': 'uz', 'Indonesia': 'id',
  'Thailand': 'th', 'Vietnam': 'vn', 'India': 'in', 'Jordan': 'jo',
  'Lebanon': 'lb', 'Palestine': 'ps', 'Bahrain': 'bh', 'Kuwait': 'kw',
  'Oman': 'om', 'UAE': 'ae', 'United Arab Emirates': 'ae', 'Israel': 'il',
  'Philippines': 'ph', 'Malaysia': 'my', 'New Zealand': 'nz', 'Fiji': 'fj',
  'Papua New Guinea': 'pg', 'Vanuatu': 'vu', 'Solomon Islands': 'sb',
  'Tahiti': 'pf',
};

function getIso(name) {
  if (!name) return null;
  if (ISO[name]) return ISO[name];
  const lower = name.toLowerCase().trim();
  for (const [k, v] of Object.entries(ISO)) {
    if (lower === k.toLowerCase()) return v;
  }
  for (const [k, v] of Object.entries(ISO)) {
    if (lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) return v;
  }
  return null;
}

// Convert 2-letter ISO code to Unicode emoji flag (regional indicator symbols)
function isoToEmoji(iso) {
  if (!iso || iso.length < 2) return '🌐';
  const letters = iso.slice(0, 2).toUpperCase();
  try {
    return String.fromCodePoint(
      0x1F1E6 + letters.charCodeAt(0) - 65,
      0x1F1E6 + letters.charCodeAt(1) - 65,
    );
  } catch { return '🌐'; }
}

function Flag({ team, size = 32 }) {
  const iso = getIso(team);
  const emoji = iso ? isoToEmoji(iso) : '🌐';
  return (
    <Box sx={{
      width: size, height: size,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: `${Math.round(size * 0.82)}px`, lineHeight: 1, userSelect: 'none',
    }}>
      {emoji}
    </Box>
  );
}

// ── Score stepper ─────────────────────────────────────────────────────────────
function ScoreInput({ value, onChange, disabled }) {
  const btnStyle = (active) => ({
    width: 28, height: 28, border: `1px solid ${C.line}`, bgcolor: C.card2,
    color: active ? C.ink1 : C.ink2, borderRadius: '6px',
    cursor: disabled || !active ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '1rem', fontFamily: MONO, transition: 'all 0.12s',
    '&:hover:not(:disabled)': { bgcolor: active ? C.line : C.card2, color: active ? C.ink0 : C.ink2 },
  });
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <Box component="button" disabled={disabled || value <= 0}
        onClick={() => !disabled && onChange(Math.max(0, value - 1))}
        sx={btnStyle(value > 0)}>−</Box>
      <Box sx={{
        width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: MONO, fontWeight: 700, fontSize: '1.3rem', color: C.ink0,
        bgcolor: C.card, border: `1px solid ${C.line}`, borderRadius: '6px',
      }}>{value}</Box>
      <Box component="button" disabled={disabled || value >= 20}
        onClick={() => !disabled && onChange(Math.min(20, value + 1))}
        sx={btnStyle(true)}>+</Box>
    </Box>
  );
}

// ── Date header ───────────────────────────────────────────────────────────────
const DAYS_ES   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function DateHeader({ dateStr }) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const label = `${DAYS_ES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`.toUpperCase();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 3, mb: '6px' }}>
      <Box sx={{ px: '10px', py: '4px', bgcolor: C.card2, border: `1px solid ${C.line}`,
        borderRadius: '6px', fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700,
        color: C.gold, letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>{label}</Box>
      <Box sx={{ flex: 1, height: '1px', bgcolor: C.line }} />
    </Box>
  );
}

// ── Match card ────────────────────────────────────────────────────────────────
function MatchCard({ match, token }) {
  const pred      = match.prediction;
  const isResolved = pred && ['exact','correct','wrong'].includes(pred.status);
  const isLocked   = match.status === 'live' || match.status === 'final';

  const [home,   setHome]   = useState(pred?.predicted_home ?? 0);
  const [away,   setAway]   = useState(pred?.predicted_away ?? 0);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(!!pred);
  const [err,    setErr]    = useState(null);

  const save = useCallback(async (h, a) => {
    if (!token || isLocked || isResolved) return;
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`${API}/api/mundial/predict`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: match.eventId, homeTeam: match.homeTeam, awayTeam: match.awayTeam,
          gameDate: match.gameDate, predictedHome: h, predictedAway: a,
        }),
      });
      const d = await r.json();
      if (d.success) setSaved(true);
      else setErr(d.error ?? 'Error al guardar');
    } catch { setErr('Error de red'); }
    finally { setSaving(false); }
  }, [token, match, isLocked, isResolved]);

  const kickoff = match.gameTime
    ? new Date(match.gameTime).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
    : null;

  // Status badge after resolution
  const STATUS = {
    exact:   { color: C.gold,  label: '★ Exacto · +5 créditos' },
    correct: { color: C.green, label: '✓ Resultado correcto · suma en tabla' },
    wrong:   { color: C.red,   label: '✗ Incorrecto' },
  };

  return (
    <Box sx={{ bgcolor: C.card, border: `1px solid ${C.line}`, borderRadius: '10px', mb: '8px', overflow: 'hidden' }}>
      {/* Top bar */}
      <Box sx={{ px: 2, py: '5px', bgcolor: C.card2, borderBottom: `1px solid ${C.line}`,
        display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.ink2 }}>⏰ {kickoff ?? '--:-- ET'}</Box>
        {match.status === 'live'  && <Box sx={{ ml: 'auto', fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700, color: C.green, bgcolor: '#22c55e22', px: '6px', py: '1px', borderRadius: '4px', border: `1px solid ${C.green}44` }}>EN VIVO</Box>}
        {match.status === 'final' && <Box sx={{ ml: 'auto', fontFamily: MONO, fontSize: '0.55rem', color: C.ink2 }}>FINALIZADO</Box>}
      </Box>

      {/* Actual score if final */}
      {match.status === 'final' && match.homeScore != null && (
        <Box sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.ink1, textAlign: 'center', pt: '8px', pb: 0 }}>
          Resultado oficial: <strong style={{ color: C.ink0 }}>{match.homeScore} – {match.awayScore}</strong>
        </Box>
      )}

      {/* Teams + inputs */}
      <Box sx={{ px: 2, py: '12px', display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Home */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
          <Flag team={match.homeTeam} size={32} />
          <Box sx={{ fontFamily: MONO, fontSize: '0.7rem', fontWeight: 600, color: C.ink0,
            textAlign: 'center', lineHeight: 1.3, maxWidth: 90 }}>
            {match.homeTeam}
          </Box>
        </Box>

        {/* Score inputs + button */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', px: '4px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ScoreInput value={home} onChange={v => { setHome(v); setSaved(false); }} disabled={isLocked || isResolved || !token} />
            <Box sx={{ fontFamily: MONO, fontWeight: 700, fontSize: '1.1rem', color: C.ink2 }}>:</Box>
            <ScoreInput value={away} onChange={v => { setAway(v); setSaved(false); }} disabled={isLocked || isResolved || !token} />
          </Box>
          {!isLocked && !isResolved && token && (
            <Box component="button" disabled={saving} onClick={() => save(home, away)}
              sx={{
                px: '18px', py: '6px',
                bgcolor: saved ? '#22c55e18' : C.goldDim,
                border: `1px solid ${saved ? C.green + '88' : C.gold + '88'}`,
                borderRadius: '6px', cursor: saving ? 'default' : 'pointer',
                fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700,
                color: saved ? C.green : C.gold, letterSpacing: '0.08em',
                transition: 'all 0.18s',
                '&:hover:not(:disabled)': { bgcolor: saved ? '#22c55e28' : '#f59e0b28' },
              }}>
              {saving ? '...' : saved ? '✓ Guardado' : 'Predecir'}
            </Box>
          )}
          {!token && (
            <Box sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.ink2, textAlign: 'center' }}>
              Inicia sesión
            </Box>
          )}
        </Box>

        {/* Away */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
          <Flag team={match.awayTeam} size={32} />
          <Box sx={{ fontFamily: MONO, fontSize: '0.7rem', fontWeight: 600, color: C.ink0,
            textAlign: 'center', lineHeight: 1.3, maxWidth: 90 }}>
            {match.awayTeam}
          </Box>
        </Box>
      </Box>

      {/* Resolution badge */}
      {isResolved && (
        <Box sx={{ mx: 2, mb: '10px', px: '10px', py: '5px', borderRadius: '6px',
          bgcolor: `${STATUS[pred.status].color}18`, border: `1px solid ${STATUS[pred.status].color}44`,
          fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700, color: STATUS[pred.status].color,
          letterSpacing: '0.06em', textAlign: 'center' }}>
          {STATUS[pred.status].label}
          {' · Tu predicción: '}<strong>{pred.predicted_home}–{pred.predicted_away}</strong>
        </Box>
      )}

      {err && (
        <Box sx={{ mx: 2, mb: '8px', fontFamily: MONO, fontSize: '0.6rem', color: C.red, textAlign: 'center' }}>
          {err}
        </Box>
      )}
    </Box>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ matches, token }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/mundial/my-predictions`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success) setSummary(d.summary); })
      .catch(() => {});
  }, [token, matches]);

  const total     = matches.length;
  const predicted = matches.filter(m => m.prediction).length;
  const pct       = total > 0 ? Math.round(predicted / total * 100) : 0;

  return (
    <Box sx={{ bgcolor: C.card, border: `1px solid ${C.line}`, borderRadius: '10px', p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ fontFamily: MONO, fontSize: '0.8rem', color: C.ink0, fontWeight: 600 }}>
          {predicted} / {total} predicciones
        </Box>
        <Box sx={{ fontFamily: MONO, fontSize: '0.8rem', color: C.gold, fontWeight: 700 }}>{pct}%</Box>
      </Box>
      <Box sx={{ height: 4, bgcolor: C.line, borderRadius: 2, overflow: 'hidden', mb: summary ? 1.5 : 0 }}>
        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: C.gold,
          background: `linear-gradient(90deg, ${C.gold}, #fbbf24)`, borderRadius: 2, transition: 'width 0.4s' }} />
      </Box>
      {summary && (
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          {[
            { label: 'Exactos',  val: summary.exact,         color: C.gold  },
            { label: 'Aciertos', val: summary.correct,       color: C.green },
            { label: 'Créditos', val: summary.total_credits, color: C.cyan  },
          ].map(({ label, val, color }) => (
            <Box key={label} sx={{ flex: 1, textAlign: 'center' }}>
              <Box sx={{ fontFamily: MONO, fontSize: '1.1rem', fontWeight: 700, color }}>{val ?? 0}</Box>
              <Box sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.ink2, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function Leaderboard() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/mundial/leaderboard`)
      .then(r => r.json())
      .then(d => { setRows(d.leaderboard ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const medals = ['🥇','🥈','🥉'];

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} sx={{ color: C.gold }} /></Box>;
  if (!rows.length) return <Box sx={{ textAlign: 'center', py: 6, fontFamily: MONO, fontSize: '0.8rem', color: C.ink2 }}>Aún no hay resultados resueltos. ¡Vuelve pronto!</Box>;

  return (
    <Box>
      {rows.map((row, i) => (
        <Box key={row.id} sx={{
          display: 'flex', alignItems: 'center', gap: 2, px: 2, py: '10px', mb: '4px',
          bgcolor: i < 3 ? C.card2 : C.card,
          border: `1px solid ${i < 3 ? C.gold + '55' : C.line}`,
          borderRadius: '8px',
        }}>
          <Box sx={{ fontFamily: MONO, fontSize: '1rem', width: 28, textAlign: 'center' }}>
            {medals[i] ?? <span style={{ color: C.ink2, fontSize: '0.7rem' }}>#{i + 1}</span>}
          </Box>
          <Box sx={{ flex: 1, fontFamily: MONO, fontSize: '0.8rem', color: C.ink0, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.username}
          </Box>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Box sx={{ textAlign: 'center' }}>
              <Box sx={{ fontFamily: MONO, fontSize: '0.8rem', color: C.gold, fontWeight: 700 }}>{row.exact_count ?? 0}</Box>
              <Box sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.ink2, letterSpacing: '0.08em' }}>EXACTOS</Box>
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Box sx={{ fontFamily: MONO, fontSize: '0.8rem', color: C.green, fontWeight: 700 }}>{row.correct_count ?? 0}</Box>
              <Box sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.ink2, letterSpacing: '0.08em' }}>RESULT.</Box>
            </Box>
            <Box sx={{ textAlign: 'center', minWidth: 42 }}>
              <Box sx={{ fontFamily: MONO, fontSize: '0.95rem', color: C.cyan, fontWeight: 700 }}>{row.total_credits ?? 0}</Box>
              <Box sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.ink2, letterSpacing: '0.08em' }}>CRÉDITOS</Box>
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function MundialPage({ token }) {
  const [tab,     setTab]     = useState(0);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState(null);

  useEffect(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API}/api/mundial/all-matches`, { headers })
      .then(r => r.json())
      .then(d => { setMatches(d.matches ?? []); setLoading(false); })
      .catch(e => { setFetchErr(e.message); setLoading(false); });
  }, [token]);

  const byDate = matches.reduce((acc, m) => {
    const k = m.gameDate || 'TBD';
    if (!acc[k]) acc[k] = [];
    acc[k].push(m);
    return acc;
  }, {});
  const sortedDates = Object.keys(byDate).sort();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.bg, color: C.ink0, pb: 8 }}>
      {/* Header */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10,
        bgcolor: 'rgba(8,14,20,0.96)', backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.line}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, pt: '12px', pb: 0 }}>
          <Box component="button" onClick={() => { window.location.href = '/'; }}
            sx={{ background: 'none', border: 'none', color: C.gold, cursor: 'pointer',
              fontFamily: MONO, fontSize: '0.7rem', letterSpacing: '0.08em',
              p: '4px 8px', borderRadius: '6px', '&:hover': { bgcolor: C.card } }}>
            ← HEXA
          </Box>
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Box sx={{ fontFamily: MONO, fontWeight: 700, fontSize: '0.9rem', color: C.gold, letterSpacing: '0.12em' }}>
              🏆 MUNDIAL 2026
            </Box>
            <Box sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.ink2, letterSpacing: '0.15em' }}>
              {loading ? '...' : `${matches.length} PARTIDOS`}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
            <Box sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.gold }}>★ Exacto = +5 créditos</Box>
            <Box sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.green }}>✓ Resultado = tabla</Box>
          </Box>
        </Box>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}
          sx={{ px: 2, minHeight: 40,
            '& .MuiTabs-indicator': { bgcolor: C.gold },
            '& .MuiTab-root': { fontFamily: MONO, fontSize: '0.7rem', letterSpacing: '0.1em',
              color: C.ink2, minHeight: 40, textTransform: 'uppercase', fontWeight: 600,
              '&.Mui-selected': { color: C.gold } } }}>
          <Tab label="⚽ Predecir" />
          <Tab label="🏆 Ranking" />
        </Tabs>
      </Box>

      <Box sx={{ maxWidth: 560, mx: 'auto', px: 2, pt: 2 }}>
        {tab === 0 && (
          loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress size={32} sx={{ color: C.gold }} />
            </Box>
          ) : fetchErr ? (
            <Box sx={{ textAlign: 'center', py: 8, fontFamily: MONO, fontSize: '0.8rem', color: C.red }}>
              {fetchErr}
            </Box>
          ) : (
            <>
              <StatsBar matches={matches} token={token} />
              {sortedDates.map(date => (
                <Box key={date}>
                  <DateHeader dateStr={date} />
                  {byDate[date].map(m => (
                    <MatchCard key={m.eventId} match={m} token={token} />
                  ))}
                </Box>
              ))}
            </>
          )
        )}
        {tab === 1 && <Leaderboard />}
      </Box>
    </Box>
  );
}
