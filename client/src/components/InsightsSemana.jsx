/**
 * InsightsSemana.jsx
 * Public weekly showcase of curated picks — H.E.X.A. carta de presentación.
 * Admin-only: pick curator modal to select & publish insights.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../store/authStore';
import { C, BARLOW, MONO, SANS } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Colors ──────────────────────────────────────────────────────────────────

const G      = '#00FF88';
const GDIM   = 'rgba(0,255,136,0.07)';
const GLINE  = 'rgba(0,255,136,0.28)';
const GGLOW  = 'rgba(0,255,136,0.14)';
const AMBER  = '#FFB800';
const ADIM   = 'rgba(255,184,0,0.07)';
const ALINE  = 'rgba(255,184,0,0.28)';
const AGLOW  = 'rgba(255,184,0,0.10)';
const CARD_BG = '#05080D';

// ─── MLB team ID map for logos ────────────────────────────────────────────────

const MLB_TEAM_IDS = {
  NYY: 147, BOS: 111, LAD: 119, SF: 137,  SFG: 137,
  CHC: 112, CWS: 145, HOU: 117, ATL: 144, NYM: 121,
  PHI: 143, MIA: 146, WSH: 120, WAS: 120, PIT: 134,
  STL: 138, CIN: 113, MIL: 158, CLE: 114, DET: 116,
  KC:  118, KCR: 118, MIN: 142, TEX: 140, SEA: 136,
  ATH: 133, OAK: 133, LAA: 108, ARI: 109, COL: 115,
  SD:  135, SDP: 135, TB:  139, TBR: 139, TOR: 141,
  BAL: 110,
};

function getTeamLogoUrl(abbr) {
  if (!abbr) return null;
  const id = MLB_TEAM_IDS[abbr.toUpperCase().trim()];
  return id ? `https://www.mlbstatic.com/team-logos/${id}.svg` : null;
}

function derivePickTeam(detail, awayTeam, homeTeam) {
  if (!detail) return homeTeam || awayTeam;
  const up = detail.toUpperCase();
  if (awayTeam && up.includes(awayTeam.toUpperCase())) return awayTeam;
  if (homeTeam && up.includes(homeTeam.toUpperCase())) return homeTeam;
  return homeTeam || awayTeam;
}

// ─── Player headshot hook ─────────────────────────────────────────────────────

const _playerCache = {};

function usePlayerImage(propDetail) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!propDetail) { setUrl(null); return; }

    // Parse "Aaron Judge Over 1.5 Total Bases" → "Aaron Judge"
    const match = propDetail.match(/^([A-Za-zÀ-ÿ'\-\.\s]+?)(?:\s+(?:Over|Under|To Hit|To Score)\s)/i);
    const name = match ? match[1].trim() : propDetail.split(' ').slice(0, 2).join(' ');

    if (!name || name.length < 4) { setUrl(null); return; }

    if (_playerCache[name] !== undefined) { setUrl(_playerCache[name]); return; }

    const encoded = encodeURIComponent(name);
    fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encoded}&limit=1`)
      .then(r => r.json())
      .then(d => {
        const id = d.people?.[0]?.id;
        if (id) {
          const imgUrl = `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png/people/${id}/headshot/67/current`;
          _playerCache[name] = imgUrl;
          setUrl(imgUrl);
        } else {
          _playerCache[name] = null;
        }
      })
      .catch(() => { _playerCache[name] = null; });
  }, [propDetail]);

  return url;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function shiftWeek(weekStart, delta) {
  const d = new Date(weekStart + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(weekStart) {
  const from = new Date(weekStart + 'T12:00:00Z');
  const to   = new Date(weekStart + 'T12:00:00Z');
  to.setUTCDate(to.getUTCDate() + 6);
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return `${from.toLocaleDateString('es-ES', opts)} — ${to.toLocaleDateString('es-ES', { ...opts, year: 'numeric' })}`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function resultLabel(result) {
  if (result === 'win')  return 'WIN';
  if (result === 'loss') return 'LOSS';
  if (result === 'push') return 'PUSH';
  return result?.toUpperCase() || '—';
}

function resultColor(result) {
  if (result === 'win')  return C.green;
  if (result === 'loss') return C.red;
  if (result === 'push') return C.cyan;
  return C.textMuted;
}

// ─── SemanaBanner ────────────────────────────────────────────────────────────

function SemanaBanner({ insights, weekLabel, isCurrentWeek, weekStart, onPrev, onNext }) {
  const wins   = insights.filter(i => i.type === 'acierto').length;
  const fallos = insights.filter(i => i.type === 'fallo').length;

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: '#030608',
      border: `1px solid ${GLINE}`,
      borderTop: `3px solid ${G}`,
      padding: '28px 24px 22px',
      boxShadow: `0 0 70px ${GGLOW}, 0 0 2px rgba(0,255,136,0.15)`,
    }}>
      {/* Background radial glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 80% 120% at 50% 110%, rgba(0,255,136,0.07) 0%, transparent 65%)',
      }} />

      {/* Scan lines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.03,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,1) 2px, rgba(0,255,136,1) 3px)',
        backgroundSize: '100% 6px',
      }} />

      <div style={{ position: 'relative' }}>
        {/* Label */}
        <div style={{
          fontFamily: MONO, fontSize: '9px', letterSpacing: '4px',
          color: 'rgba(0,255,136,0.55)', marginBottom: '8px',
          textTransform: 'uppercase',
        }}>
          ◈ H.E.X.A. SYSTEM INTELLIGENCE · PICKS VERIFICADOS
        </div>

        {/* Week nav + title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button
            onClick={onPrev}
            style={{
              background: 'transparent', border: `1px solid ${GLINE}`,
              color: 'rgba(0,255,136,0.5)', fontFamily: MONO, fontSize: '10px',
              padding: '5px 12px', cursor: 'pointer', letterSpacing: '1px',
              flexShrink: 0,
            }}
          >
            ◀ PREV
          </button>

          <div style={{ flex: 1, minWidth: '180px' }}>
            <div style={{
              fontFamily: BARLOW, fontWeight: 800,
              fontSize: 'clamp(18px, 3.5vw, 28px)',
              color: '#FFFFFF', letterSpacing: '1.5px', lineHeight: 1.1,
            }}>
              {isCurrentWeek ? 'SEMANA ACTUAL' : 'SEMANA'}
            </div>
            <div style={{
              fontFamily: MONO, fontSize: '11px', color: G,
              letterSpacing: '1px', marginTop: '4px', opacity: 0.85,
            }}>
              {weekLabel.toUpperCase()}
            </div>
          </div>

          <button
            onClick={onNext}
            disabled={isCurrentWeek}
            style={{
              background: 'transparent', border: `1px solid ${isCurrentWeek ? 'rgba(255,255,255,0.08)' : GLINE}`,
              color: isCurrentWeek ? 'rgba(255,255,255,0.2)' : 'rgba(0,255,136,0.5)',
              fontFamily: MONO, fontSize: '10px',
              padding: '5px 12px', cursor: isCurrentWeek ? 'not-allowed' : 'pointer',
              letterSpacing: '1px', flexShrink: 0,
            }}
          >
            NEXT ▶
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{
              fontFamily: MONO, fontWeight: 700,
              fontSize: 'clamp(32px,5vw,48px)', color: G, lineHeight: 1,
              textShadow: `0 0 30px ${G}`,
            }}>
              {wins}<span style={{ fontSize: '0.55em', opacity: 0.7, marginLeft: '4px' }}>W</span>
            </div>
            <div style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '3px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
              ACIERTOS
            </div>
          </div>

          {fallos > 0 && (
            <div>
              <div style={{
                fontFamily: MONO, fontWeight: 700,
                fontSize: 'clamp(32px,5vw,48px)', color: AMBER, lineHeight: 1,
                textShadow: `0 0 20px ${AMBER}`,
              }}>
                {fallos}<span style={{ fontSize: '0.55em', opacity: 0.7, marginLeft: '4px' }}>F</span>
              </div>
              <div style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '3px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>
                FALLOS ANALIZADOS
              </div>
            </div>
          )}

          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '1.5px', color: 'rgba(255,255,255,0.25)', lineHeight: 1.8 }}>
              CADA PICK DOCUMENTADO.<br />
              CADA SEMANA. TRANSPARENCIA TOTAL.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── InsightCard ──────────────────────────────────────────────────────────────

function InsightCard({ insight, isAdmin, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imgError, setImgError]           = useState(false);

  const isAcierto = insight.type === 'acierto';

  // Resolve pick data
  const rawPd    = insight.pick_data || {};
  const pickData = typeof rawPd === 'string' ? (JSON.parse(rawPd) || {}) : rawPd;
  const rawBp    = pickData.best_pick || {};
  const bestPick = typeof rawBp === 'string' ? (JSON.parse(rawBp) || {}) : rawBp;

  const isPlayerProp = bestPick.type === 'PlayerProp';
  const matchup      = pickData.matchup || '';
  const parts        = matchup.includes('@') ? matchup.split('@') : ['', matchup];
  const awayTeam     = parts[0].trim().split(' ')[0];
  const homeTeam     = parts[1]?.trim().split(' ')[0] || '';

  const pickTeam   = derivePickTeam(bestPick.detail, awayTeam, homeTeam);
  const teamLogoUrl = getTeamLogoUrl(pickTeam);

  const playerImgUrl = usePlayerImage(isPlayerProp ? (bestPick.detail || '') : null);

  const imageUrl = !imgError
    ? (isPlayerProp && playerImgUrl ? playerImgUrl : teamLogoUrl)
    : null;

  const pickText = pickData.pick || bestPick.detail || insight.title || '—';

  const col      = isAcierto ? G     : AMBER;
  const dimCol   = isAcierto ? GDIM  : ADIM;
  const lineCol  = isAcierto ? GLINE : ALINE;
  const glowCol  = isAcierto ? GGLOW : AGLOW;

  return (
    <div
      style={{
        position: 'relative',
        background: CARD_BG,
        border: `1px solid ${lineCol}`,
        borderLeft: `4px solid ${col}`,
        overflow: 'hidden',
        boxShadow: `0 0 40px ${glowCol}, 0 0 1px ${col}33`,
        display: 'flex',
        transition: 'box-shadow 0.25s',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 60px ${glowCol}, 0 0 2px ${col}55`; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = `0 0 40px ${glowCol}, 0 0 1px ${col}33`; }}
    >
      {/* Ambient bg glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: isAcierto
          ? 'radial-gradient(ellipse 100% 80% at 92% 50%, rgba(0,255,136,0.05) 0%, transparent 60%)'
          : 'radial-gradient(ellipse 100% 80% at 92% 50%, rgba(255,184,0,0.04) 0%, transparent 60%)',
      }} />

      {/* Corner tick mark */}
      <div style={{
        position: 'absolute', top: 0, right: imageUrl ? '114px' : '0',
        width: '10px', height: '10px',
        borderTop: `1px solid ${lineCol}`,
        borderRight: `1px solid ${lineCol}`,
        opacity: 0.6, pointerEvents: 'none',
      }} />

      {/* ── Main content ── */}
      <div style={{ flex: 1, padding: '18px 20px', position: 'relative', minWidth: 0 }}>

        {/* Top row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <span style={{
            fontFamily: MONO, fontSize: '9px', letterSpacing: '2.5px',
            padding: '3px 10px',
            background: dimCol,
            border: `1px solid ${lineCol}`,
            color: col, flexShrink: 0,
          }}>
            {isAcierto ? '✦ ACIERTO' : '⚠ FALLO ANALIZADO'}
          </span>

          <span style={{ flex: 1 }} />

          <span style={{ fontFamily: MONO, fontSize: '9px', color: 'rgba(255,255,255,0.28)', letterSpacing: '1px' }}>
            {fmtDate(insight.created_at)}
          </span>

          {/* Admin delete */}
          {isAdmin && (
            <div style={{ position: 'relative' }}>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  style={{
                    background: 'transparent', border: '1px solid transparent',
                    color: C.textMuted, fontFamily: MONO, fontSize: '11px',
                    cursor: 'pointer', padding: '2px 6px',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.target.style.borderColor = C.red; e.target.style.color = C.red; }}
                  onMouseLeave={e => { e.target.style.borderColor = 'transparent'; e.target.style.color = C.textMuted; }}
                >✕</button>
              ) : (
                <div style={{
                  position: 'absolute', top: 0, right: 0, zIndex: 10,
                  background: '#07090E', border: `1px solid ${C.red}`,
                  boxShadow: `0 0 14px rgba(255,34,68,0.25)`,
                  padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '6px',
                  minWidth: '160px',
                }}>
                  <span style={{ fontFamily: MONO, fontSize: '9px', color: C.red, letterSpacing: '1px' }}>
                    ¿BORRAR ESTE INSIGHT?
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setConfirmDelete(false)} style={{
                      flex: 1, background: 'transparent', border: `1px solid ${C.border}`,
                      color: C.cyan, fontFamily: MONO, fontSize: '9px', padding: '3px', cursor: 'pointer',
                    }}>NO</button>
                    <button onClick={() => { setConfirmDelete(false); onDelete(insight.id); }} style={{
                      flex: 1, background: C.redDim, border: `1px solid ${C.red}`,
                      color: C.red, fontFamily: MONO, fontSize: '9px', padding: '3px', cursor: 'pointer',
                    }}>SÍ</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pick text — big */}
        <div style={{
          fontFamily: BARLOW, fontWeight: 800,
          fontSize: 'clamp(17px, 2.5vw, 22px)',
          lineHeight: 1.15, color: '#FFFFFF',
          letterSpacing: '0.5px', marginBottom: '8px',
        }}>
          {pickText}
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
          {matchup && (
            <span style={{ fontFamily: MONO, fontSize: '10px', color: 'rgba(255,255,255,0.4)', letterSpacing: '1px' }}>
              {matchup}
            </span>
          )}
          {pickData.oracle_confidence && (
            <span style={{ fontFamily: MONO, fontSize: '10px', color: col, opacity: 0.9, letterSpacing: '1px' }}>
              {pickData.oracle_confidence}% CONF
            </span>
          )}
          {pickData.bet_value && (
            <span style={{
              fontFamily: MONO, fontSize: '9px', color: 'rgba(255,255,255,0.32)',
              border: '1px solid rgba(255,255,255,0.1)', padding: '1px 7px',
            }}>
              {pickData.bet_value}
            </span>
          )}
        </div>

        {/* Insight title */}
        {insight.title && (
          <div style={{
            fontFamily: MONO, fontSize: '9px', letterSpacing: '2px',
            color: col, opacity: 0.75, marginBottom: '7px', textTransform: 'uppercase',
          }}>
            {insight.title}
          </div>
        )}

        {/* Explanation */}
        <div style={{
          fontFamily: MONO, fontSize: '11px', lineHeight: 1.8,
          color: 'rgba(255,255,255,0.52)',
          padding: '10px 13px',
          background: dimCol,
          borderLeft: `2px solid ${lineCol}`,
        }}>
          {insight.explanation}
        </div>
      </div>

      {/* ── Image column ── */}
      {imageUrl && (
        <div style={{
          width: '110px', flexShrink: 0,
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          background: `linear-gradient(90deg, ${CARD_BG} 0%, transparent 30%)`,
        }}>
          {/* Left fade */}
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: '50px',
            background: `linear-gradient(90deg, ${CARD_BG} 0%, transparent 100%)`,
            zIndex: 1, pointerEvents: 'none',
          }} />
          <img
            src={imageUrl}
            alt=""
            style={{
              width: '100%', height: '100%',
              objectFit: 'contain', objectPosition: 'center',
              opacity: isPlayerProp ? 0.80 : 0.45,
              filter: isPlayerProp
                ? 'none'
                : `drop-shadow(0 0 12px ${col}55)`,
            }}
            onError={() => setImgError(true)}
          />
        </div>
      )}
    </div>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────

