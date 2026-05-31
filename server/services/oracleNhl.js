/**
 * oracleNhl.js — NHL branch of the Oracle.
 *
 * Mirrors oracleNfl.js (which mirrors the frozen MLB oracle.js), isolated in
 * its own module with its own Anthropic client so the frozen Oracle never
 * changes. `context` is the object returned by buildNhlGameContext().
 *
 * Public API:
 *   analyzeNhlGame({ context, gameDescription, lang, riskProfile,
 *                    userBankroll, marketOdds, engine, model })
 *     → { provider, model, data, rawText, parseError, stopReason, usage }
 *   analyzeNhlChat({ context, gameDescription, question, conversationHistory,
 *                    lang, marketOdds, model })
 *     → { provider, model, text, usage }
 *   serializeNhlContext({ context, marketOdds }) → string
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

import { NHL_CHAT_PROMPT, NHL_SYSTEM_PROMPT } from '../prompts/oracle-nhl-prompts.js';

dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NHL_MODELS = {
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
  return side.teamId != null ? `team ${side.teamId}` : 'unknown';
}

function describeGoalieStatus(side) {
  const g = side?.goalieStatus;
  if (!g) return 'Goalie: no confirmed/flagged goalie in context (verify starter ~1hr pre-game).';
  return `Goalie: ${g.playerName ?? 'starter'} listed ${g.status ?? g.statusKey ?? 'uncertain'} — backup risk, line impact.`;
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

function describeSpecialTeamsLine(side) {
  if (side?.ppPct != null || side?.pkPct != null) {
    return `  Special teams: PP ${fmt(side.ppPct, 1)}% | PK ${fmt(side.pkPct, 1)}%`;
  }
  return '  Special teams: PP%/PK% unavailable (using goal differential as proxy)';
}

function describeStrengthLine(side) {
  return `  Strength: GF/g ${fmt(side?.goalsForPerGame, 2)} | GA/g ${fmt(side?.goalsAgainstPerGame, 2)} | goal diff ${side?.goalDiff ?? 'n/a'} | pts% ${side?.pointsPct != null ? fmt(side.pointsPct * 100, 1) + '%' : 'n/a'}`;
}

function describeScheduleLine(side) {
  const rest = side?.restDays;
  const tags = [];
  if (side?.isBackToBack) tags.push('BACK-TO-BACK (-fatigue/backup-goalie risk)');
  const restStr = rest != null ? `${rest} days rest` : 'rest n/a';
  return `  Schedule: ${restStr}${tags.length ? ` — ${tags.join(', ')}` : ''}`;
}

function describeTeamBlock(label, side) {
  if (!side) return `${label}: data unavailable.`;
  const recent = side.recentForm;
  const recentLine = recent
    ? `last ${recent.games?.length ?? 0}: ${recent.record}, avg ${fmt(recent.avgGoalsFor, 2)} GF` +
      (recent.avgGoalsAgainst != null ? ` / ${fmt(recent.avgGoalsAgainst, 2)} GA` : '')
    : 'recent form: data unavailable';
  return [
    `${label} — ${teamLabel(side)} (${side.conference ?? '?'} ${side.division ?? ''})`.trim(),
    `  Record: ${side.record ?? 'n/a'} (${side.points ?? 'n/a'} pts)`,
    describeStrengthLine(side),
    describeSpecialTeamsLine(side),
    describeScheduleLine(side),
    `  ${recentLine}`,
    `  ${describeGoalieStatus(side)}`,
    describeInjuriesBlock(side),
  ].join('\n');
}

function describeStrengthDelta(home, away) {
  const hd = home?.goalDiff, adp = away?.goalDiff;
  if (hd == null || adp == null) {
    const hg = home?.goalsForPerGame, ag = away?.goalsForPerGame;
    if (hg == null || ag == null) return 'Team-strength gap: not computable (goal differential + GF/g both missing).';
  }
  const gap = (hd ?? 0) - (adp ?? 0);
  const fav = teamLabel(gap > 0 ? home : away);
  return `Team-strength gap: ${fav} +${Math.abs(gap)} season goal differential (home ${hd ?? 'n/a'} vs away ${adp ?? 'n/a'}).`;
}

function describeRestDelta(home, away) {
  const hr = home?.restDays;
  const ar = away?.restDays;
  if (hr == null || ar == null) return 'Rest delta: not computable.';
  const diff = hr - ar;
  if (diff === 0) return `Rest delta: even (${hr} days both sides).`;
  const adv = diff > 0 ? teamLabel(home) : teamLabel(away);
  return `Rest delta: ${adv} has ${Math.abs(diff)} day(s) more rest (home ${hr} vs away ${ar}).`;
}

function describeMarketOdds(marketOdds) {
  if (!marketOdds) return 'MARKET ODDS: not provided.';
  const parts = ['MARKET ODDS:'];
  if (marketOdds.moneyline) {
    const ml = marketOdds.moneyline;
    parts.push(`  ML Home ${ml.home}${ml.homeImplied != null ? ` (Implied: ${fmt(ml.homeImplied)}%)` : ''}`);
    parts.push(`  ML Away ${ml.away}${ml.awayImplied != null ? ` (Implied: ${fmt(ml.awayImplied)}%)` : ''}`);
  }
  if (marketOdds.puckLine) {
    const pl = marketOdds.puckLine;
    parts.push(`  Puck Line Home ${pl.home}${pl.homePrice != null ? ` (${pl.homePrice})` : ''}`);
    parts.push(`  Puck Line Away ${pl.away}${pl.awayPrice != null ? ` (${pl.awayPrice})` : ''}`);
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
 * Serialise the NHL context into a single deterministic text block. Keep
 * ordering stable — the system prompt references "MARKET ODDS block" by name.
 */
