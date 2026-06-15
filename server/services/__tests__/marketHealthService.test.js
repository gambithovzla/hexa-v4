import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyMarketHealth,
  buildMarketHealthBlock,
} from '../marketHealthService.js';

test('sustained negative CLV → degrade', () => {
  const r = classifyMarketHealth({ avgClv: -2.1, clvN: 44, observedWinRate: 50, winRateN: 44 });
  assert.equal(r.verdict, 'degrade');
  assert.match(r.reason, /CLV -2.1pts over 44/);
});

test('mild negative CLV → caution', () => {
  const r = classifyMarketHealth({ avgClv: -0.8, clvN: 30, observedWinRate: 51, winRateN: 30 });
  assert.equal(r.verdict, 'caution');
});

test('clearly positive CLV → healthy', () => {
  const r = classifyMarketHealth({ avgClv: 1.4, clvN: 60, observedWinRate: 54, winRateN: 60 });
  assert.equal(r.verdict, 'healthy');
});

test('terrible win rate escalates a healthy CLV down to degrade', () => {
  const r = classifyMarketHealth({ avgClv: 1.0, clvN: 40, observedWinRate: 41, winRateN: 40 });
  assert.equal(r.verdict, 'degrade');
});

test('weak win rate escalates healthy to caution', () => {
  const r = classifyMarketHealth({ avgClv: 0.9, clvN: 40, observedWinRate: 47, winRateN: 40 });
  assert.equal(r.verdict, 'caution');
});

test('insufficient sample → neutral', () => {
  const r = classifyMarketHealth({ avgClv: -3.0, clvN: 10, observedWinRate: 40, winRateN: 10 });
  assert.equal(r.verdict, 'neutral');
});

test('strong win rate alone (no CLV sample) → healthy', () => {
  const r = classifyMarketHealth({ avgClv: null, clvN: 0, observedWinRate: 58, winRateN: 30 });
  assert.equal(r.verdict, 'healthy');
});

test('block omits neutral markets and includes the ORACLE INSTRUCTION', () => {
  const block = buildMarketHealthBlock({
    overunder: { verdict: 'degrade', reason: 'avg CLV -2.1pts over 44' },
    moneyline: { verdict: 'healthy', reason: 'avg CLV +1.3pts over 60' },
    runline: { verdict: 'neutral', reason: 'insufficient sample' },
  });
  assert.match(block, /OVER\/UNDER: ⚠ DEGRADE/);
  assert.match(block, /MONEYLINE: ✓ HEALTHY/);
  assert.doesNotMatch(block, /RUN LINE/);
  assert.match(block, /ORACLE INSTRUCTION/);
  // degrade sorts before healthy (most severe first)
  assert.ok(block.indexOf('DEGRADE') < block.indexOf('HEALTHY'));
});

test('block is empty when nothing is actionable', () => {
  assert.equal(buildMarketHealthBlock({ moneyline: { verdict: 'neutral', reason: 'x' } }), '');
  assert.equal(buildMarketHealthBlock({}), '');
});
