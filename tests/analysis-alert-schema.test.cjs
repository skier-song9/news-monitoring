'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  alertBatchStatuses,
  alertChannels,
  alertDeliveryStatuses,
  alertEventStatuses,
  alertPolicyDefaultThreshold,
  articleAnalysisRelevanceSignalTypes,
  articleAnalysisRiskBands,
  entityArticleAnalysisRelevanceSignalType,
  keywordArticleAnalysisRelevanceSignalType,
} = require('../src/db/schema/analysis-alert.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function seedWorkspaceTargetArticle(db, workspaceId, targetId, articleId) {
  db.exec(`
    INSERT INTO workspace (id, slug, name)
    VALUES ('${workspaceId}', '${workspaceId}', '${workspaceId}');

    INSERT INTO monitoring_target (id, workspace_id, type, display_name)
    VALUES ('${targetId}', '${workspaceId}', 'company', '${targetId}');

    INSERT INTO article (id, workspace_id, source_url)
    VALUES ('${articleId}', '${workspaceId}', 'https://example.com/${articleId}');
  `);
}

test('analysis and alert records use the shared defaults', () => {
  const db = createDatabase();
  seedWorkspaceTargetArticle(db, 'workspace-1', 'target-1', 'article-1');

  db.exec(`
    INSERT INTO article_analysis (id, workspace_id, monitoring_target_id, article_id)
    VALUES ('analysis-1', 'workspace-1', 'target-1', 'article-1');

    INSERT INTO alert_policy (id, workspace_id)
    VALUES ('policy-1', 'workspace-1');

    INSERT INTO alert_event (
      id,
      workspace_id,
      monitoring_target_id,
      article_id,
      article_analysis_id,
      alert_policy_id,
      threshold_value,
      risk_score,
      risk_band
    )
    VALUES (
      'event-1',
      'workspace-1',
      'target-1',
      'article-1',
      'analysis-1',
      'policy-1',
      70,
      85,
      'high'
    );

    INSERT INTO alert_delivery (id, workspace_id, alert_event_id, alert_policy_id, channel)
    VALUES ('delivery-1', 'workspace-1', 'event-1', 'policy-1', 'slack');

    INSERT INTO alert_delivery_dispatch (workspace_id, alert_delivery_id)
    VALUES ('workspace-1', 'delivery-1');

    INSERT INTO alert_batch (
      id,
      workspace_id,
      monitoring_target_id,
      alert_policy_id,
      highest_risk_alert_event_id,
      article_count,
      window_started_at,
      window_ended_at
    )
    VALUES (
      'batch-1',
      'workspace-1',
      'target-1',
      'policy-1',
      'event-1',
      2,
      '2026-03-30T12:00:00Z',
      '2026-03-30T12:00:59Z'
    );

    INSERT INTO alert_batch_item (workspace_id, alert_batch_id, alert_event_id)
    VALUES ('workspace-1', 'batch-1', 'event-1');

    INSERT INTO alert_batch_delivery (
      id,
      workspace_id,
      alert_batch_id,
      alert_policy_id,
      channel
    )
    VALUES ('batch-delivery-1', 'workspace-1', 'batch-1', 'policy-1', 'email');

    INSERT INTO alert_batch_delivery_dispatch (workspace_id, alert_batch_delivery_id)
    VALUES ('workspace-1', 'batch-delivery-1');
  `);

  const analysis = db
    .prepare(
      `
        SELECT relevance_score, topic_labels, risk_score, risk_band, model_version, created_at
        FROM article_analysis
        WHERE id = ?
      `,
    )
    .get('analysis-1');
  const policy = db
    .prepare(
      `
        SELECT risk_threshold, slack_enabled, email_enabled, sms_enabled, created_at
        FROM alert_policy
        WHERE id = ?
      `,
    )
    .get('policy-1');
  const event = db
    .prepare('SELECT status, triggered_at FROM alert_event WHERE id = ?')
    .get('event-1');
  const delivery = db
    .prepare('SELECT final_status FROM alert_delivery WHERE id = ?')
    .get('delivery-1');
  const deliveryDispatch = db
    .prepare('SELECT payload_reference, sent_at FROM alert_delivery_dispatch WHERE workspace_id = ? AND alert_delivery_id = ?')
    .get('workspace-1', 'delivery-1');
  const batch = db
    .prepare('SELECT status, dispatched_at FROM alert_batch WHERE id = ?')
    .get('batch-1');
  const batchItem = db
    .prepare(`
      SELECT workspace_id, alert_batch_id, alert_event_id
      FROM alert_batch_item
      WHERE workspace_id = ? AND alert_batch_id = ? AND alert_event_id = ?
    `)
    .get('workspace-1', 'batch-1', 'event-1');
  const batchDelivery = db
    .prepare('SELECT final_status FROM alert_batch_delivery WHERE id = ?')
    .get('batch-delivery-1');
  const batchDeliveryDispatch = db
    .prepare(`
      SELECT payload_reference, sent_at
      FROM alert_batch_delivery_dispatch
      WHERE workspace_id = ? AND alert_batch_delivery_id = ?
    `)
    .get('workspace-1', 'batch-delivery-1');

  assert.equal(analysis.relevance_score, null);
  assert.equal(analysis.topic_labels, '[]');
  assert.equal(analysis.risk_score, null);
  assert.equal(analysis.risk_band, null);
  assert.equal(analysis.model_version, null);
  assert.ok(analysis.created_at);

  assert.equal(policy.risk_threshold, alertPolicyDefaultThreshold);
  assert.equal(policy.slack_enabled, 0);
  assert.equal(policy.email_enabled, 0);
  assert.equal(policy.sms_enabled, 0);
  assert.ok(policy.created_at);

  assert.equal(event.status, alertEventStatuses[0]);
  assert.ok(event.triggered_at);
  assert.equal(delivery.final_status, alertDeliveryStatuses[0]);
  assert.equal(deliveryDispatch.payload_reference, null);
  assert.equal(deliveryDispatch.sent_at, null);
  assert.equal(batch.status, alertBatchStatuses[0]);
  assert.equal(batch.dispatched_at, null);
  assert.deepEqual({ ...batchItem }, {
    workspace_id: 'workspace-1',
    alert_batch_id: 'batch-1',
    alert_event_id: 'event-1',
  });
  assert.equal(batchDelivery.final_status, alertDeliveryStatuses[0]);
  assert.equal(batchDeliveryDispatch.payload_reference, null);
  assert.equal(batchDeliveryDispatch.sent_at, null);

  db.close();
});

