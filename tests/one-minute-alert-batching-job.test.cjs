'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  runOneMinuteAlertBatchingJob,
} = require('../src/backend/one-minute-alert-batching-job.cjs');
const {
  completedArticleIngestionStatus,
} = require('../src/db/schema/article-ingestion.cjs');
const { activeMonitoringTargetStatus } = require('../src/db/schema/monitoring-target.cjs');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  return db;
}

function insertWorkspace(db, { id, slug, name }) {
  db.prepare(`
    INSERT INTO workspace (id, slug, name)
    VALUES (?, ?, ?)
  `).run(id, slug, name);
}

function insertMonitoringTarget(
  db,
  {
    id,
    workspaceId,
    type = 'company',
    displayName,
    note = null,
    status = activeMonitoringTargetStatus,
    defaultRiskThreshold = 70,
  },
) {
  db.prepare(`
    INSERT INTO monitoring_target (
      id,
      workspace_id,
      type,
      display_name,
      note,
      status,
      default_risk_threshold
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, type, displayName, note, status, defaultRiskThreshold);
}

function insertArticle(
  db,
  {
    id,
    workspaceId,
    sourceUrl = null,
    canonicalUrl = null,
    ingestionStatus = completedArticleIngestionStatus,
  },
) {
  db.prepare(`
    INSERT INTO article (
      id,
      workspace_id,
      source_url,
      canonical_url,
      ingestion_status
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(id, workspaceId, sourceUrl, canonicalUrl, ingestionStatus);
}

function insertArticleContent(
  db,
  {
    articleId,
    workspaceId,
    title,
    bodyText,
    authorName = null,
    publisherName = null,
    publishedAt = null,
    viewCount = null,
    fetchedAt = '2026-03-30T20:45:00.000Z',
  },
) {
  db.prepare(`
    INSERT INTO article_content (
      article_id,
      workspace_id,
      title,
      body_text,
      author_name,
      publisher_name,
      published_at,
      view_count,
      fetched_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    articleId,
    workspaceId,
    title,
    bodyText,
    authorName,
    publisherName,
    publishedAt,
    viewCount,
    fetchedAt,
  );
}

function insertArticleAnalysis(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    relevanceScore = 0.92,
    topicLabels = '["governance"]',
    summary = 'A concise summary.',
    riskScore,
    riskBand = 'high',
    rationale,
    modelVersion = 'gpt-5.4',
    relevanceScoredAt = '2026-03-30T20:40:00.000Z',
    topicsClassifiedAt = '2026-03-30T20:41:00.000Z',
    summaryGeneratedAt = '2026-03-30T20:42:00.000Z',
    riskScoredAt = '2026-03-30T20:43:00.000Z',
    createdAt = '2026-03-30T20:40:00.000Z',
    updatedAt = '2026-03-30T20:43:00.000Z',
  },
) {
  db.prepare(`
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
      risk_scored_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    relevanceScore,
    topicLabels,
    summary,
    riskScore,
    riskBand,
    rationale,
    modelVersion,
    relevanceScoredAt,
    topicsClassifiedAt,
    summaryGeneratedAt,
    riskScoredAt,
    createdAt,
    updatedAt,
  );
}

function insertAlertPolicy(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId = null,
    riskThreshold = 70,
    slackEnabled = false,
    slackWebhookUrl = null,
    emailEnabled = false,
    emailRecipients = null,
    smsEnabled = false,
    smsRecipients = null,
  },
) {
  db.prepare(`
    INSERT INTO alert_policy (
      id,
      workspace_id,
      monitoring_target_id,
      risk_threshold,
      slack_enabled,
      slack_webhook_url,
      email_enabled,
      email_recipients,
      sms_enabled,
      sms_recipients
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    riskThreshold,
    slackEnabled ? 1 : 0,
    slackWebhookUrl,
    emailEnabled ? 1 : 0,
    emailRecipients,
    smsEnabled ? 1 : 0,
    smsRecipients,
  );
}

function insertAlertEvent(
  db,
  {
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    articleAnalysisId,
    alertPolicyId = null,
    thresholdValue = 80,
    riskScore,
    riskBand = 'high',
    status = 'delivered',
    triggeredAt,
    dispatchedAt = triggeredAt,
    createdAt = triggeredAt,
    updatedAt = dispatchedAt,
  },
) {
  db.prepare(`
    INSERT INTO alert_event (
      id,
      workspace_id,
      monitoring_target_id,
      article_id,
      article_analysis_id,
      alert_policy_id,
      threshold_value,
      risk_score,
      risk_band,
      status,
      triggered_at,
      dispatched_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    monitoringTargetId,
    articleId,
    articleAnalysisId,
    alertPolicyId,
    thresholdValue,
    riskScore,
    riskBand,
    status,
    triggeredAt,
    dispatchedAt,
    createdAt,
    updatedAt,
  );
}

function createIdGenerator(...ids) {
  let currentIndex = 0;

  return () => {
    const id = ids[currentIndex];

    if (!id) {
      throw new Error('No deterministic id available for test');
    }

    currentIndex += 1;
    return id;
  };
}

function createNowSequence(...timestamps) {
  let currentIndex = 0;

  return () => {
    const timestamp = timestamps[currentIndex];

    if (!timestamp) {
      throw new Error('No deterministic timestamp available for test');
    }

    currentIndex += 1;
    return timestamp;
  };
}

function normalizeRow(row) {
  return row ? { ...row } : row;
}

test('runOneMinuteAlertBatchingJob groups one-minute high-risk events by workspace and target', async () => {
  const db = createDatabase();
  const receivedCalls = [];

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });
  insertMonitoringTarget(db, {
    id: 'target-2',
    workspaceId: 'workspace-1',
    displayName: 'Beta Retail',
  });
  insertAlertPolicy(db, {
    id: 'policy-target-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    riskThreshold: 80,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SLACK1',
    emailEnabled: true,
    emailRecipients: '["desk@example.com"]',
  });

  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme bribery probe expands',
    bodyText: 'Investigators expanded the bribery probe.',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    riskScore: 82,
    rationale: 'The article cites prosecutors and names current executives.',
  });
  insertAlertEvent(db, {
    id: 'event-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    articleAnalysisId: 'analysis-1',
    alertPolicyId: 'policy-target-1',
    thresholdValue: 80,
    riskScore: 82,
    triggeredAt: '2026-03-30T21:00:00.000Z',
  });

  insertArticle(db, {
    id: 'article-2',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-2',
    canonicalUrl: 'https://source.example.com/canonical-2',
  });
  insertArticleContent(db, {
    articleId: 'article-2',
    workspaceId: 'workspace-1',
    title: 'Acme executive raided in corruption inquiry',
    bodyText: 'The inquiry widened after a new raid.',
    publisherName: 'Market Signal',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-2',
    riskScore: 97,
    rationale: 'The article reports raids and names multiple executives.',
  });
  insertAlertEvent(db, {
    id: 'event-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-2',
    articleAnalysisId: 'analysis-2',
    alertPolicyId: 'policy-target-1',
    thresholdValue: 80,
    riskScore: 97,
    triggeredAt: '2026-03-30T21:00:40.000Z',
  });

  insertArticle(db, {
    id: 'article-3',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-3',
  });
  insertArticleContent(db, {
    articleId: 'article-3',
    workspaceId: 'workspace-1',
    title: 'Acme board faces investor questions',
    bodyText: 'Investors are questioning recent disclosures.',
    publisherName: 'Capital Watch',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-3',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-3',
    riskScore: 88,
    rationale: 'The article describes a separate investor backlash story.',
  });
  insertAlertEvent(db, {
    id: 'event-3',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-3',
    articleAnalysisId: 'analysis-3',
    alertPolicyId: 'policy-target-1',
    thresholdValue: 80,
    riskScore: 88,
    triggeredAt: '2026-03-30T21:01:50.000Z',
  });

  insertArticle(db, {
    id: 'article-4',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-4',
  });
  insertArticleContent(db, {
    articleId: 'article-4',
    workspaceId: 'workspace-1',
    title: 'Beta Retail labor dispute escalates',
    bodyText: 'A labor dispute is widening.',
    publisherName: 'Retail Journal',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-4',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-2',
    articleId: 'article-4',
    riskScore: 85,
    rationale: 'The article highlights protests outside stores.',
  });
  insertAlertEvent(db, {
    id: 'event-4',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-2',
    articleId: 'article-4',
    articleAnalysisId: 'analysis-4',
    thresholdValue: 80,
    riskScore: 85,
    triggeredAt: '2026-03-30T21:00:20.000Z',
  });

  const result = await runOneMinuteAlertBatchingJob({
    db,
    createId: createIdGenerator('batch-1', 'batch-delivery-slack-1', 'batch-delivery-email-1'),
    now: createNowSequence(
      '2026-03-30T21:02:00.000Z',
      '2026-03-30T21:02:01.000Z',
      '2026-03-30T21:02:02.000Z',
      '2026-03-30T21:02:03.000Z',
    ),
    dispatchSlackAlert: async (context) => {
      receivedCalls.push({
        channel: 'slack',
        destination: context.destination,
        payload: context.payload,
        highestRiskAlertEventId: context.highestRiskAlertEvent.id,
        alertEventIds: context.alertEvents.map((alertEvent) => alertEvent.id),
      });
      return {
        payloadReference: 'slack-batch-1',
        sentAt: '2026-03-30T21:02:01.500Z',
      };
    },
    dispatchEmailAlert: async (context) => {
      receivedCalls.push({
        channel: 'email',
        destination: context.destination,
        payload: context.payload,
        highestRiskAlertEventId: context.highestRiskAlertEvent.id,
        alertEventIds: context.alertEvents.map((alertEvent) => alertEvent.id),
      });
      return {
        payloadReference: 'email-batch-1',
        sentAt: '2026-03-30T21:02:02.500Z',
      };
    },
  });

  const savedBatch = db.prepare(`
    SELECT
      id,
      alert_policy_id,
      highest_risk_alert_event_id,
      article_count,
      status,
      window_started_at,
      window_ended_at,
      dispatched_at
    FROM alert_batch
    WHERE workspace_id = ? AND id = ?
  `).get('workspace-1', 'batch-1');
  const savedBatchItems = db.prepare(`
    SELECT alert_event_id
    FROM alert_batch_item
    WHERE workspace_id = ? AND alert_batch_id = ?
    ORDER BY alert_event_id
  `).all('workspace-1', 'batch-1');
  const savedBatchDeliveries = db.prepare(`
    SELECT
      id,
      channel,
      destination,
      final_status,
      failure_reason,
      attempted_at,
      delivered_at
    FROM alert_batch_delivery
    WHERE workspace_id = ?
    ORDER BY channel
  `).all('workspace-1');
  const savedBatchDispatches = db.prepare(`
    SELECT
      d.channel,
      x.payload_reference,
      x.sent_at
    FROM alert_batch_delivery_dispatch x
    JOIN alert_batch_delivery d
      ON d.workspace_id = x.workspace_id
     AND d.id = x.alert_batch_delivery_id
    WHERE x.workspace_id = ?
    ORDER BY d.channel
  `).all('workspace-1');
  const alertEventCount = db
    .prepare('SELECT COUNT(*) AS count FROM alert_event WHERE workspace_id = ?')
    .get('workspace-1');

  assert.deepEqual(result, {
    processedBatches: [
      {
        id: 'batch-1',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        alertPolicyId: 'policy-target-1',
        highestRiskAlertEventId: 'event-2',
        articleCount: 2,
        status: 'delivered',
        windowStartedAt: '2026-03-30T21:00:00.000Z',
        windowEndedAt: '2026-03-30T21:00:40.000Z',
        dispatchedAt: '2026-03-30T21:02:03.000Z',
        alertEventIds: ['event-1', 'event-2'],
        deliveries: [
          {
            id: 'batch-delivery-slack-1',
            channel: 'slack',
            destination: 'https://hooks.slack.com/services/T000/B000/SLACK1',
            finalStatus: 'sent',
            failureReason: null,
            payloadReference: 'slack-batch-1',
            sentAt: '2026-03-30T21:02:01.500Z',
          },
          {
            id: 'batch-delivery-email-1',
            channel: 'email',
            destination: ['desk@example.com'],
            finalStatus: 'sent',
            failureReason: null,
            payloadReference: 'email-batch-1',
            sentAt: '2026-03-30T21:02:02.500Z',
          },
        ],
        payload: {
          monitoringTargetName: 'Acme Holdings',
          articleCount: 2,
          additionalArticleCount: 1,
          thresholdValue: 80,
          highestRiskArticleTitle: 'Acme executive raided in corruption inquiry',
          highestRiskRiskScore: 97,
          highestRiskRiskBand: 'high',
          highestRiskRationale: 'The article reports raids and names multiple executives.',
          highestRiskPublisherName: 'Market Signal',
          highestRiskArticleUrl: 'https://source.example.com/canonical-2',
          windowStartedAt: '2026-03-30T21:00:00.000Z',
          windowEndedAt: '2026-03-30T21:00:40.000Z',
        },
      },
    ],
    totalProcessed: 1,
    dispatchedBatches: 1,
  });
  assert.deepEqual(normalizeRow(savedBatch), {
    id: 'batch-1',
    alert_policy_id: 'policy-target-1',
    highest_risk_alert_event_id: 'event-2',
    article_count: 2,
    status: 'delivered',
    window_started_at: '2026-03-30T21:00:00.000Z',
    window_ended_at: '2026-03-30T21:00:40.000Z',
    dispatched_at: '2026-03-30T21:02:03.000Z',
  });
  assert.deepEqual(savedBatchItems.map(normalizeRow), [
    { alert_event_id: 'event-1' },
    { alert_event_id: 'event-2' },
  ]);
  assert.deepEqual(savedBatchDeliveries.map(normalizeRow), [
    {
      id: 'batch-delivery-email-1',
      channel: 'email',
      destination: '["desk@example.com"]',
      final_status: 'sent',
      failure_reason: null,
      attempted_at: '2026-03-30T21:02:02.000Z',
      delivered_at: '2026-03-30T21:02:02.500Z',
    },
    {
      id: 'batch-delivery-slack-1',
      channel: 'slack',
      destination: 'https://hooks.slack.com/services/T000/B000/SLACK1',
      final_status: 'sent',
      failure_reason: null,
      attempted_at: '2026-03-30T21:02:01.000Z',
      delivered_at: '2026-03-30T21:02:01.500Z',
    },
  ]);
  assert.deepEqual(savedBatchDispatches.map(normalizeRow), [
    {
      channel: 'email',
      payload_reference: 'email-batch-1',
      sent_at: '2026-03-30T21:02:02.500Z',
    },
    {
      channel: 'slack',
      payload_reference: 'slack-batch-1',
      sent_at: '2026-03-30T21:02:01.500Z',
    },
  ]);
  assert.equal(alertEventCount.count, 4);
  assert.deepEqual(receivedCalls, [
    {
      channel: 'slack',
      destination: 'https://hooks.slack.com/services/T000/B000/SLACK1',
      payload: {
        monitoringTargetName: 'Acme Holdings',
        articleCount: 2,
        additionalArticleCount: 1,
        thresholdValue: 80,
        highestRiskArticleTitle: 'Acme executive raided in corruption inquiry',
        highestRiskRiskScore: 97,
        highestRiskRiskBand: 'high',
        highestRiskRationale: 'The article reports raids and names multiple executives.',
        highestRiskPublisherName: 'Market Signal',
        highestRiskArticleUrl: 'https://source.example.com/canonical-2',
        windowStartedAt: '2026-03-30T21:00:00.000Z',
        windowEndedAt: '2026-03-30T21:00:40.000Z',
      },
      highestRiskAlertEventId: 'event-2',
      alertEventIds: ['event-1', 'event-2'],
    },
    {
      channel: 'email',
      destination: ['desk@example.com'],
      payload: {
        monitoringTargetName: 'Acme Holdings',
        articleCount: 2,
        additionalArticleCount: 1,
        thresholdValue: 80,
        highestRiskArticleTitle: 'Acme executive raided in corruption inquiry',
        highestRiskRiskScore: 97,
        highestRiskRiskBand: 'high',
        highestRiskRationale: 'The article reports raids and names multiple executives.',
        highestRiskPublisherName: 'Market Signal',
        highestRiskArticleUrl: 'https://source.example.com/canonical-2',
        windowStartedAt: '2026-03-30T21:00:00.000Z',
        windowEndedAt: '2026-03-30T21:00:40.000Z',
      },
      highestRiskAlertEventId: 'event-2',
      alertEventIds: ['event-1', 'event-2'],
    },
  ]);

  db.close();
});

