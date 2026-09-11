import { getNflWeekSchedule } from '../nfl-api.js';

export async function handleNflGames(req, res) {
  const season = req.query.season != null ? Number(req.query.season) : null;
  const seasonType = req.query.seasonType != null ? Number(req.query.seasonType) : null;
  const week = req.query.week != null ? Number(req.query.week) : null;
  if (season != null && !/^\d{4}$/.test(String(season))) {
    return res.status(400).json({ success: false, error: 'season must be a 4-digit year' });
  }
  if (seasonType != null && ![1, 2, 3].includes(seasonType)) {
    return res.status(400).json({ success: false, error: 'seasonType must be 1 (pre), 2 (regular) or 3 (post)' });
  }
  if (week != null && (!Number.isInteger(week) || week < 1 || week > 18)) {
    return res.status(400).json({ success: false, error: 'week must be an integer between 1 and 18' });
  }
  res.set('Cache-Control', 'no-store');
  try {
    const { games, ...schedule } = await getNflWeekSchedule({ season, seasonType, week });
    return res.json({ success: true, ...schedule, count: games.length, data: games });
  } catch (err) {
    console.warn(`[nfl-schedule] unavailable: ${err.message}`);
    res.set('Retry-After', '30');
    return res.status(503).json({
      success: false,
      code: 'NFL_SCHEDULE_UNAVAILABLE',
      error: 'NFL schedule temporarily unavailable. Please retry.',
    });
  }
}
