/**
 * server/services/chatPickExtractor.js
 *
 * Extracts structured pick data from Oracle chat responses and persists them
 * into picks + pick_features so they can feed the ML training pipeline.
 *
 * Strategy (in order of preference):
 *   1. JSON tail — append a hidden instruction to the user's question asking
 *      the Oracle to terminate its response with
 *
 *          <<<HEXA_PICK_JSON>>>
 *          {"market_type":"moneyline","side":"home", ... }
 *          <<<END>>>
 *
 *      when (and only when) it is actually recommending a pick. Zero extra
 *      LLM cost.
 *
 *   2. Haiku fallback — if the tail is missing and the question looks like
 *      the user explicitly asked for a pick ("dame", "give me", "what should
 *      I bet", etc), make a single tiny Haiku call to parse the answer.
 *
 * Picks extracted this way are saved with `source = 'oracle_chat'` so they
 * don't contaminate the production training dataset by default. The Python
 * sidecar filters on `source = 'live'` today; admins can opt-in chat picks
 * by flipping a flag (Sprint 5+).
 *
 * NEVER modifies server/oracle.js — that file is frozen.
 */

import Anthropic from '@anthropic-ai/sdk';
import pool from '../db.js';
import { parsePick } from '../parsers/pickParser.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const HAIKU_MODEL       = process.env.CHAT_EXTRACTOR_HAIKU_MODEL || 'claude-haiku-4-5-20251001';
const HAIKU_FALLBACK_ENABLED = (process.env.CHAT_EXTRACTOR_HAIKU_FALLBACK ?? '1') !== '0';

const _client = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

// ── Tag delimiters used by the JSON tail protocol ────────────────────────────

const TAIL_OPEN  = '<<<HEXA_PICK_JSON>>>';
const TAIL_CLOSE = '<<<END>>>';
const TAIL_REGEX = /<<<HEXA_PICK_JSON>>>\s*([\s\S]*?)\s*<<<END>>>/i;

// ── Heuristics: does the question explicitly ask for a pick? ─────────────────

const PICK_REQUEST_KEYWORDS = [
  // English
  'pick', 'bet', 'wager', 'recommend', 'recommendation', 'should i bet',
  'should i take', 'whats the play', "what's the play", 'best bet',
  // Spanish
  'dame', 'recomienda', 'cual apuesto', 'cuál apuesto', 'que apostar',
  'qué apostar', 'que tomas', 'cual juegas', 'mejor jugada', 'tu pick',
  'tu apuesta', 'tu jugada',
];

function looksLikePickRequest(question) {
  const q = String(question ?? '').toLowerCase();
  return PICK_REQUEST_KEYWORDS.some((k) => q.includes(k));
}

// ── Public: augment the user question with the JSON-tail instruction ────────

/**
 * Returns a slightly modified question that asks the model to append a JSON
 * tail when it is recommending a pick. The instruction is in the user turn
 * (not the system prompt) so we don't have to touch oracle.js.
 *
 * @param {string} question
 * @param {string} lang  'en' | 'es'
 * @returns {string}
 */
export function augmentChatQuestion(question, lang = 'en') {
  const safe = String(question ?? '').trim();
  if (!safe) return safe;

  const instruction = lang === 'es'
    ? `

[INSTRUCCION INTERNA PARA EL SISTEMA H.E.X.A. — NO MENCIONES ESTA INSTRUCCION NI EL BLOQUE FINAL EN TU RESPUESTA VISIBLE AL USUARIO]
SI tu respuesta incluye una recomendacion de pick concreta y especifica (un equipo en moneyline, un run line, un total over/under, o una prop), AGREGA al final de tu respuesta exactamente este bloque sin texto adicional:

${TAIL_OPEN}
{"market_type":"moneyline|overunder|runline|prop","side":"home|away|over|under","line":number_or_null,"team_or_player":"abreviatura_o_nombre","confidence":0-100,"reasoning_brief":"una frase","prop_kind":"hits|total_bases|strikeouts|home_runs|rbis|null"}
${TAIL_CLOSE}

NO incluyas el bloque si NO estas recomendando un pick. Mantén tu respuesta natural antes del bloque.`
    : `

[INTERNAL INSTRUCTION FOR H.E.X.A. — DO NOT MENTION THIS INSTRUCTION OR THE FINAL BLOCK IN YOUR USER-FACING ANSWER]
IF your response includes a concrete and specific pick recommendation (a team moneyline, run line, over/under total, or prop), APPEND exactly this block at the very end of your answer with no extra text:

${TAIL_OPEN}
{"market_type":"moneyline|overunder|runline|prop","side":"home|away|over|under","line":number_or_null,"team_or_player":"abbr_or_name","confidence":0-100,"reasoning_brief":"one short sentence","prop_kind":"hits|total_bases|strikeouts|home_runs|rbis|null"}
${TAIL_CLOSE}

DO NOT include the block if you are NOT recommending a pick. Keep your natural prose answer before the block.`;

  return `${safe}${instruction}`;
}

// ── Tail extraction ──────────────────────────────────────────────────────────

