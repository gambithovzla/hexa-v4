import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, List, ListItemButton,
  ListItemText, Checkbox, Button, Divider, Chip, Alert, Skeleton,
} from '@mui/material';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';

const labels = {
  en: {
    title: 'Parlay Builder',
    selectGames: 'Select games for your parlay',
    selected: 'selected',
    analyze: 'Analyze Parlay',
    analyzing: 'Analyzing…',
    min: 'Select at least 2 games.',
    grade: 'Parlay Grade',
    confidence: 'Overall Confidence',
    legs: 'Legs',
    correlation: 'Correlation Insights',
    risks: 'Risk Flags',
  },
  es: {
    title: 'Constructor de Parlay',
    selectGames: 'Selecciona juegos para tu parlay',
    selected: 'seleccionados',
    analyze: 'Analizar Parlay',
    analyzing: 'Analizando…',
    min: 'Selecciona al menos 2 juegos.',
    grade: 'Calificación del Parlay',
    confidence: 'Confianza General',
    legs: 'Patas',
    correlation: 'Correlaciones',
    risks: 'Alertas de Riesgo',
  },
};

const gradeColor = { A: 'success', B: 'info', C: 'warning', D: 'error', F: 'error' };

export default function ParlayBuilder({ games, language = 'en', onSave }) {
  const [selected, setSelected] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const t = labels[language] ?? labels.en;

  function toggle(game) {
    setSelected(prev =>
      prev.some(g => g.gamePk === game.gamePk)
        ? prev.filter(g => g.gamePk !== game.gamePk)
        : [...prev, game]
    );
  }

  async function handleAnalyze() {
    if (selected.length < 2) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/analyze/parlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameIds: selected.map(g => g.gamePk), language }),
      });
      const json = await res.json();
      if (json.success) {
        setResult(json.data);
        onSave?.({ type: 'parlay', games: selected, result: json.data, date: new Date().toISOString() });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 3 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" fontWeight={700} gutterBottom>{t.title}</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>{t.selectGames}</Typography>
          <Chip label={`${selected.length} ${t.selected}`} size="small" sx={{ mb: 1 }} />
          <Divider sx={{ mb: 1 }} />
          <List dense disablePadding>
            {games.map(game => {
              const isSelected = selected.some(g => g.gamePk === game.gamePk);
              const away = game.teams?.away?.team?.name ?? 'Away';
              const home = game.teams?.home?.team?.name ?? 'Home';
              return (
                <ListItemButton key={game.gamePk} onClick={() => toggle(game)} sx={{ borderRadius: 1 }}>
                  <Checkbox edge="start" checked={isSelected} size="small" />
                  <ListItemText primary={`${away} @ ${home}`} primaryTypographyProps={{ variant: 'body2' }} />
                </ListItemButton>
              );
            })}
          </List>
          <Button
            variant="contained"
            fullWidth
            startIcon={<PlaylistAddIcon />}
            onClick={handleAnalyze}
            disabled={selected.length < 2 || loading}
            sx={{ mt: 2 }}
          >
            {loading ? t.analyzing : selected.length < 2 ? t.min : t.analyze}
          </Button>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          {loading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={28} sx={{ mb: 1 }} />)}
          {!loading && !result && (
            <Typography color="text.secondary">{t.selectGames}</Typography>
          )}
          {result && (
            <>
              <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                <Chip label={`${t.grade}: ${result.parlayGrade}`} color={gradeColor[result.parlayGrade] ?? 'default'} />
                <Chip label={`${t.confidence}: ${result.overallConfidence}`} variant="outlined" />
              </Box>
              {result.summary && <Alert severity="info" sx={{ mb: 2 }}>{result.summary}</Alert>}
              {result.legs?.length > 0 && (
                <>
                  <Typography fontWeight={700} gutterBottom>{t.legs}</Typography>
                  {result.legs.map((leg, i) => (
                    <Box key={i} sx={{ p: 1, border: 1, borderColor: 'divider', borderRadius: 1, mb: 1 }}>
                      <Typography variant="body2"><strong>{leg.market}</strong> — {leg.pick}</Typography>
                      <Chip label={leg.confidence} size="small" sx={{ mt: 0.5 }} />
                    </Box>
                  ))}
                </>
              )}
              {result.correlationInsights?.length > 0 && (
                <>
                  <Typography fontWeight={700} gutterBottom sx={{ mt: 2 }}>{t.correlation}</Typography>
                  {result.correlationInsights.map((c, i) => (
                    <Typography key={i} variant="body2" color="text.secondary">• {c}</Typography>
                  ))}
                </>
              )}
              {result.riskFlags?.length > 0 && (
                <>
                  <Typography fontWeight={700} gutterBottom sx={{ mt: 2 }}>{t.risks}</Typography>
                  {result.riskFlags.map((r, i) => (
                    <Alert key={i} severity="warning" sx={{ mb: 0.5 }}>{r}</Alert>
                  ))}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
