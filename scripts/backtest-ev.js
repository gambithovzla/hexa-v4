/**
 * backtest-ev.js — ¿Hexa tiene edge real? Simulación de ROI sobre el histórico.
 *
 * Responde la pregunta de fondo: si hubieras apostado de verdad cada pick,
 * ¿ganabas dinero? Y más importante: ¿el CLV predice qué picks ganan dinero?
 *
 * Uso:
 *   node --env-file=.env scripts/backtest-ev.js [--sport=mlb] [--days=180]
 */

import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const SPORT = args.sport || 'mlb';
const DAYS = parseInt(args.days || '180', 10);

// American odds → net profit multiplier on a 1-unit win.
function payoutMultiplier(american) {
  const o = Number(american);
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? o / 100 : 100 / Math.abs(o);
}

// ¼-Kelly stake (units) given model edge over the implied price.
// modelProb is the win prob we believed; price is American odds.
function quarterKelly(modelProb, american) {
  const mult = payoutMultiplier(american);
  if (mult == null || modelProb == null) return 0;
  const b = mult;             // net odds
  const p = modelProb;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  if (kelly <= 0) return 0;
  return Math.min(kelly * 0.25, 0.02); // ¼-Kelly, cap 2% bankroll
}

// Settle one pick at flat 1u stake. Returns net units (win/loss/push).
function settleFlat(result, american) {
  const mult = payoutMultiplier(american);
  if (mult == null) return null;
  if (result === 'win') return mult;
  if (result === 'loss') return -1;
  if (result === 'push') return 0;
  return null;
}

