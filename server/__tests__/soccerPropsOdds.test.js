/**
 * Tests for soccer props odds normalizer and enricher (Sprint 11.5).
 * Both are pure functions — no network needed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSoccerPropEvent } from '../soccer-props-odds.js';
import { enrichSoccerPropOffers } from '../services/soccerPropFeatureEnricher.js';

// ── normalizeSoccerPropEvent ──────────────────────────────────────────────────

/** Build a minimal Odds API event payload for soccer props. */
function makeEvent(markets) {
  return {
    bookmakers: [
      { key: 'bet365', markets },
    ],
  };
}

function makeOUMarket(key, player, overOdds, underOdds, point) {
  return {
    key,
    outcomes: [
      { name: 'Over',  description: player, point, price: overOdds },
      { name: 'Under', description: player, point, price: underOdds },
    ],
  };
}

function makeYesMarket(key, players) {
  return {
    key,
    outcomes: players.map((name) => ({ name, price: -130 })),
  };
}

describe('normalizeSoccerPropEvent', () => {
  test('returns [] for null/missing bookmakers', () => {
    assert.deepEqual(normalizeSoccerPropEvent(null), []);
    assert.deepEqual(normalizeSoccerPropEvent({}), []);
    assert.deepEqual(normalizeSoccerPropEvent({ bookmakers: [] }), []);
  });

  test('parses shots_on_target over/under', () => {
    const event = makeEvent([makeOUMarket('player_shots_on_target', 'Salah', -115, -105, 1.5)]);
    const offers = normalizeSoccerPropEvent(event);
    assert.equal(offers.length, 2);
    const over = offers.find(o => o.side === 'over');
    assert.ok(over, 'should have over side');
    assert.equal(over.propKind, 'shots_on_target');
    assert.equal(over.playerName, 'Salah');
    assert.equal(over.line, 1.5);
    assert.equal(over.oddsAmerican, -115);
  });

  test('parses anytime_goal as yes-market (side=over, line=0.5)', () => {
    const event = makeEvent([makeYesMarket('player_goal_scorer_anytime', ['Haaland', 'Kane'])]);
    const offers = normalizeSoccerPropEvent(event);
    assert.equal(offers.length, 2);
    for (const o of offers) {
      assert.equal(o.propKind, 'anytime_goal');
      assert.equal(o.side, 'over');
      assert.equal(o.line, 0.5);
    }
  });

  test('parses card yes-market', () => {
    const event = makeEvent([makeYesMarket('player_to_receive_a_card', ['Casemiro'])]);
    const offers = normalizeSoccerPropEvent(event);
    assert.equal(offers.length, 1);
    assert.equal(offers[0].propKind, 'card');
    assert.equal(offers[0].side, 'over');
    assert.equal(offers[0].line, 0.5);
  });

  test('skips unknown market keys', () => {
    const event = makeEvent([makeOUMarket('player_assists', 'Trent', -110, -110, 0.5)]);
    const offers = normalizeSoccerPropEvent(event);
    assert.equal(offers.length, 0, 'player_assists not in MARKET_KIND_MAP');
  });

  test('consolidates multiple books via mode+consensus', () => {
    const event = {
      bookmakers: [
        { key: 'b1', markets: [makeOUMarket('player_shots_on_target', 'Salah', -110, -110, 1.5)] },
        { key: 'b2', markets: [makeOUMarket('player_shots_on_target', 'Salah', -115, -105, 1.5)] },
        { key: 'b3', markets: [makeOUMarket('player_shots_on_target', 'Salah', -115, -105, 2.0)] },
      ],
    };
    const offers = normalizeSoccerPropEvent(event);
    const over = offers.find(o => o.side === 'over');
    assert.ok(over);
    assert.equal(over.line, 1.5, 'mode of [1.5, 1.5, 2.0] = 1.5');
    assert.ok(typeof over.impliedProb === 'number');
  });

  test('attaches impliedProb from American odds', () => {
    const event = makeEvent([makeOUMarket('player_shots_on_target', 'Salah', -200, 170, 1.5)]);
    const offers = normalizeSoccerPropEvent(event);
    const over = offers.find(o => o.side === 'over');
    // -200 → implied = 200/300 ≈ 0.6667
    assert.ok(Math.abs(over.impliedProb - 0.6667) < 0.001);
  });
});

// ── enrichSoccerPropOffers ─────────────────────────────────────────────────────

describe('enrichSoccerPropOffers', () => {
  test('returns [] for non-array input', () => {
    assert.deepEqual(enrichSoccerPropOffers(null), []);
    assert.deepEqual(enrichSoccerPropOffers(undefined), []);
  });

  test('computes fairProb and vig for paired over/under', () => {
    const offers = [
      { propKind: 'shots_on_target', playerName: 'Salah', side: 'over',  line: 1.5, oddsAmerican: -120, impliedProb: null },
      { propKind: 'shots_on_target', playerName: 'Salah', side: 'under', line: 1.5, oddsAmerican: -100, impliedProb: null },
    ];
    const enriched = enrichSoccerPropOffers(offers);
    const over  = enriched.find(o => o.side === 'over');
    const under = enriched.find(o => o.side === 'under');
    assert.ok(over.fairProb != null,  'over fairProb should be set');
    assert.ok(under.fairProb != null, 'under fairProb should be set');
    assert.ok(over.vig > 0, 'vig should be positive');
    // fairProb_over + fairProb_under should be ~1.0
    assert.ok(Math.abs(over.fairProb + under.fairProb - 1.0) < 0.001);
  });

  test('fairProb is null for unpaired yes-market (anytime_goal)', () => {
    const offers = [
      { propKind: 'anytime_goal', playerName: 'Haaland', side: 'over', line: 0.5, oddsAmerican: -130, impliedProb: null },
    ];
    const enriched = enrichSoccerPropOffers(offers);
    assert.equal(enriched[0].fairProb, null, 'no under pair → no fairProb');
    assert.ok(enriched[0].impliedProb != null, 'impliedProb still set');
  });

  test('pairComplete is true only when both sides present', () => {
    const offers = [
      { propKind: 'shots', playerName: 'Kane', side: 'over',  line: 2.5, oddsAmerican: -110, impliedProb: null },
      { propKind: 'shots', playerName: 'Kane', side: 'under', line: 2.5, oddsAmerican: -110, impliedProb: null },
      { propKind: 'anytime_goal', playerName: 'Kane', side: 'over', line: 0.5, oddsAmerican: 120, impliedProb: null },
    ];
    const enriched = enrichSoccerPropOffers(offers);
    const shotsOver = enriched.find(o => o.propKind === 'shots' && o.side === 'over');
    const goalOver  = enriched.find(o => o.propKind === 'anytime_goal');
    assert.equal(shotsOver.pairComplete, true);
    assert.equal(goalOver.pairComplete, false);
  });
});
