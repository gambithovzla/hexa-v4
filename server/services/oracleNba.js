/**
 * oracleNba.js — NBA branch of the Oracle.
 *
 * Mirrors what server/oracle.js does for MLB, but isolated in its own module
 * so the frozen MLB Oracle never has to change.
 *
 * Public API:
 *   analyzeNbaGame({ context, gameDescription, lang, riskProfile,
 *                    userBankroll, marketOdds, engine, model })
 *     → { provider, model, data, rawText, parseError, stopReason, usage }
 *
 *   analyzeNbaChat({ context, gameDescription, question, lang, model })
 *     → { provider, model, text, usage }
 *
 * `context` is expected to be the object returned by buildNbaGameContext()
 * in server/nba-context-builder.js. This module is responsible for
 * serialising it into the deterministic text block the LLM consumes.
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

import { NBA_CHAT_PROMPT, NBA_SYSTEM_PROMPT } from '../prompts/oracle-nba-prompts.js';

dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NBA_MODELS = {
  deep:    { id: 'claude-sonnet-4-6',         maxTokens: 8000 },
  premium: { id: 'claude-opus-4-7',           maxTokens: 10000 },
  haiku:   { id: 'claude-haiku-4-5-20251001', maxTokens: 1200 },
};

// ── Context serialisation ─────────────────────────────────────────────────────

function fmt(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return 'n/a';
  return Number(n).toFixed(digits);
}

function describeInjuriesBlock(side) {
  const inj = side?.injuries;
  if (!inj || !inj.ok) return '  Injuries: data unavailable';
  if (inj.count === 0)  return '  Injuries: no reported absences';
  const top = inj.items.slice(0, 6).map(it => {
    const pos = it.position ? ` (${it.position})` : '';
    const type = it.type ? ` — ${it.type}${it.detail ? ' / ' + it.detail : ''}` : '';
    const ret  = it.returnDate ? ` [return: ${it.returnDate}]` : '';
    const status = it.status ?? it.statusKey ?? 'unknown';
    return `    - ${it.playerName ?? 'Unknown'}${pos}: ${status}${type}${ret}`;
  });
  const more = inj.count > 6 ? `\n    - … +${inj.count - 6} more` : '';
  return `  Injuries (${inj.count}, ${inj.severeCount} severe):\n${top.join('\n')}${more}`;
}

function describeTeamBlock(label, side) {
  if (!side) return `${label}: data unavailable.`;
  const recent = side.recentForm;
  const recentLine = recent
    ? `last 10: ${recent.record}, avg ${fmt(recent.avgPts)} pts for` +
      (recent.avgOppPts != null ? ` / ${fmt(recent.avgOppPts)} pts allowed` : '') +
      (recent.avgPlusMinus != null ? `, avg +/- ${fmt(recent.avgPlusMinus)}` : '')
    : 'last 10: data unavailable';
  return [
    `${label} — ${teamLabel(side)}`,
    `  Record: ${side.record ?? 'n/a'}`,
    `  Off Rating: ${fmt(side.offRating)} | Def Rating: ${fmt(side.defRating)} | Net Rating: ${fmt(side.netRating)}`,
    `  Pace: ${fmt(side.pace)} | TS%: ${fmt(side.tsPct * 100)} | REB%: ${fmt(side.rebPct * 100)} | AST%: ${fmt(side.astPct * 100)}`,
    `  Rest days vs this game: ${side.daysRest ?? 'n/a'}`,
    `  ${recentLine}`,
    describeInjuriesBlock(side),
  ].join('\n');
}

function describeRestDelta(home, away) {
  const hr = home?.daysRest;
  const ar = away?.daysRest;
  if (hr == null || ar == null) return 'Rest delta: not computable (missing recent-game data).';
  const diff = hr - ar;
  if (diff === 0) return `Rest delta: even (${hr} days both sides).`;
  const advantage = diff > 0 ? teamLabel(home) : teamLabel(away);
  return `Rest delta: ${advantage} has ${Math.abs(diff)} day(s) more rest (home ${hr} vs away ${ar}).`;
}

function teamLabel(side) {
  if (!side) return 'unknown';
  const abbr = side.teamAbbr;
  if (abbr && abbr !== 'null') return String(abbr);
  const name = side.teamName;
  if (name && name !== 'null') return String(name);
  return side.teamId != null ? `team ${side.teamId}` : 'unknown';
}

function describeNetDelta(home, away) {
  const hn = home?.netRating;
  const an = away?.netRating;
  if (hn == null || an == null) return 'Net Rating gap: not computable.';
  const gap = hn - an;
  const favorite = teamLabel(gap > 0 ? home : away);
  return `Net Rating gap: ${favorite} +${fmt(Math.abs(gap))} (home ${fmt(hn)} vs away ${fmt(an)}).`;
}

function describePaceDelta(home, away) {
  const hp = home?.pace;
  const ap = away?.pace;
  if (hp == null || ap == null) return 'Pace gap: not computable.';
  const combined = (hp + ap) / 2;
  const gap = Math.abs(hp - ap);
  let tempo = 'average tempo';
  if (combined > 102) tempo = 'fast tempo';
  else if (combined < 96) tempo = 'slow tempo';
  const clash = gap > 4 ? ' — PACE CLASH (>4 possessions gap)' : '';
  return `Pace: combined ${fmt(combined)} (${tempo}); gap ${fmt(gap)} possessions${clash}.`;
}

function describeMarketOdds(marketOdds) {
  if (!marketOdds) return 'MARKET ODDS: not provided.';
  const parts = ['MARKET ODDS:'];
  if (marketOdds.moneyline) {
    const ml = marketOdds.moneyline;
    parts.push(`  ML Home ${ml.home}${ml.homeImplied != null ? ` (Implied: ${fmt(ml.homeImplied)}%)` : ''}`);
    parts.push(`  ML Away ${ml.away}${ml.awayImplied != null ? ` (Implied: ${fmt(ml.awayImplied)}%)` : ''}`);
  }
  if (marketOdds.spread) {
    const sp = marketOdds.spread;
    parts.push(`  Spread Home ${sp.home}${sp.homePrice != null ? ` (${sp.homePrice})` : ''}`);
    parts.push(`  Spread Away ${sp.away}${sp.awayPrice != null ? ` (${sp.awayPrice})` : ''}`);
  }
  if (marketOdds.total) {
    const t = marketOdds.total;
    parts.push(`  Total ${t.line}${t.overPrice != null ? ` (Over ${t.overPrice} / Under ${t.underPrice})` : ''}`);
  }
  return parts.join('\n');
}

function describeDataQuality(context_meta) {
  if (!context_meta) return null;
  const flags = Array.isArray(context_meta.staleFlags) ? context_meta.staleFlags : [];
  if (!flags.length && context_meta.overallCompleteness === 1) return null;
  const pct = Math.round((context_meta.overallCompleteness ?? 0) * 100);
  const flagsLine = flags.length ? ` Flags: ${flags.join(', ')}.` : '';
  return `DATA QUALITY: completeness ${pct}%.${flagsLine}`;
}

/**
 * Serialise the NBA context object into a single deterministic text block
 * the LLM consumes. Keep ordering stable — the system prompt references
 * "MARKET ODDS block" by name.
 */
