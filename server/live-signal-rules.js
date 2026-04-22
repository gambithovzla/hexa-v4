const LEVEL_ORDER = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function clampConfidence(value) {
  return Math.max(0.5, Math.min(0.96, Math.round(value * 100) / 100));
}

function occupiedBasesLabel(bases = {}, lang = 'en') {
  const occupied = [];
  if (bases.first) occupied.push(lang === 'es' ? '1ra' : 'first');
  if (bases.second) occupied.push(lang === 'es' ? '2da' : 'second');
  if (bases.third) occupied.push(lang === 'es' ? '3ra' : 'third');

  if (!occupied.length) return lang === 'es' ? 'bases vacias' : 'bases empty';
  if (occupied.length === 1) return occupied[0];
  if (occupied.length === 2) return `${occupied[0]} ${lang === 'es' ? 'y' : 'and'} ${occupied[1]}`;
  return `${occupied[0]}, ${occupied[1]} ${lang === 'es' ? 'y' : 'and'} ${occupied[2]}`;
}

function inningLabel(inning, lang = 'en') {
  return lang === 'es' ? `inning ${inning}` : `inning ${inning}`;
}

function scoreDiffLabel(scoreDiff, lang = 'en') {
  if (scoreDiff === 0) return lang === 'es' ? 'juego empatado' : 'tie game';
  if (scoreDiff === 1) return lang === 'es' ? 'juego por una carrera' : 'one-run game';
  return lang === 'es' ? `diferencia de ${scoreDiff} carreras` : `${scoreDiff}-run game`;
}

function outsLabel(outs, lang = 'en') {
  if (lang === 'es') {
    return `${outs} out${outs === 1 ? '' : 's'}`;
  }
  return `${outs} out${outs === 1 ? '' : 's'}`;
}

function getLang(lang) {
  return lang === 'es' ? 'es' : 'en';
}

function getSignalLevelValue(level) {
  return LEVEL_ORDER[level] ?? 0;
}

function detectHighLeverage(state = {}) {
  const inning = Number(state?.inning ?? 0);
  const outs = Number(state?.outs ?? 0);
  const scoreDiff = Number(state?.leverageContext?.scoreDiff ?? 99);
  const bases = state?.bases ?? {};
  const occupiedBases = Number(state?.leverageContext?.occupiedBases ?? 0);
  const hasRisp = !!state?.leverageContext?.hasRisp;

  if (inning < 7 || scoreDiff > 2 || occupiedBases < 1 || outs > 1) {
    return null;
  }

  const level = hasRisp && scoreDiff <= 1 && inning >= 8 ? 'critical' : 'high';
  const confidence = clampConfidence(
    level === 'critical'
      ? 0.87 + occupiedBases * 0.02
      : 0.75 + occupiedBases * 0.02
  );

  return {
    type: 'high_leverage',
    level,
    team: state?.fieldingTeam ?? null,
    impact: 'threat_against_team',
    confidence,
    factors: {
      inning,
      scoreDiff,
      outs,
      bases,
      hasRisp,
      occupiedBases,
    },
  };
}

function detectMomentumShift(state = {}) {
  const recent = state?.recentOffenseWindow ?? {};
  const baserunners = Number(recent?.hits ?? 0) + Number(recent?.walks ?? 0);
  const hardContactCount = Number(recent?.hardContactCount ?? 0);
  const deepCountCount = Number(recent?.deepCountCount ?? 0);
  const triggered = [
    baserunners >= 2 ? 'baserunners' : null,
    hardContactCount >= 2 ? 'hard_contact' : null,
    recent?.hits >= 1 && recent?.walks >= 1 && deepCountCount >= 1 ? 'grinding_counts' : null,
  ].filter(Boolean);

  if (!triggered.length || Number(recent?.plateAppearances ?? 0) < 3) {
    return null;
  }

  const level = triggered.length >= 2 || hardContactCount >= 3 ? 'high' : 'medium';
  const confidence = clampConfidence(0.64 + triggered.length * 0.07 + hardContactCount * 0.02);

  return {
    type: 'momentum_shift',
    level,
    team: state?.battingTeam ?? null,
    impact: 'supports_team_offense',
    confidence,
    factors: {
      plateAppearances: Number(recent?.plateAppearances ?? 0),
      hits: Number(recent?.hits ?? 0),
      walks: Number(recent?.walks ?? 0),
      hardContactCount,
      deepCountCount,
      baserunners,
      triggered,
    },
  };
}

function detectBullpenStress(state = {}) {
  const bullpen = state?.bullpenContext ?? {};
  const leverage = state?.leverageContext ?? {};
  const pitchCountCurrentPitcher = Number(state?.pitchCountCurrentPitcher ?? 0);
  const bullpenLoad = Number(bullpen?.teamBullpenLoad3d ?? 0);
  const occupiedBases = Number(leverage?.occupiedBases ?? 0);
  const inning = Number(state?.inning ?? 0);
  const scoreDiff = Number(leverage?.scoreDiff ?? 99);
  const hasRisp = !!leverage?.hasRisp;

  const stressors = [
    pitchCountCurrentPitcher > 20 ? 'pitch_count' : null,
    bullpenLoad >= 7 ? 'bullpen_load' : null,
    bullpen?.backToBackReliever ? 'back_to_back' : null,
    occupiedBases >= 1 ? 'traffic' : null,
  ].filter(Boolean);

  if (bullpen?.currentPitcherRole !== 'reliever' || !stressors.length) {
    return null;
  }

  const leverageBoost = inning >= 7 && scoreDiff <= 2 && hasRisp;
  let level = 'medium';
  if (stressors.length >= 2 || leverageBoost) level = 'high';
  if (stressors.length >= 3 && leverageBoost) level = 'critical';

  const confidence = clampConfidence(
    0.67 +
    stressors.length * 0.05 +
    (bullpenLoad >= 10 ? 0.04 : 0) +
    (leverageBoost ? 0.05 : 0)
  );

  return {
    type: 'bullpen_stress',
    level,
    team: state?.fieldingTeam ?? null,
    impact: 'supports_opponent_scoring',
    confidence,
    factors: {
      pitchCountCurrentPitcher,
      bullpenLoad3d: bullpenLoad,
      backToBackReliever: !!bullpen?.backToBackReliever,
      occupiedBases,
      inning,
      scoreDiff,
      hasRisp,
      currentPitcherRole: bullpen?.currentPitcherRole ?? 'unknown',
      stressors,
    },
  };
}

