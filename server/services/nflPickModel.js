import { classifyNflMarket, extractNflPickLine } from './nflLineProvenance.js';

function namesTeam(text, team, abbr) {
  return [abbr, team?.teamAbbr, team?.teamName].filter(Boolean).some(name => {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  });
}

export function alignNflModelToPick({ analysisData, context, gameMeta, marketOdds, probability }) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) return null;
  const text = String(analysisData?.master_prediction?.pick ?? analysisData?.best_pick?.detail ?? '');
  const market = classifyNflMarket(analysisData?.best_pick?.type, text);
  let side;
  if (market === 'total') {
    const over = /\bover\b/i.test(text), under = /\bunder\b/i.test(text);
    if (over === under) return null;
    const line = extractNflPickLine(text, market);
    if (line == null || line !== marketOdds?.total?.line) return null;
    side = over ? 'over' : 'under';
  } else if (market === 'moneyline' || market === 'spread') {
    const home = namesTeam(text, context?.home, gameMeta?.homeAbbr);
    const away = namesTeam(text, context?.away, gameMeta?.awayAbbr);
    if (home === away) return null;
    side = home ? 'home' : 'away';
    if (market === 'spread') {
      const match = text.replace(/\([^)]*\)/g, '').match(/([+-]\d+(?:\.\d+)?)/);
      if (!match || Number(match[1]) !== marketOdds?.spread?.[side]) return null;
    }
  } else return null;
  return {
    market: `nfl_${market}`,
    probability: side === 'away' || side === 'under' ? 1 - probability : probability,
  };
}
