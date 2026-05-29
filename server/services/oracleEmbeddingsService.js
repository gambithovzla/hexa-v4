/**
 * oracleEmbeddingsService.js — pgvector RAG for oracle reports (A3).
 *
 * Embeds oracle_report text via OpenAI text-embedding-3-small and stores
 * vectors in pick_embeddings. Before analyzing a game, context-builder
 * retrieves the 5 most similar past analyses via cosine similarity.
 *
 * Requires:
 *   - pgvector extension in Postgres (migration degrades gracefully if absent)
 *   - OPENAI_EMBED_API_KEY env var (service is a no-op if not set)
 *
 * Table: pick_embeddings (pick_id UNIQUE, embedding vector(1536), model, embedded_at)
 */

import pool from '../db.js';

const EMBED_MODEL = 'text-embedding-3-small';
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const MAX_INPUT_CHARS = 8000;

export function isEmbeddingsConfigured() {
  return Boolean(process.env.OPENAI_EMBED_API_KEY);
}

async function callEmbeddingApi(text) {
  const resp = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_EMBED_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, MAX_INPUT_CHARS) }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`OpenAI embeddings ${resp.status}: ${body.slice(0, 120)}`);
  }
  const json = await resp.json();
  return json.data[0].embedding;
}

export async function embedOracleReport(pickId, oracleReport) {
  if (!isEmbeddingsConfigured() || !oracleReport) return null;
  try {
    const embedding = await callEmbeddingApi(oracleReport);
    await pool.query(
      `INSERT INTO pick_embeddings (pick_id, embedding, model)
       VALUES ($1, $2::vector, $3)
       ON CONFLICT (pick_id) DO UPDATE
         SET embedding = $2::vector, model = $3, embedded_at = NOW()`,
      [pickId, JSON.stringify(embedding), EMBED_MODEL],
    );
    return embedding;
  } catch (err) {
    console.warn(`[embeddings] embed pick ${pickId} failed: ${err.message}`);
    return null;
  }
}

/**
 * Find past oracle analyses similar to a query text (team names + pitchers).
 * Returns up to `limit` rows with similarity score and pick summary.
 */
export async function findSimilarAnalyses(queryText, { excludeGamePk = null, limit = 5 } = {}) {
  if (!isEmbeddingsConfigured() || !queryText) return [];
  try {
    const queryEmbedding = await callEmbeddingApi(queryText);
    const { rows } = await pool.query(
      `SELECT
         p.id, p.pick, p.matchup, p.game_date::date AS game_date,
         p.oracle_confidence, p.result, p.oracle_report,
         ROUND((1 - (pe.embedding <=> $1::vector))::numeric, 4) AS similarity
       FROM pick_embeddings pe
       JOIN picks p ON p.id = pe.pick_id
       WHERE p.oracle_report IS NOT NULL
         AND p.result IS NOT NULL AND p.result != 'pending'
         AND ($2::int IS NULL OR p.game_pk != $2)
       ORDER BY pe.embedding <=> $1::vector
       LIMIT $3`,
      [JSON.stringify(queryEmbedding), excludeGamePk ?? null, limit],
    );
    return rows;
  } catch (err) {
    console.warn(`[embeddings] similarity search failed: ${err.message}`);
    return [];
  }
}

/**
 * Build a compact "SIMILAR PAST ANALYSES" context block for the oracle prompt.
 * Returns null when RAG is unconfigured or no similar analyses exist.
 */
export async function buildSimilarAnalysesBlock(homeTeam, awayTeam, gamePk) {
  if (!isEmbeddingsConfigured()) return null;
  const queryText = `MLB game: ${homeTeam} vs ${awayTeam}`;
  const similar = await findSimilarAnalyses(queryText, { excludeGamePk: gamePk, limit: 4 });
  if (similar.length === 0) return null;

  const lines = similar.map((r) => {
    const conf = r.oracle_confidence != null ? ` (${Math.round(r.oracle_confidence * 100)}% conf)` : '';
    const sim = r.similarity != null ? ` [sim:${r.similarity}]` : '';
    return `  • ${r.game_date} ${r.matchup} → ${r.pick}${conf} → ${(r.result ?? 'pending').toUpperCase()}${sim}`;
  });

  return `\n\n## SIMILAR PAST ANALYSES (RAG — most similar oracle calls by team/context)\n${lines.join('\n')}\nUse these ONLY as calibration signal, not as a bet decision.`;
}

/** Background job: embed picks that have oracle_report but no embedding. */
export async function embedPendingPicks(batchSize = 20) {
  if (!isEmbeddingsConfigured()) return { skipped: true };
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.oracle_report
       FROM picks p
       LEFT JOIN pick_embeddings pe ON pe.pick_id = p.id
       WHERE pe.pick_id IS NULL
         AND p.oracle_report IS NOT NULL
         AND p.oracle_report != ''
       ORDER BY p.created_at DESC
       LIMIT $1`,
      [batchSize],
    );
    let embedded = 0;
    let failed = 0;
    for (const row of rows) {
      const ok = await embedOracleReport(row.id, row.oracle_report);
      if (ok) embedded++; else failed++;
    }
    return { embedded, failed, total: rows.length };
  } catch (err) {
    console.error(`[embeddings] embedPendingPicks failed: ${err.message}`);
    return { error: err.message };
  }
}

export async function getEmbeddingsStats() {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM picks) AS total_picks,
        (SELECT COUNT(*)::int FROM pick_embeddings) AS embedded,
        (SELECT COUNT(*)::int FROM picks
         WHERE oracle_report IS NOT NULL AND oracle_report != '') AS eligible
    `);
    return { ...rows[0], configured: isEmbeddingsConfigured(), model: EMBED_MODEL };
  } catch {
    return { configured: isEmbeddingsConfigured(), model: EMBED_MODEL, error: 'stats_unavailable' };
  }
}
