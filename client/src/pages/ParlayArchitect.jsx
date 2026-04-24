import { useState } from 'react';
import { Box, Typography, Slider } from '@mui/material';
import { useAuth } from '../store/authStore';
import useGames from '../hooks/useGames';
import useParlayArchitectHistory from '../hooks/useParlayArchitectHistory';
import OracleLoadingOverlay from '../components/OracleLoadingOverlay';
import ParlayLegCard from '../components/ParlayLegCard';
import ParlayArchitectHistory from '../components/ParlayArchitectHistory';
import { C, MONO, BARLOW } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const L = {
  en: {
    title: 'PARLAY ARCHITECT',
    subtitle: '// SYNERGY ENGINE — H.E.X.A. PARLAY INTELLIGENCE',
    date: 'DATE',
    selectGames: 'SELECT GAMES',
    selectHint: 'Choose 2 or more games to build a parlay',
    noGames: 'No games found for this date.',
    loadingGames: 'Loading schedule...',
    selected: 'selected',
    mode: 'MODE',
    modes: {
      conservative: 'Conservative',
      balanced:     'Balanced',
      aggressive:   'Aggressive',
      dreamer:      'Dreamer',
    },
    modeDesc: {
      conservative: 'Low risk, high data quality',
      balanced:     'Balanced edge + correlation',
      aggressive:   'Max risk diversity',
      dreamer:      'Longest parlays, max reward',
    },
    legs: 'LEGS',
    model: 'MODEL TIER',
    fast: 'Fast',
    deep: 'Deep',
    credits: 'cr',
    run: 'RUN PARLAY ARCHITECT',
    needGames: 'Select at least 2 games to continue.',
    chosenParlay: 'CHOSEN PARLAY',
    combinedProb: 'Combined Prob',
    decimalOdds: 'Decimal Odds',
    edgeScore: 'Edge Score',
    synergyType: 'Synergy Type',
    thesis: 'SYNERGY THESIS',
    warnings: 'WARNINGS',
    hiddenCorr: 'HIDDEN CORRELATIONS',
    alternatives: 'ALTERNATIVES',
    alt: 'Alt',
    score: 'Score',
    show: 'show',
    hide: 'hide',
    archMeta: 'ARCHITECT META',
    fallbackBadge: 'FALLBACK — LLM unavailable',
    overrodeBadge: 'OVERRODE COMPOSER',
    timings: 'Timings',
    composerMs: 'Composer',
    llmMs: 'LLM',
    totalMs: 'Total',
    emptyHint: 'Select games and run the engine to see results.',
    errorTitle: 'Error',
    retry: 'RETRY',
    candPool: 'Pool',
    rejected: 'Rejected',
    model_used: 'Model',
    selectAll: 'SELECT ALL',
    clearAll: 'CLEAR ALL',
  },
  es: {
    title: 'PARLAY ARCHITECT',
    subtitle: '// MOTOR SINÉRGICO — INTELIGENCIA DE PARLAY H.E.X.A.',
    date: 'FECHA',
    selectGames: 'SELECCIONAR JUEGOS',
    selectHint: 'Elige 2 o más juegos para construir un parlay',
    noGames: 'No hay juegos para esta fecha.',
    loadingGames: 'Cargando calendario...',
    selected: 'seleccionado(s)',
    mode: 'MODO',
    modes: {
      conservative: 'Conservador',
      balanced:     'Balanceado',
      aggressive:   'Agresivo',
      dreamer:      'Soñador',
    },
    modeDesc: {
      conservative: 'Bajo riesgo, alta calidad de datos',
      balanced:     'Edge y correlación balanceados',
      aggressive:   'Máxima diversidad de riesgo',
      dreamer:      'Parlays largos, máxima recompensa',
    },
    legs: 'PATAS',
    model: 'NIVEL DE MODELO',
    fast: 'Rápido',
    deep: 'Profundo',
    credits: 'cr',
    run: 'EJECUTAR PARLAY ARCHITECT',
    needGames: 'Selecciona al menos 2 juegos para continuar.',
    chosenParlay: 'PARLAY ELEGIDO',
    combinedProb: 'Prob. Combinada',
    decimalOdds: 'Momios Decimales',
    edgeScore: 'Edge Total',
    synergyType: 'Tipo de Sinergia',
    thesis: 'TESIS SINÉRGICA',
    warnings: 'ADVERTENCIAS',
    hiddenCorr: 'CORRELACIONES OCULTAS',
    alternatives: 'ALTERNATIVAS',
    alt: 'Alt',
    score: 'Puntaje',
    show: 'ver',
    hide: 'ocultar',
    archMeta: 'META DEL ARQUITECTO',
    fallbackBadge: 'FALLBACK — LLM no disponible',
    overrodeBadge: 'SOBRESCRIBIÓ COMPOSITOR',
    timings: 'Tiempos',
    composerMs: 'Compositor',
    llmMs: 'LLM',
    totalMs: 'Total',
    emptyHint: 'Selecciona juegos y ejecuta el motor para ver resultados.',
    errorTitle: 'Error',
    retry: 'REINTENTAR',
    candPool: 'Pool',
    rejected: 'Rechazados',
    model_used: 'Modelo',
    selectAll: 'SELECCIONAR TODO',
    clearAll: 'LIMPIAR',
  },
};

