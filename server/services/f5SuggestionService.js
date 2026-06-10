/**
 * f5SuggestionService.js — F5 (First 5 Innings) lens over the Oracle's moneyline pick.
 *
 * The frozen Oracle schema only allows Moneyline | RunLine | Over-Under | PlayerProp,
 * so a starter-driven thesis always lands as a full-game ML even when the bullpen is
 * the stated risk. This service runs AFTER the analysis (additive, zero frozen edits,
 * same pattern as pickAlignedMl.js) and flags when the thesis maps better to the F5
 * moneyline: starter-centric primary edge + late-inning exposure on the picked team.
 *
 * Informational only — never mutates the pick, never persists.
 *
 * Public API:
 *   evaluateF5Suggestion({ analysisData, gameData, features, lang })  — pure, unit-tested
 *   normalizeF5Event(rawEvent, homeName, awayName)                    — pure, unit-tested
 *   getF5MoneylineOdds({ eventId, homeName, awayName })               — event endpoint, never throws
 *   buildF5Suggestion({ analysisData, gameData, features, eventId, lang })
 */

import { tokenMatchesTeam } from '../pick-resolver.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const F5_MARKET_KEY = 'h2h_1st_5_innings';
const CACHE_TTL_MS = 5 * 60 * 1000;

const _oddsCache = new Map();

const STARTER_METRIC_RX = /xwoba|whiff|csw|chase\s*rate|rolling\s*woba|woba[_\s]*(?:against)?[_\s]*(?:7|14|21)d|active\s*spin|x?era\b|k%|k\s*rate|strikeout|ponche|abridor|starter|opener|ip\/start|salida/i;
const BULLPEN_RX = /bullpen|relie?ver|relevo|relevista|late[\s-]*inning|innings?\s+finales|cerrador|closer|setup/i;

function americanToImplied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function impliedToAmerican(p) {
  const x = Number(p);
  if (!Number.isFinite(x) || x <= 0 || x >= 1) return null;
  return x >= 0.5 ? -Math.round((x / (1 - x)) * 100) : Math.round(((1 - x) / x) * 100);
}

function lastName(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : '';
}

function extractKeyRiskSegment(report) {
  const text = String(report ?? '');
  const m = text.match(/(?:KEY\s*RISK|RIESGO(?:\s+CLAVE)?)\s*[:—–-]?\s*/i);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const end = rest.search(/EDGE\s*MATH|C[ÁA]LCULO\s+DE(?:L)?\s+EDGE/i);
  return (end === -1 ? rest : rest.slice(0, end)).trim() || null;
}

