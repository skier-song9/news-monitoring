CREATE UNIQUE INDEX IF NOT EXISTS idx_monitoring_target_workspace_scoped_id
  ON monitoring_target (workspace_id, id);

CREATE TABLE IF NOT EXISTS article (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_url TEXT,
  canonical_url TEXT,
  normalized_title_hash TEXT,
  body_hash TEXT,
  ingestion_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ingestion_status IN ('pending', 'processing', 'completed', 'failed')),
  ingestion_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_workspace_scoped_id
  ON article (workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_workspace_source_url
  ON article (workspace_id, source_url)
  WHERE source_url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_workspace_canonical_url
  ON article (workspace_id, canonical_url)
  WHERE canonical_url IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_workspace_body_hash
  ON article (workspace_id, body_hash)
  WHERE body_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_article_workspace_status
  ON article (workspace_id, ingestion_status);

CREATE INDEX IF NOT EXISTS idx_article_workspace_title_body_hash
  ON article (workspace_id, normalized_title_hash, body_hash);

CREATE TABLE IF NOT EXISTS article_candidate (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  monitoring_target_id TEXT NOT NULL,
  article_id TEXT,
  portal_url TEXT NOT NULL,
  source_url TEXT,
  ingestion_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ingestion_status IN ('pending', 'processing', 'linked', 'failed', 'discarded')),
  ingestion_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, monitoring_target_id)
    REFERENCES monitoring_target (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, article_id)
    REFERENCES article (workspace_id, id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_candidate_target_portal_url
  ON article_candidate (monitoring_target_id, portal_url);

CREATE INDEX IF NOT EXISTS idx_article_candidate_workspace_status
  ON article_candidate (workspace_id, ingestion_status);

CREATE INDEX IF NOT EXISTS idx_article_candidate_workspace_source_url
  ON article_candidate (workspace_id, source_url);