function SectionHeader({ label, count, color, lineColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{
        fontFamily: MONO, fontSize: '9px', color,
        letterSpacing: '3.5px', display: 'flex', alignItems: 'center', gap: '6px',
        flexShrink: 0,
      }}>
        <span style={{ opacity: 0.5 }}>[ </span>{label}<span style={{ opacity: 0.5 }}> ]</span>
      </div>
      <div style={{ flex: 1, height: '1px', background: `linear-gradient(90deg, ${lineColor} 0%, transparent 100%)` }} />
      <div style={{
        fontFamily: MONO, fontSize: '12px', color, fontWeight: 700,
        background: color + '15', border: `1px solid ${lineColor}`,
        padding: '2px 10px',
      }}>
        {count}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ isCurrentWeek, type }) {
  const isAcierto = type === 'acierto';
  return (
    <div style={{
      fontFamily: MONO, fontSize: '11px',
      color: 'rgba(255,255,255,0.25)',
      padding: '24px', textAlign: 'center',
      border: `1px dashed ${isAcierto ? GLINE : ALINE}`,
      background: isAcierto ? GDIM : ADIM,
      letterSpacing: '1px',
    }}>
      {isCurrentWeek
        ? (isAcierto ? 'Sin aciertos publicados esta semana aún.' : 'Sin fallos registrados esta semana.')
        : (isAcierto ? 'Sin aciertos registrados.' : 'Sin fallos registrados.')}
    </div>
  );
}

