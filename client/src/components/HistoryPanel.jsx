/**
 * HistoryPanel.jsx
 * Two-tab panel:
 *   ANÁLISIS — existing pick history
 *   BANCA    — bankroll tracker
 *
 * Props:
 *   lang — 'en' | 'es'
 */

import { useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import useHistory from '../hooks/useHistory';
import useBankroll from '../hooks/useBankroll';
import { useAuth } from '../store/authStore';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
import { C, BARLOW, MONO, SANS } from '../theme';

const TRANSLATIONS = { en, es };

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

function getTeamId(teamName) {
  if (!teamName) return null;
  const exact = TEAM_IDS[teamName];
  if (exact) return exact;
  const lower = teamName.toLowerCase();
  for (const [name, id] of Object.entries(TEAM_IDS)) {
    if (lower.includes(name.toLowerCase().split(' ').pop())) return id;
  }
  return null;
}

function parseMatchupTeams(matchup) {
  if (!matchup) return { away: null, home: null };
  const parts = matchup.split(/\s+(?:vs\.?|@|VS)\s+/i);
  if (parts.length < 2) return { away: null, home: null };
  return { away: parts[0].trim(), home: parts[1].trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <Typography component="div" sx={{ fontFamily: MONO, fontSize: '8px', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '3px', mb: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ color: C.cyan, opacity: 0.7 }}>[ </span>
      {children}
      <span style={{ color: C.cyan, opacity: 0.7 }}> ]</span>
    </Typography>
  );
}

function StatCard({ value, label, color, sub }) {
  return (
    <Box sx={{
      bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: '0',
      p: '12px 8px', textAlign: 'center', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: '4px', position: 'relative',
      '&::before': { content: '""', position: 'absolute', top: 0, left: 0, width: '6px', height: '6px', borderTop: `1px solid ${C.cyan}`, borderLeft: `1px solid ${C.cyan}` },
    }}>
      <Typography sx={{ fontFamily: BARLOW, fontSize: { xs: '1.2rem', sm: '1.5rem' }, color, lineHeight: 1, textShadow: `0 0 12px ${color}44` }}>
        {value}
      </Typography>
      {sub && <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>{sub}</Typography>}
      <Typography sx={{ fontFamily: MONO, fontSize: '7px', color: C.textDim, textTransform: 'uppercase', letterSpacing: '2px' }}>
        {label}
      </Typography>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ANÁLISIS TAB (existing history)
// ─────────────────────────────────────────────────────────────────────────────

function resultBorderColor(result) {
  if (result === 'win')  return C.green;
  if (result === 'loss') return C.red;
  if (result === 'push') return C.cyan;
  return C.border;
}

function resultBadgeSx(result) {
  if (result === 'win')  return { bgcolor: C.greenDim, border: `1px solid ${C.greenLine}`, color: C.green };
  if (result === 'loss') return { bgcolor: C.redDim,   border: `1px solid ${C.redLine}`,   color: C.red   };
  if (result === 'push') return { bgcolor: C.cyanDim,  border: `1px solid ${C.cyanLine}`,  color: C.cyan  };
  return                        { bgcolor: C.amberDim, border: `1px solid ${C.amberLine}`,  color: C.amber };
}

function MiniConfBar({ value }) {
  const num = Math.min(100, Math.max(0, Number(value) || 0));
  const barColor = num >= 75 ? C.green : num >= 50 ? C.cyan : C.accent;
  return (
    <Box sx={{ height: '4px', bgcolor: 'rgba(0,217,255,0.08)', border: `1px solid rgba(0,217,255,0.12)`, width: 80 }}>
      <Box sx={{ height: '100%', width: `${num}%`, background: barColor, boxShadow: `0 0 6px ${barColor}80` }} />
    </Box>
  );
}

function ModeBadge({ mode }) {
  const colors = {
    single:  { bg: C.accentDim, border: C.accentLine, text: C.accent },
    parlay:  { bg: C.amberDim,  border: C.amberLine,  text: C.amber  },
    fullday: { bg: C.surfaceAlt, border: C.border,    text: C.textSecondary },
    fullDay: { bg: C.surfaceAlt, border: C.border,    text: C.textSecondary },
    safe:    { bg: C.greenDim,   border: C.greenLine,  text: C.green  },
  };
  const cfg = colors[mode] ?? colors.single;
  return (
    <Box component="span" sx={{ display: 'inline-block', px: '7px', py: '2px', bgcolor: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: '0', fontFamily: MONO, fontSize: '7px', color: cfg.text, textTransform: 'uppercase', letterSpacing: '2px', flexShrink: 0 }}>
      {mode}
    </Box>
  );
}

function PickCard({ entry, onMarkResult, onDelete, t }) {
  const borderColor = resultBorderColor(entry.result);
  const badgeSx     = resultBadgeSx(entry.result);
  const resultLabel = t.history.result?.[entry.result] ?? entry.result.toUpperCase();

  // Terminal date format: LOG // 2026-03-27 · 19:05
  const dateStr = (() => {
    try {
      const d = new Date(entry.date);
      const datepart = d.toISOString().slice(0, 10);
      const timepart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `LOG // ${datepart} · ${timepart}`;
    }
    catch { return entry.date ?? ''; }
  })();

  return (
    <Box sx={{
      bgcolor: C.surface, border: `1px solid ${C.border}`,
      borderLeft: `2px solid ${borderColor}`, borderRadius: '0',
      p: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px',
      position: 'relative',
      '&::after': { content: '""', position: 'absolute', bottom: 0, right: 0, width: '8px', height: '8px', borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <ModeBadge mode={entry.mode} />
        <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: C.textMuted, flex: 1, letterSpacing: '0.06em' }}>{dateStr}</Typography>
        <Box sx={{ ...badgeSx, px: '8px', py: '2px', borderRadius: '0', fontFamily: MONO, fontSize: '8px', textTransform: 'uppercase', letterSpacing: '2px', flexShrink: 0 }}>
          {resultLabel}
        </Box>
        <Box
          component="button"
          onClick={() => onDelete(entry.id)}
          title="Eliminar pick"
          sx={{ ml: '4px', px: '6px', py: '2px', border: `1px solid transparent`, borderRadius: '0', bgcolor: 'transparent', color: C.textMuted, fontFamily: MONO, fontSize: '0.7rem', lineHeight: 1, cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0, '&:hover': { borderColor: C.red, color: C.red, bgcolor: C.redDim } }}
        >
          ✕
        </Box>
      </Box>
      <Typography component="div" sx={{ fontFamily: BARLOW, fontSize: '1rem', color: C.textPrimary, letterSpacing: '1px', lineHeight: 1.3 }}>
        {(() => {
          const { away, home } = parseMatchupTeams(entry.matchup);
          const awayId = getTeamId(away);
          const homeId = getTeamId(home);
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {awayId && <img src={`https://www.mlbstatic.com/team-logos/${awayId}.svg`} width={20} height={20} alt="" onError={e => e.target.style.display='none'} />}
              <span>{away || entry.matchup || '?'}</span>
              {home && <span style={{ opacity: 0.4, fontSize: '0.7em' }}>vs</span>}
              {homeId && <img src={`https://www.mlbstatic.com/team-logos/${homeId}.svg`} width={20} height={20} alt="" onError={e => e.target.style.display='none'} />}
              {home && <span>{home}</span>}
            </Box>
          );
        })()}
      </Typography>
      {entry.pick && (
        <Box sx={{
          background: C.accentDim, border: `1px solid ${C.accentLine}`,
          borderTop: `2px solid ${C.accent}`, borderRadius: '0',
          p: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px',
          boxShadow: C.accentGlow,
        }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '7px', color: C.accent, textTransform: 'uppercase', letterSpacing: '3px', textShadow: `0 0 8px rgba(255,102,0,0.5)` }}>
            BEST_PICK // ORACLE_OUTPUT
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '12px', color: C.textPrimary, flex: 1, letterSpacing: '0.05em' }}>
              {entry.pick}
            </Typography>
            {entry.confidence > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <MiniConfBar value={entry.confidence} />
                <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: entry.confidence >= 75 ? C.green : entry.confidence >= 50 ? C.amber : C.red, minWidth: '34px', textAlign: 'right' }}>
                  {entry.confidence}%
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}
      {/* Kelly recommendation */}
      {entry.kelly_recommendation && (
        <Box sx={{
          mt: '8px', p: '8px 10px',
          bgcolor: C.accentDim,
          border: `1px solid ${C.accentLine}`,
          borderRadius: '2px',
        }}>
          <Typography sx={{
            fontFamily: MONO,
            fontSize: '0.65rem',
            color: C.accent,
            letterSpacing: '0.03em',
          }}>
            {entry.kelly_recommendation}
          </Typography>
        </Box>
      )}
      {entry.result === 'pending' && (
        <Box sx={{ display: 'flex', gap: '8px', pt: '2px', flexWrap: 'wrap' }}>
          <MarkBtn label={`✓ ${t.history.markWin}`}  color={C.green} dim={C.greenDim} onClick={() => onMarkResult(entry.id, 'win')} />
          <MarkBtn label={`✗ ${t.history.markLoss}`} color={C.red}   dim={C.redDim}   onClick={() => onMarkResult(entry.id, 'loss')} />
          <MarkBtn label={`⇌ ${t.history.markPush}`} color={C.cyan}  dim={C.cyanDim}  onClick={() => onMarkResult(entry.id, 'push')} />
        </Box>
      )}
    </Box>
  );
}

