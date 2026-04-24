// Parlay Synergy Engine — barrel export

export { buildCandidatePool, createPoolBuilder, clearPoolCache } from './pool.js';
export { enrichWithRiskVector, enrichPoolWithRiskVectors } from './risk.js';

// Phase 3: correl.js     → buildCorrelationMatrix
// Phase 3: correl.js     → buildCorrelationMatrix
// Phase 4: composer.js   → composeParlays
// Phase 5: architect.js  → askArchitect
//          llmClient.js  → callArchitect
//          prompts.js    → PARLAY_ARCHITECT_SYSTEM, buildArchitectUserMessage
