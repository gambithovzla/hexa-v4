// Parlay Synergy Engine — barrel export
// Modules are registered here as each phase is implemented.

// Phase 1: pool.js       → buildCandidatePool
// Phase 2: risk.js       → enrichWithRiskVector
// Phase 3: correl.js     → buildCorrelationMatrix
// Phase 4: composer.js   → composeParlays
// Phase 5: architect.js  → askArchitect
//          llmClient.js  → callArchitect
//          prompts.js    → PARLAY_ARCHITECT_SYSTEM, buildArchitectUserMessage
