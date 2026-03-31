DROP INDEX IF EXISTS idx_article_workspace_body_hash;
DROP INDEX IF EXISTS idx_article_workspace_title_body_hash;

CREATE INDEX IF NOT EXISTS idx_article_workspace_body_hash
  ON article (workspace_id, body_hash)
  WHERE body_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_workspace_title_body_hash
  ON article (workspace_id, normalized_title_hash, body_hash)
  WHERE normalized_title_hash IS NOT NULL AND body_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS article_content (
  article_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  author_name TEXT,
  publisher_name TEXT,
  published_at TEXT,
  view_count INTEGER CHECK (view_count IS NULL OR view_count >= 0),
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, article_id)
    REFERENCES article (workspace_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_content_workspace_article_id
  ON article_content (workspace_id, article_id);

CREATE INDEX IF NOT EXISTS idx_article_content_workspace_published_at
  ON article_content (workspace_id, published_at);
