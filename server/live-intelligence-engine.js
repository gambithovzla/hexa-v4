import { getBullpenUsage } from './mlb-api.js';
import { getRawLiveFeed } from './live-feed.js';
import { buildLiveNarrative } from './live-narrative.js';
import {
  getCachedBullpenUsage,
  getCachedLiveSnapshot,
  getLiveTimeline,
  storeLiveSnapshot,
} from './live-intelligence-store.js';
import { evaluateLiveSignals, formatLiveSignal } from './live-signal-rules.js';
import { normalizeLiveState } from './live-state-normalizer.js';

function isLiveFeed(rawFeed = {}) {
  const detailedState = String(rawFeed?.gameData?.status?.detailedState ?? '').trim();
  return ['In Progress', 'Manager Challenge', 'Review'].includes(detailedState);
}

function buildRelevantHash(state = {}) {
  return JSON.stringify({
    status: state.status,
    inning: state.inning,
    half: state.half,
    outs: state.outs,
    balls: state.balls,
    strikes: state.strikes,
    bases: state.bases,
    score: state.score,
    battingTeam: state.battingTeam,
    fieldingTeam: state.fieldingTeam,
    batterId: state.batter?.id ?? null,
    pitcherId: state.pitcher?.id ?? null,
    pitchCountCurrentPitcher: state.pitchCountCurrentPitcher,
    lastPlayId: state.lastPlays?.[0]?.id ?? null,
    lastPlayEvent: state.lastPlays?.[0]?.eventType ?? null,
  });
}

async function loadBullpenUsageBySide(rawFeed) {
  const homeTeamId = rawFeed?.gameData?.teams?.home?.id ?? null;
  const awayTeamId = rawFeed?.gameData?.teams?.away?.id ?? null;

  const [home, away] = await Promise.all([
    getCachedBullpenUsage(homeTeamId, () => getBullpenUsage(homeTeamId).catch(() => null)),
    getCachedBullpenUsage(awayTeamId, () => getBullpenUsage(awayTeamId).catch(() => null)),
  ]);

  return { home, away };
}

function buildHydratedPayload(snapshot, lang = 'en') {
  const signals = (snapshot?.coreSignals ?? []).map((signal) =>
    formatLiveSignal(signal, {
      state: snapshot.state,
      lang,
      generatedAt: snapshot.generatedAt,
    })
  );

  return {
    gamePk: snapshot.gamePk,
    generatedAt: snapshot.generatedAt,
    state: snapshot.state,
    signals,
    narrative: buildLiveNarrative({
      state: snapshot.state,
      signals: snapshot.coreSignals ?? [],
      lang,
    }),
  };
}

function hydrateTimelineEntry(entry, lang = 'en') {
  return {
    id: entry.id,
    gamePk: entry.gamePk,
    changeType: entry.changeType,
    generatedAt: entry.generatedAt,
    state: entry.state,
    signals: (entry.coreSignals ?? []).map((signal) =>
      formatLiveSignal(signal, {
        state: entry.state,
        lang,
        generatedAt: entry.generatedAt,
      })
    ),
    narrative: buildLiveNarrative({
      state: entry.state,
      signals: entry.coreSignals ?? [],
      lang,
    }),
  };
}

export function buildLiveIntelligenceSnapshot({ rawFeed, bullpenUsageBySide = {}, gamePk }) {
  const state = normalizeLiveState({ rawFeed, bullpenUsageBySide, gamePk });
  return {
    gamePk: state.gamePk,
    state,
    coreSignals: evaluateLiveSignals(state),
    relevantHash: buildRelevantHash(state),
    generatedAt: new Date().toISOString(),
  };
}

export async function getLiveIntelligence(gamePk, { lang = 'en' } = {}) {
  const cachedSnapshot = getCachedLiveSnapshot(gamePk);
  if (cachedSnapshot) {
    return buildHydratedPayload(cachedSnapshot, lang);
  }

  const rawFeed = await getRawLiveFeed(gamePk);
  const bullpenUsageBySide = isLiveFeed(rawFeed)
    ? await loadBullpenUsageBySide(rawFeed)
    : {};

  const snapshot = buildLiveIntelligenceSnapshot({
    rawFeed,
    bullpenUsageBySide,
    gamePk,
  });

  storeLiveSnapshot(gamePk, snapshot);
  return buildHydratedPayload(snapshot, lang);
}

export async function getLiveSignals(gamePk, { lang = 'en' } = {}) {
  const payload = await getLiveIntelligence(gamePk, { lang });
  return payload.signals;
}

export async function getLiveNarrativeForGame(gamePk, { lang = 'en' } = {}) {
  const payload = await getLiveIntelligence(gamePk, { lang });
  return payload.narrative;
}

export async function getLiveTimelineForGame(gamePk, { lang = 'en' } = {}) {
  await getLiveIntelligence(gamePk, { lang });
  return getLiveTimeline(gamePk).map((entry) => hydrateTimelineEntry(entry, lang));
}

export async function getBatchLiveIntelligence(gamePks = [], { lang = 'en' } = {}) {
  const uniqueGamePks = [...new Set((gamePks ?? []).map((gamePk) => Number(gamePk)).filter(Boolean))];
  const results = await Promise.allSettled(
    uniqueGamePks.map((gamePk) => getLiveIntelligence(gamePk, { lang }))
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      gamePk: uniqueGamePks[index],
      error: result.reason?.message ?? 'Failed to build live intelligence',
      signals: [],
      narrative: null,
      state: null,
    };
  });
}
