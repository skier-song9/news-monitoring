CREATE TABLE IF NOT EXISTS monitoring_target (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('company', 'person')),
  display_name TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'review_required'
    CHECK (status IN (
      'review_required',
      'profile_in_progress',
      'ready_for_review',
      'awaiting_activation',
      'active',
      'paused',
      'archived'
    )),
  default_risk_threshold INTEGER NOT NULL DEFAULT 70
    CHECK (default_risk_threshold BETWEEN 0 AND 100),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_monitoring_target_workspace_status
  ON monitoring_target (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_monitoring_target_workspace_type
  ON monitoring_target (workspace_id, type);
