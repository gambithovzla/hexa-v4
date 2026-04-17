import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  calculateFairOddsFromProbability,
  calculateKellyStake,
  calculateParlayFromDecimals,
  calculatePayoutFromDecimal,
  convertOddsFrom,
  decimalToImpliedProbability,
  formatAmericanOdds,
  formatDecimalOdds,
  formatMoney,
  formatProbability,
  parseProbabilityPercent,
} from '../utils/odds';
import { C, BARLOW, MONO } from '../theme';

const LABELS = {
  en: {
    title: 'HEXA Tools',
    subtitle: 'A premium market utility layer for odds conversion, bet sizing, parlay pricing, and edge detection.',
    status: 'Live utility suite',
    converter: {
      eyebrow: 'Module 01',
      title: 'Odds Converter',
      subtitle: 'Convert decimal, American, fractional, and implied probability in real time.',
      invalid: 'Enter a valid value to sync all formats.',
      reset: 'Reset',
      presets: 'Quick loads',
    },
    betSlip: {
      eyebrow: 'Module 02',
      title: 'Bet Slip Calculator',
      subtitle: 'Model stake, profit, total return, and break-even point before placing the ticket.',
      sync: 'Use converter odds',
      invalid: 'Enter stake and valid odds to compute the bet slip.',
    },
    parlay: {
      eyebrow: 'Module 03',
      title: 'Parlay Engine',
      subtitle: 'Stack legs in mixed formats and get the combined price instantly.',
      addLeg: 'Add leg',
      addCurrent: 'Add converter as leg',
      addHexa: 'Add latest Hexa pick',
      remove: 'Remove',
      invalid: 'Add at least one valid leg to price the parlay.',
    },
    edge: {
      eyebrow: 'Module 04',
      title: 'Hexa Edge + Kelly',
      subtitle: 'Compare market price vs Hexa confidence, generate fair odds, and suggest a Kelly-based stake.',
      sync: 'Use converter odds',
      confidence: 'Hexa confidence',
      bankrollHint: 'Bankroll unlocks a recommended quarter-Kelly stake.',
      positive: 'Value detected',
      negative: 'Market is too expensive',
      importHexa: 'Import last Hexa pick',
      importedFrom: 'Imported from',
      importEmpty: 'No Hexa picks available to import',
    },
    reference: {
      eyebrow: 'Reference Grid',
      title: 'Common Conversion Table',
      subtitle: 'Quick benchmark prices users recognize at a glance.',
    },
    fields: {
      decimal: 'Decimal',
      american: 'American',
      fractional: 'Fractional',
      probability: 'Implied %',
      stake: 'Stake',
      oddsFormat: 'Odds format',
      oddsValue: 'Odds',
      bankroll: 'Bankroll',
      legLabel: 'Leg label',
      marketOdds: 'Market odds',
      parlayStake: 'Parlay stake',
    },
    stats: {
      normalized: 'Normalized price',
      profit: 'Potential profit',
      totalReturn: 'Total return',
      breakEven: 'Break-even',
      combinedPrice: 'Combined price',
      legs: 'Valid legs',
      edge: 'Edge',
      fairOdds: 'Fair odds',
      kelly: 'Quarter Kelly',
      recommendedStake: 'Recommended stake',
      fullKelly: 'Full Kelly',
    },
    formats: {
      american: 'American',
      decimal: 'Decimal',
      fractional: 'Fractional',
      probability: 'Probability',
    },
  },
  es: {
    title: 'HEXA Herramientas',
    subtitle: 'Una capa premium de utilidades para convertir cuotas, calcular apuestas, combinar parlays y detectar valor.',
    status: 'Suite de utilidades activa',
    converter: {
      eyebrow: 'Módulo 01',
      title: 'Conversor de Cuotas',
      subtitle: 'Convierte decimal, americana, fraccional y probabilidad implícita en tiempo real.',
      invalid: 'Ingresa un valor válido para sincronizar todos los formatos.',
      reset: 'Resetear',
      presets: 'Cargas rápidas',
    },
    betSlip: {
      eyebrow: 'Módulo 02',
      title: 'Calculadora de Ticket',
      subtitle: 'Modela stake, ganancia, retorno total y break-even antes de tirar el ticket.',
      sync: 'Usar cuota del conversor',
      invalid: 'Ingresa stake y una cuota válida para calcular el ticket.',
    },
    parlay: {
      eyebrow: 'Módulo 03',
      title: 'Motor de Parlay',
      subtitle: 'Combina patas en formatos mixtos y obtén la cuota total al instante.',
      addLeg: 'Agregar pata',
      addCurrent: 'Agregar cuota actual',
      addHexa: 'Agregar último pick Hexa',
      remove: 'Quitar',
      invalid: 'Agrega al menos una pata válida para cotizar el parlay.',
    },
    edge: {
      eyebrow: 'Módulo 04',
      title: 'Hexa Edge + Kelly',
      subtitle: 'Compara el precio del mercado contra la confianza de Hexa, genera cuota justa y recomienda stake Kelly.',
      sync: 'Usar cuota del conversor',
      confidence: 'Confianza de Hexa',
      bankrollHint: 'El bankroll desbloquea una recomendación de quarter-Kelly.',
      positive: 'Valor detectado',
      negative: 'El mercado está caro',
      importHexa: 'Importar último pick Hexa',
      importedFrom: 'Importado de',
      importEmpty: 'No hay picks de Hexa para importar',
    },
    reference: {
      eyebrow: 'Tabla de referencia',
      title: 'Conversiones comunes',
      subtitle: 'Precios benchmark que el usuario reconoce rápido.',
    },
    fields: {
      decimal: 'Decimal',
      american: 'Americana',
      fractional: 'Fraccional',
      probability: 'Implícita %',
      stake: 'Stake',
      oddsFormat: 'Formato',
      oddsValue: 'Cuota',
      bankroll: 'Bankroll',
      legLabel: 'Etiqueta',
      marketOdds: 'Cuota de mercado',
      parlayStake: 'Stake del parlay',
    },
    stats: {
      normalized: 'Precio normalizado',
      profit: 'Ganancia potencial',
      totalReturn: 'Retorno total',
      breakEven: 'Break-even',
      combinedPrice: 'Cuota combinada',
      legs: 'Patas válidas',
      edge: 'Edge',
      fairOdds: 'Cuota justa',
      kelly: 'Quarter Kelly',
      recommendedStake: 'Stake sugerido',
      fullKelly: 'Kelly completo',
    },
    formats: {
      american: 'Americana',
      decimal: 'Decimal',
      fractional: 'Fraccional',
      probability: 'Probabilidad',
    },
  },
};

