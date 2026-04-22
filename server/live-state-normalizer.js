const HIT_EVENT_TYPES = new Set(['single', 'double', 'triple', 'home_run']);
const WALK_EVENT_TYPES = new Set(['walk', 'intent_walk', 'hit_by_pitch']);

function toHalf(value) {
  const half = String(value ?? '').toLowerCase();
  if (half === 'top' || half === 'bottom') return half;
  return '';
}

function getBattingSide(half) {
  return half === 'top' ? 'away' : 'home';
}

function getFieldingSide(half) {
  return half === 'top' ? 'home' : 'away';
}

function getTeam(rawFeed, side) {
  const team = rawFeed?.gameData?.teams?.[side] ?? {};
  return {
    id: team?.id ?? null,
    name: team?.name ?? null,
    abbreviation: team?.abbreviation ?? null,
  };
}

function countOccupiedBases(bases = {}) {
  return ['first', 'second', 'third'].reduce((total, base) => total + (bases?.[base] ? 1 : 0), 0);
}

function hasRisp(bases = {}) {
  return !!(bases?.second || bases?.third);
}

function getPitchEvents(play) {
  return Array.isArray(play?.playEvents) ? play.playEvents.filter((event) => event?.isPitch) : [];
}

function isHardContactPlay(play) {
  return getPitchEvents(play).some((event) => Number(event?.hitData?.launchSpeed ?? 0) >= 95);
}

function isDeepCountPlay(play) {
  const pitchCount = getPitchEvents(play).length;
  return pitchCount >= 6 || Number(play?.count?.balls ?? 0) >= 3;
}

function isCompletedAtBat(play) {
  return play?.result?.type === 'atBat' && play?.about?.isComplete;
}

function sideForPlay(play) {
  return toHalf(play?.about?.halfInning) === 'top' ? 'away' : 'home';
}

function getBoxscorePlayer(rawFeed, side, playerId) {
  if (!playerId) return null;
  return rawFeed?.liveData?.boxscore?.teams?.[side]?.players?.[`ID${playerId}`] ?? null;
}

function getPitcherRole(rawFeed, side, pitcherId) {
  if (!pitcherId || !side) return 'unknown';
  const pitcherIds = rawFeed?.liveData?.boxscore?.teams?.[side]?.pitchers ?? [];
  const index = pitcherIds.findIndex((id) => Number(id) === Number(pitcherId));
  if (index === -1) return 'unknown';
  return index === 0 ? 'starter' : 'reliever';
}

function getPitchCount(rawFeed, side, pitcherId) {
  const player = getBoxscorePlayer(rawFeed, side, pitcherId);
  return Number(player?.stats?.pitching?.numberOfPitches ?? 0);
}

function buildRecentOffenseWindow(allPlays, battingSide) {
  const recentPlays = allPlays
    .filter(isCompletedAtBat)
    .filter((play) => sideForPlay(play) === battingSide)
    .slice(-5);

  return {
    plateAppearances: recentPlays.length,
    hits: recentPlays.filter((play) => HIT_EVENT_TYPES.has(String(play?.result?.eventType ?? ''))).length,
    walks: recentPlays.filter((play) => WALK_EVENT_TYPES.has(String(play?.result?.eventType ?? ''))).length,
    hardContactCount: recentPlays.filter(isHardContactPlay).length,
    deepCountCount: recentPlays.filter(isDeepCountPlay).length,
  };
}

function buildLastPlays(allPlays, teams) {
  return allPlays
    .filter(isCompletedAtBat)
    .slice(-6)
    .reverse()
    .map((play, index) => {
      const battingSide = sideForPlay(play);
      const battingTeam = teams?.[battingSide] ?? {};
      const pitchEvents = getPitchEvents(play);

      return {
        id: `${play?.about?.atBatIndex ?? index}`,
        inning: Number(play?.about?.inning ?? 0),
        half: toHalf(play?.about?.halfInning),
        event: play?.result?.event ?? 'Play',
        eventType: play?.result?.eventType ?? '',
        description: play?.result?.description ?? '',
        battingTeam: battingTeam.abbreviation ?? null,
        batter: {
          id: play?.matchup?.batter?.id ?? null,
          name: play?.matchup?.batter?.fullName ?? null,
        },
        pitcher: {
          id: play?.matchup?.pitcher?.id ?? null,
          name: play?.matchup?.pitcher?.fullName ?? null,
        },
        isScoring: !!play?.about?.isScoringPlay,
        hardContact: isHardContactPlay(play),
        pitchCount: pitchEvents.length,
      };
    });
}

