/**
 * oracleNfl.js — NFL branch of the Oracle.
 *
 * Mirrors oracleNba.js (which mirrors the frozen MLB oracle.js), isolated in
 * its own module with its own Anthropic client so the frozen Oracle never
 * changes. `context` is the object returned by buildNflGameContext().
 *
 * Public API:
 *   analyzeNflGame({ context, gameDescription, lang, riskProfile,
 *                    userBankroll, marketOdds, engine, model })
 *     → { provider, model, data, rawText, parseError, stopReason, usage }
 *   analyzeNflChat({ context, gameDescription, question, conversationHistory,
 *                    lang, marketOdds, model })
 *     → { provider, model, text, usage }
 *   serializeNflContext({ context, marketOdds }) → string
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

import { NFL_CHAT_PROMPT, NFL_SYSTEM_PROMPT } from '../prompts/oracle-nfl-prompts.js';

dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NFL_MODELS = {
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

function describeQbStatus(side) {
  const qb = side?.qbStatus;
  if (!qb) return 'QB: no flagged QB issue in context (assume starter active — verify inactives).';
  return `QB: ${qb.playerName ?? 'starter'} listed ${qb.status ?? qb.statusKey ?? 'uncertain'} — major line impact, confirm before betting.`;
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

function describeTeamStrengthLine(side) {
  // EPA when present; otherwise point-differential / PF-PA per game as the proxy.
  if (side?.epaOff != null || side?.epaDef != null) {
    let line = `  EPA/play: off ${fmt(side.epaOff, 3)} | def ${fmt(side.epaDef, 3)}` +
      (side.successRateOff != null ? ` | success off ${fmt(side.successRateOff * 100)}%` : '') +
      (side.proe != null ? ` | PROE ${fmt(side.proe, 1)}` : '');
    // Opponent-adjusted (strength-of-schedule) EPA — separates real quality from
    // numbers inflated/suppressed by an easy/hard slate. Prefer this read.
    if (side.epaOffAdj != null || side.epaDefAdj != null) {
      line += `\n  EPA/play (opp-adjusted, SOS): off ${fmt(side.epaOffAdj, 3)} | def ${fmt(side.epaDefAdj, 3)}` +
        (side.sosOff != null ? ` | SOS faced (def EPA, lower=tougher) ${fmt(side.sosOff, 3)}` : '');
    }
    return line;
  }
  return `  Team strength (proxy — EPA unavailable): PF/g ${fmt(side?.pointsForPerGame)} | PA/g ${fmt(side?.pointsAgainstPerGame)} | point diff ${side?.pointDiff ?? 'n/a'}`;
}

function describeEfficiencyLine(side) {
  const parts = [];
  if (side?.redZoneTdPctOff != null)  parts.push(`RZ TD% off ${fmt(side.redZoneTdPctOff * 100)}%`);
  if (side?.redZoneTdPctDef != null)  parts.push(`def ${fmt(side.redZoneTdPctDef * 100)}%`);
  if (side?.thirdDownConvOff != null) parts.push(`3rd-dn off ${fmt(side.thirdDownConvOff * 100)}%`);
  if (side?.thirdDownConvDef != null) parts.push(`def ${fmt(side.thirdDownConvDef * 100)}%`);
  if (side?.sackRateOff != null)      parts.push(`sack-allowed ${fmt(side.sackRateOff * 100)}%`);
  if (side?.sackRateDef != null)      parts.push(`sack-forced ${fmt(side.sackRateDef * 100)}%`);
  return parts.length ? `  Efficiency: ${parts.join(' | ')}` : null;
}

function describeScheduleLine(side) {
  const rest = side?.restDays;
  const tags = [];
  if (side?.isOffBye) tags.push('OFF BYE (+prep edge)');
  if (side?.isShortWeek) tags.push('SHORT WEEK (-fatigue/prep)');
  const fat = side?.scheduleFatigue;
  if (fat?.gamesLast14d >= 3 && fat?.roadGamesLast14d >= 2) tags.push(`FATIGUE (${fat.gamesLast14d}g/14d, ${fat.roadGamesLast14d} road)`);
  else if (fat?.shortRestGames >= 1) tags.push(`SHORT REST (${fat.shortRestGames} game(s) on ≤6 days)`);
  const restStr = rest != null ? `${rest} days rest` : 'rest n/a';
  return `  Schedule: ${restStr}${tags.length ? ` — ${tags.join(', ')}` : ''}`;
}

function describeBackupQb(side) {
  if (!side?.backupQb) return null;
  const bq = side.backupQb;
  return `  Backup QB on roster: ${bq.playerName ?? 'unknown'} (${bq.status ?? 'status unknown'})`;
}

function describeTeamBlock(label, side) {
  if (!side) return `${label}: data unavailable.`;
  const recent = side.recentForm;
  const recentLine = recent
    ? `last ${recent.games?.length ?? 0}: ${recent.record}, avg ${fmt(recent.avgPointsFor)} pts for` +
      (recent.avgPointsAgainst != null ? ` / ${fmt(recent.avgPointsAgainst)} pts allowed` : '')
    : 'recent form: data unavailable';
  const effLine = describeEfficiencyLine(side);
  const backupLine = describeBackupQb(side);
  return [
    `${label} — ${teamLabel(side)} (${side.conference ?? '?'} ${side.division ?? ''})`.trim(),
    `  Record: ${side.record ?? 'n/a'}`,
    describeTeamStrengthLine(side),
    ...(effLine ? [effLine] : []),
    describeScheduleLine(side),
    `  ${recentLine}`,
    `  ${describeQbStatus(side)}`,
    ...(backupLine ? [backupLine] : []),
    describeInjuriesBlock(side),
  ].join('\n');
}

function describeStrengthDelta(home, away) {
  // Prefer EPA diff; fall back to point differential per game.
  if (home?.epaOff != null && away?.epaDef != null && home?.epaDef != null && away?.epaOff != null) {
    const homeNet = (home.epaOff - away.epaDef);
    const awayNet = (away.epaOff - home.epaDef);
    const gap = homeNet - awayNet;
    const fav = teamLabel(gap > 0 ? home : away);
    return `EPA matchup: ${fav} edge ${fmt(Math.abs(gap), 3)} (home net ${fmt(homeNet, 3)} vs away net ${fmt(awayNet, 3)}).`;
  }
  const hd = home?.pointDiff, adp = away?.pointDiff;
  if (hd == null || adp == null) return 'Team-strength gap: not computable (EPA + point differential both missing).';
  const gap = hd - adp;
  const fav = teamLabel(gap > 0 ? home : away);
  return `Team-strength gap (point-diff proxy): ${fav} +${fmt(Math.abs(gap), 0)} season point differential (home ${hd} vs away ${adp}).`;
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

function describeEfficiencyDeltas(home, away) {
  const parts = [];
  const rzH = home?.redZoneTdPctOff, rzA = away?.redZoneTdPctOff;
  const rzHD = home?.redZoneTdPctDef, rzAD = away?.redZoneTdPctDef;
  if (rzH != null && rzA != null) {
    const gap = rzH - rzA;
    const fav = Math.abs(gap) >= 0.05 ? ` [${teamLabel(gap > 0 ? home : away)} edge ${fmt(Math.abs(gap) * 100)}%]` : '';
    parts.push(`RZ TD%: home ${fmt(rzH * 100)}% off / ${fmt(rzHD * 100)}% def | away ${fmt(rzA * 100)}% off / ${fmt(rzAD * 100)}% def${fav}`);
  }
  const td3H = home?.thirdDownConvOff, td3A = away?.thirdDownConvOff;
  const td3HD = home?.thirdDownConvDef, td3AD = away?.thirdDownConvDef;
  if (td3H != null && td3A != null) {
    const gap = td3H - td3A;
    const fav = Math.abs(gap) >= 0.04 ? ` [${teamLabel(gap > 0 ? home : away)} edge ${fmt(Math.abs(gap) * 100)}%]` : '';
    parts.push(`3rd-down: home ${fmt(td3H * 100)}% off / ${fmt(td3HD * 100)}% def | away ${fmt(td3A * 100)}% off / ${fmt(td3AD * 100)}% def${fav}`);
  }
  const skH = home?.sackRateDef, skA = away?.sackRateDef;
  const skHO = home?.sackRateOff, skAO = away?.sackRateOff;
  if (skH != null && skA != null) {
    const gap = skH - skA;
    const fav = Math.abs(gap) >= 0.02 ? ` [${teamLabel(gap > 0 ? home : away)} pass-rush edge]` : '';
    parts.push(`Sack rate: home forced ${fmt(skH * 100)}% / allowed ${fmt(skHO * 100)}% | away forced ${fmt(skA * 100)}% / allowed ${fmt(skAO * 100)}%${fav}`);
  }
  if (!parts.length) return null;
  return `EFFICIENCY DELTAS:\n${parts.map(p => `  ${p}`).join('\n')}`;
}

function describeWeather(weather) {
  if (!weather) return 'WEATHER: not provided.';
  const surfaceLine = weather.surface ? ` Surface: ${weather.surface}.` : '';
  const altLine = weather.altitude != null && weather.altitude > 2000 ? ` Altitude: ${weather.altitude}ft (elevation bonus applies).` : '';
  if (weather.dome) return `VENUE: dome (${weather.stadium ?? 'indoor'}) — weather-neutral.${surfaceLine}${altLine}`;
  if (weather.unavailable) return `VENUE: outdoor (${weather.stadium ?? 'n/a'}) — forecast unavailable.${surfaceLine}${altLine}`;
  const flags = Array.isArray(weather.analysis) && weather.analysis.length ? ` Flags: ${weather.analysis.join('; ')}.` : '';
  return `VENUE/WEATHER (outdoor, ${weather.stadium ?? 'n/a'}): ${fmt(weather.temperature, 0)}°F, wind ${fmt(weather.windSpeed, 0)}mph, precip ${fmt(weather.precipitationProbability, 0)}%.${surfaceLine}${altLine}${flags}`;
}

function describeMarketOdds(marketOdds) {
  if (!marketOdds) return 'MARKET ODDS: not provided.';
  const parts = ['MARKET ODDS:'];
  if (marketOdds.spread) {
    const sp = marketOdds.spread;
    parts.push(`  Spread Home ${sp.home}${sp.homePrice != null ? ` (${sp.homePrice})` : ''}`);
    parts.push(`  Spread Away ${sp.away}${sp.awayPrice != null ? ` (${sp.awayPrice})` : ''}`);
  }
  if (marketOdds.total) {
    const t = marketOdds.total;
    parts.push(`  Total ${t.line}${t.overPrice != null ? ` (Over ${t.overPrice} / Under ${t.underPrice})` : ''}`);
  }
  if (marketOdds.moneyline) {
    const ml = marketOdds.moneyline;
    parts.push(`  ML Home ${ml.home}${ml.homeImplied != null ? ` (Implied: ${fmt(ml.homeImplied)}%)` : ''}`);
    parts.push(`  ML Away ${ml.away}${ml.awayImplied != null ? ` (Implied: ${fmt(ml.awayImplied)}%)` : ''}`);
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
 * Serialise the NFL context into a single deterministic text block. Keep
 * ordering stable — the system prompt references "MARKET ODDS block" by name.
 */
