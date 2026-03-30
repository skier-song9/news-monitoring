CREATE TABLE IF NOT EXISTS alert_delivery_dispatch (
  workspace_id TEXT NOT NULL,
  alert_delivery_id TEXT NOT NULL,
  payload_reference TEXT
    CHECK (payload_reference IS NULL OR COALESCE(LENGTH(TRIM(payload_reference)), 0) > 0),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, alert_delivery_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, alert_delivery_id)
    REFERENCES alert_delivery (workspace_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_dispatch_workspace_sent_at
  ON alert_delivery_dispatch (workspace_id, sent_at);