const FORMAT_OPTIONS = ['american', 'decimal', 'fractional'];
const QUICK_PRESETS = [
  { type: 'american', value: '-110' },
  { type: 'american', value: '+150' },
  { type: 'decimal', value: '2.00' },
  { type: 'fractional', value: '5/2' },
  { type: 'probability', value: '60' },
];
const REFERENCE_AMERICAN = [-300, -200, -110, 100, 150, 200, 300];

const panelSx = {
  position: 'relative',
  p: { xs: 2, md: 2.5 },
  border: `1px solid ${C.border}`,
  background: `linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))`,
  boxShadow: 'inset 0 0 32px rgba(0,0,0,0.75)',
  overflow: 'hidden',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    width: 16,
    height: 16,
    borderTop: `2px solid ${C.cyan}`,
    borderLeft: `2px solid ${C.cyan}`,
  },
  '&::after': {
    content: '""',
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 16,
    height: 16,
    borderRight: `2px solid ${C.accent}`,
    borderBottom: `2px solid ${C.accent}`,
  },
};

const inputSx = {
  '& .MuiOutlinedInput-root': {
    background: 'rgba(0, 217, 255, 0.03)',
  },
};

function formatByType(type, value) {
  if (value == null) return '--';
  if (type === 'decimal') return formatDecimalOdds(value);
  if (type === 'american') return formatAmericanOdds(value);
  if (type === 'probability') return formatProbability(value);
  return String(value);
}

