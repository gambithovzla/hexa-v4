/**
 * nflPlayerForm.js — per-team player form for the NFL Oracle Chat.
 *
 * The chat used to see only team aggregates, so a prop question got "I don't
 * have player data" even though the sidecar serves per-player nflverse averages
 * (the same payload the prop projection engine reads). This module picks the
 * players that matter for each side — QBs, the lead backs, the top pass
 * catchers — and renders their season + last-4 averages as a context block.
 *
 * Pure: takes the getNflPlayerStats() payload, returns plain data / text.
 */

import { getNflTeam } from '../nfl-team-map.js';

/** Below this many current-season games a team's roster is read from last season. */
const MIN_TEAM_CURRENT_GAMES = 1;

const GROUPS = [
  { key: 'QB', positions: ['QB'], sortKind: 'pass_yds', limit: 2,
    kinds: ['pass_yds', 'pass_tds', 'pass_interceptions', 'pass_completions', 'rush_yds'] },
  { key: 'RB', positions: ['RB', 'FB'], sortKind: 'rush_yds', limit: 2,
    kinds: ['rush_yds', 'rush_attempts', 'receptions', 'reception_yds', 'anytime_td'] },
  { key: 'WR/TE', positions: ['WR', 'TE'], sortKind: 'reception_yds', limit: 4,
    kinds: ['receptions', 'reception_yds', 'anytime_td'] },
];

const KIND_LABELS = {
  pass_yds: 'pass yds',
  pass_tds: 'pass TD',
  pass_interceptions: 'INT',
  pass_completions: 'comp',
  rush_yds: 'rush yds',
  rush_attempts: 'rush att',
  receptions: 'rec',
  reception_yds: 'rec yds',
  anytime_td: 'TD',
};

function canonAbbr(abbr) {
  if (!abbr) return null;
  return getNflTeam({ teamAbbr: abbr })?.abbr ?? String(abbr).toUpperCase();
}

function normName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamPlayers(players, teamAbbr) {
  const target = canonAbbr(teamAbbr);
  if (!target || !players) return [];
  return Object.values(players).filter(p => canonAbbr(p?.team) === target);
}

function injuryIndex(injuries) {
  const index = new Map();
  for (const it of injuries?.items ?? []) {
    const key = normName(it.playerName);
    if (key) index.set(key, it.status ?? it.statusKey ?? null);
  }
  return index;
}

/**
 * Select one team's relevant players.
 *
 * Uses the current season once the team has any games in it; otherwise (Week 1,
 * or nflverse lagging) last season's roster, flagged — a prior-season row can
 * list a player under a team he has since left.
 *
 * @returns {{ teamAbbr, fromPriorSeason, season, groups: [{ key, players: [...] }] }|null}
 */
export function selectNflTeamPlayerForm(payload, teamAbbr, { injuries = null } = {}) {
  if (!payload || !teamAbbr) return null;

  let pool = teamPlayers(payload.players, teamAbbr);
  let fromPriorSeason = false;
  let season = payload.season ?? null;
  if (!pool.some(p => (p.games ?? 0) >= MIN_TEAM_CURRENT_GAMES)) {
    pool = teamPlayers(payload.priorSeason?.players, teamAbbr);
    fromPriorSeason = pool.length > 0;
    season = fromPriorSeason ? (payload.priorSeason?.season ?? null) : season;
  }
  if (!pool.length) return null;

  const status = injuryIndex(injuries);
  const groups = [];
  for (const group of GROUPS) {
    const players = pool
      .filter(p => group.positions.includes(String(p.position ?? '').toUpperCase()))
      .filter(p => p.season_avg?.[group.sortKind] != null)
      .sort((a, b) => (b.season_avg[group.sortKind] ?? 0) - (a.season_avg[group.sortKind] ?? 0))
      .slice(0, group.limit)
      .map(p => ({
        name: p.name,
        position: p.position,
        games: p.games ?? null,
        injuryStatus: status.get(normName(p.name)) ?? null,
        stats: group.kinds
          .map(kind => ({
            kind,
            seasonAvg: p.season_avg?.[kind] ?? null,
            recentAvg: p.recent_avg?.[kind] ?? null,
          }))
          .filter(s => s.seasonAvg != null || s.recentAvg != null),
      }));
    if (players.length) groups.push({ key: group.key, players });
  }
  if (!groups.length) return null;

  return { teamAbbr: canonAbbr(teamAbbr), fromPriorSeason, season, groups };
}

/** Both teams' player form, or null when the sidecar has nothing for either. */
export function buildNflPlayerForm(payload, { home, away } = {}) {
  const homeForm = selectNflTeamPlayerForm(payload, home?.teamAbbr, { injuries: home?.injuries });
  const awayForm = selectNflTeamPlayerForm(payload, away?.teamAbbr, { injuries: away?.injuries });
  if (!homeForm && !awayForm) return null;
  return { home: homeForm, away: awayForm };
}

function fmtAvg(v, kind) {
  if (v == null) return 'n/a';
  const digits = ['pass_tds', 'pass_interceptions', 'anytime_td', 'receptions'].includes(kind) ? 2 : 1;
  return Number(v).toFixed(digits);
}

function describeTeamForm(side, form) {
  if (!form) return `${side}: no player data`;
  const header = `${side} ${form.teamAbbr}` +
    (form.fromPriorSeason
      ? ` — ${form.season ?? 'last'} season averages (no current-season games yet; roster may have changed)`
      : ` — ${form.season ?? 'current'} season`);
  const lines = [header];
  for (const group of form.groups) {
    for (const p of group.players) {
      const stats = p.stats
        .map(s => `${KIND_LABELS[s.kind] ?? s.kind} ${fmtAvg(s.seasonAvg, s.kind)} (L4 ${fmtAvg(s.recentAvg, s.kind)})`)
        .join(' · ');
      const injury = p.injuryStatus ? ` [${String(p.injuryStatus).toUpperCase()}]` : '';
      lines.push(`  ${group.key} ${p.name}${injury}, ${p.games ?? '?'} g: ${stats}`);
    }
  }
  return lines.join('\n');
}

/** Text block for serializeNflContext; null when there is no player form. */
export function describeNflPlayerForm(playerForm) {
  if (!playerForm || (!playerForm.home && !playerForm.away)) return null;
  return [
    'PLAYER FORM — per-game averages from nflverse (season avg, L4 = last 4 games)',
    describeTeamForm('HOME', playerForm.home),
    describeTeamForm('AWAY', playerForm.away),
    'A player tagged OUT/DOUBTFUL/QUESTIONABLE above is on the injury report — his averages do not apply this week; volume shifts to the next man up.',
  ].join('\n');
}