function findCurrentPlayer(linescorePlayer, currentPlayPlayer) {
  return linescorePlayer ? {
    id: linescorePlayer.id ?? null,
    name: linescorePlayer.fullName ?? null,
  } : currentPlayPlayer ? {
    id: currentPlayPlayer.id ?? null,
    name: currentPlayPlayer.fullName ?? null,
  } : null;
}

export function normalizeLiveState({ rawFeed, bullpenUsageBySide = {}, gamePk }) {
  const gd = rawFeed?.gameData ?? {};
  const ld = rawFeed?.liveData ?? {};
  const linescore = ld?.linescore ?? {};
  const plays = ld?.plays ?? {};
  const currentPlay = plays?.currentPlay ?? null;
  const allPlays = Array.isArray(plays?.allPlays) ? plays.allPlays : [];

  const half = toHalf(linescore?.inningHalf || currentPlay?.about?.halfInning);
  const battingSide = getBattingSide(half || 'bottom');
  const fieldingSide = getFieldingSide(half || 'bottom');

  const teams = {
    home: getTeam(rawFeed, 'home'),
    away: getTeam(rawFeed, 'away'),
  };

  const bases = {
    first: !!linescore?.offense?.first,
    second: !!linescore?.offense?.second,
    third: !!linescore?.offense?.third,
  };

  const batter = findCurrentPlayer(
    linescore?.offense?.batter,
    currentPlay?.matchup?.batter,
  );
  const pitcher = findCurrentPlayer(
    linescore?.defense?.pitcher,
    currentPlay?.matchup?.pitcher,
  );

  const currentPitcherRole = getPitcherRole(rawFeed, fieldingSide, pitcher?.id);
  const pitchCountCurrentPitcher = getPitchCount(rawFeed, fieldingSide, pitcher?.id);
  const bullpenUsage = bullpenUsageBySide?.[fieldingSide] ?? null;
  const currentReliever = Array.isArray(bullpenUsage?.relievers)
    ? bullpenUsage.relievers.find((reliever) => Number(reliever.id) === Number(pitcher?.id))
    : null;

  return {
    gamePk: Number(gamePk ?? gd?.game?.pk ?? rawFeed?.gamePk ?? 0),
    status: gd?.status?.abstractGameState ?? gd?.status?.detailedState ?? 'Unknown',
    detailedState: gd?.status?.detailedState ?? 'Unknown',
    inning: Number(linescore?.currentInning ?? 0),
    half,
    outs: Number(linescore?.outs ?? 0),
    balls: Number(linescore?.balls ?? 0),
    strikes: Number(linescore?.strikes ?? 0),
    bases,
    score: {
      away: Number(linescore?.teams?.away?.runs ?? 0),
      home: Number(linescore?.teams?.home?.runs ?? 0),
    },
    teams,
    battingTeam: teams?.[battingSide]?.abbreviation ?? null,
    battingTeamName: teams?.[battingSide]?.name ?? null,
    battingTeamSide: battingSide,
    fieldingTeam: teams?.[fieldingSide]?.abbreviation ?? null,
    fieldingTeamName: teams?.[fieldingSide]?.name ?? null,
    fieldingTeamSide: fieldingSide,
    batter,
    pitcher,
    pitchCountCurrentPitcher,
    lastPlays: buildLastPlays(allPlays, teams),
    recentOffenseWindow: buildRecentOffenseWindow(allPlays, battingSide),
    bullpenContext: {
      currentPitcherRole,
      teamBullpenLoad3d: bullpenUsage?.bullpenIP_3d ?? null,
      bullpenPitchersUsed1d: Array.isArray(bullpenUsage?.relievers)
        ? bullpenUsage.relievers.filter((reliever) => (reliever?.appearances ?? []).length > 0).length
        : 0,
      backToBackReliever: !!currentReliever?.isBackToBack,
    },
    leverageContext: {
      scoreDiff: Math.abs(
        Number(linescore?.teams?.away?.runs ?? 0) - Number(linescore?.teams?.home?.runs ?? 0)
      ),
      occupiedBases: countOccupiedBases(bases),
      hasRisp: hasRisp(bases),
    },
  };
}