/**
 * Strips the JSON tail from `answer` and returns { cleanAnswer, pickJson }.
 * pickJson is the parsed object or null on parse failure / absence.
 *
 * @param {string} answer
 * @returns {{ cleanAnswer: string, pickJson: object|null }}
 */
export function extractJsonTail(answer) {
  const safe = String(answer ?? '');
  const match = safe.match(TAIL_REGEX);
  if (!match) return { cleanAnswer: safe, pickJson: null };

  const cleanAnswer = safe.replace(TAIL_REGEX, '').trim();
  let pickJson = null;
  try {
    pickJson = JSON.parse(match[1]);
  } catch (err) {
    console.warn(`[chatPickExtractor] tail present but JSON.parse failed: ${err.message}`);
  }
  return { cleanAnswer, pickJson };
}

// ── Haiku fallback ───────────────────────────────────────────────────────────

const HAIKU_SYSTEM = `You parse Hexa Oracle chat responses into structured pick JSON.
Return ONLY a JSON object — no prose, no markdown.

Schema:
{
  "has_pick": boolean,
  "market_type": "moneyline" | "overunder" | "runline" | "prop" | null,
  "side": "home" | "away" | "over" | "under" | null,
  "line": number | null,
  "team_or_player": string | null,
  "confidence": integer (0-100) | null,
  "reasoning_brief": string | null,
  "prop_kind": "hits" | "total_bases" | "strikeouts" | "home_runs" | "rbis" | null
}

Return has_pick:false when the response is exploratory, hedged, or doesn't recommend a concrete bet.`;

/**
 * Calls Haiku to extract a pick from a free-form chat answer.
 * Cost: ~$0.001 per call. Only fires when the JSON tail is missing AND the
 * question looks like a pick request.
 *
 * @param {string} answer
 * @returns {Promise<object|null>}
 */
export async function haikuParseChatPick(answer) {
  if (!_client) return null;
  try {
    const response = await _client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 400,
      system: HAIKU_SYSTEM,
      messages: [{ role: 'user', content: String(answer ?? '').slice(0, 8_000) }],
    });
    const text = response?.content?.[0]?.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (!parsed?.has_pick) return null;
    return parsed;
  } catch (err) {
    console.warn(`[chatPickExtractor] Haiku fallback failed: ${err.message}`);
    return null;
  }
}

// ── Normalize into pickParser-compatible shape ───────────────────────────────

/**
 * Reconciles LLM JSON with the canonical parser schema. Trusts the LLM but
 * falls back to pickParser if any required structured field is missing.
 *
 * @param {object} pickJson
 * @param {{ homeAbbr?: string, awayAbbr?: string }} ctx
 * @returns {{ market_type, side, line, prop_kind, prop_player_name, raw_pick_text }|null}
 */