test('article analysis records stay tenant-scoped and unique per target and article', () => {
  const db = createDatabase();
  seedWorkspaceTargetArticle(db, 'workspace-1', 'target-1', 'article-1');
  seedWorkspaceTargetArticle(db, 'workspace-2', 'target-2', 'article-2');

  db.exec(`
    INSERT INTO article_analysis (
      id,
      workspace_id,
      monitoring_target_id,
      article_id,
      relevance_score,
      topic_labels,
      summary,
      risk_score,
      risk_band,
      rationale,
      model_version,
      relevance_scored_at,
      topics_classified_at,
      summary_generated_at,
      risk_scored_at
    )
    VALUES (
      'analysis-1',
      'workspace-1',
      'target-1',
      'article-1',
      0.92,
      '["governance"]',
      'A concise summary.',
      72,
      'high',
      'High-risk governance allegations.',
      'gpt-5.4',
      '2026-03-30T11:00:00Z',
      '2026-03-30T11:01:00Z',
      '2026-03-30T11:02:00Z',
      '2026-03-30T11:03:00Z'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis (id, workspace_id, monitoring_target_id, article_id)
        VALUES ('analysis-cross-target', 'workspace-2', 'target-1', 'article-2');
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis (id, workspace_id, monitoring_target_id, article_id)
        VALUES ('analysis-cross-article', 'workspace-2', 'target-2', 'article-1');
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis (id, workspace_id, monitoring_target_id, article_id)
        VALUES ('analysis-duplicate', 'workspace-1', 'target-1', 'article-1');
      `),
    /UNIQUE constraint failed: article_analysis\.workspace_id, article_analysis\.monitoring_target_id, article_analysis\.article_id/u,
  );

  db.close();
});