// ─── CuratorModal ─────────────────────────────────────────────────────────────

function CuratorModal({ onClose, onPublished, weekStart }) {
  const { token } = useAuth();
  const [picks, setPicks]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState(null);
  const [step, setStep]                 = useState('select');
  const [editType, setEditType]         = useState('acierto');
  const [editTitle, setEditTitle]       = useState('');
  const [editExplanation, setEditExplanation] = useState('');
  const [generating, setGenerating]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');

  useEffect(() => {
    fetch(`${API_URL}/api/insights/admin/picks-recent`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => setPicks(d.picks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  async function handleGenerate(pick, type) {
    setGenerating(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/insights/generate-explanation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pick_id: pick.id, type }),
      });
      const d = await res.json();
      if (d.success) {
        setEditTitle(d.title);
        setEditExplanation(d.explanation);
        setSelected(pick);
        setEditType(type);
        setStep('edit');
      }
    } catch { setError('Error generando explicación'); }
    finally { setGenerating(false); }
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: editType,
          title: editTitle,
          explanation: editExplanation,
          pick_id: selected?.id,
          pick_data: selected,
          week_start: selected?.game_date
            ? getWeekStart(new Date(selected.game_date + 'T12:00:00Z'))
            : weekStart,
        }),
      });
      const d = await res.json();
      if (d.success) {
        onPublished(d.insight);
        onClose();
      } else {
        setError(d.error || 'Error guardando');
      }
    } catch { setError('Error de conexión'); }
    finally { setSaving(false); }
  }

  const inputStyle = {
    width: '100%', background: C.surface, border: `1px solid ${C.border}`,
    color: C.textPrimary, fontFamily: SANS, fontSize: '13px',
    padding: '10px 12px', outline: 'none', resize: 'vertical',
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: '#07090E', border: `1px solid ${C.border}`,
        boxShadow: `0 0 40px rgba(0,217,255,0.08)`,
        width: '100%', maxWidth: '560px', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        borderTop: `2px solid ${C.accent}`,
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '13px', color: C.accent, letterSpacing: '2px' }}>
            {step === 'select' ? 'SELECCIONAR PICK' : 'EDITAR & PUBLICAR'}
          </span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.textMuted, fontFamily: MONO, fontSize: '14px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {step === 'select' && (
            <>
              <div style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '2px', marginBottom: '12px' }}>
                PICKS RESUELTOS — ÚLTIMOS 7 DÍAS
              </div>
              {loading && <div style={{ fontFamily: MONO, fontSize: '11px', color: C.textDim, textAlign: 'center', padding: '20px' }}>Cargando picks...</div>}
              {!loading && picks.length === 0 && <div style={{ fontFamily: MONO, fontSize: '11px', color: C.textDim, textAlign: 'center', padding: '20px' }}>No hay picks resueltos en los últimos 7 días.</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {picks.map(pick => (
                  <div key={pick.id} style={{
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderLeft: `2px solid ${resultColor(pick.result)}`,
                    padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px',
                  }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontFamily: MONO, fontSize: '9px', color: resultColor(pick.result), letterSpacing: '1px' }}>{resultLabel(pick.result)}</span>
                      <span style={{ fontFamily: BARLOW, fontSize: '13px', color: C.textPrimary, flex: 1, fontWeight: 700 }}>{pick.pick || pick.matchup}</span>
                      <span style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim }}>{pick.game_date?.slice(0, 10) || ''}</span>
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: '10px', color: C.textMuted }}>
                      {pick.matchup}{pick.oracle_confidence ? ` · Oracle ${pick.oracle_confidence}%` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                      <button
                        onClick={() => handleGenerate(pick, pick.result === 'win' ? 'acierto' : 'fallo')}
                        disabled={generating}
                        style={{
                          fontFamily: MONO, fontSize: '9px', letterSpacing: '1px',
                          padding: '4px 12px', cursor: generating ? 'wait' : 'pointer',
                          background: pick.result === 'win' ? C.greenDim : C.amberDim,
                          border: `1px solid ${pick.result === 'win' ? C.greenLine : C.amberLine}`,
                          color: pick.result === 'win' ? C.green : C.amber,
                        }}
                      >
                        {generating ? 'GENERANDO...' : pick.result === 'win' ? '✓ MARCAR ACIERTO' : '⚠ MARCAR FALLO'}
                      </button>
                      {pick.result === 'win' && (
                        <button
                          onClick={() => handleGenerate(pick, 'fallo')}
                          disabled={generating}
                          style={{
                            fontFamily: MONO, fontSize: '9px', letterSpacing: '1px',
                            padding: '4px 12px', cursor: generating ? 'wait' : 'pointer',
                            background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted,
                          }}
                        >
                          ⚠ COMO FALLO
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 'edit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '2px', marginBottom: '8px' }}>TIPO</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['acierto', 'fallo'].map(t => (
                    <button key={t} onClick={() => setEditType(t)} style={{
                      fontFamily: MONO, fontSize: '10px', letterSpacing: '1px',
                      padding: '6px 16px', cursor: 'pointer',
                      background: editType === t ? (t === 'acierto' ? C.greenDim : C.amberDim) : 'transparent',
                      border: `1px solid ${editType === t ? (t === 'acierto' ? C.greenLine : C.amberLine) : C.border}`,
                      color: editType === t ? (t === 'acierto' ? C.green : C.amber) : C.textMuted,
                    }}>
                      {t === 'acierto' ? '✓ ACIERTO' : '⚠ FALLO_EXPLICABLE'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '2px', marginBottom: '6px' }}>TÍTULO</div>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)} style={{ ...inputStyle, height: '38px' }} />
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '2px', marginBottom: '6px' }}>EXPLICACIÓN (editable)</div>
                <textarea value={editExplanation} onChange={e => setEditExplanation(e.target.value)} rows={5} style={{ ...inputStyle, minHeight: '100px' }} />
              </div>
              {error && <div style={{ fontFamily: MONO, fontSize: '10px', color: C.red }}>{error}</div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: '8px', justifyContent: 'flex-end', flexShrink: 0 }}>
          {step === 'edit' && (
            <button onClick={() => setStep('select')} style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '1px', padding: '8px 18px', cursor: 'pointer', background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted }}>
              ← VOLVER
            </button>
          )}
          {step === 'edit' && (
            <button
              onClick={handleSave}
              disabled={saving || !editTitle.trim() || !editExplanation.trim()}
              style={{
                fontFamily: BARLOW, fontWeight: 700, fontSize: '11px', letterSpacing: '2px',
                padding: '8px 22px', cursor: saving ? 'wait' : 'pointer',
                background: saving ? C.surface : C.accent,
                border: `1px solid ${C.accent}`,
                color: saving ? C.textDim : '#111',
                opacity: (!editTitle.trim() || !editExplanation.trim()) ? 0.5 : 1,
              }}
            >
              {saving ? 'GUARDANDO...' : 'PUBLICAR'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InsightsSemana({ lang = 'es' }) {
  const { token, user } = useAuth();
  const isAdmin = user?.is_admin === true;

  const [weekStart, setWeekStart] = useState(getWeekStart());
  const [insights, setInsights]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showCurator, setShowCurator] = useState(false);

  const thisWeek      = getWeekStart();
  const isCurrentWeek = weekStart === thisWeek;
  const weekLabel     = formatWeekLabel(weekStart);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/insights?week=${weekStart}`);
      const d   = await res.json();
      setInsights(d.insights || []);
    } catch { setInsights([]); }
    finally { setLoading(false); }
  }, [weekStart]);

  useEffect(() => { fetchInsights(); }, [fetchInsights]);

  async function handleDelete(id) {
    try {
      await fetch(`${API_URL}/api/insights/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setInsights(prev => prev.filter(i => i.id !== id));
    } catch { /* silent */ }
  }

  const aciertos = insights.filter(i => i.type === 'acierto');
  const fallos   = insights.filter(i => i.type === 'fallo');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '860px', margin: '0 auto', padding: '0 0 40px' }}>

      {/* Hero banner */}
      <SemanaBanner
        insights={insights}
        weekLabel={weekLabel}
        isCurrentWeek={isCurrentWeek}
        weekStart={weekStart}
        onPrev={() => setWeekStart(w => shiftWeek(w, -1))}
        onNext={() => !isCurrentWeek && setWeekStart(w => shiftWeek(w, 1))}
      />

      {/* Loading */}
      {loading && (
        <div style={{ fontFamily: MONO, fontSize: '11px', color: 'rgba(0,255,136,0.4)', padding: '32px', textAlign: 'center', letterSpacing: '3px' }}>
          CARGANDO PICKS...
        </div>
      )}

      {!loading && (
        <>
          {/* Aciertos */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <SectionHeader label="ACIERTOS" count={aciertos.length} color={G} lineColor={GLINE} />
            {aciertos.length === 0
              ? <EmptyState isCurrentWeek={isCurrentWeek} type="acierto" />
              : aciertos.map(i => (
                  <InsightCard key={i.id} insight={i} isAdmin={isAdmin} onDelete={handleDelete} />
                ))
            }
          </div>

          {/* Fallos */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <SectionHeader label="FALLOS ANALIZADOS" count={fallos.length} color={AMBER} lineColor={ALINE} />
            {fallos.length === 0
              ? <EmptyState isCurrentWeek={isCurrentWeek} type="fallo" />
              : fallos.map(i => (
                  <InsightCard key={i.id} insight={i} isAdmin={isAdmin} onDelete={handleDelete} />
                ))
            }
          </div>
        </>
      )}

      {/* Admin curator button */}
      {isAdmin && isCurrentWeek && (
        <button
          onClick={() => setShowCurator(true)}
          style={{
            alignSelf: 'flex-start',
            fontFamily: BARLOW, fontWeight: 700, fontSize: '11px', letterSpacing: '2px',
            padding: '10px 20px', cursor: 'pointer',
            background: GDIM, border: `1px solid ${GLINE}`, color: G,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.target.style.background = G; e.target.style.color = '#111'; }}
          onMouseLeave={e => { e.target.style.background = GDIM; e.target.style.color = G; }}
        >
          + CURAR PICKS
        </button>
      )}

      {showCurator && (
        <CuratorModal
          weekStart={weekStart}
          onClose={() => setShowCurator(false)}
          onPublished={newInsight => setInsights(prev => [newInsight, ...prev])}
        />
      )}
    </div>
  );
}
