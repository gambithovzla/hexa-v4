/**
 * MundialPage.jsx — FIFA World Cup 2026 prediction game.
 *
 * Route: /mundial  (public viewing, auth required to predict)
 * Tabs: PARTIDOS | MIS PICKS | RANKING
 *
 * Scoring: exact score = +5 créditos, correct result = +2 créditos, wrong = 0.
 */

import { useState, useEffect, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Design tokens ──────────────────────────────────────────────────────────
const GOLD   = '#f59e0b';
const GOLD_D = '#b45309';
const GREEN  = '#22c55e';
const RED    = '#ef4444';
const BLUE   = '#3b82f6';
const MONO   = "'JetBrains Mono','Share Tech Mono','Courier New',monospace";
const DISP   = "'Space Grotesk','Orbitron',system-ui,sans-serif";

// ── Flag helpers ───────────────────────────────────────────────────────────
const ISO = {
  Argentina:'ar', Brazil:'br', Brasil:'br', France:'fr', England:'gb-eng',
  Spain:'es', Portugal:'pt', Germany:'de', Netherlands:'nl', Holland:'nl',
  Belgium:'be', Italy:'it', 'United States':'us', USMNT:'us', USA:'us',
  Mexico:'mx', Canada:'ca', Uruguay:'uy', Colombia:'co', Ecuador:'ec',
  Chile:'cl', Venezuela:'ve', Paraguay:'py', Peru:'pe', Bolivia:'bo',
  Morocco:'ma', Senegal:'sn', Nigeria:'ng', Cameroon:'cm',
  'Ivory Coast':'ci', "Côte d'Ivoire":'ci', "Cote d'Ivoire":'ci',
  Egypt:'eg', Ghana:'gh', 'South Africa':'za', Japan:'jp',
  'South Korea':'kr', 'Korea Republic':'kr', Australia:'au',
  Iran:'ir', 'IR Iran':'ir', 'Saudi Arabia':'sa', Qatar:'qa',
  China:'cn', 'China PR':'cn', Indonesia:'id', Turkey:'tr', Türkiye:'tr',
  Croatia:'hr', Denmark:'dk', Switzerland:'ch', Poland:'pl', Austria:'at',
  Serbia:'rs', 'Czech Republic':'cz', Czechia:'cz', Hungary:'hu',
  Slovakia:'sk', Scotland:'gb-sct', Wales:'gb-wls', 'New Zealand':'nz',
};

function Flag({ team, size = 40 }) {
  const iso = ISO[team];
  if (!iso) return (
    <span style={{ fontSize: size * 0.65, display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: Math.round(size * 0.67) }}>
      ⚽
    </span>
  );
  return (
    <img
      src={`https://flagcdn.com/w${size * 2}/${iso}.png`}
      alt={team}
      width={size}
      height={Math.round(size * 0.67)}
      style={{ objectFit: 'cover', borderRadius: 4, display: 'block', boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}
      onError={e => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

// ── Status badge ──────────────────────────────────────────────────────────
function StatusBadge({ status, credits }) {
  const cfg = {
    exact:   { label: `⭐ EXACTO +${credits ?? 5} créditos`, bg: GOLD,  color: '#000' },
    correct: { label: `✓ CORRECTO +${credits ?? 2} créditos`, bg: GREEN, color: '#000' },
    wrong:   { label: '✗ FALLASTE',           bg: '#1f2937', color: RED     },
    pending: { label: '⏳ PENDIENTE',          bg: '#1f2937', color: BLUE    },
    locked:  { label: '🔒 BLOQUEADO',          bg: '#1f2937', color: MUTED   },
  };
  const c = cfg[status];
  if (!c) return null;
  return (
    <span style={{
      fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700,
      background: c.bg, color: c.color,
      padding: '3px 10px', borderRadius: 100,
      letterSpacing: '0.08em', whiteSpace: 'nowrap',
      animation: status === 'exact' ? 'pulseGold 2s ease-in-out infinite' : undefined,
    }}>
      {c.label}
    </span>
  );
}

// ── Score number input ─────────────────────────────────────────────────────
function ScoreBox({ value, onChange, disabled }) {
  return (
    <input
      type="number"
      min={0}
      max={20}
      value={value}
      onChange={e => {
        const v = parseInt(e.target.value, 10);
        if (!isNaN(v) && v >= 0 && v <= 20) onChange(v);
        else if (e.target.value === '') onChange('');
      }}
      disabled={disabled}
      inputMode="numeric"
      style={{
        width: 52, height: 52, textAlign: 'center',
        fontFamily: MONO, fontSize: '1.5rem', fontWeight: 700,
        background: disabled ? '#0e1220' : '#131c35',
        color: disabled ? MUTED : '#f1f5f9',
        border: `2px solid ${disabled ? '#1e2a44' : GOLD + '66'}`,
        borderRadius: 10,
        outline: 'none', appearance: 'textfield', MozAppearance: 'textfield',
        cursor: disabled ? 'default' : 'text',
        transition: 'border-color 0.15s',
      }}
      onFocus={e => { if (!disabled) e.target.style.borderColor = GOLD; }}
      onBlur={e => { e.target.style.borderColor = disabled ? '#1e2a44' : GOLD + '66'; }}
    />
  );
}

// ── Match card ────────────────────────────────────────────────────────────
function MatchCard({ match, token, onPredicted, lang }) {
  const { id, homeTeam, awayTeam, gameDate, status, homeScore, awayScore, prediction } = match;
  const [home, setHome] = useState(prediction?.predicted_home ?? '');
  const [away, setAway] = useState(prediction?.predicted_away ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState(null);
  const [saved, setSaved]   = useState(false);

  const locked = status === 'live' || status === 'final';
  const hasPred = prediction != null;
  const resolved = prediction && ['exact', 'correct', 'wrong'].includes(prediction.status);

  async function submit() {
    if (!token) { setErr('Inicia sesión para predecir.'); return; }
    if (home === '' || away === '') { setErr('Ingresa ambos marcadores.'); return; }
    setSaving(true); setErr(null);
    try {
      const r = await fetch(`${API_URL}/api/mundial/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ eventId: id, homeTeam, awayTeam, gameDate, predictedHome: home, predictedAway: away }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
      onPredicted?.();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const fmtTime = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
    } catch { return ''; }
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0e1525 0%, #111827 100%)',
      border: `1px solid ${resolved && prediction.status === 'exact' ? GOLD + '55' : resolved && prediction.status === 'correct' ? GREEN + '44' : '#1e2a44'}`,
      borderRadius: 16,
      padding: '18px 20px 14px',
      marginBottom: 12,
      boxShadow: resolved && prediction.status === 'exact' ? `0 0 20px ${GOLD}22` : '0 2px 12px rgba(0,0,0,0.4)',
      transition: 'box-shadow 0.3s',
    }}>
      {/* time + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontFamily: MONO, fontSize: '0.7rem', color: '#64748b', letterSpacing: '0.05em' }}>
          {status === 'live' ? '🔴 EN VIVO' : status === 'final' ? '✅ FINAL' : `🕐 ${fmtTime(gameDate)}`}
        </span>
        {hasPred && <StatusBadge status={prediction.status} credits={prediction.credits_earned} />}
      </div>

      {/* teams + score inputs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* home */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <Flag team={homeTeam} size={40} />
          <span style={{ fontFamily: DISP, fontSize: '0.78rem', color: '#cbd5e1', textAlign: 'center', fontWeight: 600, maxWidth: 90, lineHeight: 1.2 }}>
            {homeTeam}
          </span>
        </div>

        {/* score area */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {status === 'final' ? (
              <>
                <span style={{ fontFamily: MONO, fontSize: '1.6rem', fontWeight: 700, color: '#f1f5f9', minWidth: 32, textAlign: 'center' }}>{homeScore ?? '?'}</span>
                <span style={{ color: MUTED, fontSize: '1.2rem' }}>–</span>
                <span style={{ fontFamily: MONO, fontSize: '1.6rem', fontWeight: 700, color: '#f1f5f9', minWidth: 32, textAlign: 'center' }}>{awayScore ?? '?'}</span>
              </>
            ) : (
              <>
                <ScoreBox value={home} onChange={setHome} disabled={locked || resolved} />
                <span style={{ color: MUTED, fontSize: '1.4rem', fontWeight: 300, userSelect: 'none' }}>:</span>
                <ScoreBox value={away} onChange={setAway} disabled={locked || resolved} />
              </>
            )}
          </div>
          {/* prediction score (when resolved) */}
          {resolved && (
            <div style={{ fontFamily: MONO, fontSize: '0.7rem', color: MUTED, textAlign: 'center' }}>
              tu pick: {prediction.predicted_home} – {prediction.predicted_away}
            </div>
          )}
          {/* action */}
          {!locked && !resolved && (
            <button
              onClick={submit}
              disabled={saving}
              style={{
                marginTop: 4,
                fontFamily: MONO, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em',
                background: hasPred ? '#1e3a5f' : GOLD, color: hasPred ? BLUE : '#000',
                border: 'none', borderRadius: 8,
                padding: '7px 18px', cursor: saving ? 'wait' : 'pointer',
                transition: 'all 0.15s',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? '...' : saved ? '✓ GUARDADO' : hasPred ? 'ACTUALIZAR' : 'PREDECIR'}
            </button>
          )}
        </div>

        {/* away */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <Flag team={awayTeam} size={40} />
          <span style={{ fontFamily: DISP, fontSize: '0.78rem', color: '#cbd5e1', textAlign: 'center', fontWeight: 600, maxWidth: 90, lineHeight: 1.2 }}>
            {awayTeam}
          </span>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 8, fontFamily: MONO, fontSize: '0.7rem', color: RED, textAlign: 'center' }}>
          {err}
        </div>
      )}
    </div>
  );
}

// ── Date navigator ─────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function offsetDate(base, days) {
  const d = new Date(base + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function fmtDateLabel(iso) {
  const today = todayStr();
  const tom   = offsetDate(today, 1);
  if (iso === today) return 'HOY';
  if (iso === tom)   return 'MAÑANA';
  const [, m, d] = iso.split('-');
  const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]}`;
}

// ── PARTIDOS tab ──────────────────────────────────────────────────────────
function PartidosTab({ token, lang, refreshKey }) {
  const [date, setDate]     = useState(todayStr());
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setLoading(true);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API_URL}/api/mundial/matches?date=${date}`, { headers })
      .then(r => r.json())
      .then(d => { if (d.success) setMatches(d.matches ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [date, token, refresh, refreshKey]);

  const dates = Array.from({ length: 9 }, (_, i) => offsetDate(offsetDate(todayStr(), -1), i));

  return (
    <div>
      {/* date nav */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 16,
                    scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        {dates.map(d => (
          <button
            key={d}
            onClick={() => setDate(d)}
            style={{
              flexShrink: 0,
              fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em',
              padding: '7px 14px', borderRadius: 100,
              background: date === d ? GOLD : '#111827',
              color: date === d ? '#000' : '#64748b',
              border: `1px solid ${date === d ? GOLD : '#1e2a44'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {fmtDateLabel(d)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748b', fontFamily: MONO, fontSize: '0.8rem' }}>
          Cargando partidos...
        </div>
      ) : matches.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748b', fontFamily: DISP }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>📅</div>
          <div>No hay partidos del Mundial para esta fecha.</div>
        </div>
      ) : (
        matches.map(m => (
          <MatchCard
            key={m.id}
            match={m}
            token={token}
            lang={lang}
            onPredicted={() => setRefresh(r => r + 1)}
          />
        ))
      )}
    </div>
  );
}

// ── MIS PICKS tab ─────────────────────────────────────────────────────────
function MisPicksTab({ token, lang, refreshKey }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${API_URL}/api/mundial/my-predictions`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, refreshKey]);

  if (!token) return (
    <div style={{ textAlign: 'center', padding: 64, color: '#64748b', fontFamily: DISP }}>
      <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔒</div>
      <div style={{ marginBottom: 8 }}>Inicia sesión para ver tus picks.</div>
    </div>
  );
  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: '#64748b', fontFamily: MONO, fontSize: '0.8rem' }}>Cargando...</div>;
  if (!data) return null;

  const { predictions = [], summary = {} } = data;

  return (
    <div>
      {/* summary */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Créditos ganados', val: summary.total_credits ?? 0, color: GOLD },
          { label: '⭐ Exactos', val: summary.exact ?? 0, color: GOLD },
          { label: '✓ Correctos', val: summary.correct ?? 0, color: GREEN },
          { label: '✗ Fallaste', val: summary.wrong ?? 0, color: RED },
          { label: '⏳ Pendientes', val: summary.pending ?? 0, color: '#64748b' },
        ].map(s => (
          <div key={s.label} style={{
            flex: '1 1 80px', minWidth: 80,
            background: '#0e1525', border: '1px solid #1e2a44',
            borderRadius: 12, padding: '12px 16px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: MONO, fontSize: '1.4rem', fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontFamily: DISP, fontSize: '0.65rem', color: '#64748b', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* predictions list */}
      {predictions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#64748b', fontFamily: DISP }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>⚽</div>
          Aún no tienes predicciones. ¡Ve a PARTIDOS y predice!
        </div>
      ) : (
        predictions.map(p => {
          const statusColors = { exact: GOLD, correct: GREEN, wrong: RED, pending: '#64748b' };
          const statusLabels = { exact: '⭐ EXACTO', correct: '✓ CORRECTO', wrong: '✗ FALLASTE', pending: '⏳ PENDIENTE' };
          return (
            <div key={p.id} style={{
              background: '#0e1525', border: `1px solid ${p.status === 'exact' ? GOLD + '44' : '#1e2a44'}`,
              borderRadius: 12, padding: '14px 16px', marginBottom: 10,
              boxShadow: p.status === 'exact' ? `0 0 16px ${GOLD}20` : undefined,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: DISP, fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>
                    {p.home_team} vs {p.away_team}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: '0.72rem', color: '#64748b' }}>
                    {p.game_date} · Tu pick: <span style={{ color: '#93c5fd' }}>{p.predicted_home}–{p.predicted_away}</span>
                    {p.actual_home != null && (
                      <> · Resultado: <span style={{ color: '#f1f5f9' }}>{p.actual_home}–{p.actual_away}</span></>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{
                    fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700,
                    color: statusColors[p.status] ?? '#64748b',
                  }}>
                    {statusLabels[p.status] ?? p.status}
                  </span>
                  {p.credits_earned > 0 && (
                    <span style={{ fontFamily: MONO, fontSize: '0.75rem', color: GOLD, fontWeight: 700 }}>
                      +{p.credits_earned} créditos
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── RANKING tab ────────────────────────────────────────────────────────────
function RankingTab({ lang }) {
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/api/mundial/leaderboard`)
      .then(r => r.json())
      .then(d => { if (d.success) setRows(d.leaderboard ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const medals = ['🥇', '🥈', '🥉'];

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: '#64748b', fontFamily: MONO, fontSize: '0.8rem' }}>Cargando ranking...</div>;

  if (!rows.length) return (
    <div style={{ textAlign: 'center', padding: 64, color: '#64748b', fontFamily: DISP }}>
      <div style={{ fontSize: '2rem', marginBottom: 8 }}>🏆</div>
      El ranking se llenará con las primeras predicciones.
    </div>
  );

  return (
    <div>
      {/* headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 60px 60px 80px', gap: 8, padding: '8px 12px',
                    fontFamily: MONO, fontSize: '0.64rem', color: '#475569', letterSpacing: '0.07em', marginBottom: 4 }}>
        <span>#</span><span>USUARIO</span><span style={{ textAlign: 'center' }}>⭐ EX</span>
        <span style={{ textAlign: 'center' }}>✓ OK</span><span style={{ textAlign: 'right' }}>CRÉDITOS</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.id}
          style={{
            display: 'grid', gridTemplateColumns: '32px 1fr 60px 60px 80px', gap: 8,
            alignItems: 'center', padding: '12px 12px',
            background: i < 3 ? `linear-gradient(90deg, ${['rgba(245,158,11,0.08)','rgba(156,163,175,0.06)','rgba(180,83,9,0.06)'][i]} 0%, transparent 100%)` : 'transparent',
            borderRadius: 10, marginBottom: 4,
            border: `1px solid ${i < 3 ? ['#f59e0b33','#9ca3af22','#b4530922'][i] : '#1e2a4422'}`,
          }}
        >
          <span style={{ fontFamily: MONO, fontSize: i < 3 ? '1.1rem' : '0.8rem', textAlign: 'center' }}>
            {medals[i] ?? i + 1}
          </span>
          <div>
            <div style={{ fontFamily: DISP, fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0' }}>
              {r.username}
            </div>
            <div style={{ fontFamily: MONO, fontSize: '0.62rem', color: '#475569' }}>
              {r.resolved_count ?? 0} predicciones resueltas
            </div>
          </div>
          <span style={{ fontFamily: MONO, fontSize: '0.9rem', fontWeight: 700, color: GOLD, textAlign: 'center' }}>
            {r.exact_count ?? 0}
          </span>
          <span style={{ fontFamily: MONO, fontSize: '0.9rem', color: GREEN, textAlign: 'center' }}>
            {r.correct_count ?? 0}
          </span>
          <span style={{ fontFamily: MONO, fontSize: '0.9rem', fontWeight: 700, color: GOLD, textAlign: 'right' }}>
            {r.total_credits ?? 0}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function MundialPage({ token, lang = 'es' }) {
  const [tab, setTab]           = useState('partidos');
  const [refreshKey, setRefresh] = useState(0);

  const tabs = [
    { id: 'partidos', label: '⚽ PARTIDOS' },
    { id: 'picks',    label: '🎯 MIS PICKS' },
    { id: 'ranking',  label: '🏆 RANKING'   },
  ];

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(180deg, #06080f 0%, #0a0e1a 100%)',
      color: '#f1f5f9',
      overflowX: 'hidden',
    }}>
      <style>{`
        @keyframes pulseGold {
          0%,100% { box-shadow: 0 0 6px rgba(245,158,11,0.3); }
          50% { box-shadow: 0 0 18px rgba(245,158,11,0.7); }
        }
        @keyframes slideDown {
          from { opacity:0; transform:translateY(-12px); }
          to   { opacity:1; transform:translateY(0); }
        }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
        ::-webkit-scrollbar { height: 3px; background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e2a44; border-radius: 2px; }
      `}</style>

      {/* ── Hero ── */}
      <div style={{
        background: `linear-gradient(135deg, #0f172a 0%, #1a1f35 50%, #0f172a 100%)`,
        borderBottom: `1px solid ${GOLD}33`,
        padding: '28px 20px 24px',
        textAlign: 'center',
        animation: 'slideDown 0.4s ease',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* background glow */}
        <div style={{
          position: 'absolute', top: -60, left: '50%', transform: 'translateX(-50%)',
          width: 300, height: 200, borderRadius: '50%',
          background: `radial-gradient(ellipse, ${GOLD}18 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: '2.4rem', lineHeight: 1, marginBottom: 6 }}>🏆</div>
          <h1 style={{
            fontFamily: DISP, fontSize: 'clamp(1.5rem, 5vw, 2.2rem)', fontWeight: 900,
            letterSpacing: '0.04em', margin: 0,
            background: `linear-gradient(135deg, ${GOLD} 0%, #fde68a 50%, ${GOLD_D} 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            MUNDIAL 2026
          </h1>
          <p style={{ fontFamily: DISP, fontSize: '0.82rem', color: '#64748b', margin: '6px 0 0' }}>
            Predice el marcador exacto · Gana créditos
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
            {[
              { icon: '⭐', text: 'Marcador exacto = +5 créditos' },
              { icon: '✓',  text: 'Resultado correcto = +2 créditos' },
            ].map(t => (
              <span key={t.icon} style={{
                fontFamily: MONO, fontSize: '0.68rem', color: '#94a3b8',
                background: '#0e1525', border: '1px solid #1e2a44',
                borderRadius: 100, padding: '4px 12px', letterSpacing: '0.04em',
              }}>
                {t.icon} {t.text}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── back button ── */}
      <div style={{ padding: '10px 20px 0' }}>
        <button
          onClick={() => { window.location.href = '/'; }}
          style={{
            fontFamily: MONO, fontSize: '0.7rem', color: '#475569',
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '4px 0', letterSpacing: '0.04em',
          }}
        >
          ← HEXA
        </button>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', borderBottom: `1px solid #1e2a44`, margin: '8px 20px 0' }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700,
              letterSpacing: '0.07em', padding: '12px 4px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: tab === t.id ? GOLD : '#475569',
              borderBottom: `2px solid ${tab === t.id ? GOLD : 'transparent'}`,
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={{ padding: '20px 16px 40px', maxWidth: 600, margin: '0 auto', animation: 'slideDown 0.25s ease' }}>
        {tab === 'partidos' && (
          <PartidosTab token={token} lang={lang} refreshKey={refreshKey} />
        )}
        {tab === 'picks' && (
          <MisPicksTab token={token} lang={lang} refreshKey={refreshKey} />
        )}
        {tab === 'ranking' && (
          <RankingTab lang={lang} />
        )}
      </div>
    </div>
  );
}
