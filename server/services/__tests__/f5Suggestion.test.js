import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateF5Suggestion, normalizeF5Event } from '../f5SuggestionService.js';

const gameData = {
  teams: {
    home: { name: 'New York Yankees', abbreviation: 'NYY' },
    away: { name: 'Cleveland Guardians', abbreviation: 'CLE' },
  },
};

function baseAnalysis(overrides = {}) {
  return {
    best_pick: { type: 'Moneyline', detail: 'NYY ML', confidence: 0.6 },
    master_prediction: { pick: 'NYY Moneyline' },
    oracle_report:
      'PRIMARY EDGE — Gerrit Cole xwOBA_against .278 con Whiff% 31% domina un lineup frío; ' +
      'CONFIRMING SIGNALS — park factor 98, viento neutro; ' +
      'KEY RISK — el bullpen de los Yankees acumula uso reciente y puede regalar carreras tarde; ' +
      'EDGE MATH — 60% confianza vs 55% implícita.',
    alert_flags: [],
    ...overrides,
  };
}

const fatiguedFeatures = {
  homePitcher: { fullName: 'Gerrit Cole' },
  awayPitcher: { fullName: 'Tanner Bibee' },
  homeBullpenUsage: { bullpenIP_3d: 8.1, relievers: [] },
  awayBullpenUsage: { bullpenIP_3d: 3.0, relievers: [] },
};

test('suggests F5 when thesis is starter-driven and picked bullpen is fatigued', () => {
  const result = evaluateF5Suggestion({ analysisData: baseAnalysis(), gameData, features: fatiguedFeatures });
  assert.equal(result.suggested, true);
  assert.equal(result.side, 'home');
  assert.equal(result.suggestedPick, 'NYY ML F5');
  assert.equal(result.signals.starterThesis, true);
  assert.equal(result.signals.bullpenIp3d, 8.1);
  assert.ok(result.reasons.length >= 2);
});

test('does not suggest when picked bullpen is fresh and no risk signals', () => {
  const analysis = baseAnalysis({
    oracle_report:
      'PRIMARY EDGE — Gerrit Cole xwOBA_against .278 domina; ' +
      'CONFIRMING SIGNALS — park neutro; ' +
      'KEY RISK — el lineup de CLE pega bien vs derechos; ' +
      'EDGE MATH — 60 vs 55.',
  });
  const features = { ...fatiguedFeatures, homeBullpenUsage: { bullpenIP_3d: 3.2, relievers: [] } };
  const result = evaluateF5Suggestion({ analysisData: analysis, gameData, features });
  assert.equal(result.suggested, false);
});

test('returns null for non-moneyline picks', () => {
  const analysis = baseAnalysis({ best_pick: { type: 'Over-Under', detail: 'Over 8.5' } });
  assert.equal(evaluateF5Suggestion({ analysisData: analysis, gameData, features: fatiguedFeatures }), null);
});

test('returns null when the pick is already F5', () => {
  const analysis = baseAnalysis({ best_pick: { type: 'Moneyline', detail: 'NYY ML F5' } });
  assert.equal(evaluateF5Suggestion({ analysisData: analysis, gameData, features: fatiguedFeatures }), null);
});

test('does not suggest when the primary edge is the bullpen itself', () => {
  const analysis = baseAnalysis({
    oracle_report:
      'PRIMARY EDGE — el bullpen fresco de los Yankees vs un relevo de CLE en fatiga crítica; ' +
      'CONFIRMING SIGNALS — Cole sólido; ' +
      'KEY RISK — bullpen propio con uso; ' +
      'EDGE MATH — 60 vs 55.',
  });
  const result = evaluateF5Suggestion({ analysisData: analysis, gameData, features: fatiguedFeatures });
  assert.equal(result.suggested, false);
});

test('KEY RISK bullpen mention triggers exposure even without usage data', () => {
  const result = evaluateF5Suggestion({ analysisData: baseAnalysis(), gameData, features: {
    homePitcher: { fullName: 'Gerrit Cole' },
    awayPitcher: { fullName: 'Tanner Bibee' },
  } });
  assert.equal(result.suggested, true);
  assert.equal(result.signals.keyRiskIsBullpen, true);
  assert.equal(result.signals.bullpenIp3d, null);
});

