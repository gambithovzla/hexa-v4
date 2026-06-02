/**
 * hexaSoccerBoardService.js — lightweight Soccer "pizarra" for daily slate.
 * Same response shape as buildHexaBoard() so HexaBoard can render with sport=soccer.
 * League-aware: accepts a leagueSlug or loops all six supported leagues.
 */

import { getSoccerGamesForDate, getSoccerStandings } from '../soccer-api.js';
import { SOCCER_LEAGUE_SLUGS, getSoccerLeague } from '../soccer-league-map.js';

const _cache = new Map();

function nextDailyBoundaryMs() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const boundary = new Date(et);
  boundary.setHours(4, 0, 0, 0);
  if (et.getTime() >= boundary.getTime()) boundary.setDate(boundary.getDate() + 1);
  return now.getTime() + (boundary.getTime() - et.getTime());
}

function insight(type, en, es, meta = {}) {
  return { type, text: { en, es }, icon: '⚽', meta };
}

function formatScore(homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null;
  return `${awayScore}–${homeScore}`;
}

async function processLeague(slug, targetDate, insights, teamIds) {
  const leagueMeta = getSoccerLeague(slug);
  const leagueName = leagueMeta?.name ?? slug.toUpperCase();

  let games = [];
  try {
    games = await getSoccerGamesForDate(slug, targetDate);
  } catch (err) {
    console.warn(`[hexaSoccerBoard] games failed for ${slug}: ${err.message}`);
    return 0;
  }

  const live = games.filter(g => g.status === 'live');
  const upcoming = games.filter(g => g.status === 'scheduled');
  const featured = [...live, ...upcoming].slice(0, 3);

  for (const g of featured) {
    const home = g.teams?.home ?? {};
    const away = g.teams?.away ?? {};
    if (home.id) teamIds.add(home.id);
    if (away.id) teamIds.add(away.id);

    const score = formatScore(home.score, away.score);
    const tag   = g.status === 'live' ? `🔴 ${g.statusDetail ?? 'LIVE'}` : (g.statusDetail ?? 'Scheduled');
    const label = `[${leagueName}] ${away.name ?? 'AWAY'} @ ${home.name ?? 'HOME'}`;

    insights.push(insight(
      g.status === 'live' ? 'match_live' : 'match_today',
      `${label}${score ? ` — ${score}` : ''} (${tag})`,
      `${label}${score ? ` — ${score}` : ''} (${tag})`,
      { league: slug, gameId: g.gameId, homeId: home.id, awayId: away.id },
    ));
  }

  // Top standings entries
  try {
    const standingsPayload = await getSoccerStandings(slug);
    const groups = standingsPayload?.standings?.entries ?? standingsPayload?.entries ?? [];
    const entries = Array.isArray(groups) ? groups : [];
    for (const entry of entries.slice(0, 2)) {
      const tName = entry?.team?.displayName ?? entry?.team?.name ?? '?';
      const stats = {};
      for (const s of (entry?.stats ?? [])) stats[s.name] = s.value;
      const pts = stats.points ?? '?';
      const gd  = stats.pointDifferential ?? null;
      const gdStr = gd != null ? ` · GD ${gd > 0 ? '+' : ''}${gd}` : '';
      insights.push(insight(
        'standings_leader',
        `[${leagueName}] ${tName}: ${pts} pts${gdStr}`,
        `[${leagueName}] ${tName}: ${pts} pts${gdStr}`,
        { league: slug },
      ));
    }
  } catch { /* standings optional — never break the board */ }

  return games.length;
}

export async function buildHexaSoccerBoard({ date, leagueSlug, force = false } = {}) {
  const targetDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const leagues = leagueSlug ? [leagueSlug] : SOCCER_LEAGUE_SLUGS;
  const cacheKey = `${targetDate}:${leagues.join(',')}`;

  if (!force) {
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return { ...cached.payload, cached: true };
  }

  const insights = [];
  const teamIds = new Set();
  let totalGames = 0;

  for (const slug of leagues) {
    const count = await processLeague(slug, targetDate, insights, teamIds);
    totalGames += count;
  }

  if (insights.length === 0) {
    insights.push(insight(
      'no_games',
      'No soccer games on today\'s slate — check standings or select a different date.',
      'Sin partidos de fútbol hoy — revisa standings o cambia la fecha.',
      {},
    ));
  }

  const payload = {
    lastUpdatedAt: new Date().toISOString(),
    cached: false,
    totalGames,
    teamsAnalyzed: teamIds.size,
    insights: insights.slice(0, 12),
    sport: 'soccer',
  };

  _cache.set(cacheKey, { payload, expiresAt: nextDailyBoundaryMs() });
  return payload;
}
