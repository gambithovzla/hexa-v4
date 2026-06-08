/**
 * Tests for parseFBrefSquadTable (Sprint 11.3 — FBref set-piece stats).
 * Tests the pure exported function — no network needed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseFBrefSquadTable } from '../soccer-fbref-fetcher.js';

const GCA_FIELDS = ['sca_passes_dead_per90', 'gca_passes_dead_per90'];

/** Build a minimal FBref-style squad GCA table HTML. */
function buildFBrefTable(tableId, teams) {
  const rows = teams.map(({ name, sca, gca }) => `
    <tr>
      <th scope="row" data-stat="squad"><a href="/en/squads/xxx/${name}-Stats">${name}</a></th>
      <td data-stat="minutes_90s">30.0</td>
      <td data-stat="sca_passes_dead_per90">${sca ?? ''}</td>
      <td data-stat="gca_passes_dead_per90">${gca ?? ''}</td>
    </tr>`).join('\n');
  return `
    <html><body>
    <table id="${tableId}">
      <thead><tr><th>Squad</th><th>SCA Dead/90</th><th>GCA Dead/90</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </body></html>`;
}

describe('parseFBrefSquadTable', () => {
  test('returns null for empty/null HTML', () => {
    assert.equal(parseFBrefSquadTable(null, ['stats_squads_gca_for'], GCA_FIELDS), null);
    assert.equal(parseFBrefSquadTable('', ['stats_squads_gca_for'], GCA_FIELDS), null);
  });

  test('returns null when table ID not found', () => {
    const html = buildFBrefTable('stats_other_table', [{ name: 'Arsenal', sca: 1.7, gca: 0.24 }]);
    assert.equal(parseFBrefSquadTable(html, ['stats_squads_gca_for'], GCA_FIELDS), null);
  });

  test('falls back to second table ID when first not found', () => {
    const html = buildFBrefTable('stats_gca', [{ name: 'Arsenal', sca: 1.7, gca: 0.24 }]);
    const result = parseFBrefSquadTable(html, ['stats_squads_gca_for', 'stats_gca'], GCA_FIELDS);
    assert.ok(result, 'should find table with fallback ID');
    assert.ok(result.size > 0);
  });

  test('parses team names and numeric fields', () => {
    const html = buildFBrefTable('stats_squads_gca_for', [
      { name: 'Arsenal',         sca: 1.7,  gca: 0.24 },
      { name: 'Manchester City', sca: 2.1,  gca: 0.48 },
      { name: 'Liverpool',       sca: 1.45, gca: 0.31 },
    ]);
    const result = parseFBrefSquadTable(html, ['stats_squads_gca_for'], GCA_FIELDS);
    assert.ok(result, 'should return a Map');
    assert.equal(result.size, 3);
    // Arsenal lookup (norm: 'arsenal')
    const arsenal = result.get('arsenal');
    assert.ok(arsenal, 'should have Arsenal');
    assert.equal(arsenal.sca_passes_dead_per90, 1.7);
    assert.equal(arsenal.gca_passes_dead_per90, 0.24);
    // Manchester City (norm: 'manchestercity')
    const mcity = result.get('manchestercity');
    assert.ok(mcity, 'should have Man City');
    assert.equal(mcity.sca_passes_dead_per90, 2.1);
  });

  test('stores null for empty cell values', () => {
    const html = buildFBrefTable('stats_squads_gca_for', [
      { name: 'Arsenal', sca: '', gca: '-' },
    ]);
    const result = parseFBrefSquadTable(html, ['stats_squads_gca_for'], GCA_FIELDS);
    const arsenal = result?.get('arsenal');
    assert.equal(arsenal?.sca_passes_dead_per90, null);
    assert.equal(arsenal?.gca_passes_dead_per90, null);
  });

  test('skips sub-header rows (all-<th> rows in tbody)', () => {
    const html = `
      <table id="stats_squads_gca_for">
        <tbody>
          <tr class="thead">
            <th data-stat="squad">Squad</th>
            <th data-stat="sca_passes_dead_per90">SCA Dead/90</th>
          </tr>
          <tr>
            <th scope="row" data-stat="squad"><a href="#">Arsenal</a></th>
            <td data-stat="sca_passes_dead_per90">1.7</td>
            <td data-stat="gca_passes_dead_per90">0.24</td>
          </tr>
        </tbody>
      </table>`;
    const result = parseFBrefSquadTable(html, ['stats_squads_gca_for'], GCA_FIELDS);
    // Only 1 real data row — the thead sub-row should be skipped
    assert.equal(result.size, 1);
  });

  test('returns separate Map per call — no shared state', () => {
    const html1 = buildFBrefTable('stats_squads_gca_for', [{ name: 'Arsenal', sca: 1.7, gca: 0.24 }]);
    const html2 = buildFBrefTable('stats_squads_gca_for', [{ name: 'Barcelona', sca: 2.0, gca: 0.50 }]);
    const r1 = parseFBrefSquadTable(html1, ['stats_squads_gca_for'], GCA_FIELDS);
    const r2 = parseFBrefSquadTable(html2, ['stats_squads_gca_for'], GCA_FIELDS);
    assert.ok(r1.has('arsenal'));
    assert.ok(!r1.has('barcelona'));
    assert.ok(r2.has('barcelona'));
    assert.ok(!r2.has('arsenal'));
  });
});
