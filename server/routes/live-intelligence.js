import { Router } from 'express';
import {
  getBatchLiveIntelligence,
  getLiveIntelligence,
  getLiveNarrativeForGame,
  getLiveSignals,
  getLiveTimelineForGame,
} from '../live-intelligence-engine.js';

const router = Router();
const MAX_BATCH_SIZE = 20;

function safeError(err) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[live-intelligence]', err.message);
    return 'Internal server error';
  }
  return err.message;
}

function resolveLang(value) {
  return value === 'en' ? 'en' : 'es';
}

router.get('/:gamePk(\\d+)/intelligence', async (req, res) => {
  try {
    const payload = await getLiveIntelligence(req.params.gamePk, {
      lang: resolveLang(req.query.lang),
    });
    return res.json({ success: true, ...payload });
  } catch (err) {
    return res.status(500).json({ success: false, error: safeError(err) });
  }
});

router.get('/:gamePk(\\d+)/signals', async (req, res) => {
  try {
    const data = await getLiveSignals(req.params.gamePk, {
      lang: resolveLang(req.query.lang),
    });
    return res.json({
      success: true,
      gamePk: Number(req.params.gamePk),
      count: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: safeError(err) });
  }
});

router.get('/:gamePk(\\d+)/narrative', async (req, res) => {
  try {
    const data = await getLiveNarrativeForGame(req.params.gamePk, {
      lang: resolveLang(req.query.lang),
    });
    return res.json({
      success: true,
      gamePk: Number(req.params.gamePk),
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: safeError(err) });
  }
});

router.get('/:gamePk(\\d+)/timeline', async (req, res) => {
  try {
    const data = await getLiveTimelineForGame(req.params.gamePk, {
      lang: resolveLang(req.query.lang),
    });
    return res.json({
      success: true,
      gamePk: Number(req.params.gamePk),
      count: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: safeError(err) });
  }
});

router.post('/batch-intelligence', async (req, res) => {
  try {
    const gamePks = Array.isArray(req.body?.gamePks) ? req.body.gamePks : [];
    if (!gamePks.length) {
      return res.status(400).json({ success: false, error: 'gamePks array is required' });
    }
    if (gamePks.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        success: false,
        error: `Maximum ${MAX_BATCH_SIZE} games per request`,
      });
    }

    const data = await getBatchLiveIntelligence(gamePks, {
      lang: resolveLang(req.query.lang),
    });

    return res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: safeError(err) });
  }
});

export default router;
