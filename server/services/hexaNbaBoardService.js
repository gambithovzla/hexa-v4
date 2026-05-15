/**
 * hexaNbaBoardService.js — lightweight NBA "pizarra" for playoffs / daily slate.
 * Same response shape as buildHexaBoard() so HexaBoard can render with sport=nba.
 */

import { getNbaGamesForDate, getNbaStandings } from '../nba-api.js';

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
  return {
    type,
    text: { en, es },
    icon: '🏀',
    meta,
  };
}

export async function buildHexaNbaBoard({ date, force = false } = {}) {
  const targetDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  if (!force) {
    const cached = _cache.get(targetDate);
    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.payload, cached: true };
    }
  }

  const [games, standingsRaw] = await Promise.all([
    getNbaGamesForDate(targetDate),
    getNbaStandings().catch(() => ({ conferences: [] })),
  ]);

  const insights = [];
  const liveOrScheduled = games.filter(g => g.game_status_id !== 3);

  for (const g of liveOrScheduled.slice(0, 6)) {
    const away = g.away_team_abbr ?? 'AWAY';
    const home = g.home_team_abbr ?? 'HOME';
    const status = String(g.status ?? '').trim();
    const score =
      g.home_score != null && g.away_score != null
        ? `${away} ${g.away_score} @ ${home} ${g.home_score}`
        : null;
    insights.push(insight(
      'playoff_game_today',
      `${away} @ ${home}${score ? ` — ${score}` : ''}${status ? ` (${status})` : ''}`,
      `${away} @ ${home}${score ? ` — ${score}` : ''}${status ? ` (${status})` : ''}`,
      {
        awayId: g.away_team_id,
        awayAbbr: away,
        homeId: g.home_team_id,
        homeAbbr: home,
        gameId: g.game_id,
      },
    ));
  }

  const allTeams = (standingsRaw.conferences ?? []).flatMap(c => c.teams ?? []);
  const byNet = allTeams
    .filter(t => t.netRating != null || t.net_rating != null)
    .sort((a, b) => (b.netRating ?? b.net_rating ?? 0) - (a.netRating ?? a.net_rating ?? 0));

  for (const t of byNet.slice(0, 3)) {
    insights.push(insight(
      'hot_offense',
      `${t.teamAbbr ?? t.team_abbr ?? t.teamName}: Net ${Number(t.netRating ?? t.net_rating).toFixed(1)} (${t.wins ?? '?'}-${t.losses ?? '?'})`,
      `${t.teamAbbr ?? t.team_abbr ?? t.teamName}: Net ${Number(t.netRating ?? t.net_rating).toFixed(1)} (${t.wins ?? '?'}-${t.losses ?? '?'})`,
      { teamId: t.teamId ?? t.team_id, teamAbbr: t.teamAbbr ?? t.team_abbr },
    ));
  }

  if (insights.length === 0) {
    insights.push(insight(
      'high_scoring_matchup',
      'No NBA games on today\'s slate — check standings or switch date during playoffs.',
      'Sin partidos NBA en el calendario de hoy — revisa standings o cambia fecha en playoffs.',
      {},
    ));
  }

  const teamIds = new Set();
  for (const g of games) {
    if (g.home_team_id) teamIds.add(g.home_team_id);
    if (g.away_team_id) teamIds.add(g.away_team_id);
  }

  const payload = {
    lastUpdatedAt: new Date().toISOString(),
    cached: false,
    totalGames: games.length,
    teamsAnalyzed: teamIds.size,
    insights: insights.slice(0, 12),
    sport: 'nba',
  };

  _cache.set(targetDate, { payload, expiresAt: nextDailyBoundaryMs() });
  return payload;
}
