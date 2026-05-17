/**
 * props-board-smoke.js — verifies /api/mlb/props/board responds (auth required).
 * Set SMOKE_TOKEN to a valid JWT or skip when unset.
 */
const API_URL = process.env.SMOKE_API_URL || process.env.API_URL || 'http://localhost:3001';
const TOKEN = process.env.SMOKE_TOKEN || process.env.HEXA_SMOKE_TOKEN;

async function main() {
  if (!TOKEN) {
    console.log('[smoke:props] SKIP — set SMOKE_TOKEN for authenticated board check');
    process.exit(0);
  }

  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const res = await fetch(`${API_URL}/api/mlb/props/board?date=${date}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[smoke:props] FAIL', res.status, body);
    process.exit(1);
  }
  if (!Array.isArray(body.games)) {
    console.error('[smoke:props] FAIL — games array missing');
    process.exit(1);
  }
  console.log(`[smoke:props] OK — ${body.games.length} game(s) with prop lines`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke:props] FAIL', err.message);
  process.exit(1);
});
