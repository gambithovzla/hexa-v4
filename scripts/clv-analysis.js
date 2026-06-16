/**
 * CLV Analysis — ¿Están los picks de Hexa batiendo la línea de cierre?
 *
 * Uso:
 *   DATABASE_URL=postgresql://... node scripts/clv-analysis.js
 *   o con tu .env:
 *   node --env-file=.env scripts/clv-analysis.js
 */

import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function bar(value, max = 5, char = '█') {
  const filled = Math.round(Math.abs(value) / max * 10);
  const bar = char.repeat(Math.min(filled, 10));
  return value >= 0 ? `+${bar}` : `-${bar}`;
}

function clvLabel(v) {
  if (v == null) return '  —   ';
  const s = (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';
  return s.padStart(7);
}

try {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  HEXA — ANÁLISIS CLV (Closing Line Value)');
  console.log('  Pregunta: ¿nuestros picks compran valor antes del cierre?');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── 1. COBERTURA ────────────────────────────────────────────────────────────
  const { rows: cov } = await pool.query(`
    SELECT
      COALESCE(sport, 'mlb') AS sport,
      COUNT(*)                                                          AS total_picks,
      COUNT(*) FILTER (WHERE result IN ('win','loss','push'))           AS resolved,
      COUNT(*) FILTER (WHERE clv IS NOT NULL)                          AS with_clv,
      COUNT(*) FILTER (WHERE clv IS NOT NULL
                         AND result IN ('win','loss','push'))           AS resolved_clv
    FROM picks
    WHERE type = 'analysis'
      AND created_at > NOW() - INTERVAL '180 days'
    GROUP BY 1
    ORDER BY 1
  `);

  console.log('── COBERTURA (últimos 180d) ────────────────────────────────');
  console.log('Sport       Total  Resueltos  Con CLV  Res+CLV');
  cov.forEach(r => {
    const covPct = r.total_picks > 0
      ? ((r.with_clv / r.total_picks) * 100).toFixed(0) + '%'
      : '0%';
    console.log(
      `${String(r.sport).padEnd(10)}  ${String(r.total_picks).padStart(5)}  `+
      `${String(r.resolved).padStart(9)}  ${String(r.with_clv).padStart(7)} (${covPct})  `+
      `${String(r.resolved_clv).padStart(7)}`
    );
  });

  // ── 2. CLV PROMEDIO POR MERCADO ─────────────────────────────────────────────
  const { rows: byMarket } = await pool.query(`
    SELECT
      COALESCE(pf.market_type, p.market_type, 'unknown')  AS market,
      COUNT(*) FILTER (WHERE p.clv IS NOT NULL)            AS n_clv,
      ROUND(AVG(p.clv)::numeric, 2)                        AS avg_clv,
      ROUND(STDDEV(p.clv)::numeric, 2)                     AS std_clv,
      COUNT(*) FILTER (WHERE p.clv > 0)                    AS positive_clv,
      COUNT(*) FILTER (WHERE p.clv <= 0)                   AS negative_clv,
      ROUND(100.0 * SUM(CASE WHEN p.result = 'win' THEN 1 ELSE 0 END)
            / NULLIF(SUM(CASE WHEN p.result IN ('win','loss') THEN 1 ELSE 0 END), 0), 1) AS win_rate
    FROM picks p
    LEFT JOIN pick_features pf ON pf.pick_id = p.id
    WHERE p.type = 'analysis'
      AND COALESCE(p.sport, 'mlb') = 'mlb'
      AND p.created_at > NOW() - INTERVAL '180 days'
    GROUP BY 1
    HAVING COUNT(*) FILTER (WHERE p.clv IS NOT NULL) > 0
    ORDER BY n_clv DESC
  `);

  console.log('\n── CLV POR MERCADO (MLB 180d) ──────────────────────────────');
  console.log('Mercado        n_CLV  CLV_avg  Std  +CLV  -CLV  Win%  Bar');
  byMarket.forEach(r => {
    const b = bar(r.avg_clv ?? 0, 3);
    console.log(
      `${String(r.market).padEnd(14)} ${String(r.n_clv).padStart(6)} `+
      `${clvLabel(r.avg_clv)} ${String(r.std_clv ?? '—').padStart(5)} `+
      `${String(r.positive_clv).padStart(5)} ${String(r.negative_clv).padStart(5)} `+
      `${String(r.win_rate ?? '—').padStart(5)}%  ${b}`
    );
  });

  // ── 3. CLV x BUCKET DE CONFIANZA ────────────────────────────────────────────
  const { rows: byConf } = await pool.query(`
    SELECT
      CASE
        WHEN p.oracle_confidence >= 68 THEN '68-72'
        WHEN p.oracle_confidence >= 64 THEN '64-67'
        WHEN p.oracle_confidence >= 60 THEN '60-63'
        WHEN p.oracle_confidence >= 55 THEN '55-59'
        ELSE '50-54'
      END AS bucket,
      COUNT(*) FILTER (WHERE p.clv IS NOT NULL)    AS n_clv,
      ROUND(AVG(p.clv)::numeric, 2)                AS avg_clv,
      COUNT(*) FILTER (WHERE p.clv > 0)            AS pos,
      ROUND(100.0 * SUM(CASE WHEN p.result = 'win' THEN 1 ELSE 0 END)
            / NULLIF(SUM(CASE WHEN p.result IN ('win','loss') THEN 1 ELSE 0 END), 0), 1) AS win_rate,
      SUM(CASE WHEN p.result IN ('win','loss') THEN 1 ELSE 0 END) AS n_resolved
    FROM picks p
    WHERE p.type = 'analysis'
      AND COALESCE(p.sport, 'mlb') = 'mlb'
      AND p.oracle_confidence IS NOT NULL
      AND p.created_at > NOW() - INTERVAL '180 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `);

  console.log('\n── CLV x CONFIANZA (clave: ¿más confianza = más CLV?) ──────');
  console.log('Bucket  n_CLV  CLV_avg  +CLV  Win%   n_res  Bar');
  byConf.forEach(r => {
    const b = bar(r.avg_clv ?? 0, 3);
    console.log(
      `${String(r.bucket).padEnd(7)} ${String(r.n_clv).padStart(6)} `+
      `${clvLabel(r.avg_clv)}  ${String(r.pos).padStart(4)} `+
      `${String(r.win_rate ?? '—').padStart(5)}%  ${String(r.n_resolved).padStart(5)}  ${b}`
    );
  });

  // ── 4. TENDENCIA MENSUAL ─────────────────────────────────────────────────────
  const { rows: monthly } = await pool.query(`
    SELECT
      TO_CHAR(p.created_at, 'YYYY-MM') AS month,
      COUNT(*) FILTER (WHERE p.clv IS NOT NULL)   AS n_clv,
      ROUND(AVG(p.clv)::numeric, 2)               AS avg_clv,
      ROUND(100.0 * SUM(CASE WHEN p.result = 'win' THEN 1 ELSE 0 END)
            / NULLIF(SUM(CASE WHEN p.result IN ('win','loss') THEN 1 ELSE 0 END), 0), 1) AS win_rate
    FROM picks p
    WHERE p.type = 'analysis'
      AND COALESCE(p.sport, 'mlb') = 'mlb'
      AND p.created_at > NOW() - INTERVAL '180 days'
    GROUP BY 1
    ORDER BY 1
  `);

  console.log('\n── TENDENCIA MENSUAL ───────────────────────────────────────');
  console.log('Mes         n_CLV  CLV_avg  Win%   Bar');
  monthly.forEach(r => {
    const b = bar(r.avg_clv ?? 0, 3);
    console.log(
      `${r.month}   ${String(r.n_clv).padStart(6)} `+
      `${clvLabel(r.avg_clv)} ${String(r.win_rate ?? '—').padStart(5)}%   ${b}`
    );
  });

  // ── 5. VEREDICTO ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  VEREDICTO');
  console.log('═══════════════════════════════════════════════════════════');

  const overall = byMarket.filter(r => r.n_clv >= 5);
  if (overall.length === 0) {
    console.log('  ⚠ Muy pocos picks con CLV capturado para sacar conclusiones.');
    console.log('  El job de captura corre entre 17:00-00:59 ET antes del primer pitch.');
    console.log('  Necesitas al menos 20-30 picks con CLV por mercado para leer la señal.\n');
  } else {
    overall.forEach(r => {
      let verdict;
      if (r.avg_clv == null) {
        verdict = '⚠ Sin CLV suficiente';
      } else if (r.avg_clv > 1.5) {
        verdict = '✅ EDGE REAL — CLV positivo sólido';
      } else if (r.avg_clv > 0) {
        verdict = '🟡 POSITIVO pero leve — acumular más picks';
      } else if (r.avg_clv > -1) {
        verdict = '🟡 LEVEMENTE NEGATIVO — monitorear';
      } else {
        verdict = '❌ CLV NEGATIVO — el modelo sigue a la línea, no la anticipa';
      }
      console.log(`  ${String(r.market).padEnd(14)}: ${verdict} (CLV ${r.avg_clv > 0 ? '+' : ''}${r.avg_clv}%, n=${r.n_clv})`);
    });
    console.log();
    console.log('  Referencia: CLV > +1% sostenido = edge real. CLV ~ 0 = recapitula a Vegas.');
    console.log('  El break-even del vig está en ~+1.0% de CLV promedio.\n');
  }

} catch (err) {
  console.error('Error:', err.message);
} finally {
  await pool.end();
}
