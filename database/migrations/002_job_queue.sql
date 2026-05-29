-- Job queue table for pg-backed async jobs (B7)
CREATE TABLE IF NOT EXISTS job_queue (
  id          BIGSERIAL    PRIMARY KEY,
  type        VARCHAR(64)  NOT NULL,
  payload     JSONB        NOT NULL DEFAULT '{}',
  status      VARCHAR(16)  NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','running','done','failed')),
  priority    INT          NOT NULL DEFAULT 0,
  attempts    INT          NOT NULL DEFAULT 0,
  max_attempts INT         NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_at       TIMESTAMPTZ,
  done_at      TIMESTAMPTZ,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_type
  ON job_queue (status, type, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_job_queue_created_at
  ON job_queue (created_at DESC);
