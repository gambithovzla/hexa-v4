/**
 * LearningCenter.jsx — "Guía H.E.X.A." / "Learn MLB with H.E.X.A."
 *
 * Static, dynamically rendered from src/data/hexaLearningCenter.js.
 * Supports category filtering, a simple text search, and accordion entries.
 */

import { useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, BARLOW, MONO } from '../theme';
import { CATEGORIES, LEARNING_ENTRIES } from '../data/hexaLearningCenter';

const T = {
  en: {
    title:     'H.E.X.A. GUIDE',
    subtitle:  'Clear, bettor-focused explanations of the concepts this system uses',
    all:       'All',
    search:    'Search concepts…',
    empty:     'No entries match your search.',
  },
  es: {
    title:     'GUÍA H.E.X.A.',
    subtitle:  'Explicaciones claras, orientadas a apostadores, de los conceptos que usa H.E.X.A.',
    all:       'Todos',
    search:    'Buscar concepto…',
    empty:     'Ningún concepto coincide con tu búsqueda.',
  },
};

function CategoryChip({ label, active, onClick }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        px: '12px', py: '5px',
        border: `1px solid ${active ? C.cyan : C.border}`,
        bgcolor: active ? C.cyanDim : 'transparent',
        color: active ? C.cyan : C.textMuted,
        fontFamily: BARLOW,
        fontSize: '0.65rem',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'all 0.18s',
        '&:hover': { borderColor: C.cyan, color: C.cyan },
      }}
    >
      {label}
    </Box>
  );
}

function Accordion({ entry, lang, open, onToggle }) {
  const title = entry.title[lang] ?? entry.title.en;
  const body  = entry.body[lang]  ?? entry.body.en;
  return (
    <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, mb: 1 }}>
      <Box
        component="button"
        onClick={onToggle}
        sx={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          px: '16px', py: '12px',
          bgcolor: 'transparent', border: 'none',
          color: C.textPrimary, fontFamily: BARLOW,
          fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.06em',
          textAlign: 'left', cursor: 'pointer',
          '&:hover': { bgcolor: C.elevated },
        }}
      >
        <span>{title}</span>
        <span style={{ color: C.accent, fontFamily: MONO, fontSize: '0.9rem' }}>{open ? '−' : '+'}</span>
      </Box>
      {open && (
        <Box sx={{ px: '16px', pb: '14px', borderTop: `1px solid ${C.border}` }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.82rem', color: C.textSecondary, lineHeight: 1.6, whiteSpace: 'pre-line', pt: '10px' }}>
            {body}
          </Typography>
          <Box sx={{ mt: 1.2, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {entry.tags.map(tag => (
              <Typography key={tag} sx={{
                fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.1em',
                border: `1px solid ${C.border}`, px: '6px', py: '2px',
              }}>
                #{tag}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default function LearningCenter({ lang = 'es' }) {
  const t = T[lang] ?? T.es;
  const [category, setCategory] = useState('all');
  const [query, setQuery]       = useState('');
  const [openIds, setOpenIds]   = useState(() => new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LEARNING_ENTRIES.filter(e => {
      if (category !== 'all' && e.category !== category) return false;
      if (!q) return true;
      const blob = [
        e.title.es, e.title.en, e.body.es, e.body.en, ...e.tags,
      ].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }, [category, query]);

  const toggle = (id) => setOpenIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', width: '100%' }}>
      {/* ── Header ── */}
      <Box sx={{ mb: 2 }}>
        <Typography sx={{
          fontFamily: BARLOW, fontWeight: 800, letterSpacing: '4px',
          fontSize: { xs: '1.2rem', sm: '1.5rem' }, color: C.accent,
          textShadow: '0 0 14px rgba(255,102,0,0.35)',
        }}>
          {t.title}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted, letterSpacing: '0.1em' }}>
          {t.subtitle}
        </Typography>
      </Box>

      {/* ── Controls ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <CategoryChip label={t.all} active={category === 'all'} onClick={() => setCategory('all')} />
        {CATEGORIES.map(c => (
          <CategoryChip
            key={c.id}
            label={lang === 'es' ? c.es : c.en}
            active={category === c.id}
            onClick={() => setCategory(c.id)}
          />
        ))}
        <Box
          component="input"
          placeholder={t.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{
            flex: 1, minWidth: '180px',
            ml: 'auto',
            px: '12px', py: '6px',
            bgcolor: C.surface,
            border: `1px solid ${C.border}`,
            color: C.textPrimary,
            fontFamily: MONO, fontSize: '0.78rem',
            outline: 'none',
            '&:focus': { borderColor: C.cyan, boxShadow: C.cyanGlow },
          }}
        />
      </Box>

      {/* ── List ── */}
      {filtered.length === 0 ? (
        <Box sx={{ p: 3, border: `1px dashed ${C.border}`, textAlign: 'center' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', color: C.textMuted }}>
            {t.empty}
          </Typography>
        </Box>
      ) : (
        filtered.map(entry => (
          <Accordion
            key={entry.id}
            entry={entry}
            lang={lang}
            open={openIds.has(entry.id)}
            onToggle={() => toggle(entry.id)}
          />
        ))
      )}
    </Box>
  );
}