function MarkBtn({ label, color, dim, onClick }) {
  return (
    <Box component="button" onClick={onClick} sx={{ px: '10px', py: '4px', border: `1px solid ${color}55`, borderRadius: '2px', bgcolor: dim, color, fontFamily: MONO, fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.15s', '&:hover': { opacity: 0.85 } }}>
      {label}
    </Box>
  );
}

function groupPicksByDay(picks) {
  const groups = {};
  for (const entry of picks) {
    let dayKey = 'unknown';
    try {
      dayKey = new Date(entry.date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    } catch { /* fallback */ }
    if (!groups[dayKey]) groups[dayKey] = [];
    groups[dayKey].push(entry);
  }
  // Sort days descending (most recent first)
  return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
}

function DayHeader({ dateStr, picks, lang, defaultExpanded, onMarkResult, onDelete, t }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isEs = lang === 'es';

  const wins = picks.filter(p => p.result === 'win').length;
  const losses = picks.filter(p => p.result === 'loss').length;
  const pushes = picks.filter(p => p.result === 'push').length;
  const pending = picks.filter(p => p.result === 'pending').length;
  const total = picks.length;

  // Format: "Mar 28, 2026" or "28 Mar 2026"
  let displayDate = dateStr;
  try {
    const d = new Date(dateStr + 'T12:00:00');
    displayDate = d.toLocaleDateString(isEs ? 'es-ES' : 'en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { /* use raw */ }

  // Check if this is today
  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const isToday = dateStr === todayET;

  return (
    <Box>
      <Box
        component="button"
        onClick={() => setExpanded(prev => !prev)}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          py: '10px',
          px: '12px',
          bgcolor: C.surface,
          border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${isToday ? C.accent : C.cyan}`,
          borderRadius: '0',
          cursor: 'pointer',
          transition: 'all 0.15s',
          '&:hover': { bgcolor: C.surfaceAlt, borderColor: C.borderLight },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Typography sx={{
            fontFamily: MONO,
            fontSize: '10px',
            color: expanded ? C.cyan : C.textMuted,
            transition: 'transform 0.2s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>
            ▶
          </Typography>
          <Typography sx={{
            fontFamily: BARLOW,
            fontSize: '0.85rem',
            fontWeight: 700,
            color: isToday ? C.accent : C.textPrimary,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            {isToday ? (isEs ? 'HOY' : 'TODAY') : displayDate}
          </Typography>
          {isToday && (
            <Typography sx={{
              fontFamily: MONO, fontSize: '9px', color: C.textMuted, letterSpacing: '1px',
            }}>
              {displayDate}
            </Typography>
          )}
          <Typography sx={{
            fontFamily: MONO, fontSize: '9px', color: C.textDim, letterSpacing: '1px',
          }}>
            {total} {total === 1 ? 'pick' : 'picks'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {wins > 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.green, letterSpacing: '1px' }}>
              {wins}W
            </Typography>
          )}
          {losses > 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.red, letterSpacing: '1px' }}>
              {losses}L
            </Typography>
          )}
          {pushes > 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.cyan, letterSpacing: '1px' }}>
              {pushes}P
            </Typography>
          )}
          {pending > 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.amber, letterSpacing: '1px' }}>
              {pending}⏳
            </Typography>
          )}
        </Box>
      </Box>
      {expanded && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', pt: '6px', pb: '12px' }}>
          {picks.map(entry => (
            <PickCard key={entry.id} entry={entry} onMarkResult={onMarkResult} onDelete={onDelete} t={t} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function AnalisisTab({ lang }) {
  const t = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
  const { isAuthenticated, token } = useAuth();
  const { history, markResult, deletePick, clearHistory, getStats, loadHistory } = useHistory();
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
  const stats = getStats();
  const [confirming, setConfirming] = useState(false);
  const confirmTimeout = useRef(null);

  async function resolveAllPicks() {
    try {
      const res = await fetch(`${API_URL}/api/picks/resolve`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        // Reload picks
        loadHistory();
      }
    } catch (e) {
      console.error('Resolve error:', e);
    }
  }

  async function handleClearClick() {
    if (!confirming) {
      setConfirming(true);
      confirmTimeout.current = setTimeout(() => setConfirming(false), 3500);
    } else {
      clearTimeout(confirmTimeout.current);
      setConfirming(false);
      await clearHistory();
    }
  }

  if (!isAuthenticated) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 10, gap: '16px', minHeight: 300 }}>
        <Typography sx={{ fontSize: '2rem', lineHeight: 1 }}>📋</Typography>
        <Typography sx={{ fontFamily: SANS, fontSize: '0.875rem', color: C.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 1.7 }}>
          Inicia sesión para ver tu historial de picks.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(6, 1fr)' }, gap: '8px' }}>
        <StatCard value={stats.total}          label={t.history.totalPicks} color={C.textPrimary} />
        <StatCard value={stats.wins}           label={t.history.wins}       color={C.green}       />
        <StatCard value={stats.losses}         label={t.history.losses}     color={C.red}         />
        <StatCard value={stats.pushes ?? 0}    label={t.history.pushes}     color={C.cyan}        />
        <StatCard value={stats.pending}        label={t.history.pending}    color={C.amber}       />
        <StatCard value={`${stats.winRate}%`}  label={t.history.winRate}    color={C.accent}      />
      </Box>

      {/* Pick list */}
      {history.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 10, gap: '14px', minHeight: 260 }}>
          <Typography sx={{ fontSize: '2.5rem', lineHeight: 1 }}>📋</Typography>
          <Typography sx={{ fontFamily: SANS, fontSize: '0.875rem', color: C.textMuted, textAlign: 'center', maxWidth: 320, lineHeight: 1.7 }}>{t.history.empty}</Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {groupPicksByDay(history).map(([dayKey, dayPicks], idx) => (
            <DayHeader
              key={dayKey}
              dateStr={dayKey}
              picks={dayPicks}
              lang={lang}
              defaultExpanded={idx === 0}
              onMarkResult={markResult}
              onDelete={deletePick}
              t={t}
            />
          ))}
        </Box>
      )}

      {/* Clear footer */}
      {history.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', pt: '8px', borderTop: `1px solid ${C.border}` }}>
          <Box
            component="button"
            onClick={resolveAllPicks}
            sx={{
              px: '14px', py: '6px',
              border: `1px solid ${C.accentLine || C.border}`,
              borderRadius: '2px',
              bgcolor: 'transparent',
              color: C.accent,
              fontFamily: MONO,
              fontSize: '0.6rem',
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': { bgcolor: C.accentDim || 'rgba(0,217,255,0.08)', borderColor: C.accent },
            }}
          >
            {lang === 'es' ? '⟳ RESOLVER PICKS' : '⟳ RESOLVE PICKS'}
          </Box>
          <Box component="button" onClick={() => {
            if (window.confirm(lang === 'es'
              ? '⚠️ ¿Estás seguro? Esto ocultará todo tu historial de picks. Esta acción solo está disponible para administradores.'
              : '⚠️ Are you sure? This will hide your entire pick history. This action is only available to administrators.')) {
              clearHistory();
            }
          }} sx={{ px: '18px', py: '8px', border: `1px solid ${C.border}`, borderRadius: '2px', bgcolor: 'transparent', color: C.textMuted, fontFamily: BARLOW, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s', '&:hover': { borderColor: C.red, color: C.red, bgcolor: C.redDim } }}>
            {t.history.clearHistory}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BANCA TAB (bankroll tracker)
// ─────────────────────────────────────────────────────────────────────────────

function fmtMoney(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtOdds(n) {
  const num = Number(n);
  if (!num) return '—';
  return num > 0 ? `+${num}` : String(num);
}

// Compute bankroll curve points from bets
function buildCurve(initialBankroll, bets) {
  const sorted = [...bets]
    .filter(b => b.result !== 'pending')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const points = [{ date: null, value: initialBankroll }];
  let current  = initialBankroll;
  for (const b of sorted) {
    if (b.result === 'won')  current += b.potentialWin;
    if (b.result === 'lost') current -= b.stake;
    points.push({ date: b.date, value: parseFloat(current.toFixed(2)) });
  }
  return points;
}

// Calculate streak from bets (pushes don't break streaks)
function calcStreak(bets) {
  const resolved = [...bets]
    .filter(b => b.result === 'won' || b.result === 'lost')
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (resolved.length === 0) return '—';
  const firstResult = resolved[0].result;
  let count = 0;
  for (const b of resolved) {
    if (b.result !== firstResult) break;
    count++;
  }
  const emoji = firstResult === 'won' ? '🔥' : '❄️';
  const label = firstResult === 'won' ? 'G' : 'P';
  return `${emoji} ${count}${label}`;
}

// SVG line chart
function BankrollChart({ points, initialBankroll }) {
  if (points.length < 2) return null;

  const W = 600, H = 160, PAD = { top: 12, right: 8, bottom: 24, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const values  = points.map(p => p.value);
  const minVal  = Math.min(...values);
  const maxVal  = Math.max(...values);
  const range   = maxVal - minVal || 1;

  const scaleX  = (i) => PAD.left + (i / (points.length - 1)) * innerW;
  const scaleY  = (v) => PAD.top  + innerH - ((v - minVal) / range) * innerH;

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i).toFixed(1)} ${scaleY(p.value).toFixed(1)}`).join(' ');

  const refY  = scaleY(initialBankroll);

  return (
    <Box sx={{ width: '100%', overflow: 'hidden' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor={C.accent} />
            <stop offset="100%" stopColor={C.accent} />
          </linearGradient>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={C.accent} stopOpacity="0.12" />
            <stop offset="100%" stopColor={C.accent} stopOpacity="0"    />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y   = PAD.top + t * innerH;
          const val = maxVal - t * range;
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke={C.border} strokeWidth="1" />
              <text x={PAD.left - 4} y={y + 3} textAnchor="end" fill={C.textMuted} fontSize="8" fontFamily="JetBrains Mono, monospace">
                ${Math.round(val)}
              </text>
            </g>
          );
        })}

        {/* Initial bankroll reference line */}
        {refY >= PAD.top && refY <= PAD.top + innerH && (
          <line x1={PAD.left} y1={refY} x2={W - PAD.right} y2={refY} stroke={C.textMuted} strokeWidth="1" strokeDasharray="4,3" />
        )}

        {/* Area fill */}
        <path
          d={`${pathD} L ${scaleX(points.length - 1).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} L ${scaleX(0).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`}
          fill="url(#areaGrad)"
        />

        {/* Line */}
        <path d={pathD} fill="none" stroke="url(#lineGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={scaleX(i)} cy={scaleY(p.value)} r={3} fill={p.value >= initialBankroll ? C.green : C.red} />
        ))}
      </svg>
    </Box>
  );
}

