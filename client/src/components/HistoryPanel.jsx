/**
 * HistoryPanel.jsx
 * Displays the full pick history with stats dashboard, result tracking,
 * and clear controls.
 *
 * Props:
 *   lang  — 'en' | 'es'
 *
 * Internally uses useHistory() — no external state needed.
 * Note: This component is conditionally rendered in App.jsx (only when the
 * history tab is active), so it remounts on each tab visit and automatically
 * reads the latest localStorage state.
 */

import { useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import useHistory from '../hooks/useHistory';
import en from '../i18n/en.json';
import es from '../i18n/es.json';

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          '#0a0e17',
  cardBg:      '#111827',
  cardBorder:  '#1e293b',
  accent:      '#f59e0b',
  accentDim:   '#f59e0b12',
  textPrimary: '#f1f5f9',
  textMuted:   '#94a3b8',
  green:       '#22c55e',
  greenDim:    '#22c55e14',
  red:         '#ef4444',
  redDim:      '#ef444414',
  amber:       '#f59e0b',
  amberDim:    '#f59e0b14',
  blue:        '#3b82f6',
  blueDim:     '#3b82f614',
};

const MONO  = '"JetBrains Mono", "Fira Code", monospace';
const LABEL = '"Outfit", "Inter", system-ui, sans-serif';

const TRANSLATIONS = { en, es };

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ value, label, color, suffix = '' }) {
  return (
    <Box
      sx={{
        bgcolor: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: '10px',
        p: '16px 12px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: { xs: '1.5rem', sm: '1.9rem' },
          fontWeight: 700,
          color,
          lineHeight: 1,
        }}
      >
        {value}{suffix}
      </Typography>
      <Typography
        sx={{
          fontFamily: LABEL,
          fontSize: '0.58rem',
          fontWeight: 700,
          color: C.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.09em',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

// ── Result border color ───────────────────────────────────────────────────────

function resultBorderColor(result) {
  if (result === 'win')  return C.green;
  if (result === 'loss') return C.red;
  return C.cardBorder;
}

function resultBadgeSx(result) {
  if (result === 'win')
    return { bgcolor: C.greenDim, border: `1px solid ${C.green}44`, color: C.green };
  if (result === 'loss')
    return { bgcolor: C.redDim,   border: `1px solid ${C.red}44`,   color: C.red   };
  return   { bgcolor: C.amberDim, border: `1px solid ${C.amber}44`, color: C.amber };
}

// ── Mini confidence bar (no animation — already stored pick) ─────────────────

function MiniConfBar({ value }) {
  const num   = Math.min(100, Math.max(0, Number(value) || 0));
  const color = num >= 75 ? C.green : num >= 50 ? C.amber : C.red;
  return (
    <Box sx={{ height: 4, bgcolor: `${color}22`, borderRadius: 4, overflow: 'hidden', width: 80 }}>
      <Box sx={{ height: '100%', width: `${num}%`, bgcolor: color, borderRadius: 4 }} />
    </Box>
  );
}

// ── Mode badge ────────────────────────────────────────────────────────────────

function ModeBadge({ mode, t }) {
  const label = t.history.mode?.[mode] ?? mode;
  const colors = {
    single:  { bg: C.blueDim,  border: `${C.blue}44`,  text: C.blue  },
    parlay:  { bg: C.amberDim, border: `${C.amber}44`, text: C.amber },
    fullday: { bg: '#8b5cf614', border: '#8b5cf644',   text: '#a78bfa' },
    fullDay: { bg: '#8b5cf614', border: '#8b5cf644',   text: '#a78bfa' },
  };
  const cfg = colors[mode] ?? colors.single;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        px: '7px',
        py: '2px',
        bgcolor: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: '4px',
        fontFamily: LABEL,
        fontSize: '0.58rem',
        fontWeight: 700,
        color: cfg.text,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        flexShrink: 0,
      }}
    >
      {label}
    </Box>
  );
}

// ── Pick entry card ───────────────────────────────────────────────────────────

function PickCard({ entry, onMarkResult, t }) {
  const borderColor = resultBorderColor(entry.result);
  const badgeSx     = resultBadgeSx(entry.result);
  const resultLabel = t.history.result?.[entry.result] ?? entry.result.toUpperCase();

  const dateStr = (() => {
    try {
      return new Date(entry.date).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return entry.date ?? '';
    }
  })();

  return (
    <Box
      sx={{
        bgcolor: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: '0 10px 10px 0',
        p: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* Row 1 — meta */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <ModeBadge mode={entry.mode} t={t} />
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.65rem', color: C.textMuted, flex: 1 }}>
          {dateStr}
        </Typography>
        {/* Result badge (always visible) */}
        <Box
          sx={{
            ...badgeSx,
            px: '8px',
            py: '2px',
            borderRadius: '4px',
            fontFamily: MONO,
            fontSize: '0.6rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            flexShrink: 0,
          }}
        >
          {resultLabel}
        </Box>
      </Box>

      {/* Row 2 — matchup */}
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: '0.9rem',
          fontWeight: 700,
          color: C.textPrimary,
          lineHeight: 1.3,
        }}
      >
        {entry.matchup}
      </Typography>

      {/* Row 3 — pick + confidence */}
      {entry.pick && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.78rem',
              color: C.accent,
              fontWeight: 600,
              flex: 1,
            }}
          >
            {entry.pick}
          </Typography>
          {entry.confidence > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <MiniConfBar value={entry.confidence} />
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  color: entry.confidence >= 75 ? C.green : entry.confidence >= 50 ? C.amber : C.red,
                  minWidth: '34px',
                  textAlign: 'right',
                }}
              >
                {entry.confidence}%
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Row 4 — mark result buttons (only if pending) */}
      {entry.result === 'pending' && (
        <Box sx={{ display: 'flex', gap: '8px', pt: '2px' }}>
          <MarkButton
            label={`✓ ${t.history.markWin}`}
            color={C.green}
            dimColor={C.greenDim}
            onClick={() => onMarkResult(entry.id, 'win')}
          />
          <MarkButton
            label={`✗ ${t.history.markLoss}`}
            color={C.red}
            dimColor={C.redDim}
            onClick={() => onMarkResult(entry.id, 'loss')}
          />
        </Box>
      )}
    </Box>
  );
}

