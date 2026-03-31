CREATE TABLE IF NOT EXISTS alert_batch (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  monitoring_target_id TEXT NOT NULL,
  alert_policy_id TEXT,
  highest_risk_alert_event_id TEXT NOT NULL,
  article_count INTEGER NOT NULL
    CHECK (article_count >= 2),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'dispatching',
        'delivered',
        'partially_delivered',
        'failed',
        'suppressed'
      )
    ),
  window_started_at TEXT NOT NULL,
  window_ended_at TEXT NOT NULL,
  dispatched_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, monitoring_target_id)
    REFERENCES monitoring_target (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, alert_policy_id)
    REFERENCES alert_policy (workspace_id, id)
    ON DELETE SET NULL,
  FOREIGN KEY (workspace_id, highest_risk_alert_event_id)
    REFERENCES alert_event (workspace_id, id)
    ON DELETE CASCADE,
  CHECK (window_ended_at >= window_started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_batch_workspace_scoped_id
  ON alert_batch (workspace_id, id);

CREATE INDEX IF NOT EXISTS idx_alert_batch_workspace_status_created_at
  ON alert_batch (workspace_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_alert_batch_workspace_target_window
  ON alert_batch (workspace_id, monitoring_target_id, window_started_at, window_ended_at);

CREATE TABLE IF NOT EXISTS alert_batch_item (
  workspace_id TEXT NOT NULL,
  alert_batch_id TEXT NOT NULL,
  alert_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, alert_batch_id, alert_event_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, alert_batch_id)
    REFERENCES alert_batch (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, alert_event_id)
    REFERENCES alert_event (workspace_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_batch_item_workspace_alert_event
  ON alert_batch_item (workspace_id, alert_event_id);

CREATE INDEX IF NOT EXISTS idx_alert_batch_item_workspace_batch
  ON alert_batch_item (workspace_id, alert_batch_id);

CREATE TABLE IF NOT EXISTS alert_batch_delivery (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  alert_batch_id TEXT NOT NULL,
  alert_policy_id TEXT,
  channel TEXT NOT NULL
    CHECK (channel IN ('slack', 'email', 'sms')),
  destination TEXT,
  final_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (final_status IN ('pending', 'sent', 'failed', 'skipped')),
  failure_reason TEXT,
  attempted_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, alert_batch_id)
    REFERENCES alert_batch (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, alert_policy_id)
    REFERENCES alert_policy (workspace_id, id)
    ON DELETE SET NULL,
  CHECK (final_status != 'failed' OR COALESCE(LENGTH(TRIM(failure_reason)), 0) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_batch_delivery_workspace_scoped_id
  ON alert_batch_delivery (workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_batch_delivery_batch_channel
  ON alert_batch_delivery (workspace_id, alert_batch_id, channel);

CREATE INDEX IF NOT EXISTS idx_alert_batch_delivery_workspace_final_status
  ON alert_batch_delivery (workspace_id, final_status);

CREATE TABLE IF NOT EXISTS alert_batch_delivery_dispatch (
  workspace_id TEXT NOT NULL,
  alert_batch_delivery_id TEXT NOT NULL,
  payload_reference TEXT CHECK (
    payload_reference IS NULL OR COALESCE(LENGTH(TRIM(payload_reference)), 0) > 0
  ),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, alert_batch_delivery_id),
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, alert_batch_delivery_id)
    REFERENCES alert_batch_delivery (workspace_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alert_batch_delivery_dispatch_workspace_sent_at
  ON alert_batch_delivery_dispatch (workspace_id, sent_at);
