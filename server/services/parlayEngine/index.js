// Parlay Synergy Engine — barrel export

export { buildCandidatePool, createPoolBuilder, clearPoolCache, filterCandidatesByBetType } from './pool.js';
export { enrichWithRiskVector, enrichPoolWithRiskVectors } from './risk.js';
export { buildCorrelationMatrix, getCorrelation, getRiskDistance, pairKey } from './correl.js';
export { composeParlays, isParlayValid } from './composer.js';
export { askArchitect, createArchitect, resolveLegs } from './architect.js';
export { PARLAY_ARCHITECT_SYSTEM, buildArchitectUserMessage } from './prompts.js';
export {
  callArchitect,
  assertArchitectProviderConfigured,
  normalizeArchitectProvider,
  resolveArchitectModelSelection,
} from './llmClient.js';
// Phase 3: correl.js     → buildCorrelationMatrix
// Phase 4: composer.js   → composeParlays
// Phase 5: architect.js  → askArchitect
//          llmClient.js  → callArchitect
//          prompts.js    → PARLAY_ARCHITECT_SYSTEM, buildArchitectUserMessage
