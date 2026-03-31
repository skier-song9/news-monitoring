CREATE TABLE IF NOT EXISTS monitoring_target_profile (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  monitoring_target_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  related_entities_json TEXT NOT NULL DEFAULT '[]',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  search_results_json TEXT NOT NULL DEFAULT '[]',
  model_version TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, monitoring_target_id)
    REFERENCES monitoring_target (workspace_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monitoring_target_profile_workspace_target
  ON monitoring_target_profile (workspace_id, monitoring_target_id);

CREATE INDEX IF NOT EXISTS idx_monitoring_target_profile_workspace_generated
  ON monitoring_target_profile (workspace_id, generated_at);