test('runOneMinuteAlertBatchingJob suppresses grouped batches when no channels are enabled', async () => {
  const db = createDatabase();

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
    defaultRiskThreshold: 75,
  });

  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme bribery probe expands',
    bodyText: 'Investigators expanded the bribery probe.',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    riskScore: 82,
    rationale: 'The article cites prosecutors and names current executives.',
  });
  insertAlertEvent(db, {
    id: 'event-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    articleAnalysisId: 'analysis-1',
    thresholdValue: 75,
    riskScore: 82,
    status: 'suppressed',
    dispatchedAt: null,
    updatedAt: '2026-03-30T22:00:00.000Z',
    triggeredAt: '2026-03-30T22:00:00.000Z',
  });

  insertArticle(db, {
    id: 'article-2',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-2',
  });
  insertArticleContent(db, {
    articleId: 'article-2',
    workspaceId: 'workspace-1',
    title: 'Acme board faces investor questions',
    bodyText: 'Investors are questioning recent disclosures.',
    publisherName: 'Capital Watch',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-2',
    riskScore: 90,
    rationale: 'The article describes a separate investor backlash story.',
  });
  insertAlertEvent(db, {
    id: 'event-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-2',
    articleAnalysisId: 'analysis-2',
    thresholdValue: 75,
    riskScore: 90,
    status: 'suppressed',
    dispatchedAt: null,
    updatedAt: '2026-03-30T22:00:40.000Z',
    triggeredAt: '2026-03-30T22:00:40.000Z',
  });

  const result = await runOneMinuteAlertBatchingJob({
    db,
    createId: createIdGenerator('batch-1'),
    now: createNowSequence('2026-03-30T22:02:00.000Z'),
  });

  const savedBatch = db.prepare(`
    SELECT alert_policy_id, highest_risk_alert_event_id, article_count, status, dispatched_at
    FROM alert_batch
    WHERE workspace_id = ? AND id = ?
  `).get('workspace-1', 'batch-1');
  const batchDeliveryCount = db
    .prepare('SELECT COUNT(*) AS count FROM alert_batch_delivery WHERE workspace_id = ?')
    .get('workspace-1');

  assert.deepEqual(result, {
    processedBatches: [
      {
        id: 'batch-1',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        alertPolicyId: null,
        highestRiskAlertEventId: 'event-2',
        articleCount: 2,
        status: 'suppressed',
        windowStartedAt: '2026-03-30T22:00:00.000Z',
        windowEndedAt: '2026-03-30T22:00:40.000Z',
        dispatchedAt: null,
        alertEventIds: ['event-1', 'event-2'],
        deliveries: [],
        payload: {
          monitoringTargetName: 'Acme Holdings',
          articleCount: 2,
          additionalArticleCount: 1,
          thresholdValue: 75,
          highestRiskArticleTitle: 'Acme board faces investor questions',
          highestRiskRiskScore: 90,
          highestRiskRiskBand: 'high',
          highestRiskRationale: 'The article describes a separate investor backlash story.',
          highestRiskPublisherName: 'Capital Watch',
          highestRiskArticleUrl: 'https://source.example.com/article-2',
          windowStartedAt: '2026-03-30T22:00:00.000Z',
          windowEndedAt: '2026-03-30T22:00:40.000Z',
        },
      },
    ],
    totalProcessed: 1,
    dispatchedBatches: 0,
  });
  assert.deepEqual(normalizeRow(savedBatch), {
    alert_policy_id: null,
    highest_risk_alert_event_id: 'event-2',
    article_count: 2,
    status: 'suppressed',
    dispatched_at: null,
  });
  assert.equal(batchDeliveryCount.count, 0);

  db.close();
});

