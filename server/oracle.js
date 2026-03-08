/**
 * server/oracle.js
 * Llama a la API de Claude con el system prompt H.E.X.A. V4.
 *
 * Exporta:
 *   analyzeGame(params)                            — función principal (todos los modos)
 *   analyzeParlay(contexts, language, opts)        — wrapper para index.js
 *   analyzeFullDay(contexts, date, language, opts) — wrapper para index.js
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODELS = {
  fast: { id: 'claude-haiku-4-5-20251001',  maxTokens: 1500 },
  deep: { id: 'claude-sonnet-4-20250514',   maxTokens: 3000 },
};

// ---------------------------------------------------------------------------
// System prompt H.E.X.A. V4
// TODO: pega aquí el system prompt completo de H.E.X.A. V4
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are H.E.X.A. V4 (Hybrid Expert X-Analysis), the ultimate hybrid intelligence system for MLB prediction. You are the Sports Oracle.
## PHILOSOPHY
- Aristotelian Logic: Every prediction must explain WHY based on sabermetrics and human context. Do not just state what will happen; explain why it is inevitable.
- Precision Over Volume: Prioritize one Master Pick with high confidence over ten mediocre bets.
- Tone: Professional, direct, authoritative, analytical.
## STATISTICAL ENGINE
Cross-reference data from the provided context:
- OFFENSE: Exit Velocity, Barrel%, Pull%, Flyball%, HR/PA, wOBA, pitch arsenal vulnerability
- PITCHING: ERA, xERA, FIP, xwOBA, WHIP, K/9, BB/9, HR/9, zone vulnerability
- CROSSING RULES:
  * Batter pull+flyball+high EV vs pitcher weak heart zone + high FB rate = HIGH HR probability
  * Team high barrel rate vs pitcher yielding high EV = collapse risk 2nd/3rd time through order
  * Bullpen 2+ heavy-usage games = late-game fatigue risk
  * xERA > ERA by 1.00+ = overvalued pitcher
  * HR/9 > 1.8 + EV > 90mph = multiple HR risk
  * Bullpen xSLG > .400 + 3+ IP yesterday = fatigue flag
- ENVIRONMENTAL: Weather, Park Factors, schedule fatigue
## THE SENTINEL (human/social context)
- Social Mining: Press reports, beat writers, social media signals
- Critical Fatigue: Emotional stress beyond pitch counts
- Lifestyle & Focus: Late nights, personal distractions
- Revenge Narratives: Former teammates, humiliation streaks
- HEXA Hunch: Justified inference from invisible data with technical basis
## VOLUME PROPS STRATEGY
Prioritize volume props with hidden value: low lines, clear player roles, high-probability outcomes. For MLB: target hits, strikeouts, bases, outs recorded where the floor is visible in recent data.
## ALERT FLAGS (quantified)
- xERA > ERA by 1.00+ = overvalued pitcher
- HR/9 > 1.8 + EV > 90mph = multiple HR risk
- Bullpen xSLG > .400 + 3+ IP yesterday = fatigue
- Missing key data = increase model_risk
## OUTPUT
Respond ONLY with valid JSON. No markdown, no backticks, no preamble.
For SINGLE GAME:
{"master_prediction":{"pick":"string","oracle_confidence":"number 0-100","bet_value":"string"},"oracle_report":"string","hexa_hunch":"string","alert_flags":["strings"],"probability_model":{"home_wins":"number/10000","away_wins":"number/10000"},"best_pick":{"type":"Moneyline|RunLine|Over-Under|PlayerProp","detail":"string","confidence":"number 0-1"},"model_risk":"low|medium|high"}
For PARLAY:
{"parlay":{"legs":[{"game":"str","pick":"str","confidence":"0-1","reasoning":"str"}],"combined_confidence":"0-1","risk_level":"string","strategy_note":"string"}}
For FULL DAY:
{"games":[{"matchup":"str","master_prediction":{...},"oracle_report":"str","hexa_hunch":"str","alert_flags":[],"best_pick":{...},"model_risk":"str"}],"day_summary":"str"}`;

// ---------------------------------------------------------------------------
// Construcción del mensaje de usuario según el modo
// ---------------------------------------------------------------------------

/**
 * @param {object}   p
 * @param {string}   p.matchup
 * @param {string}   [p.betType]
 * @param {string}   p.context
 * @param {string}   p.riskProfile
 * @param {string}   p.mode         — "single" | "fullDay" | "parlay"
 * @param {string}   p.lang
 * @param {string[]} [p.games]
 * @param {number}   [p.legs]
 * @returns {string}
 */
