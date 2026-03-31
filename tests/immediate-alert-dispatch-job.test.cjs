'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const { applyMigrations } = require('../src/db/migrations.cjs');
const {
  runImmediateAlertDispatchJob,
} = require('../src/backend/immediate-alert-dispatch-job.cjs');
const {
  completedArticleIngestionStatus,
} = require('../src/db/schema/article-ingestion.cjs');
const {
  activeMonitoringTargetStatus,
  pausedMonitoringTargetStatus,
} = require('../src/db/schema/monitoring-target.cjs');

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
    summary = 'Acme faces escalating bribery allegations.',
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
    thresholdValue = 70,
    riskScore,
    riskBand = 'high',
    status = 'pending',
    triggeredAt = '2026-03-30T20:50:00.000Z',
    dispatchedAt = null,
    createdAt = triggeredAt,
    updatedAt = triggeredAt,
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

function insertAlertDelivery(
  db,
  {
    id,
    workspaceId,
    alertEventId,
    alertPolicyId = null,
    channel,
    destination = null,
    finalStatus = 'pending',
    failureReason = null,
    attemptedAt = null,
    deliveredAt = null,
    createdAt = '2026-03-30T20:51:00.000Z',
    updatedAt = createdAt,
  },
) {
  db.prepare(`
    INSERT INTO alert_delivery (
      id,
      workspace_id,
      alert_event_id,
      alert_policy_id,
      channel,
      destination,
      final_status,
      failure_reason,
      attempted_at,
      delivered_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    alertEventId,
    alertPolicyId,
    channel,
    destination,
    finalStatus,
    failureReason,
    attemptedAt,
    deliveredAt,
    createdAt,
    updatedAt,
  );
}

function insertAlertDeliveryDispatch(
  db,
  {
    workspaceId,
    alertDeliveryId,
    payloadReference = null,
    sentAt = null,
    createdAt = '2026-03-30T20:51:30.000Z',
    updatedAt = createdAt,
  },
) {
  db.prepare(`
    INSERT INTO alert_delivery_dispatch (
      workspace_id,
      alert_delivery_id,
      payload_reference,
      sent_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(workspaceId, alertDeliveryId, payloadReference, sentAt, createdAt, updatedAt);
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

test('runImmediateAlertDispatchJob creates an alert event and dispatches enabled channels', async () => {
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
    note: 'Escalate legal and governance issues.',
  });
  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
    canonicalUrl: 'https://source.example.com/canonical-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme Holdings faces bribery probe',
    bodyText: 'Investigators expanded the bribery probe to senior leadership.',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    riskScore: 88,
    rationale: 'The article describes a widening bribery probe involving executives.',
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
    smsEnabled: true,
    smsRecipients: '["+12025550100"]',
  });

  const result = await runImmediateAlertDispatchJob({
    db,
    createId: createIdGenerator('event-1', 'delivery-slack-1', 'delivery-email-1', 'delivery-sms-1'),
    now: createNowSequence(
      '2026-03-30T21:00:00.000Z',
      '2026-03-30T21:00:01.000Z',
      '2026-03-30T21:00:02.000Z',
      '2026-03-30T21:00:03.000Z',
      '2026-03-30T21:00:04.000Z',
    ),
    dispatchSlackAlert: async (context) => {
      receivedCalls.push({
        channel: 'slack',
        destination: context.destination,
        payload: context.payload,
      });
      return {
        payloadReference: 'slack-message-1',
        sentAt: '2026-03-30T21:00:01.500Z',
      };
    },
    dispatchEmailAlert: async (context) => {
      receivedCalls.push({
        channel: 'email',
        destination: context.destination,
        payload: context.payload,
      });
      return {
        payloadReference: 'email-message-1',
        sentAt: '2026-03-30T21:00:02.500Z',
      };
    },
    dispatchSmsAlert: async (context) => {
      receivedCalls.push({
        channel: 'sms',
        destination: context.destination,
        payload: context.payload,
      });
      return {
        payloadReference: 'sms-message-1',
        sentAt: '2026-03-30T21:00:03.500Z',
      };
    },
  });

  const savedEvent = db.prepare(`
    SELECT
      id,
      alert_policy_id,
      threshold_value,
      risk_score,
      risk_band,
      status,
      triggered_at,
      dispatched_at
    FROM alert_event
    WHERE workspace_id = ? AND id = ?
  `).get('workspace-1', 'event-1');
  const savedDeliveries = db.prepare(`
    SELECT
      id,
      channel,
      destination,
      final_status,
      failure_reason,
      attempted_at,
      delivered_at
    FROM alert_delivery
    WHERE workspace_id = ?
    ORDER BY channel
  `).all('workspace-1');
  const savedDispatches = db.prepare(`
    SELECT
      d.channel,
      x.payload_reference,
      x.sent_at
    FROM alert_delivery_dispatch x
    JOIN alert_delivery d
      ON d.workspace_id = x.workspace_id
     AND d.id = x.alert_delivery_id
    WHERE x.workspace_id = ?
    ORDER BY d.channel
  `).all('workspace-1');

  assert.deepEqual(result, {
    processedAlerts: [
      {
        id: 'event-1',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        articleId: 'article-1',
        articleAnalysisId: 'analysis-1',
        alertPolicyId: 'policy-target-1',
        thresholdValue: 80,
        riskScore: 88,
        riskBand: 'high',
        status: 'delivered',
        triggeredAt: '2026-03-30T21:00:00.000Z',
        dispatchedAt: '2026-03-30T21:00:04.000Z',
        deliveries: [
          {
            id: 'delivery-slack-1',
            channel: 'slack',
            destination: 'https://hooks.slack.com/services/T000/B000/SLACK1',
            finalStatus: 'sent',
            failureReason: null,
            payloadReference: 'slack-message-1',
            sentAt: '2026-03-30T21:00:01.500Z',
          },
          {
            id: 'delivery-email-1',
            channel: 'email',
            destination: ['desk@example.com'],
            finalStatus: 'sent',
            failureReason: null,
            payloadReference: 'email-message-1',
            sentAt: '2026-03-30T21:00:02.500Z',
          },
          {
            id: 'delivery-sms-1',
            channel: 'sms',
            destination: ['+12025550100'],
            finalStatus: 'sent',
            failureReason: null,
            payloadReference: 'sms-message-1',
            sentAt: '2026-03-30T21:00:03.500Z',
          },
        ],
        payload: {
          monitoringTargetName: 'Acme Holdings',
          articleTitle: 'Acme Holdings faces bribery probe',
          riskScore: 88,
          riskBand: 'high',
          rationale: 'The article describes a widening bribery probe involving executives.',
          publisherName: 'Daily Ledger',
          articleUrl: 'https://source.example.com/canonical-1',
          thresholdValue: 80,
        },
      },
    ],
    totalProcessed: 1,
    dispatchedAlerts: 1,
  });
  assert.deepEqual(normalizeRow(savedEvent), {
    id: 'event-1',
    alert_policy_id: 'policy-target-1',
    threshold_value: 80,
    risk_score: 88,
    risk_band: 'high',
    status: 'delivered',
    triggered_at: '2026-03-30T21:00:00.000Z',
    dispatched_at: '2026-03-30T21:00:04.000Z',
  });
  assert.deepEqual(savedDeliveries.map(normalizeRow), [
    {
      id: 'delivery-email-1',
      channel: 'email',
      destination: '["desk@example.com"]',
      final_status: 'sent',
      failure_reason: null,
      attempted_at: '2026-03-30T21:00:02.500Z',
      delivered_at: '2026-03-30T21:00:02.500Z',
    },
    {
      id: 'delivery-slack-1',
      channel: 'slack',
      destination: 'https://hooks.slack.com/services/T000/B000/SLACK1',
      final_status: 'sent',
      failure_reason: null,
      attempted_at: '2026-03-30T21:00:01.500Z',
      delivered_at: '2026-03-30T21:00:01.500Z',
    },
    {
      id: 'delivery-sms-1',
      channel: 'sms',
      destination: '["+12025550100"]',
      final_status: 'sent',
      failure_reason: null,
      attempted_at: '2026-03-30T21:00:03.500Z',
      delivered_at: '2026-03-30T21:00:03.500Z',
    },
  ]);
  assert.deepEqual(savedDispatches.map(normalizeRow), [
    {
      channel: 'email',
      payload_reference: 'email-message-1',
      sent_at: '2026-03-30T21:00:02.500Z',
    },
    {
      channel: 'slack',
      payload_reference: 'slack-message-1',
      sent_at: '2026-03-30T21:00:01.500Z',
    },
    {
      channel: 'sms',
      payload_reference: 'sms-message-1',
      sent_at: '2026-03-30T21:00:03.500Z',
    },
  ]);
  assert.deepEqual(receivedCalls, [
    {
      channel: 'slack',
      destination: 'https://hooks.slack.com/services/T000/B000/SLACK1',
      payload: {
        monitoringTargetName: 'Acme Holdings',
        articleTitle: 'Acme Holdings faces bribery probe',
        riskScore: 88,
        riskBand: 'high',
        rationale: 'The article describes a widening bribery probe involving executives.',
        publisherName: 'Daily Ledger',
        articleUrl: 'https://source.example.com/canonical-1',
        thresholdValue: 80,
      },
    },
    {
      channel: 'email',
      destination: ['desk@example.com'],
      payload: {
        monitoringTargetName: 'Acme Holdings',
        articleTitle: 'Acme Holdings faces bribery probe',
        riskScore: 88,
        riskBand: 'high',
        rationale: 'The article describes a widening bribery probe involving executives.',
        publisherName: 'Daily Ledger',
        articleUrl: 'https://source.example.com/canonical-1',
        thresholdValue: 80,
      },
    },
    {
      channel: 'sms',
      destination: ['+12025550100'],
      payload: {
        monitoringTargetName: 'Acme Holdings',
        articleTitle: 'Acme Holdings faces bribery probe',
        riskScore: 88,
        riskBand: 'high',
        rationale: 'The article describes a widening bribery probe involving executives.',
        publisherName: 'Daily Ledger',
        articleUrl: 'https://source.example.com/canonical-1',
        thresholdValue: 80,
      },
    },
  ]);

  db.close();
});

