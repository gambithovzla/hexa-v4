const SNAPSHOT_TTL_MS = 25_000;
const BULLPEN_TTL_MS = 10 * 60 * 1000;
const TIMELINE_LIMIT = 40;

const gameStore = new Map();
const bullpenStore = new Map();

function summarizeState(state = {}) {
  return {
    inning: state.inning ?? null,
    half: state.half ?? null,
    outs: state.outs ?? null,
    bases: state.bases ?? { first: false, second: false, third: false },
    score: state.score ?? { away: 0, home: 0 },
    battingTeam: state.battingTeam ?? null,
    fieldingTeam: state.fieldingTeam ?? null,
  };
}

function signalSignature(coreSignals = []) {
  return coreSignals
    .map((signal) => [
      signal.type,
      signal.level,
      signal.team,
      signal.impact,
    ].join(':'))
    .sort()
    .join('|');
}

export function getCachedLiveSnapshot(gamePk) {
  const entry = gameStore.get(String(gamePk));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry.snapshot;
}

export function storeLiveSnapshot(gamePk, snapshot) {
  const key = String(gamePk);
  const now = Date.now();
  const previousEntry = gameStore.get(key);
  const previousSnapshot = previousEntry?.snapshot ?? null;
  const previousTimeline = Array.isArray(previousEntry?.timeline) ? previousEntry.timeline : [];

  const previousSignature = signalSignature(previousSnapshot?.coreSignals ?? []);
  const nextSignature = signalSignature(snapshot?.coreSignals ?? []);
  const previousHash = previousSnapshot?.relevantHash ?? null;
  const nextHash = snapshot?.relevantHash ?? null;

  let changeType = null;
  if (!previousSnapshot && snapshot?.coreSignals?.length) {
    changeType = 'signals_opened';
  } else if (previousSignature !== nextSignature) {
    changeType = snapshot?.coreSignals?.length ? 'signals_updated' : 'signals_cleared';
  } else if (previousHash !== nextHash && snapshot?.coreSignals?.length) {
    changeType = 'state_shift';
  }

  const timeline = [...previousTimeline];
  if (changeType) {
    timeline.push({
      id: `${key}-${snapshot.generatedAt}-${timeline.length + 1}`,
      gamePk: Number(gamePk),
      generatedAt: snapshot.generatedAt,
      changeType,
      state: summarizeState(snapshot.state),
      coreSignals: snapshot.coreSignals ?? [],
    });
  }

  gameStore.set(key, {
    snapshot,
    expiresAt: now + SNAPSHOT_TTL_MS,
    timeline: timeline.slice(-TIMELINE_LIMIT),
  });

  return snapshot;
}

export function getLiveTimeline(gamePk) {
  return gameStore.get(String(gamePk))?.timeline ?? [];
}

export async function getCachedBullpenUsage(teamId, loader) {
  if (!teamId) return null;

  const key = String(teamId);
  const cached = bullpenStore.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await loader();
  bullpenStore.set(key, {
    value,
    expiresAt: Date.now() + BULLPEN_TTL_MS,
  });
  return value;
}

export function clearLiveIntelligenceStore() {
  gameStore.clear();
  bullpenStore.clear();
}
