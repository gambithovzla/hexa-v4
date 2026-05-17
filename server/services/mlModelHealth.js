const MLB_MARKETS = [
  'moneyline', 'overunder', 'runline',
  'prop_hits', 'prop_strikeouts', 'prop_total_bases', 'prop_home_runs', 'prop_rbis',
];
const RUNLINE_EARLY_FLOOR = 60;
const RUNLINE_MIN_FLOOR_DEFAULT = 25;

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string' && v.length > 0);
}

function inferMarketState({ enabled, healthOk, circuitState, artifact, loaded }) {
  if (!enabled) return 'disabled';
  if (circuitState === 'open') return 'circuit_open';
  if (!healthOk) return 'sidecar_unhealthy';
  if (!artifact) return 'no_artifact';
  if (loaded) return 'live';
  return 'lazy_load';
}

function inferEnsembleState({ ensembleEnabled, sidecarEnabled, healthOk, circuitState, artifact, loaded }) {
  if (!ensembleEnabled) return 'flag_off';
  if (!sidecarEnabled) return 'sidecar_off';
  if (circuitState === 'open') return 'circuit_open';
  if (!healthOk) return 'sidecar_unhealthy';
  if (!artifact) return 'not_trained';
  if (loaded) return 'live';
  return 'lazy_load';
}

function buildRunlineTrainingNote(manifestEntry) {
  if (!manifestEntry) return null;
  if (manifestEntry.skipped) {
    return {
      kind: 'skipped',
      minTrainSize: manifestEntry.min_train_size_used ?? RUNLINE_MIN_FLOOR_DEFAULT,
    };
  }
  if (manifestEntry.error) {
    return { kind: 'error', message: String(manifestEntry.error).slice(0, 120) };
  }
  const nTrain = Number(manifestEntry.n_train);
  if (Number.isFinite(nTrain) && nTrain > 0 && nTrain < RUNLINE_EARLY_FLOOR) {
    return { kind: 'early', nTrain };
  }
  return null;
}

export function buildMlObservability({
  enabled = false,
  ensembleEnabled = false,
  circuit = null,
  health = null,
} = {}) {
  const circuitState = circuit?.state ?? 'unknown';
  const healthOk = health?.status === 'ok';
  const modelsLoaded = normalizeList(health?.models_loaded);
  const modelsAvailable = normalizeList(health?.models_available);
  const ensemblesLoaded = normalizeList(health?.ensembles_loaded);
  const ensemblesAvailable = normalizeList(health?.ensembles_available);
  const manifestMarkets = health?.manifest?.markets ?? {};

  const markets = MLB_MARKETS.map((market) => {
    const manifest = manifestMarkets[market] ?? null;
    const trained = !!(manifest && !manifest.skipped && !manifest.error);
    const artifact = modelsAvailable.includes(market);
    const loaded = modelsLoaded.includes(market);
    const inference = inferMarketState({
      enabled,
      healthOk,
      circuitState,
      artifact,
      loaded,
    });

    return {
      market,
      trained,
      artifact,
      loaded,
      inference,
      manifest: manifest
        ? {
            n_train: manifest.n_train ?? null,
            n_test: manifest.n_test ?? null,
            brier_test: manifest.brier_test ?? null,
            roi_kelly25_test: manifest.roi_kelly25_test ?? null,
            trained_at: manifest.trained_at ?? null,
            skipped: !!manifest.skipped,
            min_train_size_used: manifest.min_train_size_used ?? null,
            error: manifest.error ?? null,
          }
        : null,
      runlineNote: market === 'runline' ? buildRunlineTrainingNote(manifest) : null,
    };
  });

  const ensembleArtifact = ensemblesAvailable.includes('moneyline');
  const ensembleLoaded = ensemblesLoaded.includes('moneyline');

  return {
    health_ok: healthOk,
    circuit_state: circuitState,
    models_loaded: modelsLoaded,
    models_available: modelsAvailable,
    ensembles_loaded: ensemblesLoaded,
    ensembles_available: ensemblesAvailable,
    markets,
    ensemble: {
      flag_enabled: ensembleEnabled,
      artifact: ensembleArtifact,
      loaded: ensembleLoaded,
      inference: inferEnsembleState({
        ensembleEnabled,
        sidecarEnabled: enabled,
        healthOk,
        circuitState,
        artifact: ensembleArtifact,
        loaded: ensembleLoaded,
      }),
    },
  };
}

export { MLB_MARKETS, RUNLINE_EARLY_FLOOR, RUNLINE_MIN_FLOOR_DEFAULT };