test('analysis and alert schema enforce score, scope, and delivery constraints', () => {
  const db = createDatabase();
  seedWorkspaceTargetArticle(db, 'workspace-1', 'target-1', 'article-1');
  seedWorkspaceTargetArticle(db, 'workspace-2', 'target-2', 'article-2');

  db.exec(`
    INSERT INTO article_analysis (id, workspace_id, monitoring_target_id, article_id)
    VALUES ('analysis-1', 'workspace-1', 'target-1', 'article-1');

    INSERT INTO alert_policy (
      id,
      workspace_id,
      monitoring_target_id,
      risk_threshold,
      slack_enabled,
      slack_webhook_url
    )
    VALUES (
      'policy-workspace',
      'workspace-1',
      NULL,
      75,
      1,
      'https://hooks.slack.com/services/T000/B000/123'
    );

    INSERT INTO alert_policy (
      id,
      workspace_id,
      monitoring_target_id,
      risk_threshold,
      email_enabled,
      email_recipients
    )
    VALUES (
      'policy-target',
      'workspace-1',
      'target-1',
      80,
      1,
      'ops@example.com'
    );

    INSERT INTO alert_event (
      id,
      workspace_id,
      monitoring_target_id,
      article_id,
      article_analysis_id,
      alert_policy_id,
      threshold_value,
      risk_score,
      risk_band
    )
    VALUES (
      'event-1',
      'workspace-1',
      'target-1',
      'article-1',
      'analysis-1',
      'policy-target',
      80,
      88,
      'high'
    );

    INSERT INTO alert_delivery (
      id,
      workspace_id,
      alert_event_id,
      alert_policy_id,
      channel,
      destination,
      final_status
    )
    VALUES (
      'delivery-1',
      'workspace-1',
      'event-1',
      'policy-target',
      'email',
      'ops@example.com',
      'sent'
    );

    INSERT INTO alert_delivery_dispatch (
      workspace_id,
      alert_delivery_id,
      payload_reference,
      sent_at
    )
    VALUES (
      'workspace-1',
      'delivery-1',
      'email-message-1',
      '2026-03-30T12:10:00Z'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis (
          id,
          workspace_id,
          monitoring_target_id,
          article_id,
          relevance_score
        )
        VALUES ('analysis-invalid-relevance', 'workspace-1', 'target-1', 'article-1', 1.5);
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis (
          id,
          workspace_id,
          monitoring_target_id,
          article_id,
          risk_score,
          risk_band
        )
        VALUES ('analysis-invalid-band', 'workspace-1', 'target-1', 'article-1', 55, 'high');
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_policy (id, workspace_id)
        VALUES ('policy-duplicate-default', 'workspace-1');
      `),
    /UNIQUE constraint failed: alert_policy\.workspace_id/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_policy (
          id,
          workspace_id,
          monitoring_target_id,
          email_enabled
        )
        VALUES ('policy-missing-email-target', 'workspace-2', 'target-2', 1);
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_policy (
          id,
          workspace_id,
          monitoring_target_id
        )
        VALUES ('policy-duplicate-target', 'workspace-1', 'target-1');
      `),
    /UNIQUE constraint failed: alert_policy\.workspace_id, alert_policy\.monitoring_target_id/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_event (
          id,
          workspace_id,
          monitoring_target_id,
          article_id,
          article_analysis_id,
          alert_policy_id,
          threshold_value,
          risk_score,
          risk_band
        )
        VALUES (
          'event-cross-policy',
          'workspace-2',
          'target-2',
          'article-2',
          'analysis-1',
          'policy-target',
          80,
          88,
          'high'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_event (
          id,
          workspace_id,
          monitoring_target_id,
          article_id,
          article_analysis_id,
          threshold_value,
          risk_score,
          risk_band,
          status
        )
        VALUES (
          'event-invalid-status',
          'workspace-1',
          'target-1',
          'article-1',
          'analysis-1',
          80,
          88,
          'high',
          'queued'
        );
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_delivery_dispatch (
          workspace_id,
          alert_delivery_id,
          payload_reference
        )
        VALUES (
          'workspace-1',
          'delivery-1',
          '   '
        );
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_delivery (
          id,
          workspace_id,
          alert_event_id,
          alert_policy_id,
          channel,
          final_status
        )
        VALUES (
          'delivery-invalid-channel',
          'workspace-1',
          'event-1',
          'policy-target',
          'push',
          'sent'
        );
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_delivery (
          id,
          workspace_id,
          alert_event_id,
          alert_policy_id,
          channel,
          final_status
        )
        VALUES (
          'delivery-missing-reason',
          'workspace-1',
          'event-1',
          'policy-target',
          'slack',
          'failed'
        );
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_delivery (
          id,
          workspace_id,
          alert_event_id,
          alert_policy_id,
          channel,
          final_status,
          failure_reason
        )
        VALUES (
          'delivery-cross-event',
          'workspace-2',
          'event-1',
          NULL,
          'sms',
          'failed',
          'Provider rejected request.'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_delivery_dispatch (
          workspace_id,
          alert_delivery_id,
          payload_reference
        )
        VALUES (
          'workspace-2',
          'delivery-1',
          'cross-workspace'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_batch (
          id,
          workspace_id,
          monitoring_target_id,
          alert_policy_id,
          highest_risk_alert_event_id,
          article_count,
          window_started_at,
          window_ended_at
        )
        VALUES (
          'batch-invalid-count',
          'workspace-1',
          'target-1',
          'policy-target',
          'event-1',
          1,
          '2026-03-30T12:00:00Z',
          '2026-03-30T12:00:59Z'
        );
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_batch (
          id,
          workspace_id,
          monitoring_target_id,
          alert_policy_id,
          highest_risk_alert_event_id,
          article_count,
          status,
          window_started_at,
          window_ended_at
        )
        VALUES (
          'batch-invalid-status',
          'workspace-1',
          'target-1',
          'policy-target',
          'event-1',
          2,
          'queued',
          '2026-03-30T12:00:00Z',
          '2026-03-30T12:00:59Z'
        );
      `),
    /CHECK constraint failed/u,
  );

  db.exec(`
    INSERT INTO alert_batch (
      id,
      workspace_id,
      monitoring_target_id,
      alert_policy_id,
      highest_risk_alert_event_id,
      article_count,
      window_started_at,
      window_ended_at
    )
    VALUES (
      'batch-1',
      'workspace-1',
      'target-1',
      'policy-target',
      'event-1',
      2,
      '2026-03-30T12:00:00Z',
      '2026-03-30T12:00:59Z'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_batch_item (
          workspace_id,
          alert_batch_id,
          alert_event_id
        )
        VALUES (
          'workspace-2',
          'batch-1',
          'event-1'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  db.exec(`
    INSERT INTO alert_batch_item (workspace_id, alert_batch_id, alert_event_id)
    VALUES ('workspace-1', 'batch-1', 'event-1');
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_batch_item (
          workspace_id,
          alert_batch_id,
          alert_event_id
        )
        VALUES (
          'workspace-1',
          'batch-1',
          'event-1'
        );
      `),
    /UNIQUE constraint failed: alert_batch_item\.workspace_id, alert_batch_item\.alert_event_id/u,
  );

  db.exec(`
    INSERT INTO alert_batch_delivery (
      id,
      workspace_id,
      alert_batch_id,
      alert_policy_id,
      channel
    )
    VALUES (
      'batch-delivery-1',
      'workspace-1',
      'batch-1',
      'policy-target',
      'slack'
    );
  `);

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_batch_delivery (
          id,
          workspace_id,
          alert_batch_id,
          alert_policy_id,
          channel,
          final_status
        )
        VALUES (
          'batch-delivery-invalid-channel',
          'workspace-1',
          'batch-1',
          'policy-target',
          'push',
          'sent'
        );
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO alert_batch_delivery_dispatch (
          workspace_id,
          alert_batch_delivery_id,
          payload_reference
        )
        VALUES (
          'workspace-1',
          'batch-delivery-1',
          '   '
        );
      `),
    /CHECK constraint failed/u,
  );

  db.close();
});

