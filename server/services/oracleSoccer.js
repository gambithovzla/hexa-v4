/**
 * oracleSoccer.js — Soccer branch of the Oracle.
 *
 * Mirrors oracleNhl.js (which mirrors the frozen MLB oracle.js), isolated in
 * its own module with its own Anthropic client so the frozen Oracle never
 * changes. `context` is the object returned by buildSoccerGameContext().
 *
 * Public API:
 *   analyzeSoccerGame({ context, gameDescription, lang, riskProfile,
 *                       userBankroll, marketOdds, engine, model })
 *     → { provider, model, data, rawText, parseError, stopReason, usage }
 *   analyzeSoccerChat({ context, gameDescription, question, conversationHistory,
 *                       lang, marketOdds, model })
 *     → { provider, model, text, usage }
 *   serializeSoccerContext({ context, marketOdds }) → string
 *
 * Soccer-specific serialisation differences vs NHL:
 *   - threeWay odds (home/draw/away) instead of moneyline + puck line
 *   - BTTS market
 *   - league style profile block (avgGoals, drawPct, style)
 *   - no weather block
 *   - xG/xGA surfaced when non-null; labelled "unavailable" when null
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

import { SOCCER_CHAT_PROMPT, SOCCER_SYSTEM_PROMPT } from '../prompts/oracle-soccer-prompts.js';

dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SOCCER_MODELS = {
  deep:    { id: 'claude-sonnet-4-6',         maxTokens: 8000 },
  premium: { id: 'claude-opus-4-7',           maxTokens: 10000 },
  haiku:   { id: 'claude-haiku-4-5-20251001', maxTokens: 1200 },
};

// ── Context serialisation ─────────────────────────────────────────────────────

function fmt(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return 'n/a';
  return Number(n).toFixed(digits);
}

function teamLabel(side) {
  if (!side) return 'unknown';
  const abbr = side.teamAbbr;
  if (abbr && abbr !== 'null') return String(abbr);
  const name = side.teamName;
  if (name && name !== 'null') return String(name);
  return 'unknown';
}

function describeRecentForm(side) {
  const form = side?.recentForm;
  if (!form) return '  Recent form: data unavailable';
  const record = form.record ?? form.recent ?? 'n/a';
  const gf = form.avgGoalsFor != null ? ` | avg GF ${fmt(form.avgGoalsFor, 2)}` : '';
  const ga = form.avgGoalsAgainst != null ? ` / GA ${fmt(form.avgGoalsAgainst, 2)}` : '';
  const streak = form.recent ? ` [${form.recent}]` : '';
  return `  Recent form: ${record}${streak}${gf}${ga}`;
}

function describeXgLine(side) {
  if (side?.xG != null || side?.xGA != null) {
    return `  xG: xG ${fmt(side.xG, 2)} | xGA ${fmt(side.xGA, 2)}`;
  }
  return '  xG: unavailable — using goal differential + league profile as proxy';
}

function describeStrengthLine(side) {
  const gf = side?.goalsFor != null ? `GF ${fmt(side.goalsFor / Math.max(1, (side.wins ?? 0) + (side.draws ?? 0) + (side.losses ?? 0)), 2)} avg` : 'GF n/a';
  return (
    `  Strength: record ${side?.wins ?? 'n/a'}W-${side?.draws ?? 'n/a'}D-${side?.losses ?? 'n/a'}L` +
    ` | pts ${side?.points ?? 'n/a'} | goal diff ${side?.goalDiff ?? 'n/a'}` +
    ` | GF ${side?.goalsFor ?? 'n/a'} GA ${side?.goalsAgainst ?? 'n/a'}`
  );
}

function describeAvailabilityLines(side) {
  const status = side.lineupStatus === 'confirmed'
    ? `confirmed${side.formation ? ` (${side.formation})` : ''}`
    : (side.lineupStatus ?? 'unknown — verify ~1hr pre-kick');
  const lines = [`  Lineup status: ${status}`];
  const susp = Array.isArray(side.suspensions) ? side.suspensions : [];
  const inj = Array.isArray(side.injuries) ? side.injuries : [];
  if (susp.length) {
    lines.push(`  Suspended (OUT): ${susp.map(s => s.player).filter(Boolean).join(', ')}`);
  }
  if (inj.length) {
    const top = inj.slice(0, 6).map(i => `${i.player}${i.reason ? ` (${i.reason})` : ''}`).filter(Boolean);
    lines.push(`  Injuries/doubts: ${top.join('; ')}`);
  }
  return lines;
}

function describeTeamBlock(label, side) {
  if (!side) return `${label}: data unavailable.`;
  return [
    `${label} — ${teamLabel(side)}`,
    describeStrengthLine(side),
    describeXgLine(side),
    describeRecentForm(side),
    ...describeAvailabilityLines(side),
  ].join('\n');
}

function describeLeagueProfile(leagueMeta) {
  if (!leagueMeta) return 'LEAGUE PROFILE: data unavailable.';
  return [
    `LEAGUE PROFILE — ${leagueMeta.name} (${leagueMeta.country})`,
    `  Avg goals/game: ${fmt(leagueMeta.avgGoals, 2)} | Draw rate: ${fmt((leagueMeta.drawPct ?? 0) * 100, 1)}%`,
    `  Style: ${leagueMeta.style ?? 'n/a'}`,
    `  Season: ${leagueMeta.season ?? 'n/a'}`,
  ].join('\n');
}

function describeStrengthDelta(home, away) {
  const hd = home?.goalDiff, ad = away?.goalDiff;
  if (hd == null || ad == null) return 'Team-strength gap: not computable (goal differential missing).';
  const gap = hd - ad;
  const fav = teamLabel(gap > 0 ? home : away);
  return `Team-strength gap: ${fav} +${Math.abs(gap)} season goal differential (home ${hd} vs away ${ad}).`;
}

function describeMarketOdds(marketOdds) {
  if (!marketOdds) return 'MARKET ODDS: not provided.';
  const parts = ['MARKET ODDS (1X2 + Over/Under + BTTS):'];
  if (marketOdds.threeWay) {
    const tw = marketOdds.threeWay;
    const homeImp = tw.homeImplied != null ? ` (Implied: ${fmt(tw.homeImplied, 1)}%)` : '';
    const drawImp = tw.drawImplied != null ? ` (Implied: ${fmt(tw.drawImplied, 1)}%)` : '';
    const awayImp = tw.awayImplied != null ? ` (Implied: ${fmt(tw.awayImplied, 1)}%)` : '';
    parts.push(`  1X2 Home ${tw.home ?? 'n/a'}${homeImp}`);
    parts.push(`  1X2 Draw ${tw.draw ?? 'n/a'}${drawImp}`);
    parts.push(`  1X2 Away ${tw.away ?? 'n/a'}${awayImp}`);
  }
  if (marketOdds.total) {
    const t = marketOdds.total;
    const over  = t.overPrice  != null ? ` (Over ${t.overPrice})`  : '';
    const under = t.underPrice != null ? ` / Under ${t.underPrice}` : '';
    parts.push(`  Total ${t.line ?? 'n/a'}${over}${under}`);
  }
  if (marketOdds.btts) {
    const b = marketOdds.btts;
    parts.push(`  BTTS Yes ${b.yes ?? 'n/a'} / No ${b.no ?? 'n/a'}`);
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
 * Serialise the soccer context into a deterministic text block.
 */
