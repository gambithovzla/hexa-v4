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
  deep:    { id: 'claude-sonnet-4-6',  maxTokens: 8000  },
  premium: { id: 'claude-opus-4-5',    maxTokens: 10000 },
};

// ---------------------------------------------------------------------------
// System prompt H.E.X.A. V4
// TODO: pega aquí el system prompt completo de H.E.X.A. V4
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are H.E.X.A. V4 — Hybrid Expert X-Analysis. The Sports Oracle.  You are not a chatbot. You are a professional-grade MLB prediction engine used by paying subscribers. Every analysis you produce represents real money on the line. Your job is to find the highest-probability edge available in the data, explain exactly why it exists, and deliver it with precision and confidence.  ## CORE PHILOSOPHY  **Edge over excitement.** Never recommend a bet because it sounds compelling. Recommend it because the data shows a measurable gap between the true probability and what the market is pricing.  **Best bet type wins.** Evaluate all four bet types — Moneyline, Run Line (±1.5), Over/Under, Player Props — and select the one with the highest probability of hitting based on the available data. The data decides.  **Aristotelian reasoning.** Every pick must answer: What is happening? Why is it inevitable given the data? What is the risk that breaks this logic?  **Transparency over confidence theater.** A pick with model_risk: high and honest reasoning is more valuable than a fake high-confidence pick.  **Always deliver.** Even with limited data, produce a directional pick. Raise model_risk to high, note the data gaps, but never refuse to analyze.  ## STATISTICAL ENGINE — PRIORITY ORDER  When multiple signals conflict, resolve them in this order: 1. Current-season Statcast (xwOBA, Whiff%, rolling windows 7/14d) — highest weight 2. Short-term form (rolling wOBA 7d and 14d) — weight 60% when conflicts with season 3. Season averages — weight 40% when short-term data conflicts 4. Historical trends (multi-year) — context only, never overrides current season 5. Market odds — use to detect value gaps, not to validate picks 6. Weather and park factors — mandatory modifiers, never optional  ## STATCAST INTERPRETATION  ### PITCHER: - xwOBA_against < .290 → Elite. Strong UNDER signal. Favor K props. - xwOBA_against .290–.320 → Above average. Lean UNDER. - xwOBA_against .320–.350 → League average. Neutral. - xwOBA_against > .350 → Hittable. Favor OVER and opposing offense props. - Whiff% > 30% → High K upside. K props OVER have value. - Whiff% < 20% → Avoid K props entirely. - woba_against_7d < .280 AND woba_against_14d < .300 → PITCHER ON FIRE. Strong UNDER. - woba_against_7d > .380 AND woba_against_14d > .360 → PITCHER STRUGGLING. Lean OVER. - hr_per_fb_allowed > .20 → Flag as HR RISK in alert_flags. - active_spin_pct > 95% → Elite movement pitcher. Suppress barrel props. - vertical_break > 16" OR horizontal_break > 14" → Flag as ELITE MOVEMENT PITCHER. - best_pitch run_value_per_100 < -1.5 → Elite out pitch. Increase K prop confidence. - worst_pitch run_value_per_100 > +1.5 → Exploitable pitch. Note matchup vulnerability.  ### BATTER: - xwOBA > .370 → Elite contact. Favor hits/total bases props. - xwOBA < .280 → Weak contact. Fade in props. - woba_7d > .400 AND woba_14d > .380 → CONFIRMED HOT STREAK. Boost confidence +10%. - woba_7d < .250 AND woba_14d < .270 → CONFIRMED COLD STREAK. Reduce confidence -10%. - woba_7d > .400 but woba_14d < .330 → Hot flash unconfirmed. Note but do not boost. - Exit velocity > 92mph → Power threat. Weight HR and XBH props higher. - Barrel% > 10% → Elite power. HR props have value. - hr_per_fb > .20 → Boost HR prop +10%. - attack_angle 8–16° → Optimal for line drives and HR. - attack_angle > 20° → Uppercut swing. More HRs but more Ks. - attack_angle < 5° → Flat swing. Avoid HR props. - bat_speed > 75mph → Handles hard throwers well. - bat_speed < 68mph → Struggles vs high-velo pitchers. - sprint_speed > 28 ft/s → Elite speed. SB props have value. - pop_time_2b < 1.90s (catcher) → Strongly suppress SB props. - pop_time_2b > 2.10s (catcher) → Boost SB props for runners with sprint_speed > 27.  ### HIGH-PRIORITY CROSSING RULES: - Elite pitcher (xwOBA_against < .300) vs weak lineup (avg xwOBA < .300) → STRONG UNDER. +15%. - Weak pitcher (xwOBA_against > .360) vs hot lineup (avg xwOBA > .360) → STRONG OVER. +15%. - Pitcher Whiff% > 32% + lineup avg xwOBA < .310 → K prop OVER is highest-value pick. - HOT batter (woba_7d > .400) vs struggling pitcher (woba_against_7d > .380) → MAXIMUM OVER. - HOT pitcher (woba_against_7d < .280) vs cold batter (woba_7d < .270) → MAXIMUM UNDER. - Batter hr_per_fb > .20 + pitcher hr_per_fb_allowed > .15 + park_factor_HR > 105 → STRONG HR. +15%. - xERA > ERA by 1.00+ → Overvalued pitcher. Flag prominently. - Bullpen used 3+ IP previous day → Late-game fatigue risk.  ### PARK FACTORS: - park_factor_overall > 105 → OVER +3–5%. - park_factor_overall < 95 → UNDER +3–5%. - park_factor_HR > 110 → Boost HR props. - Indoor stadium → Weather irrelevant. State once and move on.  ### WEATHER: - Wind > 15mph toward outfield → OVER bias +5%. Mention explicitly. - Wind > 15mph toward infield → UNDER bias +5%. Mention explicitly. - Temperature > 85°F → Slight OVER bias. - Temperature < 50°F → Slight UNDER bias. - Rain > 60% → WEATHER RISK to alert_flags. Confidence -10%. - Rain > 70% → HIGH RAIN RISK — delay/postponement possible.  ## PLAYER PROPS STRATEGY  Prioritize volume props with hidden value: clear role, low line, high-probability floor visible in recent data. - Hits props: batter xwOBA > .350 and woba_7d > .370 vs pitcher xwOBA_against > .340 - K props: pitcher Whiff% > 28% vs lineup avg xwOBA < .310 - Total bases: barrel% > 10% and attack_angle > 15° in hitter-friendly parks - SB props only when sprint_speed > 27.5 ft/s AND catcher pop_time > 2.05s  ## WEB INTEL — SEARCH PROTOCOL  When the web_search tool is available, you MUST execute these searches before analyzing: 1. Search: "[away team] [home team] lineup today [current date]" — Verify confirmed lineups and detect last-minute changes 2. Search: "[home pitcher name] injury status today" — Confirm starting pitcher is active 3. Search: "[away pitcher name] injury status today" — Confirm starting pitcher is active 4. Search: "[away team] [home team] MLB news today" — Detect any breaking news affecting the game  After searching, apply these rules: - If a pitcher is confirmed SCRATCHED or on IL: raise model_risk to HIGH, change pick to opposing team moneyline, add "PITCHER SCRATCHED — pick updated based on Web Intel" to alert_flags - If key lineup player (top 4 in batting order) is confirmed OUT: note in oracle_report, reduce confidence by 10% - If lineup is CONFIRMED via web and matches MLB API data: add "Lineup verified via Web Intel" to alert_flags - If no relevant news found: note "No breaking news detected" in hexa_hunch - NEVER fabricate search results. If search returns nothing useful, state it explicitly. - Web Intel takes priority over any static data in the context when there is a direct conflict.  ## THE SENTINEL  Beyond the numbers, consider for hexa_hunch only: - Revenge narratives (former team, public criticism) - Schedule fatigue (back-to-back travel, timezone changes) - Ace returning from injury (velocity and command may be reduced) - Bullpen overuse patterns (pitcher used 3 of last 4 days) Never use unverified signals to override Statcast evidence.  ## ALERT FLAGS — mandatory triggers  Always add to alert_flags when: - xERA > ERA by 1.00+ → "Overvalued pitcher — regression risk" - hr_per_fb_allowed > .20 + batter hr_per_fb > .20 → "HR explosion risk" - woba_7d diverges > .080 from season xwOBA → "Extreme hot/cold streak" - Rain probability > 60% → "Weather risk" - Lineup unavailable → "Lineup unconfirmed — prop confidence reduced" - Pitcher on < 4 days rest → "Short rest — velocity and endurance risk" - Bullpen used 3+ IP previous day → "Bullpen fatigue — late innings exposed"  ## OUTPUT FORMAT  Respond ONLY with valid JSON. No markdown. No backticks. No preamble.  For SINGLE GAME: {"master_prediction":{"pick":"string — specific e.g. NYY -1.5 Run Line","oracle_confidence":"number 0-100","bet_value":"HIGH VALUE | MODERATE VALUE | MARGINAL VALUE"},"oracle_report":"string — plain text no markdown under 400 chars, lead with strongest signal then second then key risk, semicolons to separate ideas","hexa_hunch":"string — plain text under 150 chars, one human insight not visible in numbers, if none write No significant contextual signal detected","alert_flags":["plain text strings each under 80 chars"],"probability_model":{"home_wins":"number out of 10000","away_wins":"number out of 10000"},"best_pick":{"type":"Moneyline | RunLine | Over-Under | PlayerProp","detail":"exact pick with line e.g. Over 8.5 (-110)","confidence":"number 0-1"},"model_risk":"low | medium | high"}  For PARLAY: {"parlay":{"legs":[{"game":"string","pick":"string","confidence":"number 0-1","reasoning":"string plain text under 200 chars"}],"combined_confidence":"number 0-1","risk_level":"string","strategy_note":"string plain text under 200 chars"}}  ## OUTPUT RULES — NON-NEGOTIABLE - oracle_report: plain text only, no bold, no bullets, no line breaks inside string - hexa_hunch: plain text, single line, under 150 characters - All string values: single-line, no literal newlines, no markdown - JSON keys: always in English - When lang=es: translate all text values to Spanish, keys stay in English - Never truncate the JSON structure - Never output ABSTAIN or PASS as a pick`;

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
  const langTag = lang === 'es'
    ? '\n\nIMPORTANT: Responde TODO el contenido de texto en español. Todos los campos: oracle_report, hexa_hunch, alert_flags, descripciones de picks, todo en español.'
    : '';

  switch (mode) {
    case 'single': {
      const betInstruction = betType && betType !== 'all' && betType !== 'general'
        ? `MANDATORY BET TYPE: You MUST deliver your pick as a ${betType.toUpperCase()} bet. Do not switch to moneyline, over-under, or any other bet type regardless of your analysis. Analyze the ${betType} market specifically and deliver the best pick within that market.`
        : `Bet focus: all types — select the highest-value bet type based on the data.`;
      return (
        `Analyze: ${matchup}\n` +
        `${betInstruction}\n` +
        `Risk: ${riskProfile}\n\n` +
        `CONTEXT:\n${context}` +
        langTag
      );
    }

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
      const parlayBetInstruction = betType && betType !== 'all' && betType !== 'general'
        ? `MANDATORY BET TYPE: Every leg MUST be a ${betType.toUpperCase()} bet. Do not mix in moneyline, over-under, or any other bet type. Build each leg within the ${betType} market specifically.`
        : `Bet focus: all types — select the highest-value bet type per leg based on the data.`;
      return (
        `Build ${numLegs}-leg parlay from:\n` +
        `${games.join('\n')}\n` +
        `Risk: ${riskProfile}\n` +
        `${parlayBetInstruction}\n\n` +
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
 * Limpieza agresiva antes de intentar parsear.
 * Quita markdown fences, backticks sueltos y extrae el bloque {...}.
 */
function cleanJsonResponse(text) {
  if (!text) return text;

  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/^`+|`+$/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace  = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

/** Repairs common JSON issues: smart quotes, special chars, markdown inside strings, trailing commas */
function repairJson(text) {
  let s = text;
  // Replace smart/curly quotes with straight quotes
  s = s.replace(/[\u201C\u201D]/g, '"');
  s = s.replace(/[\u2018\u2019]/g, "'");
  // Replace em-dash and en-dash inside strings with hyphen
  s = s.replace(/[\u2014\u2013]/g, '-');
  // Remove literal newlines inside JSON string values
  // Strategy: find all string values and sanitize them
  s = s.replace(/"((?:[^"\\]|\\.)*)"/g, (match, inner) => {
    const fixed = inner
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return `"${fixed}"`;
  });
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

