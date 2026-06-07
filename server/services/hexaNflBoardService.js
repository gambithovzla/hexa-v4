/**
 * hexaNflBoardService.js — lightweight NFL "pizarra del día".
 *
 * Same response shape as buildHexaBoard()/buildHexaNbaBoard() so HexaBoard can
 * render it with sport=nfl. NFL is weekly, so most calendar days have no games;
 * the board fetches that day's slate (Thu/Sun/Mon during the season) and the
 * standings, and degrades to a single fallback insight in the off-season.
 *
 * Insight types reuse the existing MLB livery keys (high_scoring_matchup /
 * hot_offense / team_streak_hot) so HexaBoard renders them with sensible card
 * intent + category chips without touching the frontend TYPE maps.
 */

import { getNflGamesForDate, getNflStandings } from '../nfl-api.js';

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
  return { type, text: { en, es }, icon: '🏈', meta };
}

function fmtRecord(t) {
  const w = t.wins ?? '?';
  const l = t.losses ?? '?';
  return t.ties ? `${w}-${l}-${t.ties}` : `${w}-${l}`;
}

export async function buildHexaNflBoard({ date, force = false } = {}) {
  const targetDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  if (!force) {
    const cached = _cache.get(targetDate);
    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.payload, cached: true };
    }
  }

  const [games, standingsRaw] = await Promise.all([
    getNflGamesForDate(targetDate).catch(() => []),
    getNflStandings().catch(() => ({ teams: [] })),
  ]);

  const insights = [];

  // ── Today's slate (live or scheduled) ──────────────────────────────────────
  const liveOrScheduled = (games ?? []).filter(g => g.game_status_id !== 3);
  for (const g of liveOrScheduled.slice(0, 8)) {
    const away = g.away_team_abbr ?? 'AWAY';
    const home = g.home_team_abbr ?? 'HOME';
    const status = String(g.status ?? '').trim();
    const score =
      g.home_score != null && g.away_score != null
        ? `${away} ${g.away_score} @ ${home} ${g.home_score}`
        : null;
    const label = `${away} @ ${home}${score ? ` — ${score}` : ''}${status ? ` (${status})` : ''}`;
    insights.push(insight('high_scoring_matchup', label, label, {
      awayId: g.away_team_id, awayAbbr: away,
      homeId: g.home_team_id, homeAbbr: home,
      gameId: g.game_id,
    }));
  }

  // ── Division leaders (best win pct per division, played teams only) ─────────
  const teams = (standingsRaw.teams ?? []).filter(t => (t.games_played ?? 0) > 0);
  const byDivision = new Map();
  for (const t of teams) {
    const key = `${t.conference ?? ''} ${t.division ?? ''}`.trim();
    const prev = byDivision.get(key);
    if (!prev || (t.win_pct ?? 0) > (prev.win_pct ?? 0)) byDivision.set(key, t);
  }
  const leaders = [...byDivision.values()].sort((a, b) => (b.win_pct ?? 0) - (a.win_pct ?? 0));
  for (const t of leaders.slice(0, 4)) {
    const div = `${t.conference ?? ''} ${t.division ?? ''}`.trim();
    const label = `${t.team_abbr ?? t.team_name}: ${fmtRecord(t)} — leads ${div}`;
    insights.push(insight('team_streak_hot', label, label, {
      teamId: t.team_id, teamAbbr: t.team_abbr,
    }));
  }

  // ── Best point differential (form / dominance) ─────────────────────────────
  const byDiff = teams
    .filter(t => t.point_diff != null)
    .sort((a, b) => (b.point_diff ?? 0) - (a.point_diff ?? 0));
  for (const t of byDiff.slice(0, 3)) {
    const sign = (t.point_diff ?? 0) >= 0 ? '+' : '';
    const label = `${t.team_abbr ?? t.team_name}: ${sign}${t.point_diff} pt diff (${fmtRecord(t)})`;
    insights.push(insight('hot_offense', label, label, {
      teamId: t.team_id, teamAbbr: t.team_abbr,
    }));
  }

  if (insights.length === 0) {
    insights.push(insight(
      'high_scoring_matchup',
      'No NFL games on this date — the NFL slate runs Thu/Sun/Mon during the season (Sep–Feb).',
      'Sin partidos NFL en esta fecha — el calendario NFL corre Jue/Dom/Lun en temporada (Sep–Feb).',
      {},
    ));
  }

  const teamIds = new Set();
  for (const g of games ?? []) {
    if (g.home_team_id) teamIds.add(g.home_team_id);
    if (g.away_team_id) teamIds.add(g.away_team_id);
  }

  const payload = {
    lastUpdatedAt: new Date().toISOString(),
    cached: false,
    totalGames: (games ?? []).length,
    teamsAnalyzed: teamIds.size,
    insights: insights.slice(0, 12),
    sport: 'nfl',
  };

  _cache.set(targetDate, { payload, expiresAt: nextDailyBoundaryMs() });
  return payload;
}