const MODES = ['conservative', 'balanced', 'aggressive', 'dreamer'];

const LEGS_MARKS = [2, 5, 10, 15, 20, 25, 30].map(v => ({ value: v, label: String(v) }));

function getMatchupLabel(game) {
  const away = game.teams?.away?.name ?? game.awayTeam ?? '?';
  const home = game.teams?.home?.name ?? game.homeTeam ?? '?';
  return `${away} @ ${home}`;
}

function getTeamId(side) {
  return side?.team?.id ?? side?.id ?? null;
}

function TeamLogo({ teamId, abbr, size = 22 }) {
  if (!teamId) {
    return (
      <Box sx={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted }}>{abbr ?? '?'}</Typography>
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={`https://www.mlbstatic.com/team-logos/${teamId}.svg`}
      alt={abbr ?? ''}
      onError={e => {
        e.target.style.display = 'none';
        e.target.nextSibling && (e.target.nextSibling.style.display = 'flex');
      }}
      sx={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, display: 'block' }}
    />
  );
}

function fmtMs(ms) {
  return ms != null ? `${ms}ms` : '—';
}

function fmtPct(v) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <Typography sx={{
      fontFamily: MONO,
      fontSize: '0.58rem',
      letterSpacing: '0.18em',
      color: C.textMuted,
      textTransform: 'uppercase',
      mb: '8px',
    }}>
      {children}
    </Typography>
  );
}