test('away-side pick resolves the away team and its bullpen', () => {
  const analysis = baseAnalysis({
    best_pick: { type: 'Moneyline', detail: 'CLE ML' },
    oracle_report:
      'PRIMARY EDGE — Tanner Bibee con CSW% elite y rolling wOBA against .250; ' +
      'CONFIRMING SIGNALS — lineup NYY frío; ' +
      'KEY RISK — clima; ' +
      'EDGE MATH — 58 vs 52.',
  });
  const features = {
    homePitcher: { fullName: 'Gerrit Cole' },
    awayPitcher: { fullName: 'Tanner Bibee' },
    awayBullpenUsage: { bullpenIP_3d: 11.2, relievers: [] },
  };
  const result = evaluateF5Suggestion({ analysisData: analysis, gameData, features });
  assert.equal(result.suggested, true);
  assert.equal(result.side, 'away');
  assert.equal(result.suggestedPick, 'CLE ML F5');
  assert.match(result.reasons.join(' '), /CR[ÍI]TICA/i);
});

test('two back-to-back relievers count as compromised depth', () => {
  const analysis = baseAnalysis({
    oracle_report:
      'PRIMARY EDGE — Gerrit Cole Whiff% 31%; CONFIRMING — park; KEY RISK — clima; EDGE MATH — 60 vs 55.',
  });
  const features = {
    homePitcher: { fullName: 'Gerrit Cole' },
    homeBullpenUsage: {
      bullpenIP_3d: 5.0,
      relievers: [{ isBackToBack: true }, { isBackToBack: true }, { isBackToBack: false }],
    },
  };
  const result = evaluateF5Suggestion({ analysisData: analysis, gameData, features });
  assert.equal(result.suggested, true);
  assert.equal(result.signals.backToBackRelievers, 2);
});

test('alert flag naming the picked team triggers exposure', () => {
  const analysis = baseAnalysis({
    oracle_report:
      'PRIMARY EDGE — Gerrit Cole xwOBA_against .278; CONFIRMING — park; KEY RISK — clima; EDGE MATH — 60 vs 55.',
    alert_flags: ['Critical bullpen fatigue — Yankees used 10.1IP in 3 days'],
  });
  const result = evaluateF5Suggestion({ analysisData: analysis, gameData, features: {
    homePitcher: { fullName: 'Gerrit Cole' },
  } });
  assert.equal(result.suggested, true);
  assert.ok(result.signals.alertFlagHit);
});

test('opponent bullpen fatigue does NOT trigger the F5 lens', () => {
  const analysis = baseAnalysis({
    oracle_report:
      'PRIMARY EDGE — Gerrit Cole xwOBA_against .278; CONFIRMING — park; KEY RISK — clima; EDGE MATH — 60 vs 55.',
    alert_flags: ['Critical bullpen fatigue — Guardians used 11IP in 3 days'],
  });
  const features = {
    homePitcher: { fullName: 'Gerrit Cole' },
    homeBullpenUsage: { bullpenIP_3d: 2.0, relievers: [] },
    awayBullpenUsage: { bullpenIP_3d: 11.0, relievers: [] },
  };
  const result = evaluateF5Suggestion({ analysisData: analysis, gameData, features });
  assert.equal(result.suggested, false);
});

test('normalizeF5Event averages books and maps teams by name', () => {
  const event = {
    bookmakers: [
      {
        key: 'book1',
        markets: [{
          key: 'h2h_1st_5_innings',
          outcomes: [
            { name: 'New York Yankees', price: -135 },
            { name: 'Cleveland Guardians', price: +115 },
          ],
        }],
      },
      {
        key: 'book2',
        markets: [{
          key: 'h2h_1st_5_innings',
          outcomes: [
            { name: 'New York Yankees', price: -145 },
            { name: 'Cleveland Guardians', price: +125 },
          ],
        }],
      },
    ],
  };
  const result = normalizeF5Event(event, 'New York Yankees', 'Cleveland Guardians');
  assert.ok(result);
  assert.equal(result.bookCount, 2);
  assert.ok(result.home <= -135 - 10 + 20 && result.home < 0, `home consensus negative: ${result.home}`);
  assert.ok(result.away > 0, `away consensus positive: ${result.away}`);
});

test('normalizeF5Event ignores other markets and returns null when empty', () => {
  const event = {
    bookmakers: [{ key: 'b', markets: [{ key: 'h2h', outcomes: [{ name: 'New York Yankees', price: -120 }] }] }],
  };
  assert.equal(normalizeF5Event(event, 'New York Yankees', 'Cleveland Guardians'), null);
  assert.equal(normalizeF5Event(null, 'a', 'b'), null);
});
