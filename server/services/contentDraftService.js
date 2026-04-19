import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import pool from '../db.js';
import { buildHexaBoard } from './hexaBoardService.js';
import { computePublicStats } from './public-stats.js';
import { toInsightDTO, toPickDTO, toPostmortemDTO } from '../routes/content-dto.js';
import { CONTENT_DRAFT_SYSTEM_PROMPT, buildContentDraftUserPrompt } from '../prompts/x-content-prompts.js';

dotenv.config();

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const CONTENT_MODEL = process.env.CONTENT_DRAFT_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1400;

const SUPPORTED_TYPES = ['pick_of_day', 'thread_daily', 'postmortem', 'weekly_recap'];

const PICK_COLUMNS = `
  id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
  oracle_report, hexa_hunch, alert_flags, best_pick, model, language,
  result, odds_at_pick, game_pk, game_date, created_at,
  postmortem, postmortem_summary, postmortem_generated_at
`;

function normalizeDateInput(value) {
  if (!value) return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function normalizeLang(value) {
  return String(value ?? 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
}

function normalizeType(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!SUPPORTED_TYPES.includes(normalized)) {
    const err = new Error(`Unsupported content type "${value}"`);
    err.code = 'INVALID_CONTENT_TYPE';
    throw err;
  }
  return normalized;
}

function getWeekStart(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clipText(value, max = 220) {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function extractRawText(response) {
  return (response?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function cleanJsonResponse(text) {
  if (!text) return text;
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function tryParseJson(raw) {
  if (!raw) return null;
  const cleaned = cleanJsonResponse(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeStringArray(value, maxItems = 6, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeDraftPayload(payload, { type, lang }) {
  const format = String(payload?.format ?? '').trim().toLowerCase() === 'thread'
    ? 'thread'
    : 'single_post';
  return {
    type,
    lang,
    title: clipText(payload?.title ?? 'HEXA Draft', 80),
    format,
    posts: normalizeStringArray(payload?.posts, format === 'thread' ? 6 : 3),
    hashtags: normalizeStringArray(payload?.hashtags, 6),
    cta: clipText(payload?.cta ?? '', 120),
    visual_brief: clipText(payload?.visual_brief ?? '', 180),
    compliance_notes: normalizeStringArray(payload?.compliance_notes, 4),
  };
}

async function fetchPicksForDate(date, limit = 5) {
  const { rows } = await pool.query(
    `SELECT ${PICK_COLUMNS}
     FROM picks
     WHERE deleted_at IS NULL
       AND game_date = $1
     ORDER BY oracle_confidence DESC NULLS LAST, created_at DESC
     LIMIT $2`,
    [date, limit]
  );
  return rows.map(toPickDTO);
}

async function fetchRecentResolvedPicks({ fromDate, limit = 6 }) {
  const { rows } = await pool.query(
    `SELECT ${PICK_COLUMNS}
     FROM picks
     WHERE deleted_at IS NULL
       AND game_date >= $1
       AND LOWER(result) IN ('won', 'lost', 'push', 'win', 'loss')
     ORDER BY game_date DESC, created_at DESC
     LIMIT $2`,
    [fromDate, limit]
  );
  return rows.map(toPickDTO);
}

async function fetchInsightsForWeek(weekStart, limit = 6) {
  const { rows } = await pool.query(
    `SELECT id, type, title, explanation, pick_id, week_start, created_at
     FROM hexa_insights
     WHERE deleted_at IS NULL
       AND week_start = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [weekStart, limit]
  );
  return rows.map(toInsightDTO);
}

async function fetchLatestInsights(limit = 6) {
  const { rows } = await pool.query(
    `SELECT id, type, title, explanation, pick_id, week_start, created_at
     FROM hexa_insights
     WHERE deleted_at IS NULL
     ORDER BY week_start DESC, created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(toInsightDTO);
}

async function fetchPostmortemCandidate({ pickId = null }) {
  if (pickId != null) {
    const { rows } = await pool.query(
      `SELECT id, matchup, pick, result, game_date,
              postmortem, postmortem_summary, postmortem_generated_at
       FROM picks
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [pickId]
    );
    return rows[0] ? toPostmortemDTO(rows[0]) : null;
  }

  const { rows } = await pool.query(
    `SELECT id, matchup, pick, result, game_date,
            postmortem, postmortem_summary, postmortem_generated_at
     FROM picks
     WHERE deleted_at IS NULL
       AND (postmortem IS NOT NULL OR postmortem_summary IS NOT NULL)
     ORDER BY postmortem_generated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`
  );
  return rows[0] ? toPostmortemDTO(rows[0]) : null;
}

function pickSummary(pick) {
  if (!pick) return null;
  return {
    id: pick.id,
    matchup: pick.matchup,
    pick: pick.pick,
    confidence: pick.oracle_confidence,
    bet_value: pick.bet_value,
    risk: pick.model_risk,
    model: pick.model,
    result: pick.result ?? null,
    report_excerpt: clipText(pick.oracle_report, 220),
    hunch: clipText(pick.hexa_hunch, 120),
  };
}

function insightSummary(insight) {
  if (!insight) return null;
  return {
    id: insight.id,
    type: insight.type,
    title: insight.title,
    explanation: clipText(insight.explanation, 220),
    week_start: insight.week_start,
  };
}

function boardSummary(board, lang) {
  if (!board) return null;
  return {
    date: board.date,
    total_games: board.totalGames ?? 0,
    teams_analyzed: board.teamsAnalyzed ?? 0,
    top_signals: Array.isArray(board.insights)
      ? board.insights.slice(0, 5).map((signal) => ({
          type: signal.type,
          text: cleanText(signal.text?.[lang] ?? signal.text?.en ?? ''),
          priority: signal.priority ?? 0,
        }))
      : [],
  };
}

function performanceSummary(stats, period) {
  if (!stats) return null;
  return {
    period,
    total_picks: stats.totalPicks ?? 0,
    wins: stats.wins ?? 0,
    losses: stats.losses ?? 0,
    pushes: stats.pushes ?? 0,
    win_rate: stats.winRate ?? 0,
    roi: stats.roi ?? 0,
    unit_profit: stats.unitProfit ?? 0,
    roi_sample_size: stats.roiSampleSize ?? 0,
  };
}

function postmortemSummary(postmortem) {
  if (!postmortem) return null;
  return {
    pick_id: postmortem.pick_id,
    matchup: postmortem.matchup,
    pick: postmortem.pick,
    result: postmortem.result,
    game_date: postmortem.game_date,
    summary: clipText(postmortem.summary, 220),
    key_factors: normalizeStringArray(postmortem.key_factors, 4),
    what_hexa_got_right: normalizeStringArray(postmortem.what_hexa_got_right, 3),
    what_hexa_missed: normalizeStringArray(postmortem.what_hexa_missed, 3),
  };
}

function buildSourceRefs(snapshot) {
  const refs = [];

  for (const pick of snapshot.picks ?? []) {
    refs.push({ kind: 'pick', id: pick.id, label: `${pick.matchup} - ${pick.pick}` });
  }
  for (const insight of snapshot.insights ?? []) {
    refs.push({ kind: 'insight', id: insight.id, label: insight.title });
  }
  if (snapshot.postmortem?.pick_id) {
    refs.push({
      kind: 'postmortem',
      id: snapshot.postmortem.pick_id,
      label: `${snapshot.postmortem.matchup} - ${snapshot.postmortem.pick}`,
    });
  }
  if (snapshot.performance_7d) refs.push({ kind: 'performance', id: '7d', label: 'Performance 7d' });
  if (snapshot.performance_30d) refs.push({ kind: 'performance', id: '30d', label: 'Performance 30d' });
  if (snapshot.board?.date) refs.push({ kind: 'board', id: snapshot.board.date, label: `Board ${snapshot.board.date}` });

  return refs;
}

function buildFallbackDraft({ type, lang, snapshot, warnings }) {
  const isEs = lang === 'es';
  const topPick = snapshot.picks?.[0] ?? null;
  const topSignal = snapshot.board?.top_signals?.[0] ?? null;
  const performance7d = snapshot.performance_7d ?? null;
  const postmortem = snapshot.postmortem ?? null;

  if (type === 'pick_of_day') {
    const post = topPick
      ? (isEs
          ? `Pick del dia HEXA: ${topPick.pick} en ${topPick.matchup}. Confianza ${topPick.confidence ?? 'N/D'}%. ${topPick.bet_value || 'Lectura fuerte'} segun el tablero de hoy. Mira el desglose completo dentro de HEXA antes del primer pitch.`
          : `HEXA pick of the day: ${topPick.pick} in ${topPick.matchup}. Confidence ${topPick.confidence ?? 'N/A'}%. ${topPick.bet_value || 'Strong read'} from today's board. Check HEXA for the full breakdown before first pitch.`)
      : (isEs
          ? `Radar HEXA del dia: ${topSignal?.text || 'sin pick publicado aun'}. Revisa la pizarra y los analisis dentro de HEXA para ver donde esta el mejor edge del slate.`
          : `HEXA radar today: ${topSignal?.text || 'no official pick posted yet'}. Check the board and in-app analysis to see where the best edge sits on the slate.`);

    return {
      type,
      lang,
      title: isEs ? 'Pick del dia' : 'Pick of the day',
      format: 'single_post',
      posts: [clipText(post, 280)],
      hashtags: isEs ? ['#MLB', '#Beisbol', '#HEXA'] : ['#MLB', '#Baseball', '#HEXA'],
      cta: isEs ? 'Abre HEXA para ver el razonamiento completo.' : 'Open HEXA for the full reasoning.',
      visual_brief: isEs ? 'Grafica limpia con matchup, pick principal y confianza HEXA.' : 'Clean card with matchup, main pick, and HEXA confidence.',
      compliance_notes: warnings.length ? warnings : [isEs ? 'No prometer ganancias ni locks.' : 'Do not imply guaranteed profit or locks.'],
    };
  }

  if (type === 'postmortem') {
    const posts = postmortem
      ? [
          isEs
            ? `Postmortem HEXA: ${postmortem.pick} en ${postmortem.matchup}. Resultado: ${postmortem.result || 'cerrado'}.`
            : `HEXA postmortem: ${postmortem.pick} in ${postmortem.matchup}. Result: ${postmortem.result || 'settled'}.`,
          isEs
            ? `${postmortem.summary || 'La revision confirma que hubo una senal valida, pero el juego giro por detalles concretos del desarrollo.'}`
            : `${postmortem.summary || 'The review shows there was a valid signal, but the game turned on concrete execution details.'}`,
        ]
      : [
          isEs
            ? 'Postmortem HEXA: aun no hay un reporte resuelto disponible para este corte.'
            : 'HEXA postmortem: there is no resolved report available yet for this cut.',
        ];

    return {
      type,
      lang,
      title: isEs ? 'Postmortem' : 'Postmortem',
      format: posts.length > 1 ? 'thread' : 'single_post',
      posts: posts.map((post) => clipText(post, 280)),
      hashtags: ['#HEXA', '#MLB'],
      cta: isEs ? 'HEXA tambien revisa en frio sus picks cerrados.' : 'HEXA also reviews settled picks honestly.',
      visual_brief: isEs ? 'Antes/despues del pick con resultado final y una leccion clave.' : 'Before/after pick card with final result and one key lesson.',
      compliance_notes: warnings.length ? warnings : [isEs ? 'Mantener tono honesto, no defensivo.' : 'Keep the tone honest, not defensive.'],
    };
  }

  if (type === 'weekly_recap') {
    const posts = [
      isEs
        ? `Resumen semanal HEXA: ${performance7d?.wins ?? 0}-${performance7d?.losses ?? 0}-${performance7d?.pushes ?? 0}, win rate ${performance7d?.win_rate ?? 0}% y ROI ${performance7d?.roi ?? 0}% en ${performance7d?.roi_sample_size ?? performance7d?.total_picks ?? 0} picks.`
        : `HEXA weekly recap: ${performance7d?.wins ?? 0}-${performance7d?.losses ?? 0}-${performance7d?.pushes ?? 0}, ${performance7d?.win_rate ?? 0}% win rate and ${performance7d?.roi ?? 0}% ROI across ${performance7d?.roi_sample_size ?? performance7d?.total_picks ?? 0} picks.`,
      isEs
        ? `${topSignal?.text || 'La pizarra sigue marcando donde el mercado deja huecos claros.'}`
        : `${topSignal?.text || 'The board keeps showing where the market leaves clear gaps.'}`,
      isEs
        ? 'La meta no es forzar accion todos los dias; es esperar spots con contexto y edge real.'
        : 'The goal is not forcing action every day; it is waiting for spots with context and real edge.',
    ];
    return {
      type,
      lang,
      title: isEs ? 'Resumen semanal' : 'Weekly recap',
      format: 'thread',
      posts: posts.map((post) => clipText(post, 280)),
      hashtags: ['#HEXA', '#MLB', '#SportsBetting'],
      cta: isEs ? 'Seguimos afinando la lectura para la proxima semana.' : 'We keep tuning the read for next week.',
      visual_brief: isEs ? 'Carrusel o hilo con win rate, ROI, units y takeaway principal.' : 'Carousel or thread with win rate, ROI, units, and top takeaway.',
      compliance_notes: warnings.length ? warnings : [isEs ? 'Usar resultados reales y muestra visible.' : 'Use real results and visible sample size.'],
    };
  }

  const threadPosts = [];
  if (topPick) {
    threadPosts.push(
      isEs
        ? `Slate HEXA del dia: ${topPick.pick} lidera el tablero con ${topPick.confidence ?? 'N/D'}% de confianza en ${topPick.matchup}.`
        : `Today's HEXA slate: ${topPick.pick} leads the board at ${topPick.confidence ?? 'N/A'}% confidence in ${topPick.matchup}.`
    );
  }
  if (snapshot.picks?.[1]) {
    threadPosts.push(
      isEs
        ? `Otra lectura fuerte: ${snapshot.picks[1].pick} en ${snapshot.picks[1].matchup}.`
        : `Another strong read: ${snapshot.picks[1].pick} in ${snapshot.picks[1].matchup}.`
    );
  }
  if (topSignal) {
    threadPosts.push(topSignal.text);
  }
  threadPosts.push(
    isEs
      ? 'La idea no es tirar volumen: es atacar los spots donde datos, contexto y mercado se alinean.'
      : 'The point is not volume: it is attacking the spots where data, context, and market line up.'
  );

  return {
    type,
    lang,
    title: isEs ? 'Thread diario' : 'Daily thread',
    format: 'thread',
    posts: threadPosts.map((post) => clipText(post, 280)),
    hashtags: ['#HEXA', '#MLB'],
    cta: isEs ? 'Si quieres el razonamiento completo, revisa HEXA.' : 'If you want the full reasoning, check HEXA.',
    visual_brief: isEs ? 'Hilo editorial con 3-4 bloques: top pick, apoyo, insight y CTA.' : 'Editorial thread with 3-4 blocks: top pick, support, insight, CTA.',
    compliance_notes: warnings.length ? warnings : [isEs ? 'Evitar lenguaje de certeza absoluta.' : 'Avoid absolute certainty language.'],
  };
}

async function buildSourceSnapshot({ type, date, lang, pickId = null }) {
  const warnings = [];
  const weekStart = getWeekStart(date);
  const [board, performance7d, performance30d, picksToday, latestInsights] = await Promise.all([
    buildHexaBoard({ date }).catch(() => null),
    computePublicStats('7').catch(() => null),
    computePublicStats('30').catch(() => null),
    fetchPicksForDate(date, type === 'thread_daily' ? 4 : 3).catch(() => []),
    fetchLatestInsights(5).catch(() => []),
  ]);

  const snapshot = {
    type,
    date,
    lang,
    board: boardSummary(board, lang),
    performance_7d: performanceSummary(performance7d, '7'),
    performance_30d: performanceSummary(performance30d, '30'),
    picks: picksToday.map(pickSummary).filter(Boolean),
    insights: latestInsights.map(insightSummary).filter(Boolean),
  };

  if (type === 'postmortem') {
    snapshot.postmortem = postmortemSummary(await fetchPostmortemCandidate({ pickId }));
    if (!snapshot.postmortem) warnings.push(lang === 'es' ? 'No habia postmortem persistido; se uso contexto limitado.' : 'No persisted postmortem was available; limited context was used.');
  }

  if (type === 'weekly_recap') {
    const [weekInsights, recentResolvedPicks] = await Promise.all([
      fetchInsightsForWeek(weekStart, 6).catch(() => []),
      fetchRecentResolvedPicks({ fromDate: weekStart, limit: 6 }).catch(() => []),
    ]);
    snapshot.week_start = weekStart;
    snapshot.insights = (weekInsights.length ? weekInsights : latestInsights).map(insightSummary).filter(Boolean);
    snapshot.resolved_picks = recentResolvedPicks.map(pickSummary).filter(Boolean);
    if (!weekInsights.length) {
      warnings.push(lang === 'es' ? 'No hubo insights semanales; se usaron los mas recientes.' : 'No weekly insights were found; latest insights were used instead.');
    }
  }

  if (type === 'pick_of_day' && snapshot.picks.length === 0) {
    warnings.push(lang === 'es' ? 'No hay picks guardados para esa fecha; se uso la pizarra del dia.' : 'No saved picks were found for that date; the daily board was used instead.');
  }

  if (type === 'thread_daily' && snapshot.picks.length < 2) {
    warnings.push(lang === 'es' ? 'Hay pocos picks publicados para esa fecha; el hilo mezcla board y performance.' : 'There are only a few picks for that date; the thread mixes board and performance.');
  }

  return { snapshot, warnings };
}

async function generateWithAnthropic({ type, lang, date, sourceSnapshot }) {
  if (!anthropic) {
    const err = new Error('Anthropic content draft model unavailable');
    err.code = 'MODEL_UNAVAILABLE';
    throw err;
  }

  const response = await anthropic.messages.create({
    model: CONTENT_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0.6,
    system: CONTENT_DRAFT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: buildContentDraftUserPrompt({ type, lang, date, sourceSnapshot }),
    }],
  });

  const raw = extractRawText(response);
  const parsed = tryParseJson(raw);
  if (!parsed) {
    const err = new Error('Invalid JSON from content draft model');
    err.code = 'INVALID_MODEL_JSON';
    err.rawPreview = raw.slice(0, 200);
    throw err;
  }

  return {
    draft: normalizeDraftPayload(parsed, { type, lang }),
    usage: response.usage ?? null,
  };
}

export function getSupportedContentTypes() {
  return [...SUPPORTED_TYPES];
}

export async function generateContentDraft({ type, date, lang = 'es', pickId = null }) {
  const normalizedType = normalizeType(type);
  const normalizedDate = normalizeDateInput(date);
  const normalizedLang = normalizeLang(lang);
  const { snapshot, warnings } = await buildSourceSnapshot({
    type: normalizedType,
    date: normalizedDate,
    lang: normalizedLang,
    pickId,
  });

  try {
    const { draft, usage } = await generateWithAnthropic({
      type: normalizedType,
      lang: normalizedLang,
      date: normalizedDate,
      sourceSnapshot: snapshot,
    });

    return {
      ...draft,
      generated_with: CONTENT_MODEL,
      usage,
      warnings,
      source_refs: buildSourceRefs(snapshot),
      source_snapshot: snapshot,
    };
  } catch (err) {
    console.warn('[content-draft] model generation failed, using fallback:', err.message);
    return {
      ...buildFallbackDraft({
        type: normalizedType,
        lang: normalizedLang,
        snapshot,
        warnings,
      }),
      generated_with: 'template_fallback',
      usage: null,
      warnings,
      source_refs: buildSourceRefs(snapshot),
      source_snapshot: snapshot,
    };
  }
}