export function serializeNhlContext({ context, marketOdds }) {
  if (!context) return 'No NHL context provided.';
  const { season, gameDate, home, away, context_meta } = context;
  const dataQualityLine = describeDataQuality(context_meta);
  return [
    `H.E.X.A. NHL CONTEXT — ${gameDate} (Season ${season ?? 'n/a'})`,
    '',
    describeStrengthDelta(home, away),
    describeRestDelta(home, away),
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

function buildAnalysisUserMessage({ gameDescription, lang, riskProfile, userBankroll, contextText }) {
  const langTag = lang === 'es'
    ? '\n\nIMPORTANT: Responde TODO el contenido de texto en español. Todos los campos: oracle_report, hexa_hunch, alert_flags, descripciones de picks, todo en español.'
    : '';
  const bankrollLine = userBankroll != null
    ? `\nUSER BANKROLL: $${Number(userBankroll).toFixed(2)} — You MUST compute the Kelly stake and include kelly_recommendation in your JSON output.`
    : '';
  return (
    `Analyze NHL game: ${gameDescription}\n` +
    `Bet focus: moneyline first, then the ±1.5 puck line, then the total — select the highest-value bet type based on the data. No player props.\n` +
    `Risk: ${riskProfile ?? 'balanced'}${bankrollLine}\n\n` +
    `CONTEXT:\n${contextText}` +
    langTag
  );
}

function buildChatUserMessage({ gameDescription, question, contextText, lang }) {
  const langTag = lang === 'es' ? '\n\n(Responde en español.)' : '\n\n(Respond in English.)';
  return (
    `Game: ${gameDescription}\n\n` +
    `DATA:\n${contextText}\n\n` +
    `ADMIN QUESTION: ${question}` +
    langTag
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * analyzeNhlGame — single-game NHL pick.
 * @param {object} opts
 * @param {object} opts.context           — output of buildNhlGameContext()
 * @param {string} opts.gameDescription   — "TOR @ BOS — 2025-11-17"
 * @param {string} [opts.lang]            — 'en' | 'es'
 * @param {string} [opts.riskProfile]     — 'conservative' | 'balanced' | 'aggressive'
 * @param {number} [opts.userBankroll]    — triggers Kelly calc
 * @param {object} [opts.marketOdds]      — { moneyline, puckLine, total } structured
 * @param {string} [opts.engine]          — 'deep' | 'premium' | 'haiku' (default 'deep')
 * @param {string} [opts.model]           — explicit model id override
 * @param {number} [opts.timeoutMs]       — request timeout (default 120 s)
 */
export async function analyzeNhlGame({
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
  const contextText = serializeNhlContext({ context, marketOdds });
  const userMessage = buildAnalysisUserMessage({
    gameDescription,
    lang,
    riskProfile,
    userBankroll,
    contextText,
  });

  const cfg = NHL_MODELS[engine] ?? NHL_MODELS.deep;
  const modelId = model || cfg.id;

  const response = await anthropic.messages.create(
    {
      model: modelId,
      max_tokens: cfg.maxTokens,
      system: NHL_SYSTEM_PROMPT,
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
 * analyzeNhlChat — conversational mode for admins. Plain text response.
 */
export async function analyzeNhlChat({
  context,
  gameDescription,
  question,
  conversationHistory = [],
  lang = 'en',
  marketOdds,
  model,
  timeoutMs = 90_000,
}) {
  const contextText = serializeNhlContext({ context, marketOdds });
  const modelId = model || NHL_MODELS.haiku.id;

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
      system: NHL_CHAT_PROMPT,
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
