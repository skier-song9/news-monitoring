CREATE TABLE IF NOT EXISTS article_analysis_topic_label (
  workspace_id TEXT NOT NULL,
  article_analysis_id TEXT NOT NULL,
  topic_label TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, article_analysis_id, topic_label),
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, article_analysis_id)
    REFERENCES article_analysis (workspace_id, id)
    ON DELETE CASCADE,
  CHECK (COALESCE(LENGTH(TRIM(topic_label)), 0) > 0)
);
