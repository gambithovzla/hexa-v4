import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { handleNflGames } from '../../server/routes/nfl-schedule.js';

// Only mounts the read-only schedule route: no database, jobs, keys or LLM calls.
const app = express();
app.get('/api/nfl/games', handleNflGames);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const response = await fetch(`${base}/api/nfl/games`, { signal: AbortSignal.timeout(40_000) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(Array.isArray(body.data));
  assert.equal(new Set(body.data.map(g => g.game_id)).size, body.count);
  assert.ok([1, 2, 3].includes(Number(body.seasonType)));
  assert.ok(Number(body.week) >= 1 && Number(body.week) <= 18);
  for (const game of body.data) {
    assert.equal(Number(game.season), Number(body.season));
    assert.equal(Number(game.season_type), Number(body.seasonType));
    assert.equal(Number(game.week), Number(body.week));
    assert.ok(game.home_team_id && game.away_team_id);
    assert.ok(Number.isFinite(Date.parse(game.game_datetime)));
  }
  const invalid = await fetch(`${base}/api/nfl/games?week=0`);
  assert.equal(invalid.status, 400);
  console.log(JSON.stringify({ ok: true, season: body.season, seasonType: body.seasonType,
    week: body.week, count: body.count, meta: body.meta }, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
