import { useState, useEffect, useRef } from 'react';
import { C, BARLOW, MONO, SANS } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function OracleChat({ lang = 'en', onBack }) {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
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

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  async function handleSend() {
    if (!question.trim() || !selectedGame || loading) return;
    const q = question.trim();
    setQuestion('');
    setLoading(true);

    setConversation(prev => [...prev, { role: 'user', text: q }]);

    try {
      const token = localStorage.getItem('hexa_token');
      const res = await fetch(`${API_URL}/api/analyze/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          gameId: selectedGame.gamePk || selectedGame.id,
          question: q,
          conversationHistory: conversation.reduce((acc, msg, i, arr) => {
            if (msg.role === 'user' && arr[i + 1]?.role === 'assistant') {
              acc.push({ question: msg.text, answer: arr[i + 1].text });
            }
            return acc;
          }, []),
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

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function getMatchup(game) {
    const away = game.teams?.away?.team?.abbreviation || game.teams?.away?.abbreviation || game.away || '?';
    const home = game.teams?.home?.team?.abbreviation || game.teams?.home?.abbreviation || game.home || '?';
    return `${away} @ ${home}`;
  }

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
        {selectedGame && (
          <button onClick={() => { setSelectedGame(null); setConversation([]); }} style={{
            background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted,
            padding: '6px 12px', borderRadius: '3px', fontFamily: MONO, fontSize: '10px',
            cursor: 'pointer',
          }}>
            CHANGE GAME
          </button>
        )}
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>

        {/* GAME SELECTOR */}
        {!selectedGame ? (
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
                  transition: 'border-color 0.2s',
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
        ) : (
          <>
            {/* SELECTED GAME BADGE */}
            <div style={{
              fontFamily: MONO, fontSize: '10px', color: C.accent, letterSpacing: '2px',
              marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <span style={{
                background: C.accentDim, border: `1px solid ${C.accentLine}`,
                padding: '4px 10px', borderRadius: '3px',
              }}>
                {getMatchup(selectedGame)}
              </span>
              <span style={{ color: C.textDim }}>
                {conversation.length > 0
                  ? `${Math.floor(conversation.length / 2)} ${lang === 'es' ? 'preguntas' : 'questions'}`
                  : lang === 'es' ? 'Haz tu primera pregunta' : 'Ask your first question'}
              </span>
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
                    color: C.textSecondary,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{
                  padding: '12px 16px', borderLeft: `3px solid ${C.accent}`,
                }}>
                  <span style={{ fontFamily: MONO, fontSize: '11px', color: C.accent, animation: 'pulse 1.5s ease infinite' }}>
                    {lang === 'es' ? 'Oracle analizando...' : 'Oracle analyzing...'}
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
                  placeholder={lang === 'es'
                    ? 'Pregunta al Oracle... (ej: ¿Arraez hace más de 1.5 hits?)'
                    : 'Ask the Oracle... (e.g. Does Cole get 7+ strikeouts?)'}
                  style={{
                    flex: 1, background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: '3px', padding: '12px 16px', color: C.textPrimary,
                    fontFamily: SANS, fontSize: '13px', outline: 'none',
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !question.trim()}
                  style={{
                    background: loading ? C.surface : C.accent,
                    color: loading ? C.textDim : '#111111',
                    border: 'none', borderRadius: '3px', padding: '12px 20px',
                    fontFamily: BARLOW, fontWeight: 700, fontSize: '12px',
                    letterSpacing: '1px', cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading || !question.trim() ? 0.5 : 1,
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