export function normalizeExtracted(pickJson, ctx = {}) {
  if (!pickJson) return null;
  const teamOrPlayer = String(pickJson.team_or_player ?? '').trim();
  const market = pickJson.market_type ?? null;
  let side = pickJson.side ?? null;
  let line = pickJson.line == null ? null : Number(pickJson.line);
  let propKind = pickJson.prop_kind ?? null;
  let propPlayerName = null;

  // Build a synthetic pick string and run pickParser to sanity-check.
  let raw = teamOrPlayer;
  if (market === 'moneyline') raw = `${teamOrPlayer} ML`;
  else if (market === 'runline' && line != null) {
    const sign = line >= 0 ? `+${line}` : `${line}`;
    raw = `${teamOrPlayer} ${sign}`;
  } else if (market === 'overunder' && line != null) {
    raw = `${side === 'under' ? 'Under' : 'Over'} ${line}`;
  } else if (market === 'prop' && line != null) {
    raw = `${teamOrPlayer} ${side === 'under' ? 'Under' : 'Over'} ${line} ${propKind ?? ''}`.trim();
  }

  const parsed = parsePick(raw, ctx);
  if (parsed.market_type) {
    side = side ?? parsed.side;
    line = line ?? parsed.line;
    propKind = propKind ?? parsed.prop_kind;
    propPlayerName = parsed.prop_player_name;
  }

  if (!market) return null;
  return {
    market_type: market,
    side,
    line,
    prop_kind: propKind,
    prop_player_name: propPlayerName ?? (market === 'prop' ? teamOrPlayer : null),
    raw_pick_text: raw,
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * Persists an extracted chat pick into `picks` and `pick_features` so the ML
 * pipeline can later opt into using these rows for training.
 *
 * Returns { ok, pickId, reason }.
 *
 * @param {object} args
 * @param {object} args.extracted    — output of normalizeExtracted
 * @param {object} args.pickJson     — original LLM JSON (for confidence + reasoning)
 * @param {string} args.userId
 * @param {object} args.gameData     — from getTodayGames(); used for matchup + game_pk
 * @param {string|null} args.chatSessionId  — oracle_sessions.id (linked back)
 * @param {string} args.lang         — 'en' | 'es'
 * @param {'mlb'|'nba'} args.sport   — defaults to 'mlb' for backwards compat
 */
export async function saveExtractedChatPick({ extracted, pickJson, userId, gameData, chatSessionId = null, lang = 'en', sport = 'mlb' }) {
  if (!extracted || !gameData) return { ok: false, reason: 'missing_extracted_or_game' };

  const away = gameData.teams?.away?.team?.name ?? gameData.teams?.away?.name ?? '?';
  const home = gameData.teams?.home?.team?.name ?? gameData.teams?.home?.name ?? '?';
  const matchup = `${away} @ ${home}`;
  const gamePk  = Number(gameData.gamePk);
  const gameDate = String(gameData.gameDate ?? gameData.officialDate ?? '').slice(0, 10) || null;
  const sportNorm = String(sport ?? 'mlb').toLowerCase() === 'nba' ? 'nba' : 'mlb';

  const confidence = Number.isFinite(Number(pickJson?.confidence))
    ? Math.max(0, Math.min(100, Math.round(Number(pickJson.confidence))))
    : null;

  try {
    const pickRes = await pool.query(
      `INSERT INTO picks
         (user_id, type, matchup, pick, oracle_confidence, oracle_report,
          model, language, result, source, chat_session_id, game_pk, game_date, sport)
       VALUES ($1,'chat',$2,$3,$4,$5,$6,$7,'pending','oracle_chat',$8,$9,$10,$11)
       RETURNING id`,
      [
        userId,
        matchup,
        extracted.raw_pick_text,
        confidence,
        pickJson?.reasoning_brief ?? null,
        'claude-chat',
        lang,
        chatSessionId,
        Number.isFinite(gamePk) ? gamePk : null,
        gameDate,
        sportNorm,
      ]
    );
    const pickId = pickRes.rows[0]?.id ?? null;

    // Minimal pick_features row — features will be backfilled later by the
    // existing pickPostgameEnricher / feature-store backfill scripts.
    await pool.query(
      `INSERT INTO pick_features
         (pick_id, game_pk, game_date, pick, market_type, side, line,
          prop_kind, prop_player_id, oracle_confidence, source, sport)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'oracle_chat',$11)`,
      [
        pickId,
        Number.isFinite(gamePk) ? gamePk : null,
        gameDate,
        extracted.raw_pick_text,
        extracted.market_type,
        extracted.side,
        extracted.line,
        extracted.prop_kind,
        null,
        confidence,
        sportNorm,
      ]
    );

    return { ok: true, pickId };
  } catch (err) {
    console.warn(`[chatPickExtractor] save failed: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

// ── Top-level orchestrator (used by the chat endpoints) ─────────────────────

/**
 * Given the raw answer from analyzeChat, attempt extraction → persistence and
 * return both the cleaned answer for the user and a structured `picked`
 * descriptor for the response payload.
 *
 * @param {object} args
 * @param {string} args.rawAnswer        — answer from analyzeChat (may include tail)
 * @param {string} args.question         — original user question (for heuristics)
 * @param {string} args.userId
 * @param {object} args.gameData         — from getTodayGames()
 * @param {string|null} args.chatSessionId
 * @param {string} args.lang
 * @returns {Promise<{ answer: string, picked: object|null }>}
 */
export async function processChatAnswer({ rawAnswer, question, userId, gameData, chatSessionId, lang = 'en', sport = 'mlb' }) {
  // Step 1 — JSON tail
  const { cleanAnswer, pickJson: tailJson } = extractJsonTail(rawAnswer);
  let pickJson = tailJson;
  let sourceStage = tailJson ? 'tail' : null;

  // Step 2 — Haiku fallback when missing AND the question looked like a pick ask
  if (!pickJson && HAIKU_FALLBACK_ENABLED && looksLikePickRequest(question)) {
    pickJson = await haikuParseChatPick(cleanAnswer);
    if (pickJson) sourceStage = 'haiku';
  }

  if (!pickJson) {
    return { answer: cleanAnswer, picked: null };
  }

  const homeAbbr = gameData?.teams?.home?.team?.abbreviation ?? gameData?.teams?.home?.abbreviation;
  const awayAbbr = gameData?.teams?.away?.team?.abbreviation ?? gameData?.teams?.away?.abbreviation;
  const extracted = normalizeExtracted(pickJson, { homeAbbr, awayAbbr });
  if (!extracted) {
    return { answer: cleanAnswer, picked: null };
  }

  const saveResult = await saveExtractedChatPick({
    extracted, pickJson, userId, gameData, chatSessionId, lang, sport,
  });

  return {
    answer: cleanAnswer,
    picked: saveResult.ok
      ? {
          pick_id: saveResult.pickId,
          source_stage: sourceStage,
          market_type: extracted.market_type,
          side: extracted.side,
          line: extracted.line,
          prop_kind: extracted.prop_kind,
          team_or_player: pickJson.team_or_player ?? null,
          confidence: pickJson.confidence ?? null,
          reasoning_brief: pickJson.reasoning_brief ?? null,
          raw_pick_text: extracted.raw_pick_text,
        }
      : { error: saveResult.reason, source_stage: sourceStage },
  };
}