export function serializeSoccerContext({ context, marketOdds }) {
  if (!context) return 'No soccer context provided.';
  const { league, leagueMeta, gameDate, home, away, context_meta } = context;
  const dataQualityLine = describeDataQuality(context_meta);
  return [
    `H.E.X.A. SOCCER CONTEXT — ${gameDate} (${league ?? 'unknown league'})`,
    '',
    describeLeagueProfile(leagueMeta),
    '',
    describeStrengthDelta(home, away),
    '',
    describeTeamBlock('HOME', home),
    '',
    describeTeamBlock('AWAY', away),
    '',
    describeMarketOdds(marketOdds),
    ...(dataQualityLine ? ['', dataQualityLine] : []),
  ].join('\n');
}

// ── JSON parser — local copy so we don't import from frozen oracle.js ─────────

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
  s = s.replace(/[""]/g, '"');
  s = s.replace(/['']/g, "'");
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

function buildAnalysisUserMessage({ gameDescription, lang, riskProfile, userBankroll, contextText }) {
  const langTag = lang === 'es'
    ? '\n\nIMPORTANT: Responde TODO el contenido de texto en español. Todos los campos: oracle_report, hexa_hunch, alert_flags, descripciones de picks, todo en español.'
    : '';
  const bankrollLine = userBankroll != null
    ? `\nUSER BANKROLL: $${Number(userBankroll).toFixed(2)} — You MUST compute the Kelly stake and include kelly_recommendation in your JSON output.`
    : '';
  return (
    `Analyze soccer match: ${gameDescription}\n` +
    `Bet focus: 1X2 (Home/Draw/Away) first, then Over/Under 2.5, then BTTS — select the highest-value bet type based on the data. No player props.\n` +
    `Risk: ${riskProfile ?? 'balanced'}${bankrollLine}\n\n` +
    `CONTEXT:\n${contextText}` +
    langTag
  );
}