export function serializeNflContext({ context, marketOdds }) {
  if (!context) return 'No NFL context provided.';
  const { season, gameDate, home, away, weather, context_meta } = context;
  const dataQualityLine = describeDataQuality(context_meta);
  const effDeltas = describeEfficiencyDeltas(home, away);
  return [
    `H.E.X.A. NFL CONTEXT — ${gameDate} (Season ${season ?? 'n/a'})`,
    '',
    describeStrengthDelta(home, away),
    describeRestDelta(home, away),
    ...(effDeltas ? ['', effDeltas] : []),
    '',
    describeTeamBlock('HOME', home),
    '',
    describeTeamBlock('AWAY', away),
    '',
    describeWeather(weather),
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
    `Analyze NFL game: ${gameDescription}\n` +
    `Bet focus: spread first, then total, then moneyline — select the highest-value bet type based on the data. Respect key numbers 3 and 7. No player props.\n` +
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
 * analyzeNflGame — single-game NFL pick.
 * @param {object} opts
 * @param {object} opts.context           — output of buildNflGameContext()
 * @param {string} opts.gameDescription   — "BUF @ KC — 2024-11-17"
 * @param {string} [opts.lang]            — 'en' | 'es'
 * @param {string} [opts.riskProfile]     — 'conservative' | 'balanced' | 'aggressive'
 * @param {number} [opts.userBankroll]    — triggers Kelly calc
 * @param {object} [opts.marketOdds]      — { spread, total, moneyline } structured
 * @param {string} [opts.engine]          — 'deep' | 'premium' | 'haiku' (default 'deep')
 * @param {string} [opts.model]           — explicit model id override
 * @param {number} [opts.timeoutMs]       — request timeout (default 120 s)
 */
export async function analyzeNflGame({
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
  const contextText = serializeNflContext({ context, marketOdds });
  const userMessage = buildAnalysisUserMessage({
    gameDescription,
    lang,
    riskProfile,
    userBankroll,
    contextText,
  });

  const cfg = NFL_MODELS[engine] ?? NFL_MODELS.deep;
  const modelId = model || cfg.id;

  const response = await anthropic.messages.create(
    {
      model: modelId,
      max_tokens: cfg.maxTokens,
      system: NFL_SYSTEM_PROMPT,
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
 * analyzeNflChat — conversational mode for admins. Plain text response.
 */
export async function analyzeNflChat({
  context,
  gameDescription,
  question,
  conversationHistory = [],
  lang = 'en',
  marketOdds,
  model,
  timeoutMs = 90_000,
}) {
  const contextText = serializeNflContext({ context, marketOdds });
  const modelId = model || NFL_MODELS.haiku.id;

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
      system: NFL_CHAT_PROMPT,
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
