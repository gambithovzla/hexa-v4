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
IMPORTANT: Even with limited data, ALWAYS provide your best analytical prediction. Never respond with ABSTAIN or PASS. Use available context, historical team tendencies, park factors, and pitcher profiles to generate a directional pick. If data is sparse, increase model_risk to 'high' but still deliver a pick with reasoning.
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
## STATCAST DATA INTERPRETATION (Baseball Savant 2025)
When the context includes STATCAST sections, you MUST use this data as PRIMARY evidence. Statcast metrics reveal true talent level beyond traditional stats.
### PITCHER STATCAST — How to use:
- xwOBA_against < .290 → Elite pitcher, strongly favor UNDER and pitcher strikeout props
- xwOBA_against .290-.320 → Above average, lean UNDER
- xwOBA_against .320-.350 → League average, neutral
- xwOBA_against > .350 → Hittable pitcher, favor OVER and opposing offense
- Whiff% > 30% → High strikeout upside, favor K props OVER
- Whiff% < 20% → Low swing-and-miss, avoid K props
- Pitch arsenal run value negative = each pitch is above average (lower is better for pitcher)
### BATTER STATCAST — How to use:
- xwOBA > .370 → Elite contact quality, favor hits/total bases props
- xwOBA .320-.370 → Above average bat
- xwOBA < .280 → Weak contact, fade in props
- Exit Velocity > 92 mph → Power threat, favor XBH and HR props
- Barrel% > 10% → Elite power, weight home run props higher
- Hard Hit% > 45% → Consistent hard contact
- Percentile xwOBA > 70 → Top tier bat in current season
### STATCAST CROSSING RULES (highest priority signals):
- Elite pitcher (xwOBA_against < .300) vs weak lineup (team avg xwOBA < .300) → STRONG UNDER signal, increase confidence +15%
- Weak pitcher (xwOBA_against > .360) vs hot lineup (avg xwOBA > .360) → STRONG OVER signal, increase confidence +15%
- Pitcher Whiff% > 32% + opposing lineup avg xwOBA < .310 → Strikeout prop OVER is high-value pick
- If Savant data is null or _sources is empty → flag as "LIMITED STATCAST DATA" and rely on traditional metrics only. Do NOT fabricate Statcast values.
### PARK FACTORS — How to use:
- park_factor_overall > 105 → Hitter-friendly park, adjust OVER +3-5% confidence
- park_factor_overall < 95 → Pitcher-friendly park, adjust UNDER +3-5% confidence
- park_factor_HR > 110 → HR-friendly, boost home run props
- Always note park factor in oracle_report when it significantly deviates from 100
### SPRINT SPEED & STOLEN BASE PROPS:
- sprint_speed > 28 ft/sec → Elite speed, favor stolen base props
- sprint_speed > 27 ft/sec → Above average speed
- sprint_speed < 25 ft/sec → Below average, avoid SB props
### BATTED BALL PROFILE CROSSING RULES:
- Pitcher gb_pct > 52% vs batter fb_pct > 45% → Groundball pitcher neutralizes power hitter
- Pitcher fb_pct > 45% vs batter barrel_pct > 10% → Dangerous matchup for pitcher, favor OVER
- Pitcher ld_pct > 23% → Allowing hard line drives, hittable
### ROLLING WINDOW (30-day form):
- rolling_woba_30d deviates > .040 from season xwOBA → flag as HOT or COLD streak
- Prioritize rolling_woba_30d over season xwOBA when gap is significant
### ROLLING WINDOWS SHORT-TERM (7/14/21 days):
- woba_7d > .400 AND woba_14d > .380 → CONFIRMED HOT STREAK, boost confidence +10%
- woba_7d < .250 AND woba_14d < .270 → CONFIRMED COLD STREAK, reduce confidence -10%
- woba_7d > .400 but woba_14d < .330 → "hot flash, unconfirmed" — note but do not boost
- woba_against_7d < .280 AND woba_against_14d < .300 → PITCHER ON FIRE, strong UNDER signal
- woba_against_7d > .380 AND woba_against_14d > .360 → PITCHER STRUGGLING, lean OVER
- When short-term and season data conflict, weight short-term 60% / season 40%
- Short-term HOT batter + struggling pitcher (woba_against_7d > .380) → MAXIMUM OVER signal
- Short-term HOT pitcher + cold batter (woba_7d < .270) → MAXIMUM UNDER signal
### HOME RUN PROFILE:
- Batter hr_per_fb > .18 → boost HR prop +10%; > .25 → elite HR rate, strong HR prop value
- Pitcher hr_per_fb_allowed > .15 → prone to HRs; > .20 → high risk, flag in alert_flags
- Batter hr_per_fb > .20 + pitcher hr_per_fb_allowed > .15 + park_factor_HR > 105 → STRONG HR signal, boost +15%
- Batter barrel_rate > 12% + pitcher fb_pct > 42% + hr_per_fb_allowed > .15 → HR prop high value
### RUN VALUE BY PITCH TYPE:
- Pitcher's worst pitch (highest positive run_value_per_100) vs batter strength in that pitch type → exploit matchup
- Pitcher's best pitch (most negative run_value_per_100) = out pitch, factor into K props
- best_pitch_run_value_per_100 < -1.5 → elite weapon, increase K prop confidence
- Conflict between pitcher's best pitch and batter's documented strength vs that pitch → flag as KEY MATCHUP CONFLICT
### SWING PATH & ATTACK ANGLE:
- attack_angle 8-16° → optimal for line drives and HR
- attack_angle > 20° → uppercut swing, more HRs but more Ks; good for HR props
- attack_angle < 5° → flat swing, ground ball tendency, avoid HR props
- squared_up_pct > 25% → elite contact quality, favor hits props; < 15% → fade hits props
- fast_swing_rate < 40% + pitcher Whiff% > 28% → K prop OVER high value
- attack_angle > 18° + pitcher fb_pct > 45% + park_factor_HR > 105 → HR prop high value
### YEAR TO YEAR CHANGES:
- year_to_year_xwoba_change > +.030 → Legitimate breakout, weight current season higher
- year_to_year_xwoba_change < -.030 → Regression risk, apply skepticism to props
### SPRING TRAINING CAVEAT:
- If savant_cache_status shows 0 records or data is null, explicitly note "Statcast 2025 data not yet available (Spring Training)" in the Oracle Report section.
- Once regular season starts (after March 27, 2025), Statcast data should populate automatically.
## HISTORICAL TRENDS ANALYSIS
When PITCHER HISTORICAL TRENDS or TEAM HISTORICAL TRENDS sections appear in the context, use them to:
1. **Pitcher trajectory**: Is the ERA improving (declining numbers = good), declining, or consistent over 3+ seasons? An improving pitcher deserves higher confidence; declining pitcher deserves skepticism.
2. **Team offense trajectory**: Is OPS trending up (improving offense) or down (weakening)? Cross-reference with current season to confirm trend continuation.
3. **HOT streak detection**: If rolling_woba_30d exceeds season xwOBA by .040+, flag as HOT and weight current form 70%, historical 30%.
4. **COLD streak detection**: If rolling_woba_30d is below season xwOBA by .040+, flag as SLUMP and weight historical 60%, current 40%.
5. **Breakout vs regression**: year_to_year_xwoba_change > +.030 = legitimate breakout; < -.030 = regression risk.
6. **Never override current-season evidence**: Historical data informs context but strong current-season data takes precedence. Use TREND annotations from the context directly.
## LINEUP STATUS INTERPRETATION
When LINEUP STATUS section appears:
- CONFIRMED lineups: Use confirmed batting order for matchup analysis. Full confidence.
- PROBABLE lineups: Analysis reliable for pitching matchup; slight uncertainty for batting props.
- UNAVAILABLE: Increase model_risk by one level (low→medium, medium→high). Note in oracle_report.
## TEAM VERIFICATION
If a TEAM VERIFICATION warning (⚠️) appears, note in alert_flags that the pitcher may have changed teams and recommend verifying before betting.
## WEATHER ANALYSIS
When WEATHER CONDITIONS data is provided:
- Wind > 15mph blowing OUT (toward outfield): +5% OVER confidence, increased HR probability — mention in oracle_report
- Wind > 15mph blowing IN (toward infield): +5% UNDER confidence, reduced HR probability — mention in oracle_report
- Wind 10-15mph: minor fly ball impact, note directional lean
- Temperature > 85°F: ball carries 3-5% farther, slight OVER bias
- Temperature < 50°F: ball dies, slight UNDER bias
- Rain probability > 60%: flag as WEATHER RISK in alert_flags, reduce overall confidence by 10%
- Rain probability > 70%: add "HIGH RAIN RISK — game delay/postponement possible" to alert_flags
- Indoor stadiums: weather is not a factor — note this briefly in oracle_report, do not penalize or boost
- Always mention weather impact in oracle_report when wind > 10mph or temp is extreme (> 85°F or < 50°F)
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
- Pitcher hr_per_fb_allowed > .20 + batter hr_per_fb > .20 = HR explosion risk — flag prominently
- Batter woba_7d diverges > .080 from season xwOBA = extreme hot/cold streak — flag prominently
## WEATHER ANALYSIS
When WEATHER CONDITIONS data is provided:
- Wind > 15mph blowing OUT (toward outfield): +5% OVER confidence, increased HR probability
- Wind > 15mph blowing IN (toward infield): +5% UNDER confidence, reduced HR probability
- Temperature > 85°F: ball carries 3-5% farther, slight OVER bias
- Temperature < 50°F: ball dies, slight UNDER bias
- Rain probability > 60%: flag as WEATHER RISK, reduce overall confidence by 10%
- Indoor stadiums: weather is not a factor, note this in oracle_report
- Always mention weather impact in oracle_report when wind > 10mph or temp is extreme
## OUTPUT
Respond ONLY with valid JSON. No markdown, no backticks, no preamble.
For SINGLE GAME:
{"master_prediction":{"pick":"string","oracle_confidence":"number 0-100","bet_value":"string"},"oracle_report":"string","hexa_hunch":"string","alert_flags":["strings"],"probability_model":{"home_wins":"number/10000","away_wins":"number/10000"},"best_pick":{"type":"Moneyline|RunLine|Over-Under|PlayerProp","detail":"string","confidence":"number 0-1"},"model_risk":"low|medium|high"}
For PARLAY:
{"parlay":{"legs":[{"game":"str","pick":"str","confidence":"0-1","reasoning":"str"}],"combined_confidence":"0-1","risk_level":"string","strategy_note":"string"}}
For FULL DAY:
{"games":[{"matchup":"str","master_prediction":{...},"oracle_report":"str","hexa_hunch":"str","alert_flags":[],"best_pick":{...},"model_risk":"str"}],"day_summary":"str"}
CRITICAL: Output raw JSON only. Never wrap in markdown code fences or backticks.`;

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
 * Limpieza agresiva antes de intentar parsear.
 * Quita markdown fences, backticks sueltos y extrae el bloque {...}.
 */
function cleanJsonResponse(text) {
  if (!text) return text;
  let cleaned = text
    .replace(/```json/gi, '')
    .replace(/```JSON/gi, '')
    .replace(/```/g, '')
    .trim();
  // Remove any remaining surrounding backticks
  cleaned = cleaned.replace(/^`+|`+$/g, '').trim();
  // Extract from first { to last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace  = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
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
    console.log('[oracle] parseResponse: empty raw text');
    return { data: null, parseError: true, errorReason: 'empty_response' };
  }

  console.log('[oracle] RAW (first 300):', JSON.stringify(raw.slice(0, 300)));

  // Aggressive cleaning first
  const cleaned = cleanJsonResponse(raw);

  console.log('[oracle] CLEANED (first 300):', JSON.stringify(cleaned.slice(0, 300)));

  // Helper: strip probability_model.note if present
  function sanitize(obj) {
    if (obj?.probability_model?.note !== undefined) {
      const { note: _note, ...rest } = obj.probability_model; // eslint-disable-line no-unused-vars
      return { ...obj, probability_model: rest };
    }
    return obj;
  }

  // 1. Direct parse
  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    try {
      const parsed = sanitize(JSON.parse(cleaned));
      console.log('[oracle] parse OK (direct)');
      return { data: parsed, parseError: false };
    } catch (e) {
      console.log('[oracle] direct parse failed:', e.message);
      // fall through to regex extraction
    }
  }

  // 2. Regex extraction — grab largest {...} block from the cleaned string
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = sanitize(JSON.parse(match[0]));
      console.log('[oracle] parse OK (regex)');
      return { data: parsed, parseError: false };
    } catch (err) {
      console.log('[oracle] regex parse failed:', err.message);
      return { data: null, parseError: true, errorReason: 'invalid_json', parseErrorMessage: err.message };
    }
  }

  // 3. Raw text fallback (prose response — not an error)
  console.log('[oracle] no JSON found, returning prose');
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
    model        = 'fast',
    timeoutMs    = null,
  } = params;

  const { id: modelId, maxTokens } = MODELS[model] ?? MODELS.fast;

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