test('runImmediateAlertDispatchJob records partial failures without dropping the alert event', async () => {
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
  });
  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme Holdings faces bribery probe',
    bodyText: 'Investigators expanded the bribery probe to senior leadership.',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    riskScore: 85,
    rationale: 'The article names executives and cites regulatory action.',
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

  const result = await runImmediateAlertDispatchJob({
    db,
    createId: createIdGenerator('event-1', 'delivery-slack-1', 'delivery-email-1'),
    now: createNowSequence(
      '2026-03-30T22:00:00.000Z',
      '2026-03-30T22:00:01.000Z',
      '2026-03-30T22:00:02.000Z',
      '2026-03-30T22:00:03.000Z',
    ),
    dispatchSlackAlert: async () => ({
      payloadReference: 'slack-message-1',
      sentAt: '2026-03-30T22:00:01.500Z',
    }),
    dispatchEmailAlert: async () => {
      throw new Error('SMTP provider rejected the message');
    },
  });

  const savedEvent = db
    .prepare(`
      SELECT status, dispatched_at
      FROM alert_event
      WHERE workspace_id = ? AND id = ?
    `)
    .get('workspace-1', 'event-1');
  const savedDeliveries = db
    .prepare(`
      SELECT channel, final_status, failure_reason
      FROM alert_delivery
      WHERE workspace_id = ?
      ORDER BY channel
    `)
    .all('workspace-1');
  const savedDispatches = db
    .prepare(`
      SELECT d.channel, x.payload_reference, x.sent_at
      FROM alert_delivery_dispatch x
      JOIN alert_delivery d
        ON d.workspace_id = x.workspace_id
       AND d.id = x.alert_delivery_id
      WHERE x.workspace_id = ?
      ORDER BY d.channel
    `)
    .all('workspace-1');

  assert.equal(result.processedAlerts[0].status, 'partially_delivered');
  assert.deepEqual(normalizeRow(savedEvent), {
    status: 'partially_delivered',
    dispatched_at: '2026-03-30T22:00:03.000Z',
  });
  assert.deepEqual(savedDeliveries.map(normalizeRow), [
    {
      channel: 'email',
      final_status: 'failed',
      failure_reason: 'SMTP provider rejected the message',
    },
    {
      channel: 'slack',
      final_status: 'sent',
      failure_reason: null,
    },
  ]);
  assert.deepEqual(savedDispatches.map(normalizeRow), [
    {
      channel: 'email',
      payload_reference: null,
      sent_at: null,
    },
    {
      channel: 'slack',
      payload_reference: 'slack-message-1',
      sent_at: '2026-03-30T22:00:01.500Z',
    },
  ]);

  db.close();
});

