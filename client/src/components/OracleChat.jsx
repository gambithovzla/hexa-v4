import { useState, useEffect, useRef } from 'react';
import { C, BARLOW, MONO, SANS } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function OracleChat({ lang = 'en', onBack }) {
  const [games, setGames] = useState([]);
  const [mode, setMode] = useState('partido'); // 'partido' | 'jornada'

  // Partido mode
  const [selectedGame, setSelectedGame] = useState(null);

  // Jornada mode
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [jornadaActive, setJornadaActive] = useState(false);

  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState([]);
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Fetch today's games (use local date, not UTC — MLB games are scheduled
  // in ET/PT, and using toISOString() would skip to tomorrow after ~8pm ET)
  useEffect(() => {
    const token = localStorage.getItem('hexa_token');
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    fetch(`${API_URL}/api/games?date=${date}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        const gameList = data.data || data.games || data || [];
        setGames(Array.isArray(gameList) ? gameList : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  function getMatchup(game) {
    const away = game.teams?.away?.team?.abbreviation || game.teams?.away?.abbreviation || game.away || '?';
    const home = game.teams?.home?.team?.abbreviation || game.teams?.home?.abbreviation || game.home || '?';
    return `${away} @ ${home}`;
  }

  function buildHistory() {
    return conversation.reduce((acc, msg, i, arr) => {
      if (msg.role === 'user' && arr[i + 1]?.role === 'assistant') {
        acc.push({ question: msg.text, answer: arr[i + 1].text });
      }
      return acc;
    }, []);
  }

  // --------------------------------------------------------------------------
  // Partido mode: single-game send
  // --------------------------------------------------------------------------
  async function handleSendPartido() {
    if (!question.trim() || !selectedGame || loading) return;
    const q = question.trim();
    setQuestion('');
    setLoading(true);
    setConversation(prev => [...prev, { role: 'user', text: q }]);

    try {
      const token = localStorage.getItem('hexa_token');
      const res = await fetch(`${API_URL}/api/analyze/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          gameId: selectedGame.gamePk || selectedGame.id,
          question: q,
          conversationHistory: buildHistory(),
          lang,
        }),
      });
      const data = await res.json();
      if (data.success && data.answer) {
        setConversation(prev => [...prev, { role: 'assistant', text: data.answer }]);
      } else {
        setConversation(prev => [...prev, { role: 'assistant', text: data.error || 'Error getting response.' }]);
      }
    } catch {
      setConversation(prev => [...prev, { role: 'assistant', text: 'Connection error.' }]);
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------------------------------
  // Jornada mode: multi-game send
  // --------------------------------------------------------------------------
  async function handleSendJornada() {
    if (!question.trim() || selectedIds.size < 2 || loading) return;
    const q = question.trim();
    setQuestion('');
    setLoading(true);
    setConversation(prev => [...prev, { role: 'user', text: q }]);

    try {
      const token = localStorage.getItem('hexa_token');
      const res = await fetch(`${API_URL}/api/analyze/chat-jornada`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          gameIds: [...selectedIds],
          question: q,
          conversationHistory: buildHistory(),
          lang,
        }),
      });
      const data = await res.json();
      if (data.success && data.answer) {
        setConversation(prev => [...prev, { role: 'assistant', text: data.answer }]);
      } else {
        setConversation(prev => [...prev, { role: 'assistant', text: data.error || 'Error getting response.' }]);
      }
    } catch {
      setConversation(prev => [...prev, { role: 'assistant', text: 'Connection error.' }]);
    } finally {
      setLoading(false);
    }
  }

  function handleSend() {
    if (mode === 'partido') handleSendPartido();
    else handleSendJornada();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function toggleGameId(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetAll() {
    setSelectedGame(null);
    setSelectedIds(new Set());
    setJornadaActive(false);
    setConversation([]);
  }

  function switchMode(m) {
    setMode(m);
    resetAll();
  }

  const inChat = mode === 'partido' ? !!selectedGame : jornadaActive;
  const sendDisabled = loading || !question.trim() || (mode === 'jornada' && selectedIds.size < 2);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.textPrimary, fontFamily: SANS }}>

      {/* TOP BAR */}
      <div style={{
        padding: '12px 20px', background: C.surface, borderBottom: `1px solid ${C.border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={onBack} style={{
            background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted,
            padding: '6px 14px', borderRadius: '3px', fontFamily: BARLOW, fontWeight: 600,
            fontSize: '12px', letterSpacing: '1px', cursor: 'pointer',
          }}>
            ← BACK
          </button>
          <span style={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '16px', color: C.accent }}>
            ORACLE CHAT
          </span>
          <span style={{ fontFamily: MONO, fontSize: '10px', color: C.textDim, letterSpacing: '1px' }}>
            ADMIN ONLY
          </span>
        </div>

        {inChat && (
          <button onClick={resetAll} style={{
            background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted,
            padding: '6px 12px', borderRadius: '3px', fontFamily: MONO, fontSize: '10px',
            cursor: 'pointer',
          }}>
            {mode === 'partido' ? 'CHANGE GAME' : 'CHANGE SELECTION'}
          </button>
        )}
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>

        {/* MODE TOGGLE — only show when not in an active chat */}
        {!inChat && (
          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px' }}>
            {['partido', 'jornada'].map(m => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                style={{
                  padding: '8px 20px', borderRadius: '3px', cursor: 'pointer',
                  fontFamily: BARLOW, fontWeight: 700, fontSize: '12px', letterSpacing: '1px',
                  border: `1px solid ${mode === m ? C.accent : C.border}`,
                  background: mode === m ? C.accentDim : 'transparent',
                  color: mode === m ? C.accent : C.textMuted,
                  transition: 'all 0.15s',
                }}
              >
                {m === 'partido'
                  ? (lang === 'es' ? 'PARTIDO' : 'SINGLE GAME')
                  : (lang === 'es' ? 'JORNADA' : 'MATCHDAY')}
              </button>
            ))}
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* PARTIDO MODE — game selector                                        */}
        {/* ------------------------------------------------------------------ */}
        {mode === 'partido' && !selectedGame && (
          <div>
            <div style={{
              fontFamily: MONO, fontSize: '10px', color: C.textDim,
              letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px',
            }}>
              {lang === 'es' ? 'SELECCIONA UN PARTIDO' : 'SELECT A GAME'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {games.map((game, i) => (
                <div key={i} onClick={() => setSelectedGame(game)} style={{
                  padding: '12px 16px', background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: '3px', cursor: 'pointer', display: 'flex',
                  justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontFamily: BARLOW, fontWeight: 700, fontSize: '15px', color: C.textPrimary }}>
                    {getMatchup(game)}
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: '10px', color: C.textDim }}>
                    {game.gameTime || game.time || ''}
                  </span>
                </div>
              ))}
              {games.length === 0 && (
                <div style={{ fontFamily: MONO, fontSize: '12px', color: C.textDim, padding: '20px', textAlign: 'center' }}>
                  {lang === 'es' ? 'No hay partidos hoy' : 'No games today'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* JORNADA MODE — multi-select checkboxes                             */}
        {/* ------------------------------------------------------------------ */}
        {mode === 'jornada' && !jornadaActive && (
          <div>
            <div style={{
              fontFamily: MONO, fontSize: '10px', color: C.textDim,
              letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px',
            }}>
              {lang === 'es' ? 'SELECCIONA LOS PARTIDOS A ANALIZAR' : 'SELECT GAMES TO ANALYZE'}
            </div>
            <div style={{
              fontFamily: MONO, fontSize: '10px', color: C.textDim,
              marginBottom: '16px', opacity: 0.7,
            }}>
              {lang === 'es'
                ? `${selectedIds.size} seleccionado(s) — mínimo 2 para continuar`
                : `${selectedIds.size} selected — minimum 2 to continue`}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
              {games.map((game, i) => {
                const id = game.gamePk || game.id;
                const checked = selectedIds.has(id);
                return (
                  <div
                    key={i}
                    onClick={() => toggleGameId(id)}
                    style={{
                      padding: '12px 16px',
                      background: checked ? C.accentDim : C.surface,
                      border: `1px solid ${checked ? C.accent : C.border}`,
                      borderRadius: '3px', cursor: 'pointer', display: 'flex',
                      justifyContent: 'space-between', alignItems: 'center',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {/* Checkbox */}
                      <div style={{
                        width: '16px', height: '16px', borderRadius: '2px', flexShrink: 0,
                        border: `2px solid ${checked ? C.accent : C.border}`,
                        background: checked ? C.accent : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {checked && (
                          <span style={{ color: '#111', fontSize: '10px', fontWeight: 900, lineHeight: 1 }}>✓</span>
                        )}
                      </div>
                      <span style={{ fontFamily: BARLOW, fontWeight: 700, fontSize: '15px', color: checked ? C.accent : C.textPrimary }}>
                        {getMatchup(game)}
                      </span>
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: '10px', color: C.textDim }}>
                      {game.gameTime || game.time || ''}
                    </span>
                  </div>
                );
              })}
              {games.length === 0 && (
                <div style={{ fontFamily: MONO, fontSize: '12px', color: C.textDim, padding: '20px', textAlign: 'center' }}>
                  {lang === 'es' ? 'No hay partidos hoy' : 'No games today'}
                </div>
              )}
            </div>

            {/* Jornada CTA */}
            <button
              disabled={selectedIds.size < 2}
              onClick={() => { setJornadaActive(true); setConversation([]); }}
              style={{
                width: '100%', padding: '12px', borderRadius: '3px',
                fontFamily: BARLOW, fontWeight: 700, fontSize: '13px', letterSpacing: '1px',
                cursor: selectedIds.size < 2 ? 'not-allowed' : 'pointer',
                background: selectedIds.size >= 2 ? C.accent : C.surface,
                color: selectedIds.size >= 2 ? '#111' : C.textDim,
                border: `1px solid ${selectedIds.size >= 2 ? C.accent : C.border}`,
                opacity: selectedIds.size < 2 ? 0.5 : 1,
                transition: 'all 0.15s',
              }}
            >
              {lang === 'es'
                ? `ANALIZAR ${selectedIds.size} PARTIDO${selectedIds.size !== 1 ? 'S' : ''}`
                : `ANALYZE ${selectedIds.size} GAME${selectedIds.size !== 1 ? 'S' : ''}`}
            </button>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* ACTIVE CHAT (both modes)                                            */}
        {/* ------------------------------------------------------------------ */}
        {inChat && (
          <>
            {/* Context badge(s) */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '6px',
              marginBottom: '16px', alignItems: 'center',
            }}>
              {mode === 'partido' ? (
                <span style={{
                  fontFamily: MONO, fontSize: '10px', color: C.accent,
                  background: C.accentDim, border: `1px solid ${C.accentLine}`,
                  padding: '4px 10px', borderRadius: '3px', letterSpacing: '2px',
                }}>
                  {getMatchup(selectedGame)}
                </span>
              ) : (
                games
                  .filter(g => selectedIds.has(g.gamePk || g.id))
                  .map((g, i) => (
                    <span key={i} style={{
                      fontFamily: MONO, fontSize: '10px', color: C.accent,
                      background: C.accentDim, border: `1px solid ${C.accentLine}`,
                      padding: '4px 10px', borderRadius: '3px', letterSpacing: '2px',
                    }}>
                      {getMatchup(g)}
                    </span>
                  ))
              )}
              <span style={{ fontFamily: MONO, fontSize: '10px', color: C.textDim }}>
                {conversation.length > 0
                  ? `${Math.floor(conversation.length / 2)} ${lang === 'es' ? 'preguntas' : 'questions'}`
                  : lang === 'es' ? 'Haz tu primera pregunta' : 'Ask your first question'}
              </span>
              {mode === 'jornada' && (
                <span style={{
                  fontFamily: MONO, fontSize: '9px', color: C.textDim,
                  background: C.surface, border: `1px solid ${C.border}`,
                  padding: '3px 8px', borderRadius: '3px', letterSpacing: '1px',
                }}>
                  HAIKU + OPUS 4.7
                </span>
              )}
            </div>

            {/* CONVERSATION */}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '12px',
              marginBottom: '20px', minHeight: '300px',
            }}>
              {conversation.map((msg, i) => (
                <div key={i} style={{
                  padding: '12px 16px',
                  background: msg.role === 'user' ? C.surface : 'transparent',
                  border: msg.role === 'user' ? `1px solid ${C.border}` : `1px solid ${C.borderLight}`,
                  borderLeft: msg.role === 'assistant' ? `3px solid ${C.accent}` : 'none',
                  borderRadius: msg.role === 'user' ? '3px' : '0',
                }}>
                  <div style={{
                    fontFamily: MONO, fontSize: '9px', color: msg.role === 'user' ? C.textDim : C.accent,
                    letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '6px',
                  }}>
                    {msg.role === 'user' ? 'YOU' : 'ORACLE'}
                  </div>
                  <div style={{
                    fontFamily: SANS, fontSize: '13px', lineHeight: 1.8,
                    color: C.textSecondary, whiteSpace: 'pre-wrap',
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ padding: '12px 16px', borderLeft: `3px solid ${C.accent}` }}>
                  <span style={{ fontFamily: MONO, fontSize: '11px', color: C.accent, animation: 'pulse 1.5s ease infinite' }}>
                    {mode === 'jornada'
                      ? (lang === 'es' ? 'Compilando briefs con Haiku → analizando con Opus...' : 'Compiling briefs with Haiku → analyzing with Opus...')
                      : (lang === 'es' ? 'Oracle analizando...' : 'Oracle analyzing...')}
                  </span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* INPUT */}
            <div style={{
              position: 'sticky', bottom: '0', background: C.bg,
              paddingTop: '12px', borderTop: `1px solid ${C.border}`,
            }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    mode === 'jornada'
                      ? (lang === 'es'
                          ? 'ej: ¿Cuál es el pick más seguro de hoy? ¿Dame los top 3...'
                          : 'e.g. What\'s the safest pick today? Rank all games by confidence...')
                      : (lang === 'es'
                          ? 'Pregunta al Oracle... (ej: ¿Arraez hace más de 1.5 hits?)'
                          : 'Ask the Oracle... (e.g. Does Cole get 7+ strikeouts?)')
                  }
                  style={{
                    flex: 1, background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: '3px', padding: '12px 16px', color: C.textPrimary,
                    fontFamily: SANS, fontSize: '13px', outline: 'none',
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={sendDisabled}
                  style={{
                    background: sendDisabled ? C.surface : C.accent,
                    color: sendDisabled ? C.textDim : '#111111',
                    border: 'none', borderRadius: '3px', padding: '12px 20px',
                    fontFamily: BARLOW, fontWeight: 700, fontSize: '12px',
                    letterSpacing: '1px', cursor: sendDisabled ? 'not-allowed' : 'pointer',
                    opacity: sendDisabled ? 0.5 : 1,
                  }}
                >
                  {loading ? '...' : 'ASK'}
                </button>
              </div>
              {conversation.length > 0 && (
                <button onClick={() => setConversation([])} style={{
                  background: 'transparent', border: 'none', color: C.textDim,
                  fontFamily: MONO, fontSize: '10px', cursor: 'pointer', marginTop: '8px',
                  padding: '4px 0',
                }}>
                  {lang === 'es' ? 'Limpiar conversación' : 'Clear conversation'}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
