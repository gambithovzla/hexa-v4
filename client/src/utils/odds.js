const EPSILON = 1e-9;

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function normalizeNumericInput(value) {
  return String(value ?? '')
    .trim()
    .replace(/%/g, '')
    .replace(',', '.');
}

export function parseDecimalOdds(value) {
  const normalized = normalizeNumericInput(value);
  if (!normalized) return null;
  const decimal = Number(normalized);
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal;
}

export function parseAmericanOdds(value) {
  const normalized = normalizeNumericInput(value);
  if (!normalized) return null;
  const american = Number(normalized);
  if (!Number.isFinite(american) || american === 0) return null;
  return american;
}

export function parseProbabilityPercent(value) {
  const normalized = normalizeNumericInput(value);
  if (!normalized) return null;
  const probability = Number(normalized);
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 100) return null;
  return probability;
}

export function parseFractionalOdds(value) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, '');
  if (!normalized) return null;
  const match = normalized.match(/^(-?\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  const numerator = Number(match[1].replace(',', '.'));
  const denominator = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator < 0) {
    return null;
  }
  return { numerator, denominator };
}

export function decimalToAmerican(decimalOdds) {
  const decimal = Number(decimalOdds);
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function americanToDecimal(americanOdds) {
  const american = Number(americanOdds);
  if (!Number.isFinite(american) || american === 0) return null;
  if (american > 0) return round(1 + american / 100, 4);
  return round(1 + 100 / Math.abs(american), 4);
}

export function decimalToImpliedProbability(decimalOdds) {
  const decimal = Number(decimalOdds);
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return round((1 / decimal) * 100, 2);
}

export function probabilityToDecimal(probabilityPercent) {
  const probability = Number(probabilityPercent);
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 100) return null;
  return round(100 / probability, 4);
}

export function fractionalToDecimal(fractional) {
  if (!fractional) return null;
  const { numerator, denominator } = fractional;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator < 0) {
    return null;
  }
  return round(1 + numerator / denominator, 4);
}

export function decimalToFractional(decimalOdds) {
  const decimal = Number(decimalOdds);
  if (!Number.isFinite(decimal) || decimal <= 1) return null;

  const fractional = decimal - 1;
  if (fractional < EPSILON) return '0/1';

  const precision = 1000;
  const numerator = Math.round(fractional * precision);
  const divisor = gcd(numerator, precision);
  return `${numerator / divisor}/${precision / divisor}`;
}

export function fractionalToAmerican(fractional) {
  const decimal = fractionalToDecimal(fractional);
  return decimal != null ? decimalToAmerican(decimal) : null;
}

export function americanToFractional(americanOdds) {
  const decimal = americanToDecimal(americanOdds);
  return decimal != null ? decimalToFractional(decimal) : null;
}

export function probabilityToAmerican(probabilityPercent) {
  const decimal = probabilityToDecimal(probabilityPercent);
  return decimal != null ? decimalToAmerican(decimal) : null;
}

export function formatAmericanOdds(americanOdds) {
  if (americanOdds == null || !Number.isFinite(Number(americanOdds))) return '--';
  const n = Math.round(Number(americanOdds));
  return n > 0 ? `+${n}` : `${n}`;
}

export function formatDecimalOdds(decimalOdds, decimals = 2) {
  if (decimalOdds == null || !Number.isFinite(Number(decimalOdds))) return '--';
  return Number(decimalOdds).toFixed(decimals);
}

export function formatProbability(probability, decimals = 2) {
  if (probability == null || !Number.isFinite(Number(probability))) return '--';
  return `${Number(probability).toFixed(decimals)}%`;
}

export function formatMoney(amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return '$0.00';
  return `$${Number(amount).toFixed(2)}`;
}

export function calculatePayoutFromDecimal(stakeValue, decimalOdds) {
  const stake = Number(stakeValue);
  const decimal = Number(decimalOdds);
  if (!Number.isFinite(stake) || stake <= 0 || !Number.isFinite(decimal) || decimal <= 1) return null;

  const totalReturn = stake * decimal;
  const profit = totalReturn - stake;

  return {
    stake: round(stake, 2),
    profit: round(profit, 2),
    totalReturn: round(totalReturn, 2),
    breakEvenProbability: decimalToImpliedProbability(decimal),
  };
}

export function calculateParlayFromDecimals(decimalOddsList = []) {
  const sanitized = decimalOddsList
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 1);

  if (!sanitized.length) return null;

  const combinedDecimal = sanitized.reduce((product, value) => product * value, 1);
  return {
    legs: sanitized.length,
    combinedDecimal: round(combinedDecimal, 4),
    combinedAmerican: decimalToAmerican(combinedDecimal),
    impliedProbability: decimalToImpliedProbability(combinedDecimal),
  };
}

export function calculateFairOddsFromProbability(probabilityPercent) {
  const decimal = probabilityToDecimal(probabilityPercent);
  if (decimal == null) return null;
  return {
    decimal,
    american: decimalToAmerican(decimal),
  };
}

export function calculateKellyStake({
  bankroll,
  probabilityPercent,
  decimalOdds,
  fraction = 0.25,
  maxStakePercent = 5,
}) {
  const bankrollValue = Number(bankroll);
  const probability = Number(probabilityPercent);
  const decimal = Number(decimalOdds);

  if (
    !Number.isFinite(bankrollValue) ||
    bankrollValue <= 0 ||
    !Number.isFinite(probability) ||
    probability <= 0 ||
    probability >= 100 ||
    !Number.isFinite(decimal) ||
    decimal <= 1
  ) {
    return null;
  }

  const p = probability / 100;
  const q = 1 - p;
  const b = decimal - 1;
  const fullKelly = ((b * p) - q) / b;
  const clippedFullKelly = Math.max(fullKelly, 0);
  const scaledKelly = clippedFullKelly * fraction;
  const cappedKelly = Math.min(scaledKelly, maxStakePercent / 100);
  const stakeAmount = bankrollValue * cappedKelly;

  return {
    edgePercent: round(probability - (decimalToImpliedProbability(decimal) ?? 0), 2),
    fullKellyPercent: round(clippedFullKelly * 100, 2),
    recommendedKellyPercent: round(cappedKelly * 100, 2),
    recommendedStake: round(stakeAmount, 2),
  };
}

export function convertOddsFrom(type, rawValue) {
  let decimal = null;

  if (type === 'decimal') decimal = parseDecimalOdds(rawValue);
  if (type === 'american') {
    const american = parseAmericanOdds(rawValue);
    decimal = american != null ? americanToDecimal(american) : null;
  }
  if (type === 'fractional') {
    const fractional = parseFractionalOdds(rawValue);
    decimal = fractional != null ? fractionalToDecimal(fractional) : null;
  }
  if (type === 'probability') {
    const probability = parseProbabilityPercent(rawValue);
    decimal = probability != null ? probabilityToDecimal(probability) : null;
  }

  if (decimal == null) return null;

  return {
    decimal: formatDecimalOdds(decimal),
    american: formatAmericanOdds(decimalToAmerican(decimal)),
    fractional: decimalToFractional(decimal),
    probability: formatProbability(decimalToImpliedProbability(decimal)),
    decimalValue: decimal,
  };
}