test('runImmediateAlertDispatchJob suppresses alerts when no delivery channels are enabled', async () => {
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
    title: 'Acme Holdings faces bribery probe',
    bodyText: 'Investigators expanded the bribery probe to senior leadership.',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    riskScore: 82,
    rationale: 'The article names executives and cites regulatory action.',
  });

  const result = await runImmediateAlertDispatchJob({
    db,
    createId: createIdGenerator('event-1'),
    now: createNowSequence('2026-03-30T23:00:00.000Z'),
  });

  const savedEvent = db
    .prepare(`
      SELECT alert_policy_id, threshold_value, status, dispatched_at
      FROM alert_event
      WHERE workspace_id = ? AND id = ?
    `)
    .get('workspace-1', 'event-1');
  const deliveryCount = db
    .prepare('SELECT COUNT(*) AS count FROM alert_delivery WHERE workspace_id = ?')
    .get('workspace-1');

  assert.deepEqual(result, {
    processedAlerts: [
      {
        id: 'event-1',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        articleId: 'article-1',
        articleAnalysisId: 'analysis-1',
        alertPolicyId: null,
        thresholdValue: 75,
        riskScore: 82,
        riskBand: 'high',
        status: 'suppressed',
        triggeredAt: '2026-03-30T23:00:00.000Z',
        dispatchedAt: null,
        deliveries: [],
        payload: {
          monitoringTargetName: 'Acme Holdings',
          articleTitle: 'Acme Holdings faces bribery probe',
          riskScore: 82,
          riskBand: 'high',
          rationale: 'The article names executives and cites regulatory action.',
          publisherName: 'Daily Ledger',
          articleUrl: 'https://source.example.com/article-1',
          thresholdValue: 75,
        },
      },
    ],
    totalProcessed: 1,
    dispatchedAlerts: 0,
  });
  assert.deepEqual(normalizeRow(savedEvent), {
    alert_policy_id: null,
    threshold_value: 75,
    status: 'suppressed',
    dispatched_at: null,
  });
  assert.equal(deliveryCount.count, 0);

  db.close();
});