export function evaluateLiveSignals(state = {}) {
  return [
    detectHighLeverage(state),
    detectMomentumShift(state),
    detectBullpenStress(state),
  ]
    .filter(Boolean)
    .sort((a, b) => {
      const levelDelta = getSignalLevelValue(b.level) - getSignalLevelValue(a.level);
      if (levelDelta !== 0) return levelDelta;
      return Number(b.confidence ?? 0) - Number(a.confidence ?? 0);
    });
}

function buildReasons(signal, state, lang = 'en') {
  const locale = getLang(lang);
  const factors = signal?.factors ?? {};

  if (signal?.type === 'high_leverage') {
    return [
      inningLabel(factors.inning, locale),
      scoreDiffLabel(factors.scoreDiff, locale),
      locale === 'es'
        ? `corredores en ${occupiedBasesLabel(factors.bases, locale)}`
        : `runners on ${occupiedBasesLabel(factors.bases, locale)}`,
      outsLabel(factors.outs, locale),
    ];
  }

  if (signal?.type === 'momentum_shift') {
    const reasons = [];
    if (factors.baserunners >= 2) {
      reasons.push(
        locale === 'es'
          ? `${factors.baserunners} embasados en los ultimos ${factors.plateAppearances} PA`
          : `${factors.baserunners} baserunners in the last ${factors.plateAppearances} PA`
      );
    }
    if (factors.hardContactCount >= 2) {
      reasons.push(
        locale === 'es'
          ? `${factors.hardContactCount} contactos duros recientes`
          : `${factors.hardContactCount} recent hard-hit balls`
      );
    }
    if (factors.deepCountCount >= 1) {
      reasons.push(
        locale === 'es'
          ? `${factors.deepCountCount} conteos profundos`
          : `${factors.deepCountCount} deep counts`
      );
    }
    return reasons;
  }

  if (signal?.type === 'bullpen_stress') {
    const reasons = [];
    if (factors.pitchCountCurrentPitcher > 20) {
      reasons.push(
        locale === 'es'
          ? `relevista actual con ${factors.pitchCountCurrentPitcher} pitcheos`
          : `current reliever at ${factors.pitchCountCurrentPitcher} pitches`
      );
    }
    if (factors.bullpenLoad3d >= 7) {
      reasons.push(
        locale === 'es'
          ? `carga reciente del bullpen: ${factors.bullpenLoad3d} IP en 3 dias`
          : `recent bullpen load: ${factors.bullpenLoad3d} IP in 3 days`
      );
    }
    if (factors.backToBackReliever) {
      reasons.push(locale === 'es' ? 'relevista en back-to-back' : 'current reliever worked back-to-back');
    }
    if (factors.occupiedBases >= 1) {
      reasons.push(locale === 'es' ? 'trafico activo en bases' : 'traffic on the bases');
    }
    return reasons;
  }

  return [];
}

function buildTitle(signal, lang = 'en') {
  const locale = getLang(lang);
  if (signal?.type === 'high_leverage') {
    if (signal?.level === 'critical') return locale === 'es' ? 'Presion maxima' : 'Maximum pressure';
    return locale === 'es' ? 'Presion alta' : 'High leverage';
  }
  if (signal?.type === 'momentum_shift') {
    return locale === 'es' ? 'Momentum ofensivo' : 'Momentum swing';
  }
  if (signal?.type === 'bullpen_stress') {
    if (signal?.level === 'critical') return locale === 'es' ? 'Bullpen en zona critica' : 'Bullpen under major stress';
    return locale === 'es' ? 'Bullpen bajo presion' : 'Bullpen under pressure';
  }
  return signal?.type ?? 'Signal';
}

function buildMessage(signal, state, lang = 'en') {
  const locale = getLang(lang);
  const team = signal?.team ?? state?.fieldingTeam ?? state?.battingTeam ?? '';

  if (signal?.type === 'high_leverage') {
    return locale === 'es'
      ? `Situacion de alta presion para ${team}`
      : `High-pressure spot against ${team}`;
  }

  if (signal?.type === 'momentum_shift') {
    return locale === 'es'
      ? `El impulso reciente favorece a ${team}`
      : `Recent momentum favors ${team}`;
  }

  if (signal?.type === 'bullpen_stress') {
    return locale === 'es'
      ? `El relevo de ${team} muestra desgaste`
      : `${team} bullpen is showing fatigue`;
  }

  return '';
}

export function formatLiveSignal(signal, { state, lang = 'en', generatedAt }) {
  return {
    type: signal.type,
    level: signal.level,
    team: signal.team,
    impact: signal.impact,
    confidence: signal.confidence,
    title: buildTitle(signal, lang),
    message: buildMessage(signal, state, lang),
    reasons: buildReasons(signal, state, lang),
    generatedAt,
  };
}
