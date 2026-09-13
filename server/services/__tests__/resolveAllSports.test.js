import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAllSportsPicks } from '../resolveAllSports.js';

function stub(summary) {
  const fn = async () => summary;
  fn.calls = 0;
  return async () => { fn.calls += 1; return summary; };
}

function counter(summary) {
  let calls = 0;
  const run = async () => { calls += 1; return summary; };
  run.count = () => calls;
  return run;
}

test('totals add up across every sport', async () => {
  const out = await resolveAllSportsPicks({
    resolvers: {
      mlb: stub({ resolved: 2, wins: 1, losses: 1, pushes: 0, errors: [] }),
      nfl: stub({ resolved: 3, wins: 2, losses: 0, pushes: 1, errors: [] }),
      soccer: stub({ resolved: 0, wins: 0, losses: 0, pushes: 0, errors: [] }),
    },
  });

  assert.equal(out.resolved, 5);
  assert.equal(out.wins, 3);
  assert.equal(out.pushes, 1);
  assert.equal(out.bySport.nfl.resolved, 3);
  assert.deepEqual(out.errors, []);
});

test('one sport blowing up does not stop the others', async () => {
  const out = await resolveAllSportsPicks({
    resolvers: {
      mlb: async () => { throw new Error('MLB API down'); },
      nfl: stub({ resolved: 1, wins: 1, losses: 0, pushes: 0, errors: [] }),
    },
  });

  assert.equal(out.resolved, 1, 'NFL still resolved');
  assert.match(out.errors[0], /mlb.*MLB API down/);
  assert.equal(out.bySport.mlb.resolved, 0);
});

test('per-sport errors are tagged with the sport that raised them', async () => {
  const out = await resolveAllSportsPicks({
    resolvers: {
      nhl: stub({ resolved: 0, wins: 0, losses: 0, pushes: 0, errors: ['Pick #7: missing game_date'] }),
    },
  });

  assert.deepEqual(out.errors, ['[nhl] Pick #7: missing game_date']);
});

test('a sport filter runs only that resolver', async () => {
  const nfl = counter({ resolved: 1, wins: 1, losses: 0, pushes: 0, errors: [] });
  const mlb = counter({ resolved: 9, wins: 9, losses: 0, pushes: 0, errors: [] });

  const out = await resolveAllSportsPicks({ resolvers: { mlb, nfl }, sport: 'NFL' });

  assert.equal(nfl.count(), 1);
  assert.equal(mlb.count(), 0, 'MLB is skipped');
  assert.equal(out.resolved, 1);
  assert.equal(out.bySport.mlb, undefined);
});

test('a resolver that reports voids (tennis) carries them into the total', async () => {
  const out = await resolveAllSportsPicks({
    resolvers: {
      tennis: stub({ resolved: 2, wins: 1, losses: 0, pushes: 0, voids: 1, errors: [] }),
    },
  });

  assert.equal(out.voids, 1);
});