test('runOneMinuteAlertBatchingJob is idempotent for already batched alert events', async () => {
  const db = createDatabase();
  let dispatchCount = 0;

  insertWorkspace(db, {
    id: 'workspace-1',
    slug: 'acme-risk',
    name: 'Acme Risk Desk',
  });
  insertMonitoringTarget(db, {
    id: 'target-1',
    workspaceId: 'workspace-1',
    displayName: 'Acme Holdings',
  });
  insertAlertPolicy(db, {
    id: 'policy-target-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    riskThreshold: 80,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SLACK1',
  });

  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme bribery probe expands',
    bodyText: 'Investigators expanded the bribery probe.',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    riskScore: 82,
    rationale: 'The article cites prosecutors and names current executives.',
  });
  insertAlertEvent(db, {
    id: 'event-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    articleAnalysisId: 'analysis-1',
    alertPolicyId: 'policy-target-1',
    thresholdValue: 80,
    riskScore: 82,
    triggeredAt: '2026-03-30T23:00:00.000Z',
  });

  insertArticle(db, {
    id: 'article-2',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-2',
  });
  insertArticleContent(db, {
    articleId: 'article-2',
    workspaceId: 'workspace-1',
    title: 'Acme executive raided in corruption inquiry',
    bodyText: 'The inquiry widened after a new raid.',
    publisherName: 'Market Signal',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-2',
    riskScore: 97,
    rationale: 'The article reports raids and names multiple executives.',
  });
  insertAlertEvent(db, {
    id: 'event-2',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-2',
    articleAnalysisId: 'analysis-2',
    alertPolicyId: 'policy-target-1',
    thresholdValue: 80,
    riskScore: 97,
    triggeredAt: '2026-03-30T23:00:40.000Z',
  });

  await runOneMinuteAlertBatchingJob({
    db,
    createId: createIdGenerator('batch-1', 'batch-delivery-slack-1'),
    now: createNowSequence(
      '2026-03-30T23:02:00.000Z',
      '2026-03-30T23:02:01.000Z',
      '2026-03-30T23:02:02.000Z',
    ),
    dispatchSlackAlert: async () => {
      dispatchCount += 1;
      return {
        payloadReference: 'slack-batch-1',
        sentAt: '2026-03-30T23:02:01.500Z',
      };
    },
  });

  const secondRun = await runOneMinuteAlertBatchingJob({
    db,
    now: createNowSequence('2026-03-30T23:03:00.000Z'),
    dispatchSlackAlert: async () => {
      dispatchCount += 1;
      return {
        payloadReference: 'slack-batch-2',
        sentAt: '2026-03-30T23:03:01.500Z',
      };
    },
  });

  const batchCount = db
    .prepare('SELECT COUNT(*) AS count FROM alert_batch WHERE workspace_id = ?')
    .get('workspace-1');
  const batchDeliveryCount = db
    .prepare('SELECT COUNT(*) AS count FROM alert_batch_delivery WHERE workspace_id = ?')
    .get('workspace-1');

  assert.deepEqual(secondRun, {
    processedBatches: [],
    totalProcessed: 0,
    dispatchedBatches: 0,
  });
  assert.equal(dispatchCount, 1);
  assert.equal(batchCount.count, 1);
  assert.equal(batchDeliveryCount.count, 1);

  db.close();
});
