import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { initSentry, sentryErrorHandler } from './observability.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { getMlbStandings, getMlbPlayoffBracket, getTeams, getTodayGames } from './mlb-api.js';
import { buildContext, buildContextById } from './context-builder.js';
import { analyzeGame, analyzeParlay, analyzeSafe, analyzeChat, summarizeGameBrief, analyzeChatJornada } from './oracle.js';
import { getGameOdds, matchOddsToGame, calculateImpliedProbability, getOddsApiStatus, getEventAlternates } from './odds-api.js';
import { buildExtendedCandidates, formatExtendedMenuForLLM } from './services/extendedMarketCandidates.js';
import { pruneExpiredOddsCache, getOddsCacheStats } from './odds-cache.js';
import { getCacheStatus, refreshCache } from './savant-fetcher.js';
import authRouter, { bankrollRouter, seedAdminUser } from './auth.js';
import { verifyToken, requireVerifiedEmail, requireAdmin } from './middleware/auth-middleware.js';
import { runMigrations } from './migrate.js';
import { getGameBoxscore, resolvePlayerProp } from './props-resolver.js';
import { regradeBacktestProps } from './services/backtestRegrader.js';
import pool from './db.js';
import nowpaymentsRouter from './nowpayments.js';
import { handleNowPaymentsWebhook } from './nowpayments-webhook.js';
import picksRouter from './routes/picks.js';
import oracleHistoryRouter, { upsertOracleSession } from './routes/oracle-history.js';
import insightsRouter from './routes/insights.js';
import nbaRouter from './routes/nba.js';
import nflRouter from './routes/nfl.js';
import nhlRouter from './routes/nhl.js';
import soccerRouter from './routes/soccer.js';
import tennisRouter from './routes/tennis.js';
import mundialRouter from './routes/mundial.js';
import { resolveMundialPredictions } from './services/mundialResolver.js';
import { findGame, parsePick, resolvePendingPicks, resolvePickResult, resolvePlayerPropPickResult } from './pick-resolver.js';
import { resolveNbaPendingPicks } from './pick-resolver-nba.js';
import { resolveNflPendingPicks } from './pick-resolver-nfl.js';
import { resolveNhlPendingPicks } from './pick-resolver-nhl.js';
import { resolveSoccerPendingPicks } from './pick-resolver-soccer.js';
import { resolveTennisPendingPicks } from './pick-resolver-tennis.js';
import { resolveParlayRunById, resolvePendingParlays } from './services/parlayResolver.js';
import { getActualLegCount, loadLearningsForUser } from './services/parlayLearnings.js';
import { deriveParlayOutcome } from './services/parlayRunOutcome.js';
import { captureClosingLines } from './closing-line-capture.js';
import { captureSoccerClosingLines } from './closing-line-capture-soccer.js';
import { getLiveGameData, getMultipleLiveGames, getGamePlayByPlay } from './live-feed.js';
import { parseLivePick, calculatePickProgress, buildPickOutcomeContext } from './pick-tracker.js';
import { buildNbaPickLiveProgressEntry } from './pick-tracker-nba.js';
import { buildNflPickLiveProgressEntry } from './pick-tracker-nfl.js';
import { buildSoccerPickLiveProgressEntry } from './pick-tracker-soccer.js';
import { captureOddsSnapshot, getLineMovement } from './line-movement.js';
import { savePickFeatures, updatePickFeatureResult } from './feature-store.js';
import { generatePickPostmortem, POSTMORTEM_SCHEMA_VERSION } from './pick-postmortem.js';
import { buildPostmortemGameSummary, buildPostmortemFeatureSnapshot } from './services/postmortemContext.js';
import { calculateParallelScore } from './services/xgboostValidator.js';
import { buildDeterministicSafePayload, buildValueBreakdown } from './market-intelligence.js';
import { filterCandidatesByMarketFocus, normalizeMarketFocus } from './market-focus.js';
import {
  buildShadowActualOutcome,
  getShadowModeDashboard,
  isShadowModeEnabled,
  refreshPendingShadowModelRuns,
  recordShadowModelRun,
  updateShadowModelRunsForGame,
} from './shadow-model.js';
import { buildHexaBoard } from './services/hexaBoardService.js';
import { purgePickTrainingRows, DATASET_PICK_VISIBILITY_SQL } from './services/pickTrainingCleanup.js';
import contentRouter from './routes/content.js';
import contentAdminRouter from './routes/content-admin.js';
import adminMlRouter from './routes/admin-ml.js';
import mlbPropsRouter from './routes/mlb-props.js';
import imperdibleRouter from './routes/imperdible.js';
import pickOfTheDayRouter from './routes/pick-of-the-day.js';
import nflImperdibleRouter from './routes/nfl-imperdible.js';
import soccerImperdibleRouter from './routes/soccer-imperdible.js';
import betCardRouter from './routes/bet-card.js';
import { augmentChatQuestion, processChatAnswer, processChatAnswerForGames, f5ChatAwareness, varietyChatSteer, looksLikeLockRequest } from './services/chatPickExtractor.js';
import { processScheduledContentQueue, processScheduledTelegramQueue, processScheduledThreadsQueue } from './services/contentQueueService.js';
import { subscribeNewsletter, unsubscribeNewsletter, sendWeeklyNewsletter, getSubscribers } from './services/newsletterService.js';
import { getGameHighlightsAvailability } from './live-feed.js';
import { mountAdminDbExplorer } from './admin-db-explorer.js';
import { publishWinningInsightByPickId } from './services/weeklyWinsPublisher.js';
import {
  buildCandidatePool,
  filterCandidatesByBetType,
  enrichPoolWithRiskVectors,
  buildCorrelationMatrix,
  composeParlays,
  computeHitDistribution,
  askArchitect,
  resolveLegs,
  assertArchitectProviderConfigured,
  normalizeArchitectProvider,
  resolveArchitectModelSelection,
} from './services/parlayEngine/index.js';
import { runParlaySynergyMigrations, runSprint1Migrations, runPlayerPropsMlbMigrations, runSprint3Migrations, runAdminMLControlCenterMigrations, runNbaScaffoldingMigrations, runNbaDatasetMigrations, runNflScaffoldingMigrations, runNflDatasetMigrations, runNhlScaffoldingMigrations, runNhlDatasetMigrations, runPickAlignedShadowMigrations, runImperdibleMigrations, runOddsCacheMigrations, runEnsembleBackfillMigration, runNbaPlayerStatsMigrations, runNewsletterMigrations, runBeatReporterMigrations, runCsvBacktestMigrations, runPgvectorMigrations, runFeatureFlagsMigrations, runJobQueueMigrations, runSoccerScaffoldingMigrations, runSoccerDatasetMigrations, runTennisScaffoldingMigrations, runTennisDatasetMigrations, runMundialMigrations, runSportAccessMigrations } from './migrate.js';
import { runBeatReporterScan, getRecentInjurySignals } from './services/beatReporterService.js';
import { importBacktestCsv, listCsvBacktestRuns } from './services/backtestCsvImporter.js';
import { embedPendingPicks, getEmbeddingsStats } from './services/oracleEmbeddingsService.js';
import { getAllFlags, upsertFlag, deleteFlag } from './services/featureFlagsService.js';
import { getJobQueueStats, purgeOldJobs } from './services/jobQueueService.js';
import { generatePickCardSvg, generateSlateSvg } from './services/infographicsService.js';
import { getMlbFutures, getMlbTransactions } from './services/hexaScoutService.js';
import { buildPickAlignedMlOpinion } from './services/pickAlignedMl.js';
import { buildF5Suggestion } from './services/f5SuggestionService.js';
import { getCalibratedConfidence } from './services/confidenceCalibrationService.js';
import { syncConvictionTiers } from './services/convictionService.js';
import {
  getNbaGamesForDate,
  getNbaLeagueTeamStats,
  getNbaStandings,
  getNbaPlayoffBracket,
} from './nba-api.js';
import {
  getNflGamesForWeek,
  getNflTeamStats,
  getNflStandings,
  getCurrentNflWeek,
} from './nfl-api.js';
import {
  getNhlGamesForDate,
  getNhlTeamStats,
  getNhlStandings,
} from './nhl-api.js';
import {
  getSoccerGamesForDate,
  getSoccerStandings,
  getSoccerTeams,
} from './soccer-api.js';
import { SOCCER_LEAGUE_SLUGS } from './soccer-league-map.js';
import {
  getTennisMatchesForDate,
  getTennisRankings,
} from './tennis-api.js';
import { TENNIS_TOURS_LIST } from './tennis-tour-map.js';
import { getTennisMatchOdds } from './tennis-odds.js';
import {
  getCalibration as getMlCalibration,
  getCircuitState as getMlCircuitState,
  isEnabled as isMlSidecarEnabled,
  isEnsembleEnabled as isMlEnsembleEnabled,
  getEnsembleCalibration as getMlEnsembleCalibration,
  predictEnsemble as predictMlEnsemble,
} from './services/mlModelClient.js';
import { normalizePickSport, validatePickSavePayload } from './services/picksPayloadGuardrails.js';
import {
  canonicalizePickTextForResolver,
  canonicalizeAnalysisDataPicks,
} from './services/pickTextCanonicalizer.js';
import { KNOWN_SPORTS, normalizeSportFilter as normalizeKnownSportFilter } from './sports.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // eslint-disable-line no-unused-vars

// ── Safe error helper — never leak internal details to client ──────────────
function safeError(err) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[H.E.X.A. Error]', err.message, err.stack?.split('\n')[1]);
    return 'Internal server error';
  }
  return err.message;
}

function normalizeDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const s = String(value);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function getEasternDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function shiftDateString(dateString, days) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return shifted.toISOString().slice(0, 10);
}

function buildFeatureStoreDateCandidates(preferredDate) {
  const resolved = normalizeDateInput(preferredDate) ?? getEasternDateString();
  const todayEt = getEasternDateString();
  const candidates = [
    resolved,
    shiftDateString(resolved, -1),
    shiftDateString(resolved, 1),
    todayEt,
    shiftDateString(todayEt, -1),
    shiftDateString(todayEt, 1),
  ];
  return [...new Set(candidates.filter(Boolean))];
}

async function findGameForFeatureStore(gamePk, preferredDate) {
  const dateCandidates = buildFeatureStoreDateCandidates(preferredDate);

  for (const date of dateCandidates) {
    const games = await getTodayGames(date);
    const gameData = games.find(g => String(g.gamePk) === String(gamePk));
    if (gameData) {
      return { gameData, resolvedDate: date };
    }
  }

  return { gameData: null, resolvedDate: normalizeDateInput(preferredDate) ?? getEasternDateString() };
}

function parseJsonMaybe(value) {
  let parsed = value;
  for (let i = 0; i < 2; i++) {
    if (typeof parsed !== 'string') break;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  return parsed;
}

function normalizePickResult(result) {
  if (result == null) return null;
  const value = String(result).toLowerCase();
  if (value === 'won') return 'win';
  if (value === 'lost') return 'loss';
  return value;
}

function normalizeOracleConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

// Cheap structural check used by the backtest grader to short-circuit player
// prop picks before the loose Over/Under regex below mistakes them for game
// totals. Recognises "<player> Over/Under <line> <stat>" and the stat-first
// variant "<player> <stat> Over/Under <line>" in EN/ES.
const PLAYER_PROP_STAT_TOKENS = '(?:total\\s+bases?|tb|bases\\s+totales|strikeouts?|ks?|ponches?|hits?|home\\s+runs?|hrs?|jonrones?|cuadrangulares?|rbis?|carreras?\\s+impulsadas?|stolen\\s+bases?|sbs?|bases?\\s+robadas?|walks?|bbs?|bases?\\s+por\\s+bolas?|runs?\\s+scored|carreras?\\s+anotadas?)';
const PLAYER_PROP_DIRECTIONS = '(?:over|under|m[aá]s\\s+de|menos\\s+de)';
const PLAYER_PROP_RE_DIR_FIRST = new RegExp(`\\b${PLAYER_PROP_DIRECTIONS}\\s+\\d+\\.?\\d*\\s+${PLAYER_PROP_STAT_TOKENS}\\b`, 'i');
const PLAYER_PROP_RE_STAT_FIRST = new RegExp(`\\b${PLAYER_PROP_STAT_TOKENS}\\s+${PLAYER_PROP_DIRECTIONS}\\s+\\d+\\.?\\d*\\b`, 'i');

function looksLikePlayerProp(pickStr) {
  if (!pickStr) return false;
  const s = String(pickStr);
  return PLAYER_PROP_RE_DIR_FIRST.test(s) || PLAYER_PROP_RE_STAT_FIRST.test(s);
}

function buildFeatureStorePayload(gameData, requestedDate, features = {}) {
  return {
    gamePk: gameData?.gamePk ?? null,
    gameDate: normalizeDateInput(requestedDate ?? gameData?.gameDate) ?? null,
    features: features ?? {},
  };
}

function buildShadowStatcastData(features = {}) {
  const savantBatters = features.savantBatters ?? { home: [], away: [] };

  const summarizeLineup = (batters) => {
    const withData = (batters ?? []).filter((b) => b?.savant?.xwOBA != null);
    if (!withData.length) {
      return { avg_xwOBA: null, avg_woba_7d: null };
    }

    const avg_xwOBA = withData.reduce((sum, batter) => sum + Number(batter.savant.xwOBA ?? 0), 0) / withData.length;
    const avg_woba_7d = withData.reduce((sum, batter) => {
      const rolling = batter?.savant?.rolling_woba_7d ?? batter?.savant?.rolling_windows?.woba_7d ?? batter?.savant?.xwOBA ?? 0;
      return sum + Number(rolling);
    }, 0) / withData.length;

    return { avg_xwOBA, avg_woba_7d };
  };

  return {
    homePitcher: features.homePitcherSavant ?? null,
    awayPitcher: features.awayPitcherSavant ?? null,
    homeLineup: summarizeLineup(savantBatters.home),
    awayLineup: summarizeLineup(savantBatters.away),
  };
}

function buildAnalysisMeta(features = {}) {
  const homePitcherStatcast = features.homePitcherSavant ?? null;
  const awayPitcherStatcast = features.awayPitcherSavant ?? null;
  const savantBatters = features.savantBatters ?? { home: [], away: [] };

  const countNonNull = (values) => values.filter((value) => value != null).length;
  const hasLineupXwoba = (batters) => (batters ?? []).some((b) => b?.savant?.xwOBA != null);

  // Sprint 8d observability fields
  const hasRollingWoba = (s) => s?.rolling_windows_against?.woba_against_7d != null;
  const hasBatterRolling = (batters) => batters.some((b) => b?.savant?.rolling_windows?.woba_7d != null);

  return {
    pitcher_profiles_loaded: countNonNull([homePitcherStatcast, awayPitcherStatcast]),
    pitcher_xwoba_loaded: countNonNull([
      homePitcherStatcast?.xwOBA_against,
      awayPitcherStatcast?.xwOBA_against,
    ]),
    pitcher_whiff_loaded: countNonNull([
      homePitcherStatcast?.whiff_percent,
      awayPitcherStatcast?.whiff_percent,
    ]),
    pitcher_rolling_woba_loaded: countNonNull([
      hasRollingWoba(homePitcherStatcast) ? 1 : null,
      hasRollingWoba(awayPitcherStatcast) ? 1 : null,
    ]),
    lineup_xwoba_loaded: countNonNull([
      hasLineupXwoba(savantBatters.home) ? 1 : null,
      hasLineupXwoba(savantBatters.away) ? 1 : null,
    ]),
    batter_rolling_woba_loaded: countNonNull([
      hasBatterRolling(savantBatters.home) ? 1 : null,
      hasBatterRolling(savantBatters.away) ? 1 : null,
    ]),
    umpire_loaded: features.umpireData?.name ? 1 : 0,
    fatigue_loaded: countNonNull([features.homeFatigue, features.awayFatigue]),
  };
}

function annotateAnalysisData(data, features = {}, gameData = null) {
  if (!data || typeof data !== 'object') return data;

  const analysisMeta = buildAnalysisMeta(features);
  let alertFlags = Array.isArray(data.alert_flags) ? [...data.alert_flags] : [];

  if (analysisMeta.pitcher_xwoba_loaded > 0) {
    alertFlags = alertFlags.filter((flag) => (
      !/no statcast xwoba data available for either pitcher/i.test(String(flag))
    ));
  }

  const umpireStr  = analysisMeta.umpire_loaded  ? '✓' : '✗';
  const fatigueStr = analysisMeta.fatigue_loaded > 0 ? `${analysisMeta.fatigue_loaded}/2` : '✗';
  const traceFlag = [
    `Server check: P xwOBA ${analysisMeta.pitcher_xwoba_loaded}/2`,
    `Whiff ${analysisMeta.pitcher_whiff_loaded}/2`,
    `RollingW ${analysisMeta.pitcher_rolling_woba_loaded}/2`,
    `Lineups ${analysisMeta.lineup_xwoba_loaded}/2`,
    `BatRolling ${analysisMeta.batter_rolling_woba_loaded}/2`,
    `Umpire ${umpireStr}`,
    `Fatigue ${fatigueStr}`,
  ].join(', ');
  if (!alertFlags.some((flag) => String(flag).startsWith('Server check:'))) {
    alertFlags.push(traceFlag);
  }

  // Bullpen attribution guard: detect when oracle_report names the wrong team as critical/moderate.
  // alert_flags (LLM-generated) are usually correct; oracle_report narrative sometimes inverts teams.
  if (gameData?.teams) {
    const homeL = (gameData.teams.home?.name ?? '').toLowerCase();
    const awayL = (gameData.teams.away?.name ?? '').toLowerCase();
    const reportL = (data.oracle_report ?? '').toLowerCase();

    const criticalFlagged = [];
    for (const flag of alertFlags) {
      const m = String(flag).match(/(?:critical|moderate)\s+bullpen\s+fatigue[^—–\-]*[—–\-]\s*(.+?)\s+us[oó]/i);
      if (m) criticalFlagged.push(m[1].trim().toLowerCase());
    }

    if (criticalFlagged.length > 0) {
      for (const team of [{ name: homeL }, { name: awayL }]) {
        const isCritical = criticalFlagged.some(ct =>
          team.name.includes(ct) || ct.split(/\s+/).some(tok => tok.length >= 4 && team.name.includes(tok))
        );
        if (isCritical) continue;

        // This team is NOT critical — check if oracle_report incorrectly calls it critical
        const token = team.name.split(/\s+/).find(t => t.length >= 4) ?? '';
        if (!token) continue;
        const idx = reportL.indexOf(token);
        if (idx === -1) continue;
        const window = reportL.slice(Math.max(0, idx - 100), idx + 200);
        if (
          /bullpen.{0,60}(crític|critical)/i.test(window) ||
          /(crític|critical).{0,60}bullpen/i.test(window)
        ) {
          alertFlags.push('⚠ DATA CHECK (server): oracle_report puede haber invertido equipos en fatiga de bullpen — verificar manualmente');
          break;
        }
      }
    }
  }

  const valueBreakdown = buildValueBreakdown({
    data,
    oddsData: features?.oddsData ?? null,
    gameData,
  });

  // Coherence enforcement: keep bet_value and Kelly aligned with the computed edge.
  // Claude sometimes outputs "HIGH VALUE" on a negative-edge pick or a positive
  // Kelly when the implied probability actually exceeds the model's — that
  // breaks user trust. We override the tier server-side when we can compute the
  // real edge from the market odds.
  const mp = data.master_prediction ?? null;
  const edgeNum = valueBreakdown?.edge != null ? Number(valueBreakdown.edge) : null;
  if (mp && Number.isFinite(edgeNum)) {
    let tier;
    if (edgeNum > 5) tier = 'HIGH VALUE';
    else if (edgeNum > 2) tier = 'MODERATE VALUE';
    else if (edgeNum > 0) tier = 'MARGINAL VALUE';
    else tier = 'NO VALUE';
    mp.bet_value = tier;
    if (valueBreakdown) valueBreakdown.value_tier = tier;

    // Force negative-edge Kelly to "no mathematical edge"
    if (edgeNum <= 0 && data.kelly_recommendation) {
      const isSpanish = /recomendaci|ventaja|apostar|bankroll/i.test(String(data.kelly_recommendation));
      data.kelly_recommendation = isSpanish
        ? 'RECOMENDACIÓN KELLY: Sin ventaja matemática — No apostar.'
        : 'KELLY RECOMMENDATION: No mathematical edge — Do not bet.';
    }
  }

  const marketTotal = features?.oddsData?.odds?.overUnder?.total
    ?? gameData?.odds?.overUnder?.total
    ?? null;
  const canonicalized = canonicalizeAnalysisDataPicks({
    ...data,
    alert_flags: alertFlags,
    analysis_meta: analysisMeta,
    value_breakdown: valueBreakdown ?? data.value_breakdown ?? null,
  }, gameData, { marketTotal });

  return canonicalized;
}

async function saveFeatureStoreForGame({
  pickId = null,
  backtestId = null,
  gamePk,
  gameDate,
  pick,
  result = null,
  oddsData = null,
  sport = 'mlb',
}) {
  const resolvedDate = normalizeDateInput(gameDate) ?? getEasternDateString();
  if (!gamePk) return false;

  try {
    const { gameData, resolvedDate: matchedDate } = await findGameForFeatureStore(gamePk, resolvedDate);
    if (!gameData) {
      console.warn(
        `[feature-store] Game ${gamePk} not found near ${resolvedDate}; ` +
        `tried dates: ${buildFeatureStoreDateCandidates(resolvedDate).join(', ')}`
      );
      return false;
    }

    let matchedOdds = parseJsonMaybe(oddsData);
    if (!matchedOdds?.odds) {
      try {
        const allOdds = await getGameOdds({ date: matchedDate });
        matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
      } catch {
        matchedOdds = null;
      }
    }

    const contextResult = await buildContext(gameData, matchedOdds);
    const features = contextResult._features ?? {};
    await savePickFeatures({
      pickId,
      backtestId,
      gamePk: Number(gamePk),
      gameDate: matchedDate,
      ...features,
      oddsData: features.oddsData ?? matchedOdds,
      pick,
      result,
      sport,
    });

    return true;
  } catch (err) {
    console.warn(`[feature-store] Could not save features for game ${gamePk}: ${err.message}`);
    return false;
  }
}

async function persistAnalysisPick({
  userId,
  userEmail = null,
  type = 'single',
  matchup,
  analysisData,
  model = 'deep',
  language = 'en',
  gamePk = null,
  gameDate = null,
  oddsData = null,
  featureStore = null,
  mlOpinion = null,
}) {
  if (!userId || !analysisData) return null;

  const mp = analysisData.master_prediction ?? analysisData.safe_pick ?? {};
  const bp = analysisData.best_pick ?? {};
  const pickCtx = {
    homeAbbr: featureStore?.features?.homeAbbr ?? null,
    awayAbbr: featureStore?.features?.awayAbbr ?? null,
    marketTotal: oddsData?.odds?.overUnder?.total
      ?? featureStore?.features?.oddsData?.odds?.overUnder?.total
      ?? null,
  };
  const rawPickText = mp.pick ?? bp.detail ?? null;
  const pickText = rawPickText
    ? canonicalizePickTextForResolver(rawPickText, pickCtx)
    : null;
  const oracleConfidence = normalizeOracleConfidence(mp.oracle_confidence ?? mp.hit_probability ?? null);
  const oddsAtPick = analysisData.value_breakdown?.odds ?? null;
  const impliedProbAtPick = oddsAtPick != null
    ? calculateImpliedProbability(oddsAtPick)
    : null;

  const { rows } = await pool.query(
    `INSERT INTO picks (
       user_id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
       oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
       model, language, odds_at_pick, implied_prob_at_pick, odds_details, kelly_recommendation,
       game_pk, game_date, value_breakdown, safe_candidates, safe_scope, selection_method,
       user_email, sport, pick_time_lima, ml_opinion
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,'mlb',(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP,$26)
     RETURNING *`,
    [
      userId,
      type,
      matchup ?? null,
      pickText,
      oracleConfidence,
      mp.bet_value ?? null,
      analysisData.model_risk ?? null,
      analysisData.oracle_report ?? analysisData.safe_pick?.reasoning ?? null,
      analysisData.hexa_hunch ?? null,
      JSON.stringify(analysisData.alert_flags ?? []),
      JSON.stringify(analysisData.probability_model ?? {}),
      JSON.stringify(analysisData.best_pick ?? {}),
      model,
      language,
      oddsAtPick,
      impliedProbAtPick,
      oddsData != null ? JSON.stringify(oddsData) : null,
      analysisData.kelly_recommendation ?? null,
      gamePk ?? null,
      normalizeDateInput(gameDate),
      analysisData.value_breakdown != null ? JSON.stringify(analysisData.value_breakdown) : null,
      analysisData.safe_candidates != null ? JSON.stringify(analysisData.safe_candidates) : null,
      analysisData.safe_scope ?? null,
      analysisData.selection_method ?? null,
      userEmail ?? null,
      mlOpinion != null ? JSON.stringify(mlOpinion) : null,
    ]
  );

  const savedPick = rows[0] ?? null;
  if (!savedPick) return null;

  const parsedFeatureStore = parseJsonMaybe(featureStore);
  const directFeatureGamePk = parsedFeatureStore?.gamePk ?? gamePk;
  const directFeatureGameDate = parsedFeatureStore?.gameDate ?? gameDate;
  const directFeatures = parsedFeatureStore?.features ?? null;

  if (directFeatureGamePk && directFeatures) {
    await savePickFeatures({
      pickId: savedPick.id,
      gamePk: Number(directFeatureGamePk),
      gameDate: normalizeDateInput(directFeatureGameDate),
      ...directFeatures,
      oddsData: directFeatures.oddsData ?? oddsData,
      pick: savedPick.pick,
      result: savedPick.result,
      userEmail: userEmail ?? null,
      sport: 'mlb',
    });
  } else if (gamePk) {
    await saveFeatureStoreForGame({
      pickId: savedPick.id,
      gamePk,
      gameDate,
      pick: savedPick.pick,
      result: savedPick.result,
      oddsData,
      sport: 'mlb',
    });
  }

  // Fire-and-forget: compute calibrated_confidence from historical data
  if (savedPick?.id && oracleConfidence) {
    const rawMarket = String(analysisData?.best_pick?.type ?? analysisData?.master_prediction?.bet_type ?? '').toLowerCase();
    const market = /prop/.test(rawMarket) ? 'prop'
      : /run\s*line|spread/.test(rawMarket) ? 'runline'
      : /over|under|total/.test(rawMarket) ? 'overunder'
      : /money|ml\b/.test(rawMarket) ? 'moneyline'
      : null;
    getCalibratedConfidence({ sport: 'mlb', marketType: market, rawConfidence: oracleConfidence })
      .then(({ calibrated, sampleSize }) => {
        if (sampleSize >= 15) {
          pool.query(`UPDATE picks SET calibrated_confidence = $1 WHERE id = $2`, [calibrated, savedPick.id])
            .catch(() => {});
        }
      })
      .catch(() => {});
  }

  return savedPick;
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── Sentry: init before routes ────────────────────────────────────────────────
initSentry(app).catch(() => {});

// ── CORS: strict origin (must be first) ───────────────────────────────────────
app.use(cors({
  origin: ['https://hexaoracle.lat', 'https://www.hexaoracle.lat', 'http://localhost:5173', /\.vercel\.app$/],
  credentials: true,
}));

// ── Security: HTTP headers ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://hexaoracle.lat", "https://www.hexaoracle.lat", "https://hexa-v4-production.up.railway.app"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ── Rate limiting: 100 req / 15 min per IP (webhooks exempt) ──────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/nowpayments/webhook'),
});
app.use(limiter);

