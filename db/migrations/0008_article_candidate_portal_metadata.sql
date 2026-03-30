CREATE UNIQUE INDEX IF NOT EXISTS idx_article_candidate_workspace_scoped_id
  ON article_candidate (workspace_id, id);

CREATE TABLE IF NOT EXISTS article_candidate_portal_metadata (
  article_candidate_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  portal_name TEXT NOT NULL
    CHECK (portal_name IN ('naver', 'nate', 'google_news')),
  portal_title TEXT NOT NULL,
  portal_snippet TEXT,
  portal_published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, article_candidate_id)
    REFERENCES article_candidate (workspace_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_candidate_portal_metadata_workspace_portal_name
  ON article_candidate_portal_metadata (workspace_id, portal_name, portal_published_at);
