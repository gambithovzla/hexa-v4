import express from 'express';
import { getTodayGames } from '../mlb-api.js';
import { getGameOdds, hydrateOddsForGame, matchOddsToGame } from '../odds-api.js';
import { verifyToken } from '../middleware/auth-middleware.js';
import { getBatterStatcast, getPitcherStatcast } from '../savant-fetcher.js';
import { enrichPropFeatures, mapOddsMarketToPropKind } from '../services/propFeatureEnricher.js';
import { buildPropMLFeaturePayload, predictBatch, isEnabled as isMlEnabled } from '../services/mlModelClient.js';

const router = express.Router();

const PROP_MARKET_KEYS = {
  hits: 'prop_hits',
  strikeouts: 'prop_strikeouts',
  total_bases: 'prop_total_bases',
  home_runs: 'prop_home_runs',
  rbis: 'prop_rbis',
};

const PUBLIC_PROPS_ENABLED = (process.env.MLB_PROPS_ML_PUBLIC_ENABLED ?? '0') === '1';

function americanToImplied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return -n / (-n + 100);
}

function normalizeDate(value) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

async function buildGameMlContext(game) {
  const homePitcher = game.teams?.home?.probablePitcher?.fullName
    ?? game.teams?.home?.probablePitcher?.name ?? null;
  const awayPitcher = game.teams?.away?.probablePitcher?.fullName
    ?? game.teams?.away?.probablePitcher?.name ?? null;
  const [homeSavant, awaySavant] = await Promise.all([
    homePitcher ? getPitcherStatcast(homePitcher) : null,
    awayPitcher ? getPitcherStatcast(awayPitcher) : null,
  ]);
  return {
    home_pitcher_xwoba: homeSavant?.xwOBA_against ?? null,
    away_pitcher_xwoba: awaySavant?.xwOBA_against ?? null,
    home_pitcher_whiff: homeSavant?.whiff_percent ?? null,
    away_pitcher_whiff: awaySavant?.whiff_percent ?? null,
    home_pitcher_k_pct: homeSavant?.k_percent ?? null,
    away_pitcher_k_pct: awaySavant?.k_percent ?? null,
  };
}

router.get('/props/board', verifyToken, async (req, res) => {
  try {
    const date = normalizeDate(req.query.date);
    const minEdge = Number(req.query.minEdge);
    const kindFilter = req.query.propKind ? String(req.query.propKind).toLowerCase() : null;

    const games = await getTodayGames(date);
    const oddsEvents = await getGameOdds({ date });
    const showModelScores = PUBLIC_PROPS_ENABLED || req.user?.is_admin;

    const batchItems = [];
    const propRefs = [];

    const gameRows = [];

    for (const game of games ?? []) {
      const gameMl = await buildGameMlContext(game);
      const homeName = game.teams?.home?.name ?? game.home_team?.name ?? game.homeTeam;
      const awayName = game.teams?.away?.name ?? game.away_team?.name ?? game.awayTeam;
      const matched = matchOddsToGame(oddsEvents, homeName, awayName);
      const hydrated = matched ? await hydrateOddsForGame(matched) : null;
      const playerProps = hydrated?.playerProps ?? {};
      const props = [];

      for (const [marketKey, offers] of Object.entries(playerProps)) {
        const propKind = mapOddsMarketToPropKind(marketKey);
        if (!propKind || !PROP_MARKET_KEYS[propKind]) continue;
        if (kindFilter && kindFilter !== propKind) continue;

        for (const offer of offers ?? []) {
          const implied = americanToImplied(offer.price);
          const enriched = await enrichPropFeatures({
            propKind,
            propPlayerName: offer.playerName,
            gamePk: game.gamePk ?? game.game_pk,
            propOddsAmerican: offer.price,
          });

          const side = offer.direction === 'under' ? 'under' : 'over';
          const row = {
            propKind,
            playerName: offer.playerName,
            side,
            line: offer.line,
            oddsAmerican: offer.price,
            impliedProb: implied != null ? Math.round(implied * 1000) / 1000 : null,
            savant: {
              xba: enriched.prop_player_xba,
              xslg: enriched.prop_player_xslg,
              rolling7d: enriched.prop_player_rolling_woba_7d,
              rolling14d: enriched.prop_player_rolling_woba_14d,
              opsVsLhp: enriched.prop_player_ops_vs_lhp,
              opsVsRhp: enriched.prop_player_ops_vs_rhp,
            },
            modelProb: null,
            edge: null,
            flags: [],
          };

          if (showModelScores && isMlEnabled()) {
            const payload = buildPropMLFeaturePayload({
              ...gameMl,
              ...enriched,
              side,
              line: offer.line,
              prop_odds_american: offer.price,
              prop_implied_prob: implied,
            });
            batchItems.push({ market: PROP_MARKET_KEYS[propKind], ...payload });
            propRefs.push(row);
          }

          props.push(row);
        }
      }

      if (props.length > 0) {
        gameRows.push({
          gamePk: game.game_pk ?? game.gamePk,
          awayTeam: game.teams?.away?.abbreviation ?? game.away_team?.abbreviation ?? game.awayTeam,
          homeTeam: game.teams?.home?.abbreviation ?? game.home_team?.abbreviation ?? game.homeTeam,
          startTime: game.gameTime ?? game.game_time ?? game.startTime ?? null,
          props,
        });
      }
    }

    if (batchItems.length > 0) {
      const batch = await predictBatch(batchItems.slice(0, 50));
      const preds = batch?.predictions ?? [];
      for (let i = 0; i < propRefs.length && i < preds.length; i++) {
        const prob = preds[i]?.probability;
        if (prob == null) continue;
        propRefs[i].modelProb = Math.round(prob * 1000) / 1000;
        const implied = propRefs[i].impliedProb;
        if (implied != null) {
          propRefs[i].edge = Math.round((prob - implied) * 1000) / 1000;
        }
      }
    }

    for (const g of gameRows) {
      g.props.sort((a, b) => Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0));
    }

    let filteredGames = gameRows;
    if (Number.isFinite(minEdge)) {
      filteredGames = gameRows
        .map((g) => ({
          ...g,
          props: g.props.filter((p) => p.edge != null && Math.abs(p.edge) >= minEdge),
        }))
        .filter((g) => g.props.length > 0);
    }

    for (const g of filteredGames) {
      g.props.sort((a, b) => Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0));
    }

    res.json({
      date,
      mlPublic: PUBLIC_PROPS_ENABLED,
      mlEnabled: isMlEnabled(),
      games: filteredGames,
    });
  } catch (err) {
    console.error('[mlb-props] board failed:', err.message);
    res.status(500).json({ error: 'Failed to load props board' });
  }
});

export default router;
