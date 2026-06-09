/**
 * MundialPage — FIFA World Cup 2026 prediction game.
 * Predict exact scores for all 104 matches. Earn Hexa credits.
 * Exact score = +5 credits · Correct result (1X2) = leaderboard points only
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, CircularProgress, Tabs, Tab } from '@mui/material';

const API   = import.meta.env.VITE_API_URL ?? '';
const MONO  = "'JetBrains Mono','Fira Mono',monospace";
const DISP  = "'Oswald','Barlow Condensed',sans-serif";
const COND  = "'Barlow Condensed','Oswald',sans-serif";

const C = {
  bg:      '#061827',
  card:    '#0B2540',
  raised:  '#102E54',
  inset:   '#0a1d35',
  border:  'rgba(244,236,216,0.22)',
  line:    'rgba(244,236,216,0.14)',
  lineStr: 'rgba(244,236,216,0.30)',
  bronze:  '#B8985A',
  bronzeDim: '#B8985A33',
  volt:    '#FFD60A',
  voltDim: '#FFD60A22',
  lava:    '#E63946',
  lavaDim: '#E6394622',
  green:   '#22c55e',
  greenDim:'#22c55e22',
  cream:   '#F4ECD8',
  ink1:    '#cfd6e0',
  ink2:    '#7a8a9d',
  ink3:    '#506378',
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
    width: 28, height: 28,
    border: `1px solid ${active && !disabled ? C.lineStr : C.line}`,
    bgcolor: C.inset,
    color: active && !disabled ? C.ink1 : C.ink3,
    borderRadius: '4px',
    cursor: disabled || !active ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '1rem', fontFamily: MONO, transition: 'all 0.12s',
    '&:hover:not(:disabled)': { bgcolor: active ? C.raised : C.inset, color: active ? C.cream : C.ink3 },
  });
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <Box component="button" disabled={disabled || value <= 0}
        onClick={() => !disabled && onChange(Math.max(0, value - 1))}
        sx={btnStyle(value > 0)}>−</Box>
      <Box sx={{
        width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: DISP, fontWeight: 700, fontSize: '1.4rem', color: disabled ? C.ink2 : C.cream,
        bgcolor: C.inset, border: `1px solid ${C.line}`, borderRadius: '4px',
        letterSpacing: '-0.02em',
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
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: '20px', mb: '8px' }}>
      <Box sx={{ px: '10px', py: '4px',
        bgcolor: C.raised, border: `1px solid ${C.lineStr}`,
        borderLeft: `3px solid ${C.bronze}`,
        borderRadius: '2px', fontFamily: COND, fontSize: '0.75rem', fontWeight: 700,
        color: C.bronze, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>{label}</Box>
      <Box sx={{ flex: 1, height: '1px', bgcolor: C.line }} />
    </Box>
  );
}

// ── Match card ────────────────────────────────────────────────────────────────
function MatchCard({ match, token }) {
  const pred       = match.prediction;
  const isResolved = pred && ['exact','correct','wrong'].includes(pred.status);
  const isLocked   = match.status === 'live' || match.status === 'final';
  const canEdit    = !!pred && !isLocked && !isResolved;

  const [home,    setHome]    = useState(pred?.predicted_home ?? 0);
  const [away,    setAway]    = useState(pred?.predicted_away ?? 0);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(!!pred);
  const [editing, setEditing] = useState(false);
  const [err,     setErr]     = useState(null);

  const enterEdit = () => { setEditing(true); setSaved(false); };

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
      if (d.success) { setSaved(true); setEditing(false); }
      else setErr(d.error ?? 'Error al guardar');
    } catch { setErr('Error de red'); }
    finally { setSaving(false); }
  }, [token, match, isLocked, isResolved]);

  const kickoff = match.gameTime
    ? new Date(match.gameTime).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
    : null;

  // Status badge after resolution
  const STATUS = {
    exact:   { color: C.volt,  label: '★ Exacto · +5 créditos' },
    correct: { color: C.green, label: '✓ Resultado correcto · suma en tabla' },
    wrong:   { color: C.lava,  label: '✗ Incorrecto' },
  };

  return (
    <Box sx={{
      bgcolor: C.card, border: `1px solid ${C.border}`,
      borderTop: `3px solid ${C.line}`,
      borderRadius: '4px', mb: '8px', overflow: 'hidden',
    }}>
      {/* Top bar */}
      <Box sx={{ px: 2, py: '5px', bgcolor: C.raised, borderBottom: `1px solid ${C.line}`,
        display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.ink2, letterSpacing: '0.04em' }}>
          {kickoff ?? '--:-- ET'}
        </Box>
        {match.status === 'live'  && (
          <Box sx={{ ml: 'auto', fontFamily: COND, fontSize: '0.6rem', fontWeight: 700,
            color: C.lava, letterSpacing: '0.12em' }}>● EN VIVO</Box>
        )}
        {match.status === 'final' && (
          <Box sx={{ ml: 'auto', fontFamily: COND, fontSize: '0.6rem', color: C.ink3, letterSpacing: '0.1em' }}>FINALIZADO</Box>
        )}
      </Box>

      {/* Actual score if final */}
      {match.status === 'final' && match.homeScore != null && (
        <Box sx={{ fontFamily: DISP, fontSize: '0.85rem', color: C.ink2, textAlign: 'center', pt: '8px', pb: 0, letterSpacing: '0.06em' }}>
          RESULTADO: <strong style={{ color: C.cream, fontWeight: 700 }}>{match.homeScore} – {match.awayScore}</strong>
        </Box>
      )}

      {/* Teams row */}
      <Box sx={{ px: 2, pt: '12px', pb: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
          <Flag team={match.homeTeam} size={26} />
          <Box sx={{ fontFamily: COND, fontSize: '0.88rem', fontWeight: 600, color: C.cream,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>
            {match.homeTeam.toUpperCase()}
          </Box>
        </Box>
        <Box sx={{ fontFamily: COND, fontSize: '0.6rem', color: C.ink3, flexShrink: 0, px: '2px', letterSpacing: '0.1em' }}>VS</Box>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '7px', minWidth: 0 }}>
          <Box sx={{ fontFamily: COND, fontSize: '0.88rem', fontWeight: 600, color: C.cream,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', letterSpacing: '0.04em' }}>
            {match.awayTeam.toUpperCase()}
          </Box>
          <Flag team={match.awayTeam} size={26} />
        </Box>
      </Box>

      {/* Score inputs + actions */}
      <Box sx={{ px: 2, pb: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ScoreInput value={home} onChange={v => { setHome(v); setSaved(false); }} disabled={isLocked || isResolved || (saved && !editing) || !token} />
          <Box sx={{ fontFamily: DISP, fontWeight: 700, fontSize: '1.3rem', color: C.ink3, px: '2px' }}>–</Box>
          <ScoreInput value={away} onChange={v => { setAway(v); setSaved(false); }} disabled={isLocked || isResolved || (saved && !editing) || !token} />
        </Box>

        {/* Saved + not editing */}
        {saved && !editing && canEdit && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Box sx={{
              px: '14px', py: '5px',
              bgcolor: C.greenDim, border: `1px solid ${C.green}55`,
              borderRadius: '3px', fontFamily: COND, fontSize: '0.72rem', fontWeight: 700,
              color: C.green, letterSpacing: '0.12em',
            }}>✓ GUARDADO</Box>
            <Box component="button" onClick={enterEdit} sx={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: COND, fontSize: '0.7rem', color: C.ink2, letterSpacing: '0.08em',
              px: '6px', py: '3px', borderRadius: '3px',
              '&:hover': { color: C.bronze, bgcolor: C.raised },
            }}>✏ EDITAR</Box>
          </Box>
        )}

        {/* Saved + locked (no edit) */}
        {saved && !canEdit && !isResolved && (
          <Box sx={{
            px: '14px', py: '5px', bgcolor: C.greenDim, border: `1px solid ${C.green}55`,
            borderRadius: '3px', fontFamily: COND, fontSize: '0.72rem', fontWeight: 700,
            color: C.green, letterSpacing: '0.12em',
          }}>✓ GUARDADO</Box>
        )}

        {/* First predict or editing */}
        {!isLocked && !isResolved && token && (!saved || editing) && (
          <Box component="button" disabled={saving} onClick={() => save(home, away)}
            sx={{
              px: '32px', py: '8px',
              bgcolor: editing ? C.bronzeDim : C.bronzeDim,
              border: `1px solid ${editing ? C.volt + '99' : C.bronze + '99'}`,
              borderRadius: '3px', cursor: saving ? 'default' : 'pointer',
              fontFamily: DISP, fontSize: '0.85rem', fontWeight: 700,
              color: editing ? C.volt : C.bronze, letterSpacing: '0.14em',
              transition: 'all 0.15s',
              '&:hover:not(:disabled)': { bgcolor: `${editing ? C.volt : C.bronze}22` },
            }}>
            {saving ? '...' : editing ? 'GUARDAR CAMBIOS' : 'PREDECIR'}
          </Box>
        )}

        {!token && (
          <Box sx={{ fontFamily: COND, fontSize: '0.65rem', color: C.ink3, letterSpacing: '0.08em' }}>
            INICIA SESIÓN PARA PREDECIR
          </Box>
        )}
      </Box>

      {/* Resolution badge */}
      {isResolved && (
        <Box sx={{ mx: 2, mb: '10px', px: '12px', py: '6px', borderRadius: '3px',
          bgcolor: `${STATUS[pred.status].color}18`, borderLeft: `3px solid ${STATUS[pred.status].color}`,
          border: `1px solid ${STATUS[pred.status].color}33`,
          fontFamily: COND, fontSize: '0.72rem', fontWeight: 700, color: STATUS[pred.status].color,
          letterSpacing: '0.1em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{STATUS[pred.status].label}</span>
          <span style={{ fontFamily: MONO, fontSize: '0.7rem', opacity: 0.8 }}>
            {pred.predicted_home}–{pred.predicted_away}
          </span>
        </Box>
      )}

      {err && (
        <Box sx={{ mx: 2, mb: '8px', fontFamily: MONO, fontSize: '0.6rem', color: C.lava, textAlign: 'center' }}>
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
    <Box sx={{
      bgcolor: C.card, border: `1px solid ${C.border}`,
      borderTop: `3px solid ${C.bronze}`,
      borderRadius: '4px', p: 2, mb: 2,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: '8px' }}>
        <Box sx={{ fontFamily: COND, fontSize: '0.8rem', color: C.ink1, letterSpacing: '0.06em' }}>
          {predicted} / {total} PREDICCIONES
        </Box>
        <Box sx={{ fontFamily: DISP, fontSize: '1rem', color: C.bronze, fontWeight: 700, letterSpacing: '0.04em' }}>{pct}%</Box>
      </Box>
      <Box sx={{ height: 3, bgcolor: C.raised, borderRadius: 0, overflow: 'hidden', mb: summary ? 2 : 0 }}>
        <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: C.bronze,
          background: `linear-gradient(90deg, ${C.bronze}, ${C.volt})`, transition: 'width 0.4s' }} />
      </Box>
      {summary && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          {[
            { label: 'Exactos',  val: summary.exact,         color: C.volt   },
            { label: 'Aciertos', val: summary.correct,       color: C.green  },
            { label: 'Créditos', val: summary.total_credits, color: C.bronze },
          ].map(({ label, val, color }) => (
            <Box key={label} sx={{ flex: 1, textAlign: 'center', py: '6px',
              bgcolor: C.raised, borderRadius: '3px', border: `1px solid ${C.line}` }}>
              <Box sx={{ fontFamily: DISP, fontSize: '1.3rem', fontWeight: 700, color, lineHeight: 1.1 }}>{val ?? 0}</Box>
              <Box sx={{ fontFamily: COND, fontSize: '0.6rem', color: C.ink2, letterSpacing: '0.12em', mt: '2px' }}>{label.toUpperCase()}</Box>
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

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress size={28} sx={{ color: C.bronze }} />
    </Box>
  );
  if (!rows.length) return (
    <Box sx={{ textAlign: 'center', py: 8, fontFamily: COND, fontSize: '0.85rem',
      color: C.ink2, letterSpacing: '0.08em' }}>
      AÚN NO HAY RESULTADOS RESUELTOS · VUELVE PRONTO
    </Box>
  );

  return (
    <Box>
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pb: '6px',
        fontFamily: COND, fontSize: '0.6rem', color: C.ink3, letterSpacing: '0.12em' }}>
        <Box sx={{ width: 32 }} />
        <Box sx={{ flex: 1 }}>JUGADOR</Box>
        <Box sx={{ display: 'flex', gap: '6px' }}>
          <Box sx={{ width: 44, textAlign: 'center' }}>EXACTOS</Box>
          <Box sx={{ width: 44, textAlign: 'center' }}>RESULT.</Box>
          <Box sx={{ width: 48, textAlign: 'center' }}>CRÉDITOS</Box>
        </Box>
      </Box>

      {rows.map((row, i) => (
        <Box key={row.id} sx={{
          display: 'flex', alignItems: 'center', gap: 0, px: 2, py: '10px', mb: '4px',
          bgcolor: i === 0 ? C.raised : C.card,
          border: `1px solid ${i < 3 ? C.lineStr : C.line}`,
          borderLeft: i < 3 ? `3px solid ${i === 0 ? C.volt : i === 1 ? C.ink1 : C.bronze}` : `3px solid transparent`,
          borderRadius: '3px',
        }}>
          <Box sx={{ fontFamily: MONO, fontSize: '0.9rem', width: 28, textAlign: 'center', flexShrink: 0 }}>
            {medals[i] ?? <span style={{ color: C.ink3, fontFamily: COND, fontSize: '0.65rem', letterSpacing: '0.06em' }}>#{i + 1}</span>}
          </Box>
          <Box sx={{ flex: 1, fontFamily: COND, fontSize: '0.85rem', color: C.cream, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.04em', ml: 1 }}>
            {row.username}
          </Box>
          <Box sx={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
            <Box sx={{ width: 44, textAlign: 'center' }}>
              <Box sx={{ fontFamily: DISP, fontSize: '0.9rem', color: C.volt, fontWeight: 700 }}>{row.exact_count ?? 0}</Box>
            </Box>
            <Box sx={{ width: 44, textAlign: 'center' }}>
              <Box sx={{ fontFamily: DISP, fontSize: '0.9rem', color: C.green, fontWeight: 700 }}>{row.correct_count ?? 0}</Box>
            </Box>
            <Box sx={{ width: 48, textAlign: 'center' }}>
              <Box sx={{ fontFamily: DISP, fontSize: '1rem', color: C.bronze, fontWeight: 700 }}>{row.total_credits ?? 0}</Box>
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
    <Box sx={{ minHeight: '100vh', bgcolor: C.bg, color: C.cream, pb: 8 }}>
      {/* Header */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 10,
        bgcolor: `rgba(6,24,39,0.97)`, backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${C.lineStr}` }}>

        {/* Bronze accent bar at top */}
        <Box sx={{ height: '3px', background: `linear-gradient(90deg, ${C.bronze}, ${C.volt} 60%, ${C.bronze})` }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, pt: '10px', pb: 0 }}>
          <Box component="button" onClick={() => { window.location.href = '/'; }}
            sx={{ background: 'none', border: 'none', color: C.bronze, cursor: 'pointer',
              fontFamily: COND, fontSize: '0.75rem', letterSpacing: '0.1em',
              p: '4px 8px', borderRadius: '3px', '&:hover': { bgcolor: C.raised } }}>
            ← HEXA
          </Box>
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Box sx={{ fontFamily: DISP, fontWeight: 700, fontSize: '1.1rem', color: C.cream, letterSpacing: '0.16em' }}>
              🏆 MUNDIAL 2026
            </Box>
            <Box sx={{ fontFamily: COND, fontSize: '0.62rem', color: C.bronze, letterSpacing: '0.18em', mt: '-2px' }}>
              {loading ? '···' : `FASE DE GRUPOS · ${matches.length} PARTIDOS`}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
            <Box sx={{ fontFamily: COND, fontSize: '0.6rem', color: C.volt, letterSpacing: '0.06em' }}>★ Exacto = +5 cr</Box>
            <Box sx={{ fontFamily: COND, fontSize: '0.6rem', color: C.ink2, letterSpacing: '0.06em' }}>✓ Resultado = tabla</Box>
          </Box>
        </Box>

        <Tabs value={tab} onChange={(_, v) => setTab(v)}
          sx={{ px: 2, minHeight: 40,
            '& .MuiTabs-indicator': { bgcolor: C.bronze, height: '2px' },
            '& .MuiTab-root': { fontFamily: COND, fontSize: '0.75rem', letterSpacing: '0.14em',
              color: C.ink2, minHeight: 40, textTransform: 'uppercase', fontWeight: 700,
              '&.Mui-selected': { color: C.cream } } }}>
          <Tab label="⚽ Predecir" />
          <Tab label="🏆 Ranking" />
        </Tabs>
      </Box>

      <Box sx={{ maxWidth: 560, mx: 'auto', px: 2, pt: 2 }}>
        {tab === 0 && (
          loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress size={32} sx={{ color: C.bronze }} />
            </Box>
          ) : fetchErr ? (
            <Box sx={{ textAlign: 'center', py: 8, fontFamily: COND, fontSize: '0.85rem',
              color: C.lava, letterSpacing: '0.08em' }}>
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
