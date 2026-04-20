import pool from '../db.js';
import { publishQueueItemToX } from './xPublisher.js';

const ALLOWED_STATUSES = new Set(['draft', 'approved', 'scheduled', 'published', 'failed']);

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toJson(value, fallback) {
  if (value == null) return fallback;
  return JSON.stringify(value);
}

function normalizeStatus(value, fallback = 'draft') {
  const status = String(value ?? fallback).trim().toLowerCase();
  return ALLOWED_STATUSES.has(status) ? status : fallback;
}

function normalizeDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function rowToQueueItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    lang: row.lang,
    status: row.status,
    publish_target: row.publish_target,
    title: row.title,
    format: row.format,
    posts: typeof row.posts === 'string' ? JSON.parse(row.posts) : row.posts,
    hashtags: typeof row.hashtags === 'string' ? JSON.parse(row.hashtags) : row.hashtags,
    cta: row.cta,
    visual_brief: row.visual_brief,
    compliance_notes: typeof row.compliance_notes === 'string' ? JSON.parse(row.compliance_notes) : row.compliance_notes,
    source_refs: typeof row.source_refs === 'string' ? JSON.parse(row.source_refs) : row.source_refs,
    source_snapshot: typeof row.source_snapshot === 'string' ? JSON.parse(row.source_snapshot) : row.source_snapshot,
    generated_with: row.generated_with,
    scheduled_for: row.scheduled_for,
    approved_at: row.approved_at,
    published_at: row.published_at,
    publish_result: typeof row.publish_result === 'string' ? JSON.parse(row.publish_result) : row.publish_result,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    approved_by: row.approved_by,
  };
}

export async function queueContentDraft({ draft, userId, publishTarget = 'x', scheduledFor = null }) {
  const normalizedScheduledFor = normalizeDateTime(scheduledFor);
  const initialStatus = normalizedScheduledFor ? 'scheduled' : 'draft';

  const { rows } = await pool.query(
    `INSERT INTO content_queue (
       type, lang, status, publish_target, title, format, posts, hashtags, cta,
       visual_brief, compliance_notes, source_refs, source_snapshot, generated_with,
       scheduled_for, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16)
     RETURNING *`,
    [
      cleanText(draft.type),
      cleanText(draft.lang || 'es'),
      initialStatus,
      cleanText(publishTarget || 'x'),
      cleanText(draft.title),
      cleanText(draft.format || 'single_post'),
      toJson(draft.posts ?? [], '[]'),
      toJson(draft.hashtags ?? [], '[]'),
      cleanText(draft.cta),
      cleanText(draft.visual_brief),
      toJson(draft.compliance_notes ?? [], '[]'),
      toJson(draft.source_refs ?? [], '[]'),
      toJson(draft.source_snapshot ?? {}, '{}'),
      cleanText(draft.generated_with || 'unknown'),
      normalizedScheduledFor,
      userId ?? null,
    ]
  );

  return rowToQueueItem(rows[0]);
}

export async function listQueuedContent({ status = null, limit = 30 } = {}) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);

  if (status && normalizeStatus(status, '__invalid__') !== '__invalid__') {
    const { rows } = await pool.query(
      `SELECT * FROM content_queue
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [normalizeStatus(status), normalizedLimit]
    );
    return rows.map(rowToQueueItem);
  }

  const { rows } = await pool.query(
    `SELECT * FROM content_queue
     ORDER BY created_at DESC
     LIMIT $1`,
    [normalizedLimit]
  );
  return rows.map(rowToQueueItem);
}

export async function getQueueItem(id) {
  const { rows } = await pool.query('SELECT * FROM content_queue WHERE id = $1', [id]);
  return rowToQueueItem(rows[0]);
}

export async function approveQueuedContent({ id, userId }) {
  const { rows } = await pool.query(
    `UPDATE content_queue
     SET status = 'approved',
         approved_at = NOW(),
         approved_by = $2,
         updated_at = NOW(),
         last_error = NULL
     WHERE id = $1
     RETURNING *`,
    [id, userId ?? null]
  );
  return rowToQueueItem(rows[0]);
}

export async function scheduleQueuedContent({ id, userId, scheduledFor }) {
  const normalizedScheduledFor = normalizeDateTime(scheduledFor);
  if (!normalizedScheduledFor) {
    const err = new Error('scheduledFor must be a valid datetime');
    err.code = 'INVALID_SCHEDULE';
    throw err;
  }

  const { rows } = await pool.query(
    `UPDATE content_queue
     SET status = 'scheduled',
         approved_at = COALESCE(approved_at, NOW()),
         approved_by = COALESCE(approved_by, $3),
         scheduled_for = $2,
         updated_at = NOW(),
         last_error = NULL
     WHERE id = $1
     RETURNING *`,
    [id, normalizedScheduledFor, userId ?? null]
  );
  return rowToQueueItem(rows[0]);
}

async function markPublishResult({ id, status, publishResult = null, error = null }) {
  const { rows } = await pool.query(
    `UPDATE content_queue
     SET status = $2::varchar(20),
         published_at = CASE WHEN $2::varchar(20) = 'published' THEN NOW() ELSE published_at END,
         publish_result = COALESCE($3::jsonb, publish_result),
         last_error = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, status, publishResult ? JSON.stringify(publishResult) : null, error ? cleanText(error) : null]
  );
  return rowToQueueItem(rows[0]);
}

export async function publishQueuedContent({ id }) {
  const item = await getQueueItem(id);
  if (!item) {
    const err = new Error('Queue item not found');
    err.code = 'QUEUE_NOT_FOUND';
    throw err;
  }

  try {
    const publishResult = await publishQueueItemToX(item);
    return await markPublishResult({ id, status: 'published', publishResult });
  } catch (err) {
    await markPublishResult({ id, status: 'failed', error: err.message });
    throw err;
  }
}

export async function processScheduledContentQueue() {
  const { rows } = await pool.query(
    `SELECT * FROM content_queue
     WHERE status = 'scheduled'
       AND publish_target = 'x'
       AND scheduled_for IS NOT NULL
       AND scheduled_for <= NOW()
     ORDER BY scheduled_for ASC
     LIMIT 10`
  );

  const results = [];
  for (const row of rows) {
    try {
      const published = await publishQueuedContent({ id: row.id });
      results.push({ id: row.id, status: 'published', item: published });
    } catch (err) {
      results.push({ id: row.id, status: 'failed', error: err.message });
    }
  }

  return results;
}
