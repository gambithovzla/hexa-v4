import { useState, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';

const L = {
  en: {
    title:        'LEARNINGS',
    expand:       '▾',
    collapse:     '▴',
    summary: (resolved, wr) => `${resolved} resolved · WR ${wr ?? '—'}`,
    noData:       'Not enough resolved parlays yet — finalize a few runs to see your patterns.',
    pending: (n) => `${n} pending`,
    headlines:    'HEADLINES',
    bestMode:     'Best mode',
    worstMode:    'Worst mode',
    topMissDriver:'Top miss driver (leg-type)',
    missBreakdown:'Miss breakdown',
    missBy1:      'Lost by 1 leg',
    missBy2:      'Lost by 2 legs',
    missBy3plus:  'Lost by 3+',
    matrix:       'PERFORMANCE MATRIX',
    dimensions: {
      mode:     'Mode',
      betType:  'Bet type',
      engine:   'Engine',
      model:    'Model',
      synergy:  'Synergy',
      legCount: 'Leg count',
      legType:  'Per-leg type',
    },
    cols: {
      key:        'Bucket',
      total:      'N',
      wins:       'W',
      losses:     'L',
      pushes:     'P',
      winRate:    'WR%',
      avgLegsHit: 'Avg hit',
      missBy1:    'Miss-by-1',
      avgDecOdds: 'Avg odds',
    },
    smallSample:  'small sample',
    none:         '—',
  },
  es: {
    title:        'APRENDIZAJES',
    expand:       '▾',
    collapse:     '▴',
    summary: (resolved, wr) => `${resolved} resueltas · WR ${wr ?? '—'}`,
    noData:       'Aún no hay suficientes parlays resueltos. Finaliza algunas corridas para ver tus patrones.',
    pending: (n) => `${n} pendientes`,
    headlines:    'TITULARES',
    bestMode:     'Mejor modo',
    worstMode:    'Peor modo',
    topMissDriver:'Tipo de pata que más falla',
    missBreakdown:'Cómo perdiste',
    missBy1:      'Perdido por 1 pata',
    missBy2:      'Perdido por 2 patas',
    missBy3plus:  'Perdido por 3+',
    matrix:       'MATRIZ DE PERFORMANCE',
    dimensions: {
      mode:     'Modo',
      betType:  'Tipo apuesta',
      engine:   'Engine',
      model:    'Modelo',
      synergy:  'Sinergia',
      legCount: 'Núm patas',
      legType:  'Tipo de pata',
    },
    cols: {
      key:        'Categoría',
      total:      'N',
      wins:       'G',
      losses:     'P',
      pushes:     'E',
      winRate:    'WR%',
      avgLegsHit: 'Patas avg',
      missBy1:    'Perd-por-1',
      avgDecOdds: 'Momios avg',
    },
    smallSample:  'muestra chica',
    none:         '—',
  },
};

const SMALL_SAMPLE = 5;

function fmtPct(v) {
  if (v == null) return '—';
  return `${Math.round(Number(v) * 100)}%`;
}
function fmtOdds(v) {
  if (v == null) return '—';
  return `×${Number(v).toFixed(2)}`;
}
function fmtNum(v, digits = 1) {
  if (v == null) return '—';
  return Number(v).toFixed(digits);
}
function fmtKey(v) {
  if (v == null) return '—';
  return String(v).replace(/_/g, ' ');
}
function wrColor(wr, sample) {
  if (wr == null || sample < SMALL_SAMPLE) return C.textMuted;
  if (wr >= 0.55) return C.green;
  if (wr >= 0.40) return C.amber;
  return C.red;
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 && value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <Box sx={{ width: '100%', height: '4px', bgcolor: `${C.borderLight}`, position: 'relative' }}>
      <Box sx={{ position: 'absolute', inset: 0, width: `${pct}%`, bgcolor: color }} />
    </Box>
  );
}

