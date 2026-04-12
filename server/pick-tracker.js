/**
 * pick-tracker.js — Live Pick Progress Tracker for H.E.X.A. V4
 *
 * Matches pending Oracle picks against live boxscore data to calculate
 * real-time progress on props and game bets.
 *
 * Supported pick types:
 *   - Pitcher K props: "Cole Over 5.5 K" → tracks strikeouts
 *   - Batter Hits: "Arraez Over 1.5 Hits" → tracks hits
 *   - Batter HR: "Judge HR" → tracks home runs
 *   - Batter Total Bases: "Soto Over 2.5 TB" → tracks total bases
 *   - Batter RBI: "Devers Over 1.5 RBI" → tracks RBIs
 *   - Over/Under: "Over 8.5" → tracks combined runs
 *   - Moneyline: "NYY ML" → tracks who's winning
 *   - Run Line: "NYY -1.5" → tracks run differential
 */

/**
 * Parse a pick string to determine what stat to track.
 *
 * @param {string} pickStr — e.g. "Over 8.5", "NYY -1.5 Run Line", "Cole Over 5.5 K"
 * @returns {object|null} — { type, direction, line, playerName, stat } or null
 */
export function parseLivePick(pickStr) {
  if (!pickStr) return null;
  const s = pickStr.trim();

  // Over/Under total: "Over 8.5", "Under 7.5", "Over 8.5 (-110)"
  let m = s.match(/^(Over|Under|O|U|Más\s+de|Menos\s+de)\s+(\d+\.?\d*)/i);
  if (m && !s.match(/hits|hr|home\s*run|k|strikeout|rbi|tb|total\s*base|sb|stolen/i)) {
    const dir = m[1].toLowerCase().startsWith('o') || m[1].toLowerCase().startsWith('m') ? 'over' : 'under';
    return { type: 'total', direction: dir, line: parseFloat(m[2]), playerName: null, stat: 'runs' };
  }

  // Moneyline: "NYY ML", "NYY Moneyline", "CHC ML (-217)", "Chicago Cubs ML"
  m = s.match(/^(.+?)\s+(?:ML|Moneyline|A\s+ganar|Dinero)/i);
  if (m) {
    return { type: 'moneyline', direction: null, line: null, playerName: null, stat: null, team: m[1].trim() };
  }

  // Run Line: "NYY -1.5 Run Line", "NYY -1.5 RL", "NYY -1.5", "BOS +1.5"
  m = s.match(/^(.+?)\s+([+-]?\d+\.?\d*)\s*(?:Run\s*Line|RL|Línea)?/i);
  if (m && (m[2].includes('+') || m[2].includes('-') || m[2].includes('1.5'))) {
    return { type: 'runline', direction: parseFloat(m[2]) < 0 ? 'favorite' : 'underdog', line: Math.abs(parseFloat(m[2])), playerName: null, stat: null, team: m[1].trim() };
  }

  // Player K props: "Cole Over 5.5 K", "Gerrit Cole O 6.5 Strikeouts"
  m = s.match(/^(.+?)\s+(Over|Under|O|U)\s+(\d+\.?\d*)\s*(?:K|Strikeout|Ponche)/i);
  if (m) {
    const dir = m[2].toLowerCase().startsWith('o') ? 'over' : 'under';
    return { type: 'player_prop', direction: dir, line: parseFloat(m[3]), playerName: m[1].trim(), stat: 'strikeOuts' };
  }

  // Player Hits: "Arraez Over 1.5 Hits", "Judge O 0.5 Hit"
  m = s.match(/^(.+?)\s+(Over|Under|O|U)\s+(\d+\.?\d*)\s*(?:Hit|Hits|Imparable)/i);
  if (m) {
    const dir = m[2].toLowerCase().startsWith('o') ? 'over' : 'under';
    return { type: 'player_prop', direction: dir, line: parseFloat(m[3]), playerName: m[1].trim(), stat: 'hits' };
  }

  // Player HR: "Judge HR", "Judge Over 0.5 HR", "Judge Home Run"
  m = s.match(/^(.+?)\s+(?:(Over|Under|O|U)\s+(\d+\.?\d*)\s*)?(?:HR|Home\s*Run|Jonrón)/i);
  if (m) {
    const dir = m[2] ? (m[2].toLowerCase().startsWith('o') ? 'over' : 'under') : 'over';
    const line = m[3] ? parseFloat(m[3]) : 0.5;
    return { type: 'player_prop', direction: dir, line, playerName: m[1].trim(), stat: 'homeRuns' };
  }

  // Player Total Bases: "Soto Over 2.5 TB", "Soto Over 1.5 Total Bases"
  m = s.match(/^(.+?)\s+(Over|Under|O|U)\s+(\d+\.?\d*)\s*(?:TB|Total\s*Base)/i);
  if (m) {
    const dir = m[2].toLowerCase().startsWith('o') ? 'over' : 'under';
    return { type: 'player_prop', direction: dir, line: parseFloat(m[3]), playerName: m[1].trim(), stat: 'totalBases' };
  }

  // Player RBI: "Devers Over 1.5 RBI"
  m = s.match(/^(.+?)\s+(Over|Under|O|U)\s+(\d+\.?\d*)\s*(?:RBI|Carreras?\s*Empujada)/i);
  if (m) {
    const dir = m[2].toLowerCase().startsWith('o') ? 'over' : 'under';
    return { type: 'player_prop', direction: dir, line: parseFloat(m[3]), playerName: m[1].trim(), stat: 'rbi' };
  }

  // Player SB: "Ohtani Over 0.5 SB"
  m = s.match(/^(.+?)\s+(Over|Under|O|U)\s+(\d+\.?\d*)\s*(?:SB|Stolen\s*Base|Base\s*Robada)/i);
  if (m) {
    const dir = m[2].toLowerCase().startsWith('o') ? 'over' : 'under';
    return { type: 'player_prop', direction: dir, line: parseFloat(m[3]), playerName: m[1].trim(), stat: 'stolenBases' };
  }

  return null;
}

