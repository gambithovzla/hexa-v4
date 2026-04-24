# Parlay Synergy Engine

New parallel module for H.E.X.A. v4. Builds correlated, risk-orthogonal parlays with game-script coherence.

**Does NOT touch** any existing analysis flow (`/api/analyze/parlay`, `oracle.js`, `market-intelligence.js`, `xgboostValidator.js`, `context-builder.js`).

## New endpoint

`POST /api/analyze/parlay-synergy` — admin-only while in beta, guarded by `PARLAY_SYNERGY_ENABLED` feature flag.

## Pipeline

```
buildCandidatePool   (pool.js)
  → enrichWithRiskVector     (risk.js)
  → buildCorrelationMatrix   (correl.js)
  → composeParlays           (composer.js)
  → askArchitect             (architect.js / llmClient.js)
```

## Feature flag

Set `PARLAY_SYNERGY_ENABLED=true` in your `.env` to enable. Defaults to `false`.

## Tests

`server/services/parlayEngine/__tests__/`
