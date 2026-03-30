CREATE TABLE IF NOT EXISTS article_analysis_relevance_signal (
  workspace_id TEXT NOT NULL,
  article_analysis_id TEXT NOT NULL,
  signal_type TEXT NOT NULL
    CHECK (signal_type IN ('keyword', 'entity')),
  signal_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, article_analysis_id, signal_type, signal_value),
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, article_analysis_id)
    REFERENCES article_analysis (workspace_id, id)
    ON DELETE CASCADE,
  CHECK (COALESCE(LENGTH(TRIM(signal_value)), 0) > 0)
);