function HeadlineCard({ label, value, sub, color = C.cyan }) {
  return (
    <Box sx={{
      flex: 1,
      minWidth: '160px',
      border: `1px solid ${C.borderLight}`,
      borderLeft: `3px solid ${color}`,
      bgcolor: 'rgba(0,0,0,0.25)',
      px: '12px',
      py: '10px',
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, letterSpacing: '0.14em', textTransform: 'uppercase', mb: '4px' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: BARLOW, fontWeight: 700, fontSize: '0.95rem', color, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mt: '3px' }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

function PerformanceMatrix({ data, t }) {
  const dims = [
    { key: 'mode',     rows: data.byMode     },
    { key: 'betType',  rows: data.byBetType  },
    { key: 'engine',   rows: data.byEngine   },
    { key: 'model',    rows: data.byModel    },
    { key: 'synergy',  rows: data.bySynergy  },
    { key: 'legCount', rows: data.byLegCount },
    { key: 'legType',  rows: data.byLegType  },
  ];
  const [active, setActive] = useState('mode');
  const current = dims.find(d => d.key === active) ?? dims[0];
  const isLegType = active === 'legType';

  const maxTotal = useMemo(
    () => current.rows.reduce((m, r) => Math.max(m, r.total ?? 0), 0),
    [current.rows],
  );

  return (
    <Box>
      <Typography sx={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '0.7rem', letterSpacing: '0.18em', color: C.accent, textTransform: 'uppercase', mb: '8px' }}>
        {t.matrix}
      </Typography>

      {/* Dimension tabs */}
      <Box sx={{ display: 'flex', gap: '4px', flexWrap: 'wrap', mb: '10px' }}>
        {dims.map(d => {
          const isActive = d.key === active;
          return (
            <Box
              key={d.key}
              onClick={() => setActive(d.key)}
              sx={{
                cursor: 'pointer',
                border: `1px solid ${isActive ? C.cyan : C.borderLight}`,
                bgcolor: isActive ? `${C.cyan}18` : 'transparent',
                px: '8px',
                py: '3px',
                '&:hover': { borderColor: C.cyan },
              }}
            >
              <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: isActive ? C.cyan : C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: isActive ? 700 : 400 }}>
                {t.dimensions[d.key]}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Table */}
      {current.rows.length === 0 ? (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, py: '12px' }}>
          {t.none}
        </Typography>
      ) : (
        <Box sx={{ border: `1px solid ${C.borderLight}`, bgcolor: C.surface, overflowX: 'auto' }}>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: isLegType
              ? 'minmax(120px,1.5fr) 50px 40px 40px 40px 60px'
              : 'minmax(120px,1.5fr) 50px 40px 40px 40px 60px 60px 60px 60px',
            gap: '0',
            minWidth: isLegType ? '420px' : '620px',
          }}>
            {/* Header */}
            {[
              t.cols.key, t.cols.total, t.cols.wins, t.cols.losses, t.cols.pushes, t.cols.winRate,
              ...(isLegType ? [] : [t.cols.avgLegsHit, t.cols.missBy1, t.cols.avgDecOdds]),
            ].map((h, i) => (
              <Box key={i} sx={{
                px: '8px', py: '6px',
                borderBottom: `1px solid ${C.borderLight}`,
                bgcolor: 'rgba(0,217,255,0.04)',
                position: 'sticky', top: 0,
              }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.cyan, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                  {h}
                </Typography>
              </Box>
            ))}

            {/* Rows */}
            {current.rows.map((row, idx) => {
              const isSmall = (row.total ?? 0) < SMALL_SAMPLE;
              const wrCol   = wrColor(row.winRate, row.total);
              const cells = [
                <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textPrimary, textTransform: 'capitalize' }}>
                  {fmtKey(row.key)}
                </Typography>,
                <Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textSecondary }}>{row.total}</Typography>
                  <MiniBar value={row.total} max={maxTotal} color={C.cyan} />
                </Box>,
                <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.green }}>{row.wins}</Typography>,
                <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.red }}>{row.losses}</Typography>,
                <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.amber }}>{row.pushes}</Typography>,
                <Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: wrCol, fontWeight: 700 }}>
                    {fmtPct(row.winRate)}
                  </Typography>
                  {isSmall && (
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.48rem', color: C.textMuted, fontStyle: 'italic' }}>
                      {t.smallSample}
                    </Typography>
                  )}
                </Box>,
              ];
              if (!isLegType) {
                cells.push(
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
                    {fmtNum(row.avgLegsHit)}
                  </Typography>,
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: row.missBy1 > 0 ? C.amber : C.textMuted }}>
                    {row.missBy1 ?? 0}
                  </Typography>,
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
                    {fmtOdds(row.avgDecOdds)}
                  </Typography>,
                );
              }
              return cells.map((cell, i) => (
                <Box key={`${idx}-${i}`} sx={{
                  px: '8px', py: '6px',
                  borderBottom: idx < current.rows.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                }}>
                  {cell}
                </Box>
              ));
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function buildHeadlines(data, t) {
  const out = [];
  const eligible = (data.byMode ?? []).filter(b => b.total >= SMALL_SAMPLE && b.winRate != null);
  if (eligible.length > 0) {
    const sorted = [...eligible].sort((a, b) => b.winRate - a.winRate);
    out.push({
      label: t.bestMode,
      value: fmtKey(sorted[0].key),
      sub:   `${fmtPct(sorted[0].winRate)} · ${sorted[0].wins}W ${sorted[0].losses}L`,
      color: C.green,
    });
    if (sorted.length > 1) {
      const worst = sorted[sorted.length - 1];
      out.push({
        label: t.worstMode,
        value: fmtKey(worst.key),
        sub:   `${fmtPct(worst.winRate)} · ${worst.wins}W ${worst.losses}L`,
        color: C.red,
      });
    }
  }
  const legTypes = (data.byLegType ?? []).filter(b => b.losses > 0);
  if (legTypes.length > 0) {
    const top = [...legTypes].sort((a, b) => b.losses - a.losses)[0];
    out.push({
      label: t.topMissDriver,
      value: fmtKey(top.key),
      sub:   `${top.losses}L · ${fmtPct(top.winRate)} WR`,
      color: C.amber,
    });
  }
  return out;
}