function SectionHeader({ eyebrow, title, subtitle, accent = C.cyan }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.28em', color: C.textMuted, textTransform: 'uppercase' }}>
        // {eyebrow}
      </Typography>
      <Typography sx={{ fontFamily: BARLOW, fontSize: { xs: 18, md: 20 }, letterSpacing: '0.14em', color: accent, textTransform: 'uppercase', mt: 0.5 }}>
        {title}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: 11, color: C.textSecondary, mt: 0.75, maxWidth: 620 }}>
        {subtitle}
      </Typography>
    </Box>
  );
}

function StatBlock({ label, value, accent = C.cyan }) {
  return (
    <Box sx={{ p: 1.5, border: `1px solid ${accent === C.accent ? C.accentLine : accent === C.green ? C.greenLine : C.cyanLine}`, background: 'rgba(0,0,0,0.38)' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.18em', color: C.textMuted, textTransform: 'uppercase', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: BARLOW, fontSize: 18, letterSpacing: '0.08em', color: accent, textTransform: 'uppercase' }}>
        {value}
      </Typography>
    </Box>
  );
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function americanFromEntry(entry) {
  const raw = entry?.value_breakdown?.odds;
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? `+${Math.round(n)}` : String(Math.round(n));
}

export default function OddsLab({ lang = 'en' }) {
  const t = LABELS[lang] ?? LABELS.en;

  const [hexaPicks, setHexaPicks] = useState([]);
  const [importedLabel, setImportedLabel] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('hexa_token');
    if (!token) return;
    fetch(`${API_URL}/api/picks?limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (json?.success && Array.isArray(json.data)) {
          setHexaPicks(json.data.filter(row => americanFromEntry(row) != null));
        }
      })
      .catch(() => {});
  }, []);

  const [converterInputs, setConverterInputs] = useState({
    decimal: '1.91',
    american: '-110',
    fractional: '10/11',
    probability: '52.36',
  });
  const [converterError, setConverterError] = useState('');

  const [betSlip, setBetSlip] = useState({
    oddsFormat: 'american',
    oddsValue: '-110',
    stake: '100',
  });

  const [parlayStake, setParlayStake] = useState('25');
  const [parlayLegs, setParlayLegs] = useState([
    { id: 1, label: 'ML HOME', oddsFormat: 'american', oddsValue: '-110' },
    { id: 2, label: 'OVER 8.5', oddsFormat: 'american', oddsValue: '+145' },
  ]);

  const [edgeForm, setEdgeForm] = useState({
    oddsFormat: 'american',
    marketOdds: '-110',
    confidence: '57',
    bankroll: '1000',
  });

  const converterSnapshot = convertOddsFrom('decimal', converterInputs.decimal);
  const betSlipDecimal = convertOddsFrom(betSlip.oddsFormat, betSlip.oddsValue)?.decimalValue ?? null;
  const betSlipResult = calculatePayoutFromDecimal(betSlip.stake, betSlipDecimal);

  const parlayDecimals = parlayLegs.map(leg => (
    convertOddsFrom(leg.oddsFormat, leg.oddsValue)?.decimalValue ?? null
  ));
  const validParlayDecimals = parlayDecimals.filter(Boolean);
  const parlayResult = calculateParlayFromDecimals(validParlayDecimals);
  const parlayPayout = calculatePayoutFromDecimal(parlayStake, parlayResult?.combinedDecimal ?? null);

  const marketDecimal = convertOddsFrom(edgeForm.oddsFormat, edgeForm.marketOdds)?.decimalValue ?? null;
  const marketProbability = marketDecimal != null ? decimalToImpliedProbability(marketDecimal) : null;
  const hexaConfidence = parseProbabilityPercent(edgeForm.confidence);
  const fairOdds = hexaConfidence != null ? calculateFairOddsFromProbability(hexaConfidence) : null;
  const edgePercent = marketProbability != null && hexaConfidence != null
    ? Number((hexaConfidence - marketProbability).toFixed(2))
    : null;
  const kellyResult = calculateKellyStake({
    bankroll: edgeForm.bankroll,
    probabilityPercent: hexaConfidence,
    decimalOdds: marketDecimal,
  });

  function handleConverterChange(type, rawValue) {
    if (!String(rawValue ?? '').trim()) {
      setConverterInputs({ decimal: '', american: '', fractional: '', probability: '' });
      setConverterError('');
      return;
    }

    const converted = convertOddsFrom(type, rawValue);
    if (!converted) {
      setConverterInputs(prev => ({ ...prev, [type]: rawValue }));
      setConverterError(t.converter.invalid);
      return;
    }

    setConverterInputs({
      decimal: converted.decimal,
      american: converted.american,
      fractional: converted.fractional,
      probability: converted.probability.replace('%', ''),
    });
    setConverterError('');
  }

  function resetConverter() {
    setConverterInputs({ decimal: '1.91', american: '-110', fractional: '10/11', probability: '52.36' });
    setConverterError('');
  }

  function addParlayLeg(prefill = null) {
    setParlayLegs(prev => ([
      ...prev,
      {
        id: Date.now() + prev.length,
        label: `LEG ${prev.length + 1}`,
        oddsFormat: prefill?.oddsFormat ?? 'american',
        oddsValue: prefill?.oddsValue ?? '',
      },
    ]));
  }

  function updateParlayLeg(id, key, value) {
    setParlayLegs(prev => prev.map(leg => (leg.id === id ? { ...leg, [key]: value } : leg)));
  }

  function removeParlayLeg(id) {
    setParlayLegs(prev => prev.filter(leg => leg.id !== id));
  }

  const valueDetected = edgePercent != null && edgePercent > 0;

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3 } }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', lg: 'center' }}>
          <Box>
            <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.textMuted, letterSpacing: '0.28em', textTransform: 'uppercase' }}>
              // premium utility layer
            </Typography>
            <Typography sx={{ fontFamily: BARLOW, fontSize: { xs: 28, md: 34 }, color: C.accent, letterSpacing: '0.16em', textTransform: 'uppercase', mt: 0.5 }}>
              {t.title}
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: 12, color: C.textSecondary, maxWidth: 760, mt: 1 }}>
              {t.subtitle}
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ width: { xs: '100%', lg: 'auto' } }}>
            <StatBlock label={t.stats.normalized} value={converterInputs.american || '--'} accent={C.cyan} />
            <StatBlock label={t.stats.breakEven} value={converterInputs.probability ? `${converterInputs.probability}%` : '--'} accent={C.accent} />
            <StatBlock label={t.status} value={valueDetected ? t.edge.positive : t.status} accent={valueDetected ? C.green : C.cyan} />
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.2fr 0.8fr' }, gap: 3 }}>
        <Box sx={{ display: 'grid', gap: 3 }}>
          <Box sx={panelSx}>
            <SectionHeader eyebrow={t.converter.eyebrow} title={t.converter.title} subtitle={t.converter.subtitle} />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
              {['decimal', 'american', 'fractional', 'probability'].map(type => (
                <TextField
                  key={type}
                  label={t.fields[type]}
                  value={converterInputs[type]}
                  onChange={(event) => handleConverterChange(type, event.target.value)}
                  fullWidth
                  sx={inputSx}
                />
              ))}
            </Box>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {QUICK_PRESETS.map(preset => (
                  <Chip
                    key={`${preset.type}-${preset.value}`}
                    label={`${t.fields[preset.type]} ${preset.value}${preset.type === 'probability' ? '%' : ''}`}
                    onClick={() => handleConverterChange(preset.type, preset.value)}
                    sx={{
                      color: C.cyan,
                      border: `1px solid ${C.cyanLine}`,
                      background: C.cyanDim,
                    }}
                  />
                ))}
              </Stack>
              <Button variant="outlined" onClick={resetConverter}>
                {t.converter.reset}
              </Button>
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, 1fr)' }, gap: 1.5 }}>
              <StatBlock label={t.fields.decimal} value={converterInputs.decimal || '--'} accent={C.cyan} />
              <StatBlock label={t.fields.american} value={converterInputs.american || '--'} accent={C.accent} />
              <StatBlock label={t.fields.fractional} value={converterInputs.fractional || '--'} accent={C.green} />
              <StatBlock label={t.fields.probability} value={converterInputs.probability ? `${converterInputs.probability}%` : '--'} accent={C.cyan} />
            </Box>

            {converterError && (
              <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.red, letterSpacing: '0.08em', mt: 1.5 }}>
                {converterError}
              </Typography>
            )}
          </Box>

          <Box sx={panelSx}>
            <SectionHeader eyebrow={t.betSlip.eyebrow} title={t.betSlip.title} subtitle={t.betSlip.subtitle} accent={C.accent} />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '160px 1fr 1fr auto' }, gap: 2, alignItems: 'end' }}>
              <TextField
                select
                label={t.fields.oddsFormat}
                value={betSlip.oddsFormat}
                onChange={(event) => setBetSlip(prev => ({ ...prev, oddsFormat: event.target.value }))}
                sx={inputSx}
              >
                {FORMAT_OPTIONS.map(option => (
                  <MenuItem key={option} value={option}>{t.formats[option]}</MenuItem>
                ))}
              </TextField>

              <TextField
                label={t.fields.oddsValue}
                value={betSlip.oddsValue}
                onChange={(event) => setBetSlip(prev => ({ ...prev, oddsValue: event.target.value }))}
                sx={inputSx}
              />

              <TextField
                label={t.fields.stake}
                value={betSlip.stake}
                onChange={(event) => setBetSlip(prev => ({ ...prev, stake: event.target.value }))}
                sx={inputSx}
              />

              <Button
                variant="outlined"
                onClick={() => setBetSlip(prev => ({ ...prev, oddsValue: converterInputs[prev.oddsFormat] || prev.oddsValue }))}
              >
                {t.betSlip.sync}
              </Button>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, 1fr)' }, gap: 1.5, mt: 2 }}>
              <StatBlock
                label={t.stats.normalized}
                value={betSlipDecimal != null ? formatDecimalOdds(betSlipDecimal) : '--'}
                accent={C.cyan}
              />
              <StatBlock
                label={t.stats.profit}
                value={betSlipResult ? formatMoney(betSlipResult.profit) : '--'}
                accent={C.green}
              />
              <StatBlock
                label={t.stats.totalReturn}
                value={betSlipResult ? formatMoney(betSlipResult.totalReturn) : '--'}
                accent={C.accent}
              />
              <StatBlock
                label={t.stats.breakEven}
                value={betSlipResult ? formatProbability(betSlipResult.breakEvenProbability) : '--'}
                accent={C.cyan}
              />
            </Box>

            {!betSlipResult && (
              <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.textMuted, mt: 1.5 }}>
                {t.betSlip.invalid}
              </Typography>
            )}
          </Box>
        </Box>

        <Box sx={{ display: 'grid', gap: 3 }}>
          <Box sx={panelSx}>
            <SectionHeader eyebrow={t.edge.eyebrow} title={t.edge.title} subtitle={t.edge.subtitle} accent={C.green} />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '150px 1fr 1fr auto' }, gap: 2, alignItems: 'end' }}>
              <TextField
                select
                label={t.fields.oddsFormat}
                value={edgeForm.oddsFormat}
                onChange={(event) => setEdgeForm(prev => ({ ...prev, oddsFormat: event.target.value }))}
                sx={inputSx}
              >
                {FORMAT_OPTIONS.map(option => (
                  <MenuItem key={option} value={option}>{t.formats[option]}</MenuItem>
                ))}
              </TextField>

              <TextField
                label={t.fields.marketOdds}
                value={edgeForm.marketOdds}
                onChange={(event) => setEdgeForm(prev => ({ ...prev, marketOdds: event.target.value }))}
                sx={inputSx}
              />

              <TextField
                label={t.fields.bankroll}
                value={edgeForm.bankroll}
                onChange={(event) => setEdgeForm(prev => ({ ...prev, bankroll: event.target.value }))}
                sx={inputSx}
              />

              <Button
                variant="outlined"
                onClick={() => setEdgeForm(prev => ({ ...prev, marketOdds: converterInputs[prev.oddsFormat] || prev.marketOdds }))}
              >
                {t.edge.sync}
              </Button>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
              <Button
                variant="outlined"
                disabled={hexaPicks.length === 0}
                onClick={() => {
                  const latest = hexaPicks[0];
                  if (!latest) return;
                  const american = americanFromEntry(latest);
                  const confidence = Number(latest.oracle_confidence);
                  setEdgeForm(prev => ({
                    ...prev,
                    oddsFormat: 'american',
                    marketOdds: american ?? prev.marketOdds,
                    confidence: Number.isFinite(confidence) && confidence > 0 ? String(confidence) : prev.confidence,
                  }));
                  setImportedLabel(latest.pick ?? latest.matchup ?? '');
                }}
              >
                {t.edge.importHexa}
              </Button>
              {importedLabel && (
                <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.textMuted }}>
                  {t.edge.importedFrom}: {importedLabel}
                </Typography>
              )}
              {hexaPicks.length === 0 && (
                <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.textMuted }}>
                  {t.edge.importEmpty}
                </Typography>
              )}
            </Stack>

            <Box sx={{ mt: 2 }}>
              <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.2em', mb: 1 }}>
                {t.edge.confidence}: {edgeForm.confidence || '--'}%
              </Typography>
              <Slider
                min={1}
                max={99}
                step={0.5}
                value={Number(edgeForm.confidence) || 50}
                onChange={(_, value) => setEdgeForm(prev => ({ ...prev, confidence: String(value) }))}
                valueLabelDisplay="auto"
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1.5, mt: 1 }}>
              <StatBlock label={t.stats.breakEven} value={formatProbability(marketProbability)} accent={C.cyan} />
              <StatBlock label={t.stats.edge} value={edgePercent != null ? `${edgePercent > 0 ? '+' : ''}${edgePercent.toFixed(2)}%` : '--'} accent={valueDetected ? C.green : C.red} />
              <StatBlock label={t.stats.fairOdds} value={fairOdds ? formatAmericanOdds(fairOdds.american) : '--'} accent={C.accent} />
              <StatBlock label={t.stats.kelly} value={kellyResult ? `${kellyResult.recommendedKellyPercent.toFixed(2)}%` : '--'} accent={C.green} />
            </Box>

            <Divider sx={{ my: 2 }} />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <Chip
                label={valueDetected ? t.edge.positive : t.edge.negative}
                sx={{
                  color: valueDetected ? C.green : C.red,
                  border: `1px solid ${valueDetected ? C.greenLine : C.redLine}`,
                  background: valueDetected ? C.greenDim : C.redDim,
                }}
              />
              <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.textMuted }}>
                {t.edge.bankrollHint}
              </Typography>
            </Stack>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1.5, mt: 2 }}>
              <StatBlock label={t.stats.recommendedStake} value={kellyResult ? formatMoney(kellyResult.recommendedStake) : '--'} accent={C.green} />
              <StatBlock label={t.stats.fullKelly} value={kellyResult ? `${kellyResult.fullKellyPercent.toFixed(2)}%` : '--'} accent={C.cyan} />
            </Box>
          </Box>
        </Box>
      </Box>

      <Box sx={panelSx}>
        <SectionHeader eyebrow={t.parlay.eyebrow} title={t.parlay.title} subtitle={t.parlay.subtitle} accent={C.accent} />

        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {parlayLegs.map((leg, index) => (
            <Box
              key={leg.id}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '180px 140px 1fr auto' },
                gap: 1.5,
                p: 1.5,
                border: `1px solid ${C.borderLight}`,
                background: 'rgba(0,0,0,0.28)',
                alignItems: 'end',
              }}
            >
              <TextField
                label={t.fields.legLabel}
                value={leg.label}
                onChange={(event) => updateParlayLeg(leg.id, 'label', event.target.value)}
                placeholder={`LEG ${index + 1}`}
                sx={inputSx}
              />

              <TextField
                select
                label={t.fields.oddsFormat}
                value={leg.oddsFormat}
                onChange={(event) => updateParlayLeg(leg.id, 'oddsFormat', event.target.value)}
                sx={inputSx}
              >
                {FORMAT_OPTIONS.map(option => (
                  <MenuItem key={option} value={option}>{t.formats[option]}</MenuItem>
                ))}
              </TextField>

              <TextField
                label={t.fields.oddsValue}
                value={leg.oddsValue}
                onChange={(event) => updateParlayLeg(leg.id, 'oddsValue', event.target.value)}
                sx={inputSx}
              />

              <Button
                variant="outlined"
                color="primary"
                onClick={() => removeParlayLeg(leg.id)}
                disabled={parlayLegs.length === 1}
              >
                {t.parlay.remove}
              </Button>
            </Box>
          ))}
        </Box>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mt: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button variant="outlined" onClick={() => addParlayLeg()}>
              {t.parlay.addLeg}
            </Button>
            <Button
              variant="outlined"
              onClick={() => addParlayLeg({ oddsFormat: 'american', oddsValue: converterInputs.american || '' })}
            >
              {t.parlay.addCurrent}
            </Button>
            <Button
              variant="outlined"
              disabled={hexaPicks.length === 0}
              onClick={() => {
                const latest = hexaPicks[0];
                if (!latest) return;
                const american = americanFromEntry(latest);
                if (!american) return;
                setParlayLegs(prev => ([
                  ...prev,
                  {
                    id: Date.now() + prev.length,
                    label: (latest.pick ?? `HEXA ${prev.length + 1}`).slice(0, 24).toUpperCase(),
                    oddsFormat: 'american',
                    oddsValue: american,
                  },
                ]));
              }}
            >
              {t.parlay.addHexa}
            </Button>
          </Stack>

          <TextField
            label={t.fields.parlayStake}
            value={parlayStake}
            onChange={(event) => setParlayStake(event.target.value)}
            sx={{ ...inputSx, minWidth: { xs: '100%', md: 180 } }}
          />
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(5, 1fr)' }, gap: 1.5, mt: 2 }}>
          <StatBlock label={t.stats.legs} value={String(validParlayDecimals.length)} accent={C.cyan} />
          <StatBlock label={t.stats.combinedPrice} value={parlayResult ? formatAmericanOdds(parlayResult.combinedAmerican) : '--'} accent={C.accent} />
          <StatBlock label={t.fields.decimal} value={parlayResult ? formatDecimalOdds(parlayResult.combinedDecimal) : '--'} accent={C.cyan} />
          <StatBlock label={t.stats.breakEven} value={parlayResult ? formatProbability(parlayResult.impliedProbability) : '--'} accent={C.green} />
          <StatBlock label={t.stats.totalReturn} value={parlayPayout ? formatMoney(parlayPayout.totalReturn) : '--'} accent={C.accent} />
        </Box>

        {!parlayResult && (
          <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.textMuted, mt: 1.5 }}>
            {t.parlay.invalid}
          </Typography>
        )}
      </Box>

      <Box sx={panelSx}>
        <SectionHeader eyebrow={t.reference.eyebrow} title={t.reference.title} subtitle={t.reference.subtitle} />
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t.fields.american}</TableCell>
              <TableCell>{t.fields.decimal}</TableCell>
              <TableCell>{t.fields.fractional}</TableCell>
              <TableCell>{t.fields.probability}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {REFERENCE_AMERICAN.map(american => {
              const converted = convertOddsFrom('american', String(american));
              return (
                <TableRow key={american}>
                  <TableCell>{formatByType('american', american)}</TableCell>
                  <TableCell>{converted?.decimal ?? '--'}</TableCell>
                  <TableCell>{converted?.fractional ?? '--'}</TableCell>
                  <TableCell>{converted?.probability ?? '--'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}
