/**
 * InsightsSemana.jsx
 * Public weekly feed of curated picks (aciertos & honest fallos).
 * Admin-only: pick curator modal to select & publish insights.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../store/authStore';
import { C, BARLOW, MONO, SANS } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── helpers ────────────────────────────────────────────────────────────────

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
  const to = new Date(weekStart + 'T12:00:00Z');
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
  if (result === 'win') return 'WIN';
  if (result === 'loss') return 'LOSS';
  if (result === 'push') return 'PUSH';
  return result?.toUpperCase() || '—';
}

function resultColor(result) {
  if (result === 'win') return C.green;
  if (result === 'loss') return C.red;
  if (result === 'push') return C.cyan;
  return C.textMuted;
}

// ─── InsightCard ─────────────────────────────────────────────────────────────

function InsightCard({ insight, isAdmin, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isAcierto = insight.type === 'acierto';

  const accentColor = isAcierto ? C.green : C.amber;
  const accentDim   = isAcierto ? C.greenDim : C.amberDim;
  const accentLine  = isAcierto ? C.greenLine : C.amberLine;

  return (
    <div style={{
      position: 'relative',
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${accentColor}`,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      boxShadow: isAcierto
        ? `0 0 20px rgba(0,230,118,0.06), inset 0 0 20px rgba(0,230,118,0.02)`
        : `0 0 20px rgba(255,170,0,0.05), inset 0 0 20px rgba(255,170,0,0.015)`,
      transition: 'box-shadow 0.2s',
    }}>
      {/* Corner decoration */}
      <div style={{
        position: 'absolute', top: 0, right: 0,
        width: '8px', height: '8px',
        borderTop: `1px solid ${accentLine}`,
        borderRight: `1px solid ${accentLine}`,
        opacity: 0.6,
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {/* Type badge */}
        <div style={{
          fontFamily: MONO, fontSize: '9px', letterSpacing: '2px',
          padding: '3px 10px',
          background: accentDim,
          border: `1px solid ${accentLine}`,
          color: accentColor,
          flexShrink: 0,
        }}>
          {isAcierto ? '✓ ACIERTO' : '⚠ FALLO_EXPLICABLE'}
        </div>

        <div style={{
          fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '1px', flex: 1,
        }}>
          {fmtDate(insight.created_at)}
        </div>

        {/* Admin delete */}
        {isAdmin && (
          <div style={{ position: 'relative' }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  background: 'transparent', border: `1px solid transparent`,
                  color: C.textMuted, fontFamily: MONO, fontSize: '11px',
                  cursor: 'pointer', padding: '2px 6px', borderRadius: '2px',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.target.style.borderColor = C.red; e.target.style.color = C.red; }}
                onMouseLeave={e => { e.target.style.borderColor = 'transparent'; e.target.style.color = C.textMuted; }}
              >
                ✕
              </button>
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

      {/* Title */}
      <div style={{
        fontFamily: BARLOW, fontWeight: 800, fontSize: '15px',
        color: C.textPrimary, letterSpacing: '0.5px',
      }}>
        {insight.title}
      </div>

      {/* Explanation */}
      <div style={{
        fontFamily: SANS, fontSize: '12px', lineHeight: 1.75,
        color: C.textSecondary,
        padding: '10px 12px',
        background: accentDim,
        border: `1px solid ${accentLine}`,
        borderTop: `2px solid ${accentColor}`,
      }}>
        {insight.explanation}
      </div>
    </div>
  );
}

// ─── CuratorModal ────────────────────────────────────────────────────────────

function CuratorModal({ onClose, onPublished, weekStart }) {
  const { token } = useAuth();
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // { pick, type }
  const [step, setStep] = useState('select'); // 'select' | 'edit'
  const [editType, setEditType] = useState('acierto');
  const [editTitle, setEditTitle] = useState('');
  const [editExplanation, setEditExplanation] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
          week_start: weekStart,
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

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, padding: '20px',
  };

  const panelStyle = {
    background: '#07090E', border: `1px solid ${C.border}`,
    boxShadow: `0 0 40px rgba(0,217,255,0.08)`,
    width: '100%', maxWidth: '560px', maxHeight: '85vh',
    display: 'flex', flexDirection: 'column',
    borderTop: `2px solid ${C.accent}`,
  };

  const inputStyle = {
    width: '100%', background: C.surface, border: `1px solid ${C.border}`,
    color: C.textPrimary, fontFamily: SANS, fontSize: '13px',
    padding: '10px 12px', outline: 'none', resize: 'vertical',
    boxSizing: 'border-box',
  };

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '13px', color: C.accent, letterSpacing: '2px' }}>
            {step === 'select' ? 'SELECCIONAR PICK' : 'EDITAR & PUBLICAR'}
          </span>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: C.textMuted,
            fontFamily: MONO, fontSize: '14px', cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          {step === 'select' && (
            <>
              <div style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '2px', marginBottom: '12px' }}>
                PICKS RESUELTOS — ÚLTIMOS 7 DÍAS
              </div>
              {loading && (
                <div style={{ fontFamily: MONO, fontSize: '11px', color: C.textDim, textAlign: 'center', padding: '20px' }}>
                  Cargando picks...
                </div>
              )}
              {!loading && picks.length === 0 && (
                <div style={{ fontFamily: MONO, fontSize: '11px', color: C.textDim, textAlign: 'center', padding: '20px' }}>
                  No hay picks resueltos en los últimos 7 días.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {picks.map(pick => (
                  <div key={pick.id} style={{
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderLeft: `2px solid ${resultColor(pick.result)}`,
                    padding: '10px 14px',
                    display: 'flex', flexDirection: 'column', gap: '6px',
                  }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontFamily: MONO, fontSize: '9px', color: resultColor(pick.result), letterSpacing: '1px' }}>
                        {resultLabel(pick.result)}
                      </span>
                      <span style={{ fontFamily: BARLOW, fontSize: '13px', color: C.textPrimary, flex: 1, fontWeight: 700 }}>
                        {pick.pick || pick.matchup}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim }}>
                        {pick.game_date?.slice(0, 10) || ''}
                      </span>
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: '10px', color: C.textMuted }}>
                      {pick.matchup}
                      {pick.oracle_confidence ? ` · Oracle ${pick.oracle_confidence}%` : ''}
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
                            background: 'transparent', border: `1px solid ${C.border}`,
                            color: C.textMuted,
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
              {/* Type selector */}
              <div>
                <div style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '2px', marginBottom: '8px' }}>
                  TIPO
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['acierto', 'fallo'].map(t => (
                    <button
                      key={t}
                      onClick={() => setEditType(t)}
                      style={{
                        fontFamily: MONO, fontSize: '10px', letterSpacing: '1px',
                        padding: '6px 16px', cursor: 'pointer',
                        background: editType === t ? (t === 'acierto' ? C.greenDim : C.amberDim) : 'transparent',
                        border: `1px solid ${editType === t ? (t === 'acierto' ? C.greenLine : C.amberLine) : C.border}`,
                        color: editType === t ? (t === 'acierto' ? C.green : C.amber) : C.textMuted,
                      }}
                    >
                      {t === 'acierto' ? '✓ ACIERTO' : '⚠ FALLO_EXPLICABLE'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <div style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '2px', marginBottom: '6px' }}>
                  TÍTULO
                </div>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  style={{ ...inputStyle, height: '38px' }}
                />
              </div>

              {/* Explanation */}
              <div>
                <div style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '2px', marginBottom: '6px' }}>
                  EXPLICACIÓN (editable)
                </div>
                <textarea
                  value={editExplanation}
                  onChange={e => setEditExplanation(e.target.value)}
                  rows={5}
                  style={{ ...inputStyle, minHeight: '100px' }}
                />
              </div>

              {error && (
                <div style={{ fontFamily: MONO, fontSize: '10px', color: C.red }}>{error}</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px', borderTop: `1px solid ${C.border}`,
          display: 'flex', gap: '8px', justifyContent: 'flex-end', flexShrink: 0,
        }}>
          {step === 'edit' && (
            <button onClick={() => setStep('select')} style={{
              fontFamily: MONO, fontSize: '10px', letterSpacing: '1px',
              padding: '8px 18px', cursor: 'pointer',
              background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted,
            }}>
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
              {saving ? 'PUBLICANDO...' : 'PUBLICAR'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InsightsSemana({ lang = 'es' }) {
  const { token, user } = useAuth();
  const isAdmin = user?.is_admin === true;

  const [weekStart, setWeekStart] = useState(getWeekStart());
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCurator, setShowCurator] = useState(false);

  const thisWeek = getWeekStart();
  const isCurrentWeek = weekStart === thisWeek;

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/insights?week=${weekStart}`);
      const d = await res.json();
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Week navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        background: C.surface, border: `1px solid ${C.border}`,
        borderTop: `2px solid ${C.accent}`,
      }}>
        <button
          onClick={() => setWeekStart(w => shiftWeek(w, -1))}
          style={{
            background: 'transparent', border: `1px solid ${C.border}`,
            color: C.textMuted, fontFamily: MONO, fontSize: '10px',
            padding: '5px 12px', cursor: 'pointer', letterSpacing: '1px',
          }}
        >
          ◀ PREV
        </button>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '12px', color: isCurrentWeek ? C.accent : C.textPrimary, letterSpacing: '2px', textTransform: 'uppercase' }}>
            {isCurrentWeek ? 'SEMANA ACTUAL' : 'SEMANA'}
          </div>
          <div style={{ fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '1px', marginTop: '2px' }}>
            {formatWeekLabel(weekStart)}
          </div>
        </div>

        <button
          onClick={() => setWeekStart(w => shiftWeek(w, 1))}
          disabled={isCurrentWeek}
          style={{
            background: 'transparent', border: `1px solid ${isCurrentWeek ? C.border : C.border}`,
            color: isCurrentWeek ? C.textDim : C.textMuted,
            fontFamily: MONO, fontSize: '10px',
            padding: '5px 12px', cursor: isCurrentWeek ? 'not-allowed' : 'pointer',
            letterSpacing: '1px', opacity: isCurrentWeek ? 0.3 : 1,
          }}
        >
          NEXT ▶
        </button>
      </div>

      {/* Aciertos */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px',
        }}>
          <div style={{
            fontFamily: MONO, fontSize: '9px', color: C.green,
            letterSpacing: '3px', display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <span style={{ opacity: 0.6 }}>[ </span>ACIERTOS<span style={{ opacity: 0.6 }}> ]</span>
          </div>
          <div style={{
            flex: 1, height: '1px', background: `linear-gradient(90deg, ${C.greenLine} 0%, transparent 100%)`,
          }} />
          <div style={{
            fontFamily: MONO, fontSize: '11px', color: C.green, fontWeight: 700,
            background: C.greenDim, border: `1px solid ${C.greenLine}`,
            padding: '2px 8px',
          }}>
            {aciertos.length}
          </div>
        </div>

        {loading ? (
          <div style={{ fontFamily: MONO, fontSize: '11px', color: C.textDim, padding: '20px', textAlign: 'center' }}>
            Cargando feed...
          </div>
        ) : aciertos.length === 0 ? (
          <div style={{
            fontFamily: MONO, fontSize: '11px', color: C.textDim,
            padding: '20px', textAlign: 'center',
            border: `1px dashed ${C.border}`, background: C.surface,
          }}>
            {isCurrentWeek ? 'Sin aciertos publicados esta semana aún.' : 'Sin aciertos registrados.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {aciertos.map(i => (
              <InsightCard key={i.id} insight={i} isAdmin={isAdmin} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Fallos */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px',
        }}>
          <div style={{
            fontFamily: MONO, fontSize: '9px', color: C.amber,
            letterSpacing: '3px', display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <span style={{ opacity: 0.6 }}>[ </span>FALLOS EXPLICABLES<span style={{ opacity: 0.6 }}> ]</span>
          </div>
          <div style={{
            flex: 1, height: '1px', background: `linear-gradient(90deg, ${C.amberLine} 0%, transparent 100%)`,
          }} />
          <div style={{
            fontFamily: MONO, fontSize: '11px', color: C.amber, fontWeight: 700,
            background: C.amberDim, border: `1px solid ${C.amberLine}`,
            padding: '2px 8px',
          }}>
            {fallos.length}
          </div>
        </div>

        {!loading && fallos.length === 0 ? (
          <div style={{
            fontFamily: MONO, fontSize: '11px', color: C.textDim,
            padding: '20px', textAlign: 'center',
            border: `1px dashed ${C.border}`, background: C.surface,
          }}>
            {isCurrentWeek ? 'Sin fallos publicados esta semana.' : 'Sin fallos registrados.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {fallos.map(i => (
              <InsightCard key={i.id} insight={i} isAdmin={isAdmin} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Empty state */}
      {!loading && insights.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '32px 20px',
          border: `1px solid ${C.border}`, background: C.surface,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
        }}>
          <div style={{ fontFamily: MONO, fontSize: '28px', opacity: 0.3 }}>⬡</div>
          <div style={{ fontFamily: BARLOW, fontSize: '13px', color: C.textMuted, letterSpacing: '2px' }}>
            {isCurrentWeek
              ? isAdmin ? 'Usa el botón + CURAR para publicar picks de la semana.' : 'No hay insights publicados esta semana aún.'
              : 'No hay insights para esta semana.'}
          </div>
        </div>
      )}

      {/* Admin: curator button */}
      {isAdmin && isCurrentWeek && (
        <button
          onClick={() => setShowCurator(true)}
          style={{
            alignSelf: 'flex-start',
            fontFamily: BARLOW, fontWeight: 700, fontSize: '11px', letterSpacing: '2px',
            padding: '10px 20px', cursor: 'pointer',
            background: C.accentDim,
            border: `1px solid ${C.accentLine}`,
            color: C.accent,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.target.style.background = C.accent; e.target.style.color = '#111'; }}
          onMouseLeave={e => { e.target.style.background = C.accentDim; e.target.style.color = C.accent; }}
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