/**
 * Match a player name from a pick to a player in the boxscore.
 * Tries last name match, then full name match.
 *
 * @param {string} pickName — e.g. "Cole", "Gerrit Cole"
 * @param {Array} players — array of { id, name, ... } from boxscore
 * @returns {object|null} — matched player object or null
 */
function findPlayer(pickName, players) {
  if (!pickName || !players?.length) return null;
  const q = pickName.toLowerCase().trim();

  // Exact full name match
  const exact = players.find(p => p.name?.toLowerCase() === q);
  if (exact) return exact;

  // Last name match
  const lastName = q.split(/\s+/).pop();
  const lastMatch = players.find(p => {
    const pLast = (p.name ?? '').toLowerCase().split(/\s+/).pop();
    return pLast === lastName;
  });
  if (lastMatch) return lastMatch;

  // Partial match (name contains the query or query contains part of name)
  return players.find(p => {
    const pName = (p.name ?? '').toLowerCase();
    return pName.includes(q) || q.includes(pName.split(/\s+/).pop());
  }) ?? null;
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getLastName(value) {
  const parts = normalizeName(value).split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function matchesTrackedPlayer(trackedPlayer, candidate) {
  if (!trackedPlayer || !candidate) return false;

  if (trackedPlayer.id != null && candidate.id != null) {
    return String(trackedPlayer.id) === String(candidate.id);
  }

  const trackedName = normalizeName(trackedPlayer.name);
  const candidateName = normalizeName(candidate.name);
  if (!trackedName || !candidateName) return false;
  if (trackedName === candidateName) return true;

  const trackedLast = getLastName(trackedName);
  const candidateLast = getLastName(candidateName);
  return Boolean(trackedLast) && trackedLast === candidateLast;
}

function resolveTrackedPlayer(parsedPick, liveData, playByPlayData) {
  if (!parsedPick?.playerName) return null;

  const allPitchers = [
    ...(liveData?.playerStats?.home?.pitchers ?? []),
    ...(liveData?.playerStats?.away?.pitchers ?? []),
  ];
  const allBatters = [
    ...(liveData?.playerStats?.home?.batters ?? []),
    ...(liveData?.playerStats?.away?.batters ?? []),
  ];

  const isPitcherProp = parsedPick.stat === 'strikeOuts';
  const primaryPool = isPitcherProp ? allPitchers : allBatters;
  const secondaryPool = isPitcherProp ? allBatters : allPitchers;
  const fromBoxscore = findPlayer(parsedPick.playerName, primaryPool) ?? findPlayer(parsedPick.playerName, secondaryPool);
  if (fromBoxscore) return fromBoxscore;

  const plays = Array.isArray(playByPlayData?.plays) ? playByPlayData.plays : [];
  const playPool = plays.flatMap((play) => {
    const player = isPitcherProp ? play?.pitcher : play?.batter;
    return player?.name ? [{ id: player.id ?? null, name: player.name }] : [];
  });

  return findPlayer(parsedPick.playerName, playPool);
}

function getPlayerPropEventIncrement(stat, play, trackedPlayer) {
  if (!play || !trackedPlayer) return 0;

  if (stat === 'strikeOuts') {
    if (!matchesTrackedPlayer(trackedPlayer, play.pitcher)) return 0;
    const strikeoutText = `${play.eventType ?? ''} ${play.event ?? ''}`.toLowerCase();
    return strikeoutText.includes('strikeout') ? 1 : 0;
  }

  if (!matchesTrackedPlayer(trackedPlayer, play.batter)) return 0;

  switch (stat) {
    case 'hits':
      return play.hasHit ? 1 : 0;
    case 'homeRuns':
      return play.eventType === 'home_run' ? 1 : 0;
    case 'totalBases': {
      const basesByEvent = {
        single: 1,
        double: 2,
        triple: 3,
        home_run: 4,
      };
      return basesByEvent[play.eventType] ?? 0;
    }
    case 'rbi':
      return Number(play.rbi ?? 0);
    default:
      return 0;
  }
}

function resolveStarterContext(plays, trackedPlayer, stat) {
  if (!Array.isArray(plays) || stat === 'strikeOuts') return null;

  const firstTrackedPlay = plays.find((play) => matchesTrackedPlayer(trackedPlayer, play?.batter));
  const battingTeamId = firstTrackedPlay?.batter?.teamId ?? null;
  if (!battingTeamId) return null;

  const starterPlay = plays.find((play) => String(play?.batter?.teamId ?? '') === String(battingTeamId) && play?.pitcher?.name);
  if (!starterPlay?.pitcher?.name) return null;

  return {
    id: starterPlay.pitcher.id ?? null,
    name: starterPlay.pitcher.name,
  };
}

function formatRelevantPlay(play, increment, cumulative, opposingStarter = null) {
  const pitcher = play?.pitcher?.name ? {
    id: play.pitcher.id ?? null,
    name: play.pitcher.name,
    role: opposingStarter
      ? (matchesTrackedPlayer(opposingStarter, play.pitcher) ? 'starter' : 'bullpen')
      : null,
  } : null;

  return {
    inning: play?.inning ?? null,
    halfInning: play?.halfInning ?? null,
    inningLabel: play?.inningLabel ?? null,
    event: play?.event ?? null,
    eventType: play?.eventType ?? null,
    description: play?.description ?? null,
    increment,
    cumulative,
    batter: play?.batter?.name ? {
      id: play.batter.id ?? null,
      name: play.batter.name,
    } : null,
    pitcher,
  };
}

export function buildPickOutcomeContext(parsedPick, liveData, playByPlayData) {
  if (parsedPick?.type !== 'player_prop' || !liveData || !Array.isArray(playByPlayData?.plays)) {
    return null;
  }

  const trackedPlayer = resolveTrackedPlayer(parsedPick, liveData, playByPlayData);
  if (!trackedPlayer) return null;

  const plays = playByPlayData.plays.filter((play) => play?.isComplete !== false);
  const opposingStarter = resolveStarterContext(plays, trackedPlayer, parsedPick.stat);
  const relevantEvents = [];
  let cumulative = 0;

  for (const play of plays) {
    const increment = getPlayerPropEventIncrement(parsedPick.stat, play, trackedPlayer);
    if (!increment) continue;
    cumulative += increment;
    relevantEvents.push(formatRelevantPlay(play, increment, cumulative, opposingStarter));
  }

  const thresholdValue = Math.floor(Number(parsedPick.line ?? 0)) + 1;
  const thresholdEvent = parsedPick.direction === 'over'
    ? (relevantEvents.find((event) => event.cumulative >= thresholdValue) ?? null)
    : null;
  const breakEvent = parsedPick.direction === 'under'
    ? (relevantEvents.find((event) => event.cumulative >= thresholdValue) ?? null)
    : null;

  const statLabelByKey = {
    strikeOuts: 'K',
    hits: 'H',
    homeRuns: 'HR',
    totalBases: 'TB',
    rbi: 'RBI',
    stolenBases: 'SB',
  };

  const finalValue = Number(
    trackedPlayer?.[parsedPick.stat] ??
    relevantEvents[relevantEvents.length - 1]?.cumulative ??
    0
  );

  return {
    type: parsedPick.type,
    stat: parsedPick.stat,
    statLabel: statLabelByKey[parsedPick.stat] ?? parsedPick.stat,
    direction: parsedPick.direction,
    line: parsedPick.line,
    thresholdValue,
    finalValue,
    player: {
      id: trackedPlayer.id ?? null,
      name: trackedPlayer.name ?? parsedPick.playerName,
    },
    opposingStarter,
    thresholdEvent,
    breakEvent,
    relevantEvents,
    analysisHint: thresholdEvent
      ? 'Use thresholdEvent as the first play that satisfied the prop. Do not describe a later relevant play as the fulfillment moment.'
      : breakEvent
        ? 'Use breakEvent as the first play that invalidated the prop. Do not describe a later relevant play as the failure trigger.'
        : 'Use relevantEvents for event sequencing. Do not infer fulfillment timing from recentPlays alone.',
  };
}

/**
 * Calculate live progress for a single pick against live game data.
 *
 * @param {object} parsedPick — from parseLivePick()
 * @param {object} liveData — from getLiveGameData()
 * @returns {object} — { current, target, progress, status, label, details }
 */
export function calculatePickProgress(parsedPick, liveData) {
  if (!parsedPick || !liveData) {
    return { current: null, target: null, progress: 0, status: 'no_data', label: 'No data', details: null };
  }

  const isLive = liveData.status === 'live';
  const isFinal = liveData.status === 'final';
  const homeScore = liveData.home?.score ?? 0;
  const awayScore = liveData.away?.score ?? 0;

  const allPitchers = [
    ...(liveData.playerStats?.home?.pitchers ?? []),
    ...(liveData.playerStats?.away?.pitchers ?? []),
  ];
  const allBatters = [
    ...(liveData.playerStats?.home?.batters ?? []),
    ...(liveData.playerStats?.away?.batters ?? []),
  ];

  switch (parsedPick.type) {
    case 'total': {
      const totalRuns = homeScore + awayScore;
      const target = parsedPick.line;
      const progress = Math.min(100, Math.round((totalRuns / target) * 100));
      const won = parsedPick.direction === 'over' ? totalRuns > target : totalRuns < target;
      const lost = parsedPick.direction === 'over' ? (isFinal && totalRuns <= target) : (isFinal && totalRuns >= target);
      const push = isFinal && totalRuns === target;

      return {
        current: totalRuns,
        target,
        progress,
        status: push ? 'push' : won && isFinal ? 'won' : lost ? 'lost' : isLive ? 'in_progress' : 'pending',
        label: `${parsedPick.direction === 'over' ? 'Over' : 'Under'} ${target}`,
        details: `${homeScore} + ${awayScore} = ${totalRuns} runs`,
      };
    }

    case 'moneyline': {
      const teamQ = (parsedPick.team ?? '').toLowerCase();
      const isHome = liveData.home.abbreviation?.toLowerCase() === teamQ ||
                     liveData.home.name?.toLowerCase().includes(teamQ);
      const myScore = isHome ? homeScore : awayScore;
      const oppScore = isHome ? awayScore : homeScore;
      const winning = myScore > oppScore;
      const tied = myScore === oppScore;

      return {
        current: myScore,
        target: oppScore,
        progress: winning ? 100 : tied ? 50 : Math.round((myScore / Math.max(oppScore, 1)) * 50),
        status: isFinal ? (winning ? 'won' : tied ? 'push' : 'lost') : isLive ? (winning ? 'winning' : tied ? 'tied' : 'losing') : 'pending',
        label: `${parsedPick.team} ML`,
        details: `${liveData.away.abbreviation} ${awayScore} — ${liveData.home.abbreviation} ${homeScore}`,
      };
    }

    case 'runline': {
      const teamQ = (parsedPick.team ?? '').toLowerCase();
      const isHome = liveData.home.abbreviation?.toLowerCase() === teamQ ||
                     liveData.home.name?.toLowerCase().includes(teamQ);
      const myScore = isHome ? homeScore : awayScore;
      const oppScore = isHome ? awayScore : homeScore;
      const diff = myScore - oppScore;
      const spread = parsedPick.direction === 'favorite' ? -parsedPick.line : parsedPick.line;
      const covering = diff + spread > 0;

      return {
        current: diff,
        target: spread,
        progress: covering ? 75 : 25,
        status: isFinal ? (diff + spread > 0 ? 'won' : diff + spread === 0 ? 'push' : 'lost') : isLive ? (covering ? 'covering' : 'not_covering') : 'pending',
        label: `${parsedPick.team} ${spread > 0 ? '+' : ''}${spread}`,
        details: `Diff: ${diff > 0 ? '+' : ''}${diff} (need ${spread > 0 ? '+' : ''}${spread > 0 ? '>' : '<'} ${Math.abs(spread)})`,
      };
    }

    case 'player_prop': {
      const stat = parsedPick.stat;
      const isKProp = stat === 'strikeOuts' && !parsedPick.playerName?.match(/\b(over|under|hit|hr)\b/i);

      // For K props, search pitchers; for everything else, search batters
      const searchPool = (stat === 'strikeOuts' && isKProp) ? allPitchers : allBatters;
      const player = findPlayer(parsedPick.playerName, searchPool);

      // If not found in primary pool, try the other pool
      const finalPlayer = player ?? findPlayer(parsedPick.playerName,
        searchPool === allPitchers ? allBatters : allPitchers
      );

      if (!finalPlayer) {
        return {
          current: 0,
          target: parsedPick.line,
          progress: 0,
          status: isLive || isFinal ? 'player_not_found' : 'pending',
          label: `${parsedPick.playerName} ${parsedPick.direction} ${parsedPick.line} ${stat}`,
          details: `Player not found in boxscore`,
        };
      }

      const current = finalPlayer[stat] ?? 0;
      const target = parsedPick.line;
      const progress = Math.min(100, Math.round((current / target) * 100));
      const won = parsedPick.direction === 'over' ? current > target : current < target;
      const lost = parsedPick.direction === 'over' ? (isFinal && current <= target) : (isFinal && current >= target);
      const push = isFinal && current === target;

      const statLabels = {
        strikeOuts: 'K',
        hits: 'H',
        homeRuns: 'HR',
        totalBases: 'TB',
        rbi: 'RBI',
        stolenBases: 'SB',
      };

      return {
        current,
        target,
        progress,
        status: push ? 'push' : won && isFinal ? 'won' : lost ? 'lost' : isLive ? (won ? 'hitting' : 'in_progress') : 'pending',
        label: `${finalPlayer.name} ${parsedPick.direction} ${target} ${statLabels[stat] ?? stat}`,
        details: `${finalPlayer.name}: ${current} ${statLabels[stat] ?? stat}${isLive ? ' (live)' : isFinal ? ' (final)' : ''}`,
        player: { id: finalPlayer.id, name: finalPlayer.name },
      };
    }

    default:
      return { current: null, target: null, progress: 0, status: 'unknown', label: 'Unknown pick type', details: null };
  }
}