test('runImmediateAlertDispatchJob is idempotent for analyses that already have an alert event', async () => {
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
  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme Holdings faces bribery probe',
    bodyText: 'Investigators expanded the bribery probe to senior leadership.',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    riskScore: 90,
    rationale: 'The article names executives and cites regulatory action.',
  });
  insertAlertPolicy(db, {
    id: 'policy-target-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    riskThreshold: 80,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SLACK1',
  });

  await runImmediateAlertDispatchJob({
    db,
    createId: createIdGenerator('event-1', 'delivery-slack-1'),
    now: createNowSequence(
      '2026-03-30T23:30:00.000Z',
      '2026-03-30T23:30:01.000Z',
      '2026-03-30T23:30:02.000Z',
    ),
    dispatchSlackAlert: async () => {
      dispatchCount += 1;
      return {
        payloadReference: 'slack-message-1',
        sentAt: '2026-03-30T23:30:01.500Z',
      };
    },
  });

  const secondRun = await runImmediateAlertDispatchJob({
    db,
    now: createNowSequence('2026-03-30T23:31:00.000Z'),
    dispatchSlackAlert: async () => {
      dispatchCount += 1;
      return {
        payloadReference: 'slack-message-2',
        sentAt: '2026-03-30T23:31:01.500Z',
      };
    },
  });

  const eventCount = db
    .prepare('SELECT COUNT(*) AS count FROM alert_event WHERE workspace_id = ?')
    .get('workspace-1');
  const deliveryCount = db
    .prepare('SELECT COUNT(*) AS count FROM alert_delivery WHERE workspace_id = ?')
    .get('workspace-1');

  assert.deepEqual(secondRun, {
    processedAlerts: [],
    totalProcessed: 0,
    dispatchedAlerts: 0,
  });
  assert.equal(dispatchCount, 1);
  assert.equal(eventCount.count, 1);
  assert.equal(deliveryCount.count, 1);

  db.close();
});

