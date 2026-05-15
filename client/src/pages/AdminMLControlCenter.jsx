/**
 * AdminMLControlCenter.jsx — H.E.X.A. V4 Admin
 *
 * Unified control center for the ML pipeline:
 *   - HUD status bar (sidecar enabled, URL, latency, circuit state, ensemble status)
 *   - Per-market cards (Moneyline / OverUnder / Runline) with Brier, ROI, n_train,
 *     last trained, individual "RETRAIN" button + global "RETRAIN ALL"
 *   - Reliability diagrams per market (tabbed)
 *   - Rolling 30-day accuracy chart (legacy vs python)
 *   - Ensemble Meta-Learner panel with learned weights, per-source Brier, retrain
 *   - Retrain audit log (last 50 attempts from ml_retrain_log)
 *
 * Admin-only. Polls /api/admin/ml/status every 10 seconds for live HUD.
 *
 * Props:
 *   token   — JWT (admin)
 *   onBack  — navigate back
 *   lang    — 'es' | 'en' (default 'es')
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Typography, Chip, CircularProgress, Button, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import {
  ComposedChart, Bar, Line, LineChart,
  XAxis, YAxis, ReferenceLine, Tooltip as RTooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { C, MONO, DISPLAY } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Palette ──────────────────────────────────────────────────────────────────
const BG      = C.bg;
const SURFACE = C.bg1;
const SURFACE2 = C.bg2;
const BORDER  = C.border;
const CYAN    = C.cyan;
const GREEN   = C.green;
const RED     = C.red;
const AMBER   = C.amber;
const ACCENT  = C.accent;
const MUTED   = C.ink2;
const INK1    = C.ink1;
const INK0    = C.ink0;
const DIM     = 'rgba(34,240,255,0.10)';

const MARKETS = ['moneyline', 'overunder', 'runline'];
const MARKET_LABELS = { moneyline: 'Moneyline', overunder: 'Over / Under', runline: 'Runline' };
const MARKET_TINTS  = { moneyline: CYAN, overunder: GREEN, runline: AMBER };

// ── Bilingual strings ─────────────────────────────────────────────────────────
const STRINGS = {
  en: {
    dashboard:        'Model Operations Dashboard',
    online:           'ONLINE',
    offline:          'OFFLINE',
    degraded:         'DEGRADED',
    enabled:          'ENABLED',
    disabled:         'DISABLED',
    refreshTip:       'Refresh now',
    never:            'never',
    lastRetrain:      'LAST RETRAIN',
    earlyModel:       'EARLY MODEL',
    earlyModelTip:    'Training set is below the standard floor of 60. Model is statistically thin — treat predictions as exploratory.',
    trained:          'TRAINED',
    skipped:          (floor) => `SKIPPED — need more resolved picks (configured floor: ${floor})`,
    training:         '⟳ TRAINING…',
    retrainMkt:       (m) => `▶ RETRAIN ${m.toUpperCase()}`,
    noCalibBuckets:   'No calibration buckets yet — train the model first.',
    noRolling:        'No resolved shadow runs in the last 30 days.',
    predProbBucket:   'Predicted prob bucket',
    perfectCalib:     'Perfect calibration',
    actualHitRate:    'Actual hit rate',
    legacyValidator:  'Legacy validator',
    ensembleCombiner: 'Ensemble Combiner',
    retrainEnsemble:  '▶ RETRAIN ENSEMBLE',
    brierScores:      'BRIER SCORES (lower is better)',
    learnedWeights:   'LEARNED WEIGHTS (logit-space coefficients)',
    ensembleDisabled: 'Ensemble disabled. Set ENSEMBLE_ENABLED=true on the server to enable.',
    ensembleNotTrained:'Ensemble enabled but not yet trained — click RETRAIN ENSEMBLE once ≥50 resolved picks have all 3 sources.',
    chatTitle:        'Chat-sourced Picks',
    chatLoading:      'Loading chat-sourced picks…',
    noRetrains:       'No retrains logged yet. Click RETRAIN above to fire the first one.',
    perMarketModels:  'Per-Market Models',
    reliabilityDiagram:'Reliability Diagram',
    reliabilityNote:  'Bars at the dashed 45° line = perfect calibration. Bars below = over-confident. Bars above = under-confident.',
    rolling30d:       'Rolling 30d — Legacy vs Python',
    rollingNote:      'Daily moneyline hit-rate from shadow_model_runs. 50% baseline = random.',
    retrainLog:       'Retrain Audit Log',
    back:             '← BACK',
    retrainAll:       '▶▶ RETRAIN ALL MARKETS',
    trainingAll:      '⟳ TRAINING ALL MARKETS…',
    logCols:          ['When', 'Market', 'Status', 'Brier', 'N_train', 'Duration', 'By'],
    toastOk:          (m) => `RETRAIN OK · ${m}`,
    toastFail:        (m) => `RETRAIN FAILED · ${m}`,
    ensembleOk:       'ENSEMBLE RETRAINED',
    ensembleFail:     'ENSEMBLE RETRAIN FAILED',
    allOk:            'RETRAIN ALL OK',
    allFail:          'RETRAIN ALL FAILED',
    allOkMsg:         (s) => `Completed in ${s}s — see retrain log for per-market metrics.`,
    comingSoon:       'Hits, Total Bases, Strikeouts — coming soon',
    propsDesc:        'Player-prop training requires per-batter features (xBA, xSLG, splits vs handedness, recent form 7d/14d) that are not yet in the pipeline. A dedicated sprint will extend savant-fetcher with batter leaderboards and add per-prop_kind models alongside the existing game-level ones.',
    inferencePanel:   'Live inference status',
    modelsHud:        (loaded, avail) => `MODELS ${loaded}/${avail}`,
    ensembleHudLive:  'ENSEMBLE LIVE',
    ensembleHudLazy:  'ENSEMBLE READY',
    ensembleHudOff:   'ENSEMBLE OFF',
    ensembleHudNone:  'ENSEMBLE N/T',
    artifactYes:      'ARTIFACT',
    artifactNo:       'NO ARTIFACT',
    inMemoryYes:      'IN RAM',
    inMemoryNo:       'NOT LOADED',
    runlineGate:      'Runline gate',
    runlineSkippedNote: (min) => `Training skipped — need ≥${min} resolved runline picks`,
    runlineEarlyNote: (n) => `Early model — n_train=${n} (standard floor is 60)`,
  },
  es: {
    dashboard:        'Panel de Operaciones ML',
    online:           'EN LÍNEA',
    offline:          'DESCONECTADO',
    degraded:         'DEGRADADO',
    enabled:          'ACTIVO',
    disabled:         'INACTIVO',
    refreshTip:       'Actualizar ahora',
    never:            'nunca',
    lastRetrain:      'ÚLT. REENTRENAMIENTO',
    earlyModel:       'MODELO INICIAL',
    earlyModelTip:    'El conjunto de entrenamiento está por debajo del umbral de 60. El modelo es estadísticamente débil — usa las predicciones como exploratorias.',
    trained:          'ENTRENADO',
    skipped:          (floor) => `OMITIDO — se necesitan más picks resueltos (mínimo: ${floor})`,
    training:         '⟳ ENTRENANDO…',
    retrainMkt:       (m) => `▶ REENTRENAR ${m.toUpperCase()}`,
    noCalibBuckets:   'Sin datos de calibración — entrena el modelo primero.',
    noRolling:        'Sin registros en shadow_model_runs en los últimos 30 días.',
    predProbBucket:   'Prob. predicha',
    perfectCalib:     'Calibración perfecta',
    actualHitRate:    'Tasa real de aciertos',
    legacyValidator:  'Validador Legacy',
    ensembleCombiner: 'Combinador Ensemble',
    retrainEnsemble:  '▶ REENTRENAR ENSEMBLE',
    brierScores:      'PUNTAJES BRIER (menor es mejor)',
    learnedWeights:   'PESOS APRENDIDOS (coeficientes logit)',
    ensembleDisabled: 'Ensemble desactivado. Configura ENSEMBLE_ENABLED=true en el servidor.',
    ensembleNotTrained:'Ensemble activo pero sin entrenar — presiona REENTRENAR ENSEMBLE cuando haya ≥50 picks resueltos con las 3 fuentes.',
    chatTitle:        'Picks del Chat Oracle',
    chatLoading:      'Cargando picks del chat…',
    noRetrains:       'Sin reentrenamientos registrados. Haz clic en REENTRENAR arriba para disparar el primero.',
    perMarketModels:  'Modelos por Mercado',
    reliabilityDiagram:'Diagrama de Calibración',
    reliabilityNote:  'Las barras en la línea de 45° = calibración perfecta. Por debajo = sobre-confiado. Por arriba = sub-confiado.',
    rolling30d:       'Últimos 30 días — Legacy vs Python',
    rollingNote:      'Tasa diaria de aciertos moneyline desde shadow_model_runs. 50% = aleatorio.',
    retrainLog:       'Historial de Reentrenamiento',
    back:             '← VOLVER',
    retrainAll:       '▶▶ REENTRENAR TODOS',
    trainingAll:      '⟳ ENTRENANDO TODOS…',
    logCols:          ['Cuándo', 'Mercado', 'Estado', 'Brier', 'N_train', 'Duración', 'Por'],
    toastOk:          (m) => `REENTRENADO OK · ${m}`,
    toastFail:        (m) => `FALLO REENTRENAMIENTO · ${m}`,
    ensembleOk:       'ENSEMBLE REENTRENADO',
    ensembleFail:     'FALLO ENSEMBLE',
    allOk:            'REENTRENADO TODO OK',
    allFail:          'FALLO REENTRENAMIENTO GLOBAL',
    allOkMsg:         (s) => `Completado en ${s}s — ver historial para métricas por mercado.`,
    comingSoon:       'Hits, Total Bases, Ponches — próximamente',
    propsDesc:        'El entrenamiento de props por jugador requiere features individuales (xBA, xSLG, splits por lateralidad, forma reciente 7d/14d) que aún no están en el pipeline. Un sprint dedicado extenderá savant-fetcher con leaderboards de bateadores y añadirá modelos por prop_kind junto a los modelos de nivel de juego existentes.',
    inferencePanel:   'Estado de inferencia en vivo',
    modelsHud:        (loaded, avail) => `MODELOS ${loaded}/${avail}`,
    ensembleHudLive:  'ENSEMBLE LIVE',
    ensembleHudLazy:  'ENSEMBLE LISTO',
    ensembleHudOff:   'ENSEMBLE OFF',
    ensembleHudNone:  'ENSEMBLE S/T',
    artifactYes:      'ARTEFACTO',
    artifactNo:       'SIN ARTEFACTO',
    inMemoryYes:      'EN RAM',
    inMemoryNo:       'NO CARGADO',
    runlineGate:      'Umbral runline',
    runlineSkippedNote: (min) => `Entrenamiento omitido — se necesitan ≥${min} picks runline resueltos`,
    runlineEarlyNote: (n) => `Modelo inicial — n_train=${n} (umbral estándar: 60)`,
  },
};

const INFERENCE_META = {
  live:              { label: { en: 'LIVE', es: 'LIVE' }, color: GREEN },
  lazy_load:         { label: { en: 'READY', es: 'LISTO' }, color: CYAN },
  no_artifact:       { label: { en: 'NO MODEL', es: 'SIN MODELO' }, color: AMBER },
  circuit_open:      { label: { en: 'CIRCUIT', es: 'CIRCUITO' }, color: RED },
  sidecar_unhealthy: { label: { en: 'DOWN', es: 'CAÍDO' }, color: RED },
  disabled:          { label: { en: 'OFF', es: 'OFF' }, color: MUTED },
  flag_off:          { label: { en: 'FLAG OFF', es: 'FLAG OFF' }, color: MUTED },
  sidecar_off:       { label: { en: 'SIDECAR OFF', es: 'SIDECAR OFF' }, color: MUTED },
  not_trained:       { label: { en: 'NOT TRAINED', es: 'SIN ENTRENAR' }, color: AMBER },
};

function inferenceMeta(state, lang) {
  const row = INFERENCE_META[state] ?? { label: { en: String(state ?? '—').toUpperCase(), es: String(state ?? '—').toUpperCase() }, color: MUTED };
  return { label: row.label[lang] ?? row.label.en, color: row.color };
}

// ── CSS animations (mounted once) ────────────────────────────────────────────
const CSS = `
@keyframes amlc-fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes amlc-pulse  { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes amlc-border-flow {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes amlc-scan {
  0%   { transform: translateY(-100%); opacity: 0; }
  50%  { opacity: 0.5; }
  100% { transform: translateY(100%); opacity: 0; }
}
@keyframes amlc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.amlc-flow-border {
  background: linear-gradient(90deg, ${CYAN} 0%, ${GREEN} 35%, ${ACCENT} 65%, ${CYAN} 100%);
  background-size: 200% 100%;
  animation: amlc-border-flow 6s linear infinite;
}
.amlc-scan-line {
  position: absolute; inset: 0; pointer-events: none; overflow: hidden;
}
.amlc-scan-line::before {
  content: ''; position: absolute; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, ${CYAN}, transparent);
  animation: amlc-scan 3.5s ease-in-out infinite;
}
`;

// ── Helpers ──────────────────────────────────────────────────────────────────
function pct(num, den) {
  if (!den || Number(den) === 0) return null;
  return ((Number(num) / Number(den)) * 100).toFixed(1);
}
function fmtBrier(v) { return v == null ? '—' : Number(v).toFixed(4); }
function fmtPercent(v, digits = 1) { return v == null ? '—' : `${(Number(v) * 100).toFixed(digits)}%`; }
function fmtROI(v) { return v == null ? '—' : `${v >= 0 ? '+' : ''}${(Number(v) * 100).toFixed(1)}%`; }
function fmtMs(v) { return v == null ? '—' : `${v}ms`; }
function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toISOString().slice(0, 16).replace('T', ' '); }
  catch { return '—'; }
}
function timeAgo(v) {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Corner-bracket decorator (reused everywhere) ─────────────────────────────
function CornerBrackets({ color = CYAN, size = 10 }) {
  const ext = `2px solid ${color}`;
  return (
    <>
      <Box sx={{ position: 'absolute', top: 0, left: 0, width: size, height: size, borderTop: ext, borderLeft: ext }} />
      <Box sx={{ position: 'absolute', top: 0, right: 0, width: size, height: size, borderTop: ext, borderRight: ext }} />
      <Box sx={{ position: 'absolute', bottom: 0, left: 0, width: size, height: size, borderBottom: ext, borderLeft: ext }} />
      <Box sx={{ position: 'absolute', bottom: 0, right: 0, width: size, height: size, borderBottom: ext, borderRight: ext }} />
    </>
  );
}

// ── HUD: top status overlay ──────────────────────────────────────────────────
function HUDStatusBar({ status, loading, onRefresh, T }) {
  const enabled            = !!status?.enabled;
  const ensembleEnabled    = !!status?.ensemble_enabled;
  const circuit            = status?.circuit?.state ?? 'unknown';
  const sidecarUrl         = status?.sidecar_url ?? '—';
  const latency            = status?.health_latency_ms;
  const healthOk           = !!status?.health?.status && status.health.status === 'ok';
  const lastRetrain        = status?.last_retrain;
  const artifactsDir       = status?.health?.artifacts_dir ?? null;
  const artifactsPersistent = status?.health?.artifacts_persistent ?? false;
  const obs                = status?.observability ?? null;
  const modelsLoaded       = obs?.models_loaded?.length ?? 0;
  const modelsAvailable    = obs?.models_available?.length ?? 0;
  const ensInf             = obs?.ensemble?.inference ?? null;
  const ensHudLabel = !ensembleEnabled
    ? T.ensembleHudOff
    : ensInf === 'live'
      ? T.ensembleHudLive
      : ensInf === 'lazy_load'
        ? T.ensembleHudLazy
        : ensInf === 'not_trained'
          ? T.ensembleHudNone
          : inferenceMeta(ensInf, T.lang).label;
  const ensHudColor = !ensembleEnabled
    ? MUTED
    : ensInf === 'live'
      ? GREEN
      : ensInf === 'lazy_load'
        ? CYAN
        : ensInf === 'not_trained'
          ? AMBER
          : inferenceMeta(ensInf, T.lang).color;

  const circuitColor = circuit === 'closed' ? GREEN : circuit === 'half-open' ? AMBER : circuit === 'open' ? RED : MUTED;
  const sidecarColor = enabled && healthOk ? GREEN : enabled ? AMBER : RED;
  const sidecarLabel = enabled ? (healthOk ? T.online : T.degraded) : T.offline;
  const modelsColor = modelsAvailable > 0 && modelsLoaded === modelsAvailable
    ? GREEN
    : modelsAvailable > 0
      ? CYAN
      : MUTED;

  return (
    <Box sx={{
      position:     'relative',
      background:   `linear-gradient(135deg, ${SURFACE} 0%, ${SURFACE2} 100%)`,
      border:       `1px solid ${BORDER}`,
      p:            '14px 18px',
      mb:           2,
      overflow:     'hidden',
      animation:    'amlc-fadeIn 0.3s both',
    }}>
      <Box className="amlc-flow-border" sx={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
      }} />
      <CornerBrackets color={CYAN} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 220 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px' }}>
            HEXA.ML // CONTROL CENTER
          </Typography>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 700, color: INK0, lineHeight: 1.1 }}>
            {T.dashboard}
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minWidth: 200 }} />

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <StatusPill label="Sidecar"  value={sidecarLabel} color={sidecarColor} pulse={!healthOk && enabled} />
          <StatusPill label="Circuit"  value={String(circuit).toUpperCase()} color={circuitColor} pulse={circuit === 'half-open'} />
          <StatusPill label="Models"   value={T.modelsHud(modelsLoaded, modelsAvailable)} color={modelsColor} />
          <StatusPill label="Ensemble" value={ensHudLabel} color={ensHudColor} />
          <StatusPill label="Latency"  value={fmtMs(latency)} color={latency != null && latency < 800 ? GREEN : latency != null ? AMBER : MUTED} />
        </Box>

        <Tooltip title={T.refreshTip}>
          <Button
            onClick={onRefresh}
            disabled={loading}
            sx={{
              minWidth: 0, p: '6px 10px', border: `1px solid ${BORDER}`, color: CYAN,
              fontFamily: MONO, fontSize: '10px', letterSpacing: '2px',
              '&:hover': { background: DIM, borderColor: CYAN },
            }}
          >
            {loading ? <CircularProgress size={12} sx={{ color: CYAN }} /> : '↻ SYNC'}
          </Button>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', gap: 3, mt: 1.5, flexWrap: 'wrap', fontFamily: MONO, fontSize: '10px', color: MUTED }}>
        <span>URL: <span style={{ color: INK1 }}>{sidecarUrl || '(none)'}</span></span>
        <span>FAILURES: <span style={{ color: status?.circuit?.failures ? AMBER : INK1 }}>{status?.circuit?.failures ?? 0}</span></span>
        <span>{T.lastRetrain}: <span style={{ color: INK1 }}>
          {lastRetrain ? `${lastRetrain.market} → ${lastRetrain.status} · ${timeAgo(lastRetrain.created_at)}` : T.never}
        </span></span>
        {artifactsDir && (
          <span>
            STORAGE:{' '}
            <span style={{ color: artifactsPersistent ? GREEN : AMBER }}>
              {artifactsPersistent ? '● VOLUME' : '⚠ EPHEMERAL'}
            </span>
            {' '}
            <span style={{ color: MUTED, fontSize: '9px' }}>{artifactsDir}</span>
          </span>
        )}
      </Box>
    </Box>
  );
}

function MlInferencePanel({ observability, T }) {
  if (!observability?.markets?.length) return null;

  return (
    <Box sx={{
      position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`,
      p: '14px 16px', mb: 2, overflow: 'hidden',
    }}>
      <CornerBrackets color={CYAN} size={10} />
      <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px', mb: 1.5 }}>
        {T.inferencePanel.toUpperCase()}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {observability.markets.map((row) => {
          const inf = inferenceMeta(row.inference, T.lang);
          const tint = MARKET_TINTS[row.market] ?? CYAN;
          return (
            <Box
              key={row.market}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '120px 1fr auto' },
                gap: 1, alignItems: 'center',
                borderBottom: `1px solid ${BORDER}`, pb: 1,
                '&:last-child': { borderBottom: 0, pb: 0 },
              }}
            >
              <Typography sx={{ fontFamily: DISPLAY, fontSize: '0.95rem', fontWeight: 700, color: tint }}>
                {MARKET_LABELS[row.market] ?? row.market}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', fontFamily: MONO, fontSize: '9px' }}>
                <InferenceChip label={T.artifactYes} active={row.artifact} />
                <InferenceChip label={T.inMemoryYes} active={row.loaded} />
                {row.market === 'runline' && row.runlineNote?.kind === 'skipped' && (
                  <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: AMBER, alignSelf: 'center' }}>
                    {T.runlineSkippedNote(row.runlineNote.minTrainSize)}
                  </Typography>
                )}
                {row.market === 'runline' && row.runlineNote?.kind === 'early' && (
                  <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: AMBER, alignSelf: 'center' }}>
                    {T.runlineEarlyNote(row.runlineNote.nTrain)}
                  </Typography>
                )}
              </Box>
              <Box sx={{
                justifySelf: { sm: 'end' },
                px: '8px', py: '3px', border: `1px solid ${inf.color}`,
                background: `${inf.color}14`,
              }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: inf.color, fontWeight: 700, letterSpacing: '1.5px' }}>
                  {inf.label}
                </Typography>
              </Box>
            </Box>
          );
        })}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '120px 1fr auto' },
          gap: 1, alignItems: 'center', pt: 0.5,
        }}>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '0.95rem', fontWeight: 700, color: GREEN }}>
            Ensemble
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <InferenceChip label={T.artifactYes} active={observability.ensemble?.artifact} />
            <InferenceChip label={T.inMemoryYes} active={observability.ensemble?.loaded} />
            {!observability.ensemble?.flag_enabled && (
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED }}>ENSEMBLE_ENABLED=false</Typography>
            )}
          </Box>
          {(() => {
            const inf = inferenceMeta(observability.ensemble?.inference, T.lang);
            return (
              <Box sx={{ justifySelf: { sm: 'end' }, px: '8px', py: '3px', border: `1px solid ${inf.color}`, background: `${inf.color}14` }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: inf.color, fontWeight: 700, letterSpacing: '1.5px' }}>
                  {inf.label}
                </Typography>
              </Box>
            );
          })()}
        </Box>
      </Box>
    </Box>
  );
}

function InferenceChip({ label, active }) {
  const c = active ? GREEN : MUTED;
  return (
    <Box sx={{
      px: '6px', py: '2px', border: `1px solid ${c}`,
      opacity: active ? 1 : 0.45,
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: c, letterSpacing: '1px' }}>
        {label}
      </Typography>
    </Box>
  );
}

function StatusPill({ label, value, color, pulse = false }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      px: '8px', py: '4px', border: `1px solid ${color}`,
      background: 'rgba(0,0,0,0.35)',
      animation: pulse ? 'amlc-pulse 1.5s ease-in-out infinite' : 'none',
    }}>
      <Box sx={{ width: 6, height: 6, background: color, borderRadius: '50%', boxShadow: `0 0 6px ${color}` }} />
      <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '1.5px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '10px', color, fontWeight: 700, letterSpacing: '1px' }}>{value}</Typography>
    </Box>
  );
}

// ── Per-market card with retrain action ──────────────────────────────────────
function MarketCard({ market, manifest, marketObs, onRetrain, busy, index = 0, T }) {
  const tint = MARKET_TINTS[market];
  const data = manifest?.markets?.[market] ?? null;
  const trained = data && !data.skipped && !data.error;
  const nTrain = data?.n_train ?? null;
  const brier  = data?.brier_test ?? null;
  const roi    = data?.roi_kelly25_test ?? null;
  const trainedAt = data?.trained_at ?? null;
  const early   = nTrain != null && nTrain < 60;
  const infMeta = marketObs ? inferenceMeta(marketObs.inference, T.lang) : null;
  const runlineGate = market === 'runline' && marketObs?.runlineNote;

  return (
    <Box sx={{
      position: 'relative', flex: 1, minWidth: 240,
      background: SURFACE, border: `1px solid ${BORDER}`,
      p: '18px 16px 16px', overflow: 'hidden',
      animation: `amlc-fadeIn 0.4s ${index * 0.08}s both`,
      '&:hover .amlc-mc-scan': { opacity: 1 },
    }}>
      <CornerBrackets color={tint} size={12} />
      <Box className="amlc-scan-line amlc-mc-scan" sx={{ opacity: 0, transition: 'opacity 0.3s' }} />

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px', textTransform: 'uppercase' }}>
            MARKET // {market}
          </Typography>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.15rem', fontWeight: 700, color: tint, mt: '2px', lineHeight: 1.1 }}>
            {MARKET_LABELS[market]}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
          {infMeta && (
            <Chip
              label={infMeta.label}
              size="small"
              sx={{
                fontFamily: MONO, fontSize: '8px', color: infMeta.color,
                border: `1px solid ${infMeta.color}`, background: `${infMeta.color}14`,
                height: 18, letterSpacing: '1.5px',
              }}
            />
          )}
          {early && (
            <Tooltip title={T.earlyModelTip}>
              <Chip
                label={T.earlyModel}
                size="small"
                sx={{ fontFamily: MONO, fontSize: '8px', color: AMBER, border: `1px solid ${AMBER}`, background: 'transparent', height: 18, letterSpacing: '1.5px' }}
              />
            </Tooltip>
          )}
        </Box>
      </Box>

      {runlineGate?.kind === 'skipped' && (
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: AMBER, mt: 1 }}>
          {T.runlineGate}: {T.runlineSkippedNote(runlineGate.minTrainSize)}
        </Typography>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 2 }}>
        <Metric label="BRIER" value={fmtBrier(brier)} color={brier != null && brier < 0.22 ? GREEN : brier != null ? AMBER : MUTED} />
        <Metric label="ROI KELLY 25%" value={fmtROI(roi)} color={roi != null && roi > 0 ? GREEN : roi != null ? RED : MUTED} />
        <Metric label="N TRAIN" value={nTrain ?? '—'} color={INK1} />
        <Metric label="N TEST"  value={data?.n_test ?? '—'} color={INK1} />
      </Box>

      <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 2 }}>
        {T.trained}: <span style={{ color: INK1 }}>{trainedAt ? `${fmtDate(trainedAt)} (${timeAgo(trainedAt)})` : T.never}</span>
      </Typography>
      {!trained && data?.error && (
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: RED, mt: 0.5 }}>
          ERROR: {String(data.error).slice(0, 90)}
        </Typography>
      )}
      {!trained && data?.skipped && (
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: AMBER, mt: 0.5 }}>
          {T.skipped(data?.min_train_size_used)}
        </Typography>
      )}

      <Button
        onClick={() => onRetrain(market)}
        disabled={busy}
        sx={{
          mt: 2, width: '100%', py: '8px',
          border: `1px solid ${tint}`, color: tint, background: 'transparent',
          fontFamily: MONO, fontSize: '10px', letterSpacing: '2px',
          '&:hover': { background: `${tint}1A`, boxShadow: `0 0 14px ${tint}40` },
          '&:disabled': { opacity: 0.4, borderColor: MUTED, color: MUTED },
        }}
      >
        {busy ? T.training : T.retrainMkt(market)}
      </Button>
    </Box>
  );
}

function Metric({ label, value, color = INK0 }) {
  return (
    <Box>
      <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: MUTED, letterSpacing: '2px', mb: '2px' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.1rem', fontWeight: 700, color, lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Box>
  );
}

// ── Reliability diagram (per-market tabs) ────────────────────────────────────
function ReliabilityPanel({ manifest, market, T }) {
  const buckets = manifest?.markets?.[market]?.reliability_diagram ?? [];
  if (!buckets.length) {
    return <EmptyChart text={T.noCalibBuckets} />;
  }
  const data = buckets.map((b) => ({
    bucket: b.label ?? `${Math.round(((b.pred_mean ?? 0) * 100))}%`,
    perfect: b.pred_mean,
    actual:  b.actual_frac,
    count:   b.count,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <XAxis
          dataKey="bucket"
          tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
          label={{ value: T.predProbBucket, position: 'insideBottom', offset: -4, fontFamily: MONO, fontSize: 10, fill: MUTED }}
        />
        <YAxis
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
          domain={[0, 1]}
          tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
        />
        <RTooltip
          contentStyle={{ background: SURFACE, border: `1px solid ${BORDER}`, fontFamily: MONO, fontSize: 11 }}
          formatter={(value, name) => [typeof value === 'number' ? value.toFixed(3) : value, name]}
        />
        <Line type="linear" dataKey="perfect" stroke={MUTED} strokeDasharray="3 5" dot={false} name={T.perfectCalib} strokeWidth={1} />
        <Bar dataKey="actual" fill={MARKET_TINTS[market]} opacity={0.85} name={T.actualHitRate} radius={[2, 2, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ text }) {
  return (
    <Box sx={{ color: MUTED, fontFamily: MONO, fontSize: '11px', py: 4, textAlign: 'center' }}>
      {text}
    </Box>
  );
}

// ── Rolling 30d chart ────────────────────────────────────────────────────────
function Rolling30dChart({ rolling, T }) {
  if (!rolling?.length) return <EmptyChart text={T.noRolling} />;
  const data = [...rolling].reverse().map((r) => ({
    day:    r.day?.slice(5) ?? '',
    legacy: r.resolved > 0 ? Number(pct(r.legacy_hits, r.resolved)) : null,
    python: r.resolved > 0 ? Number(pct(r.python_hits, r.resolved)) : null,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <XAxis dataKey="day" tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }} />
        <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }} />
        <ReferenceLine y={50} stroke={MUTED} strokeDasharray="4 4" />
        <RTooltip contentStyle={{ background: SURFACE, border: `1px solid ${BORDER}`, fontFamily: MONO, fontSize: 11 }} />
        <Legend formatter={(v) => <span style={{ fontFamily: MONO, fontSize: 10, color: MUTED }}>{v}</span>} />
        <Line type="monotone" dataKey="legacy" stroke={AMBER} strokeWidth={1.6} dot={false} name={T.legacyValidator} connectNulls />
        <Line type="monotone" dataKey="python" stroke={CYAN}  strokeWidth={2.2} dot={false} name="Python XGBoost"    connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Ensemble panel ───────────────────────────────────────────────────────────
function EnsemblePanel({ ensemble, ensembleObs, onRetrain, busy, T }) {
  const enabled = ensemble?.enabled;
  const m = ensemble?.manifest?.manifest?.markets?.moneyline
        ?? ensemble?.manifest?.markets?.moneyline
        ?? null;
  const ensInf = ensembleObs ? inferenceMeta(ensembleObs.inference, T.lang) : null;

  return (
    <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '20px 18px', mt: 3, overflow: 'hidden' }}>
      <CornerBrackets color={GREEN} size={14} />
      <Box className="amlc-flow-border" sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px' }} />

      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px' }}>
            META-LEARNER // SPRINT 4
          </Typography>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.2rem', fontWeight: 700, color: GREEN, lineHeight: 1.1 }}>
            {T.ensembleCombiner}
          </Typography>
          {ensInf && (
            <Box sx={{ display: 'flex', gap: 1, mt: 0.75, flexWrap: 'wrap' }}>
              <Chip
                label={ensInf.label}
                size="small"
                sx={{
                  fontFamily: MONO, fontSize: '8px', color: ensInf.color,
                  border: `1px solid ${ensInf.color}`, background: `${ensInf.color}14`,
                  height: 18, letterSpacing: '1.5px',
                }}
              />
              <InferenceChip label={T.artifactYes} active={ensembleObs?.artifact} />
              <InferenceChip label={T.inMemoryYes} active={ensembleObs?.loaded} />
            </Box>
          )}
        </Box>
        <Button
          onClick={onRetrain}
          disabled={busy || !enabled}
          sx={{
            border: `1px solid ${GREEN}`, color: GREEN, fontFamily: MONO, fontSize: '10px', letterSpacing: '2px',
            px: 2, py: '6px',
            '&:hover': { background: `${GREEN}1A`, boxShadow: `0 0 14px ${GREEN}40` },
            '&:disabled': { opacity: 0.4, borderColor: MUTED, color: MUTED },
          }}
        >
          {busy ? T.training : T.retrainEnsemble}
        </Button>
      </Box>

      <Box sx={{ background: 'rgba(43,255,136,0.04)', border: `1px solid ${GREEN}33`, p: '12px 14px', mb: 2 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: INK1, lineHeight: 1.6 }} component="div">
          {T.lang === 'en' ? <>
            The ensemble is a calibrated <strong style={{ color: GREEN }}>LogisticRegression</strong> that combines three sources of
            home-win probability — the <strong style={{ color: AMBER }}>Oracle</strong> (Claude/Grok),
            the <strong style={{ color: ACCENT }}>Legacy</strong> deterministic validator, and the trained
            <strong style={{ color: CYAN }}> Python XGBoost</strong> — into a single calibrated number.
            Each source enters in logit space; the model learns per-source weights against resolved games.
            A saved artifact only beats the best individual source on out-of-sample Brier (or you use <code>--force</code>).
          </> : <>
            El ensemble es una <strong style={{ color: GREEN }}>LogisticRegression</strong> calibrada que combina tres fuentes de probabilidad de victoria
            del equipo local — el <strong style={{ color: AMBER }}>Oracle</strong> (Claude/Grok), el validador
            <strong style={{ color: ACCENT }}> Legacy</strong> determinístico, y el
            <strong style={{ color: CYAN }}> Python XGBoost</strong> entrenado — en un único número calibrado.
            Cada fuente entra en espacio logit; el modelo aprende pesos por fuente contra partidos resueltos.
            Un artefacto guardado solo supera a la mejor fuente individual en Brier fuera de muestra.
          </>}
        </Typography>
      </Box>

      {!enabled && (
        <EmptyChart text={T.ensembleDisabled} />
      )}
      {enabled && !m && (
        <EmptyChart text={T.ensembleNotTrained} />
      )}
      {enabled && m && (
        <>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '2px', mb: 1 }}>
            {T.brierScores}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
            <BrierBadge label="Oracle"   value={m.brier_oracle} color={AMBER} />
            <BrierBadge label="Legacy"   value={m.brier_legacy} color={ACCENT} />
            <BrierBadge label="Python"   value={m.brier_python} color={CYAN} />
            <BrierBadge label="ENSEMBLE" value={m.brier_test}   color={GREEN} highlight />
          </Box>

          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '2px', mb: 1 }}>
            {T.learnedWeights}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <WeightBadge label="Oracle"    value={m.coef_oracle} />
            <WeightBadge label="Legacy"    value={m.coef_legacy} />
            <WeightBadge label="Python"    value={m.coef_python} />
            <WeightBadge label="Intercept" value={m.intercept} />
          </Box>

          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 2 }}>
            n_train={m.n_train} · n_test={m.n_test} · trained {m.trained_at ? timeAgo(m.trained_at) : '—'}
          </Typography>
        </>
      )}
    </Box>
  );
}

function BrierBadge({ label, value, color, highlight = false }) {
  return (
    <Box sx={{
      position: 'relative', minWidth: 96, px: '10px', py: '6px',
      border: `1px solid ${color}`, background: highlight ? `${color}1A` : 'transparent',
      boxShadow: highlight ? `0 0 10px ${color}40` : 'none',
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: MUTED, letterSpacing: '2px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 700, color }}>{fmtBrier(value)}</Typography>
    </Box>
  );
}

function WeightBadge({ label, value }) {
  const num = Number(value);
  const valid = Number.isFinite(num);
  const c = !valid ? MUTED : num > 0 ? GREEN : num < 0 ? RED : MUTED;
  return (
    <Box sx={{ minWidth: 96, px: '10px', py: '6px', border: `1px solid ${BORDER}` }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: MUTED, letterSpacing: '2px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 700, color: c }}>
        {valid ? (num >= 0 ? '+' : '') + num.toFixed(3) : '—'}
      </Typography>
    </Box>
  );
}

// ── Chat-sourced picks section ───────────────────────────────────────────────
function ChatPicksSection({ stats, T }) {
  const s = stats?.summary;
  if (!s) {
    return (
      <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '16px 18px', mt: 3, overflow: 'hidden' }}>
        <CornerBrackets color={ACCENT} />
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, letterSpacing: '2px' }}>
          {T.chatLoading}
        </Typography>
      </Box>
    );
  }
  const total   = Number(s.total ?? 0);
  const wins    = Number(s.wins ?? 0);
  const losses  = Number(s.losses ?? 0);
  const pending = Number(s.pending ?? 0);
  const sessions = Number(s.unique_sessions ?? 0);
  const settled = wins + losses;
  const winRate = settled > 0 ? ((wins / settled) * 100).toFixed(1) : null;

  return (
    <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '18px 18px 16px', mt: 3, overflow: 'hidden' }}>
      <CornerBrackets color={ACCENT} size={12} />

      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px' }}>
            ORACLE CHAT // TRAINING BUCKET
          </Typography>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.15rem', fontWeight: 700, color: ACCENT, lineHeight: 1.1 }}>
            {T.chatTitle}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ background: 'rgba(255,122,26,0.05)', border: `1px solid ${ACCENT}33`, p: '10px 12px', mb: 2 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: INK1, lineHeight: 1.6 }} component="div">
          {T.lang === 'en' ? <>
            Picks extracted from Oracle chat sessions, stored with <code>source='oracle_chat'</code>.
            By default these are <strong>excluded</strong> from training (the Python sidecar filters on
            <code> source = 'live'</code>) to avoid biasing the model with hypothetical questions. They
            remain available for opt-in retraining or for tracking the Oracle's casual judgement quality.
          </> : <>
            Picks extraídos de sesiones de chat del Oracle, almacenados con <code>source='oracle_chat'</code>.
            Por defecto están <strong>excluidos</strong> del entrenamiento (el sidecar Python filtra por
            <code> source = 'live'</code>) para no sesgar el modelo con preguntas hipotéticas.
            Disponibles para reentrenamiento opt-in o para monitorear la calidad del juicio casual del Oracle.
          </>}
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1.5 }}>
        <Metric label="TOTAL"    value={total} color={CYAN} />
        <Metric label="WINS"     value={wins} color={GREEN} />
        <Metric label="LOSSES"   value={losses} color={RED} />
        <Metric label="PENDING"  value={pending} color={AMBER} />
        <Metric label="WIN RATE" value={winRate ? `${winRate}%` : '—'} color={winRate && Number(winRate) >= 50 ? GREEN : MUTED} />
      </Box>

      <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 2 }}>
        SESSIONS: <span style={{ color: INK1 }}>{sessions}</span>
        {' · '}FIRST: <span style={{ color: INK1 }}>{s.first_at ? new Date(s.first_at).toISOString().slice(0,10) : '—'}</span>
        {' · '}LAST: <span style={{ color: INK1 }}>{s.last_at ? timeAgo(s.last_at) : '—'}</span>
      </Typography>

      {stats?.by_market?.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
          {stats.by_market.map((m) => (
            <Box key={m.market_type} sx={{
              px: '8px', py: '4px', border: `1px solid ${BORDER}`,
              fontFamily: MONO, fontSize: '9px', color: INK1, letterSpacing: '1.5px',
            }}>
              <span style={{ color: MUTED }}>{(m.market_type || '?').toUpperCase()}: </span>
              <span style={{ color: MARKET_TINTS[m.market_type] ?? ACCENT, fontWeight: 700 }}>{m.n}</span>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Retrain audit log ────────────────────────────────────────────────────────
function RetrainLog({ rows, T }) {
  if (!rows?.length) return <EmptyChart text={T.noRetrains} />;
  const [w, m, st, b, n, d, by] = T.logCols;
  return (
    <Box sx={{ border: `1px solid ${BORDER}`, background: SURFACE, maxHeight: 360, overflowY: 'auto' }}>
      <Box sx={{
        display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 1.5fr',
        background: SURFACE2, borderBottom: `1px solid ${BORDER}`,
        px: '12px', py: '8px',
        fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '2px', textTransform: 'uppercase',
      }}>
        <span>{w}</span><span>{m}</span><span>{st}</span><span>{b}</span><span>{n}</span><span>{d}</span><span>{by}</span>
      </Box>
      {rows.map((r) => (
        <Box key={r.id} sx={{
          display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 1.5fr',
          borderBottom: `1px solid ${C.line}`, px: '12px', py: '8px',
          fontFamily: MONO, fontSize: '10px', color: INK1,
          '&:hover': { background: SURFACE2 },
        }}>
          <span>{timeAgo(r.created_at)}</span>
          <span style={{ color: MARKET_TINTS[r.market] ?? INK1 }}>{r.market}</span>
          <span style={{ color: r.status === 'success' ? GREEN : RED }}>{r.status}</span>
          <span>{fmtBrier(r.brier)}</span>
          <span>{r.n_train ?? '—'}</span>
          <span>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}</span>
          <span style={{ color: MUTED }} title={r.user_email ?? ''}>{r.user_email?.split('@')[0] ?? '—'}</span>
        </Box>
      ))}
    </Box>
  );
}

// ── Toast for retrain feedback ───────────────────────────────────────────────
function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, 6_000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  const c = toast.kind === 'error' ? RED : toast.kind === 'warn' ? AMBER : GREEN;
  return (
    <Box sx={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: SURFACE, border: `1px solid ${c}`, p: '12px 16px',
      boxShadow: `0 0 20px ${c}40`, animation: 'amlc-fadeIn 0.25s both',
      maxWidth: 420,
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: c, letterSpacing: '2px', mb: 0.5 }}>
        {toast.title}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: INK1 }}>
        {toast.message}
      </Typography>
    </Box>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function AdminMLControlCenter({ token, onBack, lang = 'es' }) {
  const T = { ...(STRINGS[lang] ?? STRINGS.es), lang };

  const [status, setStatus]         = useState(null);
  const [calibration, setCalibration] = useState(null);
  const [ensemble, setEnsemble]     = useState(null);
  const [logRows, setLogRows]       = useState([]);
  const [chatStats, setChatStats]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyMarket, setBusyMarket] = useState(null);
  const [activeMarket, setActiveMarket] = useState('moneyline');
  const [toast, setToast]           = useState(null);
  const pollRef = useRef(null);

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/status`, { headers });
      if (!r.ok) throw new Error(`status http ${r.status}`);
      const json = await r.json();
      setStatus(json);
    } catch (err) {
      console.warn('[AdminMLControlCenter] status fetch failed', err.message);
    }
  }, [headers]);

  const fetchCalibration = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml-calibration`, { headers });
      if (!r.ok) throw new Error(`calibration http ${r.status}`);
      setCalibration(await r.json());
    } catch (err) {
      console.warn('[AdminMLControlCenter] calibration fetch failed', err.message);
    }
  }, [headers]);

  const fetchEnsemble = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/ensemble`, { headers });
      if (!r.ok) throw new Error(`ensemble http ${r.status}`);
      setEnsemble(await r.json());
    } catch (err) {
      console.warn('[AdminMLControlCenter] ensemble fetch failed', err.message);
    }
  }, [headers]);

  const fetchLog = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/retrain-log?limit=50`, { headers });
      if (!r.ok) throw new Error(`log http ${r.status}`);
      const json = await r.json();
      setLogRows(json?.data ?? []);
    } catch (err) {
      console.warn('[AdminMLControlCenter] log fetch failed', err.message);
    }
  }, [headers]);

  const fetchChatStats = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/chat-picks-stats`, { headers });
      if (!r.ok) throw new Error(`chat-stats http ${r.status}`);
      setChatStats(await r.json());
    } catch (err) {
      console.warn('[AdminMLControlCenter] chat-stats fetch failed', err.message);
    }
  }, [headers]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchStatus(), fetchCalibration(), fetchEnsemble(), fetchLog(), fetchChatStats()]);
    setRefreshing(false);
  }, [fetchStatus, fetchCalibration, fetchEnsemble, fetchLog, fetchChatStats]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refreshAll();
      if (alive) setLoading(false);
    })();
    pollRef.current = setInterval(fetchStatus, 10_000);
    return () => {
      alive = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshAll, fetchStatus]);

  // ── Retrain actions ───────────────────────────────────────────────────────
  const handleRetrain = useCallback(async (market) => {
    setBusyMarket(market);
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/retrain`, {
        method: 'POST', headers, body: JSON.stringify({ market }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `http ${r.status}`);
      const m = j?.metrics ?? {};
      setToast({
        kind: 'ok', title: T.toastOk(market),
        message: `Brier ${fmtBrier(m.brier)} · n_train=${m.nTrain ?? '?'} · ${(j.duration_ms / 1000).toFixed(1)}s`,
      });
      await Promise.all([fetchCalibration(), fetchLog(), fetchStatus()]);
    } catch (err) {
      setToast({ kind: 'error', title: T.toastFail(market), message: err.message });
      await fetchLog();
    } finally {
      setBusyMarket(null);
    }
  }, [headers, fetchCalibration, fetchLog, fetchStatus, T]);

  const handleRetrainEnsemble = useCallback(async () => {
    setBusyMarket('ensemble');
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/retrain/ensemble`, {
        method: 'POST', headers, body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `http ${r.status}`);
      setToast({
        kind: 'ok', title: T.ensembleOk,
        message: `Brier ${fmtBrier(j?.metrics?.brier)} · ${(j.duration_ms / 1000).toFixed(1)}s`,
      });
      await Promise.all([fetchEnsemble(), fetchLog(), fetchStatus()]);
    } catch (err) {
      setToast({ kind: 'error', title: T.ensembleFail, message: err.message });
      await fetchLog();
    } finally {
      setBusyMarket(null);
    }
  }, [headers, fetchEnsemble, fetchLog, fetchStatus, T]);

  const handleRetrainAll = useCallback(async () => {
    setBusyMarket('all');
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/retrain`, {
        method: 'POST', headers, body: JSON.stringify({ market: 'all' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `http ${r.status}`);
      setToast({
        kind: 'ok', title: T.allOk,
        message: T.allOkMsg((j.duration_ms / 1000).toFixed(1)),
      });
      await Promise.all([fetchCalibration(), fetchLog(), fetchStatus()]);
    } catch (err) {
      setToast({ kind: 'error', title: T.allFail, message: err.message });
      await fetchLog();
    } finally {
      setBusyMarket(null);
    }
  }, [headers, fetchCalibration, fetchLog, fetchStatus, T]);

  // ── Render ────────────────────────────────────────────────────────────────
  const manifest = calibration?.calibration?.manifest ?? null;
  const ensembleManifest = ensemble;
  const rolling = calibration?.rolling_30d ?? [];

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{CSS}</style>
        <CircularProgress sx={{ color: CYAN }} />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', background: BG, color: INK0, p: { xs: 1.5, md: 3 } }}>
      <style>{CSS}</style>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Back + global retrain */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button
          onClick={onBack}
          sx={{ color: CYAN, fontFamily: MONO, fontSize: '10px', letterSpacing: '2px', border: `1px solid ${BORDER}`, px: 2, py: '6px' }}
        >
          {T.back}
        </Button>
        <Button
          onClick={handleRetrainAll}
          disabled={busyMarket != null}
          sx={{
            border: `1px solid ${ACCENT}`, color: ACCENT, fontFamily: MONO, fontSize: '11px', letterSpacing: '2px',
            px: 2.5, py: '8px', fontWeight: 700,
            '&:hover': { background: `${ACCENT}1A`, boxShadow: `0 0 18px ${ACCENT}50` },
            '&:disabled': { opacity: 0.4, borderColor: MUTED, color: MUTED },
          }}
        >
          {busyMarket === 'all' ? T.trainingAll : T.retrainAll}
        </Button>
      </Box>

      <HUDStatusBar status={status} loading={refreshing} onRefresh={refreshAll} T={T} />

      <MlInferencePanel observability={status?.observability} T={T} />

      {/* Per-market cards */}
      <SectionTitle>{T.perMarketModels}</SectionTitle>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        {MARKETS.map((m, i) => (
          <MarketCard
            key={m}
            market={m}
            manifest={manifest}
            marketObs={status?.observability?.markets?.find((row) => row.market === m)}
            onRetrain={handleRetrain}
            busy={busyMarket === m || busyMarket === 'all'}
            index={i}
            T={T}
          />
        ))}
      </Box>

      {/* Reliability + rolling */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.4fr 1fr' }, gap: 2, mb: 3 }}>
        <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '16px 14px' }}>
          <CornerBrackets color={CYAN} />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
            <SectionTitle inline>{T.reliabilityDiagram}</SectionTitle>
            <ToggleButtonGroup
              value={activeMarket}
              exclusive
              size="small"
              onChange={(_, v) => v && setActiveMarket(v)}
              sx={{
                '& .MuiToggleButton-root': {
                  fontFamily: MONO, fontSize: '9px', letterSpacing: '2px',
                  color: MUTED, border: `1px solid ${BORDER}`, py: '4px', px: '10px',
                  '&.Mui-selected': { color: INK0, background: DIM, borderColor: CYAN },
                },
              }}
            >
              {MARKETS.map((m) => (
                <ToggleButton key={m} value={m}>{m.toUpperCase()}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
          <ReliabilityPanel manifest={manifest} market={activeMarket} T={T} />
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 1 }}>
            {T.reliabilityNote}
          </Typography>
        </Box>

        <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '16px 14px' }}>
          <CornerBrackets color={AMBER} />
          <SectionTitle>{T.rolling30d}</SectionTitle>
          <Rolling30dChart rolling={rolling} T={T} />
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 1 }}>
            {T.rollingNote}
          </Typography>
        </Box>
      </Box>

      {/* Ensemble */}
      <EnsemblePanel
        ensemble={ensembleManifest}
        ensembleObs={status?.observability?.ensemble}
        onRetrain={handleRetrainEnsemble}
        busy={busyMarket === 'ensemble' || busyMarket === 'all'}
        T={T}
      />

      {/* Chat-sourced picks bucket */}
      <ChatPicksSection stats={chatStats} T={T} />

      {/* Retrain audit log */}
      <SectionTitle>{T.retrainLog}</SectionTitle>
      <RetrainLog rows={logRows} T={T} />

      {/* Player Props banner */}
      <Box sx={{
        mt: 3, position: 'relative',
        background: `linear-gradient(135deg, ${SURFACE} 0%, ${SURFACE2} 100%)`,
        border: `1px dashed ${ACCENT}66`, p: '16px 18px', overflow: 'hidden',
      }}>
        <CornerBrackets color={ACCENT} />
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px' }}>
          SPRINT 5 // PLAYER PROPS
        </Typography>
        <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 700, color: ACCENT, mt: '4px' }}>
          {T.comingSoon}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: INK1, mt: 1, maxWidth: 720 }}>
          {T.propsDesc}
        </Typography>
      </Box>

      <Box sx={{ mt: 3, textAlign: 'center', fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '2px' }}>
        HEXA.ML CONTROL CENTER · POLL INTERVAL 10s · LIVE
      </Box>
    </Box>
  );
}

function SectionTitle({ children, inline = false }) {
  return (
    <Typography sx={{
      fontFamily: MONO, fontSize: '10px', letterSpacing: '3px',
      color: MUTED, textTransform: 'uppercase',
      mb: inline ? 0 : 1.5, mt: inline ? 0 : 1,
    }}>
      // {children}
    </Typography>
  );
}
