import { getBatterStatcast, getPitcherStatcast } from '../savant-fetcher.js';
import { getBatterSplits, getGameContext } from '../mlb-api.js';

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const PITCHER_PROP_KINDS = new Set(['strikeouts', 'outs_recorded']);

export const ODDS_MARKET_TO_PROP_KIND = {
  batter_hits: 'hits',
  pitcher_strikeouts: 'strikeouts',
  batter_total_bases: 'total_bases',
  batter_home_runs: 'home_runs',
  batter_rbis: 'rbis',
};

export const PROP_KIND_TO_ODDS_MARKET = Object.fromEntries(
  Object.entries(ODDS_MARKET_TO_PROP_KIND).map(([k, v]) => [v, k]),
);

export function mapOddsMarketToPropKind(marketKey) {
  return ODDS_MARKET_TO_PROP_KIND[marketKey] ?? null;
}

function normName(name) {
  return String(name ?? '').toLowerCase().replace(/[.,'-]/g, '').replace(/\s+/g, ' ').trim();
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function americanToImplied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return -n / (-n + 100);
}

function extractPlayersFromBoxscore(boxscore) {
  const out = {};
  for (const side of ['home', 'away']) {
    const team = boxscore?.teams?.[side];
    if (!team) continue;
    for (const entry of team.players ? Object.values(team.players) : []) {
      const person = entry?.person;
      const full = person?.fullName ?? entry?.name;
      if (!full) continue;
      const key = normName(full);
      out[key] = {
        id: person?.id ?? entry?.id ?? null,
        name: full,
        side,
        pitchHand: person?.pitchHand?.code ?? null,
      };
    }
  }
  return out;
}

function findPlayerInBoxscore(playersMap, playerName) {
  const query = normName(playerName);
  if (!query) return null;
  if (playersMap[query]) return playersMap[query];
  for (const [key, player] of Object.entries(playersMap)) {
    if (key.includes(query) || query.includes(key)) return player;
    const queryLast = query.split(' ').pop();
    const keyLast = key.split(' ').pop();
    if (queryLast && queryLast === keyLast && queryLast.length > 2) return player;
  }
  return null;
}

async function searchPlayerId(playerName) {
  const q = encodeURIComponent(String(playerName ?? '').trim());
  if (!q) return null;
  try {
    const res = await fetch(`${MLB_BASE}/people/search?names=${q}`);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = (data.people ?? [])[0];
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

export async function enrichPropFeatures({
  propKind,
  propPlayerName,
  propPlayerId = null,
  gamePk = null,
  propOddsAmerican = null,
}) {
  const kind = String(propKind ?? '').toLowerCase();
  const name = String(propPlayerName ?? '').trim();
  if (!name || !kind) return {};

  const isPitcherProp = PITCHER_PROP_KINDS.has(kind);
  const savant = isPitcherProp
    ? await getPitcherStatcast(name)
    : await getBatterStatcast(name);

  let playerId = propPlayerId;
  let opponentHand = null;
  let opponentPitcherXwoba = null;
  let opponentPitcherKPct = null;

  if (gamePk) {
    try {
      const { boxscore } = await getGameContext(gamePk);
      const playersMap = extractPlayersFromBoxscore(boxscore);
      const found = findPlayerInBoxscore(playersMap, name);
      if (found) {
        playerId = playerId ?? found.id;
        if (!isPitcherProp) {
          const oppSide = found.side === 'home' ? 'away' : 'home';
          const oppTeam = boxscore?.teams?.[oppSide];
          const starterId = oppTeam?.pitchers?.[0];
          const starter = starterId != null ? oppTeam?.players?.[`ID${starterId}`] : null;
          const opponentPitcherName = starter?.person?.fullName ?? null;
          opponentHand = starter?.person?.pitchHand?.code ?? null;
          if (opponentPitcherName) {
            const oppSavant = await getPitcherStatcast(opponentPitcherName);
            opponentPitcherXwoba = safeNum(oppSavant?.xwOBA_against);
            opponentPitcherKPct = safeNum(oppSavant?.k_percent);
            opponentHand = opponentHand ?? oppSavant?.pitch_hand ?? null;
          }
        }
      }
    } catch (err) {
      console.warn(`[propFeatureEnricher] boxscore ${gamePk}: ${err.message}`);
    }
  }

  if (!playerId && !isPitcherProp) {
    playerId = await searchPlayerId(name);
  }

  let opsVsLhp = null;
  let opsVsRhp = null;

  if (!isPitcherProp && playerId) {
    const splits = await getBatterSplits(playerId);
    if (splits) {
      opsVsLhp = safeNum(splits.vsLHP?.ops);
      opsVsRhp = safeNum(splits.vsRHP?.ops);
    }
  }

  const rolling = savant?.rolling_windows ?? savant?.rolling_windows_against ?? {};

  return {
    prop_player_id: playerId,
    prop_player_xwoba: safeNum(savant?.xwOBA ?? savant?.xwOBA_against),
    prop_player_xba: safeNum(savant?.xBA ?? savant?.xBA_against),
    prop_player_xslg: safeNum(savant?.xSLG ?? savant?.xSLG_against),
    prop_player_k_pct: safeNum(savant?.k_percent),
    prop_player_bb_pct: safeNum(savant?.bb_percent),
    prop_player_avg_exit_velocity: safeNum(savant?.avg_exit_velocity),
    prop_player_barrel_pct: safeNum(savant?.barrel_batted_rate),
    prop_player_hard_hit_pct: safeNum(savant?.hard_hit_percent),
    prop_player_rolling_woba_7d: safeNum(rolling.woba_7d ?? rolling.woba_against_7d),
    prop_player_rolling_woba_14d: safeNum(rolling.woba_14d ?? rolling.woba_against_14d),
    prop_player_rolling_woba_21d: safeNum(rolling.woba_21d ?? rolling.woba_against_21d),
    prop_player_ops_vs_lhp: opsVsLhp,
    prop_player_ops_vs_rhp: opsVsRhp,
    prop_opponent_pitcher_hand: opponentHand ? String(opponentHand).toUpperCase().slice(0, 1) : null,
    prop_opponent_pitcher_xwoba_against: opponentPitcherXwoba,
    prop_opponent_pitcher_k_pct: opponentPitcherKPct,
    prop_odds_american: safeNum(propOddsAmerican) != null ? Math.round(propOddsAmerican) : null,
    prop_implied_prob: americanToImplied(propOddsAmerican),
  };
}