test('runImmediateAlertDispatchJob skips paused monitoring targets', async () => {
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
    status: pausedMonitoringTargetStatus,
  });
  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme Holdings faces bribery probe',
    bodyText: 'Investigators expanded the bribery probe to senior leadership.',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    riskScore: 88,
    rationale: 'The article describes a widening bribery probe involving executives.',
  });
  insertAlertPolicy(db, {
    id: 'policy-target-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    riskThreshold: 80,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SLACK1',
  });

  const result = await runImmediateAlertDispatchJob({
    db,
    now: createNowSequence('2026-03-31T00:00:00.000Z'),
    dispatchSlackAlert: async () => {
      dispatchCount += 1;
      return {
        payloadReference: 'slack-message-1',
        sentAt: '2026-03-31T00:00:01.000Z',
      };
    },
  });

  const eventCount = db
    .prepare('SELECT COUNT(*) AS count FROM alert_event WHERE workspace_id = ?')
    .get('workspace-1');

  assert.deepEqual(result, {
    processedAlerts: [],
    totalProcessed: 0,
    dispatchedAlerts: 0,
  });
  assert.equal(dispatchCount, 0);
  assert.equal(eventCount.count, 0);

  db.close();
});

test('runImmediateAlertDispatchJob retries existing dispatching events and replaces stale deliveries', async () => {
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
  insertArticle(db, {
    id: 'article-1',
    workspaceId: 'workspace-1',
    sourceUrl: 'https://source.example.com/article-1',
  });
  insertArticleContent(db, {
    articleId: 'article-1',
    workspaceId: 'workspace-1',
    title: 'Acme Holdings faces bribery probe',
    bodyText: 'Investigators expanded the bribery probe to senior leadership.',
    publisherName: 'Daily Ledger',
  });
  insertArticleAnalysis(db, {
    id: 'analysis-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    riskScore: 88,
    rationale: 'The article describes a widening bribery probe involving executives.',
  });
  insertAlertPolicy(db, {
    id: 'policy-target-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    riskThreshold: 80,
    slackEnabled: true,
    slackWebhookUrl: 'https://hooks.slack.com/services/T000/B000/SLACK1',
  });
  insertAlertEvent(db, {
    id: 'event-1',
    workspaceId: 'workspace-1',
    monitoringTargetId: 'target-1',
    articleId: 'article-1',
    articleAnalysisId: 'analysis-1',
    alertPolicyId: 'policy-target-1',
    thresholdValue: 80,
    riskScore: 88,
    status: 'dispatching',
    triggeredAt: '2026-03-30T23:59:00.000Z',
    createdAt: '2026-03-30T23:59:00.000Z',
    updatedAt: '2026-03-30T23:59:00.000Z',
  });
  insertAlertDelivery(db, {
    id: 'delivery-stale-1',
    workspaceId: 'workspace-1',
    alertEventId: 'event-1',
    alertPolicyId: 'policy-target-1',
    channel: 'slack',
    destination: 'https://hooks.slack.com/services/T000/B000/OLD',
    finalStatus: 'pending',
    createdAt: '2026-03-30T23:59:01.000Z',
    updatedAt: '2026-03-30T23:59:01.000Z',
  });
  insertAlertDeliveryDispatch(db, {
    workspaceId: 'workspace-1',
    alertDeliveryId: 'delivery-stale-1',
    payloadReference: 'stale-message',
    sentAt: '2026-03-30T23:59:02.000Z',
    createdAt: '2026-03-30T23:59:02.000Z',
    updatedAt: '2026-03-30T23:59:02.000Z',
  });

  const result = await runImmediateAlertDispatchJob({
    db,
    createId: createIdGenerator('delivery-slack-1'),
    now: createNowSequence(
      '2026-03-31T00:00:00.000Z',
      '2026-03-31T00:00:01.000Z',
      '2026-03-31T00:00:02.000Z',
    ),
    dispatchSlackAlert: async () => {
      dispatchCount += 1;
      return {
        payloadReference: 'slack-message-1',
        sentAt: '2026-03-31T00:00:01.500Z',
      };
    },
  });

  const savedEvent = db
    .prepare(`
      SELECT id, status, triggered_at, dispatched_at, updated_at
      FROM alert_event
      WHERE workspace_id = ? AND id = ?
    `)
    .get('workspace-1', 'event-1');
  const savedDeliveries = db
    .prepare(`
      SELECT id, channel, destination, final_status
      FROM alert_delivery
      WHERE workspace_id = ?
      ORDER BY id
    `)
    .all('workspace-1');
  const savedDispatches = db
    .prepare(`
      SELECT alert_delivery_id, payload_reference, sent_at
      FROM alert_delivery_dispatch
      WHERE workspace_id = ?
      ORDER BY alert_delivery_id
    `)
    .all('workspace-1');

  assert.equal(dispatchCount, 1);
  assert.deepEqual(result, {
    processedAlerts: [
      {
        id: 'event-1',
        workspaceId: 'workspace-1',
        monitoringTargetId: 'target-1',
        articleId: 'article-1',
        articleAnalysisId: 'analysis-1',
        alertPolicyId: 'policy-target-1',
        thresholdValue: 80,
        riskScore: 88,
        riskBand: 'high',
        status: 'delivered',
        triggeredAt: '2026-03-30T23:59:00.000Z',
        dispatchedAt: '2026-03-31T00:00:02.000Z',
        deliveries: [
          {
            id: 'delivery-slack-1',
            channel: 'slack',
            destination: 'https://hooks.slack.com/services/T000/B000/SLACK1',
            finalStatus: 'sent',
            failureReason: null,
            payloadReference: 'slack-message-1',
            sentAt: '2026-03-31T00:00:01.500Z',
          },
        ],
        payload: {
          monitoringTargetName: 'Acme Holdings',
          articleTitle: 'Acme Holdings faces bribery probe',
          riskScore: 88,
          riskBand: 'high',
          rationale: 'The article describes a widening bribery probe involving executives.',
          publisherName: 'Daily Ledger',
          articleUrl: 'https://source.example.com/article-1',
          thresholdValue: 80,
        },
      },
    ],
    totalProcessed: 1,
    dispatchedAlerts: 1,
  });
  assert.deepEqual(normalizeRow(savedEvent), {
    id: 'event-1',
    status: 'delivered',
    triggered_at: '2026-03-30T23:59:00.000Z',
    dispatched_at: '2026-03-31T00:00:02.000Z',
    updated_at: '2026-03-31T00:00:02.000Z',
  });
  assert.deepEqual(savedDeliveries.map(normalizeRow), [
    {
      id: 'delivery-slack-1',
      channel: 'slack',
      destination: 'https://hooks.slack.com/services/T000/B000/SLACK1',
      final_status: 'sent',
    },
  ]);
  assert.deepEqual(savedDispatches.map(normalizeRow), [
    {
      alert_delivery_id: 'delivery-slack-1',
      payload_reference: 'slack-message-1',
      sent_at: '2026-03-31T00:00:01.500Z',
    },
  ]);

  db.close();
});