function pickedTeamSide(pickText, gameData) {
  const home = gameData?.teams?.home;
  const away = gameData?.teams?.away;
  if (!pickText || !home?.name || !away?.name) return null;
  const token = String(pickText)
    .replace(/\b(?:ML|Moneyline|A\s+ganar|gana)\b/gi, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  if (!token) return null;
  const isHome = tokenMatchesTeam(token, home.name, home.abbreviation);
  const isAway = tokenMatchesTeam(token, away.name, away.abbreviation);
  if (isHome === isAway) return null;
  return isHome ? 'home' : 'away';
}

/**
 * Pure heuristic. Suggests the F5 moneyline when:
 *   A) the Oracle pick is a full-game moneyline with an identifiable team, AND
 *   B) the PRIMARY EDGE is starter-centric (cites starter names/metrics, not bullpen), AND
 *   C) the picked team carries late-inning exposure (fatigued/compromised bullpen per
 *      raw usage data, alert_flags, or the KEY RISK section).
 */
export function evaluateF5Suggestion({ analysisData, gameData, features = {}, lang = 'es' } = {}) {
  if (!analysisData || !gameData?.teams) return null;
  const es = lang === 'es';

  const bestPick = analysisData.best_pick ?? {};
  const pickText = bestPick.detail ?? analysisData.master_prediction?.pick ?? '';
  const typeStr = String(bestPick.type ?? '');
  const isMoneyline = /moneyline/i.test(typeStr) || (!typeStr && /\bML\b|moneyline/i.test(pickText));
  if (!isMoneyline) return null;
  if (/\bf5\b|first\s+5|primeras?\s+5/i.test(pickText)) return null;

  const side = pickedTeamSide(pickText, gameData);
  if (!side) return null;

  const team = gameData.teams[side];
  const oppSide = side === 'home' ? 'away' : 'home';
  const report = String(analysisData.oracle_report ?? '');
  const primaryEdge = report.split(';')[0] ?? '';

  const pickedStarter = side === 'home' ? features.homePitcher : features.awayPitcher;
  const oppStarter = side === 'home' ? features.awayPitcher : features.homePitcher;
  const starterNames = [lastName(pickedStarter?.fullName), lastName(oppStarter?.fullName)].filter(n => n.length >= 3);

  const namesStarter = starterNames.some(n => new RegExp(`\\b${n}\\b`, 'i').test(primaryEdge));
  const citesStarterMetrics = STARTER_METRIC_RX.test(primaryEdge);
  const primaryEdgeIsBullpen = BULLPEN_RX.test(primaryEdge);
  const starterThesis = (namesStarter || citesStarterMetrics) && !primaryEdgeIsBullpen;

  const reasons = [];
  if (starterThesis) {
    reasons.push(es
      ? `Tesis centrada en el abridor${namesStarter ? ` (${starterNames.join(' / ')})` : ''} — el edge citado no cubre los innings de bullpen`
      : `Starter-centric thesis${namesStarter ? ` (${starterNames.join(' / ')})` : ''} — the cited edge does not cover bullpen innings`);
  }

  const usage = side === 'home' ? features.homeBullpenUsage : features.awayBullpenUsage;
  const ip3d = Number(usage?.bullpenIP_3d);
  let bullpenRisk = false;

  if (Number.isFinite(ip3d) && ip3d >= 10) {
    bullpenRisk = true;
    reasons.push(es
      ? `Bullpen de ${team.name}: ${ip3d} IP en 3 días — fatiga CRÍTICA`
      : `${team.name} bullpen: ${ip3d} IP in 3 days — CRITICAL fatigue`);
  } else if (Number.isFinite(ip3d) && ip3d >= 7) {
    bullpenRisk = true;
    reasons.push(es
      ? `Bullpen de ${team.name}: ${ip3d} IP en 3 días — fatiga moderada`
      : `${team.name} bullpen: ${ip3d} IP in 3 days — moderate fatigue`);
  }

  const b2bCount = Array.isArray(usage?.relievers)
    ? usage.relievers.filter(r => r?.isBackToBack).length
    : 0;
  if (b2bCount >= 2) {
    bullpenRisk = true;
    reasons.push(es
      ? `${b2bCount} relevistas de ${team.abbreviation ?? team.name} en back-to-back — profundidad comprometida`
      : `${b2bCount} ${team.abbreviation ?? team.name} relievers on back-to-back — depth compromised`);
  }

  const flags = Array.isArray(analysisData.alert_flags) ? analysisData.alert_flags : [];
  const teamToken = lastName(team.name).toLowerCase();
  const flagHit = flags.find(f => {
    const fl = String(f).toLowerCase();
    if (!/bullpen|relevo|relevista/.test(fl)) return false;
    if (!/fatigue|fatiga|back-to-back|compromis|exposed|expuest/.test(fl)) return false;
    return teamToken && fl.includes(teamToken);
  });
  if (flagHit && !bullpenRisk) {
    bullpenRisk = true;
    reasons.push(es ? `Alerta del Oracle: ${flagHit}` : `Oracle alert: ${flagHit}`);
  }

  const keyRisk = extractKeyRiskSegment(report);
  const keyRiskIsBullpen = keyRisk != null && BULLPEN_RX.test(keyRisk);
  if (keyRiskIsBullpen && !bullpenRisk) {
    bullpenRisk = true;
    reasons.push(es
      ? 'El KEY RISK del propio análisis es el bullpen / innings finales'
      : 'The analysis names the bullpen / late innings as its KEY RISK');
  }

  const suggested = starterThesis && bullpenRisk;
  if (!suggested) return { suggested: false };

  const label = `${team.abbreviation ?? team.name} ML F5`;
  return {
    suggested: true,
    side,
    team: { name: team.name, abbreviation: team.abbreviation ?? null },
    starter: pickedStarter?.fullName ?? null,
    suggestedPick: label,
    note: es
      ? 'El pick oficial sigue siendo el ML del juego completo — esta lente F5 aísla la tesis del abridor del riesgo de bullpen. Empate al 5to = push.'
      : 'The official pick remains the full-game ML — this F5 lens isolates the starter thesis from bullpen risk. Tied after 5 = push.',
    reasons,
    signals: {
      starterThesis,
      namesStarter,
      citesStarterMetrics,
      bullpenIp3d: Number.isFinite(ip3d) ? ip3d : null,
      backToBackRelievers: b2bCount,
      alertFlagHit: flagHit ?? null,
      keyRiskIsBullpen,
    },
  };
}

/**
 * Normalizes an Odds API event payload (h2h_1st_5_innings market) into consensus
 * American odds for home/away. Pure — matched by team name, top-5 books averaged
 * in implied-probability space.
 */
export function normalizeF5Event(event, homeName, awayName) {
  if (!event?.bookmakers?.length) return null;
  const homePrices = [];
  const awayPrices = [];
  for (const book of event.bookmakers.slice(0, 5)) {
    for (const market of book.markets ?? []) {
      if (market.key !== F5_MARKET_KEY) continue;
      for (const o of market.outcomes ?? []) {
        const implied = americanToImplied(o.price);
        if (implied == null) continue;
        if (tokenMatchesTeam(o.name, homeName, null)) homePrices.push(implied);
        else if (tokenMatchesTeam(o.name, awayName, null)) awayPrices.push(implied);
      }
    }
  }
  if (!homePrices.length && !awayPrices.length) return null;
  const avg = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  return {
    home: impliedToAmerican(avg(homePrices)),
    away: impliedToAmerican(avg(awayPrices)),
    bookCount: Math.max(homePrices.length, awayPrices.length),
  };
}

async function fetchF5EventOdds(apiKey, eventId) {
  const params = new URLSearchParams({
    apiKey,
    regions: 'us',
    markets: F5_MARKET_KEY,
    oddsFormat: 'american',
    dateFormat: 'iso',
  });
  const url = `${ODDS_API_BASE}/sports/baseball_mlb/events/${encodeURIComponent(eventId)}/odds?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, body };
  }
  return { ok: true, raw: await res.json() };
}

/**
 * F5 moneyline consensus for a single event. Dual-key fallback, 5min cache,
 * never throws — returns null when the line is unavailable.
 */
export async function getF5MoneylineOdds({ eventId, homeName, awayName } = {}) {
  if (!eventId) return null;
  const cached = _oddsCache.get(eventId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const keys = [process.env.ODDS_API_KEY, process.env.ODDS_API_BACKUP_KEY].filter(Boolean);
  for (const [i, key] of keys.entries()) {
    try {
      const result = await fetchF5EventOdds(key, eventId);
      if (!result.ok) {
        const outOfCredits = typeof result.body === 'string' && result.body.includes('OUT_OF_USAGE_CREDITS');
        if (outOfCredits && i < keys.length - 1) {
          console.warn('[f5-suggestion] odds key exhausted, falling back to backup');
          continue;
        }
        console.warn(`[f5-suggestion] F5 odds fetch failed (${result.status})`);
        break;
      }
      const data = normalizeF5Event(result.raw, homeName, awayName);
      _oddsCache.set(eventId, { data, ts: Date.now() });
      return data;
    } catch (err) {
      console.warn('[f5-suggestion] F5 odds fetch error:', err.message);
    }
  }
  _oddsCache.set(eventId, { data: null, ts: Date.now() });
  return null;
}

/**
 * Orchestrator: evaluate the heuristic and, only when it fires, attach the real
 * F5 line from the event-specific Odds API endpoint (one extra call, cached).
 */
export async function buildF5Suggestion({ analysisData, gameData, features = {}, eventId = null, lang = 'es' } = {}) {
  const evaluation = evaluateF5Suggestion({ analysisData, gameData, features, lang });
  if (!evaluation?.suggested) return evaluation;

  let f5Line = null;
  if (eventId) {
    f5Line = await getF5MoneylineOdds({
      eventId,
      homeName: gameData?.teams?.home?.name,
      awayName: gameData?.teams?.away?.name,
    });
  }
  const pickedOdds = f5Line ? (evaluation.side === 'home' ? f5Line.home : f5Line.away) : null;
  return {
    ...evaluation,
    f5Line: f5Line ? { ...f5Line, picked: pickedOdds } : null,
  };
}