function MetaBadge({ children, color }) {
  const col = color ?? C.cyan;
  return (
    <Box sx={{
      display: 'inline-flex',
      border: `1px solid ${col}40`,
      bgcolor: `${col}12`,
      px: '7px',
      py: '2px',
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: col, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {children}
      </Typography>
    </Box>
  );
}

function StatRow({ label, value, color }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', py: '3px', borderBottom: `1px solid ${C.borderLight}` }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.78rem', color: color ?? C.textPrimary, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
        {value}
      </Typography>
    </Box>
  );
}

function AltParlay({ alt, index, t, lang, expanded, onToggle }) {
  return (
    <Box sx={{ border: `1px solid ${C.borderLight}`, bgcolor: C.surface }}>
      <Box
        onClick={onToggle}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          px: { xs: '10px', sm: '14px' },
          py: '10px',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'rgba(0,217,255,0.03)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: '8px', sm: '10px' }, flexWrap: 'wrap', minWidth: 0, flex: 1 }}>
          <MetaBadge color={C.cyan}>{t.alt} {index}</MetaBadge>
          <Typography sx={{ fontFamily: MONO, fontSize: { xs: '0.64rem', sm: '0.72rem' }, color: C.textSecondary, lineHeight: 1.5 }}>
            <span style={{ color: C.cyan }}>{alt.combined_decimal_odds?.toFixed(2) ?? '—'}</span>
            {' '} · <span style={{ color: C.green }}>{fmtPct(alt.combined_probability)}</span>
            {' '} · <span style={{ color: C.accent }}>{alt.score?.toFixed(1) ?? '—'}</span>
          </Typography>
        </Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>
          [{expanded ? t.hide : t.show}]
        </Typography>
      </Box>
      {expanded && (
        <Box sx={{ px: '14px', pb: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {alt.legs?.map((leg, i) => (
            <ParlayLegCard key={leg.candidateId ?? i} leg={leg} lang={lang} index={i + 1} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function ResultPanel({ result, t, lang, expandedAlt, setExpandedAlt }) {
  const { chosen_parlay, alternatives, composer_meta, architect_meta } = result;
  const timings = architect_meta?.timings ?? {};

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* ── Chosen parlay header ── */}
      <Box sx={{ border: `1px solid ${C.accentLine}`, bgcolor: 'rgba(255,102,0,0.03)' }}>
        <Box sx={{
          px: '14px',
          py: '8px',
          borderBottom: `1px solid ${C.accentLine}`,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', letterSpacing: '0.18em', color: C.accent, textTransform: 'uppercase' }}>
            {t.chosenParlay}
          </Typography>
          {architect_meta?.overrode_composer && <MetaBadge color={C.amber}>{t.overrodeBadge}</MetaBadge>}
          {architect_meta?._fallback && <MetaBadge color={C.red}>{t.fallbackBadge}</MetaBadge>}
        </Box>

        {/* Stats row */}
        <Box sx={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.borderLight}` }}>
          {[
            { label: t.combinedProb, value: fmtPct(chosen_parlay.combined_probability), color: C.green },
            { label: t.decimalOdds,  value: chosen_parlay.combined_decimal_odds?.toFixed(2) ?? '—', color: C.cyan },
            { label: t.edgeScore,    value: chosen_parlay.combined_edge_score != null ? `${Number(chosen_parlay.combined_edge_score).toFixed(1)}` : '—', color: C.accent },
          ].map(({ label, value, color }) => (
            <Box key={label} sx={{ flex: 1, minWidth: 0, px: { xs: '8px', sm: '12px' }, py: '10px', borderRight: `1px solid ${C.borderLight}`, '&:last-child': { borderRight: 'none' } }}>
              <Typography sx={{ fontFamily: MONO, fontSize: { xs: '0.5rem', sm: '0.54rem' }, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: { xs: '0.85rem', sm: '1rem' }, color, fontWeight: 700, mt: '2px' }}>{value}</Typography>
            </Box>
          ))}
        </Box>

        {/* Synergy type + thesis */}
        {chosen_parlay.synergy_type && (
          <Box sx={{ px: '14px', py: '8px', borderBottom: `1px solid ${C.borderLight}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: chosen_parlay.synergy_thesis ? '8px' : 0 }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {t.synergyType}
              </Typography>
              <MetaBadge color={C.cyan}>{chosen_parlay.synergy_type.replace(/_/g, ' ')}</MetaBadge>
            </Box>
            {chosen_parlay.synergy_thesis && (
              <>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '4px' }}>
                  {t.thesis}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textSecondary, lineHeight: 1.6 }}>
                  {chosen_parlay.synergy_thesis}
                </Typography>
              </>
            )}
          </Box>
        )}

        {/* Warnings */}
        {chosen_parlay.warnings?.length > 0 && (
          <Box sx={{ px: '14px', py: '8px', borderBottom: `1px solid ${C.borderLight}` }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.amber, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '6px' }}>
              ⚠ {t.warnings}
            </Typography>
            {chosen_parlay.warnings.map((w, i) => (
              <Typography key={i} sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textSecondary, lineHeight: 1.5 }}>
                · {w}
              </Typography>
            ))}
          </Box>
        )}

        {/* Hidden correlations */}
        {architect_meta?.hidden_correlations_detected?.length > 0 && (
          <Box sx={{ px: '14px', py: '8px', borderBottom: `1px solid ${C.borderLight}` }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.red, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '6px' }}>
              {t.hiddenCorr}
            </Typography>
            {architect_meta.hidden_correlations_detected.map((hc, i) => (
              <Typography key={i} sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textSecondary, lineHeight: 1.5 }}>
                · [{hc.type ?? '?'}] {hc.candidates?.join(' + ')}{hc.explanation ? ` — ${hc.explanation}` : ''}
              </Typography>
            ))}
          </Box>
        )}

        {/* Legs */}
        <Box sx={{ p: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {chosen_parlay.legs?.map((leg, i) => (
            <ParlayLegCard key={leg.candidateId ?? i} leg={leg} lang={lang} index={i + 1} />
          ))}
        </Box>
      </Box>

      {/* ── Alternatives ── */}
      {alternatives?.length > 0 && (
        <Box>
          <SectionLabel>{t.alternatives}</SectionLabel>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {alternatives.map((alt, i) => (
              <AltParlay
                key={i}
                alt={alt}
                index={i + 1}
                t={t}
                lang={lang}
                expanded={expandedAlt === i}
                onToggle={() => setExpandedAlt(expandedAlt === i ? null : i)}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* ── Architect meta ── */}
      <Box sx={{ border: `1px solid ${C.borderLight}`, bgcolor: C.surface }}>
        <Box sx={{ px: '14px', py: '8px', borderBottom: `1px solid ${C.borderLight}` }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', letterSpacing: '0.18em', color: C.textMuted, textTransform: 'uppercase' }}>
            {t.archMeta}
          </Typography>
        </Box>
        <Box sx={{ px: '14px', py: '10px' }}>
          <StatRow label={t.model_used} value={architect_meta?.model ?? '—'} color={C.textSecondary} />
          <StatRow label={t.candPool}   value={composer_meta?.candidate_pool_size ?? '—'} />
          <StatRow label={t.rejected}   value={composer_meta?.rejected_by_no_go ?? '—'} />
          <StatRow label={t.composerMs} value={fmtMs(timings.composer_ms)} />
          <StatRow label={t.llmMs}      value={fmtMs(timings.llm_ms)} />
          <StatRow label={t.totalMs}    value={fmtMs(timings.total_ms)} color={C.cyan} />
        </Box>
      </Box>
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ParlayArchitect({ lang = 'en' }) {
  const t = L[lang] ?? L.en;
  const { token } = useAuth();
  const { games, date, setDate, gamesLoading } = useGames();
  const { grouped, groupedDates, stats, winRate, addRun, markResult, deleteRun } = useParlayArchitectHistory(token);

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [mode, setMode] = useState('balanced');
  const [requestedLegs, setRequestedLegs] = useState(3);
  const [model, setModel] = useState('fast');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [expandedAlt, setExpandedAlt] = useState(null);

  const cost = model === 'deep' ? 12 : 6;
  const canRun = selectedIds.size >= 2 && !loading;

  function toggleGame(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllGames() {
    const allIds = games.map(g => g.gamePk ?? g.id ?? g.gameId);
    const allSelected = allIds.every(id => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  async function run() {
    if (!canRun) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setExpandedAlt(null);
    try {
      const res = await fetch(`${API_URL}/api/analyze/parlay-synergy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          gameIds:       [...selectedIds],
          requestedLegs,
          mode,
          model,
          lang,
          date,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json.data);
      addRun({ date, mode, requestedLegs, gameIds: [...selectedIds], result: json.data, architect_meta: json.data?.architect_meta });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {loading && <OracleLoadingOverlay lang={lang} />}

      {/* Page header */}
      <Box>
        <Typography sx={{
          fontFamily: BARLOW,
          fontWeight: 800,
          fontSize: { xs: '1.05rem', sm: '1.25rem' },
          letterSpacing: '0.22em',
          color: C.accent,
          textTransform: 'uppercase',
        }}>
          {t.title}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, letterSpacing: '0.12em', mt: '2px' }}>
          {t.subtitle}
        </Typography>
      </Box>

      {/* Two-column layout */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '340px 1fr' },
        gap: { xs: 2, md: 3 },
        alignItems: 'start',
        minWidth: 0,
      }}>

        {/* ── Config panel ── */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Date */}
          <Panel>
            <SectionLabel>{t.date}</SectionLabel>
            <input
              type="date"
              value={date}
              onChange={e => {
                setDate(e.target.value);
                setSelectedIds(new Set());
                setResult(null);
                setError(null);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#E8F4FF',
                fontFamily: "'Share Tech Mono', monospace",
                fontSize: '0.88rem',
                outline: 'none',
                width: '100%',
                cursor: 'pointer',
              }}
            />
          </Panel>

          {/* Game list */}
          <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface }}>
            <Box sx={{ px: '12px', py: '8px', borderBottom: `1px solid ${C.borderLight}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Box>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', letterSpacing: '0.16em', color: C.textMuted, textTransform: 'uppercase' }}>
                  {t.selectGames}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textDim, mt: '2px' }}>
                  {t.selectHint}
                </Typography>
              </Box>
              {games.length > 0 && (
                <Box
                  onClick={toggleAllGames}
                  sx={{
                    fontFamily: MONO, fontSize: '0.52rem', letterSpacing: '0.12em',
                    color: games.every(g => selectedIds.has(g.gamePk ?? g.id ?? g.gameId)) ? C.accent : C.textMuted,
                    cursor: 'pointer', userSelect: 'none', flexShrink: 0, mt: '1px',
                    '&:hover': { color: C.accent },
                  }}
                >
                  {games.every(g => selectedIds.has(g.gamePk ?? g.id ?? g.gameId)) ? t.clearAll : t.selectAll}
                </Box>
              )}
            </Box>

            <Box sx={{ py: '4px' }}>
              {gamesLoading ? (
                <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textMuted, px: '12px', py: '8px' }}>
                  {t.loadingGames}
                </Typography>
              ) : games.length === 0 ? (
                <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textMuted, px: '12px', py: '8px' }}>
                  {t.noGames}
                </Typography>
              ) : games.map(game => {
                const id = game.gamePk ?? game.id ?? game.gameId;
                const checked = selectedIds.has(id);
                const awayId   = getTeamId(game.teams?.away);
                const homeId   = getTeamId(game.teams?.home);
                const awayAbbr = game.teams?.away?.abbreviation ?? game.teams?.away?.team?.abbreviation ?? '?';
                const homeAbbr = game.teams?.home?.abbreviation ?? game.teams?.home?.team?.abbreviation ?? '?';
                const awayName = game.teams?.away?.name ?? game.teams?.away?.team?.name ?? awayAbbr;
                const homeName = game.teams?.home?.name ?? game.teams?.home?.team?.name ?? homeAbbr;
                const gameTime = game.gameTime ?? game.time ?? null;
                return (
                  <Box
                    key={id}
                    onClick={() => toggleGame(id)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: { xs: '6px', sm: '8px' },
                      px: { xs: '8px', sm: '10px' },
                      py: '8px',
                      minHeight: '40px',
                      cursor: 'pointer',
                      bgcolor: checked ? 'rgba(255,102,0,0.05)' : 'transparent',
                      borderLeft: `3px solid ${checked ? C.accent : 'transparent'}`,
                      transition: 'background 0.1s',
                      '&:hover': { bgcolor: 'rgba(0,217,255,0.03)' },
                    }}
                  >
                    {/* Checkbox */}
                    <Box sx={{
                      width: 14, height: 14, flexShrink: 0,
                      border: `1px solid ${checked ? C.accent : C.border}`,
                      bgcolor: checked ? C.accent : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {checked && <Box sx={{ width: 8, height: 8, bgcolor: '#000' }} />}
                    </Box>

                    {/* Away logo + name */}
                    <TeamLogo teamId={awayId} abbr={awayAbbr} size={20} />
                    <Typography sx={{ fontFamily: MONO, fontSize: { xs: '0.66rem', sm: '0.68rem' }, color: checked ? C.textPrimary : C.textSecondary, fontWeight: checked ? 600 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {awayName}
                    </Typography>

                    {/* VS separator */}
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, flexShrink: 0, px: '2px' }}>@</Typography>

                    {/* Home logo + name */}
                    <TeamLogo teamId={homeId} abbr={homeAbbr} size={20} />
                    <Typography sx={{ fontFamily: MONO, fontSize: { xs: '0.66rem', sm: '0.68rem' }, color: checked ? C.textPrimary : C.textSecondary, fontWeight: checked ? 600 : 400, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {homeName}
                    </Typography>

                    {/* Time */}
                    {gameTime && (
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
                        {gameTime}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>

            {selectedIds.size > 0 && (
              <Box sx={{ px: '12px', pb: '8px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.accent, letterSpacing: '0.08em' }}>
                  ▸ {selectedIds.size} {t.selected}
                </Typography>
              </Box>
            )}
          </Box>

          {/* Mode */}
          <Panel>
            <SectionLabel>{t.mode}</SectionLabel>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {MODES.map(m => (
                <Box
                  key={m}
                  onClick={() => setMode(m)}
                  sx={{
                    py: '7px',
                    px: '6px',
                    cursor: 'pointer',
                    border: `1px solid ${mode === m ? C.accent : C.borderLight}`,
                    bgcolor: mode === m ? 'rgba(255,102,0,0.08)' : 'transparent',
                    transition: 'all 0.1s',
                    '&:hover': { borderColor: C.accent, bgcolor: 'rgba(255,102,0,0.04)' },
                  }}
                >
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.64rem', color: mode === m ? C.accent : C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t.modes[m]}
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.54rem', color: C.textMuted, mt: '1px', lineHeight: 1.3 }}>
                    {t.modeDesc[m]}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Panel>

          {/* Legs slider */}
          <Panel>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: '4px' }}>
              <SectionLabel>{t.legs}</SectionLabel>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.88rem', color: C.cyan, fontWeight: 700, lineHeight: 1 }}>
                {requestedLegs}
              </Typography>
            </Box>
            <Slider
              value={requestedLegs}
              onChange={(_, v) => setRequestedLegs(v)}
              min={2}
              max={30}
              step={1}
              marks={LEGS_MARKS}
              sx={{
                color: requestedLegs > 10 ? C.amber : C.cyan,
                py: '6px',
                '& .MuiSlider-thumb': { bgcolor: requestedLegs > 10 ? C.amber : C.cyan, width: 12, height: 12, '&:hover': { boxShadow: `0 0 0 6px rgba(0,217,255,0.12)` } },
                '& .MuiSlider-rail': { bgcolor: C.borderLight },
                '& .MuiSlider-track': { bgcolor: requestedLegs > 10 ? C.amber : C.cyan },
                '& .MuiSlider-mark': { bgcolor: C.borderLight, width: 2, height: 6 },
                '& .MuiSlider-markActive': { bgcolor: requestedLegs > 10 ? C.amber : C.cyan },
                '& .MuiSlider-markLabel': { fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, top: '22px' },
              }}
            />
            {requestedLegs > 10 && (
              <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.amber, mt: '4px', letterSpacing: '0.06em' }}>
                ⚠ {lang === 'es'
                  ? `Probabilidad combinada ≈ ${(Math.pow(0.60, requestedLegs) * 100).toFixed(4)}% — parlay de alto riesgo`
                  : `Combined probability ≈ ${(Math.pow(0.60, requestedLegs) * 100).toFixed(4)}% — high-risk longshot`
                }
              </Typography>
            )}
          </Panel>

          {/* Model tier */}
          <Panel>
            <SectionLabel>{t.model}</SectionLabel>
            <Box sx={{ display: 'flex', gap: '8px' }}>
              {[
                { key: 'fast', label: t.fast, cr: 6 },
                { key: 'deep', label: t.deep, cr: 12 },
              ].map(({ key, label, cr }) => (
                <Box
                  key={key}
                  onClick={() => setModel(key)}
                  sx={{
                    flex: 1,
                    py: '8px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    border: `1px solid ${model === key ? C.cyan : C.borderLight}`,
                    bgcolor: model === key ? 'rgba(0,217,255,0.07)' : 'transparent',
                    transition: 'all 0.1s',
                    '&:hover': { borderColor: C.cyan },
                  }}
                >
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: model === key ? C.cyan : C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {label}
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mt: '2px' }}>
                    {cr} {t.credits}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Panel>

          {/* Run button */}
          <Box>
            {selectedIds.size < 2 && (
              <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.amber, mb: '8px', letterSpacing: '0.06em' }}>
                ⚠ {t.needGames}
              </Typography>
            )}
            <Box
              onClick={canRun ? run : undefined}
              sx={{
                py: '13px',
                textAlign: 'center',
                cursor: canRun ? 'pointer' : 'not-allowed',
                bgcolor: canRun ? C.accent : 'rgba(255,102,0,0.12)',
                border: `1px solid ${canRun ? C.accent : C.borderLight}`,
                opacity: canRun ? 1 : 0.55,
                transition: 'all 0.12s',
                ...(canRun ? { '&:hover': { bgcolor: '#FF8833', boxShadow: `0 0 16px rgba(255,102,0,0.4)` } } : {}),
              }}
            >
              <Typography sx={{
                fontFamily: MONO,
                fontSize: '0.72rem',
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: canRun ? '#000' : C.textMuted,
                textTransform: 'uppercase',
              }}>
                {t.run}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: canRun ? '#000000aa' : C.textMuted, mt: '2px', letterSpacing: '0.1em' }}>
                {cost} {t.credits}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* ── Results panel ── */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {error && (
            <Box sx={{ border: `1px solid ${C.redLine}`, bgcolor: C.redDim, p: '12px 14px' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.red, letterSpacing: '0.14em', textTransform: 'uppercase', mb: '4px' }}>
                    {t.errorTitle}
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: C.textPrimary, lineHeight: 1.5 }}>
                    {error}
                  </Typography>
                </Box>
                <Box
                  onClick={run}
                  sx={{ ml: '12px', border: `1px solid ${C.red}`, px: '10px', py: '5px', cursor: 'pointer', flexShrink: 0, '&:hover': { bgcolor: C.redDim } }}
                >
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.red, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    {t.retry}
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}

          {!result && !error && (
            <Box sx={{
              border: `1px solid ${C.borderLight}`,
              bgcolor: C.surface,
              p: '40px 24px',
              minHeight: '280px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
            }}>
              <Typography sx={{ fontSize: '2.5rem', opacity: 0.12, lineHeight: 1 }}>⬡</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.1em', textAlign: 'center', textTransform: 'uppercase' }}>
                {t.emptyHint}
              </Typography>
            </Box>
          )}

          {result && (
            <ResultPanel
              result={result}
              t={t}
              lang={lang}
              expandedAlt={expandedAlt}
              setExpandedAlt={setExpandedAlt}
            />
          )}
        </Box>
      </Box>

      {/* ── History ── */}
      <ParlayArchitectHistory
        lang={lang}
        grouped={grouped}
        groupedDates={groupedDates}
        stats={stats}
        winRate={winRate}
        onMark={markResult}
        onDelete={deleteRun}
      />
    </Box>
  );
}

function Panel({ children }) {
  return (
    <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, p: '12px' }}>
      {children}
    </Box>
  );
}