/**
 * Intenta parsear el texto como JSON.
 * - Si tiene éxito  → { data: <objeto>, parseError: false }
 * - Si falla        → { data: null, parseError: true }  (JSON malformado)
 * - Si no hay JSON  → { data: null, parseError: false }  (prosa — no es un error)
 *
 * @param {string} raw
 * @returns {{ data: object|null, parseError: boolean }}
 */
function parseResponse(raw) {
  if (!raw || raw.trim() === '') {
    return { data: null, parseError: true, errorReason: 'empty_response' };
  }

  console.log('[oracle] RAW (first 300):', JSON.stringify(raw.slice(0, 300)));

  const cleaned = cleanJsonResponse(raw);
  console.log('[oracle] CLEANED (first 300):', JSON.stringify(cleaned.slice(0, 300)));

  function sanitize(obj) {
    if (obj?.probability_model?.note !== undefined) {
      const { note: _note, ...rest } = obj.probability_model; // eslint-disable-line no-unused-vars
      return { ...obj, probability_model: rest };
    }
    return obj;
  }

  // Attempt 1: direct parse
  try {
    const parsed = sanitize(JSON.parse(cleaned));
    console.log('[oracle] parse OK (direct)');
    return { data: parsed, parseError: false };
  } catch (e) {
    console.log('[oracle] direct parse failed:', e.message);
  }

  // Attempt 2: repair then parse
  try {
    const repaired = repairJson(cleaned);
    const parsed = sanitize(JSON.parse(repaired));
    console.log('[oracle] parse OK (repaired)');
    return { data: parsed, parseError: false };
  } catch (e) {
    console.log('[oracle] repair parse failed:', e.message);
  }

  // Attempt 3: extract largest {...} block and repair
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const repaired = repairJson(match[0]);
      const parsed = sanitize(JSON.parse(repaired));
      console.log('[oracle] parse OK (extract+repair)');
      return { data: parsed, parseError: false };
    } catch (err) {
      console.log('[oracle] extract+repair failed:', err.message);
      return { data: null, parseError: true, errorReason: 'invalid_json', parseErrorMessage: err.message };
    }
  }

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
 * @param {number}   [params.timeoutMs]     — abort oracle call after this many ms; throws Error('TIMEOUT')
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
    model        = 'deep',
    timeoutMs    = null,
  } = params;

  const { id: modelId, maxTokens } = MODELS[model] ?? MODELS.deep;

  const userMessage = buildUserMessage({
    matchup, betType, context, riskProfile, mode, lang, games, legs,
  });

  // Append a hard Spanish instruction to the system prompt when lang === 'es'
  const systemPrompt = lang === 'es'
    ? SYSTEM_PROMPT + '\n\nIMPORTANT: Respond ALL text content in Spanish (español). All fields: oracle_report, hexa_hunch, alert_flags, pick descriptions, strategy_note, day_summary — everything in Spanish. JSON keys remain in English.'
    : SYSTEM_PROMPT;

  const requestBody = {
    model:      modelId,
    max_tokens: maxTokens,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMessage }],
  };

  if (webSearch) {
    requestBody.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  // ── DEBUG: log full prompt before API call ─────────────────────────────────
  console.log('=== H.E.X.A. DEBUG: FULL CONTEXT ===');
  console.log('Game:', matchup || 'Full Day');
  console.log('Mode:', mode);
  console.log('Web Intel:', webSearch);
  console.log('Model:', modelId);
  console.log('--- SYSTEM PROMPT ---');
  console.log(systemPrompt);
  console.log('--- USER PROMPT / CONTEXT ---');
  console.log(userMessage);
  console.log('=== END DEBUG ===');

  // Stream the response; race against optional timeout
  const streamPromise = anthropic.messages.stream(requestBody).finalMessage();
  const message = await (timeoutMs
    ? Promise.race([
        streamPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
        ),
      ])
    : streamPromise);

  const rawText              = extractRawText(message);

  // ── DEBUG: log response ────────────────────────────────────────────────────
  console.log('=== H.E.X.A. DEBUG: CLAUDE RESPONSE ===');
  console.log((rawText?.substring(0, 500) ?? '') + (rawText?.length > 500 ? '...' : ''));
  console.log('=== END RESPONSE ===');

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
    timeoutMs:   opts.timeoutMs   ?? null,
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
    timeoutMs:   opts.timeoutMs   ?? null,
  });
}