test('analysis relevance signals stay tenant-scoped and enforce signal constraints', () => {
  const db = createDatabase();
  seedWorkspaceTargetArticle(db, 'workspace-1', 'target-1', 'article-1');
  seedWorkspaceTargetArticle(db, 'workspace-2', 'target-2', 'article-2');

  db.exec(`
    INSERT INTO article_analysis (id, workspace_id, monitoring_target_id, article_id)
    VALUES ('analysis-1', 'workspace-1', 'target-1', 'article-1');

    INSERT INTO article_analysis_relevance_signal (
      workspace_id,
      article_analysis_id,
      signal_type,
      signal_value
    )
    VALUES (
      'workspace-1',
      'analysis-1',
      'keyword',
      'Acme Holdings'
    );
  `);

  const savedSignal = db
    .prepare(`
      SELECT workspace_id, article_analysis_id, signal_type, signal_value
      FROM article_analysis_relevance_signal
      WHERE workspace_id = ? AND article_analysis_id = ?
    `)
    .get('workspace-1', 'analysis-1');

  assert.deepEqual({ ...savedSignal }, {
    workspace_id: 'workspace-1',
    article_analysis_id: 'analysis-1',
    signal_type: keywordArticleAnalysisRelevanceSignalType,
    signal_value: 'Acme Holdings',
  });

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis_relevance_signal (
          workspace_id,
          article_analysis_id,
          signal_type,
          signal_value
        )
        VALUES (
          'workspace-2',
          'analysis-1',
          'entity',
          'Acme executive'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis_relevance_signal (
          workspace_id,
          article_analysis_id,
          signal_type,
          signal_value
        )
        VALUES (
          'workspace-1',
          'analysis-1',
          'keyword',
          'Acme Holdings'
        );
      `),
    /UNIQUE constraint failed: article_analysis_relevance_signal\.workspace_id, article_analysis_relevance_signal\.article_analysis_id, article_analysis_relevance_signal\.signal_type, article_analysis_relevance_signal\.signal_value/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis_relevance_signal (
          workspace_id,
          article_analysis_id,
          signal_type,
          signal_value
        )
        VALUES (
          'workspace-1',
          'analysis-1',
          'topic',
          'governance'
        );
      `),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis_relevance_signal (
          workspace_id,
          article_analysis_id,
          signal_type,
          signal_value
        )
        VALUES (
          'workspace-1',
          'analysis-1',
          'entity',
          '   '
        );
      `),
    /CHECK constraint failed/u,
  );

  db.close();
});

test('analysis topic labels stay tenant-scoped and enforce label constraints', () => {
  const db = createDatabase();
  seedWorkspaceTargetArticle(db, 'workspace-1', 'target-1', 'article-1');
  seedWorkspaceTargetArticle(db, 'workspace-2', 'target-2', 'article-2');

  db.exec(`
    INSERT INTO article_analysis (id, workspace_id, monitoring_target_id, article_id)
    VALUES ('analysis-1', 'workspace-1', 'target-1', 'article-1');

    INSERT INTO article_analysis_topic_label (
      workspace_id,
      article_analysis_id,
      topic_label
    )
    VALUES (
      'workspace-1',
      'analysis-1',
      'governance'
    );
  `);

  const savedTopicLabel = db
    .prepare(`
      SELECT workspace_id, article_analysis_id, topic_label
      FROM article_analysis_topic_label
      WHERE workspace_id = ? AND article_analysis_id = ?
    `)
    .get('workspace-1', 'analysis-1');

  assert.deepEqual({ ...savedTopicLabel }, {
    workspace_id: 'workspace-1',
    article_analysis_id: 'analysis-1',
    topic_label: 'governance',
  });

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis_topic_label (
          workspace_id,
          article_analysis_id,
          topic_label
        )
        VALUES (
          'workspace-2',
          'analysis-1',
          'labor'
        );
      `),
    /FOREIGN KEY constraint failed/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis_topic_label (
          workspace_id,
          article_analysis_id,
          topic_label
        )
        VALUES (
          'workspace-1',
          'analysis-1',
          'governance'
        );
      `),
    /UNIQUE constraint failed: article_analysis_topic_label\.workspace_id, article_analysis_topic_label\.article_analysis_id, article_analysis_topic_label\.topic_label/u,
  );

  assert.throws(
    () =>
      db.exec(`
        INSERT INTO article_analysis_topic_label (
          workspace_id,
          article_analysis_id,
          topic_label
        )
        VALUES (
          'workspace-1',
          'analysis-1',
          '   '
        );
      `),
    /CHECK constraint failed/u,
  );

  db.close();
});

test('analysis and alert constants match the migration contract', () => {
  assert.deepEqual(articleAnalysisRiskBands, ['low', 'medium', 'high']);
  assert.deepEqual(articleAnalysisRelevanceSignalTypes, ['keyword', 'entity']);
  assert.deepEqual(alertChannels, ['slack', 'email', 'sms']);
  assert.deepEqual(alertEventStatuses, [
    'pending',
    'dispatching',
    'delivered',
    'partially_delivered',
    'failed',
    'suppressed',
  ]);
  assert.deepEqual(alertDeliveryStatuses, ['pending', 'sent', 'failed', 'skipped']);
  assert.equal(alertPolicyDefaultThreshold, 70);
  assert.equal(keywordArticleAnalysisRelevanceSignalType, 'keyword');
  assert.equal(entityArticleAnalysisRelevanceSignalType, 'entity');
});
