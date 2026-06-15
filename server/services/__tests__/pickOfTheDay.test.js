import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  impliedProbFromAmerican,
  decimalFromAmerican,
  isOddsInWindow,
  evaluatePickOfTheDayCandidate,
  selectPickOfTheDay,
  DEFAULT_POTD_CONFIG,
} from '../pickOfTheDay.js';

// Build a scored candidate of the shape imperdibleEngine produces.
function cand({ pick = 'NYY ML', odds, modelProb, consensusProb = null, dataQuality = 80, lineupConfirmed = true, variancePenalty = 0, marketType = 'moneyline', sport = 'mlb' }) {
  return {
    pick, odds, marketType, sport, lineupConfirmed, variancePenalty,
    conviction: 75,
    consensusProb: consensusProb ?? modelProb,
    components: { modelProb, impliedProb: impliedProbFromAmerican(odds), dataQuality },
  };
}

test('impliedProbFromAmerican core values', () => {
  assert.equal(impliedProbFromAmerican(-150), 60);
  assert.equal(impliedProbFromAmerican(100), 50);
  assert.equal(impliedProbFromAmerican(120), 45.45);
  assert.equal(impliedProbFromAmerican(-200), 66.67);
});

test('decimalFromAmerican payouts', () => {
  assert.ok(Math.abs(decimalFromAmerican(-150) - 1.6667) < 1e-3);
  assert.ok(Math.abs(decimalFromAmerican(120) - 2.2) < 1e-9);
});

test('isOddsInWindow respects floor (-150) and ceiling (+120)', () => {
  assert.equal(isOddsInWindow(-150), true);   // floor boundary
  assert.equal(isOddsInWindow(-110), true);
  assert.equal(isOddsInWindow(100), true);
  assert.equal(isOddsInWindow(120), true);     // ceiling boundary
  assert.equal(isOddsInWindow(-200), false);   // heavier favourite — pays too little
  assert.equal(isOddsInWindow(150), false);    // longer dog — too risky
});

test('anti-vig gate: model must beat break-even by the margin', () => {
  // -150 → 60% break-even, margin 3 → needs >= 63%.
  const ok = evaluatePickOfTheDayCandidate(cand({ odds: -150, modelProb: 64 }));
  assert.equal(ok.eligible, true);
  assert.equal(ok.edgeOverBreakeven, 4);

  const tooThin = evaluatePickOfTheDayCandidate(cand({ odds: -150, modelProb: 61 }));
  assert.equal(tooThin.eligible, false);
  assert.ok(tooThin.reasons.includes('no_edge_over_breakeven'));
});

test('rejects odds outside the payout window', () => {
  const tooShort = evaluatePickOfTheDayCandidate(cand({ odds: -250, modelProb: 80 }));
  assert.ok(tooShort.reasons.includes('odds_too_short'));

  const tooLong = evaluatePickOfTheDayCandidate(cand({ odds: 175, modelProb: 70 }));
  assert.ok(tooLong.reasons.includes('odds_too_long'));
});

test('rejects low model prob, low data quality, unconfirmed lineup', () => {
  assert.ok(evaluatePickOfTheDayCandidate(cand({ odds: -130, modelProb: 58 })).reasons.includes('model_prob_below_min'));
  assert.ok(evaluatePickOfTheDayCandidate(cand({ odds: -130, modelProb: 70, dataQuality: 40 })).reasons.includes('data_quality_below_min'));
  assert.ok(evaluatePickOfTheDayCandidate(cand({ odds: -130, modelProb: 70, lineupConfirmed: false })).reasons.includes('lineup_not_confirmed'));
});

test('selectPickOfTheDay returns the highest win-probability eligible pick', () => {
  const list = [
    cand({ pick: 'A ML', odds: -150, modelProb: 64, consensusProb: 64 }),
    cand({ pick: 'B Over 8.5', odds: -120, modelProb: 67, consensusProb: 68, marketType: 'overunder' }),
    cand({ pick: 'C ML', odds: -200, modelProb: 90 }),  // out of window
  ];
  const out = selectPickOfTheDay(list);
  assert.equal(out.status, 'PICK');
  assert.equal(out.pick.pick, 'B Over 8.5');   // highest win prob among eligible
  assert.equal(out.eligibleCount, 2);
});

test('selectPickOfTheDay tiebreaks equal win prob by payout', () => {
  const list = [
    cand({ pick: 'fav', odds: -140, modelProb: 65, consensusProb: 66 }),
    cand({ pick: 'dog', odds: 110, modelProb: 65, consensusProb: 66 }),  // same win prob, pays more
  ];
  const out = selectPickOfTheDay(list);
  assert.equal(out.pick.pick, 'dog');
});

test('selectPickOfTheDay PASSes honestly when nothing clears the gate', () => {
  const list = [
    cand({ odds: -250, modelProb: 88 }),         // too short
    cand({ odds: -150, modelProb: 61 }),         // no edge over break-even
    cand({ odds: 200, modelProb: 70 }),          // too long
  ];
  const out = selectPickOfTheDay(list);
  assert.equal(out.status, 'PASS');
  assert.equal(out.pick, null);
  assert.equal(out.reason, 'no_candidate_clears_gate');
  assert.equal(out.rejected.length, 3);
});

test('config overrides widen the window', () => {
  const c = cand({ odds: 150, modelProb: 45 });
  assert.equal(isOddsInWindow(150), false);
  assert.equal(isOddsInWindow(150, { ...DEFAULT_POTD_CONFIG, oddsCeilingAmerican: 200 }), true);
});