export default function HexaLearnings({ lang = 'en', data, loading, error }) {
  const t = L[lang] ?? L.en;
  const [open, setOpen] = useState(false);

  const summary = data?.summary ?? null;
  const wr = summary?.overallWinRate;
  const headerSummary = summary && summary.totalResolved > 0
    ? t.summary(summary.totalResolved, fmtPct(wr))
    : (loading ? '…' : t.summary(0, '—'));

  const headlines = data ? buildHeadlines(data, t) : [];
  const mb = data?.missBreakdown ?? null;

  return (
    <Box sx={{ mt: '24px', border: `1px solid ${C.borderLight}`, bgcolor: C.surface }}>
      {/* Collapsed bar */}
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'center', gap: '12px',
          px: '14px', py: '10px',
          cursor: 'pointer',
          borderBottom: open ? `1px solid ${C.borderLight}` : 'none',
          '&:hover': { bgcolor: 'rgba(0,217,255,0.04)' },
        }}
      >
        <Typography sx={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.2em', color: C.accent, textTransform: 'uppercase' }}>
          ◆ {t.title}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textSecondary, flex: 1 }}>
          {headerSummary}
          {summary?.pending > 0 && (
            <span style={{ color: C.amber, marginLeft: '10px' }}>· {t.pending(summary.pending)}</span>
          )}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.78rem', color: C.cyan }}>
          {open ? t.collapse : t.expand}
        </Typography>
      </Box>

      {/* Expanded body */}
      {open && (
        <Box sx={{ px: '14px', py: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {error && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.red }}>
              {error}
            </Typography>
          )}
          {loading && !data && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted }}>
              …
            </Typography>
          )}
          {data && summary?.totalResolved === 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted }}>
              {t.noData}
            </Typography>
          )}

          {data && summary?.totalResolved > 0 && (
            <>
              {/* Headlines */}
              {headlines.length > 0 && (
                <Box>
                  <Typography sx={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '0.7rem', letterSpacing: '0.18em', color: C.accent, textTransform: 'uppercase', mb: '8px' }}>
                    {t.headlines}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {headlines.map((h, i) => (
                      <HeadlineCard key={i} label={h.label} value={h.value} sub={h.sub} color={h.color} />
                    ))}
                  </Box>
                </Box>
              )}

              {/* Miss breakdown */}
              {mb && mb.totalLosses > 0 && (
                <Box>
                  <Typography sx={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '0.7rem', letterSpacing: '0.18em', color: C.accent, textTransform: 'uppercase', mb: '8px' }}>
                    {t.missBreakdown}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <HeadlineCard label={t.missBy1}     value={mb.missBy1}     sub={fmtPct(mb.missBy1 / mb.totalLosses)}     color={C.amber} />
                    <HeadlineCard label={t.missBy2}     value={mb.missBy2}     sub={fmtPct(mb.missBy2 / mb.totalLosses)}     color={C.amber} />
                    <HeadlineCard label={t.missBy3plus} value={mb.missBy3plus} sub={fmtPct(mb.missBy3plus / mb.totalLosses)} color={C.red} />
                  </Box>
                </Box>
              )}

              {/* Performance matrix */}
              <PerformanceMatrix data={data} t={t} />
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
