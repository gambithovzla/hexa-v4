import express from 'express';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { generateContentDraft, getSupportedContentTypes } from '../services/contentDraftService.js';
import {
  approveQueuedContent,
  listQueuedContent,
  processScheduledContentQueue,
  publishQueuedContent,
  queueContentDraft,
  scheduleQueuedContent,
} from '../services/contentQueueService.js';

const router = express.Router();

router.use(verifyToken, requireAdmin);

router.get('/types', (_req, res) => {
  res.json({ success: true, data: getSupportedContentTypes() });
});

router.post('/generate', async (req, res) => {
  const { type, date, lang = 'es', pickId = null } = req.body ?? {};

  try {
    const draft = await generateContentDraft({ type, date, lang, pickId });
    return res.json({ success: true, data: draft });
  } catch (err) {
    if (err.code === 'INVALID_CONTENT_TYPE') {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/generate-batch', async (req, res) => {
  const { types = [], date, lang = 'es', pickId = null } = req.body ?? {};
  if (!Array.isArray(types) || types.length === 0) {
    return res.status(400).json({ success: false, error: 'types array is required' });
  }

  try {
    const drafts = await Promise.all(
      types.map((type) => generateContentDraft({ type, date, lang, pickId }))
    );
    return res.json({ success: true, count: drafts.length, data: drafts });
  } catch (err) {
    if (err.code === 'INVALID_CONTENT_TYPE') {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/queue', async (req, res) => {
  try {
    const items = await listQueuedContent({
      status: req.query.status ?? null,
      limit: req.query.limit ?? 30,
    });
    return res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/queue', async (req, res) => {
  const { draft, scheduledFor = null, publishTarget = 'x' } = req.body ?? {};
  if (!draft || typeof draft !== 'object') {
    return res.status(400).json({ success: false, error: 'draft object is required' });
  }

  try {
    const item = await queueContentDraft({
      draft,
      userId: req.user?.id ?? null,
      publishTarget,
      scheduledFor,
    });
    return res.json({ success: true, data: item });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/queue/:id/approve', async (req, res) => {
  try {
    const item = await approveQueuedContent({ id: req.params.id, userId: req.user?.id ?? null });
    if (!item) return res.status(404).json({ success: false, error: 'Queue item not found' });
    return res.json({ success: true, data: item });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/queue/:id/schedule', async (req, res) => {
  try {
    const item = await scheduleQueuedContent({
      id: req.params.id,
      userId: req.user?.id ?? null,
      scheduledFor: req.body?.scheduledFor,
    });
    if (!item) return res.status(404).json({ success: false, error: 'Queue item not found' });
    return res.json({ success: true, data: item });
  } catch (err) {
    const status = err.code === 'INVALID_SCHEDULE' ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/queue/:id/publish', async (req, res) => {
  try {
    const item = await publishQueuedContent({ id: req.params.id });
    return res.json({ success: true, data: item });
  } catch (err) {
    const status = err.code === 'QUEUE_NOT_FOUND' ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

router.post('/queue/run-scheduled', async (_req, res) => {
  try {
    const results = await processScheduledContentQueue();
    return res.json({ success: true, count: results.length, data: results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