// Add bet form
function AddBetForm({ onAdd }) {
  const [form, setForm] = useState({ matchup: '', pick: '', odds: '', stake: '', notes: '' });
  const [busy, setBusy]   = useState(false);
  const [err,  setErr]    = useState('');

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.matchup || !form.pick || !form.odds || !form.stake) {
      setErr('Completa los campos requeridos');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await onAdd({ ...form, odds: Number(form.odds), stake: Number(form.stake), source: 'manual' });
      setForm({ matchup: '', pick: '', odds: '', stake: '', notes: '' });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const inputSx = {
    background:   C.bgSec,
    border:       `1px solid ${C.border}`,
    borderRadius: '2px',
    color:        C.textPrimary,
    fontFamily:   SANS,
    fontSize:     '0.8rem',
    padding:      '7px 10px',
    outline:      'none',
    colorScheme:  'dark',
    width:        '100%',
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: '2px', p: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <SectionLabel>Registrar Apuesta</SectionLabel>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '10px' }}>
        <Box>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '4px' }}>Partido *</Typography>
          <input style={inputSx} placeholder="MIA vs WSH" value={form.matchup} onChange={e => set('matchup', e.target.value)} />
        </Box>
        <Box>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '4px' }}>Pick *</Typography>
          <input style={inputSx} placeholder="OVER 8.5" value={form.pick} onChange={e => set('pick', e.target.value)} />
        </Box>
        <Box>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '4px' }}>Momio * (ej: -110)</Typography>
          <input style={inputSx} type="number" placeholder="-110" value={form.odds} onChange={e => set('odds', e.target.value)} />
        </Box>
        <Box>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '4px' }}>Stake * ($)</Typography>
          <input style={inputSx} type="number" min="0.01" step="0.01" placeholder="10.00" value={form.stake} onChange={e => set('stake', e.target.value)} />
        </Box>
      </Box>

      <Box>
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '4px' }}>Notas</Typography>
        <input style={inputSx} placeholder="Opcional…" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </Box>

      {err && <Typography sx={{ fontFamily: SANS, fontSize: '0.72rem', color: C.red }}>{err}</Typography>}

      <Box component="button" type="submit" disabled={busy} sx={{ alignSelf: 'flex-start', px: '20px', py: '9px', border: `1px solid ${C.accent}`, borderRadius: '2px', background: C.accent, color: '#111111', fontFamily: BARLOW, fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, transition: 'all 0.15s' }}>
        {busy ? 'Registrando…' : '+ Registrar Apuesta'}
      </Box>
    </Box>
  );
}