export function serializeNbaContext({ context, marketOdds }) {
  if (!context) return 'No NBA context provided.';
  const { season, gameDate, home, away, context_meta } = context;
  const dataQualityLine = describeDataQuality(context_meta);
  return [
    `H.E.X.A. NBA CONTEXT — ${gameDate} (Season ${season})`,
    '',
    describeNetDelta(home, away),
    describeRestDelta(home, away),
    describePaceDelta(home, away),
    '',
    describeTeamBlock('HOME', home),
    '',
    describeTeamBlock('AWAY', away),
    '',
    describeMarketOdds(marketOdds),
    ...(dataQualityLine ? ['', dataQualityLine] : []),
  ].join('\n');
}

// ── JSON parser — local copy so we don't import from frozen oracle.js ────────

function cleanJsonResponse(text) {
  if (!text) return text;
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/^`+|`+$/g, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

function repairJson(text) {
  let s = text;
  s = s.replace(/[“”]/g, '"');
  s = s.replace(/[‘’]/g, "'");
  s = s.replace(/[—–]/g, '-');
  s = s.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, inner) => {
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
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

function parseResponse(rawText) {
  const cleaned = cleanJsonResponse(rawText);
  if (!cleaned || !cleaned.startsWith('{')) {
    return { data: null, parseError: false };
  }
  try {
    return { data: JSON.parse(cleaned), parseError: false };
  } catch {
    try {
      return { data: JSON.parse(repairJson(cleaned)), parseError: false };
    } catch {
      return { data: null, parseError: true };
    }
  }
}

// ── User-message builders ─────────────────────────────────────────────────────

function buildAnalysisUserMessage({ gameDescription, lang, riskProfile, userBankroll, contextText, marketOddsHint }) {
  const langTag = lang === 'es'
    ? '\n\nIMPORTANT: Responde TODO el contenido de texto en español. Todos los campos: oracle_report, hexa_hunch, alert_flags, descripciones de picks, todo en español.'
    : '';
  const bankrollLine = userBankroll != null
    ? `\nUSER BANKROLL: $${Number(userBankroll).toFixed(2)} — You MUST compute the Kelly stake and include kelly_recommendation in your JSON output.`
    : '';
  const oddsHint = marketOddsHint ? `\n${marketOddsHint}` : '';
  return (
    `Analyze NBA game: ${gameDescription}\n` +
    `Bet focus: all types — select the highest-value bet type based on the data.\n` +
    `Risk: ${riskProfile ?? 'balanced'}${bankrollLine}${oddsHint}\n\n` +
    `CONTEXT:\n${contextText}` +
    langTag
  );
}

function buildChatUserMessage({ gameDescription, question, contextText, lang }) {
  const langTag = lang === 'es'
    ? '\n\n(Responde en español.)'
    : '\n\n(Respond in English.)';
  return (
    `Game: ${gameDescription}\n\n` +
    `DATA:\n${contextText}\n\n` +
    `ADMIN QUESTION: ${question}` +
    langTag
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * analyzeNbaGame — single-game NBA pick.
 *
 * @param {object} opts
 * @param {object} opts.context           — output of buildNbaGameContext()
 * @param {string} opts.gameDescription   — "LAL @ BOS — 2026-05-14"
 * @param {string} [opts.lang]            — 'en' | 'es'
 * @param {string} [opts.riskProfile]     — 'conservative' | 'balanced' | 'aggressive'
 * @param {number} [opts.userBankroll]    — triggers Kelly calc
 * @param {object} [opts.marketOdds]      — { moneyline, spread, total } structured
 * @param {string} [opts.engine]          — 'deep' | 'premium' | 'haiku' (default 'deep')
 * @param {string} [opts.model]           — explicit model id override
 * @param {number} [opts.timeoutMs]       — request timeout (default 120 s)
 */
export async function analyzeNbaGame({
  context,
  gameDescription,
  lang = 'en',
  riskProfile = 'balanced',
  userBankroll,
  marketOdds,
  engine = 'deep',
  model,
  timeoutMs = 120_000,
}) {
  const contextText = serializeNbaContext({ context, marketOdds });
  const userMessage = buildAnalysisUserMessage({
    gameDescription,
    lang,
    riskProfile,
    userBankroll,
    contextText,
  });

  const cfg = NBA_MODELS[engine] ?? NBA_MODELS.deep;
  const modelId = model || cfg.id;

  const response = await anthropic.messages.create(
    {
      model: modelId,
      max_tokens: cfg.maxTokens,
      system: NBA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    },
    { timeout: timeoutMs },
  );

  const rawText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const { data, parseError } = parseResponse(rawText);

  return {
    provider: 'anthropic',
    model: modelId,
    data,
    rawText,
    parseError,
    stopReason: response.stop_reason,
    usage: response.usage,
  };
}

/**
 * analyzeNbaChat — conversational mode for admins. Plain text response.
 */
export async function analyzeNbaChat({
  context,
  gameDescription,
  question,
  conversationHistory = [],
  lang = 'en',
  marketOdds,
  model,
  timeoutMs = 90_000,
}) {
  const contextText = serializeNbaContext({ context, marketOdds });
  const modelId = model || NBA_MODELS.haiku.id;

  const messages = [];
  for (const turn of conversationHistory) {
    if (turn?.question) messages.push({ role: 'user', content: turn.question });
    if (turn?.answer) messages.push({ role: 'assistant', content: turn.answer });
  }

  const currentMessage = buildChatUserMessage({ gameDescription, question, contextText, lang });
  messages.push({ role: 'user', content: currentMessage });

  const response = await anthropic.messages.create(
    {
      model: modelId,
      max_tokens: 1200,
      system: NBA_CHAT_PROMPT,
      messages,
    },
    { timeout: timeoutMs },
  );

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  return {
    provider: 'anthropic',
    model: modelId,
    text,
    usage: response.usage,
  };
}
