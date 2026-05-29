/**
 * jobQueueService.js — Postgres-backed async job queue (B7).
 *
 * A lightweight alternative to BullMQ + Redis that runs entirely on the
 * existing Postgres database. Handles deduplication, retries, priority,
 * and scheduled execution without additional infrastructure.
 *
 * Usage:
 *   await enqueueJob('embed_picks', {}, { dedupe: true });
 *   // in a worker loop:
 *   const job = await dequeueJob(['embed_picks', 'newsletter_send']);
 *   if (job) { ... await markJobDone(job.id); }
 *
 * Table: job_queue — see database/migrations/002_job_queue.sql
 */

import pool from '../db.js';

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Enqueue a job.
 * @param {string} type - job type key
 * @param {object} payload - job data
 * @param {object} opts
 * @param {boolean} opts.dedupe - skip if a pending job of this type exists
 * @param {number} opts.priority - higher = runs sooner (default 0)
 * @param {Date|null} opts.scheduledAt - run no earlier than this time
 * @param {number} opts.maxAttempts
 * @returns {Promise<number|null>} job id, or null if deduped
 */
export async function enqueueJob(type, payload = {}, opts = {}) {
  const { dedupe = false, priority = 0, scheduledAt = null, maxAttempts = DEFAULT_MAX_ATTEMPTS } = opts;
  if (dedupe) {
    const { rows } = await pool.query(
      `SELECT id FROM job_queue WHERE type = $1 AND status = 'pending' LIMIT 1`,
      [type],
    );
    if (rows.length > 0) return null;
  }
  const { rows } = await pool.query(
    `INSERT INTO job_queue (type, payload, priority, scheduled_at, max_attempts)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [type, JSON.stringify(payload), priority, scheduledAt ?? new Date(), maxAttempts],
  );
  return rows[0].id;
}

/**
 * Atomically claim the next available job of the given type(s).
 * Uses FOR UPDATE SKIP LOCKED so multiple workers don't collide.
 */
export async function dequeueJob(types) {
  const typeList = Array.isArray(types) ? types : [types];
  const placeholders = typeList.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE job_queue
     SET status = 'running', run_at = NOW(), attempts = attempts + 1
     WHERE id = (
       SELECT id FROM job_queue
       WHERE status = 'pending'
         AND type = ANY(ARRAY[${placeholders}]::varchar[])
         AND scheduled_at <= NOW()
       ORDER BY priority DESC, scheduled_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    typeList,
  );
  return rows[0] ?? null;
}

export async function markJobDone(jobId) {
  await pool.query(
    `UPDATE job_queue SET status = 'done', done_at = NOW() WHERE id = $1`,
    [jobId],
  );
}

export async function markJobFailed(jobId, error) {
  await pool.query(
    `UPDATE job_queue
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         error = $2,
         scheduled_at = NOW() + INTERVAL '5 minutes'
     WHERE id = $1`,
    [jobId, String(error ?? '').slice(0, 500)],
  );
}

export async function getJobQueueStats({ limit = 50 } = {}) {
  const [summary, recent] = await Promise.all([
    pool.query(
      `SELECT type, status, COUNT(*)::int AS count
       FROM job_queue
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY type, status
       ORDER BY type, status`,
    ),
    pool.query(
      `SELECT id, type, status, attempts, scheduled_at, run_at, done_at, error, created_at
       FROM job_queue
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    ),
  ]);
  return { summary: summary.rows, recent: recent.rows };
}

/** Purge completed/failed jobs older than retentionDays. */
export async function purgeOldJobs(retentionDays = 7) {
  const { rowCount } = await pool.query(
    `DELETE FROM job_queue
     WHERE status IN ('done', 'failed')
       AND created_at < NOW() - ($1 || ' days')::interval`,
    [retentionDays],
  );
  return rowCount;
}
