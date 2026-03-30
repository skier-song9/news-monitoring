CREATE TABLE IF NOT EXISTS monitoring_target_review (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  monitoring_target_id TEXT NOT NULL,
  review_decision TEXT NOT NULL
    CHECK (review_decision IN ('match', 'partial_match', 'mismatch')),
  reviewed_by_membership_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  activated_by_membership_id TEXT,
  activated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (activated_by_membership_id IS NULL AND activated_at IS NULL)
    OR
    (activated_by_membership_id IS NOT NULL AND activated_at IS NOT NULL)
  ),
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, monitoring_target_id)
    REFERENCES monitoring_target (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, reviewed_by_membership_id)
    REFERENCES workspace_membership (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, activated_by_membership_id)
    REFERENCES workspace_membership (workspace_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monitoring_target_review_workspace_target
  ON monitoring_target_review (workspace_id, monitoring_target_id);