function MarkButton({ label, color, dimColor, onClick }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        px: '14px',
        py: '6px',
        border: `1px solid ${color}66`,
        borderRadius: '6px',
        bgcolor: dimColor,
        color,
        fontFamily: LABEL,
        fontSize: '0.72rem',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all 0.15s',
        '&:hover': { bgcolor: `${color}25`, borderColor: color },
        '&:active': { transform: 'scale(0.97)' },
      }}
    >
      {label}
    </Box>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ t }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 10,
        gap: '16px',
        minHeight: 320,
      }}
    >
      <Typography sx={{ fontSize: '2.5rem', lineHeight: 1 }}>📋</Typography>
      <Typography
        sx={{
          fontFamily: LABEL,
          fontSize: '0.875rem',
          color: C.textMuted,
          textAlign: 'center',
          maxWidth: 320,
          lineHeight: 1.7,
        }}
      >
        {t.history.empty}
      </Typography>
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function HistoryPanel({ lang = 'en' }) {
  const t = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
  const { history, markResult, clearHistory, getStats } = useHistory();

  const stats = getStats();

  // Two-stage clear confirmation
  const [confirming, setConfirming]   = useState(false);
  const confirmTimeout                 = useRef(null);

  function handleClearClick() {
    if (!confirming) {
      setConfirming(true);
      confirmTimeout.current = setTimeout(() => setConfirming(false), 3500);
    } else {
      clearTimeout(confirmTimeout.current);
      clearHistory();
      setConfirming(false);
    }
  }

  return (
    <Box sx={{ bgcolor: C.bg, minHeight: '60vh', p: 2, display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Header ── */}
      <Box>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: '1.1rem',
            fontWeight: 700,
            color: C.textPrimary,
            mb: '2px',
          }}
        >
          {t.history.title}
        </Typography>
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.75rem', color: C.textMuted }}>
          {t.history.subtitle}
        </Typography>
      </Box>

      {/* ── Stats Dashboard ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(5, 1fr)' },
          gap: '10px',
        }}
      >
        <StatCard value={stats.total}   label={t.history.totalPicks} color={C.textPrimary} />
        <StatCard value={stats.wins}    label={t.history.wins}       color={C.green}       />
        <StatCard value={stats.losses}  label={t.history.losses}     color={C.red}         />
        <StatCard value={stats.pending} label={t.history.pending}    color={C.amber}       />
        <StatCard
          value={stats.winRate}
          suffix="%"
          label={t.history.winRate}
          color={C.blue}
        />
      </Box>

      {/* ── Pick list ── */}
      {history.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {history.map(entry => (
            <PickCard
              key={entry.id}
              entry={entry}
              onMarkResult={markResult}
              t={t}
            />
          ))}
        </Box>
      )}

      {/* ── Footer: Clear History ── */}
      {history.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            pt: '8px',
            borderTop: `1px solid ${C.cardBorder}`,
          }}
        >
          <Box
            component="button"
            onClick={handleClearClick}
            sx={{
              px: '18px',
              py: '8px',
              border: `1px solid ${confirming ? C.red : C.cardBorder}`,
              borderRadius: '7px',
              bgcolor: confirming ? C.redDim : 'transparent',
              color: confirming ? C.red : C.textMuted,
              fontFamily: LABEL,
              fontSize: '0.75rem',
              fontWeight: confirming ? 700 : 400,
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': {
                borderColor: C.red,
                color: C.red,
                bgcolor: C.redDim,
              },
            }}
          >
            {confirming ? t.history.confirmClear : t.history.clearHistory}
          </Box>
        </Box>
      )}
    </Box>
  );
}