function buildUserMessage({ matchup, betType, context, riskProfile, mode, lang, games = [], legs }) {
  const langTag = lang && lang !== 'en' ? `\n\nRespond in: ${lang}` : '';

  switch (mode) {
    case 'single':
      return (
        `Analyze: ${matchup}\n` +
        `Bet focus: ${betType ?? 'general'}\n` +
        `Risk: ${riskProfile}\n\n` +
        `CONTEXT:\n${context}` +
        langTag
      );

    case 'fullDay':
      return (
        `Analyze full slate:\n` +
        `${games.join('\n')}\n` +
        `Risk: ${riskProfile}\n\n` +
        `CONTEXT PER GAME:\n${context}` +
        langTag
      );

    case 'parlay': {
      const numLegs = legs ?? games.length;
      return (
        `Build ${numLegs}-leg parlay from:\n` +
        `${games.join('\n')}\n` +
        `Risk: ${riskProfile}\n` +
        `Prioritize volume props with hidden value.\n\n` +
        `CONTEXT:\n${context}` +
        langTag
      );
    }

    default:
      throw new Error(`oracle: modo desconocido "${mode}"`);
  }
}

// ---------------------------------------------------------------------------
// Extracción y parseo de la respuesta
// ---------------------------------------------------------------------------

/**
 * Une todos los bloques de texto de la respuesta en un string.
 */
function extractRawText(response) {
  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

/**
 * Elimina markdown fences (```json … ```) del texto.
 */
function stripMarkdownFences(text) {
  return text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

/**
 * Intenta parsear el texto como JSON.
 * - Si el texto empieza con { o [, asume JSON e intenta parsearlo.
 *   · Si tiene éxito  → { data: <objeto>, parseError: false }
 *   · Si falla        → { data: null, parseError: true }  (JSON malformado)
 * - Si el texto es prosa/markdown libre:
 *                     → { data: null, parseError: false }  (no es un error)
 *
 * @param {string} raw
 * @returns {{ data: object|null, parseError: boolean }}
 */
function parseResponse(raw) {
  if (!raw || raw.trim() === '') {
    return { data: null, parseError: true, errorReason: 'empty_response', rawText: raw };
  }

  const cleaned = stripMarkdownFences(raw);

  // Helper: strip probability_model.note if present
  function sanitize(obj) {
    if (obj?.probability_model?.note !== undefined) {
      // eslint-disable-next-line no-unused-vars
      const { note: _note, ...rest } = obj.probability_model;
      return { ...obj, probability_model: rest };
    }
    return obj;
  }

  // 1. Direct parse if text looks like JSON
  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    try {
      return { data: sanitize(JSON.parse(cleaned)), parseError: false };
    } catch {
      // fall through to regex extraction
    }
  }

  // 2. Regex extraction — grab first {...} block spanning the whole text
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return { data: sanitize(JSON.parse(match[0])), parseError: false };
    } catch (err) {
      return { data: null, parseError: true, errorReason: 'invalid_json', parseErrorMessage: err.message, rawText: raw };
    }
  }

  // 3. Raw text fallback (prose response — not an error)
  return { data: null, parseError: false };
}

// ---------------------------------------------------------------------------
// Función principal exportada
// ---------------------------------------------------------------------------

