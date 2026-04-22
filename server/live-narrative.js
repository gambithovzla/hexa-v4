function getLang(lang) {
  return lang === 'es' ? 'es' : 'en';
}

function trimSummary(text, maxLength = 220) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function occupiedBasesLabel(bases = {}, lang = 'en') {
  const locale = getLang(lang);
  const labels = [];
  if (bases.first) labels.push(locale === 'es' ? '1ra' : 'first');
  if (bases.second) labels.push(locale === 'es' ? '2da' : 'second');
  if (bases.third) labels.push(locale === 'es' ? '3ra' : 'third');

  if (!labels.length) return locale === 'es' ? 'bases limpias' : 'bases empty';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} ${locale === 'es' ? 'y' : 'and'} ${labels[1]}`;
  return `${labels[0]}, ${labels[1]} ${locale === 'es' ? 'y' : 'and'} ${labels[2]}`;
}

function battingTeamLabel(state = {}) {
  return state?.battingTeamName ?? state?.battingTeam ?? 'Offense';
}

function fieldingTeamLabel(state = {}) {
  return state?.fieldingTeamName ?? state?.fieldingTeam ?? 'Defense';
}

function findSignal(signals = [], type) {
  return signals.find((signal) => signal.type === type) ?? null;
}

function buildHeadline(state, signals, lang = 'en') {
  const locale = getLang(lang);
  const momentum = findSignal(signals, 'momentum_shift');
  const leverage = findSignal(signals, 'high_leverage');
  const bullpen = findSignal(signals, 'bullpen_stress');

  if (momentum) {
    return locale === 'es'
      ? `${battingTeamLabel(state)} aprieta en el inning ${state?.inning ?? '?'}`
      : `${battingTeamLabel(state)} is pressing in inning ${state?.inning ?? '?'}`;
  }

  if (leverage) {
    return locale === 'es'
      ? 'Juego entrando en zona de quiebre'
      : 'Game entering a swing spot';
  }

  if (bullpen) {
    return locale === 'es'
      ? `Bullpen de ${fieldingTeamLabel(state)} en foco`
      : `${fieldingTeamLabel(state)} bullpen under the microscope`;
  }

  return locale === 'es'
    ? `Lectura HEXA estable en el inning ${state?.inning ?? '?'}`
    : `HEXA read steady in inning ${state?.inning ?? '?'}`;
}

function buildSummary(state, signals, lang = 'en') {
  const locale = getLang(lang);
  const leverage = findSignal(signals, 'high_leverage');
  const momentum = findSignal(signals, 'momentum_shift');
  const bullpen = findSignal(signals, 'bullpen_stress');

  if (leverage && bullpen) {
    return trimSummary(
      locale === 'es'
        ? `HEXA detecta presion alta sobre ${fieldingTeamLabel(state)} por trafico en bases y desgaste del relevo.`
        : `HEXA sees heavy pressure on ${fieldingTeamLabel(state)} because of base traffic and bullpen strain.`
    );
  }

  if (leverage && momentum) {
    return trimSummary(
      locale === 'es'
        ? `HEXA marca un momento de quiebre: ${battingTeamLabel(state)} viene empujando y la presion sube sobre ${fieldingTeamLabel(state)}.`
        : `HEXA flags a swing moment: ${battingTeamLabel(state)} is pushing and the pressure is climbing on ${fieldingTeamLabel(state)}.`
    );
  }

  if (bullpen && momentum) {
    return trimSummary(
      locale === 'es'
        ? `${battingTeamLabel(state)} ha tomado el impulso reciente mientras el bullpen de ${fieldingTeamLabel(state)} entra en una zona delicada.`
        : `${battingTeamLabel(state)} has the recent edge while the ${fieldingTeamLabel(state)} bullpen moves into a fragile spot.`
    );
  }

  if (leverage) {
    return trimSummary(
      locale === 'es'
        ? `HEXA ve alta presion sobre ${fieldingTeamLabel(state)} con ${occupiedBasesLabel(state?.bases, locale)} y ${state?.outs ?? 0} outs.`
        : `HEXA sees heavy pressure on ${fieldingTeamLabel(state)} with ${occupiedBasesLabel(state?.bases, locale)} and ${state?.outs ?? 0} outs.`
    );
  }

  if (momentum) {
    return trimSummary(
      locale === 'es'
        ? `${battingTeamLabel(state)} esta encadenando trafico y contacto fuerte en su ventana ofensiva reciente.`
        : `${battingTeamLabel(state)} is stacking traffic and loud contact in its recent offensive window.`
    );
  }

  if (bullpen) {
    return trimSummary(
      locale === 'es'
        ? `HEXA detecta desgaste en el relevo de ${fieldingTeamLabel(state)} en un tramo sensible del juego.`
        : `HEXA detects fatigue in the ${fieldingTeamLabel(state)} bullpen during a sensitive stretch of the game.`
    );
  }

  return trimSummary(
    locale === 'es'
      ? `HEXA no detecta una senal dominante por ahora. El juego sigue estable con ${state?.outs ?? 0} outs y ${occupiedBasesLabel(state?.bases, locale)}.`
      : `HEXA does not see a dominant signal right now. The game is steady with ${state?.outs ?? 0} outs and ${occupiedBasesLabel(state?.bases, locale)}.`
  );
}

function buildBullets(state, signals, lang = 'en') {
  const locale = getLang(lang);
  const bullets = [];

  for (const signal of signals) {
    if (signal.type === 'high_leverage') {
      bullets.push(
        locale === 'es'
          ? `Presion alta con corredores en ${occupiedBasesLabel(state?.bases, locale)}`
          : `High leverage with runners on ${occupiedBasesLabel(state?.bases, locale)}`
      );
    }

    if (signal.type === 'bullpen_stress') {
      bullets.push(
        locale === 'es'
          ? `Bullpen de ${fieldingTeamLabel(state)} en zona delicada`
          : `${fieldingTeamLabel(state)} bullpen is in a delicate spot`
      );
    }

    if (signal.type === 'momentum_shift') {
      bullets.push(
        locale === 'es'
          ? `El impulso reciente favorece a ${battingTeamLabel(state)}`
          : `Recent momentum favors ${battingTeamLabel(state)}`
      );
    }
  }

  if (!bullets.length) {
    bullets.push(
      locale === 'es'
        ? `Sin alertas fuertes; lectura estable de ${state?.battingTeam ?? 'HEXA'}`
        : `No major alerts; stable read for ${state?.battingTeam ?? 'HEXA'}`
    );
  }

  return bullets.slice(0, 3);
}

export function buildLiveNarrative({ state, signals = [], lang = 'en' }) {
  return {
    headline: buildHeadline(state, signals, lang),
    summary: buildSummary(state, signals, lang),
    bullets: buildBullets(state, signals, lang),
  };
}