function pct(n, d) { return d > 0 ? (100 * n / d) : 0; }
function fmtU(u) { return (u >= 0 ? '+' : '') + u.toFixed(2) + 'u'; }
function fmtPct(p) { return (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; }

try {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  HEXA — BACKTEST EV · ${SPORT.toUpperCase()} · últimos ${DAYS}d`);
  console.log('  ¿Apostar cada pick habría ganado dinero?');
  console.log('═══════════════════════════════════════════════════════════\n');

  const { rows: picks } = await pool.query(`
    SELECT
      p.id, p.market_type, p.result, p.odds_at_pick, p.clv,
      p.oracle_confidence, p.implied_prob_at_pick, p.created_at
    FROM picks p
    WHERE p.type = 'analysis'
      AND COALESCE(p.sport, 'mlb') = $1
      AND p.result IN ('win','loss','push')
      AND p.odds_at_pick IS NOT NULL
      AND p.created_at > NOW() - ($2 || ' days')::interval
  `, [SPORT, String(DAYS)]);

  if (!picks.length) {
    console.log('  Sin picks resueltos con odds_at_pick. Nada que simular.\n');
    await pool.end();
    process.exit(0);
  }

  // ── 1. ROI GLOBAL (flat 1u) ───────────────────────────────────────────────
  let totalUnits = 0, totalStaked = 0, wins = 0, losses = 0, pushes = 0, skipped = 0;
  for (const p of picks) {
    const net = settleFlat(p.result, p.odds_at_pick);
    if (net == null) { skipped++; continue; }
    totalUnits += net;
    totalStaked += 1;
    if (p.result === 'win') wins++;
    else if (p.result === 'loss') losses++;
    else pushes++;
  }
  console.log('── ROI GLOBAL (flat 1u por pick) ───────────────────────────');
  console.log(`  Picks: ${totalStaked} · W-L-P: ${wins}-${losses}-${pushes}`);
  console.log(`  Win rate: ${pct(wins, wins + losses).toFixed(1)}% (break-even depende del precio)`);
  console.log(`  Resultado: ${fmtU(totalUnits)} · ROI: ${fmtPct(pct(totalUnits, totalStaked))}`);
  console.log();

  // ── 2. ROI POR MERCADO ─────────────────────────────────────────────────────
  const byMarket = {};
  for (const p of picks) {
    const net = settleFlat(p.result, p.odds_at_pick);
    if (net == null) continue;
    const m = p.market_type || 'unknown';
    (byMarket[m] ??= { u: 0, n: 0, w: 0, l: 0 });
    byMarket[m].u += net; byMarket[m].n++;
    if (p.result === 'win') byMarket[m].w++;
    else if (p.result === 'loss') byMarket[m].l++;
  }
  console.log('── ROI POR MERCADO (flat 1u) ───────────────────────────────');
  console.log('Mercado        n     Win%    Unidades   ROI');
  Object.entries(byMarket).sort((a, b) => b[1].n - a[1].n).forEach(([m, s]) => {
    console.log(
      `${m.padEnd(14)} ${String(s.n).padStart(4)}  ${pct(s.w, s.w + s.l).toFixed(1).padStart(5)}%  ` +
      `${fmtU(s.u).padStart(9)}  ${fmtPct(pct(s.u, s.n)).padStart(7)}`
    );
  });
  console.log();

  // ── 3. LA PRUEBA CLAVE: ¿EL CLV PREDICE EL ROI? ────────────────────────────
  // Separa picks con CLV+ vs CLV- y compara su ROI. Si CLV es edge real,
  // los picks con CLV positivo deberían tener ROI marcadamente mejor.
  const clvBuckets = {
    'CLV positivo (>0)':   { u: 0, n: 0, w: 0, l: 0 },
    'CLV neutro/neg (<=0)':{ u: 0, n: 0, w: 0, l: 0 },
    'Sin CLV capturado':   { u: 0, n: 0, w: 0, l: 0 },
  };
  for (const p of picks) {
    const net = settleFlat(p.result, p.odds_at_pick);
    if (net == null) continue;
    const key = p.clv == null ? 'Sin CLV capturado'
      : (Number(p.clv) > 0 ? 'CLV positivo (>0)' : 'CLV neutro/neg (<=0)');
    clvBuckets[key].u += net; clvBuckets[key].n++;
    if (p.result === 'win') clvBuckets[key].w++;
    else if (p.result === 'loss') clvBuckets[key].l++;
  }
  console.log('── ⭐ PRUEBA CLAVE: ¿CLV predice ROI? ───────────────────────');
  console.log('Grupo                    n     Win%    Unidades   ROI');
  Object.entries(clvBuckets).forEach(([k, s]) => {
    if (s.n === 0) return;
    console.log(
      `${k.padEnd(24)} ${String(s.n).padStart(4)}  ${pct(s.w, s.w + s.l).toFixed(1).padStart(5)}%  ` +
      `${fmtU(s.u).padStart(9)}  ${fmtPct(pct(s.u, s.n)).padStart(7)}`
    );
  });
  console.log();

  // ── 4. ESTRATEGIA DE SELECTIVIDAD ──────────────────────────────────────────
  // "Apostar todo" vs "solo apostar picks con CLV > 0". Si la 2da gana más,
  // la selectividad por CLV es tu motor de decisión.
  const all = clvBuckets['CLV positivo (>0)'].u + clvBuckets['CLV neutro/neg (<=0)'].u + clvBuckets['Sin CLV capturado'].u;
  const allN = clvBuckets['CLV positivo (>0)'].n + clvBuckets['CLV neutro/neg (<=0)'].n + clvBuckets['Sin CLV capturado'].n;
  const onlyPosCLV = clvBuckets['CLV positivo (>0)'];
  console.log('── ESTRATEGIA: selectividad por CLV ────────────────────────');
  console.log(`  Apostar TODO:           ${fmtU(all)} en ${allN} picks · ROI ${fmtPct(pct(all, allN))}`);
  console.log(`  Solo CLV > 0:           ${fmtU(onlyPosCLV.u)} en ${onlyPosCLV.n} picks · ROI ${fmtPct(pct(onlyPosCLV.u, onlyPosCLV.n))}`);
  console.log();

  // ── 5. ¼-KELLY (usando confianza Oracle como prob del modelo) ──────────────
  let kellyUnits = 0, kellyStaked = 0, kellyBets = 0;
  for (const p of picks) {
    if (p.oracle_confidence == null) continue;
    const modelProb = Number(p.oracle_confidence) / 100;
    const stake = quarterKelly(modelProb, p.odds_at_pick);
    if (stake <= 0) continue;
    const mult = payoutMultiplier(p.odds_at_pick);
    kellyStaked += stake; kellyBets++;
    if (p.result === 'win') kellyUnits += stake * mult;
    else if (p.result === 'loss') kellyUnits -= stake;
  }
  console.log('── STAKING ¼-KELLY (conf Oracle como prob) ─────────────────');
  console.log(`  Apuestas con edge Kelly>0: ${kellyBets} de ${picks.length}`);
  console.log(`  Total arriesgado: ${kellyStaked.toFixed(2)}u · Resultado: ${fmtU(kellyUnits)} · ROI ${fmtPct(pct(kellyUnits, kellyStaked))}`);
  console.log();

  // ── VEREDICTO ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  VEREDICTO');
  console.log('═══════════════════════════════════════════════════════════');
  const roiAll = pct(all, allN);
  const roiPos = onlyPosCLV.n >= 10 ? pct(onlyPosCLV.u, onlyPosCLV.n) : null;
  if (roiAll > 2) console.log('  ✅ Apostar todo ya es rentable a flat stake. Edge global presente.');
  else if (roiAll > -2) console.log('  🟡 Apostar todo ≈ break-even. El edge (si existe) está en la selectividad.');
  else console.log('  ❌ Apostar todo pierde. Sin selectividad, el vig te come.');

  if (roiPos != null) {
    if (roiPos > roiAll + 3) {
      console.log(`  ⭐ CLV ES TU MOTOR: picks con CLV>0 rinden ${fmtPct(roiPos)} vs ${fmtPct(roiAll)} global.`);
      console.log('     → Apostar SOLO cuando el CLV proyectado es positivo es la estrategia.');
    } else {
      console.log(`  🟡 CLV>0 rinde ${fmtPct(roiPos)} vs ${fmtPct(roiAll)} global — señal débil, acumular más datos.`);
    }
  } else {
    console.log('  ⚠ Muy pocos picks con CLV>0 para validar la tesis. El fix de captura ayudará.');
  }
  console.log();

} catch (err) {
  console.error('Error:', err.message);
} finally {
  await pool.end();
}
