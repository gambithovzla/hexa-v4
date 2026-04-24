import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../store/authStore';
import { C, BARLOW, MONO } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const G = '#00FF88';
const GLINE = 'rgba(0,255,136,0.28)';
const GDIM = 'rgba(0,255,136,0.08)';
const GGLOW = 'rgba(0,255,136,0.15)';
const CARD_BG = '#05080D';

const COPY = {
  en: {
    label: 'HEXA weekly winners',
    titleCurrent: 'This week',
    titlePast: 'Week archive',
    wins: 'wins published',
    tagline: 'Winning picks of the week',
    prev: 'Prev',
    next: 'Next',
    loading: 'Loading weekly winners...',
    emptyCurrent: 'No winning picks published yet this week.',
    emptyPast: 'No winning picks recorded for this week.',
    confidence: 'Oracle',
    autoSummary: ({ matchup, confidence, betValue }) => {
      const parts = [matchup, confidence ? `Oracle ${confidence}%` : null, betValue || null].filter(Boolean);
      return parts.join(' · ');
    },
    deleteAsk: 'Delete this winner?',
    noDate: 'Resolved this week',
  },
  es: {
    label: 'HEXA weekly winners',
    titleCurrent: 'Semana actual',
    titlePast: 'Semana',
    wins: 'ganados publicados',
    tagline: 'picks ganadores de la semana',
    prev: 'Ant.',
    next: 'Sig.',
    loading: 'Cargando picks ganadores...',
    emptyCurrent: 'Todavia no hay picks ganadores publicados esta semana.',
    emptyPast: 'No hay picks ganadores registrados para esta semana.',
    confidence: 'Oracle',
    autoSummary: ({ matchup, confidence, betValue }) => {
      const parts = [matchup, confidence ? `Oracle ${confidence}%` : null, betValue || null].filter(Boolean);
      return parts.join(' · ');
    },
    deleteAsk: 'Borrar este pick?',
    noDate: 'Resuelto esta semana',
  },
};

const MLB_TEAM_IDS = {
  NYY: 147, BOS: 111, LAD: 119, SF: 137, SFG: 137,
  CHC: 112, CWS: 145, HOU: 117, ATL: 144, NYM: 121,
  PHI: 143, MIA: 146, WSH: 120, WAS: 120, PIT: 134,
  STL: 138, CIN: 113, MIL: 158, CLE: 114, DET: 116,
  KC: 118, KCR: 118, MIN: 142, TEX: 140, SEA: 136,
  ATH: 133, OAK: 133, LAA: 108, ARI: 109, COL: 115,
  SD: 135, SDP: 135, TB: 139, TBR: 139, TOR: 141,
  BAL: 110,
};