// ── Strict rate limiting for analysis endpoints (consume Anthropic API) ───────
// Tiers (per minute): admin=unlimited, paid=20, free=8, anon=4
// Uses jwt.decode (no sig verification) for bucketing — auth gate is still verifyToken.
const ANALYSIS_LIMITS = { admin: 1000, paid: 20, free: 8, anon: 4 };

function peekJwtPayload(req) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try { return jwt.decode(token); } catch { return null; }
}

const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    const payload = peekJwtPayload(req);
    if (!payload) return ANALYSIS_LIMITS.anon;
    if (payload.is_admin) return ANALYSIS_LIMITS.admin;
    if (payload.plan && payload.plan !== 'free') return ANALYSIS_LIMITS.paid;
    return ANALYSIS_LIMITS.free;
  },
  keyGenerator: (req) => {
    const payload = peekJwtPayload(req);
    return payload?.id ? `user:${payload.id}` : ipKeyGenerator(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many analysis requests. Please wait a moment.' },
});

// ── Body parsers (raw must come before json for webhook routes) ────────────────
app.use('/api/nowpayments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

// ── Auth routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',         authRouter);
app.use('/api/bankroll',     bankrollRouter);
app.use('/api/nowpayments',  nowpaymentsRouter);
app.use('/api/picks',        picksRouter);
app.use('/api/oracle',       oracleHistoryRouter);
app.use('/api/insights',     insightsRouter);
app.use('/api/nba',          nbaRouter);
app.use('/api/nfl/imperdible', nflImperdibleRouter);
app.use('/api/nfl',          nflRouter);
app.use('/api/nhl',          nhlRouter);
app.use('/api/soccer/imperdible', soccerImperdibleRouter);
app.use('/api/soccer',       soccerRouter);
app.use('/api/tennis',       tennisRouter);
app.use('/api/mundial',     mundialRouter);
app.use('/api/mlb',          mlbPropsRouter);
app.use('/api/imperdible',   imperdibleRouter);
app.use('/api/pick-of-the-day', pickOfTheDayRouter);
app.use('/api/bet-card',     betCardRouter);
app.use('/api/admin/content', contentAdminRouter);
app.use('/api/admin', adminMlRouter);
app.post('/api/nowpayments/webhook', handleNowPaymentsWebhook);

// ── Content API — read-only, API-key auth (external consumer) ─────────────────
const contentLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/content/v1', contentLimiter, contentRouter);

// ── Credit helpers ────────────────────────────────────────────────────────────

const CREDIT_COSTS = {
  single:  { fast: 1,  deep: 2  },
  parlay:  { fast: 4,  deep: 8  },
};
const WEB_INTEL_COST = 3; // only applied to single-game

function calcServerCost(type, model, webSearch) {
  const base = CREDIT_COSTS[type]?.[model] ?? 1;
  const webBonus = (type === 'single' && webSearch) ? WEB_INTEL_COST : 0;
  return base + webBonus;
}

/**
 * deductCredits(req, res, cost)
 * Looks up the user in PostgreSQL, checks credits, deducts `cost` atomically.
 * Admin account bypasses deduction entirely.
 * Returns the updated user row, or null after sending an error response.
 */
async function deductCredits(req, res, cost) {
  const { rows } = await pool.query(
    'SELECT id, email, credits, is_admin FROM users WHERE id = $1',
    [req.user.id]
  );
  const user = rows[0];
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  // Admin account bypasses credit deduction
  if (user.is_admin) return user;
  if (user.credits < cost) {
    res.status(403).json({ error: 'No credits remaining' });
    return null;
  }
  const updated = await pool.query(
    'UPDATE users SET credits = credits - $1 WHERE id = $2 RETURNING id, email, credits, is_admin',
    [cost, user.id]
  );
  return updated.rows[0];
}

/**
 * refundCredits(userId, cost, isAdmin)
 * Adds `cost` credits back to the user account.
 * Admin accounts are skipped (they were never charged).
 */
async function refundCredits(userId, cost, isAdmin) {
  if (isAdmin) return;
  try {
    await pool.query(
      'UPDATE users SET credits = credits + $1 WHERE id = $2',
      [cost, String(userId)]
    );
    console.log(`[Credits] Refunding ${cost} credits to user ${userId} due to analysis failure`);
  } catch (err) {
    console.error(`[Credits] Refund failed for user ${userId}:`, err.message);
  }
}

async function persistParlayRun({
  userId, userEmail, gameIds, mode, requestedLegs, resolvedDate, resolvedLang,
  model, resolvedEngine, isAdminRun, cost,
  enriched, composedParlays, architectDecision,
  finalLegs, composerMs, llmMs, totalMs,
  betType, marketFocus,
}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO parlay_synergy_runs (
        user_id, user_email, game_date,
        requested_legs, mode, game_pks, language, engine, model,
        candidate_pool, composed_top3, architect_output,
        chosen_legs, combined_prob, combined_dec_odds,
        synergy_type, warnings,
        timings, credits_charged, is_admin_run,
        bet_type, market_focus
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22
      )
      RETURNING id`,
      [
        String(userId),
        userEmail ?? null,
        resolvedDate,
        requestedLegs,
        mode,
        JSON.stringify(gameIds),
        resolvedLang,
        resolvedEngine,
        model,
        JSON.stringify(enriched.map(c => ({
          candidateId: c.candidateId, gamePk: c.gamePk, pick: c.pick,
          type: c.type, edge: c.edge, modelProbability: c.modelProbability,
          riskVector: c.riskVector, gameScript: c.gameScript,
        }))),
        JSON.stringify(composedParlays.slice(0, 3)),
        JSON.stringify({
          decision:                    architectDecision.decision,
          chosen_index:                architectDecision.chosen_index,
          modifications:               architectDecision.modifications,
          synergy_type:                architectDecision.synergy_type,
          synergy_thesis:              (architectDecision.synergy_thesis ?? '').slice(0, 1000),
          hidden_correlations_detected: architectDecision.hidden_correlations_detected,
          confidence_in_decision:      architectDecision.confidence_in_decision,
          _fallback:                   architectDecision._fallback ?? false,
        }),
        JSON.stringify(finalLegs.map(l => ({
          candidateId: l.candidateId,
          gamePk:      l.gamePk,
          pick:        l.pick,
          matchup:     l.matchup,
          type:        l.type,
          gameDate:    resolvedDate,
        }))),
        architectDecision.combined_probability,
        architectDecision.combined_decimal_odds,
        architectDecision.synergy_type ?? null,
        JSON.stringify(architectDecision.warnings ?? []),
        JSON.stringify({ composer_ms: composerMs, llm_ms: llmMs, total_ms: totalMs }),
        cost,
        isAdminRun ?? false,
        betType ?? null,
        marketFocus ?? null,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[parlay-synergy] persist failed (non-fatal):', err.message);
    return null;
  }
}

function normalizeRequestLanguage(value, fallback = 'en') {
  const normalized = String(value ?? fallback ?? 'en').toLowerCase();
  return normalized.startsWith('es') ? 'es' : 'en';
}

function normalizeRequestedEngine(value) {
  const normalized = String(value ?? 'sonnet').toLowerCase().trim();
  return ['sonnet', 'grok', 'dual'].includes(normalized) ? normalized : 'sonnet';
}

// ── Admin middleware ───────────────────────────────────────────────────────────

function isAdmin(req, res, next) {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ── App settings (site-wide flags) ─────────────────────────────────────────────

async function getAppSetting(key, fallback) {
  try {
    const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
    if (rows.length === 0) return fallback;
    return rows[0].value;
  } catch (err) {
    console.warn(`[app-settings] read failed for ${key}:`, err.message);
    return fallback;
  }
}

async function setAppSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

export async function isPerformancePublic() {
  const raw = await getAppSetting('performance_public', false);
  return raw === true || raw === 'true';
}

// Public: anyone can read the flag so the UI knows whether to render the page.
app.get('/api/settings/performance-public', async (_req, res) => {
  const enabled = await isPerformancePublic();
  res.json({ success: true, enabled });
});

// Admin-only: flip the flag.
app.put('/api/settings/performance-public', verifyToken, isAdmin, async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  try {
    await setAppSetting('performance_public', enabled);
    res.json({ success: true, enabled });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/games?date=YYYY-MM-DD
app.get('/api/games', async (req, res) => {
  try {
    const date = req.query.date || getEasternDateString();
    const games = await getTodayGames(date);
    res.json({ success: true, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/hexa/board?date=YYYY-MM-DD&force=0|1
// Public endpoint — no auth. Heavy lift is cached until 04:00 ET.
app.get('/api/hexa/board', async (req, res) => {
  try {
    const date  = req.query.date || undefined;
    const force = req.query.force === '1' || req.query.force === 'true';
    const board = await buildHexaBoard({ date, force });
    res.json({ success: true, data: board });
  } catch (err) {
    console.error('[hexa/board] failed:', err.message);
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/games/:gamePk/highlights-link — safe external link only (Tarea 4)
// Returns { available, externalUrl } — never serves video URLs directly.
app.get('/api/games/:gamePk/highlights-link', async (req, res) => {
  try {
    const info = await getGameHighlightsAvailability(req.params.gamePk);
    res.json({ success: true, data: info });
  } catch (err) {
    // Fail-soft: treat errors as "no highlights available"
    res.json({ success: true, data: { available: false, externalUrl: null, reason: 'fetch_failed' } });
  }
});

// GET /api/odds/today
app.get('/api/odds/today', async (req, res) => {
  try {
    const odds = await getGameOdds({ date: req.query.date });
    res.json({ success: true, data: odds, meta: getOddsApiStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/teams
app.get('/api/teams', async (req, res) => {
  try {
    const teams = await getTeams();
    res.json({ success: true, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/mlb/standings
app.get('/api/mlb/standings', async (req, res) => {
  try {
    const season = Number.parseInt(req.query.season, 10) || new Date().getFullYear();
    const standings = await getMlbStandings(season);
    res.json({ success: true, data: standings });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/mlb/playoffs
app.get('/api/mlb/playoffs', async (req, res) => {
  try {
    const season = Number.parseInt(req.query.season, 10) || new Date().getFullYear();
    const bracket = await getMlbPlayoffBracket(season);
    res.json({ success: true, data: bracket });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── Hexa Scout — futures + transactions (B9) ─────────────────────────────────

// GET /api/mlb/futures — MLB futures odds from The Odds API
app.get('/api/mlb/futures', verifyToken, async (req, res) => {
  try {
    const data = await getMlbFutures();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/mlb/transactions — recent roster moves (call-ups, IL, DFA, etc.)
app.get('/api/mlb/transactions', verifyToken, async (req, res) => {
  try {
    const days = Math.min(14, Math.max(1, Number(req.query.days ?? 3)));
    const data = await getMlbTransactions(days);
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── NBA endpoints ─────────────────────────────────────────────────────────────
// GET /api/nba/games?date=YYYY-MM-DD
app.get('/api/nba/games', async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    }
    const games = await getNbaGamesForDate(dateStr);
    res.json({ success: true, date: dateStr, count: games.length, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/nba/teams?season=2025-26
app.get('/api/nba/teams', async (req, res) => {
  try {
    const season = req.query.season || '2025-26';
    if (!/^\d{4}-\d{2}$/.test(season)) {
      return res.status(400).json({ success: false, error: 'season must be YYYY-YY (e.g. 2025-26)' });
    }
    const teams = await getNbaLeagueTeamStats(season);
    res.json({ success: true, season, count: teams.length, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/nba/standings?season=2025-26
app.get('/api/nba/standings', async (req, res) => {
  try {
    const season = req.query.season || '2025-26';
    if (!/^\d{4}-\d{2}$/.test(season)) {
      return res.status(400).json({ success: false, error: 'season must be YYYY-YY (e.g. 2025-26)' });
    }
    const data = await getNbaStandings(season);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/nba/playoffs?season=2025-26
app.get('/api/nba/playoffs', async (req, res) => {
  try {
    const season = req.query.season || '2025-26';
    if (!/^\d{4}-\d{2}$/.test(season)) {
      return res.status(400).json({ success: false, error: 'season must be YYYY-YY (e.g. 2025-26)' });
    }
    const data = await getNbaPlayoffBracket(season);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── NFL endpoints (Sprint 9a scaffolding — public, read-only) ─────────────────
// GET /api/nfl/games?season=&seasonType=&week=  — by week (NFL cadence). No params → current week.
app.get('/api/nfl/games', async (req, res) => {
  try {
    const season = req.query.season != null ? Number(req.query.season) : null;
    const seasonType = req.query.seasonType != null ? Number(req.query.seasonType) : null;
    const week = req.query.week != null ? Number(req.query.week) : null;
    if (season != null && !/^\d{4}$/.test(String(season))) {
      return res.status(400).json({ success: false, error: 'season must be a 4-digit year' });
    }
    if (seasonType != null && ![1, 2, 3].includes(seasonType)) {
      return res.status(400).json({ success: false, error: 'seasonType must be 1 (pre), 2 (regular) or 3 (post)' });
    }
    const games = await getNflGamesForWeek({ season, seasonType, week });
    const resolved = (season == null || seasonType == null || week == null) ? await getCurrentNflWeek() : null;
    res.json({
      success: true,
      season: season ?? resolved?.season ?? null,
      seasonType: seasonType ?? resolved?.seasonType ?? null,
      week: week ?? resolved?.week ?? null,
      count: games.length,
      data: games,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/nfl/teams?season=2025  — season team stats (standings-derived)
app.get('/api/nfl/teams', async (req, res) => {
  try {
    const season = req.query.season != null ? Number(req.query.season) : null;
    if (season != null && !/^\d{4}$/.test(String(season))) {
      return res.status(400).json({ success: false, error: 'season must be a 4-digit year' });
    }
    const teams = await getNflTeamStats(season);
    res.json({ success: true, season: season ?? (teams[0]?.season ?? null), count: teams.length, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/nfl/standings?season=2025
app.get('/api/nfl/standings', async (req, res) => {
  try {
    const season = req.query.season != null ? Number(req.query.season) : null;
    if (season != null && !/^\d{4}$/.test(String(season))) {
      return res.status(400).json({ success: false, error: 'season must be a 4-digit year' });
    }
    const data = await getNflStandings(season);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── NHL endpoints (Sprint 10a scaffolding — public, read-only) ────────────────
// GET /api/nhl/games?date=YYYY-MM-DD  — by date (NHL cadence). No date → today.
app.get('/api/nhl/games', async (req, res) => {
  try {
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    }
    const games = await getNhlGamesForDate(dateStr);
    res.json({ success: true, date: dateStr, count: games.length, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/nhl/teams?season=2026  — season team stats (standings-derived)
app.get('/api/nhl/teams', async (req, res) => {
  try {
    const season = req.query.season != null ? Number(req.query.season) : null;
    if (season != null && !/^\d{4}$/.test(String(season))) {
      return res.status(400).json({ success: false, error: 'season must be a 4-digit year' });
    }
    const teams = await getNhlTeamStats(season);
    res.json({ success: true, season: season ?? null, count: teams.length, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/nhl/standings?season=2026
app.get('/api/nhl/standings', async (req, res) => {
  try {
    const season = req.query.season != null ? Number(req.query.season) : null;
    if (season != null && !/^\d{4}$/.test(String(season))) {
      return res.status(400).json({ success: false, error: 'season must be a 4-digit year' });
    }
    const data = await getNhlStandings(season);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── Soccer endpoints ──────────────────────────────────────────────────────────
// GET /api/soccer/games?league=eng.1&date=YYYY-MM-DD
app.get('/api/soccer/games', async (req, res) => {
  try {
    const { league, date } = req.query;
    if (!league || !SOCCER_LEAGUE_SLUGS.includes(league)) {
      return res.status(400).json({
        success: false,
        error: `league required; supported: ${SOCCER_LEAGUE_SLUGS.join(', ')}`,
      });
    }
    const dateStr = date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    }
    const games = await getSoccerGamesForDate(league, dateStr);
    res.json({ success: true, league, date: dateStr, count: games.length, data: games });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/soccer/teams?league=eng.1
app.get('/api/soccer/teams', async (req, res) => {
  try {
    const { league } = req.query;
    if (!league || !SOCCER_LEAGUE_SLUGS.includes(league)) {
      return res.status(400).json({
        success: false,
        error: `league required; supported: ${SOCCER_LEAGUE_SLUGS.join(', ')}`,
      });
    }
    const teams = await getSoccerTeams(league);
    res.json({ success: true, league, count: teams.length, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/soccer/standings?league=eng.1
app.get('/api/soccer/standings', async (req, res) => {
  try {
    const { league } = req.query;
    if (!league || !SOCCER_LEAGUE_SLUGS.includes(league)) {
      return res.status(400).json({
        success: false,
        error: `league required; supported: ${SOCCER_LEAGUE_SLUGS.join(', ')}`,
      });
    }
    const data = await getSoccerStandings(league);
    res.json({ success: true, league, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── Tennis endpoints ──────────────────────────────────────────────────────────
// GET /api/tennis/matches?tour=atp&date=YYYY-MM-DD
app.get('/api/tennis/matches', async (req, res) => {
  try {
    const { tour, date } = req.query;
    if (!tour || !TENNIS_TOURS_LIST.includes(tour)) {
      return res.status(400).json({
        success: false,
        error: `tour required; supported: ${TENNIS_TOURS_LIST.join(', ')}`,
      });
    }
    const dateStr = date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
    }
    console.log(`[tennis-matches] GET tour=${tour} date=${dateStr}`);
    let matches = await getTennisMatchesForDate(tour, dateStr);

    // Fallback: if ESPN returned nothing, use The Odds API match list.
    // The Odds API has player names + commence times for upcoming matches.
    if (matches.length === 0) {
      console.log(`[tennis-matches] ESPN returned 0 for ${tour} ${dateStr} — trying Odds API fallback`);
      try {
        const oddsEvents = await getTennisMatchOdds({ tour, date: dateStr });
        matches = oddsEvents.map(ev => {
          const compDate = ev.commenceTime ?? null;
          // Only include events on the requested date.
          if (compDate && !String(compDate).startsWith(dateStr)) return null;
          return {
            matchId:        ev.eventId ?? null,
            tour,
            tournamentId:   null,
            tournamentName: null,
            matchDate:      compDate,
            surface:        null,
            round:          null,
            roundDepth:     null,
            status:         'scheduled',
            statusName:     null,
            statusDetail:   null,
            isVoidStatus:   false,
            players: {
              a: { id: null, name: ev.playerA, country: null, flag: null, setsWon: null, gamesPerSet: [], winner: false, seed: null },
              b: { id: null, name: ev.playerB, country: null, flag: null, setsWon: null, gamesPerSet: [], winner: false, seed: null },
            },
            winner:    null,
            _source:   'oddsapi',
          };
        }).filter(Boolean);
        console.log(`[tennis-matches] Odds API fallback: ${matches.length} matches for ${tour} ${dateStr}`);
      } catch (oddsErr) {
        console.warn(`[tennis-matches] Odds API fallback failed: ${oddsErr.message}`);
      }
    }

    res.json({ success: true, tour, date: dateStr, count: matches.length, data: matches });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/tennis/rankings?tour=atp
app.get('/api/tennis/rankings', async (req, res) => {
  try {
    const { tour } = req.query;
    if (!tour || !TENNIS_TOURS_LIST.includes(tour)) {
      return res.status(400).json({
        success: false,
        error: `tour required; supported: ${TENNIS_TOURS_LIST.join(', ')}`,
      });
    }
    const data = await getTennisRankings(tour);
    res.json({ success: true, tour, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/games/:gameId/context  — devuelve el contexto en texto plano
app.get('/api/games/:gameId/context', verifyToken, async (req, res) => {
  try {
    const contextResult = await buildContextById(req.params.gameId);
    const context = contextResult.context ?? contextResult;
    res.json({ success: true, data: context });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/game  — requires auth, costs 1 (fast) or 2 (deep) + 3 if webSearch
app.post('/api/analyze/game', analysisLimiter, verifyToken, async (req, res) => {
  const {
    gameId,
    language    = 'en',
    lang,
    betType,
    riskProfile = 'medium',
    webSearch   = false,
    model       = 'fast',
    engine      = 'sonnet',
  } = req.body;
  const date         = req.body.date || new Date().toISOString().split('T')[0];
  const resolvedEngine = normalizeRequestedEngine(engine);
  // Input validation
  if (!gameId) return res.status(400).json({ success: false, error: 'gameId is required' });
  if (model && !['fast', 'deep', 'premium'].includes(model)) return res.status(400).json({ success: false, error: 'Invalid model' });
  if (model === 'premium' && !req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Premium model is currently admin-only' });
  }
  if (resolvedEngine !== 'sonnet' && !req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Alternate engines are currently admin-only' });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: 'Invalid date format' });
  const resolvedLang = lang ?? language;
  const cost         = calcServerCost('single', model, webSearch);

  // Require email verification before allowing analysis
  const gameUserCheck = await pool.query('SELECT email_verified FROM users WHERE id = $1', [req.user.id]);
  if (gameUserCheck.rows[0] && !gameUserCheck.rows[0].email_verified) {
    return res.status(403).json({ success: false, error: 'Please verify your email before running analysis' });
  }

  try {
    let games    = await getTodayGames(date);
    let gameData = games.find(g => String(g.gamePk) === String(gameId));

    if (!gameData) {
      // Retry with today's explicit date in case the caller passed a stale/different date
      const todayStr = new Date().toISOString().split('T')[0];
      if (todayStr !== date) {
        const retryGames = await getTodayGames(todayStr);
        console.log(`[index] gamePk ${gameId} not found in date=${date}; retrying with today=${todayStr}. ` +
          `Found gamePks: [${retryGames.map(g => g.gamePk).join(', ')}]`);
        gameData = retryGames.find(g => String(g.gamePk) === String(gameId));
        if (gameData) games = retryGames;
      } else {
        console.log(`[index] gamePk ${gameId} not found. Available gamePks for ${date}: [${games.map(g => g.gamePk).join(', ')}]`);
      }
    }

    if (!gameData) return res.status(404).json({ success: false, error: `Partido ${gameId} no encontrado` });

    let matchedOdds = null;
    try {
      const allOdds = await getGameOdds({ date });
      matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
    } catch { /* odds are optional */ }

    const updatedUser = await deductCredits(req, res, cost);
    if (!updatedUser) return;

    // Fetch user bankroll for Kelly Criterion calculation
    let userBankroll = null;
    try {
      const brResult = await pool.query(
        'SELECT current_bankroll FROM bankroll WHERE user_id = $1',
        [req.user.id]
      );
      if (brResult.rows.length > 0) {
        userBankroll = parseFloat(brResult.rows[0].current_bankroll);
      }
    } catch { /* bankroll is optional — never block the analysis */ }

    let analysis;
    let featureStore = null;
    try {
      const contextResult = await buildContext(gameData, matchedOdds);
      const context = contextResult.context ?? contextResult;
      const shadowFeatures = contextResult._features ?? {};
      featureStore = buildFeatureStorePayload(gameData, date, shadowFeatures);
      const matchup = `${gameData.teams?.away?.abbreviation ?? 'AWAY'} @ ${gameData.teams?.home?.abbreviation ?? 'HOME'}`;

      const statcastData = buildShadowStatcastData(shadowFeatures);

      analysis = await analyzeGame({
        matchup, betType, context, riskProfile,
        mode: 'single', lang: resolvedLang, webSearch, model, timeoutMs: 90000,
        statcastData,
        mlbApiData: gameData,
        userBankroll,
        engine: resolvedEngine,
      });
    } catch (err) {
      await refundCredits(updatedUser.id, cost, updatedUser.is_admin);
      const isTimeout = err.message === 'TIMEOUT';
      return res.status(500).json({
        success: false,
        error: isTimeout
          ? 'El análisis tardó demasiado. Créditos reembolsados. Por favor reintenta.'
          : 'Análisis fallido. Tus créditos han sido reembolsados.',
      });
    }

    const responseData = analysis.data
      ? {
          ...annotateAnalysisData(analysis.data, featureStore?.features ?? {}, gameData),
          matchup: `${gameData.teams?.away?.abbreviation ?? 'AWAY'} @ ${gameData.teams?.home?.abbreviation ?? 'HOME'}`,
          odds: matchedOdds ?? undefined,
        }
      : null;

    let mlOpinion = null;
    let pickAlignedForShadow = null;
    const shadowStatcast = buildShadowStatcastData(featureStore?.features ?? {});
    const shadowFeatures = featureStore?.features ?? {};

    if (req.user.is_admin && analysis?.data && gameData) {
      try {
        const aligned = await buildPickAlignedMlOpinion({
          analysisData: analysis.data,
          gameData,
          statcastData: shadowStatcast,
          features: shadowFeatures,
          xgboostResult: analysis.xgboostResult ?? null,
          admin: true,
        });
        mlOpinion = aligned.mlOpinion;
        pickAlignedForShadow = aligned.shadowFields;
      } catch (mlErr) {
        console.warn('[analyze/game] mlOpinion failed:', mlErr.message);
      }
    }

    let f5Suggestion = null;
    if (process.env.F5_SUGGESTION_ENABLED !== 'false' && req.user.is_admin && analysis?.data && gameData) {
      try {
        f5Suggestion = await buildF5Suggestion({
          analysisData: analysis.data,
          gameData,
          features: shadowFeatures,
          eventId: matchedOdds?.eventId ?? null,
          lang: resolvedLang,
        });
      } catch (f5Err) {
        console.warn('[analyze/game] f5Suggestion failed:', f5Err.message);
      }
    }

    let savedPick = null;
    if (responseData && !analysis.parseError) {
      try {
        const matchup = `${gameData.teams?.away?.abbreviation ?? 'AWAY'} @ ${gameData.teams?.home?.abbreviation ?? 'HOME'}`;
        savedPick = await persistAnalysisPick({
          userId: req.user.id,
          userEmail: req.user.email ?? null,
          type: 'single',
          matchup,
          analysisData: annotateAnalysisData(analysis.data, featureStore?.features ?? {}, gameData),
          model: model ?? 'fast',
          language: resolvedLang,
          gamePk: gameData.gamePk,
          gameDate: date,
          oddsData: matchedOdds ?? null,
          featureStore: featureStore ?? null,
          mlOpinion: req.user.is_admin ? mlOpinion : null,
        });
      } catch (saveErr) {
        console.warn('[single-persist] Could not auto-save single pick:', saveErr.message);
      }
    }

    if (isShadowModeEnabled() && analysis?.data && gameData) {
      try {
        await recordShadowModelRun({
          userId: req.user.id,
          userEmail: req.user.email ?? null,
          pickId: savedPick?.id ?? null,
          sourceType: 'analysis',
          analysisMode: 'single',
          gameData,
          gameDate: normalizeDateInput(date ?? gameData?.gameDate),
          analysisData: analysis.data,
          xgboostResult: analysis.xgboostResult ?? null,
          statcastData: shadowStatcast,
          features: shadowFeatures,
          pickAligned: pickAlignedForShadow,
          adminMl: req.user.is_admin === true,
        });
      } catch (shadowErr) {
        console.warn('[shadow-mode] Could not persist analysis run:', shadowErr.message);
      }
    }

    res.json({
      success: true,
      data: responseData,
      odds: matchedOdds ?? null,
      featureStore,
      savedPick: savedPick ?? null,
      parseError: analysis.parseError,
      rawText: analysis.rawText,
      credits: updatedUser.credits,
      engine: resolvedEngine,
      engineMeta: analysis.engineMeta ?? null,
      mlOpinion: mlOpinion ?? undefined,
      f5Suggestion: f5Suggestion ?? undefined,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/parlay  — requires auth, costs 4 (fast) or 8 (deep) credits
app.post('/api/analyze/parlay', analysisLimiter, verifyToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Parlay analysis is currently admin-only' });
  }
  const {
    gameIds,
    language    = 'en',
    lang,
    betType,
    riskProfile = 'medium',
    webSearch   = false,
    parlayLegs,
    model       = 'fast',
    engine      = 'sonnet',
  } = req.body;
  const date         = req.body.date || new Date().toISOString().split('T')[0];
  const resolvedEngine = normalizeRequestedEngine(engine);
  // Input validation
  if (!gameIds || !Array.isArray(gameIds) || gameIds.length === 0) return res.status(400).json({ success: false, error: 'gameIds array is required' });
  if (gameIds.length > 10) return res.status(400).json({ success: false, error: 'Maximum 10 games per parlay' });
  if (model && !['fast', 'deep'].includes(model)) return res.status(400).json({ success: false, error: 'Invalid model' });
  const resolvedLang = lang ?? language;
  const cost         = calcServerCost('parlay', model, false);

  // Require email verification before allowing analysis
  const parlayUserCheck = await pool.query('SELECT email_verified FROM users WHERE id = $1', [req.user.id]);
  if (parlayUserCheck.rows[0] && !parlayUserCheck.rows[0].email_verified) {
    return res.status(403).json({ success: false, error: 'Please verify your email before running analysis' });
  }

  try {
    const games = await getTodayGames(date);

    let allOdds = [];
    try { allOdds = await getGameOdds({ date: resolvedDate }); } catch { /* optional */ }

    const legOddsArr = gameIds.map(id => {
      const gameData = games.find(g => String(g.gamePk) === String(id));
      if (!gameData) return null;
      return matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
    });

    const updatedUser = await deductCredits(req, res, cost);
    if (!updatedUser) return;

    let analysis;
    try {
      const contexts = await Promise.all(
        gameIds.map(async (id, i) => {
          const gameData = games.find(g => String(g.gamePk) === String(id));
          if (!gameData) throw new Error(`Partido ${id} no encontrado`);
          return buildContext(gameData, legOddsArr[i] ?? null).then(r => r.context ?? r);
        })
      );
      analysis = await analyzeParlay(contexts, resolvedLang, {
        betType,
        riskProfile,
        webSearch,
        legs: parlayLegs,
        model,
        timeoutMs: 90000,
        engine: resolvedEngine,
      });
    } catch (err) {
      await refundCredits(updatedUser.id, cost, updatedUser.is_admin);
      const isTimeout = err.message === 'TIMEOUT';
      return res.status(500).json({
        success: false,
        error: isTimeout
          ? 'El análisis tardó demasiado. Créditos reembolsados. Por favor reintenta.'
          : 'Análisis fallido. Tus créditos han sido reembolsados.',
      });
    }

    const responseData = analysis.data
      ? { ...analysis.data, legOdds: legOddsArr.some(Boolean) ? legOddsArr : undefined }
      : null;
    res.json({
      success: true,
      data: responseData,
      parseError: analysis.parseError,
      rawText: analysis.rawText,
      credits: updatedUser.credits,
      engine: resolvedEngine,
      engineMeta: analysis.engineMeta ?? null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/parlay-synergy — Parlay Synergy Engine (paid users), costs 6 (fast) / 12 (deep)
app.post('/api/analyze/parlay-synergy', analysisLimiter, verifyToken, requireVerifiedEmail, async (req, res) => {
  // Feature flag — off by default until explicitly enabled in .env
  if (process.env.PARLAY_SYNERGY_ENABLED !== 'true') {
    return res.status(503).json({
      success: false,
      error: 'Parlay Synergy Engine coming soon. / El motor de parlays sinérgicos estará disponible próximamente.',
    });
  }

  const {
    gameIds,
    requestedLegs  = 3,
    mode           = 'balanced',
    minEdge,
    allowSGP       = true,
    lang           = 'en',
    engine         = 'anthropic',
    model          = 'fast',
    betType        = 'all',
    date,
    marketFocus,
  } = req.body;

  const resolvedDate   = date || new Date().toISOString().split('T')[0];
  const resolvedLang   = normalizeRequestLanguage(lang);
  const resolvedEngine = normalizeArchitectProvider(engine);
  const resolvedMarketFocus = normalizeMarketFocus(marketFocus ?? betType);
  const resolvedModelSelection = resolveArchitectModelSelection({
    provider: resolvedEngine,
    tier: model,
  });

  // ── Input validation ────────────────────────────────────────────────────
  if (!gameIds || !Array.isArray(gameIds) || gameIds.length < 2) {
    return res.status(400).json({ success: false, error: 'gameIds must be an array with at least 2 games' });
  }
  if (requestedLegs < 2 || requestedLegs > 30) {
    return res.status(400).json({ success: false, error: 'requestedLegs must be between 2 and 30' });
  }
  const VALID_MODES = ['safe', 'conservative', 'balanced', 'aggressive', 'dreamer'];
  if (!VALID_MODES.includes(mode)) {
    return res.status(400).json({ success: false, error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}` });
  }
  // Safe mode raises the per-leg probability floor; value modes keep the 55% coin-flip floor.
  const effectiveMinConfidence = req.body.minConfidence ?? (mode === 'safe' ? 62 : 55);
  if (model && !['fast', 'deep'].includes(model)) {
    return res.status(400).json({ success: false, error: 'Invalid model' });
  }
  const VALID_BET_TYPES = ['all', 'moneyline', 'runline', 'totals', 'props', 'pitcher_props', 'batter_props'];
  if (betType && !VALID_BET_TYPES.includes(betType)) {
    return res.status(400).json({ success: false, error: `Invalid betType. Must be one of: ${VALID_BET_TYPES.join(', ')}` });
  }
  try {
    assertArchitectProviderConfigured(resolvedEngine);
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message, engine: resolvedEngine });
  }

  const PARLAY_SYNERGY_COST = model === 'deep' ? 12 : 6;

  // ── Email verification ──────────────────────────────────────────────────
  const synergyUserCheck = await pool.query('SELECT email_verified FROM users WHERE id = $1', [req.user.id]);
  if (synergyUserCheck.rows[0] && !synergyUserCheck.rows[0].email_verified) {
    return res.status(403).json({ success: false, error: 'Please verify your email before running analysis' });
  }

  try {
    const totalStart = Date.now();

    // ── Step 1: Candidate pool (cached, fast on repeat calls) ───────────
    const rawCandidates = await buildCandidatePool({ gameIds, date: resolvedDate, lang: resolvedLang });

    if (rawCandidates.length === 0) {
      console.warn(`[parlay-synergy] empty candidate pool for gameIds=[${gameIds.join(',')}] date=${resolvedDate}`);
      return res.status(422).json({
        success: false,
        error: 'No candidates found for the provided games. Try a different date or game selection. / No se encontraron candidatos para los juegos indicados.',
        debug: { gameIds, date: resolvedDate, reason: 'empty_pool' },
      });
    }

    // ── Step 1b: Apply betType filter ────────────────────────────────────
    const candidates = filterCandidatesByBetType(rawCandidates, betType);
    if (betType && betType !== 'all') {
      console.log(`[parlay-synergy] betType="${betType}" filter: ${rawCandidates.length} → ${candidates.length} candidates`);
    }
    if (candidates.length === 0) {
      console.warn(`[parlay-synergy] betType="${betType}" filter emptied pool (raw=${rawCandidates.length}) for gameIds=[${gameIds.join(',')}]`);
      return res.status(422).json({
        success: false,
        error: resolvedLang === 'es'
          ? `Ningún candidato disponible para el filtro "${betType}" en los juegos seleccionados. Prueba otro tipo de pick o selecciona más juegos.`
          : `No candidates match the "${betType}" filter for the selected games. Try a different pick type or add more games.`,
        debug: { gameIds, date: resolvedDate, betType, rawPoolSize: rawCandidates.length, reason: 'empty_after_bet_type_filter' },
      });
    }

    // ── Deduct credits after confirming we have data ─────────────────────
    const updatedUser = await deductCredits(req, res, PARLAY_SYNERGY_COST);
    if (!updatedUser) return;

    // ── Step 2: Fetch per-game features (context builder TTL: 10 min) ───
    const allGames = await getTodayGames(resolvedDate);
    let allOdds = [];
    try { allOdds = await getGameOdds({ date: resolvedDate }); } catch { /* optional */ }

    const featuresByGamePk = new Map();
    const gameDataByGamePk = new Map();
    for (const id of gameIds) {
      const gamePk = Number(id);
      const gameData = allGames.find(g => g.gamePk === gamePk);
      if (!gameData) continue;
      const oddsData = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
      const { _features } = await buildContext(gameData, oddsData ?? null);
      featuresByGamePk.set(gamePk, _features);
      gameDataByGamePk.set(gamePk, gameData);
    }

    // ── Step 3: Risk vector enrichment ──────────────────────────────────
    const enrichedAll = enrichPoolWithRiskVectors(candidates, featuresByGamePk, gameDataByGamePk);
    const enriched = filterCandidatesByMarketFocus(enrichedAll, resolvedMarketFocus);
    if (enriched.length === 0) {
      await refundCredits(updatedUser.id, PARLAY_SYNERGY_COST, updatedUser.is_admin);
      return res.status(422).json({
        success: false,
        error: resolvedLang === 'es'
          ? 'No se encontraron candidatos para el enfoque de mercado solicitado. Prueba All Types o selecciona mas juegos.'
          : 'No candidates found for the requested market focus. Try All Types or select more games.',
        debug: { gameIds, date: resolvedDate, marketFocus: resolvedMarketFocus, originalPoolSize: enrichedAll.length },
      });
    }
    const oddsStatus = getOddsApiStatus();
    const pricedCandidateCount = enriched.filter(c => c.odds != null).length;
    const oddsWarnings = [];
    if (!oddsStatus.keyConfigured) {
      oddsWarnings.push(resolvedLang === 'es'
        ? 'ODDS_API_KEY no esta configurada en el backend; las cuotas reales no pueden cargarse.'
        : 'ODDS_API_KEY is not configured on the backend; real odds cannot load.');
    } else if (oddsStatus.ok === false) {
      oddsWarnings.push(resolvedLang === 'es'
        ? `The Odds API fallo o devolvio error (${oddsStatus.status ?? 'unknown'}); revisa cuota/credenciales.`
        : `The Odds API failed or returned an error (${oddsStatus.status ?? 'unknown'}); check quota/credentials.`);
    } else if (oddsStatus.partialMarkets) {
      oddsWarnings.push(resolvedLang === 'es'
        ? 'The Odds API no tenia creditos suficientes para todos los mercados; se uso fallback h2h y solo Moneyline tendra cuotas reales.'
        : 'The Odds API did not have enough credits for all markets; h2h fallback was used and only Moneyline will have real odds.');
    } else if (pricedCandidateCount === 0) {
      oddsWarnings.push(resolvedLang === 'es'
        ? 'No se empataron cuotas reales para los juegos seleccionados; las patas se generaron sin precio de mercado.'
        : 'No real odds matched the selected games; legs were generated without market prices.');
    }

    // ── Step 4: Correlation matrix ───────────────────────────────────────
    const correlationMatrix = buildCorrelationMatrix(enriched);

    // ── Step 5: Compose top-3 parlays ────────────────────────────────────
    const composerStart = Date.now();
    const effectiveMinEdge = minEdge ?? { safe: 0, conservative: 3, balanced: 2, aggressive: 2, dreamer: 1.5 }[mode] ?? 2;
    let { parlays: composedParlays, meta: composerMeta } = composeParlays({
      candidates: enriched,
      correlationMatrix,
      N: requestedLegs,
      mode,
      filters: { minEdge: effectiveMinEdge, minConfidence: effectiveMinConfidence, allowSGP },
    });

    if (composedParlays.length === 0 && mode === 'conservative' && effectiveMinEdge > 0) {
      console.warn(`[parlay-synergy] conservative retry with relaxed constraints after strict minEdge=${effectiveMinEdge} returned no parlays`);
      const relaxed = composeParlays({
        candidates: enriched,
        correlationMatrix,
        N: requestedLegs,
        mode,
        filters: { minEdge: 0, minConfidence: effectiveMinConfidence, allowSGP, allowNullEdge: true, allowHighRisk: true },
      });
      composedParlays = relaxed.parlays;
      composerMeta = {
        ...relaxed.meta,
        strict_min_edge: effectiveMinEdge,
        effective_min_edge: 0,
        relaxed_min_edge: true,
      };
    }
    const composerMs = Date.now() - composerStart;

    if (composedParlays.length === 0) {
      await refundCredits(updatedUser.id, PARLAY_SYNERGY_COST, updatedUser.is_admin);
      return res.status(422).json({
        success: false,
        error: `Composer could not build a valid ${requestedLegs}-leg parlay for mode="${mode}". Try fewer legs, a different mode, or more games. / El compositor no pudo construir un parlay válido de ${requestedLegs} patas. Intenta con menos patas, otro modo, o más juegos.`,
      });
    }

    // ── Step 6: LLM Architect validation ─────────────────────────────────
    const llmStart = Date.now();
    const architectDecision = await askArchitect({
      candidatePool: enriched,
      composedParlays,
      mode,
      N: requestedLegs,
      lang: resolvedLang,
      provider: resolvedModelSelection.provider,
      tier: resolvedModelSelection.tier,
      model: resolvedModelSelection.model,
    });
    const llmMs    = Date.now() - llmStart;
    const totalMs  = Date.now() - totalStart;

    // ── Step 7: Assemble response ─────────────────────────────────────────
    const topComposed   = composedParlays[0];
    const alternatives  = composedParlays.slice(1);

    // Resolve architect's chosen leg IDs back to full candidate objects
    const composerBuiltLegs = topComposed.legs.length;
    let finalLegs = resolveLegs(architectDecision.final_legs, enriched);
    if (finalLegs.length < composerBuiltLegs) {
      // Fallback: architect returned bad IDs — use top composer parlay
      console.warn('[parlay-synergy] architect leg resolution incomplete, falling back to composer top');
      finalLegs = topComposed.legs;
    }
    const actualBuiltLegs = finalLegs.length;
    const partialWarning = topComposed.partial_warning
      ?? (actualBuiltLegs < requestedLegs
        ? `Pool only supported ${actualBuiltLegs} of ${requestedLegs} requested legs.`
        : null);

    const overrodeComposer =
      architectDecision.decision !== 'confirm' || architectDecision.chosen_index !== 0;

    // ── Hit distribution — the honest math of "how many legs should hit" ──
    const hitDistribution = computeHitDistribution(
      finalLegs.map(l => (l.modelProbability ?? 0) / 100),
    );
    const hitMathWarnings = [];
    if (hitDistribution.n >= 6) {
      const pAllPct = (hitDistribution.p_all * 100).toFixed(1);
      const expected = hitDistribution.expected_hits;
      hitMathWarnings.push(resolvedLang === 'es'
        ? `Realidad estadística: con estas patas esperas acertar ~${expected} de ${hitDistribution.n}. Pegar las ${hitDistribution.n} tiene ~${pAllPct}% de probabilidad. Para mejor chance de cobrar, considera 4-6 patas.`
        : `Statistical reality: with these legs you should expect ~${expected} of ${hitDistribution.n} to hit. Hitting all ${hitDistribution.n} is ~${pAllPct}% likely. For a better shot at cashing, consider 4-6 legs.`);
    }

    const legSummary = legs => legs.map(l => ({
      candidateId:      l.candidateId,
      gamePk:           l.gamePk,
      matchup:          l.matchup,
      pick:             l.pick,
      type:             l.type,
      odds:             l.odds,
      decimalOdds:      l.decimalOdds,
      modelProbability: l.modelProbability,
      edge:             l.edge,
      reasoning:        (l.reasoning ?? '').slice(0, 200),
      riskVector:       l.riskVector,
      gameScript:       l.gameScript,
    }));

    const persistedRunId = await persistParlayRun({
      userId: updatedUser.id, userEmail: updatedUser.email,
      gameIds, mode, requestedLegs,
      resolvedDate, resolvedLang, model, resolvedEngine,
      isAdminRun: updatedUser.is_admin, cost: PARLAY_SYNERGY_COST,
      enriched, composedParlays, architectDecision,
      finalLegs, composerMs, llmMs, totalMs,
      betType, marketFocus: resolvedMarketFocus,
    });

    res.json({
      success: true,
      data: {
        run_id: persistedRunId,
        chosen_parlay: {
          legs:                  legSummary(finalLegs),
          actual_legs:           actualBuiltLegs,
          requested_legs:        requestedLegs,
          combined_probability:  architectDecision.combined_probability,
          combined_decimal_odds: architectDecision.combined_decimal_odds,
          combined_edge_score:   finalLegs.reduce((s, l) => s + (l.edge ?? 0), 0),
          hit_distribution:      hitDistribution,
          synergy_type:          architectDecision.synergy_type,
          synergy_thesis:        architectDecision.synergy_thesis,
          warnings:              [
            ...oddsWarnings,
            ...hitMathWarnings,
            ...(architectDecision.warnings ?? []),
            ...(composerMeta.relaxed_min_edge
              ? [resolvedLang === 'es'
                ? `Modo conservador relajo el piso estricto de edge de ${composerMeta.strict_min_edge}% a 0% porque ningun parlay con odds reales supero el umbral estricto.`
                : `Conservative strict edge floor relaxed from ${composerMeta.strict_min_edge}% to 0% because no valid priced parlay cleared the strict threshold.`]
              : []),
            ...(partialWarning ? [partialWarning] : []),
          ],
        },
        alternatives: alternatives.map((alt, i) => ({
          index:                 i + 1,
          legs:                  legSummary(alt.legs),
          combined_probability:  alt.combinedMarginalProbability,
          combined_decimal_odds: alt.combinedDecimalOdds,
          combined_edge_score:   alt.legs.reduce((s, l) => s + (l.edge ?? 0), 0),
          score:                 alt.score,
        })),
        composer_meta: {
          mode,
          bet_type:             betType,
          market_focus:         resolvedMarketFocus,
          candidate_pool_size:  enriched.length,
          raw_pool_size:        rawCandidates.length,
          unfiltered_candidate_pool_size: enrichedAll.length,
          priced_candidate_count: pricedCandidateCount,
          null_odds_count:      enriched.length - pricedCandidateCount,
          odds_api:             oddsStatus,
          eligible_count:       composerMeta.eligibleCount,
          rejected_by_no_go:    composerMeta.rejectedByNoGo,
          strict_min_edge:       composerMeta.strict_min_edge ?? effectiveMinEdge,
          effective_min_edge:    composerMeta.effective_min_edge ?? effectiveMinEdge,
          relaxed_min_edge:      composerMeta.relaxed_min_edge ?? false,
          requested_legs:       requestedLegs,
          built_legs:           actualBuiltLegs,
          score_breakdown:      topComposed.scoreBreakdown,
        },
        architect_meta: {
          validated:                      true,
          overrode_composer:              overrodeComposer,
          hidden_correlations_detected:   architectDecision.hidden_correlations_detected ?? [],
          provider:                       resolvedModelSelection.provider,
          provider_label:                 resolvedModelSelection.providerLabel,
          model:                          resolvedModelSelection.model,
          tier:                           resolvedModelSelection.tier,
          timings: { composer_ms: composerMs, llm_ms: llmMs, total_ms: totalMs },
        },
      },
      credits: updatedUser.credits,
      engine:  resolvedEngine,
    });

    // ── Fase 7: Shadow mode — async compare with legacy analyzeParlay ─────
    if (process.env.SHADOW_MODE_ENABLED === 'true' && gameIds.length === 1) {
      (async () => {
        try {
          const shadowResult = await analyzeParlay(
            String(gameIds[0]), resolvedLang, resolvedDate, resolvedEngine
          );
          await pool.query(
            `UPDATE parlay_synergy_runs
             SET shadow_old_parlay = $1, resolved_at = NOW()
             WHERE user_id = $2 AND created_at = (
               SELECT MAX(created_at) FROM parlay_synergy_runs WHERE user_id = $2
             )`,
            [JSON.stringify(shadowResult), String(updatedUser.id)]
          );
        } catch (err) {
          console.error('[parlay-synergy] shadow mode failed (non-fatal):', err.message);
        }
      })();
    }

  } catch (err) {
    console.error('[parlay-synergy] endpoint error:', err.message, err.stack?.split('\n')[1]);
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/parlay-architect/history — user's own parlay runs (authenticated)
app.get('/api/parlay-architect/history', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         id, created_at, game_date, mode, requested_legs, game_pks,
         engine, model, bet_type, market_focus,
         architect_output, composed_top3, chosen_legs, combined_prob, combined_dec_odds,
         synergy_type, warnings, resolved, hit, legs_hit, leg_results
       FROM parlay_synergy_runs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [String(req.user.id)]
    );

    const entries = rows.map(row => {
      const architectOutput = row.architect_output ?? {};
      const composedTop3    = row.composed_top3 ?? [];
      const chosenIndex     = architectOutput.chosen_index ?? 0;
      const chosenParlay    = composedTop3[chosenIndex] ?? composedTop3[0] ?? null;
      const composedLegs    = chosenParlay?.legs ?? [];
      const composedById    = new Map(composedLegs.map(leg => [String(leg?.candidateId ?? ''), leg]));
      const storedLegs      = Array.isArray(row.chosen_legs) ? row.chosen_legs : [];
      const actualLegs      = storedLegs.length > 0
        ? storedLegs.map(leg => {
            const candidateId = leg && typeof leg === 'object' ? leg.candidateId : leg;
            return { ...(composedById.get(String(candidateId ?? '')) ?? {}), ...(leg && typeof leg === 'object' ? leg : { candidateId }) };
          })
        : composedLegs;

      return {
        id:                    `db_${row.id}`,
        db_id:                 row.id,
        created_at:            row.created_at,
        date:                  row.game_date,
        mode:                  row.mode,
        requested_legs:        row.requested_legs,
        actual_legs:           getActualLegCount({ legs: actualLegs, leg_results: row.leg_results, requested_legs: row.requested_legs }),
        game_ids:              row.game_pks ?? [],
        engine:                row.engine ?? null,
        model:                 row.model ?? null,
        bet_type:              row.bet_type ?? null,
        market_focus:          row.market_focus ?? null,
        synergy_type:          row.synergy_type ?? null,
        synergy_thesis:        architectOutput.synergy_thesis ?? null,
        combined_probability:  row.combined_prob ?? null,
        combined_decimal_odds: row.combined_dec_odds ?? null,
        combined_edge_score:   null,
        legs:                  actualLegs,
        warnings:              row.warnings ?? [],
        result:                deriveParlayOutcome(row),
        legs_hit:              row.legs_hit ?? null,
        leg_results:           row.leg_results ?? null,
        _fallback:             architectOutput._fallback ?? false,
        _source:               'server',
      };
    });

    res.json({ success: true, data: entries });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/parlay-architect/learnings — per-dimension performance aggregates
// for the authenticated user. Pure aggregation over their resolved history.
app.get('/api/parlay-architect/learnings', verifyToken, async (req, res) => {
  try {
    const data = await loadLearningsForUser(req.user.id);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[parlay-learnings] failed:', err.message);
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/parlay-synergy/recent — last 50 runs (admin only)
app.get('/api/admin/parlay-synergy/recent', verifyToken, isAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         id, user_id, user_email, game_date, game_pks, mode, requested_legs,
         engine, model,
         architect_output, chosen_legs,
         combined_prob, combined_dec_odds,
         synergy_type, warnings,
         resolved, hit, legs_hit, resolved_at,
         shadow_old_parlay, shadow_old_hit,
         timings, credits_charged, is_admin_run, created_at
       FROM parlay_synergy_runs
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/parlay-architect/:id/auto-resolve — grade each leg of a user's own
// run against final game state and aggregate. Same logic as the scheduled
// scan, but scoped to one row and accessible to the owning user.
app.post('/api/parlay-architect/:id/auto-resolve', verifyToken, async (req, res) => {
  const runId = Number(req.params.id);
  if (!Number.isInteger(runId) || runId < 1) {
    return res.status(400).json({ success: false, error: 'Invalid run id' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, game_date, chosen_legs, candidate_pool, resolved
         FROM parlay_synergy_runs
        WHERE id = $1`,
      [runId],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ success: false, error: 'Run not found' });
    if (String(row.user_id) !== String(req.user.id) && !req.user.is_admin) {
      return res.status(403).json({ success: false, error: 'Not your run' });
    }

    const out = await resolveParlayRunById({ runId, row });
    res.json({ success: true, data: out });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/admin/parlay-synergy/auto-resolve-all — scan every unresolved run
// and persist outcomes (admin only). Same call the scheduler makes.
app.post('/api/admin/parlay-synergy/auto-resolve-all', verifyToken, isAdmin, async (req, res) => {
  try {
    const limit = Number.isFinite(Number(req.body?.limit)) ? Number(req.body.limit) : 200;
    const summary = await resolvePendingParlays({ limit });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/admin/parlay-synergy/:id/resolve — mark a run hit/miss (admin only)
app.post('/api/admin/parlay-synergy/:id/resolve', verifyToken, isAdmin, async (req, res) => {
  const runId = Number(req.params.id);
  if (!Number.isInteger(runId) || runId < 1) {
    return res.status(400).json({ success: false, error: 'Invalid run id' });
  }
  const { hit, legs_hit } = req.body;
  if (typeof hit !== 'boolean') {
    return res.status(400).json({ success: false, error: 'hit must be a boolean' });
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE parlay_synergy_runs
       SET resolved = true, hit = $1, legs_hit = $2, resolved_at = NOW()
       WHERE id = $3`,
      [hit, legs_hit ?? null, runId]
    );
    if (rowCount === 0) return res.status(404).json({ success: false, error: 'Run not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/safe — Safe Pick mode (supports single gameId or multiple gameIds for parlay safe picks)
app.post('/api/analyze/safe', analysisLimiter, verifyToken, async (req, res) => {
  const { gameId, gameIds, lang = 'en', date, engine = 'sonnet', betType, marketFocus } = req.body;
  const resolvedDate = date || new Date().toISOString().split('T')[0];
  const resolvedEngine = normalizeRequestedEngine(engine);
  const resolvedMarketFocus = normalizeMarketFocus(marketFocus ?? betType);

  // Determine if this is a multi-game safe pick request
  const ids = gameIds && Array.isArray(gameIds) && gameIds.length > 0
    ? gameIds
    : gameId ? [gameId] : [];

  if (ids.length === 0) {
    return res.status(400).json({ success: false, error: 'gameId or gameIds is required' });
  }
  if (resolvedEngine !== 'sonnet' && !req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Alternate engines are currently admin-only' });
  }

  // Cost: 2 credits per game
  const cost = 2 * ids.length;
  const isMulti = ids.length > 1;

  // Require email verification before allowing analysis
  const safeUserCheck = await pool.query('SELECT email_verified FROM users WHERE id = $1', [req.user.id]);
  if (safeUserCheck.rows[0] && !safeUserCheck.rows[0].email_verified) {
    return res.status(403).json({ success: false, error: 'Please verify your email before running analysis' });
  }

  try {
    let games = await getTodayGames(resolvedDate);

    // Fallback: try today if requested date returned nothing
    if (games.length === 0) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (todayStr !== resolvedDate) {
        games = await getTodayGames(todayStr);
      }
    }

    let allOdds = [];
    try { allOdds = await getGameOdds({ date: resolvedDate }); } catch { /* optional */ }

    const updatedUser = await deductCredits(req, res, cost);
    if (!updatedUser) return;

    // Analyze each game individually in parallel
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const gameData = games.find(g => String(g.gamePk) === String(id));
        if (!gameData) return { gameId: id, error: `Game ${id} not found` };

        let matchedOdds = null;
        try {
          matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
        } catch { /* optional */ }

        try {
          const contextBuildResult = await buildContext(gameData, matchedOdds);
          const contextString = contextBuildResult.context ?? contextBuildResult;
          const analysis = await analyzeSafe({ contextString, lang, engine: resolvedEngine, timeoutMs: 90000 });
          const shadowFeatures = contextBuildResult._features ?? {};
          const shadowStatcastData = buildShadowStatcastData(shadowFeatures);
          const xgboostResult = calculateParallelScore(shadowStatcastData, gameData);
          const deterministicSafe = buildDeterministicSafePayload({
            gameData,
            features: shadowFeatures,
            oddsData: matchedOdds ?? shadowFeatures?.oddsData ?? null,
            xgboostResult,
            lang,
            llmData: analysis.data,
            marketFocus: resolvedMarketFocus,
          });

          // Augment with alt-line / team-total candidates. Cached menu from
          // Postgres (6h TTL) — first hit of the day pays the API quota.
          let altMenu = null;
          if (matchedOdds?.eventId) {
            try { altMenu = await getEventAlternates(matchedOdds.eventId); }
            catch (err) { console.warn(`[analyze/safe] alt fetch failed: ${err.message}`); }
          }
          const extendedCandidates = buildExtendedCandidates({
            gameData,
            features: shadowFeatures,
            mainCandidates: deterministicSafe?.safe_candidates ?? [],
            alternates: altMenu,
            lang,
          });
          if (deterministicSafe && extendedCandidates.length > 0) {
            deterministicSafe.safe_candidates = [
              ...(deterministicSafe.safe_candidates ?? []).map((c) => ({ ...c, market_source: c.market_source ?? 'main' })),
              ...extendedCandidates,
            ];
            deterministicSafe.extended_candidates = extendedCandidates;
          }

          const homeAbbr = gameData.teams?.home?.abbreviation ?? 'HOME';
          const awayAbbr = gameData.teams?.away?.abbreviation ?? 'AWAY';

          let mlOpinion = null;
          let pickAlignedForShadow = null;
          if (req.user.is_admin && deterministicSafe) {
            try {
              const aligned = await buildPickAlignedMlOpinion({
                analysisData: deterministicSafe,
                gameData,
                statcastData: shadowStatcastData,
                features: shadowFeatures,
                xgboostResult,
                admin: true,
              });
              mlOpinion = aligned.mlOpinion;
              pickAlignedForShadow = aligned.shadowFields;
            } catch (mlErr) {
              console.warn('[analyze/safe] mlOpinion failed:', mlErr.message);
            }
          }

          let savedPick = null;
          if (deterministicSafe && !analysis.parseError) {
            try {
              savedPick = await persistAnalysisPick({
                userId: req.user.id,
                userEmail: req.user.email ?? null,
                type: 'safe',
                matchup: `${awayAbbr} @ ${homeAbbr}`,
                analysisData: annotateAnalysisData(deterministicSafe, shadowFeatures, gameData),
                model: 'deep',
                language: lang,
                gamePk: gameData.gamePk,
                gameDate: resolvedDate,
                oddsData: matchedOdds ?? null,
                featureStore: buildFeatureStorePayload(gameData, resolvedDate, shadowFeatures),
                mlOpinion: req.user.is_admin ? mlOpinion : null,
              });
            } catch (saveErr) {
              console.warn('[safe-persist] Could not auto-save safe pick:', saveErr.message);
            }
          }

          if (isShadowModeEnabled() && deterministicSafe) {
            try {
              await recordShadowModelRun({
                userId: req.user.id,
                userEmail: req.user.email ?? null,
                pickId: savedPick?.id ?? null,
                sourceType: 'analysis',
                analysisMode: isMulti ? 'safe_multi' : 'safe_single',
                gameData,
                gameDate: normalizeDateInput(resolvedDate ?? gameData?.gameDate),
                analysisData: deterministicSafe,
                xgboostResult: xgboostResult ?? null,
                statcastData: shadowStatcastData,
                features: shadowFeatures,
                pickAligned: pickAlignedForShadow,
                adminMl: req.user.is_admin === true,
              });
            } catch (shadowErr) {
              console.warn('[shadow-mode] Could not persist safe analysis run:', shadowErr.message);
            }
          }

          return {
            gameId: id,
            matchup: `${awayAbbr} @ ${homeAbbr}`,
            data: annotateAnalysisData(deterministicSafe, shadowFeatures, gameData),
            rawText: analysis.rawText,
            parseError: analysis.parseError,
            odds: matchedOdds ?? undefined,
            featureStore: buildFeatureStorePayload(gameData, resolvedDate, shadowFeatures),
            savedPick,
            mlOpinion: mlOpinion ?? undefined,
          };
        } catch (err) {
          return {
            gameId: id,
            matchup: `Game ${id}`,
            error: err.message === 'TIMEOUT' ? 'Analysis timed out' : err.message,
          };
        }
      })
    );

    const processedResults = results.map(r =>
      r.status === 'fulfilled' ? r.value : { error: r.reason?.message ?? 'Unknown error' }
    );

    const successCount = processedResults.filter(r => r.data && !r.error).length;
    const failCount = processedResults.filter(r => r.error).length;

    // If any failed, refund those credits
    if (failCount > 0) {
      await refundCredits(updatedUser.id, failCount * 2, updatedUser.is_admin);
    }

    // For single game (backward compatible), return the old format
    if (!isMulti) {
      const single = processedResults[0];
      if (single.error) {
        return res.status(500).json({ success: false, error: single.error });
      }
      return res.json({
        success: true,
        data: single.data,
        odds: single.odds ?? null,
        featureStore: single.featureStore ?? null,
        savedPick: single.savedPick ?? null,
        parseError: single.parseError,
        rawText: single.rawText,
        credits: updatedUser.credits - (failCount * 2),
        mode: 'safe',
        engine: resolvedEngine,
        engineMeta: single.data?.engine_meta ?? null,
        mlOpinion: single.mlOpinion ?? undefined,
      });
    }

    // Multi-game: return array of results
    res.json({
      success: true,
      data: {
        mode: 'safe_multi',
        results: processedResults,
        summary: { total: ids.length, analyzed: successCount, failed: failCount },
      },
      credits: updatedUser.credits - (failCount * 2),
      mode: 'safe',
      engine: resolvedEngine,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/admin/grant-credits — Manually add credits to a user (admin only)
app.post('/api/admin/grant-credits', verifyToken, isAdmin, async (req, res) => {
  const { email, amount } = req.body;

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'email is required' });
  }
  if (amount === undefined || amount === null) {
    return res.status(400).json({ error: 'amount is required' });
  }
  const parsedAmount = Number(amount);
  if (!Number.isInteger(parsedAmount) || parsedAmount === 0) {
    return res.status(400).json({ error: 'amount must be a non-zero integer' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE users SET credits = credits + $2 WHERE email = $1 RETURNING credits',
      [email.toLowerCase().trim(), parsedAmount]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: `User with email '${email}' not found` });
    }

    console.log(`[Admin] Granted ${parsedAmount} credits to ${email}. New balance: ${rows[0].credits}`);
    res.json({ success: true, email: email.toLowerCase().trim(), credits: rows[0].credits });
  } catch (err) {
    console.error('[Admin] grant-credits error:', err.message);
    res.status(500).json({ error: 'Failed to update credits', details: safeError(err) });
  }
});

// GET /api/admin/db/* — read-only DB explorer (admin only)
mountAdminDbExplorer(app, { verifyToken, isAdmin });

// POST /api/analyze/batch — Admin Batch Scan: analyze multiple games individually in parallel
app.post('/api/analyze/batch', analysisLimiter, verifyToken, isAdmin, async (req, res) => {
  const { gameIds, lang = 'es', date } = req.body;

  // Input validation
  if (!gameIds || !Array.isArray(gameIds) || gameIds.length === 0) {
    return res.status(400).json({ success: false, error: 'gameIds array is required' });
  }
  if (gameIds.length > 16) {
    return res.status(400).json({ success: false, error: 'Maximum 16 games per batch scan' });
  }

  const resolvedDate = date || new Date().toISOString().split('T')[0];

  try {
    const games = await getTodayGames(resolvedDate);

    let allOdds = [];
    try { allOdds = await getGameOdds({ date: resolvedDate }); } catch { /* optional */ }

    // Build context for each game
    const gameContexts = await Promise.all(
      gameIds.map(async (id) => {
        const gameData = games.find(g => String(g.gamePk) === String(id));
        if (!gameData) return { id, error: `Game ${id} not found` };

        let matchedOdds = null;
        try {
          matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
        } catch { /* optional */ }

        try {
          const contextBuildResult2 = await buildContext(gameData, matchedOdds);
          const contextString = contextBuildResult2.context ?? contextBuildResult2;
          const homeAbbr = gameData.teams?.home?.abbreviation ?? 'HOME';
          const awayAbbr = gameData.teams?.away?.abbreviation ?? 'AWAY';
          return {
            id,
            gameData,
            contextString,
            features: contextBuildResult2._features ?? {},
            matchedOdds,
            matchup: `${awayAbbr} @ ${homeAbbr}`,
          };
        } catch (err) {
          return { id, error: `Context build failed: ${err.message}` };
        }
      })
    );

    // Analyze games in batches of 3 to avoid Anthropic API rate limits (30k tokens/min)
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 5000; // 5 seconds between batches
    const allResults = [];

    for (let i = 0; i < gameContexts.length; i += BATCH_SIZE) {
      const batch = gameContexts.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(gameContexts.length / BATCH_SIZE);
      console.log(`[Admin Batch] Processing batch ${batchNum}/${totalBatches} (${batch.length} games)`);

      const batchResults = await Promise.allSettled(
        batch.map(async (ctx) => {
          if (ctx.error) return { matchup: `Game ${ctx.id}`, error: ctx.error };

          try {
            const analysis = await analyzeGame({
              mode: 'single',
              matchup: ctx.matchup,
              context: ctx.contextString,
              lang,
              betType: 'all',
              riskProfile: 'balanced',
              webSearch: false,
              model: 'deep',
              timeoutMs: 120000,
            });

            return {
              gameId: ctx.id,
              matchup: ctx.matchup,
              data: annotateAnalysisData(analysis.data, ctx.features ?? {}, ctx.gameData ?? null),
              rawText: analysis.rawText,
              parseError: analysis.parseError,
              odds: ctx.matchedOdds ?? undefined,
              _featureStore: {
                gamePk: ctx.id,
                gameDate: resolvedDate,
                features: ctx.features ?? {},
              },
            };
          } catch (err) {
            return {
              gameId: ctx.id,
              matchup: ctx.matchup,
              error: err.message === 'TIMEOUT' ? 'Analysis timed out' : err.message,
            };
          }
        })
      );

      allResults.push(...batchResults);

      // Wait between batches to respect rate limits (skip delay after last batch)
      if (i + BATCH_SIZE < gameContexts.length) {
        console.log(`[Admin Batch] Waiting ${BATCH_DELAY_MS / 1000}s before next batch...`);
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    const results = allResults;

    // Process results and auto-save picks
    const processedResults = [];

    for (const result of results) {
      const value = result.status === 'fulfilled' ? result.value : { error: result.reason?.message ?? 'Unknown error' };

      if (value.error) {
        processedResults.push(value);
        continue;
      }

      // Auto-save pick to database
      if (value.data && !value.parseError) {
        try {
          const d = value.data;
          const mp = d.master_prediction ?? d.safe_pick ?? {};
          const bp = d.best_pick ?? {};

          const oddsAtPick = d.value_breakdown?.odds ?? value.odds?.moneyline?.home ?? value.odds?.moneyline?.away ?? null;
          const impliedProbAtPick = oddsAtPick != null
            ? (oddsAtPick < 0
                ? Math.abs(oddsAtPick) / (Math.abs(oddsAtPick) + 100)
                : 100 / (oddsAtPick + 100))
            : null;

          const pickResult = await pool.query(
            `INSERT INTO picks (user_id, type, matchup, pick, oracle_confidence, bet_value,
             model_risk, oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
             model, language, odds_at_pick, implied_prob_at_pick, odds_details, value_breakdown,
             safe_candidates, safe_scope, selection_method, user_email, sport, pick_time_lima)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'mlb',(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP)
             RETURNING id`,
            [
              req.user.id,
              'batch',
              value.matchup,
              mp.pick ?? bp.detail ?? null,
              mp.oracle_confidence ?? null,
              mp.bet_value ?? null,
              d.model_risk ?? null,
              d.oracle_report ?? null,
              d.hexa_hunch ?? null,
              JSON.stringify(d.alert_flags ?? []),
              JSON.stringify(d.probability_model ?? {}),
              JSON.stringify(d.best_pick ?? {}),
              'deep',
              lang,
              oddsAtPick,
              impliedProbAtPick,
              JSON.stringify(value.odds ?? {}),
              d.value_breakdown != null ? JSON.stringify(d.value_breakdown) : null,
              d.safe_candidates != null ? JSON.stringify(d.safe_candidates) : null,
              d.safe_scope ?? null,
              d.selection_method ?? null,
              req.user.email ?? null,
            ]
          );

          value.pickId = pickResult.rows[0]?.id;
          if (value.pickId) {
            await savePickFeatures({
              pickId: value.pickId,
              gamePk: Number(value._featureStore?.gamePk ?? value.gameId),
              gameDate: value._featureStore?.gameDate ?? resolvedDate,
              ...(value._featureStore?.features ?? {}),
              oddsData: value._featureStore?.features?.oddsData ?? value.odds ?? null,
              pick: mp.pick ?? bp.detail ?? null,
              result: null,
              userEmail: req.user.email ?? null,
              sport: 'mlb',
            });
          }
        } catch (saveErr) {
          console.error(`[Batch] Failed to save pick for ${value.matchup}:`, saveErr.message);
        }
      }

      delete value._featureStore;
      processedResults.push(value);
    }

    const successCount = processedResults.filter(r => r.data && !r.error).length;
    const failCount = processedResults.filter(r => r.error).length;

    console.log(`[Admin Batch] Completed: ${successCount} success, ${failCount} failed out of ${gameIds.length} games`);

    res.json({
      success: true,
      data: {
        results: processedResults,
        summary: {
          total: gameIds.length,
          analyzed: successCount,
          failed: failCount,
          date: resolvedDate,
        },
      },
    });
  } catch (err) {
    console.error('[Admin Batch] Error:', err);
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/analyze/chat — Direct chat with Oracle (admin only, no credits)
app.post('/api/analyze/chat', analysisLimiter, verifyToken, isAdmin, async (req, res) => {
  const { gameId, question, conversationHistory = [], lang = 'en', date, sessionKey, matchups } = req.body;

  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    const resolvedDate = date || getEasternDateString();
    let games    = await getTodayGames(resolvedDate);
    let gameData = games.find(g => String(g.gamePk) === String(gameId));

    if (!gameData) {
      // Widen the search to yesterday/tomorrow ET — covers edge cases around
      // day boundaries and schedules that wrap past midnight.
      for (const candidate of [shiftDateString(resolvedDate, -1), shiftDateString(resolvedDate, 1)]) {
        const retryGames = await getTodayGames(candidate);
        gameData = retryGames.find(g => String(g.gamePk) === String(gameId));
        if (gameData) {
          games = retryGames;
          break;
        }
      }
    }

    if (!gameData) return res.status(404).json({ success: false, error: `Partido ${gameId} no encontrado` });

    let matchedOdds = null;
    try {
      const allOdds = await getGameOdds({ date: resolvedDate });
      matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
    } catch { /* odds are optional */ }

    const contextBuildResult3 = await buildContext(gameData, matchedOdds);
    const baseContextString = contextBuildResult3.context ?? contextBuildResult3;
    const chatFeatures = contextBuildResult3._features ?? {};

    // Append the extended-market menu (alt RLs, alt totals, team totals)
    // to the context so the Oracle is aware of options beyond the main
    // moneyline / RL ±1.5 / total when the user asks for SAFE / LOCK picks.
    let extendedMenuString = '';
    try {
      const xgbResult = (() => {
        try { return calculateParallelScore(buildShadowStatcastData(chatFeatures), gameData); }
        catch { return null; }
      })();
      const safePayloadForMenu = buildDeterministicSafePayload({
        gameData,
        features: chatFeatures,
        oddsData: matchedOdds ?? chatFeatures?.oddsData ?? null,
        xgboostResult: xgbResult,
        lang,
        llmData: null,
        marketFocus: 'all',
      });
      let altMenuChat = null;
      if (matchedOdds?.eventId) {
        try { altMenuChat = await getEventAlternates(matchedOdds.eventId); }
        catch { /* optional */ }
      }
      const extendedForChat = buildExtendedCandidates({
        gameData,
        features: chatFeatures,
        mainCandidates: safePayloadForMenu?.safe_candidates ?? [],
        alternates: altMenuChat,
        lang,
      });
      extendedMenuString = formatExtendedMenuForLLM(extendedForChat, lang, 15);
    } catch (err) {
      console.warn(`[Oracle Chat] extended menu prep failed: ${err.message}`);
    }
    const contextString = `${baseContextString}${extendedMenuString}`;

    // Inject the JSON-tail extraction instruction into the user turn so the
    // Oracle's structured pick (if any) lands in a parseable trailing block.
    // The instruction is opt-out via X-HEXA-Skip-Pick-Extract=1 header for
    // pure-exploration chats where saving could mislead training.
    const skipExtract = String(req.headers['x-hexa-skip-pick-extract'] ?? '') === '1';
    // F5 awareness is additive and independent of pick extraction: even in a
    // skip-extract exploration chat, a "safest pick" question should still get
    // the F5-vs-full-game steer when the thesis is starter-driven.
    const f5Steer = f5ChatAwareness(question.trim(), lang);
    // Market-variety steer: on a "safest pick" request, force the Oracle to
    // weigh the full menu (run line / totals / team totals / props) instead of
    // defaulting to a moneyline favorite. Additive, independent of extraction.
    const varietySteer = varietyChatSteer(question.trim(), lang);
    const augmentedQuestion = (skipExtract
      ? question.trim()
      : augmentChatQuestion(question.trim(), lang)) + varietySteer + f5Steer;

    const rawAnswer = await analyzeChat({
      contextString,
      question: augmentedQuestion,
      conversationHistory,
      lang,
    });

    // Strip the JSON tail (if any) before showing the answer to the user, and
    // persist the extracted pick to picks + pick_features with source='oracle_chat'.
    let cleanAnswer = rawAnswer;
    let picked = null;
    if (!skipExtract) {
      try {
        const processed = await processChatAnswer({
          rawAnswer,
          question: question.trim(),
          userId: req.user.id,
          gameData,
          chatSessionId: null,    // filled below once we have the session id
          lang,
        });
        cleanAnswer = processed.answer;
        picked = processed.picked;
      } catch (err) {
        console.warn('[Oracle Chat] pick extraction failed (non-critical):', err.message);
      }
    }

    res.json({
      success: true,
      answer: cleanAnswer,
      mode: 'chat',
      picked,  // null | { pick_id, source_stage, market_type, side, line, ... }
    });

    // Persist conversation asynchronously — never blocks the response.
    // If we extracted a pick AND we now learn the session id, backfill
    // picks.chat_session_id so the bookkeeping links both ways.
    if (sessionKey) {
      const fullMessages = [
        ...conversationHistory.flatMap(t => [
          { role: 'user', text: t.question },
          { role: 'assistant', text: t.answer },
        ]),
        { role: 'user', text: question.trim() },
        { role: 'assistant', text: cleanAnswer },
      ];
      upsertOracleSession({
        userId: req.user.id,
        sessionKey,
        dateEt: getEasternDateString(),
        mode: 'partido',
        gameIds: [gameId],
        matchups: matchups || String(gameId),
        messages: fullMessages,
      }).then((sessionId) => {
        if (sessionId && picked?.pick_id) {
          pool.query(
            'UPDATE picks SET chat_session_id = $1 WHERE id = $2 AND chat_session_id IS NULL',
            [sessionId, picked.pick_id]
          ).catch((err) => console.warn(`[Oracle Chat] backfill chat_session_id failed: ${err.message}`));
        }
      });
    }
  } catch (err) {
    console.error('[Oracle Chat] Error:', err);
    res.status(500).json({ error: 'Chat failed', details: safeError(err) });
  }
});

// POST /api/analyze/chat-jornada — Multi-game jornada chat (admin only)
// Map: each gameId → buildContext() → summarizeGameBrief() via Haiku (parallel)
// Reduce: all briefs → analyzeChatJornada() via Opus 4.7 (single call)
app.post('/api/analyze/chat-jornada', analysisLimiter, verifyToken, isAdmin, async (req, res) => {
  const { gameIds, question, conversationHistory = [], lang = 'en', date, sessionKey, matchups } = req.body;

  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }
  if (!Array.isArray(gameIds) || gameIds.length < 2) {
    return res.status(400).json({ error: 'At least 2 gameIds are required for jornada mode' });
  }

  try {
    const resolvedDate = date || getEasternDateString();
    let games = await getTodayGames(resolvedDate);

    // Widen search to yesterday/tomorrow if needed (ET boundary edge cases)
    if (games.length === 0) {
      for (const candidate of [shiftDateString(resolvedDate, -1), shiftDateString(resolvedDate, 1)]) {
        const retry = await getTodayGames(candidate);
        if (retry.length > 0) { games = retry; break; }
      }
    }

    // Resolve each gameId to its game data
    const resolvedGames = gameIds.map(id => {
      const game = games.find(g => String(g.gamePk) === String(id));
      return game || null;
    }).filter(Boolean);

    if (resolvedGames.length === 0) {
      return res.status(404).json({ success: false, error: 'No matching games found for provided gameIds' });
    }

    // Fetch all odds once, then match per game
    let allOdds = [];
    try { allOdds = await getGameOdds({ date: resolvedDate }); } catch { /* odds optional */ }

    // On a "safest pick of the day" request, enrich each per-game brief with
    // the deterministic extended menu (alt run lines / alt totals / team
    // totals). The Haiku brief only carries ML + O/U line, so without this the
    // cross-game lock decision can never see a non-moneyline option. Gated on a
    // lock request so normal jornada questions don't pay the extra fetch cost.
    const isLockJornada = looksLikeLockRequest(question);

    // MAP phase: build context + summarize with Haiku — all in parallel
    const gameBriefs = await Promise.all(
      resolvedGames.map(async (gameData) => {
        const away = gameData.teams?.away?.abbreviation || gameData.teams?.away?.team?.abbreviation || '?';
        const home = gameData.teams?.home?.abbreviation || gameData.teams?.home?.team?.abbreviation || '?';
        const matchup = `${away} @ ${home}`;

        let matchedOdds = null;
        try {
          matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);
        } catch { /* odds optional per game */ }

        const contextResult = await buildContext(gameData, matchedOdds);
        const contextString = contextResult.context ?? contextResult;

        const brief = await summarizeGameBrief({ contextString, matchup, lang });
        if (!isLockJornada) return brief;

        try {
          const features = contextResult._features ?? {};
          const xgbResult = (() => {
            try { return calculateParallelScore(buildShadowStatcastData(features), gameData); }
            catch { return null; }
          })();
          const safePayload = buildDeterministicSafePayload({
            gameData,
            features,
            oddsData: matchedOdds ?? features?.oddsData ?? null,
            xgboostResult: xgbResult,
            lang,
            llmData: null,
            marketFocus: 'all',
          });
          let altMenu = null;
          if (matchedOdds?.eventId) {
            try { altMenu = await getEventAlternates(matchedOdds.eventId); }
            catch { /* optional */ }
          }
          const extended = buildExtendedCandidates({
            gameData,
            features,
            mainCandidates: safePayload?.safe_candidates ?? [],
            alternates: altMenu,
            lang,
          });
          const menu = formatExtendedMenuForLLM(extended, lang, 8);
          return menu ? `MATCHUP: ${matchup}${menu}\n${brief}` : brief;
        } catch (err) {
          console.warn(`[Oracle Jornada Chat] extended menu prep failed for ${matchup}: ${err.message}`);
          return brief;
        }
      })
    );

    const extractorGames = resolvedGames.map((gameData) => {
      const away = gameData.teams?.away?.abbreviation || gameData.teams?.away?.team?.abbreviation || '?';
      const home = gameData.teams?.home?.abbreviation || gameData.teams?.home?.team?.abbreviation || '?';
      return {
        game_id: gameData.gamePk,
        matchup: `${away} @ ${home}`,
        away,
        home,
      };
    });

    const skipExtract = String(req.headers['x-hexa-skip-pick-extract'] ?? '') === '1';
    const userQuestion = question.trim();
    const augmentedQuestion = (skipExtract
      ? userQuestion
      : augmentChatQuestion(userQuestion, lang, 'mlb', {
          mode: 'jornada',
          multi: true,
          games: extractorGames,
        })) + varietyChatSteer(userQuestion, lang) + f5ChatAwareness(userQuestion, lang);

    // REDUCE phase: single Opus 4.7 call across all briefs
    const rawAnswer = await analyzeChatJornada({
      gameBriefs,
      question: augmentedQuestion,
      conversationHistory,
      lang,
    });

    let cleanAnswer = rawAnswer;
    let picked = [];
    if (!skipExtract) {
      try {
        const processed = await processChatAnswerForGames({
          rawAnswer,
          question: userQuestion,
          userId: req.user.id,
          gameDataList: resolvedGames,
          chatSessionId: null,
          lang,
          sport: 'mlb',
        });
        cleanAnswer = processed.answer;
        picked = processed.picked;
      } catch (err) {
        console.warn('[Oracle Jornada Chat] pick extraction failed (non-critical):', err.message);
      }
    }

    res.json({
      success: true,
      answer: cleanAnswer,
      mode: 'jornada',
      gamesAnalyzed: resolvedGames.length,
      picked,
    });

    // Persist jornada session asynchronously
    if (sessionKey) {
      const fullMessages = [
        ...conversationHistory.flatMap(t => [
          { role: 'user', text: t.question },
          { role: 'assistant', text: t.answer },
        ]),
        { role: 'user', text: userQuestion },
        { role: 'assistant', text: cleanAnswer },
      ];
      upsertOracleSession({
        userId: req.user.id,
        sessionKey,
        dateEt: resolvedDate,
        mode: 'jornada',
        gameIds,
        matchups: matchups || gameIds.join(', '),
        messages: fullMessages,
      }).then((sessionId) => {
        const pickIds = picked.map((p) => p.pick_id).filter(Boolean);
        if (sessionId && pickIds.length > 0) {
          pool.query(
            'UPDATE picks SET chat_session_id = $1 WHERE id = ANY($2::int[]) AND chat_session_id IS NULL',
            [sessionId, pickIds]
          ).catch((err) => console.warn(`[Oracle Jornada Chat] backfill chat_session_id failed: ${err.message}`));
        }
      });
    }
  } catch (err) {
    console.error('[Oracle Jornada Chat] Error:', err);
    res.status(500).json({ error: 'Jornada chat failed', details: safeError(err) });
  }
});

// GET /api/auth/is-admin — check if the authenticated user is admin + return sport access
app.get('/api/auth/is-admin', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT is_admin, sport_access FROM users WHERE id=$1', [req.user.id]);
    res.json({ isAdmin: rows[0]?.is_admin === true, sportAccess: rows[0]?.sport_access ?? ['mlb'] });
  } catch {
    res.json({ isAdmin: req.user.is_admin === true, sportAccess: req.user.sport_access ?? ['mlb'] });
  }
});

// GET /api/admin/sport-access/users — list all users with their sport access (admin only)
app.get('/api/admin/sport-access/users', verifyToken, isAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, sport_access, is_admin, created_at
       FROM users ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/admin/sport-access/:userId — update sport_access for a user (admin only)
app.patch('/api/admin/sport-access/:userId', verifyToken, isAdmin, async (req, res) => {
  const { userId } = req.params;
  const { sports } = req.body;
  if (!Array.isArray(sports)) return res.status(400).json({ success: false, error: 'sports must be an array' });
  const merged = Array.from(new Set(['mlb', ...sports]));
  try {
    const { rows } = await pool.query(
      'UPDATE users SET sport_access=$1 WHERE id=$2 RETURNING id, email, sport_access',
      [merged, userId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/games/:gamePk/live — Live game feed (GUMBO) with normalized data
app.get('/api/games/:gamePk/live', async (req, res) => {
  try {
    const data = await getLiveGameData(req.params.gamePk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/games/:gamePk/live/stream — SSE live game stream (B2 Hexa Live)
// Pushes normalized game state every POLL_MS. Client closes connection when done.
// Accepts token via Authorization header OR ?_auth= query param (EventSource workaround).
app.get('/api/games/:gamePk/live/stream', (req, res, next) => {
  // SSE auth: EventSource doesn't support headers — fall back to _auth query param
  if (!req.headers['authorization'] && req.query._auth) {
    req.headers['authorization'] = `Bearer ${req.query._auth}`;
  }
  next();
}, verifyToken, (req, res) => {
  const gamePk = req.params.gamePk;
  const POLL_MS = Math.max(5000, Math.min(60000, Number(req.query.interval ?? 15000)));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  async function sendUpdate() {
    try {
      const data = await getLiveGameData(gamePk);
      res.write(`data: ${JSON.stringify({ ok: true, data })}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ ok: false, error: err.message })}\n\n`);
    }
  }

  sendUpdate();
  const timer = setInterval(sendUpdate, POLL_MS);

  req.on('close', () => {
    clearInterval(timer);
  });
});

// GET /api/games/:gamePk/play-by-play - Complete game timeline for Gameday detail
app.get('/api/games/:gamePk/play-by-play', async (req, res) => {
  try {
    const data = await getGamePlayByPlay(req.params.gamePk);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/picks/live-progress — Calculate live progress for user's pending picks
app.post('/api/picks/live-progress', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's pending picks
    const { rows: pendingPicks } = await pool.query(
      `SELECT
         p.id,
         p.matchup,
         p.pick,
         p.oracle_confidence,
         p.type,
         p.created_at,
         COALESCE(p.sport, 'mlb') AS sport,
         COALESCE(p.game_pk, pf.game_pk) AS game_pk,
         COALESCE(p.game_date::text, pf.game_date::text) AS game_date
       FROM picks p
       LEFT JOIN LATERAL (
         SELECT game_pk, game_date
         FROM pick_features
         WHERE pick_id = p.id
         ORDER BY created_at DESC
         LIMIT 1
       ) pf ON TRUE
       WHERE p.user_id = $1
         AND p.result = 'pending'
         AND p.deleted_at IS NULL
         AND COALESCE(p.sport, 'mlb') IN ('mlb', 'nba', 'nfl', 'soccer')
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    );

    if (pendingPicks.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const results = [];
    const nbaGamesByDate = new Map();
    const nflGamesByDate = new Map();

    for (const pick of pendingPicks) {
      try {
        if (pick.sport === 'nba') {
          const nbaPick = {
            ...pick,
            game_date: normalizeDateInput(pick.game_date) ?? getEasternDateString(pick.created_at),
          };
          results.push(await buildNbaPickLiveProgressEntry(nbaPick, nbaGamesByDate));
          continue;
        }

        if (pick.sport === 'nfl') {
          const nflPick = {
            ...pick,
            game_date: normalizeDateInput(pick.game_date) ?? getEasternDateString(pick.created_at),
          };
          results.push(await buildNflPickLiveProgressEntry(nflPick, nflGamesByDate));
          continue;
        }

        if (pick.sport === 'soccer') {
          const soccerPick = {
            ...pick,
            game_date: normalizeDateInput(pick.game_date) ?? getEasternDateString(pick.created_at),
          };
          results.push(await buildSoccerPickLiveProgressEntry(soccerPick, new Map()));
          continue;
        }

        let resolvedGamePk = pick.game_pk;

        // Fallback for older picks that predate game_pk persistence.
        if (!resolvedGamePk) {
          const lookupDate = normalizeDateInput(pick.game_date) ?? getEasternDateString(pick.created_at);
          const games = await getTodayGames(lookupDate);
          const matchedGame = games.find((g) => {
            const homeAbbr = g.teams?.home?.abbreviation?.toLowerCase() ?? '';
            const awayAbbr = g.teams?.away?.abbreviation?.toLowerCase() ?? '';
            const homeName = g.teams?.home?.name?.toLowerCase() ?? '';
            const awayName = g.teams?.away?.name?.toLowerCase() ?? '';
            const matchup = (pick.matchup ?? '').toLowerCase();
            return matchup.includes(homeAbbr) || matchup.includes(awayAbbr) ||
                   matchup.includes(homeName) || matchup.includes(awayName);
          });
          resolvedGamePk = matchedGame?.gamePk ?? null;
        }

        if (!resolvedGamePk) {
          results.push({
            pickId: pick.id,
            pick: pick.pick,
            matchup: pick.matchup,
            sport: 'mlb',
            progress: null,
            status: 'no_game_found',
          });
          continue;
        }

        const liveData = await getLiveGameData(resolvedGamePk);
        const liveStatus = String(liveData?.status ?? '').toLowerCase();
        if (liveStatus === 'scheduled' || liveStatus === 'pre-game' || liveStatus === 'preview') {
          results.push({
            pickId: pick.id,
            pick: pick.pick,
            matchup: pick.matchup,
            sport: 'mlb',
            gamePk: resolvedGamePk,
            progress: null,
            status: 'not_started',
          });
          continue;
        }

        const parsed = parseLivePick(pick.pick);
        const progress = calculatePickProgress(parsed, liveData);

        results.push({
          pickId: pick.id,
          pick: pick.pick,
          matchup: pick.matchup,
          sport: 'mlb',
          gamePk: resolvedGamePk,
          confidence: pick.oracle_confidence,
          ...progress,
        });
      } catch (err) {
        results.push({
          pickId: pick.id,
          pick: pick.pick,
          matchup: pick.matchup,
          sport: pick.sport === 'nba' ? 'nba' : 'mlb',
          gamePk: pick.game_pk ?? null,
          progress: null,
          status: 'fetch_error',
          error: err.message,
        });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/games/live — Live data for multiple games at once
app.post('/api/games/live', async (req, res) => {
  try {
    const { gamePks } = req.body;
    if (!gamePks || !Array.isArray(gamePks) || gamePks.length === 0) {
      return res.status(400).json({ success: false, error: 'gamePks array is required' });
    }
    if (gamePks.length > 20) {
      return res.status(400).json({ success: false, error: 'Maximum 20 games per request' });
    }
    const data = await getMultipleLiveGames(gamePks);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/savant/status
app.get('/api/savant/status', (_req, res) => {
  try {
    res.json({ success: true, data: getCacheStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/savant/refresh
app.post('/api/savant/refresh', verifyToken, isAdmin, async (_req, res) => {
  try {
    await refreshCache();
    res.json({ success: true, data: getCacheStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/picks/resolve — manually trigger pick resolution (admin/testing)
app.get('/api/picks/resolve', verifyToken, async (_req, res) => {
  try {
    const summary = await resolvePendingPicks();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/picks/resolve-game — Resolve picks for a specific finished game
app.post('/api/picks/resolve-game', verifyToken, async (req, res) => {
  try {
    const { gamePk } = req.body;
    if (!gamePk) return res.status(400).json({ success: false, error: 'gamePk required' });

    // Get final game data
    const liveData = await getLiveGameData(gamePk);
    if (liveData.status !== 'final') {
      return res.json({ success: false, error: 'Game not finished yet', status: liveData.status });
    }

    const gameForResolver = {
      gamePk: liveData.gamePk,
      gameDate: liveData.lastUpdated,
      status: { simplified: 'final' },
      teams: {
        home: {
          name: liveData.home?.name ?? '',
          abbreviation: liveData.home?.abbreviation ?? '',
          score: liveData.home?.score ?? 0,
        },
        away: {
          name: liveData.away?.name ?? '',
          abbreviation: liveData.away?.abbreviation ?? '',
          score: liveData.away?.score ?? 0,
        },
      },
    };
    const homeTeam = gameForResolver.teams.home.abbreviation;
    const awayTeam = gameForResolver.teams.away.abbreviation;
    const homeName = gameForResolver.teams.home.name;
    const awayName = gameForResolver.teams.away.name;
    const homeScore = gameForResolver.teams.home.score;
    const awayScore = gameForResolver.teams.away.score;
    const totalRuns = homeScore + awayScore;

    // Find pending picks that match this game
    const { rows: pendingPicks } = await pool.query(
      `SELECT id, pick, matchup
       FROM picks
       WHERE result = 'pending' AND deleted_at IS NULL AND COALESCE(sport, 'mlb') = 'mlb'`
    );

    let resolved = 0;
    for (const pick of pendingPicks) {
      if (!findGame(pick.matchup, [gameForResolver])) continue;

      const pickStr = (pick.pick ?? '').toLowerCase();
      let result = null;
      const parsed = parsePick(pick.pick);

      if (parsed?.type === 'player_prop') {
        const propResult = resolvePlayerPropPickResult(parsed, liveData.playerStats);
        result = propResult?.result ?? null;
      } else if (parsed) {
        result = resolvePickResult(parsed, gameForResolver);
      } else {
        console.log(`[auto-resolve] Pick ${pick.id} unparseable: "${pick.pick}"`);
      }

      // Over/Under
      const ouMatch = pickStr.match(/^(over|under|más\s+de|menos\s+de)\s+(\d+\.?\d*)/i);
      if (ouMatch) {
        const dir = ouMatch[1].toLowerCase().startsWith('o') || ouMatch[1].toLowerCase().startsWith('m') ? 'over' : 'under';
        const line = parseFloat(ouMatch[2]);
        if (dir === 'over') result = totalRuns > line ? 'win' : totalRuns < line ? 'loss' : 'push';
        else result = totalRuns < line ? 'win' : totalRuns > line ? 'loss' : 'push';
      }

      // Moneyline
      if (!result && pickStr.match(/\bml\b|moneyline|a ganar/i)) {
        const teamInPick = pickStr.replace(/\s*(ml|moneyline|a ganar).*$/i, '').trim();
        const isHome = homeTeam.toLowerCase() === teamInPick || homeName.toLowerCase().includes(teamInPick);
        const isAway = awayTeam.toLowerCase() === teamInPick || awayName.toLowerCase().includes(teamInPick);
        if (isHome) result = homeScore > awayScore ? 'win' : homeScore < awayScore ? 'loss' : 'push';
        else if (isAway) result = awayScore > homeScore ? 'win' : awayScore < homeScore ? 'loss' : 'push';
      }

      // Run Line
      if (!result) {
        const rlMatch = pickStr.match(/^(.+?)\s+([+-]?\d+\.?\d*)\s*(?:run\s*line|rl)?/i);
        if (rlMatch && (rlMatch[2].includes('+') || rlMatch[2].includes('-') || rlMatch[2].includes('1.5'))) {
          const teamInPick = rlMatch[1].trim().toLowerCase();
          const spread = parseFloat(rlMatch[2]);
          const isHome = homeTeam.toLowerCase() === teamInPick || homeName.toLowerCase().includes(teamInPick);
          const myScore = isHome ? homeScore : awayScore;
          const oppScore = isHome ? awayScore : homeScore;
          const adjusted = myScore + spread;
          result = adjusted > oppScore ? 'win' : adjusted < oppScore ? 'loss' : 'push';
        }
      }

      if (result) {
        await pool.query(`UPDATE picks SET result = $1 WHERE id = $2`, [result, pick.id]);
        await updatePickFeatureResult({ pickId: pick.id, result });
        if (result === 'win') {
          try {
            await publishWinningInsightByPickId(pick.id);
          } catch (publishErr) {
            console.warn(`[semana-auto] Could not publish win for pick ${pick.id}: ${publishErr.message}`);
          }
        }
        resolved++;
        console.log(`[auto-resolve] Pick ${pick.id} "${pick.pick}" → ${result} (${awayTeam} ${awayScore} - ${homeTeam} ${homeScore})`);
      }
    }

    try {
      await updateShadowModelRunsForGame({
        gamePk,
        homeTeamId: liveData.home?.id ?? null,
        awayTeamId: liveData.away?.id ?? null,
        homeAbbr: liveData.home?.abbreviation ?? null,
        awayAbbr: liveData.away?.abbreviation ?? null,
        homeScore,
        awayScore,
      });
    } catch (shadowErr) {
      console.warn('[shadow-mode] Could not resolve shadow runs for game:', shadowErr.message);
    }

    res.json({ success: true, resolved, totalRuns, homeScore, awayScore });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/picks — guarda un pick en el historial (requiere email verificado)
app.post('/api/picks', verifyToken, requireVerifiedEmail, async (req, res) => {
  try {
    const {
      type, matchup, pick, oracle_confidence, bet_value,
      model_risk, oracle_report, hexa_hunch, alert_flags,
      probability_model, best_pick, model, language,
      odds_at_pick, odds_details, kelly_recommendation,
      value_breakdown, safe_candidates, safe_scope, selection_method,
      game_pk, gamePk, game_id, gameId, game_date, gameDate, date,
      sport,
      feature_store, featureStore,
    } = req.body;

    const payloadValidationError = validatePickSavePayload(req.body);
    if (payloadValidationError) {
      return res.status(400).json({
        success: false,
        error: payloadValidationError,
      });
    }

    // Calculate implied probability server-side from the American odds provided by the client
    const implied_prob_at_pick = odds_at_pick != null
      ? calculateImpliedProbability(odds_at_pick)
      : null;
    const parsedOddsDetails = odds_details != null ? parseJsonMaybe(odds_details) : null;
    const parsedFeatureStore = parseJsonMaybe(feature_store ?? featureStore);

    const normalizedSport = normalizePickSport(sport);
    const canonicalPick = canonicalizePickTextForResolver(pick);

    const { rows } = await pool.query(
      `INSERT INTO picks (
         user_id, type, matchup, pick, oracle_confidence, bet_value, model_risk,
         oracle_report, hexa_hunch, alert_flags, probability_model, best_pick,
         model, language, odds_at_pick, implied_prob_at_pick, odds_details, kelly_recommendation,
         game_pk, game_date, value_breakdown, safe_candidates, safe_scope, selection_method,
         user_email, sport, pick_time_lima
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,(NOW() AT TIME ZONE 'America/Lima')::TIMESTAMP) RETURNING *`,
      [
        req.user.id, type, matchup, canonicalPick, normalizeOracleConfidence(oracle_confidence), bet_value, model_risk,
        oracle_report, hexa_hunch,
        JSON.stringify(alert_flags ?? []), JSON.stringify(probability_model ?? {}),
        JSON.stringify(best_pick ?? {}), model, language,
        odds_at_pick ?? null,
        implied_prob_at_pick,
        parsedOddsDetails != null ? JSON.stringify(parsedOddsDetails) : null,
        kelly_recommendation ?? null,
        game_pk ?? gamePk ?? game_id ?? gameId ?? null,
        normalizeDateInput(game_date ?? gameDate ?? date),
        value_breakdown != null ? JSON.stringify(value_breakdown) : null,
        safe_candidates != null ? JSON.stringify(safe_candidates) : null,
        safe_scope ?? null,
        selection_method ?? null,
        req.user.email ?? null,
        normalizedSport,
      ]
    );
    const savedPick = rows[0];
    console.log(
      `[picks] saved id=${savedPick.id} user=${req.user.id} type=${type} sport=${normalizedSport} game_pk=${savedPick.game_pk ?? 'n/a'}`
    );
    const featureGamePk = game_pk ?? gamePk ?? game_id ?? gameId ?? null;
    const featureGameDate = game_date ?? gameDate ?? date ?? null;
    const directFeatureGamePk = parsedFeatureStore?.gamePk ?? featureGamePk;
    const directFeatureGameDate = parsedFeatureStore?.gameDate ?? featureGameDate;
    const directFeatures = parsedFeatureStore?.features ?? null;

    if (directFeatureGamePk && directFeatures) {
      await savePickFeatures({
        pickId: savedPick.id,
        gamePk: Number(directFeatureGamePk),
        gameDate: normalizeDateInput(directFeatureGameDate),
        ...directFeatures,
        oddsData: directFeatures.oddsData ?? parsedOddsDetails,
        pick: savedPick.pick,
        result: savedPick.result,
        userEmail: req.user.email ?? null,
        sport: normalizedSport,
      });
    } else if (featureGamePk) {
      await saveFeatureStoreForGame({
        pickId: savedPick.id,
        gamePk: featureGamePk,
        gameDate: featureGameDate,
        pick: savedPick.pick,
        result: savedPick.result,
        oddsData: parsedOddsDetails,
        sport: normalizedSport,
      });
    }

    res.json({ success: true, data: savedPick });
  } catch (err) {
    console.error(`[picks] save failed user=${req.user?.id ?? 'n/a'}: ${err.message}`);
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/picks/clv-stats — CLV dashboard stats for authenticated user
app.get('/api/picks/clv-stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Aggregate stats for picks with CLV data
    const { rows: [stats] } = await pool.query(`
      SELECT
        COUNT(*)                                              AS "totalPicks",
        COUNT(*) FILTER (WHERE clv IS NOT NULL)              AS "picksWithCLV",
        ROUND(AVG(clv) FILTER (WHERE clv IS NOT NULL), 2)   AS "avgCLV",
        COUNT(*) FILTER (WHERE clv > 0)                     AS "positiveCLV",
        COUNT(*) FILTER (WHERE clv < 0)                     AS "negativeCLV"
      FROM picks
      WHERE user_id = $1 AND deleted_at IS NULL
    `, [userId]);

    // Last 20 picks with CLV fields
    const { rows: recentPicks } = await pool.query(`
      SELECT id, matchup, pick, model, result,
             odds_at_pick, implied_prob_at_pick,
             closing_odds, implied_prob_closing, clv,
             created_at
      FROM picks
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId]);

    // Group by bet type (parsed from pick string in JS to avoid SQL regex complexity)
    const betTypeMap = { moneyline: { count: 0, totalCLV: 0 }, runline: { count: 0, totalCLV: 0 }, over_under: { count: 0, totalCLV: 0 } };
    const modelMap   = {};

    const { rows: allWithCLV } = await pool.query(`
      SELECT pick, model, clv FROM picks WHERE user_id = $1 AND clv IS NOT NULL AND deleted_at IS NULL
    `, [userId]);

    for (const row of allWithCLV) {
      const p = (row.pick ?? '').toLowerCase();
      let betType = 'moneyline';
      if (/over|under|m[aá]s\s+de|menos\s+de|alta|baja/i.test(p)) betType = 'over_under';
      else if (/run\s+line|rl|l[ií]nea\s+de\s+carrera/i.test(p)) betType = 'runline';

      betTypeMap[betType].count++;
      betTypeMap[betType].totalCLV += parseFloat(row.clv);

      const m = row.model ?? 'unknown';
      if (!modelMap[m]) modelMap[m] = { count: 0, totalCLV: 0 };
      modelMap[m].count++;
      modelMap[m].totalCLV += parseFloat(row.clv);
    }

    const clvByBetType = {};
    for (const [key, val] of Object.entries(betTypeMap)) {
      clvByBetType[key] = {
        count:  val.count,
        avgCLV: val.count > 0 ? Math.round((val.totalCLV / val.count) * 100) / 100 : null,
      };
    }

    const clvByModel = {};
    for (const [key, val] of Object.entries(modelMap)) {
      clvByModel[key] = {
        count:  val.count,
        avgCLV: val.count > 0 ? Math.round((val.totalCLV / val.count) * 100) / 100 : null,
      };
    }

    res.json({
      success: true,
      data: {
        totalPicks:   parseInt(stats.totalPicks),
        picksWithCLV: parseInt(stats.picksWithCLV),
        avgCLV:       stats.avgCLV != null ? parseFloat(stats.avgCLV) : null,
        positiveCLV:  parseInt(stats.positiveCLV),
        negativeCLV:  parseInt(stats.negativeCLV),
        clvByBetType,
        clvByModel,
        recentPicks,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/picks — obtiene el historial del usuario
app.get('/api/picks', verifyToken, async (req, res) => {
  try {
    const sport = normalizeKnownSportFilter(req.query?.sport, { allowAll: false, fallback: '' });
    const rawSport = String(req.query?.sport ?? '').toLowerCase();
    if (rawSport && !sport) {
      return res.status(400).json({
        success: false,
        error: `sport must be one of: ${KNOWN_SPORTS.join(', ')}`,
      });
    }
    const hasSportFilter = Boolean(sport);
    const historyQuery = hasSportFilter
      ? 'SELECT * FROM picks WHERE user_id = $1 AND deleted_at IS NULL AND COALESCE(sport, \'mlb\') = $2 ORDER BY created_at DESC LIMIT 100'
      : 'SELECT * FROM picks WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100';
    const historyParams = hasSportFilter ? [req.user.id, sport] : [req.user.id];
    const summaryQuery = hasSportFilter
      ? `SELECT
           COUNT(*) AS total_picks,
           COUNT(*) FILTER (WHERE result = 'win') AS wins,
           COUNT(*) FILTER (WHERE result = 'loss') AS losses,
           COUNT(*) FILTER (WHERE result = 'push') AS pushes,
           COUNT(*) FILTER (WHERE result = 'pending' OR result IS NULL) AS pending
         FROM picks
        WHERE user_id = $1 AND deleted_at IS NULL AND COALESCE(sport, 'mlb') = $2`
      : `SELECT
           COUNT(*) AS total_picks,
           COUNT(*) FILTER (WHERE result = 'win') AS wins,
           COUNT(*) FILTER (WHERE result = 'loss') AS losses,
           COUNT(*) FILTER (WHERE result = 'push') AS pushes,
           COUNT(*) FILTER (WHERE result = 'pending' OR result IS NULL) AS pending
         FROM picks
         WHERE user_id = $1 AND deleted_at IS NULL`;
    const summaryParams = hasSportFilter ? [req.user.id, sport] : [req.user.id];

    const [historyResult, summaryResult] = await Promise.all([
      pool.query(historyQuery, historyParams),
      pool.query(summaryQuery, summaryParams),
    ]);

    const summaryRow = summaryResult.rows[0] ?? {};
    const total = Number(summaryRow.total_picks ?? 0);
    const wins = Number(summaryRow.wins ?? 0);
    const losses = Number(summaryRow.losses ?? 0);
    const pushes = Number(summaryRow.pushes ?? 0);
    const pending = Number(summaryRow.pending ?? 0);
    const resolved = wins + losses;
    const winRate = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;

    res.json({
      success: true,
      data: historyResult.rows,
      summary: {
        total,
        wins,
        losses,
        pushes,
        pending,
        winRate,
        shown: historyResult.rows.length,
        hasMore: total > historyResult.rows.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/picks/analyzed-pks — returns game_pks with picks for a given date+sport
app.get('/api/picks/analyzed-pks', verifyToken, async (req, res) => {
  try {
    const { date, sport } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'date (YYYY-MM-DD) required' });
    }
    const sp = normalizeKnownSportFilter(sport, { allowAll: false, fallback: 'mlb' });
    const { rows } = await pool.query(
      `SELECT DISTINCT game_pk FROM picks
       WHERE user_id = $1 AND game_date = $2 AND COALESCE(sport,'mlb') = $3
       AND game_pk IS NOT NULL AND deleted_at IS NULL`,
      [req.user.id, date, sp],
    );
    return res.json({ success: true, data: rows.map(r => Number(r.game_pk)) });
  } catch (err) {
    return res.status(500).json({ success: false, error: safeError(err) });
  }
});

// PATCH /api/picks/:id — actualiza resultado (win/loss/pending) — solo admins
app.patch('/api/picks/:id', verifyToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Manual result update is restricted to admins' });
  }
  try {
    const result = normalizePickResult(req.body?.result);
    if (!['pending', 'win', 'loss', 'push'].includes(result)) {
      return res.status(400).json({ success: false, error: 'result must be pending, win, loss, or push' });
    }
    const { rows } = await pool.query(
      `UPDATE picks
       SET result = $1,
           postmortem = NULL,
           postmortem_summary = NULL,
           postmortem_generated_at = NULL
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [result, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pick not found' });
    await updatePickFeatureResult({ pickId: rows[0].id, result: rows[0].result });
    if (rows[0].result === 'win') {
      try {
        await publishWinningInsightByPickId(rows[0].id);
      } catch (publishErr) {
        console.warn(`[semana-auto] Could not publish manual win for pick ${rows[0].id}: ${publishErr.message}`);
      }
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/picks/:id/postmortem — generate or return persisted postmortem analysis
app.post('/api/picks/:id/postmortem', verifyToken, async (req, res) => {
  try {
    const force = req.body?.force === true;
    const requestedLang = normalizeRequestLanguage(req.body?.lang ?? req.body?.language, null);
    const { rows } = await pool.query(
      `SELECT
         p.*,
         pf.game_pk AS feature_game_pk,
         pf.game_date AS feature_game_date,
         pf.home_pitcher_xwoba,
         pf.away_pitcher_xwoba,
         pf.home_pitcher_whiff,
         pf.away_pitcher_whiff,
         pf.home_pitcher_k_pct,
         pf.away_pitcher_k_pct,
         pf.home_pitcher_era,
         pf.away_pitcher_era,
         pf.home_team_ops,
         pf.away_team_ops,
         pf.home_lineup_avg_xwoba,
         pf.away_lineup_avg_xwoba,
         pf.park_factor_overall,
         pf.park_factor_hr,
         pf.temperature,
         pf.wind_speed,
         pf.data_quality_score,
         pf.signal_coherence_score,
         pf.odds_ml_home,
         pf.odds_ml_away,
         pf.odds_ou_total,
         pf.home_net_rating,
         pf.away_net_rating,
         pf.home_off_rating,
         pf.away_off_rating,
         pf.home_def_rating,
         pf.away_def_rating,
         pf.home_pace,
         pf.away_pace,
         pf.home_rest_days,
         pf.away_rest_days,
         pf.context_completeness
       FROM picks p
       LEFT JOIN LATERAL (
         SELECT *
         FROM pick_features
         WHERE pick_id = p.id
         ORDER BY created_at DESC
         LIMIT 1
       ) pf ON TRUE
       WHERE p.id = $1 AND p.user_id = $2 AND p.deleted_at IS NULL
       LIMIT 1`,
      [req.params.id, req.user.id]
    );

    const pickRow = rows[0];
    if (!pickRow) {
      return res.status(404).json({ success: false, error: 'Pick not found' });
    }
    if (normalizePickResult(pickRow.result) === 'pending') {
      return res.status(400).json({ success: false, error: 'Pick must be resolved first' });
    }

    const storedPostmortemLang = normalizeRequestLanguage(
      pickRow.postmortem?.lang ?? pickRow.language,
      'en'
    );
    const effectiveLang = normalizeRequestLanguage(
      requestedLang ?? pickRow.postmortem?.lang ?? pickRow.language,
      storedPostmortemLang
    );
    const storedPostmortemVersion = Number(pickRow.postmortem?.version ?? 1);
    const shouldReuseStoredPostmortem =
      Boolean(pickRow.postmortem) &&
      !force &&
      storedPostmortemLang === effectiveLang &&
      storedPostmortemVersion >= POSTMORTEM_SCHEMA_VERSION;

    if (shouldReuseStoredPostmortem) {
      await pool.query(
        'UPDATE picks SET postmortem_requested_at = NOW() WHERE id = $1 AND user_id = $2',
        [pickRow.id, req.user.id]
      );
      return res.json({
        success: true,
        data: {
          postmortem: pickRow.postmortem,
          postmortem_summary: pickRow.postmortem_summary,
          postmortem_generated_at: pickRow.postmortem_generated_at,
        },
      });
    }

    const rawPickSport = String(pickRow.sport ?? 'mlb').toLowerCase();
    const pickSport = ['nba', 'soccer'].includes(rawPickSport) ? rawPickSport : 'mlb';
    const gameSummary = await buildPostmortemGameSummary(pickRow, pickSport);
    const featureSnapshot = buildPostmortemFeatureSnapshot(pickRow, pickSport);

    const postmortem = await generatePickPostmortem({
      lang: effectiveLang,
      sport: pickSport,
      pick: {
        id: pickRow.id,
        matchup: pickRow.matchup,
        pick: pickRow.pick,
        result: normalizePickResult(pickRow.result),
        oracle_confidence: pickRow.oracle_confidence,
        bet_value: pickRow.bet_value,
        model_risk: pickRow.model_risk,
        oracle_report: pickRow.oracle_report,
        hexa_hunch: pickRow.hexa_hunch,
        alert_flags: Array.isArray(pickRow.alert_flags) ? pickRow.alert_flags : [],
        best_pick: pickRow.best_pick,
        odds_at_pick: pickRow.odds_at_pick,
      },
      featureSnapshot,
      gameSummary,
    });

    const { rows: saved } = await pool.query(
      `UPDATE picks
       SET postmortem = $1,
           postmortem_summary = $2,
           postmortem_generated_at = NOW(),
           postmortem_requested_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING postmortem, postmortem_summary, postmortem_generated_at`,
      [JSON.stringify(postmortem), postmortem.summary, pickRow.id, req.user.id]
    );

    return res.json({ success: true, data: saved[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/postmortem-stats — aggregate postmortem data (admin-only)
app.get('/api/admin/postmortem-stats', verifyToken, requireAdmin, async (req, res) => {
  try {
    const sport = req.query.sport ?? null;
    const sportFilter = sport ? `AND COALESCE(p.sport,'mlb') = $1` : '';
    const params = sport ? [sport] : [];

    const [coverageRes, signalsRes, missesRes, hitsRes, keyFactorsRes, recentRes] = await Promise.all([
      // Coverage: resolved picks vs postmortems generated
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE result IS NOT NULL AND result != 'pending' AND deleted_at IS NULL) AS resolved_total,
          COUNT(*) FILTER (WHERE postmortem IS NOT NULL AND deleted_at IS NULL) AS postmortem_count
        FROM picks p
        WHERE deleted_at IS NULL ${sport ? `AND COALESCE(p.sport,'mlb') = $1` : ''}
      `, params),

      // Top adjustment_signals
      pool.query(`
        SELECT sig AS text, COUNT(*) AS cnt
        FROM picks p,
          jsonb_array_elements_text(p.postmortem->'adjustment_signals') AS sig
        WHERE p.postmortem IS NOT NULL AND p.deleted_at IS NULL ${sportFilter}
        GROUP BY sig ORDER BY cnt DESC LIMIT 15
      `, params),

      // Top what_hexa_missed
      pool.query(`
        SELECT miss AS text, COUNT(*) AS cnt
        FROM picks p,
          jsonb_array_elements_text(p.postmortem->'what_hexa_missed') AS miss
        WHERE p.postmortem IS NOT NULL AND p.deleted_at IS NULL ${sportFilter}
        GROUP BY miss ORDER BY cnt DESC LIMIT 15
      `, params),

      // Top what_hexa_got_right
      pool.query(`
        SELECT hit AS text, COUNT(*) AS cnt
        FROM picks p,
          jsonb_array_elements_text(p.postmortem->'what_hexa_got_right') AS hit
        WHERE p.postmortem IS NOT NULL AND p.deleted_at IS NULL ${sportFilter}
        GROUP BY hit ORDER BY cnt DESC LIMIT 15
      `, params),

      // Top key_factors
      pool.query(`
        SELECT factor AS text, COUNT(*) AS cnt
        FROM picks p,
          jsonb_array_elements_text(p.postmortem->'key_factors') AS factor
        WHERE p.postmortem IS NOT NULL AND p.deleted_at IS NULL ${sportFilter}
        GROUP BY factor ORDER BY cnt DESC LIMIT 15
      `, params),

      // Recent postmortems (last 30)
      pool.query(`
        SELECT
          p.id, p.pick, p.result, p.matchup, p.game_date,
          COALESCE(p.sport,'mlb') AS sport,
          p.postmortem_summary,
          p.postmortem_generated_at,
          p.postmortem->'key_factors' AS key_factors,
          p.postmortem->'what_hexa_missed' AS what_hexa_missed,
          p.postmortem->'adjustment_signals' AS adjustment_signals,
          p.postmortem->'training_takeaway' AS training_takeaway
        FROM picks p
        WHERE p.postmortem IS NOT NULL AND p.deleted_at IS NULL ${sportFilter}
        ORDER BY p.postmortem_generated_at DESC
        LIMIT 30
      `, params),
    ]);

    res.json({
      success: true,
      data: {
        coverage: {
          resolved_total: parseInt(coverageRes.rows[0]?.resolved_total ?? 0),
          postmortem_count: parseInt(coverageRes.rows[0]?.postmortem_count ?? 0),
        },
        adjustment_signals: signalsRes.rows.map(r => ({ text: r.text, count: parseInt(r.cnt) })),
        what_hexa_missed:   missesRes.rows.map(r => ({ text: r.text, count: parseInt(r.cnt) })),
        what_hexa_got_right: hitsRes.rows.map(r => ({ text: r.text, count: parseInt(r.cnt) })),
        key_factors:        keyFactorsRes.rows.map(r => ({ text: r.text, count: parseInt(r.cnt) })),
        recent:             recentRes.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── Newsletter endpoints ───────────────────────────────────────────────────

// POST /api/newsletter/subscribe — public
app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const { email, lang = 'es' } = req.body ?? {};
    if (!email) return res.status(400).json({ success: false, error: 'email required' });
    const result = await subscribeNewsletter(email, lang);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.code === 'INVALID_EMAIL') return res.status(400).json({ success: false, error: err.message });
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/newsletter/unsubscribe?email=&token= — public (unsubscribe link)
app.get('/api/newsletter/unsubscribe', async (req, res) => {
  try {
    const { email, token } = req.query;
    if (!email || !token) return res.status(400).json({ success: false, error: 'email and token required' });
    const result = await unsubscribeNewsletter(email, token);
    if (!result.ok) return res.status(400).json({ success: false, error: result.reason });
    res.json({ success: true, message: 'Unsubscribed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/newsletter/subscribers — admin
app.get('/api/admin/newsletter/subscribers', verifyToken, requireAdmin, async (req, res) => {
  try {
    const activeOnly = req.query.active !== '0';
    const rows = await getSubscribers({ activeOnly });
    res.json({ success: true, data: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/admin/newsletter/send-weekly — admin trigger
app.post('/api/admin/newsletter/send-weekly', verifyToken, requireAdmin, async (req, res) => {
  try {
    if (process.env.NEWSLETTER_ENABLED !== '1') {
      return res.status(403).json({ success: false, error: 'NEWSLETTER_ENABLED is not set to 1' });
    }
    const lang = req.body?.lang ?? 'es';
    const date = req.body?.date ?? null;
    const result = await sendWeeklyNewsletter(lang, date);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/picks/:id/infographic — SVG pick card (B8)
app.get('/api/picks/:id/infographic', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, matchup, pick, confidence, result, sport, created_at
       FROM picks WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pick not found' });
    const svg = generatePickCardSvg(rows[0]);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/mlb/slate-infographic?date=YYYY-MM-DD — SVG slate overview (B8)
app.get('/api/mlb/slate-infographic', verifyToken, async (req, res) => {
  try {
    const date = req.query.date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const { rows } = await pool.query(
      `SELECT matchup, pick, confidence, result, created_at
       FROM picks
       WHERE game_date = $1 AND deleted_at IS NULL AND COALESCE(sport,'mlb') = 'mlb'
       ORDER BY confidence DESC NULLS LAST
       LIMIT 10`,
      [date]
    );
    const svg = generateSlateSvg({ picks: rows, date });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/admin/backtest/import-csv — evaluate historical picks from CSV (A7)
app.post('/api/admin/backtest/import-csv', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { csv, label, dryRun = false } = req.body ?? {};
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ success: false, error: 'csv field (string) required' });
    }
    const result = await importBacktestCsv({ csv, label, dryRun: !!dryRun });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/backtest/csv-runs — list past CSV backtest runs
app.get('/api/admin/backtest/csv-runs', verifyToken, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const runs = await listCsvBacktestRuns({ limit });
    res.json({ success: true, data: runs });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/injury-signals — recent beat reporter injury signals
app.get('/api/admin/injury-signals', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { team, hours = 24 } = req.query;
    const signals = await getRecentInjurySignals({ teamAbbr: team, hoursBack: Number(hours), limit: 100 });
    res.json({ success: true, data: signals, total: signals.length });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/admin/injury-signals/scan — trigger manual beat reporter scan
app.post('/api/admin/injury-signals/scan', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await runBeatReporterScan();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── Oracle Embeddings (A3) ───────────────────────────────────────────────────

// GET /api/admin/embeddings/stats
app.get('/api/admin/embeddings/stats', verifyToken, requireAdmin, async (req, res) => {
  try {
    const stats = await getEmbeddingsStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/admin/embeddings/backfill — embed all eligible picks
app.post('/api/admin/embeddings/backfill', verifyToken, requireAdmin, async (req, res) => {
  try {
    const batchSize = Number(req.body?.batchSize ?? 100);
    const result = await embedPendingPicks(Math.min(batchSize, 500));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── Feature Flags (B5) ───────────────────────────────────────────────────────

// GET /api/admin/feature-flags
app.get('/api/admin/feature-flags', verifyToken, requireAdmin, async (req, res) => {
  try {
    const flags = await getAllFlags();
    res.json({ success: true, data: flags });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// PUT /api/admin/feature-flags/:key
app.put('/api/admin/feature-flags/:key', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { enabled, rollout_pct, metadata } = req.body ?? {};
    await upsertFlag({ key, enabled: Boolean(enabled), rollout_pct: rollout_pct ?? 100, metadata: metadata ?? {} });
    res.json({ success: true, key });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// DELETE /api/admin/feature-flags/:key
app.delete('/api/admin/feature-flags/:key', verifyToken, requireAdmin, async (req, res) => {
  try {
    await deleteFlag(req.params.key);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── Job Queue (B7) ────────────────────────────────────────────────────────────

// GET /api/admin/jobs — job queue dashboard stats
app.get('/api/admin/jobs', verifyToken, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const stats = await getJobQueueStats({ limit });
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// POST /api/admin/jobs/purge — purge old done/failed jobs
app.post('/api/admin/jobs/purge', verifyToken, requireAdmin, async (req, res) => {
  try {
    const days = Number(req.body?.retentionDays ?? 7);
    const purged = await purgeOldJobs(days);
    res.json({ success: true, purged });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// DELETE /api/picks/:id — elimina un pick individual del historial
app.delete('/api/picks/:id', verifyToken, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ success: false, error: 'Only admin can delete picks' });
    }
    const { rows } = await pool.query(
      'UPDATE picks SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pick not found' });
    try {
      const purged = await purgePickTrainingRows(rows[0].id);
      console.log(`[picks] purged training rows for pick ${rows[0].id}:`, purged);
    } catch (purgeErr) {
      console.warn(`[picks] training purge failed for pick ${rows[0].id}:`, purgeErr.message);
    }
    res.json({ success: true, id: rows[0].id });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// DELETE /api/picks — elimina todo el historial del usuario autenticado (solo admin)
app.delete('/api/picks', verifyToken, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ success: false, error: 'Only admin can clear all history' });
    }
    const pending = await pool.query(
      'SELECT id FROM picks WHERE user_id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    await pool.query('UPDATE picks SET deleted_at = NOW() WHERE user_id = $1 AND deleted_at IS NULL', [req.user.id]);
    for (const row of pending.rows) {
      try {
        await purgePickTrainingRows(row.id);
      } catch (purgeErr) {
        console.warn(`[picks] training purge failed for pick ${row.id}:`, purgeErr.message);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/odds/movement — line movement data for a specific game
app.get('/api/odds/movement', verifyToken, async (req, res) => {
  try {
    const { home, away, date } = req.query;
    if (!home || !away || !date) {
      return res.status(400).json({ success: false, error: 'home, away and date query params are required' });
    }
    const movement = await getLineMovement(home, away, date);
    if (!movement) {
      return res.json({ success: true, data: null, message: 'Not enough snapshots for line movement (need at least 2)' });
    }
    res.json({ success: true, data: movement });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/backtest-stats — backtest results dashboard (admin only)
app.get('/api/admin/backtest-stats', verifyToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  try {
    // Summary
    const summary = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses,
        COUNT(*) FILTER (WHERE actual_result = 'push') as pushes,
        COUNT(*) FILTER (WHERE actual_result IS NULL) as unresolved,
        ROUND(AVG(oracle_confidence)::numeric, 1) as avg_confidence,
        ROUND(AVG(latency_ms)::numeric, 0) as avg_latency_ms
      FROM backtest_results
    `);

    // By date
    const byDate = await pool.query(`
      SELECT
        historical_date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses,
        COUNT(*) FILTER (WHERE actual_result IS NULL) as unresolved
      FROM backtest_results
      GROUP BY historical_date
      ORDER BY historical_date DESC
    `);

    // By pick type
    const byType = await pool.query(`
      SELECT
        pick_type,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses
      FROM backtest_results
      WHERE actual_result IS NOT NULL
      GROUP BY pick_type
    `);

    // By confidence bucket
    const byConfidence = await pool.query(`
      SELECT
        CASE
          WHEN oracle_confidence >= 65 THEN '65-70'
          WHEN oracle_confidence >= 60 THEN '60-64'
          WHEN oracle_confidence >= 55 THEN '55-59'
          WHEN oracle_confidence >= 50 THEN '50-54'
          ELSE 'under-50'
        END as bucket,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses
      FROM backtest_results
      WHERE actual_result IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `);

    // By flags
    const byFlags = await pool.query(`
      SELECT
        has_critical_flags,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses
      FROM backtest_results
      WHERE actual_result IS NOT NULL
      GROUP BY has_critical_flags
    `);

    // Recent picks detail
    const recent = await pool.query(`
      SELECT matchup, pick, oracle_confidence, actual_result,
             actual_home_score, actual_away_score, historical_date, latency_ms
      FROM backtest_results
      ORDER BY created_at DESC
      LIMIT 50
    `);

    // Run history
    const runs = await pool.query(`
      SELECT run_id,
        MIN(historical_date) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses,
        MIN(created_at) as run_time
      FROM backtest_results
      GROUP BY run_id
      ORDER BY MIN(created_at) DESC
      LIMIT 20
    `);

    res.json({
      success: true,
      data: {
        summary: summary.rows[0],
        byDate: byDate.rows,
        byType: byType.rows,
        byConfidence: byConfidence.rows,
        byFlags: byFlags.rows,
        recent: recent.rows,
        runs: runs.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/regrade-backtest-props — re-grade prop rows in backtest_results
// against the real MLB boxscore. Defaults to dry-run; pass apply:true to write.
app.post('/api/admin/regrade-backtest-props', verifyToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  const { apply = false, from = null, to = null, runId = null, limit = null } = req.body ?? {};
  const safeLimit = limit != null ? Math.min(Math.max(parseInt(limit, 10) || 0, 0), 5000) : null;
  try {
    const start = Date.now();
    const result = await regradeBacktestProps({
      pool,
      apply: !!apply,
      from,
      to,
      runId,
      limit: safeLimit,
      maxMismatchExamples: 100,
      onLog: ({ level, msg }) => {
        if (level === 'warn') console.warn(msg); else console.log(msg);
      },
    });
    res.json({
      success: true,
      data: {
        apply: result.apply,
        stats: result.stats,
        mismatches: result.mismatches,
        elapsed_ms: Date.now() - start,
        filters: { from, to, runId, limit: safeLimit },
      },
    });
  } catch (err) {
    console.error('[regrade] endpoint failed:', err);
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/historical-games?date=YYYY-MM-DD — fetch completed games for a date
app.get('/api/admin/historical-games', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });
  const date = req.query.date;
  if (!date) return res.status(400).json({ success: false, error: 'date query param required' });

  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?date=${date}&sportId=1&hydrate=team,linescore,probablePitcher`;
    const mlbRes = await fetch(url);
    const data = await mlbRes.json();
    const games = [];
    for (const dateObj of data.dates ?? []) {
      for (const game of dateObj.games ?? []) {
        const status = game.status?.detailedState ?? '';
        const isFinal = status.toLowerCase().includes('final');
        const home = game.teams?.home;
        const away = game.teams?.away;
        games.push({
          gamePk: game.gamePk,
          status: isFinal ? 'final' : status,
          isFinal,
          home: { name: home?.team?.name ?? '', abbreviation: home?.team?.abbreviation ?? '', score: home?.score ?? 0 },
          away: { name: away?.team?.name ?? '', abbreviation: away?.team?.abbreviation ?? '', score: away?.score ?? 0 },
          totalRuns: (home?.score ?? 0) + (away?.score ?? 0),
          homePitcher: home?.probablePitcher?.fullName ?? 'TBD',
          awayPitcher: away?.probablePitcher?.fullName ?? 'TBD',
        });
      }
    }
    // Check which games already have backtest results
    const existing = await pool.query(
      'SELECT DISTINCT game_pk FROM backtest_results WHERE historical_date = $1',
      [date]
    );
    const existingPks = new Set(existing.rows.map(r => r.game_pk));
    games.forEach(g => { g.alreadyTested = existingPks.has(g.gamePk); });

    res.json({ success: true, data: { date, games } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/admin/run-backtest — analyze a single historical game and save to backtest_results
app.post('/api/admin/run-backtest', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });
  const { gamePk, date, runId, homeTeam, awayTeam, homeScore, awayScore, totalRuns, betType } = req.body;
  if (!gamePk || !date) return res.status(400).json({ success: false, error: 'gamePk and date required' });

  try {
    const matchup = `${awayTeam} vs ${homeTeam}`;
    const start = Date.now();

    // Use existing analyze/game endpoint logic internally
    const games = await getTodayGames(date);
    const gameData = games.find(g => String(g.gamePk) === String(gamePk));
    if (!gameData) return res.status(404).json({ success: false, error: 'Game not found in MLB schedule' });

    let allOdds = [];
    try { allOdds = await getGameOdds({ date }); } catch {}
    const matchedOdds = matchOddsToGame(allOdds, gameData.teams?.home?.name, gameData.teams?.away?.name);

    const contextResult2 = await buildContext(gameData, matchedOdds);
    const context = contextResult2.context ?? contextResult2;
    const shadowFeatures = contextResult2._features ?? {};
    const shadowStatcastData = buildShadowStatcastData(shadowFeatures);
    const analysis = await analyzeGame({
      mode: 'single', matchup, context, lang: 'en',
      betType: betType || 'all', riskProfile: 'balanced', webSearch: false, model: 'deep', timeoutMs: 90000,
      statcastData: shadowStatcastData,
      mlbApiData: gameData,
    });

    const latency = Date.now() - start;
    const mp = analysis.data?.master_prediction;
    const pick = mp?.pick ?? null;
    const confidence = mp?.oracle_confidence ?? null;
    const betValue = mp?.bet_value ?? null;
    const modelRisk = analysis.data?.model_risk ?? null;
    const alertFlags = analysis.data?.alert_flags ?? [];
    const hasCriticalFlags = alertFlags.some(f =>
      /statcast.*no.*available|no.*statcast|data.*limited|minimal.*analysis|small.*sample/i.test(f)
    );
    let pickType = pick ? (
      /over|under/i.test(pick) ? 'total' :
      /moneyline|ml/i.test(pick) ? 'moneyline' :
      /run\s*line|rl/i.test(pick) ? 'runline' : 'other'
    ) : 'unknown';

    // Resolve result.
    //
    // Player props MUST be tried first — otherwise picks like
    // "Wilyer Abreu Over 1.5 Total Bases" get matched by the loose
    // /(Over|O)\s+(\d+\.?\d*)/ regex below, which then compares the prop's
    // line against the GAME total runs and almost always returns WIN.
    let actualResult = null;
    if (pick && looksLikePlayerProp(pick)) {
      try {
        const boxscorePlayers = await getGameBoxscore(gamePk);
        if (boxscorePlayers) {
          const propResult = resolvePlayerProp(pick, boxscorePlayers);
          if (propResult?.result) {
            actualResult = propResult.result;
            pickType = `prop_${propResult.propType}`;
            console.log(`[backtest] Prop resolved: ${propResult.playerName} ${propResult.propType} ${propResult.direction ?? ''} ${propResult.line} — actual: ${propResult.actual} — ${actualResult}`);
          } else if (propResult?.error) {
            console.warn(`[backtest] Prop unresolvable (${propResult.error}): "${pick}"`);
          }
        }
      } catch (err) {
        console.warn(`[backtest] Props resolver failed: ${err.message}`);
      }
    }

    if (!actualResult && pick && homeScore != null && awayScore != null) {
      const total = parseInt(homeScore) + parseInt(awayScore);
      const cleaned = pick.replace(/\s*\([+-]?\d+\)\s*$/i, '').replace(/\s+[+-]\d{2,3}\s*$/i, '').replace(/\s*\(estimated\s+line\)\s*$/i, '').replace(/\s*\(est\.?\)\s*$/i, '').replace(/\s*\([^)]*total[^)]*\)\s*$/i, '').trim();

      let m = cleaned.match(/(?:Over|O)\s*\(?(?:estimated\s+|est\.?\s*)?(\d+\.?\d*)\)?/i);
      if (m) { const line = parseFloat(m[1]); actualResult = total > line ? 'win' : total < line ? 'loss' : 'push'; }
      if (!actualResult) { m = cleaned.match(/(?:Under|U)\s*\(?(?:estimated\s+|est\.?\s*)?(\d+\.?\d*)\)?/i); }
      if (m && !actualResult) { const line = parseFloat(m[1]); actualResult = total < line ? 'win' : total > line ? 'loss' : 'push'; }
      if (!actualResult && /moneyline|ml|a ganar/i.test(cleaned)) {
        const teamToken = cleaned.replace(/\s*(moneyline|ml|a ganar|dinero)\s*/gi, '').trim().toLowerCase();
        const pickedHome = homeTeam?.toLowerCase().includes(teamToken) || teamToken.includes(homeTeam?.toLowerCase()?.split(' ').pop());
        const pickedAway = awayTeam?.toLowerCase().includes(teamToken) || teamToken.includes(awayTeam?.toLowerCase()?.split(' ').pop());
        if (pickedHome) actualResult = parseInt(homeScore) > parseInt(awayScore) ? 'win' : 'loss';
        else if (pickedAway) actualResult = parseInt(awayScore) > parseInt(homeScore) ? 'win' : 'loss';
      }
    }

    // Save to DB
    const backtestInsert = await pool.query(`
      INSERT INTO backtest_results (run_id, historical_date, game_pk, matchup, home_team, away_team,
        pick, oracle_confidence, bet_value, model_risk, pick_type,
        actual_home_score, actual_away_score, actual_result, model, latency_ms,
        alert_flags, bet_value_raw, has_critical_flags)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (run_id, game_pk, pick_type) DO UPDATE SET
        matchup = EXCLUDED.matchup,
        home_team = EXCLUDED.home_team,
        away_team = EXCLUDED.away_team,
        pick = EXCLUDED.pick,
        oracle_confidence = EXCLUDED.oracle_confidence,
        bet_value = EXCLUDED.bet_value,
        model_risk = EXCLUDED.model_risk,
        actual_home_score = EXCLUDED.actual_home_score,
        actual_away_score = EXCLUDED.actual_away_score,
        actual_result = EXCLUDED.actual_result,
        model = EXCLUDED.model,
        latency_ms = EXCLUDED.latency_ms,
        alert_flags = EXCLUDED.alert_flags,
        bet_value_raw = EXCLUDED.bet_value_raw,
        has_critical_flags = EXCLUDED.has_critical_flags
      RETURNING id
    `, [
      runId, date, gamePk, matchup, homeTeam, awayTeam,
      pick, confidence, betValue, modelRisk, pickType,
      homeScore, awayScore, actualResult, 'deep', latency,
      JSON.stringify(alertFlags), betValue, hasCriticalFlags,
    ]);

    const backtestId = backtestInsert.rows[0]?.id;
    if (backtestId) {
      await savePickFeatures({
        backtestId,
        gamePk: Number(gamePk),
        gameDate: date,
        ...(contextResult2._features ?? {}),
        oddsData: contextResult2._features?.oddsData ?? matchedOdds,
        pick,
        result: actualResult,
        sport: 'mlb',
      });

      if (isShadowModeEnabled() && analysis?.data && analysis?.xgboostResult) {
        try {
          await recordShadowModelRun({
            backtestId,
            sourceType: 'backtest',
            analysisMode: 'single',
            gameData,
            gameDate: normalizeDateInput(date ?? gameData?.gameDate),
            analysisData: analysis.data,
            xgboostResult: analysis.xgboostResult,
            statcastData: shadowStatcastData,
            features: shadowFeatures,
            actual: buildShadowActualOutcome({
              gameData,
              actualResult,
              homeScore,
              awayScore,
            }),
          });
        } catch (shadowErr) {
          console.warn('[shadow-mode] Could not persist backtest run:', shadowErr.message);
        }
      }
    }

    res.json({
      success: true,
      data: { gamePk, matchup, pick, confidence, betValue, modelRisk, actualResult, alertFlags, latency, pickType, backtestId },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/admin/shadow-model — view shadow model dashboard (admin only)
app.get('/api/admin/shadow-model', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });

  try {
    const limit = Number(req.query.limit ?? 50);
    const rawSport = String(req.query.sport ?? 'mlb').toLowerCase();
    const sport = ['nba', 'nfl'].includes(rawSport) ? rawSport : 'mlb';
    // Only MLB shadow runs go through the live-game refresher (NBA/NFL resolvers
    // don't expose getLiveGameData yet — runs stay pending until the per-sport
    // pick resolver back-fills them).
    if (sport === 'mlb') {
      await refreshPendingShadowModelRuns(Math.min(limit, 50));
    }
    const data = await getShadowModeDashboard(limit, sport);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/ml-calibration — proxy the Python sidecar's calibration data (admin only)
app.get('/api/admin/ml-calibration', verifyToken, isAdmin, async (req, res) => {
  try {
    const circuit = getMlCircuitState();
    const enabled = isMlSidecarEnabled();

    if (!enabled) {
      return res.json({
        success: true,
        enabled: false,
        circuit,
        message: 'ML sidecar is disabled (ML_SIDECAR_ENABLED=false). Set to true and provide HEXA_ML_API_URL to activate.',
        calibration: null,
        shadow_comparison: null,
      });
    }

    // Fetch calibration from Python sidecar (may return null if circuit is open or sidecar is down)
    let calibration = await getMlCalibration();

    // Railway uses an ephemeral filesystem — model artifacts are lost on redeploy/restart.
    // When the sidecar manifest is empty, fall back to the last known metrics stored in
    // ml_retrain_log so the dashboard always shows the last successfully trained state.
    const liveMarkets = calibration?.manifest?.markets ?? {};
    const hasLiveData = Object.keys(liveMarkets).some(
      (m) => liveMarkets[m] && !liveMarkets[m].skipped && !liveMarkets[m].error && liveMarkets[m].brier_test != null
    );
    if (!hasLiveData) {
      try {
        const logRes = await pool.query(`
          SELECT DISTINCT ON (market)
            market, brier AS brier_test, n_train, n_test, finished_at AS trained_at, response
          FROM ml_retrain_log
          WHERE status = 'success'
            AND market NOT IN ('all', 'ensemble')
            AND brier IS NOT NULL
          ORDER BY market, finished_at DESC
        `);
        if (logRes.rows.length > 0) {
          const markets = {};
          for (const row of logRes.rows) {
            // Try to pull richer metrics from the saved retrain response JSON
            let extra = {};
            try {
              const parsed = row.response ? JSON.parse(row.response) : null;
              const mBlock = parsed?.summary?.[row.market] ?? parsed?.[row.market] ?? null;
              if (mBlock) extra = mBlock;
            } catch { /* ignore parse errors */ }
            markets[row.market] = {
              brier_test: Number(row.brier_test),
              n_train: row.n_train,
              n_test: row.n_test,
              trained_at: row.trained_at,
              _from_log: true,
              ...extra,
            };
          }
          calibration = { manifest: { markets, _from_log: true } };
        }
      } catch (logErr) {
        console.warn('[ml-calibration] log fallback failed:', logErr.message);
      }
    }

    // Pull comparison data from shadow_model_runs: legacy vs python model accuracy
    const comparisonRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE python_model_status = 'ok') AS python_scored,
        COUNT(*) FILTER (WHERE python_model_status = 'disabled') AS python_disabled,
        COUNT(*) FILTER (WHERE python_model_status = 'unavailable') AS python_unavailable,
        COUNT(*) FILTER (WHERE python_model_status = 'error') AS python_error,
        COUNT(*) FILTER (WHERE python_model_status IS NULL) AS python_null,
        COUNT(*) FILTER (WHERE actual_winner_id IS NOT NULL AND python_model_status = 'ok') AS python_resolved,
        COUNT(*) FILTER (
          WHERE actual_winner_id IS NOT NULL
            AND python_model_status = 'ok'
            AND python_model_score IS NOT NULL
            AND (
              (python_model_score >= 0.5 AND actual_winner_id = home_team_id::TEXT) OR
              (python_model_score < 0.5  AND actual_winner_id = away_team_id::TEXT)
            )
        ) AS python_correct,
        COUNT(*) FILTER (WHERE actual_winner_id IS NOT NULL AND shadow_predicted_winner_id IS NOT NULL) AS legacy_resolved,
        COUNT(*) FILTER (
          WHERE actual_winner_id IS NOT NULL
            AND shadow_predicted_winner_id = actual_winner_id
        ) AS legacy_correct,
        ROUND(AVG(python_model_score)::numeric, 4) AS avg_python_prob,
        MIN(created_at) AS first_run,
        MAX(created_at) AS last_run
      FROM shadow_model_runs
    `);

    // Rolling 30d accuracy by model source
    const rolling30dRes = await pool.query(`
      SELECT
        TO_CHAR(created_at::date, 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE actual_winner_id IS NOT NULL) AS resolved,
        COUNT(*) FILTER (
          WHERE actual_winner_id IS NOT NULL
            AND shadow_predicted_winner_id = actual_winner_id
        ) AS legacy_hits,
        COUNT(*) FILTER (
          WHERE actual_winner_id IS NOT NULL
            AND python_model_status = 'ok'
            AND python_model_score IS NOT NULL
            AND (
              (python_model_score >= 0.5 AND actual_winner_id = home_team_id::TEXT) OR
              (python_model_score < 0.5  AND actual_winner_id = away_team_id::TEXT)
            )
        ) AS python_hits
      FROM shadow_model_runs
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1
      ORDER BY 1 DESC
    `);

    // Sprint 4 — pull ensemble manifest in parallel (may be null if not trained)
    const ensembleEnabled = isMlEnsembleEnabled();
    const ensembleManifest = ensembleEnabled ? await getMlEnsembleCalibration() : null;

    return res.json({
      success: true,
      enabled: true,
      circuit,
      calibration: calibration ?? null,
      shadow_comparison: comparisonRes.rows[0] ?? null,
      rolling_30d: rolling30dRes.rows,
      ensemble: {
        enabled: ensembleEnabled,
        manifest: ensembleManifest,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Sprint 4 — Ensemble meta-learner endpoints
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/analyze/game-ensemble
 *
 * Returns the meta-learner's combined home-win probability for one game.
 * Reads the latest shadow_model_runs row for the requested game_pk to get
 * the 3 source probabilities (oracle / legacy / python), then asks the
 * Python sidecar to apply the trained weights.
 *
 * NEVER mutates picks. NEVER changes the Oracle behavior. This is purely
 * annotation — the legacy Oracle path is untouched.
 *
 * Body: { game_pk: number, market?: 'moneyline' }
 * Response: { success, enabled, probability?, sources?, weights?, model_version?, reason? }
 *
 * Feature flag: ENSEMBLE_ENABLED=false by default.
 */
app.post('/api/analyze/game-ensemble', verifyToken, async (req, res) => {
  try {
    if (!isMlEnsembleEnabled()) {
      return res.json({
        success: true,
        enabled: false,
        reason: 'ENSEMBLE_ENABLED=false (set to true and train the ensemble first).',
      });
    }

    const gamePk = Number(req.body?.game_pk);
    const market = String(req.body?.market ?? 'moneyline');
    if (!Number.isFinite(gamePk)) {
      return res.status(400).json({ success: false, error: 'game_pk is required' });
    }
    const ENSEMBLE_MARKETS = new Set(['moneyline', 'overunder', 'runline']);
    if (!ENSEMBLE_MARKETS.has(market)) {
      return res.status(400).json({ success: false, error: `Unsupported ensemble market: ${market}. Valid: ${[...ENSEMBLE_MARKETS].join(', ')}` });
    }

    // Pull the most recent shadow_model_runs row with all 3 pick-aligned probs.
    const sourceRow = await pool.query(
      `SELECT
         oracle_pick_prob,
         legacy_pick_prob,
         python_pick_prob,
         pick_market_type,
         home_team_abbr,
         away_team_abbr,
         created_at
       FROM shadow_model_runs
       WHERE game_pk = $1
         AND (pick_market_type = $2 OR (pick_market_type IS NULL AND $2 = 'moneyline'))
         AND oracle_pick_prob IS NOT NULL
         AND legacy_pick_prob IS NOT NULL
         AND python_pick_prob IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [gamePk, market]
    );

    if (!sourceRow.rows.length) {
      return res.json({
        success: true,
        enabled: true,
        probability: null,
        reason: 'No shadow_model_runs row has all 3 pick-aligned sources for this game yet.',
      });
    }

    const r = sourceRow.rows[0];
    const ensemble = await predictMlEnsemble({
      market,
      oracle_prob: Number(r.oracle_pick_prob),
      legacy_prob: Number(r.legacy_pick_prob),
      python_prob: Number(r.python_pick_prob),
    });

    if (!ensemble) {
      return res.json({
        success: true,
        enabled: true,
        probability: null,
        reason: 'Sidecar returned no result (ensemble not trained or sidecar down).',
      });
    }

    return res.json({
      success: true,
      enabled: true,
      game_pk: gamePk,
      matchup: `${r.away_team_abbr} @ ${r.home_team_abbr}`,
      probability: ensemble.probability,
      confidence: ensemble.confidence,
      sources: ensemble.sources,
      weights: ensemble.weights,
      model_version: ensemble.model_version,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

/**
 * GET /api/admin/ml-ensemble-calibration — proxy the sidecar's ensemble manifest.
 * Admin only. Used by the MLCalibrationDashboard to render the 4th series.
 */
app.get('/api/admin/ml-ensemble-calibration', verifyToken, isAdmin, async (req, res) => {
  try {
    const enabled = isMlEnsembleEnabled();
    const manifest = enabled ? await getMlEnsembleCalibration() : null;
    return res.json({
      success: true,
      enabled,
      manifest,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// GET /api/admin/feature-store — view ML training dataset (admin only)
app.get('/api/admin/feature-store', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });
  try {
    const requestedMonth = String(req.query.month ?? '').trim();
    if (requestedMonth && !/^\d{4}-\d{2}$/.test(requestedMonth)) {
      return res.status(400).json({ success: false, error: 'Invalid month format. Use YYYY-MM.' });
    }
    const rawSport = String(req.query.sport ?? 'mlb').toLowerCase();
    const sport = ['nba', 'nfl'].includes(rawSport) ? rawSport : 'mlb';
    const sportFilterPf = `COALESCE(pf.sport,'mlb') = '${sport}'`;
    const datasetBaseWhere = `WHERE ${sportFilterPf} ${DATASET_PICK_VISIBILITY_SQL}`;

    const summarySql = sport === 'nfl'
      ? `
        SELECT
          COUNT(*) as total_records,
          COUNT(*) FILTER (WHERE pf.result = 'win') as wins,
          COUNT(*) FILTER (WHERE pf.result = 'loss') as losses,
          COUNT(*) FILTER (WHERE pf.result IS NULL) as pending,
          COUNT(*) FILTER (WHERE pf.pick_id IS NOT NULL) as from_real_picks,
          COUNT(*) FILTER (WHERE pf.backtest_id IS NOT NULL) as from_backtests,
          ROUND(AVG(pf.home_epa_off)::numeric, 3) as avg_home_epa_off,
          ROUND(AVG(pf.away_epa_off)::numeric, 3) as avg_away_epa_off,
          ROUND(AVG(pf.wind_mph)::numeric, 1) as avg_wind_mph,
          ROUND(AVG(pf.context_completeness)::numeric, 2) as avg_completeness,
          MIN(pf.game_date) as earliest_date,
          MAX(pf.game_date) as latest_date
        FROM pick_features pf
        ${datasetBaseWhere}
      `
      : sport === 'nba'
      ? `
        SELECT
          COUNT(*) as total_records,
          COUNT(*) FILTER (WHERE pf.result = 'win') as wins,
          COUNT(*) FILTER (WHERE pf.result = 'loss') as losses,
          COUNT(*) FILTER (WHERE pf.result IS NULL) as pending,
          COUNT(*) FILTER (WHERE pf.pick_id IS NOT NULL) as from_real_picks,
          COUNT(*) FILTER (WHERE pf.backtest_id IS NOT NULL) as from_backtests,
          ROUND(AVG(pf.home_net_rating)::numeric, 2) as avg_home_net_rating,
          ROUND(AVG(pf.away_net_rating)::numeric, 2) as avg_away_net_rating,
          ROUND(AVG(pf.home_pace)::numeric, 1) as avg_home_pace,
          ROUND(AVG(pf.context_completeness)::numeric, 2) as avg_completeness,
          MIN(pf.game_date) as earliest_date,
          MAX(pf.game_date) as latest_date
        FROM pick_features pf
        ${datasetBaseWhere}
      `
      : `
        SELECT
          COUNT(*) as total_records,
          COUNT(*) FILTER (WHERE pf.result = 'win') as wins,
          COUNT(*) FILTER (WHERE pf.result = 'loss') as losses,
          COUNT(*) FILTER (WHERE pf.result IS NULL) as pending,
          COUNT(*) FILTER (WHERE pf.pick_id IS NOT NULL) as from_real_picks,
          COUNT(*) FILTER (WHERE pf.backtest_id IS NOT NULL) as from_backtests,
          ROUND(AVG(pf.home_pitcher_xwoba)::numeric, 3) as avg_home_p_xwoba,
          ROUND(AVG(pf.away_pitcher_xwoba)::numeric, 3) as avg_away_p_xwoba,
          ROUND(AVG(pf.temperature)::numeric, 1) as avg_temperature,
          ROUND(AVG(pf.data_quality_score)::numeric, 0) as avg_data_quality,
          MIN(pf.game_date) as earliest_date,
          MAX(pf.game_date) as latest_date
        FROM pick_features pf
        ${datasetBaseWhere}
      `;
    const summary = await pool.query(summarySql);

    const monthOptions = await pool.query(`
      SELECT
        TO_CHAR(pf.game_date::date, 'YYYY-MM') as month_key,
        MIN(pf.game_date::date) as month_start,
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE pf.result = 'win') as wins,
        COUNT(*) FILTER (WHERE pf.result = 'loss') as losses,
        COUNT(*) FILTER (WHERE pf.result IS NULL) as pending
      FROM pick_features pf
      WHERE pf.game_date IS NOT NULL AND ${sportFilterPf} ${DATASET_PICK_VISIBILITY_SQL}
      GROUP BY 1
      ORDER BY month_key DESC
    `);

    const selectedMonth = requestedMonth || monthOptions.rows[0]?.month_key || null;

    const dailySummaries = selectedMonth
      ? await pool.query(`
          SELECT
            TO_CHAR(pf.game_date::date, 'YYYY-MM-DD') as day_key,
            COUNT(*) as total_records,
            COUNT(*) FILTER (WHERE pf.result = 'win') as wins,
            COUNT(*) FILTER (WHERE pf.result = 'loss') as losses,
            COUNT(*) FILTER (WHERE pf.result IS NULL) as pending
          FROM pick_features pf
          WHERE TO_CHAR(pf.game_date::date, 'YYYY-MM') = $1 AND ${sportFilterPf} ${DATASET_PICK_VISIBILITY_SQL}
          GROUP BY 1
          ORDER BY day_key DESC
        `, [selectedMonth])
      : { rows: [] };

    const monthRecords = selectedMonth
      ? (sport === 'nba'
          ? await pool.query(`
              SELECT pf.game_date, pf.game_pk, pf.pick, pf.result,
                p.matchup,
                CASE
                  WHEN COALESCE(pf.source, p.source) = 'oracle_chat' THEN 'Oraclechat'
                  ELSE COALESCE(pf.user_email, p.user_email)
                END AS user_email,
                pf.pick_time_lima,
                pf.home_team_abbr, pf.away_team_abbr,
                pf.home_net_rating, pf.away_net_rating,
                pf.home_off_rating, pf.away_off_rating,
                pf.home_def_rating, pf.away_def_rating,
                pf.home_pace, pf.away_pace,
                pf.home_ts_pct, pf.away_ts_pct,
                pf.home_rest_days, pf.away_rest_days,
                pf.home_is_b2b, pf.away_is_b2b,
                pf.home_injuries_severe, pf.away_injuries_severe,
                pf.home_last10_wins, pf.away_last10_wins,
                pf.context_completeness,
                pf.odds_ml_home, pf.odds_ml_away, pf.odds_ou_total
              FROM pick_features pf
              LEFT JOIN picks p ON pf.pick_id = p.id
              WHERE TO_CHAR(pf.game_date::date, 'YYYY-MM') = $1 AND ${sportFilterPf} ${DATASET_PICK_VISIBILITY_SQL}
              ORDER BY pf.game_date DESC, pf.created_at DESC
              LIMIT 750
            `, [selectedMonth])
          : await pool.query(`
              SELECT pf.game_date, pf.game_pk, pf.pick, pf.result,
                p.matchup,
                CASE
                  WHEN COALESCE(pf.source, p.source) = 'oracle_chat' THEN 'Oraclechat'
                  ELSE COALESCE(pf.user_email, p.user_email)
                END AS user_email,
                pf.pick_time_lima,
                pf.home_pitcher_xwoba, pf.away_pitcher_xwoba,
                pf.home_pitcher_whiff, pf.away_pitcher_whiff,
                pf.home_lineup_avg_xwoba, pf.away_lineup_avg_xwoba,
                pf.park_factor_overall, pf.temperature, pf.wind_speed,
                pf.data_quality_score, pf.signal_coherence_score,
                pf.odds_ml_home, pf.odds_ml_away, pf.odds_ou_total
              FROM pick_features pf
              LEFT JOIN picks p ON pf.pick_id = p.id
              WHERE TO_CHAR(pf.game_date::date, 'YYYY-MM') = $1 AND ${sportFilterPf} ${DATASET_PICK_VISIBILITY_SQL}
              ORDER BY pf.game_date DESC, pf.created_at DESC
              LIMIT 750
            `, [selectedMonth]))
      : { rows: [] };

    const featureCoverageSql = sport === 'nba'
      ? `
        SELECT
          COUNT(*) as total,
          COUNT(pf.home_net_rating) as has_home_net,
          COUNT(pf.away_net_rating) as has_away_net,
          COUNT(pf.home_pace)       as has_home_pace,
          COUNT(pf.away_pace)       as has_away_pace,
          COUNT(pf.home_rest_days)  as has_home_rest,
          COUNT(pf.away_rest_days)  as has_away_rest,
          COUNT(pf.odds_ml_home)    as has_odds,
          COUNT(pf.context_completeness) as has_completeness
        FROM pick_features pf
        ${datasetBaseWhere}
      `
      : `
        SELECT
          COUNT(*) as total,
          COUNT(pf.home_pitcher_xwoba) as has_home_xwoba,
          COUNT(pf.away_pitcher_xwoba) as has_away_xwoba,
          COUNT(pf.home_pitcher_whiff) as has_home_whiff,
          COUNT(pf.away_pitcher_whiff) as has_away_whiff,
          COUNT(pf.home_lineup_avg_xwoba) as has_home_lineup,
          COUNT(pf.away_lineup_avg_xwoba) as has_away_lineup,
          COUNT(pf.temperature) as has_temperature,
          COUNT(pf.odds_ml_home) as has_odds,
          COUNT(pf.park_factor_overall) as has_park
        FROM pick_features pf
        ${datasetBaseWhere}
      `;
    const featureCoverage = await pool.query(featureCoverageSql);

    // winRateByTemperature only makes sense for MLB; NBA gets a rest-day bucket instead.
    const winRateByFeature = sport === 'nba'
      ? await pool.query(`
          SELECT
            CASE
              WHEN pf.home_rest_days = 0 OR pf.away_rest_days = 0 THEN 'B2B PRESENT'
              WHEN pf.home_rest_days >= 3 OR pf.away_rest_days >= 3 THEN '3+ REST DAYS'
              ELSE '1-2 REST DAYS'
            END as bucket,
            COUNT(*) FILTER (WHERE pf.result = 'win') as wins,
            COUNT(*) FILTER (WHERE pf.result IN ('win','loss')) as total
          FROM pick_features pf
          WHERE ${sportFilterPf} ${DATASET_PICK_VISIBILITY_SQL}
            AND pf.result IN ('win','loss')
            AND (pf.home_rest_days IS NOT NULL OR pf.away_rest_days IS NOT NULL)
          GROUP BY bucket
          ORDER BY bucket
        `)
      : await pool.query(`
          SELECT
            CASE WHEN pf.temperature < 50 THEN 'COLD (<50F)' WHEN pf.temperature < 70 THEN 'MILD (50-70F)' ELSE 'WARM (70F+)' END as temp_bucket,
            COUNT(*) FILTER (WHERE pf.result = 'win') as wins,
            COUNT(*) FILTER (WHERE pf.result IN ('win','loss')) as total
          FROM pick_features pf
          WHERE pf.temperature IS NOT NULL AND pf.result IN ('win','loss') AND ${sportFilterPf} ${DATASET_PICK_VISIBILITY_SQL}
          GROUP BY temp_bucket
          ORDER BY temp_bucket
        `);

    res.json({
      success: true,
      data: {
        sport,
        summary: summary.rows[0],
        selectedMonth,
        monthOptions: monthOptions.rows,
        dailySummaries: dailySummaries.rows,
        records: monthRecords.rows,
        featureCoverage: featureCoverage.rows[0],
        winRateByTemperature: winRateByFeature.rows,
        statcastCache: sport === 'mlb' ? getCacheStatus() : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Startup: run migrations → seed admin → start server ───────────────────────
app.post('/api/admin/feature-store/backfill', verifyToken, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ success: false, error: 'Admin access required' });

  const requestedLimit = Number(req.body?.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(250, Math.floor(requestedLimit))) : 50;
  const scope = String(req.body?.scope ?? 'all').toLowerCase();
  const onlyMissing = req.body?.onlyMissing !== false;

  const missingPredicate = `
    pf.id IS NULL OR
    pf.home_pitcher_xwoba IS NULL OR
    pf.away_pitcher_xwoba IS NULL OR
    pf.home_pitcher_whiff IS NULL OR
    pf.away_pitcher_whiff IS NULL OR
    pf.home_lineup_avg_xwoba IS NULL OR
    pf.away_lineup_avg_xwoba IS NULL
  `;

  try {
    const candidates = [];

    if (scope === 'all' || scope === 'picks') {
      const picksRes = await pool.query(`
        SELECT
          'pick' AS source,
          p.id AS entity_id,
          p.id AS pick_id,
          NULL::INTEGER AS backtest_id,
          p.game_pk,
          p.game_date,
          p.pick,
          p.result,
          p.odds_details
        FROM picks p
        LEFT JOIN pick_features pf ON pf.pick_id = p.id
        WHERE p.deleted_at IS NULL
          AND p.game_pk IS NOT NULL
          ${onlyMissing ? `AND (${missingPredicate})` : ''}
        ORDER BY p.created_at DESC
        LIMIT $1
      `, [limit]);
      candidates.push(...picksRes.rows);
    }

    if (scope === 'all' || scope === 'backtests') {
      const backtestsRes = await pool.query(`
        SELECT
          'backtest' AS source,
          b.id AS entity_id,
          NULL::INTEGER AS pick_id,
          b.id AS backtest_id,
          b.game_pk,
          b.historical_date AS game_date,
          b.pick,
          b.actual_result AS result,
          NULL::JSONB AS odds_details
        FROM backtest_results b
        LEFT JOIN pick_features pf ON pf.backtest_id = b.id
        WHERE b.game_pk IS NOT NULL
          ${onlyMissing ? `AND (${missingPredicate})` : ''}
        ORDER BY b.created_at DESC
        LIMIT $1
      `, [limit]);
      candidates.push(...backtestsRes.rows);
    }

    const deduped = Array.from(
      new Map(candidates.map((row) => [`${row.source}:${row.entity_id}`, row])).values()
    ).slice(0, limit);

    let rebuilt = 0;
    let failed = 0;
    const failures = [];

    for (const row of deduped) {
      try {
        const ok = await saveFeatureStoreForGame({
          pickId: row.pick_id,
          backtestId: row.backtest_id,
          gamePk: row.game_pk,
          gameDate: row.game_date,
          pick: row.pick,
          result: row.result,
          oddsData: row.odds_details,
        });

        if (ok) rebuilt += 1;
        else {
          failed += 1;
          failures.push({
            source: row.source,
            entity_id: row.entity_id,
            game_pk: row.game_pk,
            reason: 'game_not_found_or_feature_save_skipped',
          });
        }
      } catch (err) {
        failed += 1;
        failures.push({
          source: row.source,
          entity_id: row.entity_id,
          game_pk: row.game_pk,
          reason: err.message,
        });
      }
    }

    res.json({
      success: true,
      data: {
        scanned: deduped.length,
        rebuilt,
        failed,
        scope,
        onlyMissing,
        failures: failures.slice(0, 20),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: safeError(err) });
  }
});

// ── Global error handler (Sentry + JSON response) ────────────────────────────
app.use(sentryErrorHandler());
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(`[express] Unhandled error ${req.method} ${req.path}:`, err.message);
  res.status(err.status ?? 500).json({ success: false, error: safeError(err) });
});

runMigrations()
  .then(() => runParlaySynergyMigrations())
  .then(() => runSprint1Migrations())
  .then(() => runPlayerPropsMlbMigrations())
  .then(() => runSprint3Migrations())
  .then(() => runAdminMLControlCenterMigrations())
  .then(() => runNbaScaffoldingMigrations())
  .then(() => runNbaDatasetMigrations())
  .then(() => runNflScaffoldingMigrations())
  .then(() => runNflDatasetMigrations())
  .then(() => runNhlScaffoldingMigrations())
  .then(() => runNhlDatasetMigrations())
  .then(() => runPickAlignedShadowMigrations())
  .then(() => runImperdibleMigrations())
  .then(() => runOddsCacheMigrations())
  .then(() => runEnsembleBackfillMigration())
  .then(() => runNbaPlayerStatsMigrations())
  .then(() => runNewsletterMigrations())
  .then(() => runBeatReporterMigrations())
  .then(() => runCsvBacktestMigrations())
  .then(() => runPgvectorMigrations())
  .then(() => runFeatureFlagsMigrations())
  .then(() => runJobQueueMigrations())
  .then(() => runSoccerScaffoldingMigrations())
  .then(() => runSoccerDatasetMigrations())
  .then(() => runTennisScaffoldingMigrations())
  .then(() => runTennisDatasetMigrations())
  .then(() => runMundialMigrations())
  .then(() => runSportAccessMigrations())
  .then(() => seedAdminUser())
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Hexa-v4 server running on http://0.0.0.0:${PORT}`);

      // ── Statcast cache warm-up (non-blocking, delayed 30s) ──────────────
      console.log('[H.E.X.A.] Statcast cache warm-up programado en 30s...');
      setTimeout(() => {
        console.log('[H.E.X.A.] Warming up Statcast cache...');
        refreshCache()
          .then(status => {
            const total = Object.values(status?.recordCounts ?? {}).reduce((a, b) => a + b, 0);
            console.log(`[H.E.X.A.] Statcast cache ready: ${total} records loaded`);
          })
          .catch(err => {
            console.warn('[H.E.X.A.] Statcast warm-up failed (will retry on first request):', err.message);
          });
      }, 30000).unref();

      // ── Auto-refresh every 6 hours ───────────────────────────────────────
      const SIX_HOURS = 6 * 60 * 60 * 1000;
      setInterval(() => {
        console.log('[H.E.X.A.] Refreshing Statcast cache (scheduled)...');
        refreshCache()
          .then(status => {
            const total = Object.values(status?.recordCounts ?? {}).reduce((a, b) => a + b, 0);
            console.log(`[H.E.X.A.] Statcast cache refreshed: ${total} records`);
          })
          .catch(err => {
            console.warn('[H.E.X.A.] Scheduled Statcast refresh failed:', err.message);
          });
      }, SIX_HOURS).unref();

      // ── Line movement snapshot: every 6 hours between 9am–7pm ET ────────
      const SIX_HOURS_LM = 6 * 60 * 60 * 1000;
      setInterval(() => {
        const etHour = parseInt(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', hour12: false, timeZone: 'America/New_York',
          }).format(new Date()),
          10
        );
        // Window: 09:00–18:59 ET (lines open in the morning, games start ~18:00+)
        if (etHour >= 9 && etHour < 19) {
          console.log(`[line-movement] Scheduled snapshot triggered (ET hour: ${etHour})`);
          captureOddsSnapshot().catch(err => {
            console.error('[line-movement] Scheduled snapshot failed:', err.message);
          });
        }
      }, SIX_HOURS_LM).unref();

      // ── Pick resolver: every 30 min between 7pm–6am ET ───────────────────
      const THIRTY_MIN = 30 * 60 * 1000;
      setInterval(() => {
        // Get current hour in US Eastern Time (handles EDT/EST automatically)
        const etHour = parseInt(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', hour12: false, timeZone: 'America/New_York',
          }).format(new Date()),
          10
        );
        // Window: 19:00–05:59 ET (west coast games finish ~7pm ET; extras/rain delays can run past 3am)
        if (etHour >= 19 || etHour < 6) {
          console.log(`[pick-resolver] Scheduled run triggered (ET hour: ${etHour})`);
          resolvePendingPicks()
            .catch(err => {
              console.error('[pick-resolver] Scheduled run failed:', err.message);
            })
            .finally(() => {
              // Resolve parlays after individual picks so live-feed cache is warm
              // (both call getLiveGameData per gamePk, but each has its own cache).
              resolvePendingParlays().catch(err => {
                console.error('[parlay-resolver] Scheduled run failed:', err.message);
              });
            });

          if (process.env.NBA_ANALYSIS_ENABLED === 'true') {
            resolveNbaPendingPicks().catch(err => {
              console.error('[pick-resolver-nba] Scheduled run failed:', err.message);
            });
          }

          // NHL plays daily (Oct–Jun); games finish late evening into early
          // morning ET — same window as MLB/NBA, gated by its own flag.
          if (process.env.NHL_ANALYSIS_ENABLED === 'true') {
            resolveNhlPendingPicks().catch(err => {
              console.error('[pick-resolver-nhl] Scheduled run failed:', err.message);
            });
          }

          // Soccer plays daily across six leagues; games span daytime through evening.
          if (process.env.SOCCER_ANALYSIS_ENABLED === 'true') {
            resolveSoccerPendingPicks().catch(err => {
              console.error('[pick-resolver-soccer] Scheduled run failed:', err.message);
            });
          }

          // Tennis is year-round; tournaments run across many timezones, so the
          // same broad evening/overnight ET window covers most finals. Gated by
          // its own flag; the resolver itself skips dates with no pending picks.
          if (process.env.TENNIS_ANALYSIS_ENABLED === 'true') {
            resolveTennisPendingPicks().catch(err => {
              console.error('[pick-resolver-tennis] Scheduled run failed:', err.message);
            });
          }

          resolveMundialPredictions().catch(err => {
            console.error(`[mundial-resolver] ${err.message}`);
          });
        }

        // NFL resolver — game-time-aware: NFL plays Thu/Sun/Mon. Sunday early
        // games finish ~16:00 ET; primetime spills past midnight into the next
        // morning. Run only on those days, from 16:00 ET through 05:59 ET, so we
        // don't poll ESPN on the (idle) MLB/NBA-only days of the week.
        if (process.env.NFL_ANALYSIS_ENABLED === 'true') {
          const etWeekday = new Intl.DateTimeFormat('en-US', {
            weekday: 'short', timeZone: 'America/New_York',
          }).format(new Date());
          const isNflDay = etWeekday === 'Thu' || etWeekday === 'Sun' || etWeekday === 'Mon';
          if (isNflDay && (etHour >= 16 || etHour < 6)) {
            resolveNflPendingPicks().catch(err => {
              console.error('[pick-resolver-nfl] Scheduled run failed:', err.message);
            });
          }
        }
      }, THIRTY_MIN).unref();

      // ── Closing line capture: every 30 min between 2pm–1am ET ────────────
      // Previously ran every 2h with a 30-min pre-game gate — most games fell
      // in the gap between job fires. 30-min interval + 3h gate means we get
      // at least 4-6 capture attempts per game before first pitch.
      setInterval(() => {
        const etHour = parseInt(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', hour12: false, timeZone: 'America/New_York',
          }).format(new Date()),
          10
        );
        // Closing line capture: 14:00–01:59 ET (afternoon + evening MLB windows)
        if (etHour >= 14 || etHour < 2) {
          console.log(`[closing-line] Scheduled capture triggered (ET hour: ${etHour})`);
          captureClosingLines().catch(err => {
            console.error('[closing-line] Scheduled capture failed:', err.message);
          });
        }
        // Soccer closing-line capture runs across a wider window (European
        // matches kick off ~07:00–17:00 ET; MLS evenings) when soccer is on.
        if (process.env.SOCCER_ANALYSIS_ENABLED === 'true') {
          captureSoccerClosingLines().catch(err => {
            console.error('[closing-line-soccer] Scheduled capture failed:', err.message);
          });
        }
      }, THIRTY_MIN).unref();

      // ── Odds cache warm-up: once a day at 10am ET, refresh alt-line
      //     menu for every game of the day so Imperdible / Safe / Parlay /
      //     Oracle Chat read from cache instead of hitting The Odds API.
      //     Also prunes expired rows. Runs hourly between 10am-7pm ET; only
      //     does work when within the warm window or when prune is due.
      const ONE_HOUR = 60 * 60 * 1000;
      const oddsCacheState = { lastWarmDate: null };
      setInterval(() => {
        const etHour = parseInt(
          new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', hour12: false, timeZone: 'America/New_York',
          }).format(new Date()),
          10
        );
        // Prune expired entries hourly (cheap).
        pruneExpiredOddsCache().catch(() => {});
        // Warm window: 10am-12pm ET. Only run once per ET-day.
        if (etHour < 10 || etHour > 12) return;
        const etDate = new Intl.DateTimeFormat('en-CA', {
          year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York',
        }).format(new Date());
        if (oddsCacheState.lastWarmDate === etDate) return;
        oddsCacheState.lastWarmDate = etDate;
        (async () => {
          try {
            console.log(`[odds-cache] warm-up starting for ${etDate}`);
            const games = await getGameOdds({ date: etDate });
            if (!Array.isArray(games) || games.length === 0) {
              console.log('[odds-cache] warm-up: no games returned, skipping alt fetch');
              return;
            }
            let warmedCount = 0;
            for (const game of games) {
              if (!game?.eventId) continue;
              try {
                const result = await getEventAlternates(game.eventId);
                if (result) warmedCount++;
                // Throttle to ~1 req/sec to be polite with the Odds API.
                await new Promise((r) => setTimeout(r, 1100));
              } catch (err) {
                console.warn(`[odds-cache] warm-up alt fetch failed for ${game.eventId}: ${err.message}`);
              }
            }
            console.log(`[odds-cache] warm-up complete: ${warmedCount}/${games.length} events cached`);
          } catch (err) {
            console.warn(`[odds-cache] warm-up failed: ${err.message}`);
          }
        })().catch(() => {});
      }, ONE_HOUR).unref();

      if (process.env.X_AUTO_PUBLISH_ENABLED === '1') {
        const intervalMinutes = Math.max(1, Number.parseInt(process.env.X_AUTO_PUBLISH_INTERVAL_MINUTES ?? '5', 10) || 5);
        const CONTENT_QUEUE_INTERVAL = intervalMinutes * 60 * 1000;
        console.log(`[content-queue] Scheduled X autopublish enabled (${intervalMinutes}m cadence)`);
        setInterval(() => {
          processScheduledContentQueue()
            .then((results) => {
              if (results.length > 0) {
                console.log(`[content-queue] Processed ${results.length} scheduled item(s)`);
              }
            })
            .catch((err) => {
              console.error('[content-queue] Scheduled publish failed:', err.message);
            });
        }, CONTENT_QUEUE_INTERVAL).unref();
      }

      if (process.env.NEWSLETTER_ENABLED === '1') {
        // Weekly newsletter — fires every Sunday between 09:00 and 09:59 ET
        setInterval(() => {
          const now = new Date();
          const dayET  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const dow    = dayET.getDay();   // 0 = Sunday
          const hourET = dayET.getHours();
          if (dow !== 0 || hourET !== 9) return;
          ['es', 'en'].forEach((lang) => {
            sendWeeklyNewsletter(lang, null).catch((err) => {
              console.error(`[newsletter] weekly send (${lang}) failed:`, err.message);
            });
          });
        }, 60 * 60 * 1000).unref(); // check hourly
        console.log('[newsletter] Weekly newsletter job scheduled (Sundays 09:00 ET)');
      }

      if (process.env.BEAT_REPORTER_ENABLED === '1') {
        console.log('[beat-reporter] Hourly injury signal scan enabled');
        setInterval(() => {
          runBeatReporterScan()
            .then(r => {
              if (r.signals > 0) console.log(`[beat-reporter] Scan done: ${r.processed} tweets, ${r.signals} signals`);
            })
            .catch(err => console.error('[beat-reporter] Scan failed:', err.message));
        }, 60 * 60 * 1000).unref();
      }

      if (process.env.THREADS_ENABLED === '1') {
        const threadsInterval = Math.max(1, Number.parseInt(process.env.X_AUTO_PUBLISH_INTERVAL_MINUTES ?? '5', 10) || 5);
        setInterval(() => {
          processScheduledThreadsQueue()
            .then(r => { if (r.length) console.log(`[threads-queue] Processed ${r.length} item(s)`); })
            .catch(err => console.error('[threads-queue] Publish failed:', err.message));
        }, threadsInterval * 60 * 1000).unref();
      }

      if (process.env.DISCORD_ENABLED === '1') {
        // Lazy import keeps discord.js out of the boot graph — a missing
        // package only matters when the bot is explicitly enabled.
        import('./services/discordBot.js')
          .then(({ startDiscordBot }) => startDiscordBot())
          .catch(err => console.error('[discord] Startup failed:', err.message));
      }

      // A3: background embedding job — embeds new oracle_reports every 15 min
      setInterval(() => {
        embedPendingPicks(20)
          .then(r => { if (r.embedded) console.log(`[embeddings] ${r.embedded} new picks embedded`); })
          .catch(err => console.warn(`[embeddings] background job failed: ${err.message}`));
      }, 15 * 60 * 1000).unref();

      // B7: job queue purge — weekly cleanup of done/failed jobs older than 7 days
      setInterval(() => {
        purgeOldJobs(7)
          .then(n => { if (n > 0) console.log(`[job-queue] purged ${n} old jobs`); })
          .catch(err => console.warn(`[job-queue] purge failed: ${err.message}`));
      }, 7 * 24 * 60 * 60 * 1000).unref();

      // Conviction tier sweep — the shadow run lands async after the pick is
      // saved, so picks.conviction_tier is backfilled from shadow_model_runs
      setInterval(() => {
        syncConvictionTiers({ days: 3 })
          .catch(err => console.warn(`[conviction] sweep failed: ${err.message}`));
      }, 30 * 60 * 1000).unref();

      if (process.env.TELEGRAM_ENABLED === '1') {
        const tgIntervalMinutes = Math.max(1, Number.parseInt(process.env.X_AUTO_PUBLISH_INTERVAL_MINUTES ?? '5', 10) || 5);
        console.log(`[telegram-queue] Scheduled Telegram autopublish enabled (${tgIntervalMinutes}m cadence)`);
        setInterval(() => {
          processScheduledTelegramQueue()
            .then((results) => {
              if (results.length > 0) {
                console.log(`[telegram-queue] Processed ${results.length} item(s)`);
              }
            })
            .catch((err) => {
              console.error('[telegram-queue] Scheduled publish failed:', err.message);
            });
        }, tgIntervalMinutes * 60 * 1000).unref();
      }
    });
  })
  .catch(err => {
    console.error('[H.E.X.A.] Startup failed:', err.message);
    process.exit(1);
  });