// Bet result badge
function ResultBadge({ result }) {
  const cfg = result === 'won'
    ? { label: 'GANADA',    color: C.green, dim: C.greenDim, border: C.greenLine }
    : result === 'lost'
    ? { label: 'PERDIDA',   color: C.red,   dim: C.redDim,   border: C.redLine   }
    : result === 'push'
    ? { label: 'PUSH',      color: C.cyan,  dim: C.cyanDim,  border: C.cyanLine  }
    : { label: 'PENDIENTE', color: C.amber, dim: C.amberDim, border: C.amberLine };

  return (
    <Box component="span" sx={{ display: 'inline-block', px: '8px', py: '2px', bgcolor: cfg.dim, border: `1px solid ${cfg.border}`, borderRadius: '2px', fontFamily: BARLOW, fontSize: '0.6rem', fontWeight: 700, color: cfg.color, letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>
      {cfg.label}
    </Box>
  );
}

// Bets table
function BetsTable({ bets, onUpdateResult, onDelete }) {
  const sorted = [...bets].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (sorted.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 5 }}>
        <Typography sx={{ fontFamily: SANS, fontSize: '0.82rem', color: C.textMuted }}>Sin apuestas registradas aún.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {sorted.map(bet => {
        const dateStr = (() => { try { return new Date(bet.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; } })();
        return (
          <Box key={bet.id} sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${bet.result === 'won' ? C.green : bet.result === 'lost' ? C.red : bet.result === 'push' ? C.cyan : C.border}`, borderRadius: '0 2px 2px 0', p: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Top row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, flexShrink: 0 }}>{dateStr}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.82rem', fontWeight: 700, color: C.textPrimary, flex: 1 }}>{bet.matchup}</Typography>
              <ResultBadge result={bet.result} />
              {bet.source === 'hexa' && (
                <Box component="span" sx={{ px: '6px', py: '1px', bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`, borderRadius: '2px', fontFamily: MONO, fontSize: '9px', fontWeight: 700, color: C.accent, letterSpacing: '1px' }}>HEXA</Box>
              )}
            </Box>

            {/* Pick row */}
            <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textSecondary }}>{bet.pick}</Typography>

            {/* Stats row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <Typography sx={{ fontFamily: BARLOW, fontSize: '0.55rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Momio</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', fontWeight: 700, color: C.textPrimary }}>{fmtOdds(bet.odds)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <Typography sx={{ fontFamily: BARLOW, fontSize: '0.55rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Stake</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', fontWeight: 700, color: C.textPrimary }}>{fmtMoney(bet.stake)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <Typography sx={{ fontFamily: BARLOW, fontSize: '0.55rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ganancia posible</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', fontWeight: 700, color: C.green }}>+{fmtMoney(bet.potentialWin)}</Typography>
              </Box>
              {bet.notes && (
                <Typography sx={{ fontFamily: SANS, fontSize: '0.65rem', color: C.textMuted, fontStyle: 'italic', flex: 1 }}>{bet.notes}</Typography>
              )}
            </Box>

            {/* Action row */}
            <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {bet.result !== 'won' && (
                <ActionBtn label="✓ Ganada" color={C.green} dim={C.greenDim} border="rgba(0,230,118,0.3)" onClick={() => onUpdateResult(bet.id, 'won')} />
              )}
              {bet.result !== 'lost' && (
                <ActionBtn label="✗ Perdida" color={C.red} dim={C.redDim} border="rgba(255,61,87,0.3)" onClick={() => onUpdateResult(bet.id, 'lost')} />
              )}
              {bet.result !== 'push' && (
                <ActionBtn label="⇌ Push" color={C.cyan} dim={C.cyanDim} border={C.cyanLine} onClick={() => onUpdateResult(bet.id, 'push')} />
              )}
              {bet.result !== 'pending' && (
                <ActionBtn label="↺ Pendiente" color={C.textMuted} dim={C.surfaceAlt} border={C.border} onClick={() => onUpdateResult(bet.id, 'pending')} />
              )}
              <Box sx={{ ml: 'auto' }}>
                <ActionBtn label="🗑" color={C.red} dim="transparent" border="transparent" onClick={() => onDelete(bet.id)} />
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function ActionBtn({ label, color, dim, border, onClick }) {
  return (
    <Box component="button" onClick={onClick} sx={{ px: '10px', py: '4px', border: `1px solid ${border}`, borderRadius: '2px', bgcolor: dim, color, fontFamily: BARLOW, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.15s', '&:hover': { opacity: 0.8 } }}>
      {label}
    </Box>
  );
}

function BancaTab() {
  const { isAuthenticated } = useAuth();
  const { bankrollData, loading, setupBankroll, addBet, updateBetResult, deleteBet } = useBankroll();
  const [setupVal, setSetupVal] = useState('');
  const [setupErr, setSetupErr] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);

  if (!isAuthenticated) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 10, gap: '16px', minHeight: 300 }}>
        <Typography sx={{ fontSize: '2rem', lineHeight: 1 }}>💰</Typography>
        <Typography sx={{ fontFamily: SANS, fontSize: '0.875rem', color: C.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 1.7 }}>
          Inicia sesión para usar el Bankroll Tracker.
        </Typography>
      </Box>
    );
  }

  if (loading && !bankrollData) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted }}>Cargando banca…</Typography>
      </Box>
    );
  }

  // SETUP state
  if (!bankrollData || bankrollData.initialBankroll === null) {
    async function handleSetup(e) {
      e.preventDefault();
      const amount = Number(setupVal);
      if (!amount || amount <= 0) { setSetupErr('Ingresa un monto válido'); return; }
      setSetupBusy(true);
      setSetupErr('');
      try { await setupBankroll(amount); }
      catch (e) { setSetupErr(e.message); }
      finally { setSetupBusy(false); }
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, gap: '24px', minHeight: 320 }}>
        <Box sx={{ textAlign: 'center' }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '1.4rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.1em', textTransform: 'uppercase', mb: '6px' }}>
            Define tu Banca Inicial
          </Typography>
          <Typography sx={{ fontFamily: SANS, fontSize: '0.82rem', color: C.textMuted, maxWidth: 300, lineHeight: 1.7 }}>
            Establece el monto de tu bankroll para empezar a rastrear tus apuestas y calcular tu ROI.
          </Typography>
        </Box>

        <Box component="form" onSubmit={handleSetup} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%', maxWidth: 280 }}>
          <Box sx={{ position: 'relative', width: '100%' }}>
            <Typography sx={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontFamily: MONO, fontSize: '0.9rem', color: C.textMuted, pointerEvents: 'none' }}>$</Typography>
            <input
              type="number"
              min="1"
              step="0.01"
              placeholder="1000.00"
              value={setupVal}
              onChange={e => setSetupVal(e.target.value)}
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '2px', color: C.textPrimary, fontFamily: MONO, fontSize: '1.1rem', fontWeight: 700, padding: '12px 16px 12px 28px', outline: 'none', colorScheme: 'dark', textAlign: 'center' }}
            />
          </Box>
          {setupErr && <Typography sx={{ fontFamily: SANS, fontSize: '0.72rem', color: C.red }}>{setupErr}</Typography>}
          <Box component="button" type="submit" disabled={setupBusy} sx={{ width: '100%', py: '12px', border: `1px solid ${C.accent}`, borderRadius: '2px', background: C.accent, color: '#111111', fontFamily: BARLOW, fontSize: '0.9rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: setupBusy ? 'default' : 'pointer', opacity: setupBusy ? 0.6 : 1 }}>
            {setupBusy ? 'Configurando…' : 'Comenzar'}
          </Box>
        </Box>
      </Box>
    );
  }

  // DASHBOARD state
  const { initialBankroll, currentBankroll, bets } = bankrollData;
  const netGain     = currentBankroll - initialBankroll;
  const roi         = initialBankroll ? ((netGain / initialBankroll) * 100).toFixed(1) : '0.0';
  const streak      = calcStreak(bets);
  const total       = bets.length;
  const won         = bets.filter(b => b.result === 'won').length;
  const lost        = bets.filter(b => b.result === 'lost').length;
  const winRate     = total > 0 ? ((won / total) * 100).toFixed(0) : '0';
  const curve       = buildCurve(initialBankroll, bets);
  const bankrollColor = currentBankroll >= initialBankroll ? C.green : C.red;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Top stats row */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: '8px' }}>
        <StatCard value={fmtMoney(currentBankroll)} label="Banca Actual"  color={bankrollColor} />
        <StatCard value={(netGain >= 0 ? '+' : '') + fmtMoney(netGain)} label="Ganancia Neta" color={bankrollColor} />
        <StatCard value={`${roi}%`} label="ROI" color={Number(roi) >= 0 ? C.green : C.red} sub={`desde ${fmtMoney(initialBankroll)}`} />
        <StatCard value={streak} label="Racha Actual" color={C.accent} />
      </Box>

      {/* Second stats row */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
        <StatCard value={total}       label="Apostadas"  color={C.textPrimary} />
        <StatCard value={won}         label="Ganadas"    color={C.green} />
        <StatCard value={lost}        label="Perdidas"   color={C.red} />
        <StatCard value={`${winRate}%`} label="Win Rate" color={C.accent} />
      </Box>

      {/* Bankroll chart */}
      {curve.length >= 2 && (
        <Box sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: '2px', p: '14px' }}>
          <SectionLabel>Evolución de Banca</SectionLabel>
          <BankrollChart points={curve} initialBankroll={initialBankroll} />
        </Box>
      )}

      {/* Add bet form */}
      <AddBetForm onAdd={addBet} />

      {/* Bets table */}
      <Box sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: '2px', p: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SectionLabel>Historial de Apuestas</SectionLabel>
        <BetsTable bets={bets} onUpdateResult={updateBetResult} onDelete={deleteBet} />
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export default function HistoryPanel({ lang = 'en' }) {
  return (
    <Box sx={{ bgcolor: C.bg, minHeight: '60vh', p: 2, display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <AnalisisTab lang={lang} />
    </Box>
  );
}