/**
 * Analiza un partido, parlay o jornada completa vía la API de Claude.
 *
 * @param {object}   params
 * @param {string}   params.matchup         — "NYY @ BOS" (modo single)
 * @param {string}   [params.betType]       — "moneyline" | "totals" | "runline" | …
 * @param {string}   params.context         — string de buildContext()
 * @param {string}   [params.riskProfile]   — "low" | "medium" | "high"  (def. "medium")
 * @param {string}   [params.mode]          — "single" | "fullDay" | "parlay" (def. "single")
 * @param {string}   [params.lang]          — idioma de la respuesta (def. "en")
 * @param {boolean}  [params.webSearch]     — incluir tool web_search (def. false)
 * @param {string[]} [params.games]         — lista de matchups para fullDay/parlay
 * @param {number}   [params.legs]          — número de patas del parlay
 * @param {string}   [params.model]         — "fast" (Haiku) | "deep" (Sonnet)  (def. "fast")
 *
 * @returns {Promise<{
 *   data:       object|null,
 *   rawText:    string,
 *   parseError: boolean,
 *   stopReason: string,
 *   usage:      object,
 * }>}
 */
export async function analyzeGame(params) {
  const {
    matchup      = '',
    betType,
    context      = '',
    riskProfile  = 'medium',
    mode         = 'single',
    lang         = 'en',
    webSearch    = false,
    games        = [],
    legs,
    model        = 'fast',
  } = params;

  const { id: modelId, maxTokens } = MODELS[model] ?? MODELS.fast;

  const userMessage = buildUserMessage({
    matchup, betType, context, riskProfile, mode, lang, games, legs,
  });

  const requestBody = {
    model:      modelId,
    max_tokens: maxTokens,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userMessage }],
  };

  if (webSearch) {
    requestBody.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  // Usamos streaming para evitar timeouts con respuestas largas
  const stream  = anthropic.messages.stream(requestBody);
  const message = await stream.finalMessage();

  const rawText              = extractRawText(message);
  const { data, parseError } = parseResponse(rawText);

  return {
    data,
    rawText,
    parseError,
    stopReason: message.stop_reason,
    usage:      message.usage,
  };
}

// ---------------------------------------------------------------------------
// Wrappers de conveniencia — mantienen la firma que usa index.js
// ---------------------------------------------------------------------------

/**
 * Analiza varios partidos como parlay.
 *
 * @param {string[]} contexts  — un string de contexto por partido
 * @param {string}   [language]
 * @param {object}   [opts]    — riskProfile, webSearch, …
 */
export async function analyzeParlay(contexts, language = 'en', opts = {}) {
  return analyzeGame({
    mode:        'parlay',
    matchup:     `${contexts.length}-leg parlay`,
    context:     contexts.join('\n\n---\n\n'),
    lang:        language,
    legs:        opts.legs        ?? contexts.length,
    games:       contexts.map((_, i) => `Game ${i + 1}`),
    betType:     opts.betType,
    riskProfile: opts.riskProfile ?? 'medium',
    webSearch:   opts.webSearch   ?? false,
    model:       opts.model       ?? 'fast',
  });
}

/**
 * Analiza la jornada completa.
 *
 * @param {string[]} contexts  — un string de contexto por partido
 * @param {string}   [date]
 * @param {string}   [language]
 * @param {object}   [opts]
 */
export async function analyzeFullDay(contexts, date = '', language = 'en', opts = {}) {
  return analyzeGame({
    mode:        'fullDay',
    matchup:     `Full slate — ${date}`,
    context:     contexts.join('\n\n---\n\n'),
    lang:        language,
    games:       contexts.map((_, i) => `Game ${i + 1}`),
    betType:     opts.betType,
    riskProfile: opts.riskProfile ?? 'medium',
    webSearch:   opts.webSearch   ?? false,
    model:       opts.model       ?? 'fast',
  });
}
