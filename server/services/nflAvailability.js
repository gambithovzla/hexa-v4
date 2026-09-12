/**
 * nflAvailability.js — NFL player availability ("altas y bajas") derived from
 * ESPN's league injury feed.
 *
 * The feed is already fetched for the Oracle context; these helpers index it by
 * player so the props board can flag an OUT receiver before you take his over,
 * and rank a team's report so a UI can cut the tail.
 *
 * Pure except for the caller-supplied payload — no network here.
 */

import { findTeamInjuries } from '../nfl-api.js';

/** Higher = worse news for a bettor holding that player's prop. */
const SEVERITY = {
  out_for_season: 100,
  out: 90,
  doubtful: 70,
  game_time_decision: 55,
  questionable: 50,
  day_to_day: 40,
  probable: 20,
  unknown: 0,
};

export function nflInjurySeverity(statusKey) {
  return SEVERITY[String(statusKey ?? 'unknown')] ?? 10;
}

/** Statuses that make a player's prop untradeable rather than merely risky. */
export function isNflPlayerOut(statusKey) {
  return nflInjurySeverity(statusKey) >= 90;
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

/**
 * buildNflAvailabilityIndex(payload, teams) → { [normalizedName]: entry }
 * `teams` is an array of { teamId, teamAbbr } — normally the two sides of a game.
 */
export function buildNflAvailabilityIndex(payload, teams = []) {
  const index = {};
  for (const team of teams) {
    const report = findTeamInjuries(payload, team ?? {});
    for (const injury of report?.injuries ?? []) {
      const key = normName(injury.playerName);
      if (!key) continue;
      const entry = {
        playerName: injury.playerName,
        position: injury.position ?? null,
        team: report.abbreviation ?? team?.teamAbbr ?? null,
        status: injury.status ?? null,
        statusKey: injury.statusKey ?? 'unknown',
        detail: injury.detail ?? injury.type ?? null,
        severity: nflInjurySeverity(injury.statusKey),
      };
      // A player can appear twice across feeds; keep the worse status.
      if (!index[key] || entry.severity > index[key].severity) index[key] = entry;
    }
  }
  return index;
}

/** Availability for one player name, tolerant of "A.J. Brown" vs "AJ Brown". */
export function findNflPlayerAvailability(index, playerName) {
  const key = normName(playerName);
  if (!key || !index) return null;
  if (index[key]) return index[key];
  for (const [candidate, entry] of Object.entries(index)) {
    if (candidate === key) return entry;
    const a = candidate.split(' ');
    const b = key.split(' ');
    if (a.at(-1) === b.at(-1) && a[0]?.[0] === b[0]?.[0]) return entry;
  }
  return null;
}

/** The report worth showing above a slate: everyone doubtful or worse. */
export function summarizeNflUnavailable(index, { minSeverity = 70 } = {}) {
  return Object.values(index ?? {})
    .filter(e => e.severity >= minSeverity)
    .sort((a, b) => b.severity - a.severity || String(a.playerName).localeCompare(String(b.playerName)));
}
