import { getLiveGameData, getGamePlayByPlay } from '../live-feed.js';
import { getNbaGamesForDate } from '../nba-api.js';
import { findNbaGameForPick, nbaGameToLiveData } from '../pick-tracker-nba.js';
import { parseLivePick, calculatePickProgress, buildPickOutcomeContext } from '../pick-tracker.js';

function normalizeDateInput(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export async function buildPostmortemGameSummary(pickRow, sport = 'mlb') {
  const gamePk = pickRow.game_pk ?? pickRow.feature_game_pk ?? null;
  const gameDate =
    normalizeDateInput(pickRow.game_date) ??
    normalizeDateInput(pickRow.feature_game_date) ??
    null;

  if (sport === 'nba') {
    if (!gameDate) {
      return { gamePk, gameDate, sport: 'nba', pickProgress: null, pickOutcomeContext: null };
    }
    const games = await getNbaGamesForDate(gameDate);
    const nbaGame = findNbaGameForPick(
      { game_pk: gamePk, matchup: pickRow.matchup },
      games,
    );
    if (!nbaGame) {
      return { gamePk, gameDate, sport: 'nba', pickProgress: null, pickOutcomeContext: null };
    }
    const liveData = nbaGameToLiveData(nbaGame);
    const parsed = parseLivePick(pickRow.pick);
    const progress = calculatePickProgress(parsed, liveData);
    return {
      gamePk: nbaGame.game_id,
      gameDate,
      sport: 'nba',
      status: liveData.status,
      away: liveData.away,
      home: liveData.home,
      period: nbaGame.live_period ?? null,
      clock: nbaGame.live_clock ?? null,
      statusDetail: nbaGame.status ?? null,
      pickProgress: progress,
      pickOutcomeContext: null,
      recentPlays: [],
    };
  }

  // Soccer: no live play-by-play feed (and 1X2 has no push). The final result
  // lives on the pick itself; the feature snapshot carries the rest. Minimal,
  // network-free summary — mirrors the NBA "no GUMBO" shape.
  if (sport === 'soccer') {
    return {
      gamePk,
      gameDate,
      sport: 'soccer',
      league: pickRow.league ?? null,
      pickProgress: null,
      pickOutcomeContext: null,
      recentPlays: [],
    };
  }

  let liveData = null;
  let playByPlay = null;
  if (gamePk) {
    try {
      liveData = await getLiveGameData(gamePk);
    } catch {
      liveData = null;
    }
    try {
      playByPlay = await getGamePlayByPlay(gamePk);
    } catch {
      playByPlay = null;
    }
  }

  const parsedPick = parseLivePick(pickRow.pick);
  const progress = liveData ? calculatePickProgress(parsedPick, liveData) : null;
  const pickOutcomeContext = (liveData && playByPlay)
    ? buildPickOutcomeContext(parsedPick, liveData, playByPlay)
    : null;

  if (liveData) {
    return {
      gamePk: liveData.gamePk,
      status: liveData.status,
      away: {
        name: liveData.away?.name ?? null,
        abbreviation: liveData.away?.abbreviation ?? null,
        score: liveData.away?.score ?? null,
      },
      home: {
        name: liveData.home?.name ?? null,
        abbreviation: liveData.home?.abbreviation ?? null,
        score: liveData.home?.score ?? null,
      },
      pickProgress: progress,
      pickOutcomeContext,
      recentPlays: Array.isArray(liveData.recentPlays) ? liveData.recentPlays.slice(0, 5) : [],
    };
  }

  return {
    gamePk,
    gameDate,
    pickProgress: null,
    pickOutcomeContext: null,
  };
}

export function buildPostmortemFeatureSnapshot(pickRow, sport = 'mlb') {
  const gamePk = pickRow.game_pk ?? pickRow.feature_game_pk ?? null;
  const gameDate =
    normalizeDateInput(pickRow.game_date) ??
    normalizeDateInput(pickRow.feature_game_date) ??
    null;

  if (sport === 'nba') {
    return {
      sport: 'nba',
      gamePk,
      gameDate,
      home_net_rating: pickRow.home_net_rating,
      away_net_rating: pickRow.away_net_rating,
      home_off_rating: pickRow.home_off_rating,
      away_off_rating: pickRow.away_off_rating,
      home_def_rating: pickRow.home_def_rating,
      away_def_rating: pickRow.away_def_rating,
      home_pace: pickRow.home_pace,
      away_pace: pickRow.away_pace,
      home_days_rest: pickRow.home_days_rest,
      away_days_rest: pickRow.away_days_rest,
      context_completeness: pickRow.context_completeness,
      data_quality_score: pickRow.data_quality_score,
      signal_coherence_score: pickRow.signal_coherence_score,
      odds_ml_home: pickRow.odds_ml_home,
      odds_ml_away: pickRow.odds_ml_away,
      odds_ou_total: pickRow.odds_ou_total,
    };
  }

  if (sport === 'soccer') {
    return {
      sport: 'soccer',
      gamePk,
      gameDate,
      league: pickRow.league ?? null,
      home_goals_for: pickRow.home_goals_for,
      away_goals_for: pickRow.away_goals_for,
      home_goals_against: pickRow.home_goals_against,
      away_goals_against: pickRow.away_goals_against,
      home_goal_diff: pickRow.home_goal_diff,
      away_goal_diff: pickRow.away_goal_diff,
      home_points: pickRow.home_points,
      away_points: pickRow.away_points,
      home_xg: pickRow.home_xg,
      away_xg: pickRow.away_xg,
      home_xga: pickRow.home_xga,
      away_xga: pickRow.away_xga,
      draw_price: pickRow.draw_price,
      btts_yes_price: pickRow.btts_yes_price,
      odds_ml_home: pickRow.odds_ml_home,
      odds_ml_away: pickRow.odds_ml_away,
      odds_ou_total: pickRow.odds_ou_total,
      context_completeness: pickRow.context_completeness,
    };
  }

  return {
    sport: 'mlb',
    gamePk,
    gameDate,
    home_pitcher_xwoba: pickRow.home_pitcher_xwoba,
    away_pitcher_xwoba: pickRow.away_pitcher_xwoba,
    home_pitcher_whiff: pickRow.home_pitcher_whiff,
    away_pitcher_whiff: pickRow.away_pitcher_whiff,
    home_pitcher_k_pct: pickRow.home_pitcher_k_pct,
    away_pitcher_k_pct: pickRow.away_pitcher_k_pct,
    home_pitcher_era: pickRow.home_pitcher_era,
    away_pitcher_era: pickRow.away_pitcher_era,
    home_team_ops: pickRow.home_team_ops,
    away_team_ops: pickRow.away_team_ops,
    home_lineup_avg_xwoba: pickRow.home_lineup_avg_xwoba,
    away_lineup_avg_xwoba: pickRow.away_lineup_avg_xwoba,
    park_factor_overall: pickRow.park_factor_overall,
    park_factor_hr: pickRow.park_factor_hr,
    temperature: pickRow.temperature,
    wind_speed: pickRow.wind_speed,
    data_quality_score: pickRow.data_quality_score,
    signal_coherence_score: pickRow.signal_coherence_score,
    odds_ml_home: pickRow.odds_ml_home,
    odds_ml_away: pickRow.odds_ml_away,
    odds_ou_total: pickRow.odds_ou_total,
  };
}