function buildChatUserMessage({ gameDescription, question, contextText, lang }) {
  const langTag = lang === 'es' ? '\n\n(Responde en español.)' : '\n\n(Respond in English.)';
  return (
    `Match: ${gameDescription}\n\n` +
    `DATA:\n${contextText}\n\n` +
    `ADMIN QUESTION: ${question}` +
    langTag
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * analyzeSoccerGame — single-match soccer pick.
 * @param {object} opts
 * @param {object} opts.context           — output of buildSoccerGameContext()
 * @param {string} opts.gameDescription   — "Arsenal vs Chelsea — 2025-12-01 — Premier League"
 * @param {string} [opts.lang]            — 'en' | 'es'
 * @param {string} [opts.riskProfile]     — 'conservative' | 'balanced' | 'aggressive'
 * @param {number} [opts.userBankroll]    — triggers Kelly calc
 * @param {object} [opts.marketOdds]      — { threeWay, total, btts } structured
 * @param {string} [opts.engine]          — 'deep' | 'premium' | 'haiku' (default 'deep')
 * @param {string} [opts.model]           — explicit model id override
 * @param {number} [opts.timeoutMs]       — request timeout (default 120 s)
 */
export async function analyzeSoccerGame({
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
  const contextText = serializeSoccerContext({ context, marketOdds });
  const userMessage = buildAnalysisUserMessage({
    gameDescription,
    lang,
    riskProfile,
    userBankroll,
    contextText,
  });

  const cfg = SOCCER_MODELS[engine] ?? SOCCER_MODELS.deep;
  const modelId = model || cfg.id;

  const response = await anthropic.messages.create(
    {
      model: modelId,
      max_tokens: cfg.maxTokens,
      system: SOCCER_SYSTEM_PROMPT,
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
 * analyzeSoccerChat — conversational mode for admins. Plain text response.
 */
export async function analyzeSoccerChat({
  context,
  gameDescription,
  question,
  conversationHistory = [],
  lang = 'en',
  marketOdds,
  model,
  timeoutMs = 90_000,
}) {
  const contextText = serializeSoccerContext({ context, marketOdds });
  const modelId = model || SOCCER_MODELS.haiku.id;

  const messages = [];
  for (const turn of conversationHistory) {
    if (turn?.question) messages.push({ role: 'user', content: turn.question });
    if (turn?.answer)   messages.push({ role: 'assistant', content: turn.answer });
  }

  const currentMessage = buildChatUserMessage({ gameDescription, question, contextText, lang });
  messages.push({ role: 'user', content: currentMessage });

  const response = await anthropic.messages.create(
    {
      model: modelId,
      max_tokens: 1200,
      system: SOCCER_CHAT_PROMPT,
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