function getWeekStart(date = new Date()) {
  const utcDate = (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
  const d = new Date(`${utcDate}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function shiftWeek(weekStart, delta) {
  const d = new Date(`${weekStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(weekStart, lang) {
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  const from = new Date(`${weekStart}T12:00:00Z`);
  const to = new Date(`${weekStart}T12:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 6);
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return `${from.toLocaleDateString(locale, opts)} - ${to.toLocaleDateString(locale, { ...opts, year: 'numeric' })}`;
}

function formatCardDate(iso, lang, fallbackLabel) {
  if (!iso) return fallbackLabel;
  try {
    return new Date(iso).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return fallbackLabel;
  }
}

function parseMaybe(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getTeamLogoUrl(abbr) {
  if (!abbr) return null;
  const id = MLB_TEAM_IDS[String(abbr).toUpperCase().trim()];
  return id ? `https://www.mlbstatic.com/team-logos/${id}.svg` : null;
}

function derivePickTeam(detail, awayTeam, homeTeam) {
  if (!detail) return homeTeam || awayTeam;
  const up = detail.toUpperCase();
  if (awayTeam && up.includes(awayTeam.toUpperCase())) return awayTeam;
  if (homeTeam && up.includes(homeTeam.toUpperCase())) return homeTeam;
  return homeTeam || awayTeam;
}

const playerImageCache = {};

function usePlayerImage(propDetail) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!propDetail) {
      setUrl(null);
      return;
    }

    const match = propDetail.match(/^([A-Za-zÀ-ÿ'\-.\s]+?)(?:\s+(?:Over|Under|To Hit|To Score)\s)/i);
    const name = match ? match[1].trim() : propDetail.split(' ').slice(0, 2).join(' ');
    if (!name || name.length < 4) {
      setUrl(null);
      return;
    }

    if (playerImageCache[name] !== undefined) {
      setUrl(playerImageCache[name]);
      return;
    }

    const encoded = encodeURIComponent(name);
    fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encoded}&limit=1`)
      .then((r) => r.json())
      .then((data) => {
        const id = data.people?.[0]?.id;
        const imageUrl = id
          ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:silo:current.png/people/${id}/headshot/67/current`
          : null;
        playerImageCache[name] = imageUrl;
        setUrl(imageUrl);
      })
      .catch(() => {
        playerImageCache[name] = null;
        setUrl(null);
      });
  }, [propDetail]);

  return url;
}

function SemanaBanner({ weekLabel, isCurrentWeek, winCount, copy, onPrev, onNext }) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#030608',
        border: `1px solid ${GLINE}`,
        borderTop: `3px solid ${G}`,
        padding: '24px 18px 20px',
        boxShadow: `0 0 60px ${GGLOW}, 0 0 2px rgba(0,255,136,0.15)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse 80% 120% at 50% 110%, rgba(0,255,136,0.08) 0%, transparent 65%)',
        }}
      />

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.28em', color: 'rgba(0,255,136,0.62)', textTransform: 'uppercase' }}>
          {copy.label}
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={onPrev}
            style={{
              background: 'transparent',
              border: `1px solid ${GLINE}`,
              color: 'rgba(0,255,136,0.78)',
              fontFamily: MONO,
              fontSize: '11px',
              padding: '8px 12px',
              cursor: 'pointer',
              letterSpacing: '0.14em',
            }}
          >
            {copy.prev}
          </button>

          <div style={{ flex: 1, minWidth: '170px' }}>
            <div style={{ fontFamily: BARLOW, fontWeight: 800, fontSize: 'clamp(18px, 5vw, 30px)', color: '#FFFFFF', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {isCurrentWeek ? copy.titleCurrent : copy.titlePast}
            </div>
            <div style={{ fontFamily: MONO, fontSize: '11px', color: G, letterSpacing: '0.12em', marginTop: '6px' }}>
              {weekLabel.toUpperCase()}
            </div>
          </div>

          <button
            onClick={onNext}
            disabled={isCurrentWeek}
            style={{
              background: 'transparent',
              border: `1px solid ${isCurrentWeek ? 'rgba(255,255,255,0.10)' : GLINE}`,
              color: isCurrentWeek ? 'rgba(255,255,255,0.24)' : 'rgba(0,255,136,0.78)',
              fontFamily: MONO,
              fontSize: '11px',
              padding: '8px 12px',
              cursor: isCurrentWeek ? 'not-allowed' : 'pointer',
              letterSpacing: '0.14em',
            }}
          >
            {copy.next}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div style={{ padding: '14px 16px', border: `1px solid ${GLINE}`, background: GDIM }}>
            <div style={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '0.24em', color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase' }}>
              {copy.wins}
            </div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 'clamp(30px, 6vw, 44px)', lineHeight: 1, color: G, textShadow: `0 0 24px ${G}` }}>
              {winCount}
            </div>
          </div>

          <div style={{ padding: '14px 16px', border: `1px solid ${GLINE}`, background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center' }}>
            <div style={{ fontFamily: MONO, fontSize: '12px', lineHeight: 1.7, color: 'rgba(255,255,255,0.76)' }}>
              {copy.tagline}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightCard({ insight, lang, isAdmin, onDelete }) {
  const copy = COPY[lang] ?? COPY.es;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imgError, setImgError] = useState(false);

  const pickData = parseMaybe(insight.pick_data, {});
  const bestPick = parseMaybe(pickData.best_pick, {});
  const pickText = pickData.pick || bestPick.detail || insight.title || '-';
  const matchup = pickData.matchup || '';
  const confidence = pickData.oracle_confidence || null;
  const betValue = pickData.bet_value || null;
  const isAutoWinner = pickData.auto_published === true || insight.explanation === 'AUTO_PUBLISHED_WIN';
  const parts = matchup.includes('@') ? matchup.split('@') : ['', matchup];
  const awayTeam = parts[0]?.trim().split(' ')[0] || '';
  const homeTeam = parts[1]?.trim().split(' ')[0] || '';
  const pickTeam = derivePickTeam(bestPick.detail || pickData.pick || '', awayTeam, homeTeam);
  const isPlayerProp = bestPick.type === 'PlayerProp';
  const playerImageUrl = usePlayerImage(isPlayerProp ? (bestPick.detail || pickData.pick || '') : null);
  const teamLogoUrl = getTeamLogoUrl(pickTeam);
  const imageUrl = !imgError ? (isPlayerProp ? playerImageUrl : teamLogoUrl) : null;
  const explanation = isAutoWinner
    ? copy.autoSummary({ matchup, confidence, betValue })
    : (insight.explanation || copy.autoSummary({ matchup, confidence, betValue }));

  return (
    <div
      style={{
        position: 'relative',
        background: CARD_BG,
        border: `1px solid ${GLINE}`,
        borderLeft: `4px solid ${G}`,
        overflow: 'hidden',
        boxShadow: `0 0 36px ${GGLOW}, 0 0 1px rgba(0,255,136,0.2)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse 100% 80% at 92% 50%, rgba(0,255,136,0.05) 0%, transparent 60%)',
        }}
      />

      <div
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: imageUrl ? '1fr minmax(72px, 92px)' : '1fr',
          gap: '8px',
        }}
      >
        <div style={{ padding: '18px 18px 16px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <span
              style={{
                fontFamily: MONO,
                fontSize: '9px',
                letterSpacing: '0.22em',
                padding: '4px 10px',
                background: GDIM,
                border: `1px solid ${GLINE}`,
                color: G,
                textTransform: 'uppercase',
              }}
            >
              Win
            </span>

            <span style={{ flex: 1 }} />

            <span style={{ fontFamily: MONO, fontSize: '10px', color: 'rgba(255,255,255,0.34)', letterSpacing: '0.08em' }}>
              {formatCardDate(insight.created_at, lang, copy.noDate)}
            </span>

            {isAdmin && (
              <div style={{ position: 'relative' }}>
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    style={{
                      background: 'transparent',
                      border: '1px solid transparent',
                      color: C.textMuted,
                      fontFamily: MONO,
                      fontSize: '11px',
                      cursor: 'pointer',
                      padding: '2px 6px',
                    }}
                  >
                    x
                  </button>
                ) : (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      zIndex: 10,
                      minWidth: '172px',
                      background: '#07090E',
                      border: `1px solid ${C.red}`,
                      boxShadow: '0 0 12px rgba(255,34,68,0.24)',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <span style={{ fontFamily: MONO, fontSize: '9px', color: C.red, letterSpacing: '0.1em' }}>
                      {copy.deleteAsk}
                    </span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => setConfirmDelete(false)}
                        style={{
                          flex: 1,
                          background: 'transparent',
                          border: `1px solid ${C.border}`,
                          color: C.cyan,
                          fontFamily: MONO,
                          fontSize: '9px',
                          padding: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        No
                      </button>
                      <button
                        onClick={() => onDelete(insight.id)}
                        style={{
                          flex: 1,
                          background: C.redDim,
                          border: `1px solid ${C.red}`,
                          color: C.red,
                          fontFamily: MONO,
                          fontSize: '9px',
                          padding: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ fontFamily: BARLOW, fontWeight: 800, fontSize: 'clamp(17px, 4.8vw, 24px)', lineHeight: 1.15, color: '#FFFFFF', letterSpacing: '0.03em' }}>
            {pickText}
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '10px' }}>
            {matchup && (
              <span style={{ fontFamily: MONO, fontSize: '10px', color: 'rgba(255,255,255,0.42)', letterSpacing: '0.08em' }}>
                {matchup}
              </span>
            )}
            {confidence && (
              <span style={{ fontFamily: MONO, fontSize: '10px', color: G, letterSpacing: '0.08em' }}>
                {copy.confidence} {confidence}%
              </span>
            )}
            {betValue && (
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: '9px',
                  color: 'rgba(255,255,255,0.44)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  padding: '2px 7px',
                }}
              >
                {betValue}
              </span>
            )}
          </div>

          <div
            style={{
              marginTop: '14px',
              fontFamily: MONO,
              fontSize: '11px',
              lineHeight: 1.75,
              color: 'rgba(255,255,255,0.64)',
              padding: '10px 12px',
              background: GDIM,
              borderLeft: `2px solid ${GLINE}`,
            }}
          >
            {explanation}
          </div>
        </div>

        {imageUrl && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '12px 8px 12px 0',
            }}
          >
            <img
              src={imageUrl}
              alt=""
              style={{
                width: '100%',
                maxWidth: '88px',
                maxHeight: '88px',
                objectFit: 'contain',
                opacity: isPlayerProp ? 0.86 : 0.54,
                filter: isPlayerProp ? 'none' : 'drop-shadow(0 0 12px rgba(0,255,136,0.25))',
              }}
              onError={() => setImgError(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function InsightsSemana({ lang = 'es' }) {
  const copy = COPY[lang] ?? COPY.es;
  const { token, user } = useAuth();
  const isAdmin = user?.is_admin === true;

  const [weekStart, setWeekStart] = useState(getWeekStart());
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  const thisWeek = getWeekStart();
  const isCurrentWeek = weekStart === thisWeek;
  const weekLabel = useMemo(() => formatWeekLabel(weekStart, lang), [weekStart, lang]);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/insights?week=${weekStart}&type=acierto`);
      const data = await res.json();
      setInsights(Array.isArray(data.insights) ? data.insights : []);
    } catch {
      setInsights([]);
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  // Auto-refresh every 3 minutes when viewing the current week so resolved wins appear automatically
  useEffect(() => {
    if (!isCurrentWeek) return;
    const id = setInterval(fetchInsights, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [isCurrentWeek, fetchInsights]);

  async function handleDelete(id) {
    try {
      await fetch(`${API_URL}/api/insights/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setInsights((prev) => prev.filter((insight) => insight.id !== id));
    } catch {
      // silent
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '920px', margin: '0 auto', padding: '0 0 36px' }}>
      <SemanaBanner
        weekLabel={weekLabel}
        isCurrentWeek={isCurrentWeek}
        winCount={insights.length}
        copy={copy}
        onPrev={() => setWeekStart((value) => shiftWeek(value, -1))}
        onNext={() => !isCurrentWeek && setWeekStart((value) => shiftWeek(value, 1))}
      />

      {loading ? (
        <div style={{ fontFamily: MONO, fontSize: '11px', color: 'rgba(0,255,136,0.46)', padding: '28px', textAlign: 'center', letterSpacing: '0.22em' }}>
          {copy.loading}
        </div>
      ) : insights.length === 0 ? (
        <div
          style={{
            fontFamily:  MONO,
            fontSize:    '11px',
            color:       'rgba(255,255,255,0.38)',
            padding:     '32px 24px',
            textAlign:   'center',
            border:      `1px dashed ${GLINE}`,
            background:  GDIM,
            letterSpacing: '0.08em',
            position:    'relative',
            overflow:    'hidden',
            minHeight:   '120px',
            display:     'flex',
            flexDirection: 'column',
            alignItems:  'center',
            justifyContent: 'center',
            gap:         '10px',
          }}
        >
          <img
            src="/hexa-mascot-ghost.png"
            alt=""
            aria-hidden="true"
            style={{ height: 64, width: 'auto', opacity: 0.18, pointerEvents: 'none', userSelect: 'none' }}
          />
          {isCurrentWeek ? copy.emptyCurrent : copy.emptyPast}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              lang={lang}
              isAdmin={isAdmin}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
