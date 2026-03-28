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
