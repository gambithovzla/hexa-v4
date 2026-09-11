import { test } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../../db.js';
import { saveNflPickFeatures } from '../nflShadowPersistence.js';
import { serializeNflContext } from '../oracleNfl.js';

test('Oracle context favors the team allowing lower defensive EPA', () => {
  const text = serializeNflContext({ context: {
    home: { teamAbbr: 'KC', epaOff: 0.1, epaDef: -0.1 },
    away: { teamAbbr: 'BUF', epaOff: 0.1, epaDef: 0.1 },
  } });
  assert.match(text, /Net EPA .*KC edge 0\.200/);
});

test('feature persistence keeps missing EPA, odds, QB and injuries unknown', async t => {
  let params;
  t.mock.method(pool, 'query', async (_sql, values) => { params = values; return { rows: [{ id: 99 }] }; });
  const id = await saveNflPickFeatures({ pickId: 1, gamePk: 2, context: {
    home: { epaOff: null, injuries: { ok: false, severeCount: 0 } },
    away: { epaOff: 0, injuries: { ok: true, severeCount: 0 } },
  } });
  assert.equal(id, 99);
  assert.equal(params[7], null);
  assert.equal(params[8], 0);
  assert.equal(params[23], null);
  assert.equal(params[27], null);
  assert.equal(params[28], null);
  assert.equal(params[29], null);
  assert.equal(params[30], 0);
});
