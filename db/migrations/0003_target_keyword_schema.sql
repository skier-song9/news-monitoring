CREATE TABLE IF NOT EXISTS target_keyword (
  id TEXT PRIMARY KEY,
  monitoring_target_id TEXT NOT NULL,
  keyword TEXT NOT NULL COLLATE NOCASE,
  source_type TEXT NOT NULL CHECK (source_type IN ('seed', 'expanded', 'excluded')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (monitoring_target_id) REFERENCES monitoring_target (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_target_keyword_target_active_source_order
  ON target_keyword (monitoring_target_id, is_active, source_type, display_order);

CREATE INDEX IF NOT EXISTS idx_target_keyword_target_source
  ON target_keyword (monitoring_target_id, source_type);
