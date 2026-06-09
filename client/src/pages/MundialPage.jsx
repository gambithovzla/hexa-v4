/**
 * MundialPage.jsx — FIFA World Cup 2026 prediction game.
 *
 * Route: /mundial  (public browse, auth to predict)
 *
 * UX: All matches visible at once grouped by date. Per match, tap
 * [Local] [Empate] [Visitante]. Click saves immediately.
 *
 * Scoring: correct H/A = +2 créditos, correct Draw = +3 créditos.
 */

import { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const GOLD  = '#f59e0b';
const GREEN = '#22c55e';
const RED   = '#ef4444';
const BLUE  = '#60a5fa';
const MUTED = '#475569';
const MONO  = "'JetBrains Mono','Share Tech Mono','Courier New',monospace";
const DISP  = "'Space Grotesk','Orbitron',system-ui,sans-serif";

// ── Flags ─────────────────────────────────────────────────────────────────
const ISO = {
  Argentina:'ar', Brazil:'br', Brasil:'br', France:'fr', England:'gb-eng',
  Spain:'es', Portugal:'pt', Germany:'de', Netherlands:'nl', Holland:'nl',
  Belgium:'be', Italy:'it', 'United States':'us', USMNT:'us', USA:'us',
  Mexico:'mx', México:'mx', Canada:'ca', Uruguay:'uy', Colombia:'co',
  Ecuador:'ec', Chile:'cl', Venezuela:'ve', Paraguay:'py', Peru:'pe',
  Bolivia:'bo', Morocco:'ma', Senegal:'sn', Nigeria:'ng', Cameroon:'cm',
  'Ivory Coast':'ci', "Côte d'Ivoire":'ci', "Cote d'Ivoire":'ci',
  Egypt:'eg', Ghana:'gh', 'South Africa':'za', Japan:'jp',
  'South Korea':'kr', 'Korea Republic':'kr', Australia:'au',
  Iran:'ir', 'IR Iran':'ir', 'Saudi Arabia':'sa', Qatar:'qa',
  China:'cn', 'China PR':'cn', Indonesia:'id', Turkey:'tr', Türkiye:'tr',
  Croatia:'hr', Denmark:'dk', Switzerland:'ch', Poland:'pl', Austria:'at',
  Serbia:'rs', 'Czech Republic':'cz', Czechia:'cz', Hungary:'hu',
  Slovakia:'sk', Scotland:'gb-sct', Wales:'gb-wls', 'New Zealand':'nz',
};

function Flag({ name, size = 32 }) {
  const iso = ISO[name];
  if (!iso) return (
    <span style={{ fontSize: size * 0.7, display: 'inline-flex', alignItems: 'center' }}>⚽</span>
  );
  return (
    <img
      src={`https://flagcdn.com/w${size * 2}/${iso}.png`}
      alt={name} width={size} height={Math.round(size * 0.68)}
      style={{ objectFit: 'cover', borderRadius: 3, display: 'block',
               boxShadow: '0 1px 4px rgba(0,0,0,0.5)', flexShrink: 0 }}
      onError={e => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

// ── Date section header ───────────────────────────────────────────────────
const MONTHS_ES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const DAYS_ES   = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];

function DateHeader({ dateStr }) {
  const d     = new Date(dateStr + 'T12:00:00Z');
  const today = new Date().toISOString().split('T')[0];
  const tom   = (() => { const t = new Date(); t.setDate(t.getDate()+1); return t.toISOString().split('T')[0]; })();
  const label = dateStr === today ? 'HOY' : dateStr === tom ? 'MAÑANA' : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 10px' }}>
      <div style={{
        background: label ? GOLD : '#1e2a44',
        borderRadius: 8, padding: '4px 12px',
        fontFamily: MONO, fontSize: '0.7rem', fontWeight: 700,
        color: label ? '#000' : '#94a3b8', letterSpacing: '0.08em', whiteSpace: 'nowrap',
      }}>
        {label ?? `${DAYS_ES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`}
      </div>
      <div style={{ flex: 1, height: 1, background: '#1e2a44' }} />
    </div>
  );
}

// ── Per-match prediction card ─────────────────────────────────────────────
function MatchCard({ match, token, onSaved }) {
  const { eventId, homeTeam, awayTeam, gameDate, gameTime, status, homeScore, awayScore, prediction } = match;

  const [selected, setSelected] = useState(prediction?.predicted_side ?? null);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState(null);
  const [flash, setFlash]       = useState(null); // 'ok' | 'err'

  const locked    = status === 'live' || status === 'final';
  const resolved  = prediction && (prediction.status === 'correct' || prediction.status === 'wrong');

  const kickoff = gameTime ? (() => {
    try {
      return new Date(gameTime).toLocaleTimeString('es', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York'
      }) + ' ET';
    } catch { return ''; }
  })() : '';

  async function pick(side) {
    if (locked || resolved) return;
    if (!token) { setErr('Inicia sesión para predecir.'); return; }
    if (selected === side) return; // already this choice
    setSelected(side);
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`${API_URL}/api/mundial/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ eventId, homeTeam, awayTeam, gameDate, predictedSide: side }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setFlash('ok'); setTimeout(() => setFlash(null), 1200);
      onSaved?.();
    } catch (e) { setErr(e.message); setSelected(prediction?.predicted_side ?? null); setFlash('err'); }
    finally { setSaving(false); }
  }

  // Status badge (shown when match is locked/resolved)
  const statusDisplay = (() => {
    if (resolved) {
      if (prediction.status === 'correct') return { label: `✓ +${prediction.credits_earned} créditos`, color: GREEN };
      return { label: '✗ Fallaste', color: RED };
    }
    if (locked)   return { label: status === 'live' ? '🔴 En Vivo' : `Final ${homeScore}–${awayScore}`, color: status === 'live' ? RED : MUTED };
    if (selected) return { label: '✓ Guardado', color: '#64748b' };
    return null;
  })();

  // Button config
  const btnStyle = (side) => {
    const isSel = selected === side;
    const isCorrect = resolved && prediction?.actual_side === side;
    const isWrong   = resolved && isSel && prediction?.actual_side !== side;
    let bg = '#0e1525', border = '#1e2a44', color = '#94a3b8';
    if (isCorrect && isSel) { bg = GREEN + '22'; border = GREEN; color = GREEN; }
    else if (isCorrect)     { bg = GREEN + '11'; border = GREEN + '44'; color = GREEN + 'cc'; }
    else if (isWrong)       { bg = RED + '18'; border = RED + '55'; color = RED; }
    else if (isSel && flash === 'ok') { bg = GOLD + '22'; border = GOLD; color = GOLD; }
    else if (isSel)         { bg = '#131c35'; border = GOLD + '77'; color = '#f1f5f9'; }
    return {
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 6,
      padding: '10px 6px',
      background: bg, border: `1.5px solid ${border}`,
      borderRadius: side === 'H' ? '10px 0 0 10px' : side === 'A' ? '0 10px 10px 0' : '0',
      cursor: locked || resolved ? 'default' : 'pointer',
      transition: 'all 0.15s',
      opacity: saving && selected !== side ? 0.6 : 1,
      minWidth: 0,
    };
  };

  return (
    <div style={{
      background: resolved && prediction.status === 'correct'
        ? 'linear-gradient(135deg, #0e1525 0%, #0f1f0f 100%)'
        : '#0e1525',
      border: `1px solid ${resolved && prediction.status === 'correct' ? GREEN + '33' : '#1e2a44'}`,
      borderRadius: 12, marginBottom: 8, overflow: 'hidden',
      boxShadow: resolved && prediction.status === 'correct' ? `0 0 14px ${GREEN}18` : undefined,
    }}>
      {/* top bar: time + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 14px 0', minHeight: 24 }}>
        <span style={{ fontFamily: MONO, fontSize: '0.65rem', color: '#475569' }}>
          {status === 'live' ? '🔴' : status === 'final' ? '✅' : '🕐'} {kickoff}
        </span>
        {statusDisplay && (
          <span style={{ fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700,
                         color: statusDisplay.color, letterSpacing: '0.05em' }}>
            {statusDisplay.label}
          </span>
        )}
      </div>

      {/* 3-button selector */}
      <div style={{ display: 'flex', margin: '8px 10px 10px', gap: 0 }}>
        {/* HOME */}
        <button style={btnStyle('H')} onClick={() => pick('H')} disabled={locked || resolved}>
          <Flag name={homeTeam} size={28} />
          <span style={{ fontFamily: DISP, fontSize: '0.7rem', fontWeight: 600,
                         color: 'inherit', textAlign: 'center', lineHeight: 1.2,
                         maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {homeTeam}
          </span>
        </button>

        {/* DRAW */}
        <button style={{ ...btnStyle('D'), minWidth: 56, flex: '0 0 56px' }}
                onClick={() => pick('D')} disabled={locked || resolved}>
          <span style={{ fontFamily: MONO, fontSize: '1rem', color: 'inherit' }}>═</span>
          <span style={{ fontFamily: MONO, fontSize: '0.6rem', letterSpacing: '0.05em', color: 'inherit' }}>
            EMPATE
          </span>
        </button>

        {/* AWAY */}
        <button style={btnStyle('A')} onClick={() => pick('A')} disabled={locked || resolved}>
          <Flag name={awayTeam} size={28} />
          <span style={{ fontFamily: DISP, fontSize: '0.7rem', fontWeight: 600,
                         color: 'inherit', textAlign: 'center', lineHeight: 1.2,
                         maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {awayTeam}
          </span>
        </button>
      </div>

      {err && (
        <div style={{ padding: '0 14px 8px', fontFamily: MONO, fontSize: '0.65rem', color: RED }}>
          {err}
        </div>
      )}
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────
function StatsBar({ matches, token }) {
  if (!token) return null;
  const total   = matches.length;
  const filled  = matches.filter(m => m.prediction).length;
  const correct = matches.filter(m => m.prediction?.status === 'correct').length;
  const wrong   = matches.filter(m => m.prediction?.status === 'wrong').length;
  const credits = matches.reduce((s, m) => s + (m.prediction?.credits_earned ?? 0), 0);
  const pct     = total ? Math.round((filled / total) * 100) : 0;

  return (
    <div style={{
      background: '#0e1525', border: '1px solid #1e2a44', borderRadius: 12,
      padding: '14px 16px', marginBottom: 20,
    }}>
      {/* progress bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontFamily: DISP, fontSize: '0.75rem', color: '#94a3b8' }}>
          {filled} / {total} predicciones
        </span>
        <span style={{ fontFamily: MONO, fontSize: '0.75rem', color: GOLD, fontWeight: 700 }}>
          {credits > 0 ? `+${credits} créditos` : `${pct}%`}
        </span>
      </div>
      <div style={{ height: 4, background: '#1e2a44', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: `linear-gradient(90deg, ${GOLD} 0%, ${GREEN} 100%)`,
          borderRadius: 2, transition: 'width 0.4s ease',
        }} />
      </div>
      {/* mini stats */}
      {(correct > 0 || wrong > 0) && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          {[
            { v: correct, label: 'correctas', c: GREEN },
            { v: wrong,   label: 'falladas',  c: RED   },
          ].map(s => (
            <span key={s.label} style={{ fontFamily: MONO, fontSize: '0.68rem', color: s.c }}>
              {s.v} {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Leaderboard ────────────────────────────────────────────────────────────
function Leaderboard() {
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/api/mundial/leaderboard`)
      .then(r => r.json()).then(d => { if (d.success) setRows(d.leaderboard ?? []); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: MUTED, fontFamily: MONO, fontSize: '0.8rem' }}>Cargando ranking...</div>;
  if (!rows.length) return (
    <div style={{ padding: 56, textAlign: 'center', color: MUTED, fontFamily: DISP }}>
      <div style={{ fontSize: '2rem', marginBottom: 8 }}>🏆</div>
      El ranking se completará con las primeras predicciones.
    </div>
  );

  const medals = ['🥇','🥈','🥉'];
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 60px 80px', gap: 8,
                    padding: '6px 10px', fontFamily: MONO, fontSize: '0.62rem',
                    color: '#334155', letterSpacing: '0.07em', marginBottom: 4 }}>
        <span>#</span><span>USUARIO</span>
        <span style={{ textAlign: 'center' }}>✓ OK</span>
        <span style={{ textAlign: 'right' }}>CRÉDITOS</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.id} style={{
          display: 'grid', gridTemplateColumns: '28px 1fr 60px 80px', gap: 8,
          alignItems: 'center', padding: '11px 10px', borderRadius: 10, marginBottom: 4,
          background: i < 3
            ? `linear-gradient(90deg, ${[GOLD+'12',`#9ca3af0e`,`#b4530910`][i]} 0%, transparent 100%)`
            : 'transparent',
          border: `1px solid ${i < 3 ? [GOLD+'33','#9ca3af18','#b4530918'][i] : '#1e2a4418'}`,
        }}>
          <span style={{ fontFamily: MONO, fontSize: i < 3 ? '1rem' : '0.75rem', textAlign: 'center' }}>
            {medals[i] ?? i + 1}
          </span>
          <div>
            <div style={{ fontFamily: DISP, fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>
              {r.username}
            </div>
            <div style={{ fontFamily: MONO, fontSize: '0.6rem', color: '#475569' }}>
              {r.resolved_count ?? 0} resueltos
            </div>
          </div>
          <span style={{ fontFamily: MONO, fontSize: '0.85rem', color: GREEN, textAlign: 'center' }}>
            {r.correct_count ?? 0}
          </span>
          <span style={{ fontFamily: MONO, fontSize: '0.85rem', fontWeight: 700, color: GOLD, textAlign: 'right' }}>
            {r.total_credits ?? 0}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
const TABS = [
  { id: 'partidos', label: '⚽ PREDECIR' },
  { id: 'ranking',  label: '🏆 RANKING'  },
];

export default function MundialPage({ token, lang = 'es' }) {
  const [tab, setTab]         = useState('partidos');
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const [refreshKey, setRefresh] = useState(0);

  useEffect(() => {
    setLoading(true); setErr(null);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API_URL}/api/mundial/all-matches`, { headers })
      .then(r => r.json())
      .then(d => {
        if (d.success) setMatches(d.matches ?? []);
        else setErr(d.error ?? 'Error cargando partidos');
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [token, refreshKey]);

  // Group matches by date
  const byDate = {};
  for (const m of matches) {
    const k = m.gameDate ?? 'unknown';
    if (!byDate[k]) byDate[k] = [];
    byDate[k].push(m);
  }
  const sortedDates = Object.keys(byDate).sort();

  const totalPreds = matches.filter(m => m.prediction).length;

  return (
    <div style={{ minHeight: '100dvh', background: 'linear-gradient(180deg,#06080f 0%,#0a0e1a 100%)', color: '#f1f5f9' }}>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
        button:active { transform: scale(0.97); }
        ::-webkit-scrollbar { width:4px; background:transparent }
        ::-webkit-scrollbar-thumb { background:#1e2a44; border-radius:2px }
      `}</style>

      {/* ── Hero ── */}
      <div style={{
        background: 'linear-gradient(135deg,#0f172a 0%,#1a1f35 60%,#0f172a 100%)',
        borderBottom: `1px solid ${GOLD}33`,
        padding: '22px 20px 18px', textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        {/* glow */}
        <div style={{ position: 'absolute', top: -50, left: '50%', transform: 'translateX(-50%)',
                      width: 280, height: 180, borderRadius: '50%', pointerEvents: 'none',
                      background: `radial-gradient(ellipse, ${GOLD}15 0%, transparent 70%)` }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: '2rem', lineHeight: 1, marginBottom: 4 }}>🏆</div>
          <h1 style={{
            fontFamily: DISP, fontSize: 'clamp(1.4rem,5vw,2rem)', fontWeight: 900,
            letterSpacing: '0.05em', margin: 0,
            background: `linear-gradient(135deg,${GOLD} 0%,#fde68a 50%,#b45309 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>MUNDIAL 2026</h1>
          <p style={{ fontFamily: DISP, fontSize: '0.78rem', color: '#64748b', margin: '5px 0 0' }}>
            Predice cada partido · Gana créditos Hexa
          </p>
          {/* scoring legend */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {[
              { t: '✓ Resultado correcto H/V = +2 créditos' },
              { t: '✓ Empate correcto = +3 créditos' },
            ].map(x => (
              <span key={x.t} style={{
                fontFamily: MONO, fontSize: '0.64rem', color: '#94a3b8',
                background: '#0e1525', border: '1px solid #1e2a44',
                borderRadius: 100, padding: '3px 10px',
              }}>{x.t}</span>
            ))}
          </div>
          {/* prediction counter (only if logged in) */}
          {token && matches.length > 0 && (
            <div style={{ marginTop: 10, fontFamily: MONO, fontSize: '0.72rem', color: totalPreds > 0 ? GREEN : '#475569' }}>
              {totalPreds} / {matches.length} predicciones completadas
            </div>
          )}
        </div>
      </div>

      {/* back link */}
      <div style={{ padding: '8px 20px 0' }}>
        <button onClick={() => { window.location.href = '/'; }}
          style={{ fontFamily: MONO, fontSize: '0.68rem', color: '#475569',
                   background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
          ← HEXA
        </button>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e2a44', margin: '8px 20px 0' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700,
            letterSpacing: '0.07em', padding: '11px 4px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: tab === t.id ? GOLD : '#475569',
            borderBottom: `2px solid ${tab === t.id ? GOLD : 'transparent'}`,
            transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Content ── */}
      <div style={{ padding: '16px 14px 60px', maxWidth: 640, margin: '0 auto', animation: 'fadeUp 0.3s ease' }}>
        {tab === 'partidos' && (
          <>
            {loading ? (
              <div style={{ padding: 60, textAlign: 'center', color: '#475569', fontFamily: DISP }}>
                <div style={{ fontSize: '2rem', marginBottom: 10 }}>⏳</div>
                Cargando el calendario del Mundial...
              </div>
            ) : err ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ color: RED, fontFamily: MONO, fontSize: '0.8rem', marginBottom: 16 }}>{err}</div>
                <button onClick={() => setRefresh(k => k+1)} style={{
                  fontFamily: MONO, fontSize: '0.72rem', color: GOLD, background: 'transparent',
                  border: `1px solid ${GOLD}55`, borderRadius: 8, padding: '8px 20px', cursor: 'pointer',
                }}>Reintentar</button>
              </div>
            ) : matches.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center', color: '#475569', fontFamily: DISP }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>📅</div>
                El calendario del Mundial aún no está disponible.
              </div>
            ) : (
              <>
                {!token && (
                  <div style={{
                    background: `${GOLD}15`, border: `1px solid ${GOLD}44`,
                    borderRadius: 10, padding: '12px 16px', marginBottom: 16,
                    fontFamily: DISP, fontSize: '0.82rem', color: '#fde68a', textAlign: 'center',
                  }}>
                    🔐 Inicia sesión para guardar tus predicciones y ganar créditos
                  </div>
                )}

                {/* Stats bar */}
                <StatsBar matches={matches} token={token} />

                {/* All matches grouped by date */}
                {sortedDates.map(dateStr => (
                  <div key={dateStr}>
                    <DateHeader dateStr={dateStr} />
                    {byDate[dateStr].map(m => (
                      <MatchCard
                        key={m.eventId}
                        match={m}
                        token={token}
                        onSaved={() => setRefresh(k => k + 1)}
                      />
                    ))}
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {tab === 'ranking' && <Leaderboard />}
      </div>
    </div>
  );
}
