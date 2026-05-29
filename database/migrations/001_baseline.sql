-- Baseline migration — H.E.X.A. v4
-- All schema up to 2026-05-29 already exists via server/migrate.js idempotent functions.
-- This file marks the baseline for node-pg-migrate so future migrations are tracked.
-- DO NOT add DDL here — the existing tables are managed by server/migrate.js.
SELECT 1; -- no-op
