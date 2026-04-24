// Parlay Synergy Engine — barrel export

export { buildCandidatePool, createPoolBuilder, clearPoolCache } from './pool.js';

// Phase 2: risk.js       → enrichWithRiskVector
// Phase 3: correl.js     → buildCorrelationMatrix
// Phase 4: composer.js   → composeParlays
// Phase 5: architect.js  → askArchitect
//          llmClient.js  → callArchitect
//          prompts.js    → PARLAY_ARCHITECT_SYSTEM, buildArchitectUserMessage
