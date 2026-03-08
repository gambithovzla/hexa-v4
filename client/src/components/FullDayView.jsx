import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Chip,
  Alert, Skeleton, List, ListItem, ListItemText, Divider,
} from '@mui/material';
import WbSunnyIcon from '@mui/icons-material/WbSunny';

const labels = {
  en: {
    title: 'Full Day Slate Analysis',
    analyze: 'Analyze Today\'s Slate',
    analyzing: 'Analyzing…',
    grade: 'Slate Grade',
    topPicks: 'Top Picks',
    avoid: 'Games to Avoid',
    narratives: 'Key Narratives',
  },
  es: {
    title: 'Análisis de Todos los Juegos del Día',
    analyze: 'Analizar Pizarra Completa',
    analyzing: 'Analizando…',
    grade: 'Calificación',
    topPicks: 'Mejores Picks',
    avoid: 'Juegos a Evitar',
    narratives: 'Narrativas Clave',
  },
};

const gradeColor = { A: 'success', B: 'info', C: 'warning', D: 'error', F: 'error' };

export default function FullDayView({ date, language = 'en', onSave }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const t = labels[language] ?? labels.en;

  async function handleAnalyze() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/analyze/full-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, language }),
      });
      const json = await res.json();
      if (json.success) {
        setResult(json.data);
        onSave?.({ type: 'fullday', date, result: json.data, date: new Date().toISOString() });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <WbSunnyIcon color="warning" />
          <Typography variant="h6" fontWeight={700}>{t.title}</Typography>
          <Typography variant="body2" color="text.secondary">({date})</Typography>
        </Box>

        <Button
          variant="contained"
          onClick={handleAnalyze}
          disabled={loading}
          sx={{ mb: 3 }}
        >
          {loading ? t.analyzing : t.analyze}
        </Button>

        {loading && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={28} sx={{ mb: 1 }} />)}

        {result && (
          <>
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Chip label={`${t.grade}: ${result.slateGrade}`} color={gradeColor[result.slateGrade] ?? 'default'} />
            </Box>

            {result.summary && <Alert severity="info" sx={{ mb: 2 }}>{result.summary}</Alert>}

            {result.topPicks?.length > 0 && (
              <>
                <Typography fontWeight={700} gutterBottom>{t.topPicks}</Typography>
                {result.topPicks.map((pick, i) => (
                  <Box key={i} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, mb: 1 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="body2"><strong>{pick.market}</strong> — {pick.pick}</Typography>
                      <Chip label={pick.confidence} size="small" />
                    </Box>
                  </Box>
                ))}
              </>
            )}

            <Divider sx={{ my: 2 }} />

            {result.gamesToAvoid?.length > 0 && (
              <>
                <Typography fontWeight={700} gutterBottom>{t.avoid}</Typography>
                <List dense disablePadding>
                  {result.gamesToAvoid.map((g, i) => (
                    <ListItem key={i} disablePadding>
                      <ListItemText primary={g} primaryTypographyProps={{ variant: 'body2', color: 'error' }} />
                    </ListItem>
                  ))}
                </List>
              </>
            )}

            {result.narratives?.length > 0 && (
              <>
                <Typography fontWeight={700} gutterBottom sx={{ mt: 2 }}>{t.narratives}</Typography>
                {result.narratives.map((n, i) => (
                  <Alert key={i} severity="info" sx={{ mb: 1 }}>{n}</Alert>
                ))}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
