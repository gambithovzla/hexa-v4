import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToImpliedProb,
  americanToNetPayout,
  normalizeProb,
  isFullAgreementTier,
  kellyStakeUnits,
  evaluateGates,
  DEFAULT_THRESHOLDS,
} from '../betCardService.js';

test('americanToImpliedProb handles favorites, dogs and garbage', () => {
  assert.ok(Math.abs(americanToImpliedProb(-130) - 130 / 230) < 1e-9);
  assert.ok(Math.abs(americanToImpliedProb(120) - 100 / 220) < 1e-9);
  assert.equal(americanToImpliedProb(0), null);
  assert.equal(americanToImpliedProb(null), null);
  assert.equal(americanToImpliedProb('nope'), null);
});

test('americanToNetPayout converts both signs', () => {
  assert.ok(Math.abs(americanToNetPayout(-200) - 0.5) < 1e-9);
  assert.ok(Math.abs(americanToNetPayout(150) - 1.5) < 1e-9);
  assert.equal(americanToNetPayout(undefined), null);
});

test('normalizeProb accepts 0-1 and 0-100 scales', () => {
  assert.equal(normalizeProb(0.62), 0.62);
  assert.equal(normalizeProb(62), 0.62);
  assert.equal(normalizeProb('0.5500'), 0.55);
  assert.equal(normalizeProb(null), null);
  assert.equal(normalizeProb(-5), null);
});

test('isFullAgreementTier only accepts full-agreement tiers', () => {
  assert.equal(isFullAgreementTier('3/3'), true);
  assert.equal(isFullAgreementTier('2/2'), true);
  assert.equal(isFullAgreementTier('2/3'), false);
  assert.equal(isFullAgreementTier('1/2'), false);
  assert.equal(isFullAgreementTier(null), false);
  assert.equal(isFullAgreementTier('1/1'), false);
});

test('kellyStakeUnits sizes a positive-EV bet and caps it', () => {
  const units = kellyStakeUnits({ modelProb: 0.62, oddsAtPick: -110 });
  // kelly = (0.909*0.62 - 0.38)/0.909 ≈ 0.2019 → quarter ≈ 5.05u → capped at 2
  assert.equal(units, DEFAULT_THRESHOLDS.maxStakeUnits);

  const small = kellyStakeUnits({ modelProb: 0.55, oddsAtPick: -110 });
  assert.ok(small > 0 && small < DEFAULT_THRESHOLDS.maxStakeUnits);
});

test('kellyStakeUnits returns 0 for negative-EV and null without inputs', () => {
  assert.equal(kellyStakeUnits({ modelProb: 0.5, oddsAtPick: -130 }), 0);
  assert.equal(kellyStakeUnits({ modelProb: null, oddsAtPick: -130 }), null);
  assert.equal(kellyStakeUnits({ modelProb: 0.6, oddsAtPick: null }), null);
});

const healthyClvTable = { 'mlb:moneyline': { avgClv: 1.2, n: 120 } };

function goodCandidate(overrides = {}) {
  return {
    modelProb: 0.62,
    modelSource: 'python',
    oddsAtPick: -110,
    convictionTier: '3/3',
    calibratedConfidence: 58,
    sport: 'mlb',
    marketType: 'moneyline',
    ...overrides,
  };
}

test('evaluateGates passes a fully certified candidate and sizes the stake', () => {
  const v = evaluateGates(goodCandidate(), { clvTable: healthyClvTable });
  assert.equal(v.passed, true);
  assert.ok(v.edge > 0.03);
  assert.ok(v.stakeUnits > 0);
  assert.equal(v.gates.filter((g) => g.status === 'fail').length, 0);
});

test('evaluateGates fails without a model probability', () => {
  const v = evaluateGates(goodCandidate({ modelProb: null }), { clvTable: healthyClvTable });
  assert.equal(v.passed, false);
  assert.ok(v.gates.some((g) => g.key === 'model_certified' && g.status === 'fail'));
  assert.equal(v.stakeUnits, null);
});

test('evaluateGates fails below the edge floor', () => {
  // implied at -110 ≈ 52.4%; model 54% → edge ≈ 1.6% < 3%
  const v = evaluateGates(goodCandidate({ modelProb: 0.54 }), { clvTable: healthyClvTable });
  assert.equal(v.passed, false);
  assert.ok(v.gates.some((g) => g.key === 'edge' && g.status === 'fail'));
});

test('evaluateGates fails on partial or missing conviction', () => {
  const partial = evaluateGates(goodCandidate({ convictionTier: '2/3' }), { clvTable: healthyClvTable });
  assert.equal(partial.passed, false);
  const missing = evaluateGates(goodCandidate({ convictionTier: null }), { clvTable: healthyClvTable });
  assert.equal(missing.passed, false);
});

test('evaluateGates fails when the market bleeds CLV, neutral when sample is thin', () => {
  const bleeding = evaluateGates(goodCandidate(), {
    clvTable: { 'mlb:moneyline': { avgClv: -1.8, n: 200 } },
  });
  assert.equal(bleeding.passed, false);
  assert.ok(bleeding.gates.some((g) => g.key === 'market_clv' && g.status === 'fail'));

  const thin = evaluateGates(goodCandidate(), {
    clvTable: { 'mlb:moneyline': { avgClv: -1.8, n: 5 } },
  });
  assert.ok(thin.gates.some((g) => g.key === 'market_clv' && g.status === 'neutral'));
  assert.equal(thin.passed, true);
});

test('evaluateGates fails below the calibration floor, neutral when absent', () => {
  const low = evaluateGates(goodCandidate({ calibratedConfidence: 48 }), { clvTable: healthyClvTable });
  assert.equal(low.passed, false);
  assert.ok(low.gates.some((g) => g.key === 'calibration' && g.status === 'fail'));

  const absent = evaluateGates(goodCandidate({ calibratedConfidence: null }), { clvTable: healthyClvTable });
  assert.ok(absent.gates.some((g) => g.key === 'calibration' && g.status === 'neutral'));
  assert.equal(absent.passed, true);
});

test('evaluateGates accepts 0-100 scale model probs (legacy validator)', () => {
  const v = evaluateGates(goodCandidate({ modelProb: 62, modelSource: 'legacy' }), {
    clvTable: healthyClvTable,
  });
  assert.equal(v.passed, true);
  assert.ok(Math.abs(v.modelProb - 0.62) < 1e-9);
});
