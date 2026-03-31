CREATE TABLE IF NOT EXISTS article_analysis (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  monitoring_target_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  relevance_score REAL
    CHECK (relevance_score IS NULL OR (relevance_score >= 0 AND relevance_score <= 1)),
  topic_labels TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  risk_score INTEGER
    CHECK (risk_score IS NULL OR risk_score BETWEEN 0 AND 100),
  risk_band TEXT
    CHECK (risk_band IS NULL OR risk_band IN ('low', 'medium', 'high')),
  rationale TEXT,
  model_version TEXT,
  relevance_scored_at TEXT,
  topics_classified_at TEXT,
  summary_generated_at TEXT,
  risk_scored_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, monitoring_target_id)
    REFERENCES monitoring_target (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, article_id)
    REFERENCES article (workspace_id, id)
    ON DELETE CASCADE,
  CHECK (
    (risk_score IS NULL AND risk_band IS NULL)
    OR (risk_score BETWEEN 0 AND 39 AND risk_band = 'low')
    OR (risk_score BETWEEN 40 AND 69 AND risk_band = 'medium')
    OR (risk_score BETWEEN 70 AND 100 AND risk_band = 'high')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_analysis_workspace_scoped_id
  ON article_analysis (workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_article_analysis_target_article
  ON article_analysis (workspace_id, monitoring_target_id, article_id);

CREATE INDEX IF NOT EXISTS idx_article_analysis_workspace_risk
  ON article_analysis (workspace_id, risk_band, risk_score);

CREATE INDEX IF NOT EXISTS idx_article_analysis_workspace_target_updated_at
  ON article_analysis (workspace_id, monitoring_target_id, updated_at);

CREATE TABLE IF NOT EXISTS alert_policy (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  monitoring_target_id TEXT,
  risk_threshold INTEGER NOT NULL DEFAULT 70
    CHECK (risk_threshold BETWEEN 0 AND 100),
  slack_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (slack_enabled IN (0, 1)),
  slack_webhook_url TEXT,
  email_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (email_enabled IN (0, 1)),
  email_recipients TEXT,
  sms_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (sms_enabled IN (0, 1)),
  sms_recipients TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, monitoring_target_id)
    REFERENCES monitoring_target (workspace_id, id)
    ON DELETE CASCADE,
  CHECK (slack_enabled = 0 OR COALESCE(LENGTH(TRIM(slack_webhook_url)), 0) > 0),
  CHECK (email_enabled = 0 OR COALESCE(LENGTH(TRIM(email_recipients)), 0) > 0),
  CHECK (sms_enabled = 0 OR COALESCE(LENGTH(TRIM(sms_recipients)), 0) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_policy_workspace_scoped_id
  ON alert_policy (workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_policy_workspace_default_scope
  ON alert_policy (workspace_id)
  WHERE monitoring_target_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_policy_target_scope
  ON alert_policy (workspace_id, monitoring_target_id)
  WHERE monitoring_target_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS alert_event (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  monitoring_target_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  article_analysis_id TEXT NOT NULL,
  alert_policy_id TEXT,
  threshold_value INTEGER NOT NULL
    CHECK (threshold_value BETWEEN 0 AND 100),
  risk_score INTEGER NOT NULL
    CHECK (risk_score BETWEEN 0 AND 100),
  risk_band TEXT NOT NULL
    CHECK (risk_band IN ('low', 'medium', 'high')),
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
  triggered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspace (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, monitoring_target_id)
    REFERENCES monitoring_target (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, article_id)
    REFERENCES article (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, article_analysis_id)
    REFERENCES article_analysis (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, alert_policy_id)
    REFERENCES alert_policy (workspace_id, id)
    ON DELETE SET NULL,
  CHECK (
    (risk_score BETWEEN 0 AND 39 AND risk_band = 'low')
    OR (risk_score BETWEEN 40 AND 69 AND risk_band = 'medium')
    OR (risk_score BETWEEN 70 AND 100 AND risk_band = 'high')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_event_workspace_scoped_id
  ON alert_event (workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_event_analysis
  ON alert_event (workspace_id, article_analysis_id);

CREATE INDEX IF NOT EXISTS idx_alert_event_workspace_status_triggered_at
  ON alert_event (workspace_id, status, triggered_at);

CREATE INDEX IF NOT EXISTS idx_alert_event_workspace_target_triggered_at
  ON alert_event (workspace_id, monitoring_target_id, triggered_at);

CREATE TABLE IF NOT EXISTS alert_delivery (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  alert_event_id TEXT NOT NULL,
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
  FOREIGN KEY (workspace_id, alert_event_id)
    REFERENCES alert_event (workspace_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, alert_policy_id)
    REFERENCES alert_policy (workspace_id, id)
    ON DELETE SET NULL,
  CHECK (final_status != 'failed' OR COALESCE(LENGTH(TRIM(failure_reason)), 0) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_delivery_workspace_scoped_id
  ON alert_delivery (workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_delivery_event_channel
  ON alert_delivery (workspace_id, alert_event_id, channel);

CREATE INDEX IF NOT EXISTS idx_alert_delivery_workspace_final_status
  ON alert_delivery (workspace_id, final_status);
